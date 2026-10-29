'use strict';
// Explicit integration suite for an isolated disposable PostgreSQL container.
// No Meta credentials, HTTP publishing or existing Studio data are used.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Pool}=require('pg');
const core=require('../studio-module/core.cjs'),{createRepository}=require('../studio-module/repository.cjs'),{createQueue}=require('../publisher/repository.cjs');
async function main(){
  assert.equal(process.env.FR2_ISOLATED_TEST,'yes');const url=new URL(process.env.FR2_TEST_DATABASE_URL);assert.equal(url.hostname,'community-publisher-test-db');
  const pool=new Pool({connectionString:url.href,max:6});let checks=0,appPool,workerPool;
  try{
    await pool.query(await fs.readFile(path.join(__dirname,'../studio-module/schema.sql'),'utf8'));
    await pool.query(await fs.readFile(path.join(__dirname,'../publisher/schema.sql'),'utf8'));
    await pool.query('CREATE ROLE community_publicacoes_app; CREATE ROLE community_publicador; GRANT SELECT,INSERT,UPDATE ON feed_drafts,feed_draft_versions TO community_publicacoes_app;');
    await pool.query(await fs.readFile(path.join(__dirname,'../publisher/permissions.sql'),'utf8'));
    appPool=new Pool({connectionString:url.href,max:4,options:'-c role=community_publicacoes_app'});
    workerPool=new Pool({connectionString:url.href,max:4,options:'-c role=community_publicador'});
    const repo=createRepository(appPool,{publishing:true}),appQueue=createQueue(appPool),q=createQueue(workerPool),now=new Date();
    const context={post_id:'integration-only',client_slug:'community',generation_id:'test-generation',generation_status:'completed',source_digest:'source',assets:[{id:'a',sha256:'a'.repeat(64),mime:'image/jpeg',bytes:100,width:1080,height:1350}]};
    let draft=core.emptyDraft(context);draft.captions.instagram='Test only';draft.rights_confirmed=true;
    await repo.save(context.post_id,draft,0,'test');
    const review=core.review(draft,context,now),params={postId:context.post_id,version:1,review,actor:'test',confirmationKey:'confirmation',now};
    const two=await Promise.all([appQueue.enqueue(params),appQueue.enqueue(params)]);assert.equal(two.filter(r=>r.duplicate).length,1);assert.equal((await q.list(context.post_id)).length,2);checks++;
    await assert.rejects(repo.save(context.post_id,draft,1,'test'),e=>e.code==='active_delivery');checks++;
    const jobs=await Promise.all([q.claim(),q.claim()]);assert(jobs[0]&&jobs[1]);assert.notEqual(jobs[0].id,jobs[1].id);assert.equal(await q.claim(),null);checks++;
    await assert.rejects(appQueue.cancel(context.post_id,jobs[0].id,'test'),e=>e.code==='cannot_cancel');checks++;
    const attempt=await q.begin(jobs[0],'publish_container');
    await pool.query("UPDATE publication_deliveries SET lease_until=now()-interval '1 second' WHERE id=$1",[jobs[0].id]);
    await q.claim();assert.equal((await q.list(context.post_id)).find(d=>d.id===jobs[0].id).status,'uncertain');
    assert.equal((await pool.query('SELECT status FROM publication_attempts WHERE id=$1',[attempt])).rows[0].status,'uncertain');checks++;
    await assert.rejects(q.finish(jobs[0],{}),e=>e.code==='lost_lease');checks++;
    await q.finish(jobs[1],{state:{published_id:'123'},delay:0});let resumed=await q.claim();assert.equal(resumed.state.published_id,'123');
    await q.finish(resumed,{status:'published',result:{id:'123',url:'https://www.facebook.com/123'}});assert.equal(await q.claim(),null);checks++;
    const changed=structuredClone(draft);changed.captions.instagram='Changed';await assert.rejects(appQueue.enqueue({...params,version:1,confirmationKey:'new-key',review:core.review(changed,context,now)}));
    checks++;
    const second={...context,post_id:'cancel-only'};draft=core.emptyDraft(second);draft.captions.instagram='Future';draft.rights_confirmed=true;draft.networks=['instagram'];draft.timing='scheduled';
    draft.schedule_local=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()+86400000)).replace(' ','T');
    await repo.save(second.post_id,draft,0,'test');const r=await appQueue.enqueue({postId:second.post_id,version:1,review:core.review(draft,second,now),actor:'test',confirmationKey:'future',now});assert.equal(await q.claim(),null);await appQueue.cancel(second.post_id,r.deliveries[0].id,'test');assert.equal((await q.list(second.post_id))[0].status,'cancelled');checks++;
    await repo.save(second.post_id,draft,1,'test');await appQueue.enqueue({postId:second.post_id,version:2,review:core.review(draft,second,now),actor:'test',confirmationKey:'future-v2',now});assert.equal((await q.list(second.post_id)).filter(d=>d.status==='scheduled').length,1);checks++;
    await q.health('worker',true,{});await q.health('instagram',true,{});assert(await q.readiness(['instagram']));await q.health('instagram',false,{});assert(!await q.readiness(['instagram']));checks++;
    let release;const gate=new Promise(r=>release=r);let entered;const entry=new Promise(r=>entered=r);
    const first=q.exclusive(async()=>{entered();await gate;});await entry;assert.equal(await q.exclusive(async()=>{throw Error('concurrent worker');}),false);release();await first;checks++;
    console.log(JSON.stringify({ok:true,postgres_integration_checks:checks,external_writes:false}));
  }finally{await Promise.all([pool.end(),appPool?.end(),workerPool?.end()]);}
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.code||e.name,message:e.message}));process.exitCode=1;});
