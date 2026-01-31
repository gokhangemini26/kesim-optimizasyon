
/* eslint-disable no-restricted-globals */

// --- UTILS & CONSTANTS ---

// Calculates the estimated length of a marker (pastal) based on consumptions
const calculateMarkerLength = (sizeGroup, consumptionMode, avgConsumption, sizeConsumptions) => {
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
// - Same sizes (e.g. 32,32,32 or 32,32)
// - Small + Large combinations 
// - BLOCKS "Only Large" combinations (En küçük 2 + En büyük 2 rule constraint)
const generateSizeGroups = (availableSizes) => {
    const groups = [];
    const sizeList = [...availableSizes]; // Assume sorted

    // Identify Small vs Large
    // If list is small (<= 4), everything is allowable? 
    // Constraint: "En küçük 2 beden + en büyük 2 beden birlikte kesilebilir"
    // Constraint: "Sadece büyük beden -> EN yetmez ❌"

    // Logic: Identify indices 0,1 as Small, N-1, N-2 as Large.
    // If we pick ONLY sizes from Large set, block it?
    // Let's enable: All pure groups allowed EXCEPT pure Large groups?
    // Safe bet: Allow pure groups for ALL. 
    // But prioritize Small+Large.

    // Re-reading: "Sadece büyük beden -> EN yetmez" means width is issue.
    // If we cut 4 XLs, width > fabric width.
    // We don't have width data. But the rule says "❌".
    // So we should Block groups that are exclusively composed of the "Largest 2 sizes" if the total count > 2?
    // Or just generally discourage.
    // Let's implement strict "Small+Large" generation and "Same Size" generation.

    const n = sizeList.length;
    let smalls = sizeList;
    let larges = [];

    if (n >= 4) {
        smalls = sizeList.slice(0, 2); // First 2
        larges = sizeList.slice(-2);   // Last 2
    } else if (n >= 2) {
        smalls = [sizeList[0]];
        larges = [sizeList[sizeList.length - 1]];
    }

    // 1. Same Size Groups (2, 3, 4 count)
    // "Maksimum 4 beden"
    for (let i = 0; i < sizeList.length; i++) {
        const s = sizeList[i];
        const isLarge = (i >= n - 2) && n > 3; // Is one of the top 2 sizes?

        // Allow 2, 3, 4
        groups.push([s, s]);

        // If it's a "Large" size, maybe restrict 3 and 4 matches? 
        // "Sadece büyük beden -> EN yetmez"
        // Let's restrict >2 count for Large sizes to be safe against width
        if (!isLarge) {
            groups.push([s, s, s]);
            groups.push([s, s, s, s]);
        } else {
            // For large sizes, perhaps only 2 is safe? 
            // Or allow 3 but heavily penalize in selection if width was known.
            // Let's block 3, 4 for Large sizes strictly per user hint.
        }
    }

    // 2. Small + Large Combinations (Cross)
    // "En küçük 2 beden + en büyük 2 beden birlikte kesilebilir"
    if (sizeList.length >= 2) {
        for (const s of smalls) {
            for (const l of larges) {
                if (s === l) continue;
                // S, L (2)
                groups.push([s, l]);
                // S, S, L, L (4) - Ideal mix
                groups.push([s, s, l, l]);
                // S, L, L ? (3)
                // S, S, L ? (3)
                groups.push([s, s, l]);
            }
        }
    }

    // Uniq groups
    const uniqueGroups = [];
    const seen = new Set();
    groups.forEach(g => {
        const key = g.sort().join(','); // sort for key
        if (!seen.has(key)) {
            seen.add(key);
            uniqueGroups.push(g);
        }
    });

    return uniqueGroups;
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
    // params: { consumptionMode, avgConsumption, sizeConsumptions }

    const { consumptionMode, avgConsumption, sizeConsumptions } = params;

    // Sort Sizes: 30, 32, 34... 
    const sortedSizes = Object.keys(demand).sort((a, b) => {
        const nA = parseFloat(a); const nB = parseFloat(b);
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

        let attempts = 0;
        // Prefer filling one main lot first? 
        // To respect "Single Lot" rule, pick A lot, try to exhaust it?
        // Random approach: pick random lot. The selection pressure will drive to Single Lot.

        while (attempts < 500) {
            attempts++;

            const remainingSizes = Object.keys(tempDemand).filter(s => tempDemand[s] > 0);
            if (remainingSizes.length === 0) break;

            const availableLots = tempLots.filter(l => l.remainingMetraj > 1);
            if (availableLots.length === 0) break;

            // Bias selection to already used lots to encourage "Single Lot"?
            // Or purely random and let fitness sort it out? 
            // Pure random is fine if generations are enough. 
            // Let's randomly pick one.
            const lot = availableLots[Math.floor(Math.random() * availableLots.length)];

            // Filter relevant groups
            const validGroups = possibleSizeGroups.filter(g => g.some(s => tempDemand[s] > 0));
            if (validGroups.length === 0) break;

            const group = validGroups[Math.floor(Math.random() * validGroups.length)];

            const mLength = calculateMarkerLength(group, consumptionMode, avgConsumption, sizeConsumptions);
            const maxLayersStore = Math.floor(lot.remainingMetraj / mLength);

            if (maxLayersStore < 1) {
                lot.usedMetraj = lot.totalMetraj;
                continue;
            }

            let maxLayersDemand = 1000;
            for (const s of group) {
                const needed = tempDemand[s];
                // "Sadece küçük beden -> verim düşer"
                // Algorithm can cut EXTRA.
                // If needed <= 0, we can still cut a bit if it helps balance?
                // Limit extra cuts.
                if (needed <= 0) {
                    maxLayersDemand = Math.min(maxLayersDemand, 5); // Allow small over-cut
                } else {
                    const countInGroup = group.filter(x => x === s).length;
                    maxLayersDemand = Math.min(maxLayersDemand, Math.ceil(needed / countInGroup) + 5);
                    // Allow +5 layers buffer for optimization
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
        let score = 10000; // Increase base score
        const produced = {};
        const lotUsage = {};
        const sizeLotMap = {}; // size -> Set(lotIds) (Not used for color integrity but tracked)
        const lotIdsUsed = new Set();

        chrom.cutJobs.forEach(job => {
            job.sizeGroup.forEach(s => {
                produced[s] = (produced[s] || 0) + job.layers;
            });
            lotUsage[job.lotId] = (lotUsage[job.lotId] || 0) + job.totalMetraj;
            lotIdsUsed.add(job.lotId);
        });

        // 1. Equal Distribution of Excess/Deficit (Quadratic Penalty)
        let totalMismatchPenalty = 0;
        let totalDeficit = 0;

        Object.keys(demand).forEach(s => {
            const desired = demand[s];
            const actual = produced[s] || 0;
            const diff = actual - desired;

            // Target: Desired + 5%
            // Range [Desired, Desired * 1.05] is Ideal.

            const targetMin = desired;
            const targetMax = Math.ceil(desired * 1.05);

            if (actual < targetMin) {
                // Under Production
                const missing = targetMin - actual;
                totalDeficit += missing;
                // Quadratic Penalty: missing^2 enforces equal distribution of missing pieces
                totalMismatchPenalty += (missing * missing) * 50;
            }
            else if (actual > targetMax) {
                // Over Production (>5%)
                const excess = actual - targetMax;
                // Quadratic Penalty
                totalMismatchPenalty += (excess * excess) * 20;
            }
            else {
                // In Sweet Spot (0 - 5% extra)
                score += 100; // Bonus for hitting target
            }
        });
        score -= totalMismatchPenalty;

        // 2. Lot Fragmentation (Color Integrity)
        // Rule: "bir renk mumkun oldugunca bir tek lot ile kesilmeli"
        // Rule: "20 adetten buyuk eksik adet kalirsa... farkli lottan"
        // Logic: 
        // Penalty for using > 1 Lot. 
        // Cost(2nd Lot) must be LESS than Cost(Missing > 20 pieces).

        // Cost(Missing 20 pieces) = 20^2 * 50 = 400 * 50 = 20,000.
        // So Cost(2nd Lot) should be around 10,000.

        if (lotIdsUsed.size > 1) {
            score -= (lotIdsUsed.size - 1) * 10000;
        }

        // 3. Efficiency / Waste
        let totalMetraj = 0;
        let totalPieces = 0;
        Object.values(lotUsage).forEach(m => totalMetraj += m);
        Object.values(produced).forEach(p => totalPieces += p);

        if (totalPieces > 0) {
            const efficiency = totalMetraj / totalPieces;
            // Compare to Avg Consumption
            // If efficiency > avg, standard waste penalty
            if (efficiency > avgConsumption) {
                score -= (efficiency - avgConsumption) * 2000;
            }
        }

        // 4. Maximize Layers / Large Cuts
        chrom.cutJobs.forEach(job => {
            // Reward high layers (up to 80)
            score += job.layers * 2;
            // Reward 4-size markers (efficient width usage usually)
            if (job.sizeGroup.length >= 3) score += 50;
        });

        // Constraint: Lot Capacity
        lots.forEach(l => {
            const used = lotUsage[l.id] || 0;
            if (used > l.totalMetraj) {
                score -= (used - l.totalMetraj) * 100000; // Impossible
            }
        });

        chrom.score = score;
        return score;
    };


    // --- EVOLUTION LOOP (Standard) ---
    let popSize = 250;
    let population = [];
    for (let i = 0; i < popSize; i++) {
        const c = createRandomChromosome();
        calculateFitness(c);
        population.push(c);
    }

    // Check if initial population is completely stuck?
    // Sometimes random gen fails hard. We trust popSize=250 covers it.

    const generations = 400;

    for (let gen = 0; gen < generations; gen++) {
        population.sort((a, b) => b.score - a.score);

        // Stop if perfect? (Hard to know perfect score with bonuses)

        const eliteCount = Math.floor(popSize * 0.2);
        const newPop = population.slice(0, eliteCount);

        while (newPop.length < popSize) {
            // Tournament
            const tournamentSize = 4;
            let parentA, parentB;
            const pick = () => population[Math.floor(Math.random() * population.length)];

            let best = pick();
            for (let t = 0; t < tournamentSize - 1; t++) if (pick().score > best.score) best = pick();
            parentA = best;

            best = pick();
            for (let t = 0; t < tournamentSize - 1; t++) if (pick().score > best.score) best = pick();
            parentB = best;

            // Simple Crossover
            const child = new Chromosome();
            const splitA = Math.floor(parentA.cutJobs.length / 2);
            const splitB = Math.floor(parentB.cutJobs.length / 2);
            child.cutJobs = [
                ...parentA.cutJobs.slice(0, splitA).map(j => j.clone()),
                ...parentB.cutJobs.slice(splitB).map(j => j.clone())
            ];

            // Mutation
            if (Math.random() < 0.1) {
                if (child.cutJobs.length > 0) {
                    const job = child.cutJobs[Math.floor(Math.random() * child.cutJobs.length)];
                    if (Math.random() < 0.5) {
                        // Change Lot
                        const randomLot = lots[Math.floor(Math.random() * lots.length)];
                        job.lotId = randomLot.id;
                    } else {
                        // Change Layers (Small tweaks)
                        job.layers += (Math.random() < 0.5 ? 2 : -2);
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

    population.sort((a, b) => b.score - a.score);
    return population[0];
};


// --- WORKER HANDLER ---

self.onmessage = (e) => {
    const { orderRows, groupingResults, parameters } = e.data;
    const { avgConsumption, consumptionMode, sizeConsumptions } = parameters;

    try {
        const colorDemands = {};
        orderRows.forEach(row => {
            if (!colorDemands[row.color]) colorDemands[row.color] = {};
            Object.entries(row.quantities).forEach(([sz, qty]) => {
                const val = parseInt(qty) || 0;
                if (val > 0) colorDemands[row.color][sz] = (colorDemands[row.color][sz] || 0) + val;
            });
        });

        const allLots = [];
        ['kalip1', 'kalip2', 'kalip3'].forEach(k => {
            if (groupingResults[k]) {
                groupingResults[k].forEach(l => {
                    const shrinkName = k === 'kalip1' ? 'KALIP - 1' : k === 'kalip2' ? 'KALIP - 2' : 'KALIP - 3';
                    allLots.push(new FabricLot(l.lot, l, l.totalMetraj, shrinkName));
                });
            }
        });

        const finalPlans = [];
        let planIdCounter = 1;

        Object.keys(colorDemands).forEach(color => {
            const demand = colorDemands[color];

            const eligibleLots = allLots.filter(l => {
                if (l.details.renk) return l.details.renk.toLowerCase() === color.toLowerCase();
                return true;
            });

            if (eligibleLots.length === 0) return;

            const bestSolution = solveForColor(color, demand, eligibleLots, parameters);

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
                    note: 'GA Strict'
                });
            });
        });

        // Integrity Map logic
        const integrityMap = {};
        Object.keys(colorDemands).forEach(color => {
            Object.keys(colorDemands[color]).forEach(size => {
                integrityMap[`${color}-${size}`] = { score: 100, allocations: [] };
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
            // 5% extra logic check for integrity score? 
            // If totalPlanned >= demand, score 100.
            if (totalPlanned < demandQty) score = Math.max(0, score - 20);

            integrityMap[key] = {
                score: score,
                allocations: lotList
            };
        });

        self.postMessage({ success: true, plans: finalPlans, integrityMap });

    } catch (err) {
        console.error("Worker Error:", err);
        self.postMessage({ success: false, error: err.message });
    }
};
