/* global pf, $, esc, show, toast, modal, closeModal, pdfjsLib, PDFLib, fontkit, Tesseract, requireLogin, startAnalysis */
'use strict';
// ============================================================================
// PortalFirma Studio — editor PDF
//  · Render: pdf.js · Cambios: pdf-lib (+ fontkit para fuentes TrueType)
//  · Edición de texto: detecta párrafos (texto digital) o los reconoce con OCR
//    (fotocopias), los vuelve editables con una fuente equivalente a la original
//    y al guardar los "hornea": tapa el original con el color de fondo y escribe
//    el texto nuevo exactamente donde el navegador lo dibujó (WYSIWYG).
// ============================================================================

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
const { PDFDocument, StandardFonts, rgb, degrees, PDFName } = PDFLib;
const MAX_SEND = 20 * 1024 * 1024;
const A4 = [595.28, 841.89], LETTER = [612, 792], OFICIO = [612, 936];

// Catálogo de fuentes (fonts.js): equivalentes de Office, sin serifa, con serifa, monoespaciadas y manuscritas.
const FAMILIES = window.PF_FONTS;
// Para reconocer la fuente de un PDF: primero los nombres más específicos ("Roboto Mono" antes que "Roboto").
const FONT_MATCHERS = Object.values(FAMILIES).filter((f) => f.match).sort((a, b) => b.match.source.length - a.match.source.length);
const CSS2FAM = Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [v.css.toLowerCase(), k]));

// Cada pestaña es un documento con su propio estado. `ed` apunta a la pestaña activa.
let tabSeq = 0;
function newState() {
  return {
    id: 't' + (++tabSeq),
    bytes: null, name: 'documento.pdf', path: null, fromPdf: false, dirty: false,
    pdf: null, count: 0, current: 0, selected: new Set(), zoom: 1, scale: 1, scales: [],
    overlays: {}, undo: [], sel: null, multi: [], editing: null, tool: 'select', lifted: {},
    blocks: {}, ocr: {}, ocrPending: {}, vp1: {}, renderToken: 0, notice: null,
    scrollFrac: 0, find: null, textIndex: {}, side: 'pages', outline: undefined,
    fmt: { family: 'sans', size: 11, color: '#111111', bold: false, italic: false, underline: false, align: 'left', lh: 1.25 },
  };
}
const tabs = [];
let ed = newState();
const G = { busy: false }; // estado global de la interfaz (una operación a la vez)
let uid = 0;

// ---------- utilidades ----------
const fmtMB = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';
const hasOverlays = () => Object.values(ed.overlays).some((l) => l.length) || Object.values(ed.ocr).some((o) => o && !o.baked);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (c) => '#' + c.map((x) => clamp(Math.round(x * 255), 0, 255).toString(16).padStart(2, '0')).join('');
const unhex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [0, 0, 0]; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const cssRgb = (s) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(s || ''); return m ? [m[1] / 255, m[2] / 255, m[3] / 255, m[4] == null ? 1 : Number(m[4])] : [0, 0, 0, 1]; };
function busy(msg, pct) {
  G.busy = !!msg; G.busyMsg = msg || '';
  globalBusy();
  const b = $('#edBusy'); if (!b) return;
  b.classList.toggle('hidden', !msg); b.querySelector('span').textContent = msg || '';
  const bar = b.querySelector('.ed-progress'); bar.classList.toggle('hidden', pct == null); if (pct != null) bar.firstElementChild.style.width = Math.round(pct * 100) + '%';
}
// Fuera del editor (Inicio, Plazos, etc.) el aviso de «trabajando» se muestra flotante, para que se vea que algo está pasando
function globalBusy() {
  const g = document.getElementById('globalBusy'); if (!g) return;
  const out = document.getElementById('view-editor')?.classList.contains('hidden');
  g.classList.toggle('hidden', !(G.busy && out));
  g.querySelector('span').textContent = G.busyMsg || '';
}
let stepDepth = 0; // pasos anidados: el aviso de «trabajando» se mantiene hasta que termina el de afuera
async function step(msg, fn) { stepDepth++; if (stepDepth === 1) busy(msg); try { return await fn(); } catch (e) { if (stepDepth > 1) throw e; if (!e.silent) { console.error(e); toast('Error: ' + e.message, 6000); } } finally { stepDepth--; if (!stepDepth) busy(null); } }
function setDirty(v = true) { ed.dirty = v; syncDocState(); updateToolbar(); }
function syncDocState() {
  pf.edState?.({ name: ed.name, dirty: ed.dirty, hasDoc: !!ed.bytes, path: ed.path, dirtyNames: tabs.filter((t) => t.dirty).map((t) => t.name) });
  renderTabs();
}
function cloneOverlays() { return JSON.parse(JSON.stringify(ed.overlays, (k, v) => (k === 'bytes' ? undefined : v))); }
function snapshot() {
  if (!ed.bytes) return;
  const imgs = {}; for (const l of Object.values(ed.overlays)) for (const o of l) if (o.bytes) imgs[o.id] = o.bytes;
  ed.undo.push({ bytes: ed.bytes, overlays: cloneOverlays(), imgs, ocr: JSON.parse(JSON.stringify(ed.ocr)) });
  while (ed.undo.length > (ed.bytes.length > 40e6 ? 3 : 10)) ed.undo.shift();
  setDirty(true);
}
async function loadLib(bytes) { const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); d.registerFontkit(fontkit); return d; }
async function saveLib(doc) { return doc.save({ useObjectStreams: true, updateFieldAppearances: false }); }

// Fuentes TrueType embebibles (cacheadas por archivo)
const fontBytesCache = {};
async function fontBytes(fam, bold, italic) {
  const st = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
  const f = (FAMILIES[fam] || FAMILIES.sans).files[st].replace(/\.ttf$/, '');
  if (!fontBytesCache[f]) fontBytesCache[f] = fetch(`vendor/fonts/${f}.ttf`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b));
  return { key: f, bytes: await fontBytesCache[f] };
}
const metricsCache = {};
async function fontMetrics(fam, bold, italic) { // ascent/descent relativos (hhea) para ubicar la línea base
  const { key, bytes } = await fontBytes(fam, bold, italic);
  if (!metricsCache[key]) { const f = fontkit.create(bytes); metricsCache[key] = { asc: f.ascent / f.unitsPerEm, desc: -f.descent / f.unitsPerEm }; }
  return metricsCache[key];
}

// Reconoce la fuente de un PDF y la lleva a una de nuestras familias.
function mapFont(rawName, fontObj, style) {
  const n = String(rawName || '').replace(/^[A-Z]{6}\+/, '');
  const l = n.toLowerCase();
  let family = 'sans';
  const compact = l.replace(/[\s_]/g, '');
  const hit = FONT_MATCHERS.find((f) => f.match.test(l) || f.match.test(compact));
  if (hit) family = hit.key;
  else if (/calibri|carlito/.test(l)) family = 'calibri';
  else if (/cambria|caladea/.test(l)) family = 'cambria';
  else if (/courier|mono|consol|lucidaconsole/.test(l)) family = 'mono';
  else if (/times|georgia|garamond|antiqua|palatino|bookman|century|serif(?!.*sans)|roman|minion|cmr\d|liberationserif/.test(l)) family = 'serif';
  else if (/arial|helvetica|verdana|tahoma|segoe|roboto|open ?sans|sans|liberationsans|calibri|gothic/.test(l)) family = 'sans';
  else if (fontObj?.isMonospace) family = 'mono';
  else if (fontObj?.isSerifFont || style?.fontFamily === 'serif') family = 'serif';
  const bold = /bold|black|heavy|semibold|demi|,b\b|-b\b/.test(l) || !!fontObj?.bold || !!fontObj?.black;
  const italic = /italic|oblique|,i\b|-it\b/.test(l) || !!fontObj?.italic;
  return { family, bold, italic, name: n || (style?.fontFamily || 'desconocida') };
}

// ---------- carga y render ----------
async function setBytes(bytes, { keepPage = true, structural = false, keepBlocks = false } = {}) {
  const T = ed;
  T.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try { await T.pdf?.destroy(); } catch {}
  T.pdf = await pdfjsLib.getDocument({ data: T.bytes.slice(), isEvalSupported: false, fontExtraProperties: true, standardFontDataUrl: 'vendor/standard_fonts/', cMapUrl: 'vendor/cmaps/', cMapPacked: true }).promise;
  T.count = T.pdf.numPages; T.vp1 = {}; if (!keepBlocks) T.blocks = {}; T.textIndex = {}; T.outline = undefined;
  // Tamaño de todas las páginas (para el desplazamiento continuo)
  for (let i = 0; i < T.count; i += 40) {
    await Promise.all(Array.from({ length: Math.min(40, T.count - i) }, async (_, k) => { const p = await T.pdf.getPage(i + k + 1); T.vp1[i + k] = p.getViewport({ scale: 1 }); }));
  }
  if (structural) { T.ocr = {}; }
  if (!keepPage || T.current >= T.count) T.current = clamp(T.current, 0, T.count - 1);
  T.selected = new Set([...T.selected].filter((i) => i < T.count));
  if (ed !== T) return;
  renderShell(); renderThumbs(); await renderPage(); updateToolbar(); renderSide();
  if (T.find?.q) runFind(T.find.q, { keepIdx: true });
}
async function vp1(i) { if (!ed.vp1[i]) { const p = await ed.pdf.getPage(i + 1); ed.vp1[i] = p.getViewport({ scale: 1 }); } return ed.vp1[i]; }
const isLarge = (v) => v.width * v.height > A4[0] * A4[1] * 3;

function fitScale(vp) {
  const area = $('#edCanvasWrap'); const availW = Math.max(300, (area?.clientWidth || 800) - 48);
  const availH = Math.max(300, (area?.clientHeight || 700) - 70);
  const fitAll = isLarge(vp) || vp.width > vp.height;
  return (fitAll ? Math.min(availW / vp.width, availH / vp.height) : Math.min(availW / vp.width, 1.6)) * ed.zoom;
}
const paper = (i) => document.querySelector(`#edStage .ed-paper[data-i="${i}"]`);
let shownTab = null; // pestaña dibujada actualmente en pantalla
let pageObserver = null;

