# PDGA on-demand course access

The application searches Norway through the official PDGA REST API on demand,
alongside the separate SQL-backed OSM catalogue. The PDGA account's licence
agreement was inspected in the signed-in browser on 2026-10-24. It permits
temporary caching for application operation/performance with invalidation, but
prohibits permanent storage, creating a PDGA database or bulk downloads without
an exception. PDGA record IDs may be retained for back-end matching.

Consequently there is **no PDGA catalogue replication, bulk import or scheduled
PDGA sync**. The initial disabled bulk-sync implementation was replaced before
deployment or any live import. Migration 005
constrains PDGA-linked pins to a generic name and a source ID, not provider
content. Never substitute this file for an already-applied migration.

## Data flow and retention

- Authenticated search performs one bounded PDGA request with the user's query,
  `country=NO`, and at most 30 results. A saved pin resolves one course by ID.
  Live `course_id` queries were observed returning neighbouring legacy IDs, not
  just the requested record. A cold pin lookup therefore reads one bounded
  response (limit 30), selects an exact returned ID match and discards the
  neighbours. There is no pagination, broad fallback or cache of those neighbours.
  No match in a nonempty response fails explicitly; the first row is never used
  as a substitute. Verify saved pins after a cold restart, not only after search
  has warmed their cache.
- Credentials, API cookies and CSRF tokens remain server-side. Every valid API
  session attempts logout, including after failure; failed logout is an error.
- A process-local cache holds at most 100 entries for 15 minutes. Expired data
  is invalidated, physically pruned at least once per minute, and never served
  stale when the provider fails. There is no disk, SQL or shared durable cache.
- Identical concurrent requests coalesce; other concurrent misses fail busy.
  Each server process allows at most 20 cache misses per minute.
- Only course name, city, coordinates, stated hole count, IDs and canonical
  PDGA link leave the API session. Contact details/raw responses are discarded.
- A private bag link stores `pdga:<course_id>`, a generic `PDGA course` label and
  the user's bag relationship. SQL rejects saving provider names in PDGA pins.
  Display names and links are resolved afresh; the browser clears temporary
  course results/details at expiry. A provider failure leaves an honest generic
  pin with retry rather than an indefinitely retained provider name.
- The application returns `Cache-Control: no-store` on authenticated API data.
  PDGA information is never included in the ODbL download.

The PDGA agreement requires the attribution **"Player, event, and course data
provided by PDGA."** linking to PDGA on every screen with PDGA data. Course names
link to the corresponding PDGA page. Provider results are not silently conflated
with OSM courses or layouts.

## Layout limitations

The documented Course Search API supplies course details and a hole count,
**not** individual holes, pars, distances, tees, baskets or layout variants.
PDGA courses can link to bag configurations but show **layout unavailable**.
No numbered holes or hole-by-hole game plans are generated from their counts.
The separate private planner accepts independently authored manual holes,
measurements and notes. It does not populate layouts from PDGA counts or records.
Additional official API access/written permission is needed to import provider layouts.

## Dev credentials and deployment

Add both `PDGA_USERNAME` and `PDGA_PASSWORD` under the repository's GitHub
**dev environment secrets**, not variables or source files. Do not paste them
into chat. Use the approved account only; the agreement does not authorize
creating an unrelated shared integration account without PDGA permission.

The existing **Deploy Griplock dev** workflow has an opt-in
`configure_pdga` manual input (default false). Its credential step:

1. Uses the dev environment's OIDC Azure identity and the shared dev release lock.
2. Requires the exact workflow commit to be deployed on `app-griplock-dev`.
3. Transfers the two secrets to Azure Container App secrets through an in-memory
   ARM request. They never become CLI arguments, parameter files or log output.
4. Preserves existing app secrets, adds server-side `secretRef` environment
   variables and waits for the new revision to become ready.

Dispatch the existing dev workflow at this commit with `configure_pdga=true`.
The deployment completes before the credential step runs. PR-triggered deploys
never execute that step or receive its PDGA secret environment.
No credentials are available from the earlier local API test.
Activation is not performed merely by adding GitHub secrets.

Ordinary dev image updates preserve this configuration. The protected main
production release automatically provisions the **prod** app from prod environment
secrets and restores the **dev** app from dev environment secrets after the Bicep
foundation/app deployment. Both providers must become ready before release
verification completes. The provisioner allows production only from the exact
main `prod.yml` workflow (manual dispatch or successful-main-CI workflow run).
It does not grant PR-triggered dev deployments access to PDGA secrets.

Standalone foundation/app Bicep application still replaces the complete
secret/environment set: follow it with the protected release, or the opt-in manual
dev workflow for dev-only work. Do not deploy production from a feature branch.
Both GitHub environments require the two PDGA secrets; missing credentials fail
the provider stage explicitly rather than silently publishing a disabled integration.

After activation, verify authenticated Ekeberg search and the corresponding
PDGA link, a saved bag link after reload, the unavailable-layout explanation,
provider-failure warnings and the OSM-only export. Local fixtures are not proof
of a live PDGA deployment.

For access revocation or a PDGA removal request, remove the two server
environment references, deactivate/stop all previous app revisions, restart
current replicas and remove the two Azure secrets. This clears all process
caches; API responses are not browser-cacheable. Only generic private pins and
matching IDs remain. PDGA requires removal/destruction within 24 hours of a
written request. Do not serve stale content while resolving access problems.

Before public launch, obtain PDGA review when required, and contact
**dev@pdga.com** for commercial use, unaddressed uses or additional layout APIs.
The 15-minute cache is an application policy, not a refresh interval specified
or separately approved by PDGA.

## Local read-only access test

From a private PowerShell terminal in the repository root:

```powershell
.\scripts\test-pdga.ps1
```

The launcher uses `Get-Credential` with hidden password input and passes it to
Node over an anonymous stdin pipe, never arguments, environment files or disk.
Do not use PowerShell transcription, debugging, screen recording or memory
dumps. JavaScript/.NET strings cannot be guaranteed securely erased.

It searches Ekeberg plus a bounded Norway sample of 10, then confirms logout.
It imports nothing and saves no credentials. Output excludes account/contact
data, passwords, cookies, tokens and raw responses. Requests reject redirects,
have a 30-second timeout and a 2 MiB response cap. A website browser session is
not harvested. This test does not activate the hosted integration.

References: [API agreement](https://www.pdga.com/pdga-api-license-agreement),
[authentication](https://www.pdga.com/dev/api/rest/v1/auth),
[services](https://www.pdga.com/dev/api/rest/v1/services),
[developer programme](https://www.pdga.com/dev).
