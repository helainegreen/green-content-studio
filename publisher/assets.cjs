'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {constants}=require('node:fs');
const {check}=require('../studio-module/core.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function createAssets({directory,origin,secret,clock=()=>Date.now()}){
  check(path.isAbsolute(directory)&&secret?.length>=32,'media_configuration','Armazenamento de mídia indisponível.',503);
  const sign=(hash,expires)=>crypto.createHmac('sha256',secret).update(hash+'\n'+expires).digest('hex');
  const target=hash=>{check(/^[a-f0-9]{64}$/.test(hash),'invalid_asset','Imagem inválida.');return path.join(directory,hash+'.jpg');};
  async function read(hash){
    const h=await fs.open(target(hash),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const st=await h.stat();check(st.isFile()&&st.size>0&&st.size<=8_000_000,'invalid_media','Imagem indisponível.');const bytes=await h.readFile();check(sha(bytes)===hash,'corrupt_media','A imagem armazenada mudou.',503);return bytes;}finally{await h.close();}
  }
  return {
    async freeze(context,review,getImage){
      await fs.mkdir(directory,{recursive:true,mode:0o700});
      const space=await fs.statfs(directory);
      check(space.bavail*space.bsize>2*1024*1024*1024+review.snapshot.assets.reduce((n,a)=>n+a.bytes,0),'media_storage_full','O armazenamento precisa de espaço antes de confirmar a publicação.',503);
      for(const asset of review.snapshot.assets){
        const bytes=await getImage(context,asset);
        check(bytes.length===asset.bytes&&sha(bytes)===asset.sha256&&bytes[0]===255&&bytes[1]===216,'source_changed','As artes mudaram. Revise novamente.',409);
        let h;try{h=await fs.open(target(asset.sha256),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await h.writeFile(bytes);await h.sync();}
        catch(e){if(e.code!=='EEXIST')throw e;}finally{await h?.close();}
        await read(asset.sha256);
      }
    },
    async url(hash){await read(hash);const expires=String(Math.floor(clock()/1000)+86400);return origin+'/community-publicacoes/media/'+hash+'.jpg?expires='+expires+'&sig='+sign(hash,expires);},
    async handle(req,res,url){
      if(!url.pathname.startsWith('/community-publicacoes/media/'))return false;
      try{
        const m=url.pathname.match(/^\/community-publicacoes\/media\/([a-f0-9]{64})\.jpg$/),exp=url.searchParams.get('expires'),sig=url.searchParams.get('sig');
        const seconds=Math.floor(clock()/1000);
        check(['GET','HEAD'].includes(req.method)&&m&&/^\d{10}$/.test(exp||'')&&/^[a-f0-9]{64}$/.test(sig||'')&&[...url.searchParams].length===2&&Number(exp)>seconds&&Number(exp)<=seconds+86400,'invalid_media_link','Link indisponível.',404);
        check(crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(m[1],exp))),'invalid_media_link','Link indisponível.',404);
        const bytes=await read(m[1]);res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:bytes);
      }catch{res.writeHead(404,{'Cache-Control':'no-store'});res.end('Imagem indisponível');}return true;
    }
  };
}
module.exports={createAssets};
