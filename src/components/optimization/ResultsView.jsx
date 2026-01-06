import React from 'react'
import { ArrowLeft, Download, FileText, Layers, Ruler, CheckCircle2, AlertCircle, TrendingDown } from 'lucide-react'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function ResultsView({ plans, summary, onBack }) {
    // Global sizes across the entire order (from the summary)
    const globalSizes = summary && summary.length > 0
        ? Object.keys(summary[0].demanded).sort((a, b) =>
            String(a).localeCompare(String(b), undefined, { numeric: true })
        )
        : []

    // Global totals for the summary footer
    const totalDemanded = summary ? summary.reduce((acc, item) => acc + Object.values(item.demanded).reduce((a, b) => a + b, 0), 0) : 0
    const totalPlanned = summary ? summary.reduce((acc, item) => acc + Object.values(item.planned).reduce((a, b) => a + b, 0), 0) : 0
    const totalMissing = Math.max(0, totalDemanded - totalPlanned)

    // Helper to sanitize Turkish characters for basic PDF fonts
    const trFix = (str) => {
        if (!str) return ""
        return String(str)
            .replace(/İ/g, 'I').replace(/ı/g, 'i')
            .replace(/Ğ/g, 'G').replace(/ğ/g, 'g')
            .replace(/Ü/g, 'U').replace(/ü/g, 'u')
            .replace(/Ş/g, 'S').replace(/ş/g, 's')
            .replace(/Ö/g, 'O').replace(/ö/g, 'o')
            .replace(/Ç/g, 'C').replace(/ç/g, 'c')
    }

    // --- Export to Excel ---
    const exportToExcel = () => {
        const wb = XLSX.utils.book_new()

        // 1. Summary Sheet
        const summaryData = summary.map(item => {
            const row = { 'RENK': item.color }
            globalSizes.forEach(size => {
                row[`BEDEN ${size} (T)`] = item.demanded[size] || 0
                row[`BEDEN ${size} (P)`] = item.planned[size] || 0
            })
            const totalP = Object.values(item.planned).reduce((a, b) => a + b, 0)
            const totalD = Object.values(item.demanded).reduce((a, b) => a + b, 0)
            row['TOPLAM PLAN'] = totalP
            row['FARK'] = totalP - totalD
            return row
        })
        const wsSummary = XLSX.utils.json_to_sheet(summaryData)
        XLSX.utils.book_append_sheet(wb, wsSummary, "Özet Rapor")

        // 2. Individual Plans Sheets
        plans.forEach((plan, idx) => {
            const planData = []
            // Header info
            planData.push(['KESİM NO', plan.id, 'LOT', plan.lot, 'KALIP', plan.mold])
            planData.push(['TOPLAM KAT', plan.totalLayers, 'KUMAŞLAR', plan.fabrics])
            planData.push([]) // Spacer

            // Table Header
            const headers = ['RENK / KAT', ...Object.keys(plan.markerRatio).map(s => `BEDEN ${s} (x${plan.markerRatio[s]})`), 'TOPLAM']
            planData.push(headers)

            // Table Body
            plan.rows.forEach(row => {
                const dataRow = [`${row.colors} (${row.layers} Kat)`]
                Object.keys(plan.markerRatio).forEach(sz => {
                    dataRow.push(row.quantities[sz] || 0)
                })
                dataRow.push(Object.values(row.quantities).reduce((a, b) => a + b, 0))
                planData.push(dataRow)
            })

            const wsPlan = XLSX.utils.aoa_to_sheet(planData)
            XLSX.utils.book_append_sheet(wb, wsPlan, `Kesim ${plan.id}`)
        })

        XLSX.writeFile(wb, "Kesim_Plani_Raporu.xlsx")
    }

    // --- Export to PDF ---
    const exportToPDF = () => {
        const doc = new jsPDF()
        const timestamp = new Date().toLocaleString('tr-TR')

        // Title
        doc.setFontSize(18)
        doc.text(trFix("HAZIRLANAN KESIM PLANLARI"), 14, 20)
        doc.setFontSize(10)
        doc.text(`Tarih: ${timestamp}`, 14, 28)

        // Summary Section
        doc.setFontSize(14)
        doc.text(trFix("OZET RAPOR"), 14, 40)

        const summaryHeaders = [['RENK', ...globalSizes, 'TOPLAM', 'EKSIK']]
        const summaryBody = summary.map(item => {
            const totalP = Object.values(item.planned).reduce((a, b) => a + b, 0)
            const totalD = Object.values(item.demanded).reduce((a, b) => a + b, 0)
            return [
                trFix(item.color),
                ...globalSizes.map(sz => item.planned[sz] || 0),
                totalP,
                totalP - totalD
            ]
        })

        autoTable(doc, {
            startY: 45,
            head: summaryHeaders,
            body: summaryBody,
            theme: 'striped',
            headStyles: { fillColor: [15, 23, 42] }
        })

        // Plans Section
        let currentY = doc.lastAutoTable.finalY + 20

        plans.forEach((plan, idx) => {
            if (currentY > 240) {
                doc.addPage()
                currentY = 20
            }

            doc.setFontSize(14)
            doc.text(trFix(`KESIM #${plan.id} - ${plan.shrinkage}`), 14, currentY)
            doc.setFontSize(10)
            doc.text(trFix(`Lot: ${plan.lot} | Kat: ${plan.totalLayers} | Kumaslar: ${plan.fabrics}`), 14, currentY + 6)

            const planSizes = Object.keys(plan.markerRatio).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
            const headers = [['RENK / SERIM', ...planSizes.map(s => `${s} (x${plan.markerRatio[s]})`), 'TOPLAM']]
            const body = plan.rows.map(row => [
                trFix(`${row.colors} (${row.layers} Kat)`),
                ...planSizes.map(sz => row.quantities[sz] || 0),
                Object.values(row.quantities).reduce((a, b) => a + b, 0)
            ])

            autoTable(doc, {
                startY: currentY + 10,
                head: headers,
                body: body,
                theme: 'grid',
                headStyles: { fillColor: [5, 150, 105] }
            })

            currentY = doc.lastAutoTable.finalY + 15
        })

        doc.save("Kesim_Plani_Raporu.pdf")
    }

    return (
        <div className="max-w-7xl mx-auto p-4 md:p-8 pb-32">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold transition-colors mb-2"
                    >
                        <ArrowLeft size={20} />
                        Veri Girişine Dön
                    </button>
                    <h1 className="text-3xl font-black text-slate-900 font-primary">Hazırlanan Kesim Planları</h1>
                    <p className="text-slate-500">Optimizasyon kısıtlarına uygun olarak hazırlanan {plans.length} adet kesim emri.</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={exportToExcel}
                        className="bg-white border border-slate-200 text-slate-700 font-bold py-3 px-6 rounded-2xl flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
                    >
                        <Download size={20} />
                        Excel'e Aktar
                    </button>
                    <button
                        onClick={exportToPDF}
                        className="bg-primary-600 text-white font-bold py-3 px-6 rounded-2xl flex items-center gap-2 hover:bg-primary-700 transition-all shadow-lg shadow-primary-200"
                    >
                        <FileText size={20} />
                        PDF İndir
                    </button>
                </div>
            </div>

            {/* Cutting Plans Section */}
            <div className="space-y-12">
                {plans.map((group) => {
                    // Dynamic sizes for THIS specific plan
                    const planSizes = Object.keys(group.markerRatio).sort((a, b) =>
                        String(a).localeCompare(String(b), undefined, { numeric: true })
                    )

                    return (
                        <div key={group.id} className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
                            <div className={`p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${group.mold === 'KALIP - 1' ? 'bg-emerald-50/30' : 'bg-amber-50/30'}`}>
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md text-white ${group.mold === 'KALIP - 1' ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                                            KESİM #{group.id}
                                        </span>
                                        <h2 className="text-3xl font-black text-slate-900 font-primary tracking-tight">
                                            {group.shrinkage}
                                        </h2>
                                    </div>
                                    <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500">
                                        <span className="bg-white shadow-sm border border-slate-100 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                                            <Ruler size={14} className="text-primary-500" />
                                            PASTAL DİZİMİ:
                                            <span className="text-slate-900 font-black">
                                                {Object.entries(group.markerRatio).map(([sz, count]) => `${sz}:${count}`).join(', ')}
                                            </span>
                                        </span>
                                        <span className="bg-white shadow-sm border border-slate-100 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                                            <Layers size={14} className="text-blue-500" />
                                            TOPLAM KAT: <span className="text-slate-900 font-black">{group.totalLayers}</span>
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-col items-end gap-2 text-right">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">KULLANILAN TOPLAR</span>
                                    <div className="text-xs font-bold text-slate-700 max-w-[300px] bg-white p-2 rounded-xl border border-slate-100 shadow-sm leading-relaxed">
                                        {group.fabrics}
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-center border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50/50 border-b-2 border-slate-100">
                                            <th className="p-6 font-black text-slate-400 uppercase tracking-widest text-xs text-left border-r border-slate-50">RENK / KAT</th>
                                            {planSizes.map(size => (
                                                <th key={size} className="p-6 border-r border-slate-50">
                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">BEDEN</div>
                                                    <div className="text-xl font-black text-slate-900">{size}</div>
                                                    <div className="text-[10px] font-bold text-primary-500">
                                                        (x{group.markerRatio[size]})
                                                    </div>
                                                </th>
                                            ))}
                                            <th className="p-6">
                                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 italic">TOPLAM</div>
                                                <div className="text-xl font-black text-slate-900">ADET</div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.rows.map((row, idx) => {
                                            const rowTotal = Object.values(row.quantities).reduce((a, b) => a + b, 0)
                                            return (
                                                <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                                                    <td className="p-6 text-left border-r border-slate-50">
                                                        <div className="text-lg font-black text-slate-900 leading-tight">
                                                            {row.colors}
                                                        </div>
                                                        <div className="text-xs font-bold text-blue-600 flex items-center gap-1 mt-1">
                                                            <Layers size={12} />
                                                            {row.layers} Kat Serim
                                                        </div>
                                                    </td>
                                                    {planSizes.map(size => (
                                                        <td key={size} className="p-6 text-2xl font-black text-slate-900 border-r border-slate-50">
                                                            {row.quantities[size] || '-'}
                                                        </td>
                                                    ))}
                                                    <td className="p-6 text-2xl font-black text-primary-600 bg-primary-50/20">
                                                        {rowTotal}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* --- Global Summary Report --- */}
            {summary && (
                <div className="mt-20">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="h-1 flex-1 bg-slate-200 rounded-full"></div>
                        <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter flex items-center gap-3 font-primary">
                            <CheckCircle2 className="text-emerald-500 w-8 h-8" />
                            KESİM ÖZET RAPORU
                        </h2>
                        <div className="h-1 flex-1 bg-slate-200 rounded-full"></div>
                    </div>

                    <div className="bg-white rounded-[40px] shadow-2xl border border-slate-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-center border-collapse">
                                <thead>
                                    <tr className="bg-slate-900 text-white">
                                        <th className="p-6 text-left font-black uppercase tracking-widest text-xs border-r border-slate-800">RENK / DURUM</th>
                                        {globalSizes.map(size => (
                                            <th key={size} className="p-6 border-r border-slate-800">
                                                <div className="text-[10px] font-bold text-slate-400 mb-1">BEDEN</div>
                                                <div className="text-xl font-black">{size}</div>
                                            </th>
                                        ))}
                                        <th className="p-6 bg-primary-600">
                                            <div className="text-[10px] font-bold text-primary-200 mb-1">TOPLAM</div>
                                            <div className="text-xl font-black">ADET</div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary.map((item, idx) => {
                                        const totalDemandedRow = Object.values(item.demanded).reduce((a, b) => a + b, 0)
                                        const totalPlannedRow = Object.values(item.planned).reduce((a, b) => a + b, 0)
                                        const diffRow = totalPlannedRow - totalDemandedRow

                                        return (
                                            <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                                <td className="p-6 text-left border-r border-slate-100 bg-slate-50/30">
                                                    <div className="text-xl font-black text-slate-900">{item.color}</div>
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">SİPARİŞ DETAYI</div>
                                                </td>
                                                {globalSizes.map(size => {
                                                    const d = item.demanded[size] || 0
                                                    const p = item.planned[size] || 0
                                                    const sDiff = p - d
                                                    const isMissing = sDiff < 0

                                                    return (
                                                        <td key={size} className={`p-4 border-r border-slate-100 ${isMissing ? 'bg-red-50/50' : ''}`}>
                                                            <div className="flex flex-col items-center">
                                                                <div className="text-[10px] text-slate-400 font-black mb-1">
                                                                    T: <span className="text-slate-600">{d}</span>
                                                                </div>
                                                                <div className={`text-2xl font-black ${isMissing ? 'text-red-600' : 'text-slate-900'}`}>{p}</div>
                                                                {sDiff !== 0 && (
                                                                    <div className={`text-[10px] font-black px-1.5 py-0.5 rounded mt-1 shadow-sm ${sDiff > 0 ? 'bg-amber-100 text-amber-700' : 'bg-red-600 text-white'}`}>
                                                                        {sDiff > 0 ? `+${sDiff}` : sDiff}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    )
                                                })}
                                                <td className={`p-6 border-l w-40 ${diffRow === 0 ? 'bg-emerald-50/50' : diffRow > 0 ? 'bg-amber-50/50' : 'bg-red-50/50'}`}>
                                                    <div className="flex flex-col items-center justify-center">
                                                        <div className={`text-2xl font-black mb-1 ${diffRow < 0 ? 'text-red-600' : 'text-slate-900'}`}>{totalPlannedRow}</div>
                                                        <div className={`text-[10px] font-black px-2 py-1 rounded-lg uppercase tracking-widest flex items-center gap-1 ${diffRow === 0 ? 'bg-emerald-500 text-white' : diffRow > 0 ? 'bg-amber-500 text-white' : 'bg-red-600 text-white'}`}>
                                                            {diffRow === 0 ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                                                            {diffRow === 0 ? 'TAMAM' : diffRow > 0 ? `FAZLA (+${diffRow})` : `EKSİK (${diffRow})`}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Total Statistics Footer */}
                        <div className="p-8 bg-slate-900 text-white flex flex-col md:flex-row justify-between items-center gap-8">
                            <div className="flex flex-wrap gap-8 md:gap-16">
                                <div>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] block mb-2">TOPLAM SİPARİŞ TALEBİ</span>
                                    <span className="text-4xl font-black">
                                        {totalDemanded}
                                    </span>
                                </div>
                                <div className="hidden md:block h-16 w-px bg-slate-800"></div>
                                <div>
                                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] block mb-2">TOPLAM PLANLANAN</span>
                                    <span className="text-4xl font-black text-emerald-400">
                                        {totalPlanned}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-8 bg-white/5 p-6 rounded-[30px] border border-white/10">
                                <div className="text-right">
                                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-[0.2em] block mb-1">TOPLAM EKSİK ADET</span>
                                    <span className={`text-3xl font-black ${totalMissing > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                        {totalMissing}
                                    </span>
                                </div>
                                <div className={`p-3 rounded-2xl shadow-xl ${totalMissing > 0 ? 'bg-red-500 shadow-red-500/20' : 'bg-emerald-500 shadow-emerald-500/20'}`}>
                                    {totalMissing > 0 ? <TrendingDown className="text-white w-8 h-8" /> : <CheckCircle2 className="text-white w-8 h-8" />}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
