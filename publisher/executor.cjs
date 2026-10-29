'use strict';
const core=require('../studio-module/core.cjs');
const {ACCOUNTS}=require('./repository.cjs');
async function execute(job,{queue,api,assets,clock=()=>new Date()}){
  const state=structuredClone(job.state),snapshot=job.snapshot,now=clock();let writing=false;
  const finish=data=>queue.finish(job,{state,...data});
  async function write(operation,fn,save){
    const attempt=await queue.begin(job,operation);writing=true;
    let result;
    try{result=await fn();}catch(e){
      const rejected=e.kind==='rejected';
      // Unknown exceptions after dispatch are also uncertain. Never retry a write here.
      await finish({status:rejected?'failed':'uncertain',error:rejected?'meta_rejected_'+String(e.meta_code||0):'uncertain_write',attempt,attemptStatus:rejected?'rejected':'uncertain'});return;
    }
    save(result);await finish({attempt,attemptResult:result});
  }
  try{
    core.check(job.account_id===ACCOUNTS[job.network]&&snapshot.networks.includes(job.network),'account_mismatch','Conta inválida.');
    core.check(require('./disclosure.cjs').supported(snapshot),'unsupported_disclosure','Identificação de conteúdo pendente.');
    core.check(snapshot.assets.length>0&&snapshot.assets.length<=10,'invalid_snapshot','Revisão inválida.');
    if(state.published_id){
      const result=await api.publishedResult(state.published_id);await finish({status:'published',result});return;
    }
    if(!state.started_at&&now-new Date(job.due_at)>15*60_000){await finish({status:'held',error:'schedule_missed'});return;}
    if(state.started_at&&now-new Date(state.started_at)>20*60*60_000){await finish({status:'held',error:'preparation_expired'});return;}
    if(!state.started_at){await api.identity();if(job.network==='instagram'){const q=await api.quota();if(q.used>=q.total){await finish({status:'held',error:'quota_exhausted'});return;}}state.started_at=now.toISOString();}
    const caption=core.captionFor(snapshot,job.network);
    state.media=state.media||[];
    if(state.media.length<snapshot.assets.length){
      const a=snapshot.assets[state.media.length],url=await assets.url(a.sha256);
      if(job.network==='facebook')await write('upload_photo',()=>api.uploadPhoto({url,altText:a.alt_text}),r=>state.media.push({...r,ready:true}));
      else await write('create_image',()=>api.createImage({url,altText:a.alt_text,caption:snapshot.assets.length===1?caption:'',carouselItem:snapshot.assets.length>1,aiGenerated:snapshot.ai_generated}),r=>state.media.push({...r,ready:false}));
      return;
    }
    if(job.network==='facebook'){
      await write('publish_photos',()=>api.publishPhotos({photos:state.media.map(m=>m.id),caption}),r=>{state.published_id=r.id;});return;
    }
    const child=state.media.find(m=>!m.ready);
    if(child){
      const r=await api.containerStatus(child.id);
      if(['ERROR','EXPIRED','PUBLISHED'].includes(r.status)){await finish({status:r.status==='PUBLISHED'?'uncertain':'failed',error:'container_'+r.status.toLowerCase()});return;}
      if(r.status==='FINISHED')child.ready=true;
      await finish({delay:r.status==='FINISHED'?1000:30_000});return;
    }
    if(!state.container){
      if(state.media.length===1){state.container=state.media[0].id;state.container_ready=true;await finish({});}
      else await write('create_carousel',()=>api.createCarousel({children:state.media.map(m=>m.id),caption,aiGenerated:snapshot.ai_generated}),r=>{state.container=r.id;});return;
    }
    if(!state.container_ready){
      const r=await api.containerStatus(state.container);
      if(['ERROR','EXPIRED','PUBLISHED'].includes(r.status)){await finish({status:r.status==='PUBLISHED'?'uncertain':'failed',error:'container_'+r.status.toLowerCase()});return;}
      state.container_ready=r.status==='FINISHED';await finish({delay:state.container_ready?1000:30_000});return;
    }
    await write('publish_container',()=>api.publishContainer(state.container),r=>{state.published_id=r.id;});
  }catch(e){
    // A failure to journal a received answer leaves inflight intact. Lease recovery marks it uncertain.
    if(writing)throw e;
    const temporary=e.kind==='unavailable'||e.kind==='rejected';
    await finish({status:temporary?'scheduled':'held',error:temporary?'connection_unavailable':(e.code||'preflight_failed'),delay:5*60_000});
  }
}
module.exports={execute};
