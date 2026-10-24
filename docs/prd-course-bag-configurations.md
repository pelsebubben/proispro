# PRD: Course-specific bag configurations

Status: PDGA-only cached event layouts and private planning approved. Historical
discovery below remains context; community publishing is not approved for this release.

## PDGA event planning update

OSM functionality and scheduled sync are retired. Requested PDGA information
uses a bounded 24-hour PostgreSQL cache, not permanent replication. Protected
server configuration holds developing provider routes; do not publish them.
Match legacy course ID to the canonical node ID, then match event and layout
before using hole details. Keep same-name event variants separate and label
them with their historical event/date. Provider facts are read-only and expire;
private plans retain IDs, owned-disc choices and player-authored strategy.

Bags is focused on inventory selection. A compact right-aligned Courses & plans
shortcut opens Courses filtered to the bag. Course management, event layout
selection and planning stay in Courses. Manual layouts remain available.
Existing private content and legacy assignments are preserved, without automatic
conversion of old source links.

## Private manual planner: first version

Enter through **Bags → Courses & plans → Open private planner**, or directly in
Courses. Courses can open the linked bag or link another bag to the same course.

- Layout facts are private to their author and reusable across their bag links to
  the same course. Name, tee/basket variant, description, date checked, hole label,
  optional par/distance in metres, and hole notes are manually editable.
- Up to 72 explicit holes have stable UUIDs: changing labels/order does not move
  assignments. Removing a hole removes that hole's choices from linked plans.
  There is no automatic hole generation or inferred geometry.
- Each course/bag link has one selected layout and independent strategy notes,
  primary disc and up to 11 alternatives per hole, all from owned inventory.
  Selected discs outside the linked bag are flagged, never silently added.
- A layout editor starts with no holes and requires confirmation of authorship or
  permission. Directory data is not copied into private layouts. PDGA links retain
  only their matching ID and generic label; temporary names stay temporary.
- Forced owner RLS covers layouts/plans. Parameterized same-origin APIs bound
  input size and use optimistic versions, transaction locks and ownership checks.
  Conflicting writes require reloading; unsaved navigation warns the player.
- Unlinking a course deletes its game plan but retains the reusable layout.
  Deleting an inventory disc removes it from private choices. Layout deletion
  refuses while any game plan still references it; unlink those plans first.
- Legacy hole assignments are retained in storage, not silently rewritten as
  event or manual layout facts.

Community submission, approval/publication, public downloads, revisioned shared
layouts, map/photo uploads and recommendations are deferred. No restricted UDisc
or PDGA guides, images, geometry or layouts may be copied.

Schema 006 adds `private_layouts` and `private_plans` without rewriting applied
migrations. CI and the disposable Azure verification job exercise the planner
against real PostgreSQL before production migrations. The production release
backs up live data when migration code changes and upgrades both live and dev.

## Product goal

Enable an individual disc golf player to prepare for a course by creating,
reusing, and easily adjusting a bag configuration made from their owned discs.

This is the key MVP outcome. Inventory supports that workflow; it is not the
product's primary end in itself.

## Problem

Players commonly swap discs before visiting different courses. The GUI needs
better design and flow so these adjustments are straightforward.

Moxfield's relationship between a collection and editable decks is the conceptual
reference: a deck corresponds to a saved bag configuration. No visual direction
or particular Moxfield interaction has been selected.

## Confirmed terminology and rules

| Term | Meaning |
|------|---------|
| Collection | The player's owned discs available for configuration building |
| Bag / bag configuration | A saved selection of owned discs, not a physical bag |
| Course | A directory entry the player searches for and selects |
| Course matching | The player manually links a configuration to a course |

- Only discs from the player's collection may be added to configurations.
- The same physical disc may belong to multiple configurations.
- Configuration membership must not be modeled as exclusive physical location.
- Automatic course-based disc recommendations are outside the MVP.

## Confirmed MVP scope

1. Provide a searchable course directory with Nordic-first coverage.
2. Let the player select a course from that directory.
3. Support saved bag configurations made from the player's collection.
4. Let the player add and remove discs when adjusting a configuration.
5. Let the player manually associate a configuration with a selected course.
6. Improve the GUI and workflow around these tasks.

Course data must be fetched from official sources or an authorized provider.
UDisc is a candidate only if suitable access exists, not a committed integration.
Manual course entry is not a substitute for the confirmed directory requirement.

## Proposed primary journey

This sequence expresses the confirmed goal; its screen structure is not approved.

1. Search for and select the course the player intends to visit.
2. Open a linked configuration or create a configuration for that course.
3. View its selected discs and choose additions from the player's collection.
4. Remove or replace selections as needed.
5. Save and revisit the course-linked configuration.

