'use strict';
const {createAccess} = require('./access.cjs');
const {createRepository} = require('./repository.cjs');
const {vaultFromFile, check, SocialError, hash, requireSameOrigin} = require('./security.cjs');
const {createMeta, validateSettings, capabilities} = require('./meta.cjs');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const networkName = n => n === 'instagram' ? 'Instagram' : 'Facebook';
const styles = `<style>
main:has(.social-page){width:calc(100% - 36px);max-width:1180px}
.social-page{max-width:1000px;margin:auto}.social-heading{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:24px}
.social-heading h1{font-size:26px;margin:0}.social-heading p{margin:6px 0 0;color:#59656a}
.social-rows{border-top:1px solid #dbe1df}.social-row{display:grid;grid-template-columns:150px minmax(0,1fr) auto;gap:24px;align-items:center;padding:24px 0;border-bottom:1px solid #dbe1df}
.social-row h2{font-size:18px;margin:0}.social-row p{margin:5px 0;overflow-wrap:anywhere}.social-state{color:#52635a;font-size:14px}.social-warning{color:#905215}.social-note{padding:14px 0;color:#52615b;font-size:14px}
.social-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.social-page fieldset{border:0;padding:0;margin:20px 0}.social-page legend{font-weight:600;margin-bottom:10px}
.social-page button:disabled{opacity:.5;cursor:not-allowed}
.social-choice{display:flex!important;gap:10px;align-items:flex-start;margin:12px 0!important}.social-choice input{width:auto!important;margin-top:5px}.social-choice span{min-width:0;overflow-wrap:anywhere}
.social-form{max-width:640px}.social-form label{display:block;margin:16px 0 8px}.social-form input{width:100%;box-sizing:border-box}.social-page code{overflow-wrap:anywhere;white-space:normal}
.insights-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:#dbe1df;border:1px solid #dbe1df;margin:24px 0}.insight-card{background:#fff;padding:22px;min-height:112px}.insight-card strong{display:block;font-size:28px;line-height:1.1}.insight-card span{display:block;margin-top:9px;font-size:14px;color:#52615b}.insight-card small{display:block;margin-top:5px;color:#748078}
@media(max-width:640px){.social-row{grid-template-columns:1fr;gap:10px}.social-heading h1{font-size:24px}.social-actions .btn{max-width:100%;white-space:normal}}
</style>`;
async function form(req) {
  check((req.headers['content-type'] || '').split(';')[0] === 'application/x-www-form-urlencoded', 'content_type', 'Formato inválido.', 415);
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; check(bytes <= 16384, 'body_size', 'Formulário muito grande.', 413); chunks.push(chunk); }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
function createSocialConnections({pool, layout, uploadRoot, env = process.env, vault, fetchImpl, metaFactory = createMeta}) {
  if (env.GCS_SOCIAL_ENABLED !== 'true') return {enabled: false, hydrate: async u => u, guard: async () => {}, handle: async () => false, link: () => '', settingsLink: () => ''};
  const enabledClients = new Set(String(env.GCS_SOCIAL_CONNECTION_CLIENTS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
  const statisticsClients = new Set(String(env.GCS_SOCIAL_STATISTICS_CLIENTS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
  const publicLoginEnabled = env.GCS_META_PUBLIC_LOGIN_ENABLED === 'true';
  check(enabledClients.size > 0 && [...enabledClients].every(value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)),
    'connection_clients', 'Configure os clientes habilitados para conexão.', 503);
  const parsedOrigin = new URL(env.GCS_SOCIAL_ORIGIN || '');
  check(parsedOrigin.protocol === 'https:' && parsedOrigin.origin === env.GCS_SOCIAL_ORIGIN, 'origin', 'Origem HTTPS inválida.', 503);
  const origin = parsedOrigin.origin;
  vault ||= vaultFromFile(env.GCS_SOCIAL_KEY_FILE);
  const access = createAccess(pool, {uploadRoot}), repo = createRepository(pool, vault);
  const wrap = (title, user, body) => layout({title, user, body: styles + '<div class="social-page">' + body + '</div>'});
  function send(res, body, status = 200) { res.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'}); res.end(body); }
  function redirect(res, url) { res.writeHead(303, {Location: url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}); res.end(); }
  const csrf = (user, action) => `<input type="hidden" name="csrf" value="${esc(vault.csrf(user, action))}">`;
  async function mutation(req, user, action) {
    requireSameOrigin(req, origin);
    const data = await form(req); vault.verifyCsrf(data.get('csrf'), user, action); return data;
  }
  const base = client => '/clients/' + encodeURIComponent(client.slug) + '/connections';
  const statistics = client => '/clients/' + encodeURIComponent(client.slug) + '/statistics';
  const api = settings => metaFactory(settings, {origin, fetchImpl});
  const actor = (user, client) => user.is_master || client.member_role === 'owner';
  async function settingsPage(res, user) {
    check(user.is_master, 'forbidden', 'Acesso exclusivo da administração.', 403);
    const value = await repo.settings() || {};
    send(res, wrap('Configuração Meta', user, `<div class="social-heading"><h1>Configuração Meta</h1><a href="/dashboard">Voltar</a></div>
      <form class="social-form" method="post" action="/settings/meta">${csrf(user, 'settings')}
      <label for="meta-app">App ID</label><input id="meta-app" name="app_id" inputmode="numeric" pattern="[0-9]{1,40}" value="${esc(value.app_id)}" required>
      <label for="meta-config">Configuration ID</label><input id="meta-config" name="config_id" inputmode="numeric" pattern="[0-9]{1,40}" value="${esc(value.config_id)}" required>
      <label for="meta-secret">App Secret ${value.app_secret ? '(já salvo)' : ''}</label><input id="meta-secret" name="app_secret" type="password" autocomplete="new-password" ${value.app_secret ? '' : 'required'}>
      <label for="meta-version">Graph API</label><input id="meta-version" name="version" value="${esc(value.version || 'v26.0')}" pattern="v[0-9]{2}\.0" required>
      <p class="social-note">URL de retorno: <code>${esc(origin)}/integrations/meta/callback</code></p>
      <div class="social-actions"><button class="btn" type="submit">Salvar configuração</button></div></form>`));
  }
  async function connections(res, user, client) {
    const rows = await repo.list(client.id), settings = await repo.settings();
    const content = ['instagram','facebook'].map(network => {
      const row = rows.find(r => r.network === network), legacy = row?.status === 'legacy';
      const expired = row?.expires_at && new Date(row.expires_at) <= new Date();
      const active = row?.status === 'connected' && !expired;
      const status = legacy ? 'Integração atual preservada' : expired ? 'Autorização expirada' : active ? 'Conectado' : 'Não conectado';
      const details = active ? `<p class="social-state">Publicação: ${row.capabilities.publish ? 'autorizada' : 'permissão pendente'} · Estatísticas: ${row.capabilities.insights ? 'autorizadas' : 'permissão pendente'}</p>` : '';
      const fullStatistics = network === 'instagram' && statisticsClients.has(client.slug);
      const insightUrl = fullStatistics ? statistics(client) : `${base(client)}/${network}/insights`;
      const insights = active && row.capabilities.insights ? `<a class="btn secondary" href="${insightUrl}">${fullStatistics ? 'Ver estatísticas completas' : 'Ver insights'}</a>` : '';
      const disconnect = row?.status === 'connected' && actor(user, client) ? `<form method="post" action="${base(client)}/${esc(row.id)}/disconnect">${csrf(user, 'disconnect:' + row.id)}<button class="btn secondary" type="submit">Desconectar</button></form>` : '';
      return `<section class="social-row"><h2>${networkName(network)}</h2><div><p><strong>${esc(row?.status !== 'disconnected' ? row?.account_name || 'Conta não vinculada' : 'Conta não vinculada')}</strong></p><p class="social-state">${status}</p>${details}</div><div class="social-actions">${insights}${disconnect}</div></section>`;
    }).join('');
    const protectedLegacy = rows.some(r => r.status === 'legacy');
    const loginReady = settings && publicLoginEnabled;
    const label = !settings ? 'Conexão temporariamente indisponível' :
      publicLoginEnabled ? 'Continuar com Facebook' : 'Aguardando liberação da Meta';
    const button = actor(user, client) && !protectedLegacy ? `<form method="post" action="${base(client)}/meta/start">${csrf(user, 'start:' + client.id)}<button class="btn" type="submit" ${loginReady ? '' : 'disabled'}>${label}</button></form>` : '';
    send(res, wrap('Facebook e Instagram · ' + client.name, user, `<div class="social-heading"><div><h1>Facebook e Instagram</h1><p>${esc(client.name)}</p></div><a href="/clients/${esc(client.slug)}">Voltar ao cliente</a></div>
      <div class="social-rows">${content}</div><div class="social-actions" style="margin-top:24px">${button}</div>
      ${!protectedLegacy ? '<p class="social-note">Use o Facebook que administra a Página. Nenhuma conta de desenvolvedor é necessária.</p>' : ''}
      ${protectedLegacy ? '<p class="social-note">As conexões atuais do Community News continuam sob o serviço de publicação existente.</p>' : ''}`));
  }
  async function insightPage(res, user, client, network) {
    if (network === 'instagram' && statisticsClients.has(client.slug)) {
      redirect(res, statistics(client)); return;
    }
    const settings = await repo.settings();
    check(settings, 'settings', 'Aplicativo ainda nao configurado.', 503);
    const connection = await repo.insightConnection(client.id, network);
    const value = await api(settings).insights(connection);
    const format = new Intl.NumberFormat('pt-BR');
    const cards = value.metrics.map(metric => `<div class="insight-card"><strong>${esc(format.format(metric.value))}</strong><span>${esc(metric.label)}</span><small>${esc(metric.detail)}</small></div>`).join('');
    const since = new Date(value.range.since).toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'});
    const until = new Date(value.range.until).toLocaleDateString('pt-BR', {timeZone:'America/Sao_Paulo'});
    send(res, wrap('Insights do ' + networkName(network), user, `<div class="social-heading"><div><h1>Insights do ${networkName(network)}</h1><p>${esc(client.name)} · ${esc(value.account.name)}</p></div><a href="${base(client)}">Voltar às conexões</a></div>
      <p class="social-state">Período de ${esc(since)} a ${esc(until)}</p><div class="insights-grid">${cards}</div>
      <p class="social-note">Dados consultados agora na Meta. O Green Content Studio não armazena estas métricas.</p>`));
  }
  async function choose(res, user, client, id) {
    const {candidates} = await repo.pending(id, client, user);
    const pages = candidates.pages.map(p => {
      const portfolios = Array.isArray(p.businesses) && p.businesses.length
        ? `<br><small>Portfólio: ${esc(p.businesses.map(item => item.name).join(', '))}</small>` : '';
      return `<label class="social-choice"><input type="radio" name="page_id" value="${esc(p.id)}" required><span><strong>${esc(p.name)}</strong><br><small>Facebook ${esc(p.id)}${p.instagram ? ' · Instagram @' + esc(p.instagram.name) : ' · Sem Instagram vinculado'}</small>${portfolios}</span></label>`;
    }).join('');
    send(res, wrap('Selecionar contas', user, `<div class="social-heading"><div><h1>Selecionar contas</h1><p>${esc(client.name)}</p></div><a href="${base(client)}">Cancelar</a></div>
      <form method="post" action="${base(client)}/meta/select">${csrf(user, 'select:' + client.id)}<input type="hidden" name="flow" value="${esc(id)}">
      <fieldset><legend>Página autorizada</legend>${pages}</fieldset><fieldset><legend>Redes para este cliente</legend>
      ${['instagram','facebook'].map(n => `<label class="social-choice"><input type="checkbox" name="network" value="${n}"><span>${networkName(n)}</span></label>`).join('')}</fieldset>
      <button class="btn" type="submit">Confirmar conexão</button></form>`));
  }
  return {
    enabled: true,
    hydrate: user => access.hydrate(user),
    guard: (req, user, url) => access.guard(req, user, url),
    link: (slug, user) => enabledClients.has(slug) && user?.nav_clients?.some(c => c.slug === slug) ?
      `<a class="btn secondary" href="/clients/${esc(slug)}/connections">Facebook e Instagram</a>` : '',
    settingsLink: () => '',
    async handle(req, res, user, url) {
      const match = url.pathname.match(/^\/clients\/([^/]+)\/connections(?:\/(.*))?$/);
      if (!match && !['/settings/meta','/integrations/meta/callback'].includes(url.pathname)) return false;
      if (match && !enabledClients.has(match[1])) return false;
      try {
        if (url.pathname === '/settings/meta') {
          check(user.is_master, 'forbidden', 'Acesso exclusivo da administração.', 403);
          if (req.method === 'GET') await settingsPage(res, user);
          else if (req.method === 'POST') {
            const data = await mutation(req, user, 'settings'), current = await repo.settings();
            const appId = data.get('app_id')?.trim();
            check(!current || current.app_id === appId || data.get('app_secret'), 'settings', 'Ao trocar o App ID, informe também o App Secret correspondente.');
            const value = validateSettings({app_id: appId, config_id: data.get('config_id')?.trim(),
              app_secret: data.get('app_secret')?.trim() || current?.app_secret, version: data.get('version')?.trim()});
            await repo.saveSettings(value, user); redirect(res, '/settings/meta');
          } else check(false, 'method', 'Método não permitido.', 405);
          return true;
        }
        if (url.pathname === '/integrations/meta/callback') {
          check(req.method === 'GET', 'method', 'Método não permitido.', 405);
          check(publicLoginEnabled, 'meta_app_inactive', 'A conexão será liberada após a aprovação do aplicativo pela Meta.', 503);
          const settings = await repo.settings(); check(settings, 'settings', 'Aplicativo ainda não configurado.', 503);
          const flow = await repo.consume(url.searchParams.get('state'), user, settings);
          const result = await pool.query('SELECT slug FROM clients WHERE id=$1', [flow.client_id]);
          check(result.rows[0], 'not_found', 'Cliente não encontrado.', 404);
          const client = await access.client(user, result.rows[0].slug, 'connect');
          if (url.searchParams.has('error')) { redirect(res, base(client)); return true; }
          const candidates = await api(settings).exchange(url.searchParams.get('code'));
          await repo.candidates(flow, candidates); redirect(res, base(client) + '/meta/select?flow=' + flow.id); return true;
        }
        const sub = match[2] || '';
        const insightsMatch = sub.match(/^(instagram|facebook)\/insights$/);
        const client = await access.client(user, match[1], !sub || insightsMatch ? 'read' : 'connect');
        if (req.method === 'GET' && !sub) await connections(res, user, client);
        else if (req.method === 'GET' && insightsMatch) await insightPage(res, user, client, insightsMatch[1]);
        else if (req.method === 'POST' && sub === 'meta/start') {
          await mutation(req, user, 'start:' + client.id);
          check(publicLoginEnabled, 'meta_app_inactive', 'A conexão será liberada após a aprovação do aplicativo pela Meta.', 503);
          check(!(await repo.list(client.id)).some(r => r.status === 'legacy'), 'legacy_protected', 'As conexões atuais deste cliente serão preservadas.', 409);
          const settings = await repo.settings(); check(settings, 'settings', 'Aplicativo ainda não configurado.', 503);
          const state = await repo.begin(client, user, settings); redirect(res, api(settings).authorize(state));
        } else if (req.method === 'GET' && sub === 'meta/select') {
          check(publicLoginEnabled, 'meta_app_inactive', 'A conexão será liberada após a aprovação do aplicativo pela Meta.', 503);
          await choose(res, user, client, url.searchParams.get('flow'));
        }
        else if (req.method === 'POST' && sub === 'meta/select') {
          check(publicLoginEnabled, 'meta_app_inactive', 'A conexão será liberada após a aprovação do aplicativo pela Meta.', 503);
          const data = await mutation(req, user, 'select:' + client.id), pending = await repo.pending(data.get('flow'), client, user);
          const settings = await repo.settings();
          check(hash(JSON.stringify(settings)) === pending.flow.settings_hash, 'settings_changed', 'A configuração mudou. Conecte novamente.', 409);
          const page = pending.candidates.pages.find(p => p.id === data.get('page_id'));
          check(page, 'page', 'Selecione uma Página autorizada.');
          const networks = data.getAll('network');
          check(networks.every(n => ['instagram','facebook'].includes(n)) && networks.length > 0, 'network', 'Selecione as redes.');
          const verified = await api(settings).verifyPage(page);
          pending.candidates.scopes = pending.candidates.scopes.filter(s => verified.scopes.includes(s));
          const limits = [pending.candidates.expires_at, verified.expires_at].filter(Boolean).map(x => new Date(x).getTime());
          pending.candidates.expires_at = limits.length ? new Date(Math.min(...limits)).toISOString() : null;
          await repo.select({client, user, ...pending, page, networks}); redirect(res, base(client));
        } else if (req.method === 'POST' && /^[a-f0-9-]{36}\/disconnect$/.test(sub)) {
          const id = sub.split('/')[0]; await mutation(req, user, 'disconnect:' + id);
          await repo.disconnect(id, client, user); redirect(res, base(client));
        } else check(false, 'not_found', 'Página não encontrada.', 404);
      } catch (error) {
        // Never render upstream bodies, OAuth codes, tokens, URLs or stack traces.
        const known = error instanceof SocialError;
        send(res, wrap('Conexões', user, `<h1>Não foi possível concluir</h1><p>${esc(known ? error.message : 'A conexão está indisponível. Tente novamente mais tarde.')}</p><a href="${match ? '/clients/' + esc(match[1]) + '/connections' : '/dashboard'}">Voltar</a>`), known ? error.status : 503);
      }
      return true;
    }
  };
}
module.exports = {createSocialConnections, form};
