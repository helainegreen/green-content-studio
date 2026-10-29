'use strict';
const crypto = require('node:crypto');
const {check} = require('../social-connections/security.cjs');
const core = require('./core.cjs');

function createRepository(pool, {advisoryLocks = true} = {}) {
  async function transaction(callback) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const value = await callback(db);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async function batchWith(db, batchId, clientId, lock = false) {
    const result = await db.query(`SELECT * FROM social_publication_batches
      WHERE id=$1 AND client_id=$2${lock ? ' FOR UPDATE' : ''}`, [batchId, clientId]);
    check(result.rowCount === 1, 'batch_not_found', 'Lote de publicação não encontrado.', 404);
    return result.rows[0];
  }

  async function plansWith(db, batchId, lock = false) {
    const result = await db.query(`SELECT p.*,posts.source_title
      FROM social_publication_plans p JOIN posts ON posts.id=p.post_id
      WHERE p.batch_id=$1 ORDER BY p.position${lock ? ' FOR UPDATE OF p' : ''}`, [batchId]);
    return result.rows;
  }

  async function planWith(db, batchId, planId, lock = false) {
    const result = await db.query(`SELECT p.*,posts.source_title
      FROM social_publication_plans p JOIN posts ON posts.id=p.post_id
      WHERE p.batch_id=$1 AND p.id=$2${lock ? ' FOR UPDATE OF p' : ''}`, [batchId, planId]);
    check(result.rowCount === 1, 'plan_not_found', 'Post agendado não encontrado.', 404);
    return result.rows[0];
  }

  async function editableDeliveries(db, batchId, planId) {
    const deliveries = (await db.query(`SELECT d.id,d.network,d.status,d.state,d.inflight
      FROM social_publication_deliveries d JOIN social_publication_plans p ON p.id=d.plan_id
      WHERE p.batch_id=$1 AND p.id=$2 FOR UPDATE OF d`, [batchId, planId])).rows;
    check(deliveries.length > 0, 'publication_missing', 'Este post ainda não possui entregas confirmadas.', 409);
    check(!deliveries.some(row => ['processing','uncertain'].includes(row.status) || row.inflight),
      'publication_in_progress', 'Uma publicação deste post está em processamento ou precisa de conferência.', 409);
    const uncertain = await db.query(`SELECT 1 FROM social_publication_attempts a
      JOIN social_publication_deliveries d ON d.id=a.delivery_id
      WHERE d.plan_id=$1 AND a.status IN ('prepared','uncertain') LIMIT 1`, [planId]);
    check(uncertain.rowCount === 0, 'publication_in_progress',
      'Uma publicação deste post já iniciou e precisa de conferência.', 409);
    const editable = deliveries.filter(row => ['scheduled','held','failed'].includes(row.status) &&
      !row.state?.published_id);
    check(editable.length > 0, 'nothing_to_edit', 'Este post não possui publicações futuras para alterar.', 409);
    return editable;
  }

  return {
    async createBatch({clientId, label, userId, plans}) {
      check(Array.isArray(plans) && plans.length > 0 && plans.length <= 100,
        'invalid_batch', 'Selecione entre 1 e 100 posts.');
      return transaction(async db => {
        const batchId = crypto.randomUUID();
        await db.query(`INSERT INTO social_publication_batches(id,client_id,label,created_by)
          VALUES($1,$2,$3,$4)`, [batchId, clientId, String(label || 'Novo lote').slice(0, 200), userId]);
        for (let index = 0; index < plans.length; index += 1) {
          const plan = plans[index];
          await db.query(`INSERT INTO social_publication_plans
            (id,batch_id,post_id,position,due_at,networks,captions,source_digest,generation_id)
            SELECT $1,$2,p.id,$3,$4,$5,$6,$7,$8 FROM posts p
            WHERE p.id=$9 AND p.client_id=$10`, [
            crypto.randomUUID(), batchId, index + 1, plan.due_at,
            JSON.stringify(core.networks(plan.networks)), JSON.stringify(plan.captions),
            plan.source_digest, plan.generation_id, plan.post_id, clientId
          ]);
        }
        const inserted = await plansWith(db, batchId);
        check(inserted.length === plans.length, 'invalid_batch', 'Um post não pertence a este cliente.', 409);
        return {id: batchId, plans: inserted};
      });
    },

    async listBatches(clientId) {
      const result = await pool.query(`SELECT b.id,b.label,b.status,b.created_at,b.confirmed_at,
        COUNT(DISTINCT p.id)::integer AS posts,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status='published')::integer AS published,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status IN ('failed','held','uncertain'))::integer AS attention
        FROM social_publication_batches b
        LEFT JOIN social_publication_plans p ON p.batch_id=b.id
        LEFT JOIN social_publication_deliveries d ON d.plan_id=p.id
        WHERE b.client_id=$1 GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`, [clientId]);
      return result.rows;
    },

    async calendar(clientId, from, to) {
      const plans = (await pool.query(`SELECT p.id,p.batch_id,p.post_id,p.position,p.due_at,p.networks,
        posts.source_title,b.label AS batch_label,b.status AS batch_status
        FROM social_publication_plans p
        JOIN social_publication_batches b ON b.id=p.batch_id
        JOIN posts ON posts.id=p.post_id
        WHERE b.client_id=$1 AND p.due_at>=$2 AND p.due_at<$3 AND b.status<>'cancelled'
          AND (b.status='draft' OR EXISTS(
            SELECT 1 FROM social_publication_deliveries active
            WHERE active.plan_id=p.id AND active.status<>'cancelled'
          ))
        ORDER BY p.due_at,p.position`, [clientId, from, to])).rows;
      if (!plans.length) return [];
      const deliveries = (await pool.query(`SELECT d.id,d.plan_id,d.network,d.status,d.result,d.error_code,d.updated_at,a.snapshot
        FROM social_publication_deliveries d JOIN social_publication_approvals a ON a.id=d.approval_id
        WHERE d.plan_id=ANY($1::uuid[]) ORDER BY d.network`,
      [plans.map(plan => plan.id)])).rows;
      return plans.map(plan => ({...plan, deliveries: deliveries.filter(row => row.plan_id === plan.id)}));
    },

    async getBatch(batchId, clientId) {
      return transaction(async db => {
        const batch = await batchWith(db, batchId, clientId);
        const plans = await plansWith(db, batchId);
        const deliveries = (await db.query(`SELECT d.id,d.plan_id,d.network,d.status,d.due_at,d.result,d.error_code,d.updated_at,a.snapshot
          FROM social_publication_deliveries d JOIN social_publication_plans p ON p.id=d.plan_id
          JOIN social_publication_approvals a ON a.id=d.approval_id
          WHERE p.batch_id=$1 ORDER BY p.position,d.network`, [batchId])).rows;
        return {batch, plans: plans.map(plan => ({...plan, deliveries: deliveries.filter(row => row.plan_id === plan.id)}))};
      });
    },

    async updateBatch({batchId, clientId, updates}) {
      return transaction(async db => {
        const batch = await batchWith(db, batchId, clientId, true);
        check(batch.status === 'draft', 'batch_locked', 'O lote já foi confirmado e não pode mais ser alterado.', 409);
        const plans = await plansWith(db, batchId, true);
        check(updates.length === plans.length, 'invalid_batch', 'O lote mudou. Atualize a página.', 409);
        for (const plan of plans) {
          const value = updates.find(item => item.id === plan.id);
          check(value, 'invalid_batch', 'O lote mudou. Atualize a página.', 409);
          await db.query(`UPDATE social_publication_plans SET due_at=$1,networks=$2,captions=$3,
            version=version+1,updated_at=now() WHERE id=$4 AND batch_id=$5`, [
            value.due_at, JSON.stringify(core.networks(value.networks)), JSON.stringify(value.captions), plan.id, batchId
          ]);
        }
        await db.query('UPDATE social_publication_batches SET updated_at=now() WHERE id=$1', [batchId]);
        return plansWith(db, batchId);
      });
    },

    async updatePlan({batchId, planId, clientId, update}) {
      return transaction(async db => {
        const batch = await batchWith(db, batchId, clientId, true);
        check(batch.status === 'draft', 'batch_locked', 'O lote já foi confirmado e não pode ser alterado diretamente.', 409);
        await planWith(db, batchId, planId, true);
        await db.query(`UPDATE social_publication_plans SET due_at=$1,networks=$2,captions=$3,
          version=version+1,updated_at=now() WHERE id=$4 AND batch_id=$5`, [
          update.due_at, JSON.stringify(core.networks(update.networks)),
          JSON.stringify(update.captions), planId, batchId
        ]);
        await db.query('UPDATE social_publication_batches SET updated_at=now() WHERE id=$1', [batchId]);
        return planWith(db, batchId, planId);
      });
    },

    async cancelPlan({batchId, planId, clientId, userId}) {
      return transaction(async db => {
        const batch = await batchWith(db, batchId, clientId, true);
        check(batch.status === 'confirmed', 'batch_locked', 'Somente um agendamento confirmado pode ser cancelado por post.', 409);
        await planWith(db, batchId, planId, true);
        const editable = await editableDeliveries(db, batchId, planId);
        const result = await db.query(`UPDATE social_publication_deliveries SET
          status='cancelled',cancelled_by=$2,lease_id=NULL,lease_until=NULL,updated_at=now()
          WHERE plan_id=$1 AND status IN ('scheduled','held','failed') AND inflight IS NULL
            AND NOT(state ? 'published_id') RETURNING id`, [planId,userId]);
        check(result.rowCount === editable.length, 'cannot_cancel', 'O estado deste post mudou. Atualize a página.', 409);
        return {plan_id:planId,cancelled:result.rowCount};
      });
    },

    async revisePlan({batchId, planId, clientId, userId}) {
      return transaction(async db => {
        const batch = await batchWith(db, batchId, clientId, true);
        check(batch.status === 'confirmed', 'batch_locked', 'Somente um agendamento confirmado pode ser editado desta forma.', 409);
        const plan = await planWith(db, batchId, planId, true);
        const editable = await editableDeliveries(db, batchId, planId);
        const networks = plan.networks.filter(network => editable.some(row => row.network === network));
        const existing = await db.query(`SELECT p.id,p.batch_id
          FROM social_publication_plans p JOIN social_publication_batches b ON b.id=p.batch_id
          WHERE p.replaces_plan_id=$1 AND b.client_id=$2 AND b.status='draft'
          ORDER BY b.created_at DESC LIMIT 1`, [planId,clientId]);
        if (existing.rowCount) {
          return {id:existing.rows[0].batch_id,plan_id:existing.rows[0].id,
            plans:await plansWith(db,existing.rows[0].batch_id)};
        }
        const newBatchId = crypto.randomUUID();
        const newPlanId = crypto.randomUUID();
        const cleanLabel = String(batch.label || 'Publicações').replace(/\s+·\s+edição\s*$/i,'');
        const label = `${cleanLabel} · ${plan.source_title} · edição`.slice(0,200);
        await db.query(`INSERT INTO social_publication_batches(id,client_id,label,created_by)
          VALUES($1,$2,$3,$4)`, [newBatchId,clientId,label,userId]);
        await db.query(`INSERT INTO social_publication_plans
          (id,batch_id,post_id,position,version,due_at,networks,captions,source_digest,generation_id,replaces_plan_id)
          VALUES($1,$2,$3,1,1,$4,$5,$6,$7,$8,$9)`, [
          newPlanId,newBatchId,plan.post_id,plan.due_at,JSON.stringify(networks),
          JSON.stringify(plan.captions),plan.source_digest,plan.generation_id,planId
        ]);
        return {id:newBatchId,plan_id:newPlanId,plans:await plansWith(db,newBatchId)};
      });
    },

    async cancelBatch({batchId, clientId, userId}) {
      return transaction(async db => {
        const batch = await batchWith(db, batchId, clientId, true);
        check(['draft','confirmed'].includes(batch.status), 'batch_locked', 'Este agendamento já foi cancelado.', 409);
        const deliveries = (await db.query(`SELECT d.id,d.status,d.inflight
          FROM social_publication_deliveries d JOIN social_publication_plans p ON p.id=d.plan_id
          WHERE p.batch_id=$1 FOR UPDATE OF d`, [batchId])).rows;
        check(!deliveries.some(row => ['processing','uncertain'].includes(row.status) || row.inflight),
          'publication_in_progress', 'Uma publicação deste lote já está em processamento ou precisa de conferência.', 409);
        const uncertain = await db.query(`SELECT 1 FROM social_publication_attempts a
          JOIN social_publication_deliveries d ON d.id=a.delivery_id
          JOIN social_publication_plans p ON p.id=d.plan_id
          WHERE p.batch_id=$1 AND a.status IN ('prepared','uncertain') LIMIT 1`, [batchId]);
        check(uncertain.rowCount === 0, 'publication_in_progress',
          'Uma publicação deste lote já iniciou e precisa de conferência.', 409);
        const cancelled = await db.query(`UPDATE social_publication_deliveries d
          SET status='cancelled',cancelled_by=$2,lease_id=NULL,lease_until=NULL,updated_at=now()
          FROM social_publication_plans p WHERE d.plan_id=p.id AND p.batch_id=$1
            AND d.status IN ('scheduled','held','failed') AND d.inflight IS NULL RETURNING d.id`, [batchId,userId]);
        await db.query(`UPDATE social_publication_batches SET status='cancelled',updated_at=now()
          WHERE id=$1 AND client_id=$2`, [batchId,clientId]);
        return {batch_id:batchId,cancelled:cancelled.rowCount};
      });
    },

    async reviseBatch({batchId, clientId, userId}) {
      return transaction(async db => {
        const batch = await batchWith(db, batchId, clientId, true);
        check(batch.status === 'confirmed', 'batch_locked', 'Somente um agendamento confirmado pode ser reaberto.', 409);
        const plans = await plansWith(db, batchId, true);
        const deliveries = (await db.query(`SELECT d.id,d.status,d.inflight
          FROM social_publication_deliveries d JOIN social_publication_plans p ON p.id=d.plan_id
          WHERE p.batch_id=$1 FOR UPDATE OF d`, [batchId])).rows;
        check(deliveries.length > 0 && deliveries.every(row =>
          ['scheduled','held','failed','cancelled'].includes(row.status) && !row.inflight),
        'publication_started', 'Este lote já começou a publicar. Cancele apenas as entregas futuras.', 409);
        const uncertain = await db.query(`SELECT 1 FROM social_publication_attempts a
          JOIN social_publication_deliveries d ON d.id=a.delivery_id
          JOIN social_publication_plans p ON p.id=d.plan_id
          WHERE p.batch_id=$1 AND a.status IN ('prepared','uncertain') LIMIT 1`, [batchId]);
        check(uncertain.rowCount === 0, 'publication_started',
          'Este lote já iniciou uma publicação e não pode ser reaberto.', 409);
        await db.query(`UPDATE social_publication_deliveries d
          SET status='cancelled',cancelled_by=$2,lease_id=NULL,lease_until=NULL,updated_at=now()
          FROM social_publication_plans p WHERE d.plan_id=p.id AND p.batch_id=$1
            AND d.status IN ('scheduled','held','failed') AND d.inflight IS NULL`, [batchId,userId]);
        await db.query(`UPDATE social_publication_batches SET status='cancelled',updated_at=now()
          WHERE id=$1 AND client_id=$2`, [batchId,clientId]);
        const newBatchId = crypto.randomUUID();
        const label = `${String(batch.label || 'Publicações').replace(/\s+·\s+edição\s*$/i,'')} · edição`.slice(0,200);
        await db.query(`INSERT INTO social_publication_batches(id,client_id,label,created_by)
          VALUES($1,$2,$3,$4)`, [newBatchId,clientId,label,userId]);
        for (const plan of plans) {
          await db.query(`INSERT INTO social_publication_plans
            (id,batch_id,post_id,position,version,due_at,networks,captions,source_digest,generation_id)
            VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9)`, [
            crypto.randomUUID(),newBatchId,plan.post_id,plan.position,plan.due_at,
            JSON.stringify(plan.networks),JSON.stringify(plan.captions),plan.source_digest,plan.generation_id
          ]);
        }
        return {id:newBatchId,plans:await plansWith(db,newBatchId)};
      });
    },

    async connectionRows(clientId) {
      const result = await pool.query(`SELECT id,network,account_id,account_name,status,capabilities,expires_at
        FROM social_connections WHERE client_id=$1 ORDER BY network`, [clientId]);
      return result.rows;
    },

    async instagramContainerUsage(accountId) {
      check(/^\d{1,40}$/.test(accountId || ''), 'invalid_meta_id', 'Identificação da Meta inválida.');
      const result = await pool.query(`SELECT count(*)::integer AS total
        FROM social_publication_attempts a
        JOIN social_publication_deliveries d ON d.id=a.delivery_id
        WHERE d.network='instagram' AND d.account_id=$1
          AND a.operation IN ('create_image','create_carousel')
          AND a.created_at>now()-interval '24 hours'`, [accountId]);
      return result.rows[0]?.total || 0;
    },

    async confirmBatch({batchId, clientId, userId, approvals, retainDays = 60}) {
      check(Array.isArray(approvals) && approvals.length > 0, 'invalid_batch', 'O lote está vazio.');
      return transaction(async db => {
        if (advisoryLocks) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['gcs-social-batch:' + batchId]);
        const batch = await batchWith(db, batchId, clientId, true);
        check(batch.status === 'draft', 'batch_locked', 'O lote já foi confirmado.', 409);
        const plans = await plansWith(db, batchId, true);
        check(plans.length === approvals.length, 'invalid_batch', 'O lote mudou. Revise novamente.', 409);
        for (const plan of plans) {
          const approval = approvals.find(item => item.plan_id === plan.id);
          check(approval && Number(approval.plan_version) === Number(plan.version),
            'stale_plan', 'O lote mudou. Revise novamente.', 409);
          check(approval.plan_fingerprint === core.planFingerprint(plan),
            'stale_plan', 'O lote mudou. Revise novamente.', 409);
          const snapshot = {...approval.snapshot};
          const fingerprint = snapshot.fingerprint;
          delete snapshot.fingerprint;
          check(fingerprint === core.hash(snapshot), 'invalid_snapshot', 'A confirmação do lote é inválida.', 409);
          check(snapshot.client_id === clientId && snapshot.post_id === plan.post_id &&
            snapshot.generation_id === plan.generation_id && snapshot.source_digest === plan.source_digest,
          'source_changed', 'O conteúdo mudou. Revise novamente.', 409);
          if (plan.replaces_plan_id) {
            const original = await db.query(`SELECT p.id,p.batch_id,p.post_id,b.client_id
              FROM social_publication_plans p JOIN social_publication_batches b ON b.id=p.batch_id
              WHERE p.id=$1 FOR UPDATE OF p,b`, [plan.replaces_plan_id]);
            const replaced = original.rows[0];
            check(replaced && replaced.client_id === clientId && replaced.post_id === plan.post_id,
              'replacement_changed', 'O agendamento original não está mais disponível. Atualize a página.', 409);
            const editable = await editableDeliveries(db, replaced.batch_id, replaced.id);
            const cancelled = await db.query(`UPDATE social_publication_deliveries SET
              status='cancelled',cancelled_by=$2,lease_id=NULL,lease_until=NULL,updated_at=now()
              WHERE plan_id=$1 AND status IN ('scheduled','held','failed') AND inflight IS NULL
                AND NOT(state ? 'published_id') RETURNING id`, [replaced.id,userId]);
            check(cancelled.rowCount === editable.length, 'replacement_changed',
              'O agendamento original mudou. Revise novamente.', 409);
          }
          const pending = await db.query(`SELECT id FROM social_publication_deliveries
            WHERE post_id=$1 AND network=ANY($2::text[]) AND status<>'cancelled' LIMIT 1`,
          [plan.post_id, snapshot.networks]);
          check(pending.rowCount === 0, 'already_scheduled',
            'Este post já possui publicação ativa em uma das redes selecionadas.', 409);
          const approvalId = crypto.randomUUID();
          await db.query(`INSERT INTO social_publication_approvals
            (id,plan_id,plan_version,fingerprint,snapshot,approved_by,retain_until)
            VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz+($8*interval '1 day'))`, [
            approvalId, plan.id, plan.version, fingerprint, JSON.stringify(snapshot), userId, plan.due_at, retainDays
          ]);
          for (const network of snapshot.networks) {
            const account = snapshot.accounts[network];
            const connection = await db.query(`SELECT id,account_id,status,capabilities,expires_at
              FROM social_connections WHERE id=$1 AND client_id=$2 AND network=$3 FOR SHARE`, [
              account.connection_id, clientId, network
            ]);
            const row = connection.rows[0];
            check(row && row.status === 'connected' && row.account_id === account.account_id &&
              row.capabilities?.publish === true && (!row.expires_at || new Date(row.expires_at) > new Date()),
            'connection_changed', `A conexão do ${network === 'instagram' ? 'Instagram' : 'Facebook'} mudou. Revise novamente.`, 409);
            await db.query(`INSERT INTO social_publication_deliveries
              (id,approval_id,plan_id,client_id,post_id,network,connection_id,account_id,due_at,next_at)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [
              crypto.randomUUID(), approvalId, plan.id, clientId, plan.post_id, network,
              row.id, row.account_id, plan.due_at
            ]);
          }
        }
        await db.query(`UPDATE social_publication_batches SET status='confirmed',confirmed_by=$2,
          confirmed_at=now(),updated_at=now() WHERE id=$1`, [batchId, userId]);
        return {batch_id: batchId, scheduled: plans.length};
      });
    },

    async cancelDelivery({deliveryId, batchId, clientId, userId}) {
      const result = await pool.query(`UPDATE social_publication_deliveries SET status='cancelled',cancelled_by=$3,updated_at=now()
        WHERE id=$1 AND client_id=$2 AND status IN ('scheduled','held','failed') AND inflight IS NULL
          AND plan_id IN (SELECT id FROM social_publication_plans WHERE batch_id=$4)
          AND NOT(state ? 'published_id')
          AND NOT EXISTS(SELECT 1 FROM social_publication_attempts WHERE delivery_id=$1 AND status IN ('prepared','uncertain'))
        RETURNING id`, [deliveryId, clientId, userId, batchId]);
      check(result.rowCount === 1, 'cannot_cancel', 'A publicação já iniciou ou exige conferência.', 409);
    },

    async health(component, ready, details = {}) {
      await pool.query(`INSERT INTO social_publication_health(component,ready,details)
        VALUES($1,$2,$3) ON CONFLICT(component) DO UPDATE SET ready=EXCLUDED.ready,
        details=EXCLUDED.details,checked_at=now()`, [component, ready, JSON.stringify(details)]);
    },

    async claim() {
      return transaction(async db => {
        await db.query(`UPDATE social_publication_attempts SET status='uncertain',finished_at=now()
          WHERE status='prepared' AND delivery_id IN (
            SELECT id FROM social_publication_deliveries
            WHERE status='processing' AND lease_until<now() AND inflight IS NOT NULL
          )`);
        await db.query(`UPDATE social_publication_deliveries SET
          status=CASE WHEN inflight IS NULL THEN 'scheduled' ELSE 'uncertain' END,
          error_code=CASE WHEN inflight IS NULL THEN error_code ELSE 'interrupted_write' END,
          lease_id=NULL,lease_until=NULL,updated_at=now()
          WHERE status='processing' AND lease_until<now()`);
        const result = await db.query(`SELECT d.*,a.snapshot,a.approved_at,a.approved_by,
          c.encrypted_token,c.status AS connection_status,c.expires_at AS connection_expires_at,c.account_name,c.page_id
          FROM social_publication_deliveries d
          JOIN social_publication_approvals a ON a.id=d.approval_id
          JOIN social_connections c ON c.id=d.connection_id
          WHERE d.status='scheduled' AND d.next_at<=now()
          ORDER BY d.next_at,d.created_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED`);
        const row = result.rows[0];
        if (!row) return null;
        row.lease_id = crypto.randomUUID();
        await db.query(`UPDATE social_publication_deliveries SET status='processing',lease_id=$2,
          lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1`, [row.id, row.lease_id]);
        return row;
      });
    },

    async begin(job, operation) {
      return transaction(async db => {
        const attempt = crypto.randomUUID();
        const result = await db.query(`UPDATE social_publication_deliveries SET inflight=$3,updated_at=now()
          WHERE id=$1 AND lease_id=$2 AND status='processing' AND lease_until>now() AND inflight IS NULL RETURNING id`,
        [job.id, job.lease_id, {id: attempt, operation}]);
        check(result.rowCount === 1, 'lost_lease', 'A reserva de publicação expirou.', 409);
        await db.query(`INSERT INTO social_publication_attempts(id,delivery_id,operation,status)
          VALUES($1,$2,$3,'prepared')`, [attempt, job.id, operation]);
        return attempt;
      });
    },

    async finish(job, {state = job.state, status = 'scheduled', result = null, error = null,
      delay = 1000, attempt = null, attemptStatus = 'succeeded', attemptResult = null}) {
      return transaction(async db => {
        const updated = await db.query(`UPDATE social_publication_deliveries SET state=$3,status=$4,result=$5,
          error_code=$6,next_at=now()+($7*interval '1 millisecond'),lease_id=NULL,lease_until=NULL,
          inflight=NULL,updated_at=now()
          WHERE id=$1 AND lease_id=$2 AND status='processing' AND lease_until>now() RETURNING id`, [
          job.id, job.lease_id, JSON.stringify(state), status, result ? JSON.stringify(result) : null,
          error, delay
        ]);
        check(updated.rowCount === 1, 'lost_lease', 'A reserva de publicação expirou.', 409);
        if (attempt) await db.query(`UPDATE social_publication_attempts SET status=$2,result=$3,finished_at=now()
          WHERE id=$1 AND delivery_id=$4`, [attempt, attemptStatus,
          attemptResult ? JSON.stringify(attemptResult) : null, job.id]);
      });
    },

    async exclusive(callback) {
      const db = await pool.connect();
      try {
        if (!advisoryLocks) return callback();
        const result = await db.query('SELECT pg_try_advisory_lock(58392062) AS locked');
        if (!result.rows[0].locked) return false;
        try { return await callback(); }
        finally { await db.query('SELECT pg_advisory_unlock(58392062)'); }
      } finally {
        db.release();
      }
    }
  };
}

module.exports = {createRepository};
