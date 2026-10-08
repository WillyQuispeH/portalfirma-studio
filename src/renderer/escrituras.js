/* global pf, $, esc, toast, modal, closeModal, icon, show, pdfjsLib, PDFLib, fontkit */
'use strict';
(() => { // módulo aislado
// ============================================================================
// Trámites notariales (cliente final). Portalfirma es el puente entre el cliente y la notaría:
//   1 Trámite (escritura pública · protocolización · reducción a escritura pública)
//   2 Documento (minuta Word/PDF/texto, o PDF del documento privado)
//   3 Revisión: materia según la planilla de precios, actos adicionales, observaciones con corrección
//     de un clic, comparecientes (quién asiste a firmar y su contacto)
//   4 Vista previa: escritura formateada al estilo notarial o carátula de protocolización
//   5 Pago con el saldo de la cuenta (o recarga por la pasarela) → la operación se crea y la notaría
//     descarga los archivos. Repertorio, número, fecha y datos del notario los completa la notaría:
//     quedan marcados [ ] en los documentos.
// La lectura y la revisión ocurren en el computador, sin IA.
// ============================================================================
const N = window.Notarial; const MT = window.Materias;
const { PDFDocument, rgb, setCharacterSpacing, PDFOperator, PDFNumber } = PDFLib;
const TRAMITES = {
  escritura: { t: 'Escritura pública', d: 'Compraventas, promesas, mandatos, sociedades, rectificaciones… Subes la minuta; la revisamos, le damos formato notarial y la notaría coordina la firma presencial.', ic: 'notary', presencial: true },
  protocolizacion: { t: 'Protocolización', d: () => `Cualquier documento (firmado o no, incluso una fotocopia) se incorpora al registro público del notario y obtiene fecha cierta. Sin cita presencial. Tarifa fija de ${MT.clp(MT.TARIFAS.protocolizacion)}.`, ic: 'bookmark', presencial: false },
  reduccion: { t: 'Reducción a escritura pública', d: () => `Un documento privado ya firmado pasa a ser público: se transcribe íntegro en una escritura. Debes llevar el original firmado el día de la firma. Tarifa fija de ${MT.clp(MT.TARIFAS.reduccion)}.`, ic: 'fileOut', presencial: true },
};
const S = { sel: 'draft', vista: 'notaria', red: null, redCuerpo: null, tramite: null, paso: 'tramite', raw: '', name: '', orig: null, a: null, o: null, materia: null, sug: [], actos: [], contactos: {}, proto: { docs: [], info: null, d: null, text: '', manual: false }, preview: null, previewFor: '', hojasEsc: 0, saldo: null, op: null, ops: [] };
const SEV = { error: ['Error', '#c0362c'], warn: ['Revisar', '#b26a00'], info: ['Nota', '#3f4fe6'] };
const baseName = (n) => String(n || 'documento').replace(/\.[^.]+$/, '');
const dateToIso = (d) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
const isoToDate = (iso) => (iso ? new Date(iso + 'T12:00:00') : null);
const emailOk = (s) => /^\S+@\S+\.\S+$/.test(String(s || '').trim());
const telOk = (s) => String(s || '').replace(/\D/g, '').length >= 8;

// ---------------------------------------------------------------- PDF
const Tz = (p) => PDFOperator.of('Tz', [PDFNumber.of(p)]);
async function fonts(doc, fam) {
  const E = window.editor;
  const [r, b] = await Promise.all([E._fontBytes(fam, false, false), E._fontBytes(fam, true, false)]);
  return { r: await doc.embedFont(r.bytes), b: await doc.embedFont(b.bytes) };
}
function txt(page, s, x, y, font, size, track = 0, scale = 1, mark = false) {
  if (!s) return;
  if (mark) page.drawRectangle({ x: x - 1, y: y - size * 0.25, width: font.widthOfTextAtSize(s, size) * scale + track * s.length + 1, height: size * 1.1, color: rgb(1, 0.95, 0.55) });
  page.pushOperators(setCharacterSpacing(track), Tz(scale * 100));
  page.drawText(s, { x, y, size, font, color: rgb(0, 0, 0) });
  page.pushOperators(setCharacterSpacing(0), Tz(100));
}
const isMark = (w) => /\[|\]/.test(w);
async function escrituraPdf(blocks) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const F = await fonts(doc, 'sans');
  const L = N.LAYOUT; const k = L.narrow;
  const measure = (t, bold, size) => (bold ? F.b : F.r).widthOfTextAtSize(t, size) * k;
  const { pages, W } = N.layoutEscritura(blocks, measure);
  const H = N.OFICIO.h; let open = false; // dentro de una marca [ … ] que ocupa varias palabras
  const ink = rgb(0.1, 0.11, 0.14); const soft = rgb(0.55, 0.57, 0.62);
  pages.forEach((items, pi) => {
    const M = pi % 2 === 0 ? L.odd : L.even;
    const page = doc.addPage([N.OFICIO.w, H]);
    const yOf = (slot) => H - (L.top + slot * L.pitch);
    for (const ln of items) {
      const y = yOf(ln.slot);
      if (ln.k === 'blank') continue;
      if (ln.k === 'sep') { const w = 70; page.drawLine({ start: { x: M.left + (W - w) / 2, y: y + 4 }, end: { x: M.left + (W + w) / 2, y: y + 4 }, thickness: 0.6, color: soft }); continue; }
      if (ln.k === 'sigrow') {
        const colW = W / ln.cols;
        ln.cells.forEach((c, ci) => {
          const cx = ln.cols === 1 || ln.cells.length === 1 ? M.left + W / 2 : M.left + colW * ci + colW / 2; // la última firma sola va centrada
          const lineY = y - 1.9 * L.pitch; const half = Math.min(84, colW / 2 - 14);
          page.drawLine({ start: { x: cx - half, y: lineY }, end: { x: cx + half, y: lineY }, thickness: 0.5, color: ink });
          let ny = lineY - 14;
          c.name.forEach((nm) => { const w = F.b.widthOfTextAtSize(nm, L.sigSize) + 0.8 * nm.length; txt(page, nm, cx - w / 2, ny, F.b, L.sigSize, 0.8); ny -= 12; });
          (c.rol || []).forEach((r) => { const w = F.r.widthOfTextAtSize(r, L.sigSize - 1) + 0.2 * r.length; txt(page, r, cx - w / 2, ny, F.r, L.sigSize - 1, 0.2); ny -= 11; });
          if (c.ci) { const t = `C.I. N° ${c.ci}`; const w = F.r.widthOfTextAtSize(t, L.sigSize - 1) + 0.4 * t.length; txt(page, t, cx - w / 2, ny, F.r, L.sigSize - 1, 0.4); }
        });
        continue;
      }
      const font = ln.bold ? F.b : F.r; const size = ln.size; const tr = ln.track || 0; const scale = k;
      const ww = (s) => font.widthOfTextAtSize(s, size) * scale + tr * s.length;
      if (ln.text != null) {
        const w = ww(ln.text); let x = ln.align === 'center' ? M.left + (W - w) / 2 : M.left;
        ln.text.split(/(\[[^\]]*\])/).filter(Boolean).forEach((seg) => { txt(page, seg, x, y, font, size, tr, scale, seg.startsWith('[')); x += ww(seg); });
        continue;
      }
      const widths = ln.words.map(ww); const sum = widths.reduce((a, b) => a + b, 0);
      const space = font.widthOfTextAtSize(' ', size) * scale + tr;
      let gap = space; let x = M.left;
      if (ln.align === 'justify' && ln.words.length > 1) gap = (W - sum) / (ln.words.length - 1);
      else if (ln.align === 'center') x = M.left + (W - (sum + space * (ln.words.length - 1))) / 2;
      ln.words.forEach((w, j) => { const m = open || w.includes('['); if (w.includes('[')) open = true; if (w.includes(']')) open = false; txt(page, w, x, y, font, size, tr, scale, m); x += widths[j] + gap; });
    }
    const pn = String(pi + 1); txt(page, pn, M.left + (W - F.r.widthOfTextAtSize(pn, 9)) / 2, H - L.pageNumY, F.r, 9);
  });
  return { bytes: await doc.save(), pages: pages.length };
}
async function caratulaPdf(d, adjuntos = []) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const F = await fonts(doc, 'verdana'); const H = N.OFICIO.h; const page = doc.addPage([N.OFICIO.w, H]);
  const left = 110, W = N.OFICIO.w - 70 - left; let y = H - 150;
  const center = (s, f, sz, gap = 18) => { txt(page, s, left + (W - f.widthOfTextAtSize(s, sz)) / 2, y, f, sz, 0, 1, isMark(s)); y -= gap; };
  const wrapC = (s, f, sz) => { let cur = ''; const out = []; s.split(/\s+/).forEach((w) => { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, sz) > W - 20 && cur) { out.push(cur); cur = w; } else cur = t; }); if (cur) out.push(cur); out.forEach((l) => center(l, f, sz, 17)); };
  txt(page, 'REPERTORIO Nº ', left, y, F.b, 11); txt(page, '[_______]', left + F.b.widthOfTextAtSize('REPERTORIO Nº ', 11), y, F.b, 11, 0, 1, true); y -= 17;
  txt(page, 'PROTOCOLIZADO Nº ', left, y, F.b, 11); txt(page, '[_______]', left + F.b.widthOfTextAtSize('PROTOCOLIZADO Nº ', 11), y, F.b, 11, 0, 1, true); y -= 40;
  center('PROTOCOLIZACIÓN DE DOCUMENTOS', F.b, 11, 17); center('*'.repeat(40), F.r, 11, 20);
  wrapC((d.titulo || '').toUpperCase(), F.b, 11); y -= 6;
  if (d.partes?.[0]) { wrapC(d.partes[0].toUpperCase(), F.b, 11); if (d.partes[1]) { center('A', F.b, 11, 17); wrapC(`“${d.partes[1].toUpperCase()}”`, F.b, 11); } }
  center('*'.repeat(40), F.r, 11, 30);
  const words = []; String(d.texto || '').split(/(\*\*[^*]+\*\*)/).filter(Boolean).forEach((p) => { const b = p.startsWith('**'); (b ? p.slice(2, -2) : p).split(/(\s+)/).forEach((w) => { if (!w) return; if (/^\s+$/.test(w)) { if (words.length) words[words.length - 1].sp = true; } else if (words.length && !words[words.length - 1].sp) words[words.length - 1].parts.push({ w, b }); else words.push({ parts: [{ w, b }], sp: false }); }); });
  const size = 11; const sw = F.r.widthOfTextAtSize(' ', size);
  const wW = (w) => w.parts.reduce((a, p) => a + (p.b ? F.b : F.r).widthOfTextAtSize(p.w, size), 0);
  const lines = []; let cur = []; let cw = 0; let open = false;
  words.forEach((w) => { const x = wW(w); if (cur.length && cw + sw + x > W) { lines.push(cur); cur = [w]; cw = x; } else { cw += (cur.length ? sw : 0) + x; cur.push(w); } });
  if (cur.length) lines.push(cur);
  lines.forEach((ln, i) => {
    const sum = ln.reduce((a, w) => a + wW(w), 0); const gap = i < lines.length - 1 && ln.length > 1 ? (W - sum) / (ln.length - 1) : sw;
    let x = left; ln.forEach((w) => { w.parts.forEach((p) => { const f = p.b ? F.b : F.r; const m = open || p.w.includes('['); if (p.w.includes('[')) open = true; if (p.w.includes(']')) open = false; txt(page, p.w, x, y, f, size, 0, 1, m); x += f.widthOfTextAtSize(p.w, size); }); x += gap; });
    y -= 21;
  });
  for (const a of adjuntos) { const src = await PDFDocument.load(a.bytes, { ignoreEncryption: true }); (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p)); }
  return doc.save();
}
async function pdfText(bytes) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise; let out = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent(); let lastY = null;
    tc.items.forEach((it) => { const y = Math.round(it.transform[5]); if (lastY !== null && Math.abs(y - lastY) > 2) out += '\n'; else if (lastY !== null && it.str && !out.endsWith(' ')) out += ' '; out += it.str; lastY = y; });
    out += '\n\n';
  }
  return { text: out, pages: pdf.numPages };
}
async function renderPages(host, bytes, max = 40, scale = 1, append = false) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  if (!append) host.innerHTML = '';
  const dpr = window.devicePixelRatio || 1;
  for (let i = 1; i <= Math.min(pdf.numPages, max); i++) {
    const p = await pdf.getPage(i); const base = p.getViewport({ scale: 1 }); const fit = Math.min(1.1, (host.clientWidth - 40) / base.width || 1.1) * scale;
    const vp = p.getViewport({ scale: Math.max(0.4, fit) * dpr });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.className = 'es-page'; c.style.width = (vp.width / dpr) + 'px';
    host.appendChild(c); await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
}

