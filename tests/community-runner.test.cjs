'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.COMMUNITY_TEST_ROOT||path.join(__dirname,'..','current');
const {startRunner}=require(path.join(root,'runner.cjs'));

async function main(){
 const timers={timeout:null,interval:null};
 let calls=0,release;
 const waiting=new Promise(resolve=>{release=resolve;});
 const runner=startRunner({
  step:async()=>{calls+=1;if(calls===1)await waiting;return {stage:'manual_material_read'};},
  scheduleTimeout:fn=>{timers.timeout=fn;return {unref(){}};},
  scheduleInterval:fn=>{timers.interval=fn;return {unref(){}};},
  cancelTimeout(){},cancelInterval(){},logger:{error(){}},
 });
 assert.equal(runner.status().last_result,'starting');
 const first=timers.timeout();
 assert.deepEqual(await runner.run(),{busy:true});
 assert.equal(calls,1);
 release();
 assert.deepEqual(await first,{stage:'manual_material_read'});
 assert.equal(runner.status().last_result,'manual_material_read');
 assert.equal(runner.status().consecutive_failures,0);

 let errors=0;
 const recovering=startRunner({
  step:async()=>{if(errors++===0){const error=new Error('offline');error.code='temporary_offline';throw error;}return {idle:true};},
  scheduleTimeout:()=>({unref(){}}),scheduleInterval:()=>({unref(){}}),cancelTimeout(){},cancelInterval(){},logger:{error(){}},
 });
 assert.deepEqual(await recovering.run(),{error:true,code:'temporary_offline'});
 assert.equal(recovering.status().consecutive_failures,1);
 assert.deepEqual(await recovering.run(),{idle:true});
 assert.equal(recovering.status().consecutive_failures,0);
 assert.equal(recovering.status().last_result,'idle');
 console.log(JSON.stringify({ok:true,checks:12}));
}

main().catch(error=>{console.error(error);process.exit(1);});
