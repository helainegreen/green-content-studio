'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{EventEmitter}=require('node:events');
const core=require('../image-jobs/core.cjs'),{processJob,filePaths,pngSize,recoverFile}=require('../image-jobs/engine.cjs');
const {createImageJobs}=require('../image-jobs/studio.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const user={id:'reviewer',nav_clients:[{slug:'community'}]},secret='x'.repeat(40),postId='11111111-1111-4111-a111-111111111111';
function job(count=1){return {id:crypto.randomUUID(),post_id:postId,actor_id:user.id,status:'running',lease_id:crypto.randomUUID(),kind:count===1?'cover':'internal',payload:{prompts:Array(count).fill('private prompt'),quality:'low',credit:'IA'},state:{basis:'basis',items:Array.from({length:count},()=>({id:crypto.randomUUID(),dispatched:false,saved:false,applied:false}))}};}
async function fixture(t,count=1){const root=await fs.mkdtemp(path.join(os.tmpdir(),'fr2-image-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const j=job(count),saves=[],applied=[];let calls=0;
  return {root,job:j,saves,applied,repo:{save:async(j,status=j.status,error)=>{j.status=status;j.error_code=error;saves.push(structuredClone(j));}},studio:{attached:async()=>null,validate:async()=>{},fence:async()=>{},apply:async(j,i)=>{applied.push(i.id);return 'basis';}},generate:async(prompt,file)=>{calls++;assert.equal(saves.at(-1).state.items[applied.length].dispatched,true);await fs.writeFile(file,png);},calls:()=>calls};}
test('request token binds user, action, integrity and expiry; create retry has stable post ID',()=>{
 const token=core.token(secret,user,'create',1000),key=core.verify(secret,token,user,'create',2000);assert.equal(core.postIdFor(key),core.postIdFor(key));
 for(const [u,scope,now] of [[{id:'other'},'create',2000],[user,'other',2000],[user,'create',900],[user,'create',1000+86400001]])assert.throws(()=>core.verify(secret,token,u,scope,now));
 assert.throws(()=>core.verify(secret,token+'x',user,'create',2000));
});
test('prompt and quality validation bounds paid work before dispatch',()=>{
 assert.throws(()=>core.normalize('internal',{ai_prompts:Array(9).fill('x').join('\n')}));assert.throws(()=>core.normalize('cover',{ai_prompt:'x',ai_quality:'unbounded'}));assert.equal(core.normalize('internal',{ai_prompts:'one\n\ntwo'}).prompts.length,2);
});
test('complete PNG required; truncation and corrupt CRC cannot be reused',async t=>{
 assert.equal(pngSize(png),png.length);assert.equal(pngSize(png.subarray(0,png.length-1)),false);const corrupt=Buffer.from(png);corrupt[30]^=1;assert.equal(pngSize(corrupt),false);
 const f=await fixture(t),p=filePaths(f.root,f.job,f.job.state.items[0]);await fs.mkdir(p.dir);await fs.writeFile(p.pending,png);assert.equal(await recoverFile(p),true);assert.deepEqual(await fs.readFile(p.final),png);
});
test('successful generation checkpoints before provider, saves file, then applies once',async t=>{
 const f=await fixture(t);await processJob(f);assert.equal(f.calls(),1);assert.equal(f.job.status,'completed');assert.equal(f.applied.length,1);assert.equal(f.job.state.items[0].applied,true);
});
test('provider timeout preserves prior cover and never automatically retries',async t=>{
 const f=await fixture(t);let calls=0;f.generate=async()=>{calls++;throw Error('timeout secret-provider-content');};await processJob(f);assert.equal(f.job.status,'uncertain');assert.equal(f.applied.length,0);assert.equal(calls,1);assert.equal(f.job.error_code,'unconfirmed_result');assert.ok(!JSON.stringify(f.saves).includes('secret-provider-content'));
 f.job.status='running';await processJob(f);assert.equal(calls,1);assert.equal(f.job.status,'uncertain');
});
test('interrupted running call without a file requires review without a second provider call',async t=>{
 const f=await fixture(t);f.job.state.items[0].dispatched=true;await processJob(f);assert.equal(f.calls(),0);assert.equal(f.job.status,'uncertain');
});
test('restart with complete file attaches it without a second paid generation',async t=>{
 const f=await fixture(t),i=f.job.state.items[0],p=filePaths(f.root,f.job,i);i.dispatched=true;await fs.mkdir(p.dir);await fs.writeFile(p.pending,png);await processJob(f);assert.equal(f.calls(),0);assert.equal(f.job.status,'completed');assert.equal(f.applied.length,1);
});
test('restart after attachment commit recognizes existing asset without reattaching',async t=>{
 const f=await fixture(t);f.studio.attached=async()=> 'after-commit';await processJob(f);assert.equal(f.calls(),0);assert.equal(f.applied.length,0);assert.equal(f.job.state.basis,'after-commit');assert.equal(f.job.status,'completed');
});
test('queued request survives restart and starts exactly one provider call',async t=>{
 const f=await fixture(t);f.job=JSON.parse(JSON.stringify(f.job));await processJob(f);assert.equal(f.calls(),1);assert.equal(f.job.status,'completed');
});
test('partial internal success is retained when next request fails',async t=>{
 const f=await fixture(t,3);let calls=0;f.generate=async(_,file)=>{calls++;if(calls===2)throw Object.assign(Error('rejected'),{providerStatus:429});await fs.writeFile(file,png);};await processJob(f);assert.equal(calls,2);assert.equal(f.applied.length,1);assert.equal(f.job.status,'failed');assert.equal(core.publicJob(f.job).completed,1);
});
test('changed source during generation keeps result for review and preserves current cover',async t=>{
 const f=await fixture(t);f.studio.apply=async()=>{throw new core.ImageJobError('post_changed','changed');};await processJob(f);assert.equal(f.calls(),1);assert.equal(f.job.status,'review_needed');assert.equal(f.applied.length,0);assert.equal(core.publicJob(f.job).files.length,1);
});
test('source changed while queued is detected before spending',async t=>{
 const f=await fixture(t);f.studio.validate=async()=>{throw new core.ImageJobError('post_changed','changed');};await processJob(f);assert.equal(f.calls(),0);assert.equal(f.job.status,'review_needed');assert.match(core.publicJob(f.job).message,/antes/);
});
test('lost worker connection fences asset writes and retains dispatch marker',async t=>{
 const f=await fixture(t);let alive=true;const generate=f.generate;f.alive=()=>alive;f.generate=async(...args)=>{await generate(...args);alive=false;};await processJob(f);assert.equal(f.applied.length,0);assert.equal(f.job.status,'running');assert.equal(f.job.state.items[0].dispatched,true);
});
test('status JSON never includes prompt, actor, request key, absolute path or raw error',()=>{
 const j=job();j.state.items[0].saved=true;j.request_key='private-key';j.error_code='safe';const s=JSON.stringify(core.publicJob(j));for(const text of ['private prompt','reviewer','private-key','lease_id','payload'])assert.ok(!s.includes(text));
});
test('feature off does not initialize pools or inspect database',async()=>{
 const m=createImageJobs({env:{},Pool:class{constructor(){throw Error('unexpected');}}});assert.equal(await m.handle({},null,null,new URL('https://example.test/posts/'+postId+'/generate-ai-cover')),false);assert.equal(m.fields(user,'create'),'');assert.equal(await m.banner(postId,user),'');m.start();
});
function webFixture(){
 let enqueued=0,queries=0,providerCalls=0;
 const post={id:postId,type:'news',source_title:'Title',source_text:'Text'},rows=[];
 const pool={query:async(q)=>{queries++;if(q.includes('FROM posts'))return {rows:[post],rowCount:1};if(q.includes('FROM post_assets'))return {rows, rowCount:0};return {rows:[],rowCount:0};},connect:async()=>Object.assign(new EventEmitter(),{query:async()=>({rows:[]}),release:()=>{}})};
 const jobs=new Map(),repo={latest:async()=>[...jobs.values()].at(-1)||null,busy:async()=>false,enqueue:async x=>{if(!jobs.has(x.key)){enqueued++;jobs.set(x.key,{...job(),status:'queued',post_id:x.postId,payload:x.payload});}return jobs.get(x.key);}};
 const env={FR2_IMAGE_JOBS_ENABLED:'true',FR2_FEED_REVIEWER_IDS:user.id,FR2_FEED_DATABASE_URL:'postgres://community_publicacoes_app@database/community_publicacoes',FR2_FEED_CSRF_SECRET:secret,FR2_FEED_ORIGIN:'https://studio.test'};
 const m=createImageJobs({studioPool:pool,layout:x=>x.body,generate:async()=>{providerCalls++;return new Promise(()=>{});},env,dependencies:{repo,pool},uploadRoot:'/tmp/test-unused'});
 async function request(route,form={},who=user,origin=env.FR2_FEED_ORIGIN,method='POST'){
  const req=Readable.from([Buffer.from(new URLSearchParams(form).toString())]);req.method=method;req.headers={'content-type':'application/x-www-form-urlencoded',origin};
  const res=new EventEmitter();res.headers={};res.setHeader=(k,v)=>res.headers[k]=v;res.writeHead=(s,h)=>{res.status=s;Object.assign(res.headers,h);};res.end=b=>{res.body=String(b||'');res.emit('finish');};
  await m.handle(req,res,who,new URL(route,env.FR2_FEED_ORIGIN));return res;
 }return {m,request,counts:()=>({enqueued,queries,providerCalls}),repo};
}
test('HTTP returns redirect after queue commit without waiting for provider; double submit reuses request',async()=>{
 const f=webFixture(),route='/posts/'+postId+'/generate-ai-cover',form={_image_request:core.token(secret,user,postId+':generate-ai-cover'),ai_prompt:'prompt'};
 const r=await Promise.race([f.request(route,form),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('blocked HTTP')),500);t.unref();})]);assert.equal(r.status,303);assert.equal(r.headers.Location,'/posts/'+postId+'/review');assert.equal(f.counts().providerCalls,0);
 await f.request(route,form);assert.equal(f.counts().enqueued,1);
});
test('HTTP enforces owner, exact origin, action-bound token and safe error messages',async()=>{
 const f=webFixture(),route='/posts/'+postId+'/generate-ai-cover',form={_image_request:core.token(secret,user,postId+':generate-ai-cover'),ai_prompt:'secret prompt'};
 assert.equal((await f.request(route,form,{id:'wrong',nav_clients:user.nav_clients})).status,403);
 assert.equal((await f.request(route,form,user,'https://evil.test')).status,403);
 assert.equal((await f.request(route,{...form,_image_request:core.token(secret,user,'create')})).status,403);
 assert.equal(f.counts().enqueued,0);
 f.repo.enqueue=async()=>{throw Error('password=secret');};const r=await f.request(route,form);assert.equal(r.status,503);assert.ok(!r.body.includes('password='));assert.ok(!r.body.includes('secret prompt'));
});
test('status and form tokens are authenticated, new generation requires explicit checkbox after uncertainty',async()=>{
 const f=webFixture();assert.match(f.m.fields(user,'create'),/_image_request/);assert.match(f.m.fields(user,'create'),/_confirm_new/);assert.equal(f.m.fields({id:'other'},'create'),'');
 assert.equal((await f.request('/posts/'+postId+'/image-generation/status',{},user,undefined,'GET')).status,200);
 assert.equal((await f.request('/posts/'+postId+'/image-generation/status',{},null,undefined,'GET')).status,403);
});
test('browser keeps idle notice visible and preserves unsaved edits on completion',async()=>{
 const code=await fs.readFile(path.join(__dirname,'../image-jobs/browser.js'),'utf8'),vm=require('node:vm');
 async function poll({busy=false,dirty=false,status='idle',message=''}){
  const text={textContent:'Initial'},refresh={hidden:true},listeners={},timers=[],navigations=[];
  const panel={dataset:{busy:String(busy),post:postId,status:busy?'running':'idle'},querySelector:s=>s==='[data-image-message]'?text:refresh};
  vm.runInNewContext(code,{document:{forms:[],querySelector:()=>panel,querySelectorAll:()=>[],addEventListener:(n,fn)=>listeners[n]=fn},location:{href:'https://studio.test/posts/'+postId+'/review',replace:url=>navigations.push(url)},setTimeout:fn=>timers.push(fn),fetch:async()=>({ok:true,json:async()=>({busy:false,status,message,total:status==='completed'?1:0,completed:status==='completed'?1:0})})});
  if(dirty)listeners.input();await timers.shift()();return {text:text.textContent,refresh:!refresh.hidden,navigations};
 }
 const idle=await poll({});assert.match(idle.text,/pronta para receber pedidos/);assert.equal(idle.navigations.length,0);
 const dirty=await poll({busy:true,dirty:true,status:'completed',message:'Imagem pronta.'});assert.equal(dirty.navigations.length,0);assert.equal(dirty.refresh,true);assert.match(dirty.text,/alterações/);
 const clean=await poll({busy:true,status:'completed',message:'Imagem pronta.'});assert.deepEqual(clean.navigations,['/posts/'+postId+'/review']);
});
