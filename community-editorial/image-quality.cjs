'use strict';
const DEFAULT='medium',VALUES=new Set(['low','medium','high']);
function normalize(value){const quality=String(value||DEFAULT).trim();return VALUES.has(quality)?quality:DEFAULT;}
module.exports={DEFAULT,normalize};
