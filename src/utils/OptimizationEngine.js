
export const runWaterfallOptimization = (data) => {
    const { orderRows, groupingResults, avgConsumption, consumptionMode, sizeConsumptions } = data
    if (!groupingResults) return { plans: [], integrityMap: {} }

    // 1. Deep Copy & Flatten Lots
    const allLots = []
    const processGroup = (group, moldName) => {
        group.forEach(g => {
            allLots.push({
                ...g,
                currentMetraj: g.totalMetraj, // Working copy of metraj
                mold: moldName,
                assignedOrders: [] // Bucket for orders: { color, size, qty }
            })
        })
    }
    processGroup(groupingResults.kalip1, 'KALIP - 1 (0-3%)')
    processGroup(groupingResults.kalip2, 'KALIP - 2 (3.1-6%)')
    processGroup(groupingResults.kalip3, 'KALIP - 3 (6.1-9%)')

    // 2. Prepare & Sort Demand
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
                    allocations: [] // { lotId, qty } to track integrity
                })
            }
        })
    })
    // Sort: Largest Demand First
    demandQueue.sort((a, b) => b.totalQty - a.totalQty)

    // Sort Lots: Largest Supply First
    allLots.sort((a, b) => b.currentMetraj - a.currentMetraj)

    const calcLen = (s) => (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[s]) : 0) || avgConsumption

    // 3. Allocation Loop
    demandQueue.forEach(item => {
        while (item.remainingQty > 0) {
            // Find Candidate Lots
            // Preference 1: Fits COMPLETELY (Scenario A)
            let candidateLot = allLots.find(lot => {
                if (lot.currentMetraj <= 0) return false
                const markerLen = calcLen(item.size)
                const maxCap = Math.floor(lot.currentMetraj / markerLen)
                return maxCap >= item.remainingQty
            })

            // Preference 2: If no complete fit, find Largest Available (Scenario B)
            if (!candidateLot) {
                // Find lot with MAX current metraj
                candidateLot = allLots.reduce((max, lot) => lot.currentMetraj > (max?.currentMetraj || 0) ? lot : max, null)
            }

            if (!candidateLot || candidateLot.currentMetraj <= 0) {
                // No fabric left at all anywhere
                break
            }

            // Execute Cut for this step
            const markerLen = calcLen(item.size)
            const maxLotCap = Math.floor(candidateLot.currentMetraj / markerLen)
            const qtyToCut = Math.min(item.remainingQty, maxLotCap)

            if (qtyToCut <= 0) break // Should not happen if metraj > 0 but safety

            // Assign
            candidateLot.assignedOrders.push({
                color: item.color,
                size: item.size,
                qty: qtyToCut,
                markerLen: markerLen
            })

            candidateLot.currentMetraj -= (qtyToCut * markerLen)
            item.remainingQty -= qtyToCut
            item.allocations.push({ lot: candidateLot.lot, qty: qtyToCut })
        }
    })

    // 4. Marker Efficiency & Plan Generation (UPDATED FOR MULTI-SIZE)
    const finalPlans = []
    let cutIdCounter = 1

    allLots.forEach(lot => {
        if (lot.assignedOrders.length === 0) return

        // 1. Group by Color
        const colorGroups = {}
        lot.assignedOrders.forEach(ord => {
            if (!colorGroups[ord.color]) colorGroups[ord.color] = []
            colorGroups[ord.color].push(ord)
        })

        // 2. Process each color group
        Object.entries(colorGroups).forEach(([color, orders]) => {
            // Aggregate orders by size to handle multiple partial allocations for same size
            const sizePool = {}
            orders.forEach(o => {
                if (!sizePool[o.size]) sizePool[o.size] = { qty: 0, markerLen: o.markerLen }
                sizePool[o.size].qty += o.qty
            })

            // Create working list of sizes
            let workSizes = Object.entries(sizePool).map(([size, data]) => ({
                size,
                qty: data.qty,
                markerLen: data.markerLen
            }))

            // Sort sizes to mix Small & Large:
            // S, M, L, XL -> We want S+XL, M+L logic to balance marker
            // Sort standard alphanumeric (matches user expectation roughly)
            workSizes.sort((a, b) => String(a.size).localeCompare(String(b.size), undefined, { numeric: true }))

            while (workSizes.length > 0) {
                // Strategy: Pick up to 4 sizes.
                // Try to take 1 from Start (Small), 1 from End (Large), Repeat.
                // This creates a "Mix" marker.

                const selected = []
                const indicesToRemove = []

                // Helper to pick
                const pickIndex = (idx) => {
                    if (idx >= 0 && idx < workSizes.length && !indicesToRemove.includes(idx)) {
                        selected.push(workSizes[idx])
                        indicesToRemove.push(idx)
                        return true
                    }
                    return false
                }

                // Pick 1: Smallest
                pickIndex(0)
                // Pick 2: Largest (if diff)
                if (workSizes.length > 1) pickIndex(workSizes.length - 1)
                // Pick 3: 2nd Smallest (if valid)
                if (workSizes.length > 2) pickIndex(1)
                // Pick 4: 2nd Largest (if valid)
                if (workSizes.length > 3) pickIndex(workSizes.length - 2)

                // Now we have 'selected' list of up to 4 items.
                // Determine Layer Count
                const minQty = Math.min(...selected.map(s => s.qty))
                const maxQty = Math.max(...selected.map(s => s.qty))

                // SMART MERGE LOGIC:
                // If the difference is small (e.g. <= 8 layers), just do the MAX to avoid a tiny remnant cut.
                // Unless MAX > HARD_CAP (80), then we are limited by the table anyway.

                let layers = minQty
                const REMNANT_TOLERANCE = 8

                console.log(`[SmartMerge] Checking: Sizes=[${selected.map(s => s.size).join(',')}], Qty=[${selected.map(s => s.qty).join(',')}], Min=${minQty}, Max=${maxQty}, Diff=${maxQty - minQty}`)

                if (maxQty <= 80 && (maxQty - minQty) <= REMNANT_TOLERANCE) {
                    console.log(`[SmartMerge] MERGING! Upgrading layers to ${maxQty}`)
                    layers = maxQty // All selected sizes get cleared! (Some overproduction)
                } else {
                    layers = Math.min(minQty, 80) // Capped standard logic
                }

                // Calculate Marker Stats
                let totalMarkerLen = 0
                const markerRatio = {}
                const rowQuantities = {}

                selected.forEach(s => {
                    totalMarkerLen += s.markerLen
                    markerRatio[s.size] = 1 // Ratio 1 for each
                    rowQuantities[s.size] = layers
                })

                // Create Plan
                finalPlans.push({
                    id: cutIdCounter++,
                    shrinkage: `${lot.mold} | LOT: ${lot.lot}`,
                    lot: lot.lot,
                    mold: lot.mold,
                    totalLayers: layers,
                    markerRatio: markerRatio,
                    markerLength: totalMarkerLen.toFixed(2),
                    rows: [{
                        colors: color,
                        layers: layers,
                        quantities: rowQuantities
                    }],
                    fabrics: lot.fabrics.map(f => f.topNo).join(', '),
                    note: `Multi-Size: ${selected.map(s => s.size).join('+')} (${layers} L)`
                })

                // Update Remaining Quantities in Work Pool
                // We just decrement. If qty becomes 0, we remove from queue.
                selected.forEach(s => {
                    // Update the object in workSizes directly (since selected contains refs)
                    s.qty -= layers
                })

                // Remove finished sizes
                workSizes = workSizes.filter(s => s.qty > 0)
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
    // Re-use logic from App.jsx but enhanced
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

            // Integrity
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