// Desplazamiento continuo: todas las páginas en una columna; se dibujan solo las visibles.
async function renderPage() {
  if (!ed.pdf) return;
  const T = ed; ++T.renderToken;
  const stage = $('#edStage'); if (!stage) return;
  shownTab = T;
  pageObserver?.disconnect();
  stage.innerHTML = '';
  T.scales = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < T.count; i++) {
    const v = T.vp1[i]; const sc = fitScale(v); T.scales[i] = sc;
    const pg = document.createElement('div'); pg.className = 'ed-paper'; pg.dataset.i = i;
    pg.style.width = Math.floor(v.width * sc) + 'px'; pg.style.height = Math.floor(v.height * sc) + 'px';
    pg.innerHTML = '<canvas></canvas><div class="textLayer"></div><div class="ed-links"></div><div class="ed-layer"></div>';
    frag.appendChild(pg);
  }
  stage.appendChild(frag);
  stage.className = 'ed-stage mode-' + T.tool;
  const view = $('#edCanvasWrap');
  pageObserver = new IntersectionObserver((ents) => {
    for (const en of ents) { if (en.isIntersecting) drawPage(en.target); else releasePage(en.target); }
  }, { root: view, rootMargin: '900px 0px' });
  stage.querySelectorAll('.ed-paper').forEach((el) => pageObserver.observe(el));
  for (let i = 0; i < T.count; i++) renderOverlaysFor(i);
  setCurrent(T.current, { force: true });
  const el = paper(T.current);
  if (el) view.scrollTop = el.offsetTop - 52 + T.scrollFrac * el.offsetHeight;
  await drawPage(el);
}
function drawPage(el) {
  if (!el) return Promise.resolve();
  if (el._ready) return el._ready;
  const T = ed; const i = Number(el.dataset.i);
  el._ready = (async () => {
    let page; try { page = await T.pdf.getPage(i + 1); } catch { return; }
    if (ed !== T || !el.isConnected) return;
    const v1 = T.vp1[i] || page.getViewport({ scale: 1 }); const sc = T.scales[i];
    const vp = page.getViewport({ scale: sc });
    const canvas = el.querySelector('canvas');
    const k = Math.min(window.devicePixelRatio || 1, Math.sqrt(16e6 / (vp.width * vp.height)));
    canvas.width = Math.floor(vp.width * k); canvas.height = Math.floor(vp.height * k);
    el._k = canvas.width / v1.width; // px de canvas por punto
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: sc * k }) });
    el._task = task;
    try { await task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn(e); return; }
    el._task = null;
    if (ed !== T || !el.isConnected) return;
    el.classList.add('drawn');
    await Promise.all([drawTextLayer(el, page, vp, T, i), drawLinks(el, page, vp, T)]);
  })();
  return el._ready;
}
function releasePage(el) {
  const i = Number(el.dataset.i); if (i === ed.current || !el._ready) return;
  try { el._task?.cancel(); } catch {}
  el._ready = null; el._task = null; el._divs = null; el._strs = null; el._hl = null;
  const c = el.querySelector('canvas'); c.width = 0; c.height = 0;
  el.querySelector('.textLayer').innerHTML = ''; el.querySelector('.ed-links').innerHTML = '';
  el.classList.remove('drawn');
}
// Página activa: es la que recibe la edición (#edCanvas / #edLayer).
function setCurrent(i, { force = false } = {}) {
  const T = ed; i = clamp(i, 0, T.count - 1);
  if (!force && i === T.current && $('#edLayer')) return;
  if (T.editing) stopEditing();
  const prev = T.current;
  const old = $('#edLayer'); if (old) { old.removeAttribute('id'); old.querySelectorAll('.tb').forEach((n) => n.remove()); }
  $('#edCanvas')?.removeAttribute('id');
  document.querySelectorAll('#edStage .ed-paper.current').forEach((n) => n.classList.remove('current'));
  if (!force) T.sel = null;
  T.current = i;
  if (prev !== i) renderOverlaysFor(prev);
  const el = paper(i); if (!el) return;
  el.classList.add('current');
  el.querySelector('canvas').id = 'edCanvas'; el.querySelector('.ed-layer').id = 'edLayer';
  T.scale = T.scales[i] || T.scale;
  updatePageInfo();
  renderOverlays();
  document.querySelectorAll('.ed-thumb').forEach((t) => t.classList.toggle('current', Number(t.dataset.i) === i));
  document.querySelector(`.ed-thumb[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  drawPage(el).then(() => { if (ed !== T || T.current !== i) return; if (T.tool === 'edittext') showTextBlocks(); else checkScanned(); });
  if (!force) renderPanel();
}
function updatePageInfo() {
  const v1 = ed.vp1[ed.current]; if (!v1 || !$('#edPageNum')) return;
  if (document.activeElement !== $('#edPageNum')) $('#edPageNum').value = ed.current + 1;
  $('#edPageCount').textContent = `de ${ed.count}`;
  $('#edPageSize').textContent = `${Math.round(v1.width / 72 * 25.4)} × ${Math.round(v1.height / 72 * 25.4)} mm` + (isLarge(v1) ? ' · formato grande' : '');
  $('#edZoomPct').textContent = Math.round((ed.scales[ed.current] || 1) * 100) + '%';
}
function onViewScroll() {
  const T = ed; const view = $('#edCanvasWrap'); if (!T.pdf || !view || shownTab !== T) return;
  const y = view.scrollTop + view.clientHeight * 0.35;
  const papers = document.querySelectorAll('#edStage .ed-paper'); if (!papers.length) return;
  let lo = 0, hi = papers.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (papers[m].offsetTop <= y) lo = m; else hi = m - 1; }
  if (lo !== T.current && !T.editing && !layerDragging) setCurrent(lo);
  const cur = paper(T.current); if (cur) T.scrollFrac = clamp((view.scrollTop + 52 - cur.offsetTop) / cur.offsetHeight, -0.5, 1);
}

// --- Capa de texto seleccionable (copiar) y resaltado de búsqueda
async function drawTextLayer(el, page, vp, T, i) {
  const tl = el.querySelector('.textLayer'); tl.innerHTML = '';
  tl.style.setProperty('--scale-factor', vp.scale);
  let tc; try { tc = await page.getTextContent(); } catch { return; }
  if (!T.textIndex[i]) T.textIndex[i] = buildIndex(tc);
  const divs = [], strs = [];
  try { await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: divs, textContentItemsStr: strs }).promise; } catch { return; }
  if (ed !== T || !el.isConnected) return;
  el._divs = divs; el._strs = strs;
  applyHighlights(el);
}
const normText = (s) => { let o = ''; for (let j = 0; j < s.length; j++) { const c = s[j]; const n = (c.normalize('NFD')[0] || c).toLowerCase(); o += n.length === 1 ? n : c; } return o; };
function buildIndex(tc) {
  let str = ''; const starts = [], lens = [];
  for (const it of tc.items) {
    if (it.str === undefined) continue;
    starts.push(str.length); lens.push(it.str.length); str += it.str;
    if (it.hasEOL) str += ' ';
  }
  return { str, norm: normText(str).replace(/\s/g, ' '), starts, lens };
}
async function textIndex(T, i) {
  if (T.textIndex[i]) return T.textIndex[i];
  try { const tc = await (await T.pdf.getPage(i + 1)).getTextContent(); T.textIndex[i] = buildIndex(tc); } catch { T.textIndex[i] = { str: '', norm: '', starts: [], lens: [] }; }
  return T.textIndex[i];
}
function applyHighlights(el) {
  const divs = el._divs, strs = el._strs; if (!divs) return;
  for (const k of el._hl || []) divs[k].textContent = strs[k];
  el._hl = [];
  const f = ed.find; if (!f?.matches?.length) return;
  const i = Number(el.dataset.i); const idx = ed.textIndex[i]; if (!idx) return;
  const per = new Map();
  f.matches.forEach((m, n) => {
    if (m.p !== i) return;
    for (let k = 0; k < idx.starts.length; k++) {
      const a = idx.starts[k], b = a + idx.lens[k];
      if (b <= m.s) continue; if (a >= m.e) break;
      if (!per.has(k)) per.set(k, []);
      per.get(k).push([Math.max(0, m.s - a), Math.min(idx.lens[k], m.e - a), n === f.idx]);
    }
  });
  for (const [k, ranges] of per) {
    const d = divs[k], str = strs[k]; if (!d) continue;
    ranges.sort((x, y) => x[0] - y[0]);
    d.textContent = ''; let pos = 0;
    for (const [a, b, cur] of ranges) {
      if (a < pos) continue;
      if (a > pos) d.append(str.slice(pos, a));
      const sp = document.createElement('span'); sp.className = 'hl' + (cur ? ' cur' : ''); sp.textContent = str.slice(a, b); d.append(sp); pos = b;
    }
    if (pos < str.length) d.append(str.slice(pos));
    el._hl.push(k);
  }
}
const refreshHighlights = () => document.querySelectorAll('#edStage .ed-paper').forEach((el) => applyHighlights(el));

// --- Buscar (⌘F)
let findTimer = null;
function find() {
  const bar = $('#edFind'); if (!bar) return;
  bar.classList.remove('hidden');
  const inp = $('#edFindQ'); inp.focus(); inp.select();
}
function closeFind() { $('#edFind')?.classList.add('hidden'); ed.find = null; refreshHighlights(); updateFindUi(); }
async function runFind(q, { keepIdx = false } = {}) {
  const T = ed;
  const prevIdx = keepIdx && T.find ? T.find.idx : -1;
  const nq = normText(String(q || '').trim()).replace(/\s+/g, ' ');
  T.find = { q, matches: [], idx: -1, searching: true };
  updateFindUi();
  if (!nq) { T.find.searching = false; refreshHighlights(); updateFindUi(); return; }
  for (let i = 0; i < T.count; i++) {
    const idx = await textIndex(T, i);
    if (ed !== T || T.find?.q !== q) return;
    let from = 0;
    for (;;) { const j = idx.norm.indexOf(nq, from); if (j < 0) break; T.find.matches.push({ p: i, s: j, e: j + nq.length }); from = j + nq.length; }
    if (i % 25 === 24) updateFindUi();
  }
  T.find.searching = false;
  const ms = T.find.matches;
  if (ms.length) T.find.idx = prevIdx >= 0 && prevIdx < ms.length ? prevIdx : Math.max(0, ms.findIndex((m) => m.p >= T.current));
  refreshHighlights(); updateFindUi();
  if (ms.length && !keepIdx) revealMatch();
}
function findStep(d) {
  const f = ed.find;
  if (!f || !f.matches.length) { if ($('#edFind')?.classList.contains('hidden')) find(); return; }
  f.idx = (f.idx + d + f.matches.length) % f.matches.length;
  refreshHighlights(); updateFindUi(); revealMatch();
}
async function revealMatch() {
  const T = ed; const m = T.find?.matches[T.find.idx]; if (!m) return;
  const el = paper(m.p); if (!el) return;
  const view = $('#edCanvasWrap');
  if (el.offsetTop > view.scrollTop + view.clientHeight || el.offsetTop + el.offsetHeight < view.scrollTop) view.scrollTop = el.offsetTop - 52;
  await drawPage(el); if (ed !== T) return;
  applyHighlights(el);
  const h = el.querySelector('.hl.cur');
  if (h) h.scrollIntoView({ block: 'center', inline: 'nearest' });
  if (m.p !== T.current && !T.editing) setCurrent(m.p);
}
function updateFindUi() {
  const c = $('#edFindCount'); if (!c) return;
  const f = ed.find;
  c.textContent = !f || !f.q ? '' : f.matches.length ? `${f.idx + 1} de ${f.matches.length}${f.searching ? '…' : ''}` : f.searching ? 'Buscando…' : 'Sin resultados';
  c.classList.toggle('none', !!(f && f.q && !f.matches.length && !f.searching));
}

// --- Enlaces del PDF (a páginas y a sitios web)
async function drawLinks(el, page, vp, T) {
  const host = el.querySelector('.ed-links'); host.innerHTML = '';
  let ann = []; try { ann = await page.getAnnotations({ intent: 'display' }); } catch {}
  if (ed !== T || !el.isConnected) return;
  for (const a of ann) {
    if (a.subtype !== 'Link') continue;
    const url = a.url || a.unsafeUrl; const dest = a.dest; const action = a.action;
    if (!url && !dest && !action) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const d = document.createElement('a'); d.className = 'lnk'; d.href = '#';
    Object.assign(d.style, { left: Math.min(x1, x2) + 'px', top: Math.min(y1, y2) + 'px', width: Math.abs(x2 - x1) + 'px', height: Math.abs(y2 - y1) + 'px' });
    d.title = url ? url : 'Ir a otra parte del documento';
    d.onclick = (e) => {
      e.preventDefault();
      if (url) return openLink(url);
      if (dest) return gotoDest(dest);
      const n = { NextPage: ed.current + 1, PrevPage: ed.current - 1, FirstPage: 0, LastPage: ed.count - 1 }[action];
      if (n != null) goto(n);
    };
    host.appendChild(d);
  }
}
function openLink(url) {
  if (!/^(https?:|mailto:)/i.test(url)) return toast('Este enlace no se puede abrir por seguridad.');
  modal(`<h2>Abrir enlace</h2><p>El documento quiere abrir:</p><p class="mono small" style="word-break:break-all">${esc(url)}</p>
    <p class="muted small">Ábrelo solo si confías en el documento.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Abrir</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => { closeModal(); pf.openLink(url); };
}
async function gotoDest(dest) {
  const T = ed;
  try {
    const explicit = typeof dest === 'string' ? await T.pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return;
    const ref = explicit[0];
    const pi = typeof ref === 'object' && ref ? await T.pdf.getPageIndex(ref) : Number(ref);
    let yPt = 0;
    if (explicit[1]?.name === 'XYZ' && explicit[3] != null) { const v = T.vp1[pi]; if (v) yPt = Math.max(0, v.convertToViewportPoint(explicit[2] || 0, explicit[3])[1] - 10); }
    if (explicit[1]?.name === 'FitH' && explicit[2] != null) { const v = T.vp1[pi]; if (v) yPt = Math.max(0, v.convertToViewportPoint(0, explicit[2])[1] - 10); }
    if (ed === T) goto(pi, yPt);
  } catch (e) { console.warn(e); }
}

function renderThumbs() {
  const host = $('#edThumbs'); if (!host) return; host.innerHTML = '';
  const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); drawThumb(en.target); } }), { root: host });
  for (let i = 0; i < ed.count; i++) {
    const d = document.createElement('div');
    d.className = 'ed-thumb' + (i === ed.current ? ' current' : '') + (ed.selected.has(i) ? ' sel' : '');
    d.dataset.i = i; d.draggable = true;
    d.innerHTML = `<canvas></canvas><span>${i + 1}</span>`;
    host.appendChild(d); io.observe(d);
  }
}
async function drawThumb(el) {
  const i = Number(el.dataset.i); if (!ed.pdf || i >= ed.count) return;
  let page; try { page = await ed.pdf.getPage(i + 1); } catch { return; }
  const v = page.getViewport({ scale: 1 }); const s = 110 / Math.max(v.width, v.height); const vp = page.getViewport({ scale: s * 2 });
  const c = el.querySelector('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = vp.width / 2 + 'px'; c.style.height = vp.height / 2 + 'px';
  try { await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; } catch {}
}

// ============================================================================
// Reconocimiento de texto
// ============================================================================

// Muestras de color del canvas renderizado (tinta y fondo) para que lo editado se funda.
function canvasPixels(x, y, w, h) {
  const c = $('#edCanvas'); if (!c || !c.width) return null; const k = paper(ed.current)?._k || 1;
  const X = clamp(Math.floor(x * k), 0, c.width - 1), Y = clamp(Math.floor(y * k), 0, c.height - 1);
  const W = clamp(Math.ceil(w * k), 1, c.width - X), H = clamp(Math.ceil(h * k), 1, c.height - Y);
  try { return { data: c.getContext('2d', { willReadFrequently: true }).getImageData(X, Y, W, H).data, W, H }; } catch { return null; }
}
function sampleColors(b) {
  // Fondo: mediana del contorno (justo afuera del bloque). Tinta: promedio del 8% más oscuro de adentro.
  const pad = 2;
  const ring = [];
  const push = (p) => { if (!p) return; for (let i = 0; i < p.data.length; i += 16) ring.push([p.data[i], p.data[i + 1], p.data[i + 2]]); };
  push(canvasPixels(b.x - pad, b.y - pad, b.w + pad * 2, pad)); push(canvasPixels(b.x - pad, b.y + b.h, b.w + pad * 2, pad));
  push(canvasPixels(b.x - pad, b.y, pad, b.h)); push(canvasPixels(b.x + b.w, b.y, pad, b.h));
  const med = (arr, i) => { const v = arr.map((p) => p[i]).sort((a, c) => a - c); return v.length ? v[Math.floor(v.length / 2)] : 255; };
  const bg = ring.length ? [med(ring, 0), med(ring, 1), med(ring, 2)].map((v) => v / 255) : [1, 1, 1];
  const inner = canvasPixels(b.x, b.y, b.w, b.h); let ink = [0.07, 0.07, 0.09];
  if (inner) {
    const px = []; for (let i = 0; i < inner.data.length; i += 4) px.push([inner.data[i], inner.data[i + 1], inner.data[i + 2], inner.data[i] + inner.data[i + 1] + inner.data[i + 2]]);
    px.sort((a, c) => a[3] - c[3]); const n = Math.max(1, Math.floor(px.length * 0.025)); const dark = px.slice(0, n); // el 2,5 % más oscuro: en textos cortos el borde suavizado de las letras aclara el promedio
    const avg = [0, 1, 2].map((i) => dark.reduce((s, p) => s + p[i], 0) / n / 255);
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    if (lum(bg) - lum(avg) > 0.15) ink = avg;
    // Colores casi negros se normalizan a negro para que no queden "grises" al reescribir
    if (Math.max(...ink) < 0.22 && Math.max(...ink) - Math.min(...ink) < 0.08) ink = [0.05, 0.05, 0.06];
  }
  return { bg, ink };
}

// --- Texto digital: pdf.js entrega fragmentos; se agrupan en líneas y luego en párrafos.
async function detectDigitalBlocks(i) {
  const page = await ed.pdf.getPage(i + 1); const v = await vp1(i);
  await page.getOperatorList(); // asegura que las fuentes estén cargadas en commonObjs
  const tc = await page.getTextContent({ disableNormalization: false });
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue; // los "espacios" que agrega pdf.js entre columnas unirían columnas distintas
    const t = pdfjsLib.Util.transform(v.transform, it.transform);
    const size = Math.hypot(t[2], t[3]); if (size < 2) continue;
    if (Math.abs(t[1]) > size * 0.05 || Math.abs(t[2]) > size * 0.05) continue; // texto girado: no editable aquí
    let fontObj = null; try { if (page.commonObjs.has(it.fontName)) fontObj = page.commonObjs.get(it.fontName); } catch {}
    const st = tc.styles[it.fontName];
    const f = mapFont(fontObj?.name || st?.fontFamily, fontObj, st);
    const w = it.width * (v.scale || 1) || it.str.length * size * 0.5;
    items.push({ str: it.str, x: t[4], base: t[5], w, size, ...f, asc: st?.ascent || 0.8, desc: Math.abs(st?.descent || 0.22) });
  }
  return groupBlocks(await splitColumns(items), 'pdf');
}
// Un mismo trozo de texto con muchos espacios seguidos suele ser dos columnas (por ejemplo, las firmas
// "JUAN PÉREZ        MARÍA GONZÁLEZ"): se separa para que cada columna sea su propio párrafo.
const measureCtx = document.createElement('canvas').getContext('2d');
async function splitColumns(items) {
  const out = [];
  for (const it of items) {
    if (!/\S\s{3,}\S/.test(it.str)) { out.push(it); continue; }
    const css = FAMILIES[it.family]?.css || 'PF Sans'; const font = `${it.italic ? 'italic ' : ''}${it.bold ? '700 ' : '400 '}${it.size}px '${css}'`;
    try { await document.fonts.load(font); } catch {}
    measureCtx.font = font;
    const k = it.w / (measureCtx.measureText(it.str).width || 1);
    const re = /\S+(?:\s{1,2}\S+)*/g; let m;
    while ((m = re.exec(it.str))) out.push({ ...it, str: m[0], x: it.x + measureCtx.measureText(it.str.slice(0, m.index)).width * k, w: measureCtx.measureText(m[0]).width * k });
  }
  return out;
}

function groupBlocks(items, source) {
  if (!items.length) return [];
  // Líneas
  items.sort((a, b) => (Math.abs(a.base - b.base) < Math.min(a.size, b.size) * 0.35 ? a.x - b.x : a.base - b.base));
  const lines = [];
  for (const it of items) {
    const ln = lines.length && lines[lines.length - 1];
    const sameRow = ln && Math.abs(ln.base - it.base) < Math.min(ln.size, it.size) * 0.35;
    const gap = ln ? it.x - ln.x1 : 0;
    if (sameRow && gap < Math.max(ln.size, it.size) * 2.2 && gap > -ln.size) {
      ln.items.push(it); ln.x1 = Math.max(ln.x1, it.x + it.w); ln.size = Math.max(ln.size, it.size);
    } else lines.push({ items: [it], x0: it.x, x1: it.x + it.w, base: it.base, size: it.size });
  }
  for (const l of lines) { // tamaño dominante (el de más caracteres)
    const tally = {}; for (const it of l.items) tally[it.size.toFixed(1)] = (tally[it.size.toFixed(1)] || 0) + it.str.length;
    l.size = Number(Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0]);
    l.text = l.items.map((x, k) => { const p = l.items[k - 1]; return p && x.x - (p.x + p.w) > x.size * 0.12 && !/\s$/.test(p.str) && !/^\s/.test(x.str) ? ' ' + x.str : x.str; }).join('');
  }
  // Párrafos
  const blocks = [];
  for (const l of lines.sort((a, b) => a.base - b.base || a.x0 - b.x0)) {
    if (!l.text.trim()) continue;
    let target = null;
    for (const b of blocks) {
      if (b.closed) continue;
      const last = b.lines[b.lines.length - 1];
      const dy = l.base - last.base; const sz = Math.max(l.size, last.size);
      if (dy < sz * 0.8 || dy > sz * 1.9) continue;
      if (Math.abs(l.size - b.size) > b.size * 0.18) continue;
      if (b.lines.length > 1 && Math.abs(dy - b.dy) > b.dy * 0.3) continue;
      const ov = Math.min(l.x1, b.x1) - Math.max(l.x0, b.x0);
      if (ov < Math.min(l.x1 - l.x0, b.x1 - b.x0) * 0.4) continue;
      target = b; break;
    }
    if (target) { target.dy = target.lines.length > 1 ? (target.dy * (target.lines.length - 1) + (l.base - target.lines[target.lines.length - 1].base)) / target.lines.length : l.base - target.lines[target.lines.length - 1].base; target.lines.push(l); target.x0 = Math.min(target.x0, l.x0); target.x1 = Math.max(target.x1, l.x1); }
    else blocks.push({ lines: [l], x0: l.x0, x1: l.x1, size: l.size, dy: l.size * 1.2 });
    // cierra párrafos que quedaron muy arriba
    for (const b of blocks) if (b !== target && l.base - b.lines[b.lines.length - 1].base > b.size * 2.2) b.closed = true;
  }
  return blocks.map((b, n) => finishBlock(b, n, source));
}

function finishBlock(b, n, source) {
  const first = b.lines[0], last = b.lines[b.lines.length - 1];
  const asc = first.items[0].asc ?? 0.8, desc = last.items[0].desc ?? 0.22;
  const top = first.base - first.size * Math.min(0.95, Math.max(0.7, asc));
  const bottom = last.base + last.size * Math.min(0.3, Math.max(0.15, desc));
  const box = { x: b.x0 - 1, y: top - 1, w: b.x1 - b.x0 + 2, h: bottom - top + 2 };
  // Alineación
  const W = b.x1 - b.x0, tol = b.size * 0.6;
  const lefts = b.lines.map((l) => l.x0 - b.x0), rights = b.lines.map((l) => b.x1 - l.x1);
  const centers = b.lines.map((l) => Math.abs((l.x0 + l.x1) / 2 - (b.x0 + b.x1) / 2));
  let align = 'left';
  if (b.lines.length >= 2) {
    const body = b.lines.slice(0, -1);
    if (b.lines.length >= 3 && body.every((l) => l.x0 - b.x0 < tol && b.x1 - l.x1 < b.size * 0.3) && lefts.every((v) => v < tol)) align = 'justify';
    else if (lefts.some((v) => v > tol) && centers.every((v) => v < tol)) align = 'center';
    else if (rights.every((v) => v < tol) && lefts.some((v) => v > tol)) align = 'right';
  } else if (source === 'pdf') { /* una línea: izquierda */ }
  const lh = b.lines.length > 1 ? clamp(b.dy / b.size, 1, 2.2) : 1.2;
  // Estilo base = el del texto mayoritario
  const tally = {}; for (const l of b.lines) for (const it of l.items) { const k = `${it.family}|${it.bold}|${it.italic}`; tally[k] = (tally[k] || 0) + it.str.length; }
  const [famK] = Object.entries(tally).sort((a, c) => c[1] - a[1])[0][0].split('|');
  const names = {}; for (const l of b.lines) for (const it of l.items) names[it.name] = (names[it.name] || 0) + it.str.length;
  const detected = Object.entries(names).sort((a, c) => c[1] - a[1])[0]?.[0] || '';
  // HTML con los estilos por fragmento (negritas y cursivas se conservan)
  let html = '';
  b.lines.forEach((l, li) => {
    let prev = null;
    for (const it of l.items) {
      if (prev) { const gap = it.x - (prev.x + prev.w); if (gap > it.size * 0.12 && !/\s$/.test(prev.str) && !/^\s/.test(it.str)) html += ' '; }
      const s = esc(it.str);
      const st = [];
      if (it.family !== famK) st.push(`font-family:'${FAMILIES[it.family].css}'`);
      if (Math.abs(it.size - b.size) > 0.6) st.push(`font-size:${it.size.toFixed(1)}px`);
      const inner = it.bold ? `<b>${s}</b>` : s;
      const inner2 = it.italic ? `<i>${inner}</i>` : inner;
      html += st.length ? `<span style="${st.join(';')}">${inner2}</span>` : inner2;
      prev = it;
    }
    if (li < b.lines.length - 1) {
      const full = align === 'justify' || (W - (l.x1 - l.x0)) < b.size * 3 || align === 'center';
      html += full && align !== 'center' ? ' ' : '<br>';
    }
  });
  html = html.replace(/<\/b><b>/g, '').replace(/<\/i><i>/g, '').replace(/ {2,}/g, ' ');
  return { id: 'b' + n, box, x0: b.x0, x1: b.x1, base0: first.base, align, lh, size: b.size, family: famK, html, text: b.lines.map((l) => l.text).join('\n'), detected, source };
}

// --- Fotocopias / escaneos: OCR con Tesseract (español, sin internet)
let ocrWorker = null;
async function getOcr(progress) {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('spa', 1, {
      workerPath: 'vendor/tesseract/worker.min.js', corePath: 'vendor/tesseract/core', langPath: 'vendor/tesseract/lang',
      gzip: true, workerBlobURL: false, cacheMethod: 'none',
      logger: (m) => { if (m.status === 'recognizing text' && ocrWorker?._progress) ocrWorker._progress(m.progress); },
    });
    await ocrWorker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
  }
  ocrWorker._progress = progress;
  return ocrWorker;
}

// Compara cada línea escaneada con el mismo texto dibujado en cada fuente candidata
// (ajustando el tamaño para que el ancho coincida) y elige la de mayor correlación.
const FIT_CANDIDATES = [['sans', false], ['sans', true], ['serif', false], ['serif', true], ['calibri', false], ['calibri', true], ['cambria', false], ['mono', false]];
async function fitFonts(g, c, lines) {
  await Promise.all(FIT_CANDIDATES.map(([f, b]) => document.fonts.load(`${b ? 700 : 400} 40px '${FAMILIES[f].css}'`).catch(() => {})));
  const work = document.createElement('canvas'); const wg = work.getContext('2d', { willReadFrequently: true });
  const meas = document.createElement('canvas').getContext('2d');
  const out = [];
  for (const { ln, lw } of lines) {
    const text = lw.map((w) => w.text).join(' ');
    const x0 = Math.min(...lw.map((w) => w.bbox.x0)), x1 = Math.max(...lw.map((w) => w.bbox.x1));
    const y0 = ln.bbox.y0, y1 = ln.bbox.y1, W = x1 - x0, H = y1 - y0;
    if (text.length < 4 || W < 20 || H < 6) { out.push(null); continue; }
    const base = ln.baseline?.y0 > 0 ? (ln.baseline.y0 + ln.baseline.y1) / 2 : y1 - H * 0.2;
    const pad = Math.round(H * 0.3); const bw = Math.round(W + pad * 2), bh = Math.round(H + pad * 2);
    const k = Math.min(1, 400 / bw); const sw = Math.max(8, Math.round(bw * k)), sh = Math.max(4, Math.round(bh * k));
    const src = g.getImageData(Math.max(0, x0 - pad), Math.max(0, y0 - pad), bw, bh);
    // muestra escaneada reducida y normalizada (1 = tinta)
    work.width = bw; work.height = bh; wg.putImageData(src, 0, 0);
    const small = document.createElement('canvas'); small.width = sw; small.height = sh; const sg = small.getContext('2d', { willReadFrequently: true }); sg.drawImage(work, 0, 0, sw, sh);
    const A = toInk(sg.getImageData(0, 0, sw, sh).data);
    let best = null;
    for (const [fam, bold] of FIT_CANDIDATES) {
      const font = (px) => `${bold ? 700 : 400} ${px}px '${FAMILIES[fam].css}'`;
      meas.font = font(100); const w100 = meas.measureText(text).width; if (!w100) continue;
      const px = 100 * W / w100;
      if (px < H * 0.45 || px > H * 2.2) continue; // tamaño incoherente con la altura de la línea
      sg.fillStyle = '#fff'; sg.fillRect(0, 0, sw, sh); sg.fillStyle = '#000'; sg.font = font(px * k); sg.textBaseline = 'alphabetic';
      sg.fillText(text, (x0 - Math.max(0, x0 - pad)) * k, (base - Math.max(0, y0 - pad)) * k);
      const B = toInk(sg.getImageData(0, 0, sw, sh).data);
      const score = corr(A, B);
      if (!best || score > best.score) best = { family: fam, bold, sizePx: px * 0.97, score };
    }
    out.push(best && best.score > 0.25 ? best : null);
  }
  // Una sola familia por documento escaneado suele ser lo correcto: se usa la mayoritaria si gana claramente.
  const votes = {}; out.forEach((f) => { if (f) votes[f.family] = (votes[f.family] || 0) + f.score; });
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (top) out.forEach((f) => { if (f && f.family !== top[0] && f.score < 0.75) f.family = top[0]; });
  return out;
}
function toInk(d) { const a = new Float32Array(d.length / 4); for (let i = 0, j = 0; i < d.length; i += 4, j++) a[j] = 1 - (d[i] + d[i + 1] + d[i + 2]) / 765; return a; }
function corr(a, b) {
  let ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; } ma /= a.length; mb /= b.length;
  let num = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

