'use strict';
const crypto = require('node:crypto');
const NETWORKS = ['instagram', 'facebook'];
class FeedError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
function check(ok, code, message, status) { if (!ok) throw new FeedError(code, message, status); }
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function hash(v) { return crypto.createHash('sha256').update(stable(v)).digest('hex'); }
function scope(context) {
  check(context?.client_slug === 'community', 'wrong_client', 'Publicação disponível somente para o Community News.', 404);
  check(typeof context.post_id === 'string' && /^[\w-]{1,100}$/.test(context.post_id), 'invalid_post', 'Post inválido.', 404);
}
function text(v, limit, label) {
  check(typeof v === 'string' && !v.includes('\0') && [...v].length <= limit, 'invalid_text', `${label}: confira o tamanho do texto.`);
  return v.trim();
}
function localSchedule(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value), 'schedule_required', 'Escolha data e hora de Brasília.');
  const date = new Date(value + ':00-03:00');
  check(Number.isFinite(date.getTime()), 'invalid_schedule', 'Data inválida.');
  const formatted = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(date).replace(' ', 'T');
  check(formatted === value, 'invalid_schedule', 'Data inválida ou horário fora do fuso de Brasília.');
  return date.toISOString();
}
function emptyDraft(context) {
  scope(context);
  return {schema_version:1, post_id:context.post_id, source_digest:context.source_digest, generation_id:context.generation_id,
    networks:['instagram','facebook'], shared_caption:true, captions:{instagram:'',facebook:''},
    without_caption:{instagram:false,facebook:false}, facebook_link:'', assets:context.assets.slice(0,10).map(a=>({id:a.id,alt_text:''})),
    timing:'now', schedule_local:'', rights_confirmed:false, ai_generated:false, paid_partnership:false};
}
function normalize(input, context) {
  scope(context);
  check(input && input.post_id === context.post_id, 'wrong_post', 'O post da revisão mudou.', 409);
  check(Array.isArray(input.networks) && input.networks.length <= 2 && new Set(input.networks).size === input.networks.length && input.networks.every(n=>NETWORKS.includes(n)), 'invalid_networks', 'Escolha somente Instagram e Facebook.');
  check(Array.isArray(input.assets) && input.assets.length <= 10 && new Set(input.assets.map(a=>a.id)).size === input.assets.length, 'invalid_assets', 'Selecione até 10 imagens, sem repetir arquivos.');
  const ids = new Set(context.assets.map(a=>a.id));
  const assets = input.assets.map(a=>{
    check(ids.has(a.id), 'stale_asset', 'As artes mudaram. Atualize a página e revise a seleção.', 409);
    return {id:a.id,alt_text:text(a.alt_text ?? '',1000,'Texto alternativo')};
  });
  const shared = input.shared_caption === true;
  const captions = {instagram:text(input.captions?.instagram ?? '',2200,'Legenda do Instagram'),facebook:text(input.captions?.facebook ?? '',2200,'Legenda do Facebook')};
  const without = {instagram:input.without_caption?.instagram === true,facebook:input.without_caption?.facebook === true};
  let link = text(input.facebook_link ?? '',2048,'Link da matéria');
  if (link) {
    let url; try { url = new URL(link); } catch {}
    check(url && ['https:','http:'].includes(url.protocol) && !url.username && !url.password && !/[\r\n]/.test(link), 'invalid_link', 'Use um link http ou https válido para a matéria.');
    link = url.href;
  }
  check(['now','scheduled'].includes(input.timing), 'invalid_timing', 'Escolha publicar agora ou agendar.');
  const schedule = input.schedule_local || '';
  if (schedule) localSchedule(schedule);
  // Source comes only from the current server context. Review/save compare the old digest separately.
  return {schema_version:1,post_id:context.post_id,source_digest:context.source_digest,generation_id:context.generation_id,
    networks:[...input.networks],shared_caption:shared,captions,without_caption:without,facebook_link:link,assets,
    timing:input.timing,schedule_local:input.timing==='scheduled'?schedule:'',rights_confirmed:input.rights_confirmed===true,
    ai_generated:input.ai_generated===true,paid_partnership:input.paid_partnership===true};
}
function sameSource(input, context) {
  check(input.source_digest === context.source_digest && input.generation_id === context.generation_id, 'source_changed', 'A notícia ou as artes mudaram. Atualize a página e revise novamente.', 409);
}
function captionFor(draft, network) {
  const key = draft.shared_caption ? 'instagram' : network;
  let caption = draft.without_caption[key] ? '' : draft.captions[key];
  if (network === 'facebook' && draft.facebook_link) caption += (caption ? '\n\n' : '') + draft.facebook_link;
  return caption;
}
function review(input, context, now = new Date()) {
  sameSource(input, context);
  const draft = normalize(input, context);
  check(context.generation_status==='completed' && !context.generation_active, 'generation_unavailable', 'Aguarde a geração das artes terminar.');
  check(draft.networks.length > 0, 'network_required', 'Escolha pelo menos uma rede.');
  check(draft.assets.length > 0, 'media_required', 'Escolha pelo menos uma imagem.');
  check(draft.rights_confirmed, 'rights_required', 'Confirme que pode publicar as imagens selecionadas.');
  if (draft.timing === 'scheduled') check(Date.parse(localSchedule(draft.schedule_local)) > now.getTime(), 'past_schedule', 'O horário agendado precisa estar no futuro.');
  const available = new Map(context.assets.map(a=>[a.id,a]));
  for (const n of draft.networks) {
    const key = draft.shared_caption ? 'instagram' : n;
    check(draft.captions[key].length > 0 || draft.without_caption[key], 'caption_required', 'Preencha a legenda ou escolha explicitamente publicar sem legenda.');
    check(!(draft.captions[key].length > 0 && draft.without_caption[key]), 'caption_conflict', 'Limpe a legenda ou desmarque a opção de publicar sem legenda.');
  }
  const media = draft.assets.map(a=>{
    const original = available.get(a.id);
    check(original.mime==='image/jpeg' && original.bytes>0 && original.bytes<=8_000_000 && /^[a-f0-9]{64}$/.test(original.sha256), 'invalid_media', 'Uma imagem precisa ser gerada novamente em JPEG.');
    check(Number.isSafeInteger(original.width)&&original.width>0&&Number.isSafeInteger(original.height)&&original.height>0,'invalid_dimensions','Uma imagem está com dimensões inválidas.');
    if (draft.networks.includes('instagram')) check(original.width/original.height>=0.8 && original.width/original.height<=1.91, 'invalid_ratio', 'Uma imagem está fora da proporção aceita no feed do Instagram.');
    return {...a,sha256:original.sha256,mime:original.mime,width:original.width,height:original.height,bytes:original.bytes};
  });
  const snapshot = {...draft,assets:media};
  return {draft,snapshot,fingerprint:hash(snapshot),scheduled_at:draft.timing==='scheduled'?localSchedule(draft.schedule_local):null,
    previews:draft.networks.map(network=>({network,caption:captionFor(draft,network),assets:media})),
    capability_holds:[...(draft.paid_partnership?['paid_partnership']:[]),...(draft.ai_generated?['ai_disclosure']:[])]};
}
function seal(payload, secret) {
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return raw+'.'+crypto.createHmac('sha256',secret).update(raw).digest('base64url');
}
function unseal(token, secret, expected, now = Date.now()) {
  check(typeof token==='string' && token.length<8192, 'invalid_confirmation', 'Confirmação inválida.', 403);
  const parts=token.split('.');
  check(parts.length===2, 'invalid_confirmation', 'Confirmação inválida.',403);
  const signature=crypto.createHmac('sha256',secret).update(parts[0]).digest('base64url');
  check(parts[1].length===signature.length && crypto.timingSafeEqual(Buffer.from(parts[1]),Buffer.from(signature)), 'invalid_confirmation', 'Confirmação inválida.',403);
  let data;try{data=JSON.parse(Buffer.from(parts[0],'base64url'));}catch{}
  const maxLife=expected.purpose==='csrf'?8*60*60_000:15*60_000;
  check(data && data.expires>now && data.expires<=now+maxLife && Object.entries(expected).every(([k,v])=>data[k]===v), 'expired_confirmation', 'A confirmação expirou ou pertence a outra revisão. Revise novamente.',409);
  return data;
}
module.exports={FeedError,check,hash,scope,localSchedule,emptyDraft,normalize,sameSource,captionFor,review,seal,unseal};
