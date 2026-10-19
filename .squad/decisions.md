# Squad Decisions

## Architecture & Design

### Static Vanilla Stack — No Build Pipeline
**By:** Danny (Lead) | **Date:** 2026-04-13 | **Status:** Active

Ship vanilla HTML, CSS, and JavaScript directly to hosting with no bundler, build step, or compilation.

**Rationale:** Simplicity justified for single-user inventory tool. Vanilla JS sufficient for CRUD + filtering. No tree-shaking, minification, or module system needed for <50KB assets. Instant deployment.

**Implementation:** `index.html` (DOM + modals), `styles.css` (400L responsive grid), `app.js` (all business logic).

---

### Primary Storage: CosmosDB via Data API Builder
**By:** Danny (Lead) | **Date:** 2026-04 | **Status:** **Superseded** (Azure/Entra rebuild, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** by the **Azure-hosted, Entra-authenticated, multi-user rebuild** ADR (2026-10-19). Already de-facto superseded by the Supabase migration; the earlier "Active (Migrated)" label was stale. New DB target is **Azure SQL serverless** behind a thin Functions API.

CosmosDB container `discs` is the source of truth. All CRUD operations route through DAB REST endpoints (`/api/Disc`).

**Rationale:** Durable, multi-region capable backend. Eliminates localStorage-clear data loss risk. Real-time consistency across tabs/devices. Fallback to localStorage if DAB unavailable (offline resilience).

**Trade-off:** Requires backend deployment + CosmosDB instance (breaks GitHub Pages simplicity). Stateful — single-tenant assumption still holds.

**Migration:** From localStorage-first + GitHub file backend to CosmosDB as primary.

---

### GitHub Sync Feature: Removed (Deprecated)
**By:** Rusty (Frontend Dev) | **Date:** 2026-04-15 | **Status:** Deprecated

GitHub sync feature removed from frontend entirely. No longer supported.

**Context:** GitHub sync was a workaround from pre-database era. CosmosDB/DAB is now authoritative backend. GitHub sync code added ~250 lines of complexity (PAT management, settings modal, SHA conflict handling, retry logic).

**Removal:** All GitHub integration code eliminated from `app.js` and `index.html`:
- Constants: `GH_TOKEN_KEY`, `GH_OWNER_KEY`, `GH_REPO_KEY`, `GH_PATH_KEY`
- Functions: `toBase64`, `fromBase64`, `getGitHubConfig`, `githubLoad`, `githubSave`, `triggerGitHubSync`, `timeSince`, `setSyncStatus`, `openSettingsModal`, `closeSettingsModal`, `saveSettingsHandler`, `testConnectionHandler`
- UI: Settings button, `#syncStatus` div, entire settings modal overlay
- Retained: `STORAGE_KEY` + localStorage fallback for local dev without SWA CLI

**Verification:** Grep confirmed zero dangling GitHub symbol references.

---

### Browser-First Storage with localStorage Fallback
**By:** Danny (Lead) | **Date:** 2026-04-13 | **Status:** Active (Updated)

localStorage serves as fallback cache. Primary source of truth is now CosmosDB via DAB.

**Rationale:** Offline-first resilience (app uses stale localStorage if DAB unavailable). DAB is immediate + durable. Trade-off: localStorage may lag behind CosmosDB for multi-device scenarios (single-user app, acceptable).

**Implementation:** Load on boot from DAB. Fall back to localStorage if DAB unavailable. Cache writes to localStorage on every mutation for offline resilience.

---

### Hosting: Azure Static Web Apps + CDN
**By:** Linus (DevOps) | **Date:** 2026-04-14 | **Status:** **Superseded** (Azure/Entra rebuild, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** by the **Azure-hosted, Entra-authenticated, multi-user rebuild** ADR (2026-10-19). Already de-facto superseded by Supabase + GitHub Pages; the "Active (Migrated)" label was stale. The rebuild returns to **SWA** but with a **hand-written Azure Functions API (not DAB)** + Entra EasyAuth.

Host static frontend + DAB backend on Azure SWA (free tier).

**Rationale:** Single deployment target. DAB runtime integrated with SWA (no separate Functions needed). Automatic HTTPS, CDN-backed. Free tier sufficient for single-user app.

**Trade-off:** Vendor lock-in to Azure (was GitHub-portable before). More opaque infrastructure (SWA + DAB + CosmosDB).

**Implications:** CNAME still points to proispro.com (now Azure SWA hostname). SSL auto-managed by Azure. No GitHub Actions deploy workflow needed.

**Migration:** From GitHub Pages to Azure SWA.

---

### Data Schema — Flat Array + Immutable IDs (User Inventory)
**By:** Danny (Lead) | **Date:** 2026-04-13 | **Status:** Active

Single array of disc objects in user inventory. Each disc: id + 10 standard fields + timestamps.

**Schema:**
```json
{
  "id": "timestamp-based-uid",
  "name": "Destroyer",
  "manufacturer": "Innova",
  "type": "distance",
  "plastic": "Star",
  "weight": 175,
  "color": "Red",
  "condition": "good",
  "flight": "12 / 5 / -1 / 3",
  "notes": "Favorite hyzer flip disc",
  "addedAt": 1681234567000
}
```

**Rationale:** Flat array (no joins, easy JSON serialization). Immutable IDs collision-resistant. `addedAt` enables sorting + audit trail. Trade-off: no relational constraints; app validates schema.

---

### Disc Catalog Schema — CosmosDB NoSQL
**By:** Basher (Data Wrangler) | **Date:** 2026-04-14 | **Status:** **Superseded** (Azure/Entra rebuild, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** by the **Azure-hosted, Entra-authenticated, multi-user rebuild** ADR (2026-10-19). CosmosDB/DAB access is retired; the catalog moves to the new **Azure SQL serverless** schema behind the thin Functions API.

Separate public disc catalog in Cosmos DB (read-only reference data). Partition key: `/manufacturer`.

**Core Fields:**
- `id` — kebab-case identifier: `{manufacturer}-{name}-{plastic}` (e.g., `innova-destroyer-champion`)
- `manufacturer` (partition key) — e.g., "Innova", "Discraft"
- `name` — disc model name
- `type` — one of: "Distance Driver", "Fairway Driver", "Midrange", "Putter"
- `plastic` (array) — all plastics available (e.g., `["Champion", "Star", "DX"]`)
- `speed`, `glide`, `turn`, `fade` — flight ratings (numeric for range queries + sorting)
- `weightMin`, `weightMax` — available weight range in grams
- `description`, `imageUrl`, `approved`, `pdgaClass`, `discontinued`, `updatedAt` (ISO 8601)

**Design Rationale:**
- **Partition key:** `/manufacturer` provides ~10-20 logical partitions (major brands). Enables queries like "all Innova discs" (single partition) + "all Putters" (acceptable cross-partition).
- **Flight numbers as separate fields:** Enables OData queries (`speed ge 12 and fade ge 3`) + sorting (`orderby=speed desc`). Cannot do with composite string.
- **`plastic` as array:** Same mold in different plastics shares all specs. Array allows "all Champion plastic" queries without data duplication.
- **`weightMin`/`weightMax`:** Catalog describes what's manufactured, not specific disc in bag. Enables "lightweight distance drivers" queries.

**Access Control:** Read-only via DAB (anonymous reads, no writes).

---

### Conflict Resolution: Last-Write-Wins
**By:** Danny (Lead) | **Date:** 2026-04-13 | **Status:** Active

No conflict detection. Latest write always wins.

**Rationale:** Single user/device, no concurrent edits. Complex resolution overkill. Trade-off: multiple tabs editing same disc — last DAB write wins (acceptable).

---

### UI Framework: Vanilla — Semantic HTML + CSS Grid
**By:** Danny (Lead) | **Date:** 2026-04-13 | **Status:** Active

Vanilla HTML + CSS Grid + DOM manipulation. No React, Vue, or framework.

**Rationale:** Bundle <50KB (framework overhead >100KB would double it). Transparent code (frameworks raise barrier). Instant iteration (no build step). Trade-off: manual DOM updates, more state tracking. Fine for <1000 lines.

---

### Error Handling: Graceful Degradation
**By:** Danny (Lead) | **Date:** 2026-04-13 | **Status:** Active

If DAB fails, app continues with stale localStorage. Toast notifies user.

**Rationale:** Offline-first (user doesn't lose data). Transparency. Trade-off: stale data may not reflect latest server state.

---

### Authentication: GitHub OAuth via Azure SWA
**By:** Basher (Data Wrangler) | **Date:** 2026-04-15 | **Status:** **Superseded** (Azure/Entra rebuild, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** by the **Azure-hosted, Entra-authenticated, multi-user rebuild** ADR (2026-10-19). Already superseded by Supabase GitHub OAuth; the rebuild standardizes on **Entra ID via SWA built-in auth (EasyAuth)** with server-derived `ownerId`.

All access gated behind GitHub OAuth authentication via Azure Static Web Apps.

**Implementation:**
- Route config (`staticwebapp.config.json`) requires `authenticated` role for all routes except `/.auth/*`
- Unauthenticated requests to any route → 302 redirect to `/.auth/login/github`
- GitHub OAuth → SWA issues encrypted session cookie
- Subsequent requests carry session cookie → SWA validates → user has `authenticated` role
- DAB validates session → `authenticated` role required for Disc entity operations

**Auth Model:** Single user (GitHub account = single user identity). No multi-user isolation.

**Rationale:** Personal inventory tool, no business case for public access. GitHub OAuth is zero-config on SWA. Single-user assumption baked into UI.

**Trade-off:** App inaccessible to users without GitHub account (acceptable: personal tool). First-time experience shows GitHub OAuth screen (expected for this auth model).

---

### Data API Builder Access Control
**By:** Basher (Data Wrangler) | **Date:** 2026-04-15 | **Status:** **Superseded** (Azure/Entra rebuild, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** by the **Azure-hosted, Entra-authenticated, multi-user rebuild** ADR (2026-10-19). DAB is retired as the API tier; access control moves to **per-owner scoping in the hand-written Functions API** (Entra principal → `ownerId`).

DAB Disc entity requires `authenticated` role. CORS restricted to `https://proispro.com`.

**Configuration:**
- `permission.role`: `"authenticated"` (no anonymous access)
- `CORS.origins`: `["https://proispro.com"]` (known production domain only)

**Rationale:** Data is private (authenticated users only). CORS tightening needed for write operations (no wildcard). Reads/writes both require authentication.

---

### DAB REST Endpoint Path in SWA
**By:** Danny (Lead) | **Date:** 2026-04-15 | **Status:** **Superseded** (Azure/Entra rebuild, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** by the **Azure-hosted, Entra-authenticated, multi-user rebuild** ADR (2026-10-19). DAB (`/data-api/rest/*`) is retired; the rebuild uses a hand-written **Azure Functions API at `/api/*`**. Kept for history / the DAB scar.

In Azure Static Web Apps, DAB REST API is served at `/data-api/rest/{entity}`, NOT `/api/{entity}`. The `/api/` path is reserved for Azure Functions.

**Implementation:** `API_BASE` in app.js uses `/data-api/rest/Disc` (not `/api/Disc`). SWA config routes `/data-api/*` for DAB, not `/api/*` for DAB. Auth lockdown (authenticated) applies to `/data-api/` routes.

**Rationale:** Confirmed by live 404 error when calling `/api/Disc`; corrected to `/data-api/rest/Disc`. This is the correct DAB endpoint structure in SWA.

**Impact:** Never debug by opening DAB endpoints to 'anonymous' — always lock to 'authenticated'.

---

### No Backend Server — Serverless DAB
**By:** Danny (Lead) | **Date:** 2026-04 | **Status:** **Superseded** (Azure/Entra rebuild, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** by the **Azure-hosted, Entra-authenticated, multi-user rebuild** ADR (2026-10-19). The "zero custom code via DAB" approach is explicitly reversed — the rebuild uses a **thin, hand-written Azure Functions API** precisely because managed DAB-in-SWA was deprecated.

Data API Builder provides serverless REST layer. No custom Node.js functions or databases to manage.

**Rationale:** DAB auto-generates REST endpoints from Cosmos DB schema. Zero custom code. Role-based access control out-of-the-box. Cost-effective (free tier).

**Trade-off:** Vendor lock-in to Azure (not portable to other clouds). More opaque infrastructure compared to GitHub Pages simplicity.

**Migration:** From no backend (GitHub Pages) to serverless DAB + CosmosDB.

### DAB Retirement & Migration to Supabase
**By:** Danny (Lead) | **Date:** 2026-04-20 | **Status:** Completed & Live (Supabase target later **Superseded by the Azure/Entra rebuild**)

> **⚠️ Supabase target superseded by the Azure/Entra rebuild** (ADR 2026-10-19, `docs/adr-azure-entra-rebuild.md`). **The DAB-deprecation lesson/scar below remains in force** — it is exactly why the rebuild's API tier is a hand-written **Azure Functions** layer, **not** managed DAB.

Azure Static Web Apps Database Connections (DAB) was retired November 30, 2025. We debugged a deprecated feature for days before discovering this. **Complete migration:** Supabase PostgreSQL (backend) + Alpine.js (frontend) + GitHub Pages (hosting).

**Why Supabase won:**
- Standard PostgreSQL (portable, not vendor-locked)
- Row-Level Security (RLS) provides security without server code
- Built-in GitHub OAuth (zero custom auth logic)
- Free tier sufficient (500MB database, unlimited requests)
- No build step needed (GitHub Pages + CDN, instant deploys)

**Learnings captured in `docs/lessons-learned.md`:** Always check service deprecation FIRST when debugging managed platform failures. "Works locally ≠ works in production" when local tooling bundles its own runtime. Simpler stacks (Supabase + GitHub Pages) beat complex ones (SWA + CosmosDB + DAB) for small apps.

**Status:** Live at proispro.com. Cloud sync working. Zero 500 errors.

---

### Hosting: GitHub Pages + Custom Domain (Supabase Backend)
**By:** Linus (DevOps) | **Date:** 2026-04-20 | **Status:** **Superseded by the Azure/Entra rebuild** (at cutover)

> **⚠️ Superseded by the Azure/Entra rebuild** (ADR 2026-10-19, `docs/adr-azure-entra-rebuild.md`) — GitHub Pages + Supabase is replaced by **Azure SWA + Azure SQL serverless + Entra ID** at the DNS cutover window.

Host static frontend on GitHub Pages at proispro.com. Backend is Supabase (not SWA).

**Rationale:** Zero-config hosting. Push to main → deployed. Custom domain + SSL auto-managed. Static site works perfectly with Supabase client-side SDK (no server-side code needed).

**Trade-off:** GitHub Pages is not a dynamic platform (but we don't need one — Supabase handles all state).

**Replaces:** Azure Static Web Apps (vendor lock-in, operational overhead).

---

### GitHub Codespaces: Zero-Dependency devcontainer
**By:** Danny (Lead) | **Date:** 2026-04-16 | **Status:** Active

Add `.devcontainer/devcontainer.json` to support GitHub Codespaces for the proispro static site (Alpine.js + Supabase).

**Configuration:**
- **Base image:** `mcr.microsoft.com/devcontainers/base:ubuntu` — lightweight, no Node toolchain overhead
- **Extensions:** Live Server (ritwickdey.LiveServer), Prettier, Supabase VS Code, GitHub PRs
- **Port forwarding:** 5500 (Live Server default), opens in preview pane automatically
- **No postCreateCommand** — project has zero build dependencies

**Alternatives Considered:**
| Option | Pros | Cons | Decision |
|---|---|---|---|
| `npx serve` in postCreateCommand | Fully auto-starts server | Requires Node runtime, adds dependency | ❌ Rejected |
| Node devcontainer image | Full Node ecosystem available | Overkill for a zero-build static site | ❌ Rejected |
| Base Ubuntu + Live Server | Minimal, matches project philosophy | One manual click to "Go Live" | ✅ Chosen |

**Trade-off:** Live Server doesn't auto-start in Codespaces — developer clicks "Go Live" button in VS Code status bar. This acceptable to preserve zero-dependency constraint.

**Rationale:** Consistent with "boring technology" principle. No Node runtime, no build pipeline. Project is pure HTML/CSS/JS; Live Server provides identical static preview experience with one extra click.

---

### OKLCH Color Palette — Perceptually Uniform
**By:** Saul (Color Expert) | **Date:** 2026-04-13 | **Status:** Active

All `:root` color tokens use OKLCH instead of hex/HSL. Hex originals retained as inline comments.

**Why OKLCH:**
- Perceptual lightness uniform across ALL hues (L=0.75 looks equally bright for purple, green, amber, red)
- Badge uniformity: All four disc type badges pinned to L=0.75, C=0.18; only hue varies (impossible to guarantee with hex)
- Predictable adjustments: Nudging L/C/H produces expected results (HSL doesn't)
- Browser support: Chrome 111+, Firefox 113+, Safari 15.4+ (all modern)

**Color Tokens:**

**Surfaces (dark navy, H≈264°, C=0.03):**
- `--clr-bg`: `oklch(0.16 0.03 264)` ≈ #0f172a
- `--clr-surface`: `oklch(0.22 0.03 264)` ≈ #1e293b
- `--clr-surface2`: `oklch(0.26 0.03 264)` ≈ #273549
- `--clr-border`: `oklch(0.32 0.03 264)` ≈ #334155

**Text:**
- `--clr-text`: `oklch(0.96 0.005 264)` ≈ #f1f5f9 (near-white)
- `--clr-muted`: `oklch(0.67 0.04 264)` ≈ #94a3b8 (secondary)

**Accent (cyan, H=204°, C=0.12):**
- `--clr-accent`: `oklch(0.82 0.12 204)` ≈ #22d3ee (primary CTA)
- `--clr-accent2`: `oklch(0.60 0.12 204)` ≈ #0891b2 (secondary)

**Semantic:**
- `--clr-danger`: `oklch(0.63 0.22 25)` ≈ #ef4444 (destructive)

**Type Badges (L=0.75, C=0.18, hue-only variation):**
- `--putter`: `oklch(0.75 0.18 295)` — purple
- `--midrange`: `oklch(0.75 0.18 155)` — green
- `--fairway`: `oklch(0.75 0.18 70)` — amber
- `--distance`: `oklch(0.75 0.18 25)` — red

**Accessibility:**
- Text on background: ~14:1 contrast (WCAG AAA)
- Muted text: ~5.5:1 (WCAG AA)
- Badges on backgrounds: ~5–6:1 (WCAG AA normal text)

---

### Disc Color Palette — 10 Vivid OKLCH Swatches
**By:** Saul (Color Expert) | **Date:** 2026-04-14 | **Status:** Approved

---

### Rebuild on lightweight, Supabase-free, local-first architecture
**By:** Danny (Lead / Architect) | **Date:** 2026-10-19 | **Status:** **Superseded by the Azure/Entra rebuild** (ADR 2026-10-19, `docs/adr-azure-entra-rebuild.md`)

> **⚠️ Superseded** — the new **multi-user** requirement (sharing with friends → shared hosted DB) voids the single-user, no-auth, local-first (IndexedDB/Dexie) plan. Retained for history; see *Azure-hosted, Entra-authenticated, multi-user rebuild* above.

**Decision:** Plan to rebuild `proispro` as a **local-first** app — persist to **IndexedDB via Dexie** behind a single **storage-adapter (repository) seam**, **drop auth entirely**, and use **JSON export/import** for backup + portability + one-time Supabase migration. Retire the orphaned `identify-disc` edge function and the dormant `disc-photos` Storage bucket. Keep React + hooks + `utils/disc.ts`. Full plan: `docs/adr-supabase-free-rebuild.md`.

**Primary:** IndexedDB/Dexie, no backend. **Fallback (deferred):** Turso/libSQL or Cloudflare D1 + tiny Worker behind the *same* adapter interface, only if auto multi-device sync becomes a hard requirement.

**Trade-offs named:**
- Gain: zero backend/secrets/RLS/OAuth, offline-first, tiny attack+review surface, $0 infra, ends doc drift.
- Lose: per-device data (mitigated by export + optional later sync); **public for-sale share URL (`sale.html?token`) is the one genuine feature regression** without a server.

**IMPORTANT — documentation drift to correct (Phase 5):**
- `team.md` Tech Stack says **Alpine.js** → reality is **React 18 + TS + Vite 6**.
- `decisions.md` marks **CosmosDB via DAB** and **Azure Static Web Apps** as *Active* → reality is **Supabase + GitHub Pages** (`deploy.yml`). These entries are **stale/superseded** and must be corrected.

**Also note:** the `identify-disc` edge function and Supabase Storage photo upload have **no callers in `src/`** today — retiring them is cleanup, not feature loss.

**Rebuild sequence:** seam → swap → delete (Phase 0 adapter seam over current Supabase; 1 Dexie adapter; 2 export/migration; 3 remove `@supabase/supabase-js` + `supabase/`; 4 retire legacy Alpine files; 5 fix docs; 6 optional sync).

---

### Azure-hosted, Entra-authenticated, multi-user rebuild
**By:** Danny (Lead / Architect) | **Date:** 2026-10-19 | **Status:** Active (Proposed — supersedes local-first ADR)

> **⚠️ Compute/API tier REVISED — 2026-10-19 (Danny).** The **managed-Azure-Functions-in-SWA API** specified below is now replaced by a **conventional long-running HTTP server packaged as a container on Azure Container Apps (ACA)**, with the React SPA staying on SWA and ACA attached as a **linked backend** (Entra EasyAuth still forwards `x-ms-client-principal`). See *Compute/API Tier Revision — Functions-in-SWA → Container API on Azure Container Apps* below and `docs/adr-azure-entra-rebuild.md`. **Everything else in this decision still stands:** Entra ID auth, Azure SQL serverless, the storage-adapter seam, per-owner `ownerId` scoping, **NO Supabase**, **NO managed DAB**.

**Requirement change:** proispro is now **multi-user** — Anders will share it with friends, so it needs a **real, shared, hosted database** (not per-device local storage). This **voids** the earlier single-user assumption and **withdraws** the local-first (IndexedDB/Dexie, no-auth) recommendation.

**Decision (the architecture):**
- **Preferred cloud: Azure** (Anders has a full Entra ID environment + tooling).
- **Hosting: Azure Static Web Apps (SWA)** — static React SPA + built-in Entra auth + managed Azure Functions API, one deploy target.
- **Database: Azure SQL Database, serverless (auto-pause)** — relational, boring SQL, near-$0 idle cost at hobby scale. Fallback: Cosmos DB serverless (free tier) behind the same API.
- **API: thin hand-written managed Azure Functions** (REST, ~one handler set per entity). **Not** Data API Builder — the managed DAB-in-SWA feature was retired 2026-11-30 (prior team scar); DAB only as a self-hosted fallback.
- **Auth: Entra ID via SWA built-in authentication (EasyAuth)** — no MSAL code. Server derives `ownerId` from the Entra principal (`x-ms-client-principal` / `oid`) and scopes every query — **replaces Supabase RLS**. Friends invited as **Entra B2B guest users**; no RBAC.
- **Multi-tenancy:** per-owner rows (`ownerId` on every entity) + one `visibility:'shared'` for-sale surface (authenticated friends-only marketplace, replacing the old anonymous `sale.html?token` link).
- **Keep the storage-adapter seam:** new `AzureAdapter` is the only client code that knows the transport; UI/hooks unchanged.
- **IaC:** `azd` (Azure Developer CLI) + Bicep. **No Supabase, no microservices, no event sourcing** — one SPA + one thin API + one DB.

**Trade-offs named:** hand-written CRUD (vs DAB's zero code) to own our fate and avoid a deprecated dependency; SQL cold-start after idle (vs always-on cost); a DNS cutover window (Pages → SWA); no anonymous public share link; no photo upload in v1.

**Supersedes:** the local-first ADR (`danny-supabase-free-rebuild`, "Rebuild on lightweight, Supabase-free, local-first architecture") and all prior Cosmos/DAB/SWA-DB-Connections and Supabase + GitHub Pages architecture/hosting/auth entries (annotated **Superseded** in this file). The **DAB-deprecation lesson** (`docs/lessons-learned.md`) stays in force — it is why the API tier is Functions, not DAB.

**Docs:** `team.md` stack is wrong (says Alpine.js) — update to React 18 + TS + Vite + Azure SWA + Azure SQL serverless + Functions + Entra ID, **multi-user**. Full plan: `docs/adr-azure-entra-rebuild.md` (revises/supersedes `docs/adr-supabase-free-rebuild.md`).

**Phasing / owners:** Phase 0 seam (Rusty) → 1 provision Azure/IaC/Entra app reg (Linus) → 2 schema + thin API (Danny) → 3 AzureAdapter + Entra wiring (Rusty) + sign-in/sharing UX (Livingston) → 4 Supabase→Azure SQL migration tooling (Basher) + hosting cutover (Linus) → 5 delete Supabase + legacy Alpine → 6 fix docs (Danny + Scribe).

---

### Compute/API Tier Revision — Functions-in-SWA → Container API on Azure Container Apps

**Status:** Active — 2026-10-19 — Danny (Lead / Architect). Requested by Anders (AK).
**Refines (does not supersede):** the Active "Azure-hosted, Entra-authenticated, multi-user rebuild" decision and `docs/adr-azure-entra-rebuild.md`. Only the **compute/API tier** changes; everything else in that ADR stands.

**Context / trigger.** Anders gave two signals that touch only compute: (1) *"create an infrastructure where I can scale a bit more"* → wants real horizontal headroom; (2) *"Functions is hard to work with"* → the Azure Functions programming model (triggers/bindings, stateless handlers, cold starts, awkward local dev) is a developer-experience pain point. Developer experience is now a first-class, heavily-weighted requirement.

**Decision.**
- **API tier:** move off **managed Azure Functions-in-SWA** onto a **conventional long-running HTTP server** (recommended: **Node + Fastify + TypeScript**; ASP.NET Minimal API is an accepted alternative) packaged as a **container on Azure Container Apps (ACA, Consumption)**. **PRIMARY.** **Fallback compute:** **Azure App Service (Web App for Containers)** — same image, always-warm PaaS, at the cost of an idle floor. **AKS rejected** (operational overhead unjustified for tens of users). Keep **Dapr OFF**.
- **Frontend:** the **React SPA stays on Azure Static Web Apps** (static CDN). The ACA API is **attached to SWA as a linked backend**.
- **Auth adjustment:** keep **Entra ID via SWA EasyAuth**; with the API in a separate tier, SWA's **linked backend proxies `/api/*` to ACA and forwards `x-ms-client-principal`** → the server still derives `ownerId` with **near-zero auth code**. Caveats: SWA **Standard** tier, one linked backend, supported region, and **ACA ingress must be locked to the proxy** (never trust the principal header on an independently-public endpoint). **Documented fallback:** **MSAL-in-SPA + a small validate-JWT middleware** (two origins + CORS + a second app registration) if linked-backend constraints bite.
- **Scaling:** ACA **HTTP autoscale** on concurrent requests; `minReplicas 0..1`, `maxReplicas 3`. **Scale-to-zero (minReplicas:0) is the default** (~$0 idle, few-second cold start); flip to `minReplicas:1` only if first-load latency annoys. Honest ceiling: tens of users → 1–2 replicas suffice; this is a replica count, not an orchestration platform.
- **IaC/CI:** `azd` + Bicep now provisions **SWA + ACA env + API container app + Azure Container Registry (ACR) + Azure SQL serverless + Entra app reg(s)**; **CI builds/pushes the image to ACR and deploys the ACA revision**. Adds a standard **Dockerfile**.

**Unchanged (explicitly):** Entra ID auth, **Azure SQL Database serverless** (+ its fallback) with managed identity, the **storage-adapter seam** (`AzureAdapter` still just calls `/api/...` — only the server behind it changes), **per-owner `ownerId` scoping** replacing RLS, **friends as Entra B2B guests**, `azd`+Bicep IaC, phased seam→swap→delete migration, **NO Supabase**, **NO managed Data API Builder** (the DAB-deprecation scar still binds; DAB only as a self-hosted fallback in the same ACA env).

**Consequences.** + Normal web-API dev experience (run the container locally, ordinary routing/middleware); real horizontal scale (replica count in Bicep); near-$0 idle (ACA scale-to-zero + SQL auto-pause); one container runtime. − We now own a container image + ACR + a CI build step; a separate API tier adds linked-backend constraints (or CORS + JWT under the fallback); ACA/SQL cold-start on scale-from-zero/idle.

**Owner mapping.** Linus — ACA/App Service + ACR + Bicep + CI container pipeline + Entra app reg. Danny — API shape (Fastify/TS) + auth-validation design (linked-backend header / JWT fallback). Rusty — `AzureAdapter` + MSAL/sign-in wiring if SPA auth changes. Basher — Supabase→Azure SQL migration tooling. Livingston — sign-in / sharing UX.

**Reference:** full analysis and decision tables in `docs/adr-azure-entra-rebuild.md` (see the "Revision — 2026-10-19 (compute/API tier only)" note at the top and §2).

---

## Decision: Disc Catalog Schema — Supabase PostgreSQL
**By:** Basher (Data Wrangler) | **Date:** 2025-04 | **Status:** Proposed (Pending review)

ProIsPro currently fetches disc catalog data from DiscIt API (Marshall Street), caches in localStorage with 24-hour TTL. This decision captures the plan to own the disc catalog in Supabase, support production run variants (same disc name, different plastic/year → different flight numbers), and support wear adjustments (user tweaks turn/fade/glide as their disc beats in).

### Schema Decisions

**A) `disc_catalog` Table:**
- **Primary Key:** UUID (`gen_random_uuid()`) — enables external ID mapping flexibility, federation-ready
- **Production Variants:** `plastic_type` (TEXT, nullable), `run_year` (INTEGER, nullable) — same mold can have different flight characteristics in different plastics/runs
- **Denormalized Stability:** `stability` (TEXT) and `stability_slug` (TEXT) — avoids recalculating in every query; requires consistency with flight numbers on INSERT/UPDATE
- **Indexes:** Individual indexes on `brand_slug`, `type`, `stability_slug`, `speed DESC` + compound index on `(brand_slug, type, speed DESC)` + GIN trigram indexes on `name` and `brand`
- **RLS:** Public SELECT (flight guide is public), service_role-only write

**B) `disc_wear_adjustments` Table:**
- **Offset Storage:** Storing offsets (deltas from catalog value), not absolute values — keeps catalog value visible and ensures correct application if catalog specs are later corrected
- **Offset Bounds:** `-3` to `+3` — prevents nonsense values, bounded CHECK constraint enforces sanity
- **Link Strategy:** `user_disc_id` UUID NOT NULL (links to user's `discs` entry), `catalog_disc_id` UUID NULLABLE (links to `disc_catalog` if matched), `user_id` UUID NOT NULL
- **RLS:** User can only SELECT/INSERT/UPDATE/DELETE their own adjustments

**C) Query Pattern:**
- Flight Guide: Direct SELECT from `disc_catalog` with optional filters
- User Bag with Wear: LEFT JOIN `discs` → `disc_catalog` → `disc_wear_adjustments`; effective flight numbers = `COALESCE(d.speed, c.speed + COALESCE(w.speed_offset, 0))`

### Migration Plan
1. Run SQL migration (creates tables, indexes, RLS policies)
2. Enable `pg_trgm` extension (for fuzzy search)
3. Write seed script to fetch DiscIt API → INSERT into `disc_catalog`
4. Update `disc-catalog.js`: replace DiscIt fetch with Supabase query
5. Update `flight-guide.js`: adapt `loadCatalog()` to Supabase client
6. Add wear adjustment UI to bag view (new feature, can be phased)

### Open Questions
1. Admin UI: Manual SQL, custom admin page, or Data API Builder endpoint?
2. Seed automation: One-time manual seed or periodic refresh job?
3. DiscIt fallback: If our catalog stale/incomplete, should we fall back to DiscIt API or commit to 100% ownership?

---

## Decision: Flight Guide Data Source
**By:** AK (via Copilot) | **Date:** 2026-04-16 | **Scope:** Flight Guide feature data source selection

Use **DiscIt API** (discit-api.fly.dev/disc) as the primary disc catalog data source.

**Rationale:**
- Only source with flight numbers at scale (no other public API provides flight characteristics for 1000+ discs)
- Free and open with no licensing restrictions
- Reliable, stable API serving disc golf community with industry-standard flight number format (4 integers)
- Alternative sources (PDGA CSV, Marshall Street direct, manual entry) are impractical

**Implementation:**
- Parse legacy flight strings (e.g., "12 / 5 / -1 / 3") into discrete integer columns
- Implement 24h localStorage caching to minimize API calls
- Caching layer provides graceful degradation if API temporarily unavailable

**Note:** This decision assumes eventual migration to self-owned Supabase catalog (see ADR: Flight Numbers Data Ownership).

---

## ADR: Flight Numbers Data Ownership & Production Run Model
**Decision Lead:** Danny (Lead / Architect) | **Date:** 2026-04-21 | **Status:** Proposed | **Stakeholders:** Anders (User), Rusty (Frontend), Basher (Data)

This ADR lays out the architecture for three layers of flight number management:
1. Canonical catalog (remove Marshall Street dependency)
2. Production run variants (plastic/run variation)
3. Per-user adjustments (wear-based customization)

### A. Data Ownership Strategy: Recommendation = Import Once, Self-Managed

**Option A1 (Recommended ✓):**
- **Approach:** Seed Supabase `discs` table from DiscIt API once, then own all updates
- **Pros:** Clean break from dependency, full control, familiar structure, low migration friction
- **Cons:** One-time operational step, no auto-correction if Marshall Street discovers errors, manual process for new discs
- **Trade-off:** Operational simplicity vs. data freshness (acceptable for ~20–50 disc releases/year)

**Rejected Options:**
- **A2 (Build catalog from scratch):** Rejected — 10,000+ rows unsustainable, no initial data
- **A3 (DiscIt as fallback):** Rejected — still depends on DiscIt, defeats goal of independence

**Implementation:** One-time seed script → insert into `public.discs` → verify row count → manual updates going forward

---

### B. Production Run Model: Recommendation = One Row per Plastic

**Option B1 (Recommended ✓):**
- **Schema:** Separate row per plastic variant (innova-destroyer-champion, innova-destroyer-star, etc.)
- **Pros:** One true flight per physical variant, simple queries, enables plastic-aware UI, storage efficient
- **Cons:** Larger table (~10k–15k rows vs 3k), duplication, import complexity
- **Trade-off:** Larger table (negligible cost) vs. clarity (one flight = one reality)
- **ID format:** `{manufacturer}-{name}-{plastic}` (lowercase, kebab-case)

**Rejected Options:**
- **B2 (JSONB overrides):** Rejected — Supabase queries harder without stored procedures, UI complexity
- **B3 (Lookup table):** Rejected — overkill for data model, extra join complexity

---

### C. Wear Adjustment Model: Recommendation = Separate `disc_adjustments` Table

**Option C1 (Recommended ✓):**
- **Schema:** Separate table with `user_id`, `bagged_disc_id`, speed/glide/turn/fade offsets, reason field
- **Constraints:** Offsets bounded [speed: -4–4, glide: -3–3, turn: -3–3, fade: -2–2], one adjustment per bagged disc
- **RLS:** User can only adjust their own discs
- **Pros:** Clean separation, audit trail, easy revert, reusable fields, flexible for extensions
- **Cons:** Extra table + join (minimal performance hit at scale)

**Example:** Innova Destroyer Star (canonical: 12/5/-2/2) + wear adjustment (0/0/+1/+1) = final flight 12/5/-1/3

**Rejected Options:**
- **C2 (JSONB on user_discs):** Rejected — hard to query, no bounds enforcement, loses audit trail
- **C3 (Version history):** Rejected — conflates user adjustments with canonical data (data modeling nightmare)

---

### D. Frontend Migration: disc-catalog.js → Supabase

**Option D1 (Recommended ✓):**
- **Approach:** Direct Supabase query + localStorage cache (same pattern as DiscIt)
- **Implementation:** Replace DiscIt fetch with `supabase.from('discs').select(...)`
- **Cache:** localStorage still provides offline resilience + performance
- **Fallback:** Stale cache if Supabase temporarily unavailable
- **Pros:** Clean separation, no breaking changes to flight-guide.js, graceful degradation
- **Cons:** Two caches to manage, Supabase required for first-time users

**Rejected Options:**
- **D2 (Supabase RPC):** Rejected — adds server-side maintenance burden, overkill for <15k rows

**localStorage Version Bump:** Change key from `proispro_disc_catalog` to `proispro_disc_catalog_v2` (prevents stale data pollution)

---

### E. Migration Path: Phased Rollout with Feature Flag

**Phases:**
1. **Phase 1 (Schema Setup):** Create `discs` table, seed from DiscIt, verify counts
2. **Phase 2 (Feature Flag):** Update `disc-catalog.js` with `USE_SUPABASE_CATALOG = false`, internal testing
3. **Phase 3 (Cutover):** Flip flag to true, deploy, monitor error logs + latency
4. **Phase 4 (Cleanup):** Remove DiscIt code + feature flag after 1 week stability

**Concurrent Work:** While Phase 1/2 happen, build "Edit Flight" modal in `flight-guide.html` (wear adjustment UI)

**Go/No-Go Criteria:**
- ✅ Supabase row count within ±5% of DiscIt
- ✅ Spot-check: 10 random discs match DiscIt data
- ✅ Query latency <200ms (p95)
- ✅ Flight guide loads without errors
- ✅ localStorage fallback works (offline resilience proven)

**Post-Launch Success (1 week):**
- <1% error rate on Supabase queries
- Zero support tickets about missing discs/wrong flights
- ≥80% of users see all expected discs

### Implementation Timeline

| Dimension | Decision | Owner | Timeline |
|-----------|----------|-------|----------|
| **A. Data Ownership** | Import DiscIt once, self-manage | Basher | 1 day |
| **B. Production Run** | One row per plastic variant | Basher + Rusty | 2 days (curate plastics) |
| **C. Wear Adjustments** | Separate `disc_adjustments` table + RLS | Basher + Rusty | 3 days (schema + UI) |
| **D. Frontend Migration** | Supabase query + localStorage cache | Rusty | 1 day |
| **E. Migration Path** | Phased rollout with feature flag | Rusty + Basher | 5 days total |

**Week 1:** Basher curates plastics + runs import; Rusty updates `disc-catalog.js` + deploys Phase 2  
**Week 2:** Rusty builds wear adjustment UI + disc_adjustments schema; integration testing  
**Week 3:** Observation window; cleanup (remove DiscIt code, feature flag); go live with Flight Guide v2

### Key Decisions Locked In

1. ✅ No Marshall Street dependency — migrate to self-owned Supabase discs
2. ✅ Plastic variants as separate rows — enables per-plastic flight numbers
3. ✅ Wear adjustments as separate table — clean, auditable, reversible
4. ✅ Frontend stays vanilla — Supabase replaces DiscIt fetch, no UI rewrite
5. ✅ Phased rollout — feature flag mitigates rollback risk

### Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Supabase outage during migration | Low (99.9% SLA) | Medium | Feature flag → fallback to DiscIt (48h max) |
| Plastic variant data incomplete | Medium (manual curation) | Low | MVP: accept gaps, iterative improvement |
| Wear adjustment queries slow | Low (small table) | Medium | Monitor p95 latency, paginate if needed |
| Users lose custom adjustments | Very low (new feature) | N/A | RLS ensures user-scoped data |
| localStorage corruption | Low | Low | Error handling in place |

### Open Questions

1. **Plastic curation:** Manual research vs. auto-detect from DiscIt payload?
2. **New disc releases:** Manual admin updates or periodic DiscIt sync endpoint?
3. **Adjustment history:** Needed at launch or deferred (can add later, backward-compatible)?

---

## Spec: Disc Detail Modal — UX Specification
**By:** Livingston (UX Designer) | **Date:** 2026-04-16 | **For:** Rusty (Frontend Dev)

Replace the current right-side detail panel (320px `<aside class="fg-detail">`) with a centered, full-screen modal overlay. Goal: in-your-face product detail experience (inspired by trydiscs.com) with more screen real estate, prominent CTAs, future-ready for wear adjustment UI.

**Remove:** Marshall Street commercial link (lines 227-231 in flight-guide.html).

### Modal Structure & Information Hierarchy

**Desktop Layout (≥768px):** Two-column (image | details), max-width 720px, centered on viewport
**Mobile Layout (<768px):** Single-column, full-screen, scrollable

**Information Hierarchy:**
1. Disc name (H2, 1.5–1.8rem, font-weight 800) — hero element
2. Flight path visualization (large image/SVG) — visual anchor
3. Type + Stability badges (color-coded) — quick scan
4. Flight numbers with bars (enhanced: taller 12px, more spacing) — core data
5. Brand + category (smaller, muted) — context
6. Notes/description (placeholder) — future content
7. Wear adjustment UI (future, design space reserved) — only when in bag
8. "Add to My Bag" CTA (prominent button) — primary action

**Modal Structure:**
- **Backdrop:** `rgba(15, 23, 42, 0.85)` semi-transparent overlay, click to close
- **Card:** White/surface card, max-width 720px desktop (100% mobile)
- **Close button:** Top-right corner + ESC key + backdrop click

### Interaction Spec

**Open Modal:**
- Trigger: Click disc tile in grid
- Animation: Backdrop fade in (200ms), modal scale 95%→100% + fade (250ms ease-out)
- Body scroll locked (`overflow: hidden`)
- Focus moves to close button

**Close Modal:**
- Triggers: Close button (×), backdrop click, ESC key
- Animation: Reverse of open (200ms ease-in)
- Focus restored to clicked disc tile

**Modal Behavior:**
- Desktop: 720px max-width, centered, 2rem padding
- Mobile: Full-screen (100vw × 100vh), edge-to-edge
- Scrolling: Content scrollable if taller than viewport (overflow-y: auto)
- Focus trap: Tab cycles within modal

### Flight Number Visualization

**Current bars (keep them ✅):**
- Horizontal bar chart design (width = value)
- Color-coded by type (speed=yellow, glide=green, turn=blue/orange, fade=red)
- Numeric value displayed alongside
- Improvements in modal: increase bar height 8px→12px, gap .45rem→.65rem

**Wear Adjustment Section (Future):**
- Location: Between flight numbers and notes, only visible when `disc.isInBag === true`
- Design: Placeholder for now: `<div class="fg-wear-section" x-show="isInBag(selectedDisc)">Wear adjustments coming soon…</div>`
- Future: Per-flight inline sliders or single "Wear" slider (0–10 scale)

### Accessibility (WCAG 2.2)

**Focus Management:**
- On modal open: move focus to close button
- Focus trap: Tab cycles within modal (close → badges? → CTA → close)
- On modal close: return focus to clicked disc tile

**Keyboard Navigation:**
- ✅ ESC closes modal (already implemented)
- ✅ Click backdrop closes modal (new)
- ✅ Close button has aria-label
- ✅ Modal: `role="dialog"`, `aria-modal="true"`
- ✅ Modal title: `id="modal-title"`, backdrop: `aria-labelledby="modal-title"`

**Target Size:** Close button & CTA ≥44×44px (WCAG 2.5.8 AA)  
**Reduced Motion:** `@media (prefers-reduced-motion: reduce)` → transitions: none

### CSS Structure

**New classes:**
- `.fg-modal-backdrop` — fixed overlay, flex center
- `.fg-modal-card` — white card, max-width 720px, z-index 1000
- `.fg-modal-close` — 44px button, top-right corner
- `.fg-modal-content` — grid: 1fr 1.2fr (image | details)
- `.fg-modal-image-col`, `.fg-modal-pic`, `.fg-modal-pic-placeholder`
- `.fg-modal-details-col` — flex column, gap 1.2rem
- `.fg-modal-name`, `.fg-modal-brand`, `.fg-modal-badges`
- `.fg-wear-section`, `.fg-wear-title`
- `.fg-notes-section`, `.fg-notes-title`
- `.fg-modal-actions`, `.fg-modal-actions .fg-add-btn` — width 100%, min-height 48px

**Mobile (<768px):**
- `.fg-modal-backdrop`: padding 0 (full-screen)
- `.fg-modal-card`: max-width 100%, border-radius 0
- `.fg-modal-content`: grid-template-columns 1fr (single column), gap 1rem

### What to Remove

From `flight-guide.html`:
- Lines 159-237: `<aside class="fg-detail">` block
- Lines 227-231: `<a class="fg-store-link">` (no commercial links)

From `flight-guide.css`:
- Lines 269-395: `.fg-detail*` classes
- Lines 380-394: `.fg-store-link` class

From `flight-guide.js`:
- No deletions — reuse existing `showDetail`, `selectedDisc`, `addToBag`, `isInBag`, ESC handler

### Implementation Notes

**Order of Work:**
1. Remove old code (aside block, .fg-detail* CSS)
2. Add modal HTML structure (new backdrop + card)
3. Add modal CSS (from spec above)
4. Update Alpine methods (add `closeModal()`, track focus in `selectDisc()`)
5. Test interactions (open/close, backdrop, ESC, responsive, focus trap)
6. Accessibility review (screen reader, keyboard nav, contrast)

**Edge Cases:**
- No flight path image → placeholder (✈️ emoji)
- Very long disc names → wraps (line-height 1.2)
- Modal taller than viewport → scrollable (overflow-y: auto)
- Backdrop click during animation → completes without jank

**Future Work (Not in Scope):**
- Notes/description data source (Basher to add to schema?)
- Wear adjustment UI (Basher designing schema + logic)
- "Already in bag" state (change text to "View in Bag" or disable?)

### Summary

This spec replaces 320px side panel with modern, spacious modal:
- **Desktop:** Two-column (image left, details right), 720px max-width, centered
- **Mobile:** Full-screen, single-column, scrollable
- **Accessibility:** Focus trap, backdrop click, ESC, ARIA labels, keyboard nav
- **Future-ready:** Space for wear adjustments + notes

Modal provides 2× screen real estate, emphasizes flight path image, makes CTA prominent. Flight bars enhanced (taller, more spacing) but keep excellent design. No commercial links.

**Decision:** Modal replaces side panel. Marshall Street link removed. Wear + notes reserved for future work.

10 vivid OKLCH disc colors for the color picker UI in the Add/Edit Disc modal. Designed to evoke bold, sporty disc plastic on dark navy background.

**Palette (10 colors, hue-spread ~30–40° apart):**

| Name | OKLCH | Hex | H° |
|------|-------|-----|-----|
| Crimson | `oklch(0.72 0.24 25)` | #f04545 | 25 |
| Tangerine | `oklch(0.76 0.22 52)` | #f98340 | 52 |
| Solar Yellow | `oklch(0.80 0.20 108)` | #c0e418 | 108 |
| Lime | `oklch(0.76 0.22 140)` | #52de4a | 140 |
| Emerald | `oklch(0.74 0.22 162)` | #28d47a | 162 |
| Seafoam | `oklch(0.78 0.20 196)` | #20d4ba | 196 |
| Electric Blue | `oklch(0.72 0.18 235)` | #7cb4f8 | 235 |
| Iris | `oklch(0.74 0.22 278)` | #9578ff | 278 |
| Hot Plum | `oklch(0.72 0.26 308)` | #cc44cc | 308 |
| Hot Pink | `oklch(0.76 0.24 340)` | #f462a4 | 340 |

**Design Rationale:**

- **Lightness band L=0.72–0.80:** Perceptually uniform across hues (OKLCH's key advantage). Yellow at L=0.80 (upper limit) because yellow hue has limited sRGB chroma at lower lightness.
- **Chroma band C=0.18–0.26:** High saturation evokes bold disc plastic. Blues capped at C=0.18 (sRGB gamut narrower in blue region). Reds/magentas/purples push to C=0.24–0.26.
- **Full spectrum coverage:** Red → orange → yellow → lime → green → teal → blue → violet → plum → pink. Each disc distinctly identifiable by color alone.
- **Text: Always dark navy.** At L≥0.72, swatch luminance Y≈0.38–0.51. Dark text achieves ~8–10:1 contrast (WCAG AAA). White text fails at <2.5:1.
- **Semantic separation from type badges:** Badges (L=0.75, C=0.18) communicate disc *type*. Disc colors (C=0.18–0.26) communicate physical *appearance*. Different roles, different chroma authority.

**Implementation:**
- CSS variables: `--disc-{slug}` in `:root` (e.g., `--disc-crimson`, `--disc-solar-yellow`).
- JSON: Array of color objects (slug, name, oklch, hex, textColor).
- HTML: 11 swatch buttons (× + 10 colors), backgrounds via `style="background:var(--disc-{slug})"`.
- Touch targets: 44×44px minimum via `::after` pseudo-element, visual 32px.

---

### Disc Color Picker — Swatch Selection Pattern
**By:** Rusty (Frontend Dev) | **Date:** 2026-04-14 | **Status:** Active

Replaced free-text `<input type="text" id="discColor">` with visual swatch picker: 11 circular buttons (× + 10 named colors) backed by hidden `<input type="hidden" id="discColor">`.

**Key Decisions:**

1. **Human color names stored** — Data stores human-readable name (e.g., "Crimson"), not slug or OKLCH. Slug derived at render time via `.toLowerCase()`. Keeps data human-readable and decoupled from CSS internals.

2. **CSS variables wired via inline style** — Swatch backgrounds use `style="background:var(--disc-{slug})"` in HTML. When Saul defines `--disc-{slug}` in `:root`, picker colors update automatically—no JS change required.

3. **Touch target via `::after` pseudo-element** — Visual swatch 32px; touch target expanded to ≥44px by `::after { inset: -6px }`. Keeps layout compact while meeting WCAG 2.5.5 (44×44px minimum).

4. **Fixed 10-color palette** — Curated (10 slugs): crimson, tangerine, solar-yellow, lime, emerald, seafoam, electric-blue, iris, hot-plum, hot-pink. No free-text fallback. Existing disc data with non-palette color strings render without color dot (graceful degradation—no crash, just no dot).

5. **× (none) button is part of swatch group** — Deselection uses same `.color-swatch` mechanism as selection. No special state needed—`data-color=""` on none button; `setColorPicker('')` selects it.

6. **Unified picker state management** — `setColorPicker(name)` and `resetColorPicker()` are the single source of truth. They update hidden input value + visual selection + label text simultaneously.

7. **Card display** — Colored 10px dot via `style="background:var(--disc-{slug})"` prepended to 🎨 label. Border on dot handles white swatch legibility on dark backgrounds.

8. **Accessibility** — `aria-live="polite"` on `.color-label` announces selection changes to screen readers.

---

### Frontend Rewrite: Alpine.js + Supabase Client
**By:** Rusty (Frontend Dev) | **Date:** 2026-04-16 | **Status:** **Superseded by the Azure/Entra rebuild**

> **⚠️ Superseded by the Azure/Entra rebuild** (ADR 2026-10-19, `docs/adr-azure-entra-rebuild.md`) — the Alpine.js + Supabase client is replaced by **React 18 + TS + Vite** talking to the Azure Functions API via the `AzureAdapter` seam. (Note: `team.md` still mislabels the stack as Alpine.js — fix in the docs phase.)

Complete rewrite of frontend from vanilla DOM + DAB GraphQL to Alpine.js + Supabase JS client (both via CDN). No build step.

**What Changed:**
- Replaced DAB GraphQL queries → Supabase JS client CRUD operations
- Replaced vanilla DOM manipulation → Alpine.js reactive components
- Replaced Azure SWA auth → Supabase GitHub OAuth
- Weight input changed from `type="number"` → `type="text"` (matches PostgreSQL string column, allows flexible entries like "170-175")

**Key Design:**
- **Single Alpine component:** Entire app is one `discApp()` function (~300 lines, no splitting needed)
- **Graceful Supabase detection:** If `SUPABASE_URL` is placeholder, app runs in localStorage-only mode (local dev without Supabase project)
- **Auth gate:** Login screen shown when not authenticated (single-page app, no route-level auth needed)
- **`x-cloak` CSS rule:** Prevents flash of unstyled Alpine template syntax before hydration

**Files Modified:**
- `app.js` — Complete rewrite (Alpine + Supabase)
- `index.html` — Alpine directives + CDN script tags
- `styles.css` — Added `[x-cloak]` rule

**Files Created:**
- `docs/supabase-setup.md` — User setup guide
- `docs/migration-sql.sql` — PostgreSQL schema + RLS policies

**Preserved:**
- All CSS classes, visual design (zero styling changes)
- OKLCH color system, disc color swatches, condition dots, type badges
- localStorage fallback (offline/unconfigured mode)
- Export/import JSON functionality
- Toast notifications

---

### Azure Fully Decommissioned — Supabase is Sole Backend
**By:** Linus (DevOps) | **Date:** 2026-04-20 | **Status:** **Superseded by the Azure/Entra rebuild**

> **⚠️ Superseded by the Azure/Entra rebuild** (ADR 2026-10-19, `docs/adr-azure-entra-rebuild.md`) — Azure is being **re-adopted** (SWA + Azure SQL serverless + Functions + Entra ID) for the multi-user rebuild. This decommission record is historical; the new Azure footprint is intentionally minimal (one SPA + one thin API + one DB) and avoids the retired DAB feature.

All Azure resources deleted from portal by AK. Repository cleaned of all Azure/CosmosDB/DAB configuration files and documentation.

**What Was Removed from Repo:**
- `docs/infra/` — Entire directory (Azure/DAB setup docs + PowerShell scripts)
- `.squad/skills/cosmosdb-best-practices/SKILL.md` — Obsolete CosmosDB skill
- `.squad/decisions/inbox/danny-dab-fix.md` — DAB troubleshooting notes (not durable)
- `.squad/decisions/inbox/danny-dab-retirement-migration.md` — Superseded by decisions.md
- `.gitignore` — Removed stale `docs/infra/` ignore rule

**Verification (grep confirmed zero references):**
- `app.js` — zero Azure/CosmosDB/DAB references
- `index.html` — zero Azure/CosmosDB/DAB references

**Current Stack (Sole Production):**
| Layer | Technology |
|-------|-----------|
| Hosting | GitHub Pages (proispro.com) |
| Database | Supabase PostgreSQL |
| Auth | Supabase GitHub OAuth |
| Deploy | GitHub Actions (`.github/workflows/deploy.yml`) |

**Portal Cleanup (Separate Action by AK):**
- Deleted `proispro` resource group (was empty — setup script never ran)
- Left DNS zones (likely shared test infrastructure)
- Zero active charges (CosmosDB + SWA were never provisioned)

**Status:** ✅ Azure fully decommissioned. Supabase is sole backend. Repo is clean.

---

### Cloud Services: Verify Deprecation & Documentation First
**By:** AK (User Directive via Copilot) | **Date:** 2026-04-15 | **Status:** Policy

Before making any architecture decisions involving cloud services (Azure, AWS, GCP, Supabase, etc.):
1. **First:** Check relevant vendor's official documentation for service status & best practices
2. **Never assume** patterns, pricing, or behavior — verify from source
3. **Applies to all agents**, especially Lead and DevOps roles

**Why:** Learned from CosmosDB/DAB experiment where assumptions about service behavior and fit led to wasted debugging and full migration. DAB was silently deprecated (November 30, 2025); production showed 500s with no helpful error message. Local SWA CLI bundled its own DAB runtime, creating illusion of working code.

**Red Flags for Deprecation Checks:**
- Instant 500 responses (not timeout) = runtime not starting
- Zero service logs in platform dashboards = feature not present
- Official docs redirect to overview pages = deprecation notice
- "Works locally but fails in production" with managed platform tooling

---

---

### Disc Photo Storage Architecture
**By:** Danny (Lead/Architect) | **Date:** 2026-04-16 | **Status:** Active

Store user-uploaded disc photos in Supabase Storage bucket `disc-photos` (public). Photo URL persisted as `user_photo_url TEXT` on `disc_wear_adjustments`. Full ADR at `docs/adr-disc-photo-storage.md`.

**Schema:** `user_photo_url TEXT` column on `disc_wear_adjustments` — no new table; 1:1 per bag disc already enforced.

**Storage path:** `{user_id}/{user_disc_id}.{ext}` — keyed on `user_disc_id` (not `wear_adjustment_id`) to avoid orphaned files if the adjustment row is recreated.

**Upload:** Direct browser → Supabase Storage via `supabase-js` (`supabase.storage.from('disc-photos').upload(..., { upsert: true })`), then store returned public URL in DB.

**RLS:** Four policies on `storage.objects` gate access by `(storage.foldername(name))[1] = auth.uid()::text` — INSERT, SELECT, UPDATE, DELETE scoped to own `{user_id}/*` prefix.

**Constraints:** JPEG/PNG/WEBP, 5MB max. No client-side resize for v1.

**Display priority:** (1) `wearAdjustment.user_photo_url` → (2) `catalogEntry.pic` → (3) SVG flight chart.

**Migration:** `docs/migration-v4-disc-photos.sql` (Basher). ⚠️ Migration uses `adjustment_id` as path key vs. `user_disc_id` in this ADR — see "Disc Photo Storage Path — Fallback Strategy" below for tracking.

---

## Feature Development

### 2026-05-16: PRD Decomposition — ProIsPro v2 Features
**By:** Danny (Lead/Architect) | **Date:** 2026-05-16 | **Status:** Active

Decomposed 3 feature requests (FR-1 autocomplete polish, FR-2 bag history, FR-3 course+holes+stats) into 10 GitHub issues with explicit dependency ordering and architecture decisions.

**Issues Created:**
- #48: [FR-1] Audit & improve disc name autocomplete UX
- #49: [FR-2] Add bag_history Supabase migration
- #50: [FR-2] Wire bag history into add/remove mutations + load on bag open
- #51: [FR-2] Bag change history UI panel
- #52: [FR-3b] Disc-to-hole assignment UI (course game plan)
- #53: [FR-3a] Course holes UI — show hole list in Courses tab
- #54: [FR-3c] Disc usage stats — Core vs Scramble badges
- #55: [FR-3b] Hole assignment logic in app.js
- #56: [FR-3a] Fix OSM course fetching + parse structured hole data
- #57: [FR-3b] Hole assignments Supabase migration

All labeled `squad:copilot` for autonomous pickup.

**Architecture Decisions:**

1. **bag_history as separate audit table** — Not using array mutation log or storing history inline. Separate table enables efficient queries, proper indexing, and RLS isolation. Append-only (no UPDATE/DELETE policies) preserves audit integrity.

2. **hole_assignments scoped to course_pin_id** — Assignments reference the user's pinned course (course_pins.id), not a separate course entity. This keeps the relationship simple and maintains bag context per user.

3. **Disc stats computed client-side** — No materialized view or pre-aggregated table. At current user scale, aggregating from hole_assignments on demand is sufficient. Threshold of 5+ holes for "Core" badge is initial heuristic — may tune later.

4. **Holes stored as JSONB on course_pins** — Rather than a separate holes table, storing structured hole data as JSON column keeps queries simple and avoids joins. Works well for read-heavy, rarely-updated data.

**Dependency Order:**
```
FR-1 (standalone)
FR-2: #49 → #50 → #51
FR-3: #56 → #53 → #57 → #55 → #52 → #54
```

**Rationale:** AK requested PRD decomposition and build kickoff for v2 features. Explicit dependency ordering prevents blocked work.

---

### Disc Photo Storage Path — Fallback Strategy
**By:** Rusty (Frontend Dev) via Copilot | **Date:** 2026-04-16 | **Status:** Active (follow-up pending)

Use `selectedDisc.adjustment_id || selectedDisc.id` as the Storage path key for disc photos until the wear-adjustments query is joined into the flight guide data load.

`disc_wear_adjustments.id` (the adjustment row PK) is the intended key, but `selectedDisc` in `flightGuide()` may not carry `adjustment_id` until that join is wired in. Falling back to `selectedDisc.id` (catalog disc ID) is unique per disc model — not per user × adjustment row — so it must be treated as temporary.

**Follow-up:** When Basher's wear-adjustments schema is joined into the flight guide data load, surface `adjustment_id` on `selectedDisc` and drop the fallback. Confirm the `disc_wear_adjustments` update uses `.eq('user_disc_id', ...)` (column name must match Basher's final migration output).

---

### Disc Photo UX — Tabbed View (Photo | Chart)
**By:** Livingston (UX Designer) | **Date:** 2026-04-16 | **Status:** Proposed (pending Anders review)

Use a tabbed interface ("📷 Photo" | "✈️ Chart") in the disc detail modal whenever a photo exists. Full spec at `docs/ux-spec-disc-photo.md`.

**Priority order:**
1. User photo present → photo tab shown by default; chart accessible via tab
2. Catalog photo present (no user photo) → photo tab default + "Add your photo" CTA
3. No photos → chart shown, tab bar hidden (current behavior unchanged)

**Alpine implementation:**
- `imageTab: 'photo'` state in `flightGuide()` component
- `hasPhoto(disc)` → `!!disc.userPhotoUrl || !!disc.catalogPic`
- Tab bar (`role="tablist"`) hidden via `x-show="hasPhoto(selectedDisc)"`
- Chart SVG always rendered; toggled with `x-show`
- After photo upload: `this.imageTab = 'photo'`; after removal: `this.imageTab = 'chart'`
- ARIA tabs pattern: `role="tablist"`, `role="tab"`, arrow key navigation

**CSS additions:** ~40 lines (`.image-tab-bar`, `.tab-btn`, `.tab-btn.active`, focus/hover states).

**Rationale:** Priority approach (photo hides chart) rejected — UX regression; users lose flight path visualization. Side-by-side rejected — modal column too narrow (~350px), unusable on mobile. Tabs: no functionality loss, familiar pattern, mobile-friendly tap targets, accessible.

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

---

### No External Disc APIs in Edge Function
**By:** Copilot (Coding Agent) | **Date:** 2026-04-19 | **Status:** Active

Use Gemini's own training knowledge for disc flight specs instead of calling external APIs (PDGA, manufacturer APIs) from the edge function.

**Rationale:**
- User directive: "don't make us rely on too much other API"
- Disc mold names + types form a small, stable corpus (~400 discs)
- Gemini has sufficient training knowledge to return flight specs from mold name alone
- Reduces infrastructure complexity and external dependencies
- Faster response time (fewer network hops)

**Implementation:**
- Edge function (`identify-disc`) returns mold name + any flight numbers visible in image
- Client-side `findBestCatalogMatch()` in `disc-catalog.js` enriches with specs from local catalog
- Catalog is authoritative source of truth for flight numbers and disc metadata

---

### Gemini 2.5 Flash — Always Set thinkingBudget: 0
**By:** Copilot (Coding Agent) | **Date:** 2026-04-19 | **Status:** Active

When using Gemini 2.5 Flash for disc detection, always disable thinking mode by setting `thinkingBudget: 0` in the `thinkingConfig`.

**Rationale:**
- Gemini 2.5 Flash with thinking enabled consumes "thinking" tokens against the `maxOutputTokens` budget
- Thinking tokens exhaust the budget before the actual JSON output is emitted
- Result: Truncated/incomplete JSON responses (e.g., `"Clash Dis."` instead of `"Clash Disc"`)
- Disc detection task is straightforward classification (not reasoning-heavy) — thinking adds no value

**Configuration:**
```typescript
thinkingConfig: {
  thinkingBudget: 0
},
maxOutputTokens: 1024
```

---

### Gemini Model Selection — 2.5 Flash Primary, 2.5 Pro Fallback
**By:** Copilot (Coding Agent) | **Date:** 2026-04-19 | **Status:** Active

Primary model for disc detection: `gemini-2.5-flash` (v1beta). Fallback if quota/limits: `gemini-2.5-pro` (v1beta).

**Rationale:**
- Flash: Fast + cheap, sufficient for image classification task
- Pro: Fallback for rate limits or quota exhaustion
- Deprecated models: Older `gemini-1.5-*` versions should never be used — always target 2.5 series

**Model Configuration:**
```typescript
model: "gemini-2.5-flash"  // primary
model: "gemini-2.5-pro"    // fallback
```

---

### Disc Catalog Fuzzy Matching — findBestCatalogMatch Pattern
**By:** Copilot (Coding Agent via Basher) | **Date:** 2026-04-19 | **Status:** Active

New `findBestCatalogMatch(moldName, manufacturerName)` function in `disc-catalog.js` for robust catalog lookups when input names vary in format/verbosity.

**Problem:** AI disc detection returns mold name (e.g., "Destroyer"), but exact substring matching fails against full catalog entries (e.g., "Innova Destroyer 12/5/-1/3").

**Solution:**
- **Normalization:** Both input and catalog entries normalized (lowercase, non-alphanumeric removed, whitespace stripped)
- **Multi-criteria scoring:**
  - Exact name match: +10 points
  - Partial name match (first word, key terms): +5 points
  - Brand/manufacturer match: +3 points
  - Score-based ranking: returns top 3 candidates with confidence
- **Fallback:** If no manufacturer provided, find closest alphabetic match
- **Result:** Robust matching that handles name variations, punctuation differences, descriptor text

**Pattern Applicability:** Useful for any catalog lookup where:
- Input names vary in format/verbosity (user input, OCR, model output)
- Catalog entries have descriptive metadata mixed with canonical names
- Fuzzy matching with manual scoring is preferred over Levenshtein/Jaro-Winkler

---

### Disc Photo Upload — Moved to Bag Edit Modal
**By:** Rusty (Frontend Dev) | **Date:** 2026-05 | **Status:** Implemented

Photo upload functionality moved from Flight Guide catalog to Bag Edit modal exclusively.

**Rationale:**
Flight Guide is a **public catalog browser** — it shows discs from the shared catalog, not discs the user owns. Adding photo upload there was architecturally wrong: users shouldn't be able to tag photos onto catalog discs they might not own.

Photos only make sense for **owned discs** in the user's personal bag.

**Storage Key:** `{user_id}/{disc_id}.{ext}` in the `disc-photos` Supabase Storage bucket.

---

### Disc Card Photo — Circular Avatar Instead of Banner
**By:** Rusty (Frontend Dev) | **Date:** 2026-05 | **Status:** Implemented (commit addfd5e)

Replace banner layout with **64×64px circular avatar** absolutely positioned in **top-right corner** of each disc card.

**Rationale:**
- Keeps card height consistent regardless of whether a photo is present
- Avatar feel is more personal and compact — matches "my disc bag" mental model
- No layout reflow: other card content completely unaffected
- Creates layered look without collision with type badge

---

### Moxfield-Inspired Inventory UX — Full Redesign
**By:** Livingston (UX Designer) + Rusty (Frontend Dev) | **Date:** 2026-04-19 | **Status:** Implemented

Comprehensive redesign of disc inventory inspired by Moxfield's card collection manager. Full UX specification at `.squad/agents/livingston/ux-spec-disc-inventory.md`.

**Problem:** Current single-grid view with basic filtering doesn't scale for users with 30+ discs. Excessive scrolling, limited organization, no personalization.

**Solution:** Three view modes (Grid, List, Compact), grouping (Type/Brand/Bag), expanded sorting (18 options), tag system, and redesigned toolbar.

**Key Components:**

1. **View Modes (3)**
   - Grid: Card layout (existing), photo-first
   - List: Tabular rows with 9 columns (Color | Type | Name | Flight | Weight | Condition | Bags | Tags | Actions)
   - Compact: Ultra-dense single-line rows

2. **Grouping (4 options)**
   - None (flat), Type (Putter→Distance), Brand (alphabetical), Bag (membership)
   - Collapsible sections with count labels, default expanded

3. **Sorting (18 options)**
   - Name (A→Z, Z→A), Type (Putter→Distance, reverse)
   - Speed, Glide, Turn, Fade (asc/desc pairs)
   - Weight (Low→High, High→Low), Condition (Best→Worst, reverse)
   - Date Added (Newest, Oldest)
   - Combined format: `'speed-desc'` (field-direction)

4. **Tags System**
   - Free-form tags stored as JSONB array in `discs.tags`
   - Color-coded chips (8 hashed OKLCH colors via deterministic hash)
   - Click tag → filter inventory to that tag
   - Autocomplete in edit modal, add/remove buttons

5. **Toolbar Redesign**
   - **Top row:** Search | View toggle (⊞ ☰ ≡) | Group dropdown | Sort dropdown | Advanced button | Count
   - **Filter chips:** [All] [Putter] [Midrange] [Fairway] [Distance] as toggle pills
   - **Advanced popover:** Brand text search, Bag filter, Condition filter, Weight range, Clear all

6. **Empty States**
   - Context-aware: "No [Type] discs", "No discs matching [query]", "No tags yet"

**Rationale:**

- **Progressive Density:** Three view modes let users choose density (Grid = browsing, List = scanning, Compact = maximum info)
- **Grouping for Organization:** Mirrors real-world disc categorization (type, brand, bag)
- **Tags for Personalization:** Free-form tags support diverse workflows (favorites, for sale, loaner, retired)
- **Filter Chips Discoverability:** One-click toggles more discoverable than dropdown-buried filters
- **Column Sorting:** Spreadsheet pattern (clickable headers) faster than dropdown for tabular layouts

**Trade-Offs:**

- **Complexity vs. Flexibility:** Mitigated with sane defaults (Grid, no grouping, name sort) → advanced features opt-in
- **Mobile Responsiveness:** List view drops Tags/Bags/Weight columns on < 768px
- **Performance:** `filteredSorted` runs on state change; O(n) grouping acceptable for single-user inventory

**Implementation Details:**

- **Alpine.js State:** 15+ new variables (viewMode, groupBy, sortBy, filters, groupExpanded, tagInput, etc.)
- **Computed Properties:** `groupedDiscs`, `filteredSorted`, `discCount` (shows "N of M" when filtered)
- **Methods:** `tagColor()` (hash tag to color), `setSortColumn()`, `toggleGroup()`, `addTag()`, `removeTag()`
- **CSS:** ~300 lines for list/compact/tags/groups/filters/mobile
- **HTML:** Toolbar redesign, conditional view templates, tags field in modal
- **Database:** `tags` JSONB column expected in `discs` table (migration: `ALTER TABLE discs ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`)

**Key Decisions:**

- **Combined sort strings** (`'speed-desc'`): Simpler than separate field/direction state
- **Default expanded groups:** Reduces clicks for typical use case (view all discs)
- **Inline dynamic tag colors:** More maintainable than generated CSS classes
- **List header in first group only:** Prevents duplicate headers when grouping active
- **Popover with click-outside:** `@click.outside` auto-closes without manual handling

**Status & Next Steps:**

- ✅ UX spec complete (Livingston)
- ✅ Frontend implementation complete, pushed to main (Rusty, commit 59f044a)
- ⏳ Pending: Basher/Danny to add `tags` JSONB column migration
- 🧪 Testing needed: All 18 sorts (especially nulls), list view mobile collapse, tags autocomplete, accessibility audit
- 🎯 Future: Save viewMode/groupBy to localStorage, upgrade datalist → custom dropdown for mobile

---

## Decision: Supabase Schema Extensions — Collections, Wishlist, For Sale
**By:** Basher (Data Wrangler) | **Date:** 2026-04-20 | **Status:** Implemented

Three new feature tables added via Supabase migrations to support Moxfield-inspired inventory features.

### Tables

**`collections` (001_collections.sql)**
- Named disc groupings distinct from `bags` (bags = operational round loadouts; collections = curated sets like "all Roc variants" or "vintage Innova")
- UUID PK, `user_id` FK → `auth.users` ON DELETE CASCADE
- `name TEXT NOT NULL`, `description TEXT` (nullable)
- `created_at`, `updated_at` TIMESTAMPTZ — updated_at maintained via trigger
- RLS: owner SELECT/INSERT/UPDATE/DELETE via `auth.uid() = user_id`

**`collection_discs` (001_collections.sql)**
- Many-to-many junction between collections and discs. No `user_id` column — ownership resolved by joining to `collections`
- Composite PK: `(collection_id, disc_id)`
- `sort_order INTEGER DEFAULT 0` — allows user-defined ordering within a collection
- `added_at TIMESTAMPTZ` — audit trail
- RLS: all operations check `EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = auth.uid())`
- **Decision:** Do NOT denormalize `user_id` onto `collection_discs`. Ownership is single-hop away via collections; indirect RLS check is cleaner and avoids update anomalies.

**`wishlist_items` (002_wishlist.sql)**
- Disc acquisition wishlist. Captures intent to buy before a disc exists in inventory.
- `priority SMALLINT DEFAULT 0` — 0=low, 1=medium, 2=high (not an enum — avoids migration for priority label changes)
- `acquired BOOLEAN DEFAULT false` — soft flag; rows kept post-acquisition for history
- `weight_min`/`weight_max INTEGER` — range preference, both nullable
- RLS: owner all ops via `auth.uid() = user_id`
- updated_at trigger
- **Decision:** Keep `acquired` as boolean rather than deleting rows. Preserves wishlist history and enables "show recently acquired" views without separate table.

**`forsale_listings` (003_forsale.sql)**
- Marketplace listings for discs the user wants to sell.
- `disc_id UUID REFERENCES discs ON DELETE CASCADE` — listing disappears if disc deleted from inventory
- `price NUMERIC(8,2)`, `currency TEXT DEFAULT 'SEK'` — SEK default reflects project owner's locale (AK/Sweden)
- `status TEXT` with `CHECK (status IN ('available', 'pending', 'sold'))` — text enum pattern
- `listed_at TIMESTAMPTZ DEFAULT now()`, `sold_at TIMESTAMPTZ` (nullable)
- No `updated_at` trigger — status transitions (`available` → `pending` → `sold`) cover the lifecycle sufficiently
- RLS: owner all ops via `auth.uid() = user_id`
- **Decision:** Use TEXT + CHECK constraint for status rather than PostgreSQL ENUM type. Reason: ENUM type changes require DDL (`ALTER TYPE`) which is more disruptive; CHECK on TEXT allows no-downtime constraint updates via `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT`.

### Shared Infrastructure

- `update_updated_at_column()` function declared with `CREATE OR REPLACE` in each migration that needs it — self-contained, no cross-migration dependency.
- RLS policy idempotency: `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` guards (not `CREATE POLICY IF NOT EXISTS`, which requires PostgreSQL 17).
- Trigger idempotency: `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` pattern.

---

## Decision: Collections, Wishlist, For Sale UI Implementation
**By:** Rusty (Frontend Dev) | **Date:** 2026-04-20 | **Status:** Implemented

Implemented Phases 1–3 of Moxfield-inspired disc inventory features: Collections, Wishlist, and For Sale. All built as new tabs inside the existing Alpine.js `discApp()` component with zero build step.

### Implementation

**app.js (~280 new lines):**
- `loadCollections()`, `loadWishlist()`, `loadForsale()` Supabase loaders
- CRUD functions: `createCollection()`, `addDiscToCollection()`, `deleteCollection()`, `reorderCollectionDiscs()`, `addWishlistItem()`, `updateWishlistItem()`, `markWishlistAcquired()`, `createForsaleListing()`, `updateForsaleStatus()`
- Filter/getter functions: `forsaleDiscPickerFiltered` excludes already-listed discs; `getDiscsForCollection()` resolves join table
- State: `collections`, `wishlistItems`, `forsaleListings`, plus 7 modal flags

**index.html (3 new tabs, 7 modals):**
- **Collections tab:** List/create/delete collections; add/reorder discs within each
- **Wishlist tab:** Wishlist items with priority flags (🟢/🟡/🔴), acquired tracking
- **For Sale tab:** Active/pending/sold listings with price display and status editor

**styles.css (~140 new lines):**
- Tab styling (active state, hover)
- Modal styling (backdrop, dialog, buttons)
- Collection/wishlist/forsale item cards

### Key Design Decisions

1. **`_collectionDiscs` as non-reactive cache (not Alpine state)**
   Collections use a join table pattern (`collection_discs`). Rather than a nested structure, `_collectionDiscs` is initialized as a plain array in state and populated from a second Supabase query in `loadCollections()`. It's manipulated directly (push/filter) without Alpine reactivity — resolved objects are returned by `getDiscsForCollection()` which IS called from reactive templates.
   **Rationale:** Avoids deep nesting, keeps the Supabase schema flat, and mirrors how bags use `discIds[]` arrays.

2. **For Sale disc picker excludes already-listed discs**
   `forsaleDiscPickerFiltered` computed getter filters out discs that already have a non-sold listing. This prevents duplicate active listings for the same disc.
   **Rationale:** User intent — if you're listing Disc A, you shouldn't see Disc A as an option again until the listing is marked sold.

3. **Wishlist priority stored as integer (0/1/2)**
   Priority stored as `SMALLINT` (0=low, 1=medium, 2=high) matching the Supabase schema. UI maps to emoji labels: 🟢 / 🟡 / 🔴.
   **Rationale:** Integer comparison is simpler for future sorting. Enum strings would add mapping complexity.

4. **All 7 new modal flags wired into `closeModals()`**
   The global Escape key handler calls `closeModals()` which now resets all 13 modal flags (6 existing + 7 new). This means Escape reliably dismisses any modal.

5. **Supabase fallback: empty arrays for unauthenticated / local mode**
   All three `load*` methods fall through to empty arrays if Supabase is unavailable or user is in local mode. Collections/Wishlist/ForSale are Supabase-only features — no localStorage fallback was added (unlike bags/discs which have localStorage resilience).
   **Rationale:** These features require user accounts by design (shared/social features). No strong offline use case.

---

## Data Migrations — Supabase (2026-05-16)

### bag_history Migration — Append-Only Audit Schema
**By:** Basher (Data Wrangler) | **Date:** 2026-05-16 | **Status:** Implemented & Pushed
**Migration:** `20260516000000_bag_history.sql`

Audit table for disc additions/removals to bags. Immutable by design (append-only, no UPDATE/DELETE RLS policies).

**Schema Decisions:**

1. **TEXT IDs (not UUID)** — Matches existing `bags.id TEXT` and `discs.id TEXT` types. Foreign key constraints require matching types. Avoids type mismatch errors.

2. **Denormalized `disc_name` column** — Even if user deletes a disc from inventory after recording it in bag history, the history entry still displays the disc name. Denormalization trades write consistency for read reliability (audit trail integrity).

3. **No UPDATE/DELETE RLS policies** — Only SELECT (owner read) and INSERT (owner write). Prevents tampering with audit trail. Trade-off: erroneous entries cannot be corrected by user (acceptable for single-user app; admin can fix via SQL).

**Implementation Details:**
- Indexes: `bag_history(bag_id)` (fast lookup of changes), `bag_history(user_id)` (RLS optimization), `bag_history(changed_at DESC)` (chronological UI)
- Idempotent pattern: `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for RLS policies (PG 15/16 compatibility)

**Also included:** Retroactive migration `20260516000001_bags_and_course_pins.sql` to track existing tables that were created ad-hoc in Supabase but never added to `supabase/migrations/`. Wrapped with `IF NOT EXISTS` guards.

---

### hole_assignments Migration — Game Plan Storage
**By:** Basher (Data Wrangler) | **Date:** 2026-05-16 | **Status:** Implemented & Pushed
**Migration:** `20260516000002_hole_assignments.sql`

Schema for storing disc-to-hole game plan recommendations. Scoped to `course_pin_id` to preserve bag context.

**Schema Decisions:**

1. **Scoped to `course_pin_id` (not abstract course)** — Different bags may have different game plans for the same course. Avoids forcing one strategy per course.

2. **Full CRUD RLS (not append-only)** — Unlike `bag_history`, assignments allow UPDATE/DELETE because users change strategy over time. Unique constraint: `(course_pin_id, hole_ref, user_id)` ensures one assignment per hole per course per user.

3. **Denormalized `disc_name` + nullable `disc_id`** — Follows bag_history pattern. If user deletes disc from inventory, assignment still shows disc name (history survival).

4. **TEXT for `course_pin_id`** — Matches `course_pins.id TEXT PRIMARY KEY` type. Keeps FK types consistent.

5. **`holes_data JSONB` on `course_pins`** — OSM hole data is read-heavy, rarely updated, and inherently structured. JSONB column avoids separate `holes` table and enables efficient JSON queries if needed later.

**Implications:**
- Client can query all assignments for a course pin to display game plan UI
- Stats (Core vs Scramble) computed client-side at 5+ hole threshold
- No materialized view needed (current single-user scale: on-demand aggregation sufficient)
- If disc deleted, assignment shows disc name but no longer links to inventory

---

## Frontend Patterns — MVP Build Sprint (2026-05-16)

### Course Holes Parsing + Expandable UI
**By:** Rusty (Frontend Dev) | **Date:** 2026-05-16 | **Status:** Implemented (PR #59)

Fixed hole data display and implemented structured hole parsing from OSM elements.

**Problem:** `getHolesForPin()` filtered for `disc_golf=hole` only, but OSM data predominantly uses `disc_golf=tee` and `disc_golf=basket`. Result: hole list UI showed "No hole data" even after downloading map.

**Solution:**

1. **Inclusive hole filter** — Changed filter to `['hole', 'tee', 'basket'].includes(el.discGolf)`. OSM tagging convention varies by region/contributor; inclusive approach necessary.

2. **Structured parsing** — New `parseHolesFromElements()` function extracts disc_golf nodes, uses OSM `ref` tag as hole number, natural sort by numeric ref + string fallback.

3. **Expandable UI** — Each course card shows collapsible hole list (only when map downloaded). Toggle button shows ▶/▼ + hole count. Clicking hole item opens Google Maps at that location.

4. **State management** — `expandedHoleLists` object tracks per-pin expansion. `getHolesForPin(pin)` retrieves holes from cache. `toggleHoleList(pinId)` toggles expansion. `openHoleInMaps(hole)` navigates.

5. **Alpine.js patterns** — `x-collapse` for smooth expand/collapse, `x-if` for conditional rendering, `x-for` to iterate holes.

**Architecture Decision: localStorage-first approach** — Holes stored in `_courseCache` (localStorage) rather than Supabase `holes_data` JSONB. Unblocks frontend work pending Basher's migration (#57). Sync to Supabase happens later once schema is deployed.

---

### Bag History UI Panel — Moxfield-Style Change Badges
**By:** Rusty (Frontend Dev) | **Date:** 2026-05-16 | **Status:** Implemented (PR #62)

Frontend UI panel displaying bag change history with relative timestamps and +1/-1 badges.

**Architecture:**

1. **Bag expand hook** — Replaced inline `@click` toggle with `openBagDetail(bag)` method that:
   - Toggles bag open/closed
   - Loads history on expand: `await loadBagHistory(bag.id)`
   - Clears history on collapse

2. **History load** — Async fetch from `bag_history` table, ordered `changed_at DESC`, limit 20. Graceful fallback if Supabase unavailable: `bagHistory` stays empty.

3. **UI components:**
   - Toggle button: ▶ Change history / ▼ Hide history
   - Empty state: Centered muted text "No changes recorded yet"
   - History list: +1/-1 badge (green for added, red for removed) | Disc name (bold) | Relative timestamp (right-aligned, muted)

4. **Relative time formatting** — Hand-rolled formatter (no library):
   - < 1 min: "just now"
   - < 1 hr: "Xm ago"
   - < 24 hr: "Xh ago"
   - < 7 days: "Xd ago"
   - else: `toLocaleDateString()`

5. **CSS design:**
   - Colors: Green badge `var(--midrange)` (existing OKLCH green), red `var(--clr-danger)`
   - Flexbox row per entry, hover background transition
   - Spacing: `gap: 0.75rem` between elements, `0.5rem` between entries

**Implementation:** ~50 JS, ~25 HTML, ~80 CSS. Alpine.js `x-transition` for smooth collapse.

---

### Disc Usage Badges: Core vs Scramble
**By:** Rusty (Frontend Dev)  
**Date:** 2026-05-16  
**Status:** Implemented (PR #64)

Show usage badges on disc cards based on hole assignment frequency:
- 🔑 **Core** — disc assigned to 3+ holes OR appears in 2+ courses
- 🎲 **Scramble** — disc assigned to 1-2 holes (situational use)

Stats computed **client-side** from `holeAssignments` state array.

**Implementation:**
- `holeAssignments` array added to Alpine state (loaded at init via `loadAllHoleAssignments()`)
- `computeDiscUsageStats()` iterates assignments, returns Map<discId, { count, courseCount }>
- `getDiscBadge(discId)` applies thresholds, returns 'core' | 'scramble' | null
- Badges shown inline below disc name in inventory cards and bag disc lists (compact emoji-only version)
- Only displayed when assignments exist (graceful empty state)

**Styling:**
- `.disc-usage-badge` — inline-flex, 0.7rem font, rounded pill
- `.badge-core` — OKLCH warm gold background, dark text
- `.badge-scramble` — OKLCH soft purple background, dark text

**Rationale:**
- No DB query overhead (assignments already loaded for game plan feature)
- Acceptable at current scale (<100 discs × <50 assignments)
- Can memoize later if performance issue arises
- 3+ holes = "I reach for this disc frequently"; 2+ courses = "This disc is versatile"
- "Core/Scramble" borrowed from CCG/deck-building culture, clear visual distinction

**Trade-Offs:**
- Recomputes on every render (O(n) where n = assignments)
- Could be slow if assignments grow to 1000s (mitigable via memoization)

---

### Flight Chart Visualization — Pure SVG Scatter Plot
**By:** Rusty (Frontend Dev) | **Date:** 2026-05-16 | **Status:** Implemented (PR #61)

Bag flight chart implemented as pure SVG scatter plot (zero external library).

**Rationale for SVG over chart library:**
- Zero bundle size increase (no Chart.js, D3, etc.)
- Loads instantly (no additional HTTP request)
- Full control over styling/interaction (matches existing OKLCH color system)
- Simple use case (20+ basic dots + labels) doesn't justify library overhead (100KB+ added size)
- Alpine.js reactive bindings work natively with SVG attributes

**Design decisions:**

1. **Why speed vs turn axes** — Turn determines flight path shape (understable vs overstable), Speed determines throw difficulty/distance. Together they show bag coverage at a glance. Glide/fade less visually distinctive for quick scanning.

2. **Why per-bag (not global)** — Users organize discs by bag for specific courses. Bag-level view shows what they'll actually throw in a round. Global chart would be cluttered for 100+ disc inventories.

3. **Coordinate system:**
   - X-axis: Turn (-6 to +2, left=understable, right=overstable)
   - Y-axis: Speed (1-15, inverted so distance drivers at top)
   - Color: OKLCH colors matching disc type badges (putter/mid/fairway/driver)
   - Labels: Disc names (truncated to 7 chars if needed)
   - Tooltip: Full flight numbers on hover (via SVG `<title>` element)

4. **Interaction** — Collapsible panel in bag detail view (Alpine `x-show`).

---

### Decision: Disc-to-Hole Game Plan UI Architecture
**Date:** 2026-05-16  
**Author:** Rusty (Frontend Dev)  
**Context:** Issues #55 + #52 (FR-3 Game Planning feature)

**Decision:**
Implemented per-hole disc assignment UI as an **inline collapsible panel** within each course pin card, not a modal or separate route.

**Rationale:**
1. **Context preservation** — User can see course name, bag, and map download status while building game plan
2. **One-at-a-time focus** — Only one pin's game plan open at a time (via `activePinId` state), reduces cognitive load
3. **Smooth UX** — Alpine `x-transition` provides polished expand/collapse animation
4. **Mobile-friendly** — Avoids modal stacking issues on small screens

**Why per-pin state (not global):**
- Course pins are user-specific instances (same course can be pinned multiple times with different bags)
- Assignments scoped to `course_pin_id` (not abstract `course_id`) matches user mental model
- Bag selection drives disc options — pin → bag → discs is natural data flow

**Why denormalize `disc_name`:**
- Mirrors `bag_history` pattern; survives disc deletion
- Game plans remain readable even if user sells/removes a disc
- No join required for display — direct read from `hole_assignments` table

**Implementation:**
- State: `holeAssignments: []` (loaded per-pin), `activePinId: null` (open panel), `showGamePlan: false` (toggle)
- Hole extraction: `getHolesForPin(pin)` reads from `_courseCache[courseId].mapData.elements`, filters by `['hole', 'tee', 'basket']`, sorts by numeric `ref` tag
- Unique constraint: `(course_pin_id, hole_ref, user_id)` prevents duplicate assignments per hole
- Denormalized `disc_name` stored for display history

**Status:** ✅ Implemented in PR #63 (`squad/52-hole-game-plan-ui`)  
Closes #55, #52

---

## Decision: Disc Modal Overflow + Swatch Alias Fixes
**By:** Rusty (Frontend Dev)  
**Date:** 2026-05-19  
**Status:** Proposed

- Render the disc-name autocomplete dropdown with `position: fixed` using the input's viewport rect instead of anchoring it absolutely inside the scrolling modal card.
- Maintain simple `--disc-*` CSS aliases for UI labels that are normalized by `colorSlug()`.

**Why**
- The modal card uses `overflowY: auto`, so absolutely positioned suggestion menus get clipped.
- The frontend uses simple color names like `Red`, `Blue`, and `Teal`, while the core palette currently exposes more specific token names such as `--disc-crimson` and `--disc-electric-blue`.

**Implementation notes**
- Close the suggestion menu on scroll capture to avoid stale viewport coordinates.
- Keep the existing input wrapper for outside-click detection; only the positioning strategy changes.
- Add the missing simple-name disc color variables in `styles.css` so swatches resolve without falling back to transparent.

---

## Decision: Rusty — Disc Modal Autocomplete Behavior
**Status:** Proposed

In `src/components/DiscModal.tsx`, the DiscIt-powered autocomplete should autofill manufacturer, type, and flight numbers only when the modal is in **Add Disc** mode. In **Edit Disc** mode, the same suggestions remain available for name lookup, but selecting one updates only the name so existing bag-specific metadata is not overwritten.

**Why**
- The modal edits owned discs, so catalog data is helpful as a starting point but should not silently replace user-tuned values.
- Add mode benefits from fast population of known catalog specs.
- Edit mode stays safe for discs with manual corrections, wear-based changes, or custom manufacturer/type fields.

**Implementation notes**
- Catalog source: DiscIt API with shared in-memory cache + 24h `localStorage` cache.
- UI pattern: custom combobox with click-outside close and keyboard navigation.

---

## Decision: React + Vite + TypeScript Scaffold
**Date:** 2026-05-16  
**Submitted by:** Rusty (Frontend Dev)  
**Context:** Anders requested migration from Alpine.js (CDN, no build) to React + Vite + TypeScript

Scaffolded the React migration foundation with the following structure:

### Package Structure
```json
{
  "name": "proispro",
  "version": "2.0.0",
  "type": "module"
}
```

### Dependencies Added
- **React ecosystem:** `react@18.3.1`, `react-dom@18.3.1`, `react-router-dom@6.28.0`
- **Supabase:** `@supabase/supabase-js@2.48.0`
- **Charts:** `recharts@2.15.0`
- **Build tools:** `vite@6.0.7`, `typescript@5.7.2`, `@vitejs/plugin-react@4.3.4`
- **Type definitions:** `@types/react`, `@types/react-dom`, `@types/node`

### Build Verification
- ✅ `npm install` — 124 packages, 0 vulnerabilities
- ✅ `npm run build` — Clean TypeScript + Vite build (1.02s)
- ✅ Output: `dist/` with bundled assets (160KB JS gzipped to 52KB)

---

## Azure/Entra Rebuild — Implementation Log

> These entries record the per-phase implementation decisions that **refine** the
> Active "Azure-hosted, Entra-authenticated, multi-user rebuild" and "Compute/API
> Tier Revision — Functions-in-SWA → Container API on Azure Container Apps"
> decisions above (ADR `docs/adr-azure-entra-rebuild.md`). They add build-level
> detail (seam, IaC, API, adapter/auth, migration, cutover); they do not supersede
> the architecture decisions. Merged by Scribe 2026-02-10.

### Decision: Storage-adapter seam (Phase 0 / P0)

**Author:** Rusty (Frontend Dev)
**Date:** 2026-10-19
**Status:** Implemented — pure refactor, zero behavior change (build green)
**Relates to:** `docs/adr-azure-entra-rebuild.md` §3.1 (the keystone seam)

#### What changed

Introduced a backend-agnostic persistence seam under `src/lib/storage/`. Hooks no
longer import `../lib/supabase` — they talk only to `getStorage()`. The app still
runs 100% on Supabase; only the *indirection* was added.

##### New files
- `src/lib/storage/types.ts` — `StorageAdapter`, generic `Collection<T>`
  (`list/get/put/remove`) plus per-entity collection interfaces, the backup shape
  (`StorageExport` + `exportAll()/importAll()`), and the centralised client entity
  types (`ClientPin`, `HoleAssignment`, `ClientCollection`, `CollectionDisc`,
  `WishlistItem`, `ForSaleListing`, `BagHistoryEntry`). `ClientDisc`/`ClientBag`
  are imported from `utils/disc.ts` (not duplicated).
- `src/lib/storage/supabaseAdapter.ts` — `supabaseAdapter`, a verbatim move of the
  existing `supabase.from(...)` logic (ordering, `toDbDisc`/`fromDbDisc`,
  optimistic-update contracts, and Supabase's resolve-with-`{error}` semantics all
  preserved).
- `src/lib/storage/index.ts` — `getStorage(): StorageAdapter`. Single accessor +
  `VITE_STORAGE` env switch stub (defaults to `'supabase'`).
- `src/vite-env.d.ts` — types `import.meta.env.VITE_STORAGE`.

##### Changed files
- `src/hooks/useDiscs.ts`, `useBags.ts`, `useCoursePins.ts`, `useCollections.ts`,
  `useWishlist.ts`, `useForSale.ts` — now call `getStorage().<entity>.<method>()`.
  **Public hook APIs (returned object shapes) are unchanged**, so pages/components
  were not touched. Hooks that moved their inline client types into `types.ts`
  re-export them (`export type { ... }`) so existing page imports keep working.

`AuthContext.tsx` was intentionally **not** touched (auth seam is P3). Hooks still
read `user` from `useAuth` and pass `user.id` into adapter methods that need it.

#### The contract

`StorageAdapter` exposes one collection per entity: `discs`, `bags`, `bagHistory`,
`coursePins`, `holeAssignments`, `collections`, `collectionDiscs`, `wishlist`,
`forSale`, `saleTokens`. The seven primary entities implement the generic
`Collection<T>` (`list/get/put/remove`) plus only the extra methods a hook actually
uses today (e.g. `discs.setQuantity`, `coursePins.create` returning a success flag,
`holeAssignments.removeByPin`, `forSale.updateStatus`). The join/side tables
(`bagHistory`, `collectionDiscs`, `saleTokens`) expose just their real operations.
Nothing speculative was invented. `exportAll()` is implemented (reads); `importAll()`
is a documented Phase-0 stub (migration-phase concern).

#### How a future adapter plugs in

Implement a new object satisfying `StorageAdapter` (e.g. `src/lib/storage/azureAdapter.ts`,
plain `fetch` to `/api/*`), then add one branch in `getStorage()`:

```ts
// src/lib/storage/index.ts
if (backend === 'azure') return azureAdapter
```

Flip `VITE_STORAGE=azure` to run the new backend side-by-side. **No hook changes.**
That is the whole win: the data layer is swappable, the UI is not rewritten.

#### Verification
- `npm run build` (tsc + vite) — **green**. (Pre-existing recharts chunk-size
  warning is unrelated.)

### Decision: Azure IaC layout + deploy pipeline (Phase 1)

**Date:** 2026-10-19
**Author:** Linus (DevOps)
**Requested by:** AK (Anders)
**Status:** Proposed (files authored; NOT deployed — no Azure credentials in this environment)
**Scope:** Phase 1 of `docs/adr-azure-entra-rebuild.md` — provision the Azure
target architecture as reproducible Infrastructure-as-Code + CI. Files only.

#### Context

The ADR re-targets proispro onto Azure: SWA (SPA + Entra EasyAuth) → Container
Apps API → Azure SQL serverless, with ACR, a managed identity, and Log
Analytics. Phase 1 (Linus) authors the IaC + CI so the stack is reproducible and
boring — no portal click-ops.

#### Decision

##### IaC: azd + Bicep (subscription-scoped), modular

- `infra/main.bicep` — `targetScope = 'subscription'`, creates the resource
  group `rg-proispro-<env>` and orchestrates modules. Globally-unique names use a
  deterministic `uniqueString` token so redeploys of an env are idempotent.
- `infra/modules/` — `monitoring` (Log Analytics, 1 GB/day cap, 30-day
  retention), `identity` (user-assigned MI), `registry` (ACR Basic + AcrPull role
  to the MI), `sql` (logical server, Entra-only auth, serverless GP_S_Gen5 DB with
  auto-pause), `containerapps` (ACA env + API app), `staticwebapp` (SWA Standard).
- `infra/main.parameters.json` — hobby-scale defaults: `minReplicas=0`
  (scale-to-zero), `maxReplicas=3`, SQL `minCapacity=0.5`, `autoPauseDelay=60`,
  ACR Basic, Log Analytics PerGB2018. Uses azd `${VAR=default}` substitution.
- `azure.yaml` — azd services: `web` (host `staticwebapp`, `dist/`) and `api`
  (host `containerapp`, `./api` + Dockerfile). Infra module = `main`.

##### Auth / identity model (no secrets in app)

- **ACR pull** and **Azure SQL access** both go through one **user-assigned
  managed identity**. ACR: AcrPull role assignment in Bicep (admin user disabled).
  SQL: Entra-only auth; Bicep sets the Entra **admin**, but the contained DB user
  for the MI is a **manual post-deploy SQL grant** (documented).
- The container app receives `AZURE_CLIENT_ID`, `SQL_SERVER`, `SQL_DATABASE` as
  env — it connects to SQL with an AAD token, **no password**.

##### CI: GitHub Actions, OIDC, gated on main

- `.github/workflows/azure-deploy.yml`: build API image → push to ACR → update
  ACA revision; build SPA → deploy to SWA. OIDC federated login (`azure/login`),
  **no stored cloud credentials**. Required repo secrets documented in the
  workflow header. The `api` job **auto-skips until `api/Dockerfile` exists**
  (Phase 2 dependency) so the SPA path works meanwhile.

##### Cost posture

Cheapest hobby tiers throughout: ACA Consumption scale-to-zero, SQL serverless
auto-pause (compute-$0 when idle), ACR Basic, Log Analytics capped at 1 GB/day.
Idle cost ≈ storage only.

#### Manual steps that IaC deliberately does NOT own (see `docs/azure-provisioning.md`)

1. **Entra app registration** — create app reg, redirect URIs, client secret,
   (optional) expose `access_as_user` API scope, B2B guest invites for friends.
2. **SWA auth app settings** — `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` (secret
   stays out of source/IaC).
3. **SWA linked backend** — `az staticwebapp backends link` to the ACA app
   (one backend per SWA, region-gated); then lock ACA ingress to the proxy.
4. **SQL identity grant** — `CREATE USER [id-proispro-…] FROM EXTERNAL PROVIDER`
   + `db_datareader`/`db_datawriter` (contained DB user runs inside the DB).
5. **CI bootstrap** — federated credential + repo secrets + AcrPush/Contributor.

#### Verification

- `az bicep build --file infra/main.bicep` → **exit 0, no errors** (Bicep CLI
  0.34.44, Azure CLI 2.78.0). Generated ARM artifact removed; not committed.
- Both YAML files (`azure-deploy.yml`, `azure.yaml`) parse clean.
- Not deployed: no Azure credentials in this environment (by design).

#### Consequences

- Reproducible `azd up` / `az deployment sub create` stands up the whole stack;
  `azd down` tears it back down.
- A new container image + registry + build step is now owned (the ADR's named
  trade-off vs managed Functions) — handled in CI.
- Downstream phases depend on these files: Phase 2 adds `api/` + `Dockerfile`
  (unskips the CI `api` job); Phase 3 adds `staticwebapp.config.json` + the
  `AzureAdapter`; Phase 4 wires DNS cutover.

#### Files created

- `infra/main.bicep`
- `infra/modules/{monitoring,identity,registry,sql,containerapps,staticwebapp}.bicep`
- `infra/main.parameters.json`
- `azure.yaml`
- `.github/workflows/azure-deploy.yml`
- `docs/azure-provisioning.md`

### Decision: P2 — Container API tier (Fastify/TS) + Azure SQL schema

**Author:** Danny (Lead/Architect) · **Date:** 2026-10-19 · **Requested by:** AK
**Scope:** new `api/` project only; implements the ADR's Phase 2.

#### API shape

- Thin, hand-written Fastify/TS REST under `/api`, one uniform CRUD per entity,
  mirroring the client `Collection<T>` contract (`src/lib/storage/types.ts`):
  - `GET /api/{entity}` → `list()` (owner-scoped, ordered per the client's documented order)
  - `GET /api/{entity}/:id` → `get()`
  - `POST /api/{entity}` and `PUT /api/{entity}/:id` → `put()` (upsert)
  - `DELETE /api/{entity}/:id` → `remove()`
  - `GET /api/forsale/shared` → `forSale.listShared()`: every owner's
    `visibility='shared'` listing, read-only (the friends marketplace).
- Entities: `discs`, `bags`, `coursePins`, `holeAssignments`, `collections`,
  `wishlist`, `forsale`. Request/response bodies are the existing **client model
  shapes**, so a future `AzureAdapter` is a near-pass-through.
- One generic factory (`routes/crud.ts`) builds every entity's handlers from a
  small `EntityConfig` (`table`, `orderBy`, `immutable`, `fromRow`, `toRow`).
  Deliberately not over-abstracted — per-entity field mapping stays explicit.

#### Auth model

- **Azure:** SWA EasyAuth + linked backend forwards `x-ms-client-principal`
  (base64 JSON). `auth.ts` decodes it and uses the Entra **`oid`** claim as
  `ownerId`. Missing/invalid → 401.
- **Local dev:** `DEV_AUTH_OWNER` env flag bypasses the header (treats every
  request as that owner). Absent header + absent flag → 401.
- **Trust boundary is the deployment, not the code:** ACA ingress must be locked
  to the SWA proxy; the forwarded header is only trustworthy there. Documented
  fallback (not built this phase): MSAL-in-SPA + validate-JWT middleware.
- **To Azure SQL:** Managed Identity via `DefaultAzureCredential`
  (`AZURE_CLIENT_ID` selects the UAMI); password/connection-string fallback for
  local dev. Pool rebuilt just before token expiry (small reconnect blip — an
  accepted trade-off vs a token-refresh interceptor).

#### ownerId boundary (replaces Supabase RLS)

- `ownerId` is **always** taken from the verified principal and forced onto the
  row in the upsert path; any `ownerId` in the request body is ignored.
- Every statement is **parameterized** (`request.input(...)`), owner-scoped with
  `WHERE ownerId = @ownerId`. No value is concatenated into SQL text.
- The DB does not enforce isolation (no RLS); the API layer is the single
  enforcement point. `/api/forsale/shared` is the one intentional cross-owner
  read, limited to `visibility='shared'`.

#### SQL schema mapping (Supabase/Postgres → Azure SQL, `api/db/schema.sql`)

- `user_id UUID` (FK to `auth.users`, RLS) → `ownerId NVARCHAR(100)` (Entra oid),
  no FK; isolation moves to the API.
- String/uuid PKs → `NVARCHAR(64)`, client-supplied (dropped `gen_random_uuid()` defaults).
- `TIMESTAMPTZ`→`DATETIME2` (UTC `SYSUTCDATETIME()`); `JSONB`(disc_ids)→`NVARCHAR(MAX)` JSON;
  `NUMERIC`→`DECIMAL`; `BOOLEAN`→`BIT`; `TEXT`→`NVARCHAR`.
- Indexes on `ownerId` for every table; plus `visibility` on `forsale_listings`.
- `forsale_listings` gains `visibility ('private'|'shared')` + `seller_name`
  snapshot for the marketplace; replaces the old public `sale_tokens` share model.
- Tables: discs, bags, course_pins, hole_assignments, collections,
  collection_discs (junction, no route this phase), wishlist_items,
  forsale_listings, bag_history.

#### Container / infra alignment

- `api/Dockerfile`: multi-stage (build TS → slim `node:20-slim`), non-root `node`
  user, `EXPOSE 3000`, honors `PORT` — matches `infra/modules/containerapps.bicep`
  (containerPort 3000) and `azure.yaml` service `api` (host containerapp,
  docker context `.`).

#### Verification

- `npm install` + `npm run build` (tsc) in `api/`: **clean** (0 errors).
- Boot smoke test: `/api/*` with no principal → **401**; with a valid `oid`
  principal header → auth passes (reaches DB layer); `/health` boots and probes DB.

#### Follow-ups (not in this phase)

- Lock ACA ingress to the SWA proxy (infra/runbook).
- Post-deploy `CREATE USER ... FROM EXTERNAL PROVIDER` grant for the UAMI (Linus/runbook).
- Phase 4: Supabase→Azure SQL export/import, stamping `ownerId` (Basher).
- Optional: expose `bag_history` / `collection_discs` routes if hooks need them.

### Decision: AzureAdapter + swappable Entra/Supabase auth behind VITE_STORAGE

- **Author:** Rusty (Frontend)
- **Date:** 2026-10-19
- **Phase:** P3
- **Scope:** `src/` only (no `api/`, `infra/`, root `package.json`, or `supabase/` changes; no new deps)

#### What changed

One env switch (`VITE_STORAGE`) now flips the **entire backend — data AND auth —**
without touching a single hook or page.

| `VITE_STORAGE` | Storage adapter | Auth provider |
| -------------- | --------------- | ------------- |
| unset / `supabase` (default) | `supabaseAdapter` | `supabaseAuth` |
| `azure` | `azureAdapter` | `entraAuth` (SWA EasyAuth) |

##### Files created
- `src/lib/storage/azureAdapter.ts` — implements `StorageAdapter` as a thin
  `fetch('/api/...')` client against the REST surface in `api/README.md`.
- `src/lib/auth/types.ts` — `AppUser { id, email? }` + `AuthProviderImpl` seam.
- `src/lib/auth/supabaseAuth.ts` — current Supabase auth logic, moved behind the seam.
- `src/lib/auth/entraAuth.ts` — zero-SDK Entra via `/.auth/me`, `/.auth/login/aad`, `/.auth/logout`.
- `src/lib/auth/index.ts` — `getAuthProvider()` selector (same `VITE_STORAGE` switch).

##### Files changed
- `src/lib/storage/index.ts` — `getStorage()` now returns `azureAdapter` when `VITE_STORAGE==='azure'`.
- `src/contexts/AuthContext.tsx` — no longer hard-wired to Supabase; delegates to the
  auth seam. **Same context value shape** (`user`, `isLoading`, `signIn`, `signOut`),
  so `LoginPage`, `Layout`, and `App` are unchanged. `user` is now `AppUser` (Supabase
  `User` is assignable; only `user.id`/`user.email` are consumed).

#### Key decisions / rationale

- **AzureAdapter is a dumb transport.** Base `/api`, overridable via `VITE_API_BASE`
  for local dev. `credentials: 'include'` so the SWA session cookie /
  `x-ms-client-principal` rides automatically (same-origin linked backend).
- **Server owns `ownerId`.** The Azure path **stops sending `userId`/owner in the
  body** (server stamps it from the verified principal). The Supabase path still
  sends `user_id` — unchanged. `create(..., userId)` signatures are preserved for
  contract compatibility; the Azure impl just drops the arg.
- **Upsert endpoints are full-document**, so partial updates (`setQuantity`,
  `bags.update`, `coursePins.update`, `collections.update`, `wishlist.update`,
  `forSale.updateStatus`) are **read-modify-write**: GET current → merge patch →
  re-POST. 404 on GET → undefined; 404 on DELETE → treated as success (idempotent).
  Non-2xx → `throw new Error(serverMessage)` (mirrors the error surfacing hooks expect).
- **Client-minted ids.** Supabase let the DB mint ids on `create`; the Azure upsert
  requires `id` in the body, so `coursePins`/`holeAssignments`/`collections`/`wishlist`/
  `forSale` create paths use `crypto.randomUUID()`.
- **`importAll` is implemented on Azure** (per-entity re-upsert) — unlike the Supabase
  Phase-0 stub — since every write is owner-stamped server-side.
- **Entra is zero-SDK (no MSAL).** EasyAuth injects the principal; the browser never
  handles a token. `onChange` is a no-op (redirect-based; `getUser()` re-reads
  `/.auth/me` after the login redirect). **MSAL is the documented fallback only if the
  SPA ever leaves SWA** (ADR §3.1) — isolated to `entraAuth.ts`.

#### Known gaps (no server surface yet — documented, not silently broken)

The REST API exposes the 7 CRUD entities only. These `StorageAdapter` members have
**no `/api` route**, so the Azure impls are intentional no-ops/empties with inline
comments pointing at the ADR:
- `bagHistory` — audit log not carried into the Azure model (ADR §3.2).
- `collectionDiscs` — membership is modeled as embedded `discIds` on the collection
  (ADR §3.2), not a join table; wiring it onto the collections entity is a follow-up.
- `saleTokens` — the anonymous `sale.html?token=...` link is replaced by the
  authenticated friends marketplace `GET /api/forsale/shared` (ADR §3.3).

`azureAdapter.forSale` additionally exposes `listShared()` → `GET /api/forsale/shared`
for that marketplace (extra method beyond the P0 `ForSaleCollection` contract).

#### Verification

Both builds pass clean (`tsc && vite build`), proving both adapters + both auth impls typecheck:

- `npm run build` (default / supabase) → ✓ built, 719 modules.
- `$env:VITE_STORAGE='azure'; npm run build` → ✓ built, 719 modules.

### Decision: Supabase → Azure SQL migration tooling (Phase 4)

- **Author:** Basher (Data Engineer)
- **Date:** 2026-10-19
- **Scope:** `tools/migration/` (self-contained Node + TS CLI). No changes to
  `src/`, `api/`, `infra/`, `supabase/`, or root `package.json`.
- **Context:** ADR `docs/adr-azure-entra-rebuild.md` §4/§4.1 — migrate data via
  JSON **export → import (stamping `ownerId`)**. Target schema is
  `api/db/schema.sql` (Danny).

#### Decision

A one-time, isolated CLI with three commands (`export`, `import`, `verify`),
its own `package.json` (`@supabase/supabase-js`, `mssql`, `@azure/identity`,
`dotenv`, `typescript` + `tsx`). Compiles cleanly with `tsc`.

##### Migration approach
- **Export = faithful raw dump.** `export.ts` reads every Supabase table
  (`discs, bags, course_pins, hole_assignments, collections, collection_discs,
  wishlist_items, forsale_listings, bag_history`) with pagination, preserving
  the source `user_id`, into one `proispro-backup.json` (shape mirrors
  `StorageExport` plus `bagHistory`). `collection_discs` has no `user_id` in
  Postgres, so each row is stamped with its parent collection's owner at export.
- **Translation happens at import**, not export (keeps the backup auditable and
  re-importable). `src/mapping.ts` is the single source of truth for Postgres →
  T-SQL column names + types, reconciled against `api/db/schema.sql`:
  snake_case columns kept, `NUMERIC→DECIMAL`, `BOOLEAN→BIT`,
  `TIMESTAMPTZ→DATETIME2`, JSONB (`disc_ids`, `tags`) → `NVARCHAR(MAX)` JSON.
- **Dropped (no target column):** `discs.flight` (legacy), `course_pins.holes_data`,
  `forsale.price/currency/contact_*`.
- **New Azure-only columns:** `forsale_listings.visibility` defaults to
  `'private'` (owners opt into the friends marketplace later); `seller_name`
  copied only if present. `status` constrained to `available|sold`.

##### ownerId mapping (never guessed)
- `ownerId` = Entra object id (oid, GUID). Supplied **only** via
  `--owner <oid>` (single user) and/or `--owner-map owner-map.json`
  (`{ "<supabase_user_id>": "<entra_oid>" }`). Map entry wins; `--owner` is the
  fallback. If any row is unmapped, import **aborts before any DB write** — no
  partial, half-owned load. Owner ids are shape-validated (GUID) with a warning.

##### Idempotency & safety
- Default = **UPSERT** via parameterised `MERGE` on each table's primary key →
  re-runs converge, safe to repeat.
- `--fresh` = **scoped truncate-and-load**: deletes only the migrated owners'
  rows (`WHERE ownerId IN (...)`) inside a per-table transaction, then loads;
  other users' data is never touched.
- `--dry-run` resolves owners and builds the full row set with **zero** DB
  writes. Every value is bound with its explicit `mssql` type (NULLs/decimals
  safe). All writes are parameterised (no string interpolation of data).

##### Verification (round-trip)
- `verify.ts` (and `import --verify`) print per-table `source=<n> target=<n>`
  with `OK`/`!!` and a non-zero exit on mismatch; target counts are scoped to the
  migrated owners when a map/owner is given.

##### Auth
- Azure SQL: `SQL_AUTH=aad` (preferred, `DefaultAzureCredential` → access token)
  or `SQL_AUTH=sql` (user/password). Both documented in `.env.example`/README.
- Supabase export: service_role key (full read) documented as the happy path.

#### Verification performed
- `npm install` + `npm run build` (tsc) — **compiles cleanly, exit 0**, all 10
  modules emitted.
- `import --dry-run` against a sample backup — mapping + owner stamping correct.
- Guardrail confirmed: no `--owner`/`--owner-map` → hard abort "Refusing to
  guess ownership." `--owner-map` resolves source user_id → oid as expected.
- Generated `MERGE` SQL inspected: column list matches `api/db/schema.sql`
  exactly for `dbo.discs`.

#### Columns I double-checked (and resolved)
- `collection_discs` → no source `user_id`; stamped from parent collection. ✔
- `forsale` `visibility`/`seller_name` → Azure-only; defaulted, not from source. ✔
- `discs.tags` → not guaranteed in source; stored as JSON text if present else NULL. ✔
- `course_pins.holes_data`, legacy `flight`, forsale `price/contact_*` → intentionally dropped. ✔

### Decision: docs reconciled to Azure/Entra reality; cutover gated on user deploy

**Author:** Danny (Lead / Architect)
**Date:** 2026-10-19
**Phase:** P6 (docs/config only)
**Requested by:** Anders (AK)

#### Context

Phases P0–P4 built the Azure/Entra rebuild (storage-adapter seam, Bicep IaC,
Fastify ACA API, Azure adapter + auth seam, Supabase→Azure SQL migration CLI) —
all compile green. But the squad config docs still described the *old* stack
(Alpine.js + Supabase + GitHub Pages), and there was no runbook for actually
going live.

#### Decision

1. **`.squad/team.md` reconciled.** The "Tech Stack" table now states the real
   target: React 18 + TS + Vite SPA, Azure Static Web Apps, Node + Fastify on
   ACA, Azure SQL (serverless), Microsoft Entra ID (SWA EasyAuth), with the
   `VITE_STORAGE` storage-adapter seam noted as the transition mechanism. The
   Coding Agent capability rows were retargeted to the Azure stack (Azure SQL /
   T-SQL 🟢, Bicep/ACA/SWA 🟢, storage seam 🟢; Entra auth / `ownerId` scoping
   🟡, migration tooling 🟡; color 🔴).
2. **`.squad/routing.md` reconciled.** Stale Alpine.js / Supabase-RLS rows
   replaced: Azure SQL schema + API routes → Danny; ACA/SWA/Entra infra + CI +
   DNS → Linus; React components/adapters/auth wiring → Rusty; Supabase→Azure
   migration/data tooling → Basher. Table structure preserved.
3. **`docs/CUTOVER.md` written** — an 8-step, gated, user-driven runbook:
   provision → Entra/SWA auth + guest invites → schema + MI grant → API deploy +
   `/health` → data migration (export/import/verify) → flip `VITE_STORAGE=azure`
   (go-live) → **retire Supabase (destructive, point of no return)** → DNS
   cutover. Includes an instant-rollback note (flip the toggle back) valid until
   the retire step.

#### Why gated / Supabase retained

Going live requires **the user's Azure credentials and tenant permissions**
(subscription, Entra app reg, B2B guest invites, DNS) which are **not available
in this environment**. `VITE_STORAGE` defaults to `supabase`, so **production
keeps running on Supabase** and remains instantly reversible until the user
completes Step 6 and consciously executes the destructive Step 7. No Supabase
code, the `supabase/` directory, or legacy Alpine files were removed in this
phase — Step 7 is the checklist, executed later by the user.

#### Scope / non-actions

- Changed only `.squad/team.md`, `.squad/routing.md`, `docs/CUTOVER.md`, and this
  note. No changes to `src/`, `api/`, `infra/`, `tools/`, `package.json`, or
  `supabase/`. No git-mutating commands or `npm install` run.
- `sale.html` fate (the old anonymous share page vs. the authenticated
  `/api/forsale/shared` marketplace) is flagged as a Step 7 decision —
  recommended removal or a static redirect — to be confirmed at cutover.

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
