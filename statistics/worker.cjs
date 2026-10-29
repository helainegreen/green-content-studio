'use strict';
const {createInsights}=require('./meta.cjs');
const {collect}=require('./collect.cjs');
const {createRepository,databaseUrl}=require('./repository.cjs');
const {safeFailure}=require('./model.cjs');
async function main(env=process.env) {
  if(env.FR2_STATS_COLLECT_ENABLED!=='true') throw Error('statistics_disabled');
  const {Pool}=require('pg');
  const {createVault}=require('../publisher/vault.cjs');
  const pool=new Pool({connectionString:databaseUrl(env.FR2_STATS_DATABASE_URL,true),max:1,connectionTimeoutMillis:5000,statement_timeout:10000,application_name:'community_statistics'});
  pool.on('error',()=>console.error('Community News statistics: database unavailable'));
  const vault=createVault(env.FR2_STATS_CREDENTIALS_DIR);
  const meta=createInsights({tokenProvider:()=>vault.token('instagram')});
  let stopping=false;
  process.once('SIGTERM',()=>{stopping=true;});process.once('SIGINT',()=>{stopping=true;});
  async function pass() {
    const db=await pool.connect();let locked=false;
    // Keep a broken session's lock until destruction instead of releasing a possibly lost lock.
    try {
      locked=(await db.query('SELECT pg_try_advisory_lock(1569690647,240926) AS locked')).rows[0].locked;
      if(!locked) return;
      const repo=createRepository(db);
      if(await repo.due()) {
        try { const result=await collect({meta});await repo.save(result); }
        catch(e) { await repo.failure(safeFailure(e)); console.error('Community News statistics: sync unavailable'); }
      }
    } finally {
      if(locked) { try { await db.query('SELECT pg_advisory_unlock(1569690647,240926)'); } catch { db.release(true);return; } }
      db.release();
    }
  }
  try {
    do {
      try { await pass(); } catch { console.error('Community News statistics: worker unavailable'); }
      if(env.FR2_STATS_RUN_ONCE==='true') break;
      for(let i=0;i<30 && !stopping;i++) await new Promise(r=>setTimeout(r,1000));
    } while(!stopping);
  } finally { await pool.end(); }
}
if(require.main===module) main().catch(()=>{console.error('Community News statistics: configuration unavailable');process.exitCode=1;});
module.exports={main};
