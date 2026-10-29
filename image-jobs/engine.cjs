'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {check,ImageJobError,classify}=require('./core.cjs');
const uuid=/^[a-f0-9-]{36}$/;
function filePaths(root,job,item){check(uuid.test(job.post_id)&&uuid.test(item.id),'invalid_path','Arquivo inválido.');const dir=path.join(root,job.post_id);return {dir,final:path.join(dir,item.id+'.png'),pending:path.join(dir,item.id+'.pending.png')};}
// Check every chunk and its CRC, including IEND: a process killed while writing is not a saved image.
function pngSize(b){
  if(b.length<57||!b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return false;
  let pos=8,idat=false,header=false;
  while(pos+12<=b.length){const len=b.readUInt32BE(pos),end=pos+8+len;if(end+4>b.length)return false;const type=b.toString('ascii',pos+4,pos+8);
    let crc=0xffffffff;for(let i=pos+4;i<end;i++){crc^=b[i];for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    if(((crc^0xffffffff)>>>0)!==b.readUInt32BE(end))return false;
    if(!header){if(type!=='IHDR'||len!==13||b.readUInt32BE(pos+8)<1||b.readUInt32BE(pos+12)<1)return false;header=true;}
    if(type==='IDAT')idat=true;
    if(type==='IEND')return len===0&&idat&&end+4===b.length?b.length:false;
    pos=end+4;
  }return false;
}
async function readPng(file){let h;try{h=await fs.open(file,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);const s=await h.stat();if(!s.isFile()||s.size>30_000_000)return null;const b=await h.readFile();return pngSize(b)?b:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}finally{await h?.close();}}
async function recoverFile(paths){if(await readPng(paths.final))return true;if(await readPng(paths.pending)){await fs.rename(paths.pending,paths.final);return true;}return false;}
async function processJob({job,repo,studio,generate,root,alive=()=>true}){
  try{
    for(let n=0;n<job.state.items.length;n++){
      check(alive(),'lost_connection','Conexão interrompida.');const item=job.state.items[n],files=filePaths(root,job,item);
      if(item.applied)continue;
      // A database commit can precede the queue checkpoint; recognize it without another paid call.
      const attached=await studio.attached(job,item);
      if(attached){item.applied=true;item.saved=true;job.state.basis=attached;await repo.save(job);continue;}
      if(await recoverFile(files)){item.saved=true;await repo.save(job);}
      else{
        if(item.dispatched)throw new Error('unconfirmed_dispatch');
        await studio.validate(job);
        await fs.mkdir(files.dir,{recursive:true});
        check(alive(),'lost_connection','Conexão interrompida.');
        item.dispatched=true;await repo.save(job); // Durable BEFORE contacting the paid provider.
        await studio.fence();
        await generate(job.payload.prompts[n],files.pending,job.payload.quality,job.kind,job.payload.edit_reference);
        if(!await recoverFile(files))throw new Error('incomplete_provider_file');
        item.saved=true;await repo.save(job);
      }
      check(alive(),'lost_connection','Conexão interrompida.');
      await studio.fence();
      job.state.basis=await studio.apply(job,item,files.final,(await fs.stat(files.final)).size);
      item.applied=true;await repo.save(job);
    }
    await repo.save(job,'completed');
  }catch(error){
    // Losing the lock/lease leaves the dispatched checkpoint for the next worker to inspect.
    if(!alive()||['lost_lease','lost_connection'].includes(error?.code))return;
    const result=classify(error);await repo.save(job,result.status,result.code);
  }
}
function createWorker({repo,pool,adapter,generate,root,onError=()=>{}}){let stopped=true,timer,running=false;
  async function tick(){if(stopped||running)return;running=true;let c,locked=false,lost=false;
    const lostConnection=()=>{lost=true;};
    try{c=await pool.connect();c.on('error',lostConnection);
      locked=(await c.query('SELECT pg_try_advisory_lock(58392062) AS locked')).rows[0].locked;
      if(locked){const job=await repo.claim();if(job)await processJob({job,repo,studio:adapter(c),generate,root,alive:()=>!lost});}
    }catch{onError();}finally{if(c){if(locked&&!lost)await c.query('SELECT pg_advisory_unlock(58392062)').catch(()=>{lost=true;});c.removeListener('error',lostConnection);c.release(lost);}running=false;if(!stopped){timer=setTimeout(tick,2500);timer.unref?.();}}
  }
  return {start(){if(!stopped)return;stopped=false;void tick();},stop(){stopped=true;clearTimeout(timer);},tick};
}
module.exports={filePaths,pngSize,readPng,recoverFile,processJob,createWorker};
