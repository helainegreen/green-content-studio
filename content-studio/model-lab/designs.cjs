'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {esc,ink,profile}=require('./core.cjs');
const {NEW}=require('./layouts.cjs');
const names={sans:'GCS Sans',serif:'GCS Serif',display:'GCS Display',mono:'GCS Mono',rounded:'GCS Rounded',handwritten:'GCS Handwritten',kalam:'GCS Kalam',handbody:'GCS Patrick Hand'};
let fonts;
function fontCss(){if(!fonts)fonts=Object.entries(names).filter(([file])=>fs.existsSync(path.join(__dirname,'fonts',file+'.ttf'))).map(([file,name])=>`@font-face{font-family:'${name}';src:url(data:font/ttf;base64,${fs.readFileSync(path.join(__dirname,'fonts',file+'.ttf')).toString('base64')});font-weight:${file==='display'?'700':['handwritten','kalam','handbody'].includes(file)?'400':'100 900'};font-display:block}`).join('');return fonts;}
const box=(x,y,w,h,style,content='',extra='')=>`<div ${extra} style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${style}">${content}</div>`;
const txt=(value,x,y,w,h,size,style='')=>box(x,y,w,h,`font-size:${size}px;line-height:1.15;white-space:pre-line;${style}`,esc(value),'data-text data-boundary');
function rough(value,seed=0){let index=0;return String(value).normalize('NFC').split('\n').map(line=>line.trim().split(/\s+/).filter(Boolean).map(word=>`<span class="rough-word">${[...word].map(character=>{const n=index+++seed,rotation=n*7%7-3,x=n*5%5-2,y=n*11%7-3,c=esc(character);return `<span class="rough-char" data-c="${c}" style="--x:${x}px;--y:${y}px;--r:${rotation}deg">${c}</span>`;}).join('')}</span>`).join(' ')).join('<br>');}
function handwrittenHtml(p,s,count){
 const bg=p.background,fg=p.primary,cover=s.number===1,steps=!cover&&s.composition==='steps',titleFont=`font-family:'${names.kalam}';`,bodyFont=`font-family:'${names.handbody}';`;
 const line=(x,y,w,h=2,rotate=0)=>box(x,y,w,h,`background:${fg};border-radius:50%;transform:rotate(${rotate}deg);opacity:.88;`);
 const paper=box(0,0,540,675,`background-color:${bg};background-image:radial-gradient(circle at 18% 13%,rgba(255,255,255,.22),transparent 25%),radial-gradient(circle at 78% 74%,rgba(91,56,23,.09),transparent 38%),radial-gradient(circle at 60% 21%,rgba(255,247,224,.18),transparent 24%),radial-gradient(circle at 32% 71%,rgba(116,75,34,.045),transparent 31%),radial-gradient(circle at 71% 37%,rgba(255,255,255,.09),transparent 29%);`);
 const handle=txt(p.handle||p.name,365,cover?646:622,150,cover?20:30,12,bodyFont+'text-align:right;transform:rotate(-1deg);');
 let art=paper+handle;
 if(cover){
  art+=box(49,34,220,150,`font-size:124px;line-height:1;${titleFont}font-weight:400;transform:rotate(-3deg);`,rough(String(count).padStart(2,'0'),2),'data-text data-boundary class="rough scribbled"');
  art+=box(35,197,470,267,`font-size:66px;line-height:.94;${titleFont}font-weight:400;text-align:center;text-transform:uppercase;`,rough(String(s.title).toLocaleUpperCase('pt-BR'),7),'data-text data-boundary class="rough scribbled"');
  art+=line(54,473,432,3,-1)+line(80,483,378,2,1);
  art+=txt(s.body,58,521,305,101,29,bodyFont+'line-height:1.02;text-align:center;transform:rotate(-2deg);');
  art+=`<svg aria-hidden="true" viewBox="0 0 110 145" style="position:absolute;right:31px;top:508px;width:103px;height:132px;stroke:${fg};fill:none;stroke-linecap:round;stroke-linejoin:round"><circle cx="51" cy="31" r="21" stroke-width="2.7"/><path d="M43 27l1 1m14-1l1 1M41 37q10 10 22 0M51 53l-2 49M50 73L24 94M50 73l38-17M49 102l-18 37M49 102l23 35M88 56l13-8M91 64l16 1M86 49l6-15" stroke-width="3"/><path d="M52 53l-2 49M50 73L26 96" stroke-width="1.3" opacity=".65"/></svg>`;
 }else if(steps){
  art+=box(28,35,484,83,`font-size:42px;line-height:1;${titleFont}text-align:center;text-transform:uppercase;`,rough(String(s.title).toLocaleUpperCase('pt-BR'),17),'data-text data-boundary class="rough scribbled"');
  art+=line(35,108,470,2,-.5)+line(49,114,438,1,.35);
  const start=145,unit=151;
  s.items.forEach((item,i)=>{const top=start+i*unit;art+=txt(String(i+1)+'.',35,top,43,45,30,bodyFont);art+=box(78,top,425,122,'display:flex;flex-direction:column;gap:8px;',`<div data-text style="font-size:27px;line-height:1.05;${bodyFont}">${esc(item.title)}</div><div data-text style="font-size:22px;line-height:1.12;white-space:pre-line;${bodyFont}">${esc(item.body)}</div>`,'data-boundary');});
 }else{
  art+=box(28,35,484,83,`font-size:42px;line-height:1;${titleFont}text-align:center;text-transform:uppercase;`,rough(String(s.title).toLocaleUpperCase('pt-BR'),29),'data-text data-boundary class="rough scribbled"');
  art+=line(35,108,470,2,-.5)+line(49,114,438,1,.35);
  art+=txt(s.body,35,138,470,472,29,bodyFont+'line-height:1.14;');
 }
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"><style>${fontCss()}*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden}body{background:${bg};color:${fg}}.art{position:relative;width:540px;height:675px;transform:scale(2);transform-origin:top left;overflow:hidden}img{display:block}[data-text]{z-index:1;flex-shrink:0;overflow-wrap:normal}.rough-word{display:inline-block;white-space:nowrap}.rough-char{display:inline-block;position:relative;transform:translate(var(--x),var(--y)) rotate(var(--r));}.rough-char:before,.rough-char:after{content:attr(data-c);position:absolute;inset:0;pointer-events:none}.scribbled .rough-char{color:transparent;-webkit-text-stroke:1.15px ${fg};text-shadow:none}.scribbled .rough-char:before{color:transparent;-webkit-text-stroke:.8px ${fg};transform:translate(.8px,-.45px);opacity:.82}.scribbled .rough-char:after{color:transparent;-webkit-text-stroke:.65px ${fg};transform:translate(-.6px,.65px);opacity:.68}</style></head><body><article class="art" data-layout="rascunho">${art}</article></body></html>`;
}
function editorialTutorialHtml(p,s,count,imageData=''){
 const bg=p.background,fg=ink(bg),muted=fg+'a3',cover=s.number===1,steps=!cover&&s.composition==='steps';
 const initials=p.name.split(/\s+/).filter(Boolean),monogram=esc((initials[0]?.[0]||'')+(initials.length>1?initials.at(-1)[0]:''));
 const avatar=p.logo?`<img src="${p.logo}" alt="">`:monogram;
 const identity=`<header class="identity"><div class="avatar" aria-hidden="true">${avatar}</div><div class="profile"><strong data-text>${esc(p.name)}</strong><span data-text>${esc(p.handle||p.name)}</span></div><span class="brand-mark" aria-hidden="true"></span></header>`;
 const placeholder=`<div class="mockup" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>`;
 const media=imageData?`<img src="${imageData}" alt="">`:placeholder;
 const footer=`<footer><span data-text>${esc(p.handle||p.name)}</span><span data-text>${String(s.number).padStart(2,'0')} / ${String(count).padStart(2,'0')}</span></footer>`;
 let content=identity;
 if(cover){
  content+=`<main><div class="cover-copy" data-boundary><div class="kicker"><span aria-hidden="true"></span><b data-text>TUTORIAL</b></div><h1 data-text>${esc(s.title)}</h1><p data-text>${esc(s.body)}</p></div><figure class="cover-media">${media}</figure></main>`;
 }else if(steps){
  content+=`<main><h1 class="steps-title" data-text data-boundary>${esc(s.title)}</h1><div class="steps">${s.items.map((item,index)=>`<article data-boundary><span class="number" aria-hidden="true">${index+1}</span><div><h2 data-text>${esc(item.title)}</h2><p data-text>${esc(item.body)}</p></div></article>`).join('')}</div></main>`;
 }else{
  content+=`<main><div class="explain-copy" data-boundary><p data-text>${esc(s.body)}</p><h1 data-text>${esc(s.title)}</h1></div><figure class="explain-media">${media}</figure></main>`;
 }
 content+=footer;
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>${fontCss()}
 *{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden}body{font-family:'GCS Sans',Arial,sans-serif;background:${bg};color:${fg}}.art{position:relative;width:540px;height:675px;transform:scale(2);transform-origin:top left;overflow:hidden}h1,h2,p{margin:0;white-space:pre-line}[data-text]{overflow-wrap:normal;letter-spacing:0}.identity{position:absolute;left:30px;right:30px;top:26px;height:58px;display:flex;align-items:center;gap:13px}.avatar{width:50px;height:50px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;overflow:hidden;background:${p.primary};color:${ink(p.primary)};font-size:18px;font-weight:800}.avatar img{width:100%;height:100%;object-fit:cover;background:#fff}.profile{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px}.profile strong{font-size:20px;line-height:1.15;font-weight:800}.profile span{font-size:16px;line-height:1.15;color:${muted}}.brand-mark{width:13px;height:13px;background:${p.primary};transform:rotate(45deg);margin-right:3px}.cover-copy{position:absolute;left:30px;top:108px;width:480px;height:238px;display:flex;flex-direction:column;gap:13px}.kicker{display:flex;align-items:center;gap:9px;font-size:18px}.kicker span{width:8px;height:23px;background:${p.primary}}.kicker b{font-weight:900}.cover-copy h1{font-size:43px;line-height:1.08;font-weight:500}.cover-copy p{font-size:21px;line-height:1.25;color:${muted}}figure{margin:0;position:absolute;left:30px;width:480px;overflow:hidden;border-radius:7px;background:#edf1ee}figure img{width:100%;height:100%;object-fit:cover}.cover-media{top:365px;height:246px}.explain-copy{position:absolute;left:30px;top:111px;width:480px;height:271px;display:flex;flex-direction:column;gap:20px}.explain-copy p{font-size:25px;line-height:1.29}.explain-copy h1{font-size:31px;line-height:1.18;font-weight:850}.explain-media{top:405px;height:207px}.mockup{position:relative;width:100%;height:100%;background:#f0f1ee;overflow:hidden}.mockup i{position:absolute;bottom:-14px;width:112px;height:208px;border-radius:8px;background:#fff;border:1px solid #d5dbd7;box-shadow:0 9px 18px #17211d24}.mockup i:before{content:'';position:absolute;left:12px;right:12px;top:18px;height:78px;background:${p.primary}}.mockup i:after{content:'';position:absolute;left:12px;right:30px;top:112px;height:4px;background:${fg};box-shadow:0 13px 0 ${fg}55,0 26px 0 ${p.accent}}.mockup i:nth-child(1){left:25px;transform:rotate(-9deg);background:${fg}}.mockup i:nth-child(1):before{background:${p.accent}}.mockup i:nth-child(2){left:108px;transform:rotate(-4deg)}.mockup i:nth-child(3){left:193px;z-index:2;background:${p.primary}}.mockup i:nth-child(3):before{background:${bg}}.mockup i:nth-child(4){left:278px;transform:rotate(4deg)}.mockup i:nth-child(4):before{background:${p.accent}}.mockup i:nth-child(5){left:358px;transform:rotate(9deg)}.steps-title{position:absolute;left:30px;top:111px;width:480px;height:78px;font-size:35px;line-height:1.12;font-weight:800}.steps{position:absolute;left:30px;top:211px;width:480px;height:396px;display:flex;flex-direction:column}.steps article{display:grid;grid-template-columns:48px 1fr;gap:17px;min-height:132px;padding:18px 0;border-top:1px solid ${fg}2e}.number{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:${p.primary};color:${ink(p.primary)};font-size:18px;font-weight:900}.steps h2{font-size:24px;line-height:1.15;font-weight:850}.steps p{margin-top:7px;font-size:19px;line-height:1.24;color:${muted}}footer{position:absolute;left:30px;right:30px;top:641px;height:18px;display:flex;justify-content:space-between;gap:20px;font-size:10px;line-height:1.2;color:${muted}}footer span:first-child{max-width:390px}
 .cover-copy{height:245px;gap:11px}.cover-copy h1{font-size:41px}.cover-copy p{font-size:20px;line-height:1.23}.explain-media{top:335px;height:277px}.steps-title{height:84px}
 </style></head><body><article class="art" data-layout="editorialtutorial">${content}</article></body></html>`;
}
function slideHtml(brand,s,count,imageData=''){
 const p=profile(brand),id=p.layout,spec=NEW[id],cover=s.number===1,steps=!cover&&s.composition==='steps';
 if(id==='editorialtutorial')return editorialTutorialHtml(p,s,count,imageData);
 if(id==='notas'||id==='post')return require('./app-designs.cjs').slideHtml(p,s,count);
 if(id==='rascunho')return handwrittenHtml(p,s,count);
 const bg=p.background,fg=ink(bg),primary=p.primary,pi=ink(primary),accent=p.accent,ai=ink(accent);
 const font=({manifesto:'display',recortes:'serif',galeria:'serif',organico:'serif',tecnico:'mono',pop:'rounded',cinema:'serif',jornal:'serif',aurora:'sans',mosaico:'rounded',notas:'sans',rascunho:'handwritten',post:'sans'})[id];
 const ff=`font-family:'${names[font]}';`,title=(x,y,w,h,size,style='')=>txt(s.title,x,y,w,h,size,ff+'font-weight:700;'+style),body=(x,y,w,h,size,style='')=>txt(s.body,x,y,w,h,size,style);
 const photo=(x,y,w,h,style='')=>box(x,y,w,h,`overflow:hidden;background:${primary};${style}`,imageData?`<img src="${imageData}" alt="" style="width:100%;height:100%;object-fit:cover">`:`<div style="width:100%;height:100%;background:radial-gradient(circle at 30% 30%,${accent},transparent 60%);opacity:.7"></div>`);
 const line=(x,y,w,c=fg,h=1)=>box(x,y,w,h,`background:${c}`);
 let art='';
 const footer=()=>txt(p.handle||p.name,30,639,385,26,10,'line-height:1.2;')+txt(`${String(s.number).padStart(2,'0')} / ${String(count).padStart(2,'0')}`,444,642,66,18,10,'text-align:right;')+(imageData?txt('Imagem ilustrativa',30,619,390,16,8):'');
 const brandmark=p.logo?box(30,22,72,42,'background:#ffffff;border-radius:4px;padding:4px;',`<img src="${p.logo}" alt="" style="width:100%;height:100%;object-fit:contain">`):'';
 if(id==='post'){
  art+=box(35,70,52,52,`border-radius:50%;background:${primary};color:${pi};overflow:hidden;display:grid;place-items:center;font-size:24px;font-weight:700;`,p.logo?`<img src="${p.logo}" alt="" style="width:100%;height:100%;object-fit:contain;background:white">`:esc([...p.name][0]||''));
  art+=txt(p.name,102,69,395,44,18,'font-weight:700;')+txt(p.handle||p.name,102,119,395,36,13);
 }else if(id==='jornal')art+=brandmark+txt(p.name,p.logo?115:30,21,p.logo?395:480,74,30,"font-family:'GCS Serif';font-weight:700;text-align:center;")+line(30,99,480,fg,3)+line(30,106,480);
 else art+=brandmark+txt(p.name,p.logo?115:30,26,p.logo?395:480,40,12,'font-weight:700;letter-spacing:.5px;');
 art+=footer();
 if(id==='tecnico')art=box(0,0,540,675,`background-image:linear-gradient(${fg}15 1px,transparent 1px),linear-gradient(90deg,${fg}15 1px,transparent 1px);background-size:27px 27px;`)+art;
 if(id==='aurora')art=box(0,0,540,675,`background:radial-gradient(ellipse at 90% 5%,${accent}50,transparent 55%),radial-gradient(ellipse at 0% 90%,${primary}80,transparent 55%);`)+box(-50,300,650,260,`border:1px solid ${fg}25;border-radius:50%;transform:rotate(-35deg);`)+art;
 if(id==='organico')art=box(-80,440,700,250,`border-radius:50% 50% 0 0;background:${primary}22;transform:rotate(-9deg);`)+art;
 if(id==='recortes')art=box(0,0,540,675,`background:repeating-linear-gradient(0deg,transparent,transparent 23px,${fg}0d 24px);`)+art;
 if(id==='notas')art+=txt('‹  Notas',35,88,300,26,16,`color:${ink(bg)};`)+box(469,88,30,22,`border:2px solid ${primary};border-radius:4px;`);
 if(steps){
  const y=id==='post'?182:120,headH=120;
  art+=title(30,y,480,headH,id==='manifesto'?50:46);
  const start=y+headH+12,available=610-start,unit=available/3;
  s.items.forEach((item,i)=>{
   const top=start+i*unit,cardBg=id==='pop'||id==='recortes'||id==='organico'&&i===1?accent:bg,ci=ink(cardBg);
   const rounded={pop:'45px 45px 7px 45px',organico:'40px 10px 40px 10px',aurora:'20px'}[id]||'0px';
   let x=104,w=384;
   if(id==='cinema'){art+=photo(30,top,155,unit-11);x=211;w=299;}
   else if(id==='jornal'||id==='galeria'||id==='manifesto')art+=line(30,top+unit-9,480,fg,id==='manifesto'?3:1);
   else if(!['notas','post'].includes(id))art+=box(30,top,480,unit-9,`background:${cardBg};color:${ci};border:${id==='recortes'||id==='organico'||id==='pop'?0:1}px solid ${fg}70;border-radius:${rounded};${id==='recortes'?'transform:rotate('+(i%2?-1:1)+'deg);':''}`);
   if(id==='post'){
    if(i<2)art+=box(56,top+40,2,unit-24,`background:${primary}50;`);
    art+=box(38,top+10,39,39,`border-radius:50%;background:${primary};color:${pi};display:grid;place-items:center;font-size:18px;`,esc([...p.name][0]));
   }else if(id==='notas')art+=box(43,top+15,21,21,`border:2px solid ${primary};border-radius:50%;`);
   else if(id!=='cinema'){
    if(id==='mosaico')art+=box(30,top,64,unit-9,`background:${i%2?accent:primary};`);
    if(id==='aurora')art+=box(40,top+14,46,46,`border:1px solid ${fg};border-radius:50%;`);
    if(id==='tecnico'&&i<2)art+=box(60,top+54,1,unit-43,`background:${fg}70;`);
    art+=txt(id==='galeria'?['I','II','III'][i]:String(i+1).padStart(2,'0'),43,top+15,48,57,id==='manifesto'?44:26,ff+`color:${id==='mosaico'?ink(i%2?accent:primary):ci};`);
   }
   art+=box(x,top+12,w,unit-29,`color:${ci};display:flex;flex-direction:column;gap:7px;`, `<div data-text style="font-size:${id==='cinema'?21:23}px;line-height:1.12;font-weight:700;${ff}">${esc(item.title)}</div><div data-text style="font-size:${id==='cinema'?16:17}px;line-height:1.22;white-space:pre-line;">${esc(item.body)}</div>`,'data-boundary');
  });
 }else if(id==='notas'||id==='post'){
  const y=id==='notas'?150:203,h=id==='notas'?447:394;
  art+=box(35,y,470,h,'display:flex;flex-direction:column;gap:22px;',`<div data-text style="font-size:${id==='notas'?42:38}px;font-weight:700;line-height:1.13;white-space:pre-line;">${esc(s.title)}</div><div data-text style="font-size:29px;line-height:1.3;white-space:pre-line;">${esc(s.body)}</div>`,'data-boundary');
 }else if(cover){
  switch(id){
   case 'manifesto':art+=title(30,88,480,230,64)+photo(30,330,210,240)+body(263,344,247,224,28)+line(30,597,480,fg,4);break;
   case 'recortes':art+=box(33,89,474,214,`background:${primary};transform:rotate(-3deg);`)+title(48,110,440,182,58,`color:${pi};`)+photo(266,326,236,270,'transform:rotate(4deg);border:10px solid white;')+box(24,362,244,213,`background:${accent};transform:rotate(-3deg);`)+body(42,380,205,178,27,`color:${ai};`)+box(350,314,80,27,`background:${accent}aa;transform:rotate(10deg);`);break;
   case 'galeria':art+=line(40,80,460)+title(40,108,460,220,60)+body(40,367,222,230,28)+photo(290,325,210,280,'border-radius:120px 120px 0 0;');break;
   case 'organico':art+=title(35,110,470,220,62)+photo(190,347,300,172,'border-radius:60% 42% 54% 36%;transform:rotate(-8deg);')+box(40,366,95,139,`border:2px solid ${primary};border-radius:100% 0 100% 0;transform:rotate(-20deg);`)+body(35,548,470,65,24);break;
   case 'tecnico':art+=line(30,82,480)+title(30,116,480,197,43)+body(30,331,480,90,23)+photo(166,435,208,176,`border-radius:50%;border:1px solid ${fg};padding:12px;`)+line(30,522,480,fg+'55');break;
   case 'pop':art+=box(28,93,480,230,`background:${accent};border-radius:100px 100px 100px 10px;transform:rotate(-3deg);`)+title(54,121,430,195,54,`color:${ai};`)+photo(30,366,215,221,'border-radius:100px 100px 15px 100px;')+body(269,380,239,220,28);break;
   case 'cinema':art+=title(30,97,480,168,62)+photo(0,286,540,250)+body(35,555,470,62,24,'text-align:center;')+line(30,613,480);break;
   case 'jornal':art+=title(30,134,480,174,62)+line(30,318,480)+photo(30,340,300,259,'filter:grayscale(1);')+body(351,341,159,264,25,ff);break;
   case 'aurora':art+=title(30,106,480,218,58)+box(30,350,480,252,`background:${bg}cc;border:1px solid ${fg}55;border-radius:26px;`)+body(49,378,208,210,28)+photo(279,366,214,220,'border-radius:18px;');break;
   case 'mosaico':art+=box(30,90,480,235,`background:${primary};`)+title(48,112,440,202,56,`color:${pi};`)+box(30,325,210,278,`background:${accent};`)+body(48,358,175,225,24,`color:${ai};`)+photo(240,325,270,278,'border-radius:150px 0 0 0;');break;
  }
 }else{
  // Internal text compositions keep the same visual vocabulary as their cover.
  const titleY=id==='jornal'?134:108;
  if(id==='cinema')art+=photo(0,105,235,490)+title(268,119,242,197,44)+body(268,339,242,258,25,ff);
  else if(id==='recortes')art+=title(30,titleY,480,147,48)+photo(36,296,212,294,'transform:rotate(-5deg);border:9px solid white;')+box(251,304,262,294,`background:${accent};transform:rotate(3deg);`)+body(269,328,221,247,25,`color:${ai};`);
  else if(id==='jornal')art+=title(30,titleY,480,150,53)+photo(30,305,480,165,'filter:grayscale(1);')+box(30,492,480,115,ff+`font-size:25px;line-height:1.22;column-count:2;column-gap:32px;column-rule:1px solid ${fg};`,esc(s.body),'data-text data-boundary');
  else if(id==='mosaico')art+=box(30,93,480,202,`background:${accent};`)+title(47,109,446,175,54,`color:${ai};`)+box(30,295,136,303,`background:${primary};`)+box(56,376,86,86,`border:10px solid ${pi};border-radius:50%;`)+body(194,329,307,267,29);
  else {
   const surface=['manifesto','pop'].includes(id)?accent:bg,si=ink(surface),radius=id==='pop'?'80px 80px 10px 80px':id==='organico'?'90px 40px 90px 40px':id==='aurora'?'26px':'0px';
   art+=title(30,titleY,480,218,id==='manifesto'?56:id==='tecnico'?41:52)+box(30,337,480,263,`background:${surface};border:1px solid ${fg}55;border-radius:${radius};`)+body(62,368,416,207,id==='tecnico'?25:29,`color:${si};`);
  }
 }
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"><style>${fontCss()}*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden}body{font-family:'GCS Sans';background:${bg};color:${fg}}.art{position:relative;width:540px;height:675px;transform:scale(2);transform-origin:top left;overflow:hidden}img{display:block}[data-text]{z-index:1;flex-shrink:0;overflow-wrap:normal}</style></head><body><article class="art" data-layout="${id}">${art}</article></body></html>`;
}
// Run in Chromium after fonts/images load. Never shrink, clip or rewrite copy.
function measure(){
 const bad=[];for(const e of document.querySelectorAll('[data-boundary]'))if(e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)bad.push('overflow');
 const nodes=[...document.querySelectorAll('[data-text]')].filter(e=>e.textContent.trim());
 const rects=nodes.map(e=>{const r=document.createRange();r.selectNodeContents(e);const b=r.getBoundingClientRect();if(b.left<0||b.top<0||b.right>1081||b.bottom>1351)bad.push('outside');const boundary=e.closest('[data-boundary]');if(boundary){const a=boundary.getBoundingClientRect();if(b.left<a.left-2||b.right>a.right+2||b.top<a.top-parseFloat(getComputedStyle(e).fontSize)*.5||b.bottom>a.bottom+parseFloat(getComputedStyle(e).fontSize)*.5)bad.push('boundary');}return b;});
 for(let i=0;i<rects.length;i++)for(let k=i+1;k<rects.length;k++){const a=rects[i],b=rects[k];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)bad.push('collision');}
 for(const e of nodes)if(!document.fonts.check(getComputedStyle(e).fontSize+' '+getComputedStyle(e).fontFamily))bad.push('font');
 return {bad,width:innerWidth,height:innerHeight,fonts:nodes.map(e=>parseFloat(getComputedStyle(e).fontSize)*2)};
}
module.exports={slideHtml,measure,fontCss};
