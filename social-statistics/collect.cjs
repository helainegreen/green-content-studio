'use strict';
const {ACCOUNT_METRICS,MEDIA_METRICS,windowFor,metricValues,breakdownRows,follows,mediaRecord,safeFailure}=require('./model.cjs');
async function collect({meta,now=new Date(),deadlineMs=Date.now()+8*60*1000}) {
  const profile=await meta.profile();
  const failures=[];
  async function optional(label,callback,fallback) {
    if(Date.now()>deadlineMs) { failures.push(label);return fallback; }
    try { return await callback(); }
    catch(error) { if(safeFailure(error)!=='unavailable') throw error;failures.push(label);return fallback; }
  }
  const snapshots=[];
  for(const days of [7,30]) {
    const window=windowFor(days,now);
    const values=metricValues(await meta.account(window),ACCOUNT_METRICS);
    if(['views','reach','total_interactions'].every(key=>values[key]===null)) throw Error('account_metrics_unavailable');
    const followerChange=await optional('followers_'+days,async()=>follows(await meta.follows(window)),
      {gained:null,lost:null});
    snapshots.push({version:1,profile,window,metrics:values,follower_change:followerChange,collected_at:now.toISOString()});
  }
  const cities=await optional('cities',async()=>breakdownRows(await meta.cities(),'follower_demographics','city'),null);
  const demographics={timeframe:'this_month'};
  for(const dimension of ['gender','age']) {
    demographics[dimension]=await optional('demographics_'+dimension,
      async()=>breakdownRows(await meta.demographics(dimension),'follower_demographics',dimension),null);
  }
  const posts=[];const seen=new Set();const cursors=new Set();let after,complete=false,reason=null;
  const window30=windowFor(30,now);
  for(let page=0;page<4;page+=1) {
    const data=await optional('media_list',()=>meta.media(after),null);
    if(!Array.isArray(data?.data)) { reason='unavailable';break; }
    for(const raw of data.data.slice(0,25)) {
      const post=mediaRecord(raw);
      if(!post||seen.has(post.id)) continue;
      seen.add(post.id);
      if(Date.parse(post.timestamp)<window30.since*1000||Date.parse(post.timestamp)>window30.until*1000+999) continue;
      const metrics=await optional('media_'+post.id,
        async()=>metricValues(await meta.mediaInsights(post.id),MEDIA_METRICS,true),null);
      posts.push({...post,metrics});
      if(Date.now()>deadlineMs) { reason='time_limit';break; }
    }
    if(reason) break;
    if(!data.paging?.next) { complete=true;break; }
    after=data.paging?.cursors?.after;
    if(!after||cursors.has(after)) { reason='pagination_unavailable';break; }
    cursors.add(after);
  }
  if(!complete&&!reason) reason='limit';
  posts.sort((left,right)=>Date.parse(right.timestamp)-Date.parse(left.timestamp));
  const partial=failures.length>0||(!complete&&reason!=='limit');
  return {snapshots:snapshots.map(snapshot=>({...snapshot,version:2,cities,demographics,
    posts:{items:posts.filter(post=>Date.parse(post.timestamp)>=snapshot.window.since*1000&&
      Date.parse(post.timestamp)<=snapshot.window.until*1000+999),complete,reason},partial})),
    profile,collected_at:now.toISOString(),partial};
}
module.exports={collect};
