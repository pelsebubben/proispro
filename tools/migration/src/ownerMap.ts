import * as fs from 'fs'
import { ParsedArgs, getString } from './args'

// Resolves a Supabase source user_id -> Entra object id (oid) that becomes the
// Azure SQL `ownerId`. We NEVER guess an ownerId: if a row's user_id cannot be
// resolved, import aborts with a clear error.
//
// Two mechanisms (mutually usable together; --owner is the fallback default):
//   --owner <oid>              stamp EVERY row with this one oid (single-user run)
//   --owner-map owner-map.json { "<supabase_user_id>": "<entra_oid>", ... }
//
// Precedence: an explicit map entry wins; otherwise the single --owner default
// is used; otherwise it is an error.

export class OwnerResolver {
  private readonly map: Map<string, string>
  private readonly fallback: string | undefined
  private readonly seenUnmapped = new Set<string>()

  constructor(map: Record<string, string>, fallback: string | undefined) {
    this.map = new Map(Object.entries(map))
    this.fallback = fallback
  }

  resolve(userId: unknown): string {
    const key = userId == null ? '' : String(userId)
    const mapped = this.map.get(key)
    if (mapped) return mapped
    if (this.fallback) return this.fallback
    this.seenUnmapped.add(key)
    throw new Error(
      `No ownerId mapping for Supabase user_id "${key}". ` +
        `Provide --owner <entra_oid> (single user) or add it to --owner-map JSON.`
    )
  }

  get hasAnyMapping(): boolean {
    return this.map.size > 0 || this.fallback != null
  }

  get unmapped(): string[] {
    return [...this.seenUnmapped]
  }
}

function isGuidish(s: string): boolean {
  // Entra oids are GUIDs. We validate shape (not existence) to catch typos.
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    s
  )
}

export function buildOwnerResolver(args: ParsedArgs): OwnerResolver {
  const owner = getString(args, 'owner')
  const ownerMapPath = getString(args, 'owner-map')

  let map: Record<string, string> = {}
  if (ownerMapPath) {
    if (!fs.existsSync(ownerMapPath)) {
      throw new Error(`--owner-map file not found: ${ownerMapPath}`)
    }
    const raw = fs.readFileSync(ownerMapPath, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      throw new Error(`--owner-map is not valid JSON: ${(e as Error).message}`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('--owner-map must be a JSON object of { "user_id": "entra_oid" }.')
    }
    map = parsed as Record<string, string>
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== 'string') {
        throw new Error(`--owner-map value for "${k}" must be a string oid.`)
      }
      if (!isGuidish(v)) {
        console.warn(
          `[owner-map] warning: oid "${v}" for user_id "${k}" does not look like a GUID.`
        )
      }
    }
  }

  if (owner && !isGuidish(owner)) {
    console.warn(`[owner] warning: --owner "${owner}" does not look like a GUID oid.`)
  }

  const resolver = new OwnerResolver(map, owner)
  if (!resolver.hasAnyMapping) {
    throw new Error(
      'You must supply an ownerId source: --owner <entra_oid> and/or --owner-map <file.json>. ' +
        'Refusing to guess ownership.'
    )
  }
  return resolver
}
