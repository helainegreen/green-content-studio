'use strict';
const https=require('node:https');
const dns=require('node:dns/promises');
const net=require('node:net');
const {check,text}=require('./core.cjs');
function publicIPv4(ip) {if(net.isIP(ip)!==4)return false;const [a,b,c]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
async function safeGet(raw,{resolve=dns.resolve4,request=https.get}={},redirects=0) {
  let url;try{url=new URL(raw);}catch{}check(url&&url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!net.isIP(url.hostname)&&!url.hostname.endsWith('.local')&&url.hostname.includes('.'),'source_url','A fonte precisa ser um endereço HTTPS público.');
  const addresses=await resolve(url.hostname);check(addresses.length&&addresses.every(publicIPv4),'source_url','Endereços internos não podem ser usados como fonte.');
  return new Promise((resolveResult,reject)=>{
    const req=request(url,{headers:{'user-agent':'GreenContentStudio/1.0 (+editorial research)','accept':'text/html,application/xhtml+xml','accept-encoding':'identity'},lookup:(hostname,opts,cb)=>opts?.all?cb(null,[{address:addresses[0],family:4}]):cb(null,addresses[0],4),timeout:20000},res=>{
      if([301,302,303,307,308].includes(res.statusCode)) {res.resume();if(redirects>=3)return reject(new Error('source_redirect'));let next;try{next=new URL(res.headers.location,url).href;}catch(e){return reject(e);}safeGet(next,{resolve,request},redirects+1).then(resolveResult,reject);return;}
      if(res.statusCode!==200||!/^text\/html|^application\/xhtml\+xml/i.test(res.headers['content-type']||'')){res.resume();return reject(new Error('source_unavailable'));}
      let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>2000000){res.destroy(new Error('source_large'));return;}chunks.push(b);});res.on('error',reject);res.on('end',()=>resolveResult({url:url.href,html:Buffer.concat(chunks).toString('utf8')}));
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('source_timeout')));
  });
}
function plain(html) {return String(html).replace(/<(script|style|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):' ').replace(/\s+/g,' ').trim();}
async function collect(brief,{get=safeGet,allowed=async()=>true}={}) {
  const sources=[];
  if(brief.facts)sources.push({id:'S0',title:'Informações fornecidas pela marca',url:'',excerpt:brief.facts,kind:'provided',accessed_at:new Date().toISOString()});
  for(const url of brief.urls) {check(await allowed(),'revoked','O acesso foi retirado.');const result=await get(url);const article=result.html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||result.html;const excerpt=plain(article);check(excerpt.length>=200,'source_empty','Não foi possível ler a fonte. Cole os trechos relevantes no campo de informações.');sources.push({id:'S'+(sources.length+1),title:text(plain(result.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||url),250),url:result.url,excerpt:excerpt.slice(0,14000),kind:'web',accessed_at:new Date().toISOString()});}
  return sources;
}
module.exports={publicIPv4,safeGet,plain,collect};
