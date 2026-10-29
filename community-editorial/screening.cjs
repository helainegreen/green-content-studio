'use strict';
const crypto=require('node:crypto'),c=require('./core.cjs'),time=require('./timeliness.cjs'),geo=require('./geography.cjs');
const transient=new Set(['pending','running']);
function response(row,now=Date.now()){
 const b=row.body,r=b.research?.result;
 let status=row.status;
 if(status==='approved'&&(!time.validAt(r,now)||!geo.valid(r)))status='unavailable';
 const t=b.topic,source=b.source;
 return {day:row.day,...(b.edition?{edition:b.edition}:{}),topic:{client_slug:'community',...t},screening_id:row.id,status,reason:status==='approved'?'Fontes lidas e validade conferida.':b.question||r?.timeliness?.reason||'A conferência automática não foi concluída; a pauta não será enviada.',...(status==='approved'?{verified:{title:(source.title||t.title).replace(/^(?:Apurar|Investigar)(?::|\s)+/i,'').slice(0,300),summary:r.summary,source_url:source.url,publisher:new URL(source.url).hostname,published_at:source.published_at,checked_at:r.checked_at,timeliness:r.timeliness,geography:r.geography}}:{})};
}
function createScreener({pool,research}){
 async function tx(fn){const p=await pool.connect();try{await p.query('BEGIN');c.check((await p.query('SELECT current_database() AS name')).rows[0].name==='community_publicacoes','wrong_database','Banco exclusivo indisponível.',503);const v=await fn(p);await p.query('COMMIT');return v;}catch(e){await p.query('ROLLBACK').catch(()=>{});throw e;}finally{p.release();}}
 return {
 async advance(input){
  c.check(/^\d{4}-\d{2}-\d{2}$/.test(input.day||''),'screen_day','Dia do boletim inválido.');
  const hour=Number(new Date().toLocaleTimeString('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'})),edition=input.edition||(hour>=18?'18':hour>=13?'13':'08');
  c.check(['08','13','18'].includes(edition),'screen_edition','Edição do boletim inválida.');
  const topic=c.topic(input.topic),id=c.hash('screen-v23:'+input.day+':'+edition+':'+topic.id+':'+topic.title).slice(0,32),lease=crypto.randomUUID();
  c.check(!input.screening_id||input.screening_id===id,'screen_id','A referência da conferência mudou.');
  const claimed=await tx(async p=>{
   await p.query("INSERT INTO editorial_screenings(id,day,status,body) VALUES($1,$2,'pending',$3) ON CONFLICT(id) DO NOTHING",[id,input.day,{topic,edition}]);
   const row=(await p.query('SELECT *,day::text AS day FROM editorial_screenings WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!transient.has(row.status))return {row};
   if(row.lease_until){
    if(Date.parse(row.lease_until)>Date.now())return {row};
    row.status='uncertain';row.body.question='A conferência ficou sem confirmação e não será repetida automaticamente.';
    await p.query("UPDATE editorial_screenings SET status=$2,body=$3,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[id,row.status,row.body]);return {row};
   }
   await p.query("UPDATE editorial_screenings SET status='running',lease_id=$2,lease_until=now()+interval '3 minutes',updated_at=now() WHERE id=$1",[id,lease]);return {row,owned:true};
  });
  if(!claimed.owned)return response(claimed.row);
  const b=structuredClone(claimed.row.body);let status;
  const save=async(state,body,release=true)=>tx(async p=>{const q=await p.query('UPDATE editorial_screenings SET status=$3,body=$4,lease_id=CASE WHEN $5 THEN NULL ELSE lease_id END,lease_until=CASE WHEN $5 THEN NULL ELSE lease_until END,updated_at=now() WHERE id=$1 AND lease_id=$2 AND lease_until>now()',[id,lease,state,body,release]);c.check(q.rowCount===1,'lost_lease','A conferência está em andamento.',409);});
  try{
   const result=await research.advance(b,body=>save('running',body,false));
   if(result.pending)status='pending';
   else if(result.source&&time.validAt(b.research?.result)&&geo.valid(b.research?.result)){b.source=result.source;status='approved';}
   else{status=!b.research?.documents?.length&&b.research?.failures?.some(f=>f.code!=='source_incomplete')?'uncertain':'unavailable';b.question=result.question||'A fonte ainda não sustenta uma sugestão atual e completa.';}
  }catch(e){status=e.uncertain||!(e instanceof c.Fault)?'uncertain':'unavailable';b.error_code=e.code||'screening_unconfirmed';b.question='A conferência automática não pôde ser concluída. Esta pauta não será enviada como sugestão.';}
  await save(status,b);return response({id,day:input.day,status,body:b});
 },
 async approved(day,inputs){
  return tx(async p=>{const out=[];for(const input of inputs){
   c.check(/^[a-f0-9]{32}$/.test(input.screening_id||''),'screen_required','A pauta precisa passar pela conferência automática antes de entrar no boletim.');
   const row=(await p.query('SELECT *,day::text AS day FROM editorial_screenings WHERE id=$1',[input.screening_id])).rows[0];
   c.check(row&&row.day===day&&row.body.topic.source_id===input.source_id&&row.status==='approved'&&time.validAt(row.body.research?.result)&&geo.valid(row.body.research?.result),'screen_unapproved','A fonte não foi aprovada para este boletim.');
   c.fresh({...row.body,schedule_local:''});const verified=response(row).verified;
   out.push({...row.body.topic,title:verified.title,summary:verified.summary,questions:[],angle:'',why_now:'Matéria completa lida; localização e validade conferidas pelo serviço.',screening:{id:row.id,...verified}});
  }return out;});
 }
 };
}
module.exports={createScreener,response};
