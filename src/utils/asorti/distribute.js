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

    // Her beden için lot→renk kotası: üretilen adetler renklere MAKSİMUM AKIŞ ile paylaştırılır.
    // (Eski açgözlü dağıtım, çok lotlu bir rengin tek lotlu rengin payını yemesine ve
    //  lot bazında dengeli bir planın renk bazında eksik/fazla görünmesine yol açıyordu.)
    const supply = {}
    sorted.forEach(col => col.blocks.forEach(block => {
        Object.entries(col.ratio).forEach(([size, m]) => {
            if (!supply[size]) supply[size] = {}
            supply[size][block.lot] = (supply[size][block.lot] || 0) + m * block.layers
        })
    }))
    const quota = {}
    Object.entries(supply).forEach(([size, byLot]) => {
        const lotList = Object.keys(byLot)
        const sup = lotList.map(l => byLot[l])
        const colorList = [...new Set(lotList.flatMap(l => colorsByLot[l] || []))]
            .filter(c => (demandOf[c]?.[size] || 0) > 0)
        const dem = colorList.map(c => demandOf[c][size])
        const allowed = lotList.map(l => colorList.map(c => (colorsByLot[l] || []).includes(c)))
        const flow = lotList.map(() => colorList.map(() => 0))
        // Önce tek seçenekli (tek lotlu) renkleri doyur, sonra artırıcı yollarla tamamla
        const augment = (li, seen) => {
            for (let ci = 0; ci < colorList.length; ci++) {
                if (!allowed[li][ci] || seen.has(ci)) continue
                seen.add(ci)
                if (dem[ci] > 0) return [[li, ci]]
                for (let lj = 0; lj < lotList.length; lj++) {
                    if (lj === li || flow[lj][ci] <= 0) continue
                    const path = augment(lj, seen)
                    if (path) return [[li, ci], [lj, ci, true], ...path]
                }
            }
            return null
        }
        const order = colorList.map((_, ci) => ci)
            .sort((x, y) => allowed.filter(r => r[x]).length - allowed.filter(r => r[y]).length)
        lotList.forEach((_, li) => {
            for (const ci of order) {
                if (!allowed[li][ci] || sup[li] <= 0 || dem[ci] <= 0) continue
                const f = Math.min(sup[li], dem[ci])
                flow[li][ci] += f; sup[li] -= f; dem[ci] -= f
            }
        })
        lotList.forEach((_, li) => {
            while (sup[li] > 0) {
                const path = augment(li, new Set())
                if (!path) break
                let f = sup[li]
                const end = path[path.length - 1]
                f = Math.min(f, dem[end[1]])
                path.forEach(([l, c, back]) => { if (back) f = Math.min(f, flow[l][c]) })
                path.forEach(([l, c, back]) => { flow[l][c] += back ? -f : f })
                sup[li] -= f
                dem[end[1]] -= f
            }
        })
        quota[size] = {}
        lotList.forEach((l, li) => {
            quota[size][l] = {}
            colorList.forEach((c, ci) => { if (flow[li][ci] > 0) quota[size][l][c] = flow[li][ci] })
        })
    })

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
                const q = quota[size]?.[block.lot] || {}
                for (const color of colors) {
                    if (pieces <= 0) break
                    const need = q[color] || 0
                    if (need <= 0) continue
                    const give = Math.min(need, pieces)
                    q[color] -= give
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
