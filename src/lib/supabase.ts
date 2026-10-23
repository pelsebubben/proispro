import { createClient } from '@supabase/supabase-js'
import { runtime } from './runtime'

const SUPABASE_URL = 'https://odqhusmmqgipvazusrxs.supabase.co'
const SUPABASE_ANON = 'sb_publishable_p0KpjMepMloZb6SI-y6ang_2uzbdQ9U'

// Fix: Edge with Tracking Prevention blocks localStorage for cross-site origins
const authStorage = (() => {
  const mem: Record<string, string> = Object.create(null)
  const safe = <T,>(fn: () => T): T | null => {
    try {
      return fn()
    } catch {
      return null
    }
  }
  return {
    getItem(k: string): string | null {
      return safe(() => localStorage.getItem(k)) ?? mem[k] ?? null
    },
    setItem(k: string, v: string): void {
      safe(() => localStorage.setItem(k, v))
      mem[k] = v
    },
    removeItem(k: string): void {
      safe(() => localStorage.removeItem(k))
      delete mem[k]
    },
  }
})()

// Fix: navigator.locks race condition causes 15-25s login timeouts
const authLock = (() => {
  const pending = new Map<string, Promise<unknown>>()
  return <R,>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
    const tail = pending.get(name) ?? Promise.resolve()
    const next = tail.then(() => fn(), () => fn())
    pending.set(name, next.catch(() => {}))
    return next as Promise<R>
  }
})()

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: authStorage,
    lock: authLock,
    autoRefreshToken: runtime.dataBackend !== 'api' && runtime.identityReady,
    persistSession: runtime.dataBackend !== 'api' && runtime.identityReady,
    detectSessionInUrl: runtime.dataBackend !== 'api' && runtime.identityReady,
  },
})
