BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS social_publication_batches (
  id uuid PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
  created_by text NOT NULL REFERENCES users(id),
  confirmed_by text REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_publication_batches_client
  ON social_publication_batches(client_id,created_at DESC);

CREATE TABLE IF NOT EXISTS social_publication_plans (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES social_publication_batches(id) ON DELETE CASCADE,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  due_at timestamptz NOT NULL,
  networks jsonb NOT NULL CHECK (
    jsonb_typeof(networks)='array' AND jsonb_array_length(networks) BETWEEN 1 AND 2
  ),
  captions jsonb NOT NULL CHECK (jsonb_typeof(captions)='object'),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  generation_id text NOT NULL REFERENCES generation_jobs(id) ON DELETE RESTRICT,
  replaces_plan_id uuid REFERENCES social_publication_plans(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id,post_id),
  UNIQUE(batch_id,position)
);
ALTER TABLE social_publication_plans ADD COLUMN IF NOT EXISTS replaces_plan_id uuid
  REFERENCES social_publication_plans(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS social_publication_plans_post
  ON social_publication_plans(post_id);
CREATE INDEX IF NOT EXISTS social_publication_plans_replacement
  ON social_publication_plans(replaces_plan_id) WHERE replaces_plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_publication_approvals (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL UNIQUE REFERENCES social_publication_plans(id) ON DELETE RESTRICT,
  plan_version integer NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL,
  approved_by text NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS social_publication_deliveries (
  id uuid PRIMARY KEY,
  approval_id uuid NOT NULL REFERENCES social_publication_approvals(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES social_publication_plans(id) ON DELETE RESTRICT,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  post_id text NOT NULL REFERENCES posts(id) ON DELETE RESTRICT,
  network text NOT NULL CHECK (network IN ('instagram','facebook')),
  connection_id uuid NOT NULL REFERENCES social_connections(id) ON DELETE RESTRICT,
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{1,40}$'),
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled','processing','published','failed','uncertain','held','cancelled')
  ),
  due_at timestamptz NOT NULL,
  next_at timestamptz NOT NULL,
  lease_id uuid,
  lease_until timestamptz,
  state jsonb NOT NULL DEFAULT '{}',
  inflight jsonb,
  result jsonb,
  error_code text,
  cancelled_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,network)
);
CREATE INDEX IF NOT EXISTS social_publication_deliveries_due
  ON social_publication_deliveries(next_at) WHERE status='scheduled';
CREATE UNIQUE INDEX IF NOT EXISTS social_publication_post_network_once
  ON social_publication_deliveries(post_id,network) WHERE status<>'cancelled';

CREATE TABLE IF NOT EXISTS social_publication_attempts (
  id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES social_publication_deliveries(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  status text NOT NULL CHECK (status IN ('prepared','succeeded','rejected','uncertain')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS social_publication_health (
  component text PRIMARY KEY,
  ready boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  checked_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
