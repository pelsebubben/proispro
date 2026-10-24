interface CustomerAccount {
  name?: string
  idTokenClaims?: Record<string, unknown>
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 320 && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : undefined
}

function email(value: unknown): string | undefined {
  const address = text(value)
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return undefined
  if (/@[^@]*\.onmicrosoft\.com$/i.test(address)) return undefined
  return address
}

export function customerProfile(account: CustomerAccount): { email?: string; name?: string } {
  const claims = account.idTokenClaims ?? {}
  const addresses: unknown[] = Array.isArray(claims.emails) ? claims.emails : []
  const address = email(claims.email) ?? addresses.map(email).find(Boolean)
  const candidate = text(claims.name) ?? text(account.name)
  const name = candidate && !/@[^@]*\.onmicrosoft\.com$/i.test(candidate) ? candidate : undefined
  return { email: address, name }
}
