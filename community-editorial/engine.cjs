'use strict';
const c=require('./core.cjs');
function createEngine({repo,source,research,generate,studio,manualExtract,reviseCopy}){let busy=false;
 return {async step(){if(busy)return {busy:true};busy=true;let j,b;try{j=await repo.claim();if(!j)return {idle:true};b=structuredClone(j.body);
 if(['manual_research_queued','manual_researching'].includes(j.status)){
  const result=await research.advance(b,body=>repo.checkpointManualResearch(j,body));
  if(result.pending){await repo.save(j,'manual_researching',b);return {stage:'manual_research',phase:b.research.phase};}
  if(result.needs_input){b.question='A pesquisa automática não encontrou uma fonte completa para confirmar esta pauta. Envie o link de uma matéria ou informe qual fonte deve ser usada. '+(result.question||'');await repo.save(j,'manual_needs_input',b,'manual_research_insufficient');return {stage:'manual_research_needs_input'};}
  b.source=result.source;b.manual.warnings=b.manual.warnings||[];
  if(result.source?.research?.limitations)b.manual.warnings.push(result.source.research.limitations);
  delete b.question;await repo.save(j,'manual_copy_queued',b);return {stage:'manual_research_ready'};
 }
 if(j.status==='manual_queued'){
  await repo.dispatched(j);const result=await manualExtract({...j,...b});
  b.manual.warnings=result.warnings||[];b.manual.extraction_provider_id=result.provider_id;
  if(result.needs_input){b.question=result.question;await repo.save(j,'manual_needs_input',b);return {stage:'manual_needs_input'};}
  b.source=result.source;await repo.save(j,'manual_copy_queued',b);return {stage:'manual_material_read'};
 }
 if(j.status==='manual_copy_queued'){
  await repo.dispatched(j);b.copy=await generate(b);
  c.check(!b.copy.needs_input,'manual_late_question','A geração de texto pediu um dado depois da leitura do material já ter sido concluída.');
  delete b.question;await repo.save(j,'manual_ready',b);return {stage:'manual_ready'};
 }
 if(['queued','fetching'].includes(j.status)){
  if(research){const result=await research.advance(b,body=>repo.checkpointResearch(j,body));
   if(result.pending){await repo.save(j,'fetching',b);return {stage:'research',phase:b.research.phase};}
   if(result.needs_input){b.question=result.question;await repo.save(j,'unavailable',b,b.research?.result?.timeliness?.status==='expired'?'topic_expired':'research_insufficient');return {stage:'research_attention'};}
   b.source=result.source;
  }else b.source=await source(b.topic);
  delete b.question;delete b.image_plan;await repo.save(j,'awaiting_images',b);return {stage:'awaiting_images'};
 }
 if(j.status==='copy_ready'){
  if(b.revision_request){
   await repo.dispatched(j);const before=require('./carousel.cjs').sourceText(b),result=await reviseCopy(b);
   b.copy=result.copy;b.last_revision={...b.revision_request,provider_id:result.provider_id};delete b.revision_request;
   if(require('./carousel.cjs').sourceText(b)===before&&b.ready_digest&&b.render_job){delete b.previous_preview;delete b.pending_order;await repo.save(j,'ready',b);return {stage:'revision_ready'};}
   delete b.image_job;delete b.render_job;delete b.ready_digest;await repo.save(j,'copy_ready',b);return {stage:'revision_text'};
  }
  if(!b.image_plan?.confirmed_at){await repo.save(j,'awaiting_images',b);return {stage:'awaiting_images'};}
  if(!b.copy){await repo.dispatched(j);b.copy=await generate(b);if(b.copy.needs_input){b.question=b.copy.question;await repo.save(j,'needs_input',b,'source_needs_input');return {stage:'needs_input'};}
   // Persist provider response before interacting with either database or paid image jobs.
   await repo.save(j,'copy_ready',b);return {stage:'copy'};
  }
  await studio.ensurePost(j,b);
  b.image_job=await studio.ensureImage(j,b);await repo.save(j,'image_pending',b);return {stage:'image'};
 }
 if(j.status==='image_pending'){
  const result=await studio.imageStatus(j,b);
  if(['queued','running'].includes(result.status)){await repo.save(j,'image_pending',b);return {stage:'waiting_image'};}
  if(result.status!=='completed'){b.question='A imagem precisa de conferência. O pedido não será repetido automaticamente.';await repo.save(j,result.status==='uncertain'?'uncertain':'needs_input',b,'image_'+result.status);return {stage:'image_attention'};}
  await studio.ensureInternals(j,b);b.render_job=await studio.ensureRender(j,b);await repo.save(j,'render_pending',b);return {stage:'render'};
 }
 if(j.status==='render_pending'){
  const result=await studio.renderStatus(j,b);
  if(['pending','running'].includes(result.status)){await repo.save(j,'render_pending',b);return {stage:'waiting_render'};}
  c.check(result.status==='completed','render_failed','A arte precisa ser gerada novamente.');b.ready_digest=await studio.readyDigest(j,b);if(b.pending_order&&studio.restoreOrder)await studio.restoreOrder(j,b);else if(b.slide_order?.generation_id!==b.render_job)delete b.slide_order;delete b.previous_preview;await repo.save(j,'ready',b);return {stage:'ready'};
 }
 return {stage:'idle'};
 }catch(e){if(!j)throw e;if(j){b=b||structuredClone(j.body);const code=e.code||'unconfirmed_result',message=e instanceof c.Fault?e.message:'Não foi possível concluir esta etapa. O pedido foi preservado.',uncertain=e.uncertain||!(e instanceof c.Fault),manual=['manual_queued','manual_research_queued','manual_researching','manual_copy_queued'].includes(j.status),quota=code==='provider_quota';let status;
  if(uncertain)status='uncertain';
  else if(b.origin==='manual'&&manual)status=quota?'manual_needs_input':'uncertain';
  else status=/^(research_|source_)/.test(code)?'unavailable':'needs_input';
  if(b.origin==='manual'&&manual&&!quota)delete b.question;else b.question=message;
  await repo.save(j,status,b,code).catch(()=>{});
 }return {error:true};}finally{busy=false;}}};
}
module.exports={createEngine};
