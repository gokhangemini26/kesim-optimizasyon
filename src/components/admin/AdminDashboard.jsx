import React, { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { ArrowLeft, Users, Activity, Clock, Database, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function AdminDashboard() {
    const [logs, setLogs] = useState([])
    const [profiles, setProfiles] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const navigate = useNavigate()

    useEffect(() => {
        const fetchAdminData = async () => {
            setLoading(true)
            try {
                // Fetch logs with associated profiles
                const { data: logsData, error: logsError } = await supabase
                    .from('logs')
                    .select('*, profiles(full_name, email)')
                    .order('created_at', { ascending: false })

                if (logsError) throw logsError
                setLogs(logsData)

                // Fetch all profiles for summary
                const { data: profilesData, error: profilesError } = await supabase
                    .from('profiles')
                    .select('*')

                if (profilesError) throw profilesError
                setProfiles(profilesData)
            } catch (err) {
                console.error("Admin data fetch error:", err.message)
            } finally {
                setLoading(false)
            }
        }

        fetchAdminData()
    }, [])

    const filteredLogs = logs.filter(log =>
        log.profiles?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.profiles?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.action?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                    <div>
                        <button
                            onClick={() => navigate('/customers')}
                            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold transition-colors mb-2"
                        >
                            <ArrowLeft size={18} />
                            Ana Sayfaya Dön
                        </button>
                        <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
                            <Database className="text-primary-600" />
                            Yönetim Paneli
                        </h1>
                        <p className="text-slate-500">Kullanıcı aktiviteleri ve sistem logları</p>
                    </div>

                    <div className="relative w-full md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Kullanıcı veya işlem ara..."
                            className="w-full bg-white border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 focus:ring-2 focus:ring-primary-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </header>

                {/* Stats Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex items-center gap-4 text-primary-600 mb-2">
                            <Users size={24} />
                            <span className="font-bold text-sm uppercase tracking-wider">Toplam Kullanıcı</span>
                        </div>
                        <div className="text-3xl font-black text-slate-900">{profiles.length}</div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex items-center gap-4 text-emerald-600 mb-2">
                            <Activity size={24} />
                            <span className="font-bold text-sm uppercase tracking-wider">Bugünkü İşlemler</span>
                        </div>
                        <div className="text-3xl font-black text-slate-900">
                            {logs.filter(l => new Date(l.created_at).toDateString() === new Date().toDateString()).length}
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                        <div className="flex items-center gap-4 text-amber-600 mb-2">
                            <Clock size={24} />
                            <span className="font-bold text-sm uppercase tracking-wider">Son 1 Saat</span>
                        </div>
                        <div className="text-3xl font-black text-slate-900">
                            {logs.filter(l => new Date(l.created_at) > new Date(Date.now() - 3600000)).length}
                        </div>
                    </div>
                </div>

                {/* Logs Table */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                        <h2 className="font-bold text-slate-900 flex items-center gap-2">
                            İşlem Günlüğü
                            <span className="text-xs font-medium bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">Canlı Veri</span>
                        </h2>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white border-b border-slate-100">
                                    <th className="p-4 font-bold text-slate-500 text-xs uppercase tracking-widest">Zaman</th>
                                    <th className="p-4 font-bold text-slate-500 text-xs uppercase tracking-widest">Kullanıcı</th>
                                    <th className="p-4 font-bold text-slate-500 text-xs uppercase tracking-widest">İşlem</th>
                                    <th className="p-4 font-bold text-slate-500 text-xs uppercase tracking-widest">Detaylar</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="p-12 text-center text-slate-400 font-medium">Yükleniyor...</td>
                                    </tr>
                                ) : filteredLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="p-12 text-center text-slate-400 font-medium">Kayıt bulunamadı.</td>
                                    </tr>
                                ) : filteredLogs.map((log) => (
                                    <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                                        <td className="p-4 text-sm text-slate-500">
                                            {new Date(log.created_at).toLocaleString('tr-TR')}
                                        </td>
                                        <td className="p-4">
                                            <div className="font-bold text-slate-900">{log.profiles?.full_name || 'Bilinmiyor'}</div>
                                            <div className="text-xs text-slate-500">{log.profiles?.email}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-wider ${log.action === 'OPTIMIZATION_RUN' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'
                                                }`}>
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="p-4 text-sm font-medium text-slate-700">
                                            {log.details ? (
                                                <div className="flex gap-4">
                                                    <span>Müşteri: <span className="text-slate-900 font-bold">{log.details.customer}</span></span>
                                                    <span>Adet: <span className="text-slate-900 font-bold">{log.details.total_pieces}</span></span>
                                                    <span>Plan: <span className="text-slate-900 font-bold">{log.details.plans_count}</span></span>
                                                </div>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    )
}
