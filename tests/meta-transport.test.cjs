'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMeta,MetaError}=require('../publisher/meta.cjs');
const origin='https://studio.example';
const image=origin+'/community-publicacoes/media/'+'a'.repeat(64)+'.jpg?expires=1790000000&sig='+'b'.repeat(64);
const token='test-token-never-log-this-value';
function mock(network='instagram',replies=[],writesEnabled=true){
  const calls=[];
  const adapter=createMeta({network,accountId:network==='instagram'?'100000000000004':'100000000000006',tokenProvider:async()=>token,mediaOrigin:origin,writesEnabled,
    fetchImpl:async(url,init)=>{calls.push({url,init});const r=replies.shift();if(r instanceof Error)throw r;return new Response(typeof r?.body==='string'?r.body:JSON.stringify(r?.body??{id:'123'}),{status:r?.status??200});}});
  return {adapter,calls};
}
test('produção começa sem escrita e não faz sequer uma chamada ao tentar publicar',async()=>{
  const {adapter,calls}=mock('instagram',[],false);await assert.rejects(adapter.publishContainer('1'),/desativado/);assert.equal(calls.length,0);
});
test('identidade divergente bloqueia a conexão; conta correta passa',async()=>{
  let m=mock('instagram',[{body:{user_id:'123',username:'outra',account_type:'BUSINESS'}}]);await assert.rejects(m.adapter.identity(),/outra conta/);
  m=mock('instagram',[{body:{user_id:'100000000000004',username:'community',account_type:'BUSINESS'}}]);assert.equal((await m.adapter.identity()).name,'community');
  m=mock('facebook',[{body:{id:'100000000000006',name:'Community News',can_post:false}}]);await assert.rejects(m.adapter.identity(),/não permite/);
  m=mock('facebook',[{body:{id:'100000000000006',name:'Community News',can_post:true}}]);assert.equal((await m.adapter.identity()).name,'Community News');
});
test('imagens externas e caminhos fora do módulo são rejeitados antes da rede',async()=>{
  const {adapter,calls}=mock();
  for(const url of ['http://127.0.0.1/image.jpg','https://drive.google.com/secret',origin+'/files/private.jpg'])assert.throws(()=>adapter.createImage({url}),/imagem aprovada/);
  assert.equal(calls.length,0);
});
test('Instagram recebe legenda, texto alternativo e token apenas no cabeçalho',async()=>{
  const {adapter,calls}=mock();assert.equal((await adapter.createImage({url:image,caption:'Legenda ç & #bairro',altText:'Vista da praça'})).id,'123');
  assert.equal(calls[0].url,'https://graph.instagram.com/v26.0/100000000000004/media');
  assert.equal(calls[0].init.body.get('caption'),'Legenda ç & #bairro');assert.equal(calls[0].init.body.get('alt_text'),'Vista da praça');
  assert(!calls[0].url.includes(token));assert(!calls[0].init.body.toString().includes(token));assert.equal(calls[0].init.headers.Authorization,'Bearer '+token);assert.equal(calls[0].init.redirect,'error');
});
test('carrossel preserva ordem e legenda somente no pai',async()=>{
  const {adapter,calls}=mock();await adapter.createImage({url:image,carouselItem:true,caption:'não aplicar no filho'});await adapter.createCarousel({children:['3','1','2'],caption:'Legenda final'});
  assert.equal(calls[0].init.body.get('is_carousel_item'),'true');assert.equal(calls[0].init.body.get('caption'),null);
  assert.equal(calls[1].init.body.get('children'),'3,1,2');assert.equal(calls[1].init.body.get('caption'),'Legenda final');
  assert.throws(()=>adapter.createCarousel({children:['1','1']}),/inválido/);
});
test('Facebook prepara fotos sem publicar e envia legenda com fotos na ordem aprovada',async()=>{
  const {adapter,calls}=mock('facebook');await adapter.uploadPhoto({url:image,altText:'Descrição'});await adapter.publishPhotos({photos:['12','11'],caption:'Legenda\n\nhttps://news.example.invalid/noticia'});
  assert.equal(calls[0].init.body.get('published'),'false');assert.equal(calls[0].init.body.get('alt_text_custom'),'Descrição');
  assert.equal(calls[1].init.body.get('published'),'true');assert.deepEqual(JSON.parse(calls[1].init.body.get('attached_media[0]')),{media_fbid:'12'});
  assert.equal(calls[1].init.body.get('message'),'Legenda\n\nhttps://news.example.invalid/noticia');
});
test('timeout, resposta incompleta e erro 5xx deixam envio incerto sem repetição',async()=>{
  for(const reply of [new Error('fetch failed '+token),{body:'<!doctype html>',status:502},{body:{error:{code:1,message:token}},status:500},{body:{success:true}}]){
    const {adapter,calls}=mock('instagram',[reply]);
    await assert.rejects(adapter.publishContainer('123'),e=>e instanceof MetaError&&e.kind==='uncertain'&&!JSON.stringify(e).includes(token)&&!e.message.includes(token));
    assert.equal(calls.length,1);
  }
});
test('rejeição Graph completa é distinguida de resultado incerto sem vazar conteúdo',async()=>{
  const {adapter}=mock('instagram',[{status:400,body:{error:{code:190,error_subcode:463,message:token}}}]);
  await assert.rejects(adapter.publishContainer('1'),e=>e.kind==='rejected'&&e.meta_code===190&&!JSON.stringify(e).includes(token));
});
test('consulta usa limite retornado pela conta e reconhece estado do container',async()=>{
  const {adapter}=mock('instagram',[{body:{data:[{quota_usage:9,config:{quota_total:100}}]}},{body:{status_code:'FINISHED'}}]);
  assert.deepEqual(await adapter.quota(),{used:9,total:100});assert.equal((await adapter.containerStatus('1')).status,'FINISHED');
});
test('link final precisa pertencer à rede e publicação Facebook precisa estar publicada',async()=>{
  let m=mock('facebook',[{body:{id:'100000000000006_1',permalink_url:'https://www.facebook.com/100000000000006_1',is_published:true}}]);
  assert.equal((await m.adapter.publishedResult('100000000000006_1')).id,'100000000000006_1');
  m=mock('instagram',[{body:{id:'1',permalink:'https://evil.example/1'}}]);await assert.rejects(m.adapter.publishedResult('1'),/link/);
});
