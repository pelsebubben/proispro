CREATE TABLE private_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  course_key text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  tee text NOT NULL DEFAULT '' CHECK (length(tee) <= 100),
  basket text NOT NULL DEFAULT '' CHECK (length(basket) <= 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  checked_on date,
  holes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(holes)='array' AND jsonb_array_length(holes) <= 72),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id)
);
CREATE INDEX private_layouts_course_idx ON private_layouts(user_id,course_key);
CREATE TABLE private_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  course_pin_id uuid NOT NULL UNIQUE,
  layout_id uuid NOT NULL,
  selections jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(selections)='object'),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(user_id,course_pin_id) REFERENCES course_pins(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,layout_id) REFERENCES private_layouts(user_id,id) ON DELETE RESTRICT
);
CREATE INDEX private_plans_layout_idx ON private_plans(user_id,layout_id);
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['private_layouts','private_plans'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
    EXECUTE format('CREATE POLICY owner_access ON %I USING
      (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)
      WITH CHECK (user_id=nullif(current_setting(''app.user_id'',true),'''')::uuid)',target);
  END LOOP;
END $$;
REVOKE ALL ON private_layouts,private_plans FROM PUBLIC;
