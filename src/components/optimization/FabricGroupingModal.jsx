import React from 'react'
import { X, Layers, CheckCircle2, Info, Ruler } from 'lucide-react'

const getLotColor = (lot) => {
    const colors = [
        'bg-blue-50/50', 'bg-emerald-50/50', 'bg-amber-50/50',
        'bg-purple-50/50', 'bg-pink-50/50', 'bg-rose-50/50',
        'bg-indigo-50/50', 'bg-cyan-50/50', 'bg-teal-50/50'
    ]
    const borderColors = [
        'border-blue-100', 'border-emerald-100', 'border-amber-100',
        'border-purple-100', 'border-pink-100', 'border-rose-100',
        'border-indigo-100', 'border-cyan-100', 'border-teal-100'
    ]
    const textColors = [
        'text-blue-700', 'text-emerald-700', 'text-amber-700',
        'text-purple-700', 'text-pink-700', 'text-rose-700',
        'text-indigo-700', 'text-cyan-700', 'text-teal-700'
    ]

    let hash = 0
    for (let i = 0; i < lot.length; i++) {
        hash = lot.charCodeAt(i) + ((hash << 5) - hash)
    }
    const index = Math.abs(hash) % colors.length
    return { bg: colors[index], border: borderColors[index], text: textColors[index] }
}

const KalipTable = ({ title, data, totalMetraj, colorClass }) => (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden mb-12">
        <div className={`p-6 border-b flex justify-between items-center ${colorClass}`}>
            <h3 className="text-2xl font-black text-white italic tracking-tight">{title}</h3>
            <div className="bg-white/20 backdrop-blur-md px-4 py-2 rounded-xl border border-white/30 text-white font-black text-lg">
                TOPLAM: {totalMetraj.toFixed(2)} m
            </div>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-slate-50 text-slate-400 font-black uppercase text-[10px] tracking-widest border-b border-slate-100">
                        <th className="p-4 pl-8">LOT / RENK GRUBU</th>
                        <th className="p-4 text-center">TOPLAR (EN/BOY)</th>
                        <th className="p-4 text-right pr-8">LOT TOPLAM METRAJ</th>
                    </tr>
                </thead>
                <tbody>
                    {data.length === 0 ? (
                        <tr>
                            <td colSpan={3} className="p-12 text-center text-slate-400 italic">Bu grupta kumaş bulunmamaktadır.</td>
                        </tr>
                    ) : (
                        data.map((lotGroup, idx) => {
                            const styles = getLotColor(lotGroup.lot)
                            return (
                                <tr key={idx} className={`${styles.bg} border-b border-white transition-colors hover:bg-white`}>
                                    <td className="p-6 pl-8">
                                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border ${styles.border} ${styles.text} font-black text-sm`}>
                                            LOT: {lotGroup.lot}
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        <div className="flex flex-wrap gap-2 justify-center">
                                            {lotGroup.fabrics.map((f, fi) => (
                                                <div key={fi} className="bg-white/60 p-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 shadow-sm">
                                                    Top {f.topNo} <span className="text-slate-400 font-normal">({f.en}/{f.boy})</span>
                                                    <div className="text-emerald-600 font-black">{f.metraj}m</div>
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="p-6 text-right pr-8">
                                        <div className={`text-xl font-black ${styles.text}`}>
                                            {lotGroup.totalMetraj.toFixed(2)} m
                                        </div>
                                    </td>
                                </tr>
                            )
                        })
                    )}
                </tbody>
            </table>
        </div>
    </div>
)

export default function FabricGroupingModal({ results, onClose }) {
    if (!results) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-12 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-slate-50 w-full max-w-6xl max-h-full rounded-[40px] shadow-2xl overflow-hidden flex flex-col border border-white/20">
                <div className="p-8 pb-4 flex justify-between items-center">
                    <div>
                        <h2 className="text-4xl font-black text-slate-900 flex items-center gap-3 font-display">
                            <Layers className="text-emerald-500 w-10 h-10" />
                            Çekme Bazında Gruplandırma
                        </h2>
                        <p className="text-slate-500 font-medium ml-1">Kumaşların tolerans değerlerine göre Kalıp-1 ve Kalıp-2 dağılımı.</p>
                    </div>
                    <button onClick={onClose} className="p-3 bg-white hover:bg-slate-100 rounded-2xl transition-all text-slate-400 hover:text-slate-900 border border-slate-200 shadow-sm active:scale-95">
                        <X size={28} />
                    </button>
                </div>

                <div className="p-8 pt-4 overflow-y-auto flex-1 space-y-4">
                    <KalipTable
                        title="KALIP - 1 (0-5% Tolerans)"
                        data={results.kalip1}
                        totalMetraj={results.kalip1Total}
                        colorClass="bg-emerald-500"
                    />

                    <KalipTable
                        title="KALIP - 2 (5-10% Tolerans)"
                        data={results.kalip2}
                        totalMetraj={results.kalip2Total}
                        colorClass="bg-amber-500"
                    />

                    <KalipTable
                        title="KALIP - 3 (10-15% Tolerans)"
                        data={results.kalip3}
                        totalMetraj={results.kalip3Total}
                        colorClass="bg-rose-500"
                    />
                </div>

                <div className="p-8 border-t border-slate-200 bg-white flex justify-between items-center">
                    <div className="flex gap-8">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GENEL TOPLAM</span>
                            <span className="text-3xl font-black text-slate-900">{(results.kalip1Total + results.kalip2Total + results.kalip3Total).toFixed(2)} m</span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="bg-slate-900 text-white font-black text-lg py-4 px-12 rounded-2xl flex items-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 transform hover:scale-[1.02] active:scale-95"
                    >
                        <CheckCircle2 size={24} />
                        Onayla ve Devam Et
                    </button>
                </div>
            </div>
        </div>
    )
}
