/* =============================================================================
 * proispro — Azure SQL target schema (T-SQL)
 * =============================================================================
 * This is the hand-translated Azure SQL equivalent of the prior Supabase/Postgres
 * schema. Mapping to the source migrations:
 *
 *   discs             <- docs/migration-sql.sql, migration-v2 (speed/glide/turn/fade),
 *                        migration-v4 (user_photo_url), 20260420200909 (quantity),
 *                        20260421082500 (weight NUMERIC), 20260421095625 (flight NUMERIC).
 *                        `tags` is kept here as JSON text (client model carries it).
 *   bags              <- 20260516000001_bags_and_course_pins.sql (disc_ids JSONB -> NVARCHAR JSON)
 *   course_pins       <- 20260516000001_bags_and_course_pins.sql
 *   hole_assignments  <- 20260516000002_hole_assignments.sql
 *   collections       <- 001_collections.sql
 *   collection_discs  <- 001_collections.sql (junction; table only, no route this phase)
 *   wishlist_items    <- 002_wishlist.sql
 *   forsale_listings  <- 003_forsale.sql + 004_forsale_redesign.sql
 *                        (+ `visibility` and `seller_name` added for the friends
 *                         marketplace; replaces the public sale_tokens share model)
 *   bag_history       <- 20260516000000_bag_history.sql
 *
 * Key translation decisions (trade-offs named):
 *   - RLS is GONE. Postgres Row Level Security is replaced by an `ownerId` column
 *     on every table + `WHERE ownerId = @ownerId` in the API (parameterized). The
 *     DB does not enforce isolation; the API layer is the boundary.
 *   - `ownerId` is the Entra object id (oid), a GUID string -> NVARCHAR(100).
 *     (Postgres used `user_id UUID` referencing auth.users; there is no auth.users
 *      in Azure SQL, so no FK — the identity lives in Entra.)
 *   - Primary keys are client-supplied strings/uuids -> NVARCHAR(64). Postgres
 *     gen_random_uuid() defaults are dropped; the client/API supplies ids.
 *   - TIMESTAMPTZ -> DATETIME2 with SYSUTCDATETIME() defaults (UTC).
 *   - JSONB (disc_ids) -> NVARCHAR(MAX) holding a JSON array.
 *   - NUMERIC(p,s) -> DECIMAL(p,s); BOOLEAN -> BIT; TEXT -> NVARCHAR.
 *
 * Idempotent: guarded with IF NOT EXISTS so it is safe to re-run.
 * ============================================================================= */

