'use strict';
const {randomUUID}=require('node:crypto');
const core=require('./core.cjs');
const {check,entitlement}=core;
function createRepository(pool) {
  async function tx(fn) {const db=await pool.connect();try{await db.query('BEGIN');const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
  async function audit(db,user,clientId,action,details={}) {await db.query('INSERT INTO gcs_creation_audit(id,actor_id,client_id,action,details) VALUES($1,$2,$3,$4,$5)',[randomUUID(),user?.id||null,clientId,action,details]);}
  async function master(user) {check(user?.is_master,'admin','Apenas a administração pode gerenciar este recurso.',403);const r=await pool.query('SELECT user_id FROM social_master_users WHERE user_id=$1',[user.id]);check(r.rowCount,'admin','Apenas a administração pode gerenciar este recurso.',403);}
  async function client(user,slug,write=false) {
    const r=await pool.query(`SELECT c.*,a.enabled,a.management_mode,a.subscription_active,a.monthly_limit,a.version AS access_version,m.role AS member_role
      FROM clients c LEFT JOIN gcs_creation_access a ON a.client_id=c.id
      LEFT JOIN social_client_members m ON m.client_id=c.id AND m.user_id=$1
      WHERE c.slug=$2 AND c.status='active'`,[user.id,slug]);const c=r.rows[0];
    check(c&&(user.is_master||c.member_role),'not_found','Cliente não encontrado.',404);
    check(!write||user.is_master||['owner','editor'].includes(c.member_role),'forbidden','Seu acesso permite apenas visualizar.',403);
    check(entitlement(c),'disabled','A criação por marca não está liberada para este cliente.',403);return c;
  }
  async function lockAccess(db,clientId) {const r=await db.query(`SELECT a.* FROM gcs_creation_access a JOIN clients c ON c.id=a.client_id WHERE a.client_id=$1 AND c.status='active' FOR UPDATE OF a`,[clientId]);check(entitlement(r.rows[0]),'disabled','O acesso deste cliente está desativado.',403);return r.rows[0];}
  async function listAdmin(user) {await master(user);return (await pool.query(`SELECT c.id,c.slug,c.name,c.status,c.parser_type,a.enabled,a.management_mode,a.subscription_active,a.monthly_limit,a.version,a.managed_by FROM clients c LEFT JOIN gcs_creation_access a ON a.client_id=c.id ORDER BY c.name`)).rows;}
  async function createManual(user,input) {
    await master(user);const name=core.text(input.name,100),slug=core.text(input.slug,80).toLowerCase();
    check(name.length>=2&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)&&slug.length>=3,'client','Informe um nome e um identificador como minha-marca.');
    const limit=Number(input.monthly_limit||30);check(Number.isInteger(limit)&&limit>=1&&limit<=500,'limit','O limite mensal deve ficar entre 1 e 500.');
    try{return await tx(async db=>{const id=randomUUID();await db.query(`INSERT INTO clients(id,slug,name,parser_type,render_script) VALUES($1,$2,$3,'gcs_creation','')`,[id,slug,name]);await db.query(`INSERT INTO gcs_creation_access(client_id,enabled,management_mode,managed_by,monthly_limit) VALUES($1,$2,'green_managed',$3,$4)`,[id,input.enabled===true,user.id,limit]);await audit(db,user,id,'manual_client_created',{enabled:input.enabled===true,management_mode:'green_managed'});return {id,slug,name};});}catch(e){if(e.code==='23505')throw new core.CreationError('duplicate','Esse identificador já pertence a outro cliente.',409);throw e;}
  }
  async function setAccess(user,clientId,input) {
    await master(user);const enabled=input.enabled===true,limit=Number(input.monthly_limit);check(Number.isInteger(limit)&&limit>=1&&limit<=500,'limit','O limite mensal deve ficar entre 1 e 500.');
    return tx(async db=>{
      const c=(await db.query("SELECT id FROM clients WHERE id=$1 AND status='active' FOR UPDATE",[clientId])).rows[0];check(c,'not_found','Cliente não encontrado.',404);
      const old=(await db.query('SELECT * FROM gcs_creation_access WHERE client_id=$1',[clientId])).rows[0];
      // Reserved subscription mode may only be activated by a future audited billing integration.
      check(!old||old.management_mode==='green_managed','billing','Este acesso é controlado pela assinatura. Não pode ser convertido por este formulário.',409);
      check(Number(input.version||0)===Number(old?.version||0),'conflict','Outra pessoa alterou este acesso. Atualize a página.',409);
      await db.query(`INSERT INTO gcs_creation_access(client_id,enabled,monthly_limit,managed_by) VALUES($1,$2,$3,$4)
        ON CONFLICT(client_id) DO UPDATE SET enabled=$2,monthly_limit=$3,managed_by=$4,version=gcs_creation_access.version+1,updated_at=now()`,[clientId,enabled,limit,user.id]);
      if(!enabled) await db.query(`UPDATE gcs_creation_jobs SET state='cancelled',lease_token=null,error_code='access_revoked',revision=revision+1,updated_at=now() WHERE client_id=$1 AND (state LIKE 'queued_%' OR state LIKE 'working_%')`,[clientId]);
      await audit(db,user,clientId,'access_updated',{enabled,monthly_limit:limit});
    });
  }
  async function brand(clientId) {return (await pool.query('SELECT * FROM gcs_creation_brands WHERE client_id=$1',[clientId])).rows[0]||null;}
  async function saveBrand(user,c,input,version) {
    const p=core.profile(input);
    return tx(async db=>{await lockAccess(db,c.id);const old=(await db.query('SELECT version FROM gcs_creation_brands WHERE client_id=$1',[c.id])).rows[0];check(Number(version)===Number(old?.version||0),'conflict','A marca foi alterada em outra aba. Atualize a página.',409);await db.query(`INSERT INTO gcs_creation_brands(client_id,profile,updated_by) VALUES($1,$2,$3) ON CONFLICT(client_id) DO UPDATE SET profile=$2,updated_by=$3,version=gcs_creation_brands.version+1,updated_at=now()`,[c.id,p,user.id]);await audit(db,user,c.id,'brand_saved',{version:Number(version)+1});return p;});
  }
  async function jobs(clientId) {return (await pool.query('SELECT id,input,state,created_at,post_id,error_code FROM gcs_creation_jobs WHERE client_id=$1 ORDER BY created_at DESC LIMIT 50',[clientId])).rows;}
  async function job(clientId,id,db=pool,lock=false) {const r=await db.query('SELECT * FROM gcs_creation_jobs WHERE client_id=$1 AND id=$2'+(lock?' FOR UPDATE':''),[clientId,id]);check(r.rows[0],'not_found','Produção não encontrada.',404);return r.rows[0];}
  async function enqueue(user,c,input,key) {
    const b=core.brief(input);check(/^[a-f0-9-]{36}$/.test(key),'request','Solicitação inválida. Reabra o formulário.');
    return tx(async db=>{const a=await lockAccess(db,c.id);const existing=(await db.query('SELECT id FROM gcs_creation_jobs WHERE client_id=$1 AND request_key=$2',[c.id,key])).rows[0];if(existing)return existing.id;
      const used=(await db.query("SELECT count(*)::int AS n FROM gcs_creation_jobs WHERE client_id=$1 AND created_at>=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'",[c.id])).rows[0].n;check(used<a.monthly_limit,'quota','O limite de produções deste mês foi atingido. Contate a administração.',429);
      const brand=(await db.query('SELECT * FROM gcs_creation_brands WHERE client_id=$1',[c.id])).rows[0];check(brand,'brand','Configure a marca antes de criar conteúdo.');
      const id=randomUUID();await db.query(`INSERT INTO gcs_creation_jobs(id,client_id,created_by,request_key,state,input,brand_snapshot,brand_version,access_version) VALUES($1,$2,$3,$4,'queued_headlines',$5,$6,$7,$8)`,[id,c.id,user.id,key,b,brand.profile,brand.version,a.version]);await audit(db,user,c.id,'creation_requested',{job_id:id});return id;
    });
  }
  async function advance(user,c,id,version,action,input) {
    return tx(async db=>{const a=await lockAccess(db,c.id),j=await job(c.id,id,db,true);check(j.revision===Number(version),'conflict','A produção mudou. Atualize a página.',409);
      if(action==='choose') {check(j.state==='headlines','state','Esta produção não está aguardando um título.',409);const index=Number(input.index);check(Number.isInteger(index)&&index>=0&&index<10,'headline','Escolha um dos dez títulos.');await db.query(`UPDATE gcs_creation_jobs SET selected_headline=$2,state='queued_copy',access_version=$3,revision=revision+1,updated_at=now() WHERE id=$1`,[id,index,a.version]);}
      else if(action==='render'||action==='save') {check(j.state==='review','state','Esta produção não está disponível para edição.',409);const draft=core.validateDraft(input.draft,j.input.count,j.sources);if(action==='render')check(input.reviewed===true,'review','Confirme a revisão das informações e dos direitos de uso.');await db.query(`UPDATE gcs_creation_jobs SET draft=$2,state=$3,access_version=$4,revision=revision+1,updated_at=now() WHERE id=$1`,[id,draft,action==='render'?'queued_render':'review',a.version]);}
      else if(action==='revise') {check(j.state==='failed'&&j.draft,'state','Esta produção não pode voltar para revisão.',409);await db.query("UPDATE gcs_creation_jobs SET state='review',error_code=null,lease_token=null,access_version=$2,revision=revision+1,updated_at=now() WHERE id=$1",[id,a.version]);}
      else check(false,'action','Ação inválida.');
      await audit(db,user,c.id,action,{job_id:id});
    });
  }
  async function claim() {
    return tx(async db=>{
      // Expired work is held for inspection, never automatically charged/replayed.
      await db.query(`UPDATE gcs_creation_jobs SET state='failed',error_code='interrupted',lease_token=null,revision=revision+1,updated_at=now() WHERE state LIKE 'working_%' AND heartbeat_at < now()-interval '20 minutes'`);
      const r=await db.query(`SELECT j.* FROM gcs_creation_jobs j JOIN clients c ON c.id=j.client_id JOIN gcs_creation_access a ON a.client_id=j.client_id WHERE j.state IN ('queued_headlines','queued_copy','queued_render') AND c.status='active' AND a.enabled AND (a.management_mode='green_managed' OR a.subscription_active) ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
      const j=r.rows[0];if(!j)return null;const lease=randomUUID();return (await db.query(`UPDATE gcs_creation_jobs SET state=replace(state,'queued_','working_'),lease_token=$2,heartbeat_at=now(),access_version=(SELECT version FROM gcs_creation_access WHERE client_id=$3),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,[j.id,lease,j.client_id])).rows[0];
    });
  }
  async function authorized(j) {const r=await pool.query(`SELECT a.* FROM gcs_creation_access a JOIN clients c ON c.id=a.client_id JOIN gcs_creation_jobs j ON j.client_id=a.client_id WHERE j.id=$1 AND j.lease_token=$2 AND c.status='active' AND j.state LIKE 'working_%'`,[j.id,j.lease_token]);return entitlement(r.rows[0]);}
  async function heartbeat(j) {await pool.query("UPDATE gcs_creation_jobs SET heartbeat_at=now() WHERE id=$1 AND lease_token=$2 AND state LIKE 'working_%'",[j.id,j.lease_token]);}
  async function finish(j,value) {
    return tx(async db=>{const a=await lockAccess(db,j.client_id);const row=await job(j.client_id,j.id,db,true);check(row.lease_token===j.lease_token&&row.state===j.state,'lease','A produção foi interrompida.',409);
      if(j.state==='working_headlines')await db.query(`UPDATE gcs_creation_jobs SET state='headlines',headlines=$2,sources=$3,lease_token=null,revision=revision+1,updated_at=now() WHERE id=$1`,[j.id,core.validateHeadlines(value.headlines),value.sources]);
      else if(j.state==='working_copy')await db.query(`UPDATE gcs_creation_jobs SET state='review',draft=$2,lease_token=null,revision=revision+1,updated_at=now() WHERE id=$1`,[j.id,core.validateDraft(value,j.input.count,j.sources)]);
      else if(j.state==='working_render')await db.query(`UPDATE gcs_creation_jobs SET state='ready',artifact=$2,lease_token=null,revision=revision+1,updated_at=now() WHERE id=$1`,[j.id,value]);
    });
  }
  async function fail(j,code) {await pool.query(`UPDATE gcs_creation_jobs SET state='failed',error_code=$3,lease_token=null,revision=revision+1,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state LIKE 'working_%'`,[j.id,j.lease_token,code]);}
  async function exportPost(user,c,id) {
    return tx(async db=>{await lockAccess(db,c.id);const j=await job(c.id,id,db,true);check(j.state==='ready'&&j.artifact?.jpg_slides?.length===j.input.count,'state','Conclua as artes antes de exportar.',409);check(j.input.count<=10,'carousel_limit','A agenda atual aceita até 10 artes. Baixe este carrossel ou crie uma versão com até 9 slides.',409);if(j.post_id)return j.post_id;
      const postId=randomUUID(),generationId=randomUUID();
      await db.query(`INSERT INTO posts(id,client_id,type,source_title,source_text,source_meta,status) VALUES($1,$2,'brand_content',$3,$4,$5,'ready')`,[postId,c.id,j.draft.slides[0].title,'LEGENDA\n'+j.draft.caption,{origin:'gcs_creation',creation_job_id:j.id,brand_version:j.brand_version,ai_generated:j.input.image_mode==='cover'}]);
      for(const s of j.draft.slides)await db.query('INSERT INTO slides(id,post_id,number,slot,title,body,prompt) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),postId,s.number,s.number===1?'cover':'slide',s.title,s.body,s.image_prompt]);
      await db.query(`INSERT INTO generation_jobs(id,post_id,status,result_json,output_dir,started_at,finished_at) VALUES($1,$2,'completed',$3,$4,now(),now())`,[generationId,postId,j.artifact,j.artifact.output_dir]);
      await db.query('UPDATE gcs_creation_jobs SET post_id=$2,updated_at=now() WHERE id=$1',[id,postId]);await audit(db,user,c.id,'exported_to_library',{job_id:id,post_id:postId});return postId;
    });
  }
  return {master,client,listAdmin,createManual,setAccess,brand,saveBrand,jobs,job,enqueue,advance,claim,authorized,heartbeat,finish,fail,exportPost};
}
module.exports={createRepository};
