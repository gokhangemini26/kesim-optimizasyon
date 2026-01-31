
/* eslint-disable no-restricted-globals */

// --- UTILS & CONSTANTS ---

// Calculates the estimated length of a marker (pastal) based on consumptions
const calculateMarkerLength = (sizeGroup, consumptionMode, avgConsumption, sizeConsumptions) => {
    // sizeGroup is array of sizes e.g. ['32', '32', '34']
    // If consumptionMode is 'AVG', length = count * avg
    // If 'SIZE', sum of each size's consumption

    if (consumptionMode === 'AVG') {
        return sizeGroup.length * avgConsumption;
    } else {
        return sizeGroup.reduce((sum, size) => {
            const cons = parseFloat(sizeConsumptions[size]) || avgConsumption;
            return sum + cons;
        }, 0);
    }
};

// Generates valid size combinations (max 4 sizes)
// Constraints: 
// - Max 4 sizes
// - Prefer same sizes (e.g. 32,32,32 or 32,32)
// - Allow Small+Big combinations (e.g. XS,XS,XL,XL or XS,XL)
const generateSizeGroups = (availableSizes) => {
    const groups = [];
    const sizeList = [...availableSizes]; // strings

    // Sort sizes roughly to identify small/large (using string comparison or numeric if possible)
    // We assume incoming sizes are sortable.
    // However, sizes can be "S", "M", "L" or "32", "34".
    // We'll rely on the input order or simple sort.
    // For mixing S+L, we need to know what is small and large. 
    // Let's assume the availableSizes are sorted by the caller.

    // 1. Same Size Groups (2, 3, 4 count)
    for (const s of sizeList) {
        // We add groups even if we don't have enough demand yet? 
        // No, these are "Possible Pattern Types".
        // The algorithm will check validity against demand later or we check availability now?
        // The user's python code does: `range(2, 5)` i.e., 2, 3, 4.
        groups.push([s, s]);
        groups.push([s, s, s]);
        groups.push([s, s, s, s]);
    }

    // 2. Small + Large Combinations (Cross)
    // "En küçük 2 beden + en büyük 2 beden birlikte kesilebilir"
    if (sizeList.length >= 2) {
        const sorted = [...sizeList]; // Assume sorted by caller if possible
        // We can't easily know "Small" vs "Large" without logic. 
        // We'll try all pairs and quads of distinct items?
        // User said: "En küçük 2 + En Büyük 2".
        // Let's take the first 2 and last 2 of the sorted list.

        const smalls = sorted.slice(0, 2);
        const larges = sorted.slice(-2);

        // Mix S+L
        for (const s of smalls) {
            for (const l of larges) {
                if (s === l) continue;
                // S, L
                groups.push([s, l]);
                // S, S, L, L
                groups.push([s, s, l, l]);
            }
        }
    }

    return groups;
};


// --- GENETIC ALGORITHM CLASSES ---

class FabricLot {
    constructor(id, details, totalMetraj, shrinkage) {
        this.id = id;
        this.details = details; // Original object
        this.totalMetraj = totalMetraj;
        this.shrinkage = shrinkage;
        this.usedMetraj = 0;
    }

    get remainingMetraj() {
        return this.totalMetraj - this.usedMetraj;
    }

    clone() {
        const c = new FabricLot(this.id, this.details, this.totalMetraj, this.shrinkage);
        c.usedMetraj = this.usedMetraj;
        return c;
    }
}

class CutJob {
    constructor(id, sizeGroup, layers, lotId, markerLength) {
        this.id = id;
        this.sizeGroup = sizeGroup; // ['32', '32']
        this.layers = layers;
        this.lotId = lotId;
        this.markerLength = markerLength;
    }

    get totalPieces() {
        return this.sizeGroup.length * this.layers;
    }

    get totalMetraj() {
        return this.layers * this.markerLength;
    }

    clone() {
        return new CutJob(this.id, [...this.sizeGroup], this.layers, this.lotId, this.markerLength);
    }
}

