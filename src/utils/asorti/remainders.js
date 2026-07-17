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
    const cross = A.cekme !== B.cekme
    if (cross && P.allowCrossCekme === false) return null

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
    const refundByLot = {}
    for (const lot of lotsU) {
        const la = layersA[lot] || 0
        const lb = layersB[lot] || 0
        // Birleşik kolon A'nın çekmesinde kesilir; B'nin blokları çapraz geliyorsa
        // B'nin eski havuzuna iade edilir, A'nın havuzundan tüketilir.
        const alreadyInA = la * lenA + (cross ? 0 : lb * lenB)
        const extra = merged[lot] * (lenA + lenB) - alreadyInA
        const sp = subpools.get(subpoolKey(lot, A.cekme))
        if (!sp || sp.remaining < extra) return null
        extraByLot[lot] = extra
        if (cross && lb > 0) refundByLot[lot] = lb * lenB
    }

    return { merged, extraByLot, refundByLot, sourceCekme: B.cekme, overcutAdded, penalty: overcutAdded + (cross ? 0.5 : 0) }
}

const tryAbsorb = (A, B, subpools, cons, P) => {
    const cross = A.cekme !== B.cekme
    if (cross && P.allowCrossCekme === false) return null
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
        const consume = cross
            ? extraLayers * mA * len1
            : extraLayers * mA * len1 - bb.layers * mB * len1
        if (!sp || sp.remaining < consume) return null
        extraLayersTotal += extraLayers
        overcutAdded += extraLayers * mA - pieces
        moves.push({
            lot: bb.lot,
            extraLayers,
            netMetraj: consume,
            refund: cross ? bb.layers * mB * len1 : 0
        })
    }

    if (totalA + extraLayersTotal > P.maxLayers) return null
    if (overcutAdded > P.mergeOvercutMax) return null
    return { absorb: true, moves, sourceCekme: B.cekme, overcutAdded, penalty: overcutAdded + (cross ? 0.5 : 0) }
}

export const mergeColumns = (columns, subpools, cons, P) => {
    const cols = [...columns]

    for (;;) {
        let best = null
        for (let i = 0; i < cols.length; i++) {
            for (let j = i + 1; j < cols.length; j++) {
                const candidates = [
                    { t: tryMerge(cols[i], cols[j], subpools, cons, P), hostIdx: i, otherIdx: j },
                    { t: tryMerge(cols[j], cols[i], subpools, cons, P), hostIdx: j, otherIdx: i },
                    { t: tryAbsorb(cols[i], cols[j], subpools, cons, P), hostIdx: i, otherIdx: j },
                    { t: tryAbsorb(cols[j], cols[i], subpools, cons, P), hostIdx: j, otherIdx: i }
                ]
                for (const { t, hostIdx, otherIdx } of candidates) {
                    if (t && (!best || t.penalty < best.penalty)) {
                        best = { ...t, i: hostIdx, j: otherIdx }
                    }
                }
            }
        }
        if (!best) break

        const host = cols[best.i]
        const other = cols[best.j]

        if (best.absorb) {
            best.moves.forEach(({ lot, extraLayers, netMetraj, refund }) => {
                subpools.get(subpoolKey(lot, host.cekme)).remaining -= netMetraj
                if (refund > 0) {
                    const spOld = subpools.get(subpoolKey(lot, best.sourceCekme))
                    if (spOld) spOld.remaining += refund
                }
                const block = host.blocks.find(b => b.lot === lot)
                if (block) block.layers += extraLayers
                else host.blocks.push({ lot, layers: extraLayers })
            })
            cols.splice(cols.indexOf(other), 1)
        } else {
            Object.entries(best.extraByLot).forEach(([lot, extra]) => {
                subpools.get(subpoolKey(lot, host.cekme)).remaining -= extra
            })
            Object.entries(best.refundByLot || {}).forEach(([lot, refund]) => {
                const spOld = subpools.get(subpoolKey(lot, best.sourceCekme))
                if (spOld) spOld.remaining += refund
            })
            const mergedCol = {
                cekme: host.cekme,
                ratio: { ...host.ratio, ...other.ratio },
                blocks: Object.entries(best.merged).map(([lot, layers]) => ({ lot, layers }))
            }
            const jIdx = cols.indexOf(other)
            const iIdx = cols.indexOf(host)
            cols.splice(jIdx, 1)
            cols.splice(jIdx < iIdx ? iIdx - 1 : iIdx, 1, mergedCol)
        }
    }

    return cols
}
