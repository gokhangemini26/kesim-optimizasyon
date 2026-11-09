// Motor çıktısını motordan BAĞIMSIZ olarak yeniden hesaplayıp doğrular.
// Hiçbir istatistik motorun kendi beyanından alınmaz; her şey plan satırlarından türetilir.
import { DEFAULT_ENGINE_PARAMS, makeCons } from '../src/utils/asorti/common.js'

export const validatePlan = (result, { orderRows, fabricRows, params, engineParams = {} }) => {
    const P = { ...DEFAULT_ENGINE_PARAMS, ...engineParams }
    const cons = makeCons(params || {})
    const hard = []   // fiziksel olarak uygulanamaz plan
    const soft = []   // tolerans aşımı

    const pool = {}
    fabricRows.forEach(f => {
        const key = `${String(f.lot).toUpperCase()}|${f.cekme}`
        pool[key] = (pool[key] || 0) + f.metraj
    })
    const used = {}
    const plannedByColor = {}
    let totalLayers = 0
    let totalPieces = 0
    let minLayers = Infinity
    let multiLot = 0
    let metraj = 0

    result.plans.forEach(plan => {
        const ratio = plan.markerRatio
        const ppl = Object.values(ratio).reduce((a, b) => a + b, 0)
        const len = Object.entries(ratio).reduce((s, [size, m]) => s + m * cons(size), 0)
        const layers = plan.blocks.reduce((s, b) => s + b.layers, 0)
        if (layers !== plan.totalLayers) hard.push(`kesim ${plan.id}: blok katları (${layers}) ≠ toplam kat (${plan.totalLayers})`)
        if (layers > P.maxLayers) hard.push(`kesim ${plan.id}: ${layers} kat > ${P.maxLayers}`)
        if (layers <= 0) hard.push(`kesim ${plan.id}: boş kesim`)
        if (ppl > P.maxPiecesPerMarker) hard.push(`kesim ${plan.id}: pastalda ${ppl} parça > ${P.maxPiecesPerMarker}`)
        if (Object.keys(ratio).length > P.maxSizesPerMarker) hard.push(`kesim ${plan.id}: pastalda ${Object.keys(ratio).length} beden > ${P.maxSizesPerMarker}`)
        if (Math.abs(len - parseFloat(plan.markerLength)) > 0.011) hard.push(`kesim ${plan.id}: pastal boyu tutarsız`)

        plan.blocks.forEach(b => {
            const key = `${b.lot}|${plan.mold}`
            if (!(key in pool)) hard.push(`kesim ${plan.id}: ${key} havuzu yok`)
            used[key] = (used[key] || 0) + b.layers * len
        })

        // Parça korunumu: satırlara dağıtılan adet = kat × oran (lot bazında)
        const cutByLot = {}
        plan.rows.forEach(r => {
            Object.entries(r.quantities).forEach(([size, q]) => {
                const k = `${r.lot}|${size}`
                cutByLot[k] = (cutByLot[k] || 0) + q
                if (!plannedByColor[r.colors]) plannedByColor[r.colors] = {}
                plannedByColor[r.colors][size] = (plannedByColor[r.colors][size] || 0) + q
            })
            const allowed = String(result.allocation[r.colors] ?? '').split('+')
            if (!allowed.includes(r.lot)) hard.push(`kesim ${plan.id}: renk ${r.colors} tahsis dışı lottan (${r.lot}) kesildi`)
        })
        plan.blocks.forEach(b => {
            Object.entries(ratio).forEach(([size, m]) => {
                const got = cutByLot[`${b.lot}|${size}`] || 0
                if (got !== b.layers * m) hard.push(`kesim ${plan.id}: ${b.lot}/${size} dağıtım ${got} ≠ ${b.layers * m}`)
            })
        })

        totalLayers += layers
        totalPieces += layers * ppl
        metraj += layers * len
        minLayers = Math.min(minLayers, layers)
        if (plan.blocks.length > 1) multiLot++
    })

    Object.entries(used).forEach(([key, u]) => {
        if (u > (pool[key] || 0) + 0.01) hard.push(`${key} havuzunda metraj aşımı (${u.toFixed(1)} / ${(pool[key] || 0).toFixed(1)} m)`)
    })

    let ordered = 0, planned = 0, overcut = 0, undercut = 0, missingCells = 0
    orderRows.forEach(row => {
        Object.entries(row.quantities || {}).forEach(([size, qty]) => {
            const d = parseInt(qty) || 0
            if (d <= 0) return
            const p = plannedByColor[String(row.color)]?.[size] || 0
            ordered += d
            planned += p
            if (p > d) overcut += p - d
            else undercut += d - p
            if (p === 0) missingCells++
        })
    })
    const s = result.stats
    if (s.ordered !== ordered || s.planned !== planned || s.overcut !== overcut || s.undercut !== undercut) {
        hard.push(`motor istatistikleri yeniden hesapla tutmuyor (motor +${s.overcut}/−${s.undercut}, gerçek +${overcut}/−${undercut})`)
    }
    if (undercut > ordered * P.undercutFreeRatio) soft.push(`eksik %${(undercut / ordered * 100).toFixed(1)}`)
    if (overcut > ordered * P.overcutFreeRatio) soft.push(`fazla %${(overcut / ordered * 100).toFixed(1)}`)

    const cuts = result.plans.length
    return {
        hard, soft,
        ok: hard.length === 0 && soft.length === 0,
        metrics: {
            cuts, ordered, planned, overcut, undercut, missingCells,
            totalLayers,
            avgLayers: cuts ? Math.round(totalLayers / cuts * 10) / 10 : 0,
            minLayers: cuts ? minLayers : 0,
            piecesPerLayer: totalLayers ? Math.round(totalPieces / totalLayers * 100) / 100 : 0,
            piecesPerCut: cuts ? Math.round(totalPieces / cuts) : 0,
            multiLotPct: cuts ? Math.round(multiLot / cuts * 100) : 0,
            metraj: Math.round(metraj * 10) / 10
        }
    }
}
