'use strict';
const {ACCOUNT,ACCOUNT_METRICS,MEDIA_METRICS,count} = require('./model.cjs');
class InsightsError extends Error {
  constructor(status=0,code=null) { super('instagram_insights_unavailable'); this.http_status=status; this.meta_code=Number.isInteger(code)?code:null; }
}
function createInsights({tokenProvider,fetchImpl=fetch,timeoutMs=25000}) {
  async function read(route,params={}) {
    let token;
    try { token=await tokenProvider(); } catch { throw new InsightsError(); }
    if (typeof token !== 'string' || token.length<20 || /[\r\n]/.test(token)) throw new InsightsError();
    const url=new URL('https://graph.instagram.com/v26.0/'+route);
    for(const [k,v] of Object.entries(params)) if(v!==undefined) url.searchParams.set(k,String(v));
    let response,data;
    try {
      response=await fetchImpl(url.href,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      const raw=await response.text(); if(raw.length>1000000) throw Error('oversized_response');
      data=JSON.parse(raw);
    } catch { throw new InsightsError(response?.status); }
    if(!response.ok || data?.error || !data || typeof data!=='object') throw new InsightsError(response.status,data?.error?.code);
    return data;
  }
  function range(w) {
    if(![7,30].includes(w?.days) || !Number.isInteger(w.since) || !Number.isInteger(w.until) || w.until-w.since!==w.days*86400-1) throw Error('invalid_window');
    return {period:'day',metric_type:'total_value',since:w.since,until:w.until};
  }
  return {
    async profile() {
      const d=await read(ACCOUNT,{fields:'id,user_id,username,followers_count,media_count'});
      // With Instagram Login, id is app-scoped; user_id identifies the IG account.
      if(String(d.user_id)!==ACCOUNT || d.username!=='community') throw Error('wrong_account');
      return {id:ACCOUNT,username:'community',followers:count(d.followers_count),media_count:count(d.media_count)};
    },
    account(w) { return read(ACCOUNT+'/insights',{...range(w),metric:ACCOUNT_METRICS.join(',')}); },
    follows(w) { return read(ACCOUNT+'/insights',{...range(w),metric:'follows_and_unfollows',breakdown:'follow_type'}); },
    cities() { return read(ACCOUNT+'/insights',{metric:'follower_demographics',period:'lifetime',metric_type:'total_value',timeframe:'this_month',breakdown:'city'}); },
    demographics(dimension) {
      if(!['gender','age'].includes(dimension)) throw Error('invalid_demographic_dimension');
      return read(ACCOUNT+'/insights',{metric:'follower_demographics',period:'lifetime',metric_type:'total_value',timeframe:'this_month',breakdown:dimension});
    },
    media(after) {
      if(after!==undefined && (typeof after!=='string'||after.length>4096||/[\r\n]/.test(after))) throw Error('invalid_cursor');
      // Rebuild the request on the fixed host. Never follow paging.next (may contain a token).
      return read(ACCOUNT+'/media',{fields:'id,caption,media_type,media_product_type,timestamp,permalink',limit:25,after});
    },
    mediaInsights(id) {
      if(!/^\d{1,40}$/.test(id)) throw Error('invalid_media_id');
      return read(id+'/insights',{metric:MEDIA_METRICS.join(',')});
    }
  };
}
module.exports={createInsights,InsightsError};
