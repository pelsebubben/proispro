// Auth middleware — derive `ownerId` from the Entra principal.
//
// In Azure, the SPA runs on Static Web Apps with built-in Entra EasyAuth. The
// API is attached as a SWA *linked backend*, so every proxied request carries
// an `x-ms-client-principal` header: base64-encoded JSON describing the signed-in
// user. We decode it, pull the Entra object id (`oid`) claim, and use THAT as the
// per-owner scoping key. This replaces Supabase RLS — `ownerId` is derived here,
// server-side, and is NEVER read from the request body (see routes/crud.ts).
//
// Trade-off named: we trust the forwarded header because the ACA ingress is meant
// to be locked down to the SWA proxy (see infra runbook). On a freely-public
// endpoint this header would be spoofable; the deployment, not this code, is the
// boundary. The documented fallback (MSAL + validate-JWT) would verify a bearer
// token instead — out of scope for this phase.
//
// Local dev: SWA isn't in front of us, so set DEV_AUTH_OWNER to any string and
// every request is treated as that owner. If DEV_AUTH_OWNER is unset AND no
// principal header is present, we reject with 401.

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

// The Entra object-id claim can arrive under several type URIs depending on the
// token/forwarding path. We match any of these (case-insensitive).
const OID_CLAIM_TYPES = [
  'http://schemas.microsoft.com/identity/claims/objectidentifier',
  'oid',
]

interface PrincipalClaim {
  typ?: string
  val?: string
}

interface ClientPrincipal {
  // EasyAuth / linked-backend shape.
  auth_typ?: string
  claims?: PrincipalClaim[]
  // SWA /.auth/me shape (used as a fallback).
  identityProvider?: string
  userId?: string
  userDetails?: string
  userRoles?: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    ownerId: string
  }
}

function decodePrincipal(headerValue: string): ClientPrincipal | null {
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf8')
    return JSON.parse(json) as ClientPrincipal
  } catch {
    return null
  }
}

function extractOwnerId(principal: ClientPrincipal): string | null {
  if (Array.isArray(principal.claims)) {
    for (const claim of principal.claims) {
      const typ = (claim.typ || '').toLowerCase()
      if (OID_CLAIM_TYPES.includes(typ) && claim.val) {
        return claim.val
      }
    }
  }
  // SWA fallback: userId is the provider-stable subject id.
  if (principal.userId) return principal.userId
  return null
}

/**
 * Resolve the owner id for a request, or null if unauthenticated.
 * Order: real principal header first, then the DEV_AUTH_OWNER bypass.
 */
export function resolveOwnerId(request: FastifyRequest): string | null {
  const header = request.headers['x-ms-client-principal']
  if (typeof header === 'string' && header.length > 0) {
    const principal = decodePrincipal(header)
    if (principal) {
      const oid = extractOwnerId(principal)
      if (oid) return oid
    }
  }

  const devOwner = process.env.DEV_AUTH_OWNER
  if (devOwner && devOwner.length > 0) {
    return devOwner
  }

  return null
}

/**
 * Fastify plugin: attaches an onRequest hook that sets `request.ownerId`.
 * Register this INSIDE the /api scope so /health stays unauthenticated.
 */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('ownerId', '')

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const ownerId = resolveOwnerId(request)
    if (!ownerId) {
      reply.code(401).send({
        error: 'unauthenticated',
        message:
          'No Entra principal. Expected x-ms-client-principal (SWA linked backend) or DEV_AUTH_OWNER for local dev.',
      })
      return reply
    }
    request.ownerId = ownerId
  })
}
