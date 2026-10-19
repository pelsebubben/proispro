# Squad Team

> proispro

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Danny | Lead | `.squad/agents/danny/charter.md` | ✅ Active |
| Rusty | Frontend Dev | `.squad/agents/rusty/charter.md` | ✅ Active |
| Basher | Data Engineer | `.squad/agents/basher/charter.md` | ✅ Active |
| Linus | DevOps | `.squad/agents/linus/charter.md` | ✅ Active |
| Saul | Color Expert | `.squad/agents/saul/charter.md` | ✅ Active |
| Livingston | UX Designer | `.squad/agents/livingston/charter.md` | ✅ Active |
| Scribe | Session Logger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | `.squad/agents/ralph/charter.md` | 🔄 Monitor |
| @copilot | Coding Agent | `.github/copilot-instructions.md` | 🤖 Coding Agent |

## Coding Agent

<!-- copilot-auto-assign: true -->

@copilot picks up issues labeled `squad:copilot` autonomously via GitHub Copilot. No session required.

### Capabilities

| Domain | Fit | Notes |
|--------|-----|-------|
| React 18 + TypeScript components, vanilla CSS | 🟢 Good fit | Proceed autonomously |
| Azure SQL schema / T-SQL (`api/db/schema.sql`) | 🟢 Good fit | Proceed autonomously |
| Bicep / ACA / SWA infra (`infra/`) | 🟢 Good fit | Proceed autonomously |
| GitHub Actions, CI/CD workflows | 🟢 Good fit | Proceed autonomously |
| Storage-adapter seam (`VITE_STORAGE` toggle) | 🟢 Good fit | Proceed autonomously |
| Entra auth / `ownerId` scoping | 🟡 Needs review | Note in PR — Danny should review before merge |
| Supabase→Azure SQL migration tooling | 🟡 Needs review | Note in PR — Danny should review before merge |
| Color system decisions | 🔴 Not suitable | Route to Saul instead |

## Project Context

- **Project:** proispro
- **Created:** 2026-04-13

## Tech Stack

> Target architecture per `docs/adr-azure-entra-rebuild.md`. The storage-adapter
> seam lets both backends coexist during the transition; production still runs on
> Supabase until the user completes the Azure cutover (see `docs/CUTOVER.md`).

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + TypeScript + Vite (SPA), vanilla CSS with OKLCH color system |
| **Hosting** | Azure Static Web Apps (migrating from GitHub Pages) |
| **API** | Node + Fastify (TypeScript) on Azure Container Apps |
| **Database** | Azure SQL (serverless) — *not* Supabase |
| **Auth** | Microsoft Entra ID (via SWA EasyAuth) |
| **Data access** | Storage-adapter seam — `VITE_STORAGE=supabase\|azure` — swappable during the transition |
