'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const core=require('./core.cjs');
const {createHandler}=require('./http.cjs');
const {createRepository}=require('./repository.cjs');
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function jpegSize(b){
  core.check(b.length>10&&b[0]===255&&b[1]===216,'invalid_jpeg','Arte inválida. Gere novamente em JPEG.');
  let p=2;
  while(p+4<=b.length){
    core.check(b[p]===255,'invalid_jpeg','JPEG inválido.');while(b[p]===255)p++;
    const marker=b[p++];if(marker===217||marker===218)break;
    if(marker===1||(marker>=208&&marker<=215))continue;
    core.check(p+2<=b.length,'invalid_jpeg','JPEG incompleto.');const length=b.readUInt16BE(p);
    core.check(length>=2&&p+length<=b.length,'invalid_jpeg','JPEG incompleto.');
    if([192,193,194].includes(marker)){core.check(length>=8,'invalid_jpeg','JPEG inválido.');return {height:b.readUInt16BE(p+3),width:b.readUInt16BE(p+5)};}
    p+=length;
  }
  throw new core.FeedError('invalid_jpeg','Não foi possível identificar as dimensões do JPEG.');
}
async function readSafe(root,outputDir,relative){
  core.check(typeof relative==='string'&&!path.isAbsolute(relative)&&!relative.includes('\0'),'invalid_path','Arquivo inválido.');
  const realRoot=await fs.realpath(root),realDir=await fs.realpath(outputDir);
  core.check(realDir.startsWith(realRoot+path.sep),'invalid_path','Pasta de geração inválida.');
  const target=await fs.realpath(path.resolve(realDir,relative));
  core.check(target.startsWith(realDir+path.sep),'invalid_path','Arquivo fora da geração.');
  const flags=require('node:fs').constants;
  const h=await fs.open(target,flags.O_RDONLY|flags.O_NOFOLLOW);
  try{const stat=await h.stat();core.check(stat.isFile()&&stat.size>0&&stat.size<=8_000_000,'invalid_file','Arte indisponível ou maior que 8 MB.');return await h.readFile();}finally{await h.close();}
}
function sourceProvider(pool,root='/data/studio/rendered'){
  async function load(postId,{withAssets=true}={}){
    const posts=await pool.query(`SELECT p.id,p.source_title,p.source_text,p.updated_at,c.slug,c.status AS client_status
      FROM posts p JOIN clients c ON c.id=p.client_id WHERE p.id=$1 AND c.slug='community' AND c.status='active'`,[postId]);
    const post=posts.rows[0];core.check(post,'wrong_client','Post Community News não encontrado.',404);
    const jobs=await pool.query('SELECT id,status,result_json,output_dir FROM generation_jobs WHERE post_id=$1 ORDER BY created_at DESC LIMIT 20',[postId]);
    const job=jobs.rows.find(j=>j.status==='completed');
    const inputs=await pool.query('SELECT id,role,display_order,credit,updated_at FROM post_assets WHERE post_id=$1 ORDER BY id',[postId]);
    const context={post_id:post.id,client_slug:post.slug,title:post.source_title,generation_id:job?.id||null,generation_status:job?.status||null,generation_active:jobs.rows.some(j=>['pending','running'].includes(j.status)),assets:[]};
    const names=new Set();
    // Only explicit JPEG editorial slides. Never append contact sheets or the 9:16 Reels cover.
    const slides=(job?.result_json?.jpg_slides||[]).filter(s=>s&&typeof s.jpg==='string'&&!/reels|story|contact/i.test(String(s.slot)+' '+s.jpg));
    for(const slide of slides){
      if(names.has(slide.jpg))continue;names.add(slide.jpg);
      if(!withAssets)continue;
      if(context.assets.length>=30)break; // Bound discovery; the selected publication remains <=10.
      const bytes=await readSafe(root,job.output_dir,slide.jpg),dimensions=jpegSize(bytes);
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),id=core.hash({generation:job.id,file:slide.jpg}).slice(0,32);
      context.assets.push({id,label:'Arte '+String(slide.number||context.assets.length+1),mime:'image/jpeg',bytes:bytes.length,...dimensions,sha256,
        preview_url:`/posts/${encodeURIComponent(postId)}/feed/image?id=${id}&sha=${sha256}`});
    }
    context.source_digest=core.hash({post,inputs:inputs.rows,generation:job?.id||null,assets:context.assets});
    return {context,job,slides};
  }
  return {getContext:async(id,options)=>(await load(id,options)).context,getImage:async(context,asset)=>{
    const fresh=await load(context.post_id,{withAssets:false});
    core.check(fresh.job,'invalid_asset','Imagem indisponível.',404);
    const slide=fresh.slides.find(s=>core.hash({generation:fresh.job.id,file:s.jpg}).slice(0,32)===asset.id);
    core.check(slide,'invalid_asset','Imagem indisponível.',404);return readSafe(root,fresh.job.output_dir,slide.jpg);
  }};
}
function createStudioFeed({studioPool,Pool,layout,env=process.env}){
  // Feature off means no new pool, reads, migrations, file access or user-visible changes.
  if(env.FR2_FEED_EDITOR_ENABLED!=='true')return {link:()=>'',handle:async()=>false,media:async()=>false};
  const allowed=new Set((env.FR2_FEED_REVIEWER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean));
  let handler,publisher;
  const authorize=user=>!!user&&allowed.has(user.id);
  function initialize(){
    const db=new URL(env.FR2_FEED_DATABASE_URL||'');
    if(!['postgres:','postgresql:'].includes(db.protocol)||decodeURIComponent(db.pathname)!=='/community_publicacoes')throw new Error('dedicated_database_required');
    if(typeof env.FR2_FEED_CSRF_SECRET!=='string'||env.FR2_FEED_CSRF_SECRET.length<32)throw new Error('feed_secret_required'); // pragma: allowlist secret -- type/length validation; no credential value
    const publicOrigin=new URL(env.FR2_FEED_ORIGIN||'');
    if(publicOrigin.protocol!=='https:'||publicOrigin.origin!==env.FR2_FEED_ORIGIN)throw new Error('exact_https_origin_required');
    const publicationPool=new Pool({connectionString:db.href,max:2,connectionTimeoutMillis:3000,statement_timeout:5000,application_name:'community_feed_editor'});
    publicationPool.on('error',()=>console.error('Community News feed: database connection unavailable'));
    const source=sourceProvider(studioPool);
    if(env.FR2_PUBLISH_INSTALLED==='true'){
      const {createAssets}=require('../publisher/assets.cjs'),{createQueue}=require('../publisher/repository.cjs'),{createService}=require('../publisher/service.cjs');
      publisher=createService({queue:createQueue(publicationPool,{imageJobs:env.FR2_IMAGE_JOBS_ENABLED==='true'}),assets:createAssets({directory:env.FR2_PUBLISH_ASSETS_DIR,origin:env.FR2_FEED_ORIGIN,secret:env.FR2_FEED_MEDIA_SECRET}),source,enabled:env.FR2_FEED_PUBLISH_ENABLED==='true'});
    }
    handler=createHandler({...source,repo:createRepository(publicationPool,{publishing:!!publisher}),publisher,origin:env.FR2_FEED_ORIGIN,
      secret:env.FR2_FEED_CSRF_SECRET,authorize,wrap:layout,demo:false});
  }
  return {
    async media(req,res,url){
      if(!url.pathname.startsWith('/community-publicacoes/media/'))return false;
      try{if(!handler)initialize();if(publisher)return await publisher.media(req,res,url);}catch{}
      res.writeHead(404);res.end('Imagem indisponível');return true;
    },
    link(post,user){return post.client_slug==='community'&&authorize(user)?`<p><a class="btn secondary" href="/posts/${escape(post.id)}/feed">Preparar publicação no feed</a></p>`:'';},
    async handle(req,res,user,url){
      if(!/^\/posts\/[\w-]{1,100}\/feed(?:\/|$)/.test(url.pathname))return false;
      try{if(!handler)initialize();return await handler(req,res,user,url);}catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({message:'O editor de publicação ainda não está configurado.'}));return true;}
    }
  };
}
module.exports={createStudioFeed,sourceProvider,jpegSize,readSafe};
