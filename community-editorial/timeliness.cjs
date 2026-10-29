'use strict';
const c=require('./core.cjs');
const schema=ids=>({type:'object',additionalProperties:false,properties:{status:{type:'string',enum:['current','expired','uncertain']},kind:{type:'string',enum:['news','event','deadline','evergreen']},valid_until:{type:'string'},reason:{type:'string',maxLength:400},evidence_id:{type:'string',enum:['',...ids]}},required:['status','kind','valid_until','reason','evidence_id']});
const instructions=`Antes de avaliar: 1) identifique o que foi anunciado, sem assumir realização; 2) compare a data do evento e da publicação com hoje; 3) confira cada afirmação nos trechos; 4) retire a sugestão quando houver dúvida essencial. Em todas as saídas (summary, facts e reason), preserve o tempo e o modo do texto original. Não escreva 'ocorreu', 'foi realizado' ou resultados de um evento com base em texto que diz 'acontece' ou 'recebe'. Não invente o ano. Se o evento não informa ano, só use o ano da publicação quando o contexto inequivocamente se referir a esse ano. Inclua timeliness. Use a data atual no fuso America/Sao_Paulo. Uma matéria que ANUNCIA evento ou prazo cuja data já passou é expired, mesmo que publicada recentemente: não suponha que o evento ocorreu e não transforme convite antigo em retrospectiva. Uma notícia que RELATA um fato passado pode ser current se ainda útil, com atribuição e contexto. Para convite/evento/prazo, indique valid_until em ISO 8601 com fuso (fim do evento/prazo, ou fim do dia no Rio se só houver data), com evidence_id do trecho que sustenta a data. Nunca use a data de publicação como data do evento. Se não for possível determinar a data/ano aplicável com segurança, status uncertain. Para news/evergreen sem validade definida, valid_until e evidence_id podem ser vazios. Uma fonte incompleta, assunto incompatível ou condições essenciais ausentes exigem sufficient false. sufficient só pode ser true com timeliness.status current. reason explica em até 400 caracteres o motivo temporal, sem pedir pesquisa à editora. Não extrapole o conteúdo das fontes.`;
function validate(value,passages,now=Date.now()){
 if(value===undefined)return null; // Older saved assessments remain readable; new screening requires this field.
 c.check(value&&['current','expired','uncertain'].includes(value.status)&&['news','event','deadline','evergreen'].includes(value.kind),'research_time','A validade da pauta não foi confirmada.');
 const evidence=value.evidence_id?passages.get(value.evidence_id):null;
 c.check(!value.evidence_id||evidence,'research_time_evidence','A data não foi sustentada pela fonte.');
 const until=value.valid_until||'';
 c.check(!until||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(until)&&Number.isFinite(Date.parse(until))&&evidence,'research_time_evidence','A data de validade precisa de evidência.');
 if(until){const year=new Date(until).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}).slice(0,4);
  const pubYear=evidence.doc.published_at?new Date(evidence.doc.published_at).toISOString().slice(0,4):'';
  c.check(evidence.quote.includes(year)||pubYear===year,'research_year_evidence','O ano indicado não está sustentado pela fonte.');
 }
 let status=value.status;
 if(['event','deadline'].includes(value.kind)&&!until&&status==='current')status='uncertain';
 if(until&&Date.parse(until)<now)status='expired';
 return {status,kind:value.kind,valid_until:until?new Date(until).toISOString():null,reason:c.text(value.reason,400,true),...(evidence?{source_id:evidence.doc.id,url:evidence.doc.url,quote:evidence.quote}:{})};
}
function validAt(result,at=Date.now()){
 const t=result?.timeliness;
 return !!t&&t.status==='current'&&(!t.valid_until||Date.parse(t.valid_until)>at);
}
function assertPublish(body,now=Date.now()){
 const t=body.source?.research?.timeliness||body.research?.result?.timeliness;
 if(!t)return; // Legacy drafts retain their existing approval requirements.
 const at=body.schedule_local?Date.parse(body.schedule_local+':00-03:00'):now;
 c.check(validAt({timeliness:t},Math.max(now,at)),'topic_expired','A data do evento ou prazo termina antes dessa publicação. Escolha um horário válido ou outra pauta.',409);
}
module.exports={schema,instructions,validate,validAt,assertPublish};
