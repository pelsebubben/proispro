# Griplock infrastructure and application lifecycle plan

> Historical proposal. Current implementation and owner scope supersede the
> migration/copy phases below: one dev and one production app, plain Node API,
> native PostgreSQL schema, fresh data and no legacy provider SDK or imports.
> See README.md and the delivery runbook for active setup.

Status: Architecture proposal, 2026-10-23. Confirmed constraints are distinguished
from recommendations. Initial GitHub pipeline definitions and a staging
resource-group template are now implemented; see
[the pipeline runbook](github-pipelines.md). The staging OIDC bootstrap and
private registry exist. The portable API/runtime, private PostgreSQL and
Container Apps templates, and staged release workflow are implemented; consult
the runbook for verified deployment state, not this architecture proposal.

## Outcome and confirmed constraints

Give Griplock (the application currently named ProIsPro) its own reproducible
build, test, release, deployment, recovery,
and retirement lifecycle before undertaking the product refactor.

- Target fully Azure-hosted infrastructure through a staged migration.
- Use GitHub Actions for delivery.
- Keep operations simple and the user experience responsive.
- Preserve the ability to port the application to another host.
- PostgreSQL is the preferred database direction.
- A Kubernetes test cluster is available, not a production requirement.
- Support a future mobile app without replacing the backend.
- Budget is flexible; obtain a regional cost estimate before provisioning.
- Adopt Griplock naming before provisioning. Plan `griplock.no` and
  `staging.griplock.no`; DNS cutover, tenant-domain changes, and repository rename
  are separate actions. Existing mail and tenant ownership remain unchanged.
- Approved agents may deploy and iterate in staging; production requires owner
  approval. See [the detailed pipeline plan](pipeline-agent-delivery-plan.md).

## Discovery: existing plans and implementation

The repository contains historical Azure decisions, not a current replacement
infrastructure plan. Searches of GitHub issues and PRs for infrastructure,
architecture, Azure, and migration did not identify a current rewrite proposal.
This is a bounded search, not proof that no external plan exists.

`.squad/decisions.md` records an earlier Static Web Apps / CosmosDB / Data API
Builder approach followed by its abandonment and Azure cleanup. Some superseded
entries still say "Active." `docs/lessons-learned.md` explains that migration.
Do not resurrect the old design or treat its service-status claims as current
vendor documentation.

Current repository evidence:

| Surface | Evidence | Migration consequence |
|---------|----------|-----------------------|
| Web app | React / TypeScript / Vite in `package.json` | Retain initially; no frontend rewrite needed for infrastructure |
| Deployment | `.github/workflows/deploy.yml` builds and publishes to GitHub Pages | Introduce staged Azure releases before replacing live deployment |
| Data access | Hooks call Supabase directly | Introduce an application-owned API boundary |
| Authentication | `src/contexts/AuthContext.tsx` uses Supabase OAuth and user types | Replace sessions and map identities explicitly |
| Authorization | SQL uses `auth.uid()` and foreign keys to `auth.users` | Plain PostgreSQL is not a drop-in replacement |
| Photos | Supabase Storage design in `docs/adr-disc-photo-storage.md` | Audit active usage, copy objects, preserve references |
| Server function | `supabase/functions/identify-disc/index.ts` | Audit invocation; migrate or explicitly defer this capability |
| Configuration | `src/lib/supabase.ts` contains a fixed project endpoint | Separate environment configuration from release artifacts |
| Schema history | SQL exists in both `docs/` and `supabase/migrations/` | Reconcile with actual deployed schema before establishing a baseline |

This inspection did not access live Azure or Supabase resources. Production
schema, data volumes, storage usage, traffic, and actual enabled login providers
must be inventoried before migration.

## Recommended target: a small modular monolith

Use one repository and one deployable OCI image containing the built React app
and a TypeScript HTTP API. Keep business logic in ordinary modules, not separate
microservices. The API serves static assets and `/api/v1` on the same origin.

| Concern | Recommendation | Reason |
|---------|----------------|--------|
| Compute | Azure Container Apps | Managed container runtime, HTTPS ingress, health checks, release revisions |
| Database | Azure Database for PostgreSQL flexible server | Managed operations with standard PostgreSQL data and tooling |
| Photos and objects | Azure Blob Storage | Durable objects outside disposable application containers |
| Registry | Azure Container Registry | Immutable release images, managed-identity pull access |
| Infrastructure | Small Bicep deployment with environment parameters | Reproducible Azure resources without a new orchestration platform |
| Secrets | Key Vault references and managed identities where supported | Keep credentials out of artifacts and source |
| Customer identity | Evaluate Microsoft Entra External ID | Azure-managed candidate; provider compatibility is a blocking decision |
| Observability | Structured logs, basic metrics, uptime alerts | Diagnose failures without deploying a separate monitoring stack |
| Local development | Containers for the app and standard PostgreSQL | Reproduce the application without an Azure subscription |

Container Apps is preferred for the image-based release model, not because the
application needs microservices. App Service running the same container is a
valid alternative if existing organizational hosting makes it simpler. Confirm
the choice and regional costs before implementing either.