// ---------------------------------------------------------------- navegación
const priv = () => S.tramite === 'protocolizacion' || S.tramite === 'reduccion'; // documentos privados: no los edita el cliente
const hasDoc = () => (priv() ? S.proto.docs.length > 0 : !!S.a);
function reset() { Object.assign(S, { descartados: new Set(), agregados: [], notaria: null, red: null, redCuerpo: null, vista: 'notaria', raw: '', name: '', orig: null, a: null, o: null, materia: null, sug: [], actos: [], contactos: {}, preview: null, previewFor: '', hojasEsc: 0, op: null, proto: { docs: [], info: null, d: null, text: '', manual: false } }); }

// ---- 1 trámite
// ---- 2 documento
const usoIA = (x) => (x.ia || []).reduce((a, r) => ({ modelo: r._uso?.modelo || a.modelo, tokens: a.tokens + (r._uso?.entrada || 0) + (r._uso?.salida || 0) }), { modelo: '', tokens: 0 });
const ORIGEN = (x) => { if (x.origen === 'Word') return 'Word · lectura exacta'; const u = usoIA(x); return `${x.origen === 'Imagen' ? 'imagen' : 'PDF'} · leído con IA${u.modelo ? ` (${u.modelo} · ${u.tokens.toLocaleString('es-CL')} tokens)` : ''}`; };
async function take(files) {
  if (priv()) { await addDocs(files); render(); return; }
  const f = files[0];
  try {
    const text = f.text;
    if (String(text || '').replace(/\s/g, '').length < 100) return toast('El documento Word está vacío o casi no tiene texto.', 5000);
    S.orig = { name: f.name, path: f.path, bytes: f.raw, pdf: f.pdf };
    S.o = null; setRaw(text, f.name, true); S.paso = 'rev'; S.sel = 'draft'; render();
  } catch (e) { toast('No se pudo leer: ' + (e.message || e)); }
}
function setRaw(raw, name, fresh) {
  S.raw = raw; if (name) S.name = name;
  const prev = S.o; S.a = N.analyze(raw); S.preview = null; S.hojasEsc = 0;
  const a = S.a;
  const auto = { titulo: a.title, partes: [(a.parties[0] || '').replace(/,(?=\s)/g, ''), (a.parties[1] || '').replace(/,(?=\s)/g, '')] };
  S.o = prev && !fresh ? { ...prev, ...(prev._tp ? {} : auto) } : { ...auto, convertir: true, cierre: true };
  if (fresh || !S.materia) {
    S.sug = MT.clasificar(a.title, a.body.join(' '), 'escritura');
    S.materia = S.sug[0]?.value || 'otro';
    S.descartados = new Set(); S.agregados = [];
  }
}

// ---- 3 revisión
// Materias ocultas: se revisa todo el texto cada vez (dependen de la materia elegida)
const textoDoc = () => (priv() ? S.proto.docs.map((x) => x.text).join(' ') : (S.a ? [S.a.title, ...S.a.body].join(' ') : ''));
const ocultos = () => MT.detectarActos(textoDoc(), S.materia, { tipo: S.tramite === 'escritura' ? 'escritura' : 'otro' });
const actosCobro = () => [...new Set([...ocultos().filter((x) => x.cobra && !(S.descartados || new Set()).has(x.value)).map((x) => x.value), ...(S.agregados || []).filter((x) => x.value && MT.BY[x.value] && x.value !== S.materia).map((x) => x.value)])];
// Actos que el cliente agregó porque el sistema no los detectó: se cobran (escrituras) y quedan como caso para aprender
function agregadosHtml() {
  const l = S.agregados || []; const esc0 = S.tramite === 'escritura';
  return `${l.map((x, i) => `<div class="es-hid-it add"><div class="es-hid-t"><b>${esc(x.nombre)}</b><span class="es-hid-cl">Agregado por ti</span><span class="es-hid-p">${esc0 && x.value && MT.BY[x.value] ? MT.clp(MT.precio(x.value).monto) : 'informado'}</span><button class="ghost small" data-quitar="${i}" title="Quitar">${icon('x', 13)}</button></div><q>${esc(x.frase)}</q></div>`).join('')}
    <button class="link es-hid-add" id="esAddActo">${icon('plus', 13)} Agregar un acto que no detectamos</button>`;
}
function agregarActo() {
  const opts = MT.CATALOGO.filter((x) => x.tipo === 'escritura' && x.value !== 'otro').sort((a, b) => a.label.localeCompare(b.label, 'es'));
  modal(`<h3>Agregar un acto que no detectamos</h3><p class="muted small">Si el escrito contiene otro acto (por ejemplo, además de la compraventa, un usufructo), indícalo con la frase donde aparece. ${S.tramite === 'escritura' ? 'Se suma al cobro según la planilla.' : 'Queda informado a la notaría; la tarifa es fija.'} Nos ayuda a detectarlo solos la próxima vez.</p>
    <label>Acto<select id="aaActo"><option value="">Elige el acto…</option>${opts.map((x) => `<option value="${x.value}">${esc(x.label)}</option>`).join('')}<option value="__otro">Otro (no está en la lista)</option></select></label>
    <label id="aaOtroL" class="hidden">Nombre del acto<input id="aaOtro" placeholder="Ej.: Comodato" /></label>
    <label>Frase del documento donde aparece<textarea id="aaFrase" class="es-ta sm" placeholder="Copia la frase tal como está en el escrito, p. ej.: «da en comodato a don…»"></textarea></label>
    <small class="muted" id="aaMsg"></small>
    <div class="row-end"><button class="ghost" id="aaNo">Cancelar</button><button class="primary" id="aaOk">Agregar</button></div>`);
  $('#aaActo').onchange = () => $('#aaOtroL').classList.toggle('hidden', $('#aaActo').value !== '__otro');
  $('#aaNo').onclick = closeModal;
  $('#aaOk').onclick = () => {
    const v = $('#aaActo').value; const frase = $('#aaFrase').value.replace(/\s+/g, ' ').trim(); const otro = $('#aaOtro').value.trim(); const msg = $('#aaMsg');
    if (!v || (v === '__otro' && !otro)) { msg.textContent = 'Elige el acto.'; return; }
    if (frase.length < 8) { msg.textContent = 'Copia la frase del documento donde aparece el acto.'; return; }
    if (!MT.fold(textoDoc()).replace(/\s+/g, ' ').includes(MT.fold(frase))) { msg.textContent = 'No encontramos esa frase en el documento. Cópiala tal como aparece.'; return; }
    const value = v === '__otro' ? null : v; const nombre = value ? MT.BY[value].label : otro;
    if ((S.agregados || []).some((x) => (x.value || x.nombre) === (value || nombre))) { msg.textContent = 'Ese acto ya está agregado.'; return; }
    S.agregados = [...(S.agregados || []), { value, nombre, frase }]; closeModal(); render(); toast('Acto agregado');
  };
}
function panelOcultos() {
  const list = ocultos(); const red = S.tramite === 'reduccion'; const proto = S.tramite === 'protocolizacion';
  const principales = list.filter((x) => x.principal);
  const decl = MT.BY[S.materia]?.label || 'la materia declarada';
  if (!list.length) return `<div class="es-hid ok"><span class="es-hid-ic">${icon('check', 15)}</span><div><b>Sin materias ocultas</b><small>Revisamos el texto completo buscando ${MT.actosRevisados()} tipos de actos (compraventas, hipotecas, prendas, poderes, cesiones, donaciones, alzamientos…). Solo encontramos «${esc(decl)}».</small>${agregadosHtml()}</div></div>`;
  return `<div class="es-hid">
    <div class="es-hid-h"><span class="es-hid-ic warn">${icon('search', 15)}</span><div><b>Materias ocultas en el texto</b><small>Revisamos el escrito completo: además de «${esc(decl)}», contiene ${list.length === 1 ? 'este acto' : 'estos actos'}. ${proto ? 'La protocolización tiene tarifa fija; quedan informados a la notaría.' : red ? 'Están incluidos en la tarifa fija de la reducción; quedan informados a la notaría.' : 'Cada acto se cobra aparte según la planilla.'}</small></div></div>
    ${principales.length && !proto ? `<div class="es-hid-alert">${icon('alert', 14)}<span>El escrito se presenta como <b>${esc(decl)}</b>, pero su contenido corresponde a <b>${principales.map((x) => esc(x.nombre)).join(' y ')}</b>.</span>${principales[0].value ? `<button class="ghost small" data-main="${principales[0].value}">Usar ${esc(principales[0].nombre)} como materia</button>` : ''}</div>` : ''}
    ${list.map((x) => { const on = !(S.descartados || new Set()).has(x.value); const p = x.cobra ? MT.precio(x.value).monto : null; return `<div class="es-hid-it ${on ? '' : 'off'}">
      <div class="es-hid-t"><b>${esc(x.nombre)}</b>${x.clausula ? `<span class="es-hid-cl">${x.clausula === 'comparecencia' ? 'Comparecencia' : 'Cláusula ' + esc(x.clausula.toLowerCase())}</span>` : ''}<span class="es-hid-p">${x.cobra ? (on ? MT.clp(p) : 'no se cobrará') : x.value ? 'incluido' : 'informativo'}</span>
      ${x.cobra ? `<label class="es-sw"><input type="checkbox" data-acto="${x.value}" ${on ? 'checked' : ''}/><span></span></label>` : ''}</div>
      <q>${esc(x.cita)}</q>${!on ? '<small class="es-hid-note">Lo desmarcaste: la notaría verá el aviso y podrá pedir un ajuste de tarifa si corresponde.</small>' : ''}</div>`; }).join('')}
    ${agregadosHtml()}
  </div>`;
}
function wireOcultos() {
  body().querySelectorAll('[data-acto]').forEach((c) => (c.onchange = () => { S.descartados = S.descartados || new Set(); if (c.checked) S.descartados.delete(c.dataset.acto); else S.descartados.add(c.dataset.acto); render(); }));
  body().querySelectorAll('[data-main]').forEach((b) => (b.onclick = () => { S.materia = b.dataset.main; toast('Materia principal actualizada'); render(); }));
  const ad = $('#esAddActo'); if (ad) ad.onclick = () => agregarActo();
  body().querySelectorAll('[data-quitar]').forEach((b) => (b.onclick = () => { S.agregados.splice(Number(b.dataset.quitar), 1); render(); }));
}
const tarifaTxt = (x) => { const t = MT.tarifaDe(x); return t.tipo === 'fija' ? MT.clp(t.monto) : t.tipo === 'hoja' ? `${MT.clp(t.base)} + ${MT.clp(t.porHoja)}/hoja` : 'por cotizar'; };
function materiaCard(tipo) {
  const m = MT.BY[S.materia]; const top = S.sug[0]; const auto = top && top.value === S.materia;
  const opts = MT.CATALOGO.filter((x) => x.tipo === tipo || x.value === 'otro');
  return `<div class="es-mat">
    <div class="es-mat-h"><span class="ic">${icon('sparkle', 18)}</span><div class="es-mat-t"><small class="muted">Materia ${S.tramite === 'reduccion' ? 'del instrumento' : 'identificada'}</small><b id="esMatLbl">${esc(m?.label || '—')}</b></div>
      ${S.tramite === 'escritura' && ocultos().some((x) => x.principal) ? '<span class="ops-chip" style="--c:#c0362c">El contenido no coincide</span>' : auto ? `<span class="ops-chip" style="--c:${top.confianza === 'alta' ? '#13804b' : top.confianza === 'media' ? '#b26a00' : '#c0362c'}">Coincidencia ${top.confianza}</span>` : '<span class="ops-chip" style="--c:#3f4fe6">Elegida por ti</span>'}
      <span class="es-mat-p">${S.tramite === 'reduccion' ? MT.clp(MT.TARIFAS.reduccion) + ' <small class="muted">tarifa fija</small>' : esc(m ? tarifaTxt(m) : '')}</span></div>
    ${auto && top.motivo ? `<p class="small es-mat-why">${icon('alert', 13)} ${esc(top.motivo)}</p>` : ''}
    <div class="es-mat-sel"><label>Cambiar materia<select id="esMat">${opts.map((x) => `<option value="${x.value}" ${x.value === S.materia ? 'selected' : ''}>${esc(x.label)} — ${tarifaTxt(x)}</option>`).join('')}</select></label>
    ${S.sug.length > 1 ? `<div class="es-sug small"><span class="muted">También podría ser:</span> ${S.sug.filter((x) => x.value !== S.materia).slice(0, 3).map((x) => `<button class="link" data-sug="${x.value}">${esc(x.label)}</button>`).join(' · ')}</div>` : ''}</div></div>`;
}
function wireMateria() {
  const sel = $('#esMat'); if (sel) sel.onchange = () => { S.materia = sel.value; render(); };
  body().querySelectorAll('[data-sug]').forEach((b) => (b.onclick = () => { S.materia = b.dataset.sug; render(); }));
}
function asistentes() {
  return (S.a?.comparecientes || []).map((c) => ({ ...c, asiste: !c.representadoPor, motivo: c.representadoPor ? `Representado por ${c.representadoPor}: firma su representante.` : c.representa ? `Firma por sí y en representación de ${c.representa}.` : 'Debe concurrir a firmar.' }));
}
function fixAll() {
  let raw = S.raw;
  for (let k = 0; k < 4; k++) { const fx = N.analyze(raw).alerts.filter((x) => x.fix && x.fix.type !== 'cierre'); if (!fx.length) break; fx.forEach((x) => { raw = N.applyFix(raw, x.fix); }); }
  setRaw(raw); render(); toast('Correcciones aplicadas');
}