/* ----------------------------------------------------------------------------
 * discs
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.discs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.discs (
    id             NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId        NVARCHAR(100)  NOT NULL,
    name           NVARCHAR(200)  NOT NULL,
    manufacturer   NVARCHAR(200)  NULL,
    disc_type      NVARCHAR(50)   NULL,
    plastic        NVARCHAR(100)  NULL,
    weight         DECIMAL(5,1)   NULL,
    color          NVARCHAR(100)  NULL,
    condition      NVARCHAR(50)   NULL,
    speed          DECIMAL(4,1)   NULL,
    glide          DECIMAL(4,1)   NULL,
    turn           DECIMAL(4,1)   NULL,
    fade           DECIMAL(4,1)   NULL,
    notes          NVARCHAR(MAX)  NULL,
    tags           NVARCHAR(MAX)  NULL,   -- JSON array of strings
    user_photo_url NVARCHAR(400)  NULL,
    quantity       INT            NOT NULL CONSTRAINT DF_discs_quantity DEFAULT (1),
    added_at       DATETIME2(3)   NOT NULL CONSTRAINT DF_discs_added_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_discs_quantity_min CHECK (quantity >= 1)
  );
  CREATE INDEX IX_discs_ownerId ON dbo.discs (ownerId);
END
GO

/* ----------------------------------------------------------------------------
 * bags
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.bags', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.bags (
    id          NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId     NVARCHAR(100)  NOT NULL,
    name        NVARCHAR(200)  NOT NULL,
    disc_ids    NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_bags_disc_ids DEFAULT (N'[]'),  -- JSON array
    created_at  DATETIME2(3)   NOT NULL CONSTRAINT DF_bags_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at  DATETIME2(3)   NOT NULL CONSTRAINT DF_bags_updated_at DEFAULT (SYSUTCDATETIME())
  );
  CREATE INDEX IX_bags_ownerId ON dbo.bags (ownerId);
END
GO

/* ----------------------------------------------------------------------------
 * course_pins
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.course_pins', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.course_pins (
    id           NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId      NVARCHAR(100)  NOT NULL,
    course_name  NVARCHAR(200)  NOT NULL,
    course_id    NVARCHAR(64)   NULL,
    bag_id       NVARCHAR(64)   NOT NULL,
    created_at   DATETIME2(3)   NOT NULL CONSTRAINT DF_course_pins_created_at DEFAULT (SYSUTCDATETIME())
  );
  CREATE INDEX IX_course_pins_ownerId ON dbo.course_pins (ownerId);
  CREATE INDEX IX_course_pins_bag_id  ON dbo.course_pins (bag_id);
END
GO

/* ----------------------------------------------------------------------------
 * hole_assignments
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.hole_assignments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.hole_assignments (
    id              NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId         NVARCHAR(100)  NOT NULL,
    course_pin_id   NVARCHAR(64)   NOT NULL,
    hole_ref        NVARCHAR(50)   NOT NULL,
    disc_id         NVARCHAR(64)   NULL,
    disc_name       NVARCHAR(200)  NOT NULL,
    created_at      DATETIME2(3)   NOT NULL CONSTRAINT DF_hole_assignments_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at      DATETIME2(3)   NOT NULL CONSTRAINT DF_hole_assignments_updated_at DEFAULT (SYSUTCDATETIME())
  );
  CREATE INDEX IX_hole_assignments_ownerId     ON dbo.hole_assignments (ownerId);
  CREATE INDEX IX_hole_assignments_pin         ON dbo.hole_assignments (course_pin_id);
END
GO

/* ----------------------------------------------------------------------------
 * collections
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.collections', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.collections (
    id          NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId     NVARCHAR(100)  NOT NULL,
    name        NVARCHAR(200)  NOT NULL,
    description NVARCHAR(MAX)  NULL,
    created_at  DATETIME2(3)   NOT NULL CONSTRAINT DF_collections_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at  DATETIME2(3)   NOT NULL CONSTRAINT DF_collections_updated_at DEFAULT (SYSUTCDATETIME())
  );
  CREATE INDEX IX_collections_ownerId ON dbo.collections (ownerId);
END
GO

/* ----------------------------------------------------------------------------
 * collection_discs (junction)
 * Carries ownerId for uniform scoping even though it is a child of collections.
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.collection_discs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.collection_discs (
    collection_id NVARCHAR(64)   NOT NULL,
    disc_id       NVARCHAR(64)   NOT NULL,
    ownerId       NVARCHAR(100)  NOT NULL,
    sort_order    INT            NOT NULL CONSTRAINT DF_collection_discs_sort DEFAULT (0),
    added_at      DATETIME2(3)   NOT NULL CONSTRAINT DF_collection_discs_added_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_collection_discs PRIMARY KEY (collection_id, disc_id)
  );
  CREATE INDEX IX_collection_discs_ownerId ON dbo.collection_discs (ownerId);
END
GO

/* ----------------------------------------------------------------------------
 * wishlist_items
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.wishlist_items', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.wishlist_items (
    id           NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId      NVARCHAR(100)  NOT NULL,
    disc_name    NVARCHAR(200)  NOT NULL,
    manufacturer NVARCHAR(200)  NULL,
    plastic_pref NVARCHAR(100)  NULL,
    weight_min   INT            NULL,
    weight_max   INT            NULL,
    priority     INT            NOT NULL CONSTRAINT DF_wishlist_priority DEFAULT (0),
    notes        NVARCHAR(MAX)  NULL,
    acquired     BIT            NOT NULL CONSTRAINT DF_wishlist_acquired DEFAULT (0),
    created_at   DATETIME2(3)   NOT NULL CONSTRAINT DF_wishlist_created_at DEFAULT (SYSUTCDATETIME()),
    updated_at   DATETIME2(3)   NOT NULL CONSTRAINT DF_wishlist_updated_at DEFAULT (SYSUTCDATETIME())
  );
  CREATE INDEX IX_wishlist_items_ownerId ON dbo.wishlist_items (ownerId);
END
GO

/* ----------------------------------------------------------------------------
 * forsale_listings
 * `visibility` drives the friends marketplace: 'shared' listings are readable by
 * any authenticated friend via GET /api/forsale/shared. `seller_name` is a
 * snapshot so the marketplace can render the seller without a cross-owner join.
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.forsale_listings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.forsale_listings (
    id                NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId           NVARCHAR(100)  NOT NULL,
    disc_id           NVARCHAR(64)   NULL,
    disc_name         NVARCHAR(200)  NULL,
    disc_manufacturer NVARCHAR(200)  NULL,
    disc_type         NVARCHAR(50)   NULL,
    disc_plastic      NVARCHAR(100)  NULL,
    disc_color        NVARCHAR(100)  NULL,
    disc_weight       DECIMAL(6,1)   NULL,
    disc_condition    NVARCHAR(50)   NULL,
    status            NVARCHAR(20)   NOT NULL CONSTRAINT DF_forsale_status DEFAULT (N'available'),
    visibility        NVARCHAR(20)   NOT NULL CONSTRAINT DF_forsale_visibility DEFAULT (N'private'),
    seller_name       NVARCHAR(200)  NULL,
    listed_at         DATETIME2(3)   NOT NULL CONSTRAINT DF_forsale_listed_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_forsale_status     CHECK (status IN (N'available', N'sold')),
    CONSTRAINT CK_forsale_visibility CHECK (visibility IN (N'private', N'shared'))
  );
  CREATE INDEX IX_forsale_listings_ownerId    ON dbo.forsale_listings (ownerId);
  CREATE INDEX IX_forsale_listings_visibility ON dbo.forsale_listings (visibility);
END
GO

/* ----------------------------------------------------------------------------
 * bag_history (append-only audit of disc add/remove within a bag)
 * -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.bag_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.bag_history (
    id           NVARCHAR(64)   NOT NULL PRIMARY KEY,
    ownerId      NVARCHAR(100)  NOT NULL,
    bag_id       NVARCHAR(64)   NOT NULL,
    disc_id      NVARCHAR(64)   NULL,
    disc_name    NVARCHAR(200)  NOT NULL,
    action       NVARCHAR(20)   NOT NULL,
    changed_at   DATETIME2(3)   NOT NULL CONSTRAINT DF_bag_history_changed_at DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_bag_history_action CHECK (action IN (N'added', N'removed'))
  );
  CREATE INDEX IX_bag_history_ownerId ON dbo.bag_history (ownerId);
  CREATE INDEX IX_bag_history_bag_id  ON dbo.bag_history (bag_id);
END
GO
