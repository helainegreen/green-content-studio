'use strict';
// Run only in the disposable container named below, with no Meta credentials.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {Pool}=require('pg');
const {createRepository}=require('../statistics/repository.cjs');
const {ACCOUNT,windowFor}=require('../statistics/model.cjs');
async function main(){
  assert.equal(process.env.FR2_ISOLATED_TEST,'yes');
  const url=new URL(process.env.FR2_TEST_DATABASE_URL);assert.equal(url.hostname,'community-statistics-test-db');assert.equal(url.pathname,'/community_publicacoes');
  const admin=new Pool({connectionString:url.href,max:2});let app,writer,checks=0;
  try{
    await admin.query('CREATE ROLE community_publicacoes_app; CREATE ROLE community_estatisticas; CREATE TABLE publication_deliveries(id text);');
    await admin.query(await fs.readFile(path.join(__dirname,'../statistics/schema.sql'),'utf8'));
    await admin.query(await fs.readFile(path.join(__dirname,'../statistics/permissions.sql'),'utf8'));
    app=new Pool({connectionString:url.href,max:1,options:'-c role=community_publicacoes_app'});
    writer=new Pool({connectionString:url.href,max:1,options:'-c role=community_estatisticas'});
    const db=await writer.connect();
    try{
      const repo=createRepository(db),reader=createRepository(app),now=new Date(),profile={id:ACCOUNT,followers:100};
      const result={profile,collected_at:now.toISOString(),partial:false,snapshots:[7,30].map(days=>({version:1,profile,window:windowFor(days,now),collected_at:now.toISOString()}))};
      assert(await repo.due(now));await repo.save(result);assert.equal(await repo.due(now),false);checks++;
      assert.equal((await reader.load(30)).snapshot.profile.followers,100);checks++;
      await repo.save(result);assert.equal(Number((await admin.query('SELECT count(*) FROM instagram_stat_snapshots')).rows[0].count),2);checks++;
      await repo.failure('rate_limit',new Date(+now+1000));const stale=await reader.load(30);assert.equal(stale.sync.status,'rate_limit');assert(stale.sync.success_at);assert.equal(stale.snapshot.profile.followers,100);checks++;
      await assert.rejects(app.query('DELETE FROM instagram_stat_snapshots'),e=>e.code==='42501');checks++;
      await assert.rejects(app.query("UPDATE instagram_stat_sync SET status='ok'"),e=>e.code==='42501');checks++;
      await assert.rejects(db.query('SELECT * FROM publication_deliveries'),e=>e.code==='42501');checks++;
      await assert.rejects(db.query("INSERT INTO publication_deliveries VALUES('unauthorized')"),e=>e.code==='42501');checks++;
      await assert.rejects(db.query('DELETE FROM instagram_stat_snapshots'),e=>e.code==='42501');checks++;
      // A second-window constraint error rolls the first INSERT back as well.
      const bad=structuredClone(result);bad.collected_at=new Date(+now+2000).toISOString();bad.snapshots[1].window.days=8;
      await assert.rejects(repo.save(bad));assert.equal(Number((await admin.query('SELECT count(*) FROM instagram_stat_snapshots')).rows[0].count),2);checks++;
      const history=await reader.load(7);assert.equal(history.history.length,1);assert.equal(history.history[0].followers,100);checks++;
      // Newer observation wins; replaying an earlier snapshot cannot regress today's total.
      const newer=structuredClone(result);newer.collected_at=new Date(+now+4000).toISOString();newer.profile.followers=110;for(const s of newer.snapshots)s.profile.followers=110;
      await repo.save(newer);await repo.save(result);assert.equal((await reader.load(30)).history[0].followers,110);checks++;
    }finally{db.release();}
    console.log(JSON.stringify({ok:true,postgres_checks:checks,meta_calls:0,publications:0}));
  }finally{await Promise.all([admin.end(),app?.end(),writer?.end()]);}
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.code||e.name}));process.exitCode=1;});
