'use strict';
const crypto=require('node:crypto');
const {check}=require('../studio-module/core.cjs');
const ACCOUNTS={instagram:'100000000000004',facebook:'100000000000006'};
function createQueue(pool,{imageJobs=false,aiImageDisclosure=false}={}){
  async function tx(fn){const c=await pool.connect();try{check((await c.query('SELECT current_database() AS name')).rows[0]?.name==='community_publicacoes','wrong_database','Banco exclusivo indisponível.',503);await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
  const listWith=async(c,id)=>(await c.query(`SELECT id,network,status,due_at,result,error_code,updated_at FROM publication_deliveries WHERE post_id=$1 ORDER BY created_at DESC LIMIT 50`,[id])).rows;
  return {
    list:id=>tx(c=>listWith(c,id)),
    healthReport:()=>tx(async c=>(await c.query('SELECT component,ready,details,checked_at FROM publication_health ORDER BY component')).rows),
    async readiness(networks){return tx(async c=>{
      const rows=(await c.query("SELECT component,ready,checked_at FROM publication_health WHERE component=ANY($1::text[])",[['worker',...networks]])).rows;
      const now=Date.now();return ['worker',...networks].every(n=>rows.some(r=>r.component===n&&r.ready&&now-new Date(r.checked_at).getTime()<15*60_000));
    });},
    async enqueue({postId,version,review,actor,confirmationKey,now=new Date()}){return tx(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['fr2-feed:'+postId]);
      if(imageJobs)check(!(await c.query("SELECT 1 FROM image_generation_jobs WHERE post_id=$1 AND status IN ('queued','running') LIMIT 1",[postId])).rowCount,'image_busy','Aguarde a geração da imagem antes de confirmar a publicação.',409);
      const existing=(await c.query('SELECT id,fingerprint FROM publication_approvals WHERE confirmation_key=$1 OR (post_id=$2 AND draft_version=$3)',[confirmationKey,postId,version])).rows[0];
      if(existing){check(existing.fingerprint===review.fingerprint,'stale_confirmation','A confirmação pertence a outro conteúdo.',409);return {deliveries:await listWith(c,postId),duplicate:true};}
      const d=(await c.query('SELECT version,body FROM feed_drafts WHERE post_id=$1 FOR UPDATE',[postId])).rows[0];
      check(d&&Number(d.version)===version,'stale_version','A revisão mudou. Revise novamente.',409);
      // The caller validated the exact current source; bind persistence to the same draft too.
      const {hash}=require('../studio-module/core.cjs');
      check(hash(d.body)===hash(review.draft),'stale_version','A revisão mudou. Revise novamente.',409);
      const pending=await c.query("SELECT id FROM publication_deliveries WHERE post_id=$1 AND network=ANY($2::text[]) AND status<>'cancelled'",[postId,review.draft.networks]);
      check(pending.rowCount===0,'already_confirmed','Já existe um envio para esta notícia. Confira o histórico; não será criada uma duplicação.',409);
      check(review.capability_holds.every(h=>h==='ai_disclosure'&&aiImageDisclosure&&require('./disclosure.cjs').supported(review.snapshot)),'unsupported_disclosure','Conteúdo com IA ou parceria comercial precisa de tratamento específico antes de publicar.');
      const approval=crypto.randomUUID(),due=review.scheduled_at||now.toISOString();
      await c.query('INSERT INTO publication_approvals(id,post_id,draft_version,confirmation_key,fingerprint,snapshot,approved_by,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[approval,postId,version,confirmationKey,review.fingerprint,review.snapshot,actor,due]);
      for(const network of review.draft.networks)await c.query('INSERT INTO publication_deliveries(id,approval_id,post_id,network,account_id,due_at,next_at) VALUES($1,$2,$3,$4,$5,$6,$6)',[crypto.randomUUID(),approval,postId,network,ACCOUNTS[network],due]);
      return {deliveries:await listWith(c,postId),duplicate:false};
    });},
    async cancel(postId,id,actor){return tx(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['fr2-feed:'+postId]);
      const r=await c.query("UPDATE publication_deliveries SET status='cancelled',cancelled_by=$3,updated_at=now() WHERE id=$1 AND post_id=$2 AND status IN ('scheduled','held','failed') AND inflight IS NULL AND NOT(state ? 'published_id') AND NOT EXISTS(SELECT 1 FROM publication_attempts WHERE delivery_id=$1 AND status IN ('prepared','uncertain')) RETURNING id",[id,postId,actor]);
      check(r.rowCount===1,'cannot_cancel','Este envio já iniciou ou exige conferência. Atualize o histórico.',409);return listWith(c,postId);
    });},
    async health(component,ready,details){return tx(c=>c.query('INSERT INTO publication_health(component,ready,details) VALUES($1,$2,$3) ON CONFLICT(component) DO UPDATE SET ready=EXCLUDED.ready,details=EXCLUDED.details,checked_at=now()',[component,ready,details]));},
    async claim(){return tx(async c=>{
      await c.query("UPDATE publication_attempts SET status='uncertain',finished_at=now() WHERE status='prepared' AND delivery_id IN (SELECT id FROM publication_deliveries WHERE status='processing' AND lease_until<now() AND inflight IS NOT NULL)");
      await c.query("UPDATE publication_deliveries SET status=CASE WHEN inflight IS NULL THEN 'scheduled' ELSE 'uncertain' END,error_code=CASE WHEN inflight IS NULL THEN error_code ELSE 'interrupted_write' END,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE status='processing' AND lease_until<now()");
      const row=(await c.query("SELECT d.*,a.snapshot,a.approved_at,a.approved_by FROM publication_deliveries d JOIN publication_approvals a ON a.id=d.approval_id WHERE d.status='scheduled' AND d.next_at<=now() ORDER BY d.next_at,d.created_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED")).rows[0];
      if(!row)return null;row.lease_id=crypto.randomUUID();
      await c.query("UPDATE publication_deliveries SET status='processing',lease_id=$2,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1",[row.id,row.lease_id]);return row;
    });},
    async begin(job,operation){return tx(async c=>{
      const attempt=crypto.randomUUID();const r=await c.query("UPDATE publication_deliveries SET inflight=$3,updated_at=now() WHERE id=$1 AND lease_id=$2 AND status='processing' AND lease_until>now() AND inflight IS NULL RETURNING id",[job.id,job.lease_id,{id:attempt,operation}]);
      check(r.rowCount===1,'lost_lease','A reserva de publicação expirou.',409);
      await c.query("INSERT INTO publication_attempts(id,delivery_id,operation,status) VALUES($1,$2,$3,'prepared')",[attempt,job.id,operation]);return attempt;
    });},
    async finish(job,{state=job.state,status='scheduled',result=null,error=null,delay=1000,attempt=null,attemptStatus='succeeded',attemptResult=null}){return tx(async c=>{
      const r=await c.query(`UPDATE publication_deliveries SET state=$3,status=$4,result=$5,error_code=$6,next_at=now()+($7*interval '1 millisecond'),lease_id=NULL,lease_until=NULL,inflight=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2 AND status='processing' AND lease_until>now() RETURNING id`,[job.id,job.lease_id,state,status,result,error,delay]);
      check(r.rowCount===1,'lost_lease','A reserva de publicação expirou.',409);
      if(attempt)await c.query('UPDATE publication_attempts SET status=$2,result=$3,finished_at=now() WHERE id=$1 AND delivery_id=$4',[attempt,attemptStatus,attemptResult,job.id]);
    });},
    // Held by a dedicated connection for the lifetime of one worker pass. A crash releases it.
    async exclusive(fn){const c=await pool.connect();try{const r=await c.query("SELECT pg_try_advisory_lock(58392061) AS locked");if(!r.rows[0].locked)return false;try{await fn();return true;}finally{await c.query('SELECT pg_advisory_unlock(58392061)');}}finally{c.release();}}
  };
}
module.exports={createQueue,ACCOUNTS};
