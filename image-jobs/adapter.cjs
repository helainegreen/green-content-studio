'use strict';
const {check,basis}=require('./core.cjs');
async function snapshot(c,id,{lock=false}={}){
  const post=(await c.query("SELECT p.* FROM posts p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND c.slug='community' AND c.parser_type='community_manual' AND c.status='active'"+(lock?' FOR UPDATE OF p':''),[id])).rows[0];
  check(post,'post_missing','Post Community News não encontrado.',404);
  const assets=(await c.query('SELECT * FROM post_assets WHERE post_id=$1 ORDER BY id',[id])).rows;
  return {post,assets,basis:basis(post,assets)};
}
async function validate(c,job){const s=await snapshot(c,job.post_id);
  check(s.basis===job.state.basis,'post_changed','O post mudou durante a geração.');
  check(!(await c.query("SELECT 1 FROM generation_jobs WHERE post_id=$1 AND status IN ('pending','running') LIMIT 1",[job.post_id])).rowCount,'render_active','Aguarde a geração das artes.');return s;}
function createAdapter(c){return {
  fence:()=>c.query('SELECT 1'),
  validate:job=>validate(c,job),
  async attached(job,item){const s=await snapshot(c,job.post_id);if(!s.assets.some(a=>a.id===item.id))return null;
    if(job.kind==='internal')check(basis(s.post,s.assets.filter(a=>a.id!==item.id))===job.state.basis,'post_changed','O post mudou durante a geração.');return s.basis;},
  async apply(job,item,file,size){await c.query('BEGIN');try{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['fr2-image-post:'+job.post_id]);
    const s=await snapshot(c,job.post_id,{lock:true});
    if(s.assets.some(a=>a.id===item.id)){await c.query('COMMIT');return s.basis;}
    check(s.basis===job.state.basis,'post_changed','O post mudou durante a geração.');
    check(!(await c.query("SELECT 1 FROM generation_jobs WHERE post_id=$1 AND status IN ('pending','running') LIMIT 1",[job.post_id])).rowCount,'render_active','Aguarde a geração das artes.');
    // Replace metadata atomically, preserving the old file for recovery.
    if(job.kind==='cover')await c.query("DELETE FROM post_assets WHERE post_id=$1 AND role='cover'",[job.post_id]);
    const order=job.kind==='cover'?1:Math.max(0,...s.assets.filter(a=>a.role!=='cover').map(a=>Number(a.display_order)))+1;
    await c.query("INSERT INTO post_assets(id,post_id,role,file_path,original_name,mime_type,size_bytes,display_order,credit) VALUES($1,$2,$3,$4,$5,'image/png',$6,$7,$8)",[item.id,job.post_id,job.kind==='cover'?'cover':'internal',file,job.kind==='cover'?'capa-ia-openai.png':'interna-ia-openai.png',size,order,job.payload.credit]);
    if(job.kind==='cover'&&s.post.type==='cover_only'){
      const payload=JSON.parse(s.post.source_text||'{}');Object.assign(payload,{ai_prompt:job.payload.prompts[0],ai_quality:job.payload.quality,cover_credit:job.payload.credit});
      await c.query("UPDATE posts SET source_text=$2,status='draft',updated_at=now() WHERE id=$1",[job.post_id,JSON.stringify(payload,null,2)]);
    }else await c.query("UPDATE posts SET status='draft',updated_at=now() WHERE id=$1",[job.post_id]);
    const after=await snapshot(c,job.post_id);await c.query('COMMIT');return after.basis;
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}}
};}
// Serialize short UI mutations with queue admission and asset attachment, never with the paid call.
async function postLock(pool,id){const c=await pool.connect();let bad=false;const onError=()=>{bad=true;};c.on('error',onError);
  try{await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['fr2-image-post:'+id]);}catch(e){c.removeListener('error',onError);c.release(true);throw e;}let done=false;
  return async()=>{if(done)return;done=true;if(!bad)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['fr2-image-post:'+id]).catch(()=>{bad=true;});c.removeListener('error',onError);c.release(bad);};}
module.exports={snapshot,validate,createAdapter,postLock};
