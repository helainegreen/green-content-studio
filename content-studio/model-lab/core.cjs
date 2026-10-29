'use strict';
const crypto = require('node:crypto');
class CreationError extends Error { constructor(code,message,status=400) { super(message); this.code=code; this.status=status; } }
const check=(ok,code,message,status)=>{if(!ok) throw new CreationError(code,message,status);};
const text=(v,max=3000)=>String(v??'').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const layouts=require('./layouts.cjs');
const LAYOUTS={classico:'Clássico',...layouts.LAYOUTS,...Object.fromEntries(Object.entries(require('./photo-models.cjs').models).map(([id,m])=>[id,m.name]))};
const FONTS={sans:'Open Sans',serif:'Georgia',modern:'Arial'};
function color(v,fallback) {return /^#[0-9a-f]{6}$/i.test(String(v))?v.toLowerCase():fallback;}
function luminance(hex) {return hex.slice(1).match(/../g).map(v=>{v=parseInt(v,16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b) {const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function ink(bg) {return contrast(bg,'#17211d')>=4.5?'#17211d':contrast(bg,'#ffffff')>=4.5?'#ffffff':'#000000';}
function logoData(v) {
  if(!v)return '';
  check(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v),'logo','Use uma imagem PNG ou JPG para o logo.');
  const b=Buffer.from(v.split(',')[1],'base64');
  check(b.length<=350000 && b.length>=24,'logo','O logo deve ter até 350 KB.');
  check(v.startsWith('data:image/png;') ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : b[0]===255&&b[1]===216,'logo','Formato do logo inválido.');
  const dimensions=v.startsWith('data:image/png;')?{width:b.readUInt32BE(16),height:b.readUInt32BE(20)}:require('../../social-publishing/source.cjs').jpegSize(b);
  check(dimensions.width>0&&dimensions.height>0&&dimensions.width<=4000&&dimensions.height<=4000,'logo','O logo deve ter no máximo 4.000 pixels de cada lado.');
  return v;
}
function profile(input={}) {
  const p={name:text(input.name,100),business:text(input.business,1600),audience:text(input.audience,1200),voice:text(input.voice,1200),offer:text(input.offer,1200),restrictions:text(input.restrictions,1500),references:text(input.references,4000),visual:text(input.visual,1800),handle:text(input.handle,80),cta:text(input.cta,300),layout:Object.hasOwn(LAYOUTS,input.layout)?input.layout:'editorial',font:Object.hasOwn(FONTS,input.font)?input.font:'sans',primary:color(input.primary,'#245b45'),background:color(input.background,'#f5f2ea'),accent:color(input.accent,'#d7fa69'),logo:logoData(input.logo)};
  check(p.name&&p.business&&p.audience,'brand','Preencha nome, negócio e público da marca.');
  if(layouts.isNew(p.layout))check(p.name.length<=40&&p.handle.length<=48,'brand','Para estes estilos, use um nome de exibição de até 40 caracteres e uma assinatura de até 48.');
  return p;
}
function brief(input={}) {
  const count=Number(input.count), imageMode=input.image_mode||'none';
  const layout=input.layout??'';
  check(typeof layout==='string'&&(layout===''||Object.hasOwn(LAYOUTS,layout)),'layout','Escolha um modelo disponível ou use o padrão da marca.');
  check([1,5,7,9,12].includes(count),'count','Escolha 1, 5, 7, 9 ou 12 slides.');
  check(['none','cover'].includes(imageMode),'images','Selecione uma opção de imagem válida.');
  const b={topic:text(input.topic,1400),objective:text(input.objective,700),facts:text(input.facts,10000),urls:text(input.urls,2400).split(/\s+/).filter(Boolean),count,image_mode:imageMode,layout};
  check(b.topic.length>=6,'topic','Descreva a pauta com pelo menos seis caracteres.');
  check(b.urls.length<=3,'sources','Use até três URLs de fontes por pauta.');
  for(const u of b.urls) {let url;try{url=new URL(u);}catch{} check(url&&url.protocol==='https:'&&!url.username&&!url.password&&!url.port,'url','As fontes devem usar URLs HTTPS públicas.');}
  return b;
}
function validateHeadlines(value,max=100) {
  check(Array.isArray(value?.items)&&value.items.length===10,'headlines','A geração não retornou dez títulos válidos.',502);
  const seen=new Set();
  const items=value.items.map(x=>{check(typeof x.title==='string'&&x.title.length<=max,'headlines','O título excedeu o limite da capa.',502);const title=text(x.title,max),angle=text(x.angle,300);check(title.length>=10&&angle&&!seen.has(title.toLowerCase()),'headlines','Os títulos precisam ser distintos e específicos.',502);seen.add(title.toLowerCase());return {title,angle};});
  return {items};
}
function validateDraft(value,count,sources=[]) {
  check(value&&Array.isArray(value.slides)&&value.slides.length===count,'draft','A quantidade de slides não corresponde ao formato escolhido.');
  const known=new Set(sources.map(s=>s.id));
  const slides=value.slides.map((s,i)=>{
    check(typeof s.title==='string'&&s.title.trim().length>=3&&s.title.length<=110,'copy','Cada título precisa ter de 3 a 110 caracteres.');
    check(typeof s.body==='string'&&s.body.length<=460,'copy','Cada slide aceita até 460 caracteres de texto.');
    check(Array.isArray(s.source_ids)&&s.source_ids.every(id=>known.has(id)),'citation','O conteúdo contém uma fonte que não foi fornecida.');
    const composition=s.composition||'text';
    check(['text','steps'].includes(composition),'copy','Composição inválida.');
    const items=s.items||[];check(Array.isArray(items)&&items.length<=3,'copy','Use no máximo três itens.');
    check(composition==='steps'?i>0&&items.length===3&&s.body==='':items.length===0,'copy','Listas devem ter três itens, sem corpo adicional, em slides internos.');
    const cleanItems=items.map(item=>{check(typeof item.title==='string'&&item.title.trim()&&item.title.length<=100&&typeof item.body==='string'&&item.body.length<=250,'copy','Item inválido ou longo demais.');return {title:text(item.title,100),body:text(item.body,250)};});
    return {number:i+1,title:text(s.title,110),body:text(s.body,460),image_prompt:text(s.image_prompt,1400),source_ids:[...new Set(s.source_ids)],...(s.composition?{composition,items:cleanItems}:{})};
  });
  check(typeof value.caption==='string'&&value.caption.trim()&&value.caption.length<=2200,'caption','A legenda precisa ter entre 1 e 2.200 caracteres.');
  check(typeof value.review_notes==='string'&&value.review_notes.length<=3000,'review','Notas de revisão inválidas.');
  return {slides,caption:text(value.caption,2200),review_notes:text(value.review_notes,3000)};
}
function entitlement(row) {return !!row?.enabled&&(row.management_mode==='green_managed'||row.management_mode==='subscription'&&row.subscription_active);}
function csrf(secret,user) {return crypto.createHmac('sha256',secret).update('creation:'+user.id+':'+(user.session_hash||'')).digest('hex');}
function checkCsrf(secret,user,token) {const expected=csrf(secret,user);check(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)&&crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected)),'csrf','A sessão mudou. Reabra a página e tente novamente.',403);}
const LABELS={queued_headlines:'Na fila de títulos',working_headlines:'Preparando títulos',headlines:'Escolher título',queued_copy:'Na fila de texto',working_copy:'Escrevendo conteúdo',review:'Revisar texto',queued_render:'Na fila de artes',working_render:'Produzindo artes',ready:'Pronto para baixar',failed:'Precisa de atenção',cancelled:'Interrompido'};
module.exports={CreationError,check,text,esc,LAYOUTS,FONTS,color,contrast,ink,logoData,profile,brief,validateHeadlines,validateDraft,entitlement,csrf,checkCsrf,LABELS};