async function ocrPage(i, onProgress) {
  const page = await ed.pdf.getPage(i + 1); const v = await vp1(i);
  const dpi = clamp(Math.sqrt(9e6 / (v.width * v.height)) * 72, 110, 300); const s = dpi / 72;
  const vp = page.getViewport({ scale: s });
  const c = Object.assign(document.createElement('canvas'), { width: Math.floor(vp.width), height: Math.floor(vp.height) });
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  const w = await getOcr(onProgress);
  const { data } = await w.recognize(c, {}, { blocks: true, text: false });
  const img = g.getImageData(0, 0, c.width, c.height).data;
  const darkness = (bb) => { // proporción de tinta, para detectar negritas
    let dark = 0, tot = 0;
    for (let y = bb.y0; y < bb.y1; y += 2) for (let x = bb.x0; x < bb.x1; x += 2) { const p = (y * c.width + x) * 4; tot++; if (img[p] + img[p + 1] + img[p + 2] < 300) dark++; }
    return tot ? dark / tot : 0;
  };
  const words = []; const items = [];
  const lines = [];
  for (const bl of data.blocks || []) for (const par of bl.paragraphs || []) for (const ln of par.lines || []) {
    const lw = (ln.words || []).filter((wd) => wd.text.trim() && wd.confidence > 25);
    if (lw.length) lines.push({ ln, lw });
  }
  // Reconocimiento de fuente: se dibuja cada línea con las fuentes candidatas y se elige la más parecida al escaneo.
  const fits = await fitFonts(g, c, lines);
  for (let n = 0; n < lines.length; n++) {
    const { ln, lw } = lines[n]; const fit = fits[n];
    const rowH = ln.rowAttributes?.row_height || (ln.bbox.y1 - ln.bbox.y0);
    const size = clamp((fit?.sizePx || rowH * 0.92) / s, 4, 120);
    const base = (ln.baseline?.y0 != null && ln.baseline.y0 > 0 ? (ln.baseline.y0 + ln.baseline.y1) / 2 : ln.bbox.y1 - (ln.rowAttributes?.descenders || rowH * 0.2)) / s;
    const ink = lw.map((wd) => darkness(wd.bbox)); const medInk = ink.slice().sort((x, y) => x - y)[Math.floor(ink.length / 2)] || 0;
    lw.forEach((wd, k) => {
      const x = wd.bbox.x0 / s, wW = (wd.bbox.x1 - wd.bbox.x0) / s;
      const wordBold = lw.length >= 4 && wd.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 3 && ink[k] > Math.max(0.2, medInk * 1.55);
      items.push({ str: wd.text + ' ', x, base, w: wW, size, family: fit?.family || 'sans', bold: fit?.bold || wordBold, italic: false, name: fit ? `OCR · ${FAMILIES[fit.family].label}${fit.bold ? ' negrita' : ''}` : 'OCR', asc: 0.8, desc: 0.2 });
      words.push({ text: wd.text, x, y: wd.bbox.y0 / s, w: wW, h: (wd.bbox.y1 - wd.bbox.y0) / s, base, size });
    });
  }
  const blocks = groupBlocks(items, 'ocr');
  return { blocks, words, conf: data.confidence ?? null };
}

async function recognize(pages) {
  if (!pages.length) return;
  await step('Reconociendo texto…', async () => {
    for (let n = 0; n < pages.length; n++) {
      const i = pages[n];
      busy(`Reconociendo texto · página ${i + 1} (${n + 1} de ${pages.length})…`, n / pages.length);
      const r = await ocrPage(i, (p) => busy(`Reconociendo texto · página ${i + 1} (${n + 1} de ${pages.length})…`, (n + p) / pages.length));
      ed.ocr[i] = { blocks: r.blocks, words: r.words, baked: false };
      ed.blocks[i] = r.blocks;
    }
    setDirty(true); const bn = $('#edBanner'); if (bn) bn.innerHTML = '';
    toast(`Texto reconocido en ${pages.length} página(s). Ya puedes buscarlo y editarlo con "Editar texto".`, 5000);
    if (ed.tool !== 'edittext') setTool('edittext'); else await showTextBlocks();
  });
}

async function blocksFor(i) {
  if (ed.blocks[i]) return ed.blocks[i];
  if (ed.ocr[i] && !ed.ocr[i].baked && ed.ocr[i].blocks) return (ed.blocks[i] = ed.ocr[i].blocks);
  return (ed.blocks[i] = await detectDigitalBlocks(i));
}

// ¿La página es una imagen sin texto (fotocopia)? → aviso para reconocer texto.
async function checkScanned() {
  const host = $('#edBanner'); if (!host) return;
  const i = ed.current;
  if (ed.ocr[i]) { host.innerHTML = ''; return; }
  let scanned = false;
  try {
    const page = await ed.pdf.getPage(i + 1);
    const tc = await page.getTextContent();
    const chars = tc.items.reduce((s, it) => s + (it.str || '').trim().length, 0);
    if (chars < 15) { const ops = await page.getOperatorList(); scanned = ops.fnArray.some((f) => f === pdfjsLib.OPS.paintImageXObject || f === pdfjsLib.OPS.paintJpegXObject); }
  } catch {}
  if (i !== ed.current) return;
  host.innerHTML = scanned ? `<div class="ed-banner"><span>Esta página es una imagen (fotocopia o escaneo). Reconoce el texto para poder buscarlo y editarlo.</span>
    <span class="row-tight"><button class="secondary small" data-ocr="page">Reconocer esta página</button> <button class="glass-red" data-ocr="all">${icon('scanText', 16)}<span>Reconocer todo</span></button></span></div>` : '';
}
async function scannedPages() {
  const out = [];
  for (let i = 0; i < ed.count; i++) {
    if (ed.ocr[i]) continue;
    try { const tc = await (await ed.pdf.getPage(i + 1)).getTextContent(); if (tc.items.reduce((s, it) => s + (it.str || '').trim().length, 0) < 15) out.push(i); } catch {}
  }
  return out;
}

// Muestra los párrafos editables de la página actual.
async function showTextBlocks() {
  const layer = $('#edLayer'); if (!layer || !ed.pdf) return;
  layer.querySelectorAll('.tb').forEach((n) => n.remove());
  const i = ed.current; const blocks = await blocksFor(i); if (i !== ed.current || ed.tool !== 'edittext') return;
  const used = new Set((ed.overlays[i] || []).filter((o) => o.blockId).map((o) => o.blockId));
  for (const b of blocks) {
    if (used.has(b.id)) continue;
    const d = document.createElement('div'); d.className = 'tb'; d.dataset.block = b.id;
    Object.assign(d.style, { left: b.box.x * ed.scale + 'px', top: b.box.y * ed.scale + 'px', width: b.box.w * ed.scale + 'px', height: b.box.h * ed.scale + 'px' });
    d.title = `Fuente detectada: ${b.detected} · ${b.size.toFixed(1)} pt`;
    layer.prepend(d);
  }
  if (!blocks.length) checkScanned();
}

// Borra de verdad el texto original dentro de las zonas (sin parches). Devuelve true si no quedó nada.
async function removeOriginal(i, rects) {
  const T = ed;
  const doc = await loadLib(T.bytes); const v = await vp1(i);
  const r = await PdfText.removeTextInRects(doc, i, rects, (x, y) => v.convertToViewportPoint(x, y));
  if (!r.removed) return false;
  await setBytes(await saveLib(doc), { keepPage: true, keepBlocks: true });
  // Verificación: ¿queda texto dentro de la zona? (por ejemplo, dentro de un elemento que no se pudo leer)
  try {
    const page = await T.pdf.getPage(i + 1); const tc = await page.getTextContent(); const vv = page.getViewport({ scale: 1 });
    const left = tc.items.filter((it) => it.str.trim()).some((it) => { const [x, y] = vv.convertToViewportPoint(it.transform[4] + (it.width || 0) / 2, it.transform[5] + (it.height || 0) * 0.3); return rects.some((q) => x > q.x && x < q.x + q.w && y > q.y && y < q.y + q.h); });
    return !left;
  } catch { return false; }
}

// Convierte un párrafo detectado en un objeto de texto editable con la misma fuente y posición.
async function blockOverlay(b, { bg, ink }, transparent) {
  // Ubica el texto para que la primera línea base coincida con la original (modelo de "half-leading" del navegador).
  const m = await fontMetrics(b.family, false, false);
  const lh = Number(b.lh.toFixed(2)), size = Number(b.size.toFixed(1));
  const top = b.base0 - ((lh - (m.asc + m.desc)) / 2 + m.asc) * size;
  return { type: 'rich', id: 'o' + (++uid), blockId: b.id, x: b.x0, y: top, w: b.x1 - b.x0 + size * 0.4, h: b.box.h,
    cover: { ...b.box }, bg, color: hex(ink), html: b.html, family: b.family, size, align: b.align, lh, detected: b.detected, source: b.source, transparent };
}
// Abre varios párrafos de una página de una vez (un solo borrado del original).
async function openBlocks(page, blocks) {
  if (ed.current !== page) setCurrent(page);
  await drawPage(paper(page));
  const colors = blocks.map((b) => sampleColors(b.box));
  const digital = blocks.filter((b) => b.source === 'pdf');
  let transparent = false;
  if (digital.length) { try { transparent = await removeOriginal(page, digital.map((b) => b.box)); } catch (e) { console.warn(e); } }
  const out = [];
  for (let k = 0; k < blocks.length; k++) {
    const o = await blockOverlay(blocks[k], colors[k], blocks[k].source === 'pdf' && transparent);
    (ed.overlays[page] ||= []).push(o); out.push(o);
  }
  return out;
}

async function editBlock(b, clickEvt) {
  snapshot();
  const page = ed.current;
  // PDF digital: el texto original se borra del archivo y el nuevo queda sin fondo ("texto transparente").
  busy('Preparando el párrafo…');
  let o; try { [o] = await openBlocks(page, [b]); } finally { busy(null); }
  if (ed.current !== page) setCurrent(page);
  ed.sel = o.id; ed.editing = o.id;
  renderOverlays(); showTextBlocks();
  placeCaret(o, clickEvt);
}
function placeCaret(o, evt) {
  const el = document.querySelector(`.ov[data-id="${o.id}"] .rt`); if (!el) return;
  el.focus();
  if (evt && document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(evt.clientX, evt.clientY); if (r && el.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
}

// ============================================================================
// Capa de objetos: texto enriquecido (nuevo o editado), imagen, tapar
// ============================================================================
function richStyle(o, s = ed.scale) {
  return `font-synthesis:none;font-kerning:none;font-variant-ligatures:none;font-feature-settings:'kern' 0,'liga' 0;width:${o.w}px;font-family:'${FAMILIES[o.family]?.css || 'PF Sans'}';font-size:${o.size}px;line-height:${o.lh};text-align:${o.align};color:${o.color};transform:scale(${s})`;
}
function renderOverlays() { renderOverlaysFor(ed.current); }
// Dibuja los objetos de una página. Solo la página activa es interactiva.
function renderOverlaysFor(i) {
  const pg = paper(i); const layer = pg?.querySelector('.ed-layer'); if (!layer) return;
  layer.querySelectorAll('.ov, .ov-cover').forEach((n) => n.remove());
  const s = ed.scales[i] || ed.scale; const active = i === ed.current;
  for (const o of ed.overlays[i] || []) {
    if (o.type === 'rich' && o.cover && !o.transparent) {
      const c = document.createElement('div'); c.className = 'ov-cover';
      Object.assign(c.style, { left: o.cover.x * s + 'px', top: o.cover.y * s + 'px', width: o.cover.w * s + 'px', height: o.cover.h * s + 'px', background: hex(o.bg) });
      layer.appendChild(c);
    }
    const d = document.createElement('div');
    d.className = `ov ov-${o.type}` + (active && (ed.sel === o.id || ed.multi.includes(o.id)) ? ' selected' : '') + (o.ph ? ' ph' : '') + (o.lift ? ' lift' : '') + (active && ed.editing === o.id ? ' editing' : '');
    d.dataset.id = o.id;
    Object.assign(d.style, { left: o.x * s + 'px', top: o.y * s + 'px', width: o.w * s + 'px' });
    if (o.type !== 'rich') d.style.height = o.h * s + 'px';
    if (o.type === 'rich') {
      if (o.cover && !o.transparent) d.style.background = hex(o.bg);
      d.innerHTML = `<div class="rt" contenteditable="${active && ed.editing === o.id}" spellcheck="false" style="${richStyle(o, s)}">${o.html}</div>`;
    } else if (o.type === 'image') d.innerHTML = `<img src="${o.src}" draggable="false" />`;
    if (o.locked) d.classList.add('locked');
    else if (active && ed.sel === o.id && ed.editing !== o.id) d.insertAdjacentHTML('beforeend', `<i class="ov-handle"></i><b class="ov-del" title="Quitar">${icon('x', 11)}</b>`);
    else if (active && ed.editing === o.id) d.insertAdjacentHTML('beforeend', '<i class="ov-handle"></i>');
    layer.appendChild(d);
    if (o.type === 'rich') syncRichHeight(o, d, s);
  }
}
function syncRichHeight(o, d, s = ed.scale) {
  const rt = d.querySelector('.rt'); if (!rt) return;
  const h = Math.max(rt.offsetHeight, o.size * o.lh); o.h = h;
  d.style.height = h * s + 'px';
}
function findOv(id) { return (ed.overlays[ed.current] || []).find((o) => o.id === id); }
function addOv(o) { snapshot(); o.id = 'o' + (++uid); (ed.overlays[ed.current] ||= []).push(o); ed.sel = o.id; renderOverlays(); updateToolbar(); return o; }
function removeOv(id) {
  snapshot();
  const ids = Array.isArray(id) ? id : [id];
  ed.overlays[ed.current] = (ed.overlays[ed.current] || []).filter((o) => !ids.includes(o.id)); ed.multi = [];
  if (ids.includes(ed.editing)) ed.editing = null; ed.sel = null;
  renderOverlays(); if (ed.tool === 'edittext') showTextBlocks(); updateToolbar();
}
function stopEditing() {
  if (!ed.editing) return;
  const o = findOv(ed.editing); const el = document.querySelector(`.ov[data-id="${ed.editing}"] .rt`);
  if (o && el) o.html = el.innerHTML;
  ed.editing = null; renderOverlays(); renderPanel();
}

let layerDragging = false;
let spaceDown = false;
let globalBound = false;
let drag = null;
const layerEl = () => $('#edLayer');
const pt = (e) => { const r = layerEl().getBoundingClientRect(); return { x: (e.clientX - r.left) / ed.scale, y: (e.clientY - r.top) / ed.scale }; };
function bindLayer() {
  // Los eventos se escuchan en el escenario (todas las páginas). Un clic en otra página la vuelve la página activa.
  const stage = $('#edStage');
  stage.addEventListener('mousedown', async (e) => {
    if (!ed.pdf) return;
    const pg = e.target.closest('.ed-paper'); if (!pg) return;
    if (e.target.closest('.lnk') && ed.tool === 'select') return;
    const i = Number(pg.dataset.i);
    if (i !== ed.current) setCurrent(i);
    const layer = layerEl(); if (!layer) return;
    const ovEl = e.target.closest('.ov');
    if (e.target.closest('.ov-del')) { removeOv(ed.multi.length > 1 && ed.multi.includes(ovEl.dataset.id) ? ed.multi : ovEl.dataset.id); return; }
    // Mano (o barra espaciadora): mueve objetos o desplaza la vista, nunca edita ni selecciona texto
    if (ed.tool === 'hand' || spaceDown) {
      e.preventDefault();
      const o = ovEl && findOv(ovEl.dataset.id);
      if (ed.editing) stopEditing();
      if (o && !o.locked) {
        const group = ed.multi.length > 1 && ed.multi.includes(o.id) ? ed.multi.map(findOv).filter(Boolean) : [o];
        if (group.length === 1 && ed.sel !== o.id) { ed.sel = o.id; ed.multi = []; renderOverlays(); renderPanel(); }
        snapshot(); drag = { mode: 'group', start: pt(e), items: group.map((x) => ({ o: x, x: x.x, y: x.y })) }; layerDragging = true; return;
      }
      const v = $('#edCanvasWrap'); drag = { mode: 'pan', cx: e.clientX, cy: e.clientY, sl: v.scrollLeft, st: v.scrollTop }; $('#edStage').classList.add('panning'); return;
    }
    if (ovEl) {
      const o = findOv(ovEl.dataset.id); if (!o) return;
      if (o.locked) { const fe = e.target.closest('.pf-field'); if (fe) window.Plantillas.focusField(fe.dataset.field); e.preventDefault(); return; }
      if (ed.editing === o.id && e.target.closest('.rt')) return; // escribiendo
      if (ed.editing && ed.editing !== o.id) stopEditing();
      const p = pt(e);
      if (ed.multi.length > 1 && ed.multi.includes(o.id) && !e.target.classList.contains('ov-handle')) { // varios seleccionados: se mueven juntos
        snapshot(); drag = { mode: 'group', start: p, items: ed.multi.map(findOv).filter(Boolean).map((x) => ({ o: x, x: x.x, y: x.y })) }; layerDragging = true; e.preventDefault(); return;
      }
      if (ed.sel !== o.id || ed.multi.length) { ed.sel = o.id; ed.multi = []; renderOverlays(); renderPanel(); }
      snapshot();
      drag = { mode: e.target.classList.contains('ov-handle') ? 'resize' : 'move', o, start: p, orig: { ...o, cover: o.cover && { ...o.cover } } };
      layerDragging = true;
      e.preventDefault(); return;
    }
    if (ed.editing) stopEditing();
    const p = pt(e);
    if (ed.tool === 'select') {
      if (ed.sel || ed.multi.length) { ed.sel = null; ed.multi = []; renderOverlays(); renderPanel(); }
      if (e.target.closest('.textLayer span, .textLayer br') || e.detail > 1) return; // sobre el texto del PDF: selección de texto normal (copiar)
      drag = { mode: 'marquee', start: p, ghost: Object.assign(document.createElement('div'), { className: 'ov ov-marquee' }) };
      layer.appendChild(drag.ghost); layerDragging = true; e.preventDefault(); return;
    }
    if (ed.tool === 'edittext') {
      e.preventDefault();
      const tb = e.target.closest('.tb');
      const blocks = await blocksFor(ed.current);
      const b = tb ? blocks.find((x) => x.id === tb.dataset.block) : blocks.find((x) => p.x >= x.box.x && p.x <= x.box.x + x.box.w && p.y >= x.box.y && p.y <= x.box.y + x.box.h && !(ed.overlays[ed.current] || []).some((o) => o.blockId === x.id));
      if (b) { await drawPage(paper(ed.current)); editBlock(b, { clientX: e.clientX, clientY: e.clientY }); }
      else if (ed.sel) { ed.sel = null; renderOverlays(); renderPanel(); }
      return;
    }
    if (ed.tool === 'text') { // se dibuja el recuadro; al soltar se escribe dentro
      drag = { mode: 'textbox', start: p, ghost: Object.assign(document.createElement('div'), { className: 'ov ov-ghost ov-textghost' }) };
      layer.appendChild(drag.ghost); layerDragging = true; e.preventDefault(); return;
    }
    if (ed.tool === 'image') { pickImage(p); setTool('select'); return; }
    if (ed.tool === 'whiteout') {
      drag = { mode: 'create', start: p, ghost: Object.assign(document.createElement('div'), { className: 'ov ov-ghost' }) };
      layer.appendChild(drag.ghost); layerDragging = true; e.preventDefault(); return;
    }
  });
  stage.addEventListener('input', (e) => {
    const rt = e.target.closest('.rt'); if (!rt) return;
    const d = rt.closest('.ov'); const o = findOv(d.dataset.id); if (!o) return;
    o.html = rt.innerHTML; if (o.ph) { o.ph = false; d.classList.remove('ph'); } syncRichHeight(o, d); if (!ed.dirty) setDirty(true);
  });
  stage.addEventListener('dblclick', (e) => {
    const d = e.target.closest('#edLayer .ov-rich'); if (!d) return;
    const o = findOv(d.dataset.id); if (!o || o.locked) return;
    ed.sel = o.id; ed.multi = []; ed.editing = o.id; renderOverlays(); renderPanel(); if (o.ph) selectAllIn(o); else placeCaret(o, e);
  });
  $('#edCanvasWrap').addEventListener('scroll', () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; onViewScroll(); }); });
  if (globalBound) return;
  globalBound = true;
  window.addEventListener('mousemove', (e) => {
    if (!drag || !$('#edLayer')) return;
    if (drag.mode === 'pan') { const v = $('#edCanvasWrap'); v.scrollLeft = drag.sl - (e.clientX - drag.cx); v.scrollTop = drag.st - (e.clientY - drag.cy); return; }
    const p = pt(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.mode === 'group') {
      for (const it of drag.items) { it.o.x = it.x + dx; it.o.y = it.y + dy; const el = document.querySelector(`#edLayer .ov[data-id="${it.o.id}"]`); if (el) Object.assign(el.style, { left: it.o.x * ed.scale + 'px', top: it.o.y * ed.scale + 'px' }); }
      drag.moved = true; return;
    }
    if (drag.mode === 'create' || drag.mode === 'marquee' || drag.mode === 'textbox') {
      Object.assign(drag.ghost.style, { left: Math.min(p.x, drag.start.x) * ed.scale + 'px', top: Math.min(p.y, drag.start.y) * ed.scale + 'px', width: Math.abs(dx) * ed.scale + 'px', height: Math.abs(dy) * ed.scale + 'px' });
      return;
    }
    const o = drag.o, el = document.querySelector(`#edLayer .ov[data-id="${o.id}"]`);
    if (drag.mode === 'move') { o.x = drag.orig.x + dx; o.y = drag.orig.y + dy; }
    else {
      o.w = Math.max(10, drag.orig.w + dx);
      if (o.type === 'image' && o.ratio && !e.shiftKey) o.h = o.w / o.ratio; else if (o.type !== 'rich') o.h = Math.max(6, drag.orig.h + dy);
    }
    if (el) {
      Object.assign(el.style, { left: o.x * ed.scale + 'px', top: o.y * ed.scale + 'px', width: o.w * ed.scale + 'px' });
      if (o.type === 'rich') { el.querySelector('.rt').style.width = o.w + 'px'; syncRichHeight(o, el); } else el.style.height = o.h * ed.scale + 'px';
    }
  });
  window.addEventListener('mouseup', (e) => {
    layerDragging = false;
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'pan') { $('#edStage')?.classList.remove('panning'); return; }
    if (d.mode === 'group') { if (d.moved) { setDirty(true); renderOverlays(); } else ed.undo.pop(); return; }
    if (!['create', 'marquee', 'textbox'].includes(d.mode) || !$('#edLayer')) return;
    d.ghost.remove();
    const p = pt(e);
    const x = Math.min(p.x, d.start.x), y = Math.min(p.y, d.start.y), w = Math.abs(p.x - d.start.x), h = Math.abs(p.y - d.start.y);
    if (d.mode === 'textbox') { newTextBox(w < 12 ? { x: d.start.x, y: d.start.y - ed.fmt.size * 0.2, w: 220 } : { x, y, w: Math.max(w, 30) }); return; }
    if (d.mode === 'marquee') { if (w >= 4 && h >= 4) selectArea({ x, y, w, h }); return; }
    if (w < 4 || h < 3) return;
    const { bg } = sampleColors({ x, y, w, h });
    addOv({ type: 'whiteout', x, y, w, h, bg });
  });
  document.addEventListener('selectionchange', () => { if (ed.editing) renderPanel(true); });
  document.addEventListener('keydown', (e) => {
    if ($('#view-editor')?.classList.contains('hidden') || !ed.bytes) return;
    const typing = document.activeElement?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      if (document.body.classList.contains('reading')) { reading(false); return; }
      if (ed.editing) { stopEditing(); return; }
      if (ed.sel || ed.multi.length) { ed.sel = null; ed.multi = []; renderOverlays(); renderPanel(); return; } // Esc: deja de seleccionar
      if (!$('#edFind')?.classList.contains('hidden')) { closeFind(); return; }
    }
    if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) { e.preventDefault(); find(); return; }
    if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) { e.preventDefault(); printDoc(); return; }
    if (typing) return;
    if (e.code === 'Space' && !mod) { e.preventDefault(); if (!spaceDown) { spaceDown = true; $('#edStage')?.classList.add('mode-hand'); } return; }
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (!mod && !e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); setTool('hand'); return; }
    if (!mod && !e.altKey && e.key.toLowerCase() === 'v') { e.preventDefault(); setTool('select'); return; }
    if (ed.multi.length > 1 && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeOv(ed.multi.filter((id) => !findOv(id)?.locked)); return; }
    if (ed.sel && !findOv(ed.sel)?.locked && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeOv(ed.sel); }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !ed.sel && !mod) { e.preventDefault(); goto(ed.current + (e.key === 'ArrowRight' ? 1 : -1)); }
    if (e.key === 'Home' && !mod) { e.preventDefault(); goto(0); }
    if (e.key === 'End' && !mod) { e.preventDefault(); goto(ed.count - 1); }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space' && spaceDown) { spaceDown = false; const st = $('#edStage'); if (st && ed.tool !== 'hand') st.classList.remove('mode-hand'); } });
  window.addEventListener('blur', () => { if (spaceDown) { spaceDown = false; if (ed.tool !== 'hand') $('#edStage')?.classList.remove('mode-hand'); } });
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!$('#view-editor').classList.contains('hidden') && ed.pdf) renderPage(); }, 150); });
}
let scrollRaf = 0;

