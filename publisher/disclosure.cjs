'use strict';
const {captionFor}=require('../studio-module/core.cjs');
const CREDIT='Ilustração gerada por IA';
function supported(snapshot){
 if(snapshot.paid_partnership)return false;
 if(!snapshot.ai_generated)return true;
 // Only static JPEG publications with an explicit disclosure in every caption.
 return Array.isArray(snapshot.assets)&&snapshot.assets.length>0&&snapshot.assets.every(a=>a.mime==='image/jpeg')&&
  Array.isArray(snapshot.networks)&&snapshot.networks.length>0&&snapshot.networks.every(n=>['instagram','facebook'].includes(n)&&captionFor(snapshot,n).split('\n').some(line=>line.trim()===CREDIT));
}
module.exports={supported,CREDIT};
