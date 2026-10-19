# proispro Cutover Runbook — Supabase → Azure

> **Status:** Gated, user-driven. Nothing here runs automatically. Every step
> below needs **your Azure credentials** and tenant permissions, which are not
> available in the build environment. The code is built and green on both
> backends; going live is a deliberate operator action.

This is the sequential, honest checklist to **go live on Azure** and then
**retire Supabase**. It ties together the pieces already built:

- Infra (Bicep + azd): `docs/azure-provisioning.md`, `infra/`, `azure.yaml`
- API (Fastify on ACA): `api/README.md`, `api/db/schema.sql`
- Migration CLI: `tools/migration/README.md`
- Storage/auth seam: `src/lib/storage/index.ts` (`VITE_STORAGE` toggle)
- Decision record: `docs/adr-azure-entra-rebuild.md`

**The core safety rail:** `VITE_STORAGE` defaults to `supabase`, so production
keeps running on Supabase until **Step 6** flips it to `azure`. You can flip it
back instantly (**Rollback**) at any point before **Step 7**.

---

## Prerequisites

- An **Azure subscription** with rights to create resource groups and the
  resources in `infra/main.bicep` (SWA, ACA, ACR, Azure SQL, Log Analytics,
  managed identity).
- **Tooling** (versions per `docs/azure-provisioning.md §1`): `az` ≥ 2.60,
  `az bicep`, `azd`, Docker, and `sqlcmd` (or Azure Data Studio) for the SQL
  grant.
- **Entra permissions** to: create an **app registration**, set redirect URIs,
  create a client secret, and **invite B2B guests** (friends).
- Access to the **DNS zone** for the production hostname (Step 8).
- Your own **Entra object id**: `az ad signed-in-user show --query id -o tsv`.

Validate the IaC compiles before touching the cloud:

```bash
az bicep build --file infra/main.bicep   # must exit 0
```

---

## Step 1 — Provision the infrastructure

Create all Azure resources. See `docs/azure-provisioning.md §3`.

```bash
az login
az account set --subscription "<subscription-id>"

# Path A (recommended): azd
azd auth login
azd env new dev
azd env set AZURE_LOCATION westeurope
azd env set SQL_AAD_ADMIN_LOGIN     "you@contoso.com"
azd env set SQL_AAD_ADMIN_OBJECT_ID "<your-entra-object-id>"
azd provision        # RG + all resources (no app code yet)
# (azd up also builds/pushes the image + deploys — see Step 4/6)
```

Capture the outputs — `WEB_STATIC_WEB_APP_NAME`, `API_CONTAINER_APP_NAME`,
`AZURE_CONTAINER_REGISTRY_NAME`, `SQL_SERVER_FQDN`, `SQL_DATABASE_NAME`,
`API_MANAGED_IDENTITY_NAME`. You need them in later steps.

**Gate:** resources exist; `az group show` and the SWA/ACA/SQL resources all
return. Do not proceed until provisioning succeeds.

---

## Step 2 — Entra app registration + SWA auth + invite friends

See `docs/azure-provisioning.md §2 and §4`.

1. Create the app registration and add the SWA redirect URI
   (`https://<swa-hostname>/.auth/login/aad/callback`); create a client secret.
2. Set the SWA AAD provider app settings (`AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`) via `az staticwebapp appsettings set`.
3. Confirm `staticwebapp.config.json` wires the `azureActiveDirectory` provider
   and `openIdIssuer` for your tenant.
4. Link the SWA backend to the ACA API (`az staticwebapp backends link`) and
   **lock ACA ingress** to the SWA proxy only (`docs/azure-provisioning.md §5`).
5. Invite each friend as a **B2B guest**:
   ```bash
   az ad user invite \
     --invited-user-email-address "friend@example.com" \
     --invite-redirect-url "https://<swa-hostname>"
   ```

**Gate:** you can reach the SWA, sign in with Entra, and `/.auth/me` returns
your principal. Each friend has accepted their guest invite.

---

## Step 3 — Apply the database schema + managed-identity grant

1. Apply the target schema (idempotent — safe to re-run):
   ```bash
   sqlcmd -G -S <SQL_SERVER_FQDN> -d <SQL_DATABASE_NAME> -i api/db/schema.sql
   ```
2. Run the **post-deploy managed-identity grant** as the Entra SQL admin
   (`docs/azure-provisioning.md §6`), substituting `API_MANAGED_IDENTITY_NAME`:
   ```sql
   CREATE USER [id-proispro-<token>] FROM EXTERNAL PROVIDER;
   ALTER ROLE db_datareader ADD MEMBER [id-proispro-<token>];
   ALTER ROLE db_datawriter ADD MEMBER [id-proispro-<token>];
   ```

**Gate:** tables exist; the ACA managed identity is a contained DB user with
read/write.

---

## Step 4 — Build/push the API image + deploy, verify `/health`

Via CI (`.github/workflows/azure-deploy.yml`, OIDC) on `main`, or manually
(`azd up`, or `az acr build` + `az containerapp update`). See
`docs/azure-provisioning.md §7` and `api/README.md`.

```bash
curl -fsS https://<swa-hostname>/api/../health   # through SWA, or hit ACA health probe
# Expect: 200 with a DB-connectivity probe OK
```

**Gate:** `/health` returns 200 and reports DB connectivity. The API connects to
Azure SQL via managed identity (no password).

---

