import React, { useState } from 'react'
import { Mail, Lock, Building, User, ArrowRight, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'

export default function Register({ onRegister, onSwitchToLogin }) {
    const [formData, setFormData] = useState({
        companyName: '',
        fullName: '',
        email: '',
        password: ''
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            // 1. Sign up user
            const { data, error: signUpError } = await supabase.auth.signUp({
                email: formData.email,
                password: formData.password,
            })

            if (signUpError) throw signUpError

            if (data.user) {
                // 2. Create profile
                const { error: profileError } = await supabase
                    .from('profiles')
                    .insert([
                        {
                            id: data.user.id,
                            full_name: formData.fullName,
                            company_name: formData.companyName,
                            is_admin: false
                        }
                    ])

                if (profileError) throw profileError

                onRegister({
                    ...data.user,
                    name: formData.fullName,
                    company_name: formData.companyName
                })
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value })
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Hesap Oluştur</h1>
                    <p className="text-slate-500">Şirketiniz için yeni bir profil oluşturun</p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl font-medium">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-700 block mx-1">Şirket Adı</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <Building size={18} />
                            </div>
                            <input
                                type="text"
                                name="companyName"
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                placeholder="Örn: ABC Tekstil"
                                value={formData.companyName}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-700 block mx-1">Yetkili Adı</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <User size={18} />
                            </div>
                            <input
                                type="text"
                                name="fullName"
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                placeholder="Ad Soyad"
                                value={formData.fullName}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-700 block mx-1">E-posta</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <Mail size={18} />
                            </div>
                            <input
                                type="email"
                                name="email"
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                placeholder="ornek@sirket.com"
                                value={formData.email}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-slate-700 block mx-1">Şifre</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <Lock size={18} />
                            </div>
                            <input
                                type="password"
                                name="password"
                                required
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                placeholder="••••••••"
                                value={formData.password}
                                onChange={handleChange}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-primary-600 hover:bg-primary-700 text-white font-extrabold py-4 mt-6 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all transform hover:scale-[1.01] active:scale-95 shadow-xl shadow-primary-200/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? <Loader2 className="animate-spin" size={20} /> : "Hesabımı Oluştur"}
                        {!loading && <ArrowRight size={20} />}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <p className="text-slate-500 text-sm">
                        Zaten hesabınız var mı?{' '}
                        <button
                            onClick={onSwitchToLogin}
                            className="text-primary-600 hover:text-primary-700 font-bold"
                        >
                            Giriş Yapın
                        </button>
                    </p>
                </div>
            </div>
        </div>
    )
}
