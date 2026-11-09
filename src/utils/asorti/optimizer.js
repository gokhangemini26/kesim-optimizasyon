// Kesim planı için global optimizasyon çekirdeği (LNS — Large Neighbourhood Search).
//
// Eski motor her bedeni önce tek başına bir kolona koyup sonra "kat sayıları neredeyse
// aynıysa" ikişer ikişer birleştiriyordu. Bu çekirdek problemi doğrudan modeller:
//
//   kesim k  = (çekme c_k, pastal oranı r_k[beden], lot bazında kat L_k[lot])
//   üretim   P[lot][beden] = Σ_k L_k[lot] · r_k[beden]
//   amaç     en az kesimle P ≈ D (eksik ≤ %0.7, fazla ≤ %2), kumaş havuzları aşılmadan
//
// Arama üç parçadan oluşur:
//   bestCut  : kalan talebe göre "en çok işi bitiren" tek kesimi bulur (tüm oran
//              desenleri × çekmeler taranır, her lot için en iyi kat hesaplanır)
//   polish   : kat ±1, oran ±1, kesimler arası kat aktarımı ile ince ayar
//   LNS      : 1–4 kesimi söküp bir eksiğiyle yeniden kurmayı dener; tutarsa kesim azalır
import { subpoolKey } from './pools.js'

const W_CUT = 1000
const W_HARD = 1001
const W_UNDER = 8
const W_OVER = 5
const W_BLOCK = 1
const EPS = 1e-6

