'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createAccess} = require('../social-connections/access.cjs');
const {vaultFromFile, check, SocialError, requireSameOrigin} = require('../social-connections/security.cjs');
const {createRepository} = require('./repository.cjs');
const {createSource} = require('./source.cjs');
const {createAssets} = require('./assets.cjs');
const core = require('./core.cjs');

const esc = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const networkName = network => network === 'instagram' ? 'Instagram' : 'Facebook';
const statusName = status => ({
  scheduled:'Agendado',processing:'Publicando',published:'Publicado',failed:'Falhou',
  uncertain:'Conferir',held:'Pausado',cancelled:'Cancelado'
}[status] || status);
const errorName = code => ({
  schedule_missed:'O horário passou antes de o worker iniciar.',
  preparation_expired:'A preparação expirou antes da publicação.',
  quota_exhausted:'O limite de publicação do Instagram foi atingido.',
  container_quota_exhausted:'O limite de preparação de mídias do Instagram foi atingido.',
  media_processing_timeout:'O Instagram não concluiu o processamento da arte no tempo recomendado.',
  carousel_processing_timeout:'O Instagram não concluiu o processamento do carrossel no tempo recomendado.',
  connection_unavailable:'A conexão Meta está indisponível ou expirou.',
  meta_settings_missing:'A configuração da Meta ainda não está completa.',
  uncertain_write:'A Meta pode ter recebido a operação. Confira a conta antes de qualquer nova tentativa.',
  interrupted_write:'A operação foi interrompida depois de iniciar. Confira a conta antes de qualquer nova tentativa.'
}[code] || (String(code || '').startsWith('meta_rejected_')
  ? 'A Meta recusou a publicação.' : code ? 'Esta entrega requer revisão da administração.' : ''));

function resultUrl(delivery) {
  let url;
  try { url = new URL(delivery?.result?.url); } catch {}
  const hosts = delivery?.network === 'instagram'
    ? ['instagram.com','www.instagram.com'] : ['facebook.com','www.facebook.com'];
  return url?.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password
    ? url.href : '';
}

const styles = `<style>
main:has(.publish-page){width:calc(100% - 36px);max-width:1320px}
.publish-page{max-width:1180px;margin:auto}.publish-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:24px}
.publish-heading h1{font-size:26px;margin:0}.publish-heading p{margin:6px 0 0;color:#59656a}.publish-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.publish-notice{padding:13px 15px;border-left:4px solid #4f7d65;background:#f1f6f2;margin:16px 0}.publish-warning{border-left-color:#b26d20;background:#fff7ec}
.publish-list{border-top:1px solid #d9e0dc}.publish-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:14px;align-items:start;padding:16px 0;border-bottom:1px solid #d9e0dc}
.publish-row input[type=checkbox]{width:18px;height:18px;margin-top:3px;accent-color:#245b45}.publish-row h2{font-size:17px;line-height:1.35;margin:0 0 5px}.publish-meta{font-size:13px;color:#5a6860}
.publish-form-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px;margin:18px 0}.publish-form-grid label,.publish-editor label{display:block;font-weight:600;margin-bottom:6px}.publish-form-grid input,.publish-form-grid select,.publish-editor input,.publish-editor textarea{width:100%;box-sizing:border-box}
.publish-network{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0}.publish-network label{display:flex;gap:8px;align-items:center;font-weight:500}.publish-network input{width:18px;height:18px;accent-color:#245b45}
.publish-plan{display:grid;grid-template-columns:120px minmax(0,1fr);gap:18px;padding:22px 0;border-top:1px solid #d9e0dc}.publish-thumb{display:block;width:120px;aspect-ratio:4/5;background:#eef2ee;overflow:hidden}.publish-thumb img{width:100%;height:100%;object-fit:cover}.publish-plan h2{font-size:18px;line-height:1.35;margin:0 0 12px}
.publish-editor{display:grid;grid-template-columns:180px minmax(0,1fr) minmax(0,1fr);gap:14px}.publish-editor textarea{min-height:125px;resize:vertical}.publish-state{display:inline-block;border:1px solid #c8d5cd;padding:4px 7px;font-size:12px;margin:3px 4px 3px 0;background:#f7f9f7}
.publish-deliveries{display:grid;gap:8px;margin:9px 0 14px}.publish-delivery{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.publish-delivery .publish-state{margin:0}.publish-error{font-size:13px;color:#8a3d2c}.publish-cancel{padding:5px 8px;font-size:12px}
.publish-danger{border-color:#a9463c!important;color:#8f3027!important;background:#fff!important}
.calendar-wrap{overflow:auto;border-top:1px solid #d9e0dc}.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(145px,1fr));min-width:1015px}.calendar-weekday{padding:10px;font-size:12px;font-weight:700;text-transform:uppercase;border-right:1px solid #e0e5e2;border-bottom:1px solid #d9e0dc;background:#f6f8f6}
.calendar-day{min-height:150px;padding:9px;border-right:1px solid #e0e5e2;border-bottom:1px solid #e0e5e2}.calendar-day.empty{background:#fafbfa}.calendar-number{font-size:13px;font-weight:700;margin-bottom:7px}.calendar-item{display:grid;grid-template-columns:42px minmax(0,1fr);gap:7px;color:inherit;text-decoration:none;border-left:3px solid #6c8f7d;padding:7px 8px;margin:7px 0;background:#f2f6f3;font-size:12px;line-height:1.35}.calendar-item img,.calendar-item-placeholder{display:block;width:42px;aspect-ratio:4/5;object-fit:cover;background:#e1e9e3}.calendar-item-copy{min-width:0;overflow-wrap:anywhere}.calendar-item strong{display:block;margin-bottom:3px}.calendar-item.planned{border-left-color:#b98a39;background:#fff8ea}
.calendar-mobile{display:none}.calendar-mobile-day{padding:14px 0;border-top:1px solid #d9e0dc}.calendar-mobile-date{font-size:13px;font-weight:750;margin-bottom:7px}
.batch-table{width:100%;border-collapse:collapse}.batch-table th,.batch-table td{text-align:left;padding:11px 8px;border-bottom:1px solid #dce2de;vertical-align:top}.batch-table th{font-size:12px;text-transform:uppercase;color:#526159}
.publish-confirm{max-width:760px}.publish-confirm li{margin:10px 0}.publish-rights{display:flex;gap:10px;align-items:flex-start;margin:20px 0}.publish-rights input{width:18px;height:18px;margin-top:3px}
.publish-post-layout{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr);gap:28px;align-items:start}.publish-slide-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:14px}.publish-slide-grid figure{margin:0}.publish-slide-grid img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;background:#eef2ee}.publish-slide-grid figcaption{font-size:12px;color:#59656a;margin-top:5px}.publish-post-form label{display:block;font-weight:600;margin:0 0 6px}.publish-post-form input[type=datetime-local],.publish-post-form textarea{width:100%;box-sizing:border-box}.publish-post-form textarea{min-height:150px;resize:vertical}.publish-field{margin-bottom:18px}.publish-caption{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;border-top:1px solid #d9e0dc;padding-top:12px}
.bulk-planner{margin:0 0 16px}.bulk-planner-intro{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}.bulk-planner-intro h2{margin-bottom:6px}
.bulk-planner-row{display:grid;grid-template-columns:28px minmax(190px,.8fr) minmax(210px,.75fr) minmax(320px,1.5fr);gap:14px;align-items:start;padding:18px 0;border-top:1px solid #d9e0dc}.bulk-planner-row>input{width:18px;height:18px;margin-top:3px;accent-color:#245b45}.bulk-planner-row h3{font-size:16px;line-height:1.35;margin:0 0 5px}.bulk-planner-row label{display:block;font-weight:600;margin-bottom:6px}.bulk-planner-row input[type=datetime-local],.bulk-planner-row textarea{width:100%;box-sizing:border-box}.bulk-planner-row textarea{min-height:116px;resize:vertical}.bulk-planner-unavailable{opacity:.7}
@media(max-width:800px){.publish-form-grid,.publish-editor,.publish-post-layout{grid-template-columns:1fr}.publish-plan{grid-template-columns:82px minmax(0,1fr)}.publish-thumb{width:82px}.publish-heading h1{font-size:23px}.batch-table{min-width:720px}.batch-table-wrap{overflow:auto}}
@media(max-width:900px){.bulk-planner-row{grid-template-columns:28px minmax(0,1fr)}.bulk-planner-row .bulk-planner-field{grid-column:2}}
@media(max-width:650px){.calendar-wrap{display:none}.calendar-mobile{display:block}.calendar-item{grid-template-columns:64px minmax(0,1fr);font-size:13px}.calendar-item img,.calendar-item-placeholder{width:64px}.publish-plan{grid-template-columns:1fr}.publish-thumb{width:96px}.bulk-planner-intro{display:block}}
</style>`;

