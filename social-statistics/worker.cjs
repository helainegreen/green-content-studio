'use strict';
const {check,vaultFromFile}=require('../social-connections/security.cjs');
const {createRepository:createConnectionsRepository}=require('../social-connections/repository.cjs');
const {createRepository}=require('./repository.cjs');
const {createInsights}=require('./meta.cjs');
const {collect}=require('./collect.cjs');
const {safeFailure}=require('./model.cjs');
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function clientList(value) {
  const values=String(value||'').split(',').map(item=>item.trim()).filter(Boolean);
  check(values.length>0&&new Set(values).size===values.length&&values.every(item=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)),
    'statistics_clients','Configure os clientes das estatísticas.',503);
  return values;
}
async function start(env=process.env) {
  const {Pool}=require('pg');
  check(env.GCS_SOCIAL_STATISTICS_ENABLED==='true','statistics_disabled','Estatísticas desativadas.',503);
  const database=new URL(env.GCS_SOCIAL_STATISTICS_DATABASE_URL||'');
  check(['postgres:','postgresql:'].includes(database.protocol)&&decodeURIComponent(database.pathname)==='/conteudo',
    'wrong_database','Banco das estatísticas inválido.',503);
  const clients=clientList(env.GCS_SOCIAL_STATISTICS_CLIENTS);
  const pool=new Pool({connectionString:database.href,max:2,connectionTimeoutMillis:5000,statement_timeout:10000,
    application_name:'green_content_social_statistics'});
  pool.on('error',()=>console.error('[social-statistics] banco indisponível'));
  const vault=vaultFromFile(env.GCS_SOCIAL_KEY_FILE);
  const repository=createRepository(pool);
  const connections=createConnectionsRepository(pool,vault);
  let running=true;
  for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>{running=false;});
  await repository.ensure(clients);
  while(running) {
    let db,locked=false;
    try {
      db=await pool.connect();
      locked=(await db.query('SELECT pg_try_advisory_lock(1569690647,261015) AS locked')).rows[0].locked;
      if(!locked) { db.release();db=null;await wait(15000);continue; }
      const target=await repository.due(clients);
      if(!target) {
        await db.query('SELECT pg_advisory_unlock(1569690647,261015)');db.release();db=null;
        await wait(15000);continue;
      }
      const usable=target.connection_status==='connected'&&target.auth_type==='facebook_login'&&
        target.capabilities?.insights===true&&(!target.expires_at||new Date(target.expires_at)>new Date());
      if(!usable) {
        await repository.waiting(target.client_id);
      } else {
        try {
          const [settings,connection]=await Promise.all([
            connections.settings(),connections.insightConnection(target.client_id,'instagram')
          ]);
          check(settings,'meta_settings_missing','Configuração Meta indisponível.',503);
          const meta=createInsights({accountId:connection.account_id,tokenProvider:async()=>connection.token,
            appSecret:settings.app_secret,version:settings.version});
          const result=await collect({meta});
          await repository.save(target.client_id,connection.account_id,result);
        } catch(error) {
          const status=['insights_permission'].includes(error?.code)?'waiting_connection':
            ['insights_expired','insights_token'].includes(error?.code)?'reconnect':safeFailure(error);
          if(status==='waiting_connection') await repository.waiting(target.client_id);
          else await repository.failure(target.client_id,target.account_id,status);
          console.error('[social-statistics] coleta indisponível:',String(status));
        }
      }
      await db.query('SELECT pg_advisory_unlock(1569690647,261015)');db.release();db=null;
    } catch(error) {
      console.error('[social-statistics] ciclo falhou:',String(error?.code||error?.name||'error'));
      if(db) {
        if(locked) await db.query('SELECT pg_advisory_unlock(1569690647,261015)').catch(()=>{});
        db.release(true);
      }
      await wait(5000);
    }
  }
  await pool.end();
}
if(require.main===module) start().catch(error=>{
  console.error('[social-statistics] não iniciou:',String(error?.code||error?.name||'error'));process.exitCode=1;
});
module.exports={start,clientList};