## Step 5 — Migrate data (export → import → verify)

See `tools/migration/README.md`. Run from `tools/migration/` with a `.env`
pointing export at Supabase (service_role key) and import/verify at Azure SQL
(`SQL_AUTH=aad`, `az login`).

1. Get each friend's Entra **object id (`oid`)** — have them visit `/.auth/me`,
   or `az ad user show --id friend@example.com --query id -o tsv`.
2. Export from Supabase:
   ```bash
   npm run export                 # writes ./proispro-backup.json
   ```
3. Import, stamping `ownerId`. Single user with `--owner`, or multi-user with
   an `owner-map.json` via `--owner-map`:
   ```bash
   npm run import -- --owner <your_oid> --dry-run          # preview, no writes
   npm run import -- --owner-map owner-map.json --fresh --verify
   ```
4. Verify row counts match source vs target:
   ```bash
   npm run verify -- --owner-map owner-map.json
   ```

**Gate:** `verify` prints `OK` for every table (exit 0). Spot-check a few
records per owner in the app (still on Supabase at this point).

---

## Step 6 — Flip `VITE_STORAGE=azure` and deploy the SPA

This is the actual go-live. Set the build-time env var and redeploy the SPA.

- In CI / SWA build config, set `VITE_STORAGE=azure` (the toggle is read in
  `src/lib/storage/index.ts`; this also selects Entra auth via the parallel
  `src/lib/auth/` seam).
- Build and deploy the SPA to SWA.
- **Smoke test:** sign in with Entra, confirm your migrated discs/bags/etc.
  load, create/edit/delete a record, and check the friends marketplace
  (`/api/forsale/shared`).

**Gate:** signed-in users see their migrated data served from Azure SQL; writes
persist. Production now runs on Azure.

---

## Step 7 — Retire Supabase (DESTRUCTIVE — only after Step 6 is verified)

> Do **not** run any of this until Step 6 has been verified in production and
> you are satisfied with Azure. These actions remove the rollback path. This
> runbook does **not** perform them — it is the checklist.

1. **Drop the dependency:** remove `@supabase/supabase-js` from the root
   `package.json` (and reinstall to update the lockfile).
2. **Delete the Supabase adapter/auth/client files:**
   - `src/lib/storage/supabaseAdapter.ts`
   - `src/lib/auth/supabaseAuth.ts`
   - `src/lib/supabase.ts`
3. **Simplify the toggle to azure-only:** in `src/lib/storage/index.ts` drop the
   `supabase` branch/import and the `StorageBackend` union's `supabase` arm so
   `getStorage()` always returns the Azure adapter; do the same in
   `src/lib/auth/index.ts`. Remove the now-dead `VITE_STORAGE` fallback.
4. **Delete the `supabase/` directory** (`functions/`, `migrations/`, `.temp/`).
5. **Retire legacy Alpine/static files** superseded by the React SPA:
   - `app.js`, `disc-catalog.js`
   - `flight-guide.html`, `flight-guide.css`, `flight-guide.js`
   - `legacy-index.html` and any legacy index assets
6. **Decide the fate of `sale.html`** — the old **anonymous** public share link.
   It is replaced by the **authenticated** friends marketplace
   (`GET /api/forsale/shared`, `forSale.listShared()`). Recommended: **remove
   it** (no anonymous sharing in the Entra model). If any external links to it
   must survive, replace it with a static redirect to the authenticated
   marketplace route rather than keeping the Supabase-backed page. Record the
   choice in `.squad/decisions/`.
7. Rebuild, run the full test suite, and redeploy. Confirm no remaining imports
   reference Supabase (`rg -i supabase src/`).

**Gate:** clean build with no Supabase references; app fully functional on
Azure only.

---

## Step 8 — DNS cutover

Repoint the production hostname from GitHub Pages to the SWA. This is a Linus /
DevOps action against the DNS zone.

- Update the **CNAME** for the apex/subdomain to the SWA default hostname (or
  add the custom domain in SWA and follow its validation/`CNAME` instructions).
- Add the custom domain in the SWA resource and wait for TLS to provision.
- Verify the site resolves to SWA and serves over HTTPS; confirm the old GitHub
  Pages CNAME is removed.

**Gate:** the production domain serves the Azure SWA with a valid certificate.

---

## Rollback

Until **Step 7** removes the Supabase code, rollback is instant and total:

- Set **`VITE_STORAGE=supabase`** (and redeploy the SPA, or revert the SWA build
  setting). The app returns to the Supabase backend and auth immediately.
- Supabase data is untouched by the migration (export is read-only; import only
  writes to Azure SQL), so no data loss on revert.

After Step 7 there is no fast rollback — treat Step 7 as the point of no return
and only cross it once Azure has run cleanly in production for a comfortable
window.

---

## Step summary

| Step | Action | Reversible? |
|------|--------|-------------|
| 1 | Provision infra (azd/Bicep) | n/a |
| 2 | Entra app reg + SWA auth + guest invites | yes |
| 3 | Apply schema + MI grant | yes |
| 4 | Build/deploy API, verify `/health` | yes |
| 5 | Migrate data (export/import/verify) | yes (Supabase untouched) |
| 6 | `VITE_STORAGE=azure` + deploy SPA — **GO LIVE** | yes (flip back) |
| 7 | **Retire Supabase + legacy files** | **NO — point of no return** |
| 8 | DNS cutover to SWA | yes (repoint CNAME) |
