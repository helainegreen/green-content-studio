'use strict';
const ACCOUNT = '100000000000004';
const DAY = 86400;
const ACCOUNT_METRICS = ['views','reach','total_interactions','accounts_engaged','likes','comments','saves','shares'];
const MEDIA_METRICS = ['views','reach','total_interactions','likes','comments','saved','shares'];
const INTERVAL_MS = 6 * 60 * 60 * 1000;
function count(v) { return Number.isSafeInteger(v) && v >= 0 ? v : null; }
function windowFor(days, now = new Date()) {
  if (![7,30].includes(days) || !Number.isFinite(+now)) throw Error('invalid_window');
  // Brasília UTC-03: complete calendar days; until is inclusive in the Meta API.
  const end = Math.floor((+now / 1000 - 10800) / DAY) * DAY + 10800;
  return {days, since:end-days*DAY, until:end-1, timezone:'America/Sao_Paulo'};
}
function metricValues(data, names, media = false) {
  if (!Array.isArray(data?.data)) throw Error('invalid_metrics');
  return Object.fromEntries(names.map(name => {
    const metric = data.data.find(m => m.name === name);
    return [name,count(media ? metric?.values?.[0]?.value : metric?.total_value?.value)];
  }));
}
function breakdownRows(data, metric, key) {
  const m = data?.data?.find(m => m.name === metric);
  const breakdown = m?.total_value?.breakdowns?.find(b => Array.isArray(b.dimension_keys) && b.dimension_keys.includes(key));
  if (!Array.isArray(breakdown?.results)) return null;
  const index = breakdown.dimension_keys.indexOf(key);
  return breakdown.results.map(r => ({label:String(r.dimension_values?.[index] ?? '').slice(0,180),value:count(r.value)}))
    .filter(r => r.label && r.value !== null);
}
function follows(data) {
  const rows = breakdownRows(data,'follows_and_unfollows','follow_type');
  return {gained:rows?.find(r => r.label === 'FOLLOWER')?.value ?? null,
    lost:rows?.find(r => r.label === 'NON_FOLLOWER')?.value ?? null};
}
function demographicDistribution(rows,dimension) {
  const labels=dimension==='gender' ? {F:'Feminino',M:'Masculino',U:'Não informado/indisponível'}
    : dimension==='age' ? {'13-17':'13 a 17 anos','18-24':'18 a 24 anos','25-34':'25 a 34 anos','35-44':'35 a 44 anos','45-54':'45 a 54 anos','55-64':'55 a 64 anos','65+':'65 anos ou mais',U:'Não informado/indisponível'} : null;
  if(!labels) throw Error('invalid_demographic_dimension');
  if(!Array.isArray(rows)||!rows.length) return null;
  const grouped=new Map();
  for(const row of rows) {
    if(!row || count(row.value)===null) return null;
    const key=Object.hasOwn(labels,row.label)?row.label:'U';
    const sum=(grouped.get(key)||0)+row.value;
    if(count(sum)===null) return null;
    grouped.set(key,sum);
  }
  const total=[...grouped.values()].reduce((a,b)=>a+b,0);
  if(count(total)===null) return null;
  // Each breakdown has its own returned base, including unknown categories.
  // Missing categories are not synthesized as zero and bases are never added together.
  return {total,rows:Object.entries(labels).filter(([key])=>grouped.has(key)).map(([key,label])=>({key,label,value:grouped.get(key),percentage:total>0?grouped.get(key)/total*100:null}))};
}
function instagramLink(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['www.instagram.com','instagram.com'].includes(u.hostname) && !u.username && !u.password && /^\/(p|reel|tv)\/[\w-]+\/?$/.test(u.pathname) ? u.origin+u.pathname : null; } catch { return null; }
}
function mediaRecord(m) {
  if (!/^\d{1,40}$/.test(m?.id || '') || !Number.isFinite(Date.parse(m.timestamp))) return null;
  if (!['FEED','REELS'].includes(m.media_product_type)) return null;
  return {id:m.id,caption:String(m.caption || '').slice(0,2200),permalink:instagramLink(m.permalink),
    type:m.media_product_type === 'REELS' ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : 'Post',
    timestamp:new Date(m.timestamp).toISOString()};
}
function safeFailure(e) { return e?.meta_code === 190 ? 'reconnect' : e?.meta_code === 4 || e?.meta_code === 32 || e?.meta_code === 613 || e?.http_status === 429 ? 'rate_limit' : 'unavailable'; }
module.exports={ACCOUNT,DAY,INTERVAL_MS,ACCOUNT_METRICS,MEDIA_METRICS,count,windowFor,metricValues,breakdownRows,follows,demographicDistribution,instagramLink,mediaRecord,safeFailure};
