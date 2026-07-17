import { runAsortiSearch } from '../src/utils/asorti/index.js'
import { CASES } from './fixtures/kesim-dosyalar.js'
import { orderRows as o1, fabricRows as f1, humanAllocation as a1, params as p1 } from './fixtures/ornek-1sa100.js'

const ALL = [
    {
        name: '1SA100 40687', file: '(görsel tablo)', human: { cuts: 12, planned: 2070, note: '2 kalıp, 3 lot' },
        params: p1, allocation: a1, orderRows: o1, fabricRows: f1
    },
    ...CASES
]

const checkCriteria = (result, orderRows, allocation) => {
    const { plans, stats } = result
    const issues = []
    if (stats.undercut > stats.ordered * 0.007) issues.push(`eksik %${(stats.undercut / stats.ordered * 100).toFixed(1)}`)
    if (stats.overcut > stats.ordered * 0.02) issues.push(`fazla %${(stats.overcut / stats.ordered * 100).toFixed(1)}`)
    orderRows.forEach(row => {
        const color = String(row.color)
        const allowed = new Set(String(result.allocation[color] ?? allocation[color]).split('+'))
        const used = new Set()
        plans.forEach(p => p.rows.forEach(r => { if (r.colors === color) used.add(r.lot) }))
        if (![...used].every(l => allowed.has(l))) issues.push(`renk ${color} tahsis dışı: ${[...used]}`)
    })
    plans.forEach(p => {
        if (p.totalLayers > 80) issues.push(`kesim ${p.id} kat ${p.totalLayers}>80`)
        const pieces = Object.values(p.markerRatio).reduce((a, b) => a + b, 0)
        if (pieces > 6) issues.push(`kesim ${p.id} marker ${pieces}>6 parça`)
    })
    return issues
}

for (const c of ALL) {
    const ordered = c.orderRows.reduce((s, r) => s + Object.values(r.quantities).reduce((a, b) => a + (parseInt(b) || 0), 0), 0)
    const fabric = c.fabricRows.reduce((s, f) => s + f.metraj, 0)
    const input = { orderRows: c.orderRows, fabricRows: c.fabricRows, params: c.params }
    const opts = { iterations: 400, engineParams: c.engineParams || {} }

    let over, auto, overErr, autoErr
    try { over = runAsortiSearch(input, { ...opts, allocationOverride: c.allocation }) } catch (e) { overErr = e.message }
    try { auto = runAsortiSearch(input, opts) } catch (e) { autoErr = e.message }

    console.log(`\n### ${c.name}  (${c.file})`)
    console.log(`  sipariş: ${ordered} adet | kumaş: ${fabric.toFixed(1)} m | ${c.human.note}`)
    console.log(`  İNSAN PLANI : ${c.human.cuts} kesim, ${c.human.planned} adet (${c.human.planned - ordered >= 0 ? '+' : ''}${c.human.planned - ordered})`)

    const report = (label, res, err) => {
        if (err) { console.log(`  ${label}: HATA — ${err}`); return }
        const s = res.stats
        const issues = checkCriteria(res, c.orderRows, c.allocation)
        console.log(`  ${label}: ${s.cuts} kesim, ${s.planned} adet (+${s.overcut}/−${s.undercut}), ort ${s.avgLayers} kat, kumaş %${s.utilization} | ${issues.length ? '⚠ ' + issues.join('; ') : 'TÜM KRİTERLER ✓'}`)
        res.plans.forEach(p => {
            const blocks = p.blocks.map(b => `${b.lot}:${b.layers}`).join(' ')
            console.log(`      #${p.id} [${p.mold}] ${Object.entries(p.markerRatio).map(([sz, m]) => `${m}×${sz}`).join(' + ')} → ${p.totalLayers} kat (${blocks})`)
        })
    }
    report('MOTOR (insan tahsisi)', over, overErr)
    if (auto && !autoErr) {
        const s = auto.stats
        const issues = checkCriteria(auto, c.orderRows, c.allocation)
        console.log(`  MOTOR (oto tahsis)  : ${s.cuts} kesim, ${s.planned} adet (+${s.overcut}/−${s.undercut}) | tahsis: ${JSON.stringify(auto.allocation)} | ${issues.filter(i => !i.startsWith('renk')).length ? '⚠' : '✓'}`)
    } else if (autoErr) {
        console.log(`  MOTOR (oto tahsis)  : HATA — ${autoErr}`)
    }
}
