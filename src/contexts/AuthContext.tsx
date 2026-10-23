import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { runtime } from '../lib/runtime'
import { clearPhotoCache } from '../lib/data'

interface AppUser { id: string; email?: string }

interface AuthContextValue {
  user: AppUser | null
  error: string | null
  isLoading: boolean
  signIn: () => Promise<void>
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
  }, [])

  useEffect(() => {
    const expire = () => {
      setUser(null)
      setError('Your session expired. Please sign in again.')
    }
    window.addEventListener('griplock-session-expired', expire)
    return () => window.removeEventListener('griplock-session-expired', expire)
  }, [])

  const signIn = async () => {
    setError(null)
    try {
      if (!runtime.identityReady) throw new Error('Customer identity is not configured')
      await (await import('../lib/entra')).entraSignIn()
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
      else await (await import('../lib/entra')).entraSignOut()
      clearPhotoCache()
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
