'use strict';
// Pure planning only: no network, credentials, storage or publishing operations.
const DESTINATIONS = ['instagram.feed', 'instagram.story', 'facebook.feed', 'facebook.story'];
const SCHEMA_VERSION = 1;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function isoTime(value) {
  invariant(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'explicit_timezone_required');
  const ms = Date.parse(value);
  invariant(Number.isFinite(ms), 'invalid_date');
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/).slice(1).map(Number);
  const local = new Date(Date.UTC(...[parts[0], parts[1] - 1, ...parts.slice(2)]));
  invariant(local.getUTCFullYear() === parts[0] && local.getUTCMonth() + 1 === parts[1] && local.getUTCDate() === parts[2] && local.getUTCHours() === parts[3] && local.getUTCMinutes() === parts[4] && local.getUTCSeconds() === parts[5], 'invalid_date');
  return ms;
}

function validateAsset(asset, destination) {
  invariant(asset && typeof asset === 'object', 'asset_required');
  invariant(typeof asset.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(asset.id), 'invalid_asset_id');
  invariant(typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256), 'asset_checksum_required');
  for (const key of ['width', 'height', 'bytes']) invariant(Number.isSafeInteger(asset[key]) && asset[key] > 0, 'invalid_media_metadata');
  const ratio = asset.width / asset.height;
  const story = destination.endsWith('.story');
  const instagram = destination.startsWith('instagram.');
  if (asset.kind === 'image') {
    // Shared editorial profile: JPEG <= 8 MB, even where Facebook permits more.
    invariant(asset.mime === 'image/jpeg' && asset.bytes <= 8_000_000, 'jpeg_up_to_8mb_required');
    if (!story && instagram) invariant(ratio >= 0.8 && ratio <= 1.91, 'instagram_feed_aspect_ratio');
  } else if (asset.kind === 'video') {
    invariant(['video/mp4', 'video/quicktime'].includes(asset.mime), 'unsupported_video_container');
    invariant(Number.isFinite(asset.duration_seconds) && asset.duration_seconds >= 3, 'invalid_video_duration');
    // Stories use the common 3–60s range; Facebook's wider range is not enabled here.
    invariant(asset.duration_seconds <= (story ? 60 : 900), 'video_too_long_for_profile');
    invariant(asset.bytes <= (story ? 100_000_000 : 300_000_000), 'video_too_large_for_profile');
    invariant(Number.isFinite(asset.fps) && asset.fps >= 24 && asset.fps <= 60, 'unsupported_frame_rate');
    invariant(asset.video_codec === 'h264' && asset.audio_codec === 'aac', 'normalize_video_codecs');
  } else throw new Error('unsupported_asset_kind');
  // An editorial requirement, not a claim that both APIs mandate exact 9:16.
  if (story) invariant(Math.abs(ratio - 9 / 16) < 0.001, 'story_needs_vertical_variant');
}

function validateDraft(draft) {
  invariant(draft && draft.schema_version === SCHEMA_VERSION, 'unsupported_schema');
  invariant(typeof draft.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(draft.id), 'invalid_draft_id');
  invariant(Number.isSafeInteger(draft.revision) && draft.revision > 0, 'invalid_revision');
  invariant(draft.rights_confirmed === true, 'media_rights_not_confirmed');
  invariant(draft.source && draft.source.type === 'green_content_studio', 'unsupported_source');
  invariant(draft.source.client_slug === 'community', 'studio_client_out_of_scope');
  for (const key of ['post_id', 'generation_job_id']) {
    invariant(typeof draft.source[key] === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(draft.source[key]), 'studio_source_ids_required');
  }
  invariant(typeof draft.source.reference === 'string' && draft.source.reference.length > 0 && draft.source.reference.length <= 200, 'source_reference_required');
  invariant(draft.timezone === 'America/Sao_Paulo', 'editorial_timezone_required');
  invariant(draft.scheduled_at === null || typeof draft.scheduled_at === 'string', 'schedule_required');
  if (draft.scheduled_at !== null) isoTime(draft.scheduled_at);
  invariant(Array.isArray(draft.variants) && draft.variants.length > 0 && draft.variants.length <= 4, 'variants_required');
  const seen = new Set();
  for (const variant of draft.variants) {
    invariant(DESTINATIONS.includes(variant.destination), 'unknown_destination');
    invariant(!seen.has(variant.destination), 'duplicate_destination');
    seen.add(variant.destination);
    invariant(typeof variant.caption === 'string' && [...variant.caption].length <= 2200, 'caption_exceeds_editorial_profile');
    invariant(typeof variant.ai_generated === 'boolean', 'ai_disclosure_required');
    invariant(typeof variant.paid_partnership === 'boolean', 'partnership_disclosure_required');
    invariant(Array.isArray(variant.assets) && variant.assets.length >= 1, 'media_required');
    const story = variant.destination.endsWith('.story');
    if (story) {
      invariant(variant.assets.length === 1, 'one_asset_per_story');
      invariant(variant.caption === '', 'story_text_must_be_in_media');
    } else {
      invariant(variant.assets.length <= 10, 'carousel_limit_in_preparation');
      if (variant.assets.length > 1) invariant(variant.assets.every(a => a.kind === 'image'), 'mixed_carousel_not_prepared');
    }
    invariant(variant.stickers === undefined || (Array.isArray(variant.stickers) && variant.stickers.length === 0), 'stickers_require_manual_handling');
    for (const asset of variant.assets) validateAsset(asset, variant.destination);
  }
  return draft;
}

