export const colorNeeds = (orderRows, cons) =>
    orderRows.map(row => ({
        color: String(row.color),
        need: Object.entries(row.quantities || {}).reduce((sum, [size, qty]) => {
            const q = parseInt(qty) || 0
            return sum + q * cons(size)
        }, 0)
    })).filter(c => c.need > 0)

export const allocateColors = (orderRows, lots, cons, { override = null, rng = null } = {}) => {
    const byColor = {}
    const lotCodes = [...lots.keys()]

    if (override) {
        Object.entries(override).forEach(([color, val]) => {
            const arr = Array.isArray(val)
                ? val.map(v => String(v).toUpperCase())
                : String(val).toUpperCase().split('+').map(s => s.trim()).filter(Boolean)
            byColor[String(color)] = arr
        })
    } else {
        const needs = colorNeeds(orderRows, cons).sort((a, b) => b.need - a.need)
        const remaining = new Map(lotCodes.map(code => [code, lots.get(code).total]))

        needs.forEach(({ color, need }) => {
            const fitting = lotCodes
                .filter(code => remaining.get(code) >= need)
                .sort((a, b) => remaining.get(a) - remaining.get(b))

            if (fitting.length > 0) {
                let chosen = fitting[0]
                if (rng && fitting.length > 1 && rng() < 0.35) {
                    chosen = fitting[1 + Math.floor(rng() * (fitting.length - 1))]
                }
                byColor[color] = [chosen]
                remaining.set(chosen, remaining.get(chosen) - need)
            } else {
                // Hiçbir lot tek başına yetmiyor: en büyük kalan lottan başlayarak böl
                const parts = []
                let left = need
                for (const code of [...lotCodes].sort((a, b) => remaining.get(b) - remaining.get(a))) {
                    if (left <= 0) break
                    const take = Math.min(left, remaining.get(code))
                    if (take <= 0.01) continue
                    parts.push(code)
                    remaining.set(code, remaining.get(code) - take)
                    left -= take
                }
                byColor[color] = parts.length ? parts : [lotCodes[0]]
            }
        })
    }

    const groups = {}
    orderRows.forEach(row => {
        const color = String(row.color)
        if (!byColor[color] || byColor[color].length === 0) byColor[color] = [lotCodes[0]]
        byColor[color].forEach(lot => {
            if (!groups[lot]) groups[lot] = []
            if (!groups[lot].includes(color)) groups[lot].push(color)
        })
    })

    // Bölünmüş renkler için lot bazında metraj rezervasyonu:
    // tek-lotlu renkler kapasiteyi önce düşer, bölünmüşler kalanı sırayla alır.
    const needOf = {}
    orderRows.forEach(row => {
        const color = String(row.color)
        needOf[color] = Object.entries(row.quantities || {}).reduce(
            (s, [sz, q]) => s + (parseInt(q) || 0) * cons(sz), 0
        )
    })
    const capLeft = new Map(lotCodes.map(code => [code, lots.get(code)?.total || 0]))
    Object.entries(byColor).forEach(([color, arr]) => {
        if (arr.length === 1) capLeft.set(arr[0], (capLeft.get(arr[0]) || 0) - (needOf[color] || 0))
    })
    const reserved = {}
    Object.entries(byColor)
        .filter(([, arr]) => arr.length > 1)
        .sort((a, b) => (needOf[b[0]] || 0) - (needOf[a[0]] || 0))
        .forEach(([color, arr]) => {
            reserved[color] = {}
            let left = needOf[color] || 0
            arr.forEach((lot, i) => {
                const avail = Math.max(0, capLeft.get(lot) || 0)
                const take = i === arr.length - 1 ? left : Math.min(left, avail)
                reserved[color][lot] = take
                capLeft.set(lot, (capLeft.get(lot) || 0) - take)
                left -= take
            })
        })

    return { byColor, groups, reserved }
}

export const buildGroupDemand = (orderRows, byColor, lots, cons, reserved = {}) => {
    const demand = {}
    const add = (lot, size, q) => {
        if (!demand[lot]) demand[lot] = {}
        demand[lot][size] = (demand[lot][size] || 0) + q
    }

    orderRows.forEach(row => {
        const color = String(row.color)
        const assigned = byColor[color]
        const sizes = Object.entries(row.quantities || {})
            .map(([s, q]) => [s, parseInt(q) || 0])
            .filter(([, q]) => q > 0)
        if (sizes.length === 0) return

        if (assigned.length === 1) {
            sizes.forEach(([size, q]) => add(assigned[0], size, q))
            return
        }

        // Bölünmüş renk: bedenleri BÜTÜN halinde lotlara dağıt (insan planındaki gibi);
        // yalnızca hiçbir lota tam sığmayan beden mecburen bölünür.
        // Kapasite = tahsiste bu renge REZERVE edilen metraj (diğer renklerle çakışmayı önler).
        const capLeft = new Map(assigned.map(lot => [
            lot,
            reserved[color]?.[lot] != null ? reserved[color][lot] : (lots.get(lot)?.total || 0) * 0.98
        ]))
        const bySizeDesc = [...sizes].sort((a, b) => b[1] - a[1])
        bySizeDesc.forEach(([size, q]) => {
            const need = q * cons(size)
            const fitting = assigned
                .filter(lot => capLeft.get(lot) >= need)
                .sort((a, b) => capLeft.get(b) - capLeft.get(a))
            if (fitting.length > 0) {
                const lot = fitting[0]
                add(lot, size, q)
                capLeft.set(lot, capLeft.get(lot) - need)
                return
            }
            let remQ = q
            for (const lot of [...assigned].sort((a, b) => capLeft.get(b) - capLeft.get(a))) {
                if (remQ <= 0) break
                const fitQ = Math.min(remQ, Math.floor(capLeft.get(lot) / cons(size)))
                if (fitQ <= 0) continue
                add(lot, size, fitQ)
                capLeft.set(lot, capLeft.get(lot) - fitQ * cons(size))
                remQ -= fitQ
            }
            if (remQ > 0) add(assigned[0], size, remQ)
        })
    })
    return demand
}

