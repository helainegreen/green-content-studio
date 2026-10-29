'use strict';

function cleanLine(value) {
  return String(value).trim().replace(/^#{1,6}[ \t]+/, '')
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^\*\*([^*]+:)\*\*[ \t]*/, '$1 ');
}

function heading(line) {
  if (/^CAPA[ \t]*\([ \t]*SLIDE[ \t]+1[ \t]*\)[ \t]*:?[ \t]*$/i.test(line)) {
    return {number: 1, marker: 'CAPA'};
  }
  const match = line.match(/^SLIDE[ \t]+(\d+)(?:[ \t]*\([^)]*\))?(?:[ \t]*[-\u2013\u2014][ \t]*(.*?))?[ \t]*:?[ \t]*$/i);
  return match ? {number: Number(match[1]), marker: match[2] || ''} : null;
}

function label(line) {
  const text = line.match(/^(headline|subheadline|t[i\u00ed]tulo|texto)[ \t]*:[ \t]*(.*)$/i);
  if (text) {
    const key = text[1].toLowerCase();
    return {key: key === 'headline' || /^t[i\u00ed]tulo$/.test(key) ? 'title' : 'body', value: text[2]};
  }
  const prompt = line.match(/^PROMPT[ \t]+(GEMINI|OPENAI)(?:[ \t]*\([^)]*\))?[ \t]*:?[ \t]*(.*)$/i);
  return prompt ? {key: 'prompt', value: prompt[2], provider: prompt[1].toLowerCase()} : null;
}

function parseFields(block) {
  const fields = {plain: []};
  let current = 'plain', provider = '';
  for (const line of block.lines) {
    const field = label(line);
    if (field) {
      if (Object.hasOwn(fields, field.key)) throw new Error(`Slide ${block.number}: campo ${field.key} repetido. Revise o conteudo.`);
      current = field.key;
      fields[current] = field.value ? [field.value] : [];
      if (field.provider) provider = field.provider;
    } else fields[current].push(line);
  }
  const value = key => (fields[key] || []).join('\n').trim();
  let title = value('title'), body = value('body');
  // Without a Texto label, only the first title line is the heading; preserve the rest as paragraphs.
  if (block.number > 1 && !Object.hasOwn(fields, 'body')) {
    const content = (title || value('plain')).split('\n');
    title = content.shift()?.trim() || '';
    body = content.join('\n').trim();
  }
  return {number: block.number, marker: block.marker, title, body, prompt: value('prompt'), provider};
}

function meaningful(value) {
  return !!String(value).trim() && !/^(?:CTA|CAPA|M[E\u00c9]TODO|SLIDE[ \t]+\d+|HEADLINE|SUBHEADLINE|T[I\u00cd]TULO|TEXTO)[ \t]*:?[ \t]*$/i.test(String(value).trim());
}

function parseWellnessPost(rawText) {
  const lines = String(rawText || '').replace(/\r\n?/g, '\n').split('\n').map(cleanLine);
  const headers = lines.filter(line => /^\[POST\b/i.test(line));
  if (headers.length > 1) throw new Error('Mais de um post no mesmo conteudo. Separe o lote antes de interpretar os slides.');
  const sourceTitle = headers[0] || lines.find(Boolean) || '';
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (/^LEGENDA(?:[ \t]*\([^)]*\))?[ \t]*:?$/i.test(line)) break;
    const next = heading(line);
    if (next) { current = {...next, lines: []}; blocks.push(current); }
    else if (current) current.lines.push(line);
  }
  if (blocks.length < 2 || blocks[0].number !== 1) throw new Error('Nao foi possivel identificar a capa e os slides da Wellness.');
  const slides = blocks.map(parseFields);
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    if (slide.number !== i + 1) throw new Error('A numeracao dos slides deve ser unica e consecutiva, comecando na capa.');
    slide.slot = i === 0 ? 'capa' : i === slides.length - 1 ? 'cta' : i === slides.length - 2 ? 'metodo' : 'interno';
    if (!meaningful(slide.title) && !meaningful(slide.body)) throw new Error(`Slide ${slide.number}: texto ausente ou apenas rotulo de estrutura. Revise antes de gerar.`);
    if (slide.title && !meaningful(slide.title)) throw new Error(`Slide ${slide.number}: o rotulo ${slide.title} nao pode ser usado como titulo.`);
    if (slide.body && !meaningful(slide.body)) throw new Error(`Slide ${slide.number}: o texto contem apenas um rotulo.`);
    if (i === 0 && !meaningful(slide.title)) throw new Error('Capa sem headline. Nenhuma arte sera gerada.');
    if (slide.slot === 'interno' && slide.provider === 'gemini' && slide.prompt && !/^\s*(GEMINI_CLONE|WELLNESS_CLONE|GEMINI_CLONE_INTERNO)\s*:/i.test(slide.prompt)) {
      slide.prompt = 'GEMINI_CLONE: ' + slide.prompt;
    }
    delete slide.provider;
    delete slide.marker;
  }
  const postTitle = sourceTitle.replace(/^\[POST[^\]]+\][ \t]*[-\u2013\u2014][ \t]*/i, '');
  return {sourceTitle, postTitle, slides};
}

function toRenderPost(parsed) {
  const [cover, ...slides] = parsed.slides;
  return {postTitle: parsed.postTitle, cover: {title: cover.title, subtitle: cover.body, prompt: cover.prompt},
    slides: slides.map(slide => ({...slide, isCta: slide.slot === 'cta', isMetodo: slide.slot === 'metodo'}))};
}

function validateImages(post, targetSlide = 0) {
  if (targetSlide && (!Number.isInteger(targetSlide) || targetSlide < 1 || targetSlide > post.slides.length + 1)) {
    throw new Error('Slide escolhido para regeneracao e invalido.');
  }
  if ((!targetSlide || targetSlide === 1) && !post.cover.prompt.trim()) throw new Error('Capa sem prompt Gemini. Geracao bloqueada; imagens antigas nao serao reutilizadas.');
  for (const slide of post.slides) {
    if (targetSlide && targetSlide !== slide.number) continue;
    if (!slide.isCta && !slide.isMetodo && !slide.prompt.trim()) throw new Error(`Slide ${slide.number}: prompt de imagem ausente. Geracao bloqueada; imagens antigas nao serao reutilizadas.`);
  }
}

module.exports = {parseWellnessPost, toRenderPost, validateImages};
