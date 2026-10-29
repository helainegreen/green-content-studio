(() => {
  const panel=document.querySelector('[data-image-job]');if(!panel)return;
  let dirty=false,busy=panel.dataset.busy==='true';
  const post=panel.dataset.post;
  const forms=[...document.forms].filter(f=>new URL(f.action,location.href).pathname.startsWith('/posts/'+post+'/'));
  document.addEventListener('input',()=>{dirty=true;});document.addEventListener('change',()=>{dirty=true;});
  function controls(value,status){for(const form of forms){for(const b of form.querySelectorAll('button[type="submit"],input[type="submit"]')){
    if(value&&!b.disabled){b.dataset.imageDisabled='1';b.disabled=true;}
    if(!value&&b.dataset.imageDisabled){b.disabled=false;delete b.dataset.imageDisabled;}
  }}for(const l of document.querySelectorAll('[data-image-confirm]')){l.hidden=status!=='uncertain';const input=l.querySelector('input');input.required=status==='uncertain';}}
  controls(busy,panel.dataset.status);
  // Prevent a second click without disabling input fields before the browser serializes them.
  for(const form of forms.filter(f=>/\/(?:generate-ai|regenerate-ai)/.test(f.action))){let submitted=false;form.addEventListener('submit',e=>{if(submitted){e.preventDefault();return;}submitted=true;setTimeout(()=>{for(const b of form.querySelectorAll('button'))b.disabled=true;},0);});}
  async function poll(){try{const r=await fetch('/posts/'+post+'/image-generation/status',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error();const job=await r.json();
    panel.querySelector('[data-image-message]').textContent=(job.message||'Geração de imagens: pronta para receber pedidos.')+(job.total?' ('+job.completed+'/'+job.total+' salvas)':'');
    controls(job.busy,job.status);
    if(busy&&!job.busy){if(!dirty){location.replace('/posts/'+post+'/review');return;}
      panel.querySelector('[data-image-refresh]').hidden=false;
      panel.querySelector('[data-image-message]').textContent+=' Seu formulário contém alterações. Copie-as antes de atualizar a página.';
    }busy=job.busy;
  }catch{panel.querySelector('[data-image-message]').textContent='Não foi possível consultar o andamento. O pedido não será reenviado. Atualize a revisão para conferir.';}
  setTimeout(poll,busy?3000:15000);}
  setTimeout(poll,busy?1500:15000);
})();
