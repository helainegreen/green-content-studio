'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),c=require('./core.cjs');
const imageCore=require('../image-jobs/core.cjs'),{snapshot,postLock}=require('../image-jobs/adapter.cjs');
const feedCore=require('../studio-module/core.cjs');
const {safeGet}=require('./source.cjs');
const carousel=require('./carousel.cjs'),slideOrder=require('./slide-order.cjs');
const imageQuality=require('./image-quality.cjs');
function guidanceUrls(value){return [...String(value||'').matchAll(/https:\/\/[^\s<>"')]+/gi)].map(match=>match[0].replace(/[.,;:!?]+$/,''));}
function referenceUrlFromGuidance(value){return guidanceUrls(value).find(raw=>{try{const u=new URL(raw);return u.hostname==='photos.app.goo.gl'||u.hostname==='photos.google.com'&&u.pathname.startsWith('/share/')||u.hostname==='lh3.googleusercontent.com'&&u.pathname.startsWith('/pw/');}catch{return false;}})||'';}
function googlePhotosImageUrl(html){const decoded=String(html||'').replaceAll('\\u003d','=').replaceAll('\\u0026','&');return decoded.match(/https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+/)?.[0]||'';}
function editorImagePrompt(b){
 const guidance=String(b.image_plan?.cover?.guidance||'').trim(),base=String(b.copy?.cover_prompt||'').trim();
 if(!guidance)return base;
 const reference=referenceUrlFromGuidance(guidance),direction=reference?guidance.replace(reference,'Use a imagem de referência anexada para reproduzir a geometria e a aparência do local.'):guidance;
 const material=(b.copy?.material_details||[]).map(detail=>detail?.quote).filter(Boolean).join('\n').slice(0,2400).trim();
 return [`DIREÇÃO PRIORITÁRIA DA EDITORA:\n${direction}`,
  material&&`DETALHES LITERAIS DO RELATO QUE DEVEM APARECER NA ILUSTRAÇÃO QUANDO FOREM VISUAIS:\n${material}`,
  'Crie uma ilustração editorial claramente representativa, sem identificar pessoas reais e sem sangue ou ferimentos. Preserve quantidades, posições, ações, veículo e elementos do local solicitados. Não omita pessoas, armas ou veículos mencionados pela editora. Não transforme o local em outra paisagem. A direção da editora e os detalhes literais acima substituem qualquer descrição anterior contraditória.'
 ].filter(Boolean).join('\n\n');
}
function createAdapter({studioPool,publicationPool,uploadRoot,env}){
 const images=require('../image-jobs/repository.cjs').createRepository(publicationPool);
 const source=require('../studio-module/studio.cjs').sourceProvider(studioPool);
 const drafts=require('../studio-module/repository.cjs').createRepository(publicationPool,{publishing:true});
 const publisher=require('../publisher/service.cjs').createService({queue:require('../publisher/repository.cjs').createQueue(publicationPool,{imageJobs:true,aiImageDisclosure:true}),assets:require('../publisher/assets.cjs').createAssets({directory:env.FR2_PUBLISH_ASSETS_DIR,origin:env.FR2_FEED_ORIGIN,secret:env.FR2_FEED_MEDIA_SECRET}),source,enabled:env.FR2_FEED_PUBLISH_ENABLED==='true'&&env.FR2_EDITORIAL_PUBLISH_ENABLED==='true',aiImageDisclosure:true});
 const credit=b=>b.image_choice?.kind==='source'||b.image_choice?.kind==='upload'?b.image_choice.credit:'Ilustração gerada por IA';
 async function file(job,bytes,mime){c.check(bytes.length>30&&bytes.length<=8_000_000,'image_size','Use uma imagem de até 8 MB.');const type=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;c.check(type&&type===mime,'image_type','Use uma imagem PNG, JPEG ou WebP válida.');const dir=path.join(uploadRoot,c.uuid(job.post_id));await fs.mkdir(dir,{recursive:true});const target=path.join(dir,'editorial-'+c.hash(bytes)+'.'+({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]));await fs.writeFile(target,bytes,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});return {path:target,mime,bytes:bytes.length,sha256:c.hash(bytes)};}
 async function editorReference(job,b){
  const shared=referenceUrlFromGuidance(b.image_plan?.cover?.guidance);if(!shared)return null;let imageUrl=shared;
  const input=new URL(shared);
  if(input.hostname!=='lh3.googleusercontent.com'){
   const page=await safeGet(shared);imageUrl=googlePhotosImageUrl(page.buffer.toString('utf8'));
   c.check(imageUrl,'image_reference_unavailable','O link do Google Fotos não apresentou uma imagem pública utilizável.');
  }
  if(!/=w\d+(?:-|$)/.test(imageUrl))imageUrl+='=w1600';
  const fetched=await safeGet(imageUrl,{binary:true}),asset=await file(job,fetched.buffer,fetched.mime);
  return {...asset,post_id:job.post_id,source_url:shared};
 }
 return {
 credit,
 async imageEditReference(j){c.check((!j.image_choice||j.image_choice.kind==='ai')&&j.image_job&&j.image_job!=='source','image_not_ai','Esta opção ajusta uma imagem de IA. Para fotos, escolha outra imagem.');const s=await snapshot(studioPool,j.post_id);const cover=s.assets.find(a=>a.role==='cover');c.check(cover,'image_reference','Imagem atual indisponível.');return require('./image-edit.cjs').reference(uploadRoot,j.post_id,cover.file_path);},
 async orderPositions(j,order){const ctx=await source.getContext(j.post_id);return order.asset_ids.map(id=>ctx.assets.findIndex(a=>a.id===id));},
 async restoreOrder(j,b){const ctx=await source.getContext(j.post_id),positions=b.pending_order;delete b.slide_order;if(positions.length===ctx.assets.length&&new Set(positions).size===positions.length&&positions.every(i=>i>=0&&i<ctx.assets.length))b.slide_order={generation_id:ctx.generation_id,asset_ids:positions.map(i=>ctx.assets[i].id)};else b.order_notice='O número de slides mudou. Confira a nova ordem antes de publicar.';delete b.pending_order;},
 async storeReference(j,input){const use=input.use;c.check(['reference','photo'].includes(use),'attachment_use','Escolha se o arquivo é uma referência ou foto disponível para a arte.');
  const bytes=Buffer.from(c.text(input.data,11_000_000),'base64');let asset;
  if(input.mime?.startsWith('image/'))asset=await file(j,bytes,input.mime);
  else{const doc=require('./documents.cjs').inspect(bytes,input),dir=path.join(uploadRoot,c.uuid(j.post_id)),sha256=c.hash(bytes);await fs.mkdir(dir,{recursive:true});const target=path.join(dir,'editorial-'+sha256+'.'+doc.extension);await fs.writeFile(target,bytes,{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});asset={path:target,mime:doc.mime,type:doc.type,bytes:bytes.length,sha256};}
  return {...asset,id:asset.sha256.slice(0,24),name:c.text(input.name||'Imagem enviada',180),use,credit:c.text(input.credit||'',250,true),rights_confirmed:false};
 },
 async readReference(j,asset){c.check(asset?.path&&path.dirname(asset.path)===path.join(uploadRoot,c.uuid(j.post_id))&&path.basename(asset.path).startsWith('editorial-'+asset.sha256),'invalid_path','Arquivo indisponível.',404);const bytes=await fs.readFile(asset.path);c.check(bytes.length<=8_000_000&&c.hash(bytes)===asset.sha256,'attachment_changed','O arquivo precisa ser reenviado.');return bytes;},
 async storeUpload(j,input){c.check(input.rights_confirmed===true,'rights','Confirme que pode usar essa imagem.');const bytes=Buffer.from(c.text(input.data,11_000_000),'base64');return {...await file(j,bytes,input.mime),kind:'upload',credit:c.text(input.credit,250),rights_confirmed:true,confirmed_by:input.actor};},
 async ensurePost(j,b){const unlock=await postLock(studioPool,j.post_id);try{
 const current=(await studioPool.query("SELECT p.*,c.slug AS client_slug FROM posts p JOIN clients c ON c.id=p.client_id WHERE p.id=$1",[j.post_id])).rows[0];
 c.check(!current||current.client_slug==='community','wrong_client','Post não pertence ao Community News.',403);
 if(current?.source_meta?.editorial_revision===b.revision)return;
 c.check(!current||current.source_meta?.editorial_request===j.id,'post_conflict','Post existente exige conferência.');
 const payload=carousel.sourceText(b);
 const meta={editorial_format:'carousel',community_carousel_mode:'compact',origin:b.origin||'email',origin_label:b.origin==='manual'?'Pauta enviada por você':'Solicitado por e-mail',editorial_request:j.id,editorial_revision:b.revision,canonical_story_id:j.topic_id,editorial_profile:c.PROFILE,image_plan:b.image_plan,source_urls:b.source.sources?.map(s=>s.url)||[b.source.url],user_guidance:b.guidance,caption:b.copy.caption,ai_generated:!b.image_choice||b.image_choice.kind==='ai'};
 c.check(!(await images.busy(j.post_id)),'image_busy','Aguarde a imagem atual.');
 await studioPool.query("INSERT INTO posts(id,client_id,type,source_title,source_text,source_meta,status) SELECT $1,id,'post_unico',$2,$3,$4,'draft' FROM clients WHERE slug='community' AND status='active' ON CONFLICT(id) DO UPDATE SET type=EXCLUDED.type,source_title=EXCLUDED.source_title,source_text=EXCLUDED.source_text,source_meta=EXCLUDED.source_meta,status='draft',updated_at=now()",[j.post_id,b.copy.headline,payload,meta]);
 }finally{await unlock();}},
 async ensureImage(j,b){const choice=b.image_choice;
 if(choice&&choice.kind!=='ai'){
  c.check(choice.rights_confirmed&&choice.credit,'rights','Escolha uma imagem com autorização de uso e crédito.');
  let asset;if(choice.kind==='source'){c.check(b.source.images.some(i=>i.id===choice.id&&i.url===choice.url),'invalid_image','Imagem não pertence à fonte.');if(choice.upload){await this.readReference(j,choice);asset=choice;}else{const fetched=await safeGet(choice.url,{binary:true});asset=await file(j,fetched.buffer,fetched.mime);}}else{c.check(path.dirname(choice.path)===path.join(uploadRoot,j.post_id),'invalid_path','Arquivo indisponível.');asset=choice;}
  const unlock=await postLock(studioPool,j.post_id);try{const id=imageCore.postIdFor('source:'+j.id+':'+b.revision);const conn=await studioPool.connect();await conn.query('BEGIN');try{await conn.query("DELETE FROM post_assets WHERE post_id=$1 AND role='cover' AND id<>$2",[j.post_id,id]);await conn.query("INSERT INTO post_assets(id,post_id,role,file_path,original_name,mime_type,size_bytes,display_order,credit) VALUES($1,$2,'cover',$3,'capa-editorial',$4,$5,1,$6) ON CONFLICT(id) DO NOTHING",[id,j.post_id,asset.path,asset.mime,asset.bytes,choice.credit]);await conn.query('COMMIT');}catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}return 'source';}finally{await unlock();}
 }
 c.check(env.FR2_IMAGE_JOBS_ENABLED==='true'&&env.FR2_IMAGE_WORKER_ENABLED==='true','image_config','A geração de imagens não está disponível.',503);
 const key='editorial:'+j.id+':'+(b.image_revision||1);const existing=await images.byRequest(key);if(existing)return existing.id;
 const unlock=await postLock(studioPool,j.post_id);try{const s=await snapshot(studioPool,j.post_id),prompt=editorImagePrompt(b);const payload=imageCore.normalize('cover',{ai_prompt:'[FR2_EDITORIAL_ILLUSTRATION_V1]\n'+prompt,credit:credit(b),ai_quality:imageQuality.DEFAULT});if(b.image_edit){payload.edit_reference=b.image_edit.reference;payload.prompts=['Ajuste a ilustração fornecida como referência. Preserve sua identidade visual e os elementos que não foram solicitados. Não inclua textos, logos ou marcas. Mantenha espaço livre para o título. Não represente vítimas ou pessoas reais como foto documental. Pedido da editora: '+b.image_edit.guidance];}else{const reference=await editorReference(j,b);if(reference){payload.edit_reference=reference;payload.prompts=['Use a imagem fornecida como referência visual do local. Preserve a geometria da curva, as pistas, defensas, postes, vegetação, construções e perspectiva reconhecíveis. Acrescente a cena solicitada sem substituir o local por outra paisagem. Composição vertical 4:5; concentre a ação na metade superior e mantenha a metade inferior escura e limpa para título. Sem textos, logos ou marcas. '+prompt];}}const job=await images.enqueue({postId:j.post_id,actor:j.actor,key,kind:'cover',payload,expectedBasis:s.basis});return job.id;}finally{await unlock();}
 },
 async imageStatus(j,b){return b.image_job==='source'?{status:'completed'}:await images.get(j.post_id,b.image_job)||{status:'missing'};},
 async ensureInternals(j,b){
  const choices=b.internal_choices||[];c.check(choices.length<=3,'internal_images','Escolha até três imagens internas.');
  const prefix='editorial-internal-'+j.id+'-',prepared=[];
  for(const im of choices){c.check(im.rights_confirmed&&im.credit&&b.source.images.some(x=>x.id===im.id&&x.url===im.url),'invalid_image','Confira as imagens internas e seus créditos.');
   const id=imageCore.postIdFor(prefix+im.id);let asset=(await studioPool.query("SELECT file_path AS path,mime_type AS mime,size_bytes AS bytes FROM post_assets WHERE id=$1 AND post_id=$2 AND role='internal'",[id,j.post_id])).rows[0];
   if(!asset){if(im.upload){await this.readReference(j,im);asset=im;}else{const fetched=await safeGet(im.url,{binary:true});asset=await file(j,fetched.buffer,fetched.mime);}}prepared.push({id,im,asset});
  }
  const unlock=await postLock(studioPool,j.post_id);try{const conn=await studioPool.connect();try{await conn.query('BEGIN');
   c.check(!(await conn.query("SELECT 1 FROM generation_jobs WHERE post_id=$1 AND status IN ('pending','running') LIMIT 1",[j.post_id])).rowCount,'render_busy','Aguarde a montagem em andamento.');
   c.check(!(await conn.query("SELECT 1 FROM post_assets WHERE post_id=$1 AND role='internal' AND coalesce(original_name,'') NOT LIKE $2 LIMIT 1",[j.post_id,prefix+'%'])).rowCount,'internal_conflict','As imagens internas foram alteradas no histórico. Confira antes de continuar.');
   await conn.query("DELETE FROM post_assets WHERE post_id=$1 AND role='internal' AND original_name LIKE $2 AND NOT(id=ANY($3::text[]))",[j.post_id,prefix+'%',prepared.map(x=>x.id)]);
   for(const [i,{id,im,asset}] of prepared.entries())await conn.query("INSERT INTO post_assets(id,post_id,role,file_path,original_name,mime_type,size_bytes,display_order,credit) VALUES($1,$2,'internal',$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET display_order=EXCLUDED.display_order,credit=EXCLUDED.credit",[id,j.post_id,asset.path,prefix+im.id,asset.mime,asset.bytes,i+2,im.credit]);
   await conn.query('COMMIT');}catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}}finally{await unlock();}
 },
 async ensureRender(j,b){const id=imageCore.postIdFor('editorial-render:'+j.id+':'+b.revision);await studioPool.query("INSERT INTO generation_jobs(id,post_id,status) VALUES($1,$2,'pending') ON CONFLICT(id) DO NOTHING",[id,j.post_id]);return id;},
 async renderStatus(j,b){return (await studioPool.query('SELECT status FROM generation_jobs WHERE id=$1 AND post_id=$2',[b.render_job,j.post_id])).rows[0]||{status:'missing'};},
 async readyDigest(j,b){return carousel.verifyContext(await source.getContext(j.post_id),b.render_job);},
 async preview(j){
  // A new revision clears render_job; keep the last completed art visible until its replacement is ready.
  const existing=await studioPool.query("SELECT 1 FROM posts p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND c.slug='community' AND c.status='active' AND EXISTS (SELECT 1 FROM generation_jobs g WHERE g.post_id=p.id AND g.status='completed')",[j.post_id]);
  if(!existing.rowCount)return null;const ctx=await source.getContext(j.post_id);return {assets:slideOrder.assets(ctx,j.slide_order),generation_id:ctx.generation_id,previous:j.status!=='ready',status:await publisher.status(j.post_id)};
 },
 async normalizeSlideOrder(j,input){const context=await source.getContext(j.post_id);c.check(context.source_digest===j.ready_digest,'source_changed','As artes mudaram. Abra a versão atual antes de ordenar.',409);return slideOrder.normalize(input,context);},
 async prepare(j,input,actor,session){c.check(j.status==='ready','not_ready','Aguarde a versão recomendada ficar pronta.',409);c.fresh(j);const context=await source.getContext(j.post_id);c.check(context.source_digest===j.ready_digest,'source_changed','O texto ou a arte mudou no Green Content. Prepare uma nova versão antes de aprovar.',409);const ai=!j.image_choice||j.image_choice.kind==='ai';const ordered=slideOrder.assets(context,j.slide_order);const draft=feedCore.emptyDraft(context);draft.assets=ordered.map(a=>({id:a.id,alt_text:''}));draft.networks=input.networks;draft.captions={instagram:require('./caption.cjs').compose(j),facebook:require('./caption.cjs').compose(j)};draft.rights_confirmed=input.rights_confirmed===true;draft.ai_generated=ai;draft.timing=j.schedule_local?'scheduled':'now';draft.schedule_local=j.schedule_local||'';
 const normalized=feedCore.normalize(draft,context);const old=await drafts.get(j.post_id);const record=await drafts.save(j.post_id,normalized,old?.version||0,actor);const review=feedCore.review(record.draft,context);const readiness=await publisher.readiness(review);const token=feedCore.seal({purpose:'publish',requestId:j.id,requestVersion:j.version,postId:j.post_id,userId:actor,session:c.hash(session),version:record.version,fingerprint:review.fingerprint,expires:Date.now()+10*60000},env.FR2_FEED_CSRF_SECRET);return {token,version:record.version,...readiness,caption:review.previews[0].caption,networks:normalized.networks,schedule_local:j.schedule_local,assets:ordered};},
 async confirm(j,input,actor,session){c.check(j.status==='ready','not_ready','A revisão mudou.',409);c.fresh(j);const context=await source.getContext(j.post_id);c.check(context.source_digest===j.ready_digest,'source_changed','A arte ou o texto mudou. Revise novamente.',409);const record=await drafts.get(j.post_id);c.check(record,'no_draft','Revise a publicação novamente.');require('./caption.cjs').verify(j,record.draft);slideOrder.verifyDraft(record.draft,context,j.slide_order);const review=feedCore.review(record.draft,context);feedCore.unseal(input.token,env.FR2_FEED_CSRF_SECRET,{purpose:'publish',requestId:j.id,requestVersion:j.version,postId:j.post_id,userId:actor,session:c.hash(session),version:record.version,fingerprint:review.fingerprint});return publisher.confirm({postId:j.post_id,record,review,actor,token:input.token,context});},
 };
}
module.exports={createAdapter,guidanceUrls,referenceUrlFromGuidance,googlePhotosImageUrl,editorImagePrompt};
