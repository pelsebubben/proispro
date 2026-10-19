// supabaseAuth — the current Supabase auth logic, moved behind the auth seam.
//
// This is a verbatim lift of what used to live inline in AuthContext.tsx:
// getUser() restores the session, onChange() subscribes to OAuth redirect
// returns, signIn() kicks off the provider OAuth flow, signOut() clears it.
// Behaviour is unchanged — it is just addressable through AuthProviderImpl now.

import { supabase } from '../supabase'
import type { AppUser, AuthProviderImpl } from './types'

function toAppUser(u: { id: string; email?: string | null } | null | undefined): AppUser | null {
  if (!u) return null
  return { id: u.id, email: u.email ?? undefined }
}

export const supabaseAuth: AuthProviderImpl = {
  async getUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return toAppUser(user)
  },

  onChange(cb) {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      cb(toAppUser(session?.user ?? null))
    })
    return () => subscription.unsubscribe()
  },

  async signIn(provider = 'google') {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
  },

  async signOut() {
    await supabase.auth.signOut()
  },
}
