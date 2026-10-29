'use strict';
const fs=require('node:fs/promises');
const {Pool}=require('pg');
const {createQueue,ACCOUNTS}=require('./repository.cjs');
const {createMeta}=require('./meta.cjs');
const {createVault}=require('./vault.cjs');
const {createAssets}=require('./assets.cjs');
const {execute}=require('./executor.cjs');
const env=process.env;
const db=new URL(env.FR2_FEED_DATABASE_URL||'');if(db.pathname!=='/community_publicacoes')throw Error('dedicated_database_required');
const pool=new Pool({connectionString:db.href,max:2,connectionTimeoutMillis:5000,statement_timeout:10000,application_name:'community_publisher'});
pool.on('error',()=>console.error('publication_database_unavailable'));
const queue=createQueue(pool),vault=createVault(env.FR2_PUBLISH_CREDENTIALS_DIR);
const assets=createAssets({directory:env.FR2_PUBLISH_ASSETS_DIR,origin:env.FR2_FEED_ORIGIN,secret:env.FR2_FEED_MEDIA_SECRET});
const apiFor=n=>createMeta({network:n,accountId:ACCOUNTS[n],tokenProvider:()=>vault.token(n),mediaOrigin:env.FR2_FEED_ORIGIN,writesEnabled:env.FR2_PUBLISH_WRITES_ENABLED==='true'});
let stopping=false,lastHealth=0;
async function tick(){
  await queue.exclusive(async()=>{
    const control=JSON.parse(await fs.readFile(env.FR2_PUBLISH_CONTROL_FILE,'utf8'));
    const enabled=control.enabled===true&&env.FR2_PUBLISH_WRITES_ENABLED==='true';
    await queue.health('worker',enabled,{enabled});
    if(Date.now()-lastHealth>5*60_000){
      for(const n of ['instagram','facebook']){
        try{
          if(n==='instagram')await vault.refreshInstagram();
          const info=await vault.load(n);
          if(info.expires_at&&Date.parse(info.expires_at)<=Date.now())throw Error('expired');
          if(info.data_access_expires_at&&Date.parse(info.data_access_expires_at)<=Date.now())throw Error('data_access_expired');
          const identity=await apiFor(n).identity();await queue.health(n,true,{identity,expires_at:info.expires_at||null,data_access_expires_at:info.data_access_expires_at||null});
        }catch{await queue.health(n,false,{error:'connection_or_refresh_unavailable'});}
      }lastHealth=Date.now();
    }
    if(!enabled)return;
    const job=await queue.claim();if(!job)return;
    if(!Array.isArray(control.reviewers)||!control.reviewers.includes(job.approved_by)){await queue.finish(job,{status:'held',error:'reviewer_removed'});return;}
    if(!await queue.readiness([job.network])){await queue.finish(job,{delay:5*60_000,error:'connection_unavailable'});return;}
    await execute(job,{queue,assets,api:apiFor(job.network)});
  });
}
async function main(){while(!stopping){try{await tick();}catch{console.error('publication_worker_check_failed');}if(!stopping)await new Promise(resolve=>setTimeout(resolve,3000));}await pool.end();}
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
main().catch(()=>{console.error('publication_worker_stopped');process.exitCode=1;});