class Chromosome {
    constructor() {
        this.cutJobs = []; // List of CutJob
        this.score = 0;
        this.breakdown = {}; // For debug
    }

    clone() {
        const c = new Chromosome();
        c.cutJobs = this.cutJobs.map(j => j.clone());
        c.score = this.score;
        return c;
    }
}

// --- MAIN SOLVER FUNCTION ---

const solveForColor = (color, demand, lots, params) => {
    // demand: { '32': 100, '34': 50 }
    // lots: [FabricLot, FabricLot]
    // params: { consumptionMode, avgConsumption, sizeConsumptions, ... }

    const { consumptionMode, avgConsumption, sizeConsumptions } = params;
    const sortedSizes = Object.keys(demand).sort((a, b) => {
        // Try numeric sort
        const nA = parseFloat(a);
        const nB = parseFloat(b);
        if (!isNaN(nA) && !isNaN(nB)) return nA - nB;
        return a.localeCompare(b);
    });

    const possibleSizeGroups = generateSizeGroups(sortedSizes);

    // Initial Demand Calculation
    let totalDemandPieces = 0;
    Object.values(demand).forEach(v => totalDemandPieces += v);

    // --- HELPER: Random Solution Generator ---
    const createRandomChromosome = () => {
        const chrom = new Chromosome();
        const tempDemand = { ...demand };
        const tempLots = lots.map(l => l.clone());
        let jobId = 1;

        // Try to fulfill demand
        // "Akıllı Rastgelelik": Iterate lots, try to fill with random valid groups until full or stock out
        let attempts = 0;
        while (attempts < 500) {
            attempts++;

            const remainingSizes = Object.keys(tempDemand).filter(s => tempDemand[s] > 0);
            if (remainingSizes.length === 0) break;

            const availableLots = tempLots.filter(l => l.remainingMetraj > 1); // >1m
            if (availableLots.length === 0) break;

            const lot = availableLots[Math.floor(Math.random() * availableLots.length)];

            // Pick a random size group that contains needed sizes
            const validGroups = possibleSizeGroups.filter(g => g.some(s => tempDemand[s] > 0));
            if (validGroups.length === 0) break;

            const group = validGroups[Math.floor(Math.random() * validGroups.length)];

            const mLength = calculateMarkerLength(group, consumptionMode, avgConsumption, sizeConsumptions);
            const maxLayersStore = Math.floor(lot.remainingMetraj / mLength);

            if (maxLayersStore < 1) {
                lot.usedMetraj = lot.totalMetraj; // functionally full
                continue;
            }

            let maxLayersDemand = 1000;
            for (const s of group) {
                const needed = tempDemand[s];
                if (needed <= 0) {
                    maxLayersDemand = Math.min(maxLayersDemand, 10);
                } else {
                    const countInGroup = group.filter(x => x === s).length;
                    maxLayersDemand = Math.min(maxLayersDemand, Math.ceil(needed / countInGroup));
                }
            }

            // Max 80 layers
            const limit = Math.min(maxLayersStore, maxLayersDemand, 80);
            if (limit < 1) continue;

            const layers = Math.floor(Math.random() * limit) + 1;

            const job = new CutJob(jobId++, group, layers, lot.id, mLength);
            chrom.cutJobs.push(job);

            lot.usedMetraj += job.totalMetraj;
            group.forEach(s => {
                tempDemand[s] -= layers;
            });
        }

        return chrom;
    };

    // --- FITNESS FUNCTION ---
    const calculateFitness = (chrom) => {
        let score = 1000;
        const produced = {}; // size -> count
        const lotUsage = {}; // lotId -> metraj
        const sizeLotMap = {}; // size -> Set(lotIds)

        // 1. Tally Production
        chrom.cutJobs.forEach(job => {
            job.sizeGroup.forEach(s => {
                produced[s] = (produced[s] || 0) + job.layers;

                if (!sizeLotMap[s]) sizeLotMap[s] = new Set();
                sizeLotMap[s].add(job.lotId);
            });
            lotUsage[job.lotId] = (lotUsage[job.lotId] || 0) + job.totalMetraj;
        });

        // Ceza 1: Quantity Mismatch (Big Penalty)
        Object.keys(demand).forEach(s => {
            const desired = demand[s];
            const actual = produced[s] || 0;
            const diff = actual - desired;

            if (actual < desired) {
                score -= Math.abs(diff) * 50;
            } else {
                const extra = actual - desired;
                const limit = Math.ceil(desired * 0.05);
                if (extra > limit) {
                    score -= (extra - limit) * 20;
                }
            }
        });

        // Ceza 2: Waste (Metraj)
        let totalMetraj = 0;
        let totalPieces = 0;
        Object.values(lotUsage).forEach(m => totalMetraj += m);
        Object.values(produced).forEach(p => totalPieces += p);

        if (totalPieces > 0) {
            const efficiency = totalMetraj / totalPieces;
            if (efficiency > avgConsumption * 1.1) {
                score -= (efficiency - avgConsumption) * 100;
            }
        }

        // Ceza 3: Lot Fragmentation
        Object.keys(sizeLotMap).forEach(s => {
            const usedLots = sizeLotMap[s];
            if (usedLots.size > 1) {
                score -= (usedLots.size - 1) * 10;
            }
        });

        // Constraint: Lot Capacity
        lots.forEach(l => {
            const used = lotUsage[l.id] || 0;
            if (used > l.totalMetraj) {
                score -= (used - l.totalMetraj) * 1000;
            }
        });

        chrom.score = score;
        return score;
    };


    // --- EVOLUTION LOOP ---

    // Init Population
    let popSize = 200;
    let population = [];
    for (let i = 0; i < popSize; i++) {
        const c = createRandomChromosome();
        calculateFitness(c);
        population.push(c);
    }

    const generations = 250; // Or 500

    for (let gen = 0; gen < generations; gen++) {
        // Sort
        population.sort((a, b) => b.score - a.score);

        // Elitism (Top 20%)
        const eliteCount = Math.floor(popSize * 0.2);
        const newPop = population.slice(0, eliteCount);

        // Fill remaining 80%
        while (newPop.length < popSize) {
            // Tournament Selection
            const tournamentSize = 5;
            let parentA, parentB;

            const pick = () => population[Math.floor(Math.random() * population.length)];

            let best = pick();
            for (let t = 0; t < tournamentSize - 1; t++) {
                const candidate = pick();
                if (candidate.score > best.score) best = candidate;
            }
            parentA = best;

            best = pick();
            for (let t = 0; t < tournamentSize - 1; t++) {
                const candidate = pick();
                if (candidate.score > best.score) best = candidate;
            }
            parentB = best;

            // Crossover
            const child = new Chromosome();
            const splitA = Math.floor(parentA.cutJobs.length / 2);
            const splitB = Math.floor(parentB.cutJobs.length / 2);
            child.cutJobs = [
                ...parentA.cutJobs.slice(0, splitA).map(j => j.clone()),
                ...parentB.cutJobs.slice(splitB).map(j => j.clone())
            ];

            // Mutation
            if (Math.random() < 0.05) {
                if (child.cutJobs.length > 0) {
                    const job = child.cutJobs[Math.floor(Math.random() * child.cutJobs.length)];
                    // Type 1: Change Lot
                    if (Math.random() < 0.5) {
                        const randomLot = lots[Math.floor(Math.random() * lots.length)];
                        job.lotId = randomLot.id;
                    }
                    // Type 2: Change Layers
                    else {
                        job.layers += (Math.random() < 0.5 ? 1 : -1);
                        if (job.layers < 1) job.layers = 1;
                        if (job.layers > 80) job.layers = 80;
                    }
                }
            }

            calculateFitness(child);
            newPop.push(child);
        }
        population = newPop;
    }

    // Return best
    population.sort((a, b) => b.score - a.score);
    return population[0];
};