// --- Texto nuevo: recuadro dibujado por el usuario; al soltar se escribe dentro
function toolUI(t) { // cambia la herramienta sin cerrar el texto que se está escribiendo
  ed.tool = t;
  document.querySelectorAll('.ed-toolbar .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const stage = $('#edStage'); if (stage) stage.className = 'ed-stage mode-' + t;
}
function newTextBox(box, preset) {
  const f = { ...ed.fmt, ...(preset || {}) };
  snapshot();
  const o = { type: 'rich', id: 'o' + (++uid), x: box.x, y: box.y, w: box.w, h: f.size * f.lh, html: preset?.html || '', family: f.family, size: f.size, align: f.align, lh: f.lh, color: f.color, ph: !!preset?.html };
  (ed.overlays[ed.current] ||= []).push(o);
  ed.sel = o.id; ed.multi = []; ed.editing = o.id; toolUI('select'); renderOverlays(); renderPanel(); setDirty(true);
  const el = document.querySelector(`#edLayer .ov[data-id="${o.id}"] .rt`); el?.focus();
  if (o.ph) selectAllIn(o);
  else { if (f.bold) document.execCommand('bold'); if (f.italic) document.execCommand('italic'); if (f.underline) document.execCommand('underline'); }
  return o;
}
function selectAllIn(o) {
  const el = document.querySelector(`.ov[data-id="${o.id}"] .rt`); if (!el) return;
  el.focus(); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
// Modelos de texto: título, párrafo, nota… con texto de ejemplo que se reemplaza al escribir
const TEXT_PRESETS = [
  { key: 'titlePar', label: 'Título y párrafo', demo: '<b style="font-size:15px">Título</b><br><span style="font-size:10px">Párrafo de texto…</span>', parts: [{ size: 20, family: 'serif', bold: true, html: '<b>Agrega un título aquí</b>', gap: 10 }, { size: 11, html: 'Escribe aquí el texto. Puedes cambiar la fuente y el tamaño en este panel.' }] },
  { key: 'title', label: 'Título', demo: '<b style="font-size:17px">Título</b>', parts: [{ size: 22, family: 'serif', bold: true, html: '<b>Agrega un título aquí</b>' }] },
  { key: 'subtitle', label: 'Subtítulo', demo: '<b style="font-size:13px">Subtítulo</b>', parts: [{ size: 14, bold: true, html: '<b>Agrega un subtítulo</b>' }] },
  { key: 'par', label: 'Párrafo', demo: '<span style="font-size:11px">Escribe aquí…</span>', parts: [{ size: 11, html: 'Escribe aquí…' }] },
  { key: 'clause', label: 'Cláusula', demo: '<span style="font-size:11px"><b>PRIMERO:</b> texto…</span>', parts: [{ size: 11, align: 'justify', html: '<b>PRIMERO:</b> Escribe aquí el contenido de la cláusula.' }] },
  { key: 'note', label: 'Nota pequeña', demo: '<i style="font-size:9px;color:#666">Nota aclaratoria</i>', parts: [{ size: 8.5, color: '#555555', html: '<i>Nota: escribe aquí una aclaración.</i>' }] },
];
function insertPreset(key) {
  const pr = TEXT_PRESETS.find((x) => x.key === key); if (!pr || !ed.pdf) return;
  if (ed.editing) stopEditing();
  const v = ed.vp1[ed.current] || { width: 595, height: 842 }; const pg = paper(ed.current); const view = $('#edCanvasWrap');
  const visTop = pg && view ? (view.scrollTop - pg.offsetTop) / (ed.scales[ed.current] || ed.scale) : 0;
  let y = clamp(visTop + 70, 40, v.height - 120); const x = Math.round(v.width * 0.12); const w = Math.round(v.width * 0.76);
  let first = null;
  for (const part of pr.parts) {
    const fam = FAMILIES[part.family] ? part.family : ed.fmt.family;
    const o = newTextBox({ x, y, w }, { family: fam, size: part.size, color: part.color || ed.fmt.color, align: part.align || 'left', lh: 1.25, html: part.html });
    first = first || o; y += o.h + (part.gap || 6);
  }
  if (first && pr.parts.length > 1) { stopEditing(); ed.sel = first.id; ed.editing = first.id; renderOverlays(); selectAllIn(first); }
}

// --- Seleccionar un área: objetos completos dentro del recuadro (y las imágenes del PDF, que se vuelven movibles)
async function pdfImages(i) {
  const T = ed; if (T.pdfImgs?.bytes !== T.bytes) T.pdfImgs = { bytes: T.bytes, pages: {} };
  if (T.pdfImgs.pages[i]) return T.pdfImgs.pages[i];
  const out = [];
  try {
    const page = await T.pdf.getPage(i + 1); const ops = await page.getOperatorList(); const v = await vp1(i); const O = pdfjsLib.OPS;
    const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k], args = ops.argsArray[k];
      if (fn === O.save) stack.push(ctm); else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === O.transform) ctm = mul(ctm, args);
      else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (args?.[0]) ctm = mul(ctm, args[0]); }
      else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageXObjectRepeat) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => v.convertToViewportPoint(ctm[0] * a + ctm[2] * b + ctm[4], ctm[1] * a + ctm[3] * b + ctm[5]));
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        if (r.w > 6 && r.h > 6 && r.w < v.width * 0.98) out.push(r); // se ignoran fondos de página completa
      }
    }
  } catch (e) { console.warn('imágenes del PDF', e); }
  T.pdfImgs.pages[i] = out; return out;
}
const inside = (a, b, tol = 1) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
async function selectArea(r) {
  const i = ed.current; const T = ed;
  const ids = (ed.overlays[i] || []).filter((o) => !o.locked && !o.lift && inside(o, r)).map((o) => o.id);
  const lifted = (ed.lifted[i] ||= []);
  const imgs = (await pdfImages(i)).filter((q) => inside(q, r) && !lifted.some((l) => Math.abs(l.x - q.x) < 1 && Math.abs(l.y - q.y) < 1));
  if (ed !== T) return;
  if (imgs.length) {
    busy('Preparando las imágenes para moverlas…');
    try { await drawPage(paper(i)); for (const q of imgs) { const o = await liftImage(i, q); if (o) { ids.push(o.id); lifted.push(q); } } } finally { busy(null); }
  }
  ed.sel = ids.length === 1 ? ids[0] : null; ed.multi = ids.length > 1 ? ids : [];
  renderOverlays(); renderPanel();
  if (!ids.length) toast('No hay objetos completos dentro del recuadro. Encierra todo el texto, campo o imagen que quieras mover.', 4000);
  else if (ids.length > 1) toast(`${ids.length} objetos seleccionados: arrástralos para moverlos juntos o presiona Supr para quitarlos.`, 3500);
}
// Una imagen del PDF pasa a ser un objeto movible: se copia tal como se ve y su lugar original se cubre con el color del fondo
async function liftImage(i, q) {
  const c = $('#edCanvas'); const k = paper(i)?._k || 1; if (!c) return null;
  const sx = Math.max(0, Math.floor(q.x * k)), sy = Math.max(0, Math.floor(q.y * k)), sw = Math.min(c.width - sx, Math.ceil(q.w * k)), sh = Math.min(c.height - sy, Math.ceil(q.h * k));
  if (sw < 2 || sh < 2) return null;
  const cut = Object.assign(document.createElement('canvas'), { width: sw, height: sh }); cut.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
  const img = await imageToEmbeddable(await new Promise((res) => cut.toBlob(res, 'image/png')));
  const { bg } = sampleColors(q);
  snapshot();
  const list = (ed.overlays[i] ||= []);
  list.push({ type: 'whiteout', id: 'o' + (++uid), x: q.x, y: q.y, w: q.w, h: q.h, bg, lift: true });
  const o = { type: 'image', id: 'o' + (++uid), x: q.x, y: q.y, w: q.w, h: q.h, ratio: q.w / q.h, src: img.dataUrl, mime: img.mime, bytes: img.bytes };
  list.push(o); setDirty(true); return o;
}

function pickImage(p) {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp' });
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const img = await imageToEmbeddable(f);
    const v = ed.vp1[ed.current]; const w = Math.min(v.width * 0.35, img.width * 0.75);
    addOv({ type: 'image', x: p.x, y: p.y, w, h: w / img.ratio, ratio: img.ratio, src: img.dataUrl, mime: img.mime, bytes: img.bytes });
  };
  inp.click();
}
async function imageToEmbeddable(blob) {
  const bmp = await createImageBitmap(blob);
  const isJpg = /jpe?g/.test(blob.type); let bytes; const mime = isJpg ? 'image/jpeg' : 'image/png';
  if (isJpg || blob.type === 'image/png') bytes = new Uint8Array(await blob.arrayBuffer());
  else {
    const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    c.getContext('2d').drawImage(bmp, 0, 0);
    bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
  }
  return { bytes, mime, width: bmp.width, height: bmp.height, ratio: bmp.width / bmp.height, dataUrl: URL.createObjectURL(new Blob([bytes], { type: mime })) };
}

// --- Formato del texto seleccionado (panel derecho)
function applyFmt(cmd, value) {
  const o = ed.sel && findOv(ed.sel);
  const editing = ed.editing && o && o.id === ed.editing;
  const el = editing && document.querySelector(`.ov[data-id="${o.id}"] .rt`);
  const sel = getSelection(); const hasRange = el && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode);
  if (!o || o.type !== 'rich') { // sin texto seleccionado: valores por defecto para el próximo texto
    if (cmd === 'family') ed.fmt.family = value; if (cmd === 'size') ed.fmt.size = value; if (cmd === 'color') ed.fmt.color = value;
    if (cmd === 'align') ed.fmt.align = value; if (cmd === 'lh') ed.fmt.lh = value;
    if (['bold', 'italic', 'underline'].includes(cmd)) ed.fmt[cmd] = !ed.fmt[cmd];
    renderPanel(); return;
  }
  const sizeShown = cmd === 'size' ? currentFmt().size : null;
  if (!editing) snapshot();
  if (editing && !hasRange && !el.textContent && ['bold', 'italic', 'underline'].includes(cmd)) { // texto vacío: el formato se aplica a lo que se escriba
    el.focus(); document.execCommand(cmd); o.html = el.innerHTML; setDirty(true); renderPanel(true); return;
  }
  if (hasRange && ['bold', 'italic', 'underline', 'color', 'family', 'size', 'superscript', 'subscript'].includes(cmd)) {
    document.execCommand('styleWithCSS', false, true);
    if (cmd === 'color') document.execCommand('foreColor', false, value);
    else if (cmd === 'family') document.execCommand('fontName', false, FAMILIES[value].css);
    else if (cmd === 'size') wrapSelection(el, `font-size:${value}px`);
    else document.execCommand(cmd);
    o.html = el.innerHTML;
  } else {
    if (cmd === 'family') o.family = value;
    else if (cmd === 'size') { // todo el párrafo: también los trozos que tenían otro tamaño (frecuente en textos reconocidos por OCR)
      // el tamaño que se ve en el panel es el del texto bajo el cursor: todo el párrafo cambia en esa misma proporción
      const shown = sizeShown || o.size; const k = value / shown;
      o.html = o.html.replace(/font-size:\s*([\d.]+)px/g, (_, n) => `font-size:${(Number(n) * k).toFixed(2)}px`);
      if (editing) { const rt = document.querySelector(`.ov[data-id="${o.id}"] .rt`); if (rt) rt.innerHTML = o.html; }
      o.size = Math.round(o.size * k * 100) / 100;
    } else if (cmd === 'color') o.color = value;
    else if (cmd === 'align') o.align = value; else if (cmd === 'lh') o.lh = value;
    else if (['bold', 'italic', 'underline'].includes(cmd)) {
      const tag = { bold: 'b', italic: 'i', underline: 'u' }[cmd];
      const re = new RegExp(`^<${tag}>([\\s\\S]*)</${tag}>$`);
      o.html = re.test(o.html) ? o.html.replace(re, '$1') : `<${tag}>${o.html}</${tag}>`;
    }
    if (editing) { const keep = o.id; renderOverlays(); const e2 = document.querySelector(`.ov[data-id="${keep}"] .rt`); e2?.focus(); } else renderOverlays();
  }
  setDirty(true); renderPanel(true);
}
function wrapSelection(root, css) {
  const sel = getSelection(); const r = sel.getRangeAt(0);
  const span = document.createElement('span'); span.setAttribute('style', css);
  span.appendChild(r.extractContents()); r.insertNode(span);
  span.querySelectorAll('[style*="font-size"]').forEach((n) => { n.style.fontSize = ''; });
  sel.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(span); sel.addRange(nr);
}

// ============================================================================
// Hornear: pasar los objetos al PDF
// ============================================================================
// Coordenadas "visuales" (x→derecha, y→abajo, en puntos de la página tal como se ve)
// se convierten al espacio PDF con el viewport de pdf.js (considera la rotación).

