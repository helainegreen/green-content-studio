'use strict';
const crypto = require('node:crypto');
const {check, hash} = require('./security.cjs');
const {capabilities} = require('./meta.cjs');
const flowContext = flow => `social:flow:${flow.client_id}:${flow.user_id}:${flow.id}`;
const tokenContext = row => `social:token:${row.client_id}:${row.network}:${row.account_id}`;
function createRepository(pool, vault) {
  const settingsContext = 'social:settings:meta';
  return {
    async settings() {
      const r = await pool.query("SELECT encrypted_value FROM social_settings WHERE name='meta'");
      return r.rowCount ? vault.open(r.rows[0].encrypted_value, settingsContext) : null;
    },
    async saveSettings(value, user) {
      check(user.is_master, 'forbidden', 'Acesso exclusivo da administração.', 403);
      const encrypted = vault.seal(value, settingsContext);
      await pool.query(`INSERT INTO social_settings(name,encrypted_value,updated_by) VALUES('meta',$1,$2)
        ON CONFLICT(name) DO UPDATE SET encrypted_value=$1,updated_by=$2,updated_at=now()`, [encrypted, user.id]);
    },
    async list(clientId) {
      const r = await pool.query(`SELECT id,network,account_id,account_name,status,auth_type,capabilities,expires_at,updated_at
        FROM social_connections WHERE client_id=$1 ORDER BY network`, [clientId]);
      return r.rows;
    },
    async insightConnection(clientId, network) {
      check(['instagram','facebook'].includes(network), 'insights_network', 'Rede de estatisticas invalida.');
      const r = await pool.query(`SELECT id,client_id,network,account_id,account_name,status,capabilities,expires_at,encrypted_token
        FROM social_connections WHERE client_id=$1 AND network=$2`, [clientId, network]);
      const row = r.rows[0];
      check(row && row.status === 'connected' && row.encrypted_token && row.capabilities?.insights === true,
        'insights_permission', 'As estatisticas desta conta ainda nao estao autorizadas.', 409);
      check(!row.expires_at || new Date(row.expires_at) > new Date(),
        'insights_expired', 'A autorizacao expirou. Conecte novamente.', 409);
      const credential = vault.open(row.encrypted_token, tokenContext(row));
      check(typeof credential?.token === 'string' && credential.token.length >= 20,
        'insights_token', 'Reconecte a conta Meta.', 409);
      return {...row, token: credential.token, encrypted_token: undefined};
    },
    async begin(client, user, settings) {
      const state = crypto.randomBytes(32).toString('base64url'), id = crypto.randomUUID();
      // Expired credentials from unfinished consent flows are discarded on the next attempt.
      await pool.query('DELETE FROM social_oauth_flows WHERE expires_at<now()');
      await pool.query(`INSERT INTO social_oauth_flows(id,client_id,user_id,session_hash,state_hash,settings_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
      [id, client.id, user.id, user.session_hash, hash(state), hash(JSON.stringify(settings))]);
      return state;
    },
    async consume(state, user, settings) {
      check(/^[A-Za-z0-9_-]{43}$/.test(state || ''), 'oauth_state', 'Autorização inválida ou expirada.', 403);
      const r = await pool.query(`UPDATE social_oauth_flows SET consumed_at=now()
        WHERE state_hash=$1 AND user_id=$2 AND session_hash=$3 AND settings_hash=$4
          AND consumed_at IS NULL AND expires_at>now() RETURNING *`,
      [hash(state), user.id, user.session_hash, hash(JSON.stringify(settings))]);
      check(r.rowCount === 1, 'oauth_state', 'Autorização inválida, já utilizada ou expirada. Conecte novamente.', 403);
      return r.rows[0];
    },
    async candidates(flow, value) {
      await pool.query('UPDATE social_oauth_flows SET candidates=$1 WHERE id=$2 AND expires_at>now()', [vault.seal(value, flowContext(flow)), flow.id]);
    },
    async pending(id, client, user) {
      check(/^[a-f0-9-]{36}$/.test(id || ''), 'oauth_flow', 'Seleção expirada.', 404);
      const r = await pool.query(`SELECT * FROM social_oauth_flows WHERE id=$1 AND client_id=$2 AND user_id=$3
        AND session_hash=$4 AND expires_at>now() AND completed_at IS NULL AND candidates IS NOT NULL`,
      [id, client.id, user.id, user.session_hash]);
      check(r.rowCount === 1, 'oauth_flow', 'Seleção expirada. Conecte novamente.', 409);
      return {flow: r.rows[0], candidates: vault.open(r.rows[0].candidates, flowContext(r.rows[0]))};
    },
    async select({client, user, flow, candidates, page, networks}) {
      check(networks.length > 0 && networks.length <= 2 && new Set(networks).size === networks.length &&
        networks.every(n => ['instagram','facebook'].includes(n)), 'networks', 'Selecione as redes deste cliente.');
      check(!networks.includes('instagram') || page.instagram, 'instagram_missing', 'Esta Página não tem Instagram profissional vinculado.');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const claimed = await db.query(`UPDATE social_oauth_flows SET completed_at=now(),candidates=NULL
          WHERE id=$1 AND client_id=$2 AND user_id=$3 AND session_hash=$4 AND expires_at>now()
          AND completed_at IS NULL AND candidates IS NOT NULL RETURNING id`, [flow.id, client.id, user.id, user.session_hash]);
        check(claimed.rowCount === 1, 'oauth_replay', 'Esta seleção já foi utilizada ou expirou.', 409);
        for (const network of [...networks].sort()) {
          const account = network === 'instagram' ? page.instagram : page;
          const row = {client_id: client.id, network, account_id: account.id};
          const caps = capabilities(candidates.scopes, page.tasks, network);
          check(caps.read, 'permissions', 'Permissão de leitura da rede não autorizada.', 403);
          const result = await db.query(`INSERT INTO social_connections
            (id,client_id,network,account_id,account_name,page_id,app_id,auth_type,status,encrypted_token,scopes,capabilities,expires_at,connected_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,'facebook_login','connected',$8,$9,$10,$11,$12)
            ON CONFLICT(client_id,network) DO UPDATE SET account_id=EXCLUDED.account_id,account_name=EXCLUDED.account_name,
              page_id=EXCLUDED.page_id,app_id=EXCLUDED.app_id,auth_type='facebook_login',status='connected',
              encrypted_token=EXCLUDED.encrypted_token,scopes=EXCLUDED.scopes,capabilities=EXCLUDED.capabilities,
              expires_at=EXCLUDED.expires_at,connected_by=EXCLUDED.connected_by,updated_at=now()
            WHERE social_connections.status='disconnected' OR
              (social_connections.auth_type='facebook_login' AND social_connections.account_id=EXCLUDED.account_id)
            RETURNING id`, [crypto.randomUUID(), client.id, network, account.id, account.name, page.id, candidates.app_id,
            vault.seal({token: page.token}, tokenContext(row)), JSON.stringify(candidates.scopes), caps, candidates.expires_at, user.id]);
          check(result.rowCount === 1, 'connection_exists', 'Este cliente já tem outra conta vinculada. Desconecte-a antes de trocar.', 409);
          await db.query("INSERT INTO social_connection_events(client_id,actor_id,event,account_id) VALUES($1,$2,'connected',$3)", [client.id, user.id, account.id]);
        }
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        check(error.code !== '23505', 'account_in_use', 'Esta conta já está vinculada a outro cliente. Nenhuma conexão foi alterada.', 409);
        throw error;
      } finally { db.release(); }
    },
    async disconnect(id, client, user) {
      check(/^[a-f0-9-]{36}$/.test(id), 'not_found', 'Conexão não encontrada.', 404);
      const result = await pool.query(`WITH removed AS (
        UPDATE social_connections SET status='disconnected',encrypted_token=NULL,capabilities='{}',updated_at=now()
        WHERE id=$1 AND client_id=$2 AND auth_type='facebook_login' AND status='connected' RETURNING account_id
      ) INSERT INTO social_connection_events(client_id,actor_id,event,account_id)
        SELECT $2,$3,'disconnected',account_id FROM removed RETURNING id`, [id, client.id, user.id]);
      check(result.rowCount === 1, 'not_found', 'Conexão não encontrada ou protegida.', 404);
    }
  };
}
module.exports = {createRepository, flowContext, tokenContext};
