import React from 'react'
import { Plus, Trash2, Clipboard, Layers } from 'lucide-react'

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

    const handlePaste = (e) => {
        e.preventDefault()
        const clipboardData = e.clipboardData.getData('Text')
        const lines = clipboardData.split(/\r?\n/).filter(line => line.trim() !== '')

        const newRows = lines.map((line, index) => {
            const parts = line.split(/\t/)
            const safeParse = (val) => {
                if (!val) return 0
                return parseFloat(String(val).replace(',', '.')) || 0
            }

            return {
                id: Math.random() + Date.now(),
                topNo: parts[0] || (rows.length + index + 1),
                en: safeParse(parts[1]),
                boy: safeParse(parts[2]),
                lot: parts[3] || '1',
                metraj: safeParse(parts[4])
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
                        onClick={onGroupFabrics}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-100"
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
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider border-r border-yellow-500">EN</th>
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider border-r border-yellow-500">BOY</th>
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider border-r border-yellow-500">LOT</th>
                            <th className="p-4 font-black text-slate-900 uppercase tracking-wider">METRAJ</th>
                            <th className="p-4 w-12 bg-white border-l border-slate-100"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-12 text-center text-slate-400 italic bg-slate-50/30">
                                    Henüz top verisi yok. Excel'den kopyalayıp buraya yapıştırın veya 'Top Ekle' butonunu kullanın.
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
                                        className="w-full bg-transparent border-none p-2 text-center focus:ring-2 focus:ring-emerald-500 rounded-lg outline-none font-bold text-slate-700"
                                        value={row.en}
                                        onChange={(e) => handleCellChange(rowIndex, 'en', parseFloat(e.target.value) || 0)}
                                    />
                                </td>
                                <td className="p-2 border-r border-slate-100">
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="w-full bg-transparent border-none p-2 text-center focus:ring-2 focus:ring-emerald-500 rounded-lg outline-none font-bold text-slate-700"
                                        value={row.boy}
                                        onChange={(e) => handleCellChange(rowIndex, 'boy', parseFloat(e.target.value) || 0)}
                                    />
                                </td>
                                <td className="p-2 border-r border-slate-100 font-bold">
                                    <input
                                        type="text"
                                        className="w-full bg-transparent border-none p-2 text-center focus:ring-0 outline-none uppercase font-bold text-slate-700"
                                        value={row.lot}
                                        onChange={(e) => handleCellChange(rowIndex, 'lot', e.target.value)}
                                    />
                                </td>
                                <td className="p-2 font-black">
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full bg-transparent border-none p-2 text-center focus:ring-2 focus:ring-emerald-500 rounded-lg outline-none font-black text-slate-900"
                                        value={row.metraj}
                                        onChange={(e) => handleCellChange(rowIndex, 'metraj', e.target.value)}
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
