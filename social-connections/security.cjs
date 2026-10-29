'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
class SocialError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function check(value, code, message, status) { if (!value) throw new SocialError(code, message, status); }
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function requireSameOrigin(req, expected) {
  const headers = req?.headers || {};
  const fetchSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  check(!fetchSite || fetchSite === 'same-origin', 'origin', 'Origem da solicitação inválida.', 403);
  if (headers.origin) {
    check(headers.origin === expected, 'origin', 'Origem da solicitação inválida.', 403);
    return;
  }
  if (headers.referer) {
    let referer;
    try { referer = new URL(headers.referer); } catch { referer = null; }
    check(referer?.origin === expected, 'origin', 'Origem da solicitação inválida.', 403);
    return;
  }
  check(fetchSite === 'same-origin' && headers['sec-fetch-mode'] === 'navigate' && headers['sec-fetch-dest'] === 'document',
    'origin', 'Origem da solicitação inválida.', 403);
}
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function createVault(key) {
  check(Buffer.isBuffer(key) && key.length === 32, 'vault_key', 'Cofre indisponível.', 503);
  return {
    seal(value, context) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return {v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')};
    },
    open(value, context) {
      try {
        check(value?.v === 1, 'vault_version', 'Cofre indisponível.', 503);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
        decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8'));
      } catch { throw new SocialError('vault_integrity', 'Não foi possível abrir esta conexão. Contate a administração.', 503); }
    },
    csrf(user, action, now = Date.now()) {
      const expires = String(Math.floor(now / 1000) + 3600);
      const sig = crypto.createHmac('sha256', key).update(JSON.stringify([user.id, user.session_hash, action, expires])).digest('hex');
      return expires + '.' + sig;
    },
    verifyCsrf(token, user, action, now = Date.now()) {
      const [expires, sig, extra] = String(token || '').split('.');
      check(!extra && /^\d{10}$/.test(expires) && Number(expires) > now / 1000 && Number(expires) <= now / 1000 + 3601,
        'csrf', 'A página expirou. Atualize e tente novamente.', 403);
      const expected = crypto.createHmac('sha256', key).update(JSON.stringify([user.id, user.session_hash, action, expires])).digest('hex');
      check(equal(sig, expected), 'csrf', 'A página expirou. Atualize e tente novamente.', 403);
    }
  };
}
function vaultFromFile(file) {
  check(file && fs.existsSync(file), 'vault_key', 'Cofre indisponível.', 503);
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !(stat.mode & 0o077), 'vault_permissions', 'A chave do cofre precisa de acesso restrito.', 503);
  const raw = fs.readFileSync(file, 'utf8').trim();
  check(/^[a-f0-9]{64}$/.test(raw), 'vault_key', 'Cofre indisponível.', 503);
  return createVault(Buffer.from(raw, 'hex'));
}
module.exports = {SocialError, check, hash, equal, requireSameOrigin, createVault, vaultFromFile};
