'use strict';
// Shared contract for generation, review and rendering. Characters are ceilings,
// never a promise of fit: Chromium must also measure each composition.
const LEGACY={editorial:'Editorial',minimal:'Minimalista',photo:'Fotográfico',impact:'Impacto',institutional:'Institucional'};
const rows=[
 ['manifesto','Manifesto','Pôster, letras condensadas e contraste.',55,100,60,180,'#111111','#f74920','#fff4d5'],
 ['recortes','Recortes','Papéis, fotografias e colagem.',60,110,60,180,'#244b39','#e7dac4','#f1ee6e'],
 ['galeria','Galeria','Serifas, arcos e composição assimétrica.',60,110,60,170,'#bba581','#29231f','#eee6d6'],
 ['organico','Orgânico','Curvas, formas naturais e traços.',60,120,60,190,'#5d6342','#eee9dc','#bf6046'],
 ['tecnico','Técnico','Grade, diagramas e anotações.',60,110,60,180,'#123da1','#123da1','#a8f0d6'],
 ['pop','Pop','Letras arredondadas e formas expansivas.',55,100,60,180,'#422884','#422884','#ffb485'],
 ['cinema','Cinema','Fotografia panorâmica e sequência de cenas.',60,110,55,150,'#e2cb91','#121817','#f7f3e8'],
 ['jornal','Jornal','Manchetes, colunas e fotografia em preto e branco.',65,110,60,180,'#242621','#ebe7dd','#b23f2f'],
 ['aurora','Aurora','Gradientes, órbitas e painéis translúcidos.',60,110,60,190,'#102b36','#102b36','#b0f2ce'],
 ['mosaico','Mosaico','Blocos de cor, geometria e recortes.',55,100,60,160,'#a43e2b','#f0ddba','#2448a1'],
 ['notas','Notas','Bloco de notas, marcadores e checklist.',65,150,65,240,'#b48200','#fffdf7','#f4cd61'],
 ['rascunho','Anotação','Papel bege, caneta azul e escrita manual.',70,110,60,330,'#1522ad','#dec39c','#1522ad'],
 ['post','Post / Twitter','Perfil, texto e sequência de respostas.',85,170,85,220,'#245b45','#ffffff','#edf2f5'],
 ['editorialtutorial','Editorial Tutorial','Cabeçalho de perfil, narrativa didática e exemplos visuais.',88,120,70,190,'#13533f','#ffffff','#d7fa69']
];
const NEW=Object.fromEntries(rows.map(([id,name,description,title,body,innerTitle,innerBody,primary,background,accent])=>[id,{id,name,description,cover:{title,body,...(id==='post'?{total:220}:{})},text:{title:innerTitle,body:innerBody,...(id==='post'?{total:260}:{})},steps:{title:50,body:0,items:3,itemTitle:30,itemBody:65},palette:{primary,background,accent},image:!['notas','post','rascunho'].includes(id)}]));
const LAYOUTS={...LEGACY,...Object.fromEntries(Object.values(NEW).map(x=>[x.id,x.name]))};
const isNew=id=>Object.hasOwn(NEW,id);
function budget(id,slide={number:1}) {const spec=NEW[id];return spec?(slide.number===1?spec.cover:slide.composition==='steps'?spec.steps:spec.text):{title:110,body:460};}
function issues(id,slides) {
 const result=[];
 for(const s of slides){const b=budget(id,s),prefix='Slide '+s.number+': ';
  if(s.title.length>b.title)result.push(prefix+'título até '+b.title+' caracteres.');
  if(s.body.length>b.body)result.push(prefix+'texto até '+b.body+' caracteres.');
  if(b.total&&s.title.length+s.body.length>b.total)result.push(prefix+'título e texto juntos até '+b.total+' caracteres.');
  if(s.composition==='steps'){
   if(!b.items||s.items?.length!==b.items)result.push(prefix+'esta composição requer três itens em um slide interno.');
   for(const item of s.items||[]){if(item.title.length>b.itemTitle||item.body.length>b.itemBody)result.push(prefix+'cada item aceita título de até '+b.itemTitle+' e texto de até '+b.itemBody+' caracteres.');}
  }
 }
 return result;
}
module.exports={LEGACY,NEW,LAYOUTS,isNew,budget,issues};
