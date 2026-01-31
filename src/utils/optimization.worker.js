
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
        this.color = color;
        this.sizes = sizes;
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

    if (sortedOrders.length >= 4) {
        variations.push(evaluateGroup(sortedOrders.slice(0, 4)));
    }
    if (sortedOrders.length >= 3) {
        variations.push(evaluateGroup(sortedOrders.slice(0, 3)));
    }
    if (sortedOrders.length >= 2) {
        variations.push(evaluateGroup(sortedOrders.slice(0, 2)));
    }

    if (sortedOrders.length >= 4) {
        const top2 = sortedOrders.slice(0, 2);
        const bot2 = sortedOrders.slice(-2);
        const mix = [...top2, ...bot2];
        variations.push(evaluateGroup(mix));
    }

    if (sortedOrders.length > 0) {
        const top1 = sortedOrders[0];
        variations.push(evaluateGroup([top1, top1, top1, top1]));
        variations.push(evaluateGroup([top1, top1, top1]));
        variations.push(evaluateGroup([top1, top1]));

        if (sortedOrders.length >= 2) {
            const top2 = sortedOrders[1];
            variations.push(evaluateGroup([top1, top1, top2, top2]));
            variations.push(evaluateGroup([top1, top1, top1, top2]));
            variations.push(evaluateGroup([top1, top2, top2, top2]));
            variations.push(evaluateGroup([top1, top1, top2]));
            variations.push(evaluateGroup([top1, top2, top2]));
        }

        if (sortedOrders.length >= 3) {
            const top2 = sortedOrders[1];
            const top3 = sortedOrders[2];
            variations.push(evaluateGroup([top1, top1, top2, top3]));
        }
    }

    if (sortedOrders.length === 1) {
        const o = sortedOrders[0];
        variations.push(evaluateGroup([o, o, o, o]));
        variations.push(evaluateGroup([o, o]));
    }

    const valid = variations.filter(v => v !== null).sort((a, b) => b.score - a.score);
    return valid.length > 0 ? valid[0] : null;
};

// --- POST-PROCESSING ---

const enforceMinCutSize = (cuts, lots, orders) => {
    // Iterate backwards to allow removal
    for (let i = cuts.length - 1; i >= 0; i--) {
        const job = cuts[i];
        const totalPieces = job.sizes.length * job.layers;

        if (totalPieces < 20) {
            const lot = lots.find(l => l.id === job.lotId);

            // Attempt 1: Grow (Add layers to reach 20)
            const neededTotal = 20;
            const piecesPerLayer = job.sizes.length;
            const targetLayers = Math.ceil(neededTotal / piecesPerLayer);
            const extraLayers = targetLayers - job.layers;
            const extraMetraj = extraLayers * job.markerLength;

            // Check constraint: Fabric availability
            if (lot.availableMetraj >= extraMetraj) {
                // Apply Growth
                job.layers += extraLayers;
                lot.usedMetraj += extraMetraj;

                // We are "Overcutting" here, so we don't necessarily update order pending 
                // because pending might be 0 already. This is surplus.
                // But if pending was positive, we should reduce it.
                // Simplify: Just mark as valid.
            } else {
                // Attempt 2: Dissolve (Fabric too short to make it worth it)
                // Restore metraj
                lot.usedMetraj -= job.consumedMetraj;

                // Restore pending quantities
                const sizeCounts = {};
                job.sizes.forEach(s => sizeCounts[s] = (sizeCounts[s] || 0) + 1);

                Object.entries(sizeCounts).forEach(([size, count]) => {
                    const order = orders.find(o => o.color === job.color && o.size === size);
                    if (order) {
                        order.quantityPending += (count * job.layers);
                        if (order.status === 'Completed') order.status = 'Open';
                        if (order.status === 'Leftover') order.status = 'Open';
                    }
                });

                // Remove job
                cuts.splice(i, 1);
                // Also remove from lot.assignedJobs if we tracked it there (we do in main loop but simplistic here)
            }
        }
    }
};

const absorbLeftovers = (orders, cuts, lots) => {
    const pendingOrders = orders.filter(o => o.quantityPending > 0);

    pendingOrders.forEach(order => {
        // Find candidate cuts: Same color, contains size, valid size (>20 originally or via growth)
        // We only piggyback on "Good" cuts
        const candidates = cuts.filter(j =>
            j.color === order.color &&
            j.sizes.includes(order.size)
        );

        if (candidates.length === 0) return;

        // Sort by available fabric in their lots
        candidates.sort((a, b) => {
            const lotA = lots.find(l => l.id === a.lotId);
            const lotB = lots.find(l => l.id === b.lotId);
            return lotB.availableMetraj - lotA.availableMetraj;
        });

        for (const job of candidates) {
            if (order.quantityPending <= 0) break;

            const lot = lots.find(l => l.id === job.lotId);
            const countInMarker = job.sizes.filter(s => s === order.size).length;

            // Calculate needed layers
            const neededLayers = Math.ceil(order.quantityPending / countInMarker);

            // Check max layers for fabric
            const maxFabLayers = Math.floor(lot.availableMetraj / job.markerLength);

            // Add what we can
            const convertLayers = Math.min(neededLayers, maxFabLayers);

            if (convertLayers > 0) {
                job.layers += convertLayers;
                lot.usedMetraj += (convertLayers * job.markerLength);

                const cutQty = convertLayers * countInMarker;
                order.quantityPending -= cutQty; // Can go negative (overcut), allowed
            }
        }
    });
};

