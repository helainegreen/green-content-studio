'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {check}=require('../studio-module/core.cjs');
function createVault(directory){
  async function secret(name){const f=path.join(directory,name);const st=await fs.lstat(f);check(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'private_permissions','Credencial indisponível.',503);return fs.readFile(f);}
  async function load(network){
    check(['instagram','facebook'].includes(network),'network','Rede inválida.');
    const key=await secret('capture.key'),e=JSON.parse(await secret(network+'.enc'));
    const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAAD(Buffer.from('community-publicacoes-'+network+'-candidate-v1'));d.setAuthTag(Buffer.from(e.tag,'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()]));
  }
  async function save(network,data){
    const key=await secret('capture.key'),iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('community-publicacoes-'+network+'-candidate-v1'));
    const bytes=Buffer.concat([c.update(JSON.stringify(data)),c.final()]);
    const filename=path.join(directory,network+'.enc'),temporary=filename+'.'+crypto.randomUUID()+'.tmp';
    const h=await fs.open(temporary,'wx',0o600);try{await h.writeFile(JSON.stringify({v:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:bytes.toString('base64')}));await h.sync();}finally{await h.close();}
    await fs.rename(temporary,filename);
  }
  return {load,save,token:async network=>(await load(network)).token,
    async refreshInstagram(now=new Date(),fetchImpl=fetch){
      const stored=await load('instagram'),age=now-new Date(stored.refreshed_at||stored.received_at),remaining=new Date(stored.expires_at)-now;
      check(Number.isFinite(age)&&Number.isFinite(remaining)&&remaining>0,'expired_token','Reconecte o Instagram.',503);
      if(age<24*60*60_000||(age<7*24*60*60_000&&remaining>20*24*60*60_000))return false;
      const url=new URL('https://graph.instagram.com/refresh_access_token');url.searchParams.set('grant_type','ig_refresh_token');url.searchParams.set('access_token',stored.token);
      // URL/token must never enter logs. Only fixed official host; reject all redirects.
      let r,d;try{r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(25_000)});d=await r.json();}catch{throw new Error('refresh_unavailable');}
      check(r.ok&&typeof d.access_token==='string'&&d.access_token.length>=20&&d.access_token.length<=16000&&!/[\s\0]/.test(d.access_token)&&Number.isInteger(d.expires_in)&&d.expires_in>0,'refresh_failed','Renovação do Instagram pendente.',503);
      const {createMeta}=require('./meta.cjs');
      await createMeta({network:'instagram',accountId:'100000000000004',tokenProvider:async()=>d.access_token,mediaOrigin:'https://studio.example.invalid',fetchImpl}).identity();
      await save('instagram',{...stored,token:d.access_token,refreshed_at:now.toISOString(),expires_at:new Date(now.getTime()+d.expires_in*1000).toISOString()});return true;
    }
  };
}
module.exports={createVault};
