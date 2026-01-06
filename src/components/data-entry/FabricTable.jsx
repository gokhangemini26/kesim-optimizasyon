import React from 'react'
import { Plus, Trash2, Clipboard, Layers, Info } from 'lucide-react'

export default function FabricTable({ rows, onUpdateRows, onGroupFabrics }) {
    const handleCellChange = (rowIndex, field, value) => {
        const newRows = [...rows]
        newRows[rowIndex][field] = value
        onUpdateRows(newRows)
    }

    const addRow = () => {
        const newRow = {
            id: Date.now(),
            topNo: rows.length + 1,
            en: -1.5,
            boy: -2,
            lot: '1',
            metraj: 100
        }
        onUpdateRows([...rows, newRow])
    }

    const removeRow = (id) => {
        onUpdateRows(rows.filter(r => r.id !== id))
    }

    const clearRows = () => {
        if (window.confirm('Tüm kumaş verilerini silmek istediğinize emin misiniz?')) {
            onUpdateRows([])
        }
    }

    // ✅ EXCEL FORMATINI DESTEKLEYEN PARSE FONKSİYONU
    const parseExcelValue = (value, field) => {
        if (!value || value.trim() === '') return null

        const val = String(value).trim()

        // En/Boy için özel parse
        if (field === 'en' || field === 'boy') {
            // Format: "E55" veya "B6" veya "-2" veya "5.5"
            const match = val.match(/[EB]?\s*(-?\d+\.?\d*)/)
            if (match) {
                const num = parseFloat(match[1])
                // Eğer E55/B6 formatındaysa 10'a böl (5.5% yapmak için)
                if (val.match(/^[EB]/i) && Math.abs(num) > 10) {
                    return num / 10
                }
                return num
            }
        }

        // Metraj için
        if (field === 'metraj') {
            const num = parseFloat(val.replace(',', '.'))
            return isNaN(num) ? 0 : num
        }

        // Lot için - her şeyi kabul et
        if (field === 'lot') {
            return val.toUpperCase()
        }

        // Diğer alanlar
        return val
    }

    const handlePaste = (e) => {
        e.preventDefault()
        const clipboardData = e.clipboardData.getData('Text')
        const lines = clipboardData.split(/\r?\n/).filter(line => line.trim() !== '')

        const newRows = lines.map((line, index) => {
            const parts = line.split(/\t/)

            // ✅ EXCEL FORMATLARI:
            // Format 1: TopNo | En | Boy | Lot | Metraj
            // Format 2: TopNo | Metraj | Lot | Çekme (birleşik "E55 B6")

            let topNo, en, boy, lot, metraj

            if (parts.length >= 5) {
                // Format 1: Standart
                topNo = parts[0] || (rows.length + index + 1)
                en = parseExcelValue(parts[1], 'en') || 0
                boy = parseExcelValue(parts[2], 'boy') || 0
                lot = parseExcelValue(parts[3], 'lot') || '1'
                metraj = parseExcelValue(parts[4], 'metraj') || 0
            } else if (parts.length === 4) {
                // Format 2: TopNo | Metraj | Lot | Çekme
                topNo = parts[0] || (rows.length + index + 1)
                metraj = parseExcelValue(parts[1], 'metraj') || 0
                lot = parseExcelValue(parts[2], 'lot') || '1'

                // Çekme parse (E55 B6 formatı)
                const cekmeStr = parts[3] || ''
                const match = cekmeStr.match(/E\s*(-?\d+\.?\d*)\s*B\s*(-?\d+\.?\d*)/)
                if (match) {
                    en = parseFloat(match[1]) / 10
                    boy = parseFloat(match[2]) / 10
                } else {
                    en = 0
                    boy = 0
                }
            } else {
                // Eksik veri - varsayılanlar
                topNo = parts[0] || (rows.length + index + 1)
                en = 0
                boy = 0
                lot = '1'
                metraj = 0
            }

            return {
                id: Math.random() + Date.now(),
                topNo: topNo,
                en: en,
                boy: boy,
                lot: lot,
                metraj: metraj
            }
        })

        if (newRows.length > 0) {
            onUpdateRows([...rows, ...newRows])
        }
    }

    const totalMetraj = rows.reduce((sum, row) => sum + (parseFloat(row.metraj) || 0), 0)

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mt-8">
            <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50/50">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        BÖLÜM B: Kumaş Top Bilgileri
                        <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Stok Verileri</span>
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">Excel'den yapıştırabilir veya manuel ekleyebilirsiniz.</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                        <Info size={14} />
                        <span>Desteklenen formatlar: "E55 B6" veya "-2 -3" (çekme değerleri)</span>
                    </div>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <button
                        onClick={addRow}
                        className="flex-1 bg-white hover:bg-slate-50 text-slate-700 font-bold py-2.5 px-4 rounded-xl border border-slate-200 flex items-center justify-center gap-2 transition-all shadow-sm"
                    >
                        <Plus size={18} />
                        Top Ekle
                    </button>
                    <button
                        onClick={clearRows}
                        className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 font-bold py-2.5 px-4 rounded-xl border border-red-200 flex items-center justify-center gap-2 transition-all shadow-sm"
                    >
                        <Trash2 size={18} />
                        Temizle
                    </button>
                    <button
                        onClick={onGroupFabrics}
                        disabled={rows.length === 0}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Layers size={18} />
                        ÇEKME BAZINDA GRUPLANDIR
                    </button>
                </div>
            </div>

            <div
                className="overflow-x-auto outline-none focus:ring-2 focus:ring-emerald-500/20"
                onPaste={handlePaste}
                tabIndex={0}
            >
                <table className="w-full text-center border-collapse">
                    <thead>
                        <tr className="bg-yellow-400 border-b border-yellow-500">
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider border-r border-yellow-500">TOP NO</th>
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider border-r border-yellow-500">
                                <div>EN (%)</div>
                                <div className="text-[10px] font-normal text-slate-600">Negatif: Çekme</div>
                            </th>
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider border-r border-yellow-500">
                                <div>BOY (%)</div>
                                <div className="text-[10px] font-normal text-slate-600">Negatif: Çekme</div>
                            </th>
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider border-r border-yellow-500">LOT</th>
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider">METRAJ</th>
                            <th className="p-4 w-12 bg-white border-l border-slate-100"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-12 text-center text-slate-400 italic bg-slate-50/30">
                                    <div className="space-y-2">
                                        <div>Henüz top verisi yok.</div>
                                        <div className="text-xs">
                                            Excel'den kopyalayıp buraya yapıştırın veya 'Top Ekle' butonunu kullanın.
                                        </div>
                                        <div className="text-xs font-bold text-emerald-600 mt-3">
                                            💡 İpucu: "E55 B6" formatını da destekliyoruz!
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : rows.map((row, rowIndex) => (
                            <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors group">
                                <td className="p-2 border-r border-slate-100 bg-yellow-400/10 font-black">
                                    <input
                                        type="text"
                                        className="w-full bg-transparent border-none p-2 text-center focus:ring-0 font-black text-slate-900"
                                        value={row.topNo}
                                        onChange={(e) => handleCellChange(rowIndex, 'topNo', e.target.value)}
                                    />
                                </td>
                                <td className="p-2 border-r border-slate-100">
                                    <input
                                        type="number"
                                        step="0.1"
                                        className={`w-full bg-transparent border-none p-2 text-center focus:ring-2 focus:ring-emerald-500 rounded-lg outline-none font-bold ${row.en < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                        value={row.en}
                                        onChange={(e) => handleCellChange(rowIndex, 'en', parseFloat(e.target.value) || 0)}
                                        placeholder="-2.0"
                                    />
                                </td>
                                <td className="p-2 border-r border-slate-100">
                                    <input
                                        type="number"
                                        step="0.1"
                                        className={`w-full bg-transparent border-none p-2 text-center focus:ring-2 focus:ring-emerald-500 rounded-lg outline-none font-bold ${row.boy < 0 ? 'text-red-600' : 'text-slate-700'}`}
                                        value={row.boy}
                                        onChange={(e) => handleCellChange(rowIndex, 'boy', parseFloat(e.target.value) || 0)}
                                        placeholder="-3.0"
                                    />
                                </td>
                                <td className="p-2 border-r border-slate-100 font-bold">
                                    <input
                                        type="text"
                                        className="w-full bg-transparent border-none p-2 text-center focus:ring-0 outline-none uppercase font-bold text-slate-700"
                                        value={row.lot}
                                        onChange={(e) => handleCellChange(rowIndex, 'lot', e.target.value)}
                                        placeholder="LOT1"
                                    />
                                </td>
                                <td className="p-2 font-black">
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full bg-transparent border-none p-2 text-center focus:ring-2 focus:ring-emerald-500 rounded-lg outline-none font-black text-slate-900"
                                        value={row.metraj}
                                        onChange={(e) => handleCellChange(rowIndex, 'metraj', e.target.value)}
                                        placeholder="100"
                                    />
                                </td>
                                <td className="p-2 text-center">
                                    <button onClick={() => removeRow(row.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                                        <Trash2 size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot className="bg-slate-900 text-white font-black">
                            <tr>
                                <td className="p-4 text-left uppercase tracking-widest text-sm" colSpan={4}>TOPLAM METRAJ</td>
                                <td className="p-4 text-xl">{totalMetraj.toFixed(2)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    )
}
