'use strict';
const c=require('./core.cjs');
function compose(j){
 const cover=j.image_choice?.kind==='source'||j.image_choice?.kind==='upload'?j.image_choice.credit:'Ilustração gerada por IA';
 const credits=[...new Set([cover,...(j.internal_choices||[]).map(x=>x.credit)].filter(Boolean))];
 // The article URL is retained in the editorial history, never appended here.
 return [j.copy.caption,credits.join('\n')].filter(Boolean).join('\n\n');
}
function verify(j,draft){
 const expected=compose(j);
 c.check(draft.captions.instagram===expected&&draft.captions.facebook===expected,'caption_changed','A legenda da confirmação mudou. Atualize a página e revise novamente.',409);
}
module.exports={compose,verify};
