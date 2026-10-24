-- Remove only the retired shared catalogue; private links, layouts and choices remain.
DROP TABLE course_catalog.holes;
DROP TABLE course_catalog.courses;
DROP TABLE course_catalog.sync_runs;
DROP SCHEMA course_catalog;
DO $retire$
DECLARE writer text;
BEGIN
  FOREACH writer IN ARRAY ARRAY['griplock_courses_sync','griplock_dev_courses_sync'] LOOP
    IF EXISTS(SELECT FROM pg_roles WHERE rolname=writer) THEN
      EXECUTE format('ALTER ROLE %I NOLOGIN',writer);
    END IF;
  END LOOP;
END $retire$;

CREATE SCHEMA provider_cache;
REVOKE ALL ON SCHEMA provider_cache FROM PUBLIC;
CREATE TABLE provider_cache.entries (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (pg_column_size(value) <= 524288)
);
CREATE INDEX provider_cache_expiry ON provider_cache.entries(expires_at);
CREATE TABLE provider_cache.control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  window_start timestamptz NOT NULL DEFAULT now(),
  requests integer NOT NULL DEFAULT 0 CHECK (requests BETWEEN 0 AND 20),
  blocked_until timestamptz NOT NULL DEFAULT now()
);
INSERT INTO provider_cache.control DEFAULT VALUES;
REVOKE ALL ON ALL TABLES IN SCHEMA provider_cache FROM PUBLIC;

-- Provider references contain IDs only. Provider facts remain exclusively in the expiring cache.
ALTER TABLE private_layouts ADD COLUMN provider_ref jsonb CHECK (
  provider_ref IS NULL OR (
    jsonb_typeof(provider_ref) = 'object' AND
    provider_ref ?& ARRAY['course_id','tournament_id','layout_id'] AND
    provider_ref - ARRAY['course_id','tournament_id','layout_id'] = '{}'::jsonb AND
    jsonb_typeof(provider_ref->'course_id') = 'string' AND
    jsonb_typeof(provider_ref->'tournament_id') = 'string' AND
    jsonb_typeof(provider_ref->'layout_id') = 'string' AND
    provider_ref->>'course_id' ~ '^pdga:[1-9][0-9]{0,15}$' AND
    provider_ref->>'tournament_id' ~ '^[1-9][0-9]{0,15}$' AND
    provider_ref->>'layout_id' ~ '^[1-9][0-9]{0,15}$' AND
    course_key = provider_ref->>'course_id' AND
    name = 'PDGA event layout' AND holes = '[]'::jsonb AND
    tee = '' AND basket = '' AND description = '' AND checked_on IS NULL
  )
);
CREATE UNIQUE INDEX private_provider_layout ON private_layouts
  (user_id,course_key,(provider_ref->>'tournament_id'),(provider_ref->>'layout_id'))
  WHERE provider_ref IS NOT NULL;
