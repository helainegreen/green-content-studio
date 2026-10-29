const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const vm = require('node:vm');
const AdmZip = require('adm-zip');

const siblingSource = path.join(__dirname, 'server.js');
const sourcePath = process.env.SERVER_SOURCE || (fs.existsSync(siblingSource) ? siblingSource : path.join(__dirname, '..', 'server.js'));
const source = fs.readFileSync(sourcePath, 'utf8');
const startup = source.indexOf('\ninitDb().then(() => {');
assert.ok(startup > 0, 'The harness must exclude database and HTTP startup');

function harness(t, parserType = 'health_post_unico') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-docx-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const client = { id: 'test-client', slug: 'test-client', name: 'Test Client', parser_type: parserType };
  const posts = [];
  const slides = [];
  class Pool {
    async query(sql, values) {
      if (sql.startsWith('select * from clients')) return { rowCount: 1, rows: [client] };
      if (sql.startsWith('select * from posts')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('insert into posts')) posts.push(values);
      else if (sql.startsWith('insert into slides')) slides.push(values);
      else throw new Error(`Unexpected query: ${sql}`);
      return { rowCount: 1, rows: [] };
    }
  }
  const moduleStub = () => ({ link: () => '' });
  const context = {
    Buffer, URL, console, __dirname: path.dirname(sourcePath),
    process: { env: { GCS_UPLOAD_ROOT: directory } },
    require(name) {
      if (name === 'pg') return { Pool };
      if (name === './studio-module/studio.cjs') return { createStudioFeed: moduleStub };
      if (name === './statistics/studio.cjs') return { createStatistics: moduleStub };
      if (name === './image-jobs/studio.cjs') return { createImageJobs: moduleStub };
      return require(name.startsWith('./') ? path.resolve(path.dirname(sourcePath),name) : name);
    },
  };
  vm.runInNewContext(source.slice(0, startup) + '\nglobalThis.api = { clientPage, bulkDocxPage, createBulkDocx, textFromDocxBuffer, splitBulkPosts, parseClientPost };', context);
  return { ...context.api, client, posts, slides, directory };
}

function response() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = '') { this.body = String(body); },
  };
}

function docx(text) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
  const xmlEscape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split('\n').map((line) => `<w:p><w:r><w:t>${xmlEscape(line)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`));
  return zip.toBuffer();
}

