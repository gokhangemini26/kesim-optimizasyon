import React, { useState } from 'react'
import OrderTable from './OrderTable'
import FabricTable from './FabricTable'
import ConsumptionSettings from './ConsumptionSettings'
import FabricGroupingModal from '../optimization/FabricGroupingModal'

const SIZE_TYPES = {
    TIP1: ['28/32', '29/32', '30/32', '31/32', '32/32', '33/32', '34/32', '36/32', '38/32', '30/34', '31/34', '32/34', '33/34', '34/34', '36/34', '38/34'],
    TIP2: ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    TIP3: ['44', '46', '48', '50', '52', '54', '56', '58', '60']
}

// ✅ ÇEKME PARSE FONKSİYONU - Excel formatını destekler
const parseCekme = (value) => {
    if (!value) return { en: 0, boy: 0 }

    const str = String(value).trim().toUpperCase()

    // Format 1: "E55 B6" veya "E5.5 B0.6" (Excel formatı)
    const match1 = str.match(/E\s*(-?\d+\.?\d*)\s*B\s*(-?\d+\.?\d*)/)
    if (match1) {
        const en = parseFloat(match1[1]) / 10 // E55 → 5.5%
        const boy = parseFloat(match1[2]) / 10 // B6 → 0.6%
        return { en, boy }
    }

    // Format 2: Direkt sayısal değer (mevcut format)
    const num = parseFloat(str)
    if (!isNaN(num)) {
        return { en: num, boy: num }
    }

    return { en: 0, boy: 0 }
}

// ✅ TOLERANS KONTROLÜ - Doğru mantık
const isWithinTolerance = (cekmeValue, toleranceValue) => {
    // Çekme değeri: -2%, Tolerans: ±2%
    // Kabul aralığı: -4% ile 0% arası
    const lowerBound = cekmeValue - toleranceValue
    const upperBound = cekmeValue + toleranceValue

    return (value) => {
        return value >= lowerBound && value <= upperBound
    }
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
        if (fabricRows.length === 0) {
            alert('Lütfen önce kumaş bilgilerini girin!')
            return
        }

        // ✅ 1. ÇEKME GROUPLARİ OLUŞTUR (0-5%, 5-10%, 10%+)
        const groups = {
            kalip1: {}, // 0-5%
            kalip2: {}, // 5-10%
            kalip3: {}  // 10%+
        }
        const totals = { k1: 0, k2: 0, k3: 0 }

        fabricRows.forEach((fabric, idx) => {
            const parsed = parseCekme(fabric.en + ' ' + fabric.boy)

            // Mutlak değerlerin en büyüğünü al (Hem en hem boy tolerans içinde olmalı)
            const maxShrink = Math.max(Math.abs(parsed.en), Math.abs(parsed.boy))

            let targetGroup = 'kalip3'
            if (maxShrink <= 3) targetGroup = 'kalip1'
            else if (maxShrink <= 6.0) targetGroup = 'kalip2'
            // 6.1 ve üzeri kalip3

            const lot = fabric.lot || 'BELİRSİZ'

            // Lot grubu var mı?
            if (!groups[targetGroup][lot]) {
                groups[targetGroup][lot] = {
                    lot: lot,
                    fabrics: [],
                    totalMetraj: 0,
                    avgShrink: 0
                }
            }

            const metraj = parseFloat(fabric.metraj) || 0
            groups[targetGroup][lot].fabrics.push({ ...fabric, index: idx })
            groups[targetGroup][lot].totalMetraj += metraj

            // İstatistik için toplam
            if (targetGroup === 'kalip1') totals.k1 += metraj
            else if (targetGroup === 'kalip2') totals.k2 += metraj
            else totals.k3 += metraj
        })

        // ✅ 2. SONUÇLARI DÜZENLE (Object -> Array)
        const result = {
            kalip1: Object.values(groups.kalip1).sort((a, b) => b.totalMetraj - a.totalMetraj),
            kalip2: Object.values(groups.kalip2).sort((a, b) => b.totalMetraj - a.totalMetraj),
            kalip3: Object.values(groups.kalip3).sort((a, b) => b.totalMetraj - a.totalMetraj),
            kalip1Total: totals.k1,
            kalip2Total: totals.k2,
            kalip3Total: totals.k3
        }

        // Optimizasyon motoru için düz liste
        result.allGroups = [
            ...result.kalip1,
            ...result.kalip2,
            ...result.kalip3
        ]

        console.log('📊 Tolerans Bazlı Gruplama:', result)

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
