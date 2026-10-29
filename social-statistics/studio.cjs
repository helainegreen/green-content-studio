'use strict';
const {createRepository}=require('./repository.cjs');
const {renderPage}=require('./page.cjs');
function createSocialStatistics({pool,layout,env=process.env,repository,now=()=>new Date()}) {
  if(env.GCS_SOCIAL_STATISTICS_ENABLED!=='true') return {link:()=>'',handle:async()=>false};
  const enabled=new Set(String(env.GCS_SOCIAL_STATISTICS_CLIENTS||'').split(',').map(value=>value.trim()).filter(Boolean));
  if(!enabled.size||[...enabled].some(value=>!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) throw Error('invalid_statistics_clients');
  const repo=repository||createRepository(pool);
  const send=(response,status,body)=>{response.writeHead(status,{'Content-Type':'text/html; charset=utf-8',
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'X-Frame-Options':'SAMEORIGIN'});response.end(body);};
  return {
    link(slug,user) {
      return enabled.has(slug)&&user?.nav_clients?.some(client=>client.slug===slug)?
        `<a class="btn secondary" href="/clients/${encodeURIComponent(slug)}/statistics">Estatísticas</a>`:'';
    },
    async handle(request,response,user,url) {
      const match=url.pathname.match(/^\/clients\/([^/]+)\/statistics$/);
      if(!match||!enabled.has(match[1])) return false;
      if(request.method!=='GET') { send(response,405,'Método não permitido.');return true; }
      if(!user?.nav_clients?.some(client=>client.slug===match[1])) { send(response,404,'Página não encontrada.');return true; }
      const days=Number(url.searchParams.get('days')||30),sort=url.searchParams.get('sort')||'reach';
      if(![7,30].includes(days)||!['views','reach','total_interactions'].includes(sort)) {
        send(response,400,'Filtro inválido.');return true;
      }
      try {
        const clientResult=await pool.query("SELECT id,slug,name FROM clients WHERE slug=$1 AND status='active'",[match[1]]);
        if(!clientResult.rows[0]) { send(response,404,'Página não encontrada.');return true; }
        const data=await repo.load(clientResult.rows[0].id,days);
        send(response,200,layout({title:`Estatísticas · ${clientResult.rows[0].name}`,user,
          body:renderPage({client:clientResult.rows[0],...data,days,sort,now:now()})}));
      } catch {
        send(response,503,layout({title:'Estatísticas',user,body:'<section class="card"><h1>Estatísticas temporariamente indisponíveis</h1><p>Tente novamente em alguns minutos.</p></section>'}));
      }
      return true;
    }
  };
}
module.exports={createSocialStatistics};
