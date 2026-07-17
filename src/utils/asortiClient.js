export const solveAsorti = (data) => {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./optimization.worker.js', import.meta.url), { type: 'module' })

        worker.postMessage({
            orderRows: data.orderRows,
            fabricRows: data.fabricRows,
            parameters: {
                avgConsumption: data.avgConsumption,
                consumptionMode: data.consumptionMode,
                sizeConsumptions: data.sizeConsumptions
            },
            allocationOverride: data.allocationOverride || null
        })

        worker.onmessage = (e) => {
            const result = e.data
            if (result.progress) return
            if (result.success) {
                resolve(result)
            } else {
                reject(new Error(result.error))
            }
            worker.terminate()
        }

        worker.onerror = (err) => {
            reject(err)
            worker.terminate()
        }
    })
}
