'use strict';
const crypto=require('node:crypto'),c=require('./core.cjs'),topics=require('./topics.cjs');
function createRepository(pool){
 async function tx(fn){const p=await pool.connect();try{await p.query('BEGIN');c.check((await p.query('SELECT current_database() AS name')).rows[0].name==='community_publicacoes','wrong_database','Banco exclusivo indisponível.',503);const v=await fn(p);await p.query('COMMIT');return v;}catch(e){await p.query('ROLLBACK').catch(()=>{});throw e;}finally{p.release();}}
 const unpack=r=>r?{...r,...r.body,version:Number(r.version)}:null;
 async function event(p,id,kind,body){await p.query('INSERT INTO editorial_events(id,request_id,kind,body) VALUES($1,$2,$3,$4) ON CONFLICT(request_id,kind) DO NOTHING',[crypto.randomUUID(),id,kind,body]);}
 return {
 async manualCreate(input,actor){return tx(async p=>{
  const m=require('./manual.cjs').create(input,actor);
  await p.query('INSERT INTO editorial_topics(id,day,body) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[m.topic_id,new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),m.topic]);
  await p.query('SELECT id FROM editorial_topics WHERE id=$1 FOR UPDATE',[m.topic_id]);
  const old=(await p.query('SELECT id,actor FROM editorial_requests WHERE topic_id=$1',[m.topic_id])).rows[0];
  if(old){c.check(old.actor===actor,'owner','Pedido indisponível.',403);return old.id;}
  await p.query("INSERT INTO editorial_requests(id,topic_id,post_id,actor,body,status) VALUES($1,$2,$3,$4,$5,'manual_draft')",[m.id,m.topic_id,m.post_id,actor,m.body]);
  await p.query('INSERT INTO editorial_versions(request_id,version,actor,body) VALUES($1,1,$2,$3)',[m.id,actor,m.body]);return m.id;
 });},
 async locked(id,fn){return tx(async p=>fn(unpack((await p.query('SELECT * FROM editorial_requests WHERE id=$1 FOR UPDATE',[id])).rows[0])));},
 async intake(day,topics){c.check(/^\d{4}-\d{2}-\d{2}$/.test(day)&&topics.length<=6,'invalid_batch','Boletim inválido.');return tx(async p=>{const saved=[];for(const t of topics){const alias=(await p.query("SELECT id FROM editorial_topics WHERE body->'aliases' ? $1 LIMIT 1",[t.id])).rows[0];let id=alias?.id;if(!id){await p.query('INSERT INTO editorial_topics(id,day,body) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[t.id,day,t]);id=(await p.query('SELECT id FROM editorial_topics WHERE id=$1',[t.id])).rows[0]?.id;}c.check(id,'intake_missing','Não foi possível guardar a pauta.',503);saved.push({id,source_id:t.source_id,path:c.BASE+'?topic='+id});}return {count:saved.length,topics:saved,path:c.BASE};});},
 async list(options={filter:'all',page:1,size:24}){return tx(async p=>{
  const {filter,page,size,topic}=options;
  const query=`WITH inbox AS (
   SELECT t.id,t.day::text,t.created_at,t.body,r.id AS request_id,CASE WHEN EXISTS(SELECT 1 FROM publication_deliveries d WHERE d.post_id=r.post_id::text AND d.status='scheduled') THEN 'scheduled' ELSE r.status END AS request_status,r.body->'copy'->>'headline' AS display_title,
    CASE WHEN r.id IS NOT NULL AND EXISTS(SELECT 1 FROM publication_deliveries d WHERE d.post_id=r.post_id::text AND d.status='published') AND NOT EXISTS(SELECT 1 FROM publication_deliveries d WHERE d.post_id=r.post_id::text AND d.status NOT IN ('published','cancelled')) THEN 'published'
     WHEN r.status='unavailable' OR r.id IS NULL AND (t.body->'screening'->>'status'='unavailable' OR NULLIF(t.body->'screening'->'timeliness'->>'valid_until','')::timestamptz<now()) THEN 'unavailable' WHEN r.id IS NOT NULL THEN 'in_progress' WHEN t.body->'review'->>'status'='rejected' THEN 'rejected' ELSE 'pending' END AS review_status
   FROM editorial_topics t LEFT JOIN editorial_requests r ON r.topic_id=t.id
  )`;
  const counts={all:0,pending:0,in_progress:0,published:0,rejected:0,unavailable:0};
  for(const r of (await p.query(query+' SELECT review_status,count(*)::int AS n FROM inbox GROUP BY review_status')).rows){counts[r.review_status]=r.n;counts.all+=r.n;}
  const pages=topic?1:Math.max(1,Math.ceil(counts[filter]/size)),current=Math.min(page,pages);
  const rows=(await p.query(query+" SELECT * FROM inbox WHERE ($1='all' OR review_status=$1) AND ($4::text IS NULL OR id=$4) ORDER BY day DESC,created_at DESC,id DESC LIMIT $2 OFFSET $3",[filter,size,(current-1)*size,topic||null])).rows;
  return {topics:rows.map(r=>({...r.body,id:r.id,day:r.day,request_id:r.request_id,request_status:r.request_status,display_title:r.display_title,review_status:r.review_status})),requests:[],inbox:{filter,page:current,pages,counts,...(topic?{topic}:{})}};
 });},
 async calendar(month=''){return tx(async p=>{
  const current=month||new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).format(new Date());
  c.check(/^\d{4}-(0[1-9]|1[0-2])$/.test(current),'invalid_month','Confira o mês da agenda.');
  const rows=(await p.query(`SELECT d.post_id,d.network,d.status,d.due_at,d.error_code,d.result,
    a.snapshot,r.id::text AS request_id,
    COALESCE(NULLIF(r.body->'copy'->>'headline',''),NULLIF(r.body->'topic'->>'title',''),'Postagem Community News') AS title
   FROM publication_deliveries d
   JOIN publication_approvals a ON a.id=d.approval_id
   LEFT JOIN editorial_requests r ON r.post_id::text=d.post_id
   WHERE d.due_at >= (to_date($1,'YYYY-MM')::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND d.due_at < ((to_date($1,'YYYY-MM')+interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo')
   ORDER BY d.due_at,d.post_id,d.network`,[current])).rows;
  const grouped=new Map();
  for(const row of rows){
   let item=grouped.get(row.post_id);
   if(!item){
    const cover=row.snapshot?.assets?.[0];
    item={post_id:row.post_id,request_id:row.request_id,title:row.title,due_at:new Date(row.due_at).toISOString(),
      cover:cover?.id&&cover?.sha256?{id:cover.id,sha256:cover.sha256}:null,deliveries:[]};
    grouped.set(row.post_id,item);
   }
   item.deliveries.push({network:row.network,status:row.status,error_code:row.error_code||'',result:row.result||null});
  }
  return {month:current,entries:[...grouped.values()]};
 });},
 async reviewTopic(id,input,actor){return tx(async p=>{
  const row=(await p.query('SELECT body FROM editorial_topics WHERE id=$1 FOR UPDATE',[id])).rows[0];c.check(row,'missing_topic','Pauta não encontrada.',404);
  c.check(!(await p.query('SELECT id FROM editorial_requests WHERE topic_id=$1',[id])).rowCount,'already_selected','A pauta já está em preparação. Use a página do pedido.',409);
  const next=topics.review(row.body,input,actor);
  await p.query('UPDATE editorial_topics SET body=$2 WHERE id=$1',[id,next]);return {ok:true,topic:next};
 });},
 async get(id){return tx(async p=>unpack((await p.query('SELECT * FROM editorial_requests WHERE id=$1',[id])).rows[0]));},
 async select(items,actor){return tx(async p=>{const ids=[];for(const i of [...items].sort((a,b)=>a.topic_id.localeCompare(b.topic_id))){
  const t=(await p.query('SELECT body FROM editorial_topics WHERE id=$1 FOR UPDATE',[i.topic_id])).rows[0];c.check(t,'missing_topic','Pauta não encontrada.',404);
  const existing=(await p.query('SELECT id FROM editorial_requests WHERE topic_id=$1',[i.topic_id])).rows[0];if(existing){ids.push(existing.id);continue;}
  const selected=topics.selectedTopic(t.body,i),id=crypto.randomUUID(),postId=crypto.randomUUID();
  const body={topic:selected,guidance:i.guidance||selected.review?.guidance||'',schedule_local:c.schedule(i.schedule_local||selected.review?.schedule_local||''),profile:c.PROFILE,revision:1,origin:'email'};
  let status='queued';
  if(i.research!==true&&selected.screening?.id&&selected.url===(t.body.screening?.source_url||t.body.url)){
   const screen=(await p.query("SELECT body FROM editorial_screenings WHERE id=$1 AND status='approved'",[selected.screening.id])).rows[0]?.body;
   if(screen&&require('./timeliness.cjs').validAt(screen.research?.result)&&require('./geography.cjs').valid(screen.research?.result)){
    try{c.fresh({...screen,schedule_local:body.schedule_local});body.source=screen.source;body.research=screen.research;status='awaiting_images';}catch{}
   }
  }
  await p.query('INSERT INTO editorial_requests(id,topic_id,post_id,actor,body,status) VALUES($1,$2,$3,$4,$5,$6)',[id,i.topic_id,postId,actor,body,status]);
  await p.query('INSERT INTO editorial_versions(request_id,version,actor,body) VALUES($1,1,$2,$3)',[id,actor,body]);ids.push(id);
 }return ids;});},
 async revise(id,version,actor,fn){return tx(async p=>{const row=(await p.query('SELECT * FROM editorial_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];c.check(row&&Number(row.version)===version,'stale','Esta versão mudou. Atualize a página.',409);c.check(!row.lease_until||Date.parse(row.lease_until)<Date.now(),'busy','Aguarde a preparação em andamento.',409);c.check(!(await p.query("SELECT 1 FROM publication_deliveries WHERE post_id=$1 AND status<>'cancelled' LIMIT 1",[row.post_id])).rowCount,'publication_active','Confira o envio existente antes de alterar.',409);const next=await fn(unpack(row));const r=await p.query('UPDATE editorial_requests SET body=$2,status=$3,version=version+1,error_code=NULL,updated_at=now() WHERE id=$1 RETURNING *',[id,next.body,next.status]);await p.query('INSERT INTO editorial_versions(request_id,version,actor,body) VALUES($1,$2,$3,$4)',[id,version+1,actor,next.body]);return unpack(r.rows[0]);});},
 async claim(){return tx(async p=>{
 const stale=(await p.query("UPDATE editorial_requests SET status='uncertain',error_code='text_result_uncertain',lease_id=NULL,lease_until=NULL,updated_at=now() WHERE status='writing' AND lease_until<now() RETURNING id")).rows;
 for(const r of stale)await event(p,r.id,'uncertain',{message:'A geração de texto ficou sem confirmação. Não será repetida automaticamente.'});
 const row=(await p.query("SELECT * FROM editorial_requests WHERE status IN ('manual_queued','manual_research_queued','manual_researching','manual_copy_queued','queued','fetching','copy_ready','image_pending','render_pending') AND (lease_until IS NULL OR lease_until<now()) ORDER BY updated_at LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];if(!row)return null;row.lease_id=crypto.randomUUID();await p.query("UPDATE editorial_requests SET lease_id=$2,lease_until=now()+interval '5 minutes' WHERE id=$1",[row.id,row.lease_id]);return unpack(row);
 });},
 async save(job,status,body=job.body,error=null){return tx(async p=>{const r=await p.query('UPDATE editorial_requests SET status=$3,body=$4,error_code=$5,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2 AND lease_until>now() RETURNING id',[job.id,job.lease_id,status,body,error]);c.check(r.rowCount===1,'lost_lease','A preparação exige conferência.',409);if(['manual_ready','manual_needs_input','awaiting_images','ready','needs_input','uncertain','unavailable'].includes(status))await event(p,job.id,status+':'+body.revision,{title:body.topic.title,message:error==='provider_quota'?body.question:status==='manual_ready'?'Suas opções de título, subtítulo e legenda estão prontas.':status==='manual_needs_input'?'Confira a pergunta sobre o material enviado.':status==='ready'?'A versão recomendada está pronta para revisão.':status==='awaiting_images'?'Escolha como usar as imagens antes da geração.':status==='unavailable'?'O serviço retirou uma pauta sem base atual suficiente. Nenhuma pesquisa é necessária da sua parte.':'A pauta precisa da sua atenção.',path:c.BASE+'/'+job.id});});},
 async checkpointResearch(job,body){return tx(async p=>{const r=await p.query("UPDATE editorial_requests SET status='fetching',body=$3,updated_at=now() WHERE id=$1 AND lease_id=$2 AND lease_until>now() RETURNING id",[job.id,job.lease_id,body]);c.check(r.rowCount===1,'lost_lease','A pesquisa exige conferência.',409);});},
 async checkpointManualResearch(job,body){return tx(async p=>{const r=await p.query("UPDATE editorial_requests SET status='manual_researching',body=$3,updated_at=now() WHERE id=$1 AND lease_id=$2 AND lease_until>now() RETURNING id",[job.id,job.lease_id,body]);c.check(r.rowCount===1,'lost_lease','A pesquisa exige conferência.',409);});},
 async dispatched(job){return tx(async p=>{const r=await p.query("UPDATE editorial_requests SET status='writing' WHERE id=$1 AND lease_id=$2 AND lease_until>now() RETURNING id",[job.id,job.lease_id]);c.check(r.rowCount===1,'lost_lease','Pedido indisponível.',409);});},
 async events(){return tx(async p=>{const rows=(await p.query("SELECT e.* FROM editorial_events e JOIN editorial_requests r ON r.id=e.request_id WHERE e.delivered_at IS NULL AND (e.lease_until IS NULL OR e.lease_until<now()) AND NOT EXISTS(SELECT 1 FROM publication_deliveries d WHERE d.post_id=r.post_id::text AND d.status<>'cancelled') AND (e.kind=r.status||':'||(r.body->>'revision') OR e.kind='uncertain' AND r.status='uncertain') ORDER BY e.created_at LIMIT 6 FOR UPDATE OF e SKIP LOCKED")).rows;for(const row of rows){row.lease_id=crypto.randomUUID();await p.query("UPDATE editorial_events SET lease_id=$2,lease_until=now()+interval '10 minutes' WHERE id=$1",[row.id,row.lease_id]);}return rows.map(r=>({id:r.id,lease_id:r.lease_id,kind:r.kind,...r.body}));});},
 async ack(id,lease){return tx(p=>p.query('UPDATE editorial_events SET delivered_at=now(),lease_until=NULL WHERE id=$1 AND lease_id=$2 AND delivered_at IS NULL',[id,lease]));},
 };
}
module.exports={createRepository};
