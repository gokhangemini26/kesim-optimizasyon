import { subpoolKey } from './pools.js'

const minMultiplicity = (qtys, maxLayers, maxPieces) => {
    for (let m = 1; m <= maxPieces; m++) {
        const total = qtys.reduce((s, q) => s + Math.ceil(q / m), 0)
        if (total <= maxLayers) return m
    }
    return maxPieces
}

export const simulateColumn = (size, groups, cekme, state) => {
    const { subpools, cons, params: P, rng } = state
    const len1 = cons(size)

    const parts = groups.filter(g => {
        const sp = subpools.get(subpoolKey(g.lot, cekme))
        return sp && sp.remaining >= Math.min(g.qty, P.minBlockLayers) * len1
    })
    if (parts.length === 0) return null

    let m = minMultiplicity(parts.map(p => p.qty), P.maxLayers, P.maxPiecesPerMarker)
    if (rng && m < P.maxPiecesPerMarker && rng() < 0.2) m += 1

    const blocks = []
    let layerBudget = P.maxLayers
    let covered = 0
    let overcut = 0

    for (const g of parts) {
        if (layerBudget <= 0) break
        const sp = subpools.get(subpoolKey(g.lot, cekme))
        const ceilL = Math.ceil(g.qty / m)
        const floorL = Math.floor(g.qty / m)
        const short = g.qty - floorL * m
        const over = ceilL * m - g.qty
        const dropTol = Math.max(1, Math.floor(g.qty * P.flexShortRatio))
        let want = ceilL
        if (short > 0 && floorL >= 1 && short <= dropTol) {
            if (rng ? rng() < 0.5 : short < over) want = floorL
        }
        const affordable = Math.floor(sp.remaining / (m * len1))
        const layers = Math.min(want, affordable, layerBudget)
        if (layers < Math.min(want, P.minBlockLayers)) continue
        if (layers <= 0) continue

        blocks.push({ lot: g.lot, layers })
        layerBudget -= layers
        const pieces = layers * m
        covered += Math.min(g.qty, pieces)
        overcut += Math.max(0, pieces - g.qty)
    }

    if (blocks.length === 0) return null

    let minSlack = 1
    blocks.forEach(b => {
        const sp = subpools.get(subpoolKey(b.lot, cekme))
        const need = b.layers * m * len1
        if (sp.total > 0) minSlack = Math.min(minSlack, (sp.remaining - need) / sp.total)
    })

    return {
        size, cekme, m, blocks, covered, overcut, minSlack,
        metraj: blocks.reduce((s, b) => s + b.layers * m * len1, 0)
    }
}

const pickColumn = (size, remaining, state) => {
    const { cekmeGroups, rng } = state
    const sims = cekmeGroups
        .map(cekme => simulateColumn(size, remaining, cekme, state))
        .filter(Boolean)
        .sort((a, b) =>
            b.covered - a.covered ||
            b.minSlack - a.minSlack ||
            a.overcut - b.overcut
        )

    if (sims.length === 0) return null
    if (rng && sims.length > 1 && rng() < 0.3) {
        const viable = sims.filter(s => s.covered >= sims[0].covered * 0.7)
        return viable[Math.floor(rng() * viable.length)]
    }
    return sims[0]
}

const applyColumn = (sim, state) => {
    const { subpools, cons } = state
    const len1 = cons(sim.size)
    sim.blocks.forEach(b => {
        const sp = subpools.get(subpoolKey(b.lot, sim.cekme))
        sp.remaining -= b.layers * sim.m * len1
    })
    return {
        cekme: sim.cekme,
        ratio: { [sim.size]: sim.m },
        blocks: sim.blocks.map(b => ({ lot: b.lot, layers: b.layers }))
    }
}

export const buildColumnsForSizes = (sizeEntries, state, { requeueThreshold }) => {
    const { params: P } = state
    const columns = []
    const leftovers = []

    for (const { size, groups } of sizeEntries) {
        let remaining = [...groups].sort((a, b) => b.qty - a.qty)
        let guard = 0

        while (remaining.length && guard++ < P.maxColumnsPerSize) {
            const sim = pickColumn(size, remaining, state)
            if (!sim) {
                remaining.forEach(g => leftovers.push({ lot: g.lot, size, qty: g.qty }))
                remaining = []
                break
            }
            columns.push(applyColumn(sim, state))

            const next = []
            for (const g of remaining) {
                const block = sim.blocks.find(b => b.lot === g.lot)
                const cut = block ? block.layers * sim.m : 0
                const rem = g.qty - cut
                if (rem <= 0) continue
                const dropTol = Math.max(1, Math.floor(g.qty * P.flexShortRatio))
                if (cut > 0 && rem <= dropTol) continue
                if (rem >= requeueThreshold) next.push({ lot: g.lot, qty: rem })
                else leftovers.push({ lot: g.lot, size, qty: rem })
            }
            remaining = next.sort((a, b) => b.qty - a.qty)
        }

        remaining.forEach(g => leftovers.push({ lot: g.lot, size, qty: g.qty }))
    }

    return { columns, leftovers }
}

export const buildMainColumns = (state) => {
    const { demand, cons, params: P, rng } = state

    const sizeMap = {}
    Object.entries(demand).forEach(([lot, sizes]) => {
        Object.entries(sizes).forEach(([size, qty]) => {
            if (!sizeMap[size]) sizeMap[size] = []
            sizeMap[size].push({ lot, qty })
        })
    })

    const totals = {}
    Object.entries(sizeMap).forEach(([size, groups]) => {
        totals[size] = groups.reduce((s, g) => s + g.qty, 0)
    })

    const smallLeftovers = []
    const mainSizes = []
    Object.keys(sizeMap).forEach(size => {
        if (totals[size] >= P.minMainPieces) mainSizes.push(size)
        else sizeMap[size].forEach(g => smallLeftovers.push({ lot: g.lot, size, qty: g.qty }))
    })

    mainSizes.sort((a, b) => {
        const wa = totals[a] * cons(a) + (rng ? rng() * 60 : 0)
        const wb = totals[b] * cons(b) + (rng ? rng() * 60 : 0)
        return wb - wa
    })

    const entries = mainSizes.map(size => ({ size, groups: sizeMap[size] }))
    const { columns, leftovers } = buildColumnsForSizes(entries, state, { requeueThreshold: P.minMainPieces })

    return { columns, leftovers: [...leftovers, ...smallLeftovers] }
}
