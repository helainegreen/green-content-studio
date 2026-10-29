'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.basename(__dirname)==='tests'?path.dirname(__dirname):__dirname;
const layouts=require(path.join(root,'content-studio/model-lab/layouts.cjs'));
const core=require(path.join(root,'content-studio/model-lab/core.cjs'));
const generationCore=require(path.join(root,'content-studio/core.cjs'));
const renderer=require(path.join(root,'content-studio/model-lab/renderer.cjs'));

assert.equal(layouts.LAYOUTS.rascunho,'Anotação');
assert.equal(layouts.NEW.rascunho.image,false);
assert.equal(layouts.NEW.rascunho.palette.primary,'#1522ad');
assert.equal(layouts.NEW.rascunho.palette.background,'#dec39c');
assert.equal(generationCore.LAYOUTS.rascunho,undefined,'o modelo não pode ser liberado no gerador nesta etapa');
assert.deepEqual(layouts.issues('rascunho',[{number:1,title:'Título',body:'Texto'}]),[]);
const brand=core.profile({
  name:'Marca de exemplo',business:'Teste',audience:'Teste',handle:'@suamarca',
  layout:'rascunho',font:'sans',primary:'#1522ad',background:'#dec39c',accent:'#1522ad',
});
const html=renderer.slideHtml(brand,{number:1,title:'Uma ideia merece ser anotada',body:'Comece pelo essencial.'},3,'');
assert.match(html,/data-layout="rascunho"/);
assert.match(html,/GCS Kalam/);
assert.match(html,/GCS Patrick Hand/);
assert.match(html,/rough-char/);
assert.match(html,/Comece pelo essencial/);
assert.match(html,/@suamarca/);
assert.doesNotMatch(html,/Marca de exemplo/);
assert.doesNotMatch(html,/01 \/ 03/);
assert.doesNotMatch(html,/<img src=""/);
for(const number of [1,2,3]){
  const file=path.join(root,'content-studio/model-lab/previews',`rascunho-${number}.jpg`);
  assert.ok(fs.statSync(file).size>10000,file+' deve conter uma prévia renderizada');
}
process.stdout.write(JSON.stringify({ok:true,layout:'rascunho',generation_enabled:false})+'\n');
