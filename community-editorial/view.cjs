'use strict';
const c=require('./core.cjs');

const statusLabels={scheduled:'Agendado',processing:'Publicando',published:'Publicado',failed:'Falhou',held:'Pausado',uncertain:'Conferir',cancelled:'Cancelado'};
const networkLabels={facebook:'Facebook',instagram:'Instagram'};

function header(current='editorial'){
 return `<header class="studio-header"><div class="studio-bar"><a class="brand" href="/dashboard" aria-label="Green Content Studio — ir ao dashboard"><b>green<span>content</span></b><small>STUDIO</small></a><form method="post" action="/logout"><button class="studio-signout" type="submit">Sair</button></form></div><div class="studio-navigation"><a class="studio-back" href="/dashboard"><span aria-hidden="true">←</span> Voltar ao dashboard</a><nav aria-label="Navegação do Community News"><a href="${c.BASE}" ${current==='editorial'?'aria-current="page"':''}>Pautas do Community News</a><a href="${c.BASE}/agenda" ${current==='calendar'?'aria-current="page"':''}>Agenda</a><a href="/clients/community">Histórico completo</a></nav></div></header>`;
}

function shell({title,content,current='editorial',scripts=''}){
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${c.esc(title)}</title><link rel="stylesheet" href="${c.BASE}/style.css"></head><body>${header(current)}<main>${content}</main>${scripts}</body></html>`;
}

function monthShift(month,amount){const [year,value]=month.split('-').map(Number),date=new Date(Date.UTC(year,value-1+amount,1));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;}
function monthLabel(month){const [year,value]=month.split('-').map(Number);return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,value-1,1)));}
function localDate(value){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function localTime(value){return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
function entryStatus(deliveries){const active=deliveries.filter(item=>item.status!=='cancelled');if(!active.length)return 'cancelled';if(active.some(item=>['failed','held','uncertain'].includes(item.status)))return 'attention';if(active.some(item=>item.status==='processing'))return 'processing';if(active.some(item=>item.status==='scheduled'))return 'scheduled';if(active.every(item=>item.status==='published'))return 'published';return 'attention';}
function coverUrl(entry){return entry.cover?`/posts/${encodeURIComponent(entry.post_id)}/feed/image?id=${encodeURIComponent(entry.cover.id)}&sha=${encodeURIComponent(entry.cover.sha256)}`:'';}
function entryLink(entry){return entry.request_id?`${c.BASE}/${encodeURIComponent(entry.request_id)}`:`/posts/${encodeURIComponent(entry.post_id)}/review`;}
function networkStatus(delivery){return `<span class="calendar-network ${c.esc(delivery.status)}"><b>${c.esc(networkLabels[delivery.network]||delivery.network)}</b> ${c.esc(statusLabels[delivery.status]||delivery.status)}</span>`;}
function externalLinks(entry){return entry.deliveries.filter(item=>item.status==='published'&&/^https:\/\//.test(item.result?.url||'')).map(item=>`<a href="${c.esc(item.result.url)}" target="_blank" rel="noopener noreferrer">Ver no ${c.esc(networkLabels[item.network]||item.network)} ↗</a>`).join('');}
function calendarEntry(entry){const status=entryStatus(entry.deliveries),image=coverUrl(entry),links=externalLinks(entry);return `<article class="calendar-entry ${status}"><a class="calendar-entry-main" href="${c.esc(entryLink(entry))}">${image?`<img src="${c.esc(image)}" alt="Capa de ${c.esc(entry.title)}" loading="lazy">`:'<span class="calendar-cover-empty" aria-hidden="true"></span>'}<span class="calendar-entry-copy"><time datetime="${c.esc(entry.due_at)}">${localTime(entry.due_at)}</time><strong>${c.esc(entry.title)}</strong><span class="calendar-overall">${status==='attention'?'Precisa de atenção':statusLabels[status]}</span></span></a><div class="calendar-networks">${entry.deliveries.map(networkStatus).join('')}</div>${links?`<div class="calendar-results">${links}</div>`:''}</article>`;}

function calendarPage(data){
 const calendar=data.calendar,month=calendar.month,[year,value]=month.split('-').map(Number),days=new Date(Date.UTC(year,value,0)).getUTCDate(),offset=new Date(Date.UTC(year,value-1,1)).getUTCDay(),byDay=new Map();
 for(const entry of calendar.entries){const key=localDate(entry.due_at);if(!byDay.has(key))byDay.set(key,[]);byDay.get(key).push(entry);}
 const cells=[];for(let index=0;index<offset;index++)cells.push('<div class="calendar-day empty" aria-hidden="true"></div>');
 for(let day=1;day<=days;day++){const key=`${month}-${String(day).padStart(2,'0')}`,entries=byDay.get(key)||[];cells.push(`<section class="calendar-day ${entries.length?'has-entries':''}"><h2><time datetime="${key}">${day}</time></h2><div class="calendar-day-entries">${entries.map(calendarEntry).join('')}</div></section>`);}
 const states=calendar.entries.map(entry=>entryStatus(entry.deliveries)),summary={scheduled:states.filter(x=>x==='scheduled').length,processing:states.filter(x=>x==='processing').length,published:states.filter(x=>x==='published').length,attention:states.filter(x=>x==='attention').length};
 const content=`<div class="calendar-intro"><div><span class="eyebrow">Agenda do Community News</span><h1>Publicações</h1><p class="muted">Acompanhe o horário e o resultado de cada envio no Facebook e no Instagram.</p></div><a class="button" href="${c.BASE}/new">Criar conteúdo +</a></div><nav class="calendar-month-nav" aria-label="Escolher mês"><a class="button secondary" href="${c.BASE}/agenda?month=${monthShift(month,-1)}" aria-label="Mês anterior">←</a><h2>${c.esc(monthLabel(month))}</h2><a class="button secondary" href="${c.BASE}/agenda?month=${monthShift(month,1)}" aria-label="Próximo mês">→</a></nav><div class="calendar-summary" aria-label="Resumo do mês"><span><b>${calendar.entries.length}</b> publicações</span><span><b>${summary.scheduled}</b> agendadas</span><span><b>${summary.processing}</b> publicando</span><span><b>${summary.published}</b> publicadas</span>${summary.attention?`<span class="attention"><b>${summary.attention}</b> com atenção</span>`:''}</div><div class="calendar-weekdays" aria-hidden="true"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${cells.join('')}</div>${!calendar.entries.length?'<section class="calendar-empty"><h2>Nenhuma publicação neste mês</h2><p class="muted">Os conteúdos aparecerão aqui depois da confirmação final do agendamento.</p></section>':''}`;
 return shell({title:`Agenda de ${monthLabel(month)} · Community News`,content,current:'calendar'});
}

function page(data){
 if(data.calendar)return calendarPage(data);
 const manual=data.new_manual||data.request?.origin==='manual'&&['manual_draft','manual_queued','manual_research_queued','manual_researching','manual_copy_queued','manual_ready','manual_needs_input','writing','uncertain'].includes(data.request.status);
 const content='<div id="notice" role="status" aria-live="polite"></div><div id="app"></div>';
 const scripts=`<div id="toast" role="status" aria-live="polite"></div><dialog id="confirm"><h2>Confira esta versão</h2><div id="confirmation"></div><p id="hold"></p><p id="confirm-status" role="alert" aria-live="assertive" tabindex="-1" hidden></p><div class="actions"><button id="back" class="secondary">Voltar à revisão</button><button id="publish">Confirmar publicação</button></div></dialog><script type="application/json" id="boot">${JSON.stringify(data).replace(/</g,'\\u003c')}</script><script src="${c.BASE}/progress.js" defer></script><script src="${c.BASE}/${manual?'manual-browser.js':['ready','copy_ready','image_pending','render_pending'].includes(data.request?.status)&&data.request?.copy?.sections?.length&&data.request?.preview?.assets?.length&&!data.request.preview?.status?.deliveries?.some(d=>d.status!=='cancelled')?'review-browser.js':'browser.js'}" defer></script>`;
 return shell({title:'Community News · Sua redação',content,scripts});
}

module.exports={page,calendarPage};