// ---- documentos privados (protocolización y reducción): revisión de solo lectura
const totalHojas = () => S.proto.docs.reduce((s, x) => s + x.pages, 0);
function caratulaAuto() { const d = S.proto.d; return N.caratulaTexto({ ...d, requirente: '', fecha: null, fechaFirma: isoToDate(d.fechaFirma), documentos: S.proto.docs, hojas: totalHojas() }, notariaDatos()); }
function paintCar() { const P = S.proto; P.text = caratulaAuto(); const h = $('#prTxt'); if (h) h.innerHTML = esc(P.text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(\[[^\]]+\])/g, '<span class="es-mk">$1</span>'); }
// Lectura: Word (exacta) o, si no hay Word, PDF/foto/escaneo leído con IA (incluido en el valor del trámite)
async function imageToPdf(bytes, mime) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
  const jpg = new Uint8Array(await (await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9))).arrayBuffer());
  const doc = await PDFDocument.create(); const img = await doc.embedJpg(jpg);
  const w = 612; const h = Math.round((612 * bmp.height) / bmp.width); const page = doc.addPage([w, h]); page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  return doc.save();
}
async function pageJpeg(page) {
  const vp0 = page.getViewport({ scale: 1 }); const scale = Math.min(2, 1600 / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  const b = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8)); const u8 = new Uint8Array(await b.arrayBuffer());
  let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { mime: 'image/jpeg', data: btoa(bin) };
}
async function ingest(f, busy) {
  if (f.kind === 'word') { const pdf = await pdfjsLib.getDocument({ data: f.bytes.slice(0) }).promise; return { name: f.name, bytes: f.bytes, raw: f.raw, pages: pdf.numPages, text: f.text, origen: 'Word' }; }
  const origen = f.kind === 'image' ? 'Imagen' : 'PDF';
  const bytes = f.kind === 'image' ? await imageToPdf(f.bytes, f.mime) : f.bytes;
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise; const n = pdf.numPages; const ia = []; const LOTE = 3;
  for (let d = 1; d <= n; d += LOTE) {
    busy(`Leyendo «${f.name}» con IA: hojas ${d} a ${Math.min(n, d + LOTE - 1)} de ${n}…`);
    const imgs = []; for (let i = d; i <= Math.min(n, d + LOTE - 1); i++) imgs.push(await pageJpeg(await pdf.getPage(i)));
    const r = await pf.aiLeerDoc({ imagenes: imgs, desde: d, total: n }); if (!r.ok) throw new Error(r.error);
    ia.push(r.data || {});
  }
  return { name: f.name, bytes, pages: n, text: ia.map((x) => x.texto || '').join('\n\n'), origen, ia };
}
// Antes de usar IA se avisa: el documento sale del computador para leerse
function confirmarIA(files) {
  const noWord = files.filter((f) => f.kind !== 'word'); if (!noWord.length) return Promise.resolve(true);
  return new Promise((res) => {
    modal(`<h3>Este archivo no es Word</h3><p>${noWord.map((f) => `«${esc(f.name)}»`).join(', ')} ${noWord.length === 1 ? 'está' : 'están'} en PDF o imagen. Para no cometer errores lo leeremos con <b>IA</b>: está incluido en el valor del trámite.</p>
      <p class="muted small">Las hojas se envían de forma segura al servicio de IA solo para leerlas. Si tienes el documento en Word, súbelo en su lugar: la lectura es exacta e inmediata.</p>
      <div class="row-end"><button class="ghost" id="iaNo">Subir el Word</button><button class="primary" id="iaSi">Leer con IA</button></div>`);
    $('#iaNo').onclick = () => { closeModal(); res(false); }; $('#iaSi').onclick = () => { closeModal(); res(true); };
  });
}
async function addDocs(files) {
  if (!(await confirmarIA(files))) return;
  const P = S.proto; const box = $('#esBusy');
  const busy = (msg) => { if (box) { box.classList.remove('hidden'); box.innerHTML = `<span class="es-spin"></span>${esc(msg)}`; } };
  for (const f of files) {
    try { busy(`Leyendo «${f.name}»…`); P.docs.push(await ingest(f, busy)); } catch (e) { toast(`No se pudo leer «${f.name}»: ${e.message || e}`); }
  }
  if (box) box.classList.add('hidden');
  if (P.docs.length) { S.red = null; S.redCuerpo = null; analyzeDocs(); S.paso = 'rev'; S.sel = 'draft'; }
}
function analyzeDocs() {
  const P = S.proto; const first = P.docs[0];
  const all = P.docs.map((x) => x.text).join('\n\n');
  const info = N.analizarPrivado(all, { pages: totalHojas(), name: first.name });
  // lo que leyó la IA (PDF o imagen) manda sobre lo deducido del texto
  const ias = P.docs.flatMap((x) => x.ia || []);
  if (ias.length) {
    info.ia = true;
    const tit = ias.find((x) => x.titulo)?.titulo; if (tit) info.titulo = String(tit).toUpperCase();
    const fe = ias.find((x) => x.fecha)?.fecha; if (fe && /^\d{4}-\d{2}-\d{2}$/.test(fe)) info.fechaDocumento = new Date(fe + 'T12:00:00');
    const pa = ias.find((x) => x.patente)?.patente; if (pa) info.patente = String(pa).toUpperCase();
    info.participantes = [...ias.flatMap((x) => x.participantes || []).filter((p) => p?.nombre).map((p) => ({ nombre: String(p.nombre).toUpperCase(), rut: p.rut || '', rol: p.rol || '' })).filter((p, i, a) => a.findIndex((q) => N.fold(q.nombre) === N.fold(p.nombre)) === i), ...info.participantes.filter((p) => !ias.some((x) => (x.participantes || []).some((q) => q?.nombre && (N.fold(q.nombre).includes(N.fold(p.nombre)) || N.fold(p.nombre).includes(N.fold(q.nombre))))))];
    const fs = ias.flatMap((x) => x.firmas || []);
    fs.filter((f) => f.tipo === 'electronica' && f.nombre).forEach((f) => { if (!info.firmas.electronicas.some((e) => N.fold(e.nombre) === N.fold(f.nombre))) info.firmas.electronicas.push({ nombre: String(f.nombre).toUpperCase(), fecha: f.fecha ? new Date(f.fecha + 'T12:00:00') : null }); });
    fs.filter((f) => f.tipo !== 'electronica').forEach((f) => { const nm = f.nombre ? String(f.nombre).toUpperCase() : `Firma ${f.tipo === 'timbre' ? 'con timbre' : 'manuscrita'} (sin nombre legible)`; if (!info.firmas.lineas.includes(nm)) info.firmas.lineas.push(nm); });
    info.firmas.hay = !!(info.firmas.electronicas.length || info.firmas.lineas.length || info.firmas.otras);
    const ileg = ias.flatMap((x) => x.ilegible || []).filter(Boolean);
    if (ileg.length) info.alertas.push({ sev: 'warn', text: `La IA no pudo leer algunas partes: ${ileg.slice(0, 3).join(' · ')}${ileg.length > 3 ? '…' : ''}. La notaría revisará el original.` });
    info.alertas = info.alertas.filter((a) => !/campos vacíos/.test(a.text) || /undefined|null|NaN/.test(all));
  }
  if (S.tramite === 'protocolizacion' && !info.firmas.hay) info.alertas.push({ sev: 'info', text: 'El documento no muestra firmas en el texto. Se puede protocolizar igual: la protocolización le da fecha cierta y lo incorpora al registro público.' });
  P.info = info; const prev = P.d || {};
  const titulo = info.titulo + (info.ley && !/ley/i.test(info.titulo) ? ` LEY Nº ${info.ley}` : '');
  const cap = (t) => (t.charAt(0) + t.slice(1).toLowerCase()).replace(/\bley n[º°]\s*/g, 'Ley Nº ');
  const desc = P.docs.length > 1 ? `${cap(titulo)} (${P.docs.length} archivos)` : cap(titulo);
  P.d = {
    email: prev.email || '', tel: prev.tel || '', nota: prev.nota || '', declara: !!prev.declara,
    titulo, partes: info.partes, requirente: '', descripcion: desc,
    firmante: info.firmas.electronicas.map((f) => f.nombre).join(', ').replace(/, ([^,]*)$/, ' y $1'),
    fechaFirma: info.firmas.electronicas[0]?.fecha ? dateToIso(info.firmas.electronicas[0].fecha) : '', patente: info.patente, calidad: '',
  };
  S.sug = MT.clasificar(info.titulo, all, S.tramite === 'protocolizacion' ? 'protocolizacion' : 'escritura');
  S.materia = S.sug[0]?.value || (S.tramite === 'protocolizacion' ? 'protocolizacion_privado' : 'otro'); S.descartados = new Set(); S.agregados = [];
}

