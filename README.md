# Griplock / ProIsPro

A personal disc golf inventory and bag tracker for the owner and friends.

## Stack

- React, TypeScript and Vite frontend.
- Plain Node HTTP API, served with the frontend in Azure Container Apps.
- Azure PostgreSQL, application-owned users and forced per-user row-level security.
- Entra External ID customer login; shared passcode login on dev only.
- One dev database/application and one production database/application.

Inventory, bags/history, collections, wishlist, sale listings/share links, course
pins and hole assignments all use `/api/v1`. Disc search uses a bundled DiscIt
snapshot, so typing never waits on an external service. Course search/maps use
OpenStreetMap Overpass. Anonymous sale links disclose only available listings while their
owner has explicitly enabled public sharing.

## Adding discs

Search by mold, manufacturer or special edition (for example, Origin or Midnight
Prowl II). The mold and optional Edition / Run are saved separately and are both
searchable in inventory. Missing catalogue entries can be added manually.
Arrow keys and Enter select a result; Escape, Tab or clicking another field
dismiss the list. [Catalogue sources and refresh instructions](docs/disc-catalog.md)
describe the bundled data and its deliberately limited special-edition coverage.

The Type selector and inventory filters include Utility. A personal JPEG, PNG
or WebP photo can be added, replaced or removed in Add/Edit Disc. Files up to
10 MB are resized in the browser before upload. The server validates and
re-encodes them to metadata-free JPEGs, at most 1024 pixels and 256 KiB.
Photos are private to their owner and stored in PostgreSQL, not a new cloud
service. Cancelling the form does not upload or save changes. Metadata and
photos save together; inventory responses contain photo references, not images.

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

Non-draft PRs deploy to shared dev; drafts run CI without replacing the dev app.
Marking a draft ready for review starts its deployment.
Successful main CI triggers the production release.
Azure dev/prod are the only supported deployments; standalone GitHub Pages
publishing is retired because it cannot serve the same-origin application API.
See [the delivery runbook](docs/github-pipelines.md) and
[customer/local login configuration](docs/customer-login.md).

## Data model

`server/migrations/` is the only active schema source. Version 2 expands the
original `owned_discs` table and adds bags, bag history, collections/membership,
wishlist items, sale listings/tokens, course pins and hole assignments. Runtime
roles never own tables or bypass RLS. Child relationships use owner-scoped
foreign keys; bag membership/history updates are transactional.
Version 3 adds edition names and private, owner-scoped disc photos. Deleting a
disc also deletes its photo.

This deployment starts with a fresh Azure dataset. No old records, identities
or objects are imported. The retired provider's remote resources remain
untouched; historical architecture notes are not active setup instructions.
