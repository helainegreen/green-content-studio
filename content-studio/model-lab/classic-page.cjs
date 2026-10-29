'use strict';
const fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
const form=read('classic-form.html'),renderer=read('classic-models.cjs'),client=read('classic-client.js'),data=read('classic-data.json').replace(/</g,'\\u003c');
module.exports=({nonce})=>form+`<script nonce="${nonce}">${renderer}\n${client}\nclassicClient(${data});</script>`;