function upload(buffer, filename = 'Posts_Mes20_Interno.docx') {
  const boundary = 'test-docx-boundary';
  const req = Readable.from([Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="year"\r\n\r\n2026\r\n--${boundary}\r\nContent-Disposition: form-data; name="docx_file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])]);
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  return req;
}

const healthPost = (number, dash = '-', bare = false) => `[POST ${number}] ${dash} Mes 20 ${dash} Tema ${number} ${dash} Dra Health
Slide 1 ${dash} Capa
Headline:
Manchete exclusiva ${number}
Subheadline:
Subtitulo ${number}
Descricao da imagem (Gemini ${dash} clone):
Fotografia de referencia ${number}.
Slide 2${bare ? '' : ` ${dash} Desenvolvimento`}
Titulo (caixa azul):
Explicacao ${number}
Texto:
Paragrafo original ${number}.
Descricao da imagem de fundo:
Imagem interna ${number}.
Slide 3 ${dash} Fechamento
Palavra destaque: ATENCAO
Conclusao ${number}.
IMAGEM: Instrucao visual que nao deve aparecer na arte.
Slide 4 ${dash} CTA (padrao)
(Slide fixo, igual em todos os posts)
LEGENDA
Legenda separada ${number}.`;

for (const type of ['health_post_unico', 'wellness_post_unico', 'community_manual', 'unknown']) {
  test(`bulk entry points: ${type}`, async (t) => {
    const app = harness(t, type);
    const enabled = ['health_post_unico', 'wellness_post_unico'].includes(type);
    const page = response();
    await app.clientPage({}, page, {}, app.client.slug);
    assert.equal(page.body.includes(`href="/clients/${app.client.slug}/bulk-docx"`), enabled);
    const form = response();
    await app.bulkDocxPage({}, form, {}, app.client.slug);
    assert.equal(form.status, enabled ? 200 : 303);
    if (enabled) assert.match(form.body, /name="docx_file"/);
    else {
      const rejected = response();
      await app.createBulkDocx({}, rejected, {}, app.client.slug);
      assert.equal(rejected.status, 303);
      assert.equal(app.posts.length, 0);
    }
  });
}

for (const dash of ['-', '\u2013', '\u2014']) {
  for (const bare of [false, true]) {
    test(`Health multipart upload: dash ${dash.codePointAt(0)}, bare headings ${bare}`, async (t) => {
      const app = harness(t);
      const res = response();
      await app.createBulkDocx(upload(docx([1, 2].map((i) => healthPost(i, dash, bare)).join('\n'))), res, {}, app.client.slug);
      assert.equal(res.status, 303, res.body.match(/class="error">([^<]*)/)?.[1]);
      assert.match(res.headers.location, /\/bulk-docx\/result\//);
      assert.equal(app.posts.length, 2);
      assert.equal(new Set(app.posts.map((p) => p[3])).size, 2);
      app.posts.forEach((post, i) => {
        assert.equal(post[1], app.client.id);
        assert.equal(post[6], 'draft');
        assert.equal(post[5].bulk_year, '2026');
        assert.equal(post[5].bulk_month_label, 'M\u00eas 20');
        const slides = app.slides.filter((s) => s[1] === post[0]);
        assert.equal(slides.length, 3);
        assert.equal(slides[0][4], `Manchete exclusiva ${i + 1}`);
        assert.equal(slides[1][5], `Paragrafo original ${i + 1}.`);
        assert.equal(slides[2][3], 'cta');
        assert.doesNotMatch(slides.map((s) => s[5]).join('\n'), /Instrucao visual|Legenda separada/);
      });
      const resultFile = fs.readdirSync(path.join(app.directory, 'bulk-results'))[0];
      const result = JSON.parse(fs.readFileSync(path.join(app.directory, 'bulk-results', resultFile)));
      assert.equal(result.created.length, 2);
      assert.deepEqual(result.errors, []);
    });
  }
}

test('Wellness upload continues to use its own parser', async (t) => {
  const app = harness(t, 'wellness_post_unico');
  const text = '[POST 1] - Mes 20 - Wellness\nCAPA (SLIDE 1)\nHeadline:\nCapa da Wellness\nSubheadline:\nSubtitulo da Wellness\nPROMPT GEMINI (CAPA): Foto\nSLIDE 2 - CTA\nTitulo:\nContato\nTexto:\nTexto de contato.';
  const res = response();
  await app.createBulkDocx(upload(docx(text)), res, {}, app.client.slug);
  assert.equal(res.status, 303);
  assert.equal(app.posts.length, 1);
  assert.equal(app.slides[0][4], 'Capa da Wellness');
  assert.equal(app.slides[1][3], 'cta');
});

test('Invalid DOCX creates no posts', async (t) => {
  const app = harness(t);
  const res = response();
  await app.createBulkDocx(upload(Buffer.from('invalid zip')), res, {}, app.client.slug);
  assert.equal(res.status, 200);
  assert.equal(app.posts.length, 0);
  assert.match(res.body, /class="error"/);
});

test('Real Health DOCX: distinct drafts, complete slides and isolated caption', { skip: !process.env.HEALTH_DOCX }, async (t) => {
  const app = harness(t);
  const filePath = process.env.HEALTH_DOCX;
  const buffer = fs.readFileSync(filePath);
  const blocks = app.splitBulkPosts(app.textFromDocxBuffer(buffer));
  assert.equal(blocks.length, 12);
  const res = response();
  await app.createBulkDocx(upload(buffer, path.basename(filePath)), res, {}, app.client.slug);
  assert.equal(res.status, 303, res.body.match(/class="error">([^<]*)/)?.[1]);
  assert.equal(app.posts.length, blocks.length);
  assert.equal(new Set(app.posts.map((p) => p[3])).size, blocks.length);
  app.posts.forEach((post, index) => {
    assert.equal(post[4], blocks[index]);
    const slides = app.slides.filter((s) => s[1] === post[0]);
    const declaredSlides = [...blocks[index].matchAll(/^Slide\s+\d+\b/gim)].length;
    assert.equal(slides.length, declaredSlides - 1, `Incomplete slides: ${post[3]}`);
    assert.ok(slides[0][4]);
    assert.ok(slides[0][6]);
    assert.equal(slides.at(-1)[3], 'cta');
    assert.doesNotMatch(slides.map((s) => s[4] + '\n' + s[5]).join('\n'), /LEGENDA|IMAGEM:|BLOCO FIXO|GEMINI|Op[c\u00e7][a\u00e3]o A/);
  });
  assert.equal(new Set(app.slides.filter((s) => s[3] === 'capa').map((s) => s[4])).size, blocks.length);
});
