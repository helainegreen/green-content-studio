-- Only the Community News project database. No automatic retention purge.
DO $$ BEGIN
  IF current_database() <> 'community_publicacoes' THEN RAISE EXCEPTION 'dedicated_database_required'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS instagram_stat_snapshots (
  id uuid PRIMARY KEY,
  account_id text NOT NULL CHECK(account_id='100000000000004'),
  days smallint NOT NULL CHECK(days IN (7,30)),
  collected_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  UNIQUE(account_id,days,collected_at)
);
CREATE INDEX IF NOT EXISTS instagram_stat_snapshots_latest ON instagram_stat_snapshots(days,collected_at DESC);
CREATE TABLE IF NOT EXISTS instagram_follower_history (
  account_id text NOT NULL CHECK(account_id='100000000000004'),
  observed_date date NOT NULL,
  observed_at timestamptz NOT NULL,
  followers bigint NOT NULL CHECK(followers>=0),
  PRIMARY KEY(account_id,observed_date)
);
CREATE TABLE IF NOT EXISTS instagram_stat_sync (
  account_id text PRIMARY KEY CHECK(account_id='100000000000004'),
  attempted_at timestamptz NOT NULL,
  success_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('ok','partial','unavailable','reconnect','rate_limit'))
);
REVOKE ALL ON instagram_stat_snapshots,instagram_follower_history,instagram_stat_sync FROM PUBLIC;