// --- SCORING SYSTEM ---
const calculateScore = (plans, orders, lots) => {
    // 1. Efficiency (Usage Ratio vs Waste)
    // Actually simplicity: Maximize Used/Total? 
    // Or Minimize Leftover Fabric?
    const totalUsed = lots.reduce((sum, l) => sum + l.usedMetraj, 0);
    // Base Efficiency Score
    const efficiencyScore = (totalUsed > 0) ? 40 : 0;

    // 2. Fulfillment (Completed Orders)
    const totalPending = orders.reduce((sum, o) => sum + o.quantityPending, 0);
    const totalInitial = orders.reduce((sum, o) => sum + o.initialQuantity, 0);
    const fulfillment = totalInitial > 0 ? ((totalInitial - Math.max(0, totalPending)) / totalInitial) * 40 : 0;

    // 3. Integrity (Dense Markers)
    const avgLayers = plans.length > 0 ? plans.reduce((sum, p) => sum + p.totalLayers, 0) / plans.length : 0;
    const integrity = Math.min(20, (avgLayers / 80) * 20);

    return efficiencyScore + fulfillment + integrity;
};

// --- SIMULATION RUNNER ---

const runOneSimulation = (seed, mutationParams, baseLots, baseOrders, parameters, groupingResults) => {
    // Deep Copy State
    const lots = baseLots.map(l => new FabricLot(l.id, l.details, l.totalMetraj, l.shrinkageGroup));
    const orders = baseOrders.map(o => new OrderLine(o.color, o.size, o.initialQuantity));

    // Apply Mutations -> Quantity Flexing
    if (mutationParams.qtyFlex) {
        orders.forEach(o => {
            // +/- 5% Flex
            const flex = 1 + (Math.random() * 0.1 - 0.05);
            o.quantityPending = Math.floor(o.quantityPending * flex);
            // Don't update initialQuantity if we want to measure "true" fulfillment against customer order?
            // Actually user said: "If I produce %5 short, does it fit?"
            // So we are changing the target.
        });
    }

    const cuts = [];
    let cutIdCounter = 1;

    // 2. Main Loop (Optimized Phase)
    let active = true;
    let loopSafety = 0;

    while (active && loopSafety < 10000) {
        loopSafety++;
        active = false;

        // Global Sort Lots by Available Metraj (+ Jitter)
        const availableLots = lots.filter(l => l.availableMetraj > 1);
        if (availableLots.length === 0) break;

        availableLots.sort((a, b) => {
            const jitterA = mutationParams.sortJitter ? Math.random() * 10 : 0;
            const jitterB = mutationParams.sortJitter ? Math.random() * 10 : 0;
            return (b.availableMetraj + jitterB) - (a.availableMetraj + jitterA);
        });
        const currentLot = availableLots[0];

        // Filter Orders Valid for this Lot
        const colorGroups = {};
        orders.filter(o => o.status === 'Open').forEach(o => {
            if (!colorGroups[o.color]) colorGroups[o.color] = [];
            colorGroups[o.color].push(o);
        });

        const colorCandidates = Object.entries(colorGroups)
            .map(([color, lines]) => ({
                color,
                lines,
                totalPending: lines.reduce((sum, l) => sum + l.quantityPending, 0)
            }))
            .sort((a, b) => {
                const jitterA = mutationParams.sortJitter ? Math.random() * 50 : 0;
                const jitterB = mutationParams.sortJitter ? Math.random() * 50 : 0;
                return (b.totalPending + jitterB) - (a.totalPending + jitterA);
            });

        for (const candidate of colorCandidates) {
            const { color, lines } = candidate;
            const bestMarker = findBestMarkerCombination(currentLot, lines, parameters);

            if (bestMarker) {
                active = true;
                const job = new CutJob(cutIdCounter++, currentLot.id, color, bestMarker.sizes, bestMarker.layers, bestMarker.markerLength);
                cuts.push(job);
                currentLot.assignedJobs.push(job);
                currentLot.usedMetraj += job.consumedMetraj;

                const sizeCounts = {};
                bestMarker.sizes.forEach(s => sizeCounts[s] = (sizeCounts[s] || 0) + 1);
                Object.entries(sizeCounts).forEach(([size, count]) => {
                    const line = lines.find(o => o.size === size);
                    if (line) line.quantityPending -= (count * bestMarker.layers);
                });

                const totalPendingColor = lines.reduce((sum, l) => sum + l.quantityPending, 0);
                if (totalPendingColor < 30 && totalPendingColor > 0) lines.forEach(o => o.status = 'Leftover');
                if (totalPendingColor <= 0) lines.forEach(o => o.status = 'Completed');

                break;
            }
        }
    }

    // 3. Sweeping Phase (Rescue Leftovers)
    loopSafety = 0;
    active = true;
    while (active && loopSafety < 5000) {
        loopSafety++;
        active = false;
        const availableLots = lots.filter(l => l.availableMetraj > 1);
        if (availableLots.length === 0) break;
        availableLots.sort((a, b) => b.availableMetraj - a.availableMetraj);
        const currentLot = availableLots[0];

        const allCandidates = orders.filter(o => (o.status === 'Open' || o.status === 'Leftover') && o.quantityPending > 0);
        const colorGroups = {};
        allCandidates.forEach(o => {
            if (!colorGroups[o.color]) colorGroups[o.color] = [];
            colorGroups[o.color].push(o);
        });
        const sortedColors = Object.entries(colorGroups)
            .map(([color, lines]) => ({ color, lines, total: lines.reduce((s, x) => s + x.quantityPending, 0) }))
            .sort((a, b) => b.total - a.total);

        for (const cand of sortedColors) {
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
                const pending = cand.lines.reduce((s, l) => s + l.quantityPending, 0);
                if (pending <= 0) cand.lines.forEach(o => o.status = 'Completed');
                break;
            }
        }
    }

    // 4. Post-Processing: Enforce Min Size & Absorb Leftovers
    enforceMinCutSize(cuts, lots, orders);
    absorbLeftovers(orders, cuts, lots);

    // Reconstruct Final Plans
    const finalPlans = [];
    cuts.forEach(job => {
        const lotObj = lots.find(l => l.id === job.lotId);

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

    const score = calculateScore(finalPlans, orders, lots);
    return { plans: finalPlans, orders, lots, score };
};


// --- WORKER HANDLER ---

self.onmessage = (e) => {
    const { orderRows, groupingResults, parameters } = e.data;

    try {
        console.log('Monte Carlo Engine Starting...');

        // Prepare Base Data (Immutable Templates)
        const baseLots = [];
        ['kalip1', 'kalip2', 'kalip3'].forEach(k => {
            if (groupingResults[k]) {
                groupingResults[k].forEach(l => {
                    const shrinkName = k === 'kalip1' ? 'KALIP - 1' : k === 'kalip2' ? 'KALIP - 2' : 'KALIP - 3';
                    const uniqueId = `${l.lot}_${k}`;
                    baseLots.push(new FabricLot(uniqueId, l, l.totalMetraj, shrinkName));
                });
            }
        });

        const baseOrders = [];
        orderRows.forEach(row => {
            Object.entries(row.quantities).forEach(([size, qty]) => {
                const q = parseInt(qty) || 0;
                if (q > 0) baseOrders.push(new OrderLine(row.color, size, q));
            });
        });

        // MONTE CARLO LOOP
        const simulations = [];
        const ITERATIONS = 200;

        for (let i = 0; i < ITERATIONS; i++) {
            // Generate Mutations
            const mutationParams = {
                qtyFlex: Math.random() > 0.5,      // 50% chance to flex quantities
                sortJitter: Math.random() > 0.3    // 70% chance to jitter sort order
            };

            const result = runOneSimulation(i, mutationParams, baseLots, baseOrders, parameters, groupingResults);
            result.iterationId = i;
            simulations.push(result);
        }

        // Pick Winner
        simulations.sort((a, b) => b.score - a.score);
        const bestResult = simulations[0];

        console.log(`Best Simulation Score: ${bestResult.score.toFixed(2)} (Iter: ${bestResult.iterationId})`);

        // Generate Integrity Map for Best Result
        const integrityMap = {};
        bestResult.orders.forEach(o => {
            const key = `${o.color}-${o.size}`;
            const allocated = o.initialQuantity - o.quantityPending;

            let score = 100;
            if (o.status === 'Leftover') score = 50;
            if (o.quantityPending > 0) score = Math.max(0, score - 20);

            integrityMap[key] = {
                score: score,
                allocations: [{ lot: 'Mixed', qty: allocated }]
            };
        });

        self.postMessage({ success: true, plans: bestResult.plans, integrityMap });

    } catch (err) {
        console.error("Worker Error:", err);
        self.postMessage({ success: false, error: err.message });
    }
};
