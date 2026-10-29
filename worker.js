const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const appName = process.env.APP_NAME || 'Green Content Studio Worker';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const defaultRenderScript = process.env.WELLNESS_RENDER_SCRIPT || '/data/studio/gcm-wellness-post-unico.js';
const renderedRoot = process.env.GCM_RENDERED_ROOT || '/data/studio/rendered';
const retentionDays = Number(process.env.RENDER_RETENTION_DAYS || 60);
const driveSaveWebhookUrl = process.env.N8N_DRIVE_SAVE_WEBHOOK_URL || '';
const driveSaveSecret = process.env.N8N_DRIVE_SAVE_SECRET || '';
let schemaReady = false;
let lastCleanupAt = 0;
let tickRunning = false;

function encodePayload(data) {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}

function slideMarker(slide) {
  if (slide.slot === 'metodo') return ' - Método';
  if (slide.slot === 'cta') return ' - CTA';
  return '';
}

function buildWellnessText(post, slides) {
  const ordered = [...slides].sort((a, b) => a.number - b.number);
  const cover = ordered.find((slide) => slide.number === 1) || {};
  const parts = [
    post.source_title,
    'FORMATO: CARROSSEL',
    '',
    'CAPA (SLIDE 1)',
    'Headline:',
    cover.title || '',
    'Subheadline:',
    cover.body || '',
  ];
  if (cover.prompt) {
    parts.push('PROMPT GEMINI (CAPA):', cover.prompt);
  }
  for (const slide of ordered.filter((item) => item.number > 1)) {
    parts.push('', `SLIDE ${slide.number}${slideMarker(slide)}`, 'Título:', slide.title || '', 'Texto:', slide.body || '');
    if (slide.prompt) parts.push('PROMPT OPENAI (interno):', slide.prompt);
  }
  return parts.join('\n');
}

function buildHealthText(post, slides) {
  const ordered = [...slides].sort((a, b) => a.number - b.number);
  const cover = ordered.find((slide) => slide.number === 1) || {};
  const parts = [
    post.source_title,
    '',
    'SLIDES',
    '',
    'Slide 1 - Capa',
    'Headline:',
    cover.title || '',
    'Subheadline:',
    cover.body || '',
  ];
  if (cover.prompt) {
    parts.push('Descrição da imagem (Gemini - clone):', cover.prompt);
  }
  for (const slide of ordered.filter((item) => item.number > 1)) {
    const marker = slide.slot === 'cta'
      ? 'CTA'
      : (slide.slot === 'fechamento' ? 'Fechamento' : (slide.title || `Slide ${slide.number}`));
    parts.push('', `Slide ${slide.number} - ${marker}`);
    if (slide.slot === 'fechamento') {
      parts.push('Palavra destaque:', slide.title || 'ATENÇÃO', slide.body || '');
    } else {
      parts.push('Título do assunto:', slide.title || '', 'Texto:', slide.body || '');
    }
    if (slide.prompt) parts.push('Descrição da imagem de fundo:', slide.prompt);
  }
  return parts.join('\n');
}

function buildClientText(post, slides, client) {
  if (client.parser_type === 'health_post_unico') return buildHealthText(post, slides);
  return buildWellnessText(post, slides);
}

function runRender(scriptPath, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath || defaultRenderScript, encodePayload(payload)], {
      cwd: '/data/studio',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Tempo limite excedido ao gerar artes.'));
    }, 20 * 60_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const text = stdout.trim();
      let result = null;
      try {
        result = JSON.parse(text.slice(text.lastIndexOf('\n{') + 1));
      } catch (error) {
        reject(new Error(`Render retornou resposta inválida. stdout=${text.slice(0, 500)} stderr=${stderr.slice(0, 500)}`));
        return;
      }
      if (code !== 0 || result.status === 'error') {
        reject(new Error(result.error || result.response || stderr || `Render finalizou com código ${code}`));
        return;
      }
      resolve(result);
    });
  });
}

async function claimJob() {
  if (!schemaReady) await ensureSchema();
  const result = await pool.query(`
    update generation_jobs set status = 'running', started_at = now(), updated_at = now()
    where id = (
      select id from generation_jobs
      where status = 'pending'
      order by created_at
      for update skip locked
      limit 1
    )
    returning *
  `);
  return result.rows[0] || null;
}

