# proispro API

Thin, hand-written REST API: glue between the client's `StorageAdapter` /
`Collection<T>` contract (`src/lib/storage/types.ts`) and **Azure SQL**. Fastify +
TypeScript, packaged as a container for **Azure Container Apps** (ACA).

Boring on purpose. Every entity gets the same uniform CRUD. The only real logic is
the one security boundary: **`ownerId` comes from the verified Entra principal,
never from the request body**, and every query is parameterized and owner-scoped.

## Architecture (where this fits)

```
Browser ─▶ Static Web Apps (SPA + Entra EasyAuth)
                 │  linked backend: proxies /api/* and forwards
                 ▼  the x-ms-client-principal header
          Azure Container Apps ── this API ──▶ Azure SQL (serverless)
                 (Managed Identity token auth to SQL; no password)
```

See `docs/adr-azure-entra-rebuild.md` for the full decision record.

## Run locally

```bash
cd api
npm install
npm run dev     # tsx watch, reloads on change
# or: npm run build && npm start
```

### Environment variables

| Var                     | Purpose                                                                                 | Required                     |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| `PORT`                  | Listen port. Defaults to `3000` (matches the ACA Bicep module).                         | no                           |
| `HOST`                  | Bind address. Defaults to `0.0.0.0`.                                                     | no                           |
| `DEV_AUTH_OWNER`        | **Local dev auth bypass.** When set, every request is treated as this owner id (no SWA in front). | local only            |
| `SQL_SERVER`            | Azure SQL server FQDN, e.g. `myserver.database.windows.net`.                             | yes                          |
| `SQL_DATABASE`          | Database name.                                                                           | yes                          |
| `SQL_USER` / `SQL_PASSWORD` | Local SQL login. Presence of `SQL_PASSWORD` selects password auth (dev fallback).   | local (if not using a token) |
| `SQL_CONNECTION_STRING` | Alternative full connection string for local dev (wins over user/password).             | no                           |
| `SQL_PORT`              | SQL port for local dev. Defaults to `1433`.                                              | no                           |
| `SQL_TRUST_SERVER_CERT` | `true` to trust a self-signed cert (local SQL in Docker). No effect against Azure SQL.   | no                           |
| `AZURE_CLIENT_ID`       | User-assigned Managed Identity client id (set by ACA). Selects the identity for the SQL token. | Azure                  |
| `CORS_ORIGIN`           | Comma-separated allowlist. Only needed under the MSAL fallback (two origins).            | no                           |

Minimal local run against a local SQL Server:

```bash
export DEV_AUTH_OWNER="dev-owner-1"
export SQL_SERVER="localhost"
export SQL_DATABASE="proispro"
export SQL_USER="sa"
export SQL_PASSWORD="Your_Strong_Pass1"
export SQL_TRUST_SERVER_CERT="true"
npm run dev
```

First-time DB setup: run `db/schema.sql` against the target database
(`sqlcmd -S <server> -d <db> -i db/schema.sql`, or Azure Data Studio).

## Authentication

- **In Azure:** the SPA (Static Web Apps) authenticates with Entra EasyAuth and is
  linked to this API as a backend. SWA forwards the signed-in principal in the
  **`x-ms-client-principal`** header (base64 JSON). `src/auth.ts` decodes it and
  extracts the Entra **object id (`oid`)** claim as `ownerId`. Missing/invalid →
  **401**. The ACA ingress must be locked down to the SWA proxy — the deployment,
  not the code, is the trust boundary.
- **Locally:** set `DEV_AUTH_OWNER` to any string; every request is that owner.
  Without it (and without a principal header) requests get **401**.
- **To Azure SQL:** `DefaultAzureCredential` (Managed Identity, selected by
  `AZURE_CLIENT_ID`) gets an access token; no SQL password exists in Azure. The
  pool is rebuilt shortly before the token expires.

## REST surface

All `/api/*` routes require a principal (or `DEV_AUTH_OWNER`) and are scoped to
that owner. Bodies and responses are the **client-model shapes** from
`src/lib/storage/types.ts`. On upsert, `ownerId` is taken from the principal and
any `ownerId`/owner field in the body is ignored.

| Method & path                 | Maps to `Collection<T>` | Notes                                             |
| ----------------------------- | ----------------------- | ------------------------------------------------- |
| `GET /health`                 | —                       | Unauthenticated. Liveness + DB probe.             |
| `GET /api/{entity}`           | `list()`                | Owner-scoped, ordered (see below).                |
| `GET /api/{entity}/:id`       | `get(id)`               | Owner-scoped. `404` if not found.                 |
| `POST /api/{entity}`          | `put(item)`             | Upsert; `id` in body.                             |
| `PUT /api/{entity}/:id`       | `put(item)`             | Upsert; `id` from the URL.                         |
| `DELETE /api/{entity}/:id`    | `remove(id)`            | Owner-scoped. `204`, or `404` if not found.       |
| `GET /api/forsale/shared`     | `forSale.listShared()`  | **All owners'** `visibility='shared'` listings. Read-only. |

### Entities and ordering

| `{entity}`         | Table              | Client type       | `list()` order                     |
| ------------------ | ------------------ | ----------------- | ---------------------------------- |
| `discs`            | `discs`            | `ClientDisc`      | `added_at DESC`                    |
| `bags`             | `bags`             | `ClientBag`       | `created_at DESC`                  |
| `coursePins`       | `course_pins`      | `ClientPin`       | `created_at DESC`                  |
| `holeAssignments`  | `hole_assignments` | `HoleAssignment`  | `created_at ASC`                   |
| `collections`      | `collections`      | `ClientCollection`| `created_at DESC`                  |
| `wishlist`         | `wishlist_items`   | `WishlistItem`    | `priority DESC, created_at DESC`   |
| `forsale`          | `forsale_listings` | `ForSaleListing`  | `listed_at DESC`                   |

`forSale` listings additionally carry `visibility` (`'private'` | `'shared'`) and a
`seller_name` snapshot that power the `/api/forsale/shared` friends marketplace.

## Build / layout

```
api/
  src/
    server.ts         Fastify bootstrap, /health, /api scope + auth hook
    auth.ts           x-ms-client-principal decode -> ownerId (DEV_AUTH_OWNER bypass)
    db.ts             Azure SQL pool: Managed-Identity token or local password
    routes/
      crud.ts         generic, parameterized CRUD factory (the only "clever" bit)
      discs.ts bags.ts coursePins.ts collections.ts wishlist.ts forSale.ts
  db/schema.sql       Azure SQL (T-SQL) target schema
  Dockerfile          multi-stage build -> slim non-root node runtime (EXPOSE 3000)
```

`npm run build` runs `tsc` to `dist/`. The container runs `node dist/server.js`.
