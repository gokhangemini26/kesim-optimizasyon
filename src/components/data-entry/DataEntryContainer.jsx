import React, { useState } from 'react'
import OrderTable from './OrderTable'
import FabricTable from './FabricTable'
import ConsumptionSettings from './ConsumptionSettings'
import FabricGroupingModal from '../optimization/FabricGroupingModal'

const SIZE_TYPES = {
    TIP1: ['28/32', '29/32', '30/32', '31/32', '32/32', '33/32', '34/32', '36/32', '38/32', '30/34', '31/34', '32/34', '33/34', '34/34', '36/34', '38/34'],
    TIP2: ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    TIP3: ['44', '46', '48', '50', '52', '54', '56', '58', '60'],
    TIP4: ['29', '30', '31', '32', '33', '34', '35', '36', '38', '40', '42']
}

export default function DataEntryContainer({
    customer,
    onPreparePlan,
    orderRows,
    setOrderRows,
    fabricRows,
    setFabricRows,
    consumptionMode,
    setConsumptionMode,
    avgConsumption,
    setAvgConsumption,
    sizeConsumptions,
    setSizeConsumptions,
    sizeType,
    setSizeType,
    groupingResults,
    setGroupingResults,
    isOptimizing
}) {
    const [showGrouping, setShowGrouping] = useState(false)

    const currentSizes = SIZE_TYPES[sizeType]

    const handleGroupFabrics = () => {
        if (fabricRows.length === 0) {
            alert('Lütfen önce kumaş bilgilerini girin!')
            return
        }

        // KALIP = ÇEKME KODU: Her benzersiz çekme değeri kendi kalıp grubudur (E55 B45, E55 B6...)
        const byCekme = {}

        fabricRows.forEach((fabric, idx) => {
            const en = parseFloat(fabric.en) || 0
            const boy = parseFloat(fabric.boy) || 0
            const cekme = `E${Math.round(Math.abs(en) * 10)} B${Math.round(Math.abs(boy) * 10)}`
            const lot = String(fabric.lot || 'BELİRSİZ').toUpperCase()
            const metraj = parseFloat(fabric.metraj) || 0

            if (!byCekme[cekme]) byCekme[cekme] = { cekme, lots: {}, total: 0 }
            if (!byCekme[cekme].lots[lot]) {
                byCekme[cekme].lots[lot] = { lot, fabrics: [], totalMetraj: 0 }
            }
            byCekme[cekme].lots[lot].fabrics.push({ ...fabric, index: idx })
            byCekme[cekme].lots[lot].totalMetraj += metraj
            byCekme[cekme].total += metraj
        })

        const groups = Object.values(byCekme)
            .map(g => ({
                cekme: g.cekme,
                lots: Object.values(g.lots).sort((a, b) => b.totalMetraj - a.totalMetraj),
                total: g.total
            }))
            .sort((a, b) => b.total - a.total)

        const result = {
            groups,
            grandTotal: groups.reduce((s, g) => s + g.total, 0)
        }

        console.log('📊 Çekme Kodu Bazlı Gruplama:', result)

        setGroupingResults(result)
        setShowGrouping(true)
    }

    return (
        <div className="pb-20">
            <div className="mb-8 flex gap-4 items-center">
                <label className="text-sm font-bold text-slate-500 uppercase tracking-wider">Beden Tipi Seçin:</label>
                <select
                    value={sizeType}
                    onChange={(e) => setSizeType(e.target.value)}
                    className="bg-white border border-slate-200 rounded-xl px-4 py-2 font-bold text-slate-700 shadow-sm focus:ring-2 focus:ring-primary-500 outline-none"
                >
                    <option value="TIP1">TIP 1 (28/32 - 38/34)</option>
                    <option value="TIP2">TIP 2 (2XS-4XL)</option>
                    <option value="TIP3">TIP 3 (44-60)</option>
                    <option value="TIP4">TIP 4 (29-42 Jean)</option>
                </select>
            </div>

            <OrderTable
                sizeType={sizeType}
                sizes={currentSizes}
                rows={orderRows}
                onUpdateRows={setOrderRows}
            />

            <FabricTable
                rows={fabricRows}
                onUpdateRows={setFabricRows}
                onGroupFabrics={handleGroupFabrics}
            />

            <ConsumptionSettings
                mode={consumptionMode}
                onModeChange={setConsumptionMode}
                avgConsumption={avgConsumption}
                onAvgChange={setAvgConsumption}
                sizeConsumptions={sizeConsumptions}
                onSizeChange={(size, val) => setSizeConsumptions({ ...sizeConsumptions, [size]: val })}
                sizes={currentSizes}
            />

            <div className="mt-12 flex justify-center">
                <button
                    disabled={isOptimizing}
                    onClick={() => onPreparePlan({ orderRows, fabricRows, groupingResults, consumptionMode, avgConsumption, sizeConsumptions })}
                    className={`bg-primary-600 hover:bg-primary-700 text-white font-black text-xl py-5 px-12 rounded-3xl shadow-2xl shadow-primary-200 transform transition-all ${isOptimizing ? 'opacity-50 cursor-wait' : 'hover:scale-105 active:scale-95'}`}
                >
                    {isOptimizing ? 'HESAPLANIYOR...' : 'KESİM PLANI HAZIRLA'}
                </button>
            </div>

            {showGrouping && (
                <FabricGroupingModal
                    results={groupingResults}
                    onClose={() => setShowGrouping(false)}
                />
            )}
        </div>
    )
}
