import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAsortiEngine, runAsortiSearch, runAsortiSearchLegacy } from '../src/utils/asorti/index.js'
import { validatePlan } from './validate.mjs'
import { CASES } from './fixtures/kesim-dosyalar.js'
import { orderRows, fabricRows, humanAllocation, params, HUMAN_PLAN } from './fixtures/ornek-1sa100.js'

const input = { orderRows, fabricRows, params }

const checkCriteria = (result, { maxCuts, label }) => {
    const { plans, stats, allocation } = result

    assert.ok(stats.cuts <= maxCuts, `${label}: kesim sayısı ${stats.cuts} > ${maxCuts}`)
    assert.ok(
        stats.undercut <= stats.ordered * 0.007,
        `${label}: eksik kesim ${stats.undercut} > %0.7 (${Math.round(stats.ordered * 0.007)})`
    )
    assert.ok(
        stats.overcut <= stats.ordered * 0.02,
        `${label}: fazla kesim ${stats.overcut} > %2 (${Math.round(stats.ordered * 0.02)})`
    )

    orderRows.forEach(row => {
        const color = String(row.color)
        const allowed = new Set(String(allocation[color]).split('+'))
        const lotsUsed = new Set()
        plans.forEach(plan => {
            plan.rows.forEach(r => {
                if (r.colors === color) lotsUsed.add(r.lot)
            })
        })
        assert.ok(
            [...lotsUsed].every(l => allowed.has(l)),
            `${label}: renk ${color} tahsis dışı lottan kesildi: ${[...lotsUsed]} (izinli: ${[...allowed]})`
        )
    })

    plans.forEach(plan => {
        assert.ok(plan.totalLayers <= 80, `${label}: kesim ${plan.id} kat ${plan.totalLayers} > 80`)
        const pieces = Object.values(plan.markerRatio).reduce((a, b) => a + b, 0)
        assert.ok(pieces <= 6, `${label}: kesim ${plan.id} marker ${pieces} parça > 6`)
        const cekmeSet = new Set(plan.mold.split('+').map(s => s.trim()))
        assert.equal(cekmeSet.size, 1, `${label}: kesim ${plan.id} çekme karışmış`)
    })

    const fabricBudget = {}
    fabricRows.forEach(f => {
        const key = `${f.lot}|${f.cekme}`
        fabricBudget[key] = (fabricBudget[key] || 0) + f.metraj
    })
    const fabricUsed = {}
    plans.forEach(plan => {
        plan.blocks.forEach(b => {
            const key = `${b.lot}|${plan.mold}`
            fabricUsed[key] = (fabricUsed[key] || 0) + b.layers * parseFloat(plan.markerLength)
        })
    })
    Object.entries(fabricUsed).forEach(([key, used]) => {
        assert.ok(
            used <= (fabricBudget[key] || 0) + 0.01,
            `${label}: ${key} havuzunda metraj aşımı (${used.toFixed(1)} / ${(fabricBudget[key] || 0).toFixed(1)})`
        )
    })
}

test('golden: insan tahsisi ile (TEMİZ/LOT1/LOT2) insan planı seviyesi', () => {
    const result = runAsortiSearch(input, { allocationOverride: humanAllocation })
    console.log(`  [override] kesim: ${result.stats.cuts} (insan: ${HUMAN_PLAN.cuts}), planlanan: ${result.stats.planned}/${result.stats.ordered}, fazla: ${result.stats.overcut}, eksik: ${result.stats.undercut}, ort.kat: ${result.stats.avgLayers}, skor: ${result.stats.score}`)
    result.plans.forEach(p => {
        const blocks = p.blocks.map(b => `${b.lot}:${b.layers}`).join(' ')
        console.log(`    Kesim ${p.id} [${p.mold}] ${Object.entries(p.markerRatio).map(([s, m]) => `${m}×${s}`).join(' + ')} → ${p.totalLayers} kat (${blocks})`)
    })
    checkCriteria(result, { maxCuts: HUMAN_PLAN.cuts - 1, label: 'override' })
})

