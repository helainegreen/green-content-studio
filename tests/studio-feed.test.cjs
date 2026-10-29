'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const core=require('../studio-module/core.cjs');
const {createHandler}=require('../studio-module/http.cjs');
const {createStudioFeed,sourceProvider,readSafe,jpegSize}=require('../studio-module/studio.cjs');
const {createRepository}=require('../studio-module/repository.cjs');
const now=new Date('2026-09-25T12:00:00Z');
function context(){return {post_id:'post-1',client_slug:'community',title:'Notícia <script>nunca executar</script>',source_digest:'source-1',generation_id:'job-1',generation_status:'completed',generation_active:false,assets:[1,2].map(n=>({id:'asset-'+n,label:'Arte '+n,mime:'image/jpeg',bytes:4000,width:1080,height:1350,sha256:String(n).repeat(64)}))};}
function ready(c=context()){const d=core.emptyDraft(c);d.captions.instagram='Legenda editorial';d.rights_confirmed=true;return d;}
function memory(){let data=null;return {get:async()=>data&&structuredClone(data),save:async(id,draft,expected)=>{core.check((data?.version||0)===expected,'stale_version','Conflito',409);data={version:expected+1,draft:structuredClone(draft)};return structuredClone(data);}};}

test('legenda nasce vazia e não herda texto nem título da notícia',()=>{
  const c={...context(),source_text:'Texto longo que só serve para gerar as artes'};
  const d=core.emptyDraft(c);assert.deepEqual(d.captions,{instagram:'',facebook:''});
  assert.throws(()=>core.review({...d,rights_confirmed:true},c,now),/Preencha a legenda/);
});
test('geração com 11 artes começa com no máximo 10 selecionadas',()=>{
  const c=context();c.assets=Array.from({length:11},(_,i)=>({...c.assets[0],id:'asset-'+i}));
  const d=ready(c);assert.equal(d.assets.length,10);assert.equal(c.assets.length,11);
  assert.equal(core.review(d,c,now).previews[0].assets.length,10);
  d.assets.push({id:'asset-10',alt_text:''});assert.throws(()=>core.normalize(d,c),/até 10/);
});
test('legendas por rede e link exclusivo do Facebook aparecem na revisão exata',()=>{
  const c=context(),d=ready(c);d.shared_caption=false;d.captions.facebook='Outra legenda';d.facebook_link='https://news.example.invalid/noticia';
  const r=core.review(d,c,now);assert.equal(r.previews[0].caption,'Legenda editorial');assert.equal(r.previews[1].caption,'Outra legenda\n\nhttps://news.example.invalid/noticia');
  d.shared_caption=true;assert.equal(core.review(d,c,now).previews[1].caption,'Legenda editorial\n\nhttps://news.example.invalid/noticia');
});
test('publicar sem legenda exige escolha explícita e não ignora texto preenchido',()=>{
  const c=context(),d=ready(c);d.captions.instagram='';assert.throws(()=>core.review(d,c,now),/Preencha/);
  d.without_caption.instagram=true;assert.equal(core.review(d,c,now).previews[0].caption,'');
  d.captions.instagram='Não descartar';assert.throws(()=>core.review(d,c,now),/Limpe/);
});
test('agendamento usa Brasília, exige futuro e rejeita dia inexistente',()=>{
  const c=context(),d=ready(c);d.timing='scheduled';d.schedule_local='2026-09-25T10:00';assert.equal(core.review(d,c,now).scheduled_at,'2026-09-25T13:00:00.000Z');
  d.schedule_local='2026-09-25T08:00';assert.throws(()=>core.review(d,c,now),/futuro/);
  assert.throws(()=>core.localSchedule('2026-02-30T10:00'),/inválida/);
  d.timing='now';d.schedule_local='';assert.equal(core.review(d,c,now).scheduled_at,null);
});
test('ordem, texto alternativo e legenda integram a versão aprovada',()=>{
  const c=context(),d=ready(c),first=core.review(d,c,now).fingerprint;
  d.assets.reverse();const reordered=core.review(d,c,now);assert.notEqual(reordered.fingerprint,first);assert.equal(reordered.previews[0].assets[0].id,'asset-2');
  d.assets[0].alt_text='Descrição';assert.notEqual(core.review(d,c,now).fingerprint,reordered.fingerprint);
});
test('cliente, Stories, arquivos arbitrários e links executáveis são recusados',()=>{
  assert.throws(()=>core.emptyDraft({...context(),client_slug:'outro'}),/somente/);
  let d=ready();d.networks=['instagram.story'];assert.throws(()=>core.normalize(d,context()),/somente Instagram/);
  d=ready();d.assets[0].id='../../arquivo';assert.throws(()=>core.normalize(d,context()),/artes mudaram/);
  d=ready();d.facebook_link='javascript:alert(1)';assert.throws(()=>core.normalize(d,context()),/link http/);
});
test('nova geração, notícia alterada e imagem substituída invalidam confirmação',()=>{
  const c=context(),d=ready(c),first=core.review(d,c,now);
  assert.throws(()=>core.review(d,{...c,source_digest:'source-2'},now),/mudaram/);
  assert.throws(()=>core.review(d,{...c,generation_id:'job-2'},now),/mudaram/);
  const changed=structuredClone(c);changed.assets[0].sha256='f'.repeat(64);assert.notEqual(core.review(d,changed,now).fingerprint,first.fingerprint);
});
test('produção não aceita mídia incompleta nem geração em andamento',()=>{
  const c=context(),d=ready(c);assert.throws(()=>core.review(d,{...c,generation_active:true},now),/Aguarde/);
  c.assets[0].mime='image/png';assert.throws(()=>core.review(d,c,now),/JPEG/);
});
test('confirmação é vinculada à pessoa, sessão, revisão e prazo',()=>{
  const secret='s'.repeat(32),data={purpose:'publish',userId:'a',session:'s1',version:1,expires:now.getTime()+1000};
  const signed=core.seal(data,secret);assert.equal(core.unseal(signed,secret,{userId:'a',version:1},now.getTime()).version,1);
  for(const expected of [{userId:'b'},{session:'s2'},{version:2}])assert.throws(()=>core.unseal(signed,secret,expected,now.getTime()),/expirou/);
  assert.throws(()=>core.unseal(signed,secret,{},now.getTime()+2000),/expirou/);
  assert.throws(()=>core.unseal(signed+'x',secret,{},now.getTime()),/inválida/);
});
test('flag desligada não cria pool nem altera clientes existentes',async()=>{
  const app=createStudioFeed({Pool:class{constructor(){throw Error('não conectar');}},env:{}});
  assert.equal(app.link({client_slug:'community',id:'post-1'},{id:'user'}),'');assert.equal(await app.handle({},null,null,new URL('https://studio.invalid/posts/post-1/feed')),false);
});
test('acesso seguro a arquivos bloqueia traversal e symlink fora da geração',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fr2-files-'));
  try{
    await fs.mkdir(path.join(dir,'root','job'),{recursive:true});await fs.writeFile(path.join(dir,'outside.jpg'),'secret');
    await fs.symlink(path.join(dir,'outside.jpg'),path.join(dir,'root','job','escape.jpg'));
    for(const name of ['../../outside.jpg','escape.jpg'])await assert.rejects(readSafe(path.join(dir,'root'),path.join(dir,'root','job'),name));
    assert.throws(()=>jpegSize(Buffer.from('not a jpg')),/inválida/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('fonte não percorre imagens para servir o script',async()=>{
  let reads=0;const pool={query:async sql=>{reads++;
    if(sql.includes('FROM posts p'))return {rows:[{id:'p',slug:'community',source_title:'Título'}]};
    if(sql.includes('FROM generation_jobs'))return {rows:[{id:'job',status:'completed',output_dir:'/pasta-inexistente',result_json:{jpg_slides:[{slot:'capa_reels',jpg:'reels.jpg'},{slot:'capa',jpg:'capa.jpg'}]}}]};
    return {rows:[]};
  }};
  const source=sourceProvider(pool);const c=await source.getContext('p',{withAssets:false});assert.equal(c.assets.length,0);assert.equal(reads,3);
});
test('repositório recusa banco compartilhado e reverte versão concorrente',async()=>{
  let released=0,commands=[];
  const wrong={connect:async()=>({query:async()=>({rows:[{name:'studio'}]}),release:()=>released++})};
  await assert.rejects(createRepository(wrong).get('p'),/exclusivo/);assert.equal(released,1);
  const pool={connect:async()=>({query:async(sql)=>{commands.push(sql);if(sql.includes('current_database'))return {rows:[{name:'community_publicacoes'}]};if(sql.includes('SELECT version'))return {rows:[{version:2}]};return {rows:[]};},release:()=>released++})};
  await assert.rejects(createRepository(pool).save('p',ready(),1,'a'),/versão nova/);
  assert(commands.includes('ROLLBACK'));assert(!commands.some(x=>x.startsWith('INSERT')));
});

test('integração HTTP: rascunho, revisão, CSRF, concorrência e bloqueio de publicação real',async t=>{
  let c=context();const repo=memory();let handler;
  const server=http.createServer(async(req,res)=>{await handler(req,res,{id:'reviewer'},new URL(req.url,'http://127.0.0.1'));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port,base=origin+'/posts/post-1/feed';
  handler=createHandler({getContext:async()=>structuredClone(c),repo,origin,secret:'s'.repeat(32),authorize:u=>u.id==='reviewer',wrap:({body})=>body,clock:()=>now});
  const cookie='gcs_session=test-session.signature';
  const page=await fetch(base,{headers:{Cookie:cookie}});assert.equal(page.status,200);const html=await page.text();
  assert(!html.includes('<script>nunca executar</script>'));
  const boot=JSON.parse(html.match(/id="fr2-data">([^<]+)<\/script>/)[1]);
  const headers={'Content-Type':'application/json',Origin:origin,'X-FR2-CSRF':boot.csrf,Cookie:cookie};
  const post=(action,data,h=headers)=>fetch(base+'/'+action,{method:'POST',headers:h,body:JSON.stringify(data)});
  const d=ready(c);
  assert.equal((await post('save',{draft:d,expected_version:0},{...headers,Origin:'https://evil.invalid'})).status,403);
  assert.equal((await post('save',{draft:d,expected_version:0},{...headers,'X-FR2-CSRF':'bad'})).status,403);
  let r=await post('save',{draft:d,expected_version:0});assert.equal(r.status,200);assert.equal((await r.json()).record.version,1);
  assert.equal((await post('save',{draft:d,expected_version:0})).status,409);
  r=await post('review',{expected_version:1});const review=await r.json();assert.equal(r.status,200);assert.equal(review.can_confirm,false);
  r=await post('confirm',{expected_version:1,token:review.token});assert.equal(r.status,412);assert.equal((await r.json()).code,'publisher_not_connected');
  c={...c,source_digest:'news-updated'};assert.equal((await post('confirm',{expected_version:1,token:review.token})).status,409);
  const changedHtml=await(await fetch(base,{headers:{Cookie:cookie}})).text();const changed=JSON.parse(changedHtml.match(/id="fr2-data">([^<]+)<\/script>/)[1]);
  assert.equal(changed.record.draft.captions.instagram,'Legenda editorial');assert.equal(changed.record.draft.rights_confirmed,false);
});
