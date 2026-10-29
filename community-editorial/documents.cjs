'use strict';
const path=require('node:path'),c=require('./core.cjs');
const types={txt:'text/plain',md:'text/markdown',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
function inspect(bytes,input){
 const ext=path.extname(input.name||'').slice(1).toLowerCase(),mime=types[ext];
 c.check(mime,'document_type','Envie documentos TXT, Markdown (.md), PDF ou Word (.docx).');
 c.check(input.use==='reference','document_use','Documentos são referências para leitura. Envie as fotos separadamente para usar na arte.');
 c.check(bytes.length>0&&bytes.length<=8000000,'document_size','Use documentos de até 8 MB.');
 c.check(!input.mime||input.mime===mime||input.mime==='application/octet-stream'||ext==='md'&&input.mime==='text/plain','document_type','O formato do arquivo não corresponde ao documento.');
 if(ext==='txt'||ext==='md'){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new c.Fault('document_encoding','Salve o texto em UTF-8 e envie novamente.');}
  c.check(text.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text),'document_type','O arquivo de texto está vazio ou contém dados que não são texto.');
 }else if(ext==='pdf'){
  c.check(bytes.subarray(0,5).toString('ascii')==='%PDF-'&&bytes.subarray(-32768).includes(Buffer.from('%%EOF')),'document_type','O arquivo não é um PDF válido.');
 }else{
  c.check(bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])),'document_type','O arquivo não é um Word DOCX válido.');
  try{
   const zip=new(require('adm-zip'))(bytes),entries=zip.getEntries();
   c.check(entries.length<=2500&&entries.reduce((n,e)=>n+e.header.size,0)<=50000000,'document_size','O documento é muito grande depois de aberto. Divida-o em arquivos menores.');
   c.check(zip.getEntry('[Content_Types].xml')&&zip.getEntry('word/document.xml')&&!entries.some(e=>/vbaProject\.bin$/i.test(e.entryName)||e.header.flags&1),'document_type','Envie um DOCX sem senha e sem macros.');
  }catch(e){if(e instanceof c.Fault)throw e;throw new c.Fault('document_type','Não foi possível abrir o DOCX. Salve novamente no Word e envie.');}
 }
 return {mime,extension:ext,type:'document'};
}
function disposition(name){return "attachment; filename*=UTF-8''"+encodeURIComponent(name).replace(/['()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());}
module.exports={types,inspect,disposition};
