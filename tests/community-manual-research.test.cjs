'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.env.COMMUNITY_TEST_ROOT||path.join(__dirname,'..','community-editorial');
const manual=require(path.join(root,'manual.cjs'));
const {createEngine}=require(path.join(root,'engine.cjs'));
const {page}=require(path.join(root,'view.cjs'));

const base={
 origin:'manual',revision:4,topic:{title:'Comércio fechado no dia 19'},
 manual:{messages:[{role:'user',text:'Preciso de um lembrete sobre o Dia do Comerciário.'},{role:'user',text:'Pesquise sobre na internet'}],attachments:[]}
};
assert.equal(manual.researchRequested(base),true);
assert.equal(manual.researchRequested({...base,manual:{...base.manual,messages:[{role:'user',text:'Deixe a legenda mais curta'}]}}),false);
assert.equal(manual.blockingQuestion('Informações suficientes para criar este lembrete?'),'');
assert.equal(manual.blockingQuestion('Em qual cidade ocorreu o fechamento?'),'Em qual cidade ocorreu o fechamento?');
const appended=manual.append(structuredClone(base),{message:''});
assert.equal(appended.status,'manual_research_queued');
assert.equal(appended.body.question,undefined);

async function engineCase(result){
 const saves=[],checkpoints=[];
 const body=structuredClone(base);
 const repo={
  claim:async()=>({id:'request',lease_id:'lease',status:'manual_research_queued',body}),
  checkpointManualResearch:async(_job,next)=>checkpoints.push(structuredClone(next)),
  save:async(_job,status,next,error)=>saves.push({status,body:structuredClone(next),error})
 };
 const research={advance:async(next,checkpoint)=>{await checkpoint(next);return result(next);}};
 const engine=createEngine({repo,research,source:null,generate:null,studio:null,manualExtract:null,reviseCopy:null});
 const output=await engine.step();
 return {output,saves,checkpoints};
}

(async()=>{
 const pending=await engineCase(body=>{body.research={phase:'read'};return {pending:true};});
 assert.equal(pending.saves[0].status,'manual_researching');
 assert.equal(pending.output.stage,'manual_research');
 const ready=await engineCase(()=>({source:{text:'Fonte confirmada',research:{limitations:''}}}));
 assert.equal(ready.saves[0].status,'manual_copy_queued');
 assert.equal(ready.saves[0].body.source.text,'Fonte confirmada');
 const insufficient=await engineCase(()=>({needs_input:true,question:'Nenhuma fonte legível.'}));
 assert.equal(insufficient.saves[0].status,'manual_needs_input');
 assert.match(insufficient.saves[0].body.question,/Envie o link/);

 const html=page({request:{...base,id:'743b4d59-4f4a-4d28-9f53-ca57ea4abab7',status:'manual_researching'}});
 assert.match(html,/manual-browser\.js/);
 const browser=fs.readFileSync(path.join(root,'manual-browser.js'),'utf8');
 assert.match(browser,/Responda para continuar/);
 assert.match(browser,/Enviar resposta e continuar/);
 const progress=fs.readFileSync(path.join(root,'progress.js'),'utf8');
 assert.match(progress,/Pesquisando fontes na internet/);
 console.log(JSON.stringify({ok:true,cases:['request-detection','generic-question-guard','research-state-machine','visible-question-ui']}));
})().catch(error=>{console.error(error);process.exit(1);});
