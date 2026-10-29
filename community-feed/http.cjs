'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const core=require('./core.cjs');
const {editor}=require('./editor.cjs');
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function readBody(req){
  core.check(req.headers['content-type']?.split(';')[0]==='application/json','json_required','Envie dados da revisão em JSON.',415);
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;core.check(size<=128_000,'too_large','A revisão ultrapassou o tamanho permitido.',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new core.FeedError('invalid_json','Revisão inválida.',400);}
}
function createHandler({getContext,getImage,repo,origin,secret,authorize,wrap,demo=false,clock=()=>new Date()}) {
  if(typeof secret!=='string'||secret.length<32)throw new Error('feed_secret_required'); // pragma: allowlist secret -- type/length validation; no credential value
  if(new URL(origin).origin!==origin)throw new Error('exact_origin_required');
  return async function handle(req,res,user,url) {
    const match=url.pathname.match(/^\/posts\/([\w-]{1,100})\/feed(?:\/(editor\.js|save|review|confirm|image))?$/);
    if(!match)return false;
    const [,postId,action]=match,base='/posts/'+postId+'/feed';
    try {
      core.check(user&&authorize(user),'reviewer_denied','Acesso à publicação não autorizado.',403);
      const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('gcs_session='))||'';
      core.check(demo||cookie.length>12,'session_required','Entre novamente no Studio.',403);
      const session=crypto.createHash('sha256').update(cookie||'demo').digest('hex');
      const context=await getContext(postId,{withAssets:!['editor.js','image'].includes(action)});core.scope(context);
      core.check(context.post_id===postId,'wrong_post','Post não encontrado.',404);
      if(req.method==='GET'&&action==='editor.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(fs.readFileSync(path.join(__dirname,'editor.js')));return true;}
      if(req.method==='GET'&&action==='image'){
        core.check(getImage,'image_unavailable','Imagem indisponível.',404);
        const asset={id:url.searchParams.get('id'),sha256:url.searchParams.get('sha')};
        core.check(/^[a-f0-9]{32}$/.test(asset.id)&&/^[a-f0-9]{64}$/.test(asset.sha256),'stale_image','A imagem mudou; atualize a revisão.',409);
        const image=await getImage(context,asset);core.check(crypto.createHash('sha256').update(image).digest('hex')===asset.sha256,'stale_image','A imagem mudou.',409);
        res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(image);return true;
      }
      const now=clock();
      if(req.method==='GET'&&!action){
        const record=await repo.get(postId)||{version:0,draft:core.emptyDraft(context)};
        // Preserve caption text on a generation change, but require a fresh explicit selection/review.
        const changed=record.draft.source_digest!==context.source_digest;
        if(changed){record.draft={...record.draft,source_digest:context.source_digest,generation_id:context.generation_id,assets:context.assets.slice(0,10).map(a=>({id:a.id,alt_text:''})),rights_confirmed:false};}
        const csrf=core.seal({purpose:'csrf',postId,userId:user.id,session,expires:now.getTime()+8*60*60_000},secret);
        let body=editor({context,record,csrf,base,demo});
        if(changed)body='<p role="status">As artes ou a notícia mudaram. A legenda foi preservada; revise as imagens e salve novamente.</p>'+body;
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(wrap({title:'Publicar no feed',user,body}));return true;
      }
      core.check(req.method==='POST'&&['save','review','confirm'].includes(action),'method_not_allowed','Ação não permitida.',405);
      core.check(req.headers.origin===origin,'origin_denied','Atualize a página antes de continuar.',403);
      core.unseal(req.headers['x-fr2-csrf'],secret,{purpose:'csrf',postId,userId:user.id,session},now.getTime());
      const input=await readBody(req);
      core.check(Number.isSafeInteger(input.expected_version)&&input.expected_version>=0,'invalid_version','Versão inválida.',409);
      if(action==='save'){
        core.sameSource(input.draft,context);
        const draft=core.normalize(input.draft,context);
        const record=await repo.save(postId,draft,input.expected_version,user.id);
        json(res,200,{record});return true;
      }
      const record=await repo.get(postId);
      core.check(record&&record.version===input.expected_version,'stale_version','Outra revisão foi salva. Atualize a página antes de continuar.',409);
      const review=core.review(record.draft,context,now);
      if(action==='review'){
        const token=core.seal({purpose:'publish',postId,userId:user.id,session,version:record.version,fingerprint:review.fingerprint,expires:now.getTime()+10*60_000},secret);
        json(res,200,{token,previews:review.previews,can_confirm:demo,message:demo?'Esta confirmação é uma simulação. Nenhum post será publicado ou agendado nas redes.':'A publicação real aguarda a conexão e validação das contas Meta. Seu rascunho está salvo.'});return true;
      }
      core.unseal(input.token,secret,{purpose:'publish',postId,userId:user.id,session,version:record.version,fingerprint:review.fingerprint},now.getTime());
      // Fail closed. There is deliberately no external transport in this reviewable stage.
      core.check(demo,'publisher_not_connected','A publicação real ainda não está conectada. O rascunho foi preservado.',412);
      json(res,200,{simulated:true,published:false,scheduled:false,message:record.draft.timing==='now'?'Simulação concluída. Nenhum post foi publicado.':'Simulação concluída. Nenhum agendamento real foi criado.'});return true;
    } catch(error) {
      const known=error instanceof core.FeedError;
      json(res,known?error.status:500,{code:known?error.code:'internal_error',message:known?error.message:'Não foi possível concluir. Seu conteúdo salvo foi preservado.'});return true;
    }
  };
}
module.exports={createHandler};
