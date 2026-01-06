import React from 'react'
import { Plus, Trash2, Clipboard } from 'lucide-react'

const SIZE_TYPES = {
    TIP1: ['28/32', '29/32', '30/32', '31/32', '32/32', '33/32', '34/32', '36/32', '38/32', '30/34', '31/34', '32/34', '33/34', '34/34', '36/34', '38/34'],
    TIP2: ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    TIP3: ['44', '46', '48', '50', '52', '54', '56', '58', '60']
}

export default function OrderTable({ sizeType, sizes: propSizes, rows, onUpdateRows }) {
    const sizes = propSizes || SIZE_TYPES[sizeType] || SIZE_TYPES.TIP1

    const handleCellChange = (rowIndex, size, value) => {
        const newRows = [...rows]
        newRows[rowIndex].quantities[size] = parseInt(value) || 0
        // Recalculate total
        newRows[rowIndex].total = Object.values(newRows[rowIndex].quantities).reduce((a, b) => a + b, 0)
        onUpdateRows(newRows)
    }

    const handleColorChange = (rowIndex, value) => {
        const newRows = [...rows]
        newRows[rowIndex].color = value
        onUpdateRows(newRows)
    }

    const addRow = () => {
        const newRow = {
            id: Date.now(),
            color: '',
            quantities: sizes.reduce((acc, size) => ({ ...acc, [size]: 0 }), {}),
            total: 0
        }
        onUpdateRows([...rows, newRow])
    }

    const removeRow = (id) => {
        onUpdateRows(rows.filter(r => r.id !== id))
    }

    const clearRows = () => {
        if (window.confirm('Tüm satırları silmek istediğinize emin misiniz?')) {
            onUpdateRows([])
        }
    }

    const handlePaste = (e) => {
        e.preventDefault()
        const clipboardData = e.clipboardData.getData('Text')
        const lines = clipboardData.split(/\r?\n/).filter(line => line.trim() !== '')

        const newRows = lines.map(line => {
            const parts = line.split(/\t/) // Excel defaults to tabs
            const color = parts[0] || 'REK'
            const quantities = {}
            let total = 0

            sizes.forEach((size, index) => {
                const val = parseInt(parts[index + 1]) || 0
                quantities[size] = val
                total += val
            })

            return {
                id: Math.random(),
                color,
                quantities,
                total
            }
        })

        if (newRows.length > 0) {
            onUpdateRows([...rows, ...newRows])
        }
    }

    const columnTotals = sizes.reduce((acc, size) => {
        acc[size] = rows.reduce((sum, row) => sum + (row.quantities[size] || 0), 0)
        return acc
    }, {})

    const grandTotal = rows.reduce((sum, row) => sum + row.total, 0)

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                        BÖLÜM A: Kesim Adetleri
                        <span className="text-xs font-medium bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">Sipariş Verileri</span>
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">Excel'den tabloyu kopyalayıp buraya yapıştırabilirsiniz (Tab ile ayrılmış değerler).</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={addRow}
                        className="bg-white hover:bg-slate-50 text-slate-700 font-bold py-2 px-4 rounded-xl border border-slate-200 flex items-center gap-2 transition-all shadow-sm"
                    >
                        <Plus size={18} />
                        Satır Ekle
                    </button>
                    <button
                        onClick={clearRows}
                        className="bg-red-50 hover:bg-red-100 text-red-600 font-bold py-2 px-4 rounded-xl border border-red-200 flex items-center gap-2 transition-all shadow-sm"
                    >
                        <Trash2 size={18} />
                        Verileri Temizle
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto" onPaste={handlePaste}>
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="p-4 font-bold text-slate-700 sticky left-0 bg-slate-50 z-10 w-40">Renk Kodu</th>
                            {sizes.map(size => (
                                <th key={size} className="p-4 font-bold text-slate-700 text-center min-w-[80px]">{size}</th>
                            ))}
                            <th className="p-4 font-bold text-primary-700 text-center bg-primary-50/50 min-w-[100px]">TOPLAM</th>
                            <th className="p-4 w-12"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                <td className="p-2 sticky left-0 bg-white group-hover:bg-slate-50 z-10">
                                    <input
                                        type="text"
                                        className="w-full bg-slate-50 border border-slate-100 rounded-lg p-2 focus:ring-2 focus:ring-primary-500 outline-none font-medium"
                                        value={row.color}
                                        placeholder="Renk"
                                        onChange={(e) => handleColorChange(rowIndex, e.target.value)}
                                    />
                                </td>
                                {sizes.map(size => (
                                    <td key={size} className="p-2">
                                        <input
                                            type="number"
                                            className="w-full bg-transparent border-b border-transparent hover:border-slate-200 focus:border-primary-500 focus:ring-0 p-2 text-center outline-none transition-all"
                                            value={row.quantities[size] || 0}
                                            onChange={(e) => handleCellChange(rowIndex, size, e.target.value)}
                                        />
                                    </td>
                                ))}
                                <td className="p-2 text-center font-bold text-slate-900 bg-primary-50/20">
                                    {row.total}
                                </td>
                                <td className="p-4 text-right">
                                    <button onClick={() => removeRow(row.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                                        <Trash2 size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={sizes.length + 3} className="p-12 text-center text-slate-400 italic">
                                    Henüz veri girilmedi. Satır ekleyin veya Excel'den yapıştırın.
                                </td>
                            </tr>
                        )}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot className="bg-slate-50 font-bold">
                            <tr>
                                <td className="p-4 sticky left-0 bg-slate-50 z-10">GENEL TOPLAM</td>
                                {sizes.map(size => (
                                    <td key={size} className="p-4 text-center text-slate-900">{columnTotals[size]}</td>
                                ))}
                                <td className="p-4 text-center text-primary-700 text-xl">{grandTotal}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    )
}
