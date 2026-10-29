'use strict';
// Notes and Post retain the interface vocabulary of the approved catalog-v3 study.
// Icons are inline vectors: no image placeholder, remote font or external asset.
const {esc,ink,contrast}=require('./core.cjs');
const paths={
 back:'<path d="m15 5-7 7 7 7"/>',
 arrow:'<path d="M20 12H4m7-7-7 7 7 7"/>',
 share:'<path d="M8 8H5v13h14V8h-3M12 16V2m-4 4 4-4 4 4"/>',
 more:'<circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r=".6" fill="currentColor"/><circle cx="12" cy="12" r=".6" fill="currentColor"/><circle cx="16" cy="12" r=".6" fill="currentColor"/>',
 dots:'<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
 pen:'<path d="M12 4H4v16h16v-8M10 14l1-4 9-9 3 3-9 9-4 1Z"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
 attachment:'<path d="m9 15 7-7a3 3 0 0 0-4-4L4 12a5 5 0 0 0 7 7l9-9M9 15l7-7"/>',
 markup:'<circle cx="12" cy="12" r="9"/><path d="m8 16 4-11 4 11M9.5 13h5"/>',
 comment:'<path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/>',
 repeat:'<path d="m4 8 3-3 3 3M7 5v11h8M20 16l-3 3-3-3m3 3V8H9"/>',
 heart:'<path d="M20.5 4.6a5 5 0 0 0-7 0L12 6.1l-1.5-1.5a5 5 0 0 0-7 7L12 20l8.5-8.4a5 5 0 0 0 0-7Z"/>',
 bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>'
};
const icon=name=>`<span class="icon" data-icon="${name}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg></span>`;
function slideHtml(p,s,count){
 const notes=p.layout==='notas',steps=s.number!==1&&s.composition==='steps';
 const fg=contrast(p.background,notes?'#1c1c1e':'#0f1419')>=4.5?(notes?'#1c1c1e':'#0f1419'):ink(p.background);
 const muted=contrast(p.background,'#536471')>=4.5?'#536471':fg;
 const ui=contrast(p.primary,p.background)>=3?p.primary:fg;
 const initials=p.name.split(/\s+/).filter(Boolean);const monogram=esc((initials[0]?.[0]||'')+(initials.length>1?initials.at(-1)[0]:''));
 const avatar=()=>`<div class="avatar" aria-hidden="true">${p.logo?`<img src="${p.logo}" alt="">`:monogram}</div>`;
 const identity=()=>`<div class="identity"><strong data-text>${esc(p.name)}</strong>${p.handle?`<span data-text>${esc(p.handle)}</span>`:''}</div>`;
 const footer=`<footer><span data-text>${esc(p.handle||p.name)}</span>${count>1?`<span data-text>${s.number} / ${count}</span>`:''}</footer>`;
 let content;
 if(notes){
  const date=s.note_date?new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(s.note_date+'T12:00:00Z')):'';
  content=`<nav class="note-top"><div>${icon('back')}<span data-text>Notas</span></div><div>${icon('share')}${icon('more')}</div></nav><div class="note-date" data-text>${esc(date)}</div><main class="note-content" data-boundary><h1 data-text>${esc(s.title)}</h1>${steps?`<div class="checklist">${s.items.map(it=>`<div class="check-row"><span class="check-ring" aria-hidden="true"></span><div><h2 data-text>${esc(it.title)}</h2><p data-text>${esc(it.body)}</p></div></div>`).join('')}</div>`:`<p class="note-body" data-text>${esc(s.body)}</p>`}<p class="signature" data-text>— ${esc(p.name)}</p></main><div class="note-bottom">${['check','attachment','markup','pen'].map(icon).join('')}</div>${footer}`;
 }else{
  content=`<nav class="post-top">${icon('arrow')}<span data-text>${steps?'Sequência':'Post'}</span></nav>${steps?`<h1 class="thread-title" data-text data-boundary>${esc(s.title)}</h1><main class="thread" data-boundary>${s.items.map(it=>`<article class="reply">${avatar()}<div class="reply-copy">${identity()}<h2 data-text>${esc(it.title)}</h2><p data-text>${esc(it.body)}</p></div></article>`).join('')}</main>`:`<header class="post-identity">${avatar()}${identity()}${icon('dots')}</header><main class="post-content" data-boundary><h1 data-text>${esc(s.title)}</h1><p data-text>${esc(s.body)}</p></main>`}<div class="post-actions">${['comment','repeat','heart','bookmark','share'].map(icon).join('')}</div>${footer}`;
 }
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>
 *{box-sizing:border-box}html,body{margin:0;width:1080px;height:1350px;overflow:hidden}body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:${fg};background:${p.background}}.art{position:relative;width:540px;height:675px;transform:scale(2);transform-origin:top left;overflow:hidden}h1,h2,p{margin:0;white-space:pre-wrap}[data-text]{flex-shrink:0;overflow-wrap:normal}.icon{display:inline-flex;align-items:center;justify-content:center;width:29px;height:29px;flex-shrink:0}.icon svg{width:100%;height:100%}footer{position:absolute;left:35px;right:35px;top:650px;display:flex;justify-content:space-between;gap:16px;color:${muted};font-size:10px;line-height:1.2}footer span:first-child{max-width:400px}
 .note-top{position:absolute;left:25px;right:27px;top:30px;display:flex;justify-content:space-between;align-items:center;color:${ui};font-size:23px}.note-top>div{display:flex;align-items:center;gap:5px}.note-top>div:last-child{gap:24px}.note-date{position:absolute;top:99px;width:100%;text-align:center;color:${muted};font-size:14px}.note-content{position:absolute;left:35px;top:145px;width:470px;height:448px;display:flex;flex-direction:column;gap:23px}.note-content h1{font-size:42px;font-weight:700;line-height:1.12;letter-spacing:-1.1px}.note-body{font-size:29px;line-height:1.34;letter-spacing:-.3px}.signature{font-size:23px;line-height:1.2}.checklist{display:flex;flex-direction:column;gap:20px;flex-shrink:0}.check-row{display:grid;grid-template-columns:25px 1fr;gap:14px}.check-ring{border:2px solid ${ui};width:24px;height:24px;border-radius:50%;margin-top:4px}.check-row h2{font-size:26px;font-weight:500;line-height:1.22}.check-row p{font-size:22px;line-height:1.24;margin-top:5px}.note-bottom{position:absolute;left:35px;right:35px;top:608px;display:flex;justify-content:space-between;color:${ui}}
 .post-top{position:absolute;top:32px;left:29px;right:30px;display:flex;align-items:center;gap:26px;font-size:22px;font-weight:700}.post-top .icon{width:24px}.post-identity{position:absolute;left:33px;right:32px;top:117px;display:flex;align-items:center;gap:13px}.avatar{height:51px;width:51px;border-radius:50%;background:${p.primary};color:${ink(p.primary)};display:flex;align-items:center;justify-content:center;font:600 21px Arial;flex-shrink:0;overflow:hidden}.avatar img{width:100%;height:100%;object-fit:contain;background:white}.identity{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}.identity strong{font-size:20px;line-height:1.2;font-weight:700}.identity span{color:${muted};font-size:17px;line-height:1.2}.post-identity>.icon{align-self:flex-start;color:${muted};width:23px}.post-content{position:absolute;top:205px;left:35px;width:470px;height:361px;display:flex;flex-direction:column;gap:24px}.post-content h1{font-size:38px;font-weight:500;line-height:1.17;letter-spacing:-.7px}.post-content>p{font-size:29px;line-height:1.34;letter-spacing:-.3px}.post-actions{position:absolute;left:35px;right:35px;top:591px;border-top:1px solid ${muted}40;padding-top:17px;color:${muted};display:flex;justify-content:space-between}.post-actions .icon{width:24px;height:24px}.thread-title{position:absolute;left:35px;top:82px;width:470px;height:62px;font-size:25px;font-weight:500;line-height:1.2}.thread{position:absolute;left:35px;top:158px;width:470px;height:413px;display:flex;flex-direction:column;gap:20px}.reply{display:flex;gap:14px;position:relative;flex-shrink:0}.reply:not(:last-child):after{content:'';position:absolute;top:47px;bottom:-20px;left:21px;width:2px;background:${muted}40}.reply-copy{flex:1;min-width:0}.reply .identity{gap:3px}.reply .identity strong{font-size:17px}.reply .identity span{font-size:13px}.reply h2{font-size:23px;line-height:1.2;font-weight:500;margin-top:9px}.reply p{font-size:20px;line-height:1.25;margin-top:6px}.thread .avatar{width:43px;height:43px;font-size:18px}
 </style></head><body><article class="art" data-layout="${p.layout}">${content}</article></body></html>`;
}
module.exports={slideHtml};
