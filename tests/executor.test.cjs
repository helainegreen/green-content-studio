'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execute}=require('../publisher/executor.cjs'),{createAssets}=require('../publisher/assets.cjs'),{createService}=require('../publisher/service.cjs');
const core=require('../studio-module/core.cjs');
const now=new Date('2026-09-24T12:00:00Z');
function fixture(network='instagram',count=2){
  const calls=[],attempts=[],job={id:'delivery',network,account_id:network==='instagram'?'100000000000004':'100000000000006',due_at:now,state:{},lease_id:'lease',snapshot:{networks:[network],assets:Array.from({length:count},(_,i)=>({sha256:String(i+1).repeat(64),alt_text:'Arte '+i})),shared_caption:false,captions:{instagram:'IG aprovada',facebook:'FB aprovada'},without_caption:{},facebook_link:'https://news.example.invalid/noticia'}};
  const queue={begin:async(j,op)=>{attempts.push(op);job.inflight=op;return 'attempt';},finish:async(j,x)=>{Object.assign(job,{...x,state:structuredClone(x.state),inflight:null});calls.push(['finish',x.status||'scheduled']);}};
  const api={identity:async()=>({}),quota:async()=>({used:0,total:100}),createImage:async x=>{calls.push(['image',x]);return{id:String(100+calls.length)};},createCarousel:async x=>{calls.push(['carousel',x]);return{id:'999'};},containerStatus:async()=>({status:'FINISHED'}),publishContainer:async x=>{calls.push(['publish',x]);return{id:'1000'};},uploadPhoto:async x=>{calls.push(['photo',x]);return{id:String(200+calls.length)};},publishPhotos:async x=>{calls.push(['publish',x]);return{id:'100000000000006_1000'};},publishedResult:async id=>({id,url:'https://www.'+network+'.com/p/result'})};
  const deps={queue,api,assets:{url:async h=>'https://media.invalid/'+h},clock:()=>now};
  return {job,deps,calls,attempts};
}
test('carrossel é preparado na ordem, publicado uma vez e confirmado pelo ID retornado',async()=>{
  const f=fixture();for(let i=0;i<15&&f.job.status!=='published';i++)await execute(f.job,f.deps);
  assert.equal(f.job.status,'published');assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);
  assert.equal(f.calls.find(c=>c[0]==='carousel')[1].caption,'IG aprovada');
  assert.equal(f.calls.filter(c=>c[0]==='image').length,2);
  assert.deepEqual(f.attempts,['create_image','create_image','create_carousel','publish_container']);
});
test('foto única não cria carrossel e mantém legenda',async()=>{
  const f=fixture('instagram',1);for(let i=0;i<10&&f.job.status!=='published';i++)await execute(f.job,f.deps);
  assert.equal(f.job.status,'published');assert.equal(f.calls.find(c=>c[0]==='image')[1].caption,'IG aprovada');assert(!f.calls.some(c=>c[0]==='carousel'));
});
test('Facebook publica fotos na ordem com legenda e link exclusivos',async()=>{
  const f=fixture('facebook');for(let i=0;i<8&&f.job.status!=='published';i++)await execute(f.job,f.deps);
  assert.equal(f.job.status,'published');assert.equal(f.calls.find(c=>c[0]==='publish')[1].caption,'FB aprovada\n\nhttps://news.example.invalid/noticia');assert.deepEqual(f.attempts,['upload_photo','upload_photo','publish_photos']);
});
test('timeout de escrita deixa incerto, sem segunda chamada nem resultado falso',async()=>{
  const f=fixture();f.deps.api.createImage=async()=>{throw Object.assign(Error(),{kind:'uncertain'});};await execute(f.job,f.deps);
  assert.equal(f.job.status,'uncertain');assert.equal(f.attempts.length,1);assert.equal(f.job.result,undefined);
});
test('resposta de rejeição Meta é terminal; não cria outra mídia',async()=>{
  const f=fixture();f.deps.api.createImage=async()=>{throw Object.assign(Error(),{kind:'rejected',meta_code:190});};await execute(f.job,f.deps);assert.equal(f.job.status,'failed');assert.equal(f.job.error,'meta_rejected_190');
});
test('queda ao persistir resposta preserva operação em voo para recuperação',async()=>{
  const f=fixture();f.deps.queue.finish=async()=>{throw Error('db unavailable');};await assert.rejects(execute(f.job,f.deps));assert.equal(f.job.inflight,'create_image');assert.equal(f.attempts.length,1);
});
test('reserva perdida antes do envio não chama Meta',async()=>{
  const f=fixture();f.deps.queue.begin=async()=>{throw Object.assign(Error(),{code:'lost_lease'});};await execute(f.job,f.deps);assert(!f.calls.some(c=>c[0]==='image'));
});
test('ID já retornado só consulta resultado, mesmo depois do horário',async()=>{
  const f=fixture();f.job.state.published_id='1000';f.job.due_at='2020-01-01';await execute(f.job,f.deps);assert.equal(f.job.status,'published');assert.equal(f.attempts.length,0);
});
test('horário perdido, limite esgotado, IA e conta errada bloqueiam antes de escrever',async()=>{
  for(const modify of [f=>f.job.due_at=new Date(now-16*60_000),f=>f.deps.api.quota=async()=>({used:100,total:100}),f=>f.job.snapshot.ai_generated=true,f=>f.job.account_id='1']){
    const f=fixture();modify(f);await execute(f.job,f.deps);assert.equal(f.job.status,'held');assert.equal(f.attempts.length,0);
  }
});
test('processamento pendente aguarda; PUBLISHED inesperado exige conferência',async()=>{
  const f=fixture();await execute(f.job,f.deps);await execute(f.job,f.deps);f.deps.api.containerStatus=async()=>({status:'IN_PROGRESS'});await execute(f.job,f.deps);assert.equal(f.job.delay,30000);
  f.deps.api.containerStatus=async()=>({status:'PUBLISHED'});await execute(f.job,f.deps);assert.equal(f.job.status,'uncertain');assert.equal(f.attempts.length,2);
});
test('alteração da data da notícia altera assinatura da origem',()=>{assert.notEqual(core.hash({updated:new Date('2026-01-01')}),core.hash({updated:new Date('2026-01-02')}));});
test('mídia aprovada é imutável e links expirados ou alterados são recusados',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'fr2-media-'));let clock=now.getTime();
  try{
    const bytes=Buffer.from([255,216,1,2,3,255,217]),hash=crypto.createHash('sha256').update(bytes).digest('hex');
    const store=createAssets({directory,origin:'https://studio.invalid',secret:'s'.repeat(32),clock:()=>clock}),review={snapshot:{assets:[{sha256:hash,bytes:bytes.length}]}};
    await store.freeze({},review,async()=>bytes);const signed=await store.url(hash);
    const request=async url=>{let code,body;await store.handle({method:'GET'},{writeHead:c=>code=c,end:b=>body=b},new URL(url));return{code,body};};
    assert.equal((await request(signed)).code,200);assert.equal((await request(signed.replace('sig=','sig=f'))).code,404);
    clock+=86401*1000;assert.equal((await request(signed)).code,404);
    await assert.rejects(store.freeze({},review,async()=>Buffer.from('changed')));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('serviço exige estado saudável e recusa mudança de origem após copiar imagens',async()=>{
  let queued=0;const context={client_slug:'community',post_id:'p',source_digest:'s',generation_id:'g',generation_status:'completed',assets:[{id:'a',sha256:'a'.repeat(64),mime:'image/jpeg',bytes:20,width:1080,height:1350}]};
  const draft=core.emptyDraft(context);draft.captions.instagram='Aprovada';draft.rights_confirmed=true;
  const review=core.review(draft,context,now),service=createService({enabled:true,queue:{readiness:async()=>true,enqueue:async()=>queued++},assets:{freeze:async()=>{}},source:{getContext:async()=>({...context,source_digest:'changed'})},clock:()=>now});
  await assert.rejects(service.confirm({postId:'p',record:{draft},review,actor:'u',token:'t',context}));assert.equal(queued,0);
});