// --- WORKER HANDLER ---

self.onmessage = (e) => {
    const { orderRows, groupingResults, parameters } = e.data;
    const { avgConsumption, consumptionMode, sizeConsumptions } = parameters;

    console.log('Worker Started');

    try {
        // 1. Prepare Data
        // Group Demands by Color
        const colorDemands = {};
        orderRows.forEach(row => {
            if (!colorDemands[row.color]) colorDemands[row.color] = {};
            // Sum quantities for this color
            Object.entries(row.quantities).forEach(([sz, qty]) => {
                const val = parseInt(qty) || 0;
                if (val > 0) {
                    colorDemands[row.color][sz] = (colorDemands[row.color][sz] || 0) + val;
                }
            });
        });

        // Prepare Lots List locally
        const allLots = [];
        ['kalip1', 'kalip2', 'kalip3'].forEach(k => {
            if (groupingResults[k]) {
                groupingResults[k].forEach(l => {
                    const shrinkName = k === 'kalip1' ? 'KALIP - 1' : k === 'kalip2' ? 'KALIP - 2' : 'KALIP - 3';
                    allLots.push(new FabricLot(l.lot, l, l.totalMetraj, shrinkName));
                });
            }
        });

        // 2. Run GA for each color
        const finalPlans = [];
        let planIdCounter = 1;

        Object.keys(colorDemands).forEach(color => {
            const demand = colorDemands[color];

            const eligibleLots = allLots.filter(l => {
                if (l.details.renk) {
                    return l.details.renk.toLowerCase() === color.toLowerCase();
                }
                return true;
            });

            if (eligibleLots.length === 0) {
                console.warn(`No lots found for color ${color}`);
                return;
            }

            // RUN GA
            const bestSolution = solveForColor(color, demand, eligibleLots, parameters);

            // Convert Chromosome to Output Format
            bestSolution.cutJobs.forEach(job => {
                const lotObj = eligibleLots.find(l => l.id === job.lotId);
                const qs = {};
                job.sizeGroup.forEach(s => qs[s] = (qs[s] || 0) + 1);

                const rowQs = {};
                Object.keys(qs).forEach(s => rowQs[s] = qs[s] * job.layers);

                finalPlans.push({
                    id: planIdCounter++,
                    shrinkage: `${lotObj.shrinkage} | ${lotObj.id}`, // Lot info
                    lot: lotObj.id,
                    mold: lotObj.shrinkage,
                    totalLayers: job.layers,
                    markerRatio: qs,
                    markerLength: job.markerLength.toFixed(2),
                    rows: [{
                        colors: color,
                        layers: job.layers,
                        quantities: rowQs
                    }],
                    fabrics: lotObj.details.fabrics ? lotObj.details.fabrics.map(f => f.topNo).join(', ') : '',
                    note: 'GA Optimized'
                });
            });
        });

        // 3. Generate Integrity Map
        const integrityMap = {};
        Object.keys(colorDemands).forEach(color => {
            Object.keys(colorDemands[color]).forEach(size => {
                integrityMap[`${color}-${size}`] = { score: 100, allocations: [] }; // Default optimal
            });
        });

        const allocations = {};

        finalPlans.forEach(plan => {
            plan.rows.forEach(row => {
                const color = row.colors;
                Object.entries(row.quantities).forEach(([size, qty]) => {
                    const key = `${color}-${size}`;
                    if (!allocations[key]) allocations[key] = {};
                    allocations[key][plan.lot] = (allocations[key][plan.lot] || 0) + qty;
                });
            });
        });

        Object.entries(allocations).forEach(([key, lotsMap]) => {
            const [color, size] = key.split('-');
            const demandQty = colorDemands[color][size] || 0;
            const totalPlanned = Object.values(lotsMap).reduce((a, b) => a + b, 0);
            const lotList = Object.entries(lotsMap).map(([l, q]) => ({ lot: l, qty: q }));

            let score = 100;
            if (lotList.length > 1) score = 50;
            if (totalPlanned < demandQty) score = Math.max(0, score - 20);

            integrityMap[key] = {
                score: score,
                allocations: lotList
            };
        });

        self.postMessage({ success: true, plans: finalPlans, integrityMap });

    } catch (err) {
        console.error("Worker Error details:", err);
        self.postMessage({ success: false, error: err.message });
    }
};