// Descompone un texto enriquecido en palabras con su posición exacta (layout del navegador).
async function layoutRich(o) {
  const host = $('#edMeasure');
  host.innerHTML = `<div class="rt" style="${richStyle(o).replace(/transform:[^;]+/, 'transform:none')}">${o.html}</div>`;
  const root = host.firstElementChild;
  await document.fonts.ready;
  const fams = new Set(); root.querySelectorAll('*').forEach((n) => fams.add(getComputedStyle(n).fontFamily)); fams.add(getComputedStyle(root).fontFamily);
  await Promise.all([...fams].map((f) => Promise.all(['400', '700'].flatMap((w) => ['normal', 'italic'].map((st) => document.fonts.load(`${st} ${w} 12px ${f}`).catch(() => {}))))));
  const base = root.getBoundingClientRect();
  const words = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement; const cs = getComputedStyle(el);
    let underline = false; for (let a = el; a && a !== host; a = a.parentElement) if (/underline/.test(getComputedStyle(a).textDecorationLine)) underline = true;
    const famCss = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const style = { family: CSS2FAM[famCss] || 'sans', bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle === 'italic', size: parseFloat(cs.fontSize), color: cssRgb(cs.color), underline, va: cs.verticalAlign };
    const re = /\S+/g; let m;
    while ((m = re.exec(node.data))) {
      const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (rects.length <= 1) { const r = rects[0] || range.getBoundingClientRect(); words.push({ text: m[0], x: r.left - base.left, top: r.top - base.top, h: r.height, w: r.width, ...style }); }
      else { // palabra cortada entre líneas: carácter por carácter
        let cur = null;
        for (let k = 0; k < m[0].length; k++) {
          const rr = document.createRange(); rr.setStart(node, m.index + k); rr.setEnd(node, m.index + k + 1); const r = rr.getBoundingClientRect();
          if (cur && Math.abs(r.top - cur.rt) < 1) { cur.text += m[0][k]; cur.w = r.right - base.left - cur.x; }
          else { cur && words.push(cur); cur = { text: m[0][k], x: r.left - base.left, top: r.top - base.top, rt: r.top, h: r.height, w: r.width, ...style }; }
        }
        cur && words.push(cur);
      }
    }
  }
  const height = root.offsetHeight; host.innerHTML = '';
  return { words, height };
}

async function bakeAll() { return bakeDoc(true); }
// commit=false: devuelve una copia con los cambios aplicados sin tocar el documento (para imprimir).
async function bakeDoc(commit) {
  if (!hasOverlays()) return ed.bytes;
  if (ed.editing) stopEditing();
  const doc = await loadLib(ed.bytes);
  const fontCache = {};
  const font = async (fam, b, i) => { const { key, bytes } = await fontBytes(fam, b, i); if (!fontCache[key]) fontCache[key] = doc.embedFont(bytes, { subset: true }); return fontCache[key]; };
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < ed.count; i++) {
    const list = ed.overlays[i] || []; const ocr = ed.ocr[i];
    if (!list.length && !(ocr && !ocr.baked)) continue;
    const page = doc.getPage(i), v = await vp1(i);
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const P = (x, y) => v.convertToPdfPoint(x, y);
    const rect = (x, y, w, h, color) => { const [bx, by] = P(x, y + h); page.drawRectangle({ x: bx, y: by, width: w, height: h, color: rgb(...color), rotate: degrees(rot) }); };
    // 0) Lo que se tapa con "Tapar" también se borra del archivo (no queda texto oculto debajo).
    //    Va antes de dibujar nada en la página.
    const wo = list.filter((o) => o.type === 'whiteout').map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
    if (wo.length) { try { await PdfText.removeTextInRects(doc, i, wo, (x, y) => v.convertToViewportPoint(x, y), { pad: 0 }); } catch (e) { console.warn(e); } }
    // 1) Capa de texto invisible del OCR (hace la página buscable y seleccionable)
    if (ocr && !ocr.baked) {
      const covered = [...list.filter((o) => o.cover).map((o) => o.cover), ...wo];
      for (const w of ocr.words) {
        const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
        if (covered.some((c) => cx > c.x && cx < c.x + c.w && cy > c.y && cy < c.y + c.h)) continue;
        let t = ''; for (const ch of w.text) { try { helv.encodeText(ch); t += ch; } catch { t += '?'; } }
        const w1 = helv.widthOfTextAtSize(t, 1); if (!w1) continue;
        const size = clamp(w.w / w1, 2, w.h * 2.5);
        const [tx, ty] = P(w.x, w.base);
        page.drawText(t, { x: tx, y: ty, size, font: helv, opacity: 0, rotate: degrees(rot) });
      }
      if (commit) ocr.baked = true;
    }
    // 2) Objetos
    for (const o of list) {
      if (o.type === 'whiteout') rect(o.x, o.y, o.w, o.h, o.bg || [1, 1, 1]);
      if (o.type === 'image') {
        const img = o.mime === 'image/jpeg' ? await doc.embedJpg(o.bytes) : await doc.embedPng(o.bytes);
        const [bx, by] = P(o.x, o.y + o.h); page.drawImage(img, { x: bx, y: by, width: o.w, height: o.h, rotate: degrees(rot) });
      }
      if (o.type === 'rich') {
        const lay = await layoutRich(o);
        if (o.cover && !o.transparent) { rect(o.cover.x - 0.5, o.cover.y - 0.5, o.cover.w + 1, o.cover.h + 1, o.bg); rect(o.x - 0.5, o.y - 0.5, o.w + 1, Math.max(lay.height, 1) + 1, o.bg); }
        for (const w of lay.words) {
          const f = await font(w.family, w.bold, w.italic); const m = await fontMetrics(w.family, w.bold, w.italic);
          const baseline = w.top + w.h * (m.asc / (m.asc + m.desc));
          const [tx, ty] = P(o.x + w.x, o.y + baseline);
          const [r, g, b, a] = w.color;
          page.drawText(w.text, { x: tx, y: ty, size: w.size, font: f, color: rgb(r, g, b), opacity: a, rotate: degrees(rot) });
          if (w.underline) {
            const uy = o.y + baseline + w.size * 0.12, th = Math.max(0.4, w.size * 0.06);
            const [ux, uy2] = P(o.x + w.x, uy + th); page.drawRectangle({ x: ux, y: uy2, width: w.w, height: th, color: rgb(r, g, b), rotate: degrees(rot) });
          }
        }
      }
    }
  }
  const out = await saveLib(doc);
  if (!commit) return out;
  ed.overlays = {}; ed.sel = null; ed.editing = null;
  await setBytes(out);
  return ed.bytes;
}

// ============================================================================
// Páginas y documento
// ============================================================================
async function structural(msg, fn) {
  return step(msg, async () => { await bakeAll(); snapshot(); const doc = await loadLib(ed.bytes); const r = await fn(doc); await setBytes(await saveLib(doc), { structural: true }); return r; });
}
const targets = () => (ed.selected.size ? [...ed.selected].sort((a, b) => a - b) : [ed.current]);
async function rotate(delta) {
  await structural('Rotando…', (doc) => { for (const i of targets()) { const p = doc.getPage(i); p.setRotation(degrees((p.getRotation().angle + delta + 360) % 360)); } });
}
async function deletePages() {
  const t = targets();
  if (t.length >= ed.count) return toast('No puedes eliminar todas las páginas.');
  await structural('Eliminando páginas…', (doc) => { for (const i of t.slice().reverse()) doc.removePage(i); });
  ed.selected.clear(); ed.current = Math.min(ed.current, ed.count - 1); renderThumbs(); renderPage();
}
async function insertBlank() {
  const at = ed.current + 1;
  await structural('Insertando página…', (doc) => { const p = doc.getPage(ed.current); const { width, height } = p.getSize(); const np = doc.insertPage(at, [width, height]); np.setRotation(p.getRotation()); });
  ed.current = at; renderPage(); renderThumbs();
}
async function movePage(from, to) {
  if (from === to || from + 1 === to) return;
  await structural('Reordenando…', (doc) => { const p = doc.getPage(from); doc.removePage(from); doc.insertPage(to > from ? to - 1 : to, p); });
  ed.current = to > from ? to - 1 : to; ed.selected.clear(); renderThumbs(); renderPage();
}
async function extractPages(list = targets(), suffix = '-paginas') {
  await bakeAll();
  const src = await loadLib(ed.bytes); const out = await PDFDocument.create();
  (await out.copyPages(src, list)).forEach((p) => out.addPage(p));
  return saveLib(out);
}
async function extractToFile() {
  await step('Extrayendo…', async () => {
    const b = await extractPages(); const r = await pf.edSaveAs(b, baseName() + '-paginas.pdf');
    if (r.ok && r.data) toast('Guardado: ' + r.data.split(/[\\/]/).pop());
  });
}
// Dividir: cada N páginas o por rangos ("1-3, 4, 5-9")
function splitDialog() {
  modal(`<h2>Dividir PDF</h2>
    <label class="radio"><input type="radio" name="spMode" value="every" checked /> <span>Cada <input type="number" id="spN" value="1" min="1" style="width:60px;display:inline-block" /> página(s)</span></label>
    <label class="radio"><input type="radio" name="spMode" value="ranges" /> <span>Por rangos <input type="text" id="spR" placeholder="1-3, 4, 5-9" style="width:160px;display:inline-block" /></span></label>
    <p class="muted small">Se guardan como archivos separados en la carpeta que elijas.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Dividir</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const mode = document.querySelector('input[name="spMode"]:checked').value; let groups = [];
    if (mode === 'every') { const n = Math.max(1, Number($('#spN').value) || 1); for (let i = 0; i < ed.count; i += n) groups.push([...Array(Math.min(n, ed.count - i)).keys()].map((k) => i + k)); }
    else {
      for (const part of $('#spR').value.split(',')) { const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part); if (!m) continue; const a = Number(m[1]), b = Number(m[2] || m[1]); const g = []; for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k >= 1 && k <= ed.count) g.push(k - 1); if (g.length) groups.push(g); }
      if (!groups.length) return toast('Indica rangos válidos, por ejemplo 1-3, 4');
    }
    closeModal();
    const dir = await pf.edChooseDir(); if (!dir.ok || !dir.data) return;
    await step('Dividiendo…', async () => {
      for (let g = 0; g < groups.length; g++) {
        busy(`Dividiendo · archivo ${g + 1} de ${groups.length}…`, g / groups.length);
        const b = await extractPages(groups[g]); const nm = `${baseName()}-${groups[g].length === 1 ? 'p' + (groups[g][0] + 1) : (groups[g][0] + 1) + '-' + (groups[g][groups[g].length - 1] + 1)}.pdf`;
        await pf.edWriteFile(dir.data, nm, b);
      }
      toast(`${groups.length} archivo(s) guardado(s) en ${dir.data.split(/[\\/]/).pop()}`, 5000);
    });
  };
}
// Aplanar: convierte la página en imagen (elimina por completo el texto original que quedó tapado).
async function flattenPages() {
  const t = targets();
  modal(`<h2>Aplanar ${t.length > 1 ? t.length + ' páginas' : 'página'}</h2>
    <p>La página se convierte en una imagen de alta resolución. Así desaparece por completo cualquier texto que quedó <strong>tapado</strong> debajo de una edición.</p>
    <p class="muted small">Después puedes usar <strong>Reconocer texto</strong> para que vuelva a ser buscable.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Aplanar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    closeModal();
    await step('Aplanando…', async () => {
      await bakeAll(); snapshot();
      const doc = await loadLib(ed.bytes);
      for (const i of t) {
        const page = await ed.pdf.getPage(i + 1); const v = page.getViewport({ scale: 1 });
        const s = clamp(Math.sqrt(2.4e7 / (v.width * v.height)), 1, 200 / 72);
        const vp = page.getViewport({ scale: s }); const c = Object.assign(document.createElement('canvas'), { width: Math.floor(vp.width), height: Math.floor(vp.height) });
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); await page.render({ canvasContext: g, viewport: vp }).promise;
        const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88))).arrayBuffer());
        const img = await doc.embedJpg(jpg);
        doc.removePage(i); const np = doc.insertPage(i, [v.width, v.height]); np.drawImage(img, { x: 0, y: 0, width: v.width, height: v.height });
      }
      await setBytes(await saveLib(doc), { structural: true });
      toast('Página(s) aplanada(s).');
    });
  };
}

async function numberPages() {
  const big = ed.vp1[0] ? isLarge(ed.vp1[0]) : false;
  modal(`<h2>Numerar páginas</h2>
    <label>Formato<select id="nFmt"><option value="Página {n} de {t}">Página 1 de 10</option><option value="{n}">1</option><option value="{n} / {t}">1 / 10</option><option value="Fs. {n}">Fs. 1 (foliado)</option></select></label>
    <div class="grid2"><label>Posición<select id="nPos"><option value="br">Abajo a la derecha</option><option value="bc">Abajo al centro</option><option value="tr" ${big ? 'selected' : ''}>Arriba a la derecha</option></select></label>
    <label>Comenzar en<input type="number" id="nStart" value="1" min="0" /></label></div>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Numerar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const fmt = $('#nFmt').value, pos = $('#nPos').value, start = Number($('#nStart').value) || 1; closeModal();
    await structural('Numerando…', async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica); const total = ed.count + start - 1;
      for (let i = 0; i < ed.count; i++) {
        const v = await vp1(i), page = doc.getPage(i), rot = page.getRotation().angle;
        const k = Math.max(1, Math.sqrt(v.width * v.height / (A4[0] * A4[1]))); const size = 9 * k, m = 24 * k;
        const t = fmt.replace('{n}', i + start).replace('{t}', total); const tw = font.widthOfTextAtSize(t, size);
        const x = pos === 'bc' ? (v.width - tw) / 2 : v.width - m - tw; const y = pos === 'tr' ? m + size : v.height - m;
        const [px, py] = v.convertToPdfPoint(x, y);
        page.drawText(t, { x: px, y: py, size, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(rot) });
      }
    });
  };
}
async function watermark() {
  modal(`<h2>Marca de agua</h2>
    <label>Texto<input type="text" id="wText" value="COPIA" /></label>
    <label>Intensidad<select id="wOp"><option value="0.12">Suave</option><option value="0.22" selected>Media</option><option value="0.35">Fuerte</option></select></label>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Aplicar a todas las páginas</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const text = $('#wText').value.trim(), op = Number($('#wOp').value); closeModal(); if (!text) return;
    await structural('Aplicando marca de agua…', async (doc) => {
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      for (let i = 0; i < ed.count; i++) {
        const v = await vp1(i), page = doc.getPage(i), rot = page.getRotation().angle;
        const diag = Math.hypot(v.width, v.height); let size = diag * 0.7 / Math.max(1, font.widthOfTextAtSize(text, 1)); size = Math.min(size, diag / 6);
        const tw = font.widthOfTextAtSize(text, size), a = Math.PI / 4, cx = v.width / 2, cy = v.height / 2;
        const sx = cx - Math.cos(a) * tw / 2 + Math.sin(a) * size * 0.35, sy = cy + Math.sin(a) * tw / 2 + Math.cos(a) * size * 0.35;
        const [px, py] = v.convertToPdfPoint(sx, sy);
        page.drawText(text, { x: px, y: py, size, font, color: rgb(0.5, 0.5, 0.55), opacity: op, rotate: degrees(rot + 45) });
      }
    });
  };
}

// Comprimir: recodifica las imágenes grandes del PDF como JPEG (no toca texto ni vectores).
async function compress() {
  if (!ed.bytes) return;
  const before = ed.bytes.length;
  await step('Comprimiendo imágenes…', async () => {
    await bakeAll(); snapshot();
    const changed = await compressCore();
    const after = ed.bytes.length;
    toast(changed ? `Comprimido: ${fmtMB(before)} → ${fmtMB(after)} (${changed} imagen(es))` : `Sin imágenes que comprimir. Tamaño: ${fmtMB(after)}. Si es un plano vectorial, su peso viene del dibujo y no de imágenes.`, 6000);
  });
}
async function compressCore() {
  {
    const doc = await loadLib(ed.bytes); let changed = 0;
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFLib.PDFRawStream)) continue;
      const d = obj.dict; if (d.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
      if (d.get(PDFName.of('ImageMask'))?.toString() === 'true' || Number(d.get(PDFName.of('BitsPerComponent'))?.toString()) !== 8) continue;
      const filter = d.get(PDFName.of('Filter'))?.toString() || ''; const cs = d.get(PDFName.of('ColorSpace'))?.toString() || '';
      const W = Number(d.get(PDFName.of('Width'))?.toString()), H = Number(d.get(PDFName.of('Height'))?.toString());
      if (!W || !H || obj.contents.length < 150000) continue;
      let bmp = null;
      const filters = filterList(d.get(PDFName.of('Filter'))); const parms = d.get(PDFName.of('DecodeParms'));
      try {
        const last = filters[filters.length - 1];
        if (last === 'DCTDecode') {
          if (/CMYK/.test(cs)) continue;
          const data = await decodeChain(obj.contents, filters.slice(0, -1), null);
          bmp = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
        } else if ((cs === '/DeviceRGB' || cs === '/DeviceGray') && filters.every((f) => ['FlateDecode', 'ASCII85Decode', 'ASCIIHexDecode'].includes(f))) {
          const comps = cs === '/DeviceRGB' ? 3 : 1;
          const raw = await decodeChain(obj.contents, filters, parms, { comps, width: W });
          if (raw.length < W * H * comps) continue;
          const id = new ImageData(W, H);
          for (let p = 0, q = 0; p < W * H; p++, q += comps) { const r = raw[q]; id.data[p * 4] = r; id.data[p * 4 + 1] = comps === 3 ? raw[q + 1] : r; id.data[p * 4 + 2] = comps === 3 ? raw[q + 2] : r; id.data[p * 4 + 3] = 255; }
          bmp = await createImageBitmap(id);
        }
      } catch (e) { console.warn('compress skip', e); bmp = null; }
      if (!bmp) continue;
      const s = Math.min(1, 2200 / Math.max(W, H)); const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h }); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
      const jpg = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72))).arrayBuffer());
      if (jpg.length >= obj.contents.length * 0.9) continue;
      // El canvas siempre exporta JPEG en RGB.
      const nd = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', Length: jpg.length });
      const sm = d.get(PDFName.of('SMask')); if (sm) nd.set(PDFName.of('SMask'), sm);
      doc.context.assign(ref, PDFLib.PDFRawStream.of(nd, jpg)); changed++;
    }
    await setBytes(await saveLib(doc));
    return changed;
  }
}

