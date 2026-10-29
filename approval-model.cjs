'use strict';
// Executable model for local tests. Not an HTTP endpoint or a durable approval store.
const crypto = require('node:crypto');
const {validateDraft, isoTime, planDraft} = require('./contract.cjs');
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function fingerprint(draft) {
  validateDraft(draft);
  return crypto.createHash('sha256').update(stable(draft)).digest('hex');
}
function approve(draft, {actor, allowedActors, expectedFingerprint, at}) {
  if (!allowedActors.includes(actor)) throw new Error('unauthorized_reviewer');
  const snapshot = fingerprint(draft);
  if (snapshot !== expectedFingerprint) throw new Error('stale_preview');
  isoTime(at);
  return {actor, fingerprint: snapshot, revision: draft.revision, approved_at: at};
}
function preflightPublish(draft, approval, {now, enabled, prerequisites, allowedActors}) {
  const reasons = [];
  const hash = fingerprint(draft);
  const nowMs = isoTime(now);
  if (!enabled) reasons.push('publishing_disabled');
  if (!approval || approval.fingerprint !== hash || approval.revision !== draft.revision) reasons.push('approval_missing_or_stale');
  else {
    if (!allowedActors.includes(approval.actor)) reasons.push('reviewer_no_longer_allowed');
    if (isoTime(approval.approved_at) > nowMs) reasons.push('approval_in_future');
  }
  if (draft.scheduled_at === null) reasons.push('schedule_missing');
  else {
    const delta = nowMs - isoTime(draft.scheduled_at);
    if (delta < 0) reasons.push('not_due');
    if (delta > 15 * 60 * 1000) reasons.push('missed_window_requires_review');
  }
  for (const key of ['media_verified', 'hosting_verified', 'accounts_verified', 'permissions_verified', 'storage_verified', 'quota_checked']) {
    if (prerequisites[key] !== true) reasons.push(key);
  }
  for (const job of planDraft(draft)) reasons.push(...job.manual_review_reasons);
  return {allowed: reasons.length === 0, reasons: [...new Set(reasons)]};
}
function deliveryAfterResult(previous, result) {
  if (previous.state === 'published') return {...previous};
  if (previous.state === 'uncertain') throw new Error('reconcile_before_retry');
  if (previous.state !== 'publishing') throw new Error('delivery_not_claimed_for_publish');
  if (result.kind === 'confirmed' && typeof result.external_id === 'string' && result.external_id.length > 0) {
    return {...previous, state: 'published', external_id: result.external_id};
  }
  if (result.kind === 'definite_rejection') return {...previous, state: 'failed', error_code: result.error_code || 'rejected'};
  return {...previous, state: 'uncertain', error_code: 'outcome_unknown'};
}
module.exports = {fingerprint, approve, preflightPublish, deliveryAfterResult};
