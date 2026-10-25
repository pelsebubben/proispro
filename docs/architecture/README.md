# Griplock architecture and maintenance

This is the current, source-backed architecture of the first working version.
It describes configured code and infrastructure, not an audit of the live Azure
tenant. Runtime code, SQL migrations and active delivery workflows outrank prose.
Earlier stack decisions in `.squad/decisions.md`, `PRODUCT.md` and historical
sections of other plans are not instructions for the current deployment.

## Architecture drawings

| Drawing source | Question it answers |
| --- | --- |
| [Runtime](runtime.architecture.json) | Where do the browser, identity, API, provider cache and durable data run? |
| [Authenticated request](request.sequence.json) | Who verifies identity, establishes the owner and applies row-level security? |
| [Production delivery](delivery.workflow.json) | Which checks, image, jobs and evidence gate a production release? |

Every node cites source lines. CI and production generate standalone interactive
HTML drawings from these sources using the pinned Archify renderer. Download the
`architecture-<source-sha>-<run-id>` artifact from the Actions run, extract it and
open `index.html`. The bundle contains the drawings, prepared source-linked JSON,
this reference, validation/browser receipts and `release.json` with the exact
source SHA and HTML hashes. No external service receives application source.
HTML is a build artifact, not a second hand-maintained source of truth or a
public application endpoint. GitHub does not render downloaded HTML inline.

## System and module boundaries

Keep the modular monolith for this scale. React and the plain Node HTTP API ship
in **one Node 24 OCI image**, serving assets and `/api/v1` from the same origin.
There is no API gateway, Kubernetes cluster, Redis, hosted Supabase or DAB in the
active runtime. The bundled disc catalogue requires no live search provider.

| Boundary | Owns | Source of truth |
| --- | --- | --- |
| Browser | Pages, navigation, inventory/bag UI, auth UX, photo crop | `src/App.tsx`, `src/pages/`, `src/components/` |
| Client access | Runtime configuration, MSAL, authenticated API calls, error/change events | `src/lib/`, `src/contexts/`, `src/hooks/` |
| HTTP composition | Static files, health/config endpoints, token/scope validation, route dispatch | `server/index.mjs`, `server/app.mjs`, `server/identity.mjs` |
| Feature API | Validated resource CRUD, photos, bag transactions, anonymous sale projection | `server/features.mjs`, `server/photo.mjs` |
| Private planner | Layouts, active/per-layout plans, concurrency versions, packing summaries | `server/planner.mjs` |
| Course provider | PDGA login/search/logout, exact identities, layouts/maps, bounded SQL cache | `server/courses.mjs`, `server/pdga-*.mjs` |
| Persistence | Connections, transaction-local owner, append-only schema migrations | `server/database.mjs`, `server/migrate.mjs`, `server/migrations/` |
| Delivery | CI, image publication, private test/migration jobs, rollout verification | `.github/workflows/{ci,architecture,prod,dev,infra}.yml`, `infra/`, `scripts/` |

Pages call shared hooks/access helpers, never PostgreSQL or PDGA credentials.
Do not introduce a second API client or direct provider calls inside UI controls.
Keep ownership and validation in the API/database even when the browser checks
the same inputs. Extract domain helpers when a handler grows; do not split into
services merely to rename directories.

## Identity, public routes and ownership

Customer login uses Entra External ID through MSAL in the browser, with separate
browser and API registrations and one delegated API scope. Public runtime
configuration contains identifiers, never credentials. The API verifies
asymmetric JWT signatures against the configured JWKS, issuer, audience and scope.
It maps `(issuer, subject)` to its own `app_users.id`; callers cannot choose it.
See [customer login](../customer-login.md) for registration/configuration details.

`asUser` begins a transaction and sets `app.user_id` locally on the checked-out
connection. Forced PostgreSQL RLS and owner-scoped child keys enforce isolation.
Runtime roles are not table owners and cannot bypass RLS. Migration/test jobs
have a distinct administrative purpose; do not use their credentials in the app.

