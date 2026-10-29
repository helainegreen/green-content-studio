'use strict';
const crypto = require('node:crypto');
const {check, SocialError} = require('./security.cjs');
const ID = /^\d{1,40}$/;
const BASE = ['pages_show_list','pages_read_engagement'];
const PERMISSIONS = {
  facebook: {read: BASE, publish: [...BASE, 'pages_manage_posts'], insights: [...BASE, 'read_insights']},
  instagram: {read: [...BASE, 'instagram_basic'], publish: [...BASE, 'instagram_basic','instagram_content_publish'],
    insights: [...BASE, 'instagram_basic','instagram_manage_insights']}
};
const INSIGHT_METRICS = {
  facebook: [
    ['page_media_view', 'Visualizacoes de conteudo'],
    ['page_post_engagements', 'Engajamentos'],
    ['page_follows', 'Novos seguidores']
  ],
  instagram: [
    ['reach', 'Contas alcancadas'],
    ['total_interactions', 'Interacoes'],
    ['views', 'Visualizacoes']
  ]
};
function validateSettings(value) {
  check(ID.test(value.app_id || '') && ID.test(value.config_id || ''), 'settings', 'Informe App ID e Configuration ID válidos.');
  check(/^[a-f0-9]{32}$/i.test(value.app_secret || ''), 'settings', 'Informe o App Secret válido.');
  check(/^v\d{2}\.0$/.test(value.version || ''), 'settings', 'Informe a versão da Graph API, por exemplo v26.0.');
  return {app_id: value.app_id, app_secret: value.app_secret, config_id: value.config_id, version: value.version};
}
function capabilities(scopes, tasks, network) {
  const granted = new Set(scopes), required = PERMISSIONS[network];
  const content = tasks.some(t => ['MANAGE','CREATE_CONTENT','PROFILE_PLUS_FULL_CONTROL','PROFILE_PLUS_CREATE_CONTENT'].includes(t));
  const analytics = content || tasks.some(t => ['ANALYZE','PROFILE_PLUS_ANALYZE'].includes(t));
  return {read: required.read.every(s => granted.has(s)), publish: content && required.publish.every(s => granted.has(s)),
    insights: analytics && required.insights.every(s => granted.has(s)),
    missing: [...new Set([...required.publish, ...required.insights])].filter(s => !granted.has(s))};
}
function createMeta(settings, {origin, fetchImpl = fetch, now = () => Date.now()}) {
  validateSettings(settings);
  const callback = origin + '/integrations/meta/callback';
  const proof = token => crypto.createHmac('sha256', settings.app_secret).update(token).digest('hex');
  async function get(endpoint, params, token) {
    const url = new URL(`https://graph.facebook.com/${settings.version}/${endpoint}`);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
    if (token) url.searchParams.set('appsecret_proof', proof(token));
    try {
      const response = await fetchImpl(url.href, {headers: token ? {Authorization: 'Bearer ' + token} : {},
        redirect: 'error', signal: AbortSignal.timeout(20000)});
      const raw = await response.text();
      if (raw.length > 2_000_000) throw Error('size');
      const value = JSON.parse(raw);
      if (!response.ok || value.error) throw Error('meta_error');
      return value;
    } catch { throw new SocialError('meta_unavailable', 'Não foi possível confirmar a autorização na Meta. Tente conectar novamente.', 502); }
  }
  async function debug(token) {
    const result = await get('debug_token', {input_token: token}, settings.app_id + '|' + settings.app_secret);
    const d = result.data;
    check(d?.is_valid === true && String(d.app_id) === settings.app_id, 'meta_identity', 'A Meta não confirmou a credencial deste aplicativo.', 403);
    for (const key of ['expires_at','data_access_expires_at']) {
      check(d[key] === undefined || d[key] === 0 || (Number.isFinite(d[key]) && d[key] > now() / 1000), 'meta_expired', 'A autorização expirou. Conecte novamente.', 403);
    }
    return d;
  }
  async function paged(endpoint, params, token, maximumPages = 10) {
    const values = [];
    let cursor;
    for (let index = 0; index < maximumPages; index++) {
      const data = await get(endpoint, {...params, ...(cursor ? {after: cursor} : {})}, token);
      check(Array.isArray(data.data), 'meta_collection', 'Resposta da Meta invalida.', 502);
      values.push(...data.data);
      if (!data.paging?.next) return values;
      check(typeof data.paging?.cursors?.after === 'string' && data.paging.cursors.after !== cursor,
        'meta_collection_limit', 'Ha muitos ativos nesta autorizacao. Revise o acesso na Meta.', 409);
      cursor = data.paging.cursors.after;
    }
    throw new SocialError('meta_collection_limit', 'Ha muitos ativos nesta autorizacao. Revise o acesso na Meta.', 409);
  }
  function metricValue(data) {
    const item = Array.isArray(data?.data) ? data.data[0] : null;
    const total = item?.total_value?.value;
    if (Number.isFinite(total) && total >= 0) return total;
    if (!Array.isArray(item?.values)) return null;
    const values = item.values.map(entry => entry?.value).filter(value => Number.isFinite(value) && value >= 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  return {
    authorize(state) {
      const url = new URL(`https://www.facebook.com/${settings.version}/dialog/oauth`);
      for (const [key, value] of Object.entries({client_id: settings.app_id, config_id: settings.config_id,
        redirect_uri: callback, state, response_type: 'code'})) url.searchParams.set(key, value);
      return url.href;
    },
    async exchange(code) {
      check(typeof code === 'string' && code.length > 0 && code.length <= 8192 && !/[\r\n]/.test(code), 'oauth_code', 'Código de autorização inválido.');
      const short = await get('oauth/access_token', {client_id: settings.app_id, client_secret: settings.app_secret,
        redirect_uri: callback, code});
      check(typeof short.access_token === 'string' && short.access_token.length >= 20, 'oauth_token', 'A Meta não retornou uma autorização válida.', 502);
      const initial = await debug(short.access_token);
      check(initial.type === 'USER', 'oauth_type', 'Configure o Login for Business para User Access Token.', 409);
      const long = await get('oauth/access_token', {client_id: settings.app_id, client_secret: settings.app_secret,
        grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token});
      check(typeof long.access_token === 'string' && long.access_token.length >= 20, 'oauth_token', 'A Meta não retornou uma autorização válida.', 502);
      const details = await debug(long.access_token);
      check(details.user_id === initial.user_id, 'oauth_identity', 'A identidade da autorização mudou.', 403);
      const scopes = Array.isArray(details.scopes) ? details.scopes : [];
      check(BASE.every(s => scopes.includes(s)), 'oauth_permissions', 'A Meta não liberou a leitura das Páginas. Revise as permissões e conecte novamente.', 403);
      const pages = [], pageById = new Map();
      const fields = 'id,name,access_token,tasks' + (scopes.includes('instagram_basic') ? ',instagram_business_account{id,username}' : '');
      function addPage(page, business = null) {
        if (!ID.test(page?.id || '') || typeof page?.access_token !== 'string' || page.access_token.length < 20) return;
        const existing = pageById.get(page.id);
        if (existing) {
          if (business && !existing.businesses.some(item => item.id === business.id)) existing.businesses.push(business);
          return;
        }
        const value = {id: page.id, name: String(page.name || page.id).slice(0,300), token: page.access_token,
          tasks: Array.isArray(page.tasks) ? page.tasks : [], businesses: business ? [business] : [],
          instagram: ID.test(page.instagram_business_account?.id || '') ? {id: page.instagram_business_account.id,
            name: String(page.instagram_business_account.username || page.instagram_business_account.id).slice(0,300)} : null};
        pageById.set(value.id, value); pages.push(value);
      }
      for (const page of await paged('me/accounts', {fields, limit: 25}, long.access_token)) addPage(page);
      if (scopes.includes('business_management')) {
        const businesses = await paged('me/businesses', {fields: 'id,name', limit: 25}, long.access_token, 4);
        for (const item of businesses) {
          if (!ID.test(item?.id || '')) continue;
          const business = {id: item.id, name: String(item.name || item.id).slice(0,300)};
          for (const edge of ['owned_pages','client_pages']) {
            try {
              for (const page of await paged(item.id + '/' + edge, {fields, limit: 100}, long.access_token, 4)) {
                addPage(page, business);
              }
            } catch (error) {
              if (error?.code === 'meta_collection_limit') throw error;
              // A portfolio may not expose both page edges to the current person.
            }
          }
        }
      }
      check(pages.length, 'oauth_no_pages', scopes.includes('business_management')
        ? 'Nenhuma Página acessível foi encontrada nos seus portfólios empresariais.'
        : 'Nenhuma Página foi autorizada. Permita o acesso aos portfólios empresariais e conecte novamente.', 409);
      const expirations = [details.expires_at, details.data_access_expires_at].filter(x => x > 0);
      return {pages, scopes, user_id: String(details.user_id), app_id: settings.app_id,
        expires_at: expirations.length ? new Date(Math.min(...expirations) * 1000).toISOString() : null};
    },
    async verifyPage(page) {
      const info = await debug(page.token);
      const me = await get('me', {fields: 'id'}, page.token);
      check(me.id === page.id && info.type === 'PAGE', 'page_identity', 'A credencial retornada não pertence à Página selecionada.', 403);
      if (page.instagram) {
        const current = await get(page.id, {fields: 'instagram_business_account'}, page.token);
        check(current.instagram_business_account?.id === page.instagram.id, 'instagram_identity', 'O vínculo da Página com o Instagram mudou. Reconecte.', 409);
      }
      check(Array.isArray(info.scopes), 'page_permissions', 'Não foi possível confirmar as permissões da Página.', 502);
      const limits = [info.expires_at, info.data_access_expires_at].filter(x => x > 0);
      return {scopes: info.scopes, expires_at: limits.length ? new Date(Math.min(...limits) * 1000).toISOString() : null};
    },
    async insights(connection) {
      check(['instagram','facebook'].includes(connection?.network), 'insights_network', 'Rede de estatisticas invalida.');
      check(ID.test(connection?.account_id || '') && typeof connection?.token === 'string' && connection.token.length >= 20,
        'insights_connection', 'Reconecte a conta Meta.', 409);
      const end = Math.floor(now() / 1000), start = end - (30 * 24 * 60 * 60);
      const profileFields = connection.network === 'instagram'
        ? 'id,username,followers_count,media_count'
        : 'id,name,followers_count,fan_count';
      const profile = await get(connection.account_id, {fields: profileFields}, connection.token);
      check(String(profile.id) === connection.account_id, 'insights_identity', 'A Meta retornou outra conta.', 502);
      const metrics = [];
      const followers = Number.isFinite(profile.followers_count) ? profile.followers_count : profile.fan_count;
      if (Number.isFinite(followers) && followers >= 0) {
        metrics.push({key: 'followers', label: 'Seguidores atuais', value: followers, detail: 'Total atual'});
      }
      for (const [metric, label] of INSIGHT_METRICS[connection.network]) {
        try {
          const params = {metric, period: 'day', since: start, until: end};
          if (connection.network === 'instagram') params.metric_type = 'total_value';
          const value = metricValue(await get(connection.account_id + '/insights', params, connection.token));
          if (value !== null) metrics.push({key: metric, label, value, detail: 'Ultimos 30 dias'});
        } catch {
          // Metrics vary by account type and are intentionally omitted when unavailable.
        }
      }
      check(metrics.some(item => item.key !== 'followers'), 'insights_unavailable',
        'A Meta ainda nao retornou estatisticas para esta conta.', 502);
      return {
        network: connection.network,
        account: {id: connection.account_id, name: String(profile.username || profile.name || connection.account_name || '').slice(0, 300)},
        range: {since: new Date(start * 1000).toISOString(), until: new Date(end * 1000).toISOString()},
        metrics
      };
    }
  };
}
module.exports = {createMeta, validateSettings, capabilities, PERMISSIONS, INSIGHT_METRICS};
