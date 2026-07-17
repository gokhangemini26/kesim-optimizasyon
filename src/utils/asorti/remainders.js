import { subpoolKey } from './pools.js'
import { buildColumnsForSizes } from './markers.js'
import { markerLengthOf, piecesPerLayerOf } from './common.js'

export const buildRemainderColumns = (leftovers, state) => {
    if (leftovers.length === 0) return { columns: [], unfulfilled: [] }

    const bySize = {}
    leftovers.forEach(({ lot, size, qty }) => {
        if (!bySize[size]) bySize[size] = {}
        bySize[size][lot] = (bySize[size][lot] || 0) + qty
    })

    const entries = Object.entries(bySize)
        .map(([size, lots]) => ({
            size,
            groups: Object.entries(lots).map(([lot, qty]) => ({ lot, qty }))
        }))
        .sort((a, b) =>
            b.groups.reduce((s, g) => s + g.qty, 0) - a.groups.reduce((s, g) => s + g.qty, 0)
        )

    let cekmeGroups = state.cekmeGroups
    if (state.rng && cekmeGroups.length > 1 && state.rng() < 0.5) {
        cekmeGroups = [cekmeGroups[Math.floor(state.rng() * cekmeGroups.length)]]
    }

    const relaxed = {
        ...state,
        cekmeGroups,
        params: { ...state.params, minBlockLayers: 1, minPartialLayers: 1 }
    }

    const { columns, leftovers: missed } = buildColumnsForSizes(entries, relaxed, { requeueThreshold: 1 })
    return { columns, unfulfilled: missed }
}

const tryMerge = (A, B, subpools, cons, P) => {
    if (A.cekme !== B.cekme) return null

    const sizesA = Object.keys(A.ratio)
    const sizesB = Object.keys(B.ratio)
    if (sizesA.some(s => B.ratio[s] != null)) return null
    if (sizesA.length + sizesB.length > P.maxSizesPerMarker) return null

    const pA = piecesPerLayerOf(A.ratio)
    const pB = piecesPerLayerOf(B.ratio)
    if (pA + pB > P.maxPiecesPerMarker) return null

    const lotsU = [...new Set([...A.blocks.map(b => b.lot), ...B.blocks.map(b => b.lot)])]
    const layersA = Object.fromEntries(A.blocks.map(b => [b.lot, b.layers]))
    const layersB = Object.fromEntries(B.blocks.map(b => [b.lot, b.layers]))

    const merged = {}
    let totalLayers = 0
    let overcutAdded = 0
    lotsU.forEach(lot => {
        const la = layersA[lot] || 0
        const lb = layersB[lot] || 0
        merged[lot] = Math.max(la, lb)
        totalLayers += merged[lot]
        overcutAdded += (merged[lot] - la) * pA + (merged[lot] - lb) * pB
    })

    if (totalLayers > P.maxLayers) return null
    if (overcutAdded > P.mergeOvercutMax) return null

    const lenA = markerLengthOf(A.ratio, cons)
    const lenB = markerLengthOf(B.ratio, cons)
    const extraByLot = {}
    for (const lot of lotsU) {
        const la = layersA[lot] || 0
        const lb = layersB[lot] || 0
        const extra = merged[lot] * (lenA + lenB) - (la * lenA + lb * lenB)
        const sp = subpools.get(subpoolKey(lot, A.cekme))
        if (!sp || sp.remaining < extra) return null
        extraByLot[lot] = extra
    }

    return { merged, extraByLot, overcutAdded }
}

const tryAbsorb = (A, B, subpools, cons, P) => {
    if (A.cekme !== B.cekme) return null
    const sizesA = Object.keys(A.ratio)
    const sizesB = Object.keys(B.ratio)
    if (sizesA.length !== 1 || sizesB.length !== 1 || sizesA[0] !== sizesB[0]) return null

    const size = sizesA[0]
    const mA = A.ratio[size]
    const mB = B.ratio[size]
    const len1 = cons(size)
    const totalA = A.blocks.reduce((s, b) => s + b.layers, 0)

    let extraLayersTotal = 0
    let overcutAdded = 0
    const moves = []
    for (const bb of B.blocks) {
        const pieces = mB * bb.layers
        const extraLayers = Math.ceil(pieces / mA)
        const sp = subpools.get(subpoolKey(bb.lot, A.cekme))
        const netMetraj = extraLayers * mA * len1 - bb.layers * mB * len1
        if (!sp || sp.remaining < netMetraj) return null
        extraLayersTotal += extraLayers
        overcutAdded += extraLayers * mA - pieces
        moves.push({ lot: bb.lot, extraLayers, netMetraj })
    }

    if (totalA + extraLayersTotal > P.maxLayers) return null
    if (overcutAdded > P.mergeOvercutMax) return null
    return { absorb: true, moves, overcutAdded }
}

export const mergeColumns = (columns, subpools, cons, P) => {
    const cols = [...columns]

    for (;;) {
        let best = null
        for (let i = 0; i < cols.length; i++) {
            for (let j = i + 1; j < cols.length; j++) {
                const candidates = [
                    { t: tryMerge(cols[i], cols[j], subpools, cons, P), hostIdx: i, otherIdx: j },
                    { t: tryAbsorb(cols[i], cols[j], subpools, cons, P), hostIdx: i, otherIdx: j },
                    { t: tryAbsorb(cols[j], cols[i], subpools, cons, P), hostIdx: j, otherIdx: i }
                ]
                for (const { t, hostIdx, otherIdx } of candidates) {
                    if (t && (!best || t.overcutAdded < best.overcutAdded)) {
                        best = { ...t, i: hostIdx, j: otherIdx }
                    }
                }
            }
        }
        if (!best) break

        if (best.absorb) {
            const host = cols[best.i]
            const other = cols[best.j]
            best.moves.forEach(({ lot, extraLayers, netMetraj }) => {
                subpools.get(subpoolKey(lot, host.cekme)).remaining -= netMetraj
                const block = host.blocks.find(b => b.lot === lot)
                if (block) block.layers += extraLayers
                else host.blocks.push({ lot, layers: extraLayers })
            })
            cols.splice(cols.indexOf(other), 1)
        } else {
            const A = cols[best.i]
            Object.entries(best.extraByLot).forEach(([lot, extra]) => {
                subpools.get(subpoolKey(lot, A.cekme)).remaining -= extra
            })
            const mergedCol = {
                cekme: A.cekme,
                ratio: { ...A.ratio, ...cols[best.j].ratio },
                blocks: Object.entries(best.merged).map(([lot, layers]) => ({ lot, layers }))
            }
            cols.splice(best.j, 1)
            cols.splice(best.i, 1, mergedCol)
        }
    }

    return cols
}
