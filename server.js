const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const AdmZip = require('adm-zip');
const { Pool } = require('pg');
const { createStudioFeed } = require('./studio-module/studio.cjs');
const { createStatistics } = require('./statistics/studio.cjs');
const { createImageJobs } = require('./image-jobs/studio.cjs');
const { createEditorial } = require('./community-editorial/studio.cjs');
const { createSocialConnections } = require('./social-connections/studio.cjs');
const { createSocialPublishing } = require('./social-publishing/studio.cjs');
const { createSocialStatistics } = require('./social-statistics/studio.cjs');
const { SocialError } = require('./social-connections/security.cjs');
const { createContentStudio } = require('./content-studio/studio.cjs');
const communityImageQuality = require('./community-editorial/image-quality.cjs');
const documentSecurity = require('./community-editorial/documents.cjs');

const port = Number(process.env.PORT || 3000);
const appName = process.env.APP_NAME || 'Green Content Studio';
const startedAt = new Date().toISOString();
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const driveSaveWebhookUrl = process.env.N8N_DRIVE_SAVE_WEBHOOK_URL || '';
const driveSaveSecret = process.env.N8N_DRIVE_SAVE_SECRET || '';
const uploadRoot = process.env.GCS_UPLOAD_ROOT || '/data/studio/uploads/dashboard';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const communityFeed = createStudioFeed({studioPool:pool,Pool,layout});
const communityStatistics = createStatistics({Pool,layout});
const communityImages = createImageJobs({studioPool:pool,Pool,layout,generate:generateOpenAiImage,editGenerate:(prompt,outPath,quality,ref)=>require('./community-editorial/image-edit.cjs').generate({root:uploadRoot,key:readOpenAiKey(),model:process.env.COMMUNITY_IMAGE_MODEL||process.env.WELLNESS_IMAGE_MODEL||'gpt-image-2',size:process.env.COMMUNITY_IMAGE_SIZE||'1024x1536',prompt,outPath,quality,ref}),uploadRoot,coverPayloadFromFields,coverPayloadFromPost});
const communityEditorial = createEditorial({studioPool:pool,Pool,uploadRoot,readOpenAiKey});
const socialConnections = createSocialConnections({pool,layout,uploadRoot});
const socialPublishing = createSocialPublishing({pool,layout,uploadRoot});
const socialStatistics = createSocialStatistics({pool,layout});
const contentStudio = createContentStudio({pool,layout,secret:sessionSecret,connectionsLink:(slug,user)=>socialConnections.link(slug,user),publishingLink:(slug,user)=>socialPublishing.link(slug,user)});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout({ title, user, body }) {
  const navClients = Array.isArray(user?.nav_clients) ? user.nav_clients : [];
  const clientsMenu = navClients.length
    ? navClients.map((client) => `<a class="side-sub-link" href="/clients/${escapeHtml(client.slug)}">${escapeHtml(client.name)}</a>`).join('')
    : '<span class="side-empty">Nenhum cliente cadastrado</span>';
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · ${escapeHtml(appName)}</title>
  <style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17211d;background:#f5f7f3}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:#f5f7f3}
    a{color:#245b45;text-decoration:none}
    a:hover{text-decoration:underline}
    .brand{display:flex;align-items:center;gap:10px;font-weight:750}
    .mark{width:28px;height:28px;border-radius:7px;background:#245b45}
    .app-shell{min-height:100vh;display:grid;grid-template-columns:270px 1fr}
    .sidebar{background:#fff;border-right:1px solid #dce3d7;padding:20px 14px;position:sticky;top:0;height:100vh;overflow:auto}
    .sidebar .brand{padding:0 8px 22px}
    .side-nav{display:grid;gap:6px}
    .side-link,.side-sub-link,.side-section summary{border-radius:7px;color:#314139;display:flex;align-items:center;min-height:38px;padding:9px 10px;font-size:14px;font-weight:700}
    .side-link:hover,.side-sub-link:hover,.side-section summary:hover{background:#f1f5ee;text-decoration:none}
    .side-section{border-top:1px solid #edf1ea;margin-top:8px;padding-top:8px}
    .side-section summary{cursor:pointer;list-style:none;justify-content:space-between}
    .side-section summary::-webkit-details-marker{display:none}
    .side-section summary:after{content:"▾";font-size:12px;color:#66756c}
    .side-section:not([open]) summary:after{content:"▸"}
    .side-submenu{display:grid;gap:3px;margin:2px 0 0 10px;padding-left:10px;border-left:1px solid #dce3d7}
    .side-sub-link{font-weight:650;color:#526159;min-height:34px;padding:8px 10px}
    .side-empty{display:block;color:#66756c;font-size:13px;padding:8px 10px}
    .app-main{min-width:0}
    .topbar{height:58px;border-bottom:1px solid #dce3d7;background:#fff;display:flex;align-items:center;justify-content:flex-end;padding:0 22px;position:sticky;top:0;z-index:2}
    main{width:min(1180px,calc(100% - 36px));margin:28px auto 54px}
    .page-title{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:18px}
    h1{margin:0;font-size:28px;line-height:1.12}
    h2{margin:0 0 12px;font-size:18px}
    h3{margin:0 0 8px;font-size:15px}
    p{margin:0;color:#526159;line-height:1.55}
    .muted{color:#66756c;font-size:14px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    .two{display:grid;grid-template-columns:360px 1fr;gap:16px;align-items:start}
    .card{background:#fff;border:1px solid #dce3d7;border-radius:8px;padding:18px;box-shadow:0 10px 28px rgba(23,33,29,.05)}
    .card.tight{padding:14px}
    .stat{font-size:28px;font-weight:760;margin-bottom:4px}
    .btn{appearance:none;border:1px solid #245b45;background:#245b45;color:#fff;border-radius:7px;padding:10px 13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
    .btn.secondary{background:#fff;color:#245b45}
    .btn.danger{border-color:#9b3131;background:#9b3131}
    input,textarea,select{width:100%;border:1px solid #ccd5c8;border-radius:7px;padding:10px 11px;font:inherit;background:#fff;color:#17211d}
    textarea{min-height:220px;resize:vertical;line-height:1.45}
    label{display:block;font-size:13px;font-weight:700;color:#3d4b42;margin:0 0 6px}
    .field{margin-bottom:14px}
    .actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
    .list{display:grid;gap:10px}
    .item{border:1px solid #e0e6dc;border-radius:8px;padding:14px;background:#fbfcfa}
    .badge{display:inline-flex;align-items:center;border:1px solid #d0dacb;border-radius:999px;padding:3px 8px;font-size:12px;color:#506057;background:#f6f8f4}
    .slide{display:grid;grid-template-columns:82px 1fr;gap:12px;border-top:1px solid #e8ece5;padding-top:16px;margin-top:16px}
    .slide-no{font-weight:760;color:#245b45}
    .asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-top:14px}
    .asset{border:1px solid #e0e6dc;border-radius:8px;background:#fbfcfa;padding:10px}
    .asset img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px;border:1px solid #d8dfd4;background:#eef2ea;display:block}
    .asset figcaption{margin-top:8px;font-size:13px;color:#526159}
    .upload-grid{display:grid;grid-template-columns:1fr 160px 1fr auto;gap:12px;align-items:end}
    .media-row{display:grid;grid-template-columns:96px 130px 88px 1fr auto;gap:12px;align-items:center;border-top:1px solid #e8ece5;padding-top:12px;margin-top:12px}
    .media-row img{width:96px;aspect-ratio:4/5;object-fit:cover;border-radius:6px;border:1px solid #d8dfd4;background:#eef2ea;display:block}
    .media-row .field{margin-bottom:0}
    .login-wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
    .login{width:min(440px,100%);background:#fff;border:1px solid #dce3d7;border-radius:8px;padding:26px;box-shadow:0 18px 50px rgba(23,33,29,.08)}
    .error{border:1px solid #e2b6b6;background:#fff4f4;color:#812b2b;border-radius:7px;padding:10px 12px;margin-bottom:14px}
    .notice{border:1px solid #b7d9c4;background:#f2fbf5;color:#245b45;border-radius:7px;padding:10px 12px;margin-bottom:14px}
    .warn{border:1px solid #e3d09c;background:#fff9e8;color:#6b5012;border-radius:7px;padding:10px 12px;margin-bottom:14px}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#eef2ea;padding:2px 6px;border-radius:4px;overflow-wrap:anywhere;word-break:break-word}
    .slide>div{min-width:0}.slide textarea{min-height:96px}.slide textarea[name^="prompt_"]{min-height:120px}.slide .actions .btn{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}
    @media(max-width:860px){.app-shell{grid-template-columns:1fr}.sidebar{position:relative;height:auto;border-right:0;border-bottom:1px solid #dce3d7}.topbar{position:relative;padding:0 14px}.grid,.two,.upload-grid,.media-row{grid-template-columns:1fr}main{width:min(calc(100% - 24px),1180px)}.page-title{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
${user ? `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="mark"></span><span>${escapeHtml(appName)}</span></div><nav class="side-nav"><a class="side-link" href="/dashboard">Dashboard</a>${contentStudio.adminLink(user)}<details class="side-section" open><summary>Clientes</summary><div class="side-submenu">${clientsMenu}</div></details></nav></aside><div class="app-main"><header class="topbar"><form method="post" action="/logout"><button class="btn secondary" type="submit">Sair</button></form></header><main>${body}</main></div></div>` : body}
</body>
</html>`;
}

function editorialReturn(value) { return process.env.FR2_EDITORIAL_ENABLED === 'true' && /^\/community\/editorial(?:\/[a-f0-9-]{36})?$/.test(String(value || '')) ? value : '/dashboard'; }

function loginPage(error = '', next = '') {
  return layout({
    title: 'Entrar',
    body: `<div class="login-wrap"><form class="login" method="post" action="/login">
      <div class="brand" style="margin-bottom:20px"><span class="mark"></span><span>${escapeHtml(appName)}</span></div>
      <input type="hidden" name="next" value="${escapeHtml(editorialReturn(next))}">
      <h1 style="margin-bottom:8px">Entrar no painel</h1>
      <p style="margin-bottom:20px">Acesso ao painel de produção de conteúdo.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label>Senha</label><input name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn" type="submit">Entrar</button>
    </form></div>`,
  });
}

function parseCookies(req) {
  const cookie = req.headers.cookie || '';
  return Object.fromEntries(cookie.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function sessionCookie(token) {
  return `gcs_session=${encodeURIComponent(`${token}.${sign(token)}`)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 14}`;
}

function clearCookie() {
  return 'gcs_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [, salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const candidate = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}

async function bodyText(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Arquivo ou texto muito grande para este formulário.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function formData(req) {
  const raw = await bodyText(req);
  return Object.fromEntries(new URLSearchParams(raw));
}

async function bodyBuffer(req, limit = 60_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Arquivo muito grande para upload.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function parseContentDisposition(value) {
  const out = {};
  for (const part of String(value || '').split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    const key = rawKey.trim().toLowerCase();
    if (!rawValue.length) continue;
    out[key] = rawValue.join('=').trim().replace(/^"|"$/g, '');
  }
  return out;
}

async function multipartData(req, limit = 60_000_000) {
  const type = req.headers['content-type'] || '';
  const boundary = type.match(/boundary=([^;]+)/i)?.[1];
  if (!boundary) throw new Error('Upload inválido.');
  const raw = await bodyBuffer(req, limit);
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  for (let part of splitBuffer(raw, boundaryBuffer).slice(1)) {
    if (part.subarray(0, 2).toString() === '--') continue;
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(-2).toString() === '\r\n') part = part.subarray(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;
    const headerLines = part.subarray(0, headerEnd).toString('utf8').split('\r\n');
    const content = part.subarray(headerEnd + 4);
    const headers = Object.fromEntries(headerLines.map((line) => {
      const index = line.indexOf(':');
      return index > 0 ? [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()] : ['', ''];
    }).filter(([key]) => key));
    const disposition = parseContentDisposition(headers['content-disposition']);
    if (!disposition.name) continue;
    if (disposition.filename !== undefined) {
      if (!disposition.filename || !content.length) continue;
      files.push({
        field: disposition.name,
        filename: path.basename(disposition.filename),
        mime: headers['content-type'] || 'application/octet-stream',
        buffer: content,
      });
    } else {
      fields[disposition.name] = content.toString('utf8');
    }
  }
  return { fields, files };
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function textFromDocxBuffer(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('DOCX inválido: não encontrei word/document.xml.');
  const xml = entry.getData().toString('utf8');
  const paragraphs = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)]
    .map((match) => [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
      .map((part) => part[1] !== undefined ? decodeXml(part[1]) : '\n')
      .join('')
      .replace(/\u00a0/g, ' ')
      .trim())
    .filter(Boolean);
  const text = paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('Não consegui extrair texto do DOCX.');
  return text;
}

function splitBulkPosts(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  const matches = [...source.matchAll(/^\s*\[POST\s+\d+\][^\n]*$/gim)];
  if (!matches.length) throw new Error('Não encontrei blocos começando com [POST X] no DOCX.');
  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    return source.slice(start, end).trim();
  }).filter(Boolean);
}

function monthLabelFromText(text) {
  const match = String(text || '').match(/\bM[eê]s\s*(\d+)\b/i);
  return match ? `Mês ${Number(match[1])}` : '';
}

function bulkMonthLabelFromFilename(filename) {
  const match = String(filename || '').match(/(?:^|[_\s-])m[eê]s\s*(\d+)|(?:^|[_\s-])mes\s*(\d+)/i);
  const value = match?.[1] || match?.[2] || '';
  return value ? `Mês ${Number(value)}` : '';
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { location, ...headers });
  res.end();
}

function sendHtml(res, html, status = 200, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function publicDocument(title, content) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · ${escapeHtml(appName)}</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17211d;background:#f5f7f3}
    *{box-sizing:border-box}body{margin:0}main{width:min(760px,calc(100% - 32px));margin:0 auto;padding:48px 0 72px}
    header{border-bottom:1px solid #dce3d7;padding-bottom:22px;margin-bottom:28px}.brand{display:flex;align-items:center;gap:10px;color:#17211d;font-weight:750;text-decoration:none}
    .mark{width:28px;height:28px;border-radius:7px;background:#245b45}h1{font-size:32px;line-height:1.15;margin:28px 0 8px}h2{font-size:20px;margin:30px 0 8px}
    p,li{color:#46574e;line-height:1.65}ul,ol{padding-left:24px}a{color:#245b45}nav{display:flex;gap:16px;flex-wrap:wrap;margin-top:34px;padding-top:20px;border-top:1px solid #dce3d7;font-size:14px}
    .updated{font-size:14px;color:#66756c}@media(max-width:560px){main{padding-top:28px}h1{font-size:27px}}
  </style>
</head>
<body><main><header><a class="brand" href="/login"><span class="mark"></span><span>${escapeHtml(appName)}</span></a></header>${content}
<nav><a href="/privacy">Privacidade</a><a href="/terms">Termos de Uso</a><a href="/data-deletion">Exclusão de Dados</a><a href="/login">Entrar</a></nav></main></body>
</html>`;
}

function privacyPage() {
  return publicDocument('Política de Privacidade', `<h1>Política de Privacidade</h1><p class="updated">Última atualização: 13 de outubro de 2026.</p>
    <p>Esta política descreve como a Green Comunicação e Automação trata dados no Green Content Studio, uma plataforma de produção, aprovação, agendamento e publicação de conteúdo para clientes autorizados.</p>
    <h2>Dados tratados</h2><ul><li>Dados de cadastro e acesso dos usuários da plataforma.</li><li>Identificadores e nomes das Páginas do Facebook e contas profissionais do Instagram escolhidas durante a conexão.</li><li>Permissões concedidas pela Meta e credenciais de acesso necessárias à integração, armazenadas de forma criptografada.</li><li>Conteúdos, legendas, mídias, datas de agendamento, resultados de publicação e registros técnicos de auditoria.</li></ul>
    <h2>Finalidades</h2><p>Usamos esses dados para autenticar usuários, mostrar as contas que eles administram, preparar e executar publicações autorizadas, apresentar resultados, prevenir duplicidade e abuso, investigar falhas e cumprir obrigações legais e de segurança.</p>
    <h2>Compartilhamento</h2><p>Os dados são transmitidos à Meta somente para autenticação, consulta das contas autorizadas e execução das ações solicitadas. Também podem ser processados pelos provedores estritamente necessários à hospedagem, ao banco de dados e ao armazenamento da plataforma. Não vendemos dados pessoais.</p>
    <h2>Segurança e retenção</h2><p>Aplicamos controle de acesso por cliente, proteção contra requisições indevidas, criptografia das credenciais e registros de auditoria. Tokens são removidos da plataforma quando a conexão é desfeita. Conteúdos e registros podem ser mantidos durante a prestação do serviço e pelo período necessário à segurança, auditoria e cumprimento de obrigações. Mídias aprovadas para publicação podem ser preservadas por pelo menos 60 dias após a data agendada.</p>
    <h2>Seus direitos</h2><p>Você pode pedir confirmação do tratamento, acesso, correção, portabilidade, oposição ou exclusão, conforme aplicável. Consulte as <a href="/data-deletion">instruções de exclusão de dados</a>.</p>
    <h2>Contato</h2><p>Dúvidas e solicitações relacionadas à privacidade podem ser enviadas para <a href="mailto:contact@example.invalid">contact@example.invalid</a>.</p>`);
}

function termsPage() {
  return publicDocument('Termos de Uso', `<h1>Termos de Uso</h1><p class="updated">Última atualização: 13 de outubro de 2026.</p>
    <p>Estes termos regem o uso do Green Content Studio por clientes e usuários autorizados.</p>
    <h2>Uso autorizado</h2><p>O usuário deve ter autorização para administrar as Páginas do Facebook e contas profissionais do Instagram conectadas. É responsável pela legitimidade, precisão e direitos sobre textos, imagens, marcas e demais materiais que enviar ou aprovar.</p>
    <h2>Integração com a Meta</h2><p>A conexão ocorre pelo fluxo oficial da Meta. O usuário escolhe quais ativos disponibilizar, pode desconectá-los da plataforma e pode revogar a autorização nas configurações da Meta. O uso também está sujeito aos termos e políticas aplicáveis do Facebook e do Instagram.</p>
    <h2>Publicações</h2><p>Somente conteúdos e horários confirmados por usuário autorizado podem ser enviados para publicação. A plataforma registra o resultado separadamente por rede. Indisponibilidade, limitação ou alteração das APIs externas pode impedir ou atrasar uma publicação.</p>
    <h2>Segurança</h2><p>Credenciais de acesso são pessoais e não devem ser compartilhadas. O usuário deve comunicar suspeitas de uso indevido e manter corretos os acessos concedidos às suas contas sociais.</p>
    <h2>Suspensão e encerramento</h2><p>O acesso pode ser suspenso em caso de uso ilícito, violação de direitos, risco de segurança ou descumprimento destes termos. Ao encerrar o uso, o cliente pode desconectar as contas e solicitar a exclusão dos dados aplicáveis.</p>
    <h2>Contato</h2><p>Questões sobre estes termos podem ser enviadas para <a href="mailto:contact@example.invalid">contact@example.invalid</a>.</p>`);
}

function dataDeletionPage() {
  return publicDocument('Exclusão de Dados', `<h1>Exclusão de Dados</h1><p class="updated">Última atualização: 13 de outubro de 2026.</p>
    <p>Você pode remover a conexão com Facebook e Instagram e solicitar a exclusão dos dados associados ao Green Content Studio.</p>
    <h2>Desconectar as contas</h2><ol><li>Entre no Green Content Studio.</li><li>Abra o cliente correspondente e acesse <strong>Facebook e Instagram</strong>.</li><li>Selecione <strong>Desconectar</strong> em cada rede vinculada.</li></ol><p>A desconexão remove da plataforma a credencial criptografada daquela conta e impede novas publicações por essa conexão.</p>
    <h2>Revogar diretamente na Meta</h2><p>Você também pode abrir as configurações da sua conta no Facebook, acessar as integrações empresariais e remover o Green Content Studio. Essa revogação impede o uso futuro da autorização concedida.</p>
    <h2>Solicitar exclusão completa</h2><p>Envie um e-mail para <a href="mailto:contact@example.invalid?subject=Exclus%C3%A3o%20de%20dados%20-%20Green%20Content%20Studio">contact@example.invalid</a> com o assunto <strong>Exclusão de dados - Green Content Studio</strong>. Informe o e-mail cadastrado, o nome do cliente e as contas sociais que deseja remover. Nunca envie senha, token ou código de autenticação.</p>
    <p>Confirmaremos a identidade e concluiremos a solicitação em até 30 dias. Alguns registros podem ser preservados pelo prazo necessário para cumprir obrigações legais, prevenir fraude, manter a segurança e comprovar operações previamente autorizadas; quando possível, serão anonimizados.</p>`);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, { downloadName = '', inline = false } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === '.png' ? 'image/png' : (['.jpg', '.jpeg'].includes(ext) ? 'image/jpeg' : (ext === '.webp' ? 'image/webp' : (ext === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream')));
  const name = downloadName || path.basename(filePath);
  res.writeHead(200, {
    'content-type': type,
    'content-length': fs.statSync(filePath).size,
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/"/g, '')}"`,
  });
  fs.createReadStream(filePath).pipe(res);
}

function firstMatch(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[1].trim() : '';
}

function cleanLabelValue(value) {
  return String(value || '').replace(/^\s*(headline|subheadline|t[ií]tulo|texto)\s*:\s*/i, '').trim();
}

function cleanHealthLabelValue(value) {
  return String(value || '')
    .replace(/^\s*(headline|subheadline|t[ií]tulo(?:\s+do\s+assunto)?(?:\s*\([^)]*\))?|texto|descri[cç][aã]o\s+da\s+imagem(?:\s+de\s+fundo)?(?:\s*\([^)]*\))?)\s*:\s*/i, '')
    .trim();
}

function valueAfterLabel(block, labelRegex, stopRegex) {
  const source = String(block || '');
  const match = source.match(labelRegex);
  if (!match) return '';
  const body = source.slice(match.index + match[0].length);
  const stop = body.search(stopRegex);
  return cleanLabelValue((stop >= 0 ? body.slice(0, stop) : body).trim());
}

function extractBetween(text, startRegex, endRegex) {
  const source = String(text || '');
  const start = source.search(startRegex);
  if (start < 0) return '';
  const after = source.slice(start);
  const firstNewLine = after.indexOf('\n');
  const body = firstNewLine >= 0 ? after.slice(firstNewLine + 1) : after;
  const end = body.search(endRegex);
  return (end >= 0 ? body.slice(0, end) : body).trim();
}

function parseWellnessPost(rawText) {
  return require('./wellness-content.cjs').parseWellnessPost(rawText);
}

function parseHealthPost(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text || text.length < 80) throw new Error('Cole o conteúdo completo do post.');
  const firstLine = text.split(/\n/).map((line) => line.trim()).find(Boolean) || '';
  const postTitle = firstMatch(text, /^\s*(\[POST[^\n]+)$/im) || firstLine || 'Post Único Dra Health Example';
  const coverBlock = extractBetween(text, /Slide\s+1\s*[–—-]\s*Capa/i, /\n\s*Slide\s+2\b/i);
  const coverPrompt = valueAfterLabel(
    coverBlock,
    /Op[cç][aã]o\s+A\s*[–—-][^\n]*:\s*/i,
    /\n\s*Op[cç][aã]o\s+B\s*[–—-]|\n\s*Elementos\s+visuais\s*:/i,
  ) || valueAfterLabel(
    coverBlock,
    /Descri[cç][aã]o\s+da\s+imagem\s*\([^)]*Gemini[^)]*\)\s*:\s*/i,
    /\n\s*Elementos\s+visuais\s*:|\n\s*Slide\s+\d+\b/i,
  );
  const slides = [{
    number: 1,
    slot: 'capa',
    title: cleanHealthLabelValue(valueAfterLabel(coverBlock, /Headline\s*:\s*/i, /\n\s*(Subheadline|Op[cç][aã]o\s+[AB]|Descri[cç][aã]o\s+da\s+imagem|Elementos\s+visuais|Slide\s+\d+)\b/i)),
    body: cleanHealthLabelValue(valueAfterLabel(coverBlock, /Subheadline\s*:\s*/i, /\n\s*(Op[cç][aã]o\s+[AB]|Descri[cç][aã]o\s+da\s+imagem|Elementos\s+visuais|Slide\s+\d+)\b/i)),
    prompt: coverPrompt,
  }];
  const slideMatches = [...text.matchAll(/^[\t ]*Slide[\t ]+(\d+)(?:[\t ]*[–—-][\t ]*([^\n]+))?[\t ]*$/gim)];
  for (let i = 0; i < slideMatches.length; i += 1) {
    const match = slideMatches[i];
    const declared = Number(match[1]);
    if (declared <= 1) continue;
    const start = match.index + match[0].length;
    const end = i + 1 < slideMatches.length ? slideMatches[i + 1].index : text.search(/\n\s*LEGENDA\b/i);
    const block = text.slice(start, end >= 0 ? end : text.length).trim();
    const marker = cleanHealthLabelValue(match[2] || '');
    const isClosing = /fechamento/i.test(marker) || /Palavra\s+destaque/i.test(block);
    const isCta = /cta|padr[aã]o/i.test(marker) || /\(Slide\s+fixo/i.test(block);
    let title = cleanHealthLabelValue(valueAfterLabel(
      block,
      /T[ií]tulo(?:\s+do\s+assunto)?(?:\s*\([^)]*\))?\s*:\s*/i,
      /\n\s*(Texto|Descri[cç][aã]o\s+da\s+imagem|Slide\s+\d+)\b/i,
    ));
    let body = cleanHealthLabelValue(valueAfterLabel(block, /Texto\s*:\s*/i, /\n\s*(Descri[cç][aã]o\s+da\s+imagem|Slide\s+\d+)\b/i));
    if (isClosing) {
      title = firstMatch(block, /Palavra\s+destaque\s*:\s*([^\n]+)/i) || title || 'ATENÇÃO';
      body = cleanHealthLabelValue(String(block || '')
        .replace(/Ícone\s*:[^\n]*\n?/i, '')
        .replace(/Palavra\s+destaque\s*:[^\n]*\n?/i, '')
        .replace(/Descri[cç][aã]o\s+da\s+imagem\s+de\s+fundo\s*:[\s\S]*$/i, '')
        .replace(/^[\t ]*IMAGEM\s*:[\s\S]*$/im, '')
        .trim());
    }
    const prompt = valueAfterLabel(
      block,
      /Descri[cç][aã]o\s+da\s+imagem\s+de\s+fundo\s*:\s*/i,
      /\n\s*Slide\s+\d+\b|\n\s*LEGENDA\b/i,
    );
    slides.push({
      number: slides.length + 1,
      slot: isCta ? 'cta' : (isClosing ? 'fechamento' : 'interno'),
      title: title || marker || `Slide ${declared}`,
      body,
      prompt,
    });
  }
  if (!slides[0].title || slides.length <= 1) throw new Error('Não consegui identificar Slide 1 - Capa e Slide 2.');
  if (slides.length > 1) slides[slides.length - 1].slot = 'cta';
  if (slides.length >= 3) {
    const finalSlide = slides[slides.length - 1];
    const previousSlide = slides[slides.length - 2];
    if (finalSlide.slot === 'cta' && previousSlide.slot === 'fechamento') {
      finalSlide.title = previousSlide.title || 'ATENÇÃO';
      finalSlide.body = finalSlide.body || previousSlide.body || '';
      finalSlide.prompt = '';
      slides.splice(slides.length - 2, 1);
    }
  }
  slides.forEach((slide, index) => {
    slide.number = index + 1;
  });
  return { sourceTitle: firstLine || postTitle, postTitle, slides };
}

function parseCommunityPost(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text || text.length < 30) throw new Error('Cole a notícia completa do Community News.');
  const title = firstMatch(text, /^\s*(?:t[ií]tulo|headline|manchete)\s*:\s*(.+)$/im)
    || text.split(/\n/).map((line) => line.trim()).find(Boolean)
    || 'Notícia Community News';
  return {
    sourceTitle: title,
    postTitle: title,
    slides: [],
  };
}

function parseClientPost(rawText, client) {
  if (client.parser_type === 'community_manual') return parseCommunityPost(rawText);
  if (client.parser_type === 'health_post_unico') return parseHealthPost(rawText);
  return parseWellnessPost(rawText);
}

function supportsBulkDocx(client) {
  return ['wellness_post_unico', 'health_post_unico'].includes(client?.parser_type);
}

function safeGeneratedPath(job, relativeFile) {
  const renderedRoot = path.resolve('/data/studio/rendered');
  const outputDir = path.resolve(String(job?.output_dir || ''));
  if (!outputDir.startsWith(`${renderedRoot}${path.sep}`)) throw new Error('Pasta de geração inválida.');
  const cleanRelative = String(relativeFile || '').replace(/^\/+/, '');
  if (!cleanRelative || cleanRelative.includes('\0') || path.isAbsolute(cleanRelative)) throw new Error('Arquivo inválido.');
  const target = path.resolve(outputDir, cleanRelative);
  if (!target.startsWith(`${outputDir}${path.sep}`)) throw new Error('Arquivo fora da pasta da geração.');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('Arquivo não encontrado.');
  return target;
}

function generatedSlideFiles(job, preferred = 'jpg') {
  const result = job?.result_json || {};
  const files = [];
  const labelFor = (item) => String(item?.slot || '').includes('reels')
    ? 'Capa Reels'
    : `Slide ${String(item.number || '').padStart(2, '0')}`;
  const jpgSlides = (result.jpg_slides || []).filter((item) => item?.jpg);
  if (preferred === 'jpg' && jpgSlides.length) {
    for (const item of jpgSlides) {
      files.push({ number: Number(item.number), label: labelFor(item), file: item.jpg, format: 'jpg', slot: item.slot || '' });
    }
    return files.filter((item, index, list) => list.findIndex((other) => other.file === item.file) === index);
  }
  for (const item of result.png_slides || []) {
    if (item?.png) {
      files.push({ number: Number(item.number), label: labelFor(item), file: item.png, format: 'png', slot: item.slot || '' });
    }
  }
  if (!files.length) {
    for (const item of result.slides || []) {
      if (item?.png) files.push({ number: Number(item.number), label: labelFor(item), file: item.png, format: 'png', slot: item.slot || '' });
    }
  }
  return files.filter((item, index, list) => list.findIndex((other) => other.file === item.file) === index);
}

function generatedAssetsHtml(job, postId) {
  const slideFiles = generatedSlideFiles(job);
  if (!slideFiles.length) return '';
  const hasJpg = slideFiles.some((item) => item.format === 'jpg');
  const contactSheet = 'contact_sheet.png';
  const driveStatus = job.drive_status || '';
  const driveBlock = job.drive_folder_link
    ? `<div class="notice" style="margin-top:12px">Salvo no Google Drive: <a href="${escapeHtml(job.drive_folder_link)}" target="_blank" rel="noreferrer">abrir pasta</a></div>`
    : (driveStatus === 'failed'
      ? `<div class="error" style="margin-top:12px">Erro ao salvar no Drive: ${escapeHtml(job.drive_error || 'erro não informado')}</div>`
      : '');
  const cloneBlock = job.clone_drive_folder_link
    ? `<div class="notice" style="margin-top:12px">Clone Gemini salvo: <a href="${escapeHtml(job.clone_drive_folder_link)}" target="_blank" rel="noreferrer">abrir pasta de clones</a></div>`
    : (job.clone_drive_status === 'failed'
      ? `<div class="error" style="margin-top:12px">Erro ao salvar clone Gemini: ${escapeHtml(job.clone_drive_error || 'erro não informado')}</div>`
      : '');
  return `<section class="card" style="margin-bottom:16px">
    <div class="page-title" style="margin:0 0 8px"><div><h2>Artes geradas</h2><p>Visualize as artes e baixe a versão otimizada.</p></div><a class="btn" href="/posts/${postId}/download-all">Baixar tudo ${hasJpg ? 'JPG' : 'PNG'} .zip</a></div>
    <div class="actions"><form method="post" action="/posts/${postId}/save-drive"><button class="btn" type="submit">Salvar no Drive</button></form><a class="btn secondary" href="/posts/${postId}/file?file=${encodeURIComponent(contactSheet)}&download=1">Baixar contact sheet</a></div>
    ${driveBlock}
    ${cloneBlock}
    <div class="asset-grid">${slideFiles.map((item) => `
      <figure class="asset">
        <a href="/posts/${postId}/file?file=${encodeURIComponent(item.file)}" target="_blank"><img src="/posts/${postId}/file?file=${encodeURIComponent(item.file)}&inline=1" alt="${escapeHtml(item.label)}"></a>
        <figcaption>${escapeHtml(item.label)} · ${escapeHtml(String(item.format || '').toUpperCase())}<div class="actions" style="margin-top:8px"><a class="btn secondary" href="/posts/${postId}/file?file=${encodeURIComponent(item.file)}&download=1">Baixar ${escapeHtml(String(item.format || 'png').toUpperCase())}</a></div></figcaption>
      </figure>
    `).join('')}</div>
  </section>`;
}

function downloadSlug(value, fallback = 'post') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

function zipSafeName(value, fallback = 'post') {
  return String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || fallback;
}

async function initDb() {
  await pool.query(`
    create table if not exists users (
      id text primary key,
      email text unique not null,
      password_hash text not null,
      name text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists sessions (
      token_hash text primary key,
      user_id text not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );
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
    create table if not exists posts (
      id text primary key,
      client_id text not null references clients(id) on delete cascade,
      type text not null,
      source_title text not null,
      source_text text not null,
      source_meta jsonb not null default '{}'::jsonb,
      status text not null default 'draft',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists slides (
      id text primary key,
      post_id text not null references posts(id) on delete cascade,
      number int not null,
      slot text not null,
      title text not null default '',
      body text not null default '',
      prompt text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists generation_jobs (
      id text primary key,
      post_id text not null references posts(id) on delete cascade,
      status text not null default 'pending',
      error text,
      result_json jsonb,
      output_dir text,
      drive_status text,
      drive_folder_id text,
      drive_folder_link text,
      drive_error text,
      drive_saved_at timestamptz,
      clone_drive_status text,
      clone_drive_folder_id text,
      clone_drive_folder_link text,
      clone_drive_error text,
      clone_drive_saved_at timestamptz,
      target_slide int,
      base_generation_id text,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz not null default now()
    );
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
    );
  `);
  await pool.query(`
    alter table clients add column if not exists parser_type text not null default 'wellness_post_unico';
    alter table clients add column if not exists render_script text not null default '/data/studio/gcm-wellness-post-unico.js';
  `);
  await pool.query("alter table posts add column if not exists source_meta jsonb not null default '{}'::jsonb");
  await pool.query(`
    alter table generation_jobs add column if not exists drive_status text;
    alter table generation_jobs add column if not exists drive_folder_id text;
    alter table generation_jobs add column if not exists drive_folder_link text;
    alter table generation_jobs add column if not exists drive_error text;
    alter table generation_jobs add column if not exists drive_saved_at timestamptz;
    alter table generation_jobs add column if not exists clone_drive_status text;
    alter table generation_jobs add column if not exists clone_drive_folder_id text;
    alter table generation_jobs add column if not exists clone_drive_folder_link text;
    alter table generation_jobs add column if not exists clone_drive_error text;
    alter table generation_jobs add column if not exists clone_drive_saved_at timestamptz;
    alter table generation_jobs add column if not exists target_slide int;
    alter table generation_jobs add column if not exists base_generation_id text;
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
    );
  `);

  await pool.query(`
    insert into clients (id, slug, name, drive_folder_id, clone_folder_id)
    values ($1, 'demo-wellness', 'Demo Wellness', '', '')
    on conflict (slug) do update set
      name = excluded.name,
      drive_folder_id = excluded.drive_folder_id,
      clone_folder_id = excluded.clone_folder_id,
      parser_type = 'wellness_post_unico',
      render_script = '/data/studio/gcm-wellness-post-unico.js'
  `, ['client_demo_wellness']);

  await pool.query(`
    insert into clients (id, slug, name, drive_folder_id, clone_folder_id, parser_type, render_script)
    values ($1, 'demo-health', 'Demo Health', '', '', 'health_post_unico', '/data/studio/gcm-health-post-unico.js')
    on conflict (slug) do update set
      name = excluded.name,
      drive_folder_id = excluded.drive_folder_id,
      clone_folder_id = excluded.clone_folder_id,
      parser_type = excluded.parser_type,
      render_script = excluded.render_script
  `, ['client_demo_health']);

  await pool.query(`
    insert into clients (id, slug, name, drive_folder_id, clone_folder_id, parser_type, render_script)
    values ($1, 'community', 'Community News', '', '', 'community_manual', '/data/studio/gcm-community-dashboard.js')
    on conflict (slug) do update set
      name = excluded.name,
      drive_folder_id = excluded.drive_folder_id,
      clone_folder_id = excluded.clone_folder_id,
      parser_type = excluded.parser_type,
      render_script = excluded.render_script
  `, ['client_community']);

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = await pool.query('select id from users where email = $1', [adminEmail]);
    if (!existing.rowCount) {
      await pool.query('insert into users (id, email, password_hash, name) values ($1, $2, $3, $4)', [
        crypto.randomUUID(),
        adminEmail,
        await hashPassword(adminPassword),
        'Admin',
      ]);
    }
  }
}

async function currentUser(req) {
  const raw = parseCookies(req).gcs_session || '';
  const [token, signature] = raw.split('.');
  if (!token || !signature || sign(token) !== signature) return null;
  const result = await pool.query(`
    select users.id, users.email, users.name
    from sessions
    join users on users.id = sessions.user_id
    where sessions.token_hash = $1 and sessions.expires_at > now()
  `, [hashToken(token)]);
  const user = result.rows[0] || null;
  if (!user) return null;
  if (socialConnections.enabled) return socialConnections.hydrate({...user,session_hash:hashToken(token)});
  const clients = await pool.query("select slug, name from clients where status = 'active' order by name");
  user.nav_clients = clients.rows;
  return user;
}

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    const next = editorialReturn(new URL(req.url, 'http://localhost').pathname);
    redirect(res, next === '/dashboard' ? '/login' : '/login?next=' + encodeURIComponent(next));
    return null;
  }
  return user;
}

async function dashboard(req, res, user) {
  if (socialConnections.enabled && !user.is_master) {
    const ids = user.nav_clients.map(c => c.id);
    const stats = await pool.query("SELECT count(*) AS posts,count(*) FILTER (WHERE status='draft') AS drafts FROM posts WHERE client_id=ANY($1::text[])", [ids]);
    return sendHtml(res, layout({title:'Dashboard',user,body:`<div class="page-title"><h1>Dashboard</h1></div>
      <p>${escapeHtml(stats.rows[0].posts)} posts · ${escapeHtml(stats.rows[0].drafts)} rascunhos</p>
      <div class="list">${user.nav_clients.map(c => `<a class="item" href="/clients/${escapeHtml(c.slug)}"><h3>${escapeHtml(c.name)}</h3></a>`).join('') || '<p>Nenhum cliente vinculado ao seu acesso.</p>'}</div>`}));
  }
  const stats = await pool.query(`
    select
      (select count(*) from clients) as clients,
      (select count(*) from posts) as posts,
      (select count(*) from posts where status = 'draft') as drafts
  `);
  const clients = await pool.query('select * from clients order by name');
  sendHtml(res, layout({ title: 'Dashboard', user, body: `
    <div class="page-title"><div><h1>Dashboard</h1><p>Central de produção dos conteúdos mensais e posts únicos.</p></div></div>
    <div class="grid">
      <section class="card"><div class="stat">${stats.rows[0].clients}</div><p>clientes cadastrados</p></section>
      <section class="card"><div class="stat">${stats.rows[0].posts}</div><p>posts no painel</p></section>
      <section class="card"><div class="stat">${stats.rows[0].drafts}</div><p>rascunhos em revisão</p></section>
    </div>
    <div class="page-title" style="margin-top:26px"><h2>Clientes</h2></div>
    <div class="list">${clients.rows.map((client) => `<a class="item" href="/clients/${client.slug}"><h3>${escapeHtml(client.name)}</h3><p>Drive final: <code>${escapeHtml(client.drive_folder_id || '-')}</code></p></a>`).join('')}</div>
  ` }));
}

function bulkResultsForClient(client) {
  if (!supportsBulkDocx(client)) return [];
  const directory = path.join(uploadRoot, 'bulk-results');
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const filename of fs.readdirSync(directory)) {
    const match = filename.match(/^([a-f0-9-]{36})\.json$/);
    if (!match) continue;
    try {
      const filePath = path.join(directory, filename);
      const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const ownerMatches = result.client?.id
        ? result.client.id === client.id
        : result.client?.slug === client.slug;
      if (!ownerMatches) continue;
      const posts = Array.isArray(result.created) ? result.created.length : 0;
      if (!posts) continue;
      results.push({
        id: match[1],
        filename: result.filename || '',
        monthLabel: result.monthLabel || '',
        year: result.year || '',
        posts,
        createdAt: fs.statSync(filePath).mtime,
      });
    } catch {
      // A damaged historical receipt must not hide the remaining bulk results.
    }
  }
  return results.sort((left, right) => right.createdAt - left.createdAt).slice(0, 100);
}

async function clientPage(req, res, user, slug) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount) return sendHtml(res, layout({ title: 'Cliente não encontrado', user, body: '<h1>Cliente não encontrado</h1>' }), 404);
  const posts = await pool.query('select * from posts where client_id = $1 order by created_at desc limit 20', [client.rows[0].id]);
  const bulkResults = bulkResultsForClient(client.rows[0]);
  const actionLabel = client.rows[0].parser_type === 'community_manual' ? 'Nova notícia Community News' : 'Novo Post Único';
  const actions = client.rows[0].parser_type === 'community_manual'
    ? `<div class="actions"><a class="btn" href="/clients/${client.rows[0].slug}/post-unico">${escapeHtml(actionLabel)}</a><a class="btn secondary" href="/clients/${client.rows[0].slug}/cover-only">Gerar somente capa</a><a class="btn secondary" href="/clients/${client.rows[0].slug}/ai-cover">Capa com imagem IA</a>${communityStatistics.link(client.rows[0].slug,user)}${communityEditorial.link(user)}${socialConnections.link(client.rows[0].slug,user)}</div>`
    : `<div class="actions"><a class="btn" href="/clients/${client.rows[0].slug}/post-unico">${escapeHtml(actionLabel)}</a>${supportsBulkDocx(client.rows[0]) ? `<a class="btn secondary" href="/clients/${client.rows[0].slug}/bulk-docx">Upload DOCX / Bulk</a><a class="btn secondary" href="#producoes-em-massa">Produções em massa</a>` : ''}${socialConnections.link(client.rows[0].slug,user)}${socialPublishing.link(client.rows[0].slug,user)}${socialStatistics.link(client.rows[0].slug,user)}</div>`;
  const creationAction = await contentStudio.link(client.rows[0].slug,user);
  const bulkHistory = supportsBulkDocx(client.rows[0]) ? `<section class="card" id="producoes-em-massa" style="margin-top:16px;scroll-margin-top:78px">
    <h2>Produções em massa</h2>
    <p class="muted" style="margin-bottom:14px">Cada arquivo mensal permanece agrupado com todos os posts criados.</p>
    <div class="list">${bulkResults.length ? bulkResults.map((result) => `<div class="item">
      <span class="badge">${escapeHtml([result.monthLabel,result.year].filter(Boolean).join(' · ') || 'Bulk')}</span>
      <h3 style="margin-top:8px">${escapeHtml(result.filename || result.monthLabel || 'Produção em massa')}</h3>
      <p>${escapeHtml(result.posts)} posts · ${escapeHtml(result.createdAt.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}))}</p>
      <div class="actions"><a class="btn secondary" href="/clients/${escapeHtml(client.rows[0].slug)}/bulk-docx/result/${escapeHtml(result.id)}">Abrir produção completa</a></div>
    </div>`).join('') : '<p>Nenhuma produção em massa encontrada.</p>'}</div>
  </section>` : '';
  sendHtml(res, layout({ title: client.rows[0].name, user, body: `
    <div class="page-title"><div><h1>${escapeHtml(client.rows[0].name)}</h1><p>Configuração inicial do cliente e histórico de posts.</p></div>${actions}</div>
    ${creationAction ? `<div class="actions" style="margin-bottom:18px">${creationAction}</div>` : ''}
    ${bulkHistory}
    <div class="two">
      <section class="card">
        <h2>Padrão do cliente</h2>
        <p class="muted">Drive final</p><p><code>${escapeHtml(client.rows[0].drive_folder_id || '-')}</code></p>
        <p class="muted" style="margin-top:12px">Drive clones Gemini</p><p><code>${escapeHtml(client.rows[0].clone_folder_id || '-')}</code></p>
      </section>
      <section class="card">
        <h2>Posts recentes</h2>
        <div class="list">${posts.rows.length ? posts.rows.map((post) => `<a class="item" href="/posts/${post.id}/review"><span class="badge">${escapeHtml(post.status)}</span><h3 style="margin-top:8px">${escapeHtml(post.source_title)}</h3><p>${escapeHtml(post.type)}${client.rows[0].slug === 'community' ? (post.source_meta?.origin === 'email' ? ' · Solicitado por e-mail' : post.source_meta?.origin === 'manual' ? ' · Pauta enviada por você' : '') : ''}</p></a>`).join('') : '<p>Nenhum post criado ainda.</p>'}</div>
      </section>
    </div>
  ` }));
}

async function insertParsedPost(client, parsed, sourceText, type = 'post_unico', sourceMeta = {}) {
  const postId = crypto.randomUUID();
  await pool.query('insert into posts (id, client_id, type, source_title, source_text, source_meta, status) values ($1, $2, $3, $4, $5, $6, $7)', [
    postId,
    client.id,
    type,
    parsed.sourceTitle,
    sourceText,
    sourceMeta,
    'draft',
  ]);
  for (const slide of parsed.slides) {
    await pool.query('insert into slides (id, post_id, number, slot, title, body, prompt) values ($1, $2, $3, $4, $5, $6, $7)', [
      crypto.randomUUID(),
      postId,
      slide.number,
      slide.slot,
      slide.title || '',
      slide.body || '',
      slide.prompt || '',
    ]);
  }
  return postId;
}

function communityCarouselMode(value) {
  if (value === undefined || value === null || value === '') return 'compact';
  if (!['compact', 'complete'].includes(value)) throw new Error('Formato de carrossel inválido.');
  return value;
}

function communityCarouselOptionsHtml(meta = {}) {
  const mode = communityCarouselMode(meta?.community_carousel_mode);
  return `<style>main:has(#community-carousel-mode){width:min(1180px,calc(100% - 36px))}</style><div class="field"><label for="community-carousel-mode">Quantidade de slides</label><select id="community-carousel-mode" name="community_carousel_mode">
    <option value="compact" ${mode === 'compact' ? 'selected' : ''}>Resumido: até 10 slides</option>
    <option value="complete" ${mode === 'complete' ? 'selected' : ''}>Texto completo: até 20 slides</option>
  </select></div>`;
}

async function postUnicoPage(req, res, user, slug, error = '') {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount) return sendHtml(res, layout({ title: 'Cliente não encontrado', user, body: '<h1>Cliente não encontrado</h1>' }), 404);
  const isCommunity = client.rows[0].parser_type === 'community_manual';
  sendHtml(res, layout({ title: 'Novo Post Único', user, body: `
    <div class="page-title"><div><h1>${isCommunity ? 'Nova notícia Community News' : 'Novo Post Único'}</h1><p>${escapeHtml(client.rows[0].name)} · cole o conteúdo antes de gerar artes.</p></div></div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form class="card" method="post" action="/clients/${client.rows[0].slug}/post-unico">
      <div class="field"><label>${isCommunity ? 'Notícia / matéria' : 'Conteúdo do post'}</label><textarea name="source_text" required placeholder="${isCommunity ? 'Data: 02/07/2026&#10;Local: Barra Olímpica&#10;Título: ...&#10;Subtítulo: ...&#10;Texto: ...&#10;CTA: ...' : '[POST 6] – Mês 16 – ...&#10;CAPA (SLIDE 1)&#10;Headline: ...&#10;SLIDE 2...'}"></textarea></div>
      ${isCommunity ? communityCarouselOptionsHtml() : ''}
      <div class="actions"><button class="btn" type="submit">Extrair e revisar</button><a class="btn secondary" href="/clients/${client.rows[0].slug}">Cancelar</a></div>
    </form>
  ` }));
}

async function createPostUnico(req, res, user, slug) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount) return redirect(res, '/dashboard');
  const form = await formData(req);
  let parsed;
  const sourceMeta = {};
  try {
    if (client.rows[0].parser_type === 'community_manual') sourceMeta.community_carousel_mode = communityCarouselMode(form.community_carousel_mode);
    parsed = parseClientPost(form.source_text, client.rows[0]);
  } catch (error) {
    return postUnicoPage(req, res, user, slug, error.message);
  }
  const postId = await insertParsedPost(client.rows[0], parsed, form.source_text, 'post_unico', sourceMeta);
  redirect(res, `/posts/${postId}/review`);
}

async function bulkDocxPage(req, res, user, slug, error = '') {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount || !supportsBulkDocx(client.rows[0])) return redirect(res, `/clients/${slug}`);
  sendHtml(res, layout({ title: 'Upload DOCX / Bulk', user, body: `
    <div class="page-title"><div><h1>Upload DOCX / Bulk</h1><p>${escapeHtml(client.rows[0].name)} · envie o DOCX mensal para criar os rascunhos separados.</p></div></div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form class="card" method="post" action="/clients/${client.rows[0].slug}/bulk-docx" enctype="multipart/form-data">
      <div class="field"><label>Arquivo DOCX</label><input type="file" name="docx_file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required><p class="muted">DOCX de até 8 MB, sem senha e sem macros.</p></div>
      <div class="field"><label>Ano da pasta no Drive</label><input name="year" type="number" min="2020" max="2100" value="${new Date().getFullYear()}"></div>
      <p class="muted">O painel vai detectar o mês editorial pelo nome do arquivo ou pelo texto, por exemplo <code>Mês 16</code>. Cada post será criado como rascunho individual para revisão.</p>
      <div class="actions"><button class="btn" type="submit">Criar rascunhos</button><a class="btn secondary" href="/clients/${client.rows[0].slug}">Cancelar</a></div>
    </form>
  ` }));
}

async function createBulkDocx(req, res, user, slug) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount || !supportsBulkDocx(client.rows[0])) return redirect(res, `/clients/${slug}`);
  let data;
  try {
    // 8 MB for the DOCX plus multipart headers and the small year field.
    data = await multipartData(req, 10_000_000);
  } catch (error) {
    return bulkDocxPage(req, res, user, slug, error.message);
  }
  const file = data.files.find((item) => item.field === 'docx_file');
  if (!file) return bulkDocxPage(req, res, user, slug, 'Envie um arquivo DOCX.');
  if (!/\.docx$/i.test(file.filename)) return bulkDocxPage(req, res, user, slug, 'O arquivo precisa estar em formato .docx.');
  try {
    documentSecurity.inspect(file.buffer, {
      name: file.filename,
      mime: file.mime,
      use: 'reference',
    });
  } catch (error) {
    return bulkDocxPage(req, res, user, slug, error.message);
  }

  let blocks;
  let monthLabel;
  try {
    const text = textFromDocxBuffer(file.buffer);
    blocks = splitBulkPosts(text);
    monthLabel = bulkMonthLabelFromFilename(file.filename) || monthLabelFromText(text);
  } catch (error) {
    return bulkDocxPage(req, res, user, slug, error.message);
  }

  const year = String(data.fields.year || new Date().getFullYear()).replace(/\D/g, '').slice(0, 4) || String(new Date().getFullYear());
  const created = [];
  const errors = [];
  for (const block of blocks) {
    try {
      const parsed = parseClientPost(block, client.rows[0]);
      const metadata = {
        bulk_docx: true,
        bulk_filename: file.filename,
        bulk_year: year,
        bulk_month_label: monthLabel || monthLabelFromText(block),
      };
      const postId = await insertParsedPost(client.rows[0], parsed, block, 'post_unico', metadata);
      created.push({ id: postId, title: parsed.sourceTitle });
    } catch (error) {
      const title = block.split(/\n/).map((line) => line.trim()).find(Boolean) || 'Post sem título';
      errors.push({ title, error: error.message });
    }
  }
  if (!created.length) return bulkDocxPage(req, res, user, slug, errors[0]?.error || 'Nenhum post foi criado a partir do DOCX.');
  const resultId = crypto.randomUUID();
  const dir = path.join(uploadRoot, 'bulk-results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${resultId}.json`), JSON.stringify({ client: client.rows[0], created, errors, monthLabel, year, filename: file.filename }, null, 2), 'utf8');
  redirect(res, `/clients/${client.rows[0].slug}/bulk-docx/result/${resultId}`);
}

async function bulkDocxResultPage(req, res, user, slug, resultId, url = new URL(req.url, 'http://localhost')) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount) return redirect(res, '/dashboard');
  const filePath = path.join(uploadRoot, 'bulk-results', `${resultId}.json`);
  if (!fs.existsSync(filePath)) return redirect(res, `/clients/${slug}`);
  const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const ownerMatches = result.client?.id ? result.client.id === client.rows[0].id : result.client?.slug === client.rows[0].slug;
  if (!ownerMatches) return redirect(res, `/clients/${slug}`);
  const postIds = (result.created || []).map((post) => post.id);
  const statuses = postIds.length
    ? await pool.query('select id, status from posts where id = any($1)', [postIds])
    : { rows: [] };
  const statusById = Object.fromEntries(statuses.rows.map((row) => [row.id, row.status]));
  const completedJobs = postIds.length
    ? await pool.query(`
      select distinct on (post_id) post_id, id, drive_status, drive_folder_link
      from generation_jobs
      where post_id = any($1) and status = 'completed'
      order by post_id, created_at desc
    `, [postIds])
    : { rows: [] };
  const completedByPostId = Object.fromEntries(completedJobs.rows.map((row) => [row.post_id, row]));
  const notices = [
    url.searchParams.get('queued') ? `${url.searchParams.get('queued')} posts foram enfileirados para geração.` : '',
    url.searchParams.get('drive_started') ? `Salvamento no Drive iniciado para ${url.searchParams.get('drive_started')} posts. Atualize a página em alguns minutos para acompanhar os links.` : '',
    url.searchParams.get('drive_saved') ? `${url.searchParams.get('drive_saved')} posts foram salvos no Drive.` : '',
    url.searchParams.get('drive_skipped') ? `${url.searchParams.get('drive_skipped')} posts ainda não tinham geração concluída para salvar.` : '',
    url.searchParams.get('drive_errors') ? `${url.searchParams.get('drive_errors')} posts tiveram erro ao salvar no Drive.` : '',
  ].filter(Boolean);
  const notice = notices.map((message) => `<div class="notice">${escapeHtml(message)}</div>`).join('');
  const bulkPlanner = await socialPublishing.bulkPlanner(client.rows[0], user, resultId);
  sendHtml(res, layout({ title: 'Bulk Criado', user, body: `
    <div class="page-title"><div><h1>Rascunhos criados</h1><p>${escapeHtml(client.rows[0].name)} · ${escapeHtml(result.filename || '')}</p></div><a class="btn secondary" href="/clients/${slug}">Voltar ao cliente</a></div>
    ${notice}
    <section class="card" style="margin-bottom:16px">
      <h2>Destino no Drive</h2>
      <p><code>${escapeHtml(result.year || String(new Date().getFullYear()))}</code> / <code>${escapeHtml(result.monthLabel || 'mês não identificado')}</code> / <code>nome completo do post</code></p>
      <form method="post" action="/clients/${slug}/bulk-docx/result/${resultId}/generate-all" class="actions">
        <button class="btn" type="submit">Gerar todos os rascunhos</button>
        <button class="btn secondary" type="submit" formaction="/clients/${slug}/bulk-docx/result/${resultId}/save-drive-all">Salvar concluídos no Drive</button>
        <a class="btn secondary" href="/clients/${slug}/bulk-docx/result/${resultId}/download-all">Baixar todos em ZIP</a>
      </form>
    </section>
    ${bulkPlanner ? `<div class="publish-page">${bulkPlanner}</div>` : ''}
    <section class="card">
      <h2>Posts criados</h2>
      <form method="post" action="/clients/${slug}/bulk-docx/result/${resultId}/save-drive-all">
        <input type="hidden" name="selection_mode" value="selected">
        <div class="list">${(result.created || []).map((post) => {
          const completed = completedByPostId[post.id];
          const saved = completed?.drive_status === 'saved';
          return `<div class="item">
            <div style="display:grid;grid-template-columns:${completed ? '160px ' : ''}1fr;gap:14px;align-items:start">
              ${completed ? `<a href="/posts/${post.id}/file?file=contact_sheet.png" target="_blank"><img src="/posts/${post.id}/file?file=contact_sheet.png&inline=1" alt="Prévia das artes" style="width:160px;max-width:100%;border-radius:6px;border:1px solid #d8dfd4;background:#eef2ea;display:block"></a>` : ''}
              <div>
                <span class="badge">${escapeHtml(saved ? 'salvo no Drive' : (completed ? 'concluído' : (statusById[post.id] || 'rascunho')))}</span>
                <h3 style="margin-top:8px">${escapeHtml(post.title)}</h3>
                <p>${completed ? 'Confira a prévia antes de aprovar.' : 'Ainda sem arte concluída.'}</p>
                <div class="actions">
                  <a class="btn secondary" href="/posts/${post.id}/review">Revisar</a>
                  ${completed ? `<label style="display:inline-flex;align-items:center;gap:8px;margin:0;font-size:14px"><input type="checkbox" name="approved_${post.id}" value="1" ${saved ? '' : 'checked'} style="width:auto"> aprovado para Drive</label>` : ''}
                  ${completed?.drive_folder_link ? `<a class="btn secondary" href="${escapeHtml(completed.drive_folder_link)}" target="_blank" rel="noreferrer">Abrir Drive</a>` : ''}
                </div>
              </div>
            </div>
          </div>`;
        }).join('')}</div>
        <div class="actions"><button class="btn secondary" type="submit">Salvar selecionados no Drive</button></div>
      </form>
    </section>
    ${(result.errors || []).length ? `<section class="card" style="margin-top:16px"><h2>Itens com erro</h2><div class="list">${result.errors.map((item) => `<div class="item"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.error)}</p></div>`).join('')}</div></section>` : ''}
  ` }));
}

async function bulkGenerateAll(req, res, user, slug, resultId) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount) return redirect(res, '/dashboard');
  const filePath = path.join(uploadRoot, 'bulk-results', `${resultId}.json`);
  if (!fs.existsSync(filePath)) return redirect(res, `/clients/${slug}`);
  const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const created = Array.isArray(result.created) ? result.created : [];
  let queued = 0;
  for (const item of created) {
    const post = await pool.query('select posts.id from posts where id = $1 and client_id = $2', [item.id, client.rows[0].id]);
    if (!post.rowCount) continue;
    const active = await pool.query("select id from generation_jobs where post_id = $1 and status in ('pending', 'running') limit 1", [item.id]);
    if (active.rowCount) continue;
    const completed = await latestCompletedJob(item.id);
    if (completed) continue;
    await pool.query('insert into generation_jobs (id, post_id, status) values ($1, $2, $3)', [crypto.randomUUID(), item.id, 'pending']);
    await pool.query("update posts set status = 'queued', updated_at = now() where id = $1", [item.id]);
    queued += 1;
  }
  redirect(res, `/clients/${slug}/bulk-docx/result/${resultId}?queued=${queued}`);
}

async function bulkSaveDriveAll(req, res, user, slug, resultId) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount) return redirect(res, '/dashboard');
  const form = await formData(req);
  const filePath = path.join(uploadRoot, 'bulk-results', `${resultId}.json`);
  if (!fs.existsSync(filePath)) return redirect(res, `/clients/${slug}`);
  const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const allCreated = Array.isArray(result.created) ? result.created : [];
  const selectedMode = form.selection_mode === 'selected';
  const created = selectedMode ? allCreated.filter((item) => form[`approved_${item.id}`]) : allCreated;
  let skipped = allCreated.length - created.length;
  const postIds = [];
  for (const item of created) {
    const post = await pool.query('select id from posts where id = $1 and client_id = $2', [item.id, client.rows[0].id]);
    if (!post.rowCount) {
      skipped += 1;
      continue;
    }
    const job = await latestCompletedJob(item.id);
    if (!job) {
      skipped += 1;
      continue;
    }
    if (job.drive_status === 'saved' && job.drive_folder_link) {
      skipped += 1;
      continue;
    }
    postIds.push(item.id);
  }
  runBulkDriveSave(postIds, `${slug}/${resultId}`).catch((error) => {
    console.error(`[bulk-drive] falha geral em ${slug}/${resultId}:`, error);
  });
  redirect(res, `/clients/${slug}/bulk-docx/result/${resultId}?drive_started=${postIds.length}&drive_skipped=${skipped}`);
}

async function coverOnlyPage(req, res, user, slug, error = '') {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount || client.rows[0].parser_type !== 'community_manual') return redirect(res, `/clients/${slug}`);
  sendHtml(res, layout({ title: 'Gerar Somente Capa', user, body: `
    <div class="page-title"><div><h1>Gerar somente capa</h1><p>${escapeHtml(client.rows[0].name)} · use uma imagem manual e o padrão de capa do Community News.</p></div></div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form class="card" method="post" action="/clients/${client.rows[0].slug}/cover-only" enctype="multipart/form-data">
      <div class="field"><label>Headline</label><textarea name="headline" required style="min-height:100px"></textarea></div>
      <div class="field"><label>Subheadline</label><textarea name="subheadline" required style="min-height:90px"></textarea></div>
      <div class="grid">
        <div class="field"><label>Data</label><input name="date" type="date"></div>
        <div class="field"><label>Local</label><input name="local" placeholder="Barra Olímpica"></div>
        <div class="field"><label>Texto na imagem</label><input name="credit" placeholder="Imagem Ilustrativa"></div>
      </div>
      <div class="grid">
        <div class="field"><label>Posição da imagem</label><input name="position" value="68% center"></div>
        <div class="field"><label>Tamanho da imagem</label><input name="size" value="cover"></div>
        <div class="field"><label>Foto da capa</label><input type="file" name="cover_file" accept="image/png,image/jpeg,image/webp" required></div>
      </div>
      <div class="field"><label style="display:inline-flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="cover_reels" value="1" style="width:auto"> Criar também versão Reels 9:16</label></div>
      <div class="actions"><button class="btn" type="submit">Criar capa</button><a class="btn secondary" href="/clients/${client.rows[0].slug}">Cancelar</a></div>
    </form>
  ` }));
}

function coverPayloadFromFields(fields) {
  const previous = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {};
  const headline = String(fields.headline || '').trim();
  const subheadline = String(fields.subheadline || '').trim();
  const date = dateDisplayValue(fields.date);
  const local = String(fields.local || '').trim() || 'Barra Olimpica';
  const coverReels = fields.cover_reels === '1' || fields.cover_reels === 'on' || fields.cover_reels === true;
  return {
    ...previous,
    mode: 'cover_only',
    headline,
    subheadline,
    date,
    local,
    capa_data: `${date || 'Hoje'} · ${local}`,
    cover_credit: String(fields.credit || '').trim(),
    position: String(fields.position || '68% center').trim(),
    size: String(fields.size || 'cover').trim(),
    cover_reels: coverReels,
  };
}

function dateInputValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return raw;
  match = raw.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateDisplayValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  match = raw.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (!match) return raw;
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  return `${String(Number(match[1])).padStart(2, '0')}/${String(Number(match[2])).padStart(2, '0')}/${year}`;
}

function coverPayloadFromPost(post) {
  try {
    const parsed = JSON.parse(post.source_text || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function readOpenAiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const keyPath = '/data/studio/.openai_api_key';
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8').trim();
  return '';
}

function aiImagePrompt(prompt, kind = 'cover') {
  if (String(prompt || '').startsWith('[FR2_EDITORIAL_ILLUSTRATION_V1]')) return String(prompt).replace('[FR2_EDITORIAL_ILLUSTRATION_V1]', '').trim() + '\nEditorial conceptual illustration, not documentary evidence of a real incident. Vertical composition. Keep lower half dark and clear for a later headline overlay. No letters, logos, watermarks, real victims or identifiable people. Do not recreate an actual accident scene.';
  const isCover = kind === 'cover';
  return [
    String(prompt || '').trim(),
    '',
    `Ultra-realistic photojournalistic image for a Brazilian local-news Instagram ${isCover ? 'cover' : 'carousel slide'}.`,
    'Make it look like a real documentary photograph, with natural camera perspective, imperfect real-world lighting, subtle lens grain, and believable faces, clothes, objects, and environment.',
    `Use a vertical 4:5 composition suitable for an Instagram ${isCover ? 'cover background' : 'news carousel image slide'}.`,
    isCover
      ? 'Keep the lower area visually usable for headline text overlay; avoid busy details in the lower third.'
      : 'Keep the image clean, legible, realistic, and useful as an illustrative news photo.',
    'No text, no logos, no watermarks, no readable signs, no brand marks.',
    'Do not depict gore, blood, graphic injury, or explicit harm.',
  ].join('\n');
}

async function generateOpenAiImage(prompt, outPath, quality = 'low', kind = 'cover') {
  const apiKey = readOpenAiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no painel.');
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.COMMUNITY_IMAGE_MODEL || process.env.WELLNESS_IMAGE_MODEL || 'gpt-image-2',
      prompt: aiImagePrompt(prompt, kind),
      size: process.env.COMMUNITY_IMAGE_SIZE || '1024x1536',
      quality: quality || process.env.COMMUNITY_IMAGE_QUALITY || 'low',
      output_format: 'png',
      n: 1,
    }),
    signal: AbortSignal.timeout(420000),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const failure = new Error('Image provider returned invalid response'); failure.providerStatus = response.status; throw failure;
  }
  if (!response.ok) { const error = new Error('Image provider rejected request'); error.providerStatus = response.status; throw error; }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI imagem capa: imagem não retornada.');
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return outPath;
}

async function generateOpenAiCoverImage(prompt, outPath, quality = 'low') {
  return generateOpenAiImage(prompt, outPath, quality, 'cover');
}

async function generateOpenAiInternalImage(prompt, outPath, quality = 'low') {
  return generateOpenAiImage(prompt, outPath, quality, 'internal');
}

async function aiCoverPage(req, res, user, slug, error = '', values = {}) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount || client.rows[0].parser_type !== 'community_manual') return redirect(res, `/clients/${slug}`);
  const selectedQuality = communityImageQuality.normalize(values.ai_quality);
  sendHtml(res, layout({ title: 'Capa Com Imagem IA', user, body: `
    <div class="page-title"><div><h1>Capa com imagem IA</h1><p>${escapeHtml(client.rows[0].name)} · gere a foto primeiro, aprove na revisão e só então crie a capa.</p></div></div>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <form class="card" method="post" action="/clients/${client.rows[0].slug}/ai-cover">
        ${communityImages.fields(user, 'create')}
      <div class="field"><label>Prompt da imagem</label><textarea name="ai_prompt" required placeholder="Gere uma imagem como foto ultra realista de passageiros sendo assaltados dentro de um ônibus executivo">${escapeHtml(values.ai_prompt || '')}</textarea></div>
      <div class="field"><label>Headline</label><textarea name="headline" required style="min-height:100px">${escapeHtml(values.headline || '')}</textarea></div>
      <div class="field"><label>Subheadline</label><textarea name="subheadline" required style="min-height:90px">${escapeHtml(values.subheadline || '')}</textarea></div>
      <div class="grid">
        <div class="field"><label>Data</label><input name="date" type="date" value="${escapeHtml(dateInputValue(values.date || ''))}"></div>
        <div class="field"><label>Local</label><input name="local" value="${escapeHtml(values.local || 'Barra Olimpica')}" placeholder="Barra Olímpica"></div>
        <div class="field"><label>Texto na imagem</label><input name="credit" value="${escapeHtml(values.credit || 'Imagem gerada por IA')}" placeholder="Imagem gerada por IA"></div>
      </div>
      <div class="grid">
        <div class="field"><label>Posição da imagem</label><input name="position" value="${escapeHtml(values.position || 'center center')}"></div>
        <div class="field"><label>Tamanho da imagem</label><input name="size" value="${escapeHtml(values.size || 'cover')}"></div>
        <div class="field"><label>Qualidade OpenAI</label><select name="ai_quality"><option value="low"${selectedQuality === 'low' ? ' selected' : ''}>Básica</option><option value="medium"${selectedQuality === 'medium' ? ' selected' : ''}>Média</option><option value="high"${selectedQuality === 'high' ? ' selected' : ''}>Alta</option></select></div>
      </div>
      <div class="field"><label style="display:inline-flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="cover_reels" value="1" ${values.cover_reels ? 'checked' : ''} style="width:auto"> Criar também versão Reels 9:16</label></div>
      <div class="actions"><button class="btn" type="submit">Gerar imagem para aprovar</button><a class="btn secondary" href="/clients/${client.rows[0].slug}">Cancelar</a></div>
    </form>
  ` }));
}

async function createAiCover(req, res, user, slug) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount || client.rows[0].parser_type !== 'community_manual') return redirect(res, `/clients/${slug}`);
  const form = await formData(req);
  const aiPrompt = String(form.ai_prompt || '').trim();
  const payload = coverPayloadFromFields(form, {
    ai_prompt: aiPrompt,
    ai_quality: communityImageQuality.normalize(form.ai_quality),
  });
  if (!aiPrompt) return aiCoverPage(req, res, user, slug, 'Preencha o prompt da imagem.', form);
  if (!payload.headline || !payload.subheadline) return aiCoverPage(req, res, user, slug, 'Preencha headline e subheadline.', form);

  const postId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const dir = path.join(uploadRoot, postId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${assetId}.png`);
  try {
    await generateOpenAiCoverImage(aiPrompt, filePath, payload.ai_quality);
  } catch (error) {
    return aiCoverPage(req, res, user, slug, error.message, form);
  }
  const stat = fs.statSync(filePath);
  await pool.query('insert into posts (id, client_id, type, source_title, source_text, status) values ($1, $2, $3, $4, $5, $6)', [
    postId,
    client.rows[0].id,
    'cover_only',
    payload.headline,
    JSON.stringify(payload, null, 2),
    'draft',
  ]);
  await pool.query(`
    insert into post_assets (id, post_id, role, file_path, original_name, mime_type, size_bytes, display_order, credit)
    values ($1, $2, 'cover', $3, $4, 'image/png', $5, 1, $6)
  `, [assetId, postId, filePath, 'capa-ia-openai.png', stat.size, payload.cover_credit || 'Imagem gerada por IA']);
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function createCoverOnly(req, res, user, slug) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount || client.rows[0].parser_type !== 'community_manual') return redirect(res, `/clients/${slug}`);
  let data;
  try {
    data = await multipartData(req);
  } catch (error) {
    return coverOnlyPage(req, res, user, slug, error.message);
  }
  const payload = coverPayloadFromFields(data.fields);
  if (!payload.headline || !payload.subheadline) return coverOnlyPage(req, res, user, slug, 'Preencha headline e subheadline.');
  const file = data.files.find((item) => item.field === 'cover_file');
  if (!file) return coverOnlyPage(req, res, user, slug, 'Envie a foto da capa.');
  const ext = path.extname(file.filename).toLowerCase();
  const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  const allowedMime = /^image\/(jpeg|png|webp)$/i;
  if (!allowedExt.has(ext) || !allowedMime.test(file.mime)) return coverOnlyPage(req, res, user, slug, 'Formato de imagem inválido.');

  const postId = crypto.randomUUID();
  const dir = path.join(uploadRoot, postId);
  fs.mkdirSync(dir, { recursive: true });
  const assetId = crypto.randomUUID();
  const filePath = path.join(dir, `${assetId}${ext === '.jpeg' ? '.jpg' : ext}`);
  fs.writeFileSync(filePath, file.buffer);

  await pool.query('insert into posts (id, client_id, type, source_title, source_text, status) values ($1, $2, $3, $4, $5, $6)', [
    postId,
    client.rows[0].id,
    'cover_only',
    payload.headline,
    JSON.stringify(payload, null, 2),
    'draft',
  ]);
  await pool.query(`
    insert into post_assets (id, post_id, role, file_path, original_name, mime_type, size_bytes, display_order, credit)
    values ($1, $2, 'cover', $3, $4, $5, $6, 1, $7)
  `, [assetId, postId, filePath, file.filename, file.mime, file.buffer.length, payload.cover_credit]);
  await pool.query('insert into generation_jobs (id, post_id, status) values ($1, $2, $3)', [crypto.randomUUID(), postId, 'pending']);
  await pool.query("update posts set status = 'queued', updated_at = now() where id = $1", [postId]);
  redirect(res, `/posts/${postId}/review?queued=1`);
}

function assetSafePath(filePath) {
  const root = path.resolve(uploadRoot);
  const target = path.resolve(String(filePath || ''));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Arquivo de upload inválido.');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('Arquivo não encontrado.');
  return target;
}

function communityAssetsHtml(assets, postId, user) {
  const coverCount = assets.filter((asset) => asset.role === 'cover').length;
  return `
    <section class="card" style="margin-bottom:16px">
      <div class="page-title" style="margin:0 0 8px"><div><h2>Imagens manuais</h2><p>Marque uma imagem como capa. As internas entram no carrossel pela ordem definida aqui.</p></div><span class="badge">${coverCount ? 'capa ok' : 'capa pendente'}</span></div>
      <form method="post" action="/posts/${postId}/generate-ai-internal-images" style="margin-bottom:16px">
        ${communityImages.fields(user, postId+':generate-ai-internal-images')}
        <div class="field"><label>Gerar imagens IA para slides internos</label><textarea name="ai_prompts" required placeholder="Um prompt por linha. Ex: Foto ultra realista de passageiros dentro de um ônibus executivo após assalto, clima tenso, sem sangue, estilo foto jornalística"></textarea></div>
        <div class="grid">
          <div class="field"><label>Crédito</label><input name="credit" value="Imagem gerada por IA"></div>
          <div class="field"><label>Qualidade OpenAI</label><select name="ai_quality"><option value="low" selected>Básica</option><option value="medium">Média</option><option value="high">Alta</option></select></div>
          <div class="field"><label>Uso</label><input value="Adiciona como internas" disabled></div>
        </div>
        <div class="actions"><button class="btn secondary" type="submit">Gerar imagens internas</button></div>
      </form>
      <form method="post" action="/posts/${postId}/assets" enctype="multipart/form-data" class="upload-grid">
        <div class="field"><label>Adicionar imagens</label><input type="file" name="asset_files" accept="image/png,image/jpeg,image/webp" multiple required></div>
        <div class="field"><label>Tipo</label><select name="role"><option value="internal">Interna</option><option value="cover">Capa</option></select></div>
        <div class="field"><label>Crédito</label><input name="credit" placeholder="Reprodução / Divulgação"></div>
        <button class="btn" type="submit">Enviar</button>
      </form>
      ${assets.length ? `
        <form method="post" action="/posts/${postId}/assets/update" style="margin-top:8px">
          ${assets.map((asset, index) => `
            <div class="media-row">
              <img src="/posts/${postId}/asset/${asset.id}?inline=1" alt="${escapeHtml(asset.original_name)}">
              <div class="field"><label>Tipo</label><select name="role_${asset.id}"><option value="cover"${asset.role === 'cover' ? ' selected' : ''}>Capa</option><option value="internal"${asset.role !== 'cover' ? ' selected' : ''}>Interna</option></select></div>
              <div class="field"><label>Ordem</label><input name="order_${asset.id}" type="number" min="0" step="1" value="${Number(asset.display_order || index + 1)}"></div>
              <div class="field"><label>Crédito</label><input name="credit_${asset.id}" value="${escapeHtml(asset.credit || '')}"></div>
              <button class="btn danger" type="submit" name="delete_asset" value="${asset.id}" formmethod="post" formaction="/posts/${postId}/assets/${asset.id}/delete">Remover</button>
            </div>
          `).join('')}
          <div class="actions"><button class="btn secondary" type="submit">Salvar imagens</button></div>
        </form>
      ` : '<p style="margin-top:12px">Nenhuma imagem adicionada ainda.</p>'}
    </section>
  `;
}

function communityAiCoverHtml(postId, user) {
  const selectedQuality = communityImageQuality.DEFAULT;
  return `
    <section class="card" style="margin-bottom:16px">
      <h2>Gerar capa com IA</h2>
      <p class="muted" style="margin-bottom:12px">Crie uma foto de capa pela OpenAI antes de gerar o carrossel. Ao aprovar, ela substitui a capa atual.</p>
      <form method="post" action="/posts/${postId}/generate-ai-cover">
        ${communityImages.fields(user, postId+':generate-ai-cover')}
        <div class="field"><label>Prompt da imagem</label><textarea name="ai_prompt" required placeholder="Gere uma imagem como foto ultra realista de passageiros sendo assaltados dentro de um ônibus executivo"></textarea></div>
        <div class="grid">
          <div class="field"><label>Texto na imagem</label><input name="credit" value="Imagem gerada por IA"></div>
          <div class="field"><label>Qualidade OpenAI</label><select name="ai_quality"><option value="low"${selectedQuality === 'low' ? ' selected' : ''}>Básica</option><option value="medium"${selectedQuality === 'medium' ? ' selected' : ''}>Média</option><option value="high"${selectedQuality === 'high' ? ' selected' : ''}>Alta</option></select></div>
          <div class="field"><label>Ajuste</label><input name="note" value="Substitui a capa atual" disabled></div>
        </div>
        <div class="actions"><button class="btn secondary" type="submit">Gerar imagem IA da capa</button></div>
      </form>
    </section>
  `;
}

async function communityReviewPost(req, res, user, post, slides, jobs, postId, url) {
  if (post.type === 'cover_only') return communityCoverReviewPost(req, res, user, post, jobs, postId, url);
  const assets = await pool.query('select * from post_assets where post_id = $1 order by case when role = $2 then 0 else 1 end, display_order, created_at', [post.id, 'cover']);
  const activeJob = jobs.find((job) => ['pending', 'running'].includes(job.status));
  const generatedJob = jobs.find((job) => job.status === 'completed');
  sendHtml(res, layout({ title: 'Revisar Community News', user, body: `
    ${communityFeed.link(post, user)}
    ${await communityImages.banner(postId,user)}
    <div class="page-title"><div><h1>Revisar notícia</h1><p>${escapeHtml(post.client_name)} · texto, imagens manuais e geração do carrossel.</p></div><span class="badge">${escapeHtml(post.status)}</span></div>
    ${flashMessage(url)}
    ${activeJob ? `<div class="warn">Status da geração: <strong>${escapeHtml(activeJob.status)}</strong>. Job <code>${escapeHtml(activeJob.id)}</code>. Esta tela atualiza automaticamente.</div><script>setTimeout(() => location.reload(), 10000)</script>` : ''}
    ${generatedJob ? `<div class="notice">Última geração concluída. Arquivos em: <code>${escapeHtml(generatedJob.output_dir || '-')}</code></div>` : ''}
    ${jobs[0]?.status === 'failed' ? `<div class="error">Último erro: ${escapeHtml(jobs[0].error || 'erro não informado')}</div>` : ''}
    ${generatedJob?.result_json?.content_moved_to_caption ? `<div class="warn">Parte do conteúdo ficou somente na legenda. O texto completo com as imagens ocupa ${escapeHtml(generatedJob.result_json.original_total_slides)} slides.</div>` : ''}
    ${generatedJob ? generatedAssetsHtml(generatedJob, postId) : ''}
    <form class="card" method="post" action="/posts/${postId}/review" style="margin-bottom:16px">
      <div class="field"><label>Nome da pasta / título</label><input name="source_title" value="${escapeHtml(post.source_title)}"></div>
      <div class="field"><label>Texto da notícia</label><textarea name="source_text" required>${escapeHtml(post.source_text)}</textarea></div>
      ${communityCarouselOptionsHtml(post.source_meta)}
      <div class="actions"><button class="btn" type="submit" name="intent" value="save">Salvar revisão</button><button class="btn secondary" type="submit" name="intent" value="generate">Gerar artes</button><a class="btn secondary" href="/clients/${post.client_slug}">Voltar</a></div>
    </form>
    ${communityAiCoverHtml(postId, user)}
    ${communityAssetsHtml(assets.rows, postId, user)}
  ` }));
}

async function communityCoverReviewPost(req, res, user, post, jobs, postId, url) {
  const assets = await pool.query("select * from post_assets where post_id = $1 and role = 'cover' order by created_at limit 1", [postId]);
  const activeJob = jobs.find((job) => ['pending', 'running'].includes(job.status));
  const generatedJob = post.status === 'draft' ? null : jobs.find((job) => job.status === 'completed');
  const payload = coverPayloadFromPost(post);
  const cover = assets.rows[0] || null;
  const aiBlock = payload.ai_prompt ? `
    <section class="card" style="margin-bottom:16px">
      <h2>Imagem IA da capa</h2>
      <p class="muted" style="margin-bottom:10px">Prompt salvo para esta imagem.</p>
      <p>${escapeHtml(payload.ai_prompt)}</p>
      <form method="post" action="/posts/${postId}/regenerate-ai-cover" class="actions">
        ${communityImages.fields(user, postId+':regenerate-ai-cover')}
        <button class="btn secondary" type="submit">Refazer imagem IA</button>
      </form>
    </section>
  ` : '';
  sendHtml(res, layout({ title: 'Revisar Capa Community News', user, body: `
    ${communityFeed.link(post, user)}
    ${await communityImages.banner(postId,user)}
    <div class="page-title"><div><h1>Revisar capa</h1><p>${escapeHtml(post.client_name)} · capa única no padrão Community News.</p></div><span class="badge">${escapeHtml(post.status)}</span></div>
    ${flashMessage(url)}
    ${activeJob ? `<div class="warn">Status da geração: <strong>${escapeHtml(activeJob.status)}</strong>. Job <code>${escapeHtml(activeJob.id)}</code>. Esta tela atualiza automaticamente.</div><script>setTimeout(() => location.reload(), 10000)</script>` : ''}
    ${generatedJob ? `<div class="notice">Última geração concluída. Arquivos em: <code>${escapeHtml(generatedJob.output_dir || '-')}</code></div>` : ''}
    ${jobs.find((job) => job.status === 'failed') ? `<div class="error">Último erro: ${escapeHtml(jobs.find((job) => job.status === 'failed').error || 'erro não informado')}</div>` : ''}
    ${generatedJob ? generatedAssetsHtml(generatedJob, postId) : ''}
    ${aiBlock}
    <form class="card" method="post" action="/posts/${postId}/review">
      <div class="field"><label>Headline</label><textarea name="headline" required style="min-height:100px">${escapeHtml(payload.headline || post.source_title)}</textarea></div>
      <div class="field"><label>Subheadline</label><textarea name="subheadline" required style="min-height:90px">${escapeHtml(payload.subheadline || '')}</textarea></div>
      <div class="grid">
        <div class="field"><label>Data</label><input name="date" type="date" value="${escapeHtml(dateInputValue(payload.date || ''))}"></div>
        <div class="field"><label>Local</label><input name="local" value="${escapeHtml(payload.local || 'Barra Olimpica')}"></div>
        <div class="field"><label>Texto na imagem</label><input name="credit" value="${escapeHtml(payload.cover_credit || cover?.credit || '')}"></div>
      </div>
      <div class="grid">
        <div class="field"><label>Posição da imagem</label><input name="position" value="${escapeHtml(payload.position || '68% center')}"></div>
        <div class="field"><label>Tamanho da imagem</label><input name="size" value="${escapeHtml(payload.size || 'cover')}"></div>
        <div class="field"><label>Foto atual</label>${cover ? `<a href="/posts/${postId}/asset/${cover.id}" target="_blank"><img src="/posts/${postId}/asset/${cover.id}?inline=1" alt="Capa" style="width:96px;aspect-ratio:4/5;object-fit:cover;border-radius:6px;border:1px solid #d8dfd4"></a>` : '<p>Nenhuma foto.</p>'}</div>
      </div>
      <div class="field"><label style="display:inline-flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" name="cover_reels" value="1" ${payload.cover_reels ? 'checked' : ''} style="width:auto"> Criar também versão Reels 9:16</label></div>
      <div class="actions"><button class="btn" type="submit" name="intent" value="save">Salvar revisão</button><button class="btn secondary" type="submit" name="intent" value="generate">Gerar capa</button><a class="btn secondary" href="/clients/${post.client_slug}">Voltar</a></div>
    </form>
  ` }));
}

function flashMessage(url) {
  if (url.searchParams.get('saved')) return '<div class="notice">Revisão salva.</div>';
  if (url.searchParams.get('queued')) return '<div class="notice">Geração de artes enfileirada. Atualize esta página para acompanhar o status.</div>';
  if (url.searchParams.get('queued_slide')) return `<div class="notice">Slide ${escapeHtml(url.searchParams.get('queued_slide'))} enfileirado. Somente esta arte será refeita; as demais serão preservadas.</div>`;
  if (url.searchParams.get('already')) return '<div class="warn">Já existe uma geração em andamento para este post.</div>';
  if (url.searchParams.get('needs_full')) return '<div class="warn">Ainda não existe uma geração completa para usar como base. Gere as artes uma vez antes da correção individual.</div>';
  if (url.searchParams.get('missing_cover')) return '<div class="error">Adicione ou marque uma imagem como capa antes de gerar.</div>';
  if (url.searchParams.get('drive_saved')) return '<div class="notice">Arquivos salvos no Google Drive.</div>';
  if (url.searchParams.get('drive_error')) return '<div class="error">Não consegui salvar no Google Drive. Veja o erro abaixo.</div>';
  return '';
}

async function reviewPost(req, res, user, postId, url = new URL(req.url, 'http://localhost')) {
  const post = await pool.query('select posts.*, clients.name as client_name, clients.slug as client_slug, clients.parser_type from posts join clients on clients.id = posts.client_id where posts.id = $1', [postId]);
  if (!post.rowCount) return sendHtml(res, layout({ title: 'Post não encontrado', user, body: '<h1>Post não encontrado</h1>' }), 404);
  const slides = await pool.query('select * from slides where post_id = $1 order by number', [postId]);
  const jobs = await pool.query('select * from generation_jobs where post_id = $1 order by created_at desc limit 5', [postId]);
  if (post.rows[0].parser_type === 'community_manual') return communityReviewPost(req, res, user, post.rows[0], slides.rows, jobs.rows, postId, url);
  const activeJob = jobs.rows.find((job) => ['pending', 'running'].includes(job.status));
  const generatedJob = jobs.rows.find((job) => job.status === 'completed');
  const generatedByNumber = new Map(generatedSlideFiles(generatedJob).map((item) => [item.number, item]));
  sendHtml(res, layout({ title: 'Revisar Post', user, body: `
    <div class="page-title"><div><h1>Revisar conteúdo</h1><p>${escapeHtml(post.rows[0].client_name)} · edite antes de gerar artes.</p></div><span class="badge">${escapeHtml(post.rows[0].status)}</span></div>
    ${flashMessage(url)}
    ${activeJob ? `<div class="warn">Status da geração: <strong>${escapeHtml(activeJob.status)}</strong>. Job <code>${escapeHtml(activeJob.id)}</code>. Esta tela atualiza automaticamente.</div><script>setTimeout(() => location.reload(), 10000)</script>` : ''}
    ${generatedJob ? `<div class="notice">Última geração concluída. Arquivos em: <code>${escapeHtml(generatedJob.output_dir || '-')}</code></div>` : ''}
    ${jobs.rows[0]?.status === 'failed' ? `<div class="error">Último erro: ${escapeHtml(jobs.rows[0].error || 'erro não informado')}</div>` : ''}
    ${generatedJob ? generatedAssetsHtml(generatedJob, postId) : ''}
    <form class="card" method="post" action="/posts/${postId}/review">
      <div class="field"><label>Nome da pasta / título original</label><input name="source_title" value="${escapeHtml(post.rows[0].source_title)}"></div>
      ${slides.rows.map((slide) => {
        const preview = generatedByNumber.get(Number(slide.number));
        return `
        <div class="slide">
          <div class="slide-no">Slide ${slide.number}<br><span class="badge">${escapeHtml(slide.slot)}</span>${preview ? `<a href="/posts/${postId}/file?file=${encodeURIComponent(preview.file)}" target="_blank"><img src="/posts/${postId}/file?file=${encodeURIComponent(preview.file)}&inline=1" alt="Slide ${slide.number}" style="display:block;width:72px;margin-top:10px;border:1px solid #d8dfd4;border-radius:4px"></a>` : ''}</div>
          <div>
            <input type="hidden" name="slide_id_${slide.number}" value="${escapeHtml(slide.id)}">
            <div class="field"><label>Título / Headline</label><input name="title_${slide.number}" value="${escapeHtml(slide.title)}"></div>
            <div class="field"><label>Texto / Subheadline</label><textarea name="body_${slide.number}">${escapeHtml(slide.body)}</textarea></div>
            <div class="field"><label>Prompt de imagem</label><textarea name="prompt_${slide.number}">${escapeHtml(slide.prompt)}</textarea></div>
            ${generatedJob && !activeJob && supportsBulkDocx(post.rows[0]) ? `<div class="actions"><button class="btn secondary" type="submit" name="intent" value="generate_slide_${slide.number}">Gerar somente este slide</button></div>` : ''}
          </div>
        </div>
      `;}).join('')}
      <div class="actions"><button class="btn" type="submit" name="intent" value="save">Salvar revisão</button><button class="btn secondary" type="submit" name="intent" value="generate">Gerar artes</button><a class="btn secondary" href="/clients/${post.rows[0].client_slug}">Voltar</a></div>
    </form>
  ` }));
}

async function updateReview(req, res, user, postId) {
  const form = await formData(req);
  const post = await pool.query('select posts.*, clients.parser_type from posts join clients on clients.id = posts.client_id where posts.id = $1', [postId]);
  if (!post.rowCount) return redirect(res, '/dashboard');
  if (post.rows[0].type === 'cover_only') {
    const payload = coverPayloadFromFields(form, coverPayloadFromPost(post.rows[0]));
    await pool.query('update posts set source_title = $1, source_text = $2, updated_at = now() where id = $3', [
      payload.headline || 'Capa Community News',
      JSON.stringify(payload, null, 2),
      postId,
    ]);
    await pool.query("update post_assets set credit = $1, updated_at = now() where post_id = $2 and role = 'cover'", [payload.cover_credit, postId]);
    if (form.intent === 'generate') {
      const cover = await pool.query("select id from post_assets where post_id = $1 and role = 'cover' limit 1", [postId]);
      if (!cover.rowCount) return redirect(res, `/posts/${postId}/review?missing_cover=1`);
      const active = await pool.query("select id from generation_jobs where post_id = $1 and status in ('pending', 'running') limit 1", [postId]);
      if (active.rowCount) return redirect(res, `/posts/${postId}/review?already=1`);
      await pool.query('insert into generation_jobs (id, post_id, status) values ($1, $2, $3)', [crypto.randomUUID(), postId, 'pending']);
      await pool.query("update posts set status = 'queued', updated_at = now() where id = $1", [postId]);
      return redirect(res, `/posts/${postId}/review?queued=1`);
    }
    return redirect(res, `/posts/${postId}/review?saved=1`);
  }
  if (post.rows[0].parser_type === 'community_manual' && Object.hasOwn(form, 'community_carousel_mode')) {
    let mode;
    try { mode = communityCarouselMode(form.community_carousel_mode); }
    catch (error) { return sendHtml(res, layout({ title: 'Formato inválido', user, body: `<div class="error">${escapeHtml(error.message)}</div>` }), 400); }
    await pool.query("update posts set source_meta = coalesce(source_meta, '{}'::jsonb) || $1::jsonb where id = $2", [JSON.stringify({ community_carousel_mode: mode }), postId]);
  }
  await pool.query('update posts set source_title = $1, source_text = coalesce($2, source_text), updated_at = now() where id = $3', [
    form.source_title || 'Post sem título',
    form.source_text,
    postId,
  ]);
  const slides = await pool.query('select * from slides where post_id = $1 order by number', [postId]);
  for (const slide of slides.rows) {
    await pool.query('update slides set title = $1, body = $2, prompt = $3, updated_at = now() where id = $4', [
      form[`title_${slide.number}`] || '',
      form[`body_${slide.number}`] || '',
      form[`prompt_${slide.number}`] || '',
      slide.id,
    ]);
  }
  const targetMatch = String(form.intent || '').match(/^generate_slide_(\d+)$/);
  if (form.intent === 'generate' || targetMatch) {
    if (targetMatch && !supportsBulkDocx(post.rows[0])) {
      return sendHtml(res, layout({ title: 'Recurso indisponível', user, body: '<div class="error">A correção individual ainda não se aplica a este formato de conteúdo.</div>' }), 400);
    }
    if (post.rows[0].parser_type === 'community_manual') {
      const cover = await pool.query("select id from post_assets where post_id = $1 and role = 'cover' limit 1", [postId]);
      if (!cover.rowCount) return redirect(res, `/posts/${postId}/review?missing_cover=1`);
    }
    const active = await pool.query("select id from generation_jobs where post_id = $1 and status in ('pending', 'running') limit 1", [postId]);
    if (active.rowCount) return redirect(res, `/posts/${postId}/review?already=1`);
    if (targetMatch) {
      const targetSlide = Number(targetMatch[1]);
      if (!slides.rows.some((slide) => Number(slide.number) === targetSlide)) {
        return sendHtml(res, layout({ title: 'Slide inválido', user, body: '<div class="error">O slide escolhido não pertence a este post.</div>' }), 400);
      }
      const base = await pool.query(`select id from generation_jobs
        where post_id = $1 and status = 'completed' order by created_at desc limit 1`, [postId]);
      if (!base.rowCount) return redirect(res, `/posts/${postId}/review?needs_full=1`);
      await pool.query(`insert into generation_jobs
        (id, post_id, status, target_slide, base_generation_id) values ($1, $2, $3, $4, $5)`, [
        crypto.randomUUID(), postId, 'pending', targetSlide, base.rows[0].id,
      ]);
      await pool.query("update posts set status = 'queued', updated_at = now() where id = $1", [postId]);
      return redirect(res, `/posts/${postId}/review?queued_slide=${targetSlide}`);
    }
    await pool.query('insert into generation_jobs (id, post_id, status) values ($1, $2, $3)', [crypto.randomUUID(), postId, 'pending']);
    await pool.query("update posts set status = 'queued', updated_at = now() where id = $1", [postId]);
    return redirect(res, `/posts/${postId}/review?queued=1`);
  }
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function regenerateAiCover(req, res, user, postId) {
  const post = await pool.query(`
    select posts.*, clients.parser_type
    from posts
    join clients on clients.id = posts.client_id
    where posts.id = $1
  `, [postId]);
  if (!post.rowCount || post.rows[0].parser_type !== 'community_manual' || post.rows[0].type !== 'cover_only') return redirect(res, `/posts/${postId}/review`);
  const payload = coverPayloadFromPost(post.rows[0]);
  const aiPrompt = String(payload.ai_prompt || '').trim();
  if (!aiPrompt) return redirect(res, `/posts/${postId}/review`);

  const assetId = crypto.randomUUID();
  const dir = path.join(uploadRoot, postId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${assetId}.png`);
  try {
    await generateOpenAiCoverImage(aiPrompt, filePath, payload.ai_quality || 'low');
  } catch (error) {
    return sendHtml(res, layout({ title: 'Erro ao Refazer Imagem', user, body: `<div class="error">${escapeHtml(error.message)}</div><p><a href="/posts/${postId}/review">Voltar para revisão</a></p>` }), 500);
  }
  const oldAssets = await pool.query("select * from post_assets where post_id = $1 and role = 'cover'", [postId]);
  for (const asset of oldAssets.rows) {
    try {
      const oldPath = assetSafePath(asset.file_path);
      fs.unlinkSync(oldPath);
    } catch (error) {
      // The new approved draft image is already available; stale files can be ignored.
    }
  }
  await pool.query("delete from post_assets where post_id = $1 and role = 'cover'", [postId]);
  const stat = fs.statSync(filePath);
  await pool.query(`
    insert into post_assets (id, post_id, role, file_path, original_name, mime_type, size_bytes, display_order, credit)
    values ($1, $2, 'cover', $3, $4, 'image/png', $5, 1, $6)
  `, [assetId, postId, filePath, 'capa-ia-openai.png', stat.size, payload.cover_credit || 'Imagem gerada por IA']);
  await pool.query("update posts set status = 'draft', updated_at = now() where id = $1", [postId]);
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function generateAiCoverForPost(req, res, user, postId) {
  const post = await pool.query(`
    select posts.*, clients.parser_type
    from posts
    join clients on clients.id = posts.client_id
    where posts.id = $1
  `, [postId]);
  if (!post.rowCount || post.rows[0].parser_type !== 'community_manual') return redirect(res, `/posts/${postId}/review`);
  const form = await formData(req);
  const aiPrompt = String(form.ai_prompt || '').trim();
  if (!aiPrompt) return redirect(res, `/posts/${postId}/review`);

  const assetId = crypto.randomUUID();
  const dir = path.join(uploadRoot, postId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${assetId}.png`);
  try {
    await generateOpenAiCoverImage(aiPrompt, filePath, String(form.ai_quality || 'low').trim());
  } catch (error) {
    return sendHtml(res, layout({ title: 'Erro ao Gerar Imagem', user, body: `<div class="error">${escapeHtml(error.message)}</div><p><a href="/posts/${postId}/review">Voltar para revisão</a></p>` }), 500);
  }
  const oldAssets = await pool.query("select * from post_assets where post_id = $1 and role = 'cover'", [postId]);
  for (const asset of oldAssets.rows) {
    try {
      const oldPath = assetSafePath(asset.file_path);
      fs.unlinkSync(oldPath);
    } catch (error) {
      // The generated image replaces the cover asset; missing old files are harmless.
    }
  }
  await pool.query("delete from post_assets where post_id = $1 and role = 'cover'", [postId]);
  const stat = fs.statSync(filePath);
  await pool.query(`
    insert into post_assets (id, post_id, role, file_path, original_name, mime_type, size_bytes, display_order, credit)
    values ($1, $2, 'cover', $3, $4, 'image/png', $5, 1, $6)
  `, [assetId, postId, filePath, 'capa-ia-openai.png', stat.size, String(form.credit || 'Imagem gerada por IA').trim()]);

  if (post.rows[0].type === 'cover_only') {
    const payload = coverPayloadFromPost(post.rows[0]);
    payload.ai_prompt = aiPrompt;
    payload.ai_quality = String(form.ai_quality || 'low').trim();
    payload.cover_credit = String(form.credit || payload.cover_credit || 'Imagem gerada por IA').trim();
    await pool.query('update posts set source_text = $1, status = $2, updated_at = now() where id = $3', [
      JSON.stringify(payload, null, 2),
      'draft',
      postId,
    ]);
  } else {
    await pool.query("update posts set status = 'draft', updated_at = now() where id = $1", [postId]);
  }
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function generateAiInternalImages(req, res, user, postId) {
  const post = await pool.query(`
    select posts.*, clients.parser_type
    from posts
    join clients on clients.id = posts.client_id
    where posts.id = $1
  `, [postId]);
  if (!post.rowCount || post.rows[0].parser_type !== 'community_manual' || post.rows[0].type === 'cover_only') return redirect(res, `/posts/${postId}/review`);
  const form = await formData(req);
  const prompts = String(form.ai_prompts || '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!prompts.length) return redirect(res, `/posts/${postId}/review`);

  const dir = path.join(uploadRoot, postId);
  fs.mkdirSync(dir, { recursive: true });
  const existing = await pool.query('select coalesce(max(display_order), 0) as max_order from post_assets where post_id = $1', [postId]);
  let order = Number(existing.rows[0]?.max_order || 0);
  const quality = String(form.ai_quality || 'low').trim();
  const credit = String(form.credit || 'Imagem gerada por IA').trim();

  try {
    for (let index = 0; index < prompts.length; index += 1) {
      const assetId = crypto.randomUUID();
      const filePath = path.join(dir, `${assetId}.png`);
      await generateOpenAiInternalImage(prompts[index], filePath, quality);
      const stat = fs.statSync(filePath);
      order += 1;
      await pool.query(`
        insert into post_assets (id, post_id, role, file_path, original_name, mime_type, size_bytes, display_order, credit)
        values ($1, $2, 'internal', $3, $4, 'image/png', $5, $6, $7)
      `, [assetId, postId, filePath, `slide-interno-ia-${String(order).padStart(2, '0')}.png`, stat.size, order, credit]);
    }
  } catch (error) {
    return sendHtml(res, layout({ title: 'Erro ao Gerar Imagens', user, body: `<div class="error">${escapeHtml(error.message)}</div><p><a href="/posts/${postId}/review">Voltar para revisão</a></p>` }), 500);
  }
  await pool.query("update posts set status = 'draft', updated_at = now() where id = $1", [postId]);
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function uploadPostAssets(req, res, user, postId) {
  const post = await pool.query('select posts.*, clients.parser_type from posts join clients on clients.id = posts.client_id where posts.id = $1', [postId]);
  if (!post.rowCount || post.rows[0].parser_type !== 'community_manual') return redirect(res, `/posts/${postId}/review`);
  const { fields, files } = await multipartData(req);
  const role = fields.role === 'cover' ? 'cover' : 'internal';
  const credit = String(fields.credit || '').trim();
  const existing = await pool.query('select coalesce(max(display_order), 0) as max_order from post_assets where post_id = $1', [postId]);
  let order = Number(existing.rows[0]?.max_order || 0);
  const dir = path.join(uploadRoot, postId);
  fs.mkdirSync(dir, { recursive: true });
  const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  const allowedMime = /^image\/(jpeg|png|webp)$/i;
  for (const file of files.filter((item) => item.field === 'asset_files')) {
    const ext = path.extname(file.filename).toLowerCase();
    if (!allowedExt.has(ext) || !allowedMime.test(file.mime)) continue;
    const id = crypto.randomUUID();
    const fileName = `${id}${ext === '.jpeg' ? '.jpg' : ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, file.buffer);
    order += 1;
    await pool.query(`
      insert into post_assets (id, post_id, role, file_path, original_name, mime_type, size_bytes, display_order, credit)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, postId, role, filePath, file.filename, file.mime, file.buffer.length, order, credit]);
  }
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function updatePostAssets(req, res, user, postId) {
  const form = await formData(req);
  const assets = await pool.query('select * from post_assets where post_id = $1', [postId]);
  for (const asset of assets.rows) {
    await pool.query('update post_assets set role = $1, display_order = $2, credit = $3, updated_at = now() where id = $4 and post_id = $5', [
      form[`role_${asset.id}`] === 'cover' ? 'cover' : 'internal',
      Number(form[`order_${asset.id}`] || asset.display_order || 0),
      form[`credit_${asset.id}`] || '',
      asset.id,
      postId,
    ]);
  }
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function deletePostAsset(req, res, user, postId, assetId) {
  const asset = await pool.query('select * from post_assets where id = $1 and post_id = $2', [assetId, postId]);
  if (asset.rowCount) {
    try {
      const filePath = assetSafePath(asset.rows[0].file_path);
      fs.unlinkSync(filePath);
    } catch (error) {
      // Removing the DB record is more important than blocking on a missing file.
    }
    await pool.query('delete from post_assets where id = $1 and post_id = $2', [assetId, postId]);
  }
  redirect(res, `/posts/${postId}/review?saved=1`);
}

async function servePostAsset(req, res, user, postId, assetId, url) {
  const asset = await pool.query('select * from post_assets where id = $1 and post_id = $2', [assetId, postId]);
  if (!asset.rowCount) return sendHtml(res, layout({ title: 'Arquivo não encontrado', user, body: '<h1>Arquivo não encontrado</h1>' }), 404);
  try {
    const filePath = assetSafePath(asset.rows[0].file_path);
    return sendFile(res, filePath, {
      inline: url.searchParams.has('inline') && !url.searchParams.has('download'),
      downloadName: asset.rows[0].original_name || path.basename(filePath),
    });
  } catch (error) {
    return sendHtml(res, layout({ title: 'Arquivo não encontrado', user, body: `<h1>Arquivo não encontrado</h1><p>${escapeHtml(error.message)}</p>` }), 404);
  }
}

async function latestCompletedJob(postId) {
  const result = await pool.query(`
    select generation_jobs.*
    from generation_jobs
    join posts on posts.id = generation_jobs.post_id
    where generation_jobs.post_id = $1 and generation_jobs.status = 'completed'
    order by generation_jobs.created_at desc
    limit 1
  `, [postId]);
  return result.rows[0] || null;
}

async function serveGeneratedFile(req, res, user, postId, url) {
  const job = await latestCompletedJob(postId);
  if (!job) return sendHtml(res, layout({ title: 'Arquivo não encontrado', user, body: '<h1>Arquivo não encontrado</h1><p>Este post ainda não tem artes concluídas.</p>' }), 404);
  try {
    const relativeFile = url.searchParams.get('file') || '';
    const filePath = safeGeneratedPath(job, relativeFile);
    return sendFile(res, filePath, {
      inline: url.searchParams.has('inline') && !url.searchParams.has('download'),
      downloadName: path.basename(relativeFile),
    });
  } catch (error) {
    return sendHtml(res, layout({ title: 'Arquivo não encontrado', user, body: `<h1>Arquivo não encontrado</h1><p>${escapeHtml(error.message)}</p>` }), 404);
  }
}

async function downloadAllGenerated(req, res, user, postId) {
  const job = await latestCompletedJob(postId);
  if (!job) return sendHtml(res, layout({ title: 'Arquivos não encontrados', user, body: '<h1>Arquivos não encontrados</h1><p>Este post ainda não tem artes concluídas.</p>' }), 404);
  try {
    const post = await pool.query(`
      select posts.source_title, clients.slug as client_slug
      from posts
      join clients on clients.id = posts.client_id
      where posts.id = $1
    `, [postId]);
    const zip = new AdmZip();
    const slideFiles = generatedSlideFiles(job, 'jpg');
    const effectiveFormat = slideFiles.some((item) => item.format === 'jpg') ? 'jpg' : 'png';
    for (const item of slideFiles) {
      const filePath = safeGeneratedPath(job, item.file);
      zip.addLocalFile(filePath, item.format === 'jpg' ? 'jpg' : 'png');
    }
    for (const extra of ['contact_sheet.png', 'manifest.json']) {
      try {
        const filePath = safeGeneratedPath(job, extra);
        zip.addLocalFile(filePath);
      } catch (error) {
        // Optional files should not block downloading the generated slides.
      }
    }
    const buffer = zip.toBuffer();
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': buffer.length,
      'content-disposition': `attachment; filename="${downloadSlug(post.rows[0]?.client_slug, 'cliente')}-post-${postId.slice(0, 8)}-${effectiveFormat === 'jpg' ? 'jpg-otimizado' : 'png'}.zip"`,
    });
    res.end(buffer);
  } catch (error) {
    sendHtml(res, layout({ title: 'Erro no download', user, body: `<h1>Erro no download</h1><p>${escapeHtml(error.message)}</p>` }), 500);
  }
}

async function downloadBulkGenerated(req, res, user, slug, resultId) {
  const client = await pool.query('select * from clients where slug = $1', [slug]);
  if (!client.rowCount) return redirect(res, '/dashboard');
  const bulkDir = path.resolve(uploadRoot, 'bulk-results');
  const filePath = path.resolve(bulkDir, `${resultId}.json`);
  if (!filePath.startsWith(`${bulkDir}${path.sep}`) || !fs.existsSync(filePath)) return redirect(res, `/clients/${slug}`);

  try {
    const result = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const created = Array.isArray(result.created) ? result.created : [];
    const postIds = created.map((item) => item.id).filter(Boolean);
    const posts = postIds.length
      ? await pool.query(`
        select id, source_title
        from posts
        where id = any($1) and client_id = $2
      `, [postIds, client.rows[0].id])
      : { rows: [] };
    const jobs = postIds.length
      ? await pool.query(`
        select distinct on (post_id) *
        from generation_jobs
        where post_id = any($1) and status = 'completed'
        order by post_id, created_at desc
      `, [postIds])
      : { rows: [] };
    const postById = Object.fromEntries(posts.rows.map((post) => [post.id, post]));
    const jobByPostId = Object.fromEntries(jobs.rows.map((job) => [job.post_id, job]));
    const zip = new AdmZip();
    const report = [
      `Cliente: ${client.rows[0].name}`,
      `Arquivo bulk: ${result.filename || resultId}`,
      `Gerado em: ${new Date().toISOString()}`,
      '',
      'Itens:',
    ];
    let included = 0;
    let usedJpg = false;
    let usedPng = false;

    for (let index = 0; index < created.length; index += 1) {
      const item = created[index];
      const post = postById[item.id];
      const title = item.title || post?.source_title || `Post ${index + 1}`;
      if (!post) {
        report.push(`- PULADO: ${title} (post não pertence a este cliente ou não existe mais)`);
        continue;
      }
      const job = jobByPostId[item.id];
      if (!job) {
        report.push(`- PULADO: ${title} (artes ainda não concluídas)`);
        continue;
      }
      const slideFiles = generatedSlideFiles(job, 'jpg');
      if (!slideFiles.length) {
        report.push(`- PULADO: ${title} (nenhum slide encontrado na geração concluída)`);
        continue;
      }
      const postFolder = `${String(index + 1).padStart(2, '0')} - ${zipSafeName(title, `post-${index + 1}`)}`;
      let addedSlides = 0;
      for (const slide of slideFiles) {
        try {
          const source = safeGeneratedPath(job, slide.file);
          const folder = path.posix.join(postFolder, slide.format === 'jpg' ? 'jpg' : 'png');
          zip.addLocalFile(source, folder);
          addedSlides += 1;
          if (slide.format === 'jpg') usedJpg = true;
          if (slide.format === 'png') usedPng = true;
        } catch (error) {
          report.push(`- AVISO: ${title} / ${slide.file} não entrou no ZIP (${error.message})`);
        }
      }
      for (const extra of ['contact_sheet.png', 'manifest.json']) {
        try {
          const source = safeGeneratedPath(job, extra);
          zip.addLocalFile(source, postFolder);
        } catch (error) {
          // Optional support files should not block the bulk download.
        }
      }
      if (addedSlides) {
        included += 1;
        report.push(`- OK: ${title} (${addedSlides} slides)`);
      } else {
        report.push(`- PULADO: ${title} (arquivos da geração não foram encontrados)`);
      }
    }

    if (!included) {
      return sendHtml(res, layout({ title: 'ZIP não disponível', user, body: `
        <h1>ZIP não disponível</h1>
        <p>Nenhum post deste bulk tem artes concluídas para baixar ainda.</p>
        <p><a href="/clients/${slug}/bulk-docx/result/${resultId}">Voltar ao bulk</a></p>
      ` }), 404);
    }

    report.unshift(`Posts incluídos: ${included} de ${created.length}`, '');
    zip.addFile('_relatorio.txt', Buffer.from(report.join('\n'), 'utf8'));
    const buffer = zip.toBuffer();
    const formatLabel = usedJpg && !usedPng ? 'jpg-otimizado' : (usedJpg ? 'jpg-otimizado-com-fallback-png' : 'png');
    const filename = `${downloadSlug(client.rows[0].slug, 'cliente')}-${downloadSlug(result.monthLabel || result.filename || resultId, 'bulk')}-todos-posts-${formatLabel}.zip`;
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': buffer.length,
      'content-disposition': `attachment; filename="${filename}"`,
    });
    return res.end(buffer);
  } catch (error) {
    return sendHtml(res, layout({ title: 'Erro no download bulk', user, body: `<h1>Erro no download bulk</h1><p>${escapeHtml(error.message)}</p>` }), 500);
  }
}

function driveDateParts(post, job) {
  const base = new Date(job?.created_at || post?.created_at || Date.now());
  const meta = post?.source_meta && typeof post.source_meta === 'object' ? post.source_meta : {};
  const year = String(meta.bulk_year || base.getFullYear());
  const month = String(meta.bulk_month_label || monthLabelFromText(post?.source_title || post?.source_text || '') || String(base.getMonth() + 1).padStart(2, '0'));
  return { year, month };
}

function driveFileList(job) {
  const files = generatedSlideFiles(job, 'jpg').map((item) => item.file);
  for (const extra of ['contact_sheet.png', 'manifest.json']) {
    try {
      safeGeneratedPath(job, extra);
      files.push(extra);
    } catch (error) {
      // Optional support files should not block saving the slides to Drive.
    }
  }
  return files.filter((file, index, list) => list.indexOf(file) === index);
}

function cloneFileList(job, postTitle) {
  const result = job?.result_json || {};
  const outputDir = String(job?.output_dir || '').replace(/\/+$/, '');
  const covers = Array.isArray(result.generated_covers) ? result.generated_covers : [];
  const files = covers.map((cover) => {
    const absolute = String(cover?.file || '');
    if (!absolute || !absolute.startsWith(`${outputDir}/`)) return '';
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

async function savedDriveFolderForPost(postId, job) {
  if (job?.drive_folder_id) return job.drive_folder_id;
  const result = await pool.query(`
    select drive_folder_id
    from generation_jobs
    where post_id = $1 and drive_folder_id is not null and drive_folder_id <> ''
    order by drive_saved_at desc nulls last, created_at desc
    limit 1
  `, [postId]);
  return result.rows[0]?.drive_folder_id || '';
}

async function savedCloneFolderForPost(postId, job) {
  if (job?.clone_drive_folder_id) return job.clone_drive_folder_id;
  const result = await pool.query(`
    select clone_drive_folder_id
    from generation_jobs
    where post_id = $1 and clone_drive_folder_id is not null and clone_drive_folder_id <> ''
    order by clone_drive_saved_at desc nulls last, created_at desc
    limit 1
  `, [postId]);
  return result.rows[0]?.clone_drive_folder_id || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDriveSaveError(error) {
  return /error in workflow|timeout|temporar|connection|connect|econnreset|socket|gateway|503|502|504/i.test(String(error?.message || error || ''));
}

async function callDriveSave(payload) {
  const attempts = Number(process.env.N8N_DRIVE_SAVE_ATTEMPTS || 3);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
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
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientDriveSaveError(error)) break;
      await sleep(5000 * attempt);
    }
  }
  throw lastError;
}

async function saveCompletedPostToDrive(postId) {
  const postResult = await pool.query(`
    select posts.*, clients.drive_folder_id, clients.clone_folder_id
    from posts
    join clients on clients.id = posts.client_id
    where posts.id = $1
  `, [postId]);
  if (!postResult.rowCount) throw new Error('Post não encontrado.');
  const job = await latestCompletedJob(postId);
  if (!job) throw new Error('Este post ainda não tem geração concluída.');
  if (job.drive_status === 'saved' && job.drive_folder_link) {
    return { post: postResult.rows[0], job, drive_folder_link: job.drive_folder_link };
  }

  if (!driveSaveWebhookUrl || !driveSaveSecret) throw new Error('Webhook do Drive não configurado no painel.');
  const post = postResult.rows[0];
  const { year, month } = driveDateParts(post, job);
  const files = driveFileList(job);
  if (!files.length) throw new Error('Nenhum arquivo gerado encontrado para salvar.');

  await pool.query("update generation_jobs set drive_status = 'saving', drive_error = null, updated_at = now() where id = $1", [job.id]);
  try {
    const data = await callDriveSave({
      base_folder_id: post.drive_folder_id,
      year,
      month,
      post_name: post.source_title,
      output_dir: job.output_dir,
      files,
    });
    await pool.query(`
      update generation_jobs
      set drive_status = 'saved',
        drive_folder_id = $1,
        drive_folder_link = $2,
        drive_error = null,
        drive_saved_at = now(),
        updated_at = now()
      where id = $3
    `, [data.drive_folder_id || '', data.drive_folder_link || '', job.id]);

    const cloneFiles = cloneFileList(job, post.source_title);
    if (post.clone_folder_id && cloneFiles.length) {
      try {
        await pool.query("update generation_jobs set clone_drive_status = 'saving', clone_drive_error = null, updated_at = now() where id = $1", [job.id]);
        const cloneData = await callDriveSave({
          base_folder_id: post.clone_folder_id,
          year,
          month,
          post_name: post.source_title,
          post_folder_id: post.clone_folder_id,
          output_dir: job.output_dir,
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
          set clone_drive_status = 'failed', clone_drive_error = $1, updated_at = now()
          where id = $2
        `, [String(error.message || error), job.id]);
      }
    }
    return { post, job, drive_folder_link: data.drive_folder_link || '' };
  } catch (error) {
    await pool.query(`
      update generation_jobs
      set drive_status = 'failed', drive_error = $1, updated_at = now()
      where id = $2
    `, [String(error.message || error), job.id]);
    throw error;
  }
}

async function runBulkDriveSave(postIds, label = '') {
  for (const postId of postIds) {
    try {
      await saveCompletedPostToDrive(postId);
    } catch (error) {
      console.error(`[bulk-drive] ${label} ${postId}:`, error);
      try {
        const job = await latestCompletedJob(postId);
        if (job) {
          await pool.query(`
            update generation_jobs
            set drive_status = 'failed', drive_error = $1, updated_at = now()
            where id = $2
          `, [String(error.message || error), job.id]);
        }
      } catch (statusError) {
        console.error(`[bulk-drive] falha ao registrar erro em ${postId}:`, statusError);
      }
    }
  }
}

async function saveGeneratedToDrive(req, res, user, postId) {
  try {
    await saveCompletedPostToDrive(postId);
    return redirect(res, `/posts/${postId}/review?drive_saved=1`);
  } catch (error) {
    return redirect(res, `/posts/${postId}/review?drive_error=1`);
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return sendJson(res, { ok: true, app: appName, started_at: startedAt });
  if (await socialPublishing.media(req, res, url)) return;
  if (await communityFeed.media(req, res, url)) return;
  if (await communityEditorial.internal(req, res, url)) return;

  const publicHeaders = {
    'cache-control': 'public, max-age=300',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
  if (req.method === 'GET' && url.pathname === '/privacy') return sendHtml(res, privacyPage(), 200, publicHeaders);
  if (req.method === 'GET' && url.pathname === '/terms') return sendHtml(res, termsPage(), 200, publicHeaders);
  if (req.method === 'GET' && url.pathname === '/data-deletion') return sendHtml(res, dataDeletionPage(), 200, publicHeaders);

  if (req.method === 'GET' && url.pathname === '/login') return sendHtml(res, loginPage('', url.searchParams.get('next')));
  if (req.method === 'POST' && url.pathname === '/login') {
    const form = await formData(req);
    const users = await pool.query('select * from users where email = $1', [String(form.email || '').trim().toLowerCase()]);
    if (!users.rowCount || !(await verifyPassword(form.password || '', users.rows[0].password_hash))) {
      return sendHtml(res, loginPage('Email ou senha inválidos.', form.next), 401);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval \'14 days\')', [hashToken(token), users.rows[0].id]);
    return redirect(res, editorialReturn(form.next), { 'set-cookie': sessionCookie(token) });
  }
  if (req.method === 'POST' && url.pathname === '/logout') return redirect(res, '/login', { 'set-cookie': clearCookie() });

  const user = await requireUser(req, res);
  if (!user) return;
  try {
    await socialConnections.guard(req, user, url);
  } catch (error) {
    if (!(error instanceof SocialError)) throw error;
    return sendHtml(res, layout({title:'Acesso',user,body:`<h1>${escapeHtml(error.message)}</h1>`}), error.status);
  }
  if (await contentStudio.guardLegacy(req, res, user, url)) return;
  if (await contentStudio.handle(req, res, user, url)) return;
  if (await socialConnections.handle(req, res, user, url)) return;
  if (await socialPublishing.handle(req, res, user, url)) return;
  if (await socialStatistics.handle(req, res, user, url)) return;
  if (await communityEditorial.handle(req, res, user, url)) return;
  if (await communityImages.handle(req, res, user, url)) return;
  if (await communityFeed.handle(req, res, user, url)) return;
  if (await communityStatistics.handle(req, res, user, url)) return;

  if (url.pathname === '/') return redirect(res, '/dashboard');
  if (req.method === 'GET' && url.pathname === '/dashboard') return dashboard(req, res, user);

  const clientMatch = url.pathname.match(/^\/clients\/([^/]+)$/);
  if (req.method === 'GET' && clientMatch) return clientPage(req, res, user, clientMatch[1]);

  const postUnicoMatch = url.pathname.match(/^\/clients\/([^/]+)\/post-unico$/);
  if (req.method === 'GET' && postUnicoMatch) return postUnicoPage(req, res, user, postUnicoMatch[1]);
  if (req.method === 'POST' && postUnicoMatch) return createPostUnico(req, res, user, postUnicoMatch[1]);

  const bulkDocxMatch = url.pathname.match(/^\/clients\/([^/]+)\/bulk-docx$/);
  if (req.method === 'GET' && bulkDocxMatch) return bulkDocxPage(req, res, user, bulkDocxMatch[1]);
  if (req.method === 'POST' && bulkDocxMatch) return createBulkDocx(req, res, user, bulkDocxMatch[1]);

  const bulkDocxResultMatch = url.pathname.match(/^\/clients\/([^/]+)\/bulk-docx\/result\/([^/]+)$/);
  if (req.method === 'GET' && bulkDocxResultMatch) return bulkDocxResultPage(req, res, user, bulkDocxResultMatch[1], bulkDocxResultMatch[2], url);

  const bulkDownloadAllMatch = url.pathname.match(/^\/clients\/([^/]+)\/bulk-docx\/result\/([^/]+)\/download-all$/);
  if (req.method === 'GET' && bulkDownloadAllMatch) return downloadBulkGenerated(req, res, user, bulkDownloadAllMatch[1], bulkDownloadAllMatch[2]);

  const bulkGenerateAllMatch = url.pathname.match(/^\/clients\/([^/]+)\/bulk-docx\/result\/([^/]+)\/generate-all$/);
  if (req.method === 'POST' && bulkGenerateAllMatch) return bulkGenerateAll(req, res, user, bulkGenerateAllMatch[1], bulkGenerateAllMatch[2]);

  const bulkSaveDriveAllMatch = url.pathname.match(/^\/clients\/([^/]+)\/bulk-docx\/result\/([^/]+)\/save-drive-all$/);
  if (req.method === 'POST' && bulkSaveDriveAllMatch) return bulkSaveDriveAll(req, res, user, bulkSaveDriveAllMatch[1], bulkSaveDriveAllMatch[2]);

  const coverOnlyMatch = url.pathname.match(/^\/clients\/([^/]+)\/cover-only$/);
  if (req.method === 'GET' && coverOnlyMatch) return coverOnlyPage(req, res, user, coverOnlyMatch[1]);
  if (req.method === 'POST' && coverOnlyMatch) return createCoverOnly(req, res, user, coverOnlyMatch[1]);

  const aiCoverMatch = url.pathname.match(/^\/clients\/([^/]+)\/ai-cover$/);
  if (req.method === 'GET' && aiCoverMatch) return aiCoverPage(req, res, user, aiCoverMatch[1]);
  if (req.method === 'POST' && aiCoverMatch) return createAiCover(req, res, user, aiCoverMatch[1]);

  const reviewMatch = url.pathname.match(/^\/posts\/([^/]+)\/review$/);
  if (req.method === 'GET' && reviewMatch) return reviewPost(req, res, user, reviewMatch[1], url);
  if (req.method === 'POST' && reviewMatch) return updateReview(req, res, user, reviewMatch[1]);

  const regenerateAiCoverMatch = url.pathname.match(/^\/posts\/([^/]+)\/regenerate-ai-cover$/);
  if (req.method === 'POST' && regenerateAiCoverMatch) return regenerateAiCover(req, res, user, regenerateAiCoverMatch[1]);

  const generateAiCoverMatch = url.pathname.match(/^\/posts\/([^/]+)\/generate-ai-cover$/);
  if (req.method === 'POST' && generateAiCoverMatch) return generateAiCoverForPost(req, res, user, generateAiCoverMatch[1]);

  const generateAiInternalMatch = url.pathname.match(/^\/posts\/([^/]+)\/generate-ai-internal-images$/);
  if (req.method === 'POST' && generateAiInternalMatch) return generateAiInternalImages(req, res, user, generateAiInternalMatch[1]);

  const assetUploadMatch = url.pathname.match(/^\/posts\/([^/]+)\/assets$/);
  if (req.method === 'POST' && assetUploadMatch) return uploadPostAssets(req, res, user, assetUploadMatch[1]);

  const assetUpdateMatch = url.pathname.match(/^\/posts\/([^/]+)\/assets\/update$/);
  if (req.method === 'POST' && assetUpdateMatch) return updatePostAssets(req, res, user, assetUpdateMatch[1]);

  const assetDeleteMatch = url.pathname.match(/^\/posts\/([^/]+)\/assets\/([^/]+)\/delete$/);
  if (req.method === 'POST' && assetDeleteMatch) return deletePostAsset(req, res, user, assetDeleteMatch[1], assetDeleteMatch[2]);

  const assetFileMatch = url.pathname.match(/^\/posts\/([^/]+)\/asset\/([^/]+)$/);
  if (req.method === 'GET' && assetFileMatch) return servePostAsset(req, res, user, assetFileMatch[1], assetFileMatch[2], url);

  const fileMatch = url.pathname.match(/^\/posts\/([^/]+)\/file$/);
  if (req.method === 'GET' && fileMatch) return serveGeneratedFile(req, res, user, fileMatch[1], url);

  const zipMatch = url.pathname.match(/^\/posts\/([^/]+)\/download-all$/);
  if (req.method === 'GET' && zipMatch) return downloadAllGenerated(req, res, user, zipMatch[1]);

  const driveMatch = url.pathname.match(/^\/posts\/([^/]+)\/save-drive$/);
  if (req.method === 'POST' && driveMatch) return saveGeneratedToDrive(req, res, user, driveMatch[1]);

  sendHtml(res, layout({ title: 'Não encontrado', user, body: '<h1>Não encontrado</h1>' }), 404);
}

initDb().then(() => {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(error);
      sendHtml(res, `<pre>${escapeHtml(error.stack || error.message)}</pre>`, 500);
    });
  });
  server.listen(port, '0.0.0.0', () => { console.log(`${appName} listening on ${port}`); communityImages.start(); });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
