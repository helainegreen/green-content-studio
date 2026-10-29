'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const local=path.join(__dirname,'../content-studio/model-lab');
const root=fs.existsSync(local)?local:require('node:path').join(__dirname,'../content-studio/model-lab');
const layouts=require(path.join(root,'layouts.cjs'));
const designs=require(path.join(root,'designs.cjs'));

const model=layouts.NEW.editorialtutorial;
assert.equal(model.name,'Editorial Tutorial');
assert.equal(model.image,true);
assert.deepEqual(layouts.issues('editorialtutorial',[
  {number:1,title:'Uma explicação que merece ser lida',body:'Contexto, destaque e evidência visual.'},
]),[]);
const brand={name:'Marca de exemplo',business:'Teste',audience:'Teste',handle:'@suamarca',layout:'editorialtutorial',font:'sans',primary:'#13533f',background:'#ffffff',accent:'#d7fa69'};
const cover=designs.slideHtml(brand,{number:1,title:'Uma explicação que merece ser lida',body:'Contexto, destaque e evidência visual.'},3,'');
for(const expected of ['data-layout="editorialtutorial"','class="identity"','TUTORIAL','@suamarca','01 / 03'])assert.ok(cover.includes(expected),expected);
const internal=designs.slideHtml(brand,{number:2,title:'A ideia principal merece destaque.',body:'Comece pelo contexto e use uma imagem como evidência.'},3,'');
for(const expected of ['class="explain-copy"','class="explain-media"','A ideia principal merece destaque.'])assert.ok(internal.includes(expected),expected);
const steps=designs.slideHtml(brand,{number:3,title:'Explique em três movimentos',body:'',composition:'steps',items:[
  {title:'Contextualize',body:'Mostre a situação.'},{title:'Demonstre',body:'Use um exemplo.'},{title:'Conclua',body:'Indique o próximo passo.'},
]},3,'');
for(const expected of ['class="steps"','Contextualize','Demonstre','Conclua'])assert.ok(steps.includes(expected),expected);
console.log(JSON.stringify({ok:true,model:'editorialtutorial',display_name:model.name,compositions:['cover','text','steps']}));
