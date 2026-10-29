'use strict';
const crypto=require('node:crypto');
const {check,hash,ACTIVE}=require('./core.cjs');
function createRepository(pool) {
  async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
  return {
    async byRequest(key){return (await pool.query('SELECT * FROM image_generation_jobs WHERE request_key=$1',[key])).rows[0]||null;},
    async latest(postId){return (await pool.query('SELECT * FROM image_generation_jobs WHERE post_id=$1 ORDER BY created_at DESC LIMIT 1',[postId])).rows[0]||null;},
    async get(postId,id){return (await pool.query('SELECT * FROM image_generation_jobs WHERE post_id=$1 AND id=$2',[postId,id])).rows[0]||null;},
    async busy(postId){return !!(await pool.query("SELECT 1 FROM image_generation_jobs WHERE post_id=$1 AND status IN ('queued','running') LIMIT 1",[postId])).rowCount;},
    async enqueue({postId,actor,key,kind,payload,expectedBasis,confirmedUncertain=false}){return tx(async c=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('fr2-image-admission',0))");
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['fr2-feed:'+postId]);
      const digest=hash({postId,actor,kind,payload});
      const existing=(await c.query('SELECT * FROM image_generation_jobs WHERE request_key=$1',[key])).rows[0];
      if(existing){check(existing.request_digest===digest,'changed_request','Este envio já foi recebido com outro conteúdo. Atualize a página.');return existing;}
      check(!(await c.query("SELECT 1 FROM publication_deliveries WHERE post_id=$1 AND status IN ('scheduled','processing','held','uncertain') LIMIT 1",[postId])).rowCount,'publication_active','Confira ou cancele o envio confirmado antes de alterar imagens.');
      const active=(await c.query("SELECT * FROM image_generation_jobs WHERE post_id=$1 AND status IN ('queued','running') LIMIT 1",[postId])).rows[0];
      if(active){check(active.request_digest===digest,'image_busy','Já existe uma geração em andamento para este post.');return active;}
      const last=(await c.query('SELECT status FROM image_generation_jobs WHERE post_id=$1 ORDER BY created_at DESC LIMIT 1',[postId])).rows[0];
      check(last?.status!=='uncertain'||confirmedUncertain,'confirm_new','O pedido anterior ficou sem confirmação. Confirme na revisão antes de solicitar uma nova geração.');
      check(Number((await c.query("SELECT count(*) AS n FROM image_generation_jobs WHERE status IN ('queued','running')")).rows[0].n)<12,'queue_full','A fila de imagens está cheia. Aguarde uma conclusão.');
      const id=crypto.randomUUID(),state={basis:expectedBasis,items:payload.prompts.map(()=>({id:crypto.randomUUID(),dispatched:false,saved:false,applied:false}))};
      return (await c.query("INSERT INTO image_generation_jobs(id,post_id,actor_id,request_key,request_digest,kind,payload,status,state) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8) RETURNING *",[id,postId,actor,key,digest,kind,payload,state])).rows[0];
    });},
    async claim(){return tx(async c=>{
      const job=(await c.query("SELECT * FROM image_generation_jobs WHERE status IN ('queued','running') ORDER BY CASE WHEN status='running' THEN 0 ELSE 1 END,created_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if(!job)return null;
      job.lease_id=crypto.randomUUID();job.status='running';
      await c.query("UPDATE image_generation_jobs SET status='running',lease_id=$2,updated_at=now() WHERE id=$1",[job.id,job.lease_id]);return job;
    });},
    async save(job,status=job.status,error=null){
      check(['running','completed','failed','uncertain','review_needed'].includes(status),'invalid_state','Estado inválido.',500);
      const r=await pool.query('UPDATE image_generation_jobs SET state=$3,status=$4,error_code=$5,updated_at=now() WHERE id=$1 AND lease_id=$2 AND status=\'running\' RETURNING updated_at',[job.id,job.lease_id,job.state,status,error]);
      check(r.rowCount===1,'lost_lease','A geração precisa de conferência.');job.status=status;job.updated_at=r.rows[0].updated_at;
    }
  };
}
module.exports={createRepository};
