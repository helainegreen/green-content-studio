'use strict';
const c=require('./core.cjs');
const filters=['all','pending','in_progress','published','rejected','unavailable'];
function listing(params=new URLSearchParams()){
 const filter=params.get('filter')||'all',raw=params.get('page')||'1',page=Number(raw);
 c.check(filters.includes(filter)&&/^\d+$/.test(raw)&&Number.isSafeInteger(page)&&page>=1&&page<=100000,'invalid_filter','Confira o filtro da lista.');
 const topic=params.get('topic');c.check(!topic||/^[a-f0-9]{32}$/.test(topic),'invalid_topic','Confira o link da pauta.');return {filter:topic?'all':filter,page:topic?1:page,size:24,...(topic?{topic}:{})};
}
function review(topic,input,actor){
 const previous=topic.review||{};
 c.check(Number.isSafeInteger(input.version)&&input.version===(previous.version||0),'stale','Esta pauta mudou. Atualize a página.',409);
 c.check(['save','reject','restore'].includes(input.action),'invalid_action','Escolha uma ação válida.');
 const next={...previous,version:(previous.version||0)+1,actor,updated_at:new Date().toISOString()};
 if(input.action==='save'){
  c.check(previous.status!=='rejected','rejected','Recupere a pauta antes de editar.',409);
  Object.assign(next,{guidance:c.text(input.guidance||'',2000,true),schedule_local:c.schedule(input.schedule_local||''),source_url:input.source_url?c.canonical(input.source_url):'',status:'pending'});
 }else next.status=input.action==='reject'?'rejected':'pending';
 return {...topic,review:next};
}
function selectedTopic(topic,item){
 c.check(item.research===true||topic.screening?.status!=='unavailable','topic_unavailable','Esta pauta foi retirada pelo serviço por falta de informação atual.',409);
 c.check(topic.review?.status!=='rejected','rejected','Recupere a pauta antes de continuar.',409);
 if(item.version!==undefined)c.check(item.version===(topic.review?.version||0),'stale','Esta pauta mudou. Atualize a página.',409);
 const url=topic.review?.source_url||topic.screening?.source_url||topic.url;
 if(!url)return {...topic,url:null};
 const chosen=c.canonical(url),changed=chosen!==topic.url;
 return {...topic,url:chosen,...(changed?{original_url:topic.url,published_at:null,publisher:new URL(chosen).hostname}:{})};
}
module.exports={filters,listing,review,selectedTopic};
