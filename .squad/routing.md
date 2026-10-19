# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| React components, storage adapters, auth wiring | Rusty | {example: build form modals, wire `AzureAdapter`/`SupabaseAdapter` behind the seam, SWA EasyAuth vs Supabase auth} |
| Azure SQL schema, T-SQL, API routes | Danny | {example: design `api/db/schema.sql`, owner-scoped Fastify CRUD routes} |
| ACA/SWA/Entra infra, Bicep, CI/CD, DNS | Linus | {example: azd/Bicep deploy, SWA linked backend, Entra app reg, CNAME cutover, GitHub Actions} |
| Supabase→Azure SQL migration & data tooling | Basher | {example: export/import/verify CLI, `ownerId` stamping, owner-map} |
| Color palettes, accessibility, color systems | Saul | {example: "generate an accessible color palette", "check this color for WCAG contrast"} |
| UX critique, layout redesigns, interaction design, data viz UX | Livingston | {example: "redesign the flight guide grid", "improve the disc card layout", "audit mobile UX"} |
| Code review | Danny | Review PRs, check quality, suggest improvements |
| Testing | Rusty | Write tests, find edge cases, verify fixes |
| Scope & priorities | Danny | What to build next, trade-offs, decisions |
| Session logging | Scribe | Automatic — never needs routing |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |
| `squad:copilot` | Auto-assigned to @copilot coding agent via squad-heartbeat.yml | @copilot |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.

## Work Type → Agent

| Work Type | Primary | Secondary |
|-----------|---------|----------|
| Architecture, decisions, review | Danny | — |
| React, TypeScript, vanilla CSS, storage adapters | Rusty | Saul, Livingston |
| Azure SQL schema, API routes, `ownerId` scoping | Danny | Basher |
| ACA/SWA/Entra infra, Bicep, deployment, DNS | Linus | — |
| Supabase→Azure SQL migration & data tooling | Basher | Danny |
| Autonomous issue work | @copilot | Danny |

