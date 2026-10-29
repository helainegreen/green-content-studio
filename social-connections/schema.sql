BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
CREATE TABLE IF NOT EXISTS social_master_users (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS social_client_members (
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (client_id,user_id)
);
CREATE TABLE IF NOT EXISTS social_settings (
  name text PRIMARY KEY CHECK (name='meta'),
  encrypted_value jsonb NOT NULL,
  updated_by text NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS social_oauth_flows (
  id uuid PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  state_hash text NOT NULL UNIQUE,
  settings_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  candidates jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_oauth_expiry ON social_oauth_flows(expires_at);
CREATE TABLE IF NOT EXISTS social_connections (
  id uuid PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  network text NOT NULL CHECK (network IN ('instagram','facebook')),
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{1,40}$'),
  account_name text NOT NULL,
  page_id text NOT NULL,
  app_id text,
  auth_type text NOT NULL CHECK (auth_type IN ('facebook_login','legacy_community')),
  status text NOT NULL CHECK (status IN ('connected','disconnected','legacy')),
  encrypted_token jsonb,
  scopes jsonb NOT NULL DEFAULT '[]',
  capabilities jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  connected_by text REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id,network),
  CHECK ((status='connected' AND encrypted_token IS NOT NULL AND auth_type='facebook_login') OR
         (status='legacy' AND auth_type='legacy_community' AND encrypted_token IS NULL) OR
         (status='disconnected' AND encrypted_token IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS social_unique_active_account
  ON social_connections(network,account_id) WHERE status IN ('connected','legacy');
CREATE TABLE IF NOT EXISTS social_connection_events (
  id bigserial PRIMARY KEY,
  client_id text REFERENCES clients(id) ON DELETE CASCADE,
  actor_id text REFERENCES users(id),
  event text NOT NULL,
  account_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
