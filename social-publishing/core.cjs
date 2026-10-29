'use strict';
const crypto = require('node:crypto');
const {check} = require('../social-connections/security.cjs');

const NETWORKS = ['instagram', 'facebook'];

function stable(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const hash = value => crypto.createHash('sha256').update(stable(value)).digest('hex');

function text(value, limit, label) {
  check(typeof value === 'string' && !value.includes('\0'), 'invalid_text', `${label}: texto inválido.`);
  const result = value.replace(/\r\n/g, '\n').trim();
  check([...result].length <= limit, 'invalid_text', `${label}: limite de ${limit} caracteres excedido.`);
  return result;
}

function instagramCaption(value) {
  const result = text(value, 2200, 'Legenda do Instagram');
  const hashtags = result.match(/(?:^|[^\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu) || [];
  const mentions = result.match(/(?:^|[^A-Za-z0-9._])@[A-Za-z0-9._]+/g) || [];
  check(hashtags.length <= 30, 'invalid_text', 'Legenda do Instagram: use no máximo 30 hashtags.');
  check(mentions.length <= 20, 'invalid_text', 'Legenda do Instagram: use no máximo 20 menções.');
  return result;
}

function networks(value) {
  const result = Array.isArray(value) ? value : [];
  check(result.length > 0 && result.length <= 2 && new Set(result).size === result.length &&
    result.every(network => NETWORKS.includes(network)), 'invalid_networks', 'Escolha Instagram, Facebook ou ambos.');
  return NETWORKS.filter(network => result.includes(network));
}

function localSchedule(value, now = new Date()) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value),
    'invalid_schedule', 'Escolha uma data e hora de Brasília.');
  const date = new Date(value + ':00-03:00');
  check(Number.isFinite(date.getTime()), 'invalid_schedule', 'Data de publicação inválida.');
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date).replace(' ', 'T');
  check(formatted === value, 'invalid_schedule', 'Data inválida ou fora do horário de Brasília.');
  check(date.getTime() > now.getTime(), 'past_schedule', 'O horário escolhido já passou. Selecione um novo horário futuro.');
  check(date.getTime() <= now.getTime() + 366 * 24 * 60 * 60 * 1000,
    'schedule_too_far', 'Agende no máximo 12 meses à frente.');
  return date.toISOString();
}

function scheduleLocal(iso) {
  const date = new Date(iso);
  check(Number.isFinite(date.getTime()), 'invalid_schedule', 'Data de publicação inválida.');
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date).replace(' ', 'T');
}

function extractCaption(sourceText) {
  const source = String(sourceText || '').replace(/\r\n/g, '\n');
  const match = source.match(/(?:^|\n)[\t ]*LEGENDA(?:[\t ]*:[\t ]*)?[\t ]*\n([\s\S]+)$/i);
  return match ? match[1].trim() : '';
}

function normalizeCaptions(value, selectedNetworks) {
  const selected = networks(selectedNetworks);
  const captions = {
    instagram: instagramCaption(String(value?.instagram ?? '')),
    facebook: text(String(value?.facebook ?? ''), 4300, 'Legenda do Facebook')
  };
  for (const network of selected) check(captions[network].length > 0, 'caption_required', `Informe a legenda do ${network === 'instagram' ? 'Instagram' : 'Facebook'}.`);
  return captions;
}

function planFingerprint(plan) {
  return hash({
    post_id: plan.post_id,
    version: Number(plan.version),
    due_at: new Date(plan.due_at).toISOString(),
    networks: networks(plan.networks),
    captions: normalizeCaptions(plan.captions, plan.networks),
    source_digest: plan.source_digest,
    generation_id: plan.generation_id
  });
}

function snapshot(plan, source, connections) {
  check(plan.source_digest === source.source_digest && plan.generation_id === source.generation_id,
    'source_changed', 'As artes ou o conteúdo mudaram. Revise o lote novamente.', 409);
  const selectedNetworks = networks(plan.networks);
  const captions = normalizeCaptions(plan.captions, selectedNetworks);
  check(source.assets.length > 0, 'media_required', 'O post não possui artes JPG concluídas.');
  check(source.assets.length <= 10, 'carousel_limit', `O post possui ${source.assets.length} artes. A publicação aceita no máximo 10; nenhuma arte foi descartada.`, 409);
  if (selectedNetworks.includes('instagram')) {
    check(source.assets.every(asset => Number.isInteger(asset.width) && Number.isInteger(asset.height) &&
      asset.width > 0 && asset.height > 0 && asset.width * 5 >= asset.height * 4 &&
      asset.width * 100 <= asset.height * 191),
    'instagram_aspect_ratio', 'As artes do Instagram precisam ter proporção entre 4:5 e 1,91:1.', 409);
  }
  const dueAt = new Date(plan.due_at);
  check(Number.isFinite(dueAt.getTime()) && dueAt.getTime() > Date.now(), 'past_schedule', 'A publicação precisa estar no futuro.');
  const accounts = {};
  for (const network of selectedNetworks) {
    const connection = connections.find(row => row.network === network && row.status === 'connected');
    check(connection && connection.capabilities?.publish === true, 'connection_unavailable',
      `${network === 'instagram' ? 'Instagram' : 'Facebook'} ainda não está conectado com permissão de publicação.`, 409);
    check(!connection.expires_at || new Date(connection.expires_at).getTime() > Date.now(),
      'connection_expired', `A autorização do ${network === 'instagram' ? 'Instagram' : 'Facebook'} expirou.`, 409);
    accounts[network] = {connection_id: connection.id, account_id: connection.account_id};
  }
  const value = {
    schema_version: 1,
    client_id: source.client_id,
    client_slug: source.client_slug,
    post_id: plan.post_id,
    title: source.title,
    generation_id: source.generation_id,
    source_digest: source.source_digest,
    due_at: dueAt.toISOString(),
    networks: selectedNetworks,
    captions,
    accounts,
    assets: source.assets.map(asset => ({
      id: asset.id, file: asset.file, label: asset.label, sha256: asset.sha256,
      mime: asset.mime, bytes: asset.bytes, width: asset.width, height: asset.height,
      alt_text: asset.alt_text || ''
    }))
  };
  return {...value, fingerprint: hash(value)};
}

module.exports = {
  NETWORKS, stable, hash, text, instagramCaption, networks, localSchedule, scheduleLocal,
  extractCaption, normalizeCaptions, planFingerprint, snapshot
};
