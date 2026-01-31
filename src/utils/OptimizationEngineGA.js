
/**
 * Wrapper for the Genetic Algorithm Web Worker.
 * Handles communication and Promisification.
 */
export const solveCuttingStockGA = (data) => {
    return new Promise((resolve, reject) => {
        // Create worker
        const worker = new Worker(new URL('./optimization.worker.js', import.meta.url), { type: 'module' });

        // Prepare parameters
        const params = {
            orderRows: data.orderRows,
            groupingResults: data.groupingResults,
            parameters: {
                avgConsumption: data.avgConsumption,
                consumptionMode: data.consumptionMode,
                sizeConsumptions: data.sizeConsumptions
            }
        };

        worker.postMessage(params);

        worker.onmessage = (e) => {
            const result = e.data;
            if (result.success) {
                // Return plans and empty integrity map for now (or calculate it)
                // The current UI uses integrityMap for the Summary. 
                // We should probably generate the integrity Map here or in the App.
                // The existing App.jsx generates summary using `generateSummary`.
                // `generateSummary` needs `IntegrityMap`.
                // For now, return empty integrity map or basic one.
                resolve({ plans: result.plans, integrityMap: {} });
            } else {
                reject(new Error(result.error));
            }
            worker.terminate();
        };

        worker.onerror = (err) => {
            reject(err);
            worker.terminate();
        };
    });
};
