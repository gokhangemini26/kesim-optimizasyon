
import solver from 'javascript-lp-solver';

/**
 * Solves the Cutting Stock Problem using Integer Linear Programming (ILP).
 * 
 * Objectives:
 * 1. Minimize Total Fabric Used.
 * 2. Minimize "Fragmentation" (Splitting an order across multiple lots) via Penalty.
 * 
 * Model:
 * Minimize: (Sum of Metraj Used) + (Penalty * Sum of Split Flags)
 * 
 * Constraints:
 * 1. Supply: Total metraj cut from Lot L <= Inventory Metraj of L.
 * 2. Demand: Total pieces of Size S cut across all lots == Demand of Size S.
 * 3. Link (Big M): If cuts > 0 for Order O in Lot L, then Split Flag must be 1.
 * 
 * @param {Array} orderRows - Array of { color, quantities: { [size]: val } }
 * @param {Object} groupingResults - { kalip1: [...lots], kalip2: [], ... }
 * @param {Object} constants - { ...sizeConsumptions, avgConsumption }
 */
export const solveCuttingStock = (data) => {
    const { orderRows, groupingResults, avgConsumption, consumptionMode, sizeConsumptions } = data;

    // Flatten all lots with "Mold" Info
    const allLots = [];
    const flattenedLots = [];

    ['kalip1', 'kalip2', 'kalip3'].forEach(key => {
        const group = groupingResults[key] || [];
        const moldName = key === 'kalip1' ? 'KALIP - 1 (0-3%)' :
            key === 'kalip2' ? 'KALIP - 2 (3.1-6%)' : 'KALIP - 3 (6.1-9%)';
        group.forEach(l => {
            flattenedLots.push({ ...l, moldGroup: moldName, originalId: l.lot }); // Ensure ID uniqueness?
        });
    });

    // We process optimization PER COLOR to keep it simple first?
    // Review: "Critical Constraint: Bir pastal sadece TEK BİR LOT grubundan oluşabilir."
    // This implies we cut Lot X using Pattern Y. 
    // If we mix colors in a marker, this engine gets very complex. 
    // The previous engine did "Aggregate Size Planning" (Multi-Color).
    // Let's assume for now we optimize PER MOLD GROUP if possible, or Global?
    // Actually, distinct colors usually require distinct markers unless color blocking.
    // Let's iterate by Color to keep the LP manageable, OR build one massive model.
    // User wants "Order Line" (Color+Size) not to split.
    // Let's do One Big Model for the entire list.

    // 1. Prepare Model
    const model = {
        optimize: "cost",
        opType: "min",
        constraints: {},
        variables: {},
        ints: {},
        binaries: {}
    };

    const BIG_M = 100000;
    const SPLIT_PENALTY = 5000; // High cost to discourage using a generic lot just for 1 piece

    // --- CONSTRAINTS: SUPPLY ---
    flattenedLots.forEach(lot => {
        // Lot Capacity Constraint
        // Constraint Name: "lot_capacity_[LOT_ID]"
        // We handle LOT_ID collision by index if needed.
        const lotIdFragment = `L${lot.id || lot.lot}`; // Ensure unique
        model.constraints[`cap_${lotIdFragment}`] = { max: lot.totalMetraj };
    });

    // --- CONSTRAINTS: DEMAND ---
    const demandMap = []; // Store metadata for reconstruction
    orderRows.forEach(row => {
        Object.entries(row.quantities).forEach(([size, qty]) => {
            const q = parseInt(qty);
            if (q > 0) {
                const demandId = `dem_${row.color}_${size}`;
                // Demand Constraint
                // Constraint Name: demand_RED_32
                model.constraints[demandId] = { equal: q };

                demandMap.push({
                    id: demandId,
                    color: row.color,
                    size: size,
                    qty: q
                });
            }
        });
    });

    // --- VARIABLES ---
    // For every Lot, we can cut any Size (Pattern).
    // Pattern: "Single Size Cut".
    // 1x Size S from Lot L.
    // Cost: Consumption(S).
    // Effect: +1 to demand_S, +Consumption to cap_L.

    // Also, we need Binary Variables to track "Is Order O cut in Lot L?"

    demandMap.forEach(d => {
        const consumption = (consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[d.size]) : 0) || avgConsumption;

        flattenedLots.forEach(lot => {
            const lotIdFragment = `L${lot.id || lot.lot}`;
            const variableId = `cut_${lotIdFragment}_${d.id}`; // e.g. cut_L1_dem_RED_32
            const binaryId = `use_${lotIdFragment}_${d.id}`;   // e.g. use_L1_dem_RED_32

            // Variable: How many pieces of Demand D to cut from Lot L
            model.variables[variableId] = {
                [d.id]: 1,                          // Satisfies 1 unit of demand
                [`cap_${lotIdFragment}`]: consumption, // Consumes fabric
                // Cost: Minimizing fabric used is good.
                cost: consumption,                  // Base Cost = Metraj Used.
                [`link_${lotIdFragment}_${d.id}`]: 1 // Consumes 1 unit of "Link Capacity"
            };
            model.ints[variableId] = 1;

            // Binary Variable: Activation Flag
            model.variables[binaryId] = {
                cost: SPLIT_PENALTY,                // Penalty for "opening" this connection
                [`link_${lotIdFragment}_${d.id}`]: -BIG_M, // Provides huge capacity to "Link"
                // We want to MINIMIZE sum(binaryId).
                // Effectively: if we cut 1 piece, link constraint forces binary=1 (cost+=5000).
                // If we cut 100 pieces, binary=1 (cost+=5000).
                // If we cut 0, solver sets binary=0 (cost+=0).
            };
            model.binaries[binaryId] = 1;

            // Constraint: Link
            // cut - BIG_M * use <= 0  -->  cut <= BIG_M * use
            // If use=0, cut must be 0.
            // If use=1, cut can be up to BIG_M.
            model.constraints[`link_${lotIdFragment}_${d.id}`] = { max: 0 };
        });
    });

    // 2. Solve
    console.log("Starting LP Solve with variables:", Object.keys(model.variables).length);
    const solution = solver.Solve(model);
    console.log("LP Solver Status:", solution);

    // 3. Parse Results -> "Plans" format
    // Solution contains keys like "cut_L1_dem_RED_32": 50
    const finalPlans = [];
    let cutIdCounter = 1;

    // Group by Lot to form Plans
    const cutsByLot = {};

    Object.entries(solution).forEach(([key, val]) => {
        if (key.startsWith('cut_') && val > 0) {
            // key: cut_L1_dem_RED_32
            // val: quantity
            const parts = key.split('_dem_'); // ['cut_L1', 'RED_32'] or similar. Be careful with parsing.
            // Safer: We reconstructed IDs roughly.
            // Let's match strictly. But 'dem_' helps splitting.
            // lotPart = parts[0].replace('cut_', '')
            // ordPart = parts[1] (RED_32)

            // Re-find Lot and Order info
            // Actually, we iterate Lots and DemandMap is safer if keys are complex.
            // But Map lookup is O(1).
            // We used `cut_${lotIdFragment}_${d.id}`
            // d.id = `dem_${color}_${size}`

            // Let's just Regex parse
            // cut_L(lotID)_dem_(Color)_(Size)
            // It's tricky to parse if LotID has underscores.
            // Better: Iterate our known Variables and check solution[key].
        }
    });

    // Robust Gathering
    flattenedLots.forEach(lot => {
        const lotIdFragment = `L${lot.id || lot.lot}`;
        const planRows = [];


        demandMap.forEach(d => {
            const variableId = `cut_${lotIdFragment}_${d.id}`;
            const qty = solution[variableId];
            if (qty && qty > 0) {
                // We have a cut!
                planRows.push({
                    colors: d.color,
                    layers: qty, // In "Single Size Pattern", layers = pieces.
                    quantities: { [d.size]: qty },
                    totalPieces: qty
                });

            }
        });

        if (planRows.length > 0) {
            // Create a Plan Object
            // Group by "Color" if possible to look like standard output?
            // The standard output supports "rows".

            // Consolidate rows of same Color/Size?
            // Since we use Single Size Patterns, we might have multiple entries if we didn't agg.
            // But here d.id is unique per Color-Size. So it's fine.

            // Note: The UI expects `markerRatio`.
            // Since these are "1:1" cuts, MarkerRatio is { [size]: 1 }.
            // But we might have multiple sizes in one Lot.
            // Can we merge them into one "Plan"? 
            // Constraint: "Bir pastal sadece TEK BİR LOT grubundan oluşabilir."
            // If we cut Red S and Red M from Lot 1, is that 1 Plan or 2?
            // Usually 1 Lot = Multiple Markers is allowed.
            // Our UI shows "Plans" which are basically "Markers".
            // Since we modeled "Individual Pieces", we technically create "Assorted Single Lay" markers.
            // Let's group by "Size" to emulate efficient markers?
            // No, LP output is purely quantities. 
            // We will create ONE Plan Entry per Lot containing multiple "Rows".
            // Actually, if we mix sizes, we can't easily define "Ratio".
            // For now, let's treat every Size cut as a separate "Marker/Plan" line inside the Lot Block?
            // Or separate Plans?
            // UI: "Plan" has `markerRatio`, `totalLayers`.
            // Use case: 1 Plan = 1 Marker definition.
            // If Lot 1 yields 50 S and 50 M.
            // Are they cut together (Mixed Marker) or separate?
            // LP model assumed Independent Cuts (Single Size Pattern).
            // So we should output 2 Plans: One for S (50 layers), One for M (50 layers).

            // Let's emit one Plan per unique Size found in this Lot.
            const sizeGroups = {};
            planRows.forEach(row => {
                const sz = Object.keys(row.quantities)[0];
                if (!sizeGroups[sz]) sizeGroups[sz] = [];
                sizeGroups[sz].push(row);
            });

            Object.entries(sizeGroups).forEach(([size, rows]) => {
                // rows contains [{color: 'Red', layers: 50}, {color: 'Blue', layers: 20}]
                // Total Layers = Sum?
                // If we cut Red S and Blue S from same Lot, same Size. 
                // We can make a "Mixed Color Marker" (e.g. S ratio 1).
                // Total Layers = Red Layers + Blue Layers.

                const totalLayers = rows.reduce((s, r) => s + r.layers, 0);
                const consolidatedRows = rows.map(r => ({
                    colors: r.colors,
                    layers: r.totalPieces,
                    quantities: r.quantities
                }));

                finalPlans.push({
                    id: cutIdCounter++,
                    shrinkage: `${lot.moldGroup} | LOT: ${lot.lot}`,
                    lot: lot.lot,
                    mold: lot.moldGroup,
                    totalLayers: totalLayers,
                    markerRatio: { [size]: 1 },
                    markerLength: ((consumptionMode === 'SIZE' ? parseFloat(sizeConsumptions[size]) : 0) || avgConsumption).toFixed(2),
                    rows: consolidatedRows,
                    fabrics: lot.fabrics ? lot.fabrics.map(f => f.topNo).join(', ') : '',
                    note: `LP Optimized: ${size}`
                });
            });
        }
    });

    // 4. Generate Summary / Integrity Map
    // We need to calculate the "Missing" / Integrity based on solution.
    // Reconstruct Integrity.

    // Check missing.
    const integrityMap = {};
    demandMap.forEach(d => {
        // Calculate total allocated for d.id
        // Iterate lots... or check solution constraints?
        // Actually we can sum up from planRows logic or variables.
        let allocated = 0;
        flattenedLots.forEach(lot => {
            const variableId = `cut_L${lot.id || lot.lot}_${d.id}`;
            allocated += (solution[variableId] || 0);
        });

        // Score: Did it all come from ONE lot?
        const usedLots = flattenedLots.filter(lot => (solution[`cut_L${lot.id || lot.lot}_${d.id}`] || 0) > 0);
        const integrityScore = (allocated >= d.qty && usedLots.length === 1) ? 100 :
            (usedLots.length > 1 ? 50 : 0); // 50 for split, 0 for missing.

        integrityMap[`${d.color}-${d.size}`] = {
            score: integrityScore,
            allocations: usedLots.map(l => ({ lot: l.lot, qty: solution[`cut_L${l.id || l.lot}_${d.id}`] }))
        };
    });

    return { plans: finalPlans, integrityMap };
};
