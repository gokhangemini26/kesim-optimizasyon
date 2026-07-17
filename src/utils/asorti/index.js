import { DEFAULT_ENGINE_PARAMS, makeCons, mulberry32 } from './common.js'
import { buildPools } from './pools.js'
import { allocateColors, buildGroupDemand } from './allocation.js'
import { buildMainColumns } from './markers.js'
import { buildRemainderColumns, mergeColumns } from './remainders.js'
import { assignTops } from './fabrics.js'
import { buildPlans, buildAsortiMatrix, buildIntegrityMap } from './distribute.js'

export const runAsortiEngine = (input, options = {}) => {
    const P = { ...DEFAULT_ENGINE_PARAMS, ...(options.engineParams || {}) }
    const cons = makeCons(input.params || {})
    const rng = options.rng || null

    const pools = buildPools(input.fabricRows || [])
    if (pools.subpools.size === 0) throw new Error('Kumaş verisi yok')

    const alloc = allocateColors(input.orderRows || [], pools.lots, cons, {
        override: options.allocationOverride || null,
        rng
    })
    const demand = buildGroupDemand(input.orderRows || [], alloc.byColor, pools.lots, cons, alloc.reserved || {})

    const state = {
        demand,
        subpools: pools.subpools,
        cekmeGroups: pools.cekmeGroups,
        cons,
        params: P,
        rng
    }

    const { columns: mainCols, leftovers } = buildMainColumns(state)
    const { columns: remCols, unfulfilled } = buildRemainderColumns(leftovers, state)
    const rawCols = [...mainCols, ...remCols]

    // İki birleştirme modunu da dene (saf / çapraz-çekme), az kesim vereni al.
    const snapshot = () => new Map([...pools.subpools].map(([k, sp]) => [k, sp.remaining]))
    const restore = (snap) => snap.forEach((rem, k) => { pools.subpools.get(k).remaining = rem })
    const cloneCols = (cols) => cols.map(c => ({
        cekme: c.cekme,
        ratio: { ...c.ratio },
        blocks: c.blocks.map(b => ({ ...b }))
    }))

    const before = snapshot()
    const colsPure = mergeColumns(cloneCols(rawCols), pools.subpools, cons, { ...P, allowCrossCekme: false })
    const afterPure = snapshot()
    restore(before)
    const colsCross = mergeColumns(cloneCols(rawCols), pools.subpools, cons, { ...P, allowCrossCekme: true })

    let columns
    if (colsPure.length <= colsCross.length) {
        restore(afterPure)
        columns = colsPure
    } else {
        columns = colsCross
    }
    assignTops(columns, pools.subpools, cons)

    const { plans, plannedByColor, demandOf } = buildPlans({
        columns,
        orderRows: input.orderRows,
        byColor: alloc.byColor
    })

    let ordered = 0, planned = 0, overcut = 0, undercut = 0
    Object.entries(demandOf).forEach(([color, sizes]) => {
        Object.entries(sizes).forEach(([size, d]) => {
            const p = plannedByColor[color]?.[size] || 0
            ordered += d
            planned += p
            if (p > d) overcut += p - d
            else undercut += d - p
        })
    })

    const availableMetraj = [...pools.lots.values()].reduce((s, l) => s + l.total, 0)
    const usedMetraj = plans.reduce((s, p) => s + p.totalLayers * parseFloat(p.markerLength), 0)
    const totalLayers = plans.reduce((s, p) => s + p.totalLayers, 0)
    const avgLayers = plans.length ? totalLayers / plans.length : 0

    const overcutFree = ordered * P.overcutFreeRatio
    const undercutFree = ordered * P.undercutFreeRatio
    const score = 100000
        - plans.length * 1000
        - Math.max(0, undercut - undercutFree) * 300
        - undercut * 8
        - Math.max(0, overcut - overcutFree) * 500
        - overcut * 5
        + avgLayers * 2

    const allocationOut = {}
    Object.entries(alloc.byColor).forEach(([color, arr]) => {
        allocationOut[color] = arr.join('+')
    })

    return {
        plans,
        asortiMatrix: buildAsortiMatrix(plans),
        integrityMap: buildIntegrityMap(plannedByColor, demandOf, allocationOut),
        allocation: allocationOut,
        unfulfilled,
        stats: {
            cuts: plans.length,
            ordered,
            planned,
            overcut,
            undercut,
            avgLayers: Math.round(avgLayers * 10) / 10,
            usedMetraj: Math.round(usedMetraj * 100) / 100,
            availableMetraj: Math.round(availableMetraj * 100) / 100,
            utilization: availableMetraj > 0 ? Math.round((usedMetraj / availableMetraj) * 1000) / 10 : 0,
            score: Math.round(score * 10) / 10
        }
    }
}

export const runAsortiSearch = (input, options = {}) => {
    const { iterations = 200, seed = 20260717, onProgress = null, ...rest } = options
    let best = null
    let lastError = null

    const baseEP = rest.engineParams || {}
    const moChoices = [4, 6, 8, 12]

    for (let i = 0; i < iterations; i++) {
        const rng = i === 0 ? null : mulberry32(seed + i * 7919)
        let engineParams = baseEP
        if (rng && baseEP.mergeOvercutMax == null) {
            const paramRng = mulberry32(seed + i * 104729 + 17)
            engineParams = { ...baseEP, mergeOvercutMax: moChoices[Math.floor(paramRng() * moChoices.length)] }
        }
        try {
            const res = runAsortiEngine(input, { ...rest, engineParams, rng })
            if (!best || res.stats.score > best.stats.score) {
                best = res
                best.iteration = i
            }
        } catch (err) {
            lastError = err
        }
        if (onProgress && i % 20 === 0) onProgress(i, iterations)
    }

    if (!best) throw lastError || new Error('Hiçbir senaryo üretilemedi')
    return best
}
