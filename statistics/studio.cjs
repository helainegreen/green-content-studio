'use strict';
const {createRepository,databaseUrl}=require('./repository.cjs');
const {renderPage}=require('./page.cjs');
const ROUTE='/clients/community/statistics';
function createStatistics({Pool,layout,env=process.env,repository,now=()=>new Date()}) {
  if(env.FR2_STATS_ENABLED!=='true') return {link:()=>'',handle:async()=>false};
  const reviewers=new Set((env.FR2_FEED_REVIEWER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean));
  const authorized=user=>!!user&&reviewers.has(user.id)&&user.nav_clients?.some(c=>c.slug==='community');
  let repo=repository;
  const send=(res,status,text,type='text/html; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN'});res.end(text);};
  return {
    link(slug,user,sidebar=false) { return slug==='community'&&authorized(user)?`<a class="${sidebar?'side-sub-link':'btn secondary'}" href="${ROUTE}">Estatísticas do Instagram</a>`:''; },
    async handle(req,res,user,url) {
      if(url.pathname!==ROUTE) return false;
      if(!authorized(user)) { send(res,404,'Página não encontrada.');return true; }
      if(req.method!=='GET') { send(res,405,'Método não permitido.');return true; }
      const days=Number(url.searchParams.get('days')||30),sort=url.searchParams.get('sort')||'reach';
      if(![7,30].includes(days)||!['views','reach','total_interactions'].includes(sort)) { send(res,400,'Filtro inválido.');return true; }
      try {
        if(!repo) {
          const pool=new Pool({connectionString:databaseUrl(env.FR2_FEED_DATABASE_URL),max:1,connectionTimeoutMillis:3000,statement_timeout:5000,application_name:'community_stats_view'});
          pool.on('error',()=>console.error('Community News statistics: database unavailable'));
          repo=createRepository(pool);
        }
        const data=await repo.load(days);
        send(res,200,layout({title:'Estatísticas do Instagram · Community News',user,body:renderPage({...data,days,sort,now:now()})}));
      } catch { send(res,503,layout({title:'Estatísticas · Community News',user,body:'<section class="card"><h1>Estatísticas temporariamente indisponíveis</h1><p>Tente novamente em alguns minutos.</p><a href="/clients/community">Voltar ao Community News</a></section>'})); }
      return true;
    }
  };
}
module.exports={createStatistics};
