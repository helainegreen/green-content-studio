'use strict';
const c=require('./core.cjs');
function validateOrder(input,context){
 c.check(input?.generation_id===context.generation_id,'slide_generation_changed','As artes mudaram. Abra a versão atual antes de ordenar.',409);
 const ids=input.asset_ids,known=new Set(context.assets.map(a=>a.id));
 c.check(Array.isArray(ids)&&ids.length===context.assets.length&&ids.length>0&&ids.length<=10&&new Set(ids).size===ids.length&&ids.every(id=>known.has(id)),'slide_order_invalid','Mantenha todos os slides, sem repetir ou incluir imagens de outra versão.');
 return {generation_id:context.generation_id,asset_ids:[...ids]};
}
function normalize(input,context){
 c.check(context.generation_status==='completed'&&!context.generation_active,'render_busy','Aguarde a montagem terminar para ordenar os slides.',409);
 return validateOrder(input,context);
}
function assets(context,order){
 if(!order||order.generation_id!==context.generation_id)return [...context.assets];
 const valid=validateOrder(order,context),known=new Map(context.assets.map(a=>[a.id,a]));
 return valid.asset_ids.map(id=>known.get(id));
}
function verifyDraft(draft,context,order){
 const expected=assets(context,order).map(a=>a.id);
 c.check(JSON.stringify(draft.assets.map(a=>a.id))===JSON.stringify(expected),'slide_order_changed','A ordem dos slides mudou. Revise novamente antes de publicar.',409);
}
module.exports={normalize,assets,verifyDraft};
