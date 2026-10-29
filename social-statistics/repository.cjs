'use strict';
const crypto=require('node:crypto');
const {INTERVAL_MS,count}=require('./model.cjs');
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function createRepository(pool) {
  async function transaction(callback) {
    const db=await pool.connect();
    try { await db.query('BEGIN');const value=await callback(db);await db.query('COMMIT');return value; }
    catch(error) { await db.query('ROLLBACK').catch(()=>{});throw error; }
    finally { db.release(); }
  }
  return {
    async ensure(slugs) {
      if(!Array.isArray(slugs)||!slugs.length||slugs.some(slug=>!SLUG.test(slug))) throw Error('invalid_statistics_clients');
      await pool.query(`INSERT INTO social_instagram_stat_sync(client_id)
        SELECT id FROM clients WHERE slug=ANY($1::text[]) AND status='active'
        ON CONFLICT(client_id) DO NOTHING`,[slugs]);
    },
    async due(slugs,now=new Date()) {
      const result=await pool.query(`SELECT c.id AS client_id,c.slug,c.name,s.status,s.next_attempt_at,
        connection.id AS connection_id,connection.account_id,connection.account_name,
        connection.status AS connection_status,connection.auth_type,connection.capabilities,connection.expires_at
        FROM social_instagram_stat_sync s JOIN clients c ON c.id=s.client_id
        LEFT JOIN social_connections connection ON connection.client_id=c.id AND connection.network='instagram'
        WHERE c.slug=ANY($1::text[]) AND c.status='active' AND s.next_attempt_at<=$2
        ORDER BY s.next_attempt_at,c.slug LIMIT 1`,[slugs,now]);
      return result.rows[0]||null;
    },
    async waiting(clientId,now=new Date()) {
      await pool.query(`UPDATE social_instagram_stat_sync SET account_id=NULL,attempted_at=$2,
        next_attempt_at=$3,status='waiting_connection',updated_at=now() WHERE client_id=$1`,
      [clientId,now,new Date(+now+30*60*1000)]);
    },
    async save(clientId,accountId,result) {
      if(!/^\d{1,40}$/.test(accountId||'')||result.profile?.id!==accountId||result.snapshots?.length!==2||
        new Set(result.snapshots.map(snapshot=>snapshot.window.days)).size!==2) throw Error('invalid_snapshot');
      await transaction(async db=>{
        for(const snapshot of result.snapshots) {
          if(snapshot.profile.id!==accountId||![7,30].includes(snapshot.window.days)) throw Error('invalid_snapshot');
          await db.query(`INSERT INTO social_instagram_stat_snapshots
            (id,client_id,account_id,days,collected_at,payload) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(client_id,account_id,days,collected_at) DO NOTHING`,
          [crypto.randomUUID(),clientId,accountId,snapshot.window.days,result.collected_at,snapshot]);
        }
        if(count(result.profile.followers)!==null) {
          await db.query(`INSERT INTO social_instagram_follower_history
            (client_id,account_id,observed_date,observed_at,followers)
            VALUES($1,$2,($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date,$3,$4)
            ON CONFLICT(client_id,account_id,observed_date) DO UPDATE SET
              followers=EXCLUDED.followers,observed_at=EXCLUDED.observed_at
            WHERE social_instagram_follower_history.observed_at<=EXCLUDED.observed_at`,
          [clientId,accountId,result.collected_at,result.profile.followers]);
        }
        await db.query(`UPDATE social_instagram_stat_sync SET account_id=$2,attempted_at=$3,
          success_at=$3,next_attempt_at=$4,status=$5,updated_at=now() WHERE client_id=$1`,
        [clientId,accountId,result.collected_at,new Date(Date.parse(result.collected_at)+INTERVAL_MS),
          result.partial?'partial':'ok']);
        await db.query(`DELETE FROM social_instagram_stat_snapshots
          WHERE client_id=$1 AND collected_at<now()-interval '180 days'`,[clientId]);
        await db.query(`DELETE FROM social_instagram_follower_history
          WHERE client_id=$1 AND observed_date<current_date-400`,[clientId]);
      });
    },
    async failure(clientId,accountId,status,now=new Date()) {
      if(!['unavailable','reconnect','rate_limit'].includes(status)) status='unavailable';
      const delay=status==='unavailable'?60*60*1000:INTERVAL_MS;
      await pool.query(`UPDATE social_instagram_stat_sync SET account_id=$2,attempted_at=$3,
        next_attempt_at=$4,status=$5,updated_at=now() WHERE client_id=$1`,
      [clientId,/^\d{1,40}$/.test(accountId||'')?accountId:null,now,new Date(+now+delay),status]);
    },
    async load(clientId,days) {
      if(![7,30].includes(days)) throw Error('invalid_window');
      const connectionResult=await pool.query(`SELECT account_id,account_name,status,capabilities,expires_at
        FROM social_connections WHERE client_id=$1 AND network='instagram'`,[clientId]);
      const syncResult=await pool.query(`SELECT account_id,attempted_at,success_at,next_attempt_at,status
        FROM social_instagram_stat_sync WHERE client_id=$1`,[clientId]);
      const connection=connectionResult.rows[0]||null,sync=syncResult.rows[0]||null;
      const accountId=connection?.account_id||sync?.account_id||null;
      let snapshot=null,history=[];
      if(accountId) {
        const snapshotResult=await pool.query(`SELECT payload FROM social_instagram_stat_snapshots
          WHERE client_id=$1 AND account_id=$2 AND days=$3 ORDER BY collected_at DESC LIMIT 1`,
        [clientId,accountId,days]);
        snapshot=snapshotResult.rows[0]?.payload||null;
        const historyResult=await pool.query(`SELECT observed_date::text AS date,followers::text AS followers
          FROM social_instagram_follower_history WHERE client_id=$1 AND account_id=$2
          AND observed_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date-29 ORDER BY observed_date`,
        [clientId,accountId]);
        history=historyResult.rows.map(row=>({date:row.date,followers:count(Number(row.followers))}));
      }
      return {snapshot,history,sync,connection:connection?{
        account_id:connection.account_id,account_name:connection.account_name,status:connection.status,
        insights:connection.capabilities?.insights===true,expires_at:connection.expires_at
      }:null};
    }
  };
}
module.exports={createRepository};
