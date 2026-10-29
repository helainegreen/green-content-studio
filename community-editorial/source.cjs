'use strict';
const https=require('node:https'),dns=require('node:dns/promises'),net=require('node:net'),c=require('./core.cjs');
function public4(ip){if(net.isIP(ip)!==4)return false;const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,168].includes(b))||(a===100&&b>=64&&b<=127)||(a===198&&[18,19,51].includes(b))||(a===203&&b===0));}
async function safeGet(value,{binary=false,redirects=0}={}){
 const u=new URL(c.url(value));c.check(!net.isIP(u.hostname)&&!u.hostname.endsWith('.local'),'private_source','Fonte indisponível.');
 const addresses=await dns.lookup(u.hostname,{all:true,family:4});c.check(addresses.length&&addresses.every(a=>public4(a.address)),'private_source','Fonte indisponível.');
 const result=await new Promise((resolve,reject)=>{const req=https.get(u,{headers:{'User-Agent':'Community NewsEditorial/1.0','Accept':binary?'image/jpeg,image/png,image/webp':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},lookup:(_host,options,cb)=>options?.all?cb(null,[addresses[0]]):cb(null,addresses[0].address,4)},res=>{const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>(binary?8_000_000:2_000_000))req.destroy(new c.Fault('source_large','Arquivo maior que o limite.'));else chunks.push(b);});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,buffer:Buffer.concat(chunks)}));res.on('error',reject);});const timer=setTimeout(()=>req.destroy(new c.Fault('source_timeout','A fonte não respondeu.')),20000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);});
 if([301,302,303,307,308].includes(result.status)){c.check(redirects<3&&result.headers.location,'redirect','A fonte precisa de conferência.');return safeGet(new URL(result.headers.location,u).href,{binary,redirects:redirects+1});}
 c.check(result.status===200,'source_unavailable','Não foi possível consultar a fonte. Confira o link da matéria.');const mime=(result.headers['content-type']||'').split(';')[0];c.check(binary?['image/png','image/jpeg','image/webp'].includes(mime):['text/html','application/xhtml+xml'].includes(mime),'source_type','Formato de fonte indisponível.');return {...result,url:u.href,mime};
}
const entities={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',aacute:'á',Aacute:'Á',agrave:'à',Agrave:'À',acirc:'â',Acirc:'Â',atilde:'ã',Atilde:'Ã',eacute:'é',Eacute:'É',ecirc:'ê',Ecirc:'Ê',iacute:'í',Iacute:'Í',oacute:'ó',Oacute:'Ó',ocirc:'ô',Ocirc:'Ô',otilde:'õ',Otilde:'Õ',uacute:'ú',Uacute:'Ú',ccedil:'ç',Ccedil:'Ç',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',hellip:'…'};
const decode=s=>String(s).replace(/&([A-Za-z]+);/g,(raw,key)=>entities[key]??raw).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(raw,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):raw;});
const plain=s=>decode(String(s).replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function articleContainer(html){
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const markers=/<(div|section|h3)\b[^>]*(?:class|itemprop)=["']([^"']+)["'][^>]*>/gi;let m;
 while((m=markers.exec(clean))){if(!m[2].split(/\s+/).some(x=>['entry-content','post-content','article-content','article-body','articleBody','materia-conteudo','content-text__container','post-detalhe-texto','news-spotlight','news-detail','post-detail-content'].includes(x)))continue;
  const tags=new RegExp('<\\/?'+m[1]+'\\b[^>]*>','gi');tags.lastIndex=markers.lastIndex;let depth=1,next;
  while((next=tags.exec(clean))){depth+=next[0].startsWith('</')?-1:1;if(depth===0)return clean.slice(markers.lastIndex,next.index);}
 }
 return '';
}
function semanticMain(html){return html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||'';}
function localPublished(value){
 const text=plain(value),numeric=text.match(/\b(?:em\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
 if(numeric)return `${numeric[3]}-${numeric[2].padStart(2,'0')}-${numeric[1].padStart(2,'0')}T12:00:00-03:00`;
 const months={janeiro:1,fevereiro:2,marco:3,'março':3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
 const written=text.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/i);
 if(!written)return null;
 const month=months[written[2].toLocaleLowerCase('pt-BR')];
 return month?`${written[3]}-${String(month).padStart(2,'0')}-${written[1].padStart(2,'0')}T12:00:00-03:00`:null;
}
function metadata(html,name){for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const tag=m[0],key=tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1];if(key===name)return decode(tag.match(/content=["']([^"']*)["']/i)?.[1]||'');}return '';}
function imageMetadata(html,url,images,json){
 const attribute=(tag,key)=>decode(tag.match(new RegExp('(?:^|\\s)'+key+'\\s*=\\s*(["\'])([\\s\\S]*?)\\1','i'))?.[2]||'');
 const key=value=>{try{const u=new URL(value,url);if(u.protocol!=='https:')return '';u.pathname=u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.[^.]+$)/,'');return u.href;}catch{return '';}};
 const creditIn=value=>{const text=plain(value);return text.match(/(?:^|[\s|—–-])((?:Fotos?|Fotografia|Cr[eé]ditos?(?: da (?:foto|imagem))?|Imagem)\s*:\s*\S.{0,230})$/i)?.[1]?.trim()||'';};
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const blocks=[...clean.matchAll(/<(figure|a)\b[^>]*>[\s\S]*?<\/\1>/gi)].map(m=>m[0]);
 const objects=[...json.filter(x=>String(x['@type']).includes('ImageObject')),...json.flatMap(x=>[x.image].flat().filter(i=>i&&typeof i==='object'))];
 for(const im of images){
  const imageKey=key(im.url);let caption='',credit=im.credit||'',origin=credit?'image_metadata':'';
  for(const obj of objects.filter(x=>[x.url,x.contentUrl].some(u=>u&&key(u)===imageKey))){
   caption=plain(obj.caption||'').slice(0,500)||caption;
   const creator=[obj.creator||obj.author].flat().filter(Boolean).map(x=>typeof x==='string'?x:x.name||json.find(y=>y['@id']===x['@id'])?.name||'').filter(Boolean).join(' / ');
   const found=plain(obj.creditText||obj.copyrightNotice||'')||(creator?'Foto: '+plain(creator):'')||creditIn(caption);
   if(found&&!credit){credit=found;origin='image_metadata';}
  }
  if(!credit)for(const match of clean.matchAll(/<img\b[^>]*>/gi)){
   const tag=match[0];if(key(attribute(tag,'data-src')||attribute(tag,'src'))!==imageKey)continue;
   const found=[attribute(tag,'alt'),attribute(tag,'title')].map(creditIn).find(Boolean);if(found){credit=found;origin='image_caption';break;}
  }
  for(const block of blocks){
   const tags=[...block.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);
   const urls=tags.map(t=>attribute(t,'data-src')||attribute(t,'src')).map(key).filter(Boolean);
   if(!urls.length||urls.some(u=>u!==imageKey))continue;
   const cap=block.match(/<(?:figcaption|p|span)\b[^>]*(?:class=["'][^"']*(?:caption|credit)[^"']*["'])?[^>]*>([\s\S]*?)<\/(?:figcaption|p|span)>/i)?.[1];
   const candidates=[cap,...tags.flatMap(t=>[attribute(t,'data-caption'),attribute(t,'alt'),attribute(t,'title')])].filter(Boolean);
   const found=candidates.map(creditIn).find(Boolean);
   if(cap&&!caption)caption=plain(cap).slice(0,500);
   if(found&&!credit){credit=found;origin='image_caption';}
  }
  if(credit){im.credit=plain(credit).slice(0,250);im.source_credit=im.credit;im.credit_origin=origin;}
  if(caption)im.caption=caption;
 }
 return images;
}
function rioturBody(html,url){
 const u=new URL(url);if(u.hostname!=='riotur.rio'||!u.pathname.startsWith('/evento-calendario/'))return '';
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const marker=/<div\b[^>]*class=["']([^"']*)["'][^>]*>/gi;let match;
 while((match=marker.exec(clean))){const classes=match[1].split(/\s+/);if(!classes.includes('content-text')||!classes.includes('postCustom'))continue;
  const tags=/<\/?div\b[^>]*>/gi;tags.lastIndex=marker.lastIndex;let depth=1,next;
  while((next=tags.exec(clean))){depth+=next[0].startsWith('</')?-1:1;if(depth===0)return clean.slice(marker.lastIndex,next.index);}
  return '';
 }return '';
}
function extract(html,url){const json=[];for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const v=JSON.parse(m[1]);json.push(...(Array.isArray(v)?v:v['@graph']||[v]));}catch{}}
 const article=json.find(x=>/Article|NewsArticle|BlogPosting/.test(String(x['@type']))),webpage=json.find(x=>x['@type']==='WebPage'&&x.url===url),articleHtml=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||'',container=rioturBody(html,url)||articleContainer(html),main=semanticMain(html);
 const candidates=[article?.articleBody,articleHtml,container,main].map(plain).filter(Boolean),body=candidates.find(value=>value.length>=300)||candidates.sort((a,b)=>b.length-a.length)[0]||'';
 c.check(body.length>=300,'source_incomplete','O serviço não conseguiu ler a matéria completa nesta fonte.');
 const images=[];const add=(value,credit='')=>{if(typeof value!=='string'||!value.trim())return;try{const u=c.url(new URL(value,url).href);if(!images.some(i=>i.url===u)&&images.length<3)images.push({id:c.hash(u).slice(0,24),url:u,credit:plain(credit).slice(0,250),source_url:url,reuse:'unknown'});}catch{}};
 for(const img of [article?.image].flat().filter(Boolean)){if(typeof img==='string')add(img);else{const resolved=img['@id']?json.find(x=>x['@id']===img['@id']&&(x.url||x.contentUrl))||img:img;add(resolved.url||resolved.contentUrl,resolved.creditText||resolved.copyrightNotice||'');}}
 for(const match of (container||articleHtml||main).matchAll(/<img\b[^>]*>/gi)){const tag=match[0],value=tag.match(/(?:data-src|src)\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];add(decode(value||''));}
 for(const m of html.matchAll(/<meta\b[^>]+>/gi)){const tag=m[0];if(/(?:property|name)=["']og:image["']/i.test(tag))add(decode(tag.match(/content=["']([^"']+)/i)?.[1]||''));}
 imageMetadata(html,url,images,json);
 const dated=html.match(/<div\b[^>]*class=["'][^"']*\bpost-detalhe-data\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
 const heading=plain((container||articleHtml||main).match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1]||''),published=article?.datePublished||webpage?.datePublished||metadata(html,'article:published_time')||localPublished(dated||body);return {url,title:plain(article?.headline||webpage?.name||heading||metadata(html,'og:title')||''),text:body.slice(0,18000),published_at:Number.isFinite(Date.parse(published))?new Date(published).toISOString():null,fetched_at:new Date().toISOString(),images};
}
async function fetchArticle(topic){const result=await safeGet(topic.url);const data=extract(result.buffer.toString('utf8'),result.url);data.published_at=data.published_at||topic.published_at;return data;}
module.exports={safeGet,extract,fetchArticle,public4,decode};
