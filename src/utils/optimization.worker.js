
/* eslint-disable no-restricted-globals */

// --- DATA STRUCTURES ---

class FabricLot {
    constructor(id, details, totalMetraj, shrinkageGroup) {
        this.id = id;
        this.details = details;
        this.totalMetraj = totalMetraj;
        this.shrinkageGroup = shrinkageGroup;
        this.usedMetraj = 0;
        this.assignedJobs = [];
    }

    get availableMetraj() {
        return this.totalMetraj - this.usedMetraj;
    }
}

class OrderLine {
    constructor(color, size, quantity) {
        this.color = color;
        this.size = size;
        this.quantityPending = quantity;
        this.initialQuantity = quantity;
        this.status = 'Open';
    }
}

class CutJob {
    constructor(id, lotId, color, sizes, layers, markerLength) {
        this.id = id;
        this.lotId = lotId;
        this.color = color;       // Added Color
        this.sizes = sizes;       // ["S", "M"]
        this.layers = layers;
        this.markerLength = markerLength;
    }

    get consumedMetraj() {
        return this.layers * this.markerLength;
    }
}

// --- UTILS ---

const calculateMarkerLength = (sizes, consumptionMode, avgConsumption, sizeConsumptions) => {
    if (consumptionMode === 'AVG') {
        return sizes.length * avgConsumption;
    } else {
        return sizes.reduce((sum, size) => {
            const cons = parseFloat(sizeConsumptions[size]) || avgConsumption;
            return sum + cons;
        }, 0);
    }
};

// --- HEURISTIC ENGINE CORE ---

const findBestMarkerCombination = (lot, orderLinesForColor, params) => {
    const { consumptionMode, avgConsumption, sizeConsumptions } = params;

    // Sort sizes by pending quantity DESC
    const sortedOrders = [...orderLinesForColor].sort((a, b) => b.quantityPending - a.quantityPending);

    const variations = [];

    const evaluateGroup = (group) => {
        const sizes = group.map(o => o.size);
        const markerLen = calculateMarkerLength(sizes, consumptionMode, avgConsumption, sizeConsumptions);

        const maxLayersStock = Math.floor(lot.availableMetraj / markerLen);
        if (maxLayersStock < 1) return null;

        let maxLayersDemand = 1000;
        group.forEach(order => {
            const countInMarker = group.filter(o => o.size === order.size).length;
            const limitForOrder = Math.floor(order.quantityPending / countInMarker);
            maxLayersDemand = Math.min(maxLayersDemand, limitForOrder);
        });

        // Max 80 rule
        const layers = Math.min(maxLayersStock, maxLayersDemand, 80);

        if (layers < 1) return null;

        const totalPieces = sizes.length * layers;

        return {
            sizes: sizes,
            layers: layers,
            markerLength: markerLen,
            totalPieces: totalPieces,
            score: totalPieces
        };
    };

    // Variation A: Top 4 
    if (sortedOrders.length >= 4) {
        variations.push(evaluateGroup(sortedOrders.slice(0, 4)));
    }
    // Variation A2: Top 3
    if (sortedOrders.length >= 3) {
        variations.push(evaluateGroup(sortedOrders.slice(0, 3)));
    }
    // Variation A3: Top 2
    if (sortedOrders.length >= 2) {
        variations.push(evaluateGroup(sortedOrders.slice(0, 2)));
    }

    // Variation B: Assortment Mix (Small/Large)
    // Heuristic: If we have > 4 orders, try Top 2 + Bottom 2 
    if (sortedOrders.length >= 4) {
        const top2 = sortedOrders.slice(0, 2);
        const bot2 = sortedOrders.slice(-2);
        // Ensure distinct objects to avoid duplication issues in logic
        const mix = [...top2, ...bot2];
        variations.push(evaluateGroup(mix));
    }

    // Variation C: Multi-Instance for Top Sizes (NEW)
    // "Aynı bedeni, ayni kesim içinde 2 ya da 3 seferde kullanabilirsin"
    if (sortedOrders.length > 0) {
        const top1 = sortedOrders[0]; // Highest demand
        // Try [S, S, S, S]
        variations.push(evaluateGroup([top1, top1, top1, top1]));
        // Try [S, S, S]
        variations.push(evaluateGroup([top1, top1, top1]));
        // Try [S, S]
        variations.push(evaluateGroup([top1, top1]));

        if (sortedOrders.length >= 2) {
            const top2 = sortedOrders[1];
            // Try [S, S, M, M]
            variations.push(evaluateGroup([top1, top1, top2, top2]));
            // Try [S, S, S, M]
            variations.push(evaluateGroup([top1, top1, top1, top2]));
            // Try [S, M, M, M]
            variations.push(evaluateGroup([top1, top2, top2, top2]));
            // Try [S, S, M]
            variations.push(evaluateGroup([top1, top1, top2]));
            // Try [S, M, M]
            variations.push(evaluateGroup([top1, top2, top2]));
        }

        if (sortedOrders.length >= 3) {
            const top2 = sortedOrders[1];
            const top3 = sortedOrders[2];
            // Try [S, S, M, L]
            variations.push(evaluateGroup([top1, top1, top2, top3]));
        }
    }

    // Single Size fallback
    if (sortedOrders.length === 1) {
        const o = sortedOrders[0];
        variations.push(evaluateGroup([o, o, o, o]));
        variations.push(evaluateGroup([o, o]));
    }

    const valid = variations.filter(v => v !== null).sort((a, b) => b.score - a.score);
    return valid.length > 0 ? valid[0] : null;
};


