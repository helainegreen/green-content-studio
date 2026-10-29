-- Apply ONLY to the dedicated database community_publicacoes with its own role.
-- The application does not run this migration automatically.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'community_publicacoes' THEN
    RAISE EXCEPTION 'This migration requires community_publicacoes';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS feed_drafts (
  post_id text PRIMARY KEY,
  client_slug text NOT NULL DEFAULT 'community' CHECK (client_slug = 'community'),
  version bigint NOT NULL CHECK (version > 0),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS feed_draft_versions (
  post_id text NOT NULL REFERENCES feed_drafts(post_id),
  version bigint NOT NULL CHECK (version > 0),
  body jsonb NOT NULL,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, version)
);
COMMIT;