The intentional unauthenticated surfaces are static assets, runtime/auth config,
health and exact enabled sale-token reads. Public sales expose only available
listing snapshots, not inventory, owner photos or arbitrary resource CRUD.
Hosted shared-passcode login is dev-only; local impersonation is loopback-only.
Neither is a production customer-login fallback.

## Data and lifecycle

`server/migrations/` and the checksum-guarded migration runner define the schema.
Do not edit applied migrations. Add a migration and update `schemaVersion` and
release/readiness assertions together.

| Domain | Durable data and lifetime |
| --- | --- |
| Users/inventory | `app_users`, `owned_discs`, owner-only `disc_photos`; photos normalized by the API and stored as JPEG bytes in PostgreSQL |
| Bags | `bags.disc_ids` JSON membership and transactional `bag_history`; one inventory disc may be in several bags |
| Collections/wishlist | `collections`, `collection_discs`, `wishlist_items`; owner-scoped |
| Sharing | `forsale_listings` snapshots and `sale_tokens`; anonymous access requires explicitly enabled exact token |
| Planning | `course_pins` links course and bag; `private_layouts` reused within an owner's course; `private_plans` keeps selections/notes per layout, with one active plan per pin |
| Legacy assignments | `hole_assignments` remains for existing analytics; it is not the new private planner's source of truth |
| Provider cache | Shared `provider_cache.entries` and `control`; strict 24-hour expiry, 500-entry bound, cross-replica miss budget/locks and cooldown |

PDGA facts are temporary cache data, not copied into private layouts. Provider
layouts persist IDs and optional private names; manual layouts persist the
player's permitted observations. Course maps remain hosted by PDGA and appear
once above the layout. Private selections survive provider outages, but expired
provider facts are not served. Cache hits need no new provider request; one
uncached REST search includes login, query and logout. Details are in
[course retention and rate limits](../course-catalogue.md).

Bag readiness counts unique selected discs, including alternatives. It reports
membership, not a physical packing check or a fully planned round. Removing a
bag deletes its links/history, not discs. Removing a disc cleans bag membership
and saved selections. Layout deletion is blocked while plans reference it.
Never infer current-hole geometry from a whole-course map or historical event.

## Deployment and failure boundaries

The supported live site is `griplock.no` on Azure Container Apps. The names
`rg-griplock-staging`, `app-griplock-staging` and several job names are retained
identifiers for the **live** stack, not proof of a third environment.
`app-griplock-dev` is shared, disposable dev. Both use one Container Apps
environment/VNet and one private PostgreSQL 16 server, with separate `griplock`,
`griplock_dev` and `griplock_verify` databases/runtime roles. This is logical data
separation, not independent infrastructure or failure isolation.

`infra/staging.bicep` configures separate apps/PostgreSQL subnets, private DNS,
database public-access denial, 7-day backups, no HA, Log Analytics and finite jobs.
`infra/app.bicep` configures external HTTPS ingress, probes and image-pull
identity. ACR and its pull identity/RBAC are administrator-bootstrapped.
The provisioned locked storage account has no active application photo/upload
path. Photos live in PostgreSQL. Do not draw it as an active dependency.

Main push CI must succeed for the exact source commit. Production regenerates
architecture drawings **before** building or obtaining a cloud identity. It
publishes one image to ACR, deploys by digest, verifies the disposable private
database, conditionally backs up live before schema changes, migrates live/dev,
then rolls out live/dev and waits for matching SHA/schema readiness. Protected
PDGA settings are applied server-side. Deployed browser checks precede the
verified-release manifest. The architecture artifact proves documentation
generation, not that rollout or real customer login succeeded.

Non-draft same-repository PRs can deploy independently to shared dev. That workflow
does not wait for Required CI; production does. Prod and foundation changes share
a non-cancelling lock; shared dev has its own cancelling lock. A prod reset can
race a dev branch deployment: do not assume the dev URL still serves your branch.
Consult the health SHA and [delivery runbook](../github-pipelines.md).