async function ensureSchema() {
  await pool.query(`
    create table if not exists clients (
      id text primary key,
      slug text unique not null,
      name text not null,
      drive_folder_id text,
      clone_folder_id text,
      parser_type text not null default 'wellness_post_unico',
      render_script text not null default '/data/studio/gcm-wellness-post-unico.js',
      status text not null default 'active',
      created_at timestamptz not null default now()
    );
    alter table clients add column if not exists parser_type text not null default 'wellness_post_unico';
    alter table clients add column if not exists render_script text not null default '/data/studio/gcm-wellness-post-unico.js';
    create table if not exists generation_jobs (
      id text primary key,
      post_id text not null references posts(id) on delete cascade,
      status text not null default 'pending',
      error text,
      result_json jsonb,
      output_dir text,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists post_assets (
      id text primary key,
      post_id text not null references posts(id) on delete cascade,
      role text not null default 'internal',
      file_path text not null,
      original_name text not null default '',
      mime_type text not null default '',
      size_bytes int not null default 0,
      display_order int not null default 0,
      credit text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table generation_jobs add column if not exists clone_drive_status text;
    alter table generation_jobs add column if not exists clone_drive_folder_id text;
    alter table generation_jobs add column if not exists clone_drive_folder_link text;
    alter table generation_jobs add column if not exists clone_drive_error text;
    alter table generation_jobs add column if not exists clone_drive_saved_at timestamptz;
  `);
  schemaReady = true;
}

function safeGeneratedPath(job, relativeFile) {
  const root = path.resolve(renderedRoot);
  const outputDir = path.resolve(String(job?.output_dir || ''));
  if (!outputDir.startsWith(`${root}${path.sep}`)) throw new Error('Pasta de geração inválida.');
  const cleanRelative = String(relativeFile || '').replace(/^\/+/, '');
  if (!cleanRelative || cleanRelative.includes('\0') || path.isAbsolute(cleanRelative)) throw new Error('Arquivo inválido.');
  const target = path.resolve(outputDir, cleanRelative);
  if (!target.startsWith(`${outputDir}${path.sep}`)) throw new Error('Arquivo fora da pasta da geração.');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('Arquivo não encontrado.');
  return target;
}