// Renk→lot tahsis adayı üretir (yeni motorun tahsis araması için).
// İnsan planlamacının yaptığı gibi: büyük renkler lotları mümkün olduğunca TEK BAŞINA
// ve en az sayıda lotla kaplar, küçük renkler artan yerlere "en iyi sığan" lotla girer.
// rng verilirse sıra ve seçimler hafifçe rastgelelenir.
export const proposeAllocation = (orderRows, lots, cons, rng = null) => {
    const lotCodes = [...lots.keys()]
    const remaining = new Map(lotCodes.map(code => [code, lots.get(code).total]))
    const touched = new Set()
    const jitter = () => (rng ? 0.85 + 0.3 * rng() : 1)
    const needs = colorNeeds(orderRows, cons)
        .map(n => ({ ...n, key: n.need * jitter() }))
        .sort((a, b) => b.key - a.key)
    const byColor = {}
    const margin = 1.005

    needs.forEach(({ color, need }) => {
        const want = need * margin
        const options = []
        if (lotCodes.length <= 14) {
            const n = lotCodes.length
            for (let mask = 1; mask < (1 << n); mask++) {
                let sum = 0
                let count = 0
                let shared = 0
                for (let i = 0; i < n; i++) {
                    if (!(mask & (1 << i))) continue
                    const rem = remaining.get(lotCodes[i])
                    if (rem <= 0.01) { sum = -Infinity; break }
                    sum += rem
                    count++
                    if (touched.has(lotCodes[i])) shared++
                }
                if (sum < want) continue
                options.push({ mask, count, shared, left: sum - want })
            }
        }
        if (options.length === 0) {
            // Kumaş yetmiyor ya da lot sayısı çok: en büyük kalandan başlayarak böl
            const parts = []
            let left = need
            for (const code of [...lotCodes].sort((a, b) => remaining.get(b) - remaining.get(a))) {
                if (left <= 0) break
                const take = Math.min(left, remaining.get(code))
                if (take <= 0.01) continue
                parts.push(code)
                touched.add(code)
                remaining.set(code, remaining.get(code) - take)
                left -= take
            }
            byColor[color] = parts.length ? parts : [lotCodes[0]]
            return
        }
        options.sort((a, b) => a.count - b.count || a.left - b.left || a.shared - b.shared || a.mask - b.mask)
        const minCount = options[0].count
        const pool = options.filter(o => o.count === minCount).slice(0, 3)
        const pick = rng && pool.length > 1 && rng() < 0.5 ? pool[Math.floor(rng() * pool.length)] : pool[0]
        const chosen = lotCodes.filter((_, i) => pick.mask & (1 << i))
        // Tüketim: önce en küçük lotlar tamamen dolsun, artan en büyükte kalsın
        let left = want
        chosen.sort((a, b) => remaining.get(a) - remaining.get(b)).forEach(code => {
            const take = Math.min(left, remaining.get(code))
            remaining.set(code, remaining.get(code) - take)
            left -= take
            touched.add(code)
        })
        byColor[color] = chosen
    })
    return byColor
}

// Kumaş yetersizliğinden doğan KAÇINILMAZ eksik adet (alt sınır).
// Bölünmüş renkler lotları birbirine bağlar; her bağlı lot kümesi için
// toplam ihtiyaç toplam kumaşla karşılaştırılır.
export const unavoidableShortage = (orderRows, byColor, lots, cons) => {
    const parent = new Map()
    const find = (x) => {
        if (!parent.has(x)) parent.set(x, x)
        while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) }
        return x
    }
    Object.values(byColor).forEach(arr => arr.forEach(lot => parent.set(find(lot), find(arr[0]))))
    const need = new Map()
    const maxCons = new Map()
    orderRows.forEach(row => {
        const arr = byColor[String(row.color)]
        if (!arr || arr.length === 0) return
        const root = find(arr[0])
        Object.entries(row.quantities || {}).forEach(([size, qty]) => {
            const q = parseInt(qty) || 0
            if (q <= 0) return
            need.set(root, (need.get(root) || 0) + q * cons(size))
            maxCons.set(root, Math.max(maxCons.get(root) || 0, cons(size)))
        })
    })
    const have = new Map()
    parent.forEach((_, lot) => {
        const root = find(lot)
        have.set(root, (have.get(root) || 0) + (lots.get(lot)?.total || 0))
    })
    let short = 0
    need.forEach((n, root) => {
        const h = have.get(root) || 0
        if (n > h) short += Math.ceil((n - h) / maxCons.get(root) - 1e-9)
    })
    return short
}
