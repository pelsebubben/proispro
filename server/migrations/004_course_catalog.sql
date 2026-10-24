CREATE SCHEMA course_catalog;
REVOKE ALL ON SCHEMA course_catalog FROM PUBLIC;

CREATE TABLE course_catalog.sync_runs (
  id uuid PRIMARY KEY,
  country text NOT NULL CHECK (country = 'NO'),
  source_timestamp timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object')
);

CREATE TABLE course_catalog.courses (
  id text PRIMARY KEY CHECK (id ~ '^osm:(node|way|relation):[1-9][0-9]{0,15}$'),
  country text NOT NULL CHECK (country = 'NO'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  city text NOT NULL DEFAULT '' CHECK (length(city) <= 200),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  expected_holes integer CHECK (expected_holes BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  source_version integer NOT NULL CHECK (source_version > 0),
  source_updated_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  sync_id uuid NOT NULL REFERENCES course_catalog.sync_runs(id),
  UNIQUE (country, id)
);
CREATE INDEX courses_name_idx ON course_catalog.courses (lower(name), id) WHERE active;

CREATE TABLE course_catalog.holes (
  course_id text NOT NULL REFERENCES course_catalog.courses(id),
  id text NOT NULL CHECK (id ~ '^osm:way:[1-9][0-9]{0,15}$'),
  ref text NOT NULL CHECK (length(ref) BETWEEN 1 AND 40),
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 300),
  par integer CHECK (par BETWEEN 1 AND 20),
  length_m double precision CHECK (length_m > 0 AND length_m <= 5000),
  geometry jsonb NOT NULL CHECK (jsonb_typeof(geometry) = 'array' AND jsonb_array_length(geometry) BETWEEN 2 AND 2000),
  association text NOT NULL CHECK (association IN ('relation', 'boundary')),
  source_version integer NOT NULL CHECK (source_version > 0),
  source_updated_at timestamptz NOT NULL,
  sync_id uuid NOT NULL REFERENCES course_catalog.sync_runs(id),
  PRIMARY KEY (course_id, id),
  UNIQUE (course_id, ref)
);
REVOKE ALL ON ALL TABLES IN SCHEMA course_catalog FROM PUBLIC;
