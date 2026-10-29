'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const files=[
 'bulk-docx.test.cjs','community-copy-completion.test.cjs',
 'community-manual-research.test.cjs','community-runner.test.cjs',
 'community-source-reader.test.cjs','editorial-tutorial-unit.cjs',
 'executor.test.cjs','image-jobs.test.cjs','image-quality-default.test.cjs',
 'image-reference-prompt.test.cjs','manual-detail-recovery.test.cjs',
 'manual-state-separation.test.cjs','meta-transport.test.cjs',
 'publisher-http.test.cjs','publishing.test.cjs','statistics.test.cjs',
 'studio-feed.test.cjs','vault.test.cjs'
];
const env={};
for(const name of ['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot'])if(process.env[name])env[name]=process.env[name];
env.COMMUNITY_TEST_ROOT=path.join(root,'community-editorial');
env.SERVER_SOURCE=path.join(root,'server.js');
let failed=0;
for(const file of files){
 console.log('\n--- '+file+' ---');
 const r=spawnSync(process.execPath,[path.join(root,'tests',file)],{cwd:root,env,stdio:'inherit',timeout:35000});
 if(r.error||r.status!==0){failed++;console.error(r.error?.message||'Test file failed');}
}
console.log(`\n${files.length-failed}/${files.length} test files passed.`);
process.exitCode=failed?1:0;