function planDraft(draft) {
  validateDraft(draft);
  return draft.variants.map(variant => {
    const [network, placement] = variant.destination.split('.');
    const kind = variant.assets[0].kind;
    const carousel = variant.assets.length > 1;
    const operation = network === 'instagram'
      ? placement === 'story' ? 'ig_story' : carousel ? 'ig_image_carousel' : kind === 'video' ? 'ig_reel_shared_to_feed' : 'ig_feed_image'
      : placement === 'story' ? kind === 'video' ? 'fb_video_story' : 'fb_photo_story'
        : carousel ? 'fb_multi_photo_post' : kind === 'video' ? 'fb_feed_video' : 'fb_feed_photo';
    return {
      delivery_key: `${draft.id}:${draft.revision}:${variant.destination}`,
      network, placement, operation, scheduled_at: draft.scheduled_at,
      required_asset_ids: variant.assets.map(a => a.id),
      manual_review_reasons: [
        ...(variant.paid_partnership ? ['partnership_label_capability_not_verified'] : []),
        ...(network === 'facebook' && variant.ai_generated ? ['facebook_ai_disclosure_not_verified'] : []),
      ],
      persistent_state: 'draft',
    };
  });
}

function reviewCards(draft) {
  const jobs = planDraft(draft);
  return draft.variants.map((variant, index) => ({
    destination: variant.destination,
    text: [
      `Community News • ${draft.id} • versão ${draft.revision}`,
      `Origem: Green Content Studio • post ${draft.source.post_id} • geração ${draft.source.generation_job_id}`,
      `Destino: ${variant.destination}`,
      `Horário: ${draft.scheduled_at || 'a definir antes de autorizar a publicação'}`,
      `Mídia: ${variant.assets.map(a => a.id).join(', ')}`,
      `IA declarada: ${variant.ai_generated ? 'sim' : 'não'} | parceria: ${variant.paid_partnership ? 'sim' : 'não'}`,
      variant.caption || 'Story: texto incorporado à arte/vídeo.',
    ].join('\n'),
    asset_preview_ids: jobs[index].required_asset_ids,
    proposed_actions: ['Aprovar versão', 'Pedir ajuste', 'Definir horário', 'Rejeitar'],
    buttons_connected: false,
  }));
}

function simulate(draft) {
  return {
    mode: 'simulation_only', publish_enabled: false,
    validation_scope: 'declared_metadata_only_not_media_bytes_or_permissions',
    draft_id: draft.id, revision: draft.revision,
    jobs: planDraft(draft), review_cards: reviewCards(draft),
    blockers_before_install: ['verify_media_files_and_hosting', 'connect_persistent_storage',
      'verify_destination_accounts_and_permissions', 'connect_authenticated_approval_adapter',
      'implement_and_test_publish_adapters', 'shared_capacity_review'],
  };
}

module.exports = {DESTINATIONS, isoTime, validateDraft, planDraft, reviewCards, simulate};
