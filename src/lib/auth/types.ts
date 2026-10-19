// Auth seam (Phase 3).
//
// AuthContext imports an INTERFACE, never a concrete auth backend. This mirrors
// the storage-adapter seam: flipping VITE_STORAGE swaps both the data backend
// (supabaseAdapter <-> azureAdapter) AND the auth backend (supabaseAuth <->
// entraAuth) without any page/hook change.
//
// The app only ever needs an id (owner key) and an optional email (display).
// Keeping this shape tiny is what lets a Supabase `User` and an Entra principal
// both satisfy the same context value.

export interface AppUser {
  id: string
  email?: string
}

export interface AuthProviderImpl {
  /** Initial auth state on load (session restore / principal read). */
  getUser(): Promise<AppUser | null>
  /**
   * Subscribe to auth changes. Returns an unsubscribe fn. Backends that are
   * redirect-only (EasyAuth) have no client event stream and return a no-op.
   */
  onChange(cb: (user: AppUser | null) => void): () => void
  /** Begin sign-in. `provider` is only meaningful for the Supabase backend. */
  signIn(provider?: 'google' | 'github'): Promise<void>
  signOut(): Promise<void>
}
