BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS social_instagram_stat_snapshots (
  id uuid PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{1,40}$'),
  days integer NOT NULL CHECK (days IN (7,30)),
  collected_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id,account_id,days,collected_at)
);
CREATE INDEX IF NOT EXISTS social_instagram_stat_snapshots_latest
  ON social_instagram_stat_snapshots(client_id,account_id,days,collected_at DESC);

CREATE TABLE IF NOT EXISTS social_instagram_follower_history (
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{1,40}$'),
  observed_date date NOT NULL,
  observed_at timestamptz NOT NULL,
  followers bigint NOT NULL CHECK (followers>=0),
  PRIMARY KEY(client_id,account_id,observed_date)
);

CREATE TABLE IF NOT EXISTS social_instagram_stat_sync (
  client_id text PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  account_id text CHECK (account_id IS NULL OR account_id ~ '^[0-9]{1,40}$'),
  attempted_at timestamptz,
  success_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'waiting_connection' CHECK (status IN (
    'waiting_connection','ok','partial','reconnect','rate_limit','unavailable'
  )),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_instagram_stat_sync_due
  ON social_instagram_stat_sync(next_attempt_at);

COMMIT;
