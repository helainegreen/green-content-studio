'use strict';
const c=require('./core.cjs'),edit=require('./edit.cjs'),images=require('./image-plan.cjs');
async function update(j,input,actor,adapter){
 c.check(j.status==='ready','not_ready','Aguarde a prévia terminar.',409);
 // Validate the original art before changing anything; also fences changes in the main Studio.
 const order=await adapter.normalizeSlideOrder(j,input.order);
 let {body:b,status}=edit.edit(j.body,input);b.revision=(b.revision||0)+1;delete b.question;
 b.slide_order=order;
 if(input.networks){c.check(Array.isArray(input.networks)&&input.networks.length<=2&&new Set(input.networks).size===input.networks.length&&input.networks.every(n=>['instagram','facebook'].includes(n)),'networks','Escolha Instagram e/ou Facebook.');b.editor_networks=[...input.networks];}
 const scope=input.feedback?.scope, guidance=c.text(input.feedback?.guidance||'',2000,true);
 c.check(!guidance||['caption','slides','titles','image'].includes(scope),'revision_scope','Escolha o que deseja ajustar.');
 c.check(!(guidance&&scope==='image'&&(input.plan||input.upload)),'image_conflict','Escolha entre ajustar a imagem atual e trocar a imagem.');
 let plan;if(input.plan)plan=images.normalize(j.body,input.plan,{confirm:true,actor});
 if(guidance&&scope==='image'){
  const reference=await adapter.imageEditReference(j);
  b.image_revision=(b.image_revision||1)+1;b.image_choice={kind:'ai'};
  b.image_edit={reference,guidance};images.syncLegacyChoice(b,actor);status='copy_ready';
 }
 if(plan){images.apply(b,plan);if(plan.cover.kind!=='existing')delete b.image_edit;status='copy_ready';}
 if(input.upload){c.check(!input.plan||plan.cover.kind==='existing','image_conflict','Escolha uma única imagem para a capa.');b.image_choice=await adapter.storeUpload(j,{...input.upload,actor});b.image_revision=(b.image_revision||1)+1;delete b.image_edit;images.syncLegacyChoice(b,actor);status='copy_ready';}
 if(guidance&&scope!=='image'){b.revision_request={scope,guidance,requested_at:new Date().toISOString(),actor};status='copy_ready';}
 if(status==='copy_ready'){
  b.previous_preview={image_job:j.body.image_job,render_job:j.body.render_job,ready_digest:j.body.ready_digest};
  b.pending_order=await adapter.orderPositions(j,order);
  // Keep existing jobs for caption-only AI feedback until the resulting text is checked.
  if(!b.revision_request||require('./carousel.cjs').sourceText(b)!==require('./carousel.cjs').sourceText(j.body)||input.plan||input.upload){delete b.image_job;delete b.render_job;delete b.ready_digest;}
 }
 return {body:b,status};
}
module.exports={update};
