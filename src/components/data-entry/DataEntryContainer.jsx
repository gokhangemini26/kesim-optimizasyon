import React, { useState } from 'react'
import OrderTable from './OrderTable'
import FabricTable from './FabricTable'
import ConsumptionSettings from './ConsumptionSettings'
import FabricGroupingModal from '../optimization/FabricGroupingModal'

const SIZE_TYPES = {
    TIP1: ['29', '30', '31', '32', '33', '34', '35', '36', '38', '40', '42'],
    TIP2: ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    TIP3: ['44', '46', '48', '50', '52', '54', '56', '58', '60']
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
    setGroupingResults
}) {
    const [showGrouping, setShowGrouping] = useState(false)

    const currentSizes = SIZE_TYPES[sizeType]

    const handleGroupFabrics = () => {
        const enT = customer.enTolerance
        const boyT = customer.boyTolerance

        const kalip1 = {}
        const kalip2 = {}

        fabricRows.forEach(fabric => {
            const e = Math.abs(parseFloat(fabric.en) || 0)
            const b = Math.abs(parseFloat(fabric.boy) || 0)
            const lot = fabric.lot || 'BELİRSİZ'

            // Classification Logic: Within tolerance -> Kalıp-1, else Kalıp-2
            const isKalip1 = e <= enT && b <= boyT
            const target = isKalip1 ? kalip1 : kalip2

            if (!target[lot]) {
                target[lot] = {
                    lot: lot,
                    fabrics: [],
                    totalMetraj: 0
                }
            }
            target[lot].fabrics.push(fabric)
            target[lot].totalMetraj += parseFloat(fabric.metraj) || 0
        })

        const result = {
            kalip1: Object.values(kalip1),
            kalip2: Object.values(kalip2),
            kalip1Total: Object.values(kalip1).reduce((acc, curr) => acc + curr.totalMetraj, 0),
            kalip2Total: Object.values(kalip2).reduce((acc, curr) => acc + curr.totalMetraj, 0)
        }

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
                    <option value="TIP1">TIP 1 (29-42)</option>
                    <option value="TIP2">TIP 2 (2XS-4XL)</option>
                    <option value="TIP3">TIP 3 (44-60)</option>
                </select>
            </div>

            <OrderTable
                sizeType={sizeType}
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
                    onClick={() => onPreparePlan({ orderRows, groupingResults, consumptionMode, avgConsumption, sizeConsumptions })}
                    className="bg-primary-600 hover:bg-primary-700 text-white font-black text-xl py-5 px-12 rounded-3xl shadow-2xl shadow-primary-200 transform transition-all hover:scale-105 active:scale-95"
                >
                    KESİM PLANI HAZIRLA
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
