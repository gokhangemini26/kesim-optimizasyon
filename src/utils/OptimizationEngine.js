
export const runWaterfallOptimization = (data) => {
    const { orderRows, groupingResults, avgConsumption, consumptionMode, sizeConsumptions } = data
    if (!groupingResults) return { plans: [], integrityMap: {} }

    // Helper for consumption
    const calcLen = (s) => (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption



    // 1. Deep Copy & Flatten Lots
    const allLots = []
    const processGroup = (group, moldName) => {
        group.forEach(g => {
            allLots.push({
                ...g,
                currentMetraj: g.totalMetraj,
                mold: moldName,
                assignedOrders: [] // { color, size, qty, markerLen }
            })
        })
    }
    processGroup(groupingResults.kalip1, 'KALIP - 1 (0-3%)')
    processGroup(groupingResults.kalip2, 'KALIP - 2 (3.1-6%)')
    processGroup(groupingResults.kalip3, 'KALIP - 3 (6.1-9%)')

    // 2. Initial Allocation (Proportional)
    // Goal: Use Proportional Allocation to ensure equal distribution of deficits.

    // Group orders by "Fabric Group" (Mold) to match against Lots.
    // However, orders come in flat `orderRows`. 
    // We need to know which lots belong to which order/mold?
    // Actually, `runWaterfallOptimization` runs once per "Production Request" which usually implies one context.
    // But `groupingResults` has kalip1, kalip2, etc.
    // Orders are just {color, quantities}. Implicitly they apply to ALL groups? 
    // Standard logic: Total Fabric Available vs Total Demand.

    let totalMetrajAvailable = allLots.reduce((acc, l) => acc + l.currentMetraj, 0)

    // Calculate Total Demand in Metraj (Approx)
    // We need to loop all orders and calc metraj needed.
    let totalDemandMetraj = 0
    let demandQueue = []

    orderRows.forEach(row => {
        Object.entries(row.quantities).forEach(([size, qty]) => {
            const q = parseInt(qty)
            if (q > 0) {
                const len = calcLen(size)
                totalDemandMetraj += (q * len)

                demandQueue.push({
                    id: `${row.color}-${size}`,
                    color: row.color,
                    size: size,
                    totalQty: q,
                    remainingQty: q,
                    allocations: []
                })
            }
        })
    })

    // Calculate Global Reduction Factor
    let reductionFactor = 1.0
    if (totalMetrajAvailable < totalDemandMetraj && totalDemandMetraj > 0) {
        reductionFactor = totalMetrajAvailable / totalDemandMetraj
        // console.log(`[Proportional] Deficit detected. Factor: ${reductionFactor.toFixed(4)}`)
    }

    // Apply Reduction to "valid" demand for allocation
    // We don't change `totalQty` (original demand), but we track `allocatableQty`?
    // Or we just rely on the loop stopping?
    // If we rely on the loop, it's greedy.
    // We MUST limit `remainingQty` based on the factor first.

    if (reductionFactor < 1.0) {
        demandQueue.forEach(item => {
            // Floor to ensure we don't exceed check
            const fairShare = Math.floor(item.totalQty * reductionFactor)
            // If fairShare is 0 but we have factor > 0, gives at least 1? No, strict proportional.
            item.remainingQty = fairShare

            // Track deficit for reporting 'Eksik'?
            // The 'Eksik' is calculated by result vs original demand. 
            // If we limit remainingQty here, the allocating loop will stop early, leaving 'allocations' short.
            // Results calculation uses `allocations`. Correct.
        })
    }

    demandQueue.sort((a, b) => b.totalQty - a.totalQty)
    // Sort lots by size to prioritize biggest fabric rolls?
    allLots.sort((a, b) => b.currentMetraj - a.currentMetraj)

    demandQueue.forEach(item => {
        while (item.remainingQty > 0) {
            let candidateLot = allLots.find(lot => {
                if (lot.currentMetraj <= 0) return false
                const markerLen = calcLen(item.size)
                const maxCap = Math.floor(lot.currentMetraj / markerLen)
                return maxCap >= item.remainingQty
            })
            if (!candidateLot) {
                candidateLot = allLots.reduce((max, lot) => lot.currentMetraj > (max?.currentMetraj || 0) ? lot : max, null)
            }
            if (!candidateLot || candidateLot.currentMetraj <= 0) break

            const markerLen = calcLen(item.size)
            const maxLotCap = Math.floor(candidateLot.currentMetraj / markerLen)
            const qtyToCut = Math.min(item.remainingQty, maxLotCap)
            if (qtyToCut <= 0) break

            candidateLot.assignedOrders.push({
                color: item.color,
                size: item.size,
                qty: qtyToCut,
                markerLen: markerLen,
                originalId: item.id
            })
            candidateLot.currentMetraj -= (qtyToCut * markerLen)
            item.remainingQty -= qtyToCut
            item.allocations.push({ lot: candidateLot.lot, qty: qtyToCut })
        }
    })

    // 3. ADVANCED MARKER EFFICIENCY
    const finalPlans = []
    let cutIdCounter = 1

    allLots.forEach(lot => {
        if (lot.assignedOrders.length === 0) return

        const sizeDemand = {}
        lot.assignedOrders.forEach(ord => {
            if (!sizeDemand[ord.size]) sizeDemand[ord.size] = { totalQty: 0, markerLen: ord.markerLen, orders: [] }
            sizeDemand[ord.size].totalQty += ord.qty
            sizeDemand[ord.size].orders.push(ord)
        })

        // Two-Phase Strategy:
        // Phase 1: High Volume Cuts (> 50 pieces)
        // Phase 2: Remainder Optimization

        const MIN_PIECES_THRESHOLD = 50

        // Helper to Create Plan
        const createPlan = (size, layers, ratio, ordersData) => {
            const planRows = []
            let layersToDist = layers

            // EQUAL DISTRIBUTION LOGIC
            // Distribute layers equally among active orders to balance deficits
            while (layersToDist > 0) {
                const activeOrders = ordersData.filter(o => o.qty > 0)
                if (activeOrders.length === 0) break // All filled, overproduction

                // Each gets at least 1 layer, or share
                // Share = ceil(layersToDist / activeCount)
                // But wait, if share > remaining_need, we waste.
                // Simple round robin: Give 1 layer to each active order until layersToDist runs out?
                // For large layers (e.g. 70), calculating share is faster.

                const share = Math.max(1, Math.floor(layersToDist / activeOrders.length))
                let distributedInPass = 0

                console.log(`[Distrib] LayersToDist: ${layersToDist}, Active: ${activeOrders.length}, Share: ${share}`)

                activeOrders.forEach(ord => {
                    if (layersToDist <= 0) return

                    // Need in layers?
                    const needLayers = Math.ceil(ord.qty / ratio)
                    console.log(`  > Order ${ord.color}: Qty ${ord.qty}, NeedLayers ${needLayers}`)
                    const give = Math.min(share, needLayers, layersToDist)

                    if (give > 0) {
                        let plRow = planRows.find(pr => pr.colors === ord.color)
                        if (!plRow) {
                            plRow = { colors: ord.color, layers: 0, quantities: { [size]: 0 } }
                            planRows.push(plRow)
                        }
                        plRow.layers += give
                        plRow.quantities[size] += (give * ratio)
                        ord.qty -= (give * ratio)
                        layersToDist -= give
                        distributedInPass += give
                    }
                })

                // If we couldn't distribute anything but still have layers (Overproduction)
                if (distributedInPass === 0 && layersToDist > 0) {
                    // Force distribute to first available (or just the first one)
                    const ord = ordersData[0] // Just dump on the first one
                    let plRow = planRows.find(pr => pr.colors === ord.color)
                    if (!plRow) {
                        plRow = { colors: ord.color, layers: 0, quantities: { [size]: 0 } }
                        planRows.push(plRow)
                    }
                    plRow.layers += layersToDist
                    plRow.quantities[size] += (layersToDist * ratio)
                    layersToDist = 0
                }
            }

            // Sort plan rows for consistent display
            planRows.sort((a, b) => b.layers - a.layers)

            const markerRatio = { [size]: ratio }
            finalPlans.push({
                id: cutIdCounter++,
                shrinkage: `${lot.mold} | LOT: ${lot.lot}`,
                lot: lot.lot,
                mold: lot.mold,
                totalLayers: layers,
                markerRatio: markerRatio,
                markerLength: (ordersData[0].markerLen * ratio).toFixed(2),
                rows: planRows,
                fabrics: lot.fabrics.map(f => f.topNo).join(', '),
                note: `Block: ${size} (x${ratio})`
            })
        }


        // PHASE 1: Process Sizes for High Volume
        Object.keys(sizeDemand).sort().forEach(size => {
            const data = sizeDemand[size]
            let qtyNeeded = data.totalQty

            while (qtyNeeded > 0) {
                let bestMove = null

                // Find best ratio for High Volume
                for (let r = 8; r >= 1; r--) {
                    let layers = Math.ceil(qtyNeeded / r)
                    if (layers > 80) layers = 80
                    const pieces = layers * r

                    // STRICT FILTER: Only accept if > 50 pieces
                    if (pieces >= MIN_PIECES_THRESHOLD) {
                        // Score: Maximize efficiency (pieces per cut)
                        if (!bestMove || pieces > bestMove.pieces) {
                            bestMove = { ratio: r, layers, pieces }
                        }
                    }
                }

                if (bestMove) {
                    // Execute High Volume Cut
                    createPlan(size, bestMove.layers, bestMove.ratio, data.orders)
                    qtyNeeded -= bestMove.pieces
                } else {
                    // No high volume move possible. Break to Phase 2 (Leftovers)
                    // We update the data.totalQty to reflect what's remaining to be cut?
                    // Actually 'qtyNeeded' is just a local tracker. The 'data.orders' have their .qty reduced directly in createPlan.
                    // So we just break the loop. 
                    break
                }
            }
        })

        // PHASE 2: Leftovers (Any remaining quantity in data.orders)
        // We can just run the loop again without the threshold, OR use multi-size?
        // User said: "Once 50 adet ve ustu kesimleri olustur, sonra kalanlari mantikli olarak planla".
        // Let's run a second pass allowing small cuts.

        Object.keys(sizeDemand).sort().forEach(size => {
            const data = sizeDemand[size]
            // Recalculate needed based on remaining order quantities
            let remainingTotal = data.orders.reduce((acc, o) => acc + Math.max(0, o.qty), 0)

            while (remainingTotal > 0) {
                // Standard Greedy for leftovers
                let targetRatio = Math.round(remainingTotal / 70)
                if (targetRatio < 1) targetRatio = 1
                if (targetRatio > 6) targetRatio = 6

                let layers = Math.ceil(remainingTotal / targetRatio)
                if (layers > 80) layers = 80

                createPlan(size, layers, targetRatio, data.orders)
                remainingTotal -= (layers * targetRatio)

                // Safety break if we are stuck (should not happen as we reduce qty)
                if (layers <= 0) break
            }
        })

    })

    // UPDATE UI WITH INTEGRITY SCORES
    const integrityMap = {}
    demandQueue.forEach(d => {
        const key = `${d.color}-${d.size}`
        const primaryAlloc = d.allocations.sort((a, b) => b.qty - a.qty)[0]
        const primeQty = primaryAlloc ? primaryAlloc.qty : 0
        const score = d.totalQty > 0 ? (primeQty / d.totalQty) * 100 : 100
        integrityMap[key] = {
            score: score.toFixed(0),
            allocations: d.allocations
        }
    })

    return { plans: finalPlans, integrityMap }
}

export const generateSummary = (orderRows, plans, integrityMap) => {
    const allSizesSet = new Set()
    orderRows.forEach(order => {
        Object.keys(order.quantities).forEach(sz => allSizesSet.add(sz))
    })
    const allSizes = Array.from(allSizesSet).sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
    )

    return orderRows.map(order => {
        const originalDemanded = {}
        const planned = {}
        const integrity = {}

        allSizes.forEach(sz => {
            originalDemanded[sz] = parseInt(order.quantities[sz]) || 0
            planned[sz] = 0

            plans.forEach(plan => {
                plan.rows.forEach(r => {
                    if (r.colors === order.color) {
                        planned[sz] += (r.quantities[sz] || 0)
                    }
                })
            })

            integrity[sz] = integrityMap[`${order.color}-${sz}`] || { score: 100, allocations: [] }
        })

        return {
            color: order.color,
            demanded: originalDemanded,
            planned: planned,
            integrity: integrity
        }
    })
}
