// entraAuth — Entra ID (Azure AD) auth via Static Web Apps EasyAuth.
//
// Zero-SDK on purpose. SWA fronts the SPA, handles the Entra login, and exposes
// three built-in endpoints we simply navigate to / read:
//
//   /.auth/me          -> the signed-in principal (JSON)
//   /.auth/login/aad   -> start the Entra login (full-page redirect)
//   /.auth/logout      -> sign out (full-page redirect)
//
// There is NO MSAL here and that is deliberate: under SWA the proxy injects the
// principal and forwards `x-ms-client-principal` to the linked `/api` backend,
// so the browser never handles a token. MSAL is the documented fallback ONLY if
// the SPA ever leaves Static Web Apps (see docs/adr-azure-entra-rebuild.md §3.1);
// at that point this file is the single place that would change.

import type { AppUser, AuthProviderImpl } from './types'

interface ClientPrincipal {
  userId: string
  userDetails: string
  identityProvider: string
  userRoles?: string[]
}

interface AuthMeResponse {
  clientPrincipal: ClientPrincipal | null
}

function toAppUser(principal: ClientPrincipal | null): AppUser | null {
  if (!principal || !principal.userId) return null
  // For AAD, userDetails is typically the user's email / UPN. Only surface it as
  // an email when it looks like one; otherwise leave it undefined.
  const email =
    principal.userDetails && principal.userDetails.includes('@')
      ? principal.userDetails
      : undefined
  return { id: principal.userId, email }
}

export const entraAuth: AuthProviderImpl = {
  async getUser() {
    try {
      const res = await fetch('/.auth/me', { credentials: 'include' })
      if (!res.ok) return null
      const data = (await res.json()) as AuthMeResponse
      return toAppUser(data.clientPrincipal)
    } catch {
      // Unreachable endpoint (e.g. local dev without SWA) -> treat as signed out.
      return null
    }
  },

  onChange() {
    // EasyAuth is redirect-based: there is no client-side event stream. A sign-in
    // completes as a full-page redirect back from /.auth/login/aad, after which
    // getUser() re-reads /.auth/me on the fresh load. Nothing to subscribe to.
    return () => {}
  },

  async signIn() {
    const redirect = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.href = `/.auth/login/aad?post_login_redirect_uri=${redirect}`
  },

  async signOut() {
    window.location.href = '/.auth/logout'
  },
}
