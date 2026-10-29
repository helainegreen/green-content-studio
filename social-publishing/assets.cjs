'use strict';
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {constants} = require('node:fs');
const {check} = require('../social-connections/security.cjs');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function mediaKeyFromFile(file) {
  check(file && syncFs.existsSync(file), 'media_key', 'Chave de mídia indisponível.', 503);
  const stat = syncFs.lstatSync(file);
  check(stat.isFile() && !(stat.mode & 0o077), 'media_key', 'A chave de mídia precisa de acesso restrito.', 503);
  const raw = syncFs.readFileSync(file, 'utf8').trim();
  check(/^[a-f0-9]{64}$/.test(raw), 'media_key', 'Chave de mídia indisponível.', 503);
  return crypto.createHmac('sha256', Buffer.from(raw, 'hex')).update('green-content-studio:publication-media:v1').digest();
}

function createAssets({directory, origin, keyFile, clock = () => Date.now()}) {
  check(path.isAbsolute(directory || ''), 'media_configuration', 'Diretório de mídia inválido.', 503);
  const parsedOrigin = new URL(origin || '');
  check(parsedOrigin.protocol === 'https:' && parsedOrigin.origin === origin,
    'media_configuration', 'Origem pública de mídia inválida.', 503);
  const key = mediaKeyFromFile(keyFile);
  const sign = (hash, expires) => crypto.createHmac('sha256', key).update(hash + '\n' + expires).digest('hex');
  const target = hash => {
    check(/^[a-f0-9]{64}$/.test(hash || ''), 'invalid_asset', 'Imagem inválida.');
    return path.join(directory, hash + '.jpg');
  };

  async function read(hash) {
    const handle = await fs.open(target(hash), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      check(stat.isFile() && stat.size > 0 && stat.size <= 8_000_000,
        'invalid_media', 'Imagem congelada indisponível.', 503);
      const bytes = await handle.readFile();
      check(sha256(bytes) === hash, 'corrupt_media', 'A imagem congelada mudou.', 503);
      return bytes;
    } finally {
      await handle.close();
    }
  }

  async function freeze(source) {
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const space = await fs.statfs(directory);
    const required = source.assets.reduce((total, asset) => total + Number(asset.bytes || 0), 0);
    check(space.bavail * space.bsize > 2 * 1024 * 1024 * 1024 + required,
      'media_storage_full', 'O armazenamento precisa de espaço antes de confirmar o lote.', 503);
    for (const asset of source.assets) {
      const bytes = asset.content;
      check(Buffer.isBuffer(bytes) && bytes.length === asset.bytes && sha256(bytes) === asset.sha256 &&
        bytes[0] === 255 && bytes[1] === 216, 'source_changed', 'Uma arte mudou durante a confirmação.', 409);
      let handle;
      try {
        handle = await fs.open(target(asset.sha256),
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        await handle?.close();
      }
      await read(asset.sha256);
    }
  }

  async function url(hash) {
    await read(hash);
    const expires = String(Math.floor(clock() / 1000) + 86400);
    return `${origin}/social-publications/media/${hash}.jpg?expires=${expires}&sig=${sign(hash, expires)}`;
  }

  async function handle(req, res, urlValue) {
    if (!urlValue.pathname.startsWith('/social-publications/media/')) return false;
    try {
      const match = urlValue.pathname.match(/^\/social-publications\/media\/([a-f0-9]{64})\.jpg$/);
      const expires = urlValue.searchParams.get('expires');
      const signature = urlValue.searchParams.get('sig');
      const seconds = Math.floor(clock() / 1000);
      check(['GET','HEAD'].includes(req.method) && match && /^\d{10}$/.test(expires || '') &&
        /^[a-f0-9]{64}$/.test(signature || '') && [...urlValue.searchParams].length === 2 &&
        Number(expires) > seconds && Number(expires) <= seconds + 86400,
      'invalid_media_link', 'Link de mídia indisponível.', 404);
      const expected = sign(match[1], expires);
      check(signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
        'invalid_media_link', 'Link de mídia indisponível.', 404);
      const bytes = await read(match[1]);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg', 'Content-Length': bytes.length,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      res.writeHead(404, {'Cache-Control': 'no-store'});
      res.end('Imagem indisponível');
    }
    return true;
  }

  return {freeze, read, url, handle};
}

module.exports = {createAssets, mediaKeyFromFile};