const sizeSort = (a, b) => {
    const na = parseFloat(a)
    const nb = parseFloat(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
    return String(a).localeCompare(String(b))
}

const compositions = (parts, maxSum) => {
    const out = []
    const rec = (prefix, left) => {
        if (prefix.length === parts) { out.push(prefix.slice()); return }
        const remainingParts = parts - prefix.length - 1
        for (let v = 1; v <= left - remainingParts; v++) {
            prefix.push(v)
            rec(prefix, left - v)
            prefix.pop()
        }
    }
    rec([], maxSum)
    return out
}

export const makeProblem = ({ demand, subpools, cekmeGroups, cons, params: P, unavoidable = 0 }) => {
    const lots = Object.keys(demand).filter(l => Object.values(demand[l]).some(q => q > 0))
    const sizes = [...new Set(lots.flatMap(l => Object.keys(demand[l])))].sort(sizeSort)
    const NL = lots.length
    const NS = sizes.length
    const NC = cekmeGroups.length
    const D = new Int32Array(NL * NS)
    let ordered = 0
    lots.forEach((lot, l) => sizes.forEach((size, s) => {
        const q = demand[lot][size] || 0
        D[l * NS + s] = q
        ordered += q
    }))
    const cap = new Float64Array(NL * NC)
    lots.forEach((lot, l) => cekmeGroups.forEach((cekme, c) => {
        const sp = subpools.get(subpoolKey(lot, cekme))
        cap[l * NC + c] = sp ? sp.total : 0
    }))
    const maxSizes = Math.max(1, Math.min(P.maxSizesPerMarker, P.maxPiecesPerMarker))
    const comps = [null]
    for (let j = 1; j <= maxSizes; j++) comps.push(compositions(j, P.maxPiecesPerMarker))

    return {
        lots, sizes, cekmes: cekmeGroups, NL, NS, NC, D, cap, ordered,
        consArr: sizes.map(s => cons(s)),
        maxLayers: P.maxLayers,
        maxPieces: P.maxPiecesPerMarker,
        maxSizes,
        comps,
        unavoidable,
        uFree: Math.floor(ordered * P.undercutFreeRatio + 1e-9),
        // Kumaşı talebine yetmeyen lotlardaki kaçınılmaz eksik yalnızca arama maliyetinde
        // affedilir; aksi halde arama imkânsız birkaç adet için boşuna kesim açar.
        uSlack: Math.floor(ordered * P.undercutFreeRatio + 1e-9) + unavoidable,
        oFree: Math.floor(ordered * P.overcutFreeRatio + 1e-9)
    }
}

const newSol = (pb) => ({
    cuts: [],
    Pm: new Int32Array(pb.NL * pb.NS),
    used: new Float64Array(pb.NL * pb.NC),
    under: pb.ordered,
    over: 0,
    blocks: 0
})

const cloneSol = (sol) => ({
    cuts: sol.cuts.map(c => ({ c: c.c, sz: c.sz.slice(), m: c.m.slice(), L: c.L.slice(), len: c.len, ppl: c.ppl, tot: c.tot })),
    Pm: sol.Pm.slice(),
    used: sol.used.slice(),
    under: sol.under,
    over: sol.over,
    blocks: sol.blocks
})

const bump = (pb, sol, l, s, delta) => {
    const idx = l * pb.NS + s
    const d = pb.D[idx]
    const oldV = sol.Pm[idx]
    const newV = oldV + delta
    sol.Pm[idx] = newV
    sol.under += (d > newV ? d - newV : 0) - (d > oldV ? d - oldV : 0)
    sol.over += (newV > d ? newV - d : 0) - (oldV > d ? oldV - d : 0)
}

const applyCut = (pb, sol, cut, sign) => {
    for (let l = 0; l < pb.NL; l++) {
        const L = cut.L[l]
        if (!L) continue
        for (let i = 0; i < cut.sz.length; i++) bump(pb, sol, l, cut.sz[i], sign * L * cut.m[i])
        sol.used[l * pb.NC + cut.c] += sign * L * cut.len
        sol.blocks += sign
    }
}

const addCut = (pb, sol, cut) => { sol.cuts.push(cut); applyCut(pb, sol, cut, 1) }
const removeCutAt = (pb, sol, k) => { applyCut(pb, sol, sol.cuts[k], -1); sol.cuts.splice(k, 1) }

export const costOf = (pb, sol) =>
    sol.cuts.length * W_CUT
    + W_HARD * (Math.max(0, sol.under - pb.uSlack) + Math.max(0, sol.over - pb.oFree))
    + W_UNDER * sol.under
    + W_OVER * sol.over
    + W_BLOCK * sol.blocks

export const isFeasible = (pb, sol) => sol.under <= pb.uFree && sol.over <= pb.oFree

const subsetsOf = (arr, j) => {
    const out = []
    const rec = (start, pick) => {
        if (pick.length === j) { out.push(pick.slice()); return }
        for (let i = start; i <= arr.length - (j - pick.length); i++) {
            pick.push(arr[i])
            rec(i + 1, pick)
            pick.pop()
        }
    }
    rec(0, [])
    return out
}

// Kalan talebe (Rp) göre en değerli tek kesimi bulur.
// değer = karşılanan adet − beta · fazla adet
const bestCut = (pb, sol, { beta = 1, noise = 0, rng = null } = {}) => {
    const { NL, NS, NC, D, cap, maxLayers, consArr } = pb
    const Rp = new Int32Array(NL * NS)
    const tot = new Int32Array(NS)
    for (let l = 0; l < NL; l++) {
        for (let s = 0; s < NS; s++) {
            const r = D[l * NS + s] - sol.Pm[l * NS + s]
            if (r > 0) { Rp[l * NS + s] = r; tot[s] += r }
        }
    }
    const act = []
    for (let s = 0; s < NS; s++) if (tot[s] > 0) act.push(s)
    if (act.length === 0) return null
    act.sort((a, b) => tot[b] - tot[a])

    const rem = new Float64Array(NL * NC)
    for (let i = 0; i < rem.length; i++) rem[i] = cap[i] - sol.used[i]

    const candL = new Int32Array(NL * 8)
    const candG = new Float64Array(NL * 8)
    const candN = new Int32Array(NL)
    const Lc = new Int32Array(NL)
    const Gc = new Float64Array(NL)
    const order = new Array(NL)

    let best = null
    let bestVal = 0
    const noiseMul = 1 + noise

    for (let j = 1; j <= Math.min(pb.maxSizes, act.length); j++) {
        const subsets = subsetsOf(act, j)
        const comps = pb.comps[j]
        for (const sz of subsets) {
            for (const m of comps) {
                let ub = 0
                let len = 0
                for (let i = 0; i < j; i++) {
                    ub += Math.min(m[i] * maxLayers, tot[sz[i]])
                    len += m[i] * consArr[sz[i]]
                }
                if (ub * noiseMul <= bestVal) continue

                const gain = (l, L) => {
                    let g = 0
                    for (let i = 0; i < j; i++) {
                        const q = L * m[i]
                        const r = Rp[l * NS + sz[i]]
                        g += q <= r ? q : r - beta * (q - r)
                    }
                    return g
                }

                // Lot başına aday katlar: her bedenin "tam bitirme" kırılım noktaları
                for (let l = 0; l < NL; l++) {
                    let n = 0
                    for (let i = 0; i < j; i++) {
                        const r = Rp[l * NS + sz[i]]
                        if (r <= 0) continue
                        const f = Math.floor(r / m[i])
                        if (f > 0) candL[l * 8 + n++] = f
                        if (r % m[i]) candL[l * 8 + n++] = f + 1
                    }
                    for (let x = 0; x < n; x++) candG[l * 8 + x] = gain(l, candL[l * 8 + x])
                    candN[l] = n
                }

                for (let c = 0; c < NC; c++) {
                    let sum = 0
                    let val = 0
                    let slack = 0
                    for (let l = 0; l < NL; l++) {
                        Lc[l] = 0
                        Gc[l] = 0
                        const n = candN[l]
                        if (n === 0) continue
                        const capL = Math.min(maxLayers, Math.floor(rem[l * NC + c] / len + EPS))
                        if (capL <= 0) continue
                        let bl = 0
                        let bg = 0
                        let clipped = false
                        for (let x = 0; x < n; x++) {
                            const L = candL[l * 8 + x]
                            if (L > capL) { clipped = true; continue }
                            const g = candG[l * 8 + x]
                            if (g > bg || (g === bg && L > bl)) { bg = g; bl = L }
                        }
                        if (clipped) {
                            const g = gain(l, capL)
                            if (g > bg) { bg = g; bl = capL }
                        }
                        if (bl > 0 && bg > 0) {
                            Lc[l] = bl
                            Gc[l] = bg
                            sum += bl
                            val += bg
                            slack += rem[l * NC + c]
                        }
                    }
                    if (sum === 0) continue

                    if (sum > maxLayers) {
                        // Kat bütçesi: verimi (adet/kat) en yüksek lotları tam al, sonuncuyu kırp
                        let n = 0
                        for (let l = 0; l < NL; l++) if (Lc[l] > 0) order[n++] = l
                        const ord = order.slice(0, n).sort((a, b) =>
                            (Gc[b] / Lc[b]) - (Gc[a] / Lc[a]) || Gc[b] - Gc[a] || a - b)
                        let budget = maxLayers
                        val = 0
                        for (const l of ord) {
                            if (budget <= 0) { Lc[l] = 0; Gc[l] = 0; continue }
                            if (Lc[l] > budget) {
                                const g = gain(l, budget)
                                if (g > 0) { Lc[l] = budget; Gc[l] = g } else { Lc[l] = 0; Gc[l] = 0 }
                            }
                            budget -= Lc[l]
                            val += Gc[l]
                        }
                    }

                    let v = val + 1e-7 * slack
                    if (noise > 0 && rng) v *= 1 + noise * rng()
                    if (v > bestVal) {
                        bestVal = v
                        best = { c, sz: sz.slice(), m: m.slice(), L: Array.from(Lc), len }
                    }
                }
            }
        }
    }

    if (!best) return null
    best.ppl = best.m.reduce((a, b) => a + b, 0)
    best.tot = best.L.reduce((a, b) => a + b, 0)
    return best.tot > 0 ? best : null
}

const fabricOk = (pb, sol, l, c) => sol.used[l * pb.NC + c] <= pb.cap[l * pb.NC + c] + 1e-4

// Tek lot bloğunun katını değiştirmeyi dener; maliyet düşerse kalıcı yapar.
const tryLayerMove = (pb, sol, cut, l, delta, baseCost) => {
    const L = cut.L[l]
    const nl = L + delta
    if (nl < 0 || cut.tot + delta > pb.maxLayers) return null
    const ui = l * pb.NC + cut.c
    if (delta > 0 && sol.used[ui] + delta * cut.len > pb.cap[ui] + 1e-4) return null
    for (let i = 0; i < cut.sz.length; i++) bump(pb, sol, l, cut.sz[i], delta * cut.m[i])
    sol.used[ui] += delta * cut.len
    if (L === 0) sol.blocks++
    if (nl === 0) sol.blocks--
    cut.L[l] = nl
    cut.tot += delta
    const c = costOf(pb, sol)
    if (c < baseCost - EPS) return c
    // geri al
    for (let i = 0; i < cut.sz.length; i++) bump(pb, sol, l, cut.sz[i], -delta * cut.m[i])
    sol.used[ui] -= delta * cut.len
    if (L === 0) sol.blocks--
    if (nl === 0) sol.blocks++
    cut.L[l] = L
    cut.tot -= delta
    return null
}

// Aynı lotun katını bir kesimden diğerine taşır (çekme havuzu / 80 kat sınırı dengesi).
const tryTransfer = (pb, sol, a, b, l, baseCost) => {
    if (a.L[l] <= 0 || b.tot + 1 > pb.maxLayers) return null
    const ub = l * pb.NC + b.c
    const ua = l * pb.NC + a.c
    const sameC = a.c === b.c
    const needB = b.len - (sameC ? a.len : 0)
    if (sol.used[ub] + needB > pb.cap[ub] + 1e-4) return null
    const apply = (sign) => {
        for (let i = 0; i < a.sz.length; i++) bump(pb, sol, l, a.sz[i], -sign * a.m[i])
        for (let i = 0; i < b.sz.length; i++) bump(pb, sol, l, b.sz[i], sign * b.m[i])
        sol.used[ua] -= sign * a.len
        sol.used[ub] += sign * b.len
    }
    const la = a.L[l]
    const lb = b.L[l]
    apply(1)
    a.L[l] = la - 1; a.tot -= 1
    b.L[l] = lb + 1; b.tot += 1
    if (la === 1) sol.blocks--
    if (lb === 0) sol.blocks++
    const c = costOf(pb, sol)
    if (c < baseCost - EPS) return c
    apply(-1)
    a.L[l] = la; a.tot += 1
    b.L[l] = lb; b.tot -= 1
    if (la === 1) sol.blocks++
    if (lb === 0) sol.blocks--
    return null
}

// Pastal oranında tek adım: bir bedeni ±1, ya da yeni beden ekle.
const tryRatioMove = (pb, sol, cut, s, delta, baseCost) => {
    const pos = cut.sz.indexOf(s)
    const cur = pos >= 0 ? cut.m[pos] : 0
    const nm = cur + delta
    if (nm < 0) return null
    if (cut.ppl + delta > pb.maxPieces || cut.ppl + delta < 1) return null
    if (pos < 0 && cut.sz.length >= pb.maxSizes) return null
    const dLen = delta * pb.consArr[s]
    const apply = (sign) => {
        for (let l = 0; l < pb.NL; l++) {
            const L = cut.L[l]
            if (!L) continue
            bump(pb, sol, l, s, sign * delta * L)
            sol.used[l * pb.NC + cut.c] += sign * L * dLen
        }
    }
    apply(1)
    let ok = true
    if (delta > 0) {
        for (let l = 0; l < pb.NL && ok; l++) if (cut.L[l] && !fabricOk(pb, sol, l, cut.c)) ok = false
    }
    const c = ok ? costOf(pb, sol) : Infinity
    if (c < baseCost - EPS) {
        if (pos < 0) { cut.sz.push(s); cut.m.push(nm) }
        else if (nm === 0) { cut.sz.splice(pos, 1); cut.m.splice(pos, 1) }
        else cut.m[pos] = nm
        cut.ppl += delta
        cut.len += dLen
        return c
    }
    apply(-1)
    return null
}

const polish = (pb, sol, { transfers = true } = {}) => {
    let cost = costOf(pb, sol)
    for (let pass = 0; pass < 40; pass++) {
        let improved = false

        for (const cut of sol.cuts) {
            for (let l = 0; l < pb.NL; l++) {
                for (const d of [1, -1]) {
                    for (;;) {
                        const c = tryLayerMove(pb, sol, cut, l, d, cost)
                        if (c == null) break
                        cost = c
                        improved = true
                    }
                }
            }
        }

        for (const cut of sol.cuts) {
            for (let s = 0; s < pb.NS; s++) {
                for (const d of [1, -1]) {
                    const c = tryRatioMove(pb, sol, cut, s, d, cost)
                    if (c != null) { cost = c; improved = true }
                }
            }
        }

        if (transfers && !improved) {
            for (const a of sol.cuts) {
                for (const b of sol.cuts) {
                    if (a === b) continue
                    for (let l = 0; l < pb.NL; l++) {
                        const c = tryTransfer(pb, sol, a, b, l, cost)
                        if (c != null) { cost = c; improved = true }
                    }
                }
            }
        }

        // Boşalan kesimleri at
        for (let k = sol.cuts.length - 1; k >= 0; k--) {
            const cut = sol.cuts[k]
            if (cut.tot === 0 || cut.ppl === 0) { removeCutAt(pb, sol, k); improved = true }
        }
        cost = costOf(pb, sol)
        if (!improved) break
    }
    return cost
}

const fillGreedy = (pb, sol, maxNew, opts) => {
    let added = 0
    while (added < maxNew && sol.under > 0) {
        const cut = bestCut(pb, sol, opts)
        if (!cut) break
        addCut(pb, sol, cut)
        added++
    }
    return added
}

const construct = (pb, opts) => {
    const sol = newSol(pb)
    for (let guard = 0; guard < 400 && sol.under > pb.uSlack; guard++) {
        const cut = bestCut(pb, sol, opts)
        if (!cut) break
        addCut(pb, sol, cut)
    }
    polish(pb, sol)
    return sol
}

export const solFromColumns = (pb, columns) => {
    const sol = newSol(pb)
    const lotIdx = new Map(pb.lots.map((x, i) => [x, i]))
    const sizeIdx = new Map(pb.sizes.map((x, i) => [x, i]))
    const cIdx = new Map(pb.cekmes.map((x, i) => [x, i]))
    for (const col of columns) {
        const c = cIdx.get(col.cekme)
        if (c == null) return null
        const sz = []
        const m = []
        for (const [size, mult] of Object.entries(col.ratio)) {
            const s = sizeIdx.get(size)
            if (s == null) return null
            sz.push(s)
            m.push(mult)
        }
        const L = new Array(pb.NL).fill(0)
        for (const b of col.blocks) {
            const l = lotIdx.get(b.lot)
            if (l == null) return null
            L[l] += b.layers
        }
        const cut = {
            c, sz, m, L,
            len: m.reduce((a, mult, i) => a + mult * pb.consArr[sz[i]], 0),
            ppl: m.reduce((a, b) => a + b, 0),
            tot: L.reduce((a, b) => a + b, 0)
        }
        if (cut.tot > 0) addCut(pb, sol, cut)
    }
    return sol
}

export const columnsFromSol = (pb, sol) =>
    sol.cuts
        .filter(cut => cut.tot > 0 && cut.ppl > 0)
        .map(cut => ({
            cekme: pb.cekmes[cut.c],
            ratio: Object.fromEntries(cut.sz.map((s, i) => [pb.sizes[s], cut.m[i]])),
            blocks: cut.L.map((layers, l) => ({ lot: pb.lots[l], layers })).filter(b => b.layers > 0)
        }))

const pickDestroy = (sol, q, rng) => {
    const K = sol.cuts.length
    const chosen = new Set()
    // İlk kurban: küçük kesimler daha olası (silinmeye en yakın adaylar)
    if (rng() < 0.6) {
        const w = sol.cuts.map(c => 1 / (1 + c.tot * c.ppl))
        const sum = w.reduce((a, b) => a + b, 0)
        let x = rng() * sum
        let k = 0
        for (; k < K - 1; k++) { x -= w[k]; if (x <= 0) break }
        chosen.add(k)
    } else {
        chosen.add(Math.floor(rng() * K))
    }
    const first = sol.cuts[[...chosen][0]]
    let guard = 0
    while (chosen.size < q && guard++ < 200) {
        const k = Math.floor(rng() * K)
        if (chosen.has(k)) continue
        // Ortak bedeni olan kesimleri tercih et: aynı işi yeniden paylaştırmak daha olası
        const related = sol.cuts[k].sz.some(s => first.sz.includes(s))
        if (related || rng() < 0.45) chosen.add(k)
    }
    return [...chosen].sort((a, b) => b - a)
}

const better = (pb, a, costA, b, costB) => {
    const fa = isFeasible(pb, a)
    const fb = isFeasible(pb, b)
    if (fa !== fb) return fa
    return costA < costB - EPS
}

export const optimizeCuts = (pb, { seeds = [], iterations = 300, rng, onProgress = null } = {}) => {
    if (pb.NL === 0 || pb.NS === 0) return { sol: newSol(pb), cost: 0 }

    const starts = []
    for (const cols of seeds) {
        const s = solFromColumns(pb, cols)
        if (s) { polish(pb, s); starts.push(s) }
    }
    starts.push(construct(pb, { beta: 1 }))
    starts.push(construct(pb, { beta: 2 }))

    let best = null
    let bestCost = Infinity
    const consider = (sol, cost) => {
        if (!best || better(pb, sol, cost, best, bestCost)) { best = cloneSol(sol); bestCost = cost }
    }
    starts.forEach(s => consider(s, costOf(pb, s)))

    // En iyi iki başlangıçtan ayrı ayrı yürü
    const ranked = starts
        .map(s => ({ s, c: costOf(pb, s) }))
        .sort((a, b) => a.c - b.c)
        .slice(0, 2)
    const perStart = Math.max(1, Math.floor(iterations / ranked.length))
    let done = 0

    for (const { s } of ranked) {
        let cur = cloneSol(s)
        let curCost = costOf(pb, cur)
        let stale = 0

        for (let it = 0; it < perStart; it++, done++) {
            if (onProgress && done % 25 === 0) onProgress(done, iterations)
            const K = cur.cuts.length
            if (K === 0) break
            const trial = cloneSol(cur)
            const q = Math.min(K, 1 + Math.floor(rng() * (stale > 60 ? 5 : 4)))
            for (const k of pickDestroy(trial, q, rng)) removeCutAt(pb, trial, k)

            const opts = { beta: 0.5 + 2 * rng(), noise: rng() < 0.5 ? 0 : 0.25 * rng(), rng }
            const target = q >= 2 && rng() < 0.75 ? q - 1 : q
            let added = fillGreedy(pb, trial, target, opts)
            let cost = polish(pb, trial)
            // Mevcut çözüm tolerans dışındaysa bir fazla kesimle onarmaya izin ver
            const limit = cur.under <= pb.uSlack && cur.over <= pb.oFree ? q : q + 1
            while (added < limit && !(cost < curCost - EPS)) {
                if (fillGreedy(pb, trial, 1, opts) === 0) break
                added++
                cost = polish(pb, trial)
            }

            if (cost < curCost - EPS || (cost <= curCost + EPS && rng() < 0.5)) {
                if (cost < curCost - EPS) stale = 0
                else stale++
                cur = trial
                curCost = cost
                consider(cur, curCost)
            } else {
                stale++
                // Uzun süre takılınca küçük bir kötüleşmeyi kabul et (yerel minimumdan çıkış)
                if (stale > 40 && cost <= curCost + 30 && rng() < 0.15) {
                    cur = trial
                    curCost = cost
                }
            }
        }
    }

    return { sol: best, cost: bestCost }
}

export const residualOf = (pb, sol) => {
    const out = []
    for (let l = 0; l < pb.NL; l++) {
        for (let s = 0; s < pb.NS; s++) {
            const r = pb.D[l * pb.NS + s] - sol.Pm[l * pb.NS + s]
            if (r > 0) out.push({ lot: pb.lots[l], size: pb.sizes[s], qty: r })
        }
    }
    return out
}
