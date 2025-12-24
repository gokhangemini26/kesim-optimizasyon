import React, { useState, useEffect } from 'react'
import { Plus, Users, Search, Edit2, Trash2, CheckCircle, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'

export default function CustomerManagement({ onSelectCustomer, onLogout }) {
    const [customers, setCustomers] = useState([])
    const [loading, setLoading] = useState(true)
    const [isAdding, setIsAdding] = useState(false)
    const [formData, setFormData] = useState({ name: '', enTolerance: 2, boyTolerance: 3 })
    const [error, setError] = useState(null)

    const fetchCustomers = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const { data, error } = await supabase
                .from('customers')
                .select('*')
                .eq('user_id', user.id)
                .order('name')

            if (!error) {
                // Map snake_case DB columns to camelCase frontend state
                const formattedData = data.map(c => ({
                    ...c,
                    enTolerance: c.en_tolerance,
                    boyTolerance: c.boy_tolerance
                }))
                setCustomers(formattedData)
            }
        }
        setLoading(false)
    }

    useEffect(() => {
        fetchCustomers()
    }, [])

    const handleAdd = async (e) => {
        e.preventDefault()
        setError(null)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Kullanıcı oturumu bulunamadı.")

            const { error: insertError } = await supabase
                .from('customers')
                .insert([{
                    name: formData.name,
                    en_tolerance: formData.enTolerance,
                    boy_tolerance: formData.boyTolerance,
                    user_id: user.id
                }])

            if (insertError) throw insertError

            fetchCustomers()
            setIsAdding(false)
            setFormData({ name: '', enTolerance: 2, boyTolerance: 3 })
        } catch (err) {
            console.error('Error adding customer:', err)
            setError(err.message || "Müşteri eklenirken bir hata oluştu.")
        }
    }

    const handleDelete = async (id) => {
        const { error } = await supabase.from('customers').delete().eq('id', id)
        if (!error) fetchCustomers()
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 text-slate-900">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-extrabold text-slate-900">Müşteri Yönetimi</h1>
                    <p className="text-slate-500 mt-1">Siparişlerini yönetmek istediğiniz müşteriyi seçin veya yenisini ekleyin.</p>
                </div>
                <div className="flex gap-3">
                    {!isAdding && (
                        <button
                            onClick={() => setIsAdding(true)}
                            className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold py-3.5 px-8 rounded-2xl flex items-center gap-2 transition-all shadow-xl shadow-slate-200"
                        >
                            <Plus size={20} />
                            Yeni Müşteri Ekle
                        </button>
                    )}
                    <button
                        onClick={onLogout}
                        className="bg-red-50 hover:bg-red-100 text-red-600 font-bold px-5 py-3.5 rounded-2xl transition-all border border-red-100"
                    >
                        Çıkış Yap
                    </button>
                </div>
            </div>

            {isAdding && (
                <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-100 mb-8">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-slate-900">Yeni Müşteri Oluştur</h2>
                        <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600 font-medium">İptal</button>
                    </div>
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium">
                            {error}
                        </div>
                    )}
                    <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">

                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Müşteri Adı</label>
                            <input
                                type="text"
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 focus:ring-2 focus:ring-primary-500 outline-none"
                                placeholder="Örn: INC"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">En Toleransı (±%)</label>
                            <input
                                type="number"
                                step="0.1"
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 focus:ring-2 focus:ring-primary-500 outline-none"
                                value={formData.enTolerance}
                                onChange={(e) => setFormData({ ...formData, enTolerance: parseFloat(e.target.value) })}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-semibold text-slate-700">Boy Toleransı (±%)</label>
                            <input
                                type="number"
                                step="0.1"
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 focus:ring-2 focus:ring-primary-500 outline-none"
                                value={formData.boyTolerance}
                                onChange={(e) => setFormData({ ...formData, boyTolerance: parseFloat(e.target.value) })}
                            />
                        </div>
                        <button
                            type="submit"
                            className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg"
                        >
                            <CheckCircle size={20} />
                            Kaydet
                        </button>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center p-20">
                    <Loader2 className="animate-spin text-slate-300" size={40} />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {customers.map((customer) => (
                        <div key={customer.id} className="group bg-white rounded-2xl shadow-sm border border-slate-100 p-6 hover:shadow-xl hover:border-primary-100 transition-all duration-300">
                            <div className="flex justify-between items-start mb-4">
                                <div className="bg-primary-50 p-3 rounded-2xl text-primary-600">
                                    <Users size={24} />
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleDelete(customer.id)} className="p-2 text-slate-300 hover:text-red-600 transition-colors">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-2">{customer.name}</h3>
                            <div className="space-y-2 mb-6">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500">En Toleransı:</span>
                                    <span className="font-semibold text-slate-700">±{customer.enTolerance}%</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500">Boy Toleransı:</span>
                                    <span className="font-semibold text-slate-700">±{customer.boyTolerance}%</span>
                                </div>
                            </div>
                            <button
                                onClick={() => onSelectCustomer(customer)}
                                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-extrabold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all group/btn shadow-lg shadow-primary-200/40"
                            >
                                Müşteriyi Seç
                                <ChevronRight size={18} className="group-hover/btn:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