// ---- 4 vista previa
// Notaría elegida → datos para la comparecencia, el membrete y la carátula (repertorio y fecha los pone la notaría)
function notariaDatos() { const n = S.notaria; if (!n || n.auto) return null; return { nombre: n.notario, suplente: !n.titular, titular: n.titularDe || '', numero: n.numero, ordinal: n.ordinal, ciudad: n.ciudad, direccion: n.direccion }; }
function redBase() { if (!S.red) S.red = N.reduccionTexto(S.proto.info, S.proto.docs.map((x) => x.text).join('\n\n')); return S.red; }
function reduccionBlocks() { return N.reduccionBlocks(S.proto.info, '', { red: redBase(), cuerpo: S.redCuerpo, notaria: notariaDatos() }); }
function blocks() {
  const o = S.o; const a = { ...S.a, title: o.titulo, parties: o.partes };
  return N.buildEscritura(a, { notaria: notariaDatos(), fecha: null, cierre: o.cierre, convertir: o.convertir });
}
async function previewBytes() {
  const key = (priv() ? JSON.stringify([S.tramite, S.proto.d?.titulo, S.proto.text, S.proto.docs.length, S.redCuerpo]) : JSON.stringify([S.raw, S.o])) + (S.notaria ? S.notaria.id || 'auto' : '');
  if (!S.preview || S.previewFor !== key) {
    if (S.tramite === 'protocolizacion') S.preview = await caratulaPdf({ ...S.proto.d, requirente: '', texto: S.proto.text }, S.proto.docs);
    else if (S.tramite === 'reduccion') { const r = await escrituraPdf(reduccionBlocks()); S.preview = r.bytes; S.hojasEsc = r.pages; }
    else { const r = await escrituraPdf(blocks()); S.preview = r.bytes; S.hojasEsc = r.pages; }
    S.previewFor = key;
  }
  return S.preview;
}
function guard(fn) { return fn().catch((e) => toast('No se pudo: ' + (e.message || e))); }

