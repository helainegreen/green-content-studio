BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Additive and opt-in. No UPDATE/ALTER/DELETE of existing customer tables.
CREATE TABLE IF NOT EXISTS gcs_creation_access (
  client_id text PRIMARY KEY REFERENCES clients(id),
  enabled boolean NOT NULL DEFAULT false,
  management_mode text NOT NULL DEFAULT 'green_managed' CHECK(management_mode IN ('green_managed','subscription')),
  subscription_active boolean NOT NULL DEFAULT false,
  monthly_limit integer NOT NULL DEFAULT 30 CHECK(monthly_limit BETWEEN 1 AND 500),
  managed_by text REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gcs_creation_brands (
  client_id text PRIMARY KEY REFERENCES clients(id),
  profile jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by text REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gcs_creation_jobs (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id),
  created_by text NOT NULL REFERENCES users(id),
  request_key text NOT NULL,
  state text NOT NULL CHECK(state IN ('queued_headlines','working_headlines','headlines','queued_copy','working_copy','review','queued_render','working_render','ready','failed','cancelled')),
  input jsonb NOT NULL,
  brand_snapshot jsonb NOT NULL,
  brand_version integer NOT NULL,
  access_version integer NOT NULL,
  headlines jsonb,
  selected_headline integer,
  draft jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact jsonb,
  post_id text REFERENCES posts(id),
  revision integer NOT NULL DEFAULT 1,
  lease_token text,
  heartbeat_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, request_key)
);
CREATE INDEX IF NOT EXISTS gcs_creation_jobs_queue ON gcs_creation_jobs(state,created_at);
CREATE INDEX IF NOT EXISTS gcs_creation_jobs_client ON gcs_creation_jobs(client_id,created_at DESC);
CREATE TABLE IF NOT EXISTS gcs_creation_audit (
  id text PRIMARY KEY,
  actor_id text REFERENCES users(id),
  client_id text NOT NULL REFERENCES clients(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
