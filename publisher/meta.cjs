'use strict';
// Transport only. The durable executor must journal each write before calling this
// module. A timed-out write is uncertain and MUST NOT be retried automatically.
const {check}=require('../studio-module/core.cjs');
const IG_ACCOUNT='100000000000004';
const ID=/^\d{1,40}$/;
const POST_ID=/^\d{1,40}(?:_\d{1,40})?$/;
class MetaError extends Error {
  constructor(kind,status=0,code=null,subcode=null){
    super(kind==='uncertain'?'A Meta pode ter recebido a operação. Verifique o resultado antes de tentar novamente.':'Não foi possível concluir a operação na Meta.');
    this.name='MetaError';this.kind=kind;this.http_status=status;this.meta_code=code;this.meta_subcode=subcode;
  }
}
function numeric(v){check(typeof v==='string'&&ID.test(v),'invalid_meta_id','Identificação da Meta inválida.');return v;}
function text(v,max){check(typeof v==='string'&&!v.includes('\0')&&[...v].length<=max,'invalid_meta_text','Texto da publicação inválido.');return v;}
function createMeta({network,accountId,tokenProvider,mediaOrigin,fetchImpl=fetch,writesEnabled=false,timeoutMs=25_000}){
  check(['instagram','facebook'].includes(network),'invalid_network','Rede inválida.');numeric(accountId);
  if(network==='instagram')check(accountId===IG_ACCOUNT,'wrong_account','Conta diferente do Community News.');
  const origin=new URL(mediaOrigin);check(origin.protocol==='https:'&&origin.origin===mediaOrigin,'invalid_media_origin','Origem das imagens inválida.');
  const host=network==='instagram'?'https://graph.instagram.com':'https://graph.facebook.com';
  function imageUrl(value){
    let url;try{url=new URL(value);}catch{}
    check(url&&url.origin===mediaOrigin&&!url.username&&!url.password&&!url.hash&&/^\/community-publicacoes\/media\/[a-f0-9]{64}\.jpg$/.test(url.pathname),'invalid_media_url','Use somente a imagem aprovada desta publicação.');
    check(/^\d{10}$/.test(url.searchParams.get('expires')||'')&&/^[a-f0-9]{64}$/.test(url.searchParams.get('sig')||'')&&[...url.searchParams].length===2,'invalid_media_signature','Link da imagem inválido.');
    return url.href;
  }
  async function request(method,path,params={}){
    if(method==='POST')check(writesEnabled,'publishing_disabled','O envio real ainda está desativado.',412);
    // Paths are built only by the fixed methods below, never supplied by clients.
    const token=await tokenProvider();check(typeof token==='string'&&token.length>=20&&!/[\r\n]/.test(token),'token_unavailable','Reconecte a conta Meta.',503);
    const url=new URL('/v26.0/'+path,host),headers={'Authorization':'Bearer '+token,'Accept':'application/json'};
    let body;if(method==='GET')for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
    else{headers['Content-Type']='application/x-www-form-urlencoded';body=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));}
    let response,data;
    try{
      response=await fetchImpl(url.href,{method,headers,body,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      const raw=await response.text();if(raw.length>128_000)throw Error('response_too_large');data=JSON.parse(raw);
    }catch{throw new MetaError(method==='POST'?'uncertain':'unavailable',response?.status||0);}
    if(!response.ok||data.error){
      const error=data.error||{};
      // Only a complete Graph 4xx rejection is definitive. Never log raw messages,
      // request URLs, tokens, captions or upstream response bodies.
      const rejected=response.status>=400&&response.status<500&&Number.isInteger(error.code);
      throw new MetaError(method==='POST'&&!rejected?'uncertain':'rejected',response.status,Number.isInteger(error.code)?error.code:null,Number.isInteger(error.error_subcode)?error.error_subcode:null);
    }
    if(!data||typeof data!=='object'||Array.isArray(data))throw new MetaError(method==='POST'?'uncertain':'unavailable',response.status);
    return data;
  }
  async function write(path,params,pattern=ID){
    const data=await request('POST',path,params);
    if(typeof data.id!=='string'||!pattern.test(data.id))throw new MetaError('uncertain',200);
    return {id:data.id};
  }
  return {
    async identity(){
      const data=await request('GET','me',{fields:network==='instagram'?'user_id,username,account_type':'id,name,can_post'});
      const id=String(network==='instagram'?data.user_id:data.id);
      check(id===accountId,'wrong_account','A credencial pertence a outra conta Meta.',412);
      if(network==='instagram')check(data.username==='community'&&['BUSINESS','MEDIA_CREATOR'].includes(data.account_type),'wrong_account','A conta profissional do Community News não foi confirmada.',412);
      if(network==='facebook')check(data.can_post===true,'page_cannot_publish','A página não permite publicação com esta credencial.',412);
      return {id,name:network==='instagram'?data.username:data.name};
    },
    async quota(){
      check(network==='instagram','wrong_network','Limite disponível apenas para Instagram.');
      const d=await request('GET',accountId+'/content_publishing_limit',{fields:'config,quota_usage'});
      const q=d.data?.[0];check(Number.isInteger(q?.quota_usage)&&Number.isInteger(q?.config?.quota_total)&&q.config.quota_total>0,'quota_unavailable','Não foi possível verificar o limite de publicação.',503);
      return {used:q.quota_usage,total:q.config.quota_total};
    },
    createImage({url,caption='',altText='',carouselItem=false,aiGenerated=false}){
      check(network==='instagram','wrong_network','Operação exclusiva do Instagram.');
      const p={image_url:imageUrl(url),alt_text:text(altText,1000)};
      if(carouselItem===true)p.is_carousel_item='true';else{p.caption=text(caption,2200);if(aiGenerated===true)p.is_ai_generated='true';}
      return write(accountId+'/media',p);
    },
    createCarousel({children,caption='',aiGenerated=false}){
      check(network==='instagram','wrong_network','Operação exclusiva do Instagram.');
      check(Array.isArray(children)&&children.length>=2&&children.length<=10&&new Set(children).size===children.length,'invalid_children','Carrossel inválido.');
      return write(accountId+'/media',{media_type:'CAROUSEL',children:children.map(numeric).join(','),caption:text(caption,2200),...(aiGenerated===true?{is_ai_generated:'true'}:{})});
    },
    async containerStatus(id){
      check(network==='instagram','wrong_network','Operação exclusiva do Instagram.');
      const d=await request('GET',numeric(id),{fields:'status_code'});
      check(['IN_PROGRESS','FINISHED','PUBLISHED','ERROR','EXPIRED'].includes(d.status_code),'unknown_container_status','Estado da mídia desconhecido.',503);
      return {id,status:d.status_code};
    },
    publishContainer(id){
      check(network==='instagram','wrong_network','Operação exclusiva do Instagram.');
      return write(accountId+'/media_publish',{creation_id:numeric(id)});
    },
    uploadPhoto({url,altText=''}){
      check(network==='facebook','wrong_network','Operação exclusiva do Facebook.');
      return write(accountId+'/photos',{url:imageUrl(url),published:'false',alt_text_custom:text(altText,1000)});
    },
    publishPhotos({photos,caption=''}){
      check(network==='facebook','wrong_network','Operação exclusiva do Facebook.');
      check(Array.isArray(photos)&&photos.length>0&&photos.length<=10&&new Set(photos).size===photos.length,'invalid_photos','Seleção de fotos inválida.');
      const p={message:text(caption,4300),published:'true'};
      photos.forEach((id,i)=>{p['attached_media['+i+']']=JSON.stringify({media_fbid:numeric(id)});});
      return write(accountId+'/feed',p,POST_ID);
    },
    async publishedResult(id){
      check(typeof id==='string'&&(network==='instagram'?ID:POST_ID).test(id),'invalid_meta_id','Identificação da publicação inválida.');
      const d=await request('GET',id,{fields:network==='instagram'?'id,permalink':'id,permalink_url,is_published'});
      check(d.id===id,'wrong_result','A Meta retornou outra publicação.',503);
      const value=network==='instagram'?d.permalink:d.permalink_url;
      let link;try{link=new URL(value);}catch{}
      const domains=network==='instagram'?['www.instagram.com','instagram.com']:['www.facebook.com','facebook.com'];
      check(link?.protocol==='https:'&&domains.includes(link.hostname)&&!link.username&&!link.password,'invalid_permalink','O link da publicação ainda não foi confirmado.',503);
      if(network==='facebook')check(d.is_published===true,'not_published','A publicação ainda não foi confirmada na página.',503);
      return {id,url:link.href};
    }
  };
}
module.exports={createMeta,MetaError};
