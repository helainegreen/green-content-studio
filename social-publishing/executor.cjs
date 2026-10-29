'use strict';
const {check} = require('../social-connections/security.cjs');

const META_STATUS_POLL_MS = 60_000;
const META_STATUS_MAX_MS = 5 * 60_000;

function statusWindowExpired(createdAt, now) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return true;
  const elapsed = now.getTime() - timestamp;
  return elapsed >= META_STATUS_MAX_MS;
}

async function execute(job, {repository, api, assets, clock = () => new Date()}) {
  const state = structuredClone(job.state || {});
  const snapshot = job.snapshot;
  const now = clock();
  let writing = false;
  const finish = value => repository.finish(job, {state, ...value});

  async function write(operation, callback, save, delay = 1000) {
    const attempt = await repository.begin(job, operation);
    writing = true;
    let result;
    try {
      result = await callback();
    } catch (error) {
      const rejected = error.kind === 'rejected';
      await finish({
        status: rejected ? 'failed' : 'uncertain',
        error: rejected ? 'meta_rejected_' + String(error.meta_code || 0) : 'uncertain_write',
        attempt,
        attemptStatus: rejected ? 'rejected' : 'uncertain'
      });
      return;
    }
    save(result);
    await finish({attempt, attemptResult: result, delay});
  }

  try {
    const account = snapshot.accounts?.[job.network];
    check(snapshot.client_id === job.client_id && snapshot.post_id === job.post_id &&
      snapshot.networks.includes(job.network) && account?.connection_id === job.connection_id &&
      account?.account_id === job.account_id,
    'account_mismatch', 'A conta da publicação mudou.', 409);
    check(job.connection_status === 'connected' &&
      (!job.connection_expires_at || new Date(job.connection_expires_at).getTime() > now.getTime()),
    'connection_unavailable', 'A conexão Meta expirou.', 409);
    check(Array.isArray(snapshot.assets) && snapshot.assets.length > 0 && snapshot.assets.length <= 10,
      'invalid_snapshot', 'A seleção de artes é inválida.', 409);
    if (state.published_id) {
      const result = await api.publishedResult(state.published_id);
      await finish({status: 'published', result});
      return;
    }
    if (!state.started_at && now - new Date(job.due_at) > 15 * 60_000) {
      await finish({status: 'held', error: 'schedule_missed'});
      return;
    }
    if (state.started_at && now - new Date(state.started_at) > 20 * 60 * 60_000) {
      await finish({status: 'held', error: 'preparation_expired'});
      return;
    }
    if (!state.started_at) {
      await api.identity();
      if (job.network === 'instagram') {
        const quota = await api.quota();
        if (quota.used >= quota.total) {
          await finish({status: 'held', error: 'quota_exhausted'});
          return;
        }
      }
      state.started_at = now.toISOString();
    }
    const caption = snapshot.captions[job.network];
    state.media ||= [];
    if (state.media.length < snapshot.assets.length) {
      if (job.network === 'instagram') {
        const remaining = snapshot.assets.length - state.media.length +
          (snapshot.assets.length > 1 && !state.container ? 1 : 0);
        const used = await repository.instagramContainerUsage(job.account_id);
        if (used + remaining > 400) {
          await finish({status: 'held', error: 'container_quota_exhausted'});
          return;
        }
      }
      const asset = snapshot.assets[state.media.length];
      const url = await assets.url(asset.sha256);
      if (job.network === 'facebook') {
        await write('upload_photo', () => api.uploadPhoto({url, altText: asset.alt_text}),
          result => state.media.push({...result, ready: true}));
      } else {
        await write('create_image', () => api.createImage({
          url, altText: asset.alt_text, caption: snapshot.assets.length === 1 ? caption : '',
          carouselItem: snapshot.assets.length > 1
        }), result => state.media.push({...result, ready: false, created_at: now.toISOString()}),
        META_STATUS_POLL_MS);
      }
      return;
    }
    if (job.network === 'facebook') {
      await write('publish_photos', () => api.publishPhotos({photos: state.media.map(item => item.id), caption}),
        result => { state.published_id = result.id; });
      return;
    }
    const pendingChild = state.media.find(item => !item.ready);
    if (pendingChild) {
      const result = await api.containerStatus(pendingChild.id);
      if (['ERROR','EXPIRED','PUBLISHED'].includes(result.status)) {
        await finish({status: result.status === 'PUBLISHED' ? 'uncertain' : 'failed',
          error: 'container_' + result.status.toLowerCase()});
        return;
      }
      if (result.status === 'FINISHED') pendingChild.ready = true;
      if (result.status !== 'FINISHED' && statusWindowExpired(pendingChild.created_at, now)) {
        await finish({status: 'held', error: 'media_processing_timeout'});
        return;
      }
      await finish({delay: result.status === 'FINISHED' ? 1000 : META_STATUS_POLL_MS});
      return;
    }
    if (!state.container) {
      if (state.media.length === 1) {
        state.container = state.media[0].id;
        state.container_ready = true;
        await finish({});
      } else {
        const used = await repository.instagramContainerUsage(job.account_id);
        if (used >= 400) {
          await finish({status: 'held', error: 'container_quota_exhausted'});
          return;
        }
        await write('create_carousel', () => api.createCarousel({children: state.media.map(item => item.id), caption}),
          result => {
            state.container = result.id;
            state.container_created_at = now.toISOString();
          }, META_STATUS_POLL_MS);
      }
      return;
    }
    if (!state.container_ready) {
      const result = await api.containerStatus(state.container);
      if (['ERROR','EXPIRED','PUBLISHED'].includes(result.status)) {
        await finish({status: result.status === 'PUBLISHED' ? 'uncertain' : 'failed',
          error: 'container_' + result.status.toLowerCase()});
        return;
      }
      state.container_ready = result.status === 'FINISHED';
      if (!state.container_ready && statusWindowExpired(state.container_created_at, now)) {
        await finish({status: 'held', error: 'carousel_processing_timeout'});
        return;
      }
      await finish({delay: state.container_ready ? 1000 : META_STATUS_POLL_MS});
      return;
    }
    const quota = await api.quota();
    if (quota.used >= quota.total) {
      await finish({status: 'held', error: 'quota_exhausted'});
      return;
    }
    await write('publish_container', () => api.publishContainer(state.container),
      result => { state.published_id = result.id; });
  } catch (error) {
    if (writing) throw error;
    const temporary = error.kind === 'unavailable';
    const reason = error.kind === 'rejected'
      ? 'meta_rejected_' + String(error.meta_code || 0)
      : (error.code || 'preflight_failed');
    await finish({
      status: temporary ? 'scheduled' : 'held',
      error: temporary ? 'connection_unavailable' : reason,
      delay: 5 * 60_000
    });
  }
}

module.exports = {execute};
