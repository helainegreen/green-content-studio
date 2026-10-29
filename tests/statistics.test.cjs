'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../statistics/model.cjs');
const {createInsights,InsightsError}=require('../statistics/meta.cjs');
const {collect}=require('../statistics/collect.cjs');
const {createStatistics}=require('../statistics/studio.cjs');
const {renderPage}=require('../statistics/page.cjs');
const {databaseUrl,createRepository}=require('../statistics/repository.cjs');
const now=new Date('2026-09-24T13:00:00Z');
const token='fixture-token-that-must-not-be-logged';
const response=data=>new Response(JSON.stringify(data));
const metrics=(names,media=false)=>({data:names.map((name,i)=>({name,...(media?{values:[{value:i}]}:{total_value:{value:i}})}))});
const breakdown=(name,key,rows)=>({data:[{name,total_value:{breakdowns:[{dimension_keys:['timeframe',key],results:rows.map(([label,value])=>({dimension_values:['THIS_MONTH',label],value}))}]}}]});
const profile={id:m.ACCOUNT,username:'community',followers:54747,media_count:3966};
function metaMock() { return {profile:async()=>profile,account:async()=>metrics(m.ACCOUNT_METRICS),follows:async()=>breakdown('follows_and_unfollows','follow_type',[['FOLLOWER',1548],['NON_FOLLOWER',455]]),cities:async()=>breakdown('follower_demographics','city',[['Cidade de teste',100]]),demographics:async dimension=>breakdown('follower_demographics',dimension,dimension==='gender'?[['F',30710],['M',17518],['U',6122]]:[['65+',5],['25-34',70],['18-24',25]]),media:async()=>({data:[{id:'12',caption:'Publicação de teste',media_product_type:'FEED',media_type:'CAROUSEL_ALBUM',timestamp:'2026-09-22T13:00:00Z',permalink:'https://www.instagram.com/p/test/'}]}),mediaInsights:async()=>metrics(m.MEDIA_METRICS,true)}; }
test('janela usa dias completos de Brasília inclusive antes da meia-noite local',()=>{
  assert.deepEqual(m.windowFor(30,now),{days:30,since:1787626800,until:1790218799,timezone:'America/Sao_Paulo'});
  assert.equal(new Date((m.windowFor(7,new Date('2026-09-24T02:59:00Z')).until+1)*1000).toISOString(),'2026-09-23T03:00:00.000Z');
  assert.throws(()=>m.windowFor(90,now));
});
test('ausente, negativo, null e inválido não se transformam em zero',()=>{
  assert.deepEqual(m.metricValues({data:[{name:'views',total_value:{value:0}},{name:'reach',total_value:{value:null}}]},['views','reach','saves']),{views:0,reach:null,saves:null});
  for(const v of [null,undefined,-1,NaN,'12',Infinity]) assert.equal(m.count(v),null);
});
test('Meta retorna seguidores por FOLLOWER e NON_FOLLOWER, com dimensão mapeada',()=>{
  assert.deepEqual(m.follows(breakdown('follows_and_unfollows','follow_type',[['FOLLOWER',1548],['NON_FOLLOWER',455]])),{gained:1548,lost:455});
  assert.deepEqual(m.follows({data:[]}),{gained:null,lost:null});
});
test('somente links de publicação HTTPS do Instagram são expostos',()=>{
  for(const value of ['javascript:alert(1)','https://evil.example/p/a/','https://instagram.com.evil/p/a','https://user:contact@example.invalid/p/a','https://instagram.com/accounts/login/']) assert.equal(m.instagramLink(value),null);
  assert.equal(m.instagramLink('https://www.instagram.com/p/a/?tracking=private'),'https://www.instagram.com/p/a/');
});
test('identidade usa user_id profissional e não o id específico do app',async()=>{
  const api=createInsights({tokenProvider:async()=>token,fetchImpl:async()=>response({id:'100000000000005',user_id:m.ACCOUNT,username:'community',followers_count:54747,media_count:3966})});
  assert.deepEqual(await api.profile(),profile);
  const wrong=createInsights({tokenProvider:async()=>token,fetchImpl:async()=>response({id:m.ACCOUNT,user_id:'123',username:'outro'})});
  await assert.rejects(wrong.profile(),/wrong_account/);
});
test('transporte é exclusivamente GET oficial com token no cabeçalho e redirects negados',async()=>{
  const calls=[];
  const api=createInsights({tokenProvider:async()=>token,fetchImpl:async(url,init)=>{calls.push({url,init});return response({data:[]});}});
  await api.account(m.windowFor(7,now));await api.follows(m.windowFor(30,now));await api.cities();await api.media('cursor');await api.mediaInsights('12');
  for(const c of calls) { assert.equal(c.init.method,'GET');assert.equal(c.init.redirect,'error');assert.equal(new URL(c.url).origin,'https://graph.instagram.com');assert(!c.url.includes(token));assert.equal(c.init.headers.Authorization,'Bearer '+token); }
  assert.equal(api.publish,undefined);assert.throws(()=>api.mediaInsights('../me'));assert.throws(()=>api.media('\n'));
});
test('erros de API e rede nunca incluem token ou mensagem bruta da Meta',async()=>{
  for(const fetchImpl of [async()=>new Response(JSON.stringify({error:{code:190,message:token}}),{status:400}),async()=>{throw Error(token);},async()=>new Response('not json '+token,{status:502})]) {
    const api=createInsights({tokenProvider:async()=>token,fetchImpl});
    await assert.rejects(api.account(m.windowFor(7,now)),e=>e instanceof InsightsError && !JSON.stringify(e).includes(token)&&!e.message.includes(token));
  }
});
test('coleta preserva alcance agregado e lifetime por mídia sem somar pessoas',async()=>{
  const r=await collect({meta:metaMock(),now});
  assert.equal(r.snapshots.length,2);assert.equal(r.snapshots[0].metrics.reach,1);
  assert.equal(r.snapshots[0].posts.items[0].metrics.reach,1);
  assert.deepEqual(r.snapshots[0].follower_change,{gained:1548,lost:455});assert.equal(r.partial,false);
});
test('métrica opcional indisponível preserva visão geral e fica ausente',async()=>{
  const meta=metaMock();meta.cities=async()=>{throw new InsightsError(500)};meta.mediaInsights=async()=>{throw new InsightsError(400,100)};
  const r=await collect({meta,now});assert.equal(r.partial,true);assert.equal(r.snapshots[0].cities,null);assert.equal(r.snapshots[0].posts.items[0].metrics,null);
});
test('autenticação e rate limit interrompem chamadas em vez de multiplicar falhas',async()=>{
  for(const error of [new InsightsError(400,190),new InsightsError(429,4)]) {
    const meta=metaMock();let mediaCalls=0;meta.follows=async()=>{throw error};meta.media=async()=>{mediaCalls++;return {data:[]}};
    await assert.rejects(collect({meta,now}));assert.equal(mediaCalls,0);
  }
});
test('paginação usa cursor, elimina duplicatas e não termina em post antigo fixado',async()=>{
  const meta=metaMock(),page=await meta.media();let calls=0;
  meta.media=async after=>{calls++;if(!after)return {data:[{...page.data[0],id:'1',timestamp:'2025-01-01T12:00:00Z'},...page.data],paging:{next:'https://evil.example/?token=never-follow',cursors:{after:'safe'}}};assert.equal(after,'safe');return {data:[...page.data,{...page.data[0],id:'13'}]};};
  const r=await collect({meta,now});assert.equal(calls,2);assert.deepEqual(r.snapshots[0].posts.items.map(p=>p.id),['12','13']);
});
test('coleta limita páginas e marca cobertura parcial sem falhar todos os indicadores',async()=>{
  const meta=metaMock();let calls=0;
  meta.media=async()=>({data:[],paging:{next:'opaque',cursors:{after:String(++calls)}}});
  const r=await collect({meta,now});assert.equal(calls,4);assert.equal(r.snapshots[0].posts.complete,false);assert.equal(r.snapshots[0].posts.reason,'limit');assert.equal(r.partial,false);
});
test('posts de hoje ficam fora da janela de dias completos e métricas de 7/30 não se misturam',async()=>{
  const meta=metaMock(),p=(await meta.media()).data[0];meta.media=async()=>({data:[{...p,id:'1',timestamp:'2026-09-24T04:00:00Z'},{...p,id:'2',timestamp:'2026-09-05T04:00:00Z'}]});
  const r=await collect({meta,now});assert.equal(r.snapshots[0].posts.items.length,0);assert.deepEqual(r.snapshots[1].posts.items.map(p=>p.id),['2']);
});
test('URLs de banco exigem o banco e o papel exclusivos corretos',()=>{
  assert(databaseUrl('postgres://community_publicacoes_app:x@db/community_publicacoes'));
  assert(databaseUrl('postgres://community_estatisticas:x@db/community_publicacoes',true));
  for(const u of ['postgres://community_publicacoes_app:x@db/conteudo','postgres://conteudo:x@db/community_publicacoes','http://community_publicacoes_app:x@db/community_publicacoes'])assert.throws(()=>databaseUrl(u));
});
const env={FR2_STATS_ENABLED:'true',FR2_FEED_REVIEWER_IDS:'owner'};
const user={id:'owner',nav_clients:[{slug:'community'}]};
function resMock() { return {status:0,body:'',headers:null,writeHead(s,h){this.status=s;this.headers=h},end(s){this.body=s}}; }
test('somente usuário autorizado do Community News pode abrir a rota, sem sequer consultar DB para terceiros',async()=>{
  let calls=0;const stats=createStatistics({env,layout:({body})=>body,repository:{load:async()=>{calls++;return {snapshot:null}}}});
  for(const u of [null,{id:'other',nav_clients:user.nav_clients},{id:'owner',nav_clients:[{slug:'wellness'}]}]) {const res=resMock();await stats.handle({method:'GET'},res,u,new URL('https://studio.test/clients/community/statistics'));assert.equal(res.status,404);}
  assert.equal(calls,0);assert.equal(stats.link('wellness',user),'');assert(stats.link('community',user));
});
test('flag desligada não cria pool, link ou rota',async()=>{
  const stats=createStatistics({env:{},Pool:class{constructor(){throw Error('must not connect')}}});
  assert.equal(stats.link('community',user),'');assert.equal(await stats.handle({},resMock(),user,new URL('https://studio.test/clients/community/statistics')),false);
});
test('rota recusa métodos de escrita e filtros inválidos; sucesso impede cache compartilhado',async()=>{
  const stats=createStatistics({env,layout:({body})=>body,repository:{load:async()=>({snapshot:null})}});
  for(const [method,query,status] of [['POST','',405],['GET','?days=90',400],['GET','?sort=caption',400],['GET','?days=7',200]]) {const res=resMock();await stats.handle({method},res,user,new URL('https://studio.test/clients/community/statistics'+query));assert.equal(res.status,status);assert.equal(res.headers['Cache-Control'],'private, no-store');}
});
test('falha no banco renderiza mensagem segura sem afetar o publicador',async()=>{
  const stats=createStatistics({env,layout:({body})=>body,repository:{load:async()=>{throw Error(token)}}});const res=resMock();
  await stats.handle({method:'GET'},res,user,new URL('https://studio.test/clients/community/statistics'));assert.equal(res.status,503);assert(!res.body.includes(token));
});
test('HTML escapa conteúdo e explica lifetime, janela demográfica e atraso da Meta',async()=>{
  const r=await collect({meta:metaMock(),now});const s=r.snapshots[1];s.posts.items[0].caption='<script>bad()</script>';s.cities[0].label='<img onerror=bad()>';
  const html=renderPage({snapshot:s,now});assert(!html.includes('<script>'));assert(!html.includes('<img onerror'));assert(html.includes('&lt;script&gt;'));assert(html.includes('acumulados desde a publicação'));assert(html.includes('48 horas'));assert(html.includes('independente do filtro'));assert(html.includes('Ainda não há dois dias'));
});
test('última coleta é apresentada com aviso quando desatualizada ou conexão falha',async()=>{
  const r=await collect({meta:metaMock(),now});const html=renderPage({snapshot:r.snapshots[1],now:new Date(+now+9*3600000),sync:{status:'reconnect'}});
  assert(html.includes('última coleta disponível'));assert(html.includes('conexão precisa ser validada'));
});
test('histórico com lacunas usa datas reais e explicita que dias ausentes não são estimados',async()=>{
  const r=await collect({meta:metaMock(),now});const html=renderPage({snapshot:r.snapshots[1],now,history:[{date:'2026-09-20',followers:100},{date:'2026-09-24',followers:110}]});
  assert(html.includes('<svg'));assert(html.includes('dias sem coleta não são estimados'));assert(html.includes('20/09/2026'));assert(html.includes('24/09/2026'));
});
test('falha de sincronização apenas atualiza estado e preserva snapshots anteriores',async()=>{
  const calls=[];const repo=createRepository({query:async(q,p)=>{calls.push({q,p});return {rows:[]}}});await repo.failure('rate_limit',now);
  assert.equal(calls.length,1);assert(calls[0].q.includes('instagram_stat_sync'));assert(!calls[0].q.includes('instagram_stat_snapshots'));assert.equal(+calls[0].p[2]-now,m.INTERVAL_MS);
});
test('falha no salvamento faz rollback e não deixa os dois períodos inconsistentes',async()=>{
  const calls=[];const repo=createRepository({query:async(q)=>{calls.push(q);if(q.includes('INSERT INTO instagram_stat_snapshots'))throw Error('db');return {rows:[]}}});
  const result=await collect({meta:metaMock(),now});await assert.rejects(repo.save(result));assert.equal(calls[0],'BEGIN');assert.equal(calls.at(-1),'ROLLBACK');assert(!calls.includes('COMMIT'));
});
test('gênero usa a base retornada, mantém desconhecidos e não inventa categorias ausentes',()=>{
  const rows=[{label:'F',value:30710},{label:'M',value:17518},{label:'U',value:6122}];
  const d=m.demographicDistribution(rows,'gender');
  assert.equal(d.total,54350);assert.deepEqual(d.rows.map(r=>+r.percentage.toFixed(1)),[56.5,32.2,11.3]);
  assert.equal(d.rows[2].label,'Não informado/indisponível');
  const single=m.demographicDistribution([{label:'M',value:10}],'gender');
  assert.equal(single.rows.length,1);assert.equal(single.rows[0].key,'M');
  const unknown=m.demographicDistribution([{label:'OTHER',value:3},{label:'U',value:2}],'gender');
  assert.equal(unknown.total,5);assert.equal(unknown.rows[0].value,5);
});
test('idade tem ordem cronológica e base independente da distribuição de gênero',()=>{
  const d=m.demographicDistribution([{label:'65+',value:5},{label:'25-34',value:70},{label:'18-24',value:25}],'age');
  assert.equal(d.total,100);assert.deepEqual(d.rows.map(r=>r.key),['18-24','25-34','65+']);
  assert.equal(d.rows[1].percentage,70);assert.equal(d.rows[2].label,'65 anos ou mais');
});
test('demografia vazia ou inválida não gera percentuais fictícios nem divisão por zero',()=>{
  for(const input of [null,undefined,[],[{label:'F',value:null}],[{label:'F',value:1},{label:'M',value:Number.MAX_SAFE_INTEGER}]]) assert.equal(m.demographicDistribution(input,'gender'),null);
  assert.equal(m.demographicDistribution([{label:'F',value:0}],'gender').rows[0].percentage,null);
});
test('consultas extras limitam-se a gênero e idade, com janela demográfica fixa',async()=>{
  const urls=[];const api=createInsights({tokenProvider:async()=>token,fetchImpl:async(url)=>{urls.push(new URL(url));return response({data:[]});}});
  await api.demographics('gender');await api.demographics('age');assert.throws(()=>api.demographics('country'));
  assert.deepEqual(urls.map(u=>u.searchParams.get('breakdown')),['gender','age']);
  for(const u of urls){assert.equal(u.searchParams.get('timeframe'),'this_month');assert.equal(u.searchParams.get('metric'),'follower_demographics');assert.equal(u.searchParams.has('since'),false);}
  const meta=metaMock(),calls=[];const original=meta.demographics;meta.demographics=async key=>{calls.push(key);return original(key);};
  const r=await collect({meta,now});assert.deepEqual(calls,['gender','age']);assert.deepEqual(r.snapshots[0].demographics,r.snapshots[1].demographics);assert.equal(r.snapshots[0].version,2);
});
test('falha demográfica preserva demais indicadores e autenticação interrompe a coleta',async()=>{
  const meta=metaMock();meta.demographics=async key=>{if(key==='gender')throw new InsightsError(500);return {data:[]};};
  const r=await collect({meta,now});assert.equal(r.partial,true);assert.equal(r.snapshots[0].demographics.gender,null);assert.equal(r.snapshots[0].metrics.reach,1);
  meta.demographics=async()=>{throw new InsightsError(400,190);};await assert.rejects(collect({meta,now}));
});
test('painel aceita snapshots anteriores e apresenta percentuais, contagens e aviso da base',async()=>{
  const r=await collect({meta:metaMock(),now});const s=r.snapshots[1];
  const html=renderPage({snapshot:s,now});
  for(const value of ['Gênero dos seguidores','Faixa etária dos seguidores','56,5%','30.710 seguidores','54.350 seguidores','Não informado/indisponível','cada gráfico']) assert(html.toLowerCase().includes(value.toLowerCase()),value);
  assert(!html.includes('Países'));assert(!html.includes('NaN'));assert(!html.includes('Infinity'));
  delete s.demographics;s.version=1;const legacy=renderPage({snapshot:s,now});assert(legacy.includes('Dados ainda não disponíveis nesta coleta'));assert(legacy.includes('Movimentação de seguidores'));
});
