'use strict';
const {createRepository}=require('./repository.cjs');
const {createProvider}=require('./provider.cjs');
const {collect}=require('./sources.cjs');
const {render}=require('./renderer.cjs');
const {check}=require('./core.cjs');
async function runOne({repo,provider,renderJob=render,collectSources=collect,root,executable}) {
  const j=await repo.claim();if(!j)return false;
  const allowed=()=>repo.authorized(j);const timer=setInterval(()=>repo.heartbeat(j).catch(()=>{}),30000);timer.unref?.();
  try{check(await allowed(),'revoked','Acesso retirado.');let result;
    if(j.state==='working_headlines'){const sources=await collectSources(j.input,{allowed});check(await allowed(),'revoked','Acesso retirado.');result={sources,headlines:await provider.headlines(j,sources)};}
    else if(j.state==='working_copy')result=await provider.copy(j);
    else result=await renderJob(j,{root,provider,allowed,executable});
    check(await allowed(),'revoked','Acesso retirado.');await repo.finish(j,result);
  }catch(error){const known=new Set(['revoked','disabled','source_url','source_empty','provider_key','provider_uncertain','provider_limit','provider_failed','provider_invalid','provider_incomplete','provider_image','layout_overflow','headlines','copy','citation','caption','draft','review']);const code=known.has(error.code)?error.code:(String(error.message).startsWith('source_')?'source_unavailable':'processing_failed');await repo.fail(j,code);console.error('[gcs-creation]',j.id,code);}
  finally{clearInterval(timer);}return true;
}
async function hasCapacity({platform=process.platform,readFile=require('node:fs/promises').readFile,minMB=1024}={}) {if(platform!=='linux')return true;try{const data=await readFile('/proc/meminfo','utf8'),kb=Number(data.match(/^MemAvailable:\s+(\d+) kB/m)?.[1]||0);return kb>=minMB*1024;}catch{return false;}}
async function main() {
  if(process.env.GCS_CREATION_ENABLED!=='true'||process.env.GCS_CREATION_GENERATION_ENABLED!=='true')throw new Error('GCS_CREATION_ENABLED is not true');
  const fs=require('node:fs/promises'),{Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,application_name:'gcs-creation-worker'});
  const repo=createRepository(pool),provider=createProvider({readKey:async()=>process.env.OPENAI_API_KEY||(await fs.readFile('/data/studio/.openai_api_key','utf8')).trim()});
  let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
  try{await pool.query('SELECT id FROM gcs_creation_jobs LIMIT 0');while(!stopped){try{if(!await hasCapacity()){await new Promise(r=>setTimeout(r,10000));continue;}const didWork=await runOne({repo,provider,root:process.env.GCS_CREATION_OUTPUT_ROOT||'/data/studio/rendered'});if(!didWork)await new Promise(r=>setTimeout(r,3000));}catch{console.error('[gcs-creation] queue_unavailable');await new Promise(r=>setTimeout(r,10000));}}}finally{await pool.end();}
}
if(require.main===module)main().catch(()=>{console.error('[gcs-creation] startup_failed');process.exitCode=1;});
module.exports={runOne,hasCapacity};
