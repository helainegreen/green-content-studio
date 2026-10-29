'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const containerModule=path.join(__dirname,'../community-editorial/generate.cjs');
const generator=require(fs.existsSync(containerModule)
 ?containerModule
 :path.join(__dirname,'../community-editorial/generate.cjs'));

const submitted=`Relato recebido:

Acabei de participar de uma atividade no jardim cerca de 40 minutos atrás.

Quatro voluntários trouxeram mudas para o jardim.

Conseguimos plantar todas as mudas no local.`;
const source={
 url:'https://studio.example.invalid/community/editorial/teste',
 publisher:'Material enviado ao Community News',
 published_at:null,
 text:`MENSAGEM DA EDITORA:\n${submitted}`,
 sources:[{id:'material',url:'https://studio.example.invalid/community/editorial/teste',publisher:'Material enviado ao Community News'}]
};
const job={
 origin:'manual',profile:'community',topic:{title:'Relato recebido'},guidance:'',source,
 manual:{messages:[{role:'user',text:submitted}],warnings:[]},internal_choices:[]
};
const evidenceId=generator.generationSchema(source,job).properties.evidence.items.properties.evidence_id.enum[0];
const out={
 needs_input:false,question:'',
 material_details:[{speaker:'Morador',quote:'Acabei de participar de uma atividade no jardim cerca de 40 minutos atras.'}],
 draft_issues:[],headline:'Morador relata plantio no jardim de exemplo',
 subheadline:'Segundo o relato fictício, quatro voluntários participaram do plantio no jardim',
 headline_options:Array.from({length:10},(_,i)=>`Opção ${i+1}: relato fictício de plantio no jardim`),
 subheadline_options:Array.from({length:10},(_,i)=>`Opção ${i+1}: participante afirma que quatro voluntários ajudaram no jardim`),
 caption_paragraphs:['Um participante relatou uma atividade fictícia de plantio no jardim.'],
 hashtags:['#community','#jardim'],source_ids:['material'],local:'Bairro de Exemplo',
 cover_prompt:'Cena editorial ilustrativa de um jardim fictício, sem pessoas identificáveis.',
 sections:[
  {title:'Relato fictício de plantio',body:'Um participante afirma que quatro voluntários trouxeram mudas para um jardim fictício.'},
  {title:'Participantes concluíram o plantio',body:'Segundo o material fictício, os participantes conseguiram plantar todas as mudas.'}
 ],
 cta:'Você percebeu alguma movimentação diferente na região?',
 evidence:[{claim:'O participante afirmou que todas as mudas foram plantadas.',evidence_id:evidenceId}]
};

const copy=generator.validate(out,source,job);
assert.ok(copy.material_details.length>=3);
assert.ok(copy.material_details.every(detail=>source.text.includes(detail.quote)));
assert.ok(copy.material_details.some(detail=>detail.quote.includes('Quatro voluntários')));
console.log(JSON.stringify({ok:true,details:copy.material_details.length}));
