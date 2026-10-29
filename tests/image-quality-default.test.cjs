'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const root=process.env.COMMUNITY_TEST_ROOT||require('node:path').join(__dirname,'../community-editorial');
const quality=require(root+'/image-quality.cjs');

assert.equal(quality.DEFAULT,'medium');
assert.equal(quality.normalize(), 'medium');
assert.equal(quality.normalize('medium'),'medium');
assert.equal(quality.normalize('low'),'low');
assert.equal(quality.normalize('high'),'high');
assert.equal(quality.normalize('invalid'),'medium');

const adapter=fs.readFileSync(root+'/adapter.cjs','utf8');
const server=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
assert.match(adapter,/ai_quality:imageQuality\.DEFAULT/);
assert.match(server,/communityImageQuality\.normalize\(form\.ai_quality\)/);
assert.match(server,/selectedQuality === 'medium'/);
console.log(JSON.stringify({ok:true,default:quality.DEFAULT,choices:['low','medium','high']}));
