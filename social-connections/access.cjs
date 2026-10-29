'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {check} = require('./security.cjs');
const READ = new Set(['GET','HEAD']);
function createAccess(pool, {uploadRoot}) {
  return {
    async hydrate(user) {
      const masters = await pool.query('SELECT user_id FROM social_master_users WHERE user_id=$1', [user.id]);
      const master = masters.rowCount > 0;
      const clients = await pool.query(`SELECT c.id,c.slug,c.name,m.role FROM clients c
        LEFT JOIN social_client_members m ON m.client_id=c.id AND m.user_id=$1
        WHERE c.status='active' AND ($2::boolean OR m.user_id IS NOT NULL) ORDER BY c.name`, [user.id, master]);
      return {...user, is_master: master, nav_clients: clients.rows};
    },
    async client(user, slug, action = 'read') {
      const result = await pool.query(`SELECT c.*,m.role AS member_role FROM clients c
        LEFT JOIN social_client_members m ON m.client_id=c.id AND m.user_id=$1
        WHERE c.slug=$2 AND c.status='active'`, [user.id, slug]);
      const client = result.rows[0];
      check(client && (user.is_master || client.member_role), 'not_found', 'Cliente não encontrado.', 404);
      check(user.is_master || action === 'read' || (action === 'write' && client.member_role !== 'viewer') ||
        (action === 'connect' && client.member_role === 'owner'), 'forbidden', 'Seu acesso não permite esta alteração.', 403);
      return client;
    },
    async guard(req, user, url) {
      const clientMatch = url.pathname.match(/^\/clients\/([^/]+)(?:\/|$)/);
      const postMatch = url.pathname.match(/^\/posts\/([^/]+)(?:\/|$)/);
      const action = READ.has(req.method) ? 'read' : 'write';
      if (clientMatch) {
        const client = await this.client(user, clientMatch[1], action);
        const bulk = url.pathname.match(/^\/clients\/[^/]+\/bulk-docx\/result\/([^/]+)/);
        if (bulk) {
          check(/^[a-f0-9-]{36}$/.test(bulk[1]), 'not_found', 'Lote não encontrado.', 404);
          let result;
          try { result = JSON.parse(await fs.readFile(path.join(uploadRoot, 'bulk-results', bulk[1] + '.json'), 'utf8')); }
          catch { check(false, 'not_found', 'Lote não encontrado.', 404); }
          check(result.client?.id === client.id, 'not_found', 'Lote não encontrado.', 404);
          const ids = (result.created || []).map(item => item.id);
          if (ids.length) {
            const foreign = await pool.query('SELECT id FROM posts WHERE id=ANY($1::text[]) AND client_id<>$2 LIMIT 1', [ids, client.id]);
            check(!foreign.rowCount, 'invalid_batch', 'Lote inconsistente. Contate a administração.', 409);
          }
        }
      } else if (postMatch) {
        const result = await pool.query('SELECT c.slug FROM posts p JOIN clients c ON c.id=p.client_id WHERE p.id=$1', [postMatch[1]]);
        check(result.rows[0], 'not_found', 'Post não encontrado.', 404);
        await this.client(user, result.rows[0].slug, action);
      } else if (!user.is_master && !['/', '/dashboard', '/integrations/meta/callback'].includes(url.pathname)) {
        // Unknown legacy routes remain master-only until their ownership is audited.
        check(false, 'not_found', 'Página não encontrada.', 404);
      }
    }
  };
}
module.exports = {createAccess};