## Review findings and scoped follow-ups

| Priority | Finding | Maintenance response |
| --- | --- | --- |
| Now | Architecture knowledge was split across obsolete stack notes and historical release plans | Use this reference plus executable evidence; historical material is explicitly marked, not silently treated as current |
| Now | No documentation gate or source-linked production diagrams | Required CI plus pre-build production generation; no docs-not-needed bypass for integrity checks |
| Next | Generic CRUD and planner handlers contain several domains; hooks can independently reload the same data | Preserve current boundaries; extract small tested domain helpers when touching them, rather than replacing the stack |
| Next | Migration history is guarded, but recovery still needs a documented restore rehearsal | Rehearse restore on a disposable database before relying on recovery time; deployment success is not a restore test |
| Next | One shared host/environment and no database HA are deliberate single-instance-scale tradeoffs | Revisit availability and independent dev isolation if usage/criticality grows; do not provision a second stack in a docs change |
| Next | Legacy hole assignments and private plans use different analytics paths | Agree on analytics semantics before retiring legacy tables or migrating data |

This review does not claim load-test capacity, successful live restore, production
cloud-policy compliance or exploitability assessment. No runtime refactor,
infrastructure replacement or live configuration change is part of this work.

## Change workflow and documentation contract

1. Identify the owning boundary above and make the smallest complete change.
2. Update/add focused contract tests. Exercise API ownership and real PostgreSQL
   for data changes, and desktop/mobile behavior for UI changes.
3. Update this reference or [review history](reviews.md) in the same change.
   Revise diagrams for changed components, calls, trust boundaries or release
   gates. Even a no-topology-change dependency bump needs a brief impact note.
4. Review the cited source lines, then run `npm run docs:refresh` and
   `npm run docs:check`. Refresh records reviewed hashes; it does not infer
   architecture or prove that the prose is accurate.
5. Commit the reviewed sources, specs, prose and evidence together. Generate the
   exact-commit bundle locally or let required CI generate it. Inspect the
   downloadable drawings before merging a topology change.

The evidence ledger includes architecture-relevant `src`, `server`, `infra`,
`scripts`, delivery workflows, build manifests and Docker/Vite configuration.
It detects modified, added and deleted inputs (with CRLF normalized), edited
specs/prose and missing or out-of-range citations. The PR/main-diff guard also
requires a Markdown impact assessment, so refreshing hashes alone is not enough.
Full history is needed for `--base`. No labels, cloud credentials or live PDGA
queries are needed. Semantic correctness still requires human review.

```powershell
npm run docs:check
npm run docs:check -- --base origin/main
# Only after reviewing the affected docs and diagrams:
npm run docs:refresh
```

For local generation, use Node 24, `npm ci`, and a clean checkout of
`tt-a1i/archify` at `51a291770851ad27a400cca73c753c166b5e0c65`. No Archify npm
installation is required. The reusable workflow checks out that exact revision.

```powershell
$env:ARCHIFY_CLI = '<pinned checkout>\archify\bin\archify.mjs'
npx --no-install playwright install chromium
$env:ARCHIFY_CHROME = node --input-type=module -e 'import {chromium} from "@playwright/test"; console.log(chromium.executablePath())'
npm run docs:build
# Open architecture-report\index.html after all three finalize gates pass.
```

The builder refuses uncommitted architecture inputs: source links must identify
committed bytes, not claim that working-tree edits existed at HEAD. Each finalize
run includes schema/layout, artifact/provenance and real-browser checks. Reports
stay outside the runtime container and are retained for 30 days as Actions
artifacts; source specifications and the evidence ledger remain in Git.
Renderer/action upgrades must update the pin, lock assertions and reviewed
evidence together. Do not call an automated layout check a visual review.
