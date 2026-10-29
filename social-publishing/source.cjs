'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {constants} = require('node:fs');
const {check} = require('../social-connections/security.cjs');
const core = require('./core.cjs');

function jpegSize(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length > 10 && bytes[0] === 255 && bytes[1] === 216,
    'invalid_jpeg', 'Arte inválida. Gere novamente em JPG.');
  const sizeMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let position = 2;
  while (position + 4 <= bytes.length) {
    check(bytes[position] === 255, 'invalid_jpeg', 'Arquivo JPG inválido.');
    while (position < bytes.length && bytes[position] === 255) position += 1;
    const marker = bytes[position++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    check(position + 2 <= bytes.length, 'invalid_jpeg', 'Arquivo JPG incompleto.');
    const length = bytes.readUInt16BE(position);
    check(length >= 2 && position + length <= bytes.length, 'invalid_jpeg', 'Arquivo JPG incompleto.');
    if (sizeMarkers.has(marker)) {
      check(length >= 8, 'invalid_jpeg', 'Arquivo JPG inválido.');
      return {height: bytes.readUInt16BE(position + 3), width: bytes.readUInt16BE(position + 5)};
    }
    position += length;
  }
  check(false, 'invalid_jpeg', 'Não foi possível identificar as dimensões do JPG.');
}

async function readSafe(root, outputDir, relative) {
  check(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !relative.includes('\0'),
    'invalid_path', 'Arquivo de arte inválido.');
  const realRoot = await fs.realpath(root);
  const realDir = await fs.realpath(outputDir);
  check(realDir.startsWith(realRoot + path.sep), 'invalid_path', 'Pasta de geração inválida.');
  const target = await fs.realpath(path.resolve(realDir, relative));
  check(target.startsWith(realDir + path.sep), 'invalid_path', 'Arquivo fora da geração.');
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    check(stat.isFile() && stat.size > 0 && stat.size <= 8_000_000,
      'invalid_file', 'Arte indisponível ou maior que 8 MB.');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function slideRows(job) {
  const rows = Array.isArray(job?.result_json?.jpg_slides) ? job.result_json.jpg_slides : [];
  const seen = new Set();
  return rows.filter(row => {
    if (!row || typeof row.jpg !== 'string' || !row.jpg || /reels|story|contact/i.test(String(row.slot || '') + ' ' + row.jpg)) return false;
    if (seen.has(row.jpg)) return false;
    seen.add(row.jpg);
    return true;
  });
}

function createSource(pool, {root = '/data/studio/rendered'} = {}) {
  async function postRow(postId, clientId) {
    const result = await pool.query(`SELECT p.id,p.client_id,p.source_title,p.source_text,p.source_meta,p.status,p.updated_at,
      c.slug AS client_slug,c.name AS client_name
      FROM posts p JOIN clients c ON c.id=p.client_id
      WHERE p.id=$1 AND p.client_id=$2 AND c.status='active'`, [postId, clientId]);
    check(result.rowCount === 1, 'post_not_found', 'Post não encontrado.', 404);
    return result.rows[0];
  }

  async function latestJob(postId) {
    const jobs = await pool.query(`SELECT id,status,result_json,output_dir,created_at
      FROM generation_jobs WHERE post_id=$1 ORDER BY created_at DESC LIMIT 30`, [postId]);
    const job = jobs.rows.find(row => row.status === 'completed');
    check(job, 'generation_missing', 'O post ainda não possui artes concluídas.', 409);
    check(!jobs.rows.some(row => ['pending','running'].includes(row.status)),
      'generation_active', 'A geração deste post ainda está em andamento.', 409);
    return job;
  }

  async function load(postId, clientId, {withBytes = false} = {}) {
    const post = await postRow(postId, clientId);
    const job = await latestJob(postId);
    const slides = slideRows(job);
    check(slides.length > 0, 'generation_missing', 'A geração concluída não possui slides JPG.', 409);
    const assets = [];
    for (const slide of slides) {
      const bytes = await readSafe(root, job.output_dir, slide.jpg);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const dimensions = jpegSize(bytes);
      assets.push({
        id: core.hash({generation_id: job.id, file: slide.jpg}).slice(0, 32),
        file: slide.jpg,
        label: `Slide ${String(slide.number || assets.length + 1).padStart(2, '0')}`,
        mime: 'image/jpeg', bytes: bytes.length, ...dimensions, sha256,
        alt_text: '', ...(withBytes ? {content: bytes} : {})
      });
    }
    const source = {
      post_id: post.id,
      client_id: post.client_id,
      client_slug: post.client_slug,
      client_name: post.client_name,
      title: post.source_title,
      caption: core.extractCaption(post.source_text),
      generation_id: job.id,
      assets
    };
    source.source_digest = core.hash({
      post: {id: post.id, title: post.source_title, text: post.source_text, updated_at: post.updated_at},
      generation_id: job.id,
      assets: assets.map(({content, ...asset}) => asset)
    });
    return source;
  }

  async function summary(postId, clientId) {
    const post = await postRow(postId, clientId);
    const job = await latestJob(postId);
    const slides = slideRows(job);
    check(slides.length > 0, 'generation_missing', 'A geração concluída não possui slides JPG.', 409);
    return {
      post_id: post.id,
      title: post.source_title,
      caption: core.extractCaption(post.source_text),
      generation_id: job.id,
      slide_count: slides.length
    };
  }

  async function preview(postId, clientId) {
    const post = await postRow(postId, clientId);
    const job = await latestJob(postId);
    const slide = slideRows(job)[0];
    check(slide, 'generation_missing', 'A geração concluída não possui slides JPG.', 409);
    return {
      post_id:post.id,
      title:post.source_title,
      file:slide.jpg,
      label:`Slide ${String(slide.number || 1).padStart(2, '0')}`
    };
  }

  async function list(clientId, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const result = await pool.query(`SELECT p.id,p.source_title,p.created_at,p.source_meta,j.id AS generation_id,
      COALESCE(jsonb_array_length(j.result_json->'jpg_slides'),0) AS slide_count
      FROM posts p
      JOIN LATERAL (
        SELECT id,result_json FROM generation_jobs
        WHERE post_id=p.id AND status='completed' ORDER BY created_at DESC LIMIT 1
      ) j ON true
      WHERE p.client_id=$1
      ORDER BY p.created_at DESC,p.id DESC LIMIT $2`, [clientId, safeLimit]);
    return result.rows;
  }

  return {list, load, summary, preview, readSafe, jpegSize};
}

module.exports = {createSource, jpegSize, readSafe, slideRows};
