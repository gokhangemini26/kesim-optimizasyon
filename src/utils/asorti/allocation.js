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
        Object.entries(override).forEach(([color, lot]) => {
            byColor[String(color)] = String(lot).toUpperCase()
        })
    } else {
        const needs = colorNeeds(orderRows, cons).sort((a, b) => b.need - a.need)
        const remaining = new Map(lotCodes.map(code => [code, lots.get(code).total]))

        needs.forEach(({ color, need }) => {
            const fitting = lotCodes
                .filter(code => remaining.get(code) >= need)
                .sort((a, b) => remaining.get(a) - remaining.get(b))

            let chosen
            if (fitting.length === 0) {
                chosen = lotCodes.sort((a, b) => remaining.get(b) - remaining.get(a))[0]
            } else if (rng && fitting.length > 1 && rng() < 0.35) {
                chosen = fitting[1 + Math.floor(rng() * (fitting.length - 1))]
            } else {
                chosen = fitting[0]
            }
            byColor[color] = chosen
            remaining.set(chosen, remaining.get(chosen) - need)
        })
    }

    const groups = {}
    orderRows.forEach(row => {
        const color = String(row.color)
        const lot = byColor[color] || lotCodes[0]
        byColor[color] = lot
        if (!groups[lot]) groups[lot] = []
        groups[lot].push(color)
    })

    return { byColor, groups }
}

export const buildGroupDemand = (orderRows, byColor) => {
    const demand = {}
    orderRows.forEach(row => {
        const lot = byColor[String(row.color)]
        Object.entries(row.quantities || {}).forEach(([size, qty]) => {
            const q = parseInt(qty) || 0
            if (q <= 0) return
            if (!demand[lot]) demand[lot] = {}
            demand[lot][size] = (demand[lot][size] || 0) + q
        })
    })
    return demand
}
