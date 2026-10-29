'use strict';
const crypto=require('node:crypto');
const {Pool}=require('pg');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,application_name:'editorial-tutorial-smoke'});
const base='http://127.0.0.1:3000';
const secret=process.env.SESSION_SECRET;
if(!secret)throw new Error('SESSION_SECRET missing');
const sign=value=>crypto.createHmac('sha256',secret).update(value).digest('base64url');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const check=(value,message)=>{if(!value)throw new Error(message);};

async function request(cookie,pathname,options={},status=200){
  const response=await fetch(base+pathname,{...options,headers:{cookie,...options.headers},redirect:'manual'});
  const body=Buffer.from(await response.arrayBuffer());
  check(response.status===status,`${pathname}: expected ${status}, got ${response.status}`);
  return {response,body};
}

(async()=>{
  const user=(await pool.query(`SELECT u.id FROM users u JOIN social_master_users m ON m.user_id=u.id ORDER BY u.created_at LIMIT 1`)).rows[0];
  check(user,'master user missing');
  const token=crypto.randomBytes(32).toString('base64url'),tokenHash=hash(token);
  await pool.query(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')`,[tokenHash,user.id]);
  const cookie=`gcs_session=${encodeURIComponent(`${token}.${sign(token)}`)}`;
  try{
    const page=await request(cookie,'/admin/content-studio/models?layout=editorialtutorial');
    const html=page.body.toString('utf8');
    for(const expected of ['Editorial Tutorial','Cabeçalho de perfil, narrativa didática e exemplos visuais.','/assets/editorialtutorial/1.jpg','24 modelos','editorialtutorial'])check(html.includes(expected),'model page missing '+expected);
    for(const number of [1,2,3]){
      const asset=await request(cookie,`/admin/content-studio/models/assets/editorialtutorial/${number}.jpg`);
      check(asset.response.headers.get('content-type')==='image/jpeg','invalid asset content type');
      check(asset.body.length>10000,'empty preview '+number);
    }
    const csrf=html.match(/name="_csrf" value="([a-f0-9]{64})"/)?.[1];
    check(csrf,'csrf token missing');
    const form=new URLSearchParams({
      _csrf:csrf,test_id:crypto.randomUUID(),layout:'editorialtutorial',slot:'cover',
      title:'Uma explicação que merece ser lida',body:'Contexto, destaque e uma evidência visual.',
      name:'Marca de exemplo',handle:'@suamarca',primary:'#13533f',background:'#ffffff',accent:'#d7fa69',font:'sans',image:'',
    });
    const preview=await request(cookie,'/admin/content-studio/models/preview',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','origin':process.env.GCS_SOCIAL_ORIGIN||'https://studio.example.invalid'},body:form.toString(),
    });
    const previewHtml=preview.body.toString('utf8');
    for(const expected of ['data-layout="editorialtutorial"','TUTORIAL','Marca de exemplo','gcs-model-preview'])check(previewHtml.includes(expected),'preview missing '+expected);
    console.log(JSON.stringify({ok:true,writes:false,model:'editorialtutorial',display_name:'Editorial Tutorial',assets:3,preview:true,generation_enabled:false}));
  }finally{
    await pool.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash]);
    await pool.end();
  }
})().catch(async error=>{console.error(error.stack||error.message);try{await pool.end();}catch{}process.exitCode=1;});
