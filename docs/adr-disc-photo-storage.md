# ADR: Disc Photo Storage Architecture

**Status:** Superseded historical design; not an active setup path. Provider
storage and upload functions are not part of the current API implementation.
**Date:** 2026-04-16  
**Author:** Danny (Lead / Architect)  
**Scope:** User disc photos — upload, storage, display priority, RLS

---

## Context

Users need a photo displayed in their disc detail modal. There are three possible sources, in descending preference:

1. A personal photo the user uploads of their physical disc (unique to their bag)
2. A stock photo from `disc_catalog.pic` (may be a third-party URL or null)
3. The self-generated SVG flight chart (always works, zero dependencies)

**Constraints:**

- **Static frontend only:** GitHub Pages — no backend, no server-side processing, no Lambda/Functions.
- **Auth:** Supabase GitHub OAuth already implemented. Users are authenticated when interacting with their bag.
- **Client:** `@supabase/supabase-js` loaded via CDN. Direct browser → Supabase communication.
- **Existing schema:** `disc_wear_adjustments` is 1:1 per bag disc (enforced by `UNIQUE (user_disc_id)`). `disc_catalog` carries `pic TEXT` (stock photo URL, nullable).
- **Scale:** Single-user app. No multi-tenancy complexity. Personal bag management.

---

## Decision

### 1. Schema: Add `user_photo_url` to `disc_wear_adjustments`

**Chosen:** Add `user_photo_url TEXT` column to `disc_wear_adjustments`.

**Alternatives considered:**

| Option | Trade-off |
|---|---|
| `user_photo_url` on `disc_wear_adjustments` | **Chosen.** 1:1 constraint already exists per bag disc. No new join. Simplest path. |
| Separate `disc_photos` table | Needed if multiple photos per disc (gallery). Overkill for v1. Adds join and new RLS surface. |
| `user_photo_url` on `discs` (bag table) | Photo is logically a customization alongside wear offsets. Grouping them in `disc_wear_adjustments` keeps customization data co-located. Also avoids widening the core `discs` table with photo concerns. |

**Rationale:** `disc_wear_adjustments` is already the "per-disc customization" row. A personal photo is another user-specific override. The 1:1 UNIQUE constraint on `user_disc_id` means each bag disc already has at most one adjustment row — adding `user_photo_url` keeps it zero-extra-joins at display time.

**Consequence (bad):** If a user wants to upload a photo but has no wear adjustments recorded, the app must insert a wear_adjustment row (with zero offsets) to hold the photo URL. This row may look like "noise" in the DB. Acceptable for v1 — document in code comments.

**Consequence (good):** Photo URL is co-located with other per-disc overrides. A single `SELECT * FROM disc_wear_adjustments WHERE user_id = auth.uid()` returns everything needed to render the bag — no extra query.

---

### 2. Storage Path: `{user_id}/{user_disc_id}.{ext}`

**Chosen:** `{user_id}/{user_disc_id}.{ext}`  
Example: `a1b2c3d4-…/f9e8d7c6-….webp`

**Alternatives considered:**

| Path | Trade-off |
|---|---|
| `{user_id}/{user_disc_id}.{ext}` | **Chosen.** `user_disc_id` is the stable identity of the bag disc. |
| `{user_id}/{wear_adjustment_id}.{ext}` | If a wear_adjustment row is deleted and re-created, the photo is orphaned in Storage (old `wear_adjustment_id` no longer exists). Requires cleanup logic. |
| `{user_id}/{catalog_disc_id}.{ext}` | Wrong — multiple bag discs of the same mold would collide. Personal photo is per-bag-disc, not per-catalog-entry. |

**Rationale:** `user_disc_id` is the stable, bag-level identity. The user never re-creates their disc in the bag casually. `wear_adjustment_id` is internal infrastructure and could be garbage-collected independently of the disc.

**File extension:** The extension is determined at upload time from the MIME type (`.jpg`, `.png`, `.webp`). Because the path uses the `user_disc_id` as stem with a single file per disc, upsert (`upsert: true`) replaces the previous file. There is a theoretical orphan if a user uploads `.jpg` then later uploads `.webp` — the `.jpg` would remain. Acceptable for v1; a cleanup policy (Storage lifecycle rule) can be added later. Alternatively, the app can delete the old object before uploading the new one (preferred — see Upload Flow).

---

### 3. Upload Flow: Direct Browser → Supabase Storage

Since this is a static app with no backend, all upload logic runs in the browser using `supabase-js`.

**Flow:**

```
User selects file (input[type=file])
  → Validate: MIME type is image/jpeg | image/png | image/webp
  → Validate: size ≤ 5MB
  → If existing photo URL recorded: delete old object from Storage
  → Determine path: `{user_id}/{user_disc_id}.{ext}`
  → supabase.storage.from('disc-photos').upload(path, file, { upsert: true })
  → supabase.storage.from('disc-photos').getPublicUrl(path)
  → UPSERT disc_wear_adjustments SET user_photo_url = publicUrl WHERE user_disc_id = ...
  → Re-render modal photo
```

**Key decisions within the flow:**