// ---- 5 pago
function cotizacion() {
  const hojas = priv() ? totalHojas() : (S.hojasEsc || 1);
  return MT.cotizar({ tramite: S.tramite, materia: S.materia, actos: S.tramite === 'escritura' ? actosCobro().map((v) => MT.BY[v]).filter(Boolean) : [], hojas });
}
function faltantes() {
  const out = [];
  if (!S.notaria) out.push('elegir la notaría');
  if (priv()) {
    const d = S.proto.d; if (!emailOk(d.email)) out.push('tu correo de contacto');
    if (S.tramite === 'reduccion') { if (!telOk(d.tel)) out.push('tu teléfono'); if (!d.declara) out.push('declarar que el documento está firmado y que llevarás el original'); }
    return out;
  }
  const sin = asistentes().filter((c) => c.asiste).filter((c) => { const ct = S.contactos[c.nombre] || {}; return !emailOk(ct.email) || !telOk(ct.tel); });
  if (sin.length) out.push(sin.length === 1 ? `correo y teléfono de ${sin[0].nombre}` : `correo y teléfono de ${sin.length} comparecientes`);
  return out;
}
async function archivos() {
  const files = [];
  if (S.tramite === 'protocolizacion') {
    const car = { ...S.proto.d, requirente: '', texto: S.proto.text };
    files.push({ kind: 'caratula_pdf', name: 'Carátula.pdf', bytes: await caratulaPdf(car) });
    files.push({ kind: 'para_notaria', name: 'Carátula y documentos.pdf', bytes: await previewBytes() });
    const dx = await pf.escrDocxBytes('caratula', car, notariaDatos()); if (dx.ok) files.push({ kind: 'caratula_docx', name: 'Carátula.docx', bytes: dx.data });
    S.proto.docs.forEach((x) => { files.push({ kind: 'documento', name: x.name.replace(/\.[^.]+$/, '') + '.pdf', bytes: x.bytes }); if (x.raw) files.push({ kind: 'documento_word', name: x.name, bytes: x.raw }); });
  } else if (S.tramite === 'reduccion') {
    S.proto.docs.forEach((x) => { files.push({ kind: 'documento', name: x.name.replace(/\.[^.]+$/, '') + '.pdf', bytes: x.bytes }); if (x.raw) files.push({ kind: 'documento_word', name: x.name, bytes: x.raw }); });
    files.push({ kind: 'reduccion_pdf', name: 'Escritura de reducción.pdf', bytes: await previewBytes() });
    const dx = await pf.escrDocxBytes('escritura', reduccionBlocks(), notariaDatos()); if (dx.ok) files.push({ kind: 'reduccion_docx', name: 'Escritura de reducción.docx', bytes: dx.data });
  } else {
    if (S.orig?.bytes) files.push({ kind: 'original', name: S.orig.name, bytes: S.orig.bytes });
    if (S.tramite === 'escritura') {
      files.push({ kind: 'escritura_pdf', name: 'Escritura formateada.pdf', bytes: await previewBytes() });
      const dx = await pf.escrDocxBytes('escritura', blocks(), notariaDatos()); if (dx.ok) files.push({ kind: 'escritura_docx', name: 'Escritura formateada.docx', bytes: dx.data });
    }
  }
  return files;
}
function ficha(q) {
  const proto = priv(); const top = S.sug[0];
  return {
    tramite: S.tramite, materia: S.materia, materiaLabel: MT.BY[S.materia]?.label, materiaAutomatica: top?.value === S.materia, confianza: top?.value === S.materia ? top.confianza : 'elegida por el cliente',
    actos: S.tramite === 'escritura' ? actosCobro() : [], materiasOcultas: ocultos().map((x) => ({ codigo: x.value, nombre: x.nombre, clausula: x.clausula, cita: x.cita, principal: x.principal, cobrado: S.tramite === 'escritura' && x.cobra && !(S.descartados || new Set()).has(x.value), descartadoPorCliente: (S.descartados || new Set()).has(x.value) })), hojas: proto ? totalHojas() : S.hojasEsc, cobro: q.lineas, total: q.total, totalTexto: MT.clp(q.total), cotizacion: q.cotizacion,
    actosAgregadosPorCliente: (S.agregados || []).map((x) => ({ codigo: x.value, nombre: x.nombre, frase: x.frase, cobrado: S.tramite === 'escritura' && !!x.value && actosCobro().includes(x.value) })),
    titulo: proto ? S.proto.d.titulo : S.o.titulo, partes: proto ? S.proto.d.partes : S.o.partes,
    comparecientes: proto ? [] : asistentes().map((c) => ({ nombre: c.nombre, rut: c.rut ? N.fmtRut(c.rut, c.dv) : null, rutValido: c.rutOk, estadoCivil: c.estadoCivil, profesion: c.profesion, domicilio: c.domicilio, calidad: c.calidad, representa: c.representa || null, representadoPor: c.representadoPor || null, asiste: c.asiste, ...(S.contactos[c.nombre] || {}) })),
    documentoPrivado: proto ? { titulo: S.proto.info.titulo, descripcion: S.proto.d.descripcion, hojas: totalHojas(), archivos: S.proto.docs.map((x) => ({ nombre: x.name, hojas: x.pages, lectura: ORIGEN(x), ...(x.ia ? { ia: usoIA(x) } : {}) })), leidoConIA: !!S.proto.info.ia, participantes: S.proto.info.participantes, firmasElectronicas: S.proto.info.firmas.electronicas.map((f) => ({ nombre: f.nombre, fecha: dateToIso(f.fecha) })), lineasDeFirma: S.proto.info.firmas.lineas, fechaDocumento: dateToIso(S.proto.info.fechaDocumento), patente: S.proto.info.patente, requirente: null, declaracionOriginalFirmado: S.tramite === 'reduccion' ? !!S.proto.d.declara : undefined } : null,
    contacto: proto ? { email: S.proto.d.email, telefono: S.proto.d.tel, nota: S.proto.d.nota } : null,
    observaciones: (proto ? S.proto.info.alertas : S.a.alerts).filter((x) => x.sev !== 'info').map((x) => ({ nivel: x.sev, texto: x.text })),
    notaria: S.notaria ? (S.notaria.auto ? { asignacion: 'automatica' } : { id: S.notaria.id, nombre: S.notaria.nombre, notario: S.notaria.notario, comuna: S.notaria.comuna, direccion: S.notaria.dirCorta || S.notaria.direccion, prueba: !!S.notaria.prueba }) : null,
    origen: 'PortalFirma Studio',
  };
}
// Caso para el aprendizaje de reglas: solo si el cliente corrigió algo de la detección automática
function registrarCaso() {
  const top = S.sug[0]; const desc = ocultos().filter((x) => (S.descartados || new Set()).has(x.value));
  const cambio = !!top && top.value !== S.materia;
  if (!cambio && !desc.length && !(S.agregados || []).length) return;
  const texto = textoDoc(); let h = 0; for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) | 0;
  pf.reglasCaso({ clave: `${S.tramite}:${h}`, tramite: S.tramite, titulo: docTitulo(), materiaAuto: top?.value || null, materiaFinal: S.materia, confianza: top?.confianza || null,
    descartados: desc.map((x) => ({ codigo: x.value, nombre: x.nombre, cita: x.cita })), agregados: (S.agregados || []).map((x) => ({ codigo: x.value, nombre: x.nombre, frase: x.frase })), texto }).catch(() => {});
}
async function iniciar(q) {
  const btn = $('#esPay') || $('#esPrim'); if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    registrarCaso();
    const files = await archivos(); const payload = ficha(q);
    files.push({ kind: 'ficha', name: 'Ficha del trámite.json', bytes: new TextEncoder().encode(JSON.stringify(payload, null, 2)) });
    const r = await pf.notIniciar(payload, files);
    if (!r.ok) {
      if (r.code === 'PENDIENTE_API') { render(); modal(`<h3>Aún no disponible</h3><p>${esc(r.error)}</p><p class="muted small">No se cobró nada.${priv() ? '' : ' Puedes descargar el Word o el PDF desde la vista previa.'}</p><div class="row-end"><button class="primary" id="mOkP">Entendido</button></div>`); $('#mOkP').onclick = closeModal; return; }
      if (r.code === 'SALDO') { S.saldo = null; toast('Tu saldo no alcanza. Recarga y vuelve a intentarlo.'); }
      else if (r.code === 'NEEDS_LOGIN') window.ApiDiag.login(() => window.Escrituras.open(), 'Tu sesión expiró. Inicia sesión para pagar.');
      else toast('No se pudo iniciar el trámite: ' + r.error, 5000);
      render(); return;
    }
    S.op = r.data; S.saldo = null; const l = await pf.notList(); S.ops = l.ok ? l.data : []; reset(); S.tramite = null; S.paso = 'tramite'; S.sel = r.data.operation; render(); toast(r.data.status === 'cotizacion' ? 'Cotización solicitada' : 'Trámite pagado y enviado a la notaría');
  } catch (e) { toast('No se pudo: ' + (e.message || e)); render(); }
}
// ---------------------------------------------------------------- vista (lista + detalle, como «Mis operaciones»)
const body = () => $('#esBody');
const ini = (n) => { const w = String(n || '').replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ ]/g, ' ').trim().split(/\s+/).filter((x) => x.length > 2); if (!w.length) return '·'; const last = w.length >= 4 ? w[w.length - 2] : w[w.length - 1]; return (w[0][0] + (w.length > 1 ? last[0] : '')).toUpperCase(); }; // nombre + primer apellido
const ESTADO_C = { cotizacion: '#b26a00', pagado: '#3f4fe6', aceptado: '#3f4fe6', pausado_ajuste_tarifa: '#c0362c', citado: '#0d9488', firmado: '#13804b', cerrado: '#13804b' };
async function open(tramite) {
  if (tramite && TRAMITES[tramite]) { reset(); S.tramite = tramite; S.paso = 'doc'; S.sel = 'draft'; }
  if (!S._tar) { S._tar = true; const t = await pf.notTarifas(); if (t.ok && t.data) MT.setTarifas(t.data); await cargarReglas(); const pr = await pf.prefs?.(); S.mock = !!(pr?.ok && pr.data?.mock); const rr = await pf.notRed(); S.redNot = rr.ok ? rr.data || [] : []; }
  show('escrituras'); render();
  const r = await pf.notList(); S.ops = r.ok ? r.data : []; render();
}
async function cargarReglas() { const g = await pf.reglasGet(); if (g.ok && g.data) MT.setReglas(g.data); }
// El panel de reglas es interno de Portalfirma: administradores (o modo de prueba)
const esAdmin = () => window.Usuario?._u?.user?.role === 'admin' || !!S.mock;
function go(p) { S.paso = p; S.sel = 'draft'; render(); }
function nuevo() {
  const go0 = () => { reset(); S.tramite = null; S.paso = 'tramite'; S.sel = 'draft'; render(); };
  if (!(S.tramite && hasDoc())) return go0();
  modal(`<h3>¿Descartar el trámite en preparación?</h3><p class="muted small">«${esc(docTitulo())}» todavía no se ha enviado a la notaría.</p><div class="row-end"><button class="ghost" id="nNo">Seguir con él</button><button class="primary" id="nSi">Descartar y empezar otro</button></div>`);
  $('#nNo').onclick = closeModal; $('#nSi').onclick = () => { closeModal(); go0(); };
}
function docTitulo() { return priv() ? (S.proto.info?.titulo || 'Documento') : (S.o?.titulo || S.name || 'Minuta'); }
function render() {
  const host = $('#view-escrituras'); const q = (S.q || '').toLowerCase();
  const draft = !!S.tramite || S.sel === 'draft';
  const ops = S.ops.filter((o) => !q || `${o.titulo} ${o.materia} ${o.operation}`.toLowerCase().includes(q));
  host.innerHTML = `<div class="bulk es">
    <div class="ops-head"><div><h2>Gestión de firmas presenciales</h2><span class="muted small">${S.ops.length} ${S.ops.length === 1 ? 'trámite' : 'trámites'} · escrituras públicas, protocolizaciones y reducciones</span></div>
      <div class="ops-head-r"><button class="primary small with-ic" id="esNuevo">${icon('plus', 15)}<span>Nuevo trámite</span></button></div></div>
    <div class="es-layout">
      <aside class="es-list"><div class="ops-search">${icon('search', 14)}<input id="esQ" placeholder="Buscar trámite o número…" value="${esc(S.q || '')}" /></div>
        <div class="es-items">
        ${draft ? `<button class="es-item ${S.sel === 'draft' ? 'on' : ''}" data-sel="draft"><span class="es-item-ic draft">${icon(TRAMITES[S.tramite]?.ic || 'plus', 16)}</span><span class="xp-tx"><b>${esc(S.tramite && hasDoc() ? docTitulo() : 'Nuevo trámite')}</b><small>${S.tramite ? esc(TRAMITES[S.tramite].t) : 'Elige el tipo de trámite'}</small></span><span class="ops-chip" style="--c:#64748b">${hasDoc() ? 'En revisión' : 'Borrador'}</span></button>` : ''}
        ${ops.map((o) => `<button class="es-item ${S.sel === o.operation ? 'on' : ''}" data-sel="${esc(o.operation)}"><span class="es-item-ic">${icon(TRAMITES[o.tramite]?.ic || 'notary', 16)}</span><span class="xp-tx"><b>${esc(o.titulo || o.materia)}</b><small>Nº ${esc(o.operation)} · ${new Date(o.creado).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</small></span><span class="ops-chip" style="--c:${ESTADO_C[o.status] || '#64748b'}">${esc(o.status === 'cotizacion' ? 'Cotización' : o.status === 'pagado' ? 'Pagado' : o.estado)}</span></button>`).join('')}
        ${!draft && !ops.length ? '<div class="ops-empty small"><p>Todavía no tienes trámites.</p></div>' : ''}</div>
        ${esAdmin() ? `<button class="es-item es-admin ${S.sel === 'reglas' ? 'on' : ''}" data-sel="reglas"><span class="es-item-ic">${icon('sparkle', 16)}</span><span class="xp-tx"><b>Reglas de detección</b><small>Interno Portalfirma · aprender de los casos</small></span></button>` : ''}</aside>
      <section class="es-detail" id="esBody"></section></div></div>`;
  $('#esNuevo').onclick = () => nuevo();
  $('#esQ').oninput = (e) => { S.q = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#esQ'); i.focus(); i.setSelectionRange(pos, pos); };
  host.querySelectorAll('[data-sel]').forEach((b) => (b.onclick = () => { S.sel = b.dataset.sel; render(); }));
  if (S.sel === 'reglas' && esAdmin()) return window.ReglasPanel.abrir(body(), { recargar: cargarReglas });
  if (S.sel && S.sel !== 'draft') { const o = S.ops.find((x) => x.operation === S.sel); if (o) return detalleOp(o); }
  if (!S.tramite || S.paso === 'tramite') return pTramite();
  if (!hasDoc() || S.paso === 'doc') return pDoc();
  return pTrabajo();
}
// seguimiento: recibido → revisión → pago → notaría → firma / protocolizado
function tracker(cur, tramite, fin) {
  const st = ['Recibido', 'Revisión', 'Notaría', 'Pago', 'En notaría', tramite === 'protocolizacion' ? 'Protocolizado' : 'Firma en notaría'];
  return `<div class="es-track">${st.map((t, i) => `<div class="es-tk ${i < cur ? 'ok' : i === cur ? 'on' : ''}"><span class="es-tk-d">${i < cur ? icon('check', 13) : i + 1}</span><b>${t}</b><small>${i < cur ? 'Listo' : i === cur ? (fin || 'Ahora') : ''}</small></div>`).join('<span class="es-tk-l"></span>')}</div>`;
}
// ---- elegir trámite y subir documento (dentro del panel de detalle)
function pTramite() {
  body().innerHTML = `<div class="es-dh"><div><h3>¿Qué trámite necesitas?</h3><div class="muted small">Revisamos tu documento, identificamos la materia y su valor, y lo enviamos a la notaría.</div></div></div>
    <div class="es-cards">${Object.entries(TRAMITES).map(([k, t]) => `<button class="es-card" data-tr="${k}"><span class="ic">${icon(t.ic, 24)}</span><b>${t.t}</b><small>${esc(typeof t.d === 'function' ? t.d() : t.d)}</small><span class="ops-chip" style="--c:${t.presencial ? '#b26a00' : '#13804b'}">${t.presencial ? 'Firma presencial en la notaría' : 'Sin cita presencial'}</span></button>`).join('')}</div>
    <p class="muted small es-note">${icon('alert', 14)} Las escrituras públicas y las reducciones se firman <b>en persona</b> ante el notario. Los comparecientes deben llevar su cédula de identidad vigente.</p>`;
  body().querySelectorAll('[data-tr]').forEach((b) => (b.onclick = () => { reset(); S.tramite = b.dataset.tr; S.paso = 'doc'; S.sel = 'draft'; render(); }));
}
function pDoc() {
  const P = S.proto; const pv = priv(); const red = S.tramite === 'reduccion';
  const what = S.tramite === 'protocolizacion' ? 'el documento a protocolizar, de preferencia en Word' : red ? 'el documento privado firmado, de preferencia en Word' : 'la minuta de la escritura en Word';
  const hint = S.tramite === 'protocolizacion' ? 'Sirve cualquier documento, firmado o no. En Word (.doc, .docx) lo leemos con exactitud; si solo lo tienes en PDF, foto o escaneo, lo leemos con IA (incluido en el valor).'
    : red ? 'Debe ser un documento real y ya firmado. Nosotros lo reescribimos como escritura pública. En Word lo leemos con exactitud; si solo tienes PDF, foto o escaneo, lo leemos con IA (incluido en el valor).'
    : 'Solo Word (.doc, .docx, .rtf, .odt): así el texto se lee con exactitud.';
  body().innerHTML = `<div class="es-dh"><div><h3>${esc(TRAMITES[S.tramite].t)}</h3><div class="muted small">${esc(typeof TRAMITES[S.tramite].d === 'function' ? TRAMITES[S.tramite].d() : TRAMITES[S.tramite].d)}</div></div><button class="ghost small" id="esCambiarT">Cambiar trámite</button></div>
    ${tracker(0, S.tramite, 'Sube el documento')}
    <div class="es-drop" id="esDrop">${icon('filePlus', 40)}<p><b>Arrastra aquí ${what}</b>, o</p>
      <div class="row-c"><button class="primary with-ic" id="esPick">${icon('folderOpen', 16)}<span>${pv ? 'Elegir archivo…' : 'Elegir minuta en Word…'}</span></button></div>
      <small class="muted">${hint}</small><div id="esBusy" class="es-busy hidden"></div></div>
    ${pv && P.docs.length ? `<div class="es-files">${P.docs.map((x, i) => `<div class="es-file"><span class="xp-ic">${icon(x.origen === 'Imagen' ? 'image' : 'file', 18)}</span><div class="xp-tx"><b>${esc(x.name)}</b><small>${x.pages} ${x.pages === 1 ? 'hoja' : 'hojas'} · ${esc(ORIGEN(x))}</small></div><button class="ghost small" data-rm="${i}" title="Quitar">${icon('x', 14)}</button></div>`).join('')}</div><div class="row-end"><button class="primary" id="esNext">Revisar</button></div>` : ''}`;
  $('#esCambiarT').onclick = () => { reset(); S.tramite = null; S.paso = 'tramite'; render(); };
  $('#esPick').onclick = async () => { const r = pv ? await pf.escrOpenPriv() : await pf.escrOpen('esc'); if (r.ok && r.data.length) await take(r.data); else if (!r.ok) toast(r.error); };
  body().querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { P.docs.splice(Number(b.dataset.rm), 1); S.red = null; S.redCuerpo = null; if (P.docs.length) analyzeDocs(); render(); }));
  const nx = $('#esNext'); if (nx) nx.onclick = () => go('rev');
}
// ---- espacio de trabajo: cómo llegó / cómo va a la notaría + acciones
function pTrabajo() {
  const pv = priv(); const red = S.tramite === 'reduccion'; const proto = S.tramite === 'protocolizacion';
  const q = cotizacion(); const falt = faltantes();
  const al = pv ? S.proto.info.alertas : S.a.alerts; const errs = al.filter((x) => x.sev === 'error').length;
  const hojas = pv ? totalHojas() : S.hojasEsc;
  const vista = S.vista || 'notaria';
  body().innerHTML = `<div class="es-dh"><div><h3>${esc(docTitulo())}</h3><div class="muted small">${esc(TRAMITES[S.tramite].t)} · ${esc(MT.BY[S.materia]?.label.replace(/^(Protocolizaci[oó]n|Prot\.)\s+/i, '') || '—')}${hojas ? ` · ${hojas} ${hojas === 1 ? 'hoja' : 'hojas'}` : ''}</div></div>
      <span class="ops-chip big" style="--c:${errs ? '#c0362c' : falt.length ? '#b26a00' : '#13804b'}">${errs ? `${errs} ${errs === 1 ? 'error' : 'errores'} por revisar` : falt.length ? 'Faltan datos' : 'Listo para pagar'}</span></div>
    ${tracker(S.notaria ? 3 : 1, S.tramite, S.notaria ? 'Listo para pagar' : 'Ahora')}
    <div class="es-work">
      <div class="es-wl">
        <div class="es-vbar"><div class="es-seg2">${[['orig', 'Cómo llegó'], ['notaria', 'Cómo va a la notaría'], ['ambos', 'Lado a lado']].map(([k, t]) => `<button data-v="${k}" class="${vista === k ? 'on' : ''}">${t}</button>`).join('')}</div>
          <span class="muted small">${vista === 'orig' ? esc(pv ? S.proto.docs.map(ORIGEN).filter((v, i, a) => a.indexOf(v) === i).join(' · ') : S.name) : '<span class="es-mk">[ ]</span> lo completa la notaría'}</span></div>
        <div class="es-viewer ${vista === 'ambos' ? 'two' : ''}" id="esViewer">${vista === 'ambos' ? '<div class="es-vcol"><div class="es-vcap">Cómo llegó</div><div class="es-prev" id="esVo"></div></div><div class="es-vcol"><div class="es-vcap">Cómo va a la notaría</div><div class="es-prev" id="esVn"></div></div>' : `<div class="es-prev" id="${vista === 'orig' ? 'esVo' : 'esVn'}"></div>`}</div>
        <div class="es-review">
          ${pv ? fichaHtml() : materiaCard('escritura')}
          ${panelOcultos()}
          <div class="es-h"><h3>Observaciones</h3>${!pv && al.some((x) => x.fix && x.fix.type !== 'cierre') ? `<button class="primary small with-ic" id="esFixAll">${icon('check', 14)}<span>Corregir todo lo sugerido</span></button>` : ''}</div>
          <div class="es-alerts">${al.length ? al.map((x) => `<div class="es-al ${x.sev}"><span class="ops-chip" style="--c:${SEV[x.sev][1]}">${SEV[x.sev][0]}</span><span class="es-al-t">${esc(x.text)}</span>${!pv && x.fix && x.fix.type !== 'cierre' ? `<button class="ghost small" data-fix="${x.id}">Corregir</button>` : ''}</div>`).join('') : `<div class="es-al ok"><span class="ops-chip" style="--c:#13804b">Bien</span><span>No encontramos problemas en el documento.</span></div>`}</div>
          ${proto ? `<h4>Texto de la carátula</h4><div class="es-car" id="prTxt"></div>` : ''}
        </div>
      </div>
      <aside class="es-wr">
        <div class="es-price"><small class="muted">${q.cotizacion ? 'Valor' : 'Total a pagar'}</small><b id="esTotal">${q.total == null ? 'Por cotizar' : MT.clp(q.total)}</b>
          ${q.lineas.map((l) => `<div class="es-line"><span>${esc(l.concepto)}<small class="muted">${esc(l.detalle)}</small></span><span>${MT.clp(l.monto)}</span></div>`).join('')}
          <small class="muted es-vig">Valores vigentes al ${new Date(MT.TARIFAS.vigencia + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}, sujetos a modificación.</small></div>
        ${notariaCard()}
        <button class="primary es-big" id="esPrim">${q.cotizacion ? 'Solicitar cotización' : `Pagar y enviar a la notaría`}</button>
        ${falt.length ? `<div class="es-banner" id="esFalta">${icon('alert', 15)}<span>Falta: ${esc(falt.join('; '))}.</span></div>` : ''}
        ${!proto ? `<button class="ghost with-ic" id="esEdit">${icon('edit', 15)}<span>${red ? 'Modificar el escrito' : 'Modificar el texto'}</span></button>` : `<div class="es-lock small">${icon('lock', 13)} El documento se protocoliza tal como lo subiste; la carátula se arma sola. El ejecutivo de la notaría completa el requirente.</div>`}
        ${!pv ? `<button class="ghost with-ic" id="esDocx">${icon('fileOut', 15)}<span>Descargar Word</span></button>` : ''}
        <button class="ghost small es-link" id="esCambiar">${icon('folderOpen', 14)} Cambiar documento</button>
        ${pv ? contactoHtml() : comparecientesHtml()}
      </aside>
    </div>`;
  // eventos
  body().querySelectorAll('[data-notsel]').forEach((b) => (b.onclick = () => elegirNotaria()));
  body().querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { S.vista = b.dataset.v; render(); }));
  wireMateria(); wireOcultos();
  body().querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => { const x = al.find((y) => y.id === b.dataset.fix); setRaw(N.applyFix(S.raw, x.fix)); render(); toast('Corregido'); }));
  const fa = $('#esFixAll'); if (fa) fa.onclick = () => fixAll();
  $('#esCambiar').onclick = () => { if (pv) { S.proto.docs = []; S.red = null; S.redCuerpo = null; } else { S.a = null; S.raw = ''; } S.paso = 'doc'; render(); };
  const ed = $('#esEdit'); if (ed) ed.onclick = () => (red ? editarReduccion() : editarEscritura());
  const dx = $('#esDocx'); if (dx) dx.onclick = () => guard(async () => { const r = await pf.escrSaveDocx('escritura', blocks(), notariaDatos(), `${(S.o.titulo || 'Escritura').replace(/[\\/:*?"<>|]/g, '').slice(0, 70)}.docx`); if (!r.ok) throw new Error(r.error); if (r.data) toast('Word guardado'); });
  $('#esPrim').onclick = () => {
    const falt = faltantes(); // los datos de contacto se escriben después de dibujar la vista
    if (falt.length) { if (!$('#esFalta')) render(); toast('Falta: ' + falt[0]); $('#esFalta')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (q.cotizacion) return iniciar(q);
    if (!window.isMember()) return window.ApiDiag.login(() => window.Escrituras.open(), 'Inicia sesión con tu cuenta Portalfirma para pagar el trámite.');
    pagoModal(q);
  };
  body().querySelectorAll('[data-ct]').forEach((i) => (i.oninput = () => { const k = asistentes()[Number(i.dataset.ct)].nombre; S.contactos[k] = { ...(S.contactos[k] || {}), [i.dataset.f]: i.value.trim() }; }));
  body().querySelectorAll('[data-k]').forEach((i) => (i.oninput = () => { S.proto.d[i.dataset.k] = i.value; }));
  const dc = $('#esDecl'); if (dc) dc.onchange = () => { S.proto.d.declara = dc.checked; render(); };
  if (proto) paintCar();
  pintarVisor();
}
async function pintarVisor() {
  const vo = $('#esVo'); const vn = $('#esVn'); const two = !!(vo && vn); const sc = two ? 0.62 : 1;
  try {
    if (vo) { vo.innerHTML = '<div class="muted small es-wait">Cargando…</div>'; const docs = priv() ? S.proto.docs.map((x) => x.bytes) : [S.orig?.pdf].filter(Boolean); vo.innerHTML = ''; for (const b of docs) await renderPages(vo, b, 40, sc, true); if (!docs.length) vo.innerHTML = '<div class="muted small es-wait">Sin vista del original.</div>'; }
    if (vn) { vn.innerHTML = '<div class="muted small es-wait">Preparando…</div>'; const b = await previewBytes(); vn.innerHTML = ''; await renderPages(vn, b, 40, sc, true); }
  } catch (e) { (vn || vo).innerHTML = `<div class="es-al error">${esc('No se pudo preparar: ' + (e.message || e))}</div>`; }
}
function comparecientesHtml() {
  const comp = asistentes();
  return `<div class="es-people"><div class="es-people-h"><b>Comparecientes</b><small class="muted">${comp.filter((c) => c.asiste).length} firman</small></div>
    ${comp.map((c, i) => { const ct = S.contactos[c.nombre] || {}; return `<div class="es-person"><span class="es-av ${c.asiste ? '' : 'off'}">${ini(c.nombre)}</span><div class="es-pinfo"><b>${esc(c.nombre)}</b>
      <small class="muted">${c.rut ? `<span class="${c.rutOk ? '' : 'es-bad'}">${esc(N.fmtRut(c.rut, c.dv))}</span>` : '<span class="es-bad">sin RUT</span>'}${c.calidad ? ' · ' + esc(c.calidad) : ''}</small>
      <span class="ops-chip" style="--c:${c.asiste ? '#13804b' : '#64748b'}">${c.asiste ? 'Firma en la notaría' : 'Representado'}</span>
      ${c.asiste ? `<input class="es-in" data-ct="${i}" data-f="email" value="${esc(ct.email || '')}" placeholder="Correo" /><input class="es-in" data-ct="${i}" data-f="tel" value="${esc(ct.tel || '')}" placeholder="Teléfono" />` : `<small class="muted">${esc(c.motivo)}</small>`}</div></div>`; }).join('') || '<p class="muted small">No encontramos comparecientes con el formato «NOMBRE, nacionalidad, estado civil…».</p>'}</div>`;
}
function contactoHtml() {
  const d = S.proto.d; const info = S.proto.info; const red = S.tramite === 'reduccion';
  const sigs = red ? redBase().sigs : [];
  return `<div class="es-people"><div class="es-people-h"><b>Participantes</b><small class="muted">${info.participantes.length}</small></div>
    ${info.participantes.map((p) => `<div class="es-person"><span class="es-av">${ini(p.nombre)}</span><div class="es-pinfo"><b>${esc(p.nombre)}</b><small class="muted">${esc([p.rut, p.rol].filter(Boolean).join(' · ') || (p.tipo === 'empresa' ? 'Empresa' : ''))}</small>${red && sigs.some((g) => N.fold(g.name).includes(N.fold(p.nombre)) || N.fold(p.nombre).includes(N.fold(g.name))) ? '<span class="ops-chip" style="--c:#13804b">Firma en la notaría</span>' : ''}</div></div>`).join('') || '<p class="muted small">No se identifican participantes.</p>'}
    </div>
    ${red ? `<div class="es-decl ${info.firmas.hay ? '' : 'warn'}">${info.firmas.hay ? '' : `<p class="small">${icon('alert', 13)} No detectamos firmas: solo se puede reducir un documento ya firmado.</p>`}<label class="chk"><input type="checkbox" id="esDecl" ${d.declara ? 'checked' : ''}/><span>Declaro que el documento es real, está firmado y llevaré el <b>original firmado</b> a la notaría.</span></label></div>` : ''}
    <div class="es-people"><div class="es-people-h"><b>Tu contacto</b></div>
      <input class="es-in" data-k="email" value="${esc(d.email || '')}" placeholder="Correo" /><input class="es-in" data-k="tel" value="${esc(d.tel || '')}" placeholder="Teléfono${red ? '' : ' (opcional)'}" />
      <textarea class="es-in es-ta sm" data-k="nota" placeholder="Nota para la notaría (opcional)">${esc(d.nota || '')}</textarea></div>`;
}
function fichaHtml() {
  const info = S.proto.info; const red = S.tramite === 'reduccion'; const m = MT.BY[S.materia];
  const fil = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const firmas = [...info.firmas.electronicas.map((f) => `${esc(f.nombre)} <small class="muted">firma electrónica${f.fecha ? ' · ' + esc(f.fecha.toLocaleDateString('es-CL')) : ''}</small>`), ...info.firmas.lineas.map((n) => esc(n))].join('<br>') || '<span class="muted">No se detectan firmas</span>';
  return `<div class="es-mat ro"><div class="es-mat-h"><span class="ic">${icon('sparkle', 18)}</span><div class="es-mat-t"><small class="muted">Tipo de documento detectado</small><b id="esMatLbl">${esc((m?.label || '—').replace(/^(Protocolizaci[oó]n|Prot\.)\s+/i, ''))}</b></div><span class="ops-chip" style="--c:#3f4fe6">${icon('lock', 11)} Automático</span><span class="es-mat-p">${MT.clp(red ? MT.TARIFAS.reduccion : MT.TARIFAS.protocolizacion)} <small class="muted">tarifa fija</small></span></div></div>
    <div class="es-ficha"><div class="es-sumrows">${fil('Documento', esc(info.titulo))}${fil('Hojas', String(totalHojas()))}${fil('Lectura', esc(S.proto.docs.map(ORIGEN).filter((v, i, a) => a.indexOf(v) === i).join(' · ')))}${fil('Firmas', firmas)}${info.fechaDocumento ? fil('Fecha', esc(info.fechaDocumento.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }))) : ''}${info.patente ? fil('Placa patente', esc(info.patente)) : ''}${red ? fil('Escrito', redBase().modo === 'partes' ? 'Comparecen las mismas partes del documento' : 'Comparece quien lo presenta <span class="es-mk">lo completa la notaría</span>') : fil('Requirente', '<span class="es-mk">Lo completa la notaría</span>')}</div></div>`;
}
function editarEscritura() {
  modal(`<h3>Modificar el texto</h3><p class="muted small">Corrige lo que necesites; la revisión y la vista para la notaría se actualizan al aplicar.</p>
    <label>Título<input id="eTit" value="${esc(S.o.titulo)}" /></label>
    <div class="es-opts"><label class="chk"><input type="checkbox" id="eConv" ${S.o.convertir ? 'checked' : ''}/> Escribir las cifras en palabras</label><label class="chk"><input type="checkbox" id="eCie" ${S.o.cierre ? 'checked' : ''}/> Agregar la frase de cierre si falta</label></div>
    <textarea id="esRaw" class="es-ta big">${esc(S.raw)}</textarea><div class="row-end"><button class="ghost" id="tCan">Cancelar</button><button class="primary" id="tOk">Aplicar</button></div>`);
  $('#tCan').onclick = closeModal;
  $('#tOk').onclick = () => { const t = $('#eTit').value.trim(); const conv = $('#eConv').checked; const cie = $('#eCie').checked; setRaw($('#esRaw').value); S.o.convertir = conv; S.o.cierre = cie; if (t && t !== S.o.titulo) { S.o.titulo = t; S.o._tp = true; } S.preview = null; closeModal(); render(); };
}
function editarReduccion() {
  const r = redBase();
  modal(`<h3>Modificar el escrito</h3><p class="muted small">Este es el texto de la escritura de reducción (la comparecencia y la transcripción). Lo que está entre <span class="es-mk">[ ]</span> lo completa la notaría.</p>
    <textarea id="esRed" class="es-ta big">${esc(S.redCuerpo != null ? S.redCuerpo : r.cuerpo)}</textarea>
    <div class="row-end"><button class="ghost small" id="rRes">Volver al texto generado</button><span style="flex:1"></span><button class="ghost" id="rCan">Cancelar</button><button class="primary" id="rOk">Aplicar</button></div>`);
  $('#rCan').onclick = closeModal; $('#rRes').onclick = () => { $('#esRed').value = r.cuerpo; };
  $('#rOk').onclick = () => { const v = $('#esRed').value; S.redCuerpo = v.trim() === r.cuerpo.trim() ? null : v; S.preview = null; closeModal(); render(); };
}
async function pagoModal(q) {
  modal(`<h3>Pagar y enviar a la notaría</h3><div class="es-line total"><b>Total</b><b>${MT.clp(q.total)}</b></div><div class="es-line"><span class="muted">Saldo de tu cuenta</span><span id="esSaldo">…</span></div><div id="esPayBox" class="es-paybox"></div>`);
  const r = await pf.notSaldo(); S.saldo = r.ok && r.data != null ? r.data : 0; $('#esSaldo').textContent = MT.clp(S.saldo);
  const falta = Math.max(0, q.total - S.saldo); const pres = TRAMITES[S.tramite].presencial;
  $('#esPayBox').innerHTML = falta > 0 ? `<p class="small">Te faltan <b>${MT.clp(falta)}</b>. Recarga tu saldo con tarjeta o transferencia y vuelve a intentarlo.</p><div class="row-end"><button class="ghost" id="pCan">Cerrar</button><button class="primary" id="esTop">Recargar ${MT.clp(falta)}</button></div>`
    : `<label class="chk small"><input type="checkbox" id="esAcc"/> Acepto los términos y condiciones${pres ? ' y entiendo que la firma es presencial en la notaría' : ''}.</label><div class="row-end"><button class="ghost" id="pCan">Cancelar</button><button class="primary" id="esPay">Pagar ${MT.clp(q.total)}</button></div>`;
  $('#pCan').onclick = closeModal;
  const tp = $('#esTop'); if (tp) tp.onclick = async () => { const x = await pf.topUp(falta, ''); toast(x.ok ? 'Se abrió la página de pago en tu navegador' : 'No se pudo abrir la recarga: ' + x.error); };
  const py = $('#esPay'); if (py) py.onclick = () => { if (!$('#esAcc').checked) return toast('Acepta los términos para continuar.'); closeModal(); iniciar(q); };
}
// ---- notaría: etapa estándar para todos los trámites (elegir antes de pagar)
const SERV = { escritura: 'Escrituras', protocolizacion: 'Protocolizaciones', reduccion: 'Reducciones' };
function notariaCard() {
  const n = S.notaria;
  if (!n) return `<div class="es-people es-not need"><div class="es-people-h"><b>Notaría</b><small class="muted">paso obligatorio</small></div><p class="small muted">Elige dónde se hará el trámite. Sus datos quedan en el documento y la notaría recibe el caso al pagar.</p><button class="ghost with-ic" data-notsel>${icon('building', 15)}<span>Elegir notaría</span></button></div>`;
  if (n.auto) return `<div class="es-people es-not"><div class="es-people-h"><b>Notaría</b><button class="ghost small" data-notsel>Cambiar</button></div><div class="es-person"><span class="es-av">${icon('flow', 16)}</span><div class="es-pinfo"><b>Asignación automática</b><small class="muted">La primera notaría disponible de la red toma el caso. Sus datos los completa al recibirlo.</small></div></div></div>`;
  return `<div class="es-people es-not"><div class="es-people-h"><b>Notaría</b><button class="ghost small" data-notsel>Cambiar</button></div>
    <div class="es-person"><span class="es-av">${icon('building', 16)}</span><div class="es-pinfo"><b id="esNotNom">${esc(n.nombre)}</b><small class="muted">${esc(n.notario)}${n.titular ? '' : ' (suplente)'} · ${esc(n.dirCorta || n.direccion)}, ${esc(n.comuna)}</small>
      <small class="muted">${icon('calendar', 11)} ${esc(n.horario)}</small>${n.prueba ? '<span class="ops-chip" style="--c:#b26a00">Datos de prueba</span>' : ''}</div></div></div>`;
}
function elegirNotaria() {
  const lista = S.redNot || []; let sel = S.notaria ? (S.notaria.auto ? 'auto' : S.notaria.id) : '';
  const comunas = [...new Set(lista.map((n) => n.comuna))].sort();
  const paint = () => {
    const c = $('#nComuna')?.value || ''; const box = $('#nLista'); if (!box) return;
    box.innerHTML = lista.filter((n) => !c || n.comuna === c).map((n) => {
      const okServ = n.servicios.includes(S.tramite);
      return `<button class="es-nopt ${sel === n.id ? 'on' : ''}" data-nid="${esc(n.id)}" ${okServ ? '' : 'disabled'}>
        <span class="es-av">${icon('building', 16)}</span><span class="es-nopt-t"><b>${esc(n.nombre)}</b><small>${esc(n.notario)}${n.titular ? '' : ' (suplente)'} · ${esc(n.dirCorta || n.direccion)}, ${esc(n.comuna)}</small>
        <small>${icon('calendar', 11)} ${esc(n.horario)} · toma el caso en ${n.tomaHoras} h</small>
        <span class="es-nopt-c">${n.servicios.map((x) => `<span class="ops-chip" style="--c:${x === S.tramite ? '#13804b' : '#64748b'}">${SERV[x]}</span>`).join('')}${n.prueba ? '<span class="ops-chip" style="--c:#b26a00">Prueba</span>' : ''}</span>
        ${okServ ? '' : `<small class="es-bad">No realiza ${SERV[S.tramite].toLowerCase()}</small>`}</span><span class="es-radio"></span></button>`;
    }).join('') + `<button class="es-nopt ${sel === 'auto' ? 'on' : ''}" data-nid="auto"><span class="es-av off">${icon('flow', 16)}</span><span class="es-nopt-t"><b>Asignación automática</b><small>La primera notaría disponible de la red toma el caso. Los datos del notario quedan para que los complete la notaría.</small></span><span class="es-radio"></span></button>`;
    box.querySelectorAll('[data-nid]').forEach((b) => (b.onclick = () => { sel = b.dataset.nid; paint(); }));
    $('#nOk').disabled = !sel;
  };
  modal(`<h3>Elige la notaría</h3><p class="muted small">Todas las notarías de la red trabajan con el mismo formato y reciben el caso por Portalfirma. Sus datos (notario, número y dirección) quedan en el documento.</p>
    <label>Comuna<select id="nComuna"><option value="">Todas</option>${comunas.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
    <div class="es-nlist" id="nLista"></div>
    <div class="row-end"><button class="ghost" id="nCan">Cancelar</button><button class="primary" id="nOk" disabled>Confirmar notaría</button></div>`);
  $('#nComuna').onchange = paint; $('#nCan').onclick = closeModal;
  $('#nOk').onclick = () => { S.notaria = sel === 'auto' ? { auto: true } : lista.find((n) => n.id === sel); S.preview = null; closeModal(); render(); toast(sel === 'auto' ? 'Asignación automática' : `Notaría: ${S.notaria.nombre}`); };
  paint();
}
// ---- trámite enviado
async function detalleOp(o) {
  const cur = o.status === 'cotizacion' ? 3 : ['pagado', 'pausado_ajuste_tarifa', 'aceptado', 'citado'].includes(o.status) ? 4 : 6;
  const files = (o.archivos || []).filter((f) => typeof f === 'object');
  const main = files.find((f) => ['escritura_pdf', 'reduccion_pdf', 'para_notaria'].includes(f.kind)) || files.find((f) => f.kind === 'caratula_pdf');
  body().innerHTML = `<div class="es-dh"><div><h3>${esc(o.titulo || o.materia)}</h3><div class="muted small">Trámite Nº ${esc(o.operation)} · ${esc(TRAMITES[o.tramite]?.t || '')} · ${esc(o.materia || '')}<br>Creado ${new Date(o.creado).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div><span class="ops-chip big" style="--c:${ESTADO_C[o.status] || '#64748b'}">${esc(o.estado)}</span></div>
    ${tracker(cur, o.tramite, o.status === 'cotizacion' ? 'Esperando cotización' : 'La notaría toma el caso')}
    <div class="es-work"><div class="es-wl"><div class="es-vbar"><b class="small">Lo que recibió la notaría</b></div><div class="es-viewer"><div class="es-prev" id="esVn">${main ? '' : '<div class="muted small es-wait">Sin vista disponible.</div>'}</div></div></div>
      <aside class="es-wr"><div class="es-price"><small class="muted">${o.status === 'cotizacion' ? 'Valor' : 'Pagado'}</small><b>${MT.clp(o.total)}</b></div>
        ${o.notaria ? `<div class="es-people es-not"><div class="es-people-h"><b>Notaría</b>${o.notaria.prueba ? '<span class="ops-chip" style="--c:#b26a00">De prueba</span>' : ''}</div>${o.notaria.asignacion ? '<p class="small">Asignación automática: la primera notaría disponible de la red toma el caso.</p>' : `<div class="es-person"><span class="es-av">${icon('building', 16)}</span><div class="es-pinfo"><b>${esc(o.notaria.nombre)}</b><small class="muted">${esc(o.notaria.notario)} · ${esc(o.notaria.direccion)}, ${esc(o.notaria.comuna)}</small></div></div>`}</div>` : ''}
        <div class="es-people"><div class="es-people-h"><b>Archivos enviados</b><small class="muted">${files.length}</small></div>${files.map((f) => `<button class="ghost small es-file-b" data-f="${esc(f.name)}">${icon('file', 13)} ${esc(f.name)}</button>`).join('') || '<p class="muted small">—</p>'}</div>
        <p class="muted small">${o.status === 'cotizacion' ? 'La notaría revisará el documento y te enviará el valor. No se cobra nada hasta que lo apruebes.' : TRAMITES[o.tramite]?.presencial ? 'La notaría tomará el caso y te contactará para agendar la firma presencial.' : 'La notaría tomará el caso y te avisaremos cuando quede protocolizado.'}</p></aside></div>`;
  body().querySelectorAll('[data-f]').forEach((b) => (b.onclick = async () => { const r = await pf.notArchivo(o.operation, b.dataset.f); if (!r.ok || !r.data) return toast('No se encontró el archivo.'); if (/\.pdf$/i.test(b.dataset.f)) { const t = await pf.edTemp(r.data, b.dataset.f); if (t.ok) { window.studio.goEditor(); window.editor.openEach([t.data.path]); } } else toast('El Word lo recibe la notaría.'); }));
  if (main) { const r = await pf.notArchivo(o.operation, main.name); const v = $('#esVn'); if (v && r.ok && r.data) await renderPages(v, r.data, 40, 1, true); }
}
// arrastrar archivos sobre la vista
function dropFiles(paths) {
  if (!S.tramite || S.sel !== 'draft') { toast('Primero elige el tipo de trámite.'); return; }
  (priv() ? pf.escrReadPriv(paths) : pf.escrRead(paths)).then((r) => { if (!r.ok) return toast(r.error); take(priv() ? r.data : r.data.slice(0, 1)); });
}

window.Escrituras = { open, dropFiles, _s: S, _escrituraPdf: escrituraPdf, _caratulaPdf: caratulaPdf };
})();
