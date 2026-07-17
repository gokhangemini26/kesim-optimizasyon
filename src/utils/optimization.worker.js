import { runAsortiSearch } from './asorti/index.js'

self.onmessage = (e) => {
    const { orderRows, fabricRows, parameters, allocationOverride } = e.data

    try {
        const result = runAsortiSearch(
            { orderRows, fabricRows, params: parameters },
            {
                iterations: parameters?.iterations || 600,
                allocationOverride: allocationOverride || null,
                onProgress: (i, total) => self.postMessage({ progress: { i, total } })
            }
        )

        self.postMessage({
            success: true,
            plans: result.plans,
            integrityMap: result.integrityMap,
            asortiMatrix: result.asortiMatrix,
            allocation: result.allocation,
            unfulfilled: result.unfulfilled,
            stats: result.stats
        })
    } catch (err) {
        self.postMessage({ success: false, error: err.message })
    }
}
