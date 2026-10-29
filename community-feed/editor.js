'use strict';
(() => {
  const boot=JSON.parse(document.getElementById('fr2-data').textContent);
  const {context,base,csrf,demo}=boot;
  let record=boot.record, draft=structuredClone(record.draft), previewNetwork='instagram', pending=null, busy=false;
  const $=id=>document.getElementById(id), all=s=>[...document.querySelectorAll(s)];
  const assets=new Map(context.assets.map(a=>[a.id,a]));
  const descriptions=new Map(draft.assets.map(a=>[a.id,a.alt_text]));
  const node=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;};
  function status(message,error=false){const s=$('fr2-status');s.textContent=message;s.className=message?(error?'fr2-error':'fr2-notice'):'';}
  function dirty(){pending=null;$('fr2-save-state').textContent='Alterações não salvas';updatePreview();}
  function values(){
    draft.networks=all('#fr2-feed input[name=network]:checked').map(x=>x.value);
    draft.shared_caption=$('fr2-shared').checked;
    draft.captions={instagram:$('fr2-caption-ig').value,facebook:$('fr2-caption-fb').value};
    draft.without_caption={instagram:$('fr2-no-ig').checked,facebook:$('fr2-no-fb').checked};
    draft.facebook_link=$('fr2-link').value;
    draft.timing=all('#fr2-feed input[name=timing]:checked')[0]?.value||'now';
    draft.schedule_local=draft.timing==='scheduled'?$('fr2-schedule').value:'';
    draft.rights_confirmed=$('fr2-rights').checked;draft.ai_generated=$('fr2-ai').checked;draft.paid_partnership=$('fr2-partnership').checked;
    draft.assets=draft.assets.map(a=>({id:a.id,alt_text:descriptions.get(a.id)||''}));
    return draft;
  }
  function populate(){
    all('#fr2-feed input[name=network]').forEach(x=>x.checked=draft.networks.includes(x.value));
    $('fr2-shared').checked=draft.shared_caption;$('fr2-caption-ig').value=draft.captions.instagram;$('fr2-caption-fb').value=draft.captions.facebook;
    $('fr2-no-ig').checked=draft.without_caption.instagram;$('fr2-no-fb').checked=draft.without_caption.facebook;
    $('fr2-link').value=draft.facebook_link;
    all('#fr2-feed input[name=timing]').forEach(x=>x.checked=x.value===draft.timing);$('fr2-schedule').value=draft.schedule_local;
    $('fr2-rights').checked=draft.rights_confirmed;$('fr2-ai').checked=draft.ai_generated;$('fr2-partnership').checked=draft.paid_partnership;
    renderAssets();updatePreview();
  }
  function picture(a,alt){
    if(!a?.preview_url)return node('span',a?.label||'Escolha uma imagem');
    const img=node('img');img.src=a.preview_url;img.alt=alt||a.label;img.loading='lazy';return img;
  }
  function renderAssets(){
    const list=$('fr2-assets');list.replaceChildren();
    const order=[...draft.assets.map(a=>a.id),...context.assets.filter(a=>!draft.assets.some(x=>x.id===a.id)).map(a=>a.id)];
    for(const id of order){
      const a=assets.get(id);if(!a)continue;
      const index=draft.assets.findIndex(x=>x.id===id), row=node('div',undefined,'fr2-asset');
      const thumb=node('div',undefined,'fr2-asset-thumb');thumb.append(picture(a,descriptions.get(id)));row.append(thumb);
      const detail=node('div'),top=node('div',undefined,'fr2-asset-top'),label=node('label',undefined,'fr2-check'),box=node('input');box.type='checkbox';box.checked=index>=0;
      label.append(box,node('span',`${index>=0?(index+1)+'. ':''}${a.label}`));top.append(label);
      box.addEventListener('change',()=>{values();if(box.checked&&draft.assets.length>=10){box.checked=false;status('Desmarque uma imagem antes de selecionar outra. O limite é de 10 imagens.',true);return;}if(box.checked)draft.assets.push({id,alt_text:descriptions.get(id)||''});else draft.assets=draft.assets.filter(x=>x.id!==id);renderAssets();dirty();});
      const move=node('div',undefined,'fr2-asset-move');
      for(const [title,delta] of [['Subir',-1],['Descer',1]]){const b=node('button',title);b.type='button';b.disabled=index<0||index+delta<0||index+delta>=draft.assets.length;b.setAttribute('aria-label',`${title} ${a.label}`);b.addEventListener('click',()=>{values();[draft.assets[index],draft.assets[index+delta]]=[draft.assets[index+delta],draft.assets[index]];renderAssets();dirty();});move.append(b);}
      top.append(move);detail.append(top);
      const altLabel=node('label','Texto alternativo'),alt=node('input');alt.type='text';alt.value=descriptions.get(id)||'';alt.placeholder='Descreva a imagem para acessibilidade';alt.maxLength=1000;altLabel.append(alt);detail.append(altLabel);
      alt.addEventListener('input',()=>{descriptions.set(id,alt.value);dirty();});row.append(detail);list.append(row);
    }
    if(!context.assets.length)list.append(node('p','Gere as artes da notícia para preparar a publicação.','fr2-muted'));
  }
  function updatePreview(){
    values();
    $('fr2-fb-caption').hidden=draft.shared_caption;$('fr2-caption-label').textContent=draft.shared_caption?'Legenda':'Legenda do Instagram';
    $('fr2-schedule-wrap').hidden=draft.timing!=='scheduled';$('fr2-selected-count').textContent=draft.assets.length+' selecionada(s)';
    for(const n of ['ig','fb'])$('fr2-count-'+n).textContent=[...$('fr2-caption-'+n).value].length+' / 2.200';
    all('#fr2-feed [data-preview]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preview===previewNetwork)));
    const first=draft.assets[0],asset=first&&assets.get(first.id);$('fr2-preview-art').replaceChildren(picture(asset,first?.alt_text));
    $('fr2-preview-position').textContent=draft.assets.length?`1 de ${draft.assets.length} · ${previewNetwork==='instagram'?'Instagram':'Facebook'}`:'Nenhuma imagem selecionada';
    const key=draft.shared_caption?'instagram':previewNetwork;
    let caption=draft.without_caption[key]?'':draft.captions[key];if(previewNetwork==='facebook'&&draft.facebook_link)caption+=(caption?'\n\n':'')+draft.facebook_link;
    $('fr2-preview-caption').textContent=caption||'A legenda aparecerá aqui.';
  }
  async function api(action,data){
    const r=await fetch(base+'/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-FR2-CSRF':csrf},body:JSON.stringify(data)});
    const result=await r.json();if(!r.ok)throw new Error(result.message||'Não foi possível concluir. Tente novamente.');return result;
  }
  async function save(){
    const result=await api('save',{draft:values(),expected_version:record.version});record=result.record;draft=structuredClone(record.draft);$('fr2-save-state').textContent=demo?'Rascunho salvo nesta prévia':'Rascunho salvo';return record;
  }
  async function locked(fn){if(busy)return;busy=true;all('#fr2-feed button, #fr2-feed input, #fr2-feed textarea').forEach(b=>b.dataset.previousDisabled=String(b.disabled));all('#fr2-feed button, #fr2-feed input, #fr2-feed textarea').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message,true);}finally{all('#fr2-feed button, #fr2-feed input, #fr2-feed textarea').forEach(b=>{b.disabled=b.dataset.previousDisabled==='true';delete b.dataset.previousDisabled;});busy=false;if(pending)$('fr2-confirm').disabled=!pending.can_confirm;}}
  $('fr2-save').addEventListener('click',()=>locked(async()=>{await save();status(demo?'Rascunho salvo localmente.':'Rascunho salvo.');}));
  $('fr2-form').addEventListener('input',event=>{if(!event.target.closest('#fr2-assets'))dirty();});
  $('fr2-form').addEventListener('change',()=>dirty());
  all('#fr2-feed [data-preview]').forEach(b=>b.addEventListener('click',()=>{previewNetwork=b.dataset.preview;updatePreview();}));
  $('fr2-form').addEventListener('submit',event=>{event.preventDefault();locked(async()=>{
    await save();pending=await api('review',{expected_version:record.version});
    const summary=$('fr2-confirm-summary');summary.replaceChildren(node('p',draft.timing==='now'?'Publicar agora, após sua confirmação.':`Agendar para ${draft.schedule_local.replace('T',' às ')} · Brasília.`));
    for(const p of pending.previews){const section=node('section');section.append(node('h3',p.network==='instagram'?'Instagram · @community':'Facebook · Community News'));const imgs=node('div',undefined,'fr2-confirm-images');p.assets.forEach(a=>imgs.append(picture(assets.get(a.id),a.alt_text)));section.append(imgs,node('p',p.caption||'Sem legenda.','fr2-confirm-caption'));summary.append(section);}
    $('fr2-confirm-hold').textContent=pending.message;$('fr2-confirm').textContent=demo?(draft.timing==='now'?'Simular publicação agora':'Simular agendamento'):(draft.timing==='now'?'Confirmar publicação':'Confirmar agendamento');
    $('fr2-dialog').showModal();
  });});
  $('fr2-back').addEventListener('click',()=>{$('fr2-dialog').close();pending=null;});
  $('fr2-confirm').addEventListener('click',()=>locked(async()=>{if(!pending)return;const result=await api('confirm',{token:pending.token,expected_version:record.version});$('fr2-dialog').close();status(result.message);pending=null;}));
  window.addEventListener('beforeunload',event=>{if($('fr2-save-state').textContent==='Alterações não salvas'){event.preventDefault();event.returnValue='';}});
  populate();
})();