- **`upsert: true`** on the upload call handles replacement without a separate delete step for same-format re-uploads. For format changes (`.jpg` → `.webp`), explicitly delete the old path first — the old path with the old extension would otherwise persist.
- **Public bucket**: Photos are stored in a public bucket. The URL stored in `user_photo_url` is a stable public URL that can be rendered in an `<img>` tag without auth headers or signed URL expiry. See trade-off below.
- **No client-side resize for v1.** The 5MB cap is enforced client-side (JS validation) and at the bucket level (Supabase bucket max upload size setting). Acceptable quality for personal disc photos.

**Trade-off (public bucket):** Any person who guesses a valid `{user_id}/{user_disc_id}` path can view the photo without auth. This is low-risk — the path is a UUID pair, practically unguessable. The photos are disc pictures (not sensitive PII). Private bucket with signed URLs would add token refresh complexity and URL expiry, which breaks the stored `user_photo_url` pattern. Public bucket is the correct call for v1.

---

### 4. Supabase Storage RLS

Bucket name: `disc-photos`  
Bucket type: **Public** (anonymous read enabled)

Storage RLS is enforced on `storage.objects`. The `storage.foldername(name)[1]` function extracts the first path segment, which must equal the authenticated user's UUID.

```sql
-- Bucket: disc-photos (set as public in Supabase dashboard)

-- Authenticated users can read all photos (public bucket handles anonymous reads;
-- this policy is a belt-and-suspenders for authenticated reads)
CREATE POLICY "disc_photos_authenticated_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'disc-photos' AND auth.role() = 'authenticated');

-- User can only insert photos into their own path prefix
CREATE POLICY "disc_photos_user_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'disc-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- User can only update photos in their own path prefix
CREATE POLICY "disc_photos_user_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'disc-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- User can only delete photos in their own path prefix
CREATE POLICY "disc_photos_user_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'disc-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

**Note:** Enable RLS on `storage.objects` in the Supabase dashboard (Storage → Policies). The bucket's "Public" setting controls unauthenticated HTTP read access (CDN-level); RLS policies control write access regardless of public/private.

---

### 5. File Handling

| Constraint | Value | Enforcement |
|---|---|---|
| Max file size | 5 MB | Client-side JS check + Supabase bucket upload limit |
| Accepted formats | JPEG, PNG, WEBP | `<input accept="image/jpeg,image/png,image/webp">` + JS MIME check |
| Client-side resize | None (v1) | Deferred — 5MB cap is sufficient for disc photos |
| Filename | `{user_disc_id}.{ext}` | Derived from disc data, not user input (no injection risk) |

**Set bucket upload size limit in Supabase dashboard:** Storage → Buckets → `disc-photos` → Edit → Max upload size: 5 MB.

---

## Schema Delta

```sql
-- Migration: Add user_photo_url to disc_wear_adjustments
-- Run in Supabase SQL Editor

ALTER TABLE disc_wear_adjustments
  ADD COLUMN user_photo_url TEXT;

COMMENT ON COLUMN disc_wear_adjustments.user_photo_url IS
  'Public Supabase Storage URL for the user''s personal disc photo. '
  'Path in bucket: {user_id}/{user_disc_id}.{ext}. '
  'NULL = no personal photo; fall back to disc_catalog.pic then SVG.';
```

No index needed on `user_photo_url` — it is never filtered or sorted on, only projected.

---

## Display Priority (Frontend Logic)

```javascript
// In flight-guide.js or bag modal — determine which photo source to render
function discPhotoSrc(disc, wearAdjustment, catalogEntry) {
  if (wearAdjustment?.user_photo_url) return wearAdjustment.user_photo_url;   // 1. personal
  if (catalogEntry?.pic)               return catalogEntry.pic;                // 2. stock
  return null; // 3. fall through to SVG flight chart
}
```

The SVG is always rendered in the DOM; the `<img>` tag overlays it when a photo URL is available.

---

## Consequences

### Good
- Minimal schema change (one column, no new table, no new joins)
- No backend required — fully static app-compatible
- Public bucket URLs are stable and renderable without token management
- RLS ensures users cannot overwrite each other's photos
- Three-tier fallback is explicit and testable per-disc

### Bad / Risks
- Format-switch orphans: if user re-uploads in a different format, the old object persists. Low risk, low harm. Mitigate in v2 with explicit pre-delete or lifecycle policy.
- Public bucket: photo URLs are technically guessable (UUID pair). Acceptable for disc photos (non-sensitive).
- "Empty" wear adjustment rows: uploading a photo requires a `disc_wear_adjustments` row even if no offsets are set. Need to handle upsert on zero-offset rows cleanly in the UI code.
- 5MB is unvalidated server-side today (bucket setting must be manually configured in dashboard). Document in setup guide.

---

## Related

- `docs/migration-v3-disc-catalog.sql` — source schema for `disc_wear_adjustments` and `disc_catalog`
- `docs/supabase-setup.md` — Supabase project setup guide (update to include bucket creation steps)
- `flight-guide.js` — `flightPath()` / `flightEnd()` SVG helpers (fallback layer 3)
