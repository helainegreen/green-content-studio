'use strict';
const assert=require('node:assert/strict');
const root=process.env.COMMUNITY_TEST_ROOT||require('node:path').join(__dirname,'../community-editorial');
const core=require(root+'/core.cjs');
const {createEngine}=require(root+'/engine.cjs');
const generator=require(root+'/generate.cjs');

function job(status){return {id:'00000000-0000-4000-8000-000000000001',status,lease_id:'00000000-0000-4000-8000-000000000002',body:{origin:'manual',revision:1,manual:{messages:[{role:'user',text:'Relato com informações suficientes.'}]},source:{text:'Relato com informações suficientes.'}}};}

async function runEngine(current,{generate=async()=>({}),manualExtract=async()=>({})}={}){
 const saves=[];
 const repo={claim:async()=>current,dispatched:async()=>{},save:async(_job,status,body,error)=>{saves.push({status,body,error});}};
 const engine=createEngine({repo,generate,manualExtract});
 await engine.step();
 return saves.at(-1);
}

(async()=>{
 const validationFailure=await runEngine(job('manual_copy_queued'),{generate:async()=>{throw new core.Fault('caption_too_long','A legenda precisa ser resumida.');}});
 assert.equal(validationFailure.status,'uncertain');
 assert.equal(validationFailure.error,'caption_too_long');
 assert.equal(Object.hasOwn(validationFailure.body,'question'),false);

 const lateQuestion=await runEngine(job('manual_copy_queued'),{generate:async()=>({needs_input:true,question:'Qual é o horário?'} )});
 assert.equal(lateQuestion.status,'uncertain');
 assert.equal(lateQuestion.error,'manual_late_question');
 assert.equal(Object.hasOwn(lateQuestion.body,'question'),false);

 const factualQuestion=await runEngine(job('manual_queued'),{manualExtract:async()=>({needs_input:true,question:'Em qual bairro ocorreu o fato?',warnings:[]})});
 assert.equal(factualQuestion.status,'manual_needs_input');
 assert.equal(factualQuestion.body.question,'Em qual bairro ocorreu o fato?');

 assert.throws(()=>generator.validate({needs_input:true,question:'Qual é o horário?'},{text:'Relato.'},{origin:'manual'}),error=>error.code==='manual_late_question');
 console.log(JSON.stringify({ok:true,cases:['technical-error-is-not-question','late-question-is-rejected','factual-extraction-question-is-allowed']}));
})().catch(error=>{console.error(error);process.exit(1);});
