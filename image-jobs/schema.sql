BEGIN;
DO $$ BEGIN IF current_database()<>'community_publicacoes' THEN RAISE EXCEPTION 'dedicated database required'; END IF; END $$;
CREATE TABLE IF NOT EXISTS image_generation_jobs (
 id uuid PRIMARY KEY,
 post_id text NOT NULL,
 actor_id text NOT NULL,
 request_key text NOT NULL UNIQUE,
 request_digest text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('cover','internal')),
 payload jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed','uncertain','review_needed')),
 state jsonb NOT NULL,
 lease_id uuid,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS image_generation_one_active_post ON image_generation_jobs(post_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS image_generation_due ON image_generation_jobs(created_at) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS image_generation_post ON image_generation_jobs(post_id,created_at DESC);
GRANT SELECT,INSERT,UPDATE ON image_generation_jobs TO community_publicacoes_app;
COMMIT;
