const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateDraft, simulate, planDraft, isoTime} = require('../contract.cjs');
const {fingerprint, approve, preflightPublish, deliveryAfterResult} = require('../approval-model.cjs');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname,'../exemplo-ficticio.json')));
const fixture = () => structuredClone(sample);
const actors = ['reviewer-local-fixture'];
const at = '2026-09-25T09:55:00-03:00';
function approval(d) { return approve(d,{actor:actors[0],allowedActors:actors,expectedFingerprint:fingerprint(d),at}); }
const ready = {now:'2026-09-25T10:00:00-03:00',enabled:true,allowedActors:actors,prerequisites:{media_verified:true,hosting_verified:true,accounts_verified:true,permissions_verified:true,storage_verified:true,quota_checked:true}};

test('origem comercial não pertence ao escopo editorial do Studio',()=>{
  const d=fixture();d.source.type='approved_ad';
  assert.throws(()=>validateDraft(d),/unsupported_source/);
});
test('conteúdo de outro cliente do Studio é recusado',()=>{
  const d=fixture();d.source.client_slug='outro-cliente';
  assert.throws(()=>validateDraft(d),/studio_client_out_of_scope/);
});
test('referência exige post e geração específicos do Studio',()=>{
  for(const key of ['post_id','generation_job_id']) {
    const d=fixture();delete d.source[key];
    assert.throws(()=>validateDraft(d),/studio_source_ids_required/);
  }
});
test('trocar geração do Studio invalida a aprovação anterior',()=>{
  const d=fixture(),a=approval(d);d.source.generation_job_id='outra-geracao';
  assert(preflightPublish(d,a,ready).reasons.includes('approval_missing_or_stale'));
});

