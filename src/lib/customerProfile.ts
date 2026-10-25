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

function displayName(value: unknown): string | undefined {
  const name = text(value)
  if (!name || /^unknown$/i.test(name) || /@[^@]*\.onmicrosoft\.com$/i.test(name)) return undefined
  return name
}

export function customerProfile(account: CustomerAccount): { email?: string; name?: string } {
  const claims = account.idTokenClaims ?? {}
  const addresses: unknown[] = Array.isArray(claims.emails) ? claims.emails : []
  const address = email(claims.email) ?? addresses.map(email).find(Boolean)
  const name = displayName(claims.name) ?? displayName(account.name)
  return { email: address, name }
}
