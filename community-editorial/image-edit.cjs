'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),c=require('./core.cjs');
async function readImage(file){let handle;try{handle=await fs.open(file,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);const stat=await handle.stat();if(!stat.isFile()||stat.size<31||stat.size>14_000_000)return null;const bytes=await handle.readFile();const mime=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;return mime?{bytes,mime}:null;}catch(error){if(error.code==='ENOENT')return null;throw error;}finally{await handle?.close();}}
async function reference(root,postId,file){
 const dir=path.join(root,c.uuid(postId));c.check(typeof file==='string'&&path.dirname(file)===dir,'image_reference','A imagem atual não está disponível para edição.');
 c.check(await fs.realpath(dir)===path.join(await fs.realpath(root),postId),'image_reference','Referência de imagem inválida.');
 const image=await readImage(file);c.check(image,'image_reference','A imagem atual não está disponível para edição.');
 return {path:file,post_id:postId,sha256:c.hash(image.bytes),bytes:image.bytes.length,mime:image.mime};
}
async function generate({root,key,model,size,prompt,outPath,quality,ref,fetcher=fetch}){
 const checked=await reference(root,ref.post_id,ref.path);c.check(checked.sha256===ref.sha256&&checked.bytes===ref.bytes,'image_changed','A imagem de referência mudou. Abra a versão atual.');
 c.check(path.dirname(outPath)===path.join(root,c.uuid(ref.post_id)),'image_output','Destino inválido.');
 const image=await readImage(ref.path);c.check(image&&c.hash(image.bytes)===ref.sha256,'image_changed','A imagem de referência mudou.');
 c.check(key&&model,'image_config','A edição de imagem está indisponível.',503);
 const r=await fetcher('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(420000),body:JSON.stringify({model,images:[{image_url:'data:'+image.mime+';base64,'+image.bytes.toString('base64')}],prompt,quality:quality||'low',size:size||'1024x1536',output_format:'png',n:1})});
 if(!r.ok){const e=new Error('image_edit_provider_rejected');throw e;}
 const data=await r.json();c.check(data.data?.[0]?.b64_json,'image_edit_result','A edição da imagem não retornou um arquivo.');
 const out=Buffer.from(data.data[0].b64_json,'base64');c.check(require('../image-jobs/engine.cjs').pngSize(out),'image_edit_result','O arquivo da edição está incompleto.');await fs.writeFile(outPath,out,{flag:'wx',mode:0o600});
}
module.exports={readImage,reference,generate};
