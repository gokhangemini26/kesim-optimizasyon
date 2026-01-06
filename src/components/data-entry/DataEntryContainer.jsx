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

        const enT = customer.enTolerance
        const boyT = customer.boyTolerance

        // ✅ 1. ÇEKME GROUPLARİ OLUŞTUR
        const cekmeGroups = {}

        fabricRows.forEach((fabric, idx) => {
            const parsed = parseCekme(fabric.en + ' ' + fabric.boy)

            // Her kumaşa parse edilmiş değerleri ekle
            fabric.parsedEn = parsed.en
            fabric.parsedBoy = parsed.boy

            // Grup anahtarı: Tolerans içinde olanlar aynı grupta
            // Referans değerini ilk kumaştan al, sonrakiler buna göre grupla
            let groupKey = null

            Object.keys(cekmeGroups).forEach(key => {
                const [refEn, refBoy] = key.split('_').map(parseFloat)

                const enCheck = isWithinTolerance(refEn, enT)
                const boyCheck = isWithinTolerance(refBoy, boyT)

                if (enCheck(parsed.en) && boyCheck(parsed.boy)) {
                    groupKey = key
                }
            })

            if (!groupKey) {
                groupKey = `${parsed.en}_${parsed.boy}`
                cekmeGroups[groupKey] = {}
            }

            // ✅ 2. AYNI ÇEKME GRUBUNDA LOT'LARA GÖRE ALT GRUPLAMA
            const lot = fabric.lot || 'BELİRSİZ'

            if (!cekmeGroups[groupKey][lot]) {
                cekmeGroups[groupKey][lot] = {
                    lot: lot,
                    cekmeKey: groupKey,
                    fabrics: [],
                    totalMetraj: 0
                }
            }

            cekmeGroups[groupKey][lot].fabrics.push({
                ...fabric,
                index: idx
            })
            cekmeGroups[groupKey][lot].totalMetraj += parseFloat(fabric.metraj) || 0
        })

        // ✅ 3. SONUÇLARI DÜZENLE
        const allGroups = []
        Object.values(cekmeGroups).forEach(lotGroups => {
            Object.values(lotGroups).forEach(group => {
                allGroups.push(group)
            })
        })

        // Metraj'a göre sırala (büyükten küçüğe)
        allGroups.sort((a, b) => b.totalMetraj - a.totalMetraj)

        // ✅ 4. KALIP-1 ve KALIP-2'ye AYIR
        // Kalıp-1: Referans çekme değerlerine en yakın grup (En büyük grup)
        const kalip1 = []
        const kalip2 = []

        if (allGroups.length > 0) {
            // İlk (en büyük metrajlı) grubu Kalıp-1 olarak al
            kalip1.push(allGroups[0])

            // Geri kalanları Kalıp-2'ye at
            for (let i = 1; i < allGroups.length; i++) {
                kalip2.push(allGroups[i])
            }
        }

        const result = {
            kalip1: kalip1,
            kalip2: kalip2,
            kalip3: [], // Modal hatasını önlemek için boş
            kalip1Total: kalip1.reduce((acc, curr) => acc + curr.totalMetraj, 0),
            kalip2Total: kalip2.reduce((acc, curr) => acc + curr.totalMetraj, 0),
            kalip3Total: 0,
            allGroups: allGroups
        }

        console.log('📊 Gruplama Sonuçları:', result)

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
