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
            shrinkageCode: 'E0 B0',
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

    const handlePaste = (e) => {
        e.preventDefault()
        const clipboardData = e.clipboardData.getData('Text')
        const lines = clipboardData.split(/\r?\n/).filter(line => line.trim() !== '')

        const newRows = lines.map((line, index) => {
            const parts = line.split(/\t/) // Excel defaults to tabs

            // Heuristic to detect if pasted data has split En/Boy or single string
            // Case 1: 5 cols -> Top, En, Boy, Lot, Metraj
            // Case 2: 4 cols -> Top, Shrinkage, Lot, Metraj

            let shrinkCode = 'E0 B0'
            let lot = '1'
            let metraj = 0

            if (parts.length >= 5) {
                // Assume separate columns
                const en = parts[1] || '0'
                const boy = parts[2] || '0'
                shrinkCode = `E${en} B${boy}`
                lot = parts[3] || '1'
                metraj = parseFloat((parts[4] || '0').replace(',', '.')) || 0
            } else {
                // Assume single column
                shrinkCode = parts[1] || 'E0 B0'
                lot = parts[2] || '1'
                metraj = parseFloat((parts[3] || '0').replace(',', '.')) || 0
            }

            return {
                id: Math.random() + Date.now(),
                topNo: parts[0] || (rows.length + index + 1),
                shrinkageCode: shrinkCode,
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <div>
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <Layers className="w-5 h-5 text-indigo-600" />
                        Kumaş Listesi
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                        Toplam {rows.length} top, {totalMetraj.toFixed(2)}m kumaş
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={clearRows}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Listeyi Temizle"
                    >
                        <Trash2 size={20} />
                    </button>
                    <button
                        onClick={addRow}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                        <Plus size={20} />
                        <span>Top Ekle</span>
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                const text = await navigator.clipboard.readText();
                                // Trigger paste logic manually if needed or just inform user
                                alert("Lütfen tablo üzerine tıklayıp CTRL+V yapın.");
                            } catch (err) { }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        <Clipboard size={20} />
                        <span>Excel'den Yapıştır</span>
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 w-16">Top No</th>
                            <th className="px-4 py-3">Lot No</th>
                            <th className="px-4 py-3">Çekme (E/B)</th>
                            <th className="px-4 py-3 text-right">Metraj (m)</th>
                            <th className="px-4 py-3 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200" onPaste={handlePaste}>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="px-4 py-8 text-center text-gray-500">
                                    Henüz kumaş eklenmedi. Excel'den veri yapıştırabilir veya manuel ekleyebilirsiniz.
                                </td>
                            </tr>
                        ) : (
                            rows.map((row, index) => (
                                <tr key={row.id} className="bg-white hover:bg-gray-50 group">
                                    <td className="px-4 py-2">
                                        <input
                                            type="text"
                                            value={row.topNo}
                                            onChange={(e) => handleCellChange(index, 'topNo', e.target.value)}
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0 font-medium text-gray-900"
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="text"
                                            value={row.lot}
                                            onChange={(e) => handleCellChange(index, 'lot', e.target.value)}
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0"
                                            placeholder="Lot"
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="text"
                                            value={row.shrinkageCode}
                                            onChange={(e) => handleCellChange(index, 'shrinkageCode', e.target.value)}
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0 font-mono text-indigo-600"
                                            placeholder="E55 B45"
                                        />
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <input
                                            type="number"
                                            value={row.metraj}
                                            onChange={(e) => handleCellChange(index, 'metraj', parseFloat(e.target.value))}
                                            className="w-full bg-transparent border-0 focus:ring-0 p-0 text-right"
                                        />
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        <button
                                            onClick={() => removeRow(row.id)}
                                            className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot className="bg-gray-100 text-gray-700 font-semibold">
                            <tr>
                                <td className="px-4 py-3" colSpan="3">Toplam Metraj</td>
                                <td className="px-4 py-3 text-right">{totalMetraj.toFixed(2)} m</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    )
}
