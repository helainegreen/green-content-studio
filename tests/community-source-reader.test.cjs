'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.COMMUNITY_TEST_ROOT||path.resolve(__dirname,'../candidate');
const source=require(path.join(root,'source.cjs'));

const url='https://igua.com.br/rio-de-janeiro/fique-por-dentro/intervencao-programada-pode-afetar-abastecimento-de-agua-na-barra-olimpica-e-em-jacarepagua';
const html=`<!doctype html><html><head>
 <meta property="og:title" content="Intervenção programada | Iguá Rio | Iguá Saneamento">
 <meta property="og:image" content="https://igua.com.br/images/opengraph.png">
</head><body><header>Menu do site</header><main class="news">
 <section><h2>Fique por dentro</h2></section>
 <div class="container"><div class="py-3 news-spotlight">
  <picture><img src="/media/intervencao.jpg" alt="Intervenção programada"></picture>
  <h3>Intervenção programada pode afetar abastecimento de água na Barra Olímpica e em Jacarepaguá</h3>
  <p><span>15 de outubro de 2026</span></p>
  <div class="mb-1h fs-16 lh-14">
   A Iguá Rio informa que realizará, na próxima quarta-feira (21/10), uma intervenção programada na rede de abastecimento de água da Barra Olímpica e de Jacarepaguá, na Rua Pedro Correa, 112. A intervenção tem como objetivo aprimorar a distribuição de água na região.<br><br>
   O serviço terá início às 10h, com previsão de duração de seis horas. Durante a execução da atividade, o fornecimento de água poderá ser impactado nos bairros. A normalização do abastecimento ocorrerá de forma gradativa, em até 48 horas, após a conclusão do serviço.<br><br>
   A concessionária disponibiliza caminhões-pipa para atendimentos emergenciais e orienta o uso responsável da água.
  </div><a href="/rio-de-janeiro/fique-por-dentro">voltar</a>
 </div></div>
</main><footer>Rodapé</footer></body></html>`;

const result=source.extract(html,url);
assert.equal(result.title,'Intervenção programada pode afetar abastecimento de água na Barra Olímpica e em Jacarepaguá');
assert.match(result.text,/serviço terá início às 10h/);
assert.match(result.text,/normalização do abastecimento/);
assert.equal(result.published_at,'2026-10-15T15:00:00.000Z');
assert.equal(result.images[0].url,'https://igua.com.br/media/intervencao.jpg');
assert.equal(result.images[0].source_url,url);
assert.equal(source.public4('8.8.8.8'),true);
assert.equal(source.public4('127.0.0.1'),false);
const manual=require(path.join(root,'manual.cjs'));
const material=manual.completeMaterialText(
 {manual:{messages:[{role:'user',text:'Crie uma matéria de alerta com os dados do link.'}],attachments:[]}},
 {transcripts:[{attachment_id:'link1',attribution:'Iguá Rio',text:result.text,unreadable:false}]},
 [{url,text:result.text}]
);
assert.match(material.text,/FONTE DO LINK/);
assert.match(material.text,/serviço terá início às 10h/);
assert.deepEqual(material.transcripts,[]);
console.log(JSON.stringify({ok:true,title:result.title,text_length:result.text.length,images:result.images.length,link_only_material:true}));
