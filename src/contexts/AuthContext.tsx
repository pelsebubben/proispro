import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { getAuthProvider, type AppUser } from '../lib/auth'

interface AuthContextValue {
  user: AppUser | null
  isLoading: boolean
  signIn: (provider?: 'google' | 'github') => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const auth = getAuthProvider()
    let mounted = true

    // Restore the initial session / read the principal.
    auth.getUser().then((u) => {
      if (!mounted) return
      setUser(u)
      setIsLoading(false)
    })

    // Subscribe to auth changes (Supabase OAuth redirect return; no-op on Entra).
    const unsubscribe = auth.onChange((u) => {
      if (mounted) setUser(u)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const auth = getAuthProvider()

  const signIn = async (provider?: 'google' | 'github') => {
    await auth.signIn(provider)
  }

  const signOut = async () => {
    await auth.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
