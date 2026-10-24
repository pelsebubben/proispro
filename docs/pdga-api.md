# PDGA on-demand integration

PDGA course search uses approved REST credentials, only on the server. Sessions
reject redirects, have bounded response sizes/timeouts, and attempt logout even
when a lookup fails. Only allowlisted nonpersonal course fields are retained.
The exact requested legacy course ID must match; canonical node IDs are taken
from the returned record rather than guessed.

Provider-authorized event-layout access is configured separately. Its developing
routes are not public documentation and must **not be published in this repo**.
The browser calls only the application's authenticated same-origin endpoints.
Full event responses and player information are never cached or returned.

## Protected configuration

Both GitHub **dev** and **prod** environments require these secrets:

- `PDGA_USERNAME`
- `PDGA_PASSWORD`
- `PDGA_LAYOUT_INDEX_TEMPLATE`: provider-approved layout lookup, using the
  `{courseId}` placeholder for the canonical node ID.
- `PDGA_EVENT_OVERVIEW_TEMPLATE`: provider-approved event lookup, using
  `{tournId}` for the selected event ID.

The templates are protected operational configuration, not credentials, but
receive the same non-public handling. Runtime validation permits only HTTPS
on the fixed PDGA host, with no credentials, redirects or URL fragments.
Never pass credentials to the unauthenticated layout provider.

The protected main production release deploys the CI-verified immutable image,
then provisions production from its own environment and restores dev from its
own environment. The provisioner checks trusted workflow identity and exact
deployed SHA. ARM payloads remain in memory, existing app secrets are preserved,
and logs contain only safe provisioning phases/numeric HTTP status.

PR-triggered dev deployments receive no provider secrets. The existing dev
workflow's opt-in `configure_pdga` dispatch can activate all four settings after
deploying the exact workflow commit. Standalone app/foundation Bicep application
replaces secret references and must be followed by protected provisioning.

## Cache and licence boundaries

The signed-in agreement allows temporary caching for operation/performance, not
permanent provider databases or bulk downloads without an exception. The
approved application policy is a **24-hour on-demand PostgreSQL cache**, bounded
to 500 entries, with strict expiry and minute physical cleanup. This interval
is an application policy, not a PDGA-prescribed refresh interval.

The shared cache excludes raw responses, contact/player data, credentials,
cookies and tokens. Events cache only the exact matched course/layout and its
hole fields. Same-name layouts from different events are not conflated.
Upstream 429 cooldown and a miss budget are shared across replicas; valid cached
reads do not make upstream requests. Expired data is not served on error.

Private pins retain generic labels plus matching IDs. A private provider layout
retains course/event/layout IDs, while its displayed name and hole facts resolve
from the cache. User-authored strategy and owned-disc choices persist separately
under forced owner RLS. Do not copy provider facts into permanent manual layouts.

Display **"Player, event, and course data provided by PDGA."** linking to PDGA
where provider content is shown. Mark event layouts as historical and display
event name/date, original measurement units and available tee/target/notes.

For revocation/removal, remove provider configuration from all current/old
revisions, stop access, and purge `provider_cache.entries`. Backups must follow
the applicable deletion/retention agreement; temporary expiry does not erase
previous database backups. No provider facts belong in private layouts/plans.
Obtain any required PDGA review/commercial approval before public launch.

## Verification

Verify a cold exact course lookup, node-ID routing, event/course/layout matching,
hole ordering, feet-to-metres conversion, SQL-cache reuse after a replica restart,
expiry/cooldown, owner isolation and persistence of personal disc choices.
Ekeberg's verified identity is legacy course **4551**, canonical node **27416**;
4550/27415 refers to a different course.

The hidden-prompt local REST credential test remains available:

```powershell
.\scripts\test-pdga.ps1
```

It passes credentials through anonymous stdin, not arguments or files. Do not
enable terminal transcription/debugging. It is a bounded read-only check, not
hosted activation. It publishes no developing provider routes.
