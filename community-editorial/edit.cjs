'use strict';
const c=require('./core.cjs'),carousel=require('./carousel.cjs');
function edit(body,input){
 const b=structuredClone(body),v=c.reviewInput(input),before=carousel.sourceText(b);
 b.copy={...b.copy,headline:v.headline,subheadline:v.subheadline,caption:v.caption};
 if(Object.hasOwn(input,'cover_local')||Object.hasOwn(input,'cover_date')){
  const current=carousel.coverFields(b);
  b.cover=carousel.validateCover({local:Object.hasOwn(input,'cover_local')?input.cover_local:current.local,date:Object.hasOwn(input,'cover_date')?input.cover_date:current.date});
 }
 if(Object.hasOwn(input,'sections')||Object.hasOwn(input,'cta'))Object.assign(b.copy,carousel.validate(input.sections,input.cta));
 b.schedule_local=v.schedule_local;
 // Captions and timing are bound by the approval token, but are not rendered.
 if(carousel.sourceText(b)===before)return {body:b,status:'ready'};
 delete b.image_job;delete b.render_job;delete b.ready_digest;
 return {body:b,status:'copy_ready'};
}
module.exports={edit};
