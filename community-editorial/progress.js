'use strict';
(()=>{
 const pending=new Set(['manual_queued','manual_research_queued','manual_researching','manual_copy_queued','queued','fetching','writing','copy_ready','image_pending','render_pending']);
 const labels={manual_queued:'Lendo seu material…',manual_research_queued:'Iniciando a pesquisa…',manual_researching:'Pesquisando fontes na internet…',manual_copy_queued:'Preparando os textos…',queued:'Pedido recebido.',fetching:'Conferindo as fontes…',writing:'Preparando os textos…',copy_ready:'Atualizando a prévia…',image_pending:'Gerando a imagem…',render_pending:'Montando os slides…'};
 window.FR2Progress={watch(job,{demo=false}={}){
  if(demo||!job?.id||!pending.has(job.status))return;
  const panel=document.createElement('section');panel.className='notice preparation-progress';panel.setAttribute('aria-label','Andamento da preparação');
  const text=document.createElement('p');text.setAttribute('role','status');text.setAttribute('aria-live','polite');text.textContent=labels[job.status];
  const help=document.createElement('p');help.className='subtle';help.textContent='A preparação continua no servidor. Esta página acompanha o andamento sem recarregar.';
  const link=document.createElement('a');link.className='button';link.href='/community/editorial/'+job.id;link.hidden=true;
  panel.append(text,help,link);document.getElementById('app').prepend(panel);
  let stopped=false;
  async function poll(){
   if(stopped)return;
   try{
    if(document.hidden)return;
    const r=await fetch('/community/editorial/'+job.id+'/progress',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('progress');const next=await r.json();if(next.id!==job.id)throw Error('request');
    if(pending.has(next.status)){text.textContent=labels[next.status];help.textContent='A preparação continua no servidor. Esta página acompanha o andamento sem recarregar.';}
    else{stopped=true;const ready=['ready','manual_ready'].includes(next.status);text.textContent=ready?'Sua versão está pronta para revisar.':next.status==='awaiting_images'?'O texto está pronto. Escolha as imagens para continuar.':'A preparação precisa da sua atenção.';help.textContent='Use o botão abaixo para abrir a versão atual.';link.textContent=ready?'Ver versão pronta':next.status==='awaiting_images'?'Escolher imagens':'Ver detalhes';link.hidden=false;}
   }catch{help.textContent='Não foi possível consultar o andamento agora. Tentaremos novamente; seu pedido continua salvo.';}
   finally{if(!stopped)setTimeout(poll,15000);}
  }
  setTimeout(poll,15000);return ()=>{stopped=true;};
 }};
})();