Open questions include whether users should also begin from configurations,
whether creating from an existing configuration is part of MVP, and what
"replace" should mean as an interaction.

## Proposed acceptance scenarios

These are draft criteria to refine and approve, not measured performance claims.

- A player can find and select an available Nordic course from sourced results.
- A player can create a configuration containing only owned discs and associate
  it with the selected course.
- A player can reopen that configuration and change its disc membership.
- One owned disc can be selected in two configurations without being removed
  from either configuration or duplicated in the collection.
- Removing a disc from a configuration does not delete the owned disc.
- Saved membership and course association are retained when the configuration
  is revisited.
- Search loading, no results, and provider failure are distinguishable; a failed
  fetch is not presented as evidence that no matching course exists.

## Course-directory feasibility

Research checked: 2026-10-23. Provider availability, terms, and coverage require
verification before implementation.

Implementation update: approved PDGA REST access has been verified against
Ekeberg. The application now has an on-demand PDGA directory path with temporary
in-memory caching and ID-only provider-aware pins. The signed-in agreement
prohibits permanent PDGA databases/bulk downloads without an exception; the
initial disabled bulk-sync implementation was replaced before activation.
Live access is gated on server secret provisioning. The endpoint supplies hole counts, not individual
layouts. Layout/tee planning therefore remains a separate capability gate, not
an inferred feature of the directory integration. The current course search uses
the same-origin API backed by PostgreSQL, not browser Overpass requests. The
repository observations below describe the earlier discovery baseline.

### Current repository

`src/hooks/useCoursePins.ts` queries OpenStreetMap through Overpass endpoints.
The state name `pdgaSuggestions` does not indicate actual PDGA integration.
`src/pages/CoursesPage.tsx` supports selection from these results as well as
custom course names.

Existing course search and course-to-bag pins are implementation evidence, not
approval of the current model or user experience.

### PDGA

The [PDGA developer documentation](https://www.pdga.com/dev) documents a REST API.
It describes access at no cost for non-commercial use by current PDGA members,
authentication, a signed license agreement, and attribution/link requirements.
Commercial use and exceptions require contacting PDGA.

Open: eligibility, intended commercial status, usable course fields, search
capabilities, Nordic coverage, request limits, and permitted caching/storage.
Do not commit to PDGA until these are established.

### UDisc

A public UDisc API was not verified during discovery. An
[older UDisc forum discussion](https://forum.udisc.com/t/request-public-api/375)
includes an August 2023 statement that a public API was not on the near-term
roadmap. This is historical evidence, not proof of current unavailability.

Current official access or partnership options must be checked before choosing
UDisc. Unofficial endpoints or scraping are not an approved integration approach.

### Provider-selection gate

Before implementation, establish access permission, attribution, allowed storage,
stable course identifiers, and sufficient Nordic coverage. Select the provider
only after these requirements are demonstrated.

## Scope boundaries

Explicitly excluded from MVP:

- Adding unowned or hypothetical discs to configurations.
- Automatic recommendations about which discs to take.
- Modeling configurations as exclusive physical bags.

Not yet decided:

- Whether existing wishlist, for-sale, analytics, collections, hole-planning,
  and map features remain visible, move, or are deferred.
- Whether to compare configurations or show a packing/swap checklist.
- Sharing, public configurations, and social features.
- Offline expectations, sign-in changes, and deployment changes.

No existing feature removal is authorized by this draft.

## Open product decisions

- Can one configuration be associated with several courses?
- Can a course have several configurations, for example for different conditions?
- Should course layouts or tee choices be distinguishable in the MVP?
- What course details are necessary to distinguish similarly named courses?
- What happens when a course is absent from the directory?
- What happens to a configuration when an owned disc is deleted or unavailable?
- Which device context and adjustment actions should drive usability acceptance?
- What does satisfactory Nordic coverage mean, including territories and
  courses missing from a provider?
- Is a packing comparison essential to MVP or a later enhancement?

## Architecture and migration

The current manifest uses React, TypeScript, Vite, and Supabase. The README's
Alpine.js architecture description is outdated relative to that manifest.

Infrastructure lifecycle planning is a prerequisite to the product refactor.
The confirmed target is fully Azure-hosted infrastructure, delivered through
GitHub Actions and migrated in stages, with PostgreSQL as the preferred database.
See [the infrastructure lifecycle plan](infrastructure-lifecycle-plan.md).

No frontend framework replacement or product schema design has been selected.
Keep infrastructure migration separate from changes to configuration and course
relationship rules.

Proposed implementation guardrail: preserve existing owned discs, configurations,
and course associations through any migration, with explicit handling of records
that cannot be mapped to directory identifiers.

## Delivery state

Requirements discovery only. No UI implementation, source integration, migration,
or application-code change is part of this draft.