async function form(req) {
  check((req.headers['content-type'] || '').split(';')[0] === 'application/x-www-form-urlencoded',
    'content_type', 'Formato de formulário inválido.', 415);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    check(bytes <= 512_000, 'body_size', 'O lote enviado é muito grande.', 413);
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function monthBounds(value, now = new Date()) {
  const current = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(now);
  const month = /^\d{4}-\d{2}$/.test(value || '') ? value : current;
  const [year, number] = month.split('-').map(Number);
  check(number >= 1 && number <= 12, 'invalid_month', 'Mês inválido.');
  const nextYear = number === 12 ? year + 1 : year;
  const nextMonth = number === 12 ? 1 : number + 1;
  const previousDate = new Date(Date.UTC(year, number - 2, 1));
  const nextDate = new Date(Date.UTC(year, number, 1));
  return {
    month,
    from: `${month}-01T03:00:00.000Z`,
    to: `${String(nextYear).padStart(4,'0')}-${String(nextMonth).padStart(2,'0')}-01T03:00:00.000Z`,
    previous: `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth()+1).padStart(2,'0')}`,
    next: `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth()+1).padStart(2,'0')}`,
    year, number
  };
}

function localParts(value) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return {day:Number(get('day')),month:Number(get('month')),year:Number(get('year')),time:`${get('hour')}:${get('minute')}`};
}

function scheduleInput(value, now = new Date()) {
  const minute = 60 * 1000;
  const minimum = new Date(Math.ceil((now.getTime() + 5 * minute) / minute) * minute);
  const suggested = new Date(Math.ceil((now.getTime() + 15 * minute) / minute) * minute);
  const current = new Date(value);
  return {
    min:core.scheduleLocal(minimum),
    value:core.scheduleLocal(Number.isFinite(current.getTime()) && current > minimum ? current : suggested)
  };
}

