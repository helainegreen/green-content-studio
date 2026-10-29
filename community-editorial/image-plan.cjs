'use strict';
const c=require('./core.cjs');
function photos(b){const all=b.source?.images||[],urls=new Set(all.map(x=>x.url));return all.filter(im=>{const full=new URL(im.url);full.pathname=full.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.[^.]+$)/,'');return full.href===im.url||!urls.has(full.href);});}
function draft(b,{resume=false}={}){
 if(resume&&b.image_plan_draft)return structuredClone(b.image_plan_draft);
 return {cover:b.image_choice?.kind==='source'?structuredClone(b.image_choice):b.image_job?{kind:'existing'}:b.image_plan?.cover||null,internals:structuredClone(b.internal_choices??b.image_plan?.internals??[])};
}
function syncLegacyChoice(b,actor){
 b.image_plan={cover:b.image_choice?.kind==='source'?structuredClone(b.image_choice):{kind:'existing'},internals:structuredClone(b.internal_choices||[]),confirmed_at:new Date().toISOString(),confirmed_by:actor};
 b.image_plan_draft=structuredClone(b.image_plan);
}
function normalize(b,input,{confirm=false,actor}={}){
 c.check(input&&typeof input==='object','image_plan','Escolha como usar as imagens.');
 const available=new Map(photos(b).map(im=>[im.id,im]));
 function choice(x){const im=available.get(x?.id);c.check(im,'invalid_image','Escolha uma imagem da matéria.');const credit=c.text(x.credit||im.credit||'',250, !confirm);c.check(!confirm||x.rights_confirmed===true,'rights','Confirme o uso das imagens selecionadas.');return {...im,kind:'source',credit,rights_confirmed:x.rights_confirmed===true,...(confirm?{confirmed_by:actor}:{} )};}
 let cover=null;
 if(input.cover?.kind==='existing'){c.check(b.image_job||b.image_plan?.cover?.kind==='existing','existing_cover','Não há uma capa anterior disponível.');cover={kind:'existing'};}
 else if(input.cover?.kind==='ai')cover={kind:'ai',guidance:c.text(input.cover.guidance||'',1200,true)};
 else if(input.cover?.kind==='source')cover=choice(input.cover);
 else c.check(!confirm&&!input.cover,'cover','Escolha a imagem da capa ou a opção de gerar uma ilustração.');
 c.check(Array.isArray(input.internals)&&input.internals.length<=3,'internal_images','Escolha até três imagens para os slides internos.');const seen=new Set();const internals=input.internals.map(x=>{c.check(!seen.has(x.id),'duplicate_image','Esta imagem já foi selecionada.');seen.add(x.id);return choice(x);});
 return {cover,internals,...(confirm?{confirmed_by:actor,confirmed_at:new Date().toISOString()}: {})};
}
function apply(b,plan){c.check(plan.confirmed_at&&plan.cover,'image_plan','Confirme as imagens antes de gerar.');if(plan.cover.kind!=='existing'){
 b.image_revision=(b.image_revision||1)+1;b.image_choice=plan.cover.kind==='source'?plan.cover:{kind:'ai'};
 if(plan.cover.kind==='ai'&&b.copy&&plan.cover.guidance)b.copy.cover_prompt+='\nOrientação da editora: '+plan.cover.guidance;
 }
 b.image_plan=plan;b.image_plan_draft=plan;b.internal_choices=plan.internals;delete b.image_job;delete b.render_job;delete b.ready_digest;return b;
}
module.exports={photos,draft,syncLegacyChoice,normalize,apply};
