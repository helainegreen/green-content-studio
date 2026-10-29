'use strict';
const {Pool} = require('pg');
const {createRepository: createConnectionsRepository, tokenContext} = require('../social-connections/repository.cjs');
const {vaultFromFile, check} = require('../social-connections/security.cjs');
const {createRepository} = require('./repository.cjs');
const {createAssets} = require('./assets.cjs');
const {createMeta} = require('./meta.cjs');
const {execute} = require('./executor.cjs');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function start(env = process.env) {
  check(env.GCS_SOCIAL_PUBLISH_WORKER_ENABLED === 'true', 'worker_disabled', 'Worker desativado.', 503);
  const database = new URL(env.GCS_SOCIAL_PUBLISH_DATABASE_URL || '');
  check(['postgres:','postgresql:'].includes(database.protocol) && decodeURIComponent(database.pathname) === '/conteudo',
    'wrong_database', 'Banco do publicador inválido.', 503);
  const origin = new URL(env.GCS_SOCIAL_ORIGIN || '');
  check(origin.protocol === 'https:' && origin.origin === env.GCS_SOCIAL_ORIGIN,
    'invalid_origin', 'Origem pública inválida.', 503);
  const writesEnabled = env.GCS_SOCIAL_PUBLISH_WRITES_ENABLED === 'true';
  const pool = new Pool({
    connectionString: database.href,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    application_name: 'green_content_social_publisher'
  });
  pool.on('error', () => console.error('[social-publisher] conexão de banco indisponível'));
  const vault = vaultFromFile(env.GCS_SOCIAL_KEY_FILE);
  const repository = createRepository(pool);
  const connections = createConnectionsRepository(pool, vault);
  const assets = createAssets({
    directory: env.GCS_SOCIAL_PUBLISH_ASSETS_DIR,
    origin: origin.origin,
    keyFile: env.GCS_SOCIAL_KEY_FILE
  });
  let running = true;
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => { running = false; });
  await repository.health('worker', writesEnabled, {writes_enabled: writesEnabled});

  while (running) {
    if (!writesEnabled) {
      await wait(5000);
      continue;
    }
    try {
      const worked = await repository.exclusive(async () => {
        const job = await repository.claim();
        if (!job) return;
        const settings = await connections.settings();
        if (!settings) {
          await repository.finish(job, {status: 'held', error: 'meta_settings_missing'});
          return true;
        }
        let credential;
        try {
          credential = vault.open(job.encrypted_token, tokenContext(job));
        } catch {
          await repository.finish(job, {status: 'held', error: 'connection_unavailable'});
          return true;
        }
        const api = createMeta({
          network: job.network,
          accountId: job.account_id,
          tokenProvider: async () => credential.token,
          appSecret: settings.app_secret,
          version: settings.version,
          mediaOrigin: origin.origin,
          writesEnabled: true
        });
        await execute(job, {repository, api, assets});
        return true;
      });
      await repository.health('worker', true, {writes_enabled: true});
      if (!worked) await wait(1000);
    } catch (error) {
      console.error('[social-publisher] ciclo falhou:', String(error?.code || error?.name || 'error'));
      await repository.health('worker', false, {error: String(error?.code || 'cycle_failed')}).catch(() => {});
      await wait(5000);
    }
  }
  await pool.end();
}

if (require.main === module) {
  start().catch(error => {
    console.error('[social-publisher] não iniciou:', String(error?.code || error?.name || 'error'));
    process.exitCode = 1;
  });
}

module.exports = {start};
