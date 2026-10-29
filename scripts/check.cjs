'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');let count=0,failed=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.git','data','uploads','rendered'].includes(entry.name))continue;
 const p=path.join(dir,entry.name);
 if(entry.isDirectory())walk(p);
 else if(entry.isFile()&&/\.(?:js|cjs)$/.test(p)){
  count++;const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});
  if(r.status!==0){failed++;console.error(path.relative(root,p),r.stderr);}
 }
}}
walk(root);console.log(`${count} JavaScript files checked; ${failed} syntax errors.`);process.exitCode=failed?1:0;
