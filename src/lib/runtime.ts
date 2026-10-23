interface RuntimeConfiguration {
  environment: string
  identityReady: boolean
  dataBackend?: 'api'
  entra?: { clientId: string; authority: string; scope: string }
}

declare global {
  interface Window {
    __GRIPLOCK_RUNTIME__?: RuntimeConfiguration
  }
}

export const runtime: RuntimeConfiguration = window.__GRIPLOCK_RUNTIME__ ?? { environment: 'legacy', identityReady: true }
