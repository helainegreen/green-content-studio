'use strict';
const assert=require('node:assert/strict');
const root=process.env.COMMUNITY_TEST_ROOT||require('node:path').join(__dirname,'../community-editorial');
const adapter=require(root+'/adapter.cjs');

const share='https://photos.app.goo.gl/DEMO_REFERENCE_NOT_REAL';
assert.equal(adapter.referenceUrlFromGuidance('Use este local '+share),share);
assert.equal(adapter.googlePhotosImageUrl('<script>["https://lh3.googleusercontent.com/pw/ABC_def-123",1080,1453]</script>'),'https://lh3.googleusercontent.com/pw/ABC_def-123');

const prompt=adapter.editorImagePrompt({
 image_plan:{cover:{guidance:'Ilustrar quatro ciclistas em uma pista fictícia. Referência: '+share}},
 copy:{
  cover_prompt:'Mostre a curva sem veículos ou pessoas visíveis.',
  material_details:[{quote:'Eram quatro ciclistas em uma cena fictícia. Dois estavam no meio da pista e outros dois ao lado.'}]
 }
});
assert.match(prompt,/DIREÇÃO PRIORITÁRIA DA EDITORA/);
assert.match(prompt,/quatro ciclistas/);
assert.match(prompt,/imagem de referência anexada/);
assert.doesNotMatch(prompt,/sem veículos ou pessoas visíveis/);
assert.match(prompt,/Não omita pessoas, armas ou veículos/);
console.log(JSON.stringify({ok:true,cases:['google-photos-reference','editor-guidance-wins','literal-scene-details']}));
