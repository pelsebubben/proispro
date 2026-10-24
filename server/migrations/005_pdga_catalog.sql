CREATE SCHEMA pdga_catalog;
REVOKE ALL ON SCHEMA pdga_catalog FROM PUBLIC;

CREATE TABLE pdga_catalog.sync_runs (
  id uuid PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT now(),
  fetched_at timestamptz NOT NULL,
  course_count integer NOT NULL CHECK (course_count >= 10)
);
CREATE TABLE pdga_catalog.courses (
  id text PRIMARY KEY CHECK (id ~ '^pdga:[1-9][0-9]{0,15}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  city text NOT NULL CHECK (length(city) <= 300),
  country text NOT NULL DEFAULT 'NO' CHECK (country = 'NO'),
  latitude double precision CHECK (latitude BETWEEN 57 AND 82),
  longitude double precision CHECK (longitude BETWEEN -10 AND 36),
  expected_holes integer CHECK (expected_holes BETWEEN 1 AND 200),
  source_url text NOT NULL CHECK (source_url ~ '^https://www\.pdga\.com/node/[1-9][0-9]{0,15}$'),
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  sync_id uuid NOT NULL REFERENCES pdga_catalog.sync_runs(id)
);
CREATE INDEX pdga_courses_name_idx ON pdga_catalog.courses(lower(name),id) WHERE active;
REVOKE ALL ON ALL TABLES IN SCHEMA pdga_catalog FROM PUBLIC;
