'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),c=require('./core.cjs'),{page}=require('./view.cjs');
async function body(req,limit=150000){c.check(req.headers['content-type']?.split(';')[0]==='application/json','json','Envie dados em JSON.',415);const chunks=[];let size=0;for await(const b of req){size+=b.length;c.check(size<=limit,'large','Pedido maior que o limite.',413);chunks.push(b);}try{return JSON.parse(Buffer.concat(chunks));}catch{throw new c.Fault('json','Dados inválidos.',400);}}
function respond(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function createEditorial({studioPool,Pool,uploadRoot,readOpenAiKey,env=process.env,dependencies={}}){
 if(env.FR2_EDITORIAL_ENABLED!=='true')return {internal:async()=>false,handle:async()=>false,link:()=>''};
 const allow=new Set((env.FR2_FEED_REVIEWER_IDS||'').split(',').filter(Boolean));let repo,adapter,engine,screener;
 const authorize=user=>user&&allow.has(user.id)&&user.nav_clients?.some(x=>x.slug==='community');
 function init(){if(repo)return;const db=new URL(env.FR2_FEED_DATABASE_URL||'');c.check(['postgres:','postgresql:'].includes(db.protocol)&&db.pathname==='/community_publicacoes'&&decodeURIComponent(db.username)==='community_publicacoes_app','db_config','Banco exclusivo indisponível.',503);c.check(env.FR2_FEED_ORIGIN==='https://studio.example.invalid'&&env.FR2_FEED_CSRF_SECRET?.length>=32,'config','Integração indisponível.',503);const p=dependencies.pool||new Pool({connectionString:db.href,max:3,connectionTimeoutMillis:3000,statement_timeout:5000,application_name:'community_editorial'});p.on?.('error',()=>console.error('Community News editorial: database unavailable'));const repoCandidate=dependencies.repo||require('./repository.cjs').createRepository(p);adapter=dependencies.adapter||require('./adapter.cjs').createAdapter({studioPool,publicationPool:p,uploadRoot,env});engine=dependencies.engine||require('./engine.cjs').createEngine({repo:repoCandidate,source:require('./source.cjs').fetchArticle,research:require('./research.cjs').createResearch({key:readOpenAiKey,model:env.FR2_EDITORIAL_TEXT_MODEL}),generate:b=>require('./generate.cjs').generate(b,readOpenAiKey(),env.FR2_EDITORIAL_TEXT_MODEL),studio:adapter,reviseCopy:b=>require('./revise-copy.cjs').revise(b,readOpenAiKey(),env.FR2_EDITORIAL_TEXT_MODEL),manualExtract:job=>require('./manual.cjs').extract(job,readOpenAiKey(),env.FR2_EDITORIAL_TEXT_MODEL,(j,a)=>adapter.readReference(j,a))});screener=dependencies.screener||require('./screening.cjs').createScreener({pool:p,research:require('./research.cjs').createResearch({key:readOpenAiKey,model:env.FR2_EDITORIAL_TEXT_MODEL,requestTimeoutMs:75000})});repo=repoCandidate;}
 const session=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('gcs_session='))||'';
 async function get(id){const j=await repo.get(c.uuid(id));c.check(j,'missing','Pedido não encontrado.',404);return j;}
 function failure(res,e){const known=e instanceof c.Fault||['FeedError','ImageJobError'].includes(e.constructor?.name);respond(res,{code:known?e.code:'unavailable',message:known?e.message:'O pedido foi preservado. Não foi possível concluir esta etapa.'},known?e.status:503);}
 const runner=env.FR2_EDITORIAL_SELF_RUNNER==='true'?require('./runner.cjs').startRunner({
  step:async()=>{init();return engine.step();},
  intervalMs:Number(env.FR2_EDITORIAL_RUNNER_INTERVAL_MS||5000),
  initialDelayMs:Number(env.FR2_EDITORIAL_RUNNER_INITIAL_DELAY_MS||1000),
 }):null;
 return {
 link(user){return authorize(user)?`<a class="btn secondary" href="${c.BASE}">Pautas e criação Community News</a><a class="btn secondary" href="${c.BASE}/agenda">Agenda Community News</a>`:'';},
 async internal(req,res,url){if(!url.pathname.startsWith(c.BASE+'/api/'))return false;try{c.check(req.method==='POST','method','Método inválido.',405);c.check(c.bearer(req.headers['x-fr2-editorial-key'],env.FR2_EDITORIAL_SERVICE_KEY),'denied','Integração não autorizada.',403);init();const input=await body(req);const action=url.pathname.slice((c.BASE+'/api/').length);
 if(action==='intake'){c.check(Array.isArray(input.topics)&&input.topics.length<=6,'topics','Envie até seis pautas.');const topics=await screener.approved(input.day,input.topics);respond(res,await repo.intake(input.day,topics));}
 else if(action==='qualify')respond(res,await screener.advance(input));
 else if(action==='health'){await repo.list();respond(res,{ok:true,client:'community',pilot:env.FR2_EDITORIAL_PILOT==='true',publication_enabled:env.FR2_EDITORIAL_PUBLISH_ENABLED==='true'&&env.FR2_FEED_PUBLISH_ENABLED==='true',runner:runner?runner.status():{enabled:false},writes:false});}
 else if(action==='tick')respond(res,await engine.step());
 else if(action==='events')respond(res,{events:await repo.events()});
 else if(action==='ack'){await repo.ack(c.uuid(input.id),c.uuid(input.lease_id));respond(res,{ok:true});}
 else throw new c.Fault('missing','Ação indisponível.',404);return true;
 }catch(e){failure(res,e);return true;}},
 async handle(req,res,user,url){if(url.pathname!==c.BASE&&!url.pathname.startsWith(c.BASE+'/'))return false;
 try{c.check(authorize(user),'denied','Acesso exclusivo à revisão do Community News.',403);c.check(session(req).length>12,'session','Entre novamente no Green Content.',403);init();const relative=url.pathname.slice(c.BASE.length);
 if(req.method==='GET'&&['/browser.js','/review-browser.js','/manual-browser.js','/progress.js','/style.css'].includes(relative)){res.writeHead(200,{'Content-Type':relative.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await fs.readFile(path.join(__dirname,relative.slice(1))));return true;}
 const m=relative.match(/^\/([a-f0-9-]{36})(?:\/(plan|generate|edit|revise|image|upload|prepare|confirm|photo|material|manual-file|manual-message|manual-accept|progress|order|update)(?:\/([a-f0-9]{24}))?)?$/);
 if(req.method==='GET'){
  if(m?.[2]==='progress'){const j=await get(m[1]);respond(res,{id:j.id,status:j.status,version:j.version,updated_at:j.updated_at});return true;}
  if(m?.[2]==='material'){const j=await get(m[1]);const im=j.origin==='manual'&&j.manual.attachments.find(i=>i.id===m[3]);c.check(im,'missing_photo','Arquivo indisponível.',404);const bytes=await adapter.readReference(j,im);res.writeHead(200,{'Content-Type':im.mime,...(im.type==='document'?{'Content-Disposition':require('./documents.cjs').disposition(im.name)}:{}),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(bytes);return true;}
  if(m?.[2]==='photo'){const j=await get(m[1]),im=j.source?.images.find(i=>i.id===m[3]);c.check(im,'missing_photo','Imagem indisponível.',404);const r=im.upload?{mime:im.mime,buffer:await adapter.readReference(j,im)}:await require('./source.cjs').safeGet(im.url,{binary:true});res.writeHead(200,{'Content-Type':r.mime,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(r.buffer);return true;}
  c.check(!relative||relative==='/new'||relative==='/agenda'||m&&!m[2],'missing','Página indisponível.',404);const data=relative==='/new'?{new_manual:true}:relative==='/agenda'?{calendar:await repo.calendar(url.searchParams.get('month')||'')}:m?{request:await get(m[1])}:await repo.list(require('./topics.cjs').listing(url.searchParams));if(data.request){data.request.preview=await adapter.preview(data.request);data.request.photo_options=require('./image-plan.cjs').photos(data.request);data.request.cover_fields=require('./carousel.cjs').coverFields(data.request);}data.pilot=env.FR2_EDITORIAL_PILOT==='true';data.publication_enabled=env.FR2_EDITORIAL_PUBLISH_ENABLED==='true'&&env.FR2_FEED_PUBLISH_ENABLED==='true';data.csrf=c.token(env.FR2_FEED_CSRF_SECRET,user.id,session(req));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});if(data.request)data.request=require('./manual.cjs').publicRequest(data.request);res.end(page(data));return true;
 }
 c.check(req.method==='POST','method','Método inválido.',405);c.check(req.headers.origin===env.FR2_FEED_ORIGIN,'origin','Origem inválida. Atualize a página.',403);c.verifyToken(env.FR2_FEED_CSRF_SECRET,req.headers['x-fr2-editorial-csrf'],user.id,session(req));const input=await body(req,['upload','manual-file','update'].includes(m?.[2])?11_500_000:150000);
 if(relative==='/manual-create'){const id=await repo.manualCreate(input,user.id),j=await repo.get(id);respond(res,{id,version:j.version});return true;}
 const topicAction=relative.match(/^\/topics\/([a-f0-9]{32})$/);
 if(topicAction){respond(res,await repo.reviewTopic(topicAction[1],input,user.id));return true;}
 if(relative==='/select'){respond(res,{ids:await repo.select(c.selection(input),user.id)});return true;}
 c.check(m&&m[2]&&!['photo','material','progress'].includes(m[2]),'missing','Ação indisponível.',404);const id=m[1],action=m[2];c.check(Number.isSafeInteger(input.version)&&input.version>0,'version','Atualize a revisão.',409);
 if(['prepare','confirm'].includes(action)){const result=await repo.locked(id,async j=>{c.check(j&&j.version===input.version,'stale','A versão mudou. Atualize a página.',409);return adapter[action](j,input,user.id,session(req));});respond(res,result);return true;}
 const updated=await repo.revise(id,input.version,user.id,async j=>{
  if(action.startsWith('manual-')){
   const manual=require('./manual.cjs');c.check(j.origin==='manual','manual_only','Este pedido não é uma pauta enviada por você.');
   c.check(manual.editable.has(j.status)||j.status==='uncertain'&&action==='manual-message'&&input.retry_confirmed===true,'busy','Aguarde a preparação antes de alterar o material.',409);
   const b=structuredClone(j.body);b.revision+=1;delete b.question;
   if(action==='manual-message')return manual.append(b,input);
   if(action==='manual-accept'){c.check(j.status==='manual_ready','manual_not_ready','Aguarde as sugestões de texto.',409);return manual.accept(b,input,user.id);}
   if(action==='manual-file'){
    const asset=await adapter.storeReference(j,input);
    if(b.manual.attachments.some(a=>a.id===asset.id))return {body:b,status:j.status};
    c.check(b.manual.attachments.length<6,'attachment_limit','Use até seis arquivos por pauta.');c.check(b.manual.attachments.reduce((n,a)=>n+a.bytes,0)+asset.bytes<=24000000,'attachment_limit','Use até 24 MB de arquivos nesta pauta.');
    c.check(!b.manual.attachments.some(a=>a.id===asset.id),'attachment_duplicate','Este arquivo já foi adicionado.');
    b.manual.attachments.push(asset);if(b.copy)b.manual.previous_copy=b.copy;delete b.copy;delete b.source;delete b.manual.approved_text;
    return {body:b,status:'manual_draft'};
   }
   throw new c.Fault('action','Ação inválida.');
  }
  if(action==='update')return require('./update.cjs').update(j,input,user.id,adapter);
  c.check(['ready','needs_input','awaiting_images','unavailable'].includes(j.status),'busy','Aguarde a preparação ou confira o pedido sem confirmação.',409);const b=structuredClone(j.body);b.revision+=1;delete b.question;
  if(action==='order'){c.check(j.status==='ready','not_ready','Aguarde as artes ficarem prontas antes de ordenar.',409);b.slide_order=await adapter.normalizeSlideOrder(j,input);return {body:b,status:'ready'};}
  if(action==='plan'||action==='generate'){
   c.check(b.source,'missing_source','Aguarde a leitura da matéria.');const images=require('./image-plan.cjs');
   if(action==='plan'){if(Object.hasOwn(input,'guidance'))b.guidance=c.text(input.guidance,2000,true);if(Object.hasOwn(input,'schedule_local'))b.schedule_local=c.schedule(input.schedule_local);b.image_plan_draft=input.plan?images.normalize(b,input.plan):images.draft(b,{resume:j.status==='awaiting_images'});delete b.image_plan;return {body:b,status:'awaiting_images'};}
   c.check(j.status==='awaiting_images','image_plan','Escolha as imagens antes de gerar.');
   b.guidance=c.text(input.guidance??b.guidance??'',2000,true);b.schedule_local=c.schedule(input.schedule_local??b.schedule_local??'');
   if(input.rewrite===true||b.copy?.needs_input)delete b.copy;
   images.apply(b,images.normalize(b,input.plan,{confirm:true,actor:user.id}));return {body:b,status:'copy_ready'};
  }
  if(action==='edit'){c.check(j.status==='ready','not_ready','Aguarde a preparação.');return require('./edit.cjs').edit(b,input);}
  delete b.image_job;delete b.render_job;
  if(action==='revise'){if(b.origin==='manual')return require('./manual.cjs').append(b,{message:c.text(input.guidance,2000)});if(input.source_url&&c.canonical(input.source_url)!==b.topic.url){b.topic.original_url=b.topic.original_url||b.topic.url;b.topic.url=c.canonical(input.source_url);b.topic.published_at=null;b.topic.publisher=new URL(b.topic.url).hostname;}b.guidance=c.text(input.guidance,2000);delete b.copy;delete b.source;delete b.research;delete b.image_plan;delete b.image_plan_draft;delete b.internal_choices;return {body:b,status:'queued'};}
  else if(action==='image'){
   b.image_revision=(b.image_revision||1)+1;
   c.check(j.status==='ready','not_ready','Aguarde a preparação.');
   if(input.kind==='ai'){b.image_choice={kind:'ai'};const guidance=c.text(input.guidance||'',1200,true);if(guidance)b.copy.cover_prompt+='\nOrientação da editora: '+guidance;}
   else{const im=b.source.images.find(x=>x.id===input.id);c.check(im&&input.rights_confirmed===true,'rights','Escolha a foto e confirme a autorização.');b.image_choice={...im,kind:'source',credit:c.text(input.credit,250),rights_confirmed:true,confirmed_by:user.id};}
  }else if(action==='upload'){b.image_revision=(b.image_revision||1)+1;c.check(j.status==='ready','not_ready','Aguarde a preparação.');b.image_choice=await adapter.storeUpload(j,{...input,actor:user.id});}
  else throw new c.Fault('action','Ação inválida.');require('./image-plan.cjs').syncLegacyChoice(b,user.id);return {body:b,status:'copy_ready'};
 });let request;if(action==='update'&&updated.status==='ready'){request=require('./manual.cjs').publicRequest({...updated,preview:await adapter.preview(updated),photo_options:require('./image-plan.cjs').photos(updated),cover_fields:require('./carousel.cjs').coverFields(updated)});}respond(res,{id:updated.id,status:updated.status,version:updated.version,...(request?{request}:{})});return true;
 }catch(e){failure(res,e);return true;}}
 };
}
module.exports={createEditorial,body};
