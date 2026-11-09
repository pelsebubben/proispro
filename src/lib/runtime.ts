interface RuntimeConfiguration {
  environment: string
  identityReady: boolean
  dataBackend?: 'api'
  mockData?: boolean
  devAuth?: boolean
  devPasscode?: boolean
  entra?: { clientId: string; authority: string; scope: string }
}

declare global {
  interface Window {
    __GRIPLOCK_RUNTIME__?: RuntimeConfiguration
  }
}

const mockData = import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === '1'

export const runtime: RuntimeConfiguration = mockData
  ? { environment: 'mock-preview', identityReady: true, mockData: true }
  : window.__GRIPLOCK_RUNTIME__ ?? { environment: 'unconfigured', dataBackend: 'api', identityReady: false }
