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

    return { byColor, groups }
}

export const buildGroupDemand = (orderRows, byColor, lots, cons) => {
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
        const capLeft = new Map(assigned.map(lot => [lot, (lots.get(lot)?.total || 0) * 0.98]))
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