test('golden: otomatik tahsis ile de kriterler sağlanır', () => {
    const result = runAsortiSearch(input, {})
    console.log(`  [auto] kesim: ${result.stats.cuts}, tahsis: ${JSON.stringify(result.allocation)}`)
    console.log(`  [auto] planlanan: ${result.stats.planned}/${result.stats.ordered}, fazla: ${result.stats.overcut}, eksik: ${result.stats.undercut}`)
    checkCriteria(result, { maxCuts: HUMAN_PLAN.cuts - 1, label: 'auto' })
})

test('determinizm: aynı seed aynı plan', () => {
    const a = runAsortiSearch(input, { iterations: 200, seed: 42, allocationOverride: humanAllocation })
    const b = runAsortiSearch(input, { iterations: 200, seed: 42, allocationOverride: humanAllocation })
    assert.deepEqual(a.plans, b.plans)
    assert.equal(a.stats.score, b.stats.score)
})

test('tek geçiş (deterministik çekirdek) çalışır', () => {
    const result = runAsortiEngine(input, { allocationOverride: humanAllocation })
    assert.ok(result.plans.length > 0)
    assert.ok(result.stats.cuts < 25)
})

// Tüm gerçek dosyalar: yeni motor insan planından AZ kesimle, tüm kriterleri
// (bağımsız doğrulayıcıya göre) sağlayarak plan üretmeli.
const REAL = [
    { name: '1SA100 40687', human: HUMAN_PLAN, params, allocation: humanAllocation, orderRows, fabricRows },
    ...CASES
]
for (const c of REAL) {
    test(`gerçek dosya ${c.name}: oto tahsis insan planından az kesim, kriterler tamam`, () => {
        const result = runAsortiSearch(
            { orderRows: c.orderRows, fabricRows: c.fabricRows, params: c.params },
            { engineParams: c.engineParams || {} }
        )
        const v = validatePlan(result, c)
        console.log(`  ${c.name}: ${v.metrics.cuts} kesim (insan ${c.human.cuts}), +${v.metrics.overcut}/−${v.metrics.undercut}`)
        assert.deepEqual(v.hard, [], 'fiziksel ihlal')
        assert.deepEqual(v.soft, [], 'tolerans aşımı')
        assert.ok(v.metrics.cuts < c.human.cuts, `kesim ${v.metrics.cuts} ≥ insan ${c.human.cuts}`)
    })
}

test('yeni motor hiçbir zaman eski motordan kötü değil (aynı girdi)', () => {
    for (const c of REAL) {
        const inp = { orderRows: c.orderRows, fabricRows: c.fabricRows, params: c.params }
        const opts = { engineParams: c.engineParams || {}, allocationOverride: c.allocation, seed: 7 }
        const oldRes = runAsortiSearchLegacy(inp, { ...opts, iterations: 120 })
        const newRes = runAsortiSearch(inp, { ...opts, iterations: 300 })
        assert.ok(
            newRes.stats.withinTolerance >= oldRes.stats.withinTolerance,
            `${c.name}: tolerans geriledi`
        )
        if (newRes.stats.withinTolerance === oldRes.stats.withinTolerance) {
            assert.ok(newRes.stats.score >= oldRes.stats.score, `${c.name}: skor ${newRes.stats.score} < ${oldRes.stats.score}`)
        }
        assert.deepEqual(validatePlan(newRes, c).hard, [], `${c.name}: fiziksel ihlal`)
    }
})

test('sıfır eksik modu: kumaş yeterliyse hiç eksik bırakmaz', () => {
    const result = runAsortiSearch(input, { engineParams: { undercutFreeRatio: 0 } })
    assert.equal(result.stats.undercut, 0)
    assert.ok(result.stats.cuts <= HUMAN_PLAN.cuts)
    assert.deepEqual(validatePlan(result, { orderRows, fabricRows, params }).hard, [])
})
