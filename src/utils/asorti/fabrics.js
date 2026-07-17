import { subpoolKey } from './pools.js'
import { markerLengthOf } from './common.js'

export const assignTops = (columns, subpools, cons) => {
    columns.forEach(col => {
        const markerLen = markerLengthOf(col.ratio, cons)
        col.markerLength = markerLen
        col.blocks.forEach(block => {
            const sp = subpools.get(subpoolKey(block.lot, col.cekme))
            let need = block.layers * markerLen
            block.metraj = need
            const used = []
            if (sp) {
                for (const top of sp.tops) {
                    if (need <= 0.001) break
                    if (top.remaining <= 0.001) continue
                    const take = Math.min(top.remaining, need)
                    top.remaining -= take
                    need -= take
                    used.push(top.topNo)
                }
            }
            block.tops = used
        })
        col.fabrics = [...new Set(col.blocks.flatMap(b => b.tops))].join(', ')
    })
    return columns
}
