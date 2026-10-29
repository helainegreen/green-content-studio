'use strict';
const fs=require('node:fs');
const path=require('node:path');
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function editor({context,record,csrf,base,demo=false}) {
  const payload=JSON.stringify({context,record,csrf,base,demo}).replace(/</g,'\\u003c');
  return `<style>${fs.readFileSync(path.join(__dirname,'editor.css'),'utf8')}</style>
  <section id="fr2-feed">
    <div class="fr2-heading"><div><a href="/posts/${e(context.post_id)}/review">Community News / Revisão da notícia</a><h1>Publicar no feed</h1><p>${e(context.title)}</p></div><span class="fr2-badge">${demo?'Prévia local':'Rascunho'}</span></div>
    ${demo?'<p class="fr2-notice">Prévia com conteúdo fictício. Os rascunhos são locais e nenhuma ação publica nas redes.</p>':''}
    <div id="fr2-status" role="status" aria-live="polite"></div>
    <p id="fr2-connections" class="fr2-muted"></p>
    <section class="fr2-card"><h2>Envios desta notícia</h2><p class="fr2-muted">Cada rede tem seu próprio resultado. Alterações no rascunho não mudam uma publicação já confirmada.</p><div id="fr2-deliveries" aria-live="polite">Consultando envios…</div></section>
    <form id="fr2-form">
    <div class="fr2-workspace"><div class="fr2-main">
      <section class="fr2-card"><h2>Destino</h2><div class="fr2-networks"><label><input type="checkbox" name="network" value="instagram"> Instagram · @community</label><label><input type="checkbox" name="network" value="facebook"> Facebook · Community News</label></div></section>
      <section class="fr2-card"><h2>Legenda da publicação</h2><p class="fr2-muted">Escreva o texto que acompanhará as imagens.</p>
        <label class="fr2-check"><input id="fr2-shared" type="checkbox"> Usar a mesma legenda nas duas redes</label>
        <label id="fr2-caption-label" for="fr2-caption-ig">Legenda</label><textarea id="fr2-caption-ig" rows="6" placeholder="Escreva a legenda, incluindo hashtags e @menções, se desejar."></textarea>
        <div class="fr2-count" id="fr2-count-ig"></div><label class="fr2-check"><input id="fr2-no-ig" type="checkbox"> Publicar sem legenda</label>
        <div id="fr2-fb-caption"><label for="fr2-caption-fb">Legenda do Facebook</label><textarea id="fr2-caption-fb" rows="5"></textarea><div class="fr2-count" id="fr2-count-fb"></div><label class="fr2-check"><input id="fr2-no-fb" type="checkbox"> Publicar sem legenda no Facebook</label></div>
        <label for="fr2-link">Link da matéria no Facebook <span class="fr2-muted">· opcional</span></label><input id="fr2-link" type="url" placeholder="https://news.example.invalid/…">
      </section>
      <section class="fr2-card"><div class="fr2-section-title"><h2>Imagens e ordem</h2><span id="fr2-selected-count"></span></div><p class="fr2-muted">Selecione até 10 imagens. A primeira será a capa do carrossel no Instagram.</p>${context.assets.length>10?`<p class="fr2-notice">Esta geração tem ${context.assets.length} artes. Escolha no máximo 10 para esta publicação.</p>`:''}<div id="fr2-assets"></div></section>
      <section class="fr2-card"><h2>Quando publicar</h2><div class="fr2-time"><label><input type="radio" name="timing" value="now"> Publicar agora</label><label><input type="radio" name="timing" value="scheduled"> Agendar</label></div><div id="fr2-schedule-wrap"><label for="fr2-schedule">Data e hora · Brasília</label><input id="fr2-schedule" type="datetime-local"></div></section>
      <section class="fr2-card"><h2>Confirmações</h2><label class="fr2-check"><input id="fr2-rights" type="checkbox"> Tenho autorização para publicar as imagens.</label><label class="fr2-check"><input id="fr2-ai" type="checkbox"> As imagens contêm conteúdo gerado por IA.</label><label class="fr2-check"><input id="fr2-partnership" type="checkbox"> A publicação tem parceria comercial.</label></section>
    </div><aside class="fr2-preview fr2-card"><h2>Prévia da publicação</h2><div class="fr2-tabs"><button type="button" data-preview="instagram">Instagram</button><button type="button" data-preview="facebook">Facebook</button></div><div class="fr2-preview-brand">Community News</div><div id="fr2-preview-art"></div><p id="fr2-preview-position" class="fr2-muted"></p><div id="fr2-preview-caption"></div><p class="fr2-muted">A apresentação final pode variar entre as redes.</p></aside></div>
    <footer class="fr2-actions"><span id="fr2-save-state">Rascunho</span><button type="button" id="fr2-save">Salvar rascunho</button><button class="fr2-primary" type="submit" id="fr2-review">Revisar publicação</button></footer>
    </form>
    <dialog id="fr2-dialog"><h2>Conferir publicação</h2><div id="fr2-confirm-summary"></div><div id="fr2-confirm-hold" class="fr2-notice"></div><div class="fr2-dialog-actions"><button id="fr2-back" type="button">Voltar e editar</button><button id="fr2-confirm" class="fr2-primary" type="button">Confirmar</button></div></dialog>
  </section><script type="application/json" id="fr2-data">${payload}</script><script src="${e(base)}/editor.js" defer></script>`;
}
module.exports={editor};
