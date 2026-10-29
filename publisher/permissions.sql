-- Scoped grants, used both by the isolated integration test and deployment.
GRANT CONNECT ON DATABASE community_publicacoes TO community_publicador;
GRANT USAGE ON SCHEMA public TO community_publicador;
GRANT SELECT ON publication_approvals TO community_publicador;
GRANT SELECT,INSERT,UPDATE ON publication_deliveries,publication_attempts,publication_health TO community_publicador;
GRANT SELECT,INSERT ON publication_approvals TO community_publicacoes_app;
GRANT SELECT,INSERT,UPDATE ON publication_deliveries TO community_publicacoes_app;
GRANT SELECT ON publication_attempts,publication_health TO community_publicacoes_app;
