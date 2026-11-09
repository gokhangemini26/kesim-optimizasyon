// Rastgele üretilmiş sipariş/kumaş senaryolarında ESKİ ve YENİ motorun karşılaştırması.
//   node test/simulate.mjs [senaryo sayısı=30] [tohum=1]
// Her iki plan da test/validate.mjs ile motordan bağımsız doğrulanır.
import { runAsortiSearch, runAsortiSearchLegacy } from '../src/utils/asorti/index.js'
import { mulberry32 } from '../src/utils/asorti/common.js'
import { validatePlan } from './validate.mjs'

const N = parseInt(process.argv[2]) || 30
const SEED = parseInt(process.argv[3]) || 1
const LEGACY_ITERS = 600   // eski arayüz varsayılanı

const makeScenario = (rng) => {
    const ri = (a, b) => a + Math.floor(rng() * (b - a + 1))
    const nSizes = ri(7, 12)
    const sizes = Array.from({ length: nSizes }, (_, i) => String(28 + i))
    const mid = (nSizes - 1) / 2 + (rng() - 0.5) * 2
    const spread = 1.6 + rng() * 1.6
    const curve = sizes.map((_, i) => Math.exp(-((i - mid) ** 2) / (2 * spread * spread)))
    const curveSum = curve.reduce((a, b) => a + b, 0)

    const nColors = ri(3, 16)
    const orderRows = []
    for (let c = 0; c < nColors; c++) {
        const total = rng() < 0.3 ? ri(20, 80) : ri(80, 420)
        const quantities = {}
        sizes.forEach((size, i) => {
            const q = Math.round(total * curve[i] / curveSum * (0.7 + 0.6 * rng()))
            if (q > 0) quantities[size] = q
        })
        if (Object.keys(quantities).length) orderRows.push({ color: String(100 + c * 7), quantities })
    }

    const avgConsumption = Math.round((1.2 + rng() * 0.3) * 100) / 100
    const pieces = orderRows.reduce((s, r) => s + Object.values(r.quantities).reduce((a, b) => a + b, 0), 0)
    const need = pieces * avgConsumption

    const nLots = Math.min(ri(1, 8), Math.max(1, orderRows.length))
    const nCekme = ri(1, 3)
    const cekmes = ['E55 B6', 'E55 B45', 'E35 B35'].slice(0, nCekme)
    const slack = 1.05 + rng() * 0.1
    const weights = Array.from({ length: nLots }, () => 0.5 + rng())
    const wSum = weights.reduce((a, b) => a + b, 0)
    const fabricRows = []
    let topNo = 1
    weights.forEach((w, l) => {
        let left = need * slack * w / wSum
        while (left > 1) {
            const metraj = Math.round(Math.min(left, 45 + rng() * 80) * 100) / 100
            fabricRows.push({ topNo: String(topNo++), lot: `LOT${l + 1}`, cekme: cekmes[Math.floor(rng() * nCekme)], metraj })
            left -= metraj
        }
    })

    return {
        orderRows, fabricRows,
        params: { consumptionMode: 'AVG', avgConsumption, sizeConsumptions: {} },
        info: { pieces, nColors: orderRows.length, nSizes, nLots, nCekme }
    }
}

const run = (fn) => {
    const t = performance.now()
    try { return { res: fn(), ms: performance.now() - t } } catch (e) { return { err: e.message, ms: performance.now() - t } }
}

const agg = () => ({ cuts: 0, layers: 0, over: 0, under: 0, ok: 0, hard: 0, fail: 0, ms: 0, n: 0 })
const A = { old: agg(), neu: agg() }
let wins = 0, ties = 0, losses = 0
let ordered = 0

console.log('| # | Adet | Renk×Beden | Lot/Kalıp | ESKİ kesim | YENİ kesim | Fark | ESKİ toplam kat | YENİ toplam kat | ESKİ doğrulama | YENİ doğrulama |')
console.log('|---:|---:|---|---|---:|---:|---:|---:|---:|---|---|')

for (let i = 0; i < N; i++) {
    const sc = makeScenario(mulberry32(SEED * 100003 + i * 7919))
    const input = { orderRows: sc.orderRows, fabricRows: sc.fabricRows, params: sc.params }
    const o = run(() => runAsortiSearchLegacy(input, { iterations: LEGACY_ITERS }))
    const n = run(() => runAsortiSearch(input, {}))

    const tally = (a, r) => {
        a.n++
        a.ms += r.ms
        if (r.err) { a.fail++; return null }
        const v = validatePlan(r.res, sc)
        a.cuts += v.metrics.cuts; a.layers += v.metrics.totalLayers
        a.over += v.metrics.overcut; a.under += v.metrics.undercut
        if (v.hard.length) a.hard++
        if (v.ok) a.ok++
        return v
    }
    const vo = tally(A.old, o)
    const vn = tally(A.neu, n)
    ordered += sc.info.pieces
    const flag = (v, r) => r.err ? `HATA ${r.err}` : (v.hard.length ? `✗ ${v.hard[0]}` : (v.soft.length ? `⚠ ${v.soft.join(', ')}` : '✓'))
    if (vo && vn) {
        // Önce tolerans, sonra kesim sayısı
        const better = (vn.ok && !vo.ok) || (vn.ok === vo.ok && vn.metrics.cuts < vo.metrics.cuts)
        const worse = (!vn.ok && vo.ok) || (vn.ok === vo.ok && vn.metrics.cuts > vo.metrics.cuts)
        if (better) wins++; else if (worse) losses++; else ties++
    }
    console.log(`| ${i + 1} | ${sc.info.pieces} | ${sc.info.nColors}×${sc.info.nSizes} | ${sc.info.nLots}/${sc.info.nCekme} | ${vo ? vo.metrics.cuts : '–'} | ${vn ? vn.metrics.cuts : '–'} | ${vo && vn ? vn.metrics.cuts - vo.metrics.cuts : ''} | ${vo ? vo.metrics.totalLayers : '–'} | ${vn ? vn.metrics.totalLayers : '–'} | ${flag(vo, o)} | ${flag(vn, n)} |`)
}

const line = (label, a) =>
    `| ${label} | ${a.cuts} | ${a.layers} | +${a.over} (%${(a.over / ordered * 100).toFixed(2)}) | −${a.under} (%${(a.under / ordered * 100).toFixed(2)}) | ${a.ok}/${a.n} | ${a.hard} | ${a.fail} | ${(a.ms / a.n / 1000).toFixed(2)} sn |`
console.log(`\n### ÖZET — ${N} rastgele senaryo, toplam ${ordered} adet sipariş`)
console.log('| Motor | Toplam kesim | Toplam kat (serim) | Fazla kesim | Eksik kesim | Tüm kriterleri tutan | Fiziksel ihlal | Çöken | Ort. süre |')
console.log('|---|---:|---:|---|---|---:|---:|---:|---:|')
console.log(line('ESKİ', A.old))
console.log(line('YENİ', A.neu))
console.log(`\nKesim sayısı: %${((1 - A.neu.cuts / A.old.cuts) * 100).toFixed(1)} azalma · Serilen kat: %${((1 - A.neu.layers / A.old.layers) * 100).toFixed(1)} azalma`)
console.log(`YENİ daha iyi: ${wins} · eşit: ${ties} · daha kötü: ${losses}`)
