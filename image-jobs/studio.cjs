'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const core=require('./core.cjs'),{createRepository}=require('./repository.cjs');
const {createWorker,filePaths,readPng}=require('./engine.cjs'),{snapshot,createAdapter,postLock}=require('./adapter.cjs');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function readForm(req){let size=0,parts=[];core.check(String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'),'form_type','Formulário inválido.',415);for await(const b of req){size+=b.length;core.check(size<100000,'large_form','Formulário muito grande.',413);parts.push(b);}return Object.fromEntries(new URLSearchParams(Buffer.concat(parts).toString()));}
function createImageJobs({studioPool,Pool,layout,generate,editGenerate,uploadRoot,coverPayloadFromFields,coverPayloadFromPost,env=process.env,dependencies={}}){
  if(env.FR2_IMAGE_JOBS_ENABLED!=='true')return {fields:()=>'',banner:async()=>'',handle:async()=>false,start:()=>{}};
  const allowed=new Set((env.FR2_FEED_REVIEWER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean));
  const authorize=user=>!!user&&allowed.has(user.id)&&user.nav_clients?.some(c=>c.slug==='community');
  let repo,worker;
  function init(){if(repo)return;
    const db=new URL(env.FR2_FEED_DATABASE_URL||'');
    core.check(['postgres:','postgresql:'].includes(db.protocol)&&decodeURIComponent(db.pathname)==='/community_publicacoes'&&decodeURIComponent(db.username)==='community_publicacoes_app','database_config','Banco exclusivo indisponível.',503);
    core.check(typeof env.FR2_FEED_CSRF_SECRET==='string'&&env.FR2_FEED_CSRF_SECRET.length>=32,'secret_config','Configuração indisponível.',503); // pragma: allowlist secret -- type/length validation; no credential value
    const origin=new URL(env.FR2_FEED_ORIGIN||'');core.check(origin.protocol==='https:'&&origin.origin===env.FR2_FEED_ORIGIN,'origin_config','Configuração indisponível.',503);
    const p=dependencies.pool||new Pool({connectionString:db.href,max:1,connectionTimeoutMillis:3000,statement_timeout:5000,application_name:'community_image_jobs'});
    p.on?.('error',()=>console.error('Community News image jobs: database unavailable'));
    repo=dependencies.repo||createRepository(p);
    worker=createWorker({repo,pool:studioPool,adapter:createAdapter,generate:(prompt,file,quality,kind,ref)=>{if(ref){core.check(typeof editGenerate==='function','edit_unavailable','A edição de imagem está indisponível.');return editGenerate(prompt,file,quality,ref);}return generate(prompt,file,quality,kind);},root:uploadRoot,onError:()=>console.error('Community News image jobs: worker unavailable')});
  }
  function fields(user,scope){if(!authorize(user))return '';return `<input type="hidden" name="_image_request" value="${core.escape(core.token(env.FR2_FEED_CSRF_SECRET,user,scope))}"><span data-image-confirm hidden><label style="margin:12px 0"><input type="checkbox" name="_confirm_new" value="1" style="width:auto"> Conferi o pedido sem confirmação e quero solicitar uma nova geração, que poderá ter nova cobrança.</label></span>`;}
  async function banner(postId,user){if(!authorize(user))return '';try{init();const j=core.publicJob(await repo.latest(postId));return `<section class="${j.status==='failed'||j.status==='uncertain'?'warn':'notice'}" data-image-job data-post="${core.escape(postId)}" data-status="${j.status}" data-busy="${j.busy}"><p data-image-message>${core.escape(j.message||'Geração de imagens: pronta para receber pedidos.')}${j.total?` (${j.completed}/${j.total} salvas)`:''}</p>${j.status==='review_needed'?j.files.map(f=>`<p><a href="${core.escape(f.url)}" target="_blank" rel="noopener">Abrir imagem gerada ${f.index+1}</a></p>`).join(''):''}<p data-image-refresh hidden><a href="/posts/${core.escape(postId)}/review">Atualizar a revisão</a></p></section><script src="/community-image-jobs.js" defer></script>`;}catch{return '<div class="warn">O andamento das imagens está indisponível. Aguarde antes de solicitar outra geração.</div>';}}
  function fail(res,user,error,postId){const safe=error instanceof core.ImageJobError;res.writeHead(safe?error.status:503,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(layout({title:'Geração de imagem',user,body:`<div class="warn">${core.escape(safe?error.message:'Não foi possível confirmar o pedido. Volte à revisão e confira o andamento antes de tentar novamente.')}</div><p><a href="${postId?'/posts/'+core.escape(postId)+'/review':'/clients/community/ai-cover'}">Voltar</a></p>`}));}
  async function handle(req,res,user,url){
    const initial=url.pathname==='/clients/community/ai-cover'&&req.method==='POST';
    const m=url.pathname.match(/^\/posts\/([a-f0-9-]{36})\/(generate-ai-cover|regenerate-ai-cover|generate-ai-internal-images|image-generation\/status|image-generation\/file\/([a-f0-9-]{36})\/(\d+))$/);
    const guard=req.method==='POST'&&url.pathname.match(/^\/posts\/([a-f0-9-]{36})\/(review|assets(?:\/.*)?|feed(?:\/.*)?)$/);
    const script=url.pathname==='/community-image-jobs.js'&&req.method==='GET';
    if(!initial&&!m&&!guard&&!script)return false;
    let release,postId=m?.[1]||guard?.[1];
    try{
      if(guard){const p=await studioPool.query("SELECT 1 FROM posts p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND c.slug='community'",[postId]);if(!p.rowCount)return false;}
      core.check(authorize(user),'forbidden','Acesso não autorizado.',403);init();
      if(script){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(await fs.readFile(path.join(__dirname,'browser.js')));return true;}
      if(guard){release=await postLock(studioPool,postId);core.check(!await repo.busy(postId),'image_busy','Aguarde a imagem ficar pronta antes de salvar alterações ou confirmar a publicação.');
        const unlock=release;release=null;res.once('finish',()=>{void unlock();});res.once('close',()=>{void unlock();});return false;
      }
      if(m){core.check(uuid.test(postId),'invalid_post','Post inválido.',404);await snapshot(studioPool,postId);}
      if(m&&m[2].startsWith('image-generation/')&&req.method==='GET'){
        res.setHeader('Cache-Control','private, no-store');
        if(m[2]==='image-generation/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(core.publicJob(await repo.latest(postId))));}
        else{core.check(uuid.test(m[3]),'missing_file','Arquivo indisponível.',404);const j=await repo.get(postId,m[3]),item=j?.state.items[Number(m[4])];core.check(item?.saved,'missing_file','Arquivo indisponível.',404);const bytes=await readPng(filePaths(uploadRoot,j,item).final);core.check(bytes,'missing_file','Arquivo indisponível.',404);res.writeHead(200,{'Content-Type':'image/png','X-Content-Type-Options':'nosniff'});res.end(bytes);}
        return true;
      }
      core.check(req.method==='POST','method','Método inválido.',405);
      core.check(req.headers.origin===env.FR2_FEED_ORIGIN,'origin','Pedido de origem inválida. Atualize a revisão.',403);
      const form=await readForm(req),scope=initial?'create':postId+':'+m[2];
      const key=core.verify(env.FR2_FEED_CSRF_SECRET,form._image_request,user,scope);
      if(initial)postId=core.postIdFor(key);
      release=await postLock(studioPool,postId);
      let payload,kind=m?.[2]==='generate-ai-internal-images'?'internal':'cover';
      if(initial){const cover=coverPayloadFromFields(form,{ai_prompt:String(form.ai_prompt||'').trim(),ai_quality:String(form.ai_quality||'low')});core.check(cover.headline&&cover.subheadline,'missing_text','Preencha headline e subheadline.',400);payload=core.normalize(kind,form,cover);
        const c=(await studioPool.query("SELECT id FROM clients WHERE slug='community' AND status='active' AND parser_type='community_manual'")).rows[0];core.check(c,'client_missing','Cliente indisponível.',404);
        await studioPool.query("INSERT INTO posts(id,client_id,type,source_title,source_text,status) VALUES($1,$2,'cover_only',$3,$4,'draft') ON CONFLICT(id) DO NOTHING",[postId,c.id,cover.headline,JSON.stringify(cover,null,2)]);
      }else{const current=await snapshot(studioPool,postId);if(m[2]==='regenerate-ai-cover'){core.check(current.post.type==='cover_only','invalid_kind','Este post não é uma capa.',400);const prev=coverPayloadFromPost(current.post);Object.assign(form,{ai_prompt:prev.ai_prompt,ai_quality:prev.ai_quality,credit:prev.cover_credit});}payload=core.normalize(kind,form);}
      const s=await snapshot(studioPool,postId);
      core.check(!(await studioPool.query("SELECT 1 FROM generation_jobs WHERE post_id=$1 AND status IN ('pending','running') LIMIT 1",[postId])).rowCount,'render_active','Aguarde a geração das artes.');
      await repo.enqueue({postId,actor:user.id,key,kind,payload,expectedBasis:s.basis,confirmedUncertain:form._confirm_new==='1'});
      res.writeHead(303,{'Location':'/posts/'+postId+'/review','Cache-Control':'no-store'});res.end();return true;
    }catch(e){fail(res,user,e,postId);return true;}finally{if(release)await release();}
  }
  return {fields,banner,handle,start(){if(env.FR2_IMAGE_WORKER_ENABLED==='true'){try{init();worker.start();}catch{console.error('Community News image jobs: configuration unavailable');}}}};
}
module.exports={createImageJobs,readForm};
