-- Run only in the existing dedicated community_publicacoes database, after backup.
DO $$ BEGIN IF current_database() <> 'community_publicacoes' THEN RAISE EXCEPTION 'wrong database'; END IF; END $$;
CREATE TABLE IF NOT EXISTS editorial_topics (
 id text PRIMARY KEY CHECK(length(id)=32), day date NOT NULL, body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS editorial_requests (
 id uuid PRIMARY KEY, topic_id text NOT NULL UNIQUE REFERENCES editorial_topics(id),
 post_id uuid NOT NULL UNIQUE, actor text NOT NULL, version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'queued', body jsonb NOT NULL, error_code text,
 lease_id uuid, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS editorial_versions (
 request_id uuid NOT NULL REFERENCES editorial_requests(id), version integer NOT NULL,
 actor text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(request_id,version)
);
CREATE TABLE IF NOT EXISTS editorial_events (
 id uuid PRIMARY KEY, request_id uuid REFERENCES editorial_requests(id), kind text NOT NULL,
 body jsonb NOT NULL, delivered_at timestamptz, lease_id uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(request_id,kind)
);
CREATE INDEX IF NOT EXISTS editorial_requests_pending ON editorial_requests(status,updated_at);
GRANT SELECT,INSERT,UPDATE ON editorial_topics,editorial_requests,editorial_versions,editorial_events TO community_publicacoes_app;
