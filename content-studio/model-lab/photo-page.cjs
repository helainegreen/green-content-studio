'use strict';
const fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const form=read('photo-form.html'),renderer=read('photo-models.cjs'),client=read('photo-client.js');
const data=read('photo-data.json').replace(/</g,'\\u003c');
module.exports=({nonce,selected})=>form+`<script nonce="${nonce}">${renderer}\n${client}\nphotoClient(${data},${JSON.stringify(selected)});</script>`;
