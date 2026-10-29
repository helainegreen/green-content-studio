'use strict';
const crypto=require('node:crypto');
const ACTIVE=['queued','running'];
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
class ImageJobError extends Error {constructor(code,message,status=409){super(message);this.code=code;this.status=status;}}
function check(ok,code,message,status){if(!ok)throw new ImageJobError(code,message,status);}
function token(secret,user,scope,now=Date.now()) {
  const data=Buffer.from(JSON.stringify({u:user.id,s:scope,t:now,n:crypto.randomUUID()})).toString('base64url');
  return data+'.'+crypto.createHmac('sha256',secret).update('fr2-image:'+data).digest('base64url');
}
function verify(secret,value,user,scope,now=Date.now()) {
  check(typeof value==='string'&&value.length<1000,'reload','Atualize a página antes de solicitar a imagem.',400);
  const [data,sig,...extra]=value.split('.');
  const expected=crypto.createHmac('sha256',secret).update('fr2-image:'+data).digest('base64url');
  check(!extra.length&&typeof sig==='string'&&sig.length===expected.length&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)),'invalid_request','Pedido inválido. Atualize a página.',403);
  let d;try{d=JSON.parse(Buffer.from(data,'base64url').toString());}catch{}
  check(d?.u===user.id&&d.s===scope&&Number.isFinite(d.t)&&now-d.t>=0&&now-d.t<=24*3600000,'expired_request','Este formulário expirou. Atualize a página.',403);
  return hash(value);
}
function postIdFor(key){const h=hash('post:'+key);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function normalize(kind,form,payload={}) {
  check(['cover','internal'].includes(kind),'invalid_kind','Tipo de imagem inválido.',400);
  const prompts=(kind==='cover'?[form.ai_prompt]:String(form.ai_prompts||'').split(/\r?\n/)).map(v=>String(v||'').trim()).filter(Boolean);
  check(prompts.length>0&&prompts.length<=8&&prompts.every(p=>p.length<=8000),'invalid_prompt','Informe de 1 a 8 descrições, com até 8.000 caracteres cada.',400);
  const quality=String(form.ai_quality||'low');check(['low','medium','high'].includes(quality),'invalid_quality','Qualidade inválida.',400);
  return {prompts,quality,credit:String(form.credit||'Imagem gerada por IA').trim().slice(0,250),cover_payload:payload};
}
function basis(post,assets){return hash({id:post.id,type:post.type,title:post.source_title,text:post.source_text,assets:assets.map(a=>({id:a.id,role:a.role,order:a.display_order,credit:a.credit,updated_at:new Date(a.updated_at).toISOString()})).sort((a,b)=>a.id.localeCompare(b.id))});}
const messages={queued:'Pedido recebido. A imagem está na fila.',running:'Gerando imagem. Você pode sair desta página e voltar depois.',completed:'Imagens prontas e salvas na revisão.',failed:'Não foi possível concluir a geração. As imagens já salvas foram preservadas.',uncertain:'A geração foi interrompida sem confirmação do resultado. Não será repetida automaticamente.',review_needed:'Uma imagem ficou pronta, mas o post mudou durante a geração. Confira o arquivo antes de substituir a imagem atual.'};
function publicJob(job){if(!job)return {status:'idle',busy:false,message:'',completed:0,total:0,files:[]};
  return {id:job.id,status:job.status,busy:ACTIVE.includes(job.status),message:job.status==='review_needed'&&!job.state.items.some(i=>i.saved)?'O post mudou. O pedido foi interrompido antes de gerar outra imagem.':messages[job.status],completed:(job.state.items||[]).filter(i=>i.applied).length,total:job.payload.prompts.length,updated_at:job.updated_at,
    files:(job.state.items||[]).map((i,n)=>i.saved?{index:n,url:`/posts/${job.post_id}/image-generation/file/${job.id}/${n}`} : null).filter(Boolean)};
}
function classify(error){
  if(error?.code==='post_changed')return {status:'review_needed',code:'post_changed'};
  if(error instanceof ImageJobError)return {status:'failed',code:error.code};
  if(error?.providerStatus>=400&&error.providerStatus<500&&![408,409].includes(error.providerStatus))return {status:'failed',code:'provider_rejected'};
  return {status:'uncertain',code:'unconfirmed_result'};
}
module.exports={ACTIVE,escape,hash,ImageJobError,check,token,verify,postIdFor,normalize,basis,publicJob,classify};
