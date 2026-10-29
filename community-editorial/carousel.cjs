'use strict';
const c=require('./core.cjs');

function outputText(value,max,code,message){
 c.check(typeof value==='string'&&value.length<=max&&!value.includes('\0')&&value.trim(),code,message);
 return value.trim();
}

function validate(sections,cta){
 c.check(Array.isArray(sections)&&sections.length>=2&&sections.length<=6,'carousel_missing','Prepare de dois a seis blocos para o carrossel.');
 const clean=sections.map(s=>({title:outputText(s?.title,70,'carousel_title_invalid','Um título do carrossel precisa ser refeito.'),body:outputText(s?.body,550,'carousel_body_invalid','Um texto do carrossel precisa ser refeito.')}));
 c.check(clean.reduce((n,s)=>n+s.title.length+s.body.length,0)<=2600,'carousel_long','Resuma os textos do carrossel antes de gerar.');
 return {sections:clean,cta:outputText(cta,120,'carousel_cta_invalid','O fechamento do carrossel precisa ser refeito.')};
}
const line=value=>c.esc(String(value).replace(/\s+/g,' ').trim());
function coverFields(body){
 const date=body.source?.published_at?new Date(body.source.published_at):null;
 c.check(date===null||Number.isFinite(+date),'missing_date','Confira a data da fonte.');
 return {local:body.cover?.local??body.copy?.local??'',date:body.cover?.date??(date?new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):'')};
}
function validateCover(input){
 const local=c.text(input.local,120),date=input.date;
 c.check(!/[\r\n\t\x00-\x1f\x7f]/.test(local),'invalid_cover_local','Informe o local da capa em uma única linha.');
 c.check(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number(date.slice(0,4))>=2000,'invalid_cover_date','Escolha uma data válida para a capa.');
 const parsed=new Date(date+'T12:00:00Z');
 c.check(Number.isFinite(+parsed)&&parsed.toISOString().slice(0,10)===date,'invalid_cover_date','Escolha uma data válida para a capa.');
 return {local,date};
}
function sourceText(body){
 const copy=body.copy,{sections,cta}=validate(copy.sections,copy.cta);
 const cover=coverFields(body);
 // Wrap body lines so labels such as "Local:" cannot become renderer metadata.
 // The existing renderer removes these tags and measures the resulting text.
 return [
  ...(cover.date?['Data: '+cover.date.split('-').reverse().join('/')]:[]),
  'Local: '+line(cover.local),
  'Título: '+line(copy.headline),
  'Subtítulo: '+line(copy.subheadline),
  'Texto:',
  ...sections.flatMap(s=>['<h2>'+line(s.title.toUpperCase())+'</h2>','<p>'+line(s.body)+'</p>']),
  '<p>Fonte: '+line(body.origin==='manual'?body.source.publisher:new URL(c.url(body.source.url)).hostname.replace(/^www\./,''))+'</p>',
  'CTA: '+line(cta),
 ].join('\n');
}
function verifyContext(ctx,renderJob){
 c.check(ctx.generation_id===renderJob&&!ctx.generation_active,'render_changed','Aguarde a versão completa do carrossel.',409);
 c.check(ctx.assets.length>=3&&ctx.assets.length<=10,'carousel_incomplete','O carrossel precisa ter capa, conteúdo e fechamento, com até dez slides.',409);
 return ctx.source_digest;
}
module.exports={validate,coverFields,validateCover,sourceText,verifyContext};