function postNumber(title) {
  const match = String(title || '').match(/\[POST\s+(\d+)\]/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function createSocialPublishing({pool, layout, uploadRoot, env = process.env, vault, source, assets}) {
  if (env.GCS_SOCIAL_PUBLISHING_ENABLED !== 'true') {
    return {enabled:false,link:()=>'',bulkPlanner:async()=>'',handle:async()=>false,media:async()=>false};
  }
  const enabledClients = new Set(String(env.GCS_SOCIAL_PUBLISHING_CLIENTS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
  check(enabledClients.size > 0 && [...enabledClients].every(value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)),
    'publishing_clients', 'Configure os clientes habilitados para publicação.', 503);
  const origin = new URL(env.GCS_SOCIAL_ORIGIN || '');
  check(origin.protocol === 'https:' && origin.origin === env.GCS_SOCIAL_ORIGIN,
    'origin', 'Origem HTTPS inválida.', 503);
  vault ||= vaultFromFile(env.GCS_SOCIAL_KEY_FILE);
  const access = createAccess(pool, {uploadRoot});
  const repository = createRepository(pool);
  source ||= createSource(pool);
  assets ||= createAssets({
    directory: env.GCS_SOCIAL_PUBLISH_ASSETS_DIR,
    origin: origin.origin,
    keyFile: env.GCS_SOCIAL_KEY_FILE
  });
  const wrap = (title, user, body) => layout({title, user, body: styles + `<div class="publish-page">${body}</div>`});
  const csrf = (user, action) => `<input type="hidden" name="csrf" value="${esc(vault.csrf(user, action))}">`;
  const base = client => `/clients/${encodeURIComponent(client.slug)}/publishing`;
  const planPath = (client, batchId, planId) => `${base(client)}/batches/${encodeURIComponent(batchId)}/plans/${encodeURIComponent(planId)}`;
  const imageUrl = (postId, file) => `/posts/${encodeURIComponent(postId)}/file?file=${encodeURIComponent(file)}&inline=1`;
  function send(res, body, status = 200) {
    res.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});
    res.end(body);
  }
  function redirect(res, location) { res.writeHead(303, {Location:location,'Cache-Control':'no-store'}); res.end(); }
  async function mutation(req, user, action) {
    requireSameOrigin(req, origin.origin);
    const data = await form(req);
    vault.verifyCsrf(data.get('csrf'), user, action);
    return data;
  }

  async function bulkReceipt(resultId, client) {
    check(/^[a-f0-9-]{36}$/.test(resultId || ''), 'bulk_not_found', 'Produção em massa não encontrada.', 404);
    let result;
    try {
      result = JSON.parse(await fs.readFile(path.join(uploadRoot, 'bulk-results', `${resultId}.json`), 'utf8'));
    } catch {
      check(false, 'bulk_not_found', 'Produção em massa não encontrada.', 404);
    }
    const ownerMatches = result.client?.id ? result.client.id === client.id : result.client?.slug === client.slug;
    check(ownerMatches, 'bulk_not_found', 'Produção em massa não encontrada.', 404);
    const created = Array.isArray(result.created) ? result.created.filter(item => /^[a-f0-9-]{36}$/.test(item?.id || '')) : [];
    check(created.length > 0 && created.length <= 100, 'invalid_batch', 'Esta produção não possui posts válidos.', 409);
    return {...result, created};
  }

  async function bulkPlanner(client, user, resultId) {
    if (!enabledClients.has(client.slug)) return '';
    const receipt = await bulkReceipt(resultId, client);
    const summaries = await Promise.all(receipt.created.map(async item => {
      try { return await source.summary(item.id, client.id); } catch { return null; }
    }));
    const ready = summaries.filter(Boolean).length;
    const rows = receipt.created.map((item, index) => {
      const value = summaries[index];
      if (!value) return `<div class="bulk-planner-row bulk-planner-unavailable"><input type="checkbox" disabled><div><h3>${esc(item.title || `Post ${index + 1}`)}</h3><span class="publish-meta">Gere as artes deste post para poder agendá-lo.</span><div style="margin-top:8px"><a href="/posts/${esc(item.id)}/review">Revisar slides</a></div></div></div>`;
      return `<div class="bulk-planner-row"><input type="checkbox" name="post_id" value="${esc(item.id)}" checked aria-label="Selecionar ${esc(value.title)}"><div><h3>${esc(value.title)}</h3><span class="publish-meta">${esc(value.slide_count)} artes · legenda importada do DOCX</span><div style="margin-top:8px"><a href="/posts/${esc(item.id)}/review">Revisar slides</a></div></div><div class="bulk-planner-field"><label for="bulk-due-${esc(item.id)}">Data e hora</label><input id="bulk-due-${esc(item.id)}" type="datetime-local" name="due_local_${esc(item.id)}" data-bulk-due required></div><div class="bulk-planner-field"><label for="bulk-caption-${esc(item.id)}">Legenda</label><textarea id="bulk-caption-${esc(item.id)}" name="caption_${esc(item.id)}" maxlength="4300" required>${esc(value.caption)}</textarea></div></div>`;
    }).join('');
    const label = [receipt.monthLabel, client.name].filter(Boolean).join(' · ') || `Publicações ${client.name}`;
    return `${styles}<section class="card bulk-planner" id="planejar-publicacoes"><div class="bulk-planner-intro"><div><h2>Editar e planejar este bulk</h2><p class="publish-meta">${ready} de ${receipt.created.length} posts com artes prontas. As legendas abaixo vieram do bloco LEGENDA do arquivo.</p></div><a class="btn secondary" href="${base(client)}">Abrir calendário</a></div>
      ${ready ? `<form method="post" action="${base(client)}/from-bulk/${esc(resultId)}">${csrf(user, 'bulk-batch:' + client.id + ':' + resultId)}<div class="publish-form-grid"><div><label for="bulk-label">Nome do planejamento</label><input id="bulk-label" name="label" value="${esc(label)}" maxlength="200" required></div><div><label for="bulk-start">Primeira data e hora</label><input id="bulk-start" type="datetime-local"></div><div><label for="bulk-cadence">Intervalo em dias</label><input id="bulk-cadence" type="number" value="2" min="0" max="31"></div></div><fieldset style="border:0;padding:0"><legend><strong>Redes</strong></legend><div class="publish-network"><label><input type="checkbox" name="network" value="instagram" checked> Instagram</label><label><input type="checkbox" name="network" value="facebook" checked> Facebook</label></div></fieldset><div class="publish-actions"><button class="btn secondary" type="button" id="bulk-apply-dates">Aplicar datas ao lote</button><button class="btn secondary" type="button" id="bulk-select-all">Selecionar todos</button><button class="btn secondary" type="button" id="bulk-clear">Limpar seleção</button></div><div class="publish-list" style="margin-top:16px">${rows}</div><div class="publish-actions" style="margin-top:20px"><button class="btn" type="submit">Criar planejamento no calendário</button></div></form>` : `<div class="publish-notice publish-warning">Gere as artes para habilitar a edição das legendas e o planejamento.</div><div class="publish-list">${rows}</div>`}</section>
      <script>(()=>{const form=document.querySelector('#planejar-publicacoes form');if(!form)return;const boxes=()=>[...form.querySelectorAll('input[name=post_id]')];const sync=box=>{const due=form.querySelector('[name="due_local_'+box.value+'"]');const caption=form.querySelector('[name="caption_'+box.value+'"]');due.required=box.checked;caption.required=box.checked;};const setAll=value=>boxes().forEach(box=>{box.checked=value;sync(box);});boxes().forEach(box=>{sync(box);box.addEventListener('change',()=>sync(box));});document.getElementById('bulk-select-all')?.addEventListener('click',()=>setAll(true));document.getElementById('bulk-clear')?.addEventListener('click',()=>setAll(false));document.getElementById('bulk-apply-dates')?.addEventListener('click',()=>{const startInput=document.getElementById('bulk-start');const start=startInput.value;const interval=Number(document.getElementById('bulk-cadence').value);if(!start||!Number.isInteger(interval)||interval<0||interval>31){startInput.setCustomValidity('Escolha a primeira data e hora.');startInput.reportValidity();return;}startInput.setCustomValidity('');const baseDate=new Date(start);let position=0;boxes().forEach(box=>{if(!box.checked)return;const field=form.querySelector('[name="due_local_'+box.value+'"]');const date=new Date(baseDate);date.setDate(date.getDate()+position*interval);const pad=value=>String(value).padStart(2,'0');field.value=date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes());position+=1;});});document.getElementById('bulk-start')?.addEventListener('input',event=>event.target.setCustomValidity(''));form.addEventListener('submit',event=>{const selected=boxes().filter(box=>box.checked);if(!selected.length){event.preventDefault();alert('Selecione ao menos um post.');return;}for(const box of selected){const due=form.querySelector('[name="due_local_'+box.value+'"]');if(!due.value){event.preventDefault();due.reportValidity();due.focus();return;}}});})();</script>`;
  }

  async function createBulkBatch(req, res, user, client, resultId) {
    const data = await mutation(req, user, 'bulk-batch:' + client.id + ':' + resultId);
    const receipt = await bulkReceipt(resultId, client);
    const ids = data.getAll('post_id');
    check(ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length,
      'invalid_batch', 'Selecione entre 1 e 100 posts, sem repetir.');
    const allowed = new Set(receipt.created.map(item => item.id));
    check(ids.every(id => allowed.has(id)), 'invalid_batch', 'Um post não pertence a esta produção.', 409);
    const selectedNetworks = core.networks(data.getAll('network'));
    const plans = [];
    for (const item of receipt.created) {
      if (!ids.includes(item.id)) continue;
      const value = await source.load(item.id, client.id);
      const caption = String(data.get('caption_' + item.id) || '').trim();
      plans.push({
        post_id:value.post_id,
        due_at:core.localSchedule(data.get('due_local_' + item.id)),
        networks:selectedNetworks,
        captions:core.normalizeCaptions({instagram:caption,facebook:caption}, selectedNetworks),
        source_digest:value.source_digest,
        generation_id:value.generation_id
      });
    }
    const batch = await repository.createBatch({
      clientId:client.id,label:data.get('label')?.trim(),userId:user.id,plans
    });
    redirect(res, `${base(client)}/batches/${batch.id}`);
  }

  async function overview(res, user, client, url) {
    const bounds = monthBounds(url.searchParams.get('month'));
    const [calendar, batches, connections] = await Promise.all([
      repository.calendar(client.id, bounds.from, bounds.to),
      repository.listBatches(client.id),
      repository.connectionRows(client.id)
    ]);
    const calendarItems = await Promise.all(calendar.map(async item => {
      const frozen = item.deliveries.find(delivery => delivery.snapshot)?.snapshot?.assets?.[0];
      if (frozen?.sha256 && assets.url) {
        try { return {...item, preview_url:await assets.url(frozen.sha256)}; } catch {}
      }
      try {
        const preview = source.preview ? await source.preview(item.post_id, client.id) : await source.load(item.post_id, client.id);
        return {...item, preview_file:preview.file || preview.assets?.[0]?.file};
      } catch { return item; }
    }));
    const firstDay = new Date(bounds.from).getUTCDay();
    const days = new Date(Date.UTC(bounds.year, bounds.number, 0)).getUTCDate();
    const byDay = new Map();
    for (const item of calendarItems) {
      const parts = localParts(item.due_at);
      if (parts.month === bounds.number && parts.year === bounds.year) {
        if (!byDay.has(parts.day)) byDay.set(parts.day, []);
        byDay.get(parts.day).push({...item, time:parts.time});
      }
    }
    const cells = [];
    for (let index = 0; index < firstDay; index += 1) cells.push('<div class="calendar-day empty"></div>');
    for (let day = 1; day <= days; day += 1) {
      const items = (byDay.get(day) || []).map(item => {
        const states = item.deliveries.length
          ? item.deliveries.map(delivery => `${networkName(delivery.network)}: ${statusName(delivery.status)}`).join(' · ')
          : 'Planejado';
        const previewSource = item.preview_url || (item.preview_file ? imageUrl(item.post_id,item.preview_file) : '');
        const preview = previewSource ? `<img src="${esc(previewSource)}" alt="${esc(item.source_title)}">` : '<span class="calendar-item-placeholder" aria-hidden="true"></span>';
        return `<a class="calendar-item ${item.batch_status === 'draft' ? 'planned' : ''}" href="${planPath(client,item.batch_id,item.id)}">${preview}<span class="calendar-item-copy"><strong>${esc(item.time)} · ${esc(item.source_title)}</strong>${esc(states)}</span></a>`;
      }).join('');
      cells.push(`<div class="calendar-day"><div class="calendar-number">${day}</div>${items}</div>`);
    }
    while (cells.length % 7) cells.push('<div class="calendar-day empty"></div>');
    const mobileCalendar = calendarItems.length ? calendarItems.map(item => {
      const parts = localParts(item.due_at);
      const states = item.deliveries.length
        ? item.deliveries.map(delivery => `${networkName(delivery.network)}: ${statusName(delivery.status)}`).join(' · ')
        : 'Planejado';
      const previewSource = item.preview_url || (item.preview_file ? imageUrl(item.post_id,item.preview_file) : '');
      const preview = previewSource ? `<img src="${esc(previewSource)}" alt="${esc(item.source_title)}">` : '<span class="calendar-item-placeholder" aria-hidden="true"></span>';
      return `<div class="calendar-mobile-day"><div class="calendar-mobile-date">${String(parts.day).padStart(2,'0')}/${String(parts.month).padStart(2,'0')}/${parts.year}</div><a class="calendar-item ${item.batch_status === 'draft' ? 'planned' : ''}" href="${planPath(client,item.batch_id,item.id)}">${preview}<span class="calendar-item-copy"><strong>${esc(parts.time)} · ${esc(item.source_title)}</strong>${esc(states)}</span></a></div>`;
    }).join('') : '<p class="publish-meta">Nenhuma publicação neste mês.</p>';
    const connectionText = ['instagram','facebook'].map(network => {
      const row = connections.find(value => value.network === network);
      return `${networkName(network)}: ${row?.status === 'connected' && row.capabilities?.publish ? 'pronto' : 'não conectado para publicar'}`;
    }).join(' · ');
    const batchRows = batches.map(batch => `<tr><td><a href="${base(client)}/batches/${esc(batch.id)}">${esc(batch.label)}</a></td><td>${esc(batch.status === 'draft' ? 'Planejado' : batch.status === 'confirmed' ? 'Confirmado' : 'Cancelado')}</td><td>${esc(batch.posts)}</td><td>${esc(batch.published || 0)}</td><td>${esc(batch.attention || 0)}</td></tr>`).join('');
    send(res, wrap(`Agenda · ${client.name}`, user, `<div class="publish-heading"><div><h1>Agenda de publicações</h1><p>${esc(client.name)}</p></div><div class="publish-actions"><a class="btn secondary" href="/clients/${esc(client.slug)}">Voltar</a><a class="btn" href="${base(client)}/new">Novo lote</a></div></div>
      <div class="publish-notice ${connections.some(row => row.status === 'connected' && row.capabilities?.publish) ? '' : 'publish-warning'}">${esc(connectionText)}</div>
      <div class="publish-heading"><div><h2>${esc(new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(bounds.from)))}</h2></div><div class="publish-actions"><a class="btn secondary" href="${base(client)}?month=${bounds.previous}">Anterior</a><a class="btn secondary" href="${base(client)}?month=${bounds.next}">Próximo</a></div></div>
      <div class="calendar-wrap"><div class="calendar-grid">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${cells.join('')}</div></div><div class="calendar-mobile">${mobileCalendar}</div>
      <section style="margin-top:30px"><h2>Lotes</h2><div class="batch-table-wrap"><table class="batch-table"><thead><tr><th>Lote</th><th>Estado</th><th>Posts</th><th>Publicados</th><th>Atenção</th></tr></thead><tbody>${batchRows || '<tr><td colspan="5">Nenhum lote criado.</td></tr>'}</tbody></table></div></section>`));
  }

  async function newBatchPage(res, user, client) {
    const posts = await source.list(client.id, 100);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const defaultStart = core.scheduleLocal(tomorrow).slice(0,10) + 'T09:00';
    const rows = posts.map((post, index) => `<label class="publish-row"><input type="checkbox" name="post_id" value="${esc(post.id)}" ${index < 12 ? 'data-latest="true"' : ''}><span><h2>${esc(post.source_title)}</h2><span class="publish-meta">${esc(post.source_meta?.bulk_filename || 'Post individual')} · ${esc(post.slide_count)} artes · ${esc(new Date(post.created_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</span></span><a href="/posts/${esc(post.id)}/review" target="_blank">Revisar</a></label>`).join('');
    send(res, wrap(`Novo lote · ${client.name}`, user, `<div class="publish-heading"><div><h1>Novo lote</h1><p>Selecione apenas as versões finais que devem entrar na agenda.</p></div><a href="${base(client)}">Cancelar</a></div>
      <form method="post" action="${base(client)}/new">${csrf(user, 'new-batch:' + client.id)}
      <div class="publish-form-grid"><div><label for="batch-label">Nome do lote</label><input id="batch-label" name="label" value="Publicações ${esc(client.name)}" maxlength="200" required></div><div><label for="batch-start">Primeira publicação</label><input id="batch-start" type="datetime-local" name="start_local" value="${esc(defaultStart)}" required></div><div><label for="batch-cadence">Intervalo em dias</label><input id="batch-cadence" type="number" name="interval_days" value="2" min="0" max="31" required></div></div>
      <fieldset style="border:0;padding:0"><legend><strong>Redes</strong></legend><div class="publish-network"><label><input type="checkbox" name="network" value="instagram" checked> Instagram</label><label><input type="checkbox" name="network" value="facebook" checked> Facebook</label></div></fieldset>
      <div class="publish-actions"><button class="btn secondary" type="button" id="select-latest">Selecionar 12 mais recentes</button><button class="btn secondary" type="button" id="clear-posts">Limpar seleção</button></div>
      <div class="publish-list">${rows || '<p>Nenhum post com artes concluídas.</p>'}</div>
      <div class="publish-actions" style="margin-top:22px"><button class="btn" type="submit">Criar planejamento</button></div></form>
      <script>document.getElementById('select-latest')?.addEventListener('click',()=>document.querySelectorAll('input[name=post_id]').forEach((el,i)=>el.checked=i<12));document.getElementById('clear-posts')?.addEventListener('click',()=>document.querySelectorAll('input[name=post_id]').forEach(el=>el.checked=false));</script>`));
  }

  async function createBatch(req, res, user, client) {
    const data = await mutation(req, user, 'new-batch:' + client.id);
    const ids = data.getAll('post_id');
    check(ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length,
      'invalid_batch', 'Selecione entre 1 e 100 posts, sem repetir.');
    const selectedNetworks = core.networks(data.getAll('network'));
    const start = core.localSchedule(data.get('start_local'));
    const interval = Number(data.get('interval_days'));
    check(Number.isInteger(interval) && interval >= 0 && interval <= 31, 'invalid_interval', 'Intervalo inválido.');
    const available = await source.list(client.id, 500);
    const selected = ids.map(id => available.find(post => post.id === id));
    check(selected.every(Boolean), 'invalid_batch', 'Um post não está mais disponível. Atualize a página.', 409);
    selected.sort((a,b) => postNumber(a.source_title) - postNumber(b.source_title) ||
      new Date(a.created_at) - new Date(b.created_at));
    const plans = [];
    for (let index = 0; index < selected.length; index += 1) {
      const value = await source.load(selected[index].id, client.id);
      check(value.caption, 'caption_required', `O post “${value.title}” não possui legenda.`, 409);
      const captions = core.normalizeCaptions({instagram:value.caption,facebook:value.caption}, selectedNetworks);
      plans.push({
        post_id:value.post_id,
        due_at:new Date(Date.parse(start) + index * interval * 24 * 60 * 60 * 1000).toISOString(),
        networks:selectedNetworks,captions,source_digest:value.source_digest,generation_id:value.generation_id
      });
    }
    const batch = await repository.createBatch({
      clientId:client.id,label:data.get('label')?.trim(),userId:user.id,plans
    });
    redirect(res, `${base(client)}/batches/${batch.id}`);
  }

  async function batchPage(res, user, client, batchId, message = '') {
    const result = await repository.getBatch(batchId, client.id);
    const editable = result.batch.status === 'draft';
    const confirmed = result.batch.status === 'confirmed';
    const plans = [];
    for (const plan of result.plans) {
      const inputSchedule = editable ? scheduleInput(plan.due_at) : null;
      let current;
      try { current = await source.load(plan.post_id, client.id); } catch {}
      const thumb = current?.assets?.[0]?.file
        ? `<img src="/posts/${esc(plan.post_id)}/file?file=${encodeURIComponent(current.assets[0].file)}&inline=1" alt="">`
        : '';
      const individualPath = planPath(client,batchId,plan.id);
      const states = plan.deliveries.map(delivery => {
        const link = resultUrl(delivery);
        const error = errorName(delivery.error_code);
        const cancellable = ['scheduled','held','failed'].includes(delivery.status);
        return `<div class="publish-delivery"><span class="publish-state">${networkName(delivery.network)} · ${statusName(delivery.status)}</span>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver publicação</a>` : ''}${error ? `<span class="publish-error">${esc(error)}</span>` : ''}${cancellable ? `<form method="post" action="${base(client)}/batches/${esc(batchId)}/deliveries/${esc(delivery.id)}/cancel">${csrf(user, 'cancel-delivery:' + delivery.id)}<button class="btn secondary publish-cancel" type="submit">Cancelar</button></form>` : ''}</div>`;
      }).join('');
      plans.push(`<section class="publish-plan"><a class="publish-thumb" href="${individualPath}" aria-label="Abrir ${esc(plan.source_title)}">${thumb}</a><div><h2><a href="${individualPath}">${esc(plan.source_title)}</a></h2>${states ? `<div class="publish-deliveries">${states}</div>` : '<span class="publish-state">Planejado</span>'}
        ${editable ? `<input type="hidden" name="plan_id" value="${esc(plan.id)}"><div class="publish-editor"><div><label for="due-${esc(plan.id)}">Data e hora</label><input id="due-${esc(plan.id)}" type="datetime-local" name="due_${esc(plan.id)}" min="${esc(inputSchedule.min)}" value="${esc(inputSchedule.value)}" required><div class="publish-network"><label><input type="checkbox" name="network_${esc(plan.id)}" value="instagram" ${plan.networks.includes('instagram')?'checked':''}> Instagram</label><label><input type="checkbox" name="network_${esc(plan.id)}" value="facebook" ${plan.networks.includes('facebook')?'checked':''}> Facebook</label></div></div><div><label for="ig-${esc(plan.id)}">Legenda do Instagram</label><textarea id="ig-${esc(plan.id)}" name="instagram_${esc(plan.id)}" maxlength="2200">${esc(plan.captions.instagram)}</textarea></div><div><label for="fb-${esc(plan.id)}">Legenda do Facebook</label><textarea id="fb-${esc(plan.id)}" name="facebook_${esc(plan.id)}" maxlength="4300">${esc(plan.captions.facebook)}</textarea></div></div>` : `<p class="publish-meta">${esc(new Date(plan.due_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</p>`}
      </div></section>`);
    }
    const batchActions = editable ? `<form method="post" action="${base(client)}/batches/${esc(batchId)}/cancel" onsubmit="return confirm('Cancelar este planejamento?')">${csrf(user,'cancel-batch:'+batchId)}<button class="btn secondary publish-danger" type="submit">Cancelar planejamento</button></form>`
      : confirmed ? `<div class="publish-actions"><form method="post" action="${base(client)}/batches/${esc(batchId)}/revise" onsubmit="return confirm('Para editar com segurança, o agendamento atual será cancelado e uma cópia editável será criada. Continuar?')">${csrf(user,'revise-batch:'+batchId)}<button class="btn secondary" type="submit">Editar agendamento</button></form><form method="post" action="${base(client)}/batches/${esc(batchId)}/cancel" onsubmit="return confirm('Cancelar todas as publicações futuras deste lote?')">${csrf(user,'cancel-batch:'+batchId)}<button class="btn secondary publish-danger" type="submit">Cancelar agendamento</button></form></div>` : '';
    const description = editable ? 'Planejamento editável. Nada será publicado antes da confirmação.'
      : confirmed ? 'Lote confirmado. Acompanhe cada rede.' : 'Agendamento cancelado. O histórico foi preservado.';
    send(res, wrap(`${result.batch.label} · ${client.name}`, user, `<div class="publish-heading"><div><h1>${esc(result.batch.label)}</h1><p>${description}</p></div><div class="publish-actions">${batchActions}<a href="${base(client)}">Voltar à agenda</a></div></div>${message ? `<div class="publish-notice">${esc(message)}</div>` : ''}
      ${editable ? `<form method="post" action="${base(client)}/batches/${esc(batchId)}/save">${csrf(user, 'save-batch:' + batchId)}${plans.join('')}<div class="publish-actions"><button class="btn secondary" type="submit">Salvar alterações</button><button class="btn" type="submit" formaction="${base(client)}/batches/${esc(batchId)}/review-confirmation">Revisar confirmação</button></div></form>` : plans.join('')}`));
  }

  async function saveBatch(req, res, user, client, batchId, reviewAfter = false) {
    const data = await mutation(req, user, 'save-batch:' + batchId);
    const result = await repository.getBatch(batchId, client.id);
    check(result.batch.status === 'draft', 'batch_locked', 'O lote já foi confirmado.', 409);
    const updates = result.plans.map(plan => {
      const selectedNetworks = core.networks(data.getAll('network_' + plan.id));
      return {
        id:plan.id,
        due_at:core.localSchedule(data.get('due_' + plan.id)),
        networks:selectedNetworks,
        captions:core.normalizeCaptions({
          instagram:data.get('instagram_' + plan.id) || '',
          facebook:data.get('facebook_' + plan.id) || ''
        }, selectedNetworks)
      };
    });
    await repository.updateBatch({batchId,clientId:client.id,updates});
    redirect(res, reviewAfter ? `${base(client)}/batches/${batchId}/confirm` : `${base(client)}/batches/${batchId}`);
  }

  async function planPage(res, user, client, batchId, planId) {
    const result = await repository.getBatch(batchId, client.id);
    const plan = result.plans.find(item => item.id === planId);
    check(plan, 'plan_not_found', 'Post agendado não encontrado.', 404);
    const individualPath = planPath(client,batchId,planId);
    const editable = result.batch.status === 'draft';
    const confirmed = result.batch.status === 'confirmed';
    const inputSchedule = editable ? scheduleInput(plan.due_at) : null;
    let displayAssets = [];
    const frozenAssets = plan.deliveries.find(delivery => delivery.snapshot)?.snapshot?.assets;
    if (frozenAssets?.length && assets.url) {
      try {
        displayAssets = await Promise.all(frozenAssets.map(async asset => ({...asset,url:await assets.url(asset.sha256)})));
      } catch { displayAssets = []; }
    }
    if (!displayAssets.length) {
      try {
        const current = await source.load(plan.post_id, client.id);
        displayAssets = current.assets.map(asset => ({...asset,url:imageUrl(plan.post_id,asset.file)}));
      } catch {}
    }
    const slides = displayAssets.length ? displayAssets.map(asset =>
      `<figure><img src="${esc(asset.url)}" alt="${esc(asset.label)}"><figcaption>${esc(asset.label)}</figcaption></figure>`
    ).join('') : '<div class="publish-notice publish-warning">As artes deste post não estão disponíveis para visualização.</div>';
    const deliveries = plan.deliveries.map(delivery => {
      const link = resultUrl(delivery);
      const error = errorName(delivery.error_code);
      const cancellable = ['scheduled','held','failed'].includes(delivery.status);
      const cancel = cancellable ? `<form method="post" action="${individualPath}/deliveries/${esc(delivery.id)}/cancel" onsubmit="return confirm('Cancelar esta entrega no ${networkName(delivery.network)}?')">${csrf(user,'cancel-delivery:'+delivery.id)}<button class="btn secondary publish-cancel" type="submit">Cancelar</button></form>` : '';
      return `<div class="publish-delivery"><span class="publish-state">${networkName(delivery.network)} · ${statusName(delivery.status)}</span>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver publicação</a>` : ''}${error ? `<span class="publish-error">${esc(error)}</span>` : ''}${cancel}</div>`;
    }).join('');
    const captions = plan.networks.map(network => `<section class="publish-field"><strong>Legenda do ${networkName(network)}</strong><div class="publish-caption">${esc(plan.captions[network] || '')}</div></section>`).join('');
    const confirmedActions = confirmed && plan.deliveries.some(delivery => ['scheduled','held','failed'].includes(delivery.status))
      ? `<div class="publish-actions"><form method="post" action="${individualPath}/revise">${csrf(user,'revise-plan:'+planId)}<button class="btn secondary" type="submit">Editar este post</button></form><form method="post" action="${individualPath}/cancel" onsubmit="return confirm('Cancelar todas as entregas futuras somente deste post?')">${csrf(user,'cancel-plan:'+planId)}<button class="btn secondary publish-danger" type="submit">Cancelar este post</button></form></div>` : '';
    const replacementNotice = editable && plan.replaces_plan_id
      ? '<div class="publish-notice">O agendamento atual continua ativo. Ele só será substituído quando esta nova versão for confirmada.</div>' : '';
    const editor = editable ? `<form class="publish-post-form" method="post" action="${individualPath}/save">${csrf(user,'save-plan:'+planId)}
      <div class="publish-field"><label for="plan-due">Data e hora</label><input id="plan-due" type="datetime-local" name="due_local" min="${esc(inputSchedule.min)}" value="${esc(inputSchedule.value)}" required><div class="publish-actions" style="margin-top:8px"><button class="btn secondary" id="plan-in-15" type="button">Daqui a 15 min</button></div></div>
      <fieldset class="publish-field" style="border:0;padding:0"><legend><strong>Redes</strong></legend><div class="publish-network"><label><input type="checkbox" name="network" value="instagram" ${plan.networks.includes('instagram')?'checked':''}> Instagram</label><label><input type="checkbox" name="network" value="facebook" ${plan.networks.includes('facebook')?'checked':''}> Facebook</label></div></fieldset>
      <div class="publish-field"><label for="plan-instagram">Legenda do Instagram</label><textarea id="plan-instagram" name="instagram" maxlength="2200">${esc(plan.captions.instagram || '')}</textarea></div>
      <div class="publish-field"><label for="plan-facebook">Legenda do Facebook</label><textarea id="plan-facebook" name="facebook" maxlength="4300">${esc(plan.captions.facebook || '')}</textarea></div>
      <div class="publish-actions"><button class="btn secondary" type="submit">Salvar este post</button>${result.plans.length === 1 ? `<button class="btn" type="submit" formaction="${individualPath}/review-confirmation">Salvar e revisar confirmação</button>` : ''}</div></form>
      <script>(()=>{const input=document.getElementById('plan-due');const button=document.getElementById('plan-in-15');const local=date=>{const pad=value=>String(value).padStart(2,'0');return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(date.getHours())+':'+pad(date.getMinutes())};button?.addEventListener('click',()=>{const minimum=new Date(Date.now()+5*60000);const target=new Date(Math.ceil((Date.now()+15*60000)/60000)*60000);input.min=local(minimum);input.value=local(target);});})();</script>`
      : `<div>${deliveries ? `<div class="publish-deliveries">${deliveries}</div>` : '<span class="publish-state">Sem entregas ativas</span>'}<p class="publish-meta">${esc(new Date(plan.due_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</p>${captions}${confirmedActions}</div>`;
    const status = editable ? 'Planejamento editável' : confirmed ? 'Agendamento confirmado' : 'Agendamento cancelado';
    send(res, wrap(`${plan.source_title} · ${client.name}`, user, `<div class="publish-heading"><div><h1>${esc(plan.source_title)}</h1><p>${esc(result.batch.label)} · ${status}</p></div><div class="publish-actions"><a href="/posts/${esc(plan.post_id)}/review">Editar artes</a><a href="${base(client)}/batches/${esc(batchId)}">Ver lote</a><a href="${base(client)}">Voltar à agenda</a></div></div>
      ${replacementNotice}<div class="publish-post-layout"><div><div class="publish-slide-grid">${slides}</div></div><div>${editor}</div></div>`));
  }

  async function savePlan(req, res, user, client, batchId, planId, reviewAfter = false) {
    const data = await mutation(req, user, 'save-plan:' + planId);
    const result = await repository.getBatch(batchId, client.id);
    check(result.batch.status === 'draft' && result.plans.some(plan => plan.id === planId),
      'plan_not_found', 'Post agendado não encontrado.', 404);
    if (reviewAfter) check(result.plans.length === 1, 'invalid_batch', 'Revise a confirmação do lote completo pela tela do lote.', 409);
    const selectedNetworks = core.networks(data.getAll('network'));
    await repository.updatePlan({batchId,planId,clientId:client.id,update:{
      due_at:core.localSchedule(data.get('due_local')),
      networks:selectedNetworks,
      captions:core.normalizeCaptions({instagram:data.get('instagram') || '',facebook:data.get('facebook') || ''}, selectedNetworks)
    }});
    redirect(res, reviewAfter ? `${base(client)}/batches/${batchId}/confirm` : planPath(client,batchId,planId));
  }

  async function revisePlan(req, res, user, client, batchId, planId) {
    await mutation(req, user, 'revise-plan:' + planId);
    const revised = await repository.revisePlan({batchId,planId,clientId:client.id,userId:user.id});
    redirect(res, planPath(client,revised.id,revised.plan_id));
  }

  async function cancelPlan(req, res, user, client, batchId, planId) {
    await mutation(req, user, 'cancel-plan:' + planId);
    await repository.cancelPlan({batchId,planId,clientId:client.id,userId:user.id});
    redirect(res, planPath(client,batchId,planId));
  }

  async function confirmationPage(res, user, client, batchId) {
    const result = await repository.getBatch(batchId, client.id);
    check(result.batch.status === 'draft', 'batch_locked', 'O lote já foi confirmado.', 409);
    const connections = await repository.connectionRows(client.id);
    const lines = [];
    for (const plan of result.plans) {
      const current = await source.load(plan.post_id, client.id);
      const snapshot = core.snapshot(plan, current, connections);
      lines.push(`<li><strong>${esc(plan.source_title)}</strong><br>${esc(new Date(plan.due_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))} · ${esc(snapshot.networks.map(networkName).join(' e '))} · ${esc(snapshot.assets.length)} artes</li>`);
    }
    const replacesExisting = result.plans.some(plan => plan.replaces_plan_id);
    const confirmationNotice = replacesExisting
      ? 'Ao confirmar, esta versão substituirá o agendamento atual. Até lá, o agendamento atual continua ativo.'
      : 'Depois da confirmação, o worker poderá publicar automaticamente nos horários abaixo.';
    send(res, wrap(`Confirmar ${result.batch.label}`, user, `<div class="publish-heading"><div><h1>Confirmar ${esc(result.batch.label)}</h1><p>Esta ação congela textos, artes, contas e horários.</p></div><a href="${base(client)}/batches/${esc(batchId)}">Voltar e editar</a></div>
      <div class="publish-confirm"><div class="publish-notice publish-warning">${esc(confirmationNotice)}</div><ol>${lines.join('')}</ol>
      <form method="post" action="${base(client)}/batches/${esc(batchId)}/confirm">${csrf(user, 'confirm-batch:' + batchId)}<label class="publish-rights"><input type="checkbox" name="rights_confirmed" value="yes" required><span>Confirmo que revisei as legendas, as artes, as contas e os horários e autorizo essas publicações.</span></label><button class="btn" type="submit">Confirmar e agendar ${result.plans.length} posts</button></form></div>`));
  }

  async function confirmBatch(req, res, user, client, batchId) {
    const data = await mutation(req, user, 'confirm-batch:' + batchId);
    check(data.get('rights_confirmed') === 'yes', 'rights_required', 'Confirme a autorização das publicações.');
    const result = await repository.getBatch(batchId, client.id);
    check(result.batch.status === 'draft', 'batch_locked', 'O lote já foi confirmado.', 409);
    const connections = await repository.connectionRows(client.id);
    const approvals = [];
    for (const plan of result.plans) {
      const current = await source.load(plan.post_id, client.id, {withBytes:true});
      const snapshot = core.snapshot(plan, current, connections);
      await assets.freeze(current);
      approvals.push({plan_id:plan.id,plan_version:plan.version,plan_fingerprint:core.planFingerprint(plan),snapshot});
    }
    await repository.confirmBatch({batchId,clientId:client.id,userId:user.id,approvals});
    redirect(res, `${base(client)}/batches/${batchId}`);
  }

  async function cancelDelivery(req, res, user, client, batchId, deliveryId, planId = '') {
    await mutation(req, user, 'cancel-delivery:' + deliveryId);
    await repository.cancelDelivery({deliveryId,batchId,clientId:client.id,userId:user.id});
    redirect(res, planId ? planPath(client,batchId,planId) : `${base(client)}/batches/${batchId}`);
  }

  async function cancelBatch(req, res, user, client, batchId) {
    await mutation(req, user, 'cancel-batch:' + batchId);
    await repository.cancelBatch({batchId,clientId:client.id,userId:user.id});
    redirect(res, `${base(client)}/batches/${batchId}`);
  }

  async function reviseBatch(req, res, user, client, batchId) {
    await mutation(req, user, 'revise-batch:' + batchId);
    const revised = await repository.reviseBatch({batchId,clientId:client.id,userId:user.id});
    redirect(res, `${base(client)}/batches/${revised.id}`);
  }

  return {
    enabled:true,
    media:(req,res,url) => assets.handle(req,res,url),
    bulkPlanner,
    link:(slug,user) => enabledClients.has(slug) && user?.nav_clients?.some(client => client.slug === slug)
      ? `<a class="btn secondary" href="/clients/${esc(slug)}/publishing">Agenda</a>` : '',
    async handle(req,res,user,url) {
      const match = url.pathname.match(/^\/clients\/([^/]+)\/publishing(?:\/(.*))?$/);
      if (!match || !enabledClients.has(match[1])) return false;
      try {
        const sub = match[2] || '';
        const client = await access.client(user, match[1], req.method === 'GET' ? 'read' : 'write');
        if (req.method === 'GET' && !sub) await overview(res,user,client,url);
        else if (req.method === 'GET' && sub === 'new') await newBatchPage(res,user,client);
        else if (req.method === 'POST' && sub === 'new') await createBatch(req,res,user,client);
        else if (req.method === 'POST' && /^from-bulk\/[a-f0-9-]{36}$/.test(sub)) {
          await createBulkBatch(req,res,user,client,sub.slice('from-bulk/'.length));
        }
        else {
          const planDelivery = sub.match(/^batches\/([a-f0-9-]{36})\/plans\/([a-f0-9-]{36})\/deliveries\/([a-f0-9-]{36})\/cancel$/);
          if (planDelivery) {
            check(req.method === 'POST', 'method', 'Método não permitido.', 405);
            await cancelDelivery(req,res,user,client,planDelivery[1],planDelivery[3],planDelivery[2]);
            return true;
          }
          const plan = sub.match(/^batches\/([a-f0-9-]{36})\/plans\/([a-f0-9-]{36})(?:\/(save|review-confirmation|revise|cancel))?$/);
          if (plan) {
            const [,batchId,planId,action=''] = plan;
            if (req.method === 'GET' && !action) await planPage(res,user,client,batchId,planId);
            else if (req.method === 'POST' && action === 'save') await savePlan(req,res,user,client,batchId,planId,false);
            else if (req.method === 'POST' && action === 'review-confirmation') await savePlan(req,res,user,client,batchId,planId,true);
            else if (req.method === 'POST' && action === 'revise') await revisePlan(req,res,user,client,batchId,planId);
            else if (req.method === 'POST' && action === 'cancel') await cancelPlan(req,res,user,client,batchId,planId);
            else check(false, 'method', 'Método não permitido.', 405);
            return true;
          }
          const delivery = sub.match(/^batches\/([a-f0-9-]{36})\/deliveries\/([a-f0-9-]{36})\/cancel$/);
          if (delivery) {
            check(req.method === 'POST', 'method', 'Método não permitido.', 405);
            await cancelDelivery(req,res,user,client,delivery[1],delivery[2]);
            return true;
          }
          const batch = sub.match(/^batches\/([a-f0-9-]{36})(?:\/(save|review-confirmation|confirm|cancel|revise))?$/);
          check(batch, 'not_found', 'Página não encontrada.', 404);
          const [,batchId,action=''] = batch;
          if (req.method === 'GET' && !action) await batchPage(res,user,client,batchId);
          else if (req.method === 'POST' && action === 'save') await saveBatch(req,res,user,client,batchId,false);
          else if (req.method === 'POST' && action === 'review-confirmation') await saveBatch(req,res,user,client,batchId,true);
          else if (req.method === 'GET' && action === 'confirm') await confirmationPage(res,user,client,batchId);
          else if (req.method === 'POST' && action === 'confirm') await confirmBatch(req,res,user,client,batchId);
          else if (req.method === 'POST' && action === 'cancel') await cancelBatch(req,res,user,client,batchId);
          else if (req.method === 'POST' && action === 'revise') await reviseBatch(req,res,user,client,batchId);
          else check(false, 'method', 'Método não permitido.', 405);
        }
      } catch (error) {
        const known = error instanceof SocialError;
        if (!known) console.error('[social-publishing] erro interno:', error);
        send(res, wrap('Agenda', user, `<h1>Não foi possível concluir</h1><p>${esc(known?error.message:'A agenda está indisponível. Tente novamente.')}</p><a href="/clients/${esc(match[1])}/publishing">Voltar à agenda</a>`), known?error.status:503);
      }
      return true;
    }
  };
}

module.exports = {createSocialPublishing, form, monthBounds, localParts, postNumber, scheduleInput};
