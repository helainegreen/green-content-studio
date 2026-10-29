GRANT CONNECT ON DATABASE community_publicacoes TO community_estatisticas;
GRANT USAGE ON SCHEMA public TO community_estatisticas;
GRANT SELECT,INSERT ON instagram_stat_snapshots TO community_estatisticas;
GRANT SELECT,INSERT,UPDATE ON instagram_follower_history,instagram_stat_sync TO community_estatisticas;
GRANT SELECT ON instagram_stat_snapshots,instagram_follower_history,instagram_stat_sync TO community_publicacoes_app;