Do not add AKS, Helm, a service mesh, Redis, an API gateway, event streaming,
Dapr, or a CDN by default. Add a component only for a demonstrated requirement.
Provider-specific course fetching belongs behind the API; a database cache or
scheduled job is introduced only when permitted and necessary.

### Kubernetes and portability

Containers do not require a user-operated Kubernetes cluster. Use the existing
cluster only as an optional portability test, deploying the same image with
external configuration and a test PostgreSQL instance.

Running PostgreSQL on Kubernetes is possible, but adds persistent-volume,
operator, backup, upgrade, and recovery responsibilities. Prefer Azure-managed
PostgreSQL for production. A successful container deployment alone does not
prove database or identity portability.

Portability means:

- Standard HTTP API and PostgreSQL, with no client dependency on an Azure SDK.
- Environment-supplied endpoints, credentials, port, and identity settings.
- Business logic independent of Azure hosting and storage clients; isolate
  provider-specific calls without building a generic cloud framework.
- Stable object keys rather than permanent provider URLs as domain identifiers.
- Exportable data and objects, documented restore steps, and a non-Azure smoke
  test. Identity is a separately managed migration dependency.

Bicep is intentionally Azure-specific. Porting will require new infrastructure
definitions; the promise is portable application/data, not unchanged cloud IaC.

## Identity, authorization, and mobile

Do not write a custom password system. Evaluate a managed customer identity
provider and prove the required login flows before committing to it.

Entra External ID in a customer external tenant is the recommended candidate,
separate from the existing workforce directory. Microsoft documents Google
federation supporting personal Google accounts. Prove the configured end-to-end
flow, account linking, mobile support, pricing, and issuer migration before
cutover. Email one-time code is a proposed alternative, not a confirmed product
requirement. GitHub OAuth support must not be assumed from general OIDC support.
Changing existing login options requires an explicit product decision.

Maintain an application-owned user ID and an identity mapping keyed by issuer
and subject. Preserve existing ownership IDs where practical. Do not merge
accounts solely because email addresses match. Existing Supabase sessions cannot
be assumed transferable; plan verified relinking and reauthentication.

All private API operations must validate identity and enforce ownership. Move
`auth.users` references to application-owned users. Replace Supabase-specific
RLS functions explicitly. Recommended defense in depth: API ownership checks
plus PostgreSQL RLS using transaction-local user context, a restricted non-owner
runtime role, and tests proving connection pooling cannot leak user context.
Use a separate privileged migration role.

Future mobile clients consume the same `/api/v1` contract, not database tables.
Use standard authorization-code flows with PKCE for public clients, system
browser sign-in, and platform-secure token storage. Choose the web session
approach alongside identity implementation; cookie-based sessions require CSRF
protection, and bearer APIs require proper audience/scope validation.

Publish an OpenAPI contract and keep compatible API versions while older mobile
releases remain supported. A native framework, app-store pipeline, offline sync,
and push notifications are not required for this infrastructure milestone.

## Environments and release lifecycle

Use local development, one Azure staging environment, and production. Staging
must not use production identities, secrets, private objects, or mutable data.
Prefer a separate production database server; use synthetic staging fixtures.

1. PR: install locked dependencies, type-check/build, run focused unit/API tests,
   integration tests against PostgreSQL, and critical browser journeys.
2. Merge: build the image once, record its digest and source commit, scan it,
   and publish an immutable release artifact.
3. Deploy staging: apply reviewed infrastructure changes, run serialized
   migrations from the release image, and deploy that exact digest.
4. Verify: readiness, login, cross-user isolation, disc/configuration operations,
   object access, and course-search failure handling.
5. Promote: approve production through a protected GitHub environment where
   supported; otherwise use a controlled manual release workflow. Promote the
   same digest, not a rebuilt image.
6. Observe: gate traffic on readiness and smoke checks; roll back the application
   revision if required and schema-compatible.

Use GitHub-to-Azure OIDC federation with environment-scoped least privilege,
not long-lived deployment passwords. Bootstrap federation and permissions
separately with explicit authorization. Serialize deployments per environment.
Do not run migrations independently in every application replica.

Keep public runtime settings separate from the image so promotion does not
require recompilation. Frontend settings must contain no secrets. Build-time
Vite variables alone do not meet this build-once/promote requirement.

## Responsiveness and reliability

Start with at least one warm production application replica and colocate app,
database, and object storage in a suitable European region. Staging may scale
to zero. One replica avoids scale-from-zero delay, but is not high availability.
Decide whether production needs multiple replicas and database HA separately.

Use database connection pooling, ownership/search indexes, bounded pagination,
compressed responses, and cache headers for hashed static assets. Keep writes
durable before presenting them as saved. Course-provider calls need timeouts,
bounded retries, and explicit failure states, not live provider requests on
every render.

Proposed performance acceptance, to approve before implementation:

- On a defined mid-range mobile device and representative Nordic mobile-network
  profile, p75 LCP <= 2.5 seconds and INP <= 200 ms for the core web journey.