test('quatro destinos distintos e nenhuma publicação habilitada',()=>{
  const result=simulate(fixture());
  assert.equal(result.jobs.length,4);
  assert.equal(new Set(result.jobs.map(x=>x.delivery_key)).size,4);
  assert.equal(result.publish_enabled,false);
  assert(result.review_cards.every(x=>!x.buttons_connected));
});
test('destino duplicado não cria dois trabalhos',()=>{
  const d=fixture();d.variants[1]=structuredClone(d.variants[0]);
  assert.throws(()=>planDraft(d),/duplicate_destination/);
});
test('URL, identificador de conta ou outro destino não substitui uma rede permitida',()=>{
  const d=fixture();d.variants[0].destination='https://example.com/publish';
  assert.throws(()=>planDraft(d),/unknown_destination/);
});
test('aprovação por pessoa não autorizada é recusada',()=>{
  const d=fixture();assert.throws(()=>approve(d,{actor:'other',allowedActors:actors,expectedFingerprint:fingerprint(d),at}),/unauthorized_reviewer/);
});
test('alterar legenda invalida a prévia e a aprovação anterior',()=>{
  const d=fixture(),a=approval(d);d.variants[0].caption='Texto alterado';
  assert.throws(()=>approve(d,{actor:actors[0],allowedActors:actors,expectedFingerprint:a.fingerprint,at}),/stale_preview/);
  assert(preflightPublish(d,a,ready).reasons.includes('approval_missing_or_stale'));
});
test('alterar mídia invalida aprovação mesmo mantendo o nome do arquivo',()=>{
  const d=fixture(),a=approval(d);d.variants[0].assets[0].sha256='c'.repeat(64);
  assert(preflightPublish(d,a,ready).reasons.includes('approval_missing_or_stale'));
});
test('alterar horário invalida aprovação',()=>{
  const d=fixture(),a=approval(d);d.scheduled_at='2026-09-25T11:00:00-03:00';
  assert(preflightPublish(d,a,ready).reasons.includes('approval_missing_or_stale'));
});
test('alterar destino invalida aprovação',()=>{
  const d=fixture(),a=approval(d);d.variants.pop();
  assert(preflightPublish(d,a,ready).reasons.includes('approval_missing_or_stale'));
});
test('flag desligada bloqueia mesmo com prévia aprovada',()=>{
  const d=fixture();assert(preflightPublish(d,approval(d),{...ready,enabled:false}).reasons.includes('publishing_disabled'));
});
test('pré-requisitos desconhecidos bloqueiam',()=>{
  const d=fixture();const r=preflightPublish(d,approval(d),{...ready,prerequisites:{}});
  assert.equal(r.allowed,false);assert(r.reasons.includes('permissions_verified'));assert(r.reasons.includes('quota_checked'));
});
test('sem horário, antes do horário e atraso maior que 15min não publica',()=>{
  let d=fixture();d.scheduled_at=null;
  assert(preflightPublish(d,approval(d),ready).reasons.includes('schedule_missing'));
  d=fixture();assert(preflightPublish(d,approval(d),{...ready,now:at}).reasons.includes('not_due'));
  assert(preflightPublish(d,approval(d),{...ready,now:'2026-09-25T10:16:00-03:00'}).reasons.includes('missed_window_requires_review'));
});
test('revisor removido não mantém autorização efetiva',()=>{
  const d=fixture();assert(preflightPublish(d,approval(d),{...ready,allowedActors:[]}).reasons.includes('reviewer_no_longer_allowed'));
});
test('datas ambíguas e dias inexistentes são recusados',()=>{
  assert.throws(()=>isoTime('2026-09-25T10:00:00'),/explicit_timezone/);
  assert.throws(()=>isoTime('2026-02-30T10:00:00-03:00'),/invalid_date/);
});
test('direitos e informação de origem de IA precisam estar declarados',()=>{
  const d=fixture();d.rights_confirmed=false;assert.throws(()=>validateDraft(d),/rights/);
  const e=fixture();delete e.variants[0].ai_generated;assert.throws(()=>validateDraft(e),/disclosure/);
});
test('artes diferentes de feed e story são exigidas quando a proporção não serve',()=>{
  const d=fixture();d.variants[1].assets[0].height=1350;
  assert.throws(()=>validateDraft(d),/vertical_variant/);
});
test('imagem Instagram fora da proporção é recusada',()=>{
  const d=fixture();d.variants[0].assets[0].height=1920;
  assert.throws(()=>validateDraft(d),/feed_aspect_ratio/);
});
test('metadados inválidos, PNG e arquivos grandes são recusados no perfil comum',()=>{
  for(const patch of [{bytes:-1},{mime:'image/png'},{bytes:8_000_001},{sha256:'unknown'}]){
    const d=fixture();Object.assign(d.variants[0].assets[0],patch);assert.throws(()=>validateDraft(d));
  }
});
test('stories com texto de legenda ou stickers não são silenciosamente publicados sem eles',()=>{
  const d=fixture();d.variants[1].caption='Texto que sumiria';assert.throws(()=>validateDraft(d),/story_text/);
  const e=fixture();e.variants[1].stickers=['link'];assert.throws(()=>validateDraft(e),/manual_handling/);
});
test('story de vídeo fora do limite comum é bloqueado',()=>{
  const d=fixture();Object.assign(d.variants[1].assets[0],{kind:'video',mime:'video/mp4',duration_seconds:61,fps:30,video_codec:'h264',audio_codec:'aac'});
  assert.throws(()=>validateDraft(d),/too_long/);
});
test('vídeo de feed Instagram é planejado como Reel compartilhado no feed',()=>{
  const d=fixture();Object.assign(d.variants[0].assets[0],{kind:'video',mime:'video/mp4',duration_seconds:30,fps:30,video_codec:'h264',audio_codec:'aac'});
  assert.equal(planDraft(d)[0].operation,'ig_reel_shared_to_feed');
});
test('rotulagem de parceria não confirmada exige revisão',()=>{
  const d=fixture();d.variants[0].paid_partnership=true;
  assert(preflightPublish(d,approval(d),ready).reasons.includes('partnership_label_capability_not_verified'));
});
test('resultado incerto de publicação não gera nova tentativa automática',()=>{
  const uncertain=deliveryAfterResult({state:'publishing',delivery_key:'ig'},{kind:'timeout'});
  assert.equal(uncertain.state,'uncertain');
  assert.throws(()=>deliveryAfterResult(uncertain,{kind:'confirmed',external_id:'1'}),/reconcile/);
});
test('sucesso em uma rede não é alterado pela falha da outra',()=>{
  const ig=deliveryAfterResult({state:'publishing',delivery_key:'ig'},{kind:'confirmed',external_id:'ig-1'});
  const fb=deliveryAfterResult({state:'publishing',delivery_key:'fb'},{kind:'definite_rejection',error_code:'permission_missing'});
  assert.equal(ig.state,'published');assert.equal(fb.state,'failed');
  assert.deepEqual(deliveryAfterResult(ig,{kind:'timeout'}),ig);
});
test('modelo permite trabalho só com todos os requisitos presentes',()=>{
  const d=fixture();assert.equal(preflightPublish(d,approval(d),ready).allowed,true);
});
test('JSON n8n só contém gatilho manual, código local e nota',()=>{
  const w=JSON.parse(fs.readFileSync(path.join(__dirname,'../workflow-simulacao-n8n.json')));
  assert.equal(w.active,false);
  assert(w.nodes.every(n=>['n8n-nodes-base.manualTrigger','n8n-nodes-base.code','n8n-nodes-base.stickyNote'].includes(n.type)));
  assert(w.nodes.every(n=>n.credentials===undefined));
  const script=w.nodes.find(n=>n.id==='plan').parameters.jsCode;
  const output=vm.runInNewContext('(function(){'+script+'})()',{$input:{all:()=>[{json:fixture()}]}},{timeout:1000});
  assert.equal(output[0].json.jobs.length,4);assert.equal(output[0].json.publish_enabled,false);
});
