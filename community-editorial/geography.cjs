'use strict';
const c=require('./core.cjs');
const scopes=['rio_city','rio_state','national','outside','uncertain'];
const norm=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const schema=ids=>({type:'object',additionalProperties:false,properties:{scope:{type:'string',enum:scopes},city:{type:'string'},uf:{type:'string'},reason:{type:'string',maxLength:400},evidence_id:{type:'string',enum:['',...ids]}},required:['scope','city','uf','reason','evidence_id']});
const instructions=`COBERTURA GEOGRÁFICA: o Community News cobre Barra Olímpica, Barra da Tijuca, Recreio dos Bandeirantes e Rio2, todos no MUNICÍPIO DO RIO DE JANEIRO, UF RJ. O nome do bairro sozinho não confirma o município: Recreio dos Bandeirantes em Guaxupé/MG está fora da cobertura. Confira cidade e UF na matéria, nunca deduza pela consulta de busca. Também interessam notícias relevantes da cidade/estado do Rio e notícias nacionais de impacto concreto para esses leitores (tributos, energia, benefícios, saúde, transporte, decisões nacionais ou grandes acontecimentos). Um crime ou evento local de outro estado não se torna nacional só por ter ocorrido no Brasil. Preencha geography.scope como rio_city, rio_state, national, outside ou uncertain; city e uf devem refletir o local real (vazios quando não conhecidos/nacionais). evidence_id deve sustentar o local ou o alcance nacional. Para uma fonte oficial municipal do Rio, o domínio da Prefeitura e o endereço local também podem confirmar a cidade. reason explica a pertinência ou a exclusão. Se não conseguir confirmar a cobertura, use uncertain. sufficient só pode ser true com cobertura confirmada. Não substitua silenciosamente uma notícia de outra cidade por uma notícia diferente no Rio.`;
function validate(value,passages){
 if(value===undefined)return null; // Older saved versions remain readable.
 c.check(value&&scopes.includes(value.scope),'research_geography','A localização da pauta não foi confirmada.');
 const evidence=value.evidence_id?passages.get(value.evidence_id):null;
 c.check(!value.evidence_id||evidence,'research_geography_evidence','A localização não foi sustentada pela fonte.');
 let scope=value.scope;const city=c.text(value.city||'',120,true),uf=c.text(value.uf||'',30,true).toUpperCase();
 const quote=norm(evidence?.quote),host=evidence?new URL(evidence.doc.url).hostname:'';
 const officialRio=/(^|\.)(prefeitura\.rio|rio\.rj\.gov\.br)$/.test(host);
 const rioEvidence=/\brio de janeiro\b|\brj\b/.test(quote)||officialRio;
 if(['rio_city','rio_state'].includes(scope)&&(!evidence||uf!=='RJ'||!rioEvidence||scope==='rio_city'&&norm(city)!=='rio de janeiro'))scope='uncertain';
 if(scope==='national'&&(!evidence||!/\bbrasil\b|\bnacionais?\b|\bnacional\b|\bfederal\b|\bem todo o pais\b/.test(quote)))scope='uncertain';
 const allowed=['rio_city','rio_state','national'].includes(scope);
 return {scope,allowed,city,uf,reason:scope!==value.scope?'A fonte não confirmou o município/estado ou o alcance nacional da pauta.':c.text(value.reason,400,true),...(evidence?{source_id:evidence.doc.id,url:evidence.doc.url,quote:evidence.quote}:{})};
}
const valid=result=>result?.geography?.allowed===true&&['rio_city','rio_state','national'].includes(result.geography.scope);
module.exports={schema,instructions,validate,valid};
