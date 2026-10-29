'use strict';
const crypto=require('node:crypto');
const {ACCOUNT_METRICS,MEDIA_METRICS,count}=require('./model.cjs');
const ID=/^\d{1,40}$/;
class InsightsError extends Error {
  constructor(status=0,code=null) {
    super('instagram_insights_unavailable');
    this.name='InsightsError';this.http_status=status;this.meta_code=Number.isInteger(code)?code:null;
  }
}
function createInsights({accountId,tokenProvider,appSecret,version='v26.0',fetchImpl=fetch,timeoutMs=25000}) {
  if(!ID.test(accountId||'')||!/^[a-f0-9]{32}$/i.test(appSecret||'')||!/^v\d{2}\.0$/.test(version)) {
    throw Error('invalid_insights_configuration');
  }
  const proof=token=>crypto.createHmac('sha256',appSecret).update(token).digest('hex');
  async function read(route,params={}) {
    let token;
    try { token=await tokenProvider(); } catch { throw new InsightsError(); }
    if(typeof token!=='string'||token.length<20||/[\r\n]/.test(token)) throw new InsightsError();
    const url=new URL(`https://graph.facebook.com/${version}/${route}`);
    for(const [key,value] of Object.entries({...params,appsecret_proof:proof(token)})) {
      if(value!==undefined) url.searchParams.set(key,String(value));
    }
    let response,data;
    try {
      response=await fetchImpl(url.href,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      const raw=await response.text();
      if(raw.length>2_000_000) throw Error('oversized_response');
      data=JSON.parse(raw);
    } catch { throw new InsightsError(response?.status); }
    if(!response.ok||data?.error||!data||typeof data!=='object'||Array.isArray(data)) {
      throw new InsightsError(response.status,Number.isInteger(data?.error?.code)?data.error.code:null);
    }
    return data;
  }
  function range(window) {
    if(![7,30].includes(window?.days)||!Number.isInteger(window.since)||!Number.isInteger(window.until)||
      window.until-window.since!==window.days*86400-1) throw Error('invalid_window');
    return {period:'day',metric_type:'total_value',since:window.since,until:window.until};
  }
  return {
    async profile() {
      const data=await read(accountId,{fields:'id,username,followers_count,media_count'});
      if(String(data.id)!==accountId) throw Error('wrong_account');
      return {id:accountId,username:String(data.username||accountId).slice(0,180),
        followers:count(data.followers_count),media_count:count(data.media_count)};
    },
    account:window=>read(accountId+'/insights',{...range(window),metric:ACCOUNT_METRICS.join(',')}),
    follows:window=>read(accountId+'/insights',{...range(window),metric:'follows_and_unfollows',breakdown:'follow_type'}),
    cities:()=>read(accountId+'/insights',{metric:'follower_demographics',period:'lifetime',
      metric_type:'total_value',timeframe:'this_month',breakdown:'city'}),
    demographics(dimension) {
      if(!['gender','age'].includes(dimension)) throw Error('invalid_demographic_dimension');
      return read(accountId+'/insights',{metric:'follower_demographics',period:'lifetime',
        metric_type:'total_value',timeframe:'this_month',breakdown:dimension});
    },
    media(after) {
      if(after!==undefined&&(typeof after!=='string'||after.length>4096||/[\r\n]/.test(after))) throw Error('invalid_cursor');
      return read(accountId+'/media',{fields:'id,caption,media_type,media_product_type,timestamp,permalink',limit:25,after});
    },
    mediaInsights(id) {
      if(!ID.test(id||'')) throw Error('invalid_media_id');
      return read(id+'/insights',{metric:MEDIA_METRICS.join(',')});
    }
  };
}
module.exports={createInsights,InsightsError};