// --- WORKER HANDLER ---

self.onmessage = (e) => {
    const { orderRows, groupingResults, parameters } = e.data;
    const { avgConsumption, consumptionMode, sizeConsumptions } = parameters;

    try {
        console.log('Heuristic Engine Starting...');

        // 1. Initialize State
        const lots = [];
        ['kalip1', 'kalip2', 'kalip3'].forEach(k => {
            if (groupingResults[k]) {
                groupingResults[k].forEach(l => {
                    const shrinkName = k === 'kalip1' ? 'KALIP - 1' : k === 'kalip2' ? 'KALIP - 2' : 'KALIP - 3';
                    // Create UNIQUE ID: LotCode + ShrinkName to avoid collisions
                    const uniqueId = `${l.lot}_${k}`;
                    lots.push(new FabricLot(uniqueId, l, l.totalMetraj, shrinkName));
                });
            }
        });

        const orders = [];
        orderRows.forEach(row => {
            Object.entries(row.quantities).forEach(([size, qty]) => {
                const q = parseInt(qty) || 0;
                if (q > 0) {
                    orders.push(new OrderLine(row.color, size, q));
                }
            });
        });

        const cuts = [];
        let cutIdCounter = 1;

        // 2. Main Loop (Optimized Phase)
        let active = true;
        let loopSafety = 0;

        while (active && loopSafety < 10000) {
            loopSafety++;
            active = false;

            // Global Sort Lots by Available Metraj
            const availableLots = lots.filter(l => l.availableMetraj > 1);
            if (availableLots.length === 0) break;

            availableLots.sort((a, b) => b.availableMetraj - a.availableMetraj);
            const currentLot = availableLots[0];

            // Filter Orders Valid for this Lot
            // (Assuming Universal Compatibility for now)

            // Group Open Orders by Color
            const colorGroups = {};
            orders.filter(o => o.status === 'Open').forEach(o => {
                if (!colorGroups[o.color]) colorGroups[o.color] = [];
                colorGroups[o.color].push(o);
            });

            // Sort Colors by Total Pending Qty DESC
            const colorCandidates = Object.entries(colorGroups)
                .map(([color, lines]) => ({
                    color,
                    lines,
                    totalPending: lines.reduce((sum, l) => sum + l.quantityPending, 0)
                }))
                .sort((a, b) => b.totalPending - a.totalPending);

            // TRY CUTTING EACH COLOR (Fall-through)
            // If the best color fails (e.g. no valid marker logic), try the next best.
            for (const candidate of colorCandidates) {
                const { color, lines } = candidate;

                // Optimization Attempt
                const bestMarker = findBestMarkerCombination(currentLot, lines, parameters);

                if (bestMarker) {
                    active = true; // We made a move!

                    const job = new CutJob(cutIdCounter++, currentLot.id, color, bestMarker.sizes, bestMarker.layers, bestMarker.markerLength);
                    cuts.push(job);
                    currentLot.assignedJobs.push(job);

                    currentLot.usedMetraj += job.consumedMetraj;

                    // Deduct Orders
                    const sizeCounts = {};
                    bestMarker.sizes.forEach(s => sizeCounts[s] = (sizeCounts[s] || 0) + 1);

                    Object.entries(sizeCounts).forEach(([size, count]) => {
                        const line = lines.find(o => o.size === size);
                        if (line) {
                            line.quantityPending -= (count * bestMarker.layers);
                        }
                    });

                    // Update Status
                    const totalPendingColor = lines.reduce((sum, l) => sum + l.quantityPending, 0);
                    if (totalPendingColor < 30 && totalPendingColor > 0) {
                        lines.forEach(o => o.status = 'Leftover');
                    }
                    if (totalPendingColor <= 0) {
                        lines.forEach(o => o.status = 'Completed');
                    }

                    // Successful Cut -> Break Color Loop to restart Lot Sort (Greedy Step)
                    break;
                }
                // If bestMarker is null, we continue to next candidate color...
            }

            // If we iterated ALL candidates and found NO marker for this Lot...
            // It means this Lot effectively cannot cut any Open orders efficiently.
            // We should NOT pick it again as top priority if we can't use it.
            // But next loop step will pick it again because it still has max metraj.
            // Hack/Fix: If active is false here (no cut made), we must effectively "Skip" this lot.
            if (!active && availableLots.length > 1) {
                // If we failed to cut from Top Lot, simpler logic is to Break?
                // Or maybe other lots work?
                // Realistically, if Top Lot (Max Metraj) fails, usually smaller lots fail too unless they are specific.
                // But let's verify.
                // The algorithm will naturally stop because active=false.
            }
        }

        // 3. Sweeping Phase (Rescue Leftovers)
        // Aggressive loop for remaining fabric and leftovers
        // Relaxed constraints: Allows single size markers freely.
        console.log('Starting Sweeping Phase...');
        loopSafety = 0;
        active = true;

        while (active && loopSafety < 5000) {
            loopSafety++;
            active = false;

            const availableLots = lots.filter(l => l.availableMetraj > 1);
            if (availableLots.length === 0) break;
            availableLots.sort((a, b) => b.availableMetraj - a.availableMetraj); // Big lots first

            const currentLot = availableLots[0];

            // Candidate Orders: Open OR Leftover
            const allCandidates = orders.filter(o => (o.status === 'Open' || o.status === 'Leftover') && o.quantityPending > 0);

            // Group by Color
            const colorGroups = {};
            allCandidates.forEach(o => {
                if (!colorGroups[o.color]) colorGroups[o.color] = [];
                colorGroups[o.color].push(o);
            });

            const sortedColors = Object.entries(colorGroups)
                .map(([color, lines]) => ({ color, lines, total: lines.reduce((s, x) => s + x.quantityPending, 0) }))
                .sort((a, b) => b.total - a.total);

            for (const cand of sortedColors) {
                // Try finding ANY marker. 
                // We reuse findBestMarkerCombination inside. 
                // Note: findBestMarkerCombination already checks "Single Size Fallback".
                // But maybe we need even simpler? 
                // It verifies strict Layer limits.

                const marker = findBestMarkerCombination(currentLot, cand.lines, parameters);

                if (marker) {
                    active = true;
                    const job = new CutJob(cutIdCounter++, currentLot.id, cand.color, marker.sizes, marker.layers, marker.markerLength);
                    cuts.push(job);
                    currentLot.assignedJobs.push(job);
                    currentLot.usedMetraj += job.consumedMetraj;

                    const sizeCounts = {};
                    marker.sizes.forEach(s => sizeCounts[s] = (sizeCounts[s] || 0) + 1);
                    Object.entries(sizeCounts).forEach(([size, count]) => {
                        const line = cand.lines.find(o => o.size === size);
                        if (line) line.quantityPending -= (count * marker.layers);
                    });

                    // In Sweeping, we don't mark 'Leftover'. Just check complete.
                    const pending = cand.lines.reduce((s, l) => s + l.quantityPending, 0);
                    if (pending <= 0) cand.lines.forEach(o => o.status = 'Completed');

                    break; // Restart loop
                }
            }
        }

        // 3. Output Formatting
        const finalPlans = [];
        cuts.forEach(job => {
            const lotObj = lots.find(l => l.id === job.lotId);

            // Reconstruct quantities row
            const counts = {};
            job.sizes.forEach(s => counts[s] = (counts[s] || 0) + 1);

            const rowQs = {};
            Object.keys(counts).forEach(sz => {
                rowQs[sz] = counts[sz] * job.layers;
            });

            finalPlans.push({
                id: job.id,
                shrinkage: `${lotObj.shrinkageGroup} | ${lotObj.details.lot || lotObj.id.split('_')[0]}`,
                lot: lotObj.details.lot || lotObj.id.split('_')[0],
                mold: lotObj.shrinkageGroup,
                totalLayers: job.layers,
                markerRatio: counts,
                markerLength: job.markerLength.toFixed(2),
                rows: [{
                    colors: job.color,
                    layers: job.layers,
                    quantities: rowQs
                }],
                fabrics: lotObj.details.fabrics ? lotObj.details.fabrics.map(f => f.topNo).join(', ') : '',
                note: 'Heuristic'
            });
        });

        // Integrity Map
        const integrityMap = {};
        orders.forEach(o => {
            const key = `${o.color}-${o.size}`;

            // Calculate allocated
            // We have to iterate plans to see what really happened to this specific size?
            // Or rely on `o.quantityPending`.
            const allocated = o.initialQuantity - o.quantityPending;

            const allocations = []; // Detailed lot allocation map if needed
            // (Skipping detailed map for speed, can be added if UI needs it)

            let score = 100;
            if (o.status === 'Leftover') score = 50;
            if (o.quantityPending > 0) score = Math.max(0, score - 20);

            integrityMap[key] = {
                score: score,
                allocations: [{ lot: 'Mixed', qty: allocated }] // Simplified
            };
        });

        self.postMessage({ success: true, plans: finalPlans, integrityMap });

    } catch (err) {
        console.error("Worker Error:", err);
        self.postMessage({ success: false, error: err.message });
    }
};
