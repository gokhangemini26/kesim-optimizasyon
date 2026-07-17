export const DEFAULT_ENGINE_PARAMS = {
    maxLayers: 80,
    maxPiecesPerMarker: 6,
    maxSizesPerMarker: 2,
    minMainPieces: 40,
    minBlockLayers: 8,
    minPartialLayers: 8,
    overcutFreeRatio: 0.02,
    undercutFreeRatio: 0.007,
    flexShortRatio: 0.03,
    mergeOvercutMax: 12,
    maxColumnsPerSize: 6
}

export const mulberry32 = (seed) => {
    let a = seed >>> 0
    return () => {
        a |= 0
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export const makeCons = (params) => {
    const avg = parseFloat(params.avgConsumption) || 1.4
    if (params.consumptionMode === 'SIZE') {
        return (size) => parseFloat(params.sizeConsumptions?.[size]) || avg
    }
    return () => avg
}

export const markerLengthOf = (ratio, cons) =>
    Object.entries(ratio).reduce((sum, [size, m]) => sum + m * cons(size), 0)

export const piecesPerLayerOf = (ratio) =>
    Object.values(ratio).reduce((a, b) => a + b, 0)
