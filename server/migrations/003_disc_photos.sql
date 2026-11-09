ALTER TABLE owned_discs
  ADD COLUMN edition text NOT NULL DEFAULT '' CHECK (length(edition) <= 200),
  ADD COLUMN photo_version uuid;

-- Normalized JPEG bytes live outside owned_discs so inventory reads never carry them.
CREATE TABLE disc_photos (
  disc_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id),
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 262144),
  FOREIGN KEY (user_id, disc_id) REFERENCES owned_discs(user_id, id) ON DELETE CASCADE
);
ALTER TABLE disc_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE disc_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON disc_photos
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
