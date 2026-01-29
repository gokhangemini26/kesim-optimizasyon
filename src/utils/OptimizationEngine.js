
export const runWaterfallOptimization = (data) => {
    const { orderRows, groupingResults, avgConsumption, consumptionMode, sizeConsumptions } = data
    if (!groupingResults) return { plans: [], integrityMap: {} }

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

    // 2. Initial Allocation (Waterfall) - Same as before to distribute total quantity to lots
    let demandQueue = []
    orderRows.forEach(row => {
        Object.entries(row.quantities).forEach(([size, qty]) => {
            const q = parseInt(qty)
            if (q > 0) {
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
    demandQueue.sort((a, b) => b.totalQty - a.totalQty)
    allLots.sort((a, b) => b.currentMetraj - a.currentMetraj)

    const calcLen = (s) => (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption

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

    // 3. ADVANCED MARKER EFFICIENCY (New Logic)
    const finalPlans = []
    let cutIdCounter = 1

    allLots.forEach(lot => {
        if (lot.assignedOrders.length === 0) return

        // A. Aggregate Demand by Size (across all colors in this Lot)
        // Map: Size -> { totalQty: number, orders: [{color, qty}] }
        const sizeDemand = {}

        lot.assignedOrders.forEach(ord => {
            if (!sizeDemand[ord.size]) sizeDemand[ord.size] = { totalQty: 0, markerLen: ord.markerLen, orders: [] }
            sizeDemand[ord.size].totalQty += ord.qty
            sizeDemand[ord.size].orders.push(ord)
        })

        // B. Optimization Strategy: "Aggregate Block" Planning
        // We want to clear the 'totalQty' using high-ratio markers.
        // E.g. Size 32 Total: 150.
        // Try Ratio 4 (32/32/32/32) -> 150 / 4 = 37.5. Layers = 38 (Overproduced 152).



        Object.keys(sizeDemand).sort().forEach(size => { // Process sizes
            const data = sizeDemand[size]
            let qtyNeeded = data.totalQty

            // Try High Ratios Descending (4, 3, 2, 1)
            // Limit: Max 80 Layers.
            // Loop until qty is small

            while (qtyNeeded > 0) {
                // Determine Best Ratio
                // We want to maximize Ratio * Layers <= 80 * Ratio? No.
                // We want to maximize Pieces per Cut (Efficiency). 
                // Max Layers = 80.
                // Max Pieces per Cut = 80 * Ratio.
                // If we have 500 pieces. 
                // Ratio 4: 125 layers (Too high). Cap at 80. -> 320 pieces.
                // Ratio 6: 83 layers (Too high). Cap at 80 -> 480 pieces.

                // Heuristic: Try largest ratio (up to 6?) that fills at least 10 layers?
                // Or just standard greedy: Try Ratio X that clears remaining demand in 1 cut defined by max layers.

                // Let's iterate Ratios 6 down to 1.
                let bestMove = null

                for (let r = 8; r >= 1; r--) {
                    // How many layers needed?
                    let layers = Math.ceil(qtyNeeded / r)

                    if (layers > 80) layers = 80 // Cap

                    const pieces = layers * r

                    // Score = Pieces cleared.
                    // Prefer Higher Ratio if pieces are similar.
                    if (!bestMove || pieces > bestMove.pieces) {
                        bestMove = { ratio: r, layers, pieces }
                    }
                }

                // Check if this move is "Efficient". 
                // If we only need 5 pieces. Ratio 8 -> 1 layer -> 8 pieces. Overproduction 3. Fine.
                // If we need 5 pieces. Ratio 1 -> 5 layers -> 5 pieces. Exact.
                // User prefers "Fewer Cuts". So Ratio 8 is actually better (1 cut vs 1 cut, but 1 layer vs 5).
                // Actually fewer layers is faster? No, fewer cuts (pastal) is key.
                // But generally we want to fill the table (High Layers).
                // Let's stick to High Ratio if Layers >= 10.
                // If Layers < 10, maybe check if a lower ratio gives more layers?
                // Example: Need 40. 
                // Ratio 4 -> 10 Layers. (Good)
                // Ratio 1 -> 40 Layers. (Better? Density is higher).

                // Revised Strategy:
                // Prioritize HIGH LAYERS (approx 40-80).
                // Find a Ratio R such that Qty / R ~= 80.
                // Ideal Ratio = Qty / 80.
                // If Qty = 320. 320/80 = 4. Use Ratio 4.
                // If Qty = 100. 100/80 = 1.25. Use Ratio 1 (100 lay) or 2 (50 lay).

                let targetRatio = Math.round(qtyNeeded / 70) // Aim for 70 layers
                if (targetRatio < 1) targetRatio = 1
                if (targetRatio > 6) targetRatio = 6 // Cap ratio

                // Now calculate actuals
                let layers = Math.ceil(qtyNeeded / targetRatio)
                if (layers > 80) layers = 80

                const produced = layers * targetRatio

                // If this is a very small remnant (e.g. 5 pieces), defer to "Leftovers" logic?
                // Or just cut it.
                // Let's just create the plan.



                // Sort orders by size demand (Largest first to receive)
                data.orders.sort((a, b) => b.qty - a.qty)

                let layersToDist = layers
                const realPlanRows = []

                data.orders.forEach(ord => {
                    if (layersToDist <= 0) return
                    // How many layers can this order absorb?
                    // Need: ord.qty. One layer gives: targetRatio.
                    // LayersNeeded = ceil(ord.qty / targetRatio).
                    let lay = Math.min(layersToDist, Math.ceil(ord.qty / targetRatio))
                    if (lay > 0) {
                        realPlanRows.push({
                            colors: ord.color,
                            layers: lay,
                            quantities: { [size]: lay * targetRatio } // Display total pieces or ratio? Standard UI shows Ratio? NO, UI shows Qty.
                        })
                        ord.qty -= (lay * targetRatio) // update demand
                        layersToDist -= lay
                    }
                })

                // If layers remaining (Overproduction)
                if (layersToDist > 0 && realPlanRows.length > 0) {
                    realPlanRows[0].layers += layersToDist
                    realPlanRows[0].quantities[size] += (layersToDist * targetRatio)
                } else if (layersToDist > 0) {
                    // assigned to first
                    if (data.orders.length > 0) {
                        realPlanRows.push({
                            colors: data.orders[0].color,
                            layers: layersToDist,
                            quantities: { [size]: layersToDist * targetRatio }
                        })
                    }
                }

                const markerRatio = { [size]: targetRatio }

                finalPlans.push({
                    id: cutIdCounter++,
                    shrinkage: `${lot.mold} | LOT: ${lot.lot}`,
                    lot: lot.lot,
                    mold: lot.mold,
                    totalLayers: layers,
                    markerRatio: markerRatio,
                    markerLength: (data.markerLen * targetRatio).toFixed(2), // Approx
                    rows: realPlanRows,
                    fabrics: lot.fabrics.map(f => f.topNo).join(', '),
                    note: `Block: ${size} (x${targetRatio})`
                })

                qtyNeeded -= produced
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

            // Calculate planned from plans
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