// Decodificación de streams PDF para recomprimir imágenes.
function filterList(f) {
  if (!f) return [];
  if (f instanceof PDFLib.PDFArray) return f.asArray().map((x) => x.toString().replace('/', ''));
  return [f.toString().replace('/', '')];
}
async function inflate(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); }
function ascii85(bytes) {
  const out = []; let tuple = 0, n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0x7e) break; // ~>
    if (c <= 32) continue;
    if (c === 0x7a && n === 0) { out.push(0, 0, 0, 0); continue; } // z
    tuple = tuple * 85 + (c - 33); n++;
    if (n === 5) { out.push((tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255); tuple = 0; n = 0; }
  }
  if (n) { for (let k = n; k < 5; k++) tuple = tuple * 85 + 84; for (let k = 0; k < n - 1; k++) out.push((tuple >>> (24 - 8 * k)) & 255); }
  return new Uint8Array(out);
}
function asciiHex(bytes) { const t = new TextDecoder().decode(bytes).replace(/[^0-9a-f]/gi, ''); const o = new Uint8Array(Math.ceil(t.length / 2)); for (let i = 0; i < o.length; i++) o[i] = parseInt((t.substr(i * 2, 2) + '0').slice(0, 2), 16); return o; }
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
async function decodeChain(bytes, filters, parms, img) {
  let data = bytes;
  const pl = parms instanceof PDFLib.PDFArray ? parms.asArray() : filters.map(() => parms);
  for (let k = 0; k < filters.length; k++) {
    const f = filters[k];
    if (f === 'ASCII85Decode') data = ascii85(data);
    else if (f === 'ASCIIHexDecode') data = asciiHex(data);
    else if (f === 'FlateDecode') {
      data = await inflate(data);
      const pr = pl[k]; const pred = pr?.get?.(PDFName.of('Predictor')); const predictor = pred ? Number(pred.toString()) : 1;
      if (predictor >= 10) {
        const colors = Number(pr.get(PDFName.of('Colors'))?.toString() || img?.comps || 1), columns = Number(pr.get(PDFName.of('Columns'))?.toString() || img?.width || 1);
        data = unPredictPaeth(data, colors, columns);
      } else if (predictor === 2) throw new Error('predictor TIFF no soportado');
    } else throw new Error('filtro no soportado: ' + f);
  }
  return data;
}
function unPredictPaeth(data, bpp, columns) {
  const row = bpp * columns, rows = Math.floor(data.length / (row + 1)), out = new Uint8Array(rows * row);
  let prevOff = -1;
  for (let r = 0, i = 0; r < rows; r++) {
    const type = data[i++], o = r * row;
    for (let x = 0; x < row; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0, b = prevOff >= 0 ? out[prevOff + x] : 0, c = x >= bpp && prevOff >= 0 ? out[prevOff + x - bpp] : 0, v = data[i++];
      out[o + x] = (type === 1 ? v + a : type === 2 ? v + b : type === 3 ? v + ((a + b) >> 1) : type === 4 ? v + paeth(a, b, c) : v) & 255;
    }
    prevOff = o;
  }
  return out;
}


// ============================================================================
// Archivos: abrir, crear, combinar, guardar, exportar, enviar
// ============================================================================
const baseName = () => ed.name.replace(/\.[^.]+$/, '');

// replace=true: abre en una pestaña nueva (si son varios, combinados). replace=false: los agrega al final del documento activo.
async function addFiles(paths, { replace = false } = {}) {
  if (!paths?.length) return false;
  if (G.busy) { toast('Espera a que termine la operación en curso.'); return false; }
  if (!ed.bytes) replace = true;
  if (replace && paths.length === 1) { const t = tabs.find((x) => x.path && x.path === paths[0]); if (t) { await switchTab(t); return true; } }
  const prev = ed; const T = replace ? newState() : ed;
  const ok = !!(await step('Preparando archivos…', async () => {
    const items = [];
    for (const p of paths) {
      busy('Abriendo ' + p.split(/[\\/]/).pop() + '…');
      const r = await pf.edOpen(p); if (!r.ok) throw new Error(r.error); items.push({ ...r.data, path: p });
    }
    if (!replace) { await bakeAll(); snapshot(); }
    let bytes;
    const single = items.length === 1 && items[0].kind === 'pdf' && replace;
    if (single) bytes = new Uint8Array(items[0].bytes); // se abre tal cual (no se reescribe)
    else {
      const doc = !replace ? await loadLib(ed.bytes) : await PDFDocument.create();
      for (const it of items) {
        if (it.kind === 'pdf') { const src = await loadLib(new Uint8Array(it.bytes)); (await doc.copyPages(src, src.getPageIndices())).forEach((pg) => doc.addPage(pg)); }
        else {
          const img = await imageToEmbeddable(new Blob([it.bytes], { type: it.mime }));
          const emb = img.mime === 'image/jpeg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes);
          const [W, H] = img.ratio > 1 ? [A4[1], A4[0]] : A4; const m = 24; const s = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
          doc.addPage([W, H]).drawImage(emb, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
        }
      }
      bytes = await saveLib(doc);
    }
    if (replace) {
      T.name = items[0].name.replace(/\.[^.]+$/, '') + (items.length > 1 ? '-combinado' : '') + '.pdf';
      T.path = single && !items[0].converted ? items[0].path : null; T.fromPdf = single;
      tabs.push(T); ed = T; window.studio?.goEditor();
    }
    await setBytes(bytes, { keepPage: !replace, structural: true });
    setDirty(!(single && !items[0].converted));
    for (const it of items) if (it.kind === 'pdf' && !it.converted) pf.recentAdd?.(it.path);
    if (single && replace) window.Plantillas?.checkOpened(T);
    const conv = items.filter((i) => i.converted).map((i) => i.converted);
    if (conv.length) toast(`Convertido a PDF desde ${[...new Set(conv)].join(' y ')}. Revisa el resultado.`, 4500);
    else if (items.length > 1) toast(`${items.length} archivos combinados en un PDF`);
    return true;
  }));
  if (!ok && replace && tabs.includes(T)) { tabs.splice(tabs.indexOf(T), 1); try { await T.pdf?.destroy(); } catch {} ed = tabs.includes(prev) ? prev : (tabs[tabs.length - 1] || newState()); await activate(); }
  return ok;
}
// Abre cada archivo en su propia pestaña.
async function openEach(paths) {
  let ok = false;
  for (const p of paths) ok = (await addFiles([p], { replace: true })) || ok;
  return ok;
}

// ---------- Pestañas ----------
function renderTabs() {
  const host = $('#docTabs'); if (!host) return;
  const onEditor = !$('#view-editor')?.classList.contains('hidden');
  host.innerHTML = tabs.map((t) => `<div class="dtab ${t === ed && onEditor ? 'active' : ''}" data-tab="${t.id}" title="${esc(t.path || t.name)}">
      ${icon('file', 14)}<span class="nm">${esc(t.name)}</span>${t.dirty ? '<i class="dot" title="Cambios sin guardar"></i>' : ''}
      <button class="x" data-close="${t.id}" title="Cerrar (⌘W)">${icon('x', 12)}</button></div>`).join('')
    + `<button class="dtab-new" id="dtabNew" title="Abrir documento (⌘O)">${icon('plus', 15)}</button>`;
}
async function activate() {
  syncDocState();
  if (!ed.bytes) { shownTab = null; renderShell(); return; }
  renderShell(); renderThumbs(); renderSide(); await renderPage(); setTool(ed.tool || 'select');
  updateToolbar(); renderNotice();
  const bar = $('#edFind');
  if (bar) { bar.classList.toggle('hidden', !ed.find); $('#edFindQ').value = ed.find?.q || ''; updateFindUi(); }
}
async function switchTab(t) {
  if (!t) return false;
  if (G.busy && t !== ed) { toast('Espera a que termine la operación en curso.'); return false; }
  if (t !== ed) { if (ed.editing) stopEditing(); ed = t; }
  if ($('#view-editor').classList.contains('hidden')) show('editor');
  await activate();
  return true;
}
function cycleTab(d) {
  if (tabs.length < 2) return;
  const k = tabs.indexOf(ed); switchTab(tabs[(k + d + tabs.length) % tabs.length]);
}
async function closeTab(t = ed) {
  if (!t?.bytes) return true;
  if (G.busy) { toast('Espera a que termine la operación en curso.'); return false; }
  if (t !== ed) await switchTab(t);
  if (ed.dirty && !(await confirmDiscard())) return false;
  try { await ed.pdf?.destroy(); } catch {}
  const k = tabs.indexOf(ed); if (k >= 0) tabs.splice(k, 1);
  if (tabs.length) { ed = tabs[Math.min(k, tabs.length - 1)]; await activate(); }
  else { ed = newState(); shownTab = null; syncDocState(); window.studio?.goHome(); }
  return true;
}
async function saveAll() {
  for (const t of tabs.slice()) {
    if (!t.dirty) continue;
    await switchTab(t);
    if (!(await save())) return false;
  }
  return true;
}
function bindTabs() {
  const host = $('#docTabs'); if (!host || host._bound) return; host._bound = true;
  host.addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]'); if (x) { e.stopPropagation(); closeTab(tabs.find((t) => t.id === x.dataset.close)); return; }
    if (e.target.closest('#dtabNew')) { openDialog(true); return; }
    const t = e.target.closest('[data-tab]'); if (t) switchTab(tabs.find((z) => z.id === t.dataset.tab));
  });
  host.addEventListener('auxclick', (e) => { const t = e.target.closest('[data-tab]'); if (t && e.button === 1) closeTab(tabs.find((z) => z.id === t.dataset.tab)); });
}

function confirmDiscard() {
  return new Promise((res) => {
    modal(`<h2>Cambios sin guardar</h2><p>«${esc(ed.name)}» tiene cambios que no has guardado.</p>
      <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mNo">Descartar</button><button class="primary" id="mOk">Guardar</button></div>`);
    $('#mCancel').onclick = () => { closeModal(); res(false); };
    $('#mNo').onclick = () => { closeModal(); res(true); };
    $('#mOk').onclick = async () => { closeModal(); res(await save()); };
  });
}
async function createBlank() {
  modal(`<h2>Crear PDF</h2>
    <label>Tamaño<select id="cSize"><option value="letter">Carta (216 × 279 mm)</option><option value="oficio">Oficio (216 × 330 mm)</option><option value="a4">A4 (210 × 297 mm)</option></select></label>
    <div class="grid2"><label>Orientación<select id="cOr"><option value="p">Vertical</option><option value="l">Horizontal</option></select></label><label>Páginas<input type="number" id="cN" value="1" min="1" max="200" /></label></div>
    <p class="muted small">También puedes crear un PDF desde Word, Excel o imágenes con <strong>Convertir a PDF</strong>.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Crear</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const sz = { letter: LETTER, oficio: OFICIO, a4: A4 }[$('#cSize').value]; const l = $('#cOr').value === 'l'; const n = clamp(Number($('#cN').value) || 1, 1, 200);
    closeModal();
    if (G.busy) return toast('Espera a que termine la operación en curso.');
    const doc = await PDFDocument.create(); for (let k = 0; k < n; k++) doc.addPage(l ? [sz[1], sz[0]] : sz);
    const T = newState(); T.name = `Documento nuevo${tabs.some((t) => /^Documento nuevo/.test(t.name)) ? ' ' + (tabs.length + 1) : ''}.pdf`;
    tabs.push(T); ed = T; window.studio?.goEditor();
    await setBytes(await saveLib(doc), { keepPage: false, structural: true }); setDirty(true); setTool('text');
  };
}

async function finalBytes() { await bakeAll(); return ed.bytes; }
async function save() {
  if (!ed.bytes) return false;
  if (ed.tpl?.mode === 'fill') { toast('Estás llenando una plantilla: usa «Generar documento» en el panel derecho.', 4000); return false; }
  if (!ed.path) return saveAs();
  return !!(await step('Guardando…', async () => {
    const b = await finalBytes(); const r = await pf.edSaveTo(ed.path, b);
    if (!r.ok) throw new Error(r.error);
    setDirty(false); pf.recentAdd?.(ed.path); toast('Guardado'); return true;
  }));
}
async function saveAs() {
  if (!ed.bytes) return false;
  return !!(await step('Guardando…', async () => {
    const b = await finalBytes(); const r = await pf.edSaveAs(b, ed.name);
    if (!r.ok) throw new Error(r.error); if (!r.data) return false;
    ed.path = r.data; ed.name = r.data.split(/[\\/]/).pop(); setDirty(false); pf.recentAdd?.(ed.path); toast('Guardado como ' + ed.name); return true;
  }));
}

// --- Imprimir (⌘P): cada página se rasteriza a ~200 ppp y se abre el diálogo de impresión del sistema.
async function printDoc() {
  if (!ed.bytes || G.busy) return;
  const T = ed;
  await step('Preparando impresión…', async () => {
    const bytes = await bakeDoc(false);
    const doc = bytes === T.bytes ? T.pdf : await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: 'vendor/standard_fonts/', cMapUrl: 'vendor/cmaps/', cMapPacked: true }).promise;
    const pages = [];
    try {
      for (let i = 0; i < doc.numPages; i++) {
        busy(`Preparando impresión · página ${i + 1} de ${doc.numPages}…`, i / doc.numPages);
        const page = await doc.getPage(i + 1); const v = page.getViewport({ scale: 1 });
        const sc = Math.min(200 / 72, Math.sqrt(36e6 / (v.width * v.height)));
        const vp = page.getViewport({ scale: sc });
        const c = Object.assign(document.createElement('canvas'), { width: Math.floor(vp.width), height: Math.floor(vp.height) });
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
        // Si la orientación es distinta a la de la primera página, se gira para aprovechar la hoja.
        let src = c; const land0 = pages.length ? pages[0].w > pages[0].h : v.width > v.height;
        if ((v.width > v.height) !== land0) { src = Object.assign(document.createElement('canvas'), { width: c.height, height: c.width }); const r2 = src.getContext('2d'); r2.translate(src.width, 0); r2.rotate(Math.PI / 2); r2.drawImage(c, 0, 0); }
        const blob = await new Promise((r) => src.toBlob(r, 'image/jpeg', 0.92));
        pages.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: src === c ? v.width : v.height, h: src === c ? v.height : v.width });
        c.width = 0; c.height = 0; if (src !== c) { src.width = 0; src.height = 0; }
      }
    } finally { if (doc !== T.pdf) doc.destroy(); }
    busy('Abriendo el diálogo de impresión…');
    const r = await pf.print(pages, T.name); if (!r.ok) throw new Error(r.error);
    G.lastPrint = r.data;
  });
}

// --- Pantalla completa / modo lectura
function reading(on) {
  const want = on === undefined ? !document.body.classList.contains('reading') : !!on;
  document.body.classList.toggle('reading', want);
  pf.setFullScreen(want);
  setTimeout(() => { if (ed.pdf) renderPage(); }, 350);
}

// --- Exportar
function exportDialog(kind) {
  if (!ed.bytes) return toast('Abre un documento primero.');
  modal(`<h2>Exportar PDF</h2>
    <label class="radio"><input type="radio" name="exK" value="docx" ${!kind || kind === 'docx' ? 'checked' : ''}/> <span><strong>Word (.docx)</strong> — texto editable con negritas y cursivas, una página de Word por página</span></label>
    <label class="radio"><input type="radio" name="exK" value="png" ${kind === 'png' ? 'checked' : ''}/> <span><strong>Imágenes PNG</strong> — una imagen por página</span></label>
    <label class="radio"><input type="radio" name="exK" value="jpg" ${kind === 'jpg' ? 'checked' : ''}/> <span><strong>Imágenes JPG</strong> — más livianas</span></label>
    <label class="radio"><input type="radio" name="exK" value="txt" ${kind === 'txt' ? 'checked' : ''}/> <span><strong>Texto (.txt)</strong></span></label>
    <label>Resolución de imágenes<select id="exDpi"><option value="150">150 ppp (pantalla)</option><option value="300">300 ppp (impresión)</option></select></label>
    <p class="muted small">Si hay páginas escaneadas, primero se reconoce su texto para exportarlo a Word o texto.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Exportar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const k = document.querySelector('input[name="exK"]:checked').value, dpi = Number($('#exDpi').value); closeModal();
    if (k === 'png' || k === 'jpg') return exportImages(k, dpi);
    const scanned = await scannedPages(); if (scanned.length) await recognize(scanned);
    return k === 'docx' ? exportDocx() : exportTxt();
  };
}
function htmlRuns(html, base) {
  const div = document.createElement('div'); div.innerHTML = html; const runs = [];
  const walk = (n, st) => {
    if (n.nodeType === 3) { if (n.data) runs.push({ text: n.data, ...st }); return; }
    if (n.nodeName === 'BR') { runs.push({ text: '\n', ...st }); return; }
    const s2 = { ...st };
    if (/^(B|STRONG)$/.test(n.nodeName) || /bold|[6-9]00/.test(n.style?.fontWeight || '')) s2.bold = true;
    if (/^(I|EM)$/.test(n.nodeName) || n.style?.fontStyle === 'italic') s2.italic = true;
    if (n.nodeName === 'U' || /underline/.test(n.style?.textDecoration || '')) s2.underline = true;
    if (n.style?.fontSize) s2.size = parseFloat(n.style.fontSize);
    if (n.style?.fontFamily) s2.family = CSS2FAM[n.style.fontFamily.replace(/["']/g, '').split(',')[0].trim().toLowerCase()] || st.family;
    n.childNodes.forEach((c) => walk(c, s2));
  };
  div.childNodes.forEach((c) => walk(c, base));
  return runs;
}
async function docStructure() {
  await bakeAll();
  const pages = [];
  for (let i = 0; i < ed.count; i++) {
    const blocks = await blocksFor(i);
    pages.push({ paragraphs: blocks.map((b) => ({ align: b.align, runs: htmlRuns(b.html, { family: b.family, size: b.size, bold: false, italic: false }) })) });
  }
  return pages;
}
async function exportDocx() {
  await step('Exportando a Word…', async () => {
    const pages = await docStructure();
    const fam = Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, v.word || v.label]));
    const r = await pf.edExportDocx(pages, fam, baseName() + '.docx');
    if (!r.ok) throw new Error(r.error); if (r.data) toast('Exportado: ' + r.data.split(/[\\/]/).pop());
  });
}
async function exportTxt() {
  await step('Exportando texto…', async () => {
    const pages = await docStructure();
    const txt = pages.map((p, i) => `--- Página ${i + 1} ---\n` + p.paragraphs.map((pa) => pa.runs.map((r) => r.text).join('')).join('\n\n')).join('\n\n');
    const r = await pf.edSaveText(txt, baseName() + '.txt'); if (r.ok && r.data) toast('Exportado: ' + r.data.split(/[\\/]/).pop());
  });
}
async function exportImages(fmt, dpi) {
  const dir = await pf.edChooseDir(); if (!dir.ok || !dir.data) return;
  await step('Exportando imágenes…', async () => {
    await bakeAll();
    for (let i = 0; i < ed.count; i++) {
      busy(`Exportando página ${i + 1} de ${ed.count}…`, i / ed.count);
      const page = await ed.pdf.getPage(i + 1); const v = page.getViewport({ scale: 1 });
      const s = Math.min(dpi / 72, Math.sqrt(6e7 / (v.width * v.height))); const vp = page.getViewport({ scale: s });
      const c = Object.assign(document.createElement('canvas'), { width: Math.floor(vp.width), height: Math.floor(vp.height) });
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); await page.render({ canvasContext: g, viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9));
      await pf.edWriteFile(dir.data, `${baseName()}-${String(i + 1).padStart(2, '0')}.${fmt}`, new Uint8Array(await blob.arrayBuffer()));
    }
    toast(`${ed.count} imagen(es) exportada(s)`, 4000);
  });
}

// --- Enviar a firmar (Portalfirma)
async function sendToSign() {
  if (!ed.bytes) return toast('Abre un documento primero.');
  const b = await step('Preparando documento…', finalBytes); if (!b) return;
  if (b.length > MAX_SEND) {
    modal(`<h2>Documento muy pesado</h2><p>Pesa <strong>${fmtMB(b.length)}</strong> y Portalfirma acepta hasta 20 MB.</p>
      <p class="muted">Prueba <strong>Comprimir</strong>, o separa el documento con <strong>Dividir</strong>.</p>
      <div class="actions"><button class="secondary" id="mCancel">Cerrar</button><button class="primary" id="mOk">Comprimir ahora</button></div>`);
    $('#mCancel').onclick = closeModal; $('#mOk').onclick = () => { closeModal(); compress(); };
    return;
  }
  const r = await pf.edTemp(b, ed.name);
  if (!r.ok) return toast(r.error, 5000);
  const pre = ed.signers?.length ? ed.signers.map((x) => ({ ...x })) : null;
  requireLogin(() => { state.prefillSigners = pre; startAnalysis(r.data); }, 'Para enviar a firmar, inicia sesión en Portalfirma.');
}

