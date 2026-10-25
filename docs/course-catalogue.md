# Courses and event layouts

PDGA is the application's only external course provider. Search Norway, link a
course to a bag to open its private planner immediately, then choose a historical PDGA event
layout or create your own manual layout. Primary discs, alternatives and strategy
notes belong to the individual player's course/bag link.
Save game plan is available at both the top of the planner and below the holes.
Both buttons save the same changes and share saving, saved and error states.

**Bags stays focused on discs.** Its compact Courses & plans button beside the
list controls opens Courses filtered to that bag. Course management, layout
selection, attribution and hole planning live in Courses.
Course titles reopen the private planner rather than an external provider page.
Layout choices load automatically; no separate event-browsing action is required.
The compact bottom disclaimer warns that course data may vary and retains the
required provider credit.

## Event layouts

Course matching uses the exact REST course ID. The separate canonical course
node ID is used to find event layouts; these identifiers are not interchangeable.
Event details must match both the selected layout and course. The same named
layout in two tournaments remains two distinct choices. No neighbouring course,
different tournament layout, generated hole count or inferred geometry is used
as a substitute.

Hole labels, par, original distance/units, tee, target and director-entered notes
are displayed when supplied. Feet are also converted to metres for the planner.
The event name and date remain visible: an event setup is not a claim about the
course's current layout. Missing or changed provider data is an explicit error;
saved private choices are not silently removed or reassigned.

Choose **Duplicate & rename**, enter your own name and select **Create private
game plan**. An unchanged event layout can be copied immediately, even before
its first save and without adding discs or strategy. If you have edited disc
choices or notes, save them before copying. The copy starts with your saved disc
choices and strategy; later changes are independent of the source. Switching
between layouts restores each plan's saved choices. Only one plan is active
for a course/bag link at a time.

This is a named private plan, **not a permanent snapshot of PDGA holes**. Both
source and copy retain provider IDs and resolve hole facts from the temporary
cache. An unavailable provider does not erase the private name or strategy.

## Course maps and disc selection

The documented REST and event-layout responses do not provide hole diagrams.
The server separately reads only the course-map section of the exact course's
public PDGA media page. It accepts PDF and web-image files under PDGA's course-map
directory, never arbitrary embedded HTML, external hosts or guessed hole geometry.
Only normalized map links enter the same bounded 24-hour PostgreSQL cache.
Map files remain on PDGA; they are not downloaded into permanent application storage.
Unexpected page structure or unsupported media produces an explicit error with retry.

Available maps can be expanded in the planner and beneath each hole's details.
They are labelled **whole-course overviews**, not hole-specific diagrams or a
guaranteed match for the chosen historical layout. Previews load only when expanded;
full-size links remain available for PDF viewers that cannot render inline.
At verification, Ankerskogen (4550 / 27415) publishes two course PDFs; Ekeberg
(4551 / 27416) explicitly has no maps. Missing maps do not block private planning.

For large inventories, the disc selector groups linked-bag discs first, then
other owned discs. Within each section, types run putter, midrange, fairway,
distance, utility and unclassified; names sort naturally A–Z. Edition, plastic,
weight and colour distinguish copies. A planner-wide search matches name,
manufacturer and those identifying details without clearing saved selections.

The provider's developing integration routes are confidential configuration.
Do not put their URLs, raw responses or documentation in public source, fixtures,
issues, screenshots or browser payloads. See the server-only configuration names
in [PDGA operations](pdga-api.md).

## Storage and rate limits

Only requested courses, searches, layout lists, map links and selected event-hole details
enter the PostgreSQL cache. Each successful response expires after **24 hours**.
Expired entries are never served and are deleted on misses and by the running
server's minute cleanup. The cache is bounded to 500 entries and survives app
restarts/replicas. No scheduled PDGA replication or bulk country download exists.

Misses serialize across replicas, identical requests coalesce, and a shared
20-miss/minute budget plus upstream rate-limit cooldown protects the provider.
Cached reads continue during cooldown. Failure never overwrites a valid cached
response with empty data.

Private provider layouts store **IDs and optional user-authored plan names only**, not duplicate provider facts.
They resolve through the temporary cache; their hole keys are stable for the
same course, event, layout and provider hole ID. User-authored strategy and disc
selections remain in owner-RLS tables. Provider facts are read-only.

## Retired catalogue

The OSM catalogue, exports, parser, synchronizer, provisioning template and
scheduled workflow are removed. Migration 007 drops only the old shared
catalogue tables and disables its dedicated writer logins. The two Azure
scheduled jobs must be removed before migration. Previously applied migration
files remain unchanged for checksum validation.

Existing private links, manual layouts, plans and legacy assignments are kept;
there is no automatic conversion or matching of old links to PDGA courses.
Players can link the intended PDGA course explicitly without losing their
independently authored layouts.
