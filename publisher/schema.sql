BEGIN;
DO $$ BEGIN
 IF current_database() <> 'community_publicacoes' THEN RAISE EXCEPTION 'dedicated database required'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS publication_approvals (
 id uuid PRIMARY KEY, post_id text NOT NULL REFERENCES feed_drafts(post_id),
 draft_version bigint NOT NULL, confirmation_key text NOT NULL UNIQUE,
 fingerprint text NOT NULL, snapshot jsonb NOT NULL, approved_by text NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL,
 UNIQUE(post_id,draft_version)
);
CREATE TABLE IF NOT EXISTS publication_deliveries (
 id uuid PRIMARY KEY, approval_id uuid NOT NULL REFERENCES publication_approvals(id),
 post_id text NOT NULL, network text NOT NULL CHECK(network IN ('instagram','facebook')),
 account_id text NOT NULL,
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','processing','published','failed','uncertain','held','cancelled')),
 due_at timestamptz NOT NULL, next_at timestamptz NOT NULL,
 lease_id uuid, lease_until timestamptz, state jsonb NOT NULL DEFAULT '{}', inflight jsonb,
 result jsonb, error_code text, cancelled_by text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((network='instagram' AND account_id='100000000000004') OR (network='facebook' AND account_id='100000000000006')),
 UNIQUE(approval_id,network)
);
CREATE UNIQUE INDEX IF NOT EXISTS publication_post_network_once ON publication_deliveries(post_id,network) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS publication_due ON publication_deliveries(next_at) WHERE status='scheduled';
CREATE TABLE IF NOT EXISTS publication_attempts (
 id uuid PRIMARY KEY, delivery_id uuid NOT NULL REFERENCES publication_deliveries(id),
 operation text NOT NULL, status text NOT NULL CHECK(status IN ('prepared','succeeded','rejected','uncertain')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS publication_health (
 component text PRIMARY KEY, ready boolean NOT NULL, details jsonb NOT NULL,
 checked_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
