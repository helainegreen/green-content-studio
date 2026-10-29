'use strict';
const {check}=require('./core.cjs');
function createRepository(pool){
  const verify=async client=>{
    const result=await client.query('SELECT current_database() AS name');
    check(result.rows[0]?.name==='community_publicacoes','wrong_database','O banco exclusivo de publicações não está configurado.',503);
  };
  return {
    async get(id){
      const client=await pool.connect();
      try{await verify(client);const result=await client.query("SELECT version, body FROM feed_drafts WHERE post_id=$1 AND client_slug='community'",[id]);return result.rows[0]?{version:Number(result.rows[0].version),draft:result.rows[0].body}:null;}finally{client.release();}
    },
    async save(id,draft,expected,actor){
      const client=await pool.connect();
      try{
        await verify(client);await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',['fr2-feed:'+id]);
        const old=await client.query('SELECT version FROM feed_drafts WHERE post_id=$1 FOR UPDATE',[id]);
        check(Number(old.rows[0]?.version||0)===expected,'stale_version','Outra janela salvou uma versão nova. Atualize a página.',409);
        const version=expected+1;
        await client.query(`INSERT INTO feed_drafts(post_id, version, body, updated_by) VALUES($1,$2,$3,$4)
          ON CONFLICT(post_id) DO UPDATE SET version=EXCLUDED.version,body=EXCLUDED.body,updated_by=EXCLUDED.updated_by,updated_at=now()`,[id,version,draft,actor]);
        await client.query('INSERT INTO feed_draft_versions(post_id,version,body,saved_by) VALUES($1,$2,$3,$4)',[id,version,draft,actor]);
        await client.query('COMMIT');return {version,draft};
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
  };
}
module.exports={createRepository};
