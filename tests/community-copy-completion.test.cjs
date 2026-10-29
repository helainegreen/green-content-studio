'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.COMMUNITY_TEST_ROOT||path.join(__dirname,'..','community-editorial');
const generator=require(path.join(root,'generate.cjs'));

const configured='gpt-4.1-mini-2025-04-14';
assert.deepEqual(generator.generationModels({origin:'manual'},configured),{draft:configured,review:configured});
assert.deepEqual(generator.generationModels({origin:'email'},configured),{draft:configured,review:'gpt-5.4-mini-2026-03-17'});

const sourceText='No Rio de Janeiro, o Dia do Comerciário será celebrado em 19 de outubro de 2026. A convenção coletiva informa que os estabelecimentos comerciais da cidade não poderão funcionar. As exceções são lojas em aeroportos, portos e estações ferroviárias, metroviárias e rodoviárias.';
const output={
 needs_input:false,question:'',
 material_details:[{speaker:'Fonte consultada',quote:'No Rio de Janeiro, o Dia do Comerciário será celebrado em 19 de outubro de 2026.'}],
 draft_issues:[],headline:'Comércio do Rio não abre na segunda-feira, dia 19',
 subheadline:'Dia do Comerciário terá exceções apenas nos locais previstos pela convenção coletiva',
 headline_options:Array.from({length:10},(_,i)=>`Opção ${i+1}: comércio do Rio fecha no dia 19`),
 subheadline_options:Array.from({length:10},(_,i)=>`Opção ${i+1}: convenção coletiva define o fechamento e as exceções`),
 caption_paragraphs:['O comércio do Rio não abrirá na segunda-feira, 19 de outubro, pelo Dia do Comerciário.','A convenção prevê exceções para estabelecimentos em aeroportos, portos e estações de transporte.'],
 hashtags:['#community','#comercio'],source_ids:['s1'],local:'Rio de Janeiro',
 cover_prompt:'Cena editorial ilustrativa de rua comercial com portas fechadas.\n\nEnquadramento vertical, luz natural e área inferior livre para o título.',
 sections:[{title:'Fechamento no dia 19',body:'A convenção coletiva determina que os estabelecimentos comerciais da cidade não funcionem no Dia do Comerciário.'},{title:'Exceções previstas',body:'Lojas em aeroportos, portos e estações ferroviárias, metroviárias e rodoviárias estão entre as exceções informadas.'}],
 cta:'Você já se organizou para fazer as compras antes de segunda-feira?',
 evidence:[{claim:'O comércio não abrirá no dia 19.',evidence_id:'source:e1'}]
};
const models=[];
const fetcher=async(_url,options)=>{const request=JSON.parse(options.body);models.push(request.model);return {ok:true,json:async()=>({id:'resp_'+models.length,status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]})};};
const job={
 origin:'manual',profile:'community',topic:{title:'Dia do Comerciário'},guidance:'Prepare um lembrete.',
 manual:{messages:[{role:'user',text:'Pesquise sobre na internet'}],warnings:[]},
 source:{url:'https://sindilojas.rio/exemplo',publisher:'SindilojasRio',published_at:'2026-10-08T12:00:00Z',text:sourceText,sources:[{id:'s1',url:'https://sindilojas.rio/exemplo',publisher:'SindilojasRio'}],research:{geography:{city:'Rio de Janeiro'}}},
 internal_choices:[]
};
assert.equal(generator.manualAuditRequired(job),false);
const researchedSchema=generator.generationSchema(job.source,job);
assert.equal(Object.hasOwn(researchedSchema.properties,'material_details'),false);
assert.equal(researchedSchema.required.includes('headline_options'),true);
const suppliedJob={...job,source:{...job.source,research:undefined}};
assert.equal(generator.manualAuditRequired(suppliedJob),true);
assert.equal(Object.hasOwn(generator.generationSchema(suppliedJob.source,suppliedJob).properties,'material_details'),true);

(async()=>{
 const copy=await generator.generate(job,'test-key',configured,fetcher);
 assert.deepEqual(models,[configured,configured]);
 assert.equal(copy.headline,output.headline);
 assert.equal(copy.model,configured);
 assert.equal(copy.review_model,configured);
 assert.equal(copy.headline_options.length,10);
 console.log(JSON.stringify({ok:true,models,calls:models.length,headline_options:copy.headline_options.length}));
})().catch(error=>{console.error(error);process.exit(1);});
