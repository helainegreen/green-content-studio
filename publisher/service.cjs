'use strict';
const crypto=require('node:crypto');
const core=require('../studio-module/core.cjs');
function createService({queue,assets,source,enabled=false,aiImageDisclosure=false,clock=()=>new Date()}){
  return {
    async status(postId){return {enabled,deliveries:await queue.list(postId),connections:await queue.healthReport()};},
    async readiness(review){
      if(!enabled)return {can_confirm:false,message:'O envio real está desativado. Seu rascunho está salvo.'};
      if(review.capability_holds.some(h=>h!=='ai_disclosure'||!aiImageDisclosure||!require('./disclosure.cjs').supported(review.snapshot)))return {can_confirm:false,message:'Esta versão não publica conteúdo marcado como IA ou parceria comercial. A identificação exigida pela rede precisa ser configurada antes do envio.'};
      const ready=await queue.readiness(review.draft.networks);
      return {can_confirm:ready,message:ready?'Confira imagens, legenda, destinos e horário. A confirmação autoriza o envio desta versão.'+(review.draft.ai_generated?' IA: identificação nativa no Instagram e crédito explícito na legenda do Facebook.':''):'O serviço de publicação ou uma conexão Meta está indisponível. Seu rascunho está salvo.'};
    },
    async confirm({postId,record,review,actor,token,context}){
      const r=await this.readiness(review);core.check(r.can_confirm,'publisher_unavailable',r.message,503);
      await assets.freeze(context,review,source.getImage);
      const fresh=await source.getContext(postId);
      core.check(core.review(record.draft,fresh,clock()).fingerprint===review.fingerprint,'source_changed','A notícia ou as artes mudaram. Revise novamente.',409);
      const receipt=await queue.enqueue({postId,version:record.version,review,actor,confirmationKey:crypto.createHash('sha256').update(token).digest('hex'),now:clock()});
      return {...receipt,published:false,scheduled:true,message:receipt.duplicate?'Esta confirmação já foi recebida. Confira o histórico.':review.scheduled_at?'Agendamento confirmado. Acompanhe o resultado por rede abaixo.':'Envio autorizado e colocado na fila. Acompanhe o resultado por rede abaixo.'};
    },
    cancel:(postId,id,actor)=>queue.cancel(postId,id,actor),
    media:(req,res,url)=>assets.handle(req,res,url)
  };
}
module.exports={createService};
