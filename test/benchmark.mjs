// Gerçek kesim dosyalarında İNSAN planı / ESKİ motor / YENİ motor karşılaştırması.
//   node test/benchmark.mjs            → özet tablolar
//   node test/benchmark.mjs --detay    → yeni motorun kesim kesim planı da yazılır
import { runAsortiSearch, runAsortiSearchLegacy } from '../src/utils/asorti/index.js'
import { validatePlan } from './validate.mjs'
import { CASES } from './fixtures/kesim-dosyalar.js'
import { orderRows as o1, fabricRows as f1, humanAllocation as a1, params as p1 } from './fixtures/ornek-1sa100.js'

const DETAIL = process.argv.includes('--detay')
const LEGACY_ITERS = 800   // eski motorun bu betikteki özgün ayarı

const ALL = [
    {
        name: '1SA100 40687', human: { cuts: 12, planned: 2070, note: '2 kalıp, 3 lot' },
        params: p1, allocation: a1, orderRows: o1, fabricRows: f1
    },
    ...CASES
]

const timed = (fn) => {
    const t = performance.now()
    let res = null, err = null
    try { res = fn() } catch (e) { err = e.message }
    return { res, err, ms: Math.round(performance.now() - t) }
}

const cell = (run, c) => {
    if (run.err) return { text: `HATA: ${run.err}` }
    const v = validatePlan(run.res, c)
    const m = v.metrics
    const flag = v.hard.length ? `✗ ${v.hard[0]}` : (v.soft.length ? `⚠ ${v.soft.join(', ')}` : '✓')
    return { v, m, flag, ms: run.ms }
}

const rows = []
const totals = {}
const addTotal = (key, m, ok) => {
    const t = totals[key] || (totals[key] = { cuts: 0, layers: 0, over: 0, under: 0, ok: 0, n: 0, ms: 0 })
    t.cuts += m.cuts; t.layers += m.totalLayers; t.over += m.overcut; t.under += m.undercut; t.n++
    if (ok) t.ok++
}

for (const c of ALL) {
    const ordered = c.orderRows.reduce((s, r) => s + Object.values(r.quantities).reduce((a, b) => a + (parseInt(b) || 0), 0), 0)
    const input = { orderRows: c.orderRows, fabricRows: c.fabricRows, params: c.params }
    const ep = c.engineParams || {}

    const variants = [
        ['ESKİ · insan tahsisi', () => runAsortiSearchLegacy(input, { iterations: LEGACY_ITERS, engineParams: ep, allocationOverride: c.allocation })],
        ['YENİ · insan tahsisi', () => runAsortiSearch(input, { engineParams: ep, allocationOverride: c.allocation })],
        ['ESKİ · oto tahsis', () => runAsortiSearchLegacy(input, { iterations: LEGACY_ITERS, engineParams: ep })],
        ['YENİ · oto tahsis', () => runAsortiSearch(input, { engineParams: ep })],
        ['YENİ · oto · sıfır eksik', () => runAsortiSearch(input, { engineParams: { ...ep, undercutFreeRatio: 0 } })]
    ]

    console.log(`\n### ${c.name} — sipariş ${ordered} adet, ${c.human.note}`)
    console.log('| Plan | Kesim | Adet (fazla/eksik) | Toplam kat | Adet/kat | En sığ kesim | Çok-lotlu | Süre | Doğrulama |')
    console.log('|---|---:|---|---:|---:|---:|---:|---:|---|')
    console.log(`| İNSAN | ${c.human.cuts} | ${c.human.planned} (+${c.human.planned - ordered}) | – | – | – | – | – | referans |`)

    for (const [label, fn] of variants) {
        const run = timed(fn)
        const r = cell(run, c)
        if (!r.m) { console.log(`| ${label} | ${r.text} |`); continue }
        const m = r.m
        console.log(`| ${label} | ${m.cuts} | ${m.planned} (+${m.overcut}/−${m.undercut}) | ${m.totalLayers} | ${m.piecesPerLayer} | ${m.minLayers} kat | %${m.multiLotPct} | ${(r.ms / 1000).toFixed(1)} sn | ${r.flag} |`)
        addTotal(label, m, r.v.ok)
        totals[label].ms += r.ms
        rows.push({ name: c.name, label, human: c.human.cuts, cuts: m.cuts })
        if (DETAIL && label.startsWith('YENİ')) {
            run.res.plans.forEach(p => {
                const blocks = p.blocks.map(b => `${b.lot}:${b.layers}`).join(' ')
                console.log(`    #${p.id} [${p.mold}] ${Object.entries(p.markerRatio).map(([sz, m2]) => `${m2}×${sz}`).join(' + ')} → ${p.totalLayers} kat (${blocks})`)
            })
            console.log(`    tahsis: ${JSON.stringify(run.res.allocation)}`)
        }
    }
}

const humanTotal = ALL.reduce((s, c) => s + c.human.cuts, 0)
console.log(`\n### TOPLAM (${ALL.length} gerçek dosya)`)
console.log('| Plan | Toplam kesim | İnsana göre | Toplam kat (serim) | Fazla | Eksik | Toleransı tutan dosya | Toplam süre |')
console.log('|---|---:|---:|---:|---:|---:|---:|---:|')
console.log(`| İNSAN | ${humanTotal} | – | – | – | – | – | – |`)
Object.entries(totals).forEach(([label, t]) => {
    const pct = Math.round((t.cuts - humanTotal) / humanTotal * 100)
    console.log(`| ${label} | ${t.cuts} | ${pct > 0 ? '+' : ''}${pct}% | ${t.layers} | +${t.over} | −${t.under} | ${t.ok}/${t.n} | ${(t.ms / 1000).toFixed(1)} sn |`)
})
