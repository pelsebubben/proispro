# proispro migration tooling — Supabase → Azure SQL

One-time, idempotent, verifiable migration of proispro data from the legacy
Supabase (Postgres) backend into the new **Azure SQL** schema, stamping each row
with its Entra `ownerId`. Part of **Phase 4** of `docs/adr-azure-entra-rebuild.md`.

Three steps:

1. **`export`** — dump every Supabase table to a single `proispro-backup.json`.
2. **`import`** — load that backup into Azure SQL, stamping `ownerId`.
3. **`verify`** — compare source vs target row counts (round-trip check).

This project is fully self-contained (its own `package.json`); it does not touch
`src/`, `api/`, `infra/`, or `supabase/`.

---

## 0. Prerequisites

```bash
cd tools/migration
npm install
npm run build        # optional: type-check / emit dist/ (CLIs run via tsx)
cp .env.example .env # then fill in values
```

The target database must already exist and have the schema from
`api/db/schema.sql` applied (that script is idempotent — safe to re-run).

---

## 1. Environment variables (`.env`)

| Variable | Used by | Meaning |
|---|---|---|
| `SUPABASE_URL` | export | `https://<ref>.supabase.co` |
| `SUPABASE_KEY` | export | A key that can **read every row**. The **service_role** key is the happy path for a full multi-user dump (bypasses RLS). Keep it secret. |
| `SQL_SERVER` | import/verify | `your-server.database.windows.net` |
| `SQL_DATABASE` | import/verify | e.g. `proispro` |
| `SQL_AUTH` | import/verify | `aad` (Entra, default) or `sql` |
| `SQL_USER`, `SQL_PASSWORD` | import/verify | only when `SQL_AUTH=sql` |
| `SQL_PORT`, `SQL_ENCRYPT`, `SQL_TRUST_SERVER_CERT` | import/verify | optional tuning |

### Azure SQL auth modes

- **`SQL_AUTH=aad` (preferred).** Uses `@azure/identity`'s
  `DefaultAzureCredential`, so any of these work with no secrets in the file:
  - `az login` (your own Entra user — simplest for a one-shot run), or
  - a managed identity (when run from Azure), or
  - a service principal via `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
    `AZURE_CLIENT_SECRET` env vars.

  The user/identity needs rights to INSERT/UPDATE/DELETE on the target tables.
- **`SQL_AUTH=sql`.** Classic SQL login with `SQL_USER` / `SQL_PASSWORD`. Handy
  before Entra admin is configured on the server.

---

## 2. Getting the Entra object id(s) (`oid`) for your friends

`ownerId` **is** the Entra object id (a GUID). Each person signs into the app at
least once (so they exist as a principal in the tenant), then grab their `oid`:

- **Easiest:** have each person open the running app and visit `/.auth/me`
  (SWA EasyAuth) — the `userId` / `oid` claim is their object id.
- **Azure CLI (your own):** `az ad signed-in-user show --query id -o tsv`
- **A specific user (as tenant admin):**
  `az ad user show --id friend@example.com --query id -o tsv`
- **Guest/B2B accounts:** `az ad user list --query "[].{name:displayName,oid:id}" -o table`

You never guess these — the tool refuses to run without a real mapping (below).

---

## 3. Export (Supabase → `proispro-backup.json`)

```bash
npm run export                 # writes ./proispro-backup.json
npm run export -- --out mybackup.json
```

What it does:

- Reads every table (`discs`, `bags`, `course_pins`, `hole_assignments`,
  `collections`, `collection_discs`, `wishlist_items`, `forsale_listings`,
  `bag_history`), paging past Supabase's 1000-row limit.
- Preserves the source **`user_id`** on every row so ownership survives.
  `collection_discs` has no `user_id` in Postgres, so each row is stamped with
  the owner of its parent collection.
- Missing tables are skipped with a warning (0 rows), not a hard failure.
- Prints the distinct source `user_id`s so you can build an owner-map.

The backup stores **raw Postgres rows**; the Postgres→T-SQL translation happens
at import time (see `src/mapping.ts`).

---

## 4. Import (`proispro-backup.json` → Azure SQL, stamping `ownerId`)

You must tell the tool how to turn each source `user_id` into an Entra `oid`.
**Two options** (it refuses to guess):

### Option A — single user (`--owner`)
Migrate everything to one owner (e.g. Anders migrating his own data first):

```bash
npm run import -- --owner <entra_oid>
```

### Option B — multiple users (`--owner-map`)
`owner-map.json`:
```json
{
  "<supabase_user_id_1>": "<entra_oid_1>",
  "<supabase_user_id_2>": "<entra_oid_2>"
}
```
```bash
npm run import -- --owner-map owner-map.json
```

A map entry wins; `--owner` is the fallback for any unmapped `user_id`. If a row
has no mapping and no `--owner`, the import **aborts before writing anything**.

### Flags

| Flag | Effect |
|---|---|
| `--in <file>` | backup path (default `proispro-backup.json`) |
| `--owner <oid>` | stamp every row with this Entra oid |
| `--owner-map <file>` | per-`user_id` → oid JSON map |
| `--fresh` | delete existing target rows **for the owners in this backup** first, then load (scoped — other users untouched) |
| `--dry-run` | resolve owners + build the row set, print per-table counts, **no DB writes** |
| `--verify` | after import, print source-vs-target counts |

### Idempotency

- **Default = UPSERT.** Every row is written with a parameterised `MERGE` on the
  primary key, so re-running imports is safe and converges to the same state.
- **`--fresh` = truncate-and-load, scoped by `ownerId`.** Deletes only the
  migrated owners' rows inside a per-table transaction, then loads. Safe to
  re-run; never affects other users.

Always try `--dry-run` first:

```bash
npm run import -- --owner <oid> --dry-run
```

---

## 5. Verify (source vs target row counts)

```bash
npm run verify -- --owner <oid>            # scoped to that owner
npm run verify -- --owner-map owner-map.json
npm run verify                              # UNSCOPED (whole-table target counts)
```

Prints `source=<n> target=<n>` per table and `OK`/`!!`. Exits non-zero on any
mismatch so it can gate a script. You can also fold it into the import run with
`npm run import -- --owner <oid> --verify`.

---

## 6. Recommended one-user round-trip

```bash
# 1. export from Supabase
npm run export

# 2. preview the mapping, no writes
npm run import -- --owner <your_oid> --dry-run

# 3. load (fresh so re-runs are clean), then verify
npm run import -- --owner <your_oid> --fresh --verify
```

---

## Notes / translation decisions

- `ownerId` is **never** read from the data — only from `--owner` / `--owner-map`.
- `forsale_listings.visibility` and `seller_name` are **new** in Azure SQL (the
  friends marketplace) and don't exist in Supabase. Import defaults
  `visibility='private'` (owners opt in to sharing later) and copies
  `seller_name` only if present. Legacy `price`/`currency`/`contact_*` columns
  have no target and are dropped.
- `course_pins.holes_data` (JSONB) has no target column and is dropped — hole
  data lives in `hole_assignments`.
- `disc_ids` (JSONB) and `tags` are stored as JSON text in `NVARCHAR(MAX)`.
- Timestamps → `DATETIME2`; booleans → `BIT`; `NUMERIC` → `DECIMAL`.
- `.env`, `owner-map.json`, and `*backup.json` are gitignored — never committed.
