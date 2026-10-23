import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { runtime } from '../lib/runtime'

interface AppUser { id: string; email?: string }

interface AuthContextValue {
  user: AppUser | null
  error: string | null
  isLoading: boolean
  signIn: (provider: 'google' | 'github') => Promise<void>
  devSignIn: (user: string, passcode?: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!runtime.identityReady) {
      setIsLoading(false)
      return
    }
    if (runtime.dataBackend === 'api') {
      let active = true
      const load = runtime.devAuth
        ? import('../lib/devAuth').then(auth => auth.devUser())
        : import('../lib/entra').then(auth => auth.entraUser())
      load.then(value => {
        if (active) setUser(value)
      }).catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Sign-in failed')
      }).finally(() => {
        if (active) setIsLoading(false)
      })
      return () => { active = false }
    }
    // Get initial session
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      setUser(user)
      if (error) setError(error.message)
      setIsLoading(false)
    })

    // Subscribe to auth changes (handles OAuth redirect return)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (provider: 'google' | 'github') => {
    setError(null)
    try {
      if (!runtime.identityReady) throw new Error('Customer identity is not configured')
      if (runtime.dataBackend === 'api') await (await import('../lib/entra')).entraSignIn()
      else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider, options: { redirectTo: window.location.origin },
        })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    }
  }

  const devSignIn = async (name: string, passcode?: string) => {
    setError(null)
    try {
      if (!runtime.devAuth) throw new Error('Local sign-in is not available')
      setUser(await (await import('../lib/devAuth')).devSignIn(name, passcode))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    }
  }

  const signOut = async () => {
    setError(null)
    try {
      if (runtime.devAuth) (await import('../lib/devAuth')).devSignOut()
      else if (runtime.dataBackend === 'api') await (await import('../lib/entra')).entraSignOut()
      else {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      }
      setUser(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed')
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, error, signIn, devSignIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
