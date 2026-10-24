ALTER TABLE private_layouts ADD COLUMN private_name text
  CHECK (private_name IS NULL OR (provider_ref IS NOT NULL AND length(trim(private_name)) BETWEEN 1 AND 100));
DROP INDEX private_provider_layout;
CREATE UNIQUE INDEX private_provider_layout ON private_layouts
  (user_id,course_key,(provider_ref->>'tournament_id'),(provider_ref->>'layout_id'))
  WHERE provider_ref IS NOT NULL AND private_name IS NULL;

ALTER TABLE private_plans ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE private_plans DROP CONSTRAINT private_plans_course_pin_id_key;
ALTER TABLE private_plans ADD CONSTRAINT private_plan_per_layout UNIQUE(user_id,course_pin_id,layout_id);
CREATE UNIQUE INDEX private_active_plan ON private_plans(course_pin_id) WHERE active;
