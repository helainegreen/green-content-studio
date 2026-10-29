'use strict';
// Transport only. Every write must be journaled by the durable executor before
// it reaches this module. A timed-out write is uncertain and is never retried.
const crypto = require('node:crypto');
const {check} = require('../social-connections/security.cjs');

const ID = /^\d{1,40}$/;
const POST_ID = /^\d{1,40}(?:_\d{1,40})?$/;

class MetaError extends Error {
  constructor(kind, status = 0, code = null, subcode = null) {
    super(kind === 'uncertain'
      ? 'A Meta pode ter recebido a operação. Verifique antes de tentar novamente.'
      : 'Não foi possível concluir a operação na Meta.');
    this.name = 'MetaError';
    this.kind = kind;
    this.http_status = status;
    this.meta_code = code;
    this.meta_subcode = subcode;
  }
}

function numeric(value) {
  check(typeof value === 'string' && ID.test(value), 'invalid_meta_id', 'Identificação da Meta inválida.');
  return value;
}

function safeText(value, maximum) {
  check(typeof value === 'string' && !value.includes('\0') && [...value].length <= maximum,
    'invalid_meta_text', 'Texto da publicação inválido.');
  return value;
}

function safeInstagramCaption(value) {
  const caption = safeText(value, 2200);
  const hashtags = caption.match(/(?:^|[^\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu) || [];
  const mentions = caption.match(/(?:^|[^A-Za-z0-9._])@[A-Za-z0-9._]+/g) || [];
  check(hashtags.length <= 30 && mentions.length <= 20,
    'invalid_meta_text', 'Legenda do Instagram fora dos limites permitidos.');
  return caption;
}

function createMeta({network, accountId, tokenProvider, appSecret, version = 'v26.0', mediaOrigin,
  fetchImpl = fetch, writesEnabled = false, timeoutMs = 25_000}) {
  check(['instagram','facebook'].includes(network), 'invalid_network', 'Rede inválida.');
  numeric(accountId);
  check(/^v\d{2}\.0$/.test(version), 'invalid_meta_version', 'Versão da Graph API inválida.');
  check(/^[a-f0-9]{32}$/i.test(appSecret || ''), 'invalid_app_secret', 'Configuração Meta indisponível.', 503);
  const origin = new URL(mediaOrigin || '');
  check(origin.protocol === 'https:' && origin.origin === mediaOrigin,
    'invalid_media_origin', 'Origem das imagens inválida.', 503);

  function imageUrl(value) {
    let url;
    try { url = new URL(value); } catch {}
    check(url && url.origin === mediaOrigin && !url.username && !url.password && !url.hash &&
      /^\/social-publications\/media\/[a-f0-9]{64}\.jpg$/.test(url.pathname),
    'invalid_media_url', 'Use somente uma imagem congelada deste agendamento.');
    check(/^\d{10}$/.test(url.searchParams.get('expires') || '') &&
      /^[a-f0-9]{64}$/.test(url.searchParams.get('sig') || '') && [...url.searchParams].length === 2,
    'invalid_media_signature', 'Link da imagem inválido.');
    return url.href;
  }

  async function request(method, endpoint, params = {}) {
    if (method === 'POST') check(writesEnabled, 'publishing_disabled', 'A publicação real está desativada.', 412);
    const token = await tokenProvider();
    check(typeof token === 'string' && token.length >= 20 && !/[\r\n]/.test(token),
      'token_unavailable', 'Reconecte a conta Meta.', 503);
    const proof = crypto.createHmac('sha256', appSecret).update(token).digest('hex');
    const url = new URL(`https://graph.facebook.com/${version}/${endpoint}`);
    const headers = {Authorization: 'Bearer ' + token, Accept: 'application/json'};
    const values = {...params, appsecret_proof: proof};
    let body;
    if (method === 'GET') {
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
    }
    let response;
    let data;
    try {
      response = await fetchImpl(url.href, {method, headers, body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)});
      const raw = await response.text();
      if (raw.length > 128_000) throw Error('response_too_large');
      data = JSON.parse(raw);
    } catch {
      throw new MetaError(method === 'POST' ? 'uncertain' : 'unavailable', response?.status || 0);
    }
    if (!response.ok || data.error) {
      const error = data.error || {};
      const rejected = response.status >= 400 && response.status < 500 && Number.isInteger(error.code);
      throw new MetaError(method === 'POST' && !rejected ? 'uncertain' : 'rejected', response.status,
        Number.isInteger(error.code) ? error.code : null,
        Number.isInteger(error.error_subcode) ? error.error_subcode : null);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new MetaError(method === 'POST' ? 'uncertain' : 'unavailable', response.status);
    }
    return data;
  }

  async function write(endpoint, params, pattern = ID) {
    const data = await request('POST', endpoint, params);
    if (typeof data.id !== 'string' || !pattern.test(data.id)) throw new MetaError('uncertain', 200);
    return {id: data.id};
  }

  return {
    async identity() {
      const fields = network === 'instagram' ? 'id,username' : 'id,name,can_post';
      const data = await request('GET', accountId, {fields});
      check(String(data.id) === accountId, 'wrong_account', 'A credencial pertence a outra conta Meta.', 412);
      if (network !== 'instagram') {
        check(data.can_post === true, 'page_cannot_publish', 'A Página não permite publicação com esta credencial.', 412);
      }
      return {id: accountId, name: network === 'instagram' ? data.username : data.name};
    },
    async quota() {
      check(network === 'instagram', 'wrong_network', 'Limite disponível apenas para Instagram.');
      const data = await request('GET', accountId + '/content_publishing_limit', {fields: 'config,quota_usage'});
      const quota = data.data?.[0];
      check(Number.isInteger(quota?.quota_usage) && Number.isInteger(quota?.config?.quota_total) && quota.config.quota_total > 0,
        'quota_unavailable', 'Não foi possível verificar o limite de publicação.', 503);
      return {used: quota.quota_usage, total: quota.config.quota_total};
    },
    createImage({url, caption = '', altText = '', carouselItem = false}) {
      check(network === 'instagram', 'wrong_network', 'Operação exclusiva do Instagram.');
      const params = {image_url: imageUrl(url), alt_text: safeText(altText, 1000)};
      if (carouselItem) params.is_carousel_item = 'true';
      else {
        params.caption = safeInstagramCaption(caption);
        params.is_ai_generated = 'true';
      }
      return write(accountId + '/media', params);
    },
    createCarousel({children, caption = ''}) {
      check(network === 'instagram', 'wrong_network', 'Operação exclusiva do Instagram.');
      check(Array.isArray(children) && children.length >= 2 && children.length <= 10 &&
        new Set(children).size === children.length, 'invalid_children', 'Carrossel inválido.');
      return write(accountId + '/media', {
        media_type: 'CAROUSEL', children: children.map(numeric).join(','),
        caption: safeInstagramCaption(caption), is_ai_generated: 'true'
      });
    },
    async containerStatus(id) {
      check(network === 'instagram', 'wrong_network', 'Operação exclusiva do Instagram.');
      const data = await request('GET', numeric(id), {fields: 'status_code'});
      check(['IN_PROGRESS','FINISHED','PUBLISHED','ERROR','EXPIRED'].includes(data.status_code),
        'unknown_container_status', 'Estado da mídia desconhecido.', 503);
      return {id, status: data.status_code};
    },
    publishContainer(id) {
      check(network === 'instagram', 'wrong_network', 'Operação exclusiva do Instagram.');
      return write(accountId + '/media_publish', {creation_id: numeric(id)});
    },
    uploadPhoto({url, altText = ''}) {
      check(network === 'facebook', 'wrong_network', 'Operação exclusiva do Facebook.');
      return write(accountId + '/photos', {url: imageUrl(url), published: 'false', alt_text_custom: safeText(altText, 1000)});
    },
    publishPhotos({photos, caption = ''}) {
      check(network === 'facebook', 'wrong_network', 'Operação exclusiva do Facebook.');
      check(Array.isArray(photos) && photos.length > 0 && photos.length <= 10 &&
        new Set(photos).size === photos.length, 'invalid_photos', 'Seleção de imagens inválida.');
      const params = {message: safeText(caption, 4300), published: 'true'};
      photos.forEach((id, index) => { params[`attached_media[${index}]`] = JSON.stringify({media_fbid: numeric(id)}); });
      return write(accountId + '/feed', params, POST_ID);
    },
    async publishedResult(id) {
      check(typeof id === 'string' && (network === 'instagram' ? ID : POST_ID).test(id),
        'invalid_meta_id', 'Identificação da publicação inválida.');
      const data = await request('GET', id, {fields: network === 'instagram' ? 'id,permalink' : 'id,permalink_url,is_published'});
      check(data.id === id, 'wrong_result', 'A Meta retornou outra publicação.', 503);
      const value = network === 'instagram' ? data.permalink : data.permalink_url;
      let link;
      try { link = new URL(value); } catch {}
      const domains = network === 'instagram' ? ['www.instagram.com','instagram.com'] : ['www.facebook.com','facebook.com'];
      check(link?.protocol === 'https:' && domains.includes(link.hostname) && !link.username && !link.password,
        'invalid_permalink', 'O link da publicação ainda não foi confirmado.', 503);
      if (network === 'facebook') check(data.is_published === true, 'not_published', 'A publicação ainda não foi confirmada.', 503);
      return {id, url: link.href};
    }
  };
}

module.exports = {createMeta, MetaError};
