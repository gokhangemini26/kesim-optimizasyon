import React from 'react'
import { Ruler, Settings2 } from 'lucide-react'

export default function ConsumptionSettings({
    mode,
    onModeChange,
    avgConsumption,
    onAvgChange,
    sizeConsumptions,
    onSizeChange,
    sizes
}) {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mt-8">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    BÖLÜM C: Tüketim Değerleri
                    <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Birim Tüketim</span>
                </h2>
                <p className="text-sm text-slate-500 mt-1">Kesilecek parçalar için metre bazında tüketim değerlerini belirleyin.</p>
            </div>

            <div className="p-8">
                <div className="flex flex-wrap gap-8 mb-8">
                    <label className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all cursor-pointer flex-1 min-w-[200px] ${mode === 'AVG' ? 'border-primary-500 bg-primary-50/30' : 'border-slate-100 hover:border-slate-200'}`}>
                        <input
                            type="radio"
                            className="w-5 h-5 text-primary-600 focus:ring-primary-500 border-slate-300"
                            checked={mode === 'AVG'}
                            onChange={() => onModeChange('AVG')}
                        />
                        <div>
                            <span className="block font-bold text-slate-900">Ortalama Tüketim</span>
                            <span className="block text-xs text-slate-500">Tüm bedenler için tek bir değer kullan</span>
                        </div>
                    </label>

                    <label className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all cursor-pointer flex-1 min-w-[200px] ${mode === 'SIZE' ? 'border-primary-500 bg-primary-50/30' : 'border-slate-100 hover:border-slate-200'}`}>
                        <input
                            type="radio"
                            className="w-5 h-5 text-primary-600 focus:ring-primary-500 border-slate-300"
                            checked={mode === 'SIZE'}
                            onChange={() => onModeChange('SIZE')}
                        />
                        <div>
                            <span className="block font-bold text-slate-900">Beden Bazlı Tüketim</span>
                            <span className="block text-xs text-slate-500">Her beden için ayrı değer tanımla</span>
                        </div>
                    </label>
                </div>

                {mode === 'AVG' ? (
                    <div className="max-w-md animate-in fade-in slide-in-from-left-4">
                        <label className="text-sm font-bold text-slate-700 block mb-2 px-1">Tüketim (Metre)</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                                <Ruler size={18} />
                            </div>
                            <input
                                type="number"
                                step="0.01"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 pl-12 pr-4 focus:ring-2 focus:ring-primary-500 outline-none text-xl font-bold text-slate-900"
                                value={avgConsumption}
                                onChange={(e) => onAvgChange(parseFloat(e.target.value) || 0)}
                                placeholder="1.25"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-in fade-in slide-in-from-right-4">
                        {sizes.map(size => (
                            <div key={size} className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 block px-1">{size}</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 focus:ring-2 focus:ring-primary-500 outline-none font-bold text-slate-900"
                                    value={sizeConsumptions[size] || ''}
                                    onChange={(e) => onSizeChange(size, parseFloat(e.target.value) || 0)}
                                    placeholder="1.20"
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
