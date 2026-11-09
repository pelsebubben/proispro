# Curated courses catalog: POC rework plan

Status: Initial read-only catalog implemented; details and the broader rework remain pending.

## Selected courses

The owner selected **Holmenkollen, Ekeberg and Karidalen** for the POC. These
are shortlist names, not verified source records. Confirm the exact course,
location and source identity for each before publishing. Repository
documentation identifies Ekeberg's PDGA course ID as 4551 and its distinct
canonical node ID as 27416; the other two IDs are not established here.

## Correction to the earlier plan

The earlier version of this plan described a Supabase/Alpine.js application
that is not the current checkout. The current application is React and uses a
server-backed PostgreSQL API. `server/courses.mjs` delegates course search and
details to PDGA; `docs/course-catalogue.md` documents the current planner and
the retirement of the old OSM catalog. The current repository does not establish
an application-wide localStorage fallback or cross-device sync while the
database is down.

The owner states permission to store the course data has been obtained.
`docs/pdga-api.md` documents an agreement allowing temporary caching, but not a
permanent database of PDGA facts or bulk downloads without an exception. The
previous suggestion to permanently save API details in a repository file
was too broad: a JSON file is also persistent storage. Verify the scope of the
permission and record its applicable conditions before copying PDGA course
facts, layouts or hole details. Do not
copy provider facts into manual plans as a workaround. Assess licensing and
attribution for any alternate source separately.

## POC direction without a database

Provide a curated, version-controlled file containing only the three selected
courses, using independently supplied or otherwise verified data with permission
for this use. The owner selects and reviews the entries; a controlled
maintainer-side process updates them and deploys a new site version. Do not
embed credentials or confidential provider routes in the file or browser.

Each entry needs a stable application-owned identifier, the verified course
name, a source and attribution, and optional independently verified location
and details. Missing details must be clearly marked unavailable; do not infer
holes or geometry. Preserve source-specific identifiers as separate fields,
not interchangeable IDs. If permission or course identity cannot be verified,
show only appropriately reviewed, independently supplied information.

The POC must load the catalog without PostgreSQL or the upstream course API.
It should offer a read-only course list and course details. A maintainer can
refresh permitted data outside the user-facing flow; ordinary browsing must not
trigger provider ingestion. A fresh online visitor still needs to download the
site and file, and offline access after a visit is not guaranteed without
separate offline support. The catalog is accessible without signing in from the
login screen because session verification itself depends on the database.

**Scope boundary:** the current planner and saved bag links use server-backed
APIs. A static course file alone does not make authentication, pins, bags,
game plans, or multi-device sync work during a database outage. Preserve those
features and explicitly indicate when unavailable. Browser-only persistence
and later reconciliation would be a separate feature with conflict and
privacy decisions; it is not assumed to exist.

## Delivery checkpoints

1. **Verify identity and rights.** Confirm the three exact courses and identify
   an authorized source for each field. Record attribution, licensing, and any
   required permission. PDGA exception approval is an alternative, not assumed.
2. **Create and validate the catalog.** The versioned shortlist is in
   `src/data/curated-courses.json`; validation and verified details remain to
   be added. Add only reviewed and permitted data.
3. **Implement read-only browsing.** The initial static catalog is integrated into Courses
   without requiring the database or fetching the upstream API for browsing.
   Clearly separate catalog failure from an empty result, and preserve the
   current planner and existing links.
4. **Prove outage behavior.** With both database-backed endpoints and upstream
   provider calls blocked, load the deployed-style app in a fresh browser,
   browse and search all three entries, and inspect their stored details.
   Confirm no provider requests occur and unavailable planner actions do not
   imply that data was saved.
5. **Restore persistence later.** Design an additive database migration and
   explicit linking to existing personal pins. Review authentication, access,
   data ownership and provider permissions before syncing. Do not silently
   rematch existing links by name.

Potential course requests remain a later feature: a reliable submission and
moderation store is required, and requests must not automatically ingest data.

## Open inputs

- Exact source links or other reliable identifiers for the three chosen
  courses, particularly Holmenkollen and Karidalen.
- The scope and conditions of the owner's stated permission, including attribution.
- Whether the POC needs only read-only browsing during the outage, or also
  needs a separately designed browser-only bag-planning experience.

The initial read-only catalog is implemented; no database schema, deployment or
live data was changed.
