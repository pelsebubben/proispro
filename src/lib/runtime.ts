declare global {
  interface Window {
    __GRIPLOCK_RUNTIME__?: { environment: string; identityReady: boolean }
  }
}

export const runtime = window.__GRIPLOCK_RUNTIME__ ?? { environment: 'legacy', identityReady: true }