- At 20 concurrent active sessions, with fixtures of up to 1,000 owned discs
  and 50 configurations per test user, p95 first-party CRUD API latency
  <= 500 ms and unexpected errors < 1% over a 10-minute test.
- Measure external course-search latency separately; agree its budget after
  provider selection rather than hiding it in CRUD results.

These are proposed budgets, not measured current performance or traffic forecasts.
Record exact device/network settings, fixture sizes, and results in the eventual
test implementation. Increase load based on observed usage.

Use readiness/liveness endpoints, request IDs, latency/error monitoring, bounded
log retention, and alerts without logging tokens or sensitive user payloads.
Estimate compute, PostgreSQL/HA, storage, registry, identity, logs, backups, and
egress together; no unverified monthly price is committed here.

## Staged migration and exit gates

Keep infrastructure migration separate from the course/configuration UX redesign.
No production changes should happen as a side effect of this planning work.

### 0. Inventory and decisions

Confirm region, active providers, production schema and volumes, required
features, availability expectations, recovery objectives, and cost estimate.
Reconcile SQL history and test a complete backup restore. Inventory public
legacy routes as well as the React app so deployment does not silently remove
them. Exit: approved runtime, identity feasibility, schema baseline, and runbook.

### 1. Portable application boundary

Add the API, OpenAPI contract, health endpoints, container build, and local
PostgreSQL setup. Move browser data calls behind the API incrementally, initially
retaining Supabase persistence/auth where necessary. Keep one source of truth;
do not introduce uncoordinated dual writes.

Maintain a verified per-user authorization context for transitional Supabase
access. Do not replace browser RLS with an unrestricted service-role proxy.
Exit: representative owned-disc/configuration journeys work through the API,
with two-user isolation and integration tests.

### 2. Azure staging and lifecycle

Introduce Bicep and GitHub release workflows, then deploy synthetic data to
staging. Establish environment separation, secrets, logs, alerts, and a tested
rollback. Exit: repeatable deploy/promotion and local or Kubernetes smoke test
using the identical release image.

### 3. Data, objects, and identity rehearsal

Transform the actual schema into portable PostgreSQL migrations. Inventory
extensions, views, triggers, defaults, and RLS; do not restore all Supabase
internal schemas blindly. Rehearse data/object copy and verified identity
mapping. Validate counts, object checksums, ownership, relationships, and
representative user journeys. Preserve old storage URLs until references are
mapped or compatibility routing is available.

Move active edge-function behavior into the API or explicitly approve its
deferral. The existing identify-disc function calls Gemini; "Azure-hosted
infrastructure" does not implicitly approve a model/provider change.

Exit: successful restoration, account recovery/relinking, authorization tests,
performance checks, and an agreed cutover/rollback procedure.

### 4. Controlled production cutover

Prefer an announced short read-only window over custom dual-write replication
at this scale. Confirm acceptable downtime first. Freeze old writes, take the
final backup/copy, verify it, deploy, change routing, and smoke-test before
reopening writes. Freeze or disable old write endpoints for stale clients too;
a DNS change alone does not prevent writes to the old system.

Before Azure accepts writes, rollback can return traffic to the frozen source.
After Azure accepts writes, redirecting to stale Supabase would lose changes.
Freeze and reconcile new writes or fix forward under the rehearsed procedure.
Keep the old system read-only for an agreed retention period.

### 5. Retire and begin product refactor

After verification and retention, obtain approval to retire Supabase, obsolete
GitHub Pages deployment, stale credentials, and transitional code. Update
historical architecture status rather than erasing its record.

Exit: all retained capabilities use the Azure target, backup/restore and image
rollback are demonstrated, ownership is intact, and a portability smoke test
passes. Then implement the course-specific MVP against the new API.

## Recovery and unresolved approvals

Application rollback is not database rollback. Use expand/contract migrations;
delay destructive changes until old revisions and clients no longer need them.
Use managed point-in-time recovery plus portable exports and object backups,
with a rehearsed restore to a separate target.

Before provisioning, approve region/sizing, identity and login continuity,
HA, backup retention, recovery point/time objectives, allowable cutover
downtime, networking, and a priced resource list. Prefer private database
connectivity; ensure the migration runner has an explicit secure access path
without opening the database broadly to CI addresses.

Before implementation, approve the API framework and migration tooling; a small
TypeScript backend reuses current skills, but is a recommendation, not a mandate.
No Kubernetes production commitment or mobile app build is implied.

## Official documentation checked

Checked 2026-10-23; recheck availability, region support, and pricing when
implementing. These sources support service capabilities, not a cost estimate:

- [Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview)
- [Container Apps scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)
- [Container Apps release revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
- [Container Apps GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions)
- [GitHub Actions OIDC to Azure](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
- [Managed PostgreSQL overview](https://learn.microsoft.com/en-us/azure/postgresql/overview)
- [Container Apps secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
- [Entra External ID overview](https://learn.microsoft.com/en-us/entra/external-id/customers/overview-customers-ciam)
- [Google customer federation](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-google-federation-customers)
- [App Service alternative](https://learn.microsoft.com/en-us/azure/app-service/overview)
