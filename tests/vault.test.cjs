'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createVault}=require('../publisher/vault.cjs');
test('renovação cifrada preserva token anterior em falha e nunca renova Facebook',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fr2-vault-'));const now=new Date('2026-09-24T12:00:00Z');
 try{
  await fs.writeFile(path.join(dir,'capture.key'),crypto.randomBytes(32),{mode:0o600});const vault=createVault(dir),old='IG'+'a'.repeat(100),renewed='IG'+'b'.repeat(100);
  await vault.save('instagram',{token:old,received_at:new Date(now-8*86400000).toISOString(),expires_at:new Date(+now+30*86400000).toISOString()});
  await assert.rejects(vault.refreshInstagram(now,async()=>{throw Error('offline');}));assert.equal((await vault.load('instagram')).token,old);
  let calls=0;assert(await vault.refreshInstagram(now,async url=>{calls++;url=new URL(url);assert.equal(url.origin,'https://graph.instagram.com');if(url.pathname==='/refresh_access_token')return{ok:true,json:async()=>({access_token:renewed,expires_in:60*86400})};return new Response(JSON.stringify({user_id:'100000000000004',username:'community',account_type:'BUSINESS'}));}));
  assert.equal(calls,2);assert.equal(await vault.token('instagram'),renewed);assert.equal((await fs.stat(path.join(dir,'instagram.enc'))).mode&0o777,0o600);
  assert.equal(await vault.refreshInstagram(now,async()=>{throw Error('must not call');}),false);
  const encrypted=await fs.readFile(path.join(dir,'instagram.enc'),'utf8');assert(!encrypted.includes(renewed));
  await fs.chmod(path.join(dir,'capture.key'),0o644);await assert.rejects(vault.load('instagram'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
