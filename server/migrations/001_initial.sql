CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TABLE IF NOT EXISTS owned_discs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  manufacturer text NOT NULL DEFAULT '',
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owned_discs_user_id_idx ON owned_discs(user_id);
ALTER TABLE owned_discs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owned_discs FORCE ROW LEVEL SECURITY;
CREATE POLICY own_discs ON owned_discs
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
