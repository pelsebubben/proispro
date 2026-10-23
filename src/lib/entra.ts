import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser'
import { runtime } from './runtime'

let client: Promise<PublicClientApplication> | undefined

async function getClient() {
  const config = runtime.entra
  if (!config || !runtime.identityReady) throw new Error('Customer identity is not configured')
  client ??= (async () => {
    const instance = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: config.authority,
        knownAuthorities: [new URL(config.authority).hostname],
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    })
    await instance.initialize()
    const result = await instance.handleRedirectPromise({ navigateToLoginRequestUrl: false })
    if (result?.account) instance.setActiveAccount(result.account)
    else {
      const accounts = instance.getAllAccounts()
      if (accounts.length === 1) instance.setActiveAccount(accounts[0])
    }
    return instance
  })()
  try {
    return await client
  } catch (error) {
    client = undefined
    throw error
  }
}

export async function entraAccessToken() {
  const instance = await getClient()
  const account = instance.getActiveAccount()
  if (!account || !runtime.entra) return null
  try {
    return (await instance.acquireTokenSilent({ account, scopes: [runtime.entra.scope] })).accessToken
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) return null
    throw error
  }
}

export async function entraUser() {
  const instance = await getClient()
  const account = instance.getActiveAccount()
  if (!account) return null
  const accessToken = await entraAccessToken()
  if (!accessToken) return null
  const response = await fetch('/api/v1/session', {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
  })
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`Could not verify your application session (${response.status})`)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('userId' in data) || typeof data.userId !== 'string') {
    throw new Error('Invalid application session response')
  }
  return { id: data.userId, email: account.username }
}

export async function entraSignIn() {
  const instance = await getClient()
  if (!runtime.entra) throw new Error('Customer identity is not configured')
  await instance.loginRedirect({ scopes: [runtime.entra.scope], prompt: 'select_account' })
}

export async function entraSignOut() {
  const instance = await getClient()
  await instance.logoutRedirect({ account: instance.getActiveAccount() })
}
