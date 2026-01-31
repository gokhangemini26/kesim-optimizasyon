
import { solveCuttingStock } from './OptimizationEngineLP.js';

const mockOrderRows = [
    { color: 'RED', quantities: { '32': 500, '34': 200 } },
    { color: 'BLUE', quantities: { '32': 500 } }
];

const mockGroupingResults = {
    kalip1: [
        { id: '1', lot: 'LOT-Big', totalMetraj: 1000, fabrics: [{ topNo: '1' }] },
        { id: '2', lot: 'LOT-Small', totalMetraj: 300, fabrics: [{ topNo: '2' }] }
    ],
    kalip2: [],
    kalip3: []
};

const mockData = {
    orderRows: mockOrderRows,
    groupingResults: mockGroupingResults,
    avgConsumption: 1.0,
    consumptionMode: 'AVG',
    sizeConsumptions: {}
};

console.log("--- RUNNING LP OPTIMIZATION TEST ---");

const result = solveCuttingStock(mockData);

console.log("--- PLANS GENERATED ---");
result.plans.forEach(p => {
    console.log(`Plan ID: ${p.id} | Lot: ${p.lot} | Size: ${Object.keys(p.markerRatio)[0]} | Layers: ${p.totalLayers}`);
    p.rows.forEach(r => {
        console.log(`    - ${r.colors}: ${r.layers}`);
    })
});

console.log("\n--- INTEGRITY ---");
Object.entries(result.integrityMap).forEach(([key, val]) => {
    console.log(`${key}: Score ${val.score}, Allocs: ${JSON.stringify(val.allocations)}`);
});
