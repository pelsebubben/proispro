# Norway course catalogue

## Scope and measured coverage

The catalogue uses OpenStreetMap only. It does not import UDisc data, identifiers,
layouts, or data from a UDisc subscriber account.

The initial Norway-area query using `leisure=disc_golf_course` and course
relations, run from Azure on 2026-10-24, returned the following baseline:

| Measure | Count |
|---|---:|
| Course objects in OSM | 118 |
| Named, geolocated objects accepted | 97 |
| Skipped unnamed/unlocated course objects | 21 |
| Hole ways in OSM | 439 |
| Holes confidently associated and accepted | 281 |
| Courses with accepted holes | 20 |
| Unassociated hole ways | 119 |
| Invalid/missing reference or geometry | 39 |
| Ambiguous holes | 0 |
| Courses with an expected hole count tag | 23 |
| Courses matching that expected count | 8 |

These are **OSM object counts, not all Norwegian courses or verified distinct
facilities**. A node and area can describe the same facility. Matching a stated
hole count does not certify layout completeness, accuracy, or current availability.
Sync reports remain available through the API and structured worker logs.

The importer also accepts the standard `sport=disc_golf` tagging (including
`leisure=pitch`). Explicit `disc_golf=hole/tee/basket/target` objects are excluded
from course results even if they also carry course-level tags. The initial
baseline above predates this expanded selection; use the latest successful
sync report for current counts. Missing popular courses are not proof that
they do not exist, and no entries are fabricated to fill source gaps.

Hole membership requires explicit course-relation membership or a single closed
course-way boundary containing the entire hole path. Nearby holes, tees, or
baskets are not assigned by distance. Duplicate hole references are withheld:
they may describe layout or tee alternatives. Multipolygon boundaries, inferred
layouts, standalone tee/basket alternatives, and unnamed courses are deliberately
not imported in this first version. Existing private pins and hole assignments
are not rewritten by a sync.

## Architecture and security

`server/osm-catalog.mjs` bounds external requests to three fixed HTTPS Overpass
providers, 115 seconds/provider, and 32 MiB. Redirects and partial/error responses
are rejected. Source IDs, versions, timestamps, and hole geometry are retained;
contributor usernames and other unrelated OSM metadata are not stored.

Migration 004 creates a separate shared `course_catalog` schema in each existing
PostgreSQL database. The application role has SELECT only. The dedicated worker
role can write only the catalogue tables, cannot read private user tables, has
no privileged role memberships, and cannot bypass RLS. Provisioning refuses
unexpected existing privileges instead of silently reusing an unsafe account.
TLS certificate validation follows the existing PostgreSQL client.

Publication is one transaction protected by an advisory lock. Readers use a
read-only repeatable-read transaction, so courses, holes, and coverage belong to
one published snapshot. Invalid/stale snapshots, fewer than 10 accepted courses,
older source timestamps, or more than 25% loss of accepted courses/holes reject
publication and retain the last good data. These are conservative safety gates,
not measures of source completeness. Unexpected large legitimate removals require
an operator to review the source and change the gate through reviewed code.
Removed courses become inactive; private pins still retain their names/source IDs.

The authenticated, parameterized read API provides:

- `GET /api/v1/courses?q=name`: up to 30 matching active Norwegian course objects.
- `GET /api/v1/courses/osm:way:123/holes`: stored holes and coverage/provenance.
- `GET /api/v1/courses/export`: the shared catalogue as machine-readable JSON,
  excluding every private bag, pin, assignment, disc, and user.

There is no web-facing sync endpoint, arbitrary source URL, or runtime write path.
The same API can serve a future mobile application.

## Deployment and operations

First deploy the application/schema 5 using the existing release pipeline.
Then run **Sync Norway course catalogue** (`.github/workflows/courses.yml`),
select `dev`, and enable `configure`. New workflows must exist on the default
branch before GitHub offers manual dispatch; a normal dev application deploy
does not itself create the worker. Production configuration is separately gated
to `main`; do not configure production while evaluating Norway coverage on dev.

The workflow deploys `infra/course-sync.bicep` using the exact currently deployed
immutable app image. A short-lived manual bootstrap job provisions the
dedicated writer; cleanup removes that job and its administrator credential even
if provisioning fails. The scheduled worker holds only its own writer password.
Secrets are masked, secure Bicep parameters, and Azure Container Apps secrets,
never repository files or logs. Configuration rotates the writer password.

Azure Container Apps Jobs runs weekly on Sunday, **03:17 UTC on dev**, **03:47
UTC on production**. No Kubernetes cluster, persistent worker, or GitHub cron is
needed. Jobs use 0.5 CPU/1 GiB, one replica, zero automatic retries and a 600-second
execution limit. Fetching is weekly and deliberately bounded to avoid burdening
public Overpass instances.

For a manual refresh, dispatch the workflow with `configure=false`. A nonzero
exit/failed execution fails the workflow. Inspect the job's Executions and logs
in Azure: `course_sync_completed` includes source time and coverage;
`course_sync_failed` explains rejection without credentials. The UI displays
last successful sync time and incomplete mapping warnings. An outage retains old
data. No email/pager action group is configured; before production rollout,
connect failed-execution and missing-weekly-success alerts to the team's chosen
notification destination.

Reconfigure after deliberately updating the worker image or rotating credentials.
Application releases do not silently mutate its independent schedule/image.
Do not run bootstrap during an active release; the workflow shares release locks.
Local import, using a separately provisioned worker identity:

```powershell
node server/sync-courses.mjs
```

Set PGHOST/PGDATABASE/PGUSER/PGPASSWORD through your normal secret mechanism.
Never use the application or administrator identity for scheduled ingestion.

## Attribution and reuse

Course data: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
The Courses screen and API retain attribution; **Download ODbL course data**
offers the shared derived catalogue with provenance in machine-readable form.
Keep this attribution/license with redistributed data.

Shared source data is stored separately from personal content, but that
separation alone is not a legal determination of ODbL database boundaries.
Review ODbL share-alike/database obligations before broader redistribution,
combining other licensed datasets, or production commercial use. No third-party
course service's consumer subscription is treated as a data licence.
