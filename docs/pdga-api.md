# PDGA course catalogue and API access

The application supports a Norway PDGA course directory alongside OSM. Migration
005 creates a separate `pdga_catalog` schema; the runtime can only read it. PDGA
records never enter the ODbL export or the OSM ingestion job. Course identifiers
remain source-specific, preserving existing pins and private bag links. Courses
from different providers are not automatically merged or treated as the same
layout.

The documented PDGA Course Search API supplies course details and hole counts,
not individual holes, tees, baskets or layout variants. PDGA results explicitly
show **layout unavailable**. They can be linked to a bag configuration, but no
hole-by-hole disc assignments or layout completeness are invented. Official
individual-hole access is a separate prerequisite for advanced layout planning.

## Server-side ingestion (not enabled automatically)

`server/pdga-client.mjs` shares the tested login/logout implementation with the
local launcher below. The Norway ingestion paginates in batches of 200 with a
5,000-record safety bound. Duplicate IDs, failed pages, wrong countries and
unexpectedly small snapshots abort ingestion. Only names, city, country,
coordinates, stated hole count, stable course ID and canonical PDGA node URL are
retained. Personal contact fields and raw API responses are discarded.

`server/sync-pdga.mjs` publishes a validated snapshot in one PostgreSQL
transaction under an advisory lock. Older snapshots and count drops above 25%
are rejected; removed records become inactive so existing pins survive.
Publication occurs only after confirmed API logout. The worker emits sanitized
success/failure events and exits nonzero on failure, without logging credentials
or database error details. Investigate failures through the existing Azure job
execution status before retrying; there is no automatic retry storm.

Before activation, verify that the account's agreement permits this server-side
cache, in-app display and intended use. `PDGA_CACHE_APPROVED=true` is an explicit
operator gate, not a claim that approval has already been obtained.

`infra/pdga-sync.bicep` defines a **manual** Azure Container Apps worker, disabled
by default (`cacheApproved=false`). It reuses the existing environment, private
database and image-pull identity. A separate PDGA writer can read/insert/update
only its own catalogue tables and cannot access private user records or OSM.
Administrator credentials occur only in the short-lived setup job, never the
worker or application. All credential parameters are secure and the worker
references Azure job secrets.

Deployment sequence after confirming terms:

1. Release schema 5 and the application through the existing dev release path.
2. Supply integration credentials and a fresh 32+ character PDGA-writer password
   through a trusted secret provisioning process, not chat, Git, argv, parameter
   files, workflow outputs, debug logs or shell history. Use a dedicated PDGA
   account if permitted. No credentials from the local test were saved.
3. Deploy the Bicep with secure in-memory parameters and `cacheApproved=true`,
   run `job-griplock-pdga-setup-dev`, verify success and delete the setup job.
   Never rotate a dev role from verification: PostgreSQL roles are cluster-wide.
4. Run `job-griplock-pdga-dev` and confirm its execution succeeds. Verify Ekeberg
   search, the PDGA course link, unavailable-layout notice, and an unchanged
   OSM-only export through the authenticated app.
5. Set a schedule only after confirming PDGA's permitted refresh interval,
   retention/deletion obligations and attribution requirements. Alert routing
   and the operational runbook must be in place before production activation.

This repository change does **not** provision credentials, enable a schedule,
import live PDGA data, or deploy production. No Supabase service or dependency
is involved; storage is the existing Azure PostgreSQL database.

## Local API access test

This is a local, read-only connectivity test for an approved PDGA API account.
It does not change Griplock, import PDGA data into SQL, or create a scheduled
integration. A PDGA website browser session is not harvested or exported.

## Run securely

In a private PowerShell terminal, from the repository root:

```powershell
.\scripts\test-pdga.ps1
```

The launcher asks for the username and a hidden password using `Get-Credential`.
Enter credentials only in that prompt, not in chat, command arguments, source
files, environment files, or a recorded/transcribed/debugging PowerShell session.
Node 22 and PowerShell are required; no extra dependencies are needed.

The credentials pass directly to Node over an anonymous stdin pipe. They and
the API cookie/CSRF token exist only in process memory and are never deliberately
saved. JavaScript/.NET strings cannot be guaranteed securely erased from memory;
use a trusted workstation. Do not capture process dumps while testing.

The test calls the documented HTTPS login, searches `country=NO` for Ekeberg,
then requests a sample of at most 10 Norwegian courses. It always attempts API
logout after a valid session, including when a search fails. It neither logs out
the website session nor reads its cookies. Logout failures are explicit.

Output contains only selected course fields and PDGA attribution. It excludes
account details, contact information, passwords, cookies, tokens, and raw API
responses. Errors expose a sanitized status, not server response bodies. Requests
have a 30-second timeout, a 2 MiB response cap, and reject redirects.

An empty search is not proof that a course does not exist. This sample is not a
Norway coverage count. The documented directory API does not establish access to
individual hole layouts, pars, distances, or tee/basket geometry.

## Licensing references

Confirm permitted server-side caching, redistribution, refresh frequency, and
commercial use with PDGA. Keep PDGA-derived records/provenance and licence
obligations distinct from the downloadable OSM catalogue; never put PDGA data
into an ODbL export without confirming rights.

For a later scheduled dev integration, credentials belong in an approved Azure
secret store with access limited to the sync worker, not in frontend runtime
configuration or Git. Prefer a dedicated PDGA integration account if PDGA permits
it. That persistent credential storage and cloud configuration are not performed
by this local test.

References: [authentication](https://www.pdga.com/dev/api/rest/v1/auth),
[course service](https://www.pdga.com/dev/api/rest/v1/services#course-search),
[developer programme](https://www.pdga.com/dev).
