// Fastify bootstrap.
//
//  - GET /health            : unauthenticated liveness + DB connectivity probe.
//  - /api/*                 : authenticated (authPlugin derives request.ownerId),
//                             thin CRUD mirroring the StorageAdapter contract.
//
// Listens on PORT (default 3000, matching infra/modules/containerapps.bicep) and
// binds 0.0.0.0 so it is reachable inside the container.

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { authPlugin } from './auth'
import { pingDb } from './db'
import { registerDiscRoutes } from './routes/discs'
import { registerBagRoutes } from './routes/bags'
import { registerCoursePinRoutes } from './routes/coursePins'
import { registerCollectionRoutes } from './routes/collections'
import { registerWishlistRoutes } from './routes/wishlist'
import { registerForSaleRoutes } from './routes/forSale'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000
const HOST = process.env.HOST ?? '0.0.0.0'

export function buildServer() {
  const app = Fastify({
    logger: true,
    // Trust the SWA linked-backend proxy in front of us.
    trustProxy: true,
  })

  // CORS is only needed under the fallback topology (MSAL-in-SPA across two
  // origins). Under the linked backend everything is same-origin via the proxy.
  // CORS_ORIGIN is a comma-separated allowlist; unset => reflect same-origin only.
  const corsOrigin = process.env.CORS_ORIGIN
  app.register(cors, {
    origin: corsOrigin ? corsOrigin.split(',').map((s) => s.trim()) : false,
    credentials: true,
  })

  // Unauthenticated health check (liveness + DB reachability).
  app.get('/health', async (_request, reply) => {
    try {
      await pingDb()
      return { status: 'ok', db: 'up' }
    } catch (err) {
      app.log.error(err)
      return reply.code(503).send({ status: 'degraded', db: 'down' })
    }
  })

  // Everything under /api is authenticated and owner-scoped.
  app.register(
    async (api) => {
      // Apply the auth hook directly on this scope (NOT via register) so the
      // onRequest hook covers every route below. Registering it as a child
      // plugin would encapsulate the hook and leave the routes unauthenticated.
      await authPlugin(api)
      registerDiscRoutes(api)
      registerBagRoutes(api)
      registerCoursePinRoutes(api)
      registerCollectionRoutes(api)
      registerWishlistRoutes(api)
      registerForSaleRoutes(api)
    },
    { prefix: '/api' }
  )

  return app
}

async function main() {
  const app = buildServer()
  try {
    await app.listen({ port: PORT, host: HOST })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      app.log.info(`${signal} received, shutting down`)
      await app.close()
      process.exit(0)
    })
  }
}

if (require.main === module) {
  void main()
}
