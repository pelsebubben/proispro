# Griplock / ProIsPro

A personal disc golf inventory and bag tracker for the owner and friends.

## Stack

- React, TypeScript and Vite frontend.
- Plain Node HTTP API, served with the frontend in Azure Container Apps.
- Azure PostgreSQL, application-owned users and forced per-user row-level security.
- Entra External ID customer login; shared passcode login on dev only.
- One dev database/application and one production database/application.

Inventory, bags/history, collections, wishlist, sale listings/share links, course
pins and hole assignments all use `/api/v1`. The public disc catalog uses DiscIt;
course search/maps use OpenStreetMap Overpass. Neither requires our database
credentials. Anonymous sale links disclose only available listings while their
owner has explicitly enabled public sharing.

## Local development

Install Node 22 and PostgreSQL (or use the included Docker Compose configuration).

```powershell
npm ci
$env:PGPASSWORD = '<local PostgreSQL admin password>'
$env:PGAPP_PASSWORD = '<32+ character local runtime password>'
docker compose up -d postgres
npm run build
npm run dev:server
```

Open `http://127.0.0.1:8080` and sign in as `alice` or `bob`. The startup script
applies checksum-guarded SQL migrations, then switches to a non-owner runtime
role. For hot reload in a second terminal:

```powershell
$env:GRIPLOCK_DEV_API = 'http://127.0.0.1:8080'
npm run dev
```

Without the API proxy/runtime configuration, the static preview intentionally
disables sign-in. There is no localStorage data fallback.

## Checks and deployment

```powershell
npm run check
npm run test:unit
npm run test:api
npm run build
npx playwright test
```

API tests require a disposable PostgreSQL database and `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGAPP_PASSWORD` (and `PGSSLMODE=disable` for
local PostgreSQL). Never point them at dev or production application data.

PRs deploy to shared dev. Successful main CI triggers the production release.
See [the delivery runbook](docs/github-pipelines.md) and
[customer/local login configuration](docs/customer-login.md).

## Data model

`server/migrations/` is the only active schema source. Version 2 expands the
original `owned_discs` table and adds bags, bag history, collections/membership,
wishlist items, sale listings/tokens, course pins and hole assignments. Runtime
roles never own tables or bypass RLS. Child relationships use owner-scoped
foreign keys; bag membership/history updates are transactional.

This deployment starts with a fresh Azure dataset. No old records, identities
or objects are imported. The retired provider's remote resources remain
untouched; historical architecture notes are not active setup instructions.
