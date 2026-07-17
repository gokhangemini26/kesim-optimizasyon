import { piecesPerLayerOf } from './common.js'

export const buildPlans = ({ columns, orderRows, byColor }) => {
    const sorted = [...columns].sort((a, b) => {
        if (a.cekme !== b.cekme) return a.cekme.localeCompare(b.cekme)
        const ta = a.blocks.reduce((s, x) => s + x.layers, 0)
        const tb = b.blocks.reduce((s, x) => s + x.layers, 0)
        return tb - ta
    })

    const remaining = {}
    const demandOf = {}
    orderRows.forEach(row => {
        const color = String(row.color)
        remaining[color] = {}
        demandOf[color] = {}
        Object.entries(row.quantities || {}).forEach(([size, qty]) => {
            const q = parseInt(qty) || 0
            if (q > 0) {
                remaining[color][size] = q
                demandOf[color][size] = q
            }
        })
    })

    const colorsByLot = {}
    orderRows.forEach(row => {
        const color = String(row.color)
        const lotsOfColor = Array.isArray(byColor[color]) ? byColor[color] : [byColor[color]]
        lotsOfColor.forEach(lot => {
            if (!colorsByLot[lot]) colorsByLot[lot] = []
            colorsByLot[lot].push(color)
        })
    })
    Object.values(colorsByLot).forEach(list =>
        list.sort((a, b) => {
            const ta = Object.values(demandOf[a] || {}).reduce((x, y) => x + y, 0)
            const tb = Object.values(demandOf[b] || {}).reduce((x, y) => x + y, 0)
            return tb - ta
        })
    )

    const plannedByColor = {}
    const plans = []

    sorted.forEach((col, idx) => {
        const totalLayers = col.blocks.reduce((s, b) => s + b.layers, 0)
        const rows = []

        col.blocks.forEach(block => {
            const colors = colorsByLot[block.lot] || []
            const rowByColor = {}

            Object.entries(col.ratio).forEach(([size, m]) => {
                let pieces = m * block.layers
                for (const color of colors) {
                    if (pieces <= 0) break
                    const need = remaining[color]?.[size] || 0
                    if (need <= 0) continue
                    const give = Math.min(need, pieces)
                    remaining[color][size] -= give
                    pieces -= give
                    if (!rowByColor[color]) rowByColor[color] = {}
                    rowByColor[color][size] = (rowByColor[color][size] || 0) + give
                }
                if (pieces > 0) {
                    const target = colors.find(c => (demandOf[c]?.[size] || 0) > 0) || colors[0]
                    if (target) {
                        if (!rowByColor[target]) rowByColor[target] = {}
                        rowByColor[target][size] = (rowByColor[target][size] || 0) + pieces
                    }
                }
            })

            const ppl = piecesPerLayerOf(col.ratio)
            const entries = Object.entries(rowByColor)
            let layersLeft = block.layers
            entries.forEach(([color, quantities], i) => {
                const piecesOfColor = Object.values(quantities).reduce((a, b) => a + b, 0)
                let layerShare = i === entries.length - 1
                    ? layersLeft
                    : Math.min(layersLeft, Math.round(piecesOfColor / ppl))
                layersLeft -= layerShare
                rows.push({ colors: color, layers: layerShare, quantities, lot: block.lot })

                if (!plannedByColor[color]) plannedByColor[color] = {}
                Object.entries(quantities).forEach(([size, q]) => {
                    plannedByColor[color][size] = (plannedByColor[color][size] || 0) + q
                })
            })
        })

        const lots = [...new Set(col.blocks.map(b => b.lot))]
        plans.push({
            id: idx + 1,
            shrinkage: `${col.cekme} | ${lots.join(' + ')}`,
            lot: lots.join(' + '),
            mold: col.cekme,
            totalLayers,
            markerRatio: col.ratio,
            markerLength: col.markerLength.toFixed(2),
            rows,
            blocks: col.blocks.map(b => ({ lot: b.lot, layers: b.layers, tops: b.tops })),
            fabrics: col.fabrics || '',
            note: 'Asorti'
        })
    })

    return { plans, plannedByColor, demandOf }
}

export const buildAsortiMatrix = (plans) => {
    const lotGroups = [...new Set(plans.flatMap(p => p.blocks.map(b => b.lot)))]
    const columns = plans.map(p => ({
        id: p.id,
        cekme: p.mold,
        label: Object.entries(p.markerRatio).map(([s, m]) => `${m}×${s}`).join(' + '),
        totalLayers: p.totalLayers,
        pieces: p.totalLayers * Object.values(p.markerRatio).reduce((a, b) => a + b, 0)
    }))
    const layers = {}
    lotGroups.forEach(lot => {
        layers[lot] = {}
        plans.forEach(p => {
            const block = p.blocks.find(b => b.lot === lot)
            if (block) layers[lot][p.id] = block.layers
        })
    })
    return { lotGroups, columns, layers }
}

export const buildIntegrityMap = (plannedByColor, demandOf, byColor) => {
    const map = {}
    Object.entries(demandOf).forEach(([color, sizes]) => {
        Object.entries(sizes).forEach(([size, demand]) => {
            const planned = plannedByColor[color]?.[size] || 0
            let score = 100
            if (planned < demand) score = Math.max(0, Math.round((planned / demand) * 100) - 10)
            map[`${color}-${size}`] = {
                score,
                allocations: [{ lot: byColor[color], qty: planned }]
            }
        })
    })
    return map
}
