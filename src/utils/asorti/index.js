import { DEFAULT_ENGINE_PARAMS, makeCons, mulberry32 } from './common.js'
import { buildPools } from './pools.js'
import { allocateColors, buildGroupDemand, proposeAllocation, unavoidableShortage } from './allocation.js'
import { buildMainColumns } from './markers.js'
import { buildRemainderColumns, mergeColumns } from './remainders.js'
import { assignTops } from './fabrics.js'
import { buildPlans, buildAsortiMatrix, buildIntegrityMap } from './distribute.js'
import { makeProblem, optimizeCuts, columnsFromSol, residualOf, isFeasible } from './optimizer.js'

// Kolonlardan (kesimlerden) nihai planı, renk dağılımını ve istatistikleri üretir.
// Top ataması havuzu tükettiği için her çağrıda taze bir havuz kopyası ister.
const finalize = ({ input, P, cons, pools, alloc, columns, unfulfilled }) => {
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
            withinTolerance: undercut <= undercutFree + 1e-9 && overcut <= overcutFree + 1e-9,
            score: Math.round(score * 10) / 10
        }
    }
}

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
    return finalize({ input, P, cons, pools, alloc, columns, unfulfilled })
}

// Eski arama: açgözlü tek-beden kolon kurucunun rastgele yeniden başlatılması.
// Yeni motor bunu yalnızca başlangıç çözümü ve emniyet ağı olarak kullanır.
export const runAsortiSearchLegacy = (input, options = {}) => {
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

const columnsOfPlans = (plans) => plans.map(p => ({
    cekme: p.mold,
    ratio: { ...p.markerRatio },
    blocks: p.blocks.map(b => ({ lot: b.lot, layers: b.layers }))
}))

const betterResult = (a, b) => {
    if (!b) return true
    if (a.stats.withinTolerance !== b.stats.withinTolerance) return a.stats.withinTolerance
    return a.stats.score > b.stats.score
}

// Yeni arama: renk→lot tahsis adaylarını üretir, her biri için kesim planını
// LNS çekirdeğiyle (optimizer.js) optimize eder ve en iyi planı döndürür.
export const runAsortiSearch = (input, options = {}) => {
    const {
        iterations = 1500,
        seed = 20260717,
        onProgress = null,
        legacyIterations = 120,
        allocationCandidates = 10,
        allocationOverride = null,
        engineParams = {}
    } = options

    const P = { ...DEFAULT_ENGINE_PARAMS, ...engineParams }
    const cons = makeCons(input.params || {})
    const basePools = buildPools(input.fabricRows || [])
    if (basePools.subpools.size === 0) throw new Error('Kumaş verisi yok')

    let legacy = null
    if (legacyIterations > 0) {
        try {
            legacy = runAsortiSearchLegacy(input, { iterations: legacyIterations, seed, allocationOverride, engineParams })
        } catch {
            legacy = null
        }
    }

    // Tahsis adayları
    const candidates = []
    const seen = new Set()
    const pushCandidate = (override, rng, seedColumns) => {
        const alloc = allocateColors(input.orderRows || [], basePools.lots, cons, { override, rng })
        const key = JSON.stringify(Object.entries(alloc.byColor).sort())
        if (seen.has(key)) return
        seen.add(key)
        const demand = buildGroupDemand(input.orderRows || [], alloc.byColor, basePools.lots, cons, alloc.reserved || {})
        const unavoidable = unavoidableShortage(input.orderRows || [], alloc.byColor, basePools.lots, cons)
        const pb = makeProblem({ demand, subpools: basePools.subpools, cekmeGroups: basePools.cekmeGroups, cons, params: P, unavoidable })
        candidates.push({ alloc, pb, seeds: seedColumns ? [seedColumns] : [] })
    }

    if (allocationOverride) {
        pushCandidate(allocationOverride, null, legacy ? columnsOfPlans(legacy.plans) : null)
    } else {
        if (legacy) pushCandidate(legacy.allocation, null, columnsOfPlans(legacy.plans))
        pushCandidate(null, null, null)
        const orders = input.orderRows || []
        pushCandidate(proposeAllocation(orders, basePools.lots, cons, null), null, null)
        for (let i = 1; candidates.length < allocationCandidates && i <= allocationCandidates * 4; i++) {
            const rng = mulberry32(seed + i * 7919)
            if (i % 3 === 0) pushCandidate(null, rng, null)
            else pushCandidate(proposeAllocation(orders, basePools.lots, cons, rng), null, null)
        }
    }

    // Çok aday varsa kısa bir ön eleme yap, en iyi ikisini tam ara
    let finalists = candidates
    if (candidates.length > 2) {
        const screenIters = Math.max(20, Math.floor(iterations / 15))
        finalists = candidates
            .map((cand, i) => {
                const r = optimizeCuts(cand.pb, { seeds: cand.seeds, iterations: screenIters, rng: mulberry32(seed + 31 * (i + 1)) })
                const feasible = isFeasible(cand.pb, r.sol)
                return { cand, sol: r.sol, cost: r.cost, feasible, i }
            })
            .sort((a, b) => (b.feasible - a.feasible) || (a.cost - b.cost) || (a.i - b.i))
            .slice(0, 2)
            .map(x => ({ ...x.cand, seeds: [...x.cand.seeds, columnsFromSol(x.cand.pb, x.sol)] }))
    }

    let best = null
    const perFinalist = Math.max(1, Math.floor(iterations / finalists.length))
    finalists.forEach((cand, fi) => {
        const { sol } = optimizeCuts(cand.pb, {
            seeds: cand.seeds,
            iterations: perFinalist,
            rng: mulberry32(seed + 104729 * (fi + 1)),
            onProgress: onProgress ? (i) => onProgress(fi * perFinalist + i, iterations) : null
        })
        const res = finalize({
            input, P, cons,
            pools: buildPools(input.fabricRows || []),
            alloc: cand.alloc,
            columns: columnsFromSol(cand.pb, sol),
            unfulfilled: residualOf(cand.pb, sol)
        })
        res.stats.engine = 'lns'
        if (betterResult(res, best)) best = res
    })

    if (legacy) {
        legacy.stats.engine = 'legacy'
        if (betterResult(legacy, best)) best = legacy
    }
    if (!best) throw new Error('Hiçbir senaryo üretilemedi')
    return best
}
