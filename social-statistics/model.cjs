'use strict';
const DAY=86400;
const INTERVAL_MS=6*60*60*1000;
const ACCOUNT_METRICS=['views','reach','total_interactions','accounts_engaged','likes','comments','saves','shares'];
const MEDIA_METRICS=['views','reach','total_interactions','likes','comments','saved','shares'];
function count(value) { return Number.isSafeInteger(value)&&value>=0?value:null; }
function windowFor(days,now=new Date()) {
  if(![7,30].includes(days)||!Number.isFinite(+now)) throw Error('invalid_window');
  const end=Math.floor((+now/1000-10800)/DAY)*DAY+10800;
  return {days,since:end-days*DAY,until:end-1,timezone:'America/Sao_Paulo'};
}
function metricValues(data,names,media=false) {
  if(!Array.isArray(data?.data)) throw Error('invalid_metrics');
  return Object.fromEntries(names.map(name=>{
    const metric=data.data.find(item=>item.name===name);
    return [name,count(media?metric?.values?.[0]?.value:metric?.total_value?.value)];
  }));
}
function breakdownRows(data,metric,key) {
  const item=data?.data?.find(value=>value.name===metric);
  const breakdown=item?.total_value?.breakdowns?.find(value=>Array.isArray(value.dimension_keys)&&value.dimension_keys.includes(key));
  if(!Array.isArray(breakdown?.results)) return null;
  const index=breakdown.dimension_keys.indexOf(key);
  return breakdown.results.map(row=>({label:String(row.dimension_values?.[index]??'').slice(0,180),value:count(row.value)}))
    .filter(row=>row.label&&row.value!==null);
}
function follows(data) {
  const rows=breakdownRows(data,'follows_and_unfollows','follow_type');
  return {gained:rows?.find(row=>row.label==='FOLLOWER')?.value??null,
    lost:rows?.find(row=>row.label==='NON_FOLLOWER')?.value??null};
}
function demographicDistribution(rows,dimension) {
  const labels=dimension==='gender'?{F:'Feminino',M:'Masculino',U:'Não informado/indisponível'}:
    dimension==='age'?{'13-17':'13 a 17 anos','18-24':'18 a 24 anos','25-34':'25 a 34 anos',
      '35-44':'35 a 44 anos','45-54':'45 a 54 anos','55-64':'55 a 64 anos','65+':'65 anos ou mais',
      U:'Não informado/indisponível'}:null;
  if(!labels) throw Error('invalid_demographic_dimension');
  if(!Array.isArray(rows)||!rows.length) return null;
  const grouped=new Map();
  for(const row of rows) {
    if(!row||count(row.value)===null) return null;
    const key=Object.hasOwn(labels,row.label)?row.label:'U';
    const sum=(grouped.get(key)||0)+row.value;
    if(count(sum)===null) return null;
    grouped.set(key,sum);
  }
  const total=[...grouped.values()].reduce((left,right)=>left+right,0);
  if(count(total)===null) return null;
  return {total,rows:Object.entries(labels).filter(([key])=>grouped.has(key)).map(([key,label])=>({
    key,label,value:grouped.get(key),percentage:total>0?grouped.get(key)/total*100:null
  }))};
}
function instagramLink(value) {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&['www.instagram.com','instagram.com'].includes(url.hostname)&&
      !url.username&&!url.password&&/^\/(p|reel|tv)\/[\w-]+\/?$/.test(url.pathname)?url.origin+url.pathname:null;
  } catch { return null; }
}
function mediaRecord(media) {
  if(!/^\d{1,40}$/.test(media?.id||'')||!Number.isFinite(Date.parse(media.timestamp))) return null;
  if(!['FEED','REELS'].includes(media.media_product_type)) return null;
  return {id:media.id,caption:String(media.caption||'').slice(0,2200),permalink:instagramLink(media.permalink),
    type:media.media_product_type==='REELS'?'Reel':media.media_type==='CAROUSEL_ALBUM'?'Carrossel':'Post',
    timestamp:new Date(media.timestamp).toISOString()};
}
function safeFailure(error) {
  return error?.meta_code===190?'reconnect':[4,32,613].includes(error?.meta_code)||error?.http_status===429?
    'rate_limit':'unavailable';
}
module.exports={DAY,INTERVAL_MS,ACCOUNT_METRICS,MEDIA_METRICS,count,windowFor,metricValues,breakdownRows,
  follows,demographicDistribution,instagramLink,mediaRecord,safeFailure};
