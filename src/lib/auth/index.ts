// Single accessor for the auth seam.
//
// AuthContext imports ONLY from here (`getAuthProvider()`), never from a concrete
// auth backend. The backend is selected by the SAME `VITE_STORAGE` switch that
// picks the storage adapter, so the toggle flips data + auth together:
//
//   VITE_STORAGE=azure      -> entraAuth    (+ azureAdapter)
//   unset / 'supabase'      -> supabaseAuth (+ supabaseAdapter)

import type { AuthProviderImpl } from './types'
import { supabaseAuth } from './supabaseAuth'
import { entraAuth } from './entraAuth'

const backend = (import.meta.env.VITE_STORAGE as string | undefined) ?? 'supabase'

export function getAuthProvider(): AuthProviderImpl {
  return backend === 'azure' ? entraAuth : supabaseAuth
}

export type { AppUser, AuthProviderImpl } from './types'