function cloneFileList(job, postTitle) {
  const result = job?.result_json || {};
  const outputDir = String(job?.output_dir || '').replace(/\/+$/, '');
  const covers = Array.isArray(result.generated_covers) ? result.generated_covers : [];
  const files = covers.map((cover) => {
    const absolute = String(cover?.file || '');
    if (!absolute || !absolute.startsWith(`${outputDir}/`)) return null;
    const relative = absolute.slice(outputDir.length + 1);
    try {
      safeGeneratedPath(job, relative);
      const slide = String(cover?.slide || '1').padStart(2, '0');
      return {
        path: relative,
        name: `${postTitle} - clone slide ${slide}.png`,
      };
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
  return files.filter((file, index, list) => list.findIndex((item) => item.path === file.path) === index);
}

function driveDateParts(post, job) {
  const base = new Date(job?.created_at || post?.created_at || Date.now());
  return {
    year: String(base.getFullYear()),
    month: String(base.getMonth() + 1).padStart(2, '0'),
  };
}

async function callDriveSave(payload) {
  const response = await fetch(driveSaveWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: driveSaveSecret, ...payload }),
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Resposta inválida do n8n: ${text.slice(0, 500)}`);
  }
  if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `n8n respondeu HTTP ${response.status}`);
  return data;
}

async function autoSaveGeneratedClones(post, job, result) {
  const jobForFiles = {
    ...job,
    output_dir: result.output_dir || '',
    result_json: result,
  };
  const cloneFiles = cloneFileList(jobForFiles, post.source_title);
  if (!post.clone_folder_id || !cloneFiles.length) return;
  if (!driveSaveWebhookUrl || !driveSaveSecret) {
    await pool.query(`
      update generation_jobs
      set clone_drive_status = 'failed',
        clone_drive_error = $1,
        updated_at = now()
      where id = $2
    `, ['Webhook do Drive não configurado no worker.', job.id]);
    return;
  }
  const { year, month } = driveDateParts(post, job);
  try {
    await pool.query("update generation_jobs set clone_drive_status = 'saving', clone_drive_error = null, updated_at = now() where id = $1", [job.id]);
    const cloneData = await callDriveSave({
      base_folder_id: post.clone_folder_id,
      year,
      month,
      post_name: post.source_title,
      post_folder_id: post.clone_folder_id,
      output_dir: jobForFiles.output_dir,
      files: cloneFiles,
    });
    await pool.query(`
      update generation_jobs
      set clone_drive_status = 'saved',
        clone_drive_folder_id = $1,
        clone_drive_folder_link = $2,
        clone_drive_error = null,
        clone_drive_saved_at = now(),
        updated_at = now()
      where id = $3
    `, [cloneData.drive_folder_id || '', cloneData.drive_folder_link || '', job.id]);
  } catch (error) {
    await pool.query(`
      update generation_jobs
      set clone_drive_status = 'failed',
        clone_drive_error = $1,
        updated_at = now()
      where id = $2
    `, [String(error.message || error), job.id]);
  }
}

async function processJob(job) {
  const postResult = await pool.query(`
    select posts.*, clients.parser_type, clients.render_script, clients.clone_folder_id
    from posts
    join clients on clients.id = posts.client_id
    where posts.id = $1
  `, [job.post_id]);
  if (!postResult.rowCount) throw new Error('Post não encontrado para geração.');
  const slides = await pool.query('select * from slides where post_id = $1 order by number', [job.post_id]);
  const post = postResult.rows[0];
  let result;
  if (post.parser_type === 'community_manual') {
    const assets = await pool.query(`
      select *
      from post_assets
      where post_id = $1
      order by case when role = 'cover' then 0 else 1 end, display_order, created_at
    `, [job.post_id]);
    let coverPayload = {};
    if (post.type === 'cover_only') {
      try {
        coverPayload = JSON.parse(post.source_text || '{}');
      } catch (error) {
        coverPayload = {};
      }
    }
    result = await runRender(post.render_script, {
      ...coverPayload,
      mode: post.type === 'cover_only' ? 'cover_only' : undefined,
      text: post.source_text,
      source_title: post.source_title,
      source: 'green-content-studio',
      post_id: job.post_id,
      job_id: job.id,
      chat_id: `dashboard-community-${job.post_id}-${job.id}`,
      assets: assets.rows.map((asset) => ({
        role: asset.role,
        file_path: asset.file_path,
        credit: asset.credit,
        order: asset.display_order,
      })),
    });
  } else {
    const text = buildClientText(post, slides.rows, post);
    result = await runRender(post.render_script, {
      text,
      source: 'green-content-studio',
      post_id: job.post_id,
      job_id: job.id,
      chat_id: `dashboard-${job.post_id}`,
    });
  }
  await pool.query(`
    update generation_jobs
    set status = 'completed', result_json = $1, output_dir = $2, finished_at = now(), updated_at = now()
    where id = $3
  `, [result, result.output_dir || '', job.id]);
  await autoSaveGeneratedClones(post, job, result);
  await pool.query("update posts set status = 'generated', updated_at = now() where id = $1", [job.post_id]);
}

async function tick() {
  await cleanupOldRendersIfNeeded();
  const job = await claimJob();
  if (!job) return;
  console.log(`${appName} processing job ${job.id}`);
  try {
    await processJob(job);
    console.log(`${appName} completed job ${job.id}`);
  } catch (error) {
    console.error(`${appName} failed job ${job.id}`, error);
    await pool.query(`
      update generation_jobs
      set status = 'failed', error = $1, finished_at = now(), updated_at = now()
      where id = $2
    `, [String(error.stack || error.message || error), job.id]);
    await pool.query("update posts set status = 'draft', updated_at = now() where id = $1", [job.post_id]);
  }
}

async function cleanupOldRendersIfNeeded() {
  const now = Date.now();
  if (now - lastCleanupAt < 24 * 60 * 60 * 1000) return;
  lastCleanupAt = now;
  await cleanupOldRenders();
}

async function cleanupOldRenders() {
  if (!retentionDays || retentionDays < 1) return;
  const fs = require('fs/promises');
  const path = require('path');
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let entries = [];
  try {
    entries = await fs.readdir(renderedRoot, { withFileTypes: true });
  } catch (error) {
    console.error(`${appName} cleanup skipped`, error.message || error);
    return;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(renderedRoot, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs >= cutoff) continue;
      await fs.rm(fullPath, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      console.error(`${appName} cleanup failed for ${fullPath}`, error.message || error);
    }
  }
  if (removed) console.log(`${appName} cleanup removed ${removed} render folders older than ${retentionDays} days`);
}

console.log(`${appName} started at ${new Date().toISOString()}`);
setInterval(() => {
  if (tickRunning) return;
  tickRunning = true;
  tick()
    .catch((error) => console.error(`${appName} tick failed`, error))
    .finally(() => {
      tickRunning = false;
    });
}, 5000);
tickRunning = true;
tick()
  .catch((error) => console.error(`${appName} initial tick failed`, error))
  .finally(() => {
    tickRunning = false;
  });
