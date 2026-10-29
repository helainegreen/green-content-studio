'use strict';
// Disposable PostgreSQL only. No production data, credentials or external provider calls.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Pool}=require('pg');
const {createRepository}=require('../image-jobs/repository.cjs'),{snapshot,createAdapter}=require('../image-jobs/adapter.cjs');
const {processJob}=require('../image-jobs/engine.cjs'),{createQueue}=require('../publisher/repository.cjs');
const feed=require('../studio-module/core.cjs'),{createRepository:createFeedRepo}=require('../studio-module/repository.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function main(){assert.equal(process.env.FR2_ISOLATED_TEST,'yes');const url=new URL(process.env.FR2_TEST_DATABASE_URL);assert.equal(url.hostname,'community-image-test-db');assert.equal(url.pathname,'/community_publicacoes');
 const admin=new Pool({connectionString:url.href,max:4});let app,studio;const root=await fs.mkdtemp(path.join(os.tmpdir(),'fr2-integration-'));let checks=0,paid=0;
 try{
  await admin.query('CREATE ROLE community_publicacoes_app; CREATE ROLE community_publicador;');
  await admin.query('CREATE DATABASE conteudo');
 }catch(e){await admin.end();throw e;}
 try{
  for(const file of ['studio-module/schema.sql','publisher/schema.sql','publisher/permissions.sql','image-jobs/schema.sql'])await admin.query(await fs.readFile(path.join(__dirname,'..',file),'utf8'));
  await admin.query('GRANT SELECT,INSERT,UPDATE ON feed_drafts,feed_draft_versions TO community_publicacoes_app;');
  app=new Pool({connectionString:url.href,max:4,options:'-c role=community_publicacoes_app'});
  const sUrl=new URL(url);sUrl.pathname='/conteudo';studio=new Pool({connectionString:sUrl.href,max:5});
  await studio.query(`CREATE TABLE clients(id text PRIMARY KEY,slug text,status text,parser_type text);
   CREATE TABLE posts(id text PRIMARY KEY,client_id text REFERENCES clients(id),type text,source_title text,source_text text,status text,updated_at timestamptz DEFAULT now());
   CREATE TABLE post_assets(id text PRIMARY KEY,post_id text REFERENCES posts(id),role text,file_path text,original_name text,mime_type text,size_bytes integer,display_order integer,credit text,updated_at timestamptz DEFAULT now());
   CREATE TABLE generation_jobs(id text PRIMARY KEY,post_id text,status text);
   INSERT INTO clients VALUES('client_community','community','active','community_manual');`);
  const repo=createRepository(app),q=createQueue(app,{imageJobs:true}),fr=createFeedRepo(app,{publishing:true});
  async function newPost(){const id=crypto.randomUUID();await studio.query("INSERT INTO posts(id,client_id,type,source_title,source_text,status) VALUES($1,'client_community','news','Test','Test text','draft')",[id]);return id;}
  async function args(postId,key=crypto.randomUUID(),extra={}){const s=await snapshot(studio,postId);return {postId,key,actor:'tester',kind:'cover',payload:{prompts:['test only'],quality:'low',credit:'IA',cover_payload:{}},expectedBasis:s.basis,...extra};}
  const id=await newPost(),input=await args(id),duplicates=await Promise.all(Array.from({length:4},()=>repo.enqueue(input)));assert.equal(new Set(duplicates.map(j=>j.id)).size,1);checks++;
  const active=await repo.enqueue({...input,key:crypto.randomUUID()});assert.equal(active.id,duplicates[0].id);checks++;
  await assert.rejects(repo.enqueue({...input,key:crypto.randomUUID(),payload:{...input.payload,prompts:['other']}}),e=>e.code==='image_busy');checks++;
  await assert.rejects(repo.enqueue({...input,payload:{...input.payload,quality:'high'}}),e=>e.code==='changed_request');checks++;
  let job=await repo.claim();const stale=structuredClone(job);job=await repo.claim();await assert.rejects(repo.save(stale),e=>e.code==='lost_lease');checks++;
  await repo.save(job,'uncertain');await assert.rejects(repo.enqueue({...input,key:crypto.randomUUID()}),e=>e.code==='confirm_new');job=await repo.enqueue({...input,key:crypto.randomUUID(),confirmedUncertain:true});assert.equal(job.status,'queued');checks++;
  const oldId=crypto.randomUUID(),oldFile=path.join(root,'old.png');await fs.writeFile(oldFile,png);await studio.query("INSERT INTO post_assets(id,post_id,role,file_path,display_order) VALUES($1,$2,'cover',$3,1)",[oldId,id,oldFile]);
  // Editing after admission invalidates the queued snapshot before provider use.
  job=await repo.claim();await processJob({job,repo,studio:createAdapter(studio),root,generate:async()=>paid++});assert.equal((await repo.latest(id)).status,'review_needed');assert.equal(paid,0);checks++;
  await repo.enqueue(await args(id));job=await repo.claim();const c=await studio.connect();try{await processJob({job,repo,studio:createAdapter(c),root,generate:async(_,file)=>{paid++;await fs.writeFile(file,png);}});}finally{c.release();}
  assert.equal((await repo.latest(id)).status,'completed');const rows=(await snapshot(studio,id)).assets;assert.equal(rows.length,1);assert.notEqual(rows[0].id,oldId);assert.deepEqual(await fs.readFile(oldFile),png);checks++;
  // Failed provider calls never delete the previous cover metadata or file.
  await repo.enqueue(await args(id));job=await repo.claim();await processJob({job,repo,studio:createAdapter(studio),root,generate:async()=>{throw Object.assign(Error('quota'),{providerStatus:429});}});assert.equal((await snapshot(studio,id)).assets[0].id,rows[0].id);checks++;
  // Publication and image admission use the same per-post lock in the dedicated database.
  const raceId=await newPost(),ctx={post_id:raceId,client_slug:'community',generation_id:'test',generation_status:'completed',source_digest:'test',assets:[{id:'a',sha256:'a'.repeat(64),mime:'image/jpeg',bytes:100,width:1080,height:1350}]};
  const draft=feed.emptyDraft(ctx);draft.captions.instagram='Test';draft.networks=['instagram'];draft.rights_confirmed=true;await fr.save(raceId,draft,0,'tester');
  const publish={postId:raceId,version:1,review:feed.review(draft,ctx,new Date()),actor:'tester',confirmationKey:crypto.randomUUID()};
  const race=await Promise.allSettled([repo.enqueue(await args(raceId)),q.enqueue(publish)]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert(['image_busy','publication_active'].includes(race.find(r=>r.status==='rejected').reason.code));checks++;
  if(await repo.busy(raceId)){const r=await repo.claim();await repo.save(r,'completed');await q.enqueue(publish);}
  await assert.rejects(repo.enqueue(await args(raceId)),e=>e.code==='publication_active');checks++;
  // Global worker lock survives the whole pass and excludes a second process.
  const c1=await studio.connect(),c2=await studio.connect();try{assert((await c1.query('SELECT pg_try_advisory_lock(58392062) AS locked')).rows[0].locked);assert.equal((await c2.query('SELECT pg_try_advisory_lock(58392062) AS locked')).rows[0].locked,false);await c1.query('SELECT pg_advisory_unlock(58392062)');assert((await c2.query('SELECT pg_try_advisory_lock(58392062) AS locked')).rows[0].locked);await c2.query('SELECT pg_advisory_unlock(58392062)');}finally{c1.release();c2.release();}checks++;
  await assert.rejects(app.query('DELETE FROM image_generation_jobs'),e=>e.code==='42501');checks++;
  console.log(JSON.stringify({ok:true,postgres_integration_checks:checks,simulated_images:paid,external_provider_calls:0}));
 }finally{await Promise.all([app?.end(),studio?.end(),admin.end(),fs.rm(root,{recursive:true,force:true})]);}
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.code||e.name,message:e.message}));process.exitCode=1;});
