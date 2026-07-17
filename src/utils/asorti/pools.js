const fmt = (n) => {
    const v = Math.round(Math.abs(parseFloat(n) || 0) * 10)
    return v
}

export const normalizeCekme = (fabric) => {
    if (fabric.cekme && String(fabric.cekme).trim()) {
        return String(fabric.cekme).trim().toUpperCase().replace(/\s+/g, ' ')
    }
    return `E${fmt(fabric.en)} B${fmt(fabric.boy)}`
}

export const subpoolKey = (lot, cekme) => `${lot}|${cekme}`

export const buildPools = (fabricRows) => {
    const subpools = new Map()
    const lots = new Map()
    const cekmeSet = new Set()

    fabricRows.forEach((f) => {
        const metraj = parseFloat(f.metraj) || 0
        if (metraj <= 0) return
        const lot = String(f.lot || 'BELİRSİZ').toUpperCase()
        const cekme = normalizeCekme(f)
        cekmeSet.add(cekme)

        const key = subpoolKey(lot, cekme)
        if (!subpools.has(key)) {
            subpools.set(key, { key, lot, cekme, total: 0, remaining: 0, tops: [] })
        }
        const sp = subpools.get(key)
        sp.total += metraj
        sp.remaining += metraj
        sp.tops.push({ topNo: String(f.topNo ?? ''), metraj, remaining: metraj })

        if (!lots.has(lot)) lots.set(lot, { lot, total: 0, byCekme: {} })
        const l = lots.get(lot)
        l.total += metraj
        l.byCekme[cekme] = (l.byCekme[cekme] || 0) + metraj
    })

    subpools.forEach(sp => sp.tops.sort((a, b) => b.metraj - a.metraj))

    return { subpools, lots, cekmeGroups: [...cekmeSet].sort() }
}
