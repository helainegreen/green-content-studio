'use strict';
// Isolated design module: used verbatim by the local gallery and its photo tester.
// No registration in the live catalog, customer access, generation queue or provider.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GCSPhotoModels=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
const models={
 belezaessencial:{name:'Antes & depois · Essencial',kind:'beauty',description:'Fotos lado a lado, logo e @ do cliente. Título opcional.',palette:{primary:'#385348',background:'#f7f4ec',accent:'#d8c5ad'}},
 belezadueto:{name:'Antes & depois · Dueto',kind:'beauty',description:'Fotos uma acima da outra, logo e @ do cliente. Título opcional.',palette:{primary:'#47232d',background:'#f7efe9',accent:'#e5bca8'}},
 imovelvitrine:{name:'Imóveis · Vitrine',kind:'property',description:'Foto de fundo e ficha horizontal com ícones, área e ambientes.',palette:{primary:'#173f36',background:'#faf7ed',accent:'#d8c39b'}},
 imovelrevista:{name:'Imóveis · Revista',kind:'property',description:'Foto ampla com ícones em pequenos blocos semitransparentes na lateral.',palette:{primary:'#202d38',background:'#f6f1e8',accent:'#dfb679'}}
};
const limits={cover:{title:52,subtitle:46,body:0},inside:{title:42,subtitle:46,body:100},name:30,handle:36,price:22};
const beautyLimits={title:32,subtitle:0,body:0};
const limitsFor=(id,slot)=>models[id]?.kind==='beauty'?beautyLimits:slot==='inside'?{title:0,subtitle:0,body:0}:limits[slot];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function check(v,message){if(!v){const e=new Error(message);e.code='PHOTO_MODEL_INPUT';throw e;}}
function textValue(v,max,label,required=false){check(typeof v==='string'&&v.length<=max&&(!required||v.trim()),label+': use '+(required?'1 a ':'até ')+max+' caracteres.');return v.trim();}
const paths={area:'<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M7 3v4m4-4v2m4-2v4m4-4v2M3 11h4m-4 4h2m-2 4h4"/>',bed:'<path d="M3 19V8m18 11V8M3 15h18M3 12h18v5H3zM6 8V5h12v3M5 8h5v4H5zm9 0h5v4h-5z"/>',bath:'<path d="M3 12h18l-2 7H5l-2-7Zm3 7v2m12-2v2M6 12V5a3 3 0 0 1 6 0M10 6h4"/>',car:'<path d="m4 10 2-6h12l2 6M3 10h18v8H3zm2 8v3m14-3v3M6 14h2m8 0h2"/>',pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.7"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'};
const icon=name=>`<svg class="icon" data-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const box=(x,y,w,h,css='',html='',attrs='')=>`<div ${attrs} style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${css}">${html}</div>`;
const txt=(v,x,y,w,h,size,css='')=>box(x,y,w,h,`font-size:${size}px;line-height:1.16;white-space:pre-line;${css}`,esc(v),'data-text data-boundary');
function asset(v,label){check(typeof v==='string'&&(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v)||/^assets\/[a-z0-9-]+\.jpg$/.test(v)),label+': selecione uma foto PNG ou JPG.');return v;}
function validate(id,slot,input){
 check(Object.hasOwn(models,id),'Modelo não encontrado.');const m=models[id];check(['cover','inside'].includes(slot),'Composição inválida.');
 const d={...input},beauty=m.kind==='beauty',b=limitsFor(id,slot);d.name=textValue(d.name||'',limits.name,'Marca',!beauty);d.handle=textValue(d.handle||'',limits.handle,'Assinatura');
 d.logo=asset(d.logo,'Logo do cliente');check(/^@?[a-zA-Z0-9._]{1,30}$/.test(d.handle),'Informe o @ do cliente, com até 30 caracteres.');d.handle='@'+d.handle.replace(/^@/,'');
 d.title=textValue(d.title||'',b.title,'Título',!beauty&&slot==='cover');d.subtitle=textValue(d.subtitle||'',b.subtitle,'Complemento');d.body=textValue(d.body||'',b.body,'Texto');d.price=textValue(d.price||'',limits.price,'Preço');
 d.stage=textValue(d.stage||'',18,'Identificação da foto');d.disclosure=textValue(d.disclosure||'',64,'Crédito da imagem');
 if(beauty&&slot==='inside'){d.stage=d.stage.toUpperCase();check(['ANTES','DEPOIS'].includes(d.stage),'Identifique a foto como Antes ou Depois.');}
 if(!beauty){
  d.modality=d.modality===undefined?'venda':d.modality;
  check(typeof d.modality==='string'&&Object.hasOwn({aluguel:1,venda:1,leilao:1},d.modality),'Escolha a modalidade: Aluguel, Venda ou Leilão.');
  d.watermark=d.watermark??false;check(typeof d.watermark==='boolean','Escolha se deseja marca d’água.');
  if(d.watermark)check(d.logoTransparent===true,'Para marca d’água, envie um PNG com fundo transparente ou desative essa opção.');
  d.watermarkOpacity=d.watermarkOpacity??0.26;check(typeof d.watermarkOpacity==='number'&&d.watermarkOpacity>=0.1&&d.watermarkOpacity<=0.5,'Use intensidade de 10% a 50%.');
  d.watermarkTone=d.watermarkTone??'original';check(['light','dark','original'].includes(d.watermarkTone),'Escolha um tom válido para a marca d’água.');
  d.repeatInfo=d.repeatInfo??'none';check(['none','facts','facts_price'].includes(d.repeatInfo),'Escolha quais dados repetir nos internos.');
 }
 d.palette={...m.palette,...d.palette};for(const v of Object.values(d.palette))check(/^#[a-f0-9]{6}$/i.test(v),'Use cores hexadecimais válidas.');
 d.number=d.number??(slot==='cover'?1:2);d.count=d.count??3;check(Number.isInteger(d.number)&&Number.isInteger(d.count)&&d.number>0&&d.count>=d.number&&d.count<=20,'Numeração inválida.');
 d.fit=d.fit||'contain';check(['contain','cover'].includes(d.fit),'Enquadramento inválido.');
 if(m.kind==='beauty'&&slot==='cover'){d.before=asset(d.before,'Foto de antes');d.after=asset(d.after,'Foto de depois');}else d.photo=asset(d.photo,'Foto desta página');
 d.facts=[];if(m.kind==='property')for(const [key,label,svg] of [['area','m²','area'],['bedrooms','quartos','bed'],['bathrooms','banheiros','bath'],['parking','vagas','car']]){
  const v=d[key];if(v===undefined||v===null||v==='')continue;
  const n=Number(v);check(Number.isFinite(n)&&n>=0&&(key==='area'?n>0&&n<=1000000:Number.isInteger(n)&&n<=99),'Informe um valor válido para '+label+'.');
  d.facts.push({key,label,value:n.toLocaleString('pt-BR',{maximumFractionDigits:2}),svg});
 }
 return d;
}
function slideHtml(id,slot,input,fonts=''){
 const d=validate(id,slot,input),m=models[id],p=d.palette,cover=slot==='cover';let a='';
 const dark=id==='belezadueto'||id==='imovelrevista',paper=p.background,white='#fffdf8';
 const photo=(src,x,y,w,h,fit='cover',extra='')=>box(x,y,w,h,`overflow:hidden;background:${paper};${extra}`,`<img src="${esc(src)}" alt="${esc(m.kind==='beauty'?'Fotografia de demonstração':'Ambiente do imóvel fictício')}" style="width:100%;height:100%;object-fit:${fit};object-position:center;">`,'data-photo');
 const brand=(color=dark?white:p.primary)=>txt(d.name,28,27,380,26,12,`color:${color};font-weight:700;letter-spacing:2px;`);
 const footer=(color=p.primary)=>txt(d.disclosure,28,637,438,16,8,`color:${color};letter-spacing:.3px;`)+txt(d.handle,28,657,424,15,8,`color:${color};`)+txt(d.number+' / '+d.count,472,653,40,19,10,`color:${color};text-align:right;`);
 const identity=()=>box(0,613,540,62,`background:${paper};`)+box(28,623,160,40,'',`<img data-logo src="${esc(d.logo)}" alt="${esc(d.name||'Logo do cliente')}" style="width:100%;height:100%;object-fit:contain;object-position:left center;">`)+txt(d.handle,208,633,304,27,13,`color:${p.primary};text-align:right;`);
 const tag=(v,x,y,w,bg,fg)=>box(x,y,w,25,`background:${bg};color:${fg};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;letter-spacing:1.3px;`,esc(v),'data-text');
 const stats=(x,y,w,h,vertical=false,bg=paper,fg=p.primary)=>{
  if(!d.facts.length)return '';let z=box(x,y,w,h,`background:${bg};color:${fg};`),unit=(vertical?h:w)/d.facts.length;
  d.facts.forEach((f,i)=>{const xx=x+(vertical?0:i*unit),yy=y+(vertical?i*unit:0);z+=box(xx+(vertical?20:14),yy+(vertical?14:16),25,25,`color:${fg};`,icon(f.svg));z+=txt(f.value,xx+(vertical?55:48),yy+(vertical?13:14),vertical?w-68:unit-55,34,vertical?25:23,`color:${fg};font-weight:700;`);z+=txt(f.label,xx+(vertical?20:14),yy+(vertical?51:50),vertical?w-40:unit-22,22,11,`color:${fg};`);if(i<d.facts.length-1)z+=box(vertical?x+18:xx+unit-1,vertical?yy+unit-1:y+12,vertical?w-36:1,vertical?1:h-24,`background:${fg}30;`);});return z;
 };
 const propertyCopy=(w,bottom,size,serif=false)=>`<div data-property-copy data-boundary style="position:absolute;left:28px;bottom:${bottom}px;width:${w}px;max-height:${serif?204:160}px;display:flex;flex-direction:column;gap:6px;color:${white};"><div data-property-title data-text data-boundary style="font-size:${size}px;line-height:1.08;max-height:${serif?156:108}px;padding-bottom:8px;white-space:pre-line;font-weight:600;${serif?"font-family:'GCS Serif',Georgia,serif;":''}">${esc(d.title)}</div>${d.subtitle?`<div data-property-subtitle data-text data-boundary style="font-size:17px;line-height:1.2;max-height:46px;padding-bottom:4px;white-space:pre-line;">${esc(d.subtitle)}</div>`:''}</div>`;
 const floatingFacts=()=>d.facts.map((f,i)=>{const y=114+i*72;return box(420,y,92,62,'background:rgba(15,23,28,.76);border:1px solid #ffffff70;border-radius:9px;box-shadow:0 3px 10px #0005;','','data-fact-card')+box(430,y+11,20,20,`color:${white};filter:drop-shadow(0 1px 1px #000);`,icon(f.svg))+txt(f.value,456,y+8,48,30,21,`color:${white};font-weight:700;text-shadow:0 1px 2px #000;`)+txt(f.label,430,y+38,72,19,10,`color:${white};text-shadow:0 1px 2px #000;`);}).join('');
 const watermark=()=>d.watermark?box(120,cover?158:250,280,112,`opacity:${d.watermarkOpacity};pointer-events:none;`, `<img data-watermark src="${esc(d.logo)}" alt="" style="width:100%;height:100%;object-fit:contain;filter:${d.watermarkTone==='light'?'brightness(0) invert(1)':d.watermarkTone==='dark'?'brightness(0)':''} drop-shadow(0 1px 2px #0005);">`,'aria-hidden="true"'):'';
 const compactFacts=()=>{
  if(!d.facts.length)return '';const y=543,unit=484/d.facts.length;let z=box(28,y,484,58,`background:${paper}f2;border:1px solid #ffffffa0;border-radius:5px;box-shadow:0 2px 8px #0003;`,'','data-compact-facts');
  d.facts.forEach((f,i)=>{const x=28+i*unit;z+=box(x+12,y+10,19,19,`color:${p.primary};`,icon(f.svg))+txt(f.value,x+40,y+7,unit-48,28,19,`color:${p.primary};font-weight:700;`)+txt(f.label,x+12,y+37,unit-24,18,10,`color:${p.primary};`);});return z;
 };
 // Price and modality must remain readable when the 1080 px art is shown at phone width.
 const luminance=hex=>hex.slice(1).match(/../g).map(v=>{const n=parseInt(v,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const offerBackground=id==='imovelvitrine'?p.primary:p.accent;
 const offerLuminance=luminance(offerBackground);
 const offerInk=(offerLuminance+.05)/(luminance('#101010')+.05)>=4.5?'#101010':1.05/(offerLuminance+.05)>=4.5?'#ffffff':'#000000';
 const modalityBadge=()=>box(28,70,208,48,`background:${offerBackground};color:${offerInk};border:1px solid #ffffff80;border-radius:5px;box-shadow:0 3px 12px #0004;display:flex;align-items:center;justify-content:center;font-size:24px;line-height:1.1;font-weight:800;letter-spacing:.8px;white-space:nowrap;`,esc({aluguel:'ALUGUEL',venda:'À VENDA',leilao:'LEILÃO'}[d.modality]),'data-text data-boundary data-property-modality');
 const pricePlate=y=>d.price?box(28,y,484,62,`background:${offerBackground};border:1px solid #ffffff80;border-radius:5px;box-shadow:0 3px 12px #0004;`,'','data-price-plate')+box(44,y+6,452,54,`font-size:44px;line-height:1.1;white-space:nowrap;font-weight:800;color:${offerInk};`,esc(d.price),'data-text data-boundary data-property-price'):'';
 const repeatedPrice=()=>d.repeatInfo==='facts_price'?pricePlate(id==='imovelvitrine'?469:539):'';
 if(id==='belezaessencial'){
  if(cover){
   const top=d.title?145:125;
   if(d.title)a+=txt(d.title,24,77,492,49,32,`font-family:'GCS Serif',Georgia,serif;font-weight:600;text-align:center;`);
   a+=photo(d.before,12,top,253,395,d.fit)+photo(d.after,275,top,253,395,d.fit);
   a+=tag('ANTES',88,top+413,100,p.primary,white)+tag('DEPOIS',352,top+413,100,p.primary,white);
  }else{
   const top=d.title?91:12;
   if(d.title)a+=txt(d.title,24,25,492,49,32,`font-family:'GCS Serif',Georgia,serif;font-weight:600;text-align:center;`);
   a+=photo(d.photo,12,top,516,601-top,d.fit)+tag(d.stage,28,top+16,100,p.primary,white);
  }a+=identity();
 }else if(id==='belezadueto'){
  a+=box(0,0,540,675,`background:${p.primary};`);
  const top=d.title?84:12;
  if(d.title)a+=txt(d.title,24,24,492,45,27,`color:${white};font-weight:600;text-align:center;`);
  if(cover){const h=(589-top)/2;
   a+=photo(d.before,12,top,516,h,d.fit)+photo(d.after,12,top+h+12,516,h,d.fit);
   a+=tag('ANTES',28,top+16,100,p.primary,white)+tag('DEPOIS',28,top+h+28,100,p.primary,white);
  }else{
   a+=photo(d.photo,12,top,516,601-top,d.fit)+tag(d.stage,28,top+16,100,p.primary,white);
  }a+=identity();
 }else if(id==='imovelvitrine'){
  a+=photo(d.photo,0,0,540,613,'cover');
  if(cover){a+=box(0,0,540,613,'background:linear-gradient(#0007,transparent 22%,transparent 42%,#000c 72%,#000e);')+brand(white)+modalityBadge()+propertyCopy(484,244,42)+stats(28,445,484,80);
   a+=pricePlate(539);
  }a+=watermark();if(!cover&&d.repeatInfo!=='none')a+=compactFacts()+repeatedPrice();a+=identity();
 }else{
  a+=photo(d.photo,0,0,540,613,'cover');
  if(cover){a+=box(0,0,540,613,'background:linear-gradient(#0006,transparent 22%,transparent 54%,#000b 85%,#000d);')+brand(white)+modalityBadge()+floatingFacts()+propertyCopy(376,152,44,true);
   a+=pricePlate(539);
  }a+=watermark();if(!cover&&d.repeatInfo!=='none')a+=floatingFacts()+repeatedPrice();a+=identity();
 }
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>${fonts}*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden}body{font-family:'GCS Sans',Arial,sans-serif;color:${p.primary};background:${paper}}.art{position:relative;width:540px;height:675px;transform:scale(2);transform-origin:top left;overflow:hidden}img{display:block}.icon{display:block;width:100%;height:100%}[data-text]{overflow-wrap:normal;flex-shrink:0}</style></head><body><article class="art" data-layout="${id}" data-composition="${slot}">${a}</article></body></html>`;
}
function measure(doc=document){
 const bad=[],nodes=[...doc.querySelectorAll('[data-text]')].filter(e=>e.textContent.trim());
 for(const e of doc.querySelectorAll('[data-boundary]'))if(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)bad.push('overflow');
 const rects=nodes.map(e=>{const r=doc.createRange();r.selectNodeContents(e);const b=r.getBoundingClientRect(),a=e.getBoundingClientRect();if(b.left<0||b.top<0||b.right>1081||b.bottom>1351)bad.push('outside');if(e.hasAttribute('data-boundary')&&(b.left<a.left-2||b.right>a.right+2||b.bottom>a.bottom+4))bad.push('boundary');return b;});
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)bad.push('collision');}
 for(const i of doc.images)if(!i.complete||!i.naturalWidth)bad.push('image');
 return {ok:bad.length===0,bad,images:doc.images.length,icons:doc.querySelectorAll('[data-icon]').length};
}
return {models,limits,limitsFor,validate,slideHtml,measure};
});
