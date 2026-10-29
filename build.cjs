const fs = require('node:fs');
const path = require('node:path');
const {simulate} = require('./contract.cjs');
const dir = __dirname;
const image = (id, width, height, fill) => ({id, kind:'image', mime:'image/jpeg', width, height, bytes:400000, sha256:fill.repeat(64)});
const sample = {schema_version:1, id:'DEMONSTRACAO-001', revision:1,
  source:{type:'green_content_studio', client_slug:'community', post_id:'post-ficticio-001', generation_job_id:'geracao-ficticia-001', reference:'exemplo-ficticio-studio-local'}, rights_confirmed:true,
  timezone:'America/Sao_Paulo', scheduled_at:'2026-09-25T10:00:00-03:00',
  variants:['instagram.feed','instagram.story','facebook.feed','facebook.story'].map(destination => ({
    destination, caption:destination.endsWith('story')?'':'Exemplo fictício para testar o fluxo editorial. Não publicar.',
    ai_generated:false, paid_partnership:false,
    assets:[destination.endsWith('story') ? image('arte-story-ficticia',1080,1920,'b') : image('arte-feed-ficticia',1080,1350,'a')],
  }))};
fs.writeFileSync(path.join(dir,'exemplo-ficticio.json'),JSON.stringify(sample,null,2)+'\n');
fs.writeFileSync(path.join(dir,'resultado-simulacao.json'),JSON.stringify(simulate(sample),null,2)+'\n');
const source=fs.readFileSync(path.join(dir,'contract.cjs'),'utf8').replace(/^module\.exports = .*;$/m,'');
const nodes=[
  {id:'manual',name:'Simular manualmente',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0],parameters:{}},
  {id:'sample',name:'Exemplo fictício',type:'n8n-nodes-base.code',typeVersion:2,position:[250,0],parameters:{jsCode:'return [{json:'+JSON.stringify(sample)+'}];'}},
  {id:'plan',name:'Validar e montar quatro destinos',type:'n8n-nodes-base.code',typeVersion:2,position:[500,0],parameters:{jsCode:source+'\nreturn $input.all().map(item=>({json:simulate(item.json)}));'}},
  {id:'note',name:'Escopo desta preparação',type:'n8n-nodes-base.stickyNote',typeVersion:1,position:[0,-340],parameters:{width:800,height:280,content:'## Somente simulação local\nNão possui token, HTTP Request, banco, bot, webhook ou agendamento.\nNão publica e não envia mensagens. Dados e checksums são fictícios.\nValida metadados declarados; inspeção real da mídia e conectores estão pendentes.\nNão importar em produção sem análise de capacidade e instalação isolada.\nVeja README.md e ARQUITETURA.md.'}},
];
const workflow={name:'Community News Publicações V1 — Simulação de feed e Stories',active:false,nodes,
  connections:{'Simular manualmente':{main:[[{node:'Exemplo fictício',type:'main',index:0}]]},
    'Exemplo fictício':{main:[[{node:'Validar e montar quatro destinos',type:'main',index:0}]]}},
  settings:{executionOrder:'v1',timezone:'America/Sao_Paulo',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,executionTimeout:30},pinData:{},tags:[]};
fs.writeFileSync(path.join(dir,'workflow-simulacao-n8n.json'),JSON.stringify(workflow,null,2)+'\n');
console.log('Simulação preparada: quatro destinos, nenhuma operação externa.');
