ALTER TABLE owned_discs
  ADD COLUMN disc_type text,
  ADD COLUMN plastic text,
  ADD COLUMN weight numeric,
  ADD COLUMN color text,
  ADD COLUMN condition text,
  ADD COLUMN speed numeric,
  ADD COLUMN glide numeric,
  ADD COLUMN turn numeric,
  ADD COLUMN fade numeric,
  ADD COLUMN notes text,
  ADD COLUMN tags jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN user_photo_url text,
  ADD COLUMN quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 10000);
ALTER TABLE owned_discs ADD CONSTRAINT owned_discs_owner_key UNIQUE (user_id, id);

CREATE TABLE bags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  name text NOT NULL,
  disc_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE TABLE bag_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  bag_id uuid NOT NULL,
  disc_id uuid NOT NULL,
  disc_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('added', 'removed')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, bag_id) REFERENCES bags(user_id, id) ON DELETE CASCADE
);
CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE TABLE collection_discs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  collection_id uuid NOT NULL,
  disc_id uuid NOT NULL,
  UNIQUE (collection_id, disc_id),
  FOREIGN KEY (user_id, collection_id) REFERENCES collections(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, disc_id) REFERENCES owned_discs(user_id, id) ON DELETE CASCADE
);
CREATE TABLE wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  disc_name text NOT NULL,
  manufacturer text NOT NULL DEFAULT '',
  plastic_pref text NOT NULL DEFAULT '',
  weight_min numeric,
  weight_max numeric,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  notes text NOT NULL DEFAULT '',
  acquired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (weight_min IS NULL OR weight_max IS NULL OR weight_min <= weight_max)
);
CREATE TABLE forsale_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  disc_id uuid NOT NULL,
  disc_name text NOT NULL,
  disc_manufacturer text NOT NULL DEFAULT '',
  disc_type text NOT NULL DEFAULT '',
  disc_plastic text NOT NULL DEFAULT '',
  disc_color text NOT NULL DEFAULT '',
  disc_weight text NOT NULL DEFAULT '',
  disc_condition text NOT NULL DEFAULT 'good',
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold')),
  listed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sale_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app_users(id),
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  is_public boolean NOT NULL DEFAULT false
);
CREATE TABLE course_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  course_name text NOT NULL,
  course_id text,
  bag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, bag_id) REFERENCES bags(user_id, id) ON DELETE CASCADE
);
CREATE TABLE hole_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  course_pin_id uuid NOT NULL,
  hole_ref text NOT NULL,
  disc_id uuid NOT NULL,
  disc_name text NOT NULL,
  UNIQUE (course_pin_id, hole_ref),
  FOREIGN KEY (user_id, course_pin_id) REFERENCES course_pins(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, disc_id) REFERENCES owned_discs(user_id, id) ON DELETE CASCADE
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['bags','bag_history','collections','collection_discs',
    'wishlist_items','forsale_listings','sale_tokens','course_pins','hole_assignments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE INDEX ON %I(user_id)', table_name);
    EXECUTE format('CREATE POLICY owner_access ON %I USING
      (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)
      WITH CHECK (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;

CREATE POLICY token_lookup ON sale_tokens FOR SELECT USING (
  is_public AND token = nullif(current_setting('app.sale_token', true), '')::uuid
);
CREATE POLICY public_listing ON forsale_listings FOR SELECT USING (
  status = 'available' AND EXISTS (
    SELECT 1 FROM sale_tokens st WHERE st.user_id = forsale_listings.user_id
      AND st.is_public AND st.token = nullif(current_setting('app.sale_token', true), '')::uuid
  )
);
