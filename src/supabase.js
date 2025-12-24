import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let supabase
try {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('Supabase keys are missing! Check your .env file.')
        throw new Error('Missing keys')
    }
    supabase = createClient(supabaseUrl, supabaseAnonKey)
} catch (error) {
    // Fallback mock to prevent app crash and allow UI to render
    supabase = {
        auth: {
            getSession: () => Promise.resolve({ data: { session: null } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }),
            signInWithPassword: () => Promise.reject(new Error("Supabase keys are missing")),
            signUp: () => Promise.reject(new Error("Supabase keys are missing")),
            signOut: () => Promise.resolve()
        },
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: () => Promise.resolve({ data: null }),
                    order: () => ({})
                })
            }),
            insert: () => Promise.resolve({ error: null })
        })
    }
}

export { supabase }
