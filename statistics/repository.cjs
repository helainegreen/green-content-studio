'use strict';
const crypto=require('node:crypto');
const {ACCOUNT,INTERVAL_MS,count}=require('./model.cjs');
function databaseUrl(raw,worker=false) {
  const u=new URL(raw||'');
  if(!['postgres:','postgresql:'].includes(u.protocol)||decodeURIComponent(u.pathname)!=='/community_publicacoes'||decodeURIComponent(u.username)!==(worker?'community_estatisticas':'community_publicacoes_app')) throw Error('dedicated_database_required');
  return u.href;
}
function createRepository(db) {
  return {
    async load(days) {
      if(![7,30].includes(days)) throw Error('invalid_window');
      const rows=await db.query('SELECT payload FROM instagram_stat_snapshots WHERE account_id=$1 AND days=$2 ORDER BY collected_at DESC LIMIT 1',[ACCOUNT,days]);
      const history=await db.query("SELECT observed_date::text AS date,followers::text AS followers FROM instagram_follower_history WHERE account_id=$1 AND observed_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date-29 ORDER BY observed_date",[ACCOUNT]);
      const sync=await db.query('SELECT attempted_at,success_at,next_attempt_at,status FROM instagram_stat_sync WHERE account_id=$1',[ACCOUNT]);
      return {snapshot:rows.rows[0]?.payload||null,history:history.rows.map(h=>({date:h.date,followers:count(Number(h.followers))})),sync:sync.rows[0]||null};
    },
    async due(now=new Date()) {
      const r=await db.query('SELECT next_attempt_at FROM instagram_stat_sync WHERE account_id=$1',[ACCOUNT]);
      return !r.rows[0] || new Date(r.rows[0].next_attempt_at)<=now;
    },
    async save(result) {
      if(result.profile?.id!==ACCOUNT || result.snapshots.length!==2 || new Set(result.snapshots.map(s=>s.window.days)).size!==2) throw Error('invalid_snapshot');
      await db.query('BEGIN');
      try {
        for(const s of result.snapshots) {
          if(s.profile.id!==ACCOUNT || ![7,30].includes(s.window.days)) throw Error('invalid_snapshot');
          await db.query('INSERT INTO instagram_stat_snapshots(id,account_id,days,collected_at,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,days,collected_at) DO NOTHING',[crypto.randomUUID(),ACCOUNT,s.window.days,result.collected_at,s]);
        }
        if(count(result.profile.followers)!==null) await db.query(`INSERT INTO instagram_follower_history(account_id,observed_date,observed_at,followers)
          VALUES($1,($2::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,$2,$3)
          ON CONFLICT(account_id,observed_date) DO UPDATE SET followers=excluded.followers,observed_at=excluded.observed_at
          WHERE instagram_follower_history.observed_at<=excluded.observed_at`,[ACCOUNT,result.collected_at,result.profile.followers]);
        await db.query(`INSERT INTO instagram_stat_sync(account_id,attempted_at,success_at,next_attempt_at,status) VALUES($1,$2,$2,$3,$4)
          ON CONFLICT(account_id) DO UPDATE SET attempted_at=excluded.attempted_at,success_at=excluded.success_at,next_attempt_at=excluded.next_attempt_at,status=excluded.status
          WHERE instagram_stat_sync.attempted_at<=excluded.attempted_at`,[ACCOUNT,result.collected_at,new Date(Date.parse(result.collected_at)+INTERVAL_MS),result.partial?'partial':'ok']);
        await db.query('COMMIT');
      } catch(e) { await db.query('ROLLBACK'); throw e; }
    },
    async failure(status,now=new Date()) {
      if(!['unavailable','reconnect','rate_limit'].includes(status)) status='unavailable';
      // Failure never overwrites a successful snapshot. Back off for rate limits/auth.
      const delay=status==='unavailable'?60*60*1000:INTERVAL_MS;
      await db.query(`INSERT INTO instagram_stat_sync(account_id,attempted_at,next_attempt_at,status) VALUES($1,$2,$3,$4)
        ON CONFLICT(account_id) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at,status=excluded.status
        WHERE instagram_stat_sync.attempted_at<=excluded.attempted_at`,[ACCOUNT,now,new Date(+now+delay),status]);
    }
  };
}
module.exports={createRepository,databaseUrl};
