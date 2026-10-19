// Single accessor for the storage seam.
//
// Hooks import ONLY from here (`getStorage()`), never from a concrete adapter or
// from `../lib/supabase` directly. That is what keeps the backend swappable.
//
// Phase 0: the only implementation is the SupabaseAdapter. The `VITE_STORAGE`
// switch is stubbed in now (defaulting to 'supabase') so that a future
// AzureAdapter can be slotted in here — and ONLY here — without touching a
// single hook:
//
// Phase 3 (see docs/adr-azure-entra-rebuild.md): the AzureAdapter branch is now
// wired below. `VITE_STORAGE=azure` selects the Azure REST backend (and, via the
// parallel auth seam in src/lib/auth, Entra EasyAuth); anything else stays on
// Supabase. Hooks are untouched — the switch lives ONLY here.

import { StorageAdapter } from './types'
import { supabaseAdapter } from './supabaseAdapter'
import { azureAdapter } from './azureAdapter'

export type StorageBackend = 'supabase' | 'azure'

const backend: StorageBackend =
  (import.meta.env.VITE_STORAGE as StorageBackend | undefined) ?? 'supabase'

export function getStorage(): StorageAdapter {
  switch (backend) {
    case 'azure':
      return azureAdapter
    case 'supabase':
      return supabaseAdapter
    default:
      // Unknown/future backends fall back to Supabase until their adapter is
      // implemented. Keeps the app booting if the env var is set ahead of time.
      return supabaseAdapter
  }
}

export type { StorageAdapter } from './types'