// --- Firmar plano arquitectónico: láminas + compresión + hoja de firmas tamaño carta
const PAPER = [['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297], ['Carta', 216, 279], ['Oficio', 216, 330]];
function paperName(wPt, hPt) {
  const a = Math.round(Math.min(wPt, hPt) / 72 * 25.4), b = Math.round(Math.max(wPt, hPt) / 72 * 25.4);
  const f = PAPER.find(([, x, y]) => Math.abs(x - a) < 8 && Math.abs(y - b) < 8);
  return `${f ? f[0] + ' · ' : ''}${a} × ${b} mm`;
}
async function planWizard() {
  modal(`<h2>Firmar plano arquitectónico</h2>
    <p class="muted">Junta las láminas, las comprime si es necesario y agrega al final una <strong>hoja de firmas tamaño carta</strong> que identifica cada lámina, para que las firmas queden a tamaño normal.</p>
    <label>Nombre del proyecto<input type="text" id="plName" placeholder="Ej. Vivienda unifamiliar Los Aromos 123" /></label>
    <div class="grid2"><label>Dirección o rol <span class="muted small">(opcional)</span><input type="text" id="plAddr" /></label>
    <label>Profesional responsable <span class="muted small">(opcional)</span><input type="text" id="plPro" /></label></div>
    <label class="radio"><input type="checkbox" id="plUseOpen" ${ed.bytes ? 'checked' : 'disabled'} /> <span>Usar el documento abierto${ed.bytes ? ` (${esc(ed.name)})` : ''}</span></label>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">${ed.bytes ? 'Continuar' : 'Elegir láminas…'}</button></div>`);
  $('#plUseOpen').onchange = (e) => { $('#mOk').textContent = e.target.checked ? 'Continuar' : 'Elegir láminas…'; };
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const meta = { name: $('#plName').value.trim(), addr: $('#plAddr').value.trim(), pro: $('#plPro').value.trim() };
    const useOpen = $('#plUseOpen').checked; closeModal();
    window.studio?.goEditor();
    if (!useOpen) { const r = await pf.edPick(true); if (!r.ok || !r.data.length) return; if (!(await addFiles(r.data, { replace: true }))) return; }
    await step('Preparando plano…', async () => {
      await bakeAll();
      if (ed.bytes.length > 14 * 1048576) { busy('Comprimiendo láminas…'); await compressCore(); }
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', ed.bytes))).map((x) => x.toString(16).padStart(2, '0')).join('');
      const sheets = []; for (let i = 0; i < ed.count; i++) { const v = await vp1(i); sheets.push(paperName(v.width, v.height)); }
      snapshot();
      const doc = await loadLib(ed.bytes);
      const [W, H] = LETTER; const pg = doc.addPage([W, H]);
      const reg = await doc.embedFont((await fontBytes('sans', false, false)).bytes, { subset: true });
      const bold = await doc.embedFont((await fontBytes('sans', true, false)).bytes, { subset: true });
      const ink = rgb(0.1, 0.12, 0.2), mut = rgb(0.4, 0.42, 0.5); let y = H - 64; const L = 56;
      const text = (t, x, yy, size, f = reg, c = ink) => pg.drawText(t, { x, y: yy, size, font: f, color: c });
      const wrap = (t, size, f, maxW) => { const out = []; let line = ''; for (const w of t.split(/\s+/)) { const tt = line ? line + ' ' + w : w; if (f.widthOfTextAtSize(tt, size) > maxW && line) { out.push(line); line = w; } else line = tt; } if (line) out.push(line); return out; };
      text('HOJA DE FIRMAS', L, y, 18, bold); y -= 20; text('Planos de arquitectura', L, y, 11, reg, mut); y -= 30;
      const rows = [['Proyecto', meta.name || baseName()], ...(meta.addr ? [['Dirección / Rol', meta.addr]] : []), ...(meta.pro ? [['Profesional responsable', meta.pro]] : []), ['Archivo', ed.name], ['Fecha', new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })], ['Láminas', String(ed.count)]];
      for (const [k, val] of rows) { text(k, L, y, 9.5, bold, mut); const ls = wrap(val, 10.5, reg, W - L - 200); ls.forEach((l2, n) => text(l2, L + 150, y - n * 13, 10.5)); y -= 13 * ls.length + 6; }
      y -= 10; text('Detalle de láminas', L, y, 11, bold); y -= 16;
      pg.drawLine({ start: { x: L, y: y + 10 }, end: { x: W - L, y: y + 10 }, thickness: 0.6, color: mut });
      const maxRows = Math.floor((y - 250) / 14);
      sheets.slice(0, maxRows).forEach((s, n) => { text(`Lámina ${n + 1}`, L, y, 9.5, bold); text(`Página ${n + 1} · ${s}`, L + 150, y, 9.5); y -= 14; });
      if (sheets.length > maxRows) { text(`… y ${sheets.length - maxRows} lámina(s) más (páginas ${maxRows + 1} a ${sheets.length})`, L, y, 9.5, reg, mut); y -= 14; }
      y -= 12; text('Huella digital (SHA-256) de las láminas:', L, y, 8.5, bold, mut); y -= 12;
      text(hash.slice(0, 32), L, y, 8, reg, mut); text(hash.slice(32), L, y - 10, 8, reg, mut); y -= 30;
      for (const l2 of wrap('Las firmas electrónicas estampadas en este documento se aplican a la totalidad de las láminas individualizadas en esta hoja, que forman parte integrante del mismo.', 9.5, reg, W - 2 * L)) { text(l2, L, y, 9.5, reg, mut); y -= 13; }
      text('Firmas', L, 205, 11, bold); pg.drawRectangle({ x: L, y: 56, width: W - 2 * L, height: 136, borderColor: rgb(0.75, 0.77, 0.83), borderWidth: 0.8, borderDashArray: [4, 3] });
      await setBytes(await saveLib(doc), { keepPage: false, structural: true });
      ed.name = (meta.name ? meta.name.replace(/[\\/:*?"<>|]+/g, '-') : baseName()) + ' - para firma.pdf'; ed.path = null;
      ed.current = ed.count - 1; await renderPage(); renderThumbs(); setDirty(true);
      ed.notice = `Plano listo: ${ed.count - 1} lámina(s) + hoja de firmas · ${fmtMB(ed.bytes.length)}. Revisa y presiona «Enviar a firmar».`;
      renderNotice();
    });
  };
}

// ============================================================================
// Interfaz
// ============================================================================
const TOOLS = [
  ['select', 'pointer', 'Seleccionar', 'Seleccionar (V): clic en un objeto, o arrastra en un espacio vacío para elegir un área. Sobre el texto del PDF: seleccionar y copiar'],
  ['hand', 'hand', 'Mover', 'Mano (H o mantén la barra espaciadora): mueve textos, imágenes y campos, o arrastra la página para desplazarte'],
  ['edittext', 'textEdit', 'Editar texto', 'Editar el texto del PDF (detecta párrafos y fuente) · ⌘E'],
  ['text', 'textAdd', 'Agregar texto', 'Dibuja el recuadro y escribe dentro · ⌘T'],
  ['image', 'image', 'Imagen', 'Agregar imagen o logo'],
  ['whiteout', 'eraser', 'Tapar', 'Cubrir un área con el color del fondo'],
];
const ib = (id, ic, title, cls = '') => `<button class="ibtn ${cls}" id="${id}" title="${title}">${icon(ic, 18)}</button>`;
function renderShell() {
  const host = $('#edBody');
  if (!ed.bytes) {
    host.innerHTML = `<div class="dropzone ed-empty"><div class="drop-icon">${icon('upload', 44)}</div><h2>PortalFirma Studio</h2>
      <p class="muted">Arrastra aquí PDF, Word, Excel o imágenes, o ábrelos desde el menú Archivo.</p>
      <div class="row" style="justify-content:center"><button class="primary" id="edOpenBtn">Abrir…</button><button class="secondary" id="edHomeBtn">Ir al inicio</button></div></div>`;
    $('#edOpenBtn').onclick = () => openDialog(); $('#edHomeBtn').onclick = () => window.studio?.goHome();
    return;
  }
  if ($('#edStage')) { renderNotice(); return; }
  host.innerHTML = `
  <div class="ed-toolbar">
    <div class="tg">${ib('edOpen', 'folderOpen', 'Abrir (⌘O)')}${ib('edSave', 'save', 'Guardar (⌘S)')}${ib('edPrint', 'print', 'Imprimir (⌘P)')}${ib('edSearch', 'search', 'Buscar texto (⌘F)')}${ib('edAdd', 'files', 'Combinar: agregar archivos al final')}</div>
    <div class="tg tools">${TOOLS.map(([k, ic, l, t]) => `<button class="tool" data-tool="${k}" title="${t}">${icon(ic, 17)}<span>${l}</span></button>`).join('')}</div>
    <div class="tg"><button class="primary small with-ic" id="edOcr" title="Reconocer texto en páginas escaneadas o fotocopias (⇧⌘R)">${icon('scanText', 17)}<span>Reconocer texto</span></button>
      ${ib('edCmp', 'compress', 'Comprimir PDF')}${ib('edNum', 'hash', 'Numerar páginas')}${ib('edWm', 'droplet', 'Marca de agua')}${ib('edExp', 'export', 'Exportar a Word, imágenes o texto')}</div>
    <div class="tg">${ib('edUndo', 'undo', 'Deshacer (⌘Z)')}${ib('edZoomOut', 'zoomOut', 'Alejar (⌘−)')}<span class="zoom-pct" id="edZoomPct" title="Tamaño ajustado (⌘0)">100%</span>${ib('edZoomIn', 'zoomIn', 'Acercar (⌘+)')}${ib('edFull', 'maximize', 'Pantalla completa (modo lectura)')}</div>
    <div class="tg right"><button class="secondary small with-ic wa-btn" id="edWa" title="Escribir a soporte de Portalfirma por WhatsApp">${icon('whatsapp', 16)}<span>Soporte</span></button><button class="secondary small with-ic ai-btn" id="edAi" data-member title="Asistente legal con IA: revisa, corrige y redacta">${icon('sparkle', 16)}<span>Asistente</span><span class="lock-badge">${icon('lock', 11)}</span></button><button class="secondary small with-ic" id="edCase" title="Guardar este documento en un expediente (carpeta del caso)">${icon('folderOpen', 16)}<span>Expediente</span></button><button class="secondary small with-ic" id="edTpl" title="Convertir este documento en una plantilla con campos">${icon('template', 16)}<span>Plantilla</span></button><button class="primary small with-ic" id="edSend" data-member>${icon('sign', 16)}<span>Enviar a firmar</span><span class="lock-badge">${icon('lock', 11)}</span></button></div>
  </div>
  <div class="ed-wrap">
  <div class="ed-main">
    <aside class="ed-side">
      <div class="side-tabs"><button data-side="pages" title="Miniaturas de páginas">${icon('pages', 15)}<span>Páginas</span></button><button data-side="outline" title="Marcadores e índice del documento">${icon('bookmark', 15)}<span>Marcadores</span></button></div>
      <div class="side-pages">
        <div class="ed-pageops">
          ${ib('edRotL', 'rotateL', 'Rotar a la izquierda')}${ib('edRotR', 'rotateR', 'Rotar a la derecha')}${ib('edIns', 'filePlus', 'Insertar página en blanco después')}
          ${ib('edExt', 'fileOut', 'Extraer: guardar las páginas seleccionadas como PDF')}${ib('edSplit', 'scissors', 'Dividir en varios PDF')}${ib('edFlat', 'layers', 'Aplanar: convertir la página en imagen (elimina texto tapado)')}
          ${ib('edDel', 'trash', 'Eliminar páginas seleccionadas', 'danger')}
        </div>
        <p class="muted small ed-hint">Clic: ir · ⌘/Ctrl+clic: seleccionar varias · arrastra para reordenar</p>
        <div class="ed-thumbs" id="edThumbs"></div>
      </div>
      <div class="side-outline hidden" id="edOutline"></div>
    </aside>
    <section class="ed-view" id="edCanvasWrap">
      <div class="ed-pagebar">
        ${ib('edPrev', 'chevL', 'Página anterior (←)')}<input id="edPageNum" class="pagenum" value="1" title="Ir a la página" /><span id="edPageCount" class="muted"></span>${ib('edNext', 'chevR', 'Página siguiente (→)')}
        <span class="muted small" id="edPageSize"></span><span class="muted small" id="edSize"></span>
        <div class="ed-find hidden" id="edFind">${icon('search', 15)}<input id="edFindQ" placeholder="Buscar en el documento" spellcheck="false" /><span id="edFindCount" class="muted small"></span>
          ${ib('edFindPrev', 'chevU', 'Anterior (⇧⌘G)')}${ib('edFindNext', 'chevD', 'Siguiente (⌘G)')}${ib('edFindX', 'x', 'Cerrar (Esc)')}</div>
      </div>
      <div id="edNotice"></div><div id="edBanner"></div>
      <div class="ed-stage" id="edStage"></div>
    </section>
  </div>
  <aside class="ed-panel-wrap" id="edPanelWrap"><div class="ed-resizer" id="edResizer" title="Arrastra para cambiar el ancho del panel"></div><div class="pnl-tabs" id="edPanelTabs"></div><div class="ed-panel" id="edPanel"></div></aside>
  </div>
  <button class="reading-exit" id="edReadExit" title="Salir de pantalla completa (Esc)">${icon('minimize', 18)}<span>Salir</span></button>
  <div class="ed-busy hidden" id="edBusy"><div class="spinner"></div><span></span><div class="ed-progress hidden"><i></i></div></div>
  <div id="edMeasure" style="position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none"></div>`;
  bindShell(); renderPanel(); renderNotice(); applyPanelWidth();
}
// Panel derecho: ancho ajustable (se recuerda en este equipo)
const PANEL_MIN = 220, PANEL_MAX = 620;
function applyPanelWidth(w) {
  if (w == null) { try { w = Number(localStorage.getItem('pf.panelW')) || 0; } catch { w = 0; } }
  const wrap = document.querySelector('#edBody .ed-wrap'); if (!wrap) return;
  if (w) wrap.style.gridTemplateColumns = `minmax(0,1fr) ${clamp(w, PANEL_MIN, PANEL_MAX)}px`; else wrap.style.gridTemplateColumns = '';
}
function bindResizer() {
  const h = $('#edResizer'); if (!h) return;
  h.onmousedown = (e) => {
    e.preventDefault(); const wrapR = $('#edPanelWrap').getBoundingClientRect().right; document.body.classList.add('resizing');
    const mv = (ev) => { const w = clamp(Math.round(wrapR - ev.clientX), PANEL_MIN, PANEL_MAX); applyPanelWidth(w); h._w = w; };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); try { if (h._w) localStorage.setItem('pf.panelW', String(h._w)); } catch {} if (ed.pdf) renderPage(); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  h.ondblclick = () => { try { localStorage.removeItem('pf.panelW'); } catch {} applyPanelWidth(0); if (ed.pdf) renderPage(); };
}
// Pestañas del panel derecho: siempre se puede pasar de Edición a Asistente o a Plantilla y volver
function panelMode() { return ed.tpl?.mode === 'fill' ? 'fill' : ed.ai?.open ? 'ai' : ed.tpl?.mode === 'design' ? 'tpl' : 'edit'; }
function renderPanelTabs() {
  const host = $('#edPanelTabs'); if (!host) return; const m = panelMode();
  if (m === 'fill') { host.innerHTML = ''; host.classList.add('hidden'); return; }
  host.classList.remove('hidden');
  const key = m + (window.isMember?.() ? 'm' : '');
  if (host.dataset.k === key) return; host.dataset.k = key;
  host.innerHTML = [['edit', 'textEdit', 'Edición'], ['ai', 'sparkle', 'Asistente'], ['tpl', 'template', 'Plantilla']].map(([k, ic, l]) => `<button data-pt="${k}" class="${m === k ? 'on' : ''}">${icon(ic, 14)}<span>${l}</span>${k === 'ai' && !window.isMember?.() ? `<span class="lock-badge">${icon('lock', 10)}</span>` : ''}</button>`).join('');
  host.onclick = (e) => {
    const b = e.target.closest('[data-pt]'); if (!b) return; const k = b.dataset.pt;
    if (k === 'edit') { if (ed.ai?.open) window.Asistente.close(); else renderPanel(); }
    else if (k === 'ai') { if (!ed.ai?.open) window.members(() => window.Asistente.open(), 'El asistente legal con IA es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta para usarlo.'); }
    else if (k === 'tpl') { if (ed.ai?.open) { ed.ai.open = false; const p = $('#edPanel'); if (p) p.dataset.built = ''; } if (!ed.tpl) window.Plantillas.enterDesign(); else renderPanel(); const p = $('#edPanel'); if (p) p.scrollTop = 0; }
    host.dataset.k = '';
    renderPanelTabs();
  };
}
function renderNotice() { const n = $('#edNotice'); if (n) n.innerHTML = ed.notice ? `<div class="ed-banner"><span>${esc(ed.notice)}</span><button class="ibtn" id="edNoticeX">${icon('x', 14)}</button></div>` : ''; const x = $('#edNoticeX'); if (x) x.onclick = () => { ed.notice = null; renderNotice(); }; }

function bindShell() {
  $('#edOpen').onclick = () => openDialog(); $('#edSave').onclick = () => save();
  $('#edPrint').onclick = () => printDoc(); $('#edSearch').onclick = () => ($('#edFind').classList.contains('hidden') ? find() : closeFind());
  $('#edAdd').onclick = async () => { const r = await pf.edPick(true); if (r.ok) addFiles(r.data); };
  document.querySelectorAll('.ed-toolbar .tool').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $('#edOcr').onclick = ocrDialog; $('#edCmp').onclick = compress; $('#edNum').onclick = numberPages; $('#edWm').onclick = watermark; $('#edExp').onclick = () => exportDialog();
  $('#edUndo').onclick = undo;
  $('#edZoomIn').onclick = () => window.editor.zoom(1);
  $('#edZoomOut').onclick = () => window.editor.zoom(-1);
  $('#edZoomPct').onclick = () => window.editor.zoom(0);
  $('#edFull').onclick = () => reading(); $('#edReadExit').onclick = () => reading(false);
  $('#edSend').onclick = () => window.members(sendToSign);
  $('#edWa').onclick = () => window.studio.whatsapp();
  $('#edCase').onclick = () => { if (!ed.bytes) return toast('Abre un documento primero.'); window.Expedientes.saveCurrent(); };
  $('#edAi').onclick = () => (ed.ai?.open ? window.Asistente.close() : window.members(() => window.Asistente.open(), 'El asistente legal con IA es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta para usarlo.'));
  $('#edTpl').onclick = () => { if (ed.ai?.open) { ed.ai.open = false; const p = $('#edPanel'); if (p) p.dataset.built = ''; } if (!ed.tpl) window.Plantillas.enterDesign(); else { renderPanel(); const p = $('#edPanel'); if (p) p.scrollTop = 0; } };
  $('#edRotL').onclick = () => rotate(-90); $('#edRotR').onclick = () => rotate(90);
  $('#edIns').onclick = insertBlank; $('#edExt').onclick = extractToFile; $('#edSplit').onclick = splitDialog; $('#edFlat').onclick = flattenPages; $('#edDel').onclick = deletePages;
  $('#edPrev').onclick = () => goto(ed.current - 1); $('#edNext').onclick = () => goto(ed.current + 1);
  const pn = $('#edPageNum');
  pn.onkeydown = (e) => { if (e.key === 'Enter') { const n = parseInt(pn.value, 10); if (n >= 1 && n <= ed.count) goto(n - 1); pn.blur(); } if (e.key === 'Escape') { pn.value = ed.current + 1; pn.blur(); } };
  pn.onfocus = () => pn.select(); pn.onblur = () => { pn.value = ed.current + 1; };
  const fq = $('#edFindQ');
  fq.oninput = () => { clearTimeout(findTimer); findTimer = setTimeout(() => runFind(fq.value), 220); };
  fq.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); if (ed.find?.q !== fq.value) { clearTimeout(findTimer); runFind(fq.value); } else findStep(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { e.preventDefault(); closeFind(); } };
  $('#edFindNext').onclick = () => findStep(1); $('#edFindPrev').onclick = () => findStep(-1); $('#edFindX').onclick = closeFind;
  document.querySelectorAll('.side-tabs [data-side]').forEach((b) => (b.onclick = () => { ed.side = b.dataset.side; renderSide(); }));
  $('#edOutline').onclick = (e) => {
    const it = e.target.closest('[data-o]'); if (!it || e.target.closest('summary') && e.target.classList.contains('tw')) return;
    const o = outlineFlat[Number(it.dataset.o)]; if (!o) return;
    e.preventDefault();
    if (o.dest) gotoDest(o.dest); else if (o.url) openLink(o.url);
  };
  $('#edBanner').onclick = async (e) => { const b = e.target.closest('[data-ocr]'); if (!b) return; recognize(b.dataset.ocr === 'all' ? await scannedPages() : [ed.current]); };
  const th = $('#edThumbs'); let dragFrom = null;
  th.onclick = (e) => {
    const t = e.target.closest('.ed-thumb'); if (!t) return; const i = Number(t.dataset.i);
    if (e.metaKey || e.ctrlKey) { ed.selected.has(i) ? ed.selected.delete(i) : ed.selected.add(i); t.classList.toggle('sel'); }
    else if (e.shiftKey) { const a = Math.min(i, ed.current), b = Math.max(i, ed.current); for (let k = a; k <= b; k++) ed.selected.add(k); renderThumbs(); }
    else { ed.selected.clear(); document.querySelectorAll('.ed-thumb.sel').forEach((n) => n.classList.remove('sel')); goto(i); }
    updateToolbar();
  };
  th.addEventListener('dragstart', (e) => { const t = e.target.closest('.ed-thumb'); if (t) { dragFrom = Number(t.dataset.i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-pf-page', String(dragFrom)); } });
  th.addEventListener('dragover', (e) => { if (dragFrom == null) return; e.preventDefault(); e.stopPropagation(); const t = e.target.closest('.ed-thumb'); document.querySelectorAll('.ed-thumb.drop').forEach((n) => n.classList.remove('drop')); t?.classList.add('drop'); });
  th.addEventListener('drop', (e) => {
    if (dragFrom == null) return; e.preventDefault(); e.stopPropagation();
    const t = e.target.closest('.ed-thumb'); const to = t ? Number(t.dataset.i) + (e.offsetY > t.clientHeight / 2 ? 1 : 0) : ed.count;
    const from = dragFrom; dragFrom = null; movePage(from, to);
  });
  th.addEventListener('dragend', () => { dragFrom = null; document.querySelectorAll('.ed-thumb.drop').forEach((n) => n.classList.remove('drop')); });
  bindLayer(); bindResizer();
  setTool(ed.tool || 'select');
}
// Ir a una página (yPt: posición dentro de la página, en puntos).
function goto(i, yPt = 0) {
  if (!ed.pdf || i < 0 || i >= ed.count) return;
  if (ed.editing) stopEditing();
  const el = paper(i); const view = $('#edCanvasWrap');
  if (el && view) view.scrollTop = el.offsetTop - 52 + yPt * (ed.scales[i] || 1);
  ed.scrollFrac = el ? (yPt * (ed.scales[i] || 1)) / el.offsetHeight : 0;
  setCurrent(i);
}

// --- Marcadores (índice del PDF)
let outlineFlat = [];
async function renderSide() {
  const T = ed;
  document.querySelectorAll('.side-tabs [data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === T.side));
  $('.side-pages')?.classList.toggle('hidden', T.side !== 'pages');
  const host = $('#edOutline'); if (!host) return;
  host.classList.toggle('hidden', T.side !== 'outline');
  if (T.side !== 'outline') return;
  if (T.outline === undefined) { host.innerHTML = '<p class="muted small" style="padding:10px">Cargando…</p>'; try { T.outline = (await T.pdf.getOutline()) || []; } catch { T.outline = []; } if (ed !== T) return; }
  outlineFlat = [];
  const tree = (items, depth) => items.map((o) => {
    const n = outlineFlat.push(o) - 1;
    const label = `<a href="#" class="ol-item${o.bold ? ' b' : ''}${o.italic ? ' it' : ''}" data-o="${n}" title="${esc(o.title)}">${esc(o.title || '(sin título)')}</a>`;
    return o.items?.length ? `<details ${depth < 1 ? 'open' : ''}><summary>${label}</summary><div class="ol-kids">${tree(o.items, depth + 1)}</div></details>` : `<div class="ol-leaf">${label}</div>`;
  }).join('');
  host.innerHTML = T.outline.length ? `<div class="ol">${tree(T.outline, 0)}</div>` : `<div class="ol-empty">${icon('bookmark', 28)}<p>Este documento no tiene marcadores.</p><p class="muted small">Los PDF exportados desde Word con títulos suelen traer un índice aquí.</p></div>`;
}

function setTool(t) {
  if (ed.editing) stopEditing();
  ed.tool = t;
  if (!['select', 'edittext', 'hand'].includes(t) && (ed.sel || ed.multi.length)) { ed.sel = null; ed.multi = []; renderOverlays(); }
  document.querySelectorAll('.ed-toolbar .tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const stage = $('#edStage'); if (stage) stage.className = 'ed-stage mode-' + t;
  const layer = $('#edLayer'); if (!layer) { renderPanel(); return; }
  layer.querySelectorAll('.tb').forEach((n) => n.remove());
  if (t === 'edittext') showTextBlocks();
  renderPanel();
}
async function ocrDialog() {
  if (!ed.bytes) return;
  const sc = await scannedPages();
  modal(`<h2>Reconocer texto (OCR)</h2>
    <p>Convierte el texto de páginas escaneadas o fotocopias en texto real: se puede <strong>buscar</strong>, <strong>copiar</strong> y <strong>editar</strong> con «Editar texto». Funciona sin internet, en español.</p>
    <label class="radio"><input type="radio" name="ocrW" value="scanned" ${sc.length ? 'checked' : 'disabled'} /> <span>Páginas sin texto (${sc.length})</span></label>
    <label class="radio"><input type="radio" name="ocrW" value="current" ${sc.length ? '' : 'checked'} /> <span>Solo esta página (${ed.current + 1})</span></label>
    <label class="radio"><input type="radio" name="ocrW" value="all" /> <span>Todas las páginas (${ed.count})</span></label>
    <p class="muted small">Cada página toma unos segundos. La calidad depende de la nitidez del escaneo.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Reconocer</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => { const w = document.querySelector('input[name="ocrW"]:checked').value; closeModal(); recognize(w === 'scanned' ? sc : w === 'current' ? [ed.current] : [...Array(ed.count).keys()]); };
}

// --- Panel Formato
let savedRange = null;
document.addEventListener('selectionchange', () => { const s = getSelection(); if (s.rangeCount && s.anchorNode?.parentElement?.closest('.rt')) savedRange = s.getRangeAt(0).cloneRange(); });
function restoreRange() { if (!savedRange || !ed.editing) return; const el = document.querySelector(`.ov[data-id="${ed.editing}"] .rt`); if (!el || !el.contains(savedRange.startContainer)) return; el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
function currentFmt() {
  const o = ed.sel && findOv(ed.sel);
  if (!o || o.type !== 'rich') return { ...ed.fmt, target: null };
  const f = { family: o.family, size: o.size, color: o.color, align: o.align, lh: o.lh, bold: /^<b>/.test(o.html), italic: /^<i>/.test(o.html), underline: /^<u>/.test(o.html), target: o };
  if (ed.editing === o.id) {
    const s = getSelection(); const n = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode);
    if (n && n.closest?.('.rt')) {
      const cs = getComputedStyle(n);
      f.family = CSS2FAM[cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase()] || o.family;
      f.size = Math.round(parseFloat(cs.fontSize) * 10) / 10; const c = cssRgb(cs.color); f.color = hex(c.slice(0, 3));
      f.bold = document.queryCommandState('bold'); f.italic = document.queryCommandState('italic'); f.underline = document.queryCommandState('underline');
    }
  }
  return f;
}
function renderPanel(soft) {
  const host = $('#edPanel'); if (!host) return;
  renderPanelTabs();
  if (ed.tpl?.mode === 'fill') { // llenando una plantilla: el panel es el formulario (no se reconstruye mientras se escribe)
    if (host.dataset.built !== 'fill:' + ed.id) { host.dataset.built = 'fill:' + ed.id; window.Plantillas.fillPanel(host); }
    return;
  }
  if (ed.ai?.open && window.Asistente) { // asistente legal: se reconstruye solo cuando cambia su contenido
    const key = 'ai:' + ed.id + ':' + (ed.ai.v || 0);
    if (host.dataset.built !== key) { host.dataset.built = key; window.Asistente.panel(host); }
    return;
  }
  const f = currentFmt(); const o = f.target;
  if (soft && host.dataset.built === (o?.id || '-') + (ed.tpl?.mode === 'design' ? ':d' + ed.tpl.def.fields.length : '')) { // solo refresca estados, sin perder el foco del texto
    const typing = document.activeElement;
    if (typing !== $('#pfFam')) $('#pfFam').value = f.family;
    $('#pfPreview').style.fontFamily = `'${FAMILIES[f.family]?.css || 'PF Sans'}'`;
    if (typing !== $('#pfSize')) $('#pfSize').value = f.size;
    if (typing !== $('#pfColor')) $('#pfColor').value = f.color;
    ['bold', 'italic', 'underline'].forEach((k) => $(`#pf-${k}`).classList.toggle('on', !!f[k]));
    document.querySelectorAll('[data-align]').forEach((b) => b.classList.toggle('on', b.dataset.align === f.align));
    return;
  }
  host.dataset.built = (o?.id || '-') + (ed.tpl?.mode === 'design' ? ':d' + ed.tpl.def.fields.length : '');
  const sel = ed.sel && findOv(ed.sel);
  const tip = { select: 'Clic en un objeto para moverlo o cambiar su tamaño; doble clic sobre un texto para editarlo. Arrastra en un espacio vacío para seleccionar un área: entran los objetos y las imágenes que queden completos dentro.', hand: 'Arrastra un texto, imagen o campo para moverlo, o arrastra la página para desplazarte. Atajo: mantén la barra espaciadora.', edittext: 'Haz clic en un párrafo para editarlo. Se usa una fuente equivalente a la detectada y el color de la tinta y del fondo de la página.', text: 'Dibuja en la página el recuadro del texto y escribe. Un clic solo crea un recuadro de ancho normal.', image: 'Haz clic donde quieras poner la imagen.', whiteout: 'Arrastra un rectángulo sobre lo que quieras cubrir. Se usa el color del fondo.' }[ed.tool];
  host.innerHTML = `${ed.tpl?.mode === 'design' ? window.Plantillas.designSection() : ''}
    <div class="sec"><h4>Formato</h4>
      <div class="prow"><select id="pfFam" title="${Object.keys(FAMILIES).length} fuentes">${Object.entries(window.PF_FONT_CATS).map(([c, cl]) => `<optgroup label="${cl}">${Object.values(FAMILIES).filter((v) => v.cat === c).map((v) => `<option value="${v.key}" ${v.key === f.family ? 'selected' : ''}>${esc(v.label)}${v.real.length === 1 ? ' (solo normal)' : !v.real.includes('Italic') ? ' (sin cursiva)' : !v.real.includes('Bold') ? ' (sin negrita)' : ''}</option>`).join('')}</optgroup>`).join('')}</select></div>
      <div class="fam-preview" id="pfPreview" style="font-family:'${FAMILIES[f.family]?.css || 'PF Sans'}'">Señor Pérez · 123 <b>Negrita</b> <i>Cursiva</i></div>
      ${o?.detected ? `<div class="detected">Fuente detectada: ${esc(o.detected)}${o.source === 'ocr' ? ' (reconocida por OCR)' : ''}</div>` : ''}
      <div class="prow"><button class="fbtn fixed" id="pfSizeDown" title="Achicar (−0,5 pt)">${icon('zoomOut', 15)}</button><input type="number" id="pfSize" min="4" max="300" step="any" value="${f.size}" title="Tamaño en puntos: escribe el valor y presiona Enter" /><button class="fbtn fixed" id="pfSizeUp" title="Agrandar (+0,5 pt)">${icon('zoomIn', 15)}</button><input type="color" id="pfColor" value="${f.color}" class="fixed" title="Color" /></div>
      <div class="prow">${[['bold', '<b>N</b>', 'Negrita'], ['italic', '<i>K</i>', 'Cursiva'], ['underline', '<u>S</u>', 'Subrayado']].map(([k, l, t]) => `<button class="fbtn ${f[k] ? 'on' : ''}" id="pf-${k}" data-cmd="${k}" title="${t}">${l}</button>`).join('')}
        <button class="fbtn" data-cmd="superscript" title="Superíndice">x²</button><button class="fbtn" data-cmd="subscript" title="Subíndice">x₂</button></div>
      <div class="prow">${[['left', 'alignLeft', 'Izquierda'], ['center', 'alignCenter', 'Centrar'], ['right', 'alignRight', 'Derecha'], ['justify', 'alignJustify', 'Justificar']].map(([k, l, t]) => `<button class="fbtn ${f.align === k ? 'on' : ''}" data-align="${k}" title="${t}">${icon(l, 16)}</button>`).join('')}</div>
      <div class="prow"><span class="fixed muted">Interlineado</span><select id="pfLh">${[1, 1.15, 1.25, 1.5, 1.75, 2].map((v) => `<option value="${v}" ${Math.abs(v - f.lh) < 0.06 ? 'selected' : ''}>${v}</option>`).join('')}${[1, 1.15, 1.25, 1.5, 1.75, 2].some((v) => Math.abs(v - f.lh) < 0.06) ? '' : `<option selected value="${f.lh}">${f.lh}</option>`}</select></div>
      <p class="hint">${o ? (ed.editing === o.id ? 'Selecciona palabras para cambiar solo esas, o aplica al párrafo completo sin selección.' : 'Doble clic para editar el texto.') : 'Estos valores se usan para el próximo texto que agregues.'}</p>
      ${o?.cover && o.transparent ? '<p class="hint">El texto original se borró del PDF: no queda oculto debajo y el fondo de la página se mantiene.</p>' : o?.cover && o.source === 'pdf' ? '<p class="hint">Parte del texto original no se pudo borrar y queda tapado. Si debe desaparecer por completo, usa <strong>Aplanar</strong> en la barra de páginas.</p>' : ''}
    </div>
    <div class="sec"><h4>Agregar texto con formato</h4>
      <div class="tp-grid">${TEXT_PRESETS.map((t) => `<button class="tp" data-preset="${t.key}" title="Insertar: ${t.label}"><span class="tp-demo">${t.demo}</span><small>${t.label}</small></button>`).join('')}</div>
      <p class="hint">Se inserta en la página con un texto de ejemplo: empieza a escribir y se reemplaza.</p>
    </div>
    <div class="sec"><h4>Objetos</h4>
      ${sel ? `<button class="secondary pbtn" id="pfDel">Quitar objeto seleccionado</button>` : ed.multi.length > 1 ? `<button class="secondary pbtn" id="pfDel">Quitar los ${ed.multi.length} objetos seleccionados</button>` : ''}
      <p class="hint">${tip || ''}</p>
    </div>
    <div class="sec"><h4>Documentos escaneados</h4>
      <button class="primary pbtn with-ic" id="pfOcr">${icon('scanText', 17)}<span>Reconocer texto (OCR)…</span></button>
      <p class="hint">Para fotocopias y escaneos: el texto se vuelve buscable y editable, y la app imita el tono del papel al reescribir.</p>
    </div>`;
  host.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  host.querySelectorAll('[data-cmd]').forEach((b) => (b.onclick = () => applyFmt(b.dataset.cmd)));
  host.querySelectorAll('[data-align]').forEach((b) => (b.onclick = () => applyFmt('align', b.dataset.align)));
  $('#pfFam').onchange = (e) => { $('#pfPreview').style.fontFamily = `'${FAMILIES[e.target.value].css}'`; restoreRange(); applyFmt('family', e.target.value); };
  const setSize = (v) => { if (!(v > 0)) return; restoreRange(); applyFmt('size', clamp(Math.round(v * 10) / 10, 4, 300)); };
  $('#pfSize').onchange = (e) => setSize(Number(String(e.target.value).replace(',', '.')));
  $('#pfSize').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setSize(Number(String(e.target.value).replace(',', '.'))); } };
  $('#pfSizeDown').onclick = () => setSize((currentFmt().size || 11) - 0.5);
  $('#pfSizeUp').onclick = () => setSize((currentFmt().size || 11) + 0.5);
  $('#pfColor').oninput = (e) => { restoreRange(); applyFmt('color', e.target.value); };
  $('#pfLh').onchange = (e) => applyFmt('lh', Number(e.target.value));
  if ($('#pfDel')) $('#pfDel').onclick = () => removeOv(ed.sel || ed.multi);
  host.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => insertPreset(b.dataset.preset)));
  $('#pfOcr').onclick = ocrDialog;
  if (ed.tpl?.mode === 'design') window.Plantillas.bindDesign(host);
}

function updateToolbar() {
  if (!$('#edSize')) return;
  $('#edSize').textContent = ed.bytes ? `${ed.count} pág. · ${fmtMB(ed.bytes.length)}${ed.dirty ? ' · sin guardar' : ''}` : '';
  $('#edUndo').disabled = !ed.undo.length;
  $('#edSave').classList.toggle('dirty', !!ed.dirty);
  const n = ed.selected.size; $('#edDel').title = n > 1 ? `Eliminar ${n} páginas seleccionadas` : 'Eliminar páginas seleccionadas';
}
async function undo() {
  const s = ed.undo.pop(); if (!s) return;
  for (const l of Object.values(s.overlays)) for (const o of l) if (s.imgs[o.id]) o.bytes = s.imgs[o.id];
  ed.overlays = s.overlays; ed.ocr = s.ocr || {}; ed.sel = null; ed.editing = null;
  if (s.bytes !== ed.bytes) await setBytes(s.bytes); else { for (let i = 0; i < ed.count; i++) renderOverlaysFor(i); if (ed.tool === 'edittext') showTextBlocks(); }
  setDirty(true); renderPanel();
}
async function openDialog(multi = true) { const r = await pf.edPick(multi); if (r.ok && r.data.length) { window.studio?.goEditor(); return openEach(r.data); } return false; }
async function closeDoc() { return closeTab(ed); }

// API pública (app.js, inicio y menú)
window.editor = {
  refreshBusy: () => globalBusy(),
  docName: () => (ed.bytes ? ed.name : null),
  finalBytes: () => finalBytes(),
  open() { if (!ed.bytes) { renderShell(); renderTabs(); } else if (shownTab !== ed || !$('#edStage')) activate(); else renderTabs(); },
  openPaths(paths, replace) { window.studio?.goEditor(); return addFiles(paths, { replace: replace ?? !ed.bytes }); },
  openEach, openDialog, createBlank, save, saveAs, saveAll, exportDialog, sendToSign, planWizard, closeDoc, compress, ocrDialog, splitDialog,
  recognizeAll: async () => recognize([...Array(ed.count).keys()]),
  tool: (t) => setTool(t), undo, number: numberPages, watermark,
  rotate, move: movePage, del: deletePages,
  print: printDoc, find, findStep, runFind, reading, cycleTab, goto,
  switchTab: (k) => switchTab(tabs[k]), tabCount: () => tabs.length, refreshTabs: renderTabs,
  hasDoc: () => !!ed.bytes, isDirty: () => ed.dirty, anyDirty: () => tabs.some((t) => t.dirty),
  zoom: (k) => { if (!ed.pdf) return; ed.zoom = k === 0 ? 1 : clamp(ed.zoom * (k > 0 ? 1.25 : 0.8), 0.25, 8); renderPage(); },
  async exportBase64() { const b = await finalBytes(); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); },
  get _state() { return ed; }, _G: G, _mapFont: mapFont, _blocksFor: blocksFor, _editBlock: editBlock, _layout: layoutRich, _fontBytes: fontBytes,
};
bindTabs(); renderTabs();
pf.onFullScreen?.((on) => { if (!on && document.body.classList.contains('reading')) { document.body.classList.remove('reading'); setTimeout(() => ed.pdf && renderPage(), 300); } });
