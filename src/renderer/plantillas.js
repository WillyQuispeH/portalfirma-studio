/* global pf, $, esc, toast, modal, closeModal, icon, ed, tabs, newState, uid, setDirty, renderPanel, renderOverlays, renderOverlaysFor,
   setTool, stopEditing, bakeDoc, loadLib, saveLib, setBytes, removeOriginal, blocksFor, openBlocks, detectDigitalBlocks, layoutRich, syncRichHeight,
   normText, step, busy, baseName, vp1, activate, bakeAll, findOv, state */
'use strict';
// ============================================================================
// PortalFirma Studio — Plantillas con campos
//  · Diseño: sobre el propio documento se marcan palabras como campos (nombre, RUT, fecha, monto…).
//  · La plantilla es un PDF normal con la definición incrustada como archivo adjunto.
//  · Llenado: un formulario a la derecha; el texto del párrafo se vuelve a armar con la misma fuente,
//    el original se borra de verdad y el resultado se revisa antes de generar el documento.
// ============================================================================
const TPL_FILE = 'portalfirma-plantilla.json';
const FIELD_TYPES = { texto: 'Texto', rut: 'RUT', fecha: 'Fecha', monto: 'Monto en pesos', numero: 'Número', email: 'Correo', telefono: 'Teléfono', opcion: 'Lista de opciones', parrafo: 'Texto largo' };
const SIGNER_ATTRS = { fullName: 'Nombre', rut: 'RUT', email: 'Correo', phone: 'Teléfono' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MAX_SHRINK = 0.5; // puntos que se puede achicar la letra para que un dato quepa

// ---------- números en palabras (español de Chile) ----------
const UNI = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DEC = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CEN = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
function menorMil(n) {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100), r = n % 100;
  let s = CEN[c];
  if (r) s += (s ? ' ' : '') + (r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNI[r % 10] : ''));
  return s;
}
// apocope: "uno" → "un" delante de mil, millón o de un sustantivo; "veintiuno" → "veintiún"
const apocope = (s) => s.replace(/veintiuno$/, 'veintiún').replace(/(^|\s)uno$/, '$1un');
function numeroALetras(n, { apoc = false } = {}) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'cero';
  const parts = [];
  const millones = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000;
  if (millones) {
    if (millones >= 1000) { const milM = Math.floor(millones / 1000), m2 = millones % 1000; parts.push((milM === 1 ? 'mil' : apocope(menorMil(milM)) + ' mil') + (m2 ? ' ' + apocope(menorMil(m2)) : '') + ' millones'); }
    else parts.push(millones === 1 ? 'un millón' : apocope(menorMil(millones)) + ' millones');
  }
  if (miles) parts.push(miles === 1 ? 'mil' : apocope(menorMil(miles)) + ' mil');
  if (resto) parts.push(apoc ? apocope(menorMil(resto)) : menorMil(resto));
  return parts.join(' ');
}
function montoEnPalabras(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  const w = numeroALetras(n, { apoc: true });
  const exactMillon = n >= 1e6 && n % 1e6 === 0;
  return `${w}${exactMillon ? ' de' : ''} ${n === 1 ? 'peso' : 'pesos'}`;
}
const miles = (n) => Math.floor(Math.abs(Number(n) || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ---------- RUT ----------
function rutDv(body) { let s = 0, m = 2; for (let i = body.length - 1; i >= 0; i--) { s += Number(body[i]) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (s % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); }
function fmtRutTpl(v) {
  const c = String(v || '').replace(/[^0-9kK]/g, '').toUpperCase(); if (c.length < 2) return { text: v, error: 'RUT incompleto' };
  const body = c.slice(0, -1), dv = c.slice(-1);
  const text = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
  return rutDv(body) === dv ? { text } : { text, error: 'RUT inválido (dígito verificador)' };
}

// ---------- formato de cada campo ----------
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y|E)\b/g, (w) => w.toLowerCase());
function formatField(f, raw) {
  const v = raw == null ? '' : String(raw).trim();
  if (!v) return { text: '', empty: true, error: f.required ? 'Obligatorio' : null };
  const o = f.format || {};
  switch (f.type) {
    case 'rut': return fmtRutTpl(v);
    case 'fecha': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!m) return { text: v, error: 'Fecha inválida' };
      const [, y, mo, d] = m;
      if (o.date === 'corto') return { text: `${d}-${mo}-${y}` };
      if (o.date === 'barra') return { text: `${d}/${mo}/${y}` };
      return { text: `${Number(d)} de ${MESES[Number(mo) - 1]} de ${y}` };
    }
    case 'monto': {
      const n = Number(v.replace(/[^\d]/g, '')); if (!v.replace(/[^\d]/g, '')) return { text: v, error: 'Escribe solo números' };
      const cifra = (o.symbol === false ? '' : '$') + miles(n);
      return { text: o.words === 'solo' ? montoEnPalabras(n) : o.words ? `${cifra} (${montoEnPalabras(n)})` : cifra };
    }
    case 'numero': {
      const n = Number(v.replace(/[^\d]/g, '')); if (!/\d/.test(v)) return { text: v, error: 'Escribe un número' };
      return { text: o.words === 'solo' ? numeroALetras(n) : o.words ? `${numeroALetras(n)} (${miles(n)})` : miles(n) };
    }
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { text: v.toLowerCase() } : { text: v, error: 'Correo inválido' };
    case 'telefono': {
      let d = v.replace(/\D/g, ''); if (d.length === 9 && d[0] === '9') d = '56' + d;
      if (d.length < 8) return { text: v, error: 'Teléfono incompleto' };
      return { text: d.length === 11 && d.startsWith('569') ? `+56 9 ${d.slice(3, 7)} ${d.slice(7)}` : '+' + d };
    }
    default: {
      let t = v;
      if (o.case === 'upper') t = t.toUpperCase(); else if (o.case === 'title') t = titleCase(t);
      return { text: t };
    }
  }
}
// Al convertir una selección en campo se adivina el tipo
function guessField(text) {
  const t = text.trim();
  if (/^\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]$/.test(t)) return { type: 'rut', label: 'RUT' };
  if (/^\d{1,2} de [a-záéíóú]+ de \d{4}$/i.test(t) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(t)) return { type: 'fecha', label: 'Fecha', format: { date: /de/.test(t) ? 'largo' : t.includes('/') ? 'barra' : 'corto' } };
  if (/^\$\s?[\d.]+/.test(t)) return { type: 'monto', label: 'Monto', format: { words: /\(/.test(t) } };
  if (/^[^\s@]+@[^\s@]+$/.test(t)) return { type: 'email', label: 'Correo' };
  if (/^\+?[\d\s]{8,}$/.test(t)) return { type: 'telefono', label: 'Teléfono' };
  if (/^\d+$/.test(t)) return { type: 'numero', label: 'Número' };
  const upper = t === t.toUpperCase() && /\p{L}/u.test(t);
  return { type: t.length > 80 ? 'parrafo' : 'texto', label: t.length <= 28 ? titleCase(t) : 'Texto', format: { case: upper ? 'upper' : 'normal' } };
}

// ---------- utilidades ----------
const fieldsIn = (html) => [...String(html || '').matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]);
const allOverlays = () => Object.entries(ed.overlays).flatMap(([p, l]) => l.map((o) => ({ page: Number(p), o })));
const fieldUses = (id) => allOverlays().reduce((n, { o }) => n + fieldsIn(o.tplHtml || o.html).filter((x) => x === id).length, 0);
let fieldSeq = 0;
const newFieldId = () => 'f' + Date.now().toString(36) + (++fieldSeq);

// ============================================================================
// Diseño de plantillas
// ============================================================================
function enterDesign(def) {
  if (!ed.bytes) return toast('Abre primero el documento que quieres convertir en plantilla.');
  if (ed.tpl?.mode === 'fill') return toast('Esta pestaña está llenando una plantilla. Usa «Editar plantilla».');
  ed.tpl = { mode: 'design', def: def || { name: baseName(), fields: [] } };
  setTool('edittext'); renderPanel();
  const p = $('#edPanel'); if (p) p.scrollTop = 0;
}
function exitDesign() { if (ed.editing) stopEditing(); ed.tpl = null; setTool('select'); renderPanel(); }

function designSection() {
  const t = ed.tpl; const fs = t.def.fields;
  return `<div class="sec tpl-design"><h4>${icon('template', 13)} Plantilla</h4>
    <ol class="tpl-steps"><li>Haz clic en un párrafo.</li><li>Selecciona las palabras que cambian (nombre, RUT, fecha…).</li><li>Presiona <strong>Convertir en campo</strong>.</li></ol>
    <button class="primary pbtn" id="tplConv">${icon('plus', 15)} Convertir en campo</button>
    <button class="secondary pbtn ai-btn" id="tplAi" data-member title="La IA lee el documento y propone los campos (nombres, RUT, fechas, montos…)">${icon('sparkle', 15)} Detectar con IA <small class="tk-cost">2 tokens</small><span class="lock-badge">${icon('lock', 11)}</span></button>
    <div class="tpl-fields">${fs.length ? fs.map((f) => `<div class="tpl-f" data-f="${f.id}"><span class="nm">${esc(f.label)}${f.required ? ' *' : ''}</span>
        <span class="ty">${FIELD_TYPES[f.type]}${f.signer ? ' · firmante «' + esc(f.signer.role) + '»' : ''} · ${fieldUses(f.id)}×</span>
        <button class="ibtn" data-edit="${f.id}" title="Editar campo">${icon('edit', 14)}</button><button class="ibtn danger" data-del="${f.id}" title="Quitar campo">${icon('trash', 14)}</button></div>`).join('')
      : '<p class="hint">Todavía no hay campos.</p>'}</div>
    <div class="prow"><button class="secondary pbtn" id="tplSave">${icon('save', 15)} Guardar plantilla</button></div>
    <button class="ghost small" id="tplExit">Terminar</button></div>`;
}
function bindDesign(host) {
  const c = host.querySelector('#tplConv'); if (!c) return;
  c.addEventListener('mousedown', (e) => e.preventDefault()); // no perder la selección del texto
  c.onclick = convertSelection;
  host.querySelector('#tplAi').onclick = detectWithAi;
  host.querySelector('#tplSave').onclick = saveTemplate;
  host.querySelector('#tplExit').onclick = () => {
    if (!ed.tpl.dirty) return exitDesign();
    modal(`<h2>¿Salir sin guardar la plantilla?</h2><p>Los campos marcados se mantienen en el documento, pero la plantilla no queda en «Mis plantillas».</p>
      <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mNo">Salir</button><button class="primary" id="mOk">Guardar</button></div>`);
    $('#mCancel').onclick = closeModal; $('#mNo').onclick = () => { closeModal(); exitDesign(); }; $('#mOk').onclick = () => { closeModal(); saveTemplate(); };
  };
  host.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => fieldDialog({ field: ed.tpl.def.fields.find((f) => f.id === b.dataset.edit) })));
  host.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => removeField(b.dataset.del)));
}

// Selección actual dentro del párrafo que se está editando
function currentSelection() {
  const o = ed.editing && findOv(ed.editing); if (!o) return null;
  const rt = document.querySelector(`.ov[data-id="${o.id}"] .rt`); const s = getSelection();
  if (!rt || !s.rangeCount || s.isCollapsed) return null;
  const r = s.getRangeAt(0); if (!rt.contains(r.commonAncestorContainer)) return null;
  if ((r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest('.pf-field')) return { inField: true };
  return { o, rt, range: r.cloneRange(), text: r.toString() };
}
function convertSelection() {
  const sel = currentSelection();
  if (!sel) return toast('Haz clic en un párrafo y selecciona con el mouse las palabras que serán el campo.', 4500);
  if (sel.inField) return toast('Esas palabras ya son un campo.');
  const text = sel.text.replace(/\s+$/, '').replace(/^\s+/, '');
  if (!text) return toast('Selecciona al menos una palabra.');
  // ajusta la selección para no incluir espacios de los bordes
  fieldDialog({ sample: text, onDone: (f) => {
    const { range, rt, o } = sel;
    const span = document.createElement('span'); span.className = 'pf-field'; span.dataset.field = f.id; span.contentEditable = 'false'; span.textContent = text;
    const lead = sel.text.match(/^\s*/)[0], trail = sel.text.match(/\s*$/)[0];
    range.deleteContents(); const frag = document.createDocumentFragment();
    if (lead) frag.append(lead); frag.append(span); if (trail) frag.append(trail);
    range.insertNode(frag); rt.normalize();
    o.html = rt.innerHTML; ed.tpl.dirty = true; setDirty(true); renderPanel();
    offerRepeats(f, text);
  } });
}

function fieldDialog({ field, sample, onDone }) {
  const editing = !!field; const g = editing ? field : { ...guessField(sample || ''), required: true };
  const existing = ed.tpl.def.fields;
  const roles = [...new Set(existing.filter((x) => x.signer).map((x) => x.signer.role))];
  const fo = g.format || {};
  modal(`<h2>${editing ? 'Editar campo' : 'Nuevo campo'}</h2>
    ${!editing && sample ? `<p class="muted small">Texto de ejemplo: «${esc(sample.slice(0, 120))}»</p>` : ''}
    ${!editing && existing.length ? `<label>Usar un campo que ya existe<select id="fExisting"><option value="">— Campo nuevo —</option>${existing.map((x) => `<option value="${x.id}">${esc(x.label)} (${FIELD_TYPES[x.type]})</option>`).join('')}</select></label>` : ''}
    <div id="fNewBox">
    <div class="grid2"><label>Nombre del campo<input id="fLabel" value="${esc(g.label || '')}" placeholder="Ej. Arrendatario: nombre" /></label>
      <label>Tipo<select id="fType">${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}" ${k === g.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div id="fFmt"></div>
    <label class="radio"><input type="checkbox" id="fReq" ${g.required !== false ? 'checked' : ''}/> <span>Obligatorio</span></label>
    <label class="radio"><input type="checkbox" id="fSigner" ${g.signer ? 'checked' : ''}/> <span>Es un dato de un firmante (se usa al enviar a firmar)</span></label>
    <div class="grid2 ${g.signer ? '' : 'hidden'}" id="fSignerBox"><label>Rol del firmante<input id="fRole" list="fRoles" value="${esc(g.signer?.role || roles[0] || '')}" placeholder="Ej. Arrendatario" /><datalist id="fRoles">${roles.map((r) => `<option value="${esc(r)}">`).join('')}</datalist></label>
      <label>Dato<select id="fAttr">${Object.entries(SIGNER_ATTRS).map(([k, v]) => `<option value="${k}" ${(g.signer?.attr || (g.type === 'rut' ? 'rut' : g.type === 'email' ? 'email' : g.type === 'telefono' ? 'phone' : 'fullName')) === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    </div>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">${editing ? 'Guardar' : 'Crear campo'}</button></div>`);
  const fmtBox = () => {
    const t = $('#fType').value; const f2 = t === g.type ? fo : {};
    $('#fFmt').innerHTML = t === 'texto' ? `<label>Mayúsculas<select id="fCase"><option value="normal">Como se escriba</option><option value="upper" ${f2.case === 'upper' ? 'selected' : ''}>TODO EN MAYÚSCULAS</option><option value="title" ${f2.case === 'title' ? 'selected' : ''}>Nombre Propio</option></select></label>`
      : t === 'fecha' ? `<label>Formato<select id="fDate"><option value="largo">2 de octubre de 2026</option><option value="corto" ${f2.date === 'corto' ? 'selected' : ''}>02-10-2026</option><option value="barra" ${f2.date === 'barra' ? 'selected' : ''}>02/10/2026</option></select></label>`
      : t === 'monto' ? `<label>Formato<select id="fWords"><option value="">$500.000</option><option value="1" ${f2.words === true ? 'selected' : ''}>$500.000 (quinientos mil pesos)</option><option value="solo" ${f2.words === 'solo' ? 'selected' : ''}>quinientos mil pesos</option></select></label>`
      : t === 'numero' ? `<label>Formato<select id="fWords"><option value="">12</option><option value="1" ${f2.words === true ? 'selected' : ''}>doce (12)</option><option value="solo" ${f2.words === 'solo' ? 'selected' : ''}>doce</option></select></label>`
      : t === 'opcion' ? `<label>Opciones (una por línea)<textarea id="fOpts" rows="3">${esc((g.options || []).join('\n'))}</textarea></label>` : '';
  };
  fmtBox(); $('#fType').onchange = fmtBox;
  $('#fSigner').onchange = (e) => $('#fSignerBox').classList.toggle('hidden', !e.target.checked);
  const ex = $('#fExisting'); if (ex) ex.onchange = () => $('#fNewBox').classList.toggle('hidden', !!ex.value);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => {
    if (ex && ex.value) { closeModal(); onDone?.(existing.find((x) => x.id === ex.value)); return; }
    const label = $('#fLabel').value.trim(); if (!label) { $('#fLabel').focus(); return; }
    const type = $('#fType').value; const format = {};
    if ($('#fCase')) format.case = $('#fCase').value; if ($('#fDate')) format.date = $('#fDate').value;
    if ($('#fWords')) format.words = $('#fWords').value === 'solo' ? 'solo' : !!$('#fWords').value;
    const f = editing ? field : { id: newFieldId(), sample };
    Object.assign(f, { label, type, format, required: $('#fReq').checked, options: $('#fOpts') ? $('#fOpts').value.split('\n').map((x) => x.trim()).filter(Boolean) : f.options,
      signer: $('#fSigner').checked && $('#fRole').value.trim() ? { role: $('#fRole').value.trim(), attr: $('#fAttr').value } : null });
    if (!editing) ed.tpl.def.fields.push(f);
    ed.tpl.dirty = true; closeModal(); renderPanel(); onDone?.(f);
  };
  setTimeout(() => $('#fLabel')?.select(), 30);
}
function removeField(id) {
  for (const { o } of allOverlays()) {
    if (!fieldsIn(o.html).includes(id)) continue;
    const d = document.createElement('div'); d.innerHTML = o.html;
    d.querySelectorAll(`.pf-field[data-field="${id}"]`).forEach((sp) => sp.replaceWith(document.createTextNode(sp.textContent)));
    o.html = d.innerHTML;
  }
  ed.tpl.def.fields = ed.tpl.def.fields.filter((f) => f.id !== id); ed.tpl.dirty = true;
  for (let i = 0; i < ed.count; i++) renderOverlaysFor(i);
  renderPanel();
}

// Envuelve en un campo cada aparición de `text` en el html (fuera de otros campos). Devuelve cuántas.
function wrapText(o, text, fid) {
  const d = document.createElement('div'); d.innerHTML = o.html; let n = 0;
  const lower = text.toLowerCase();
  const walk = (node) => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 1) { if (!ch.classList.contains('pf-field')) walk(ch); continue; }
      if (ch.nodeType !== 3) continue;
      let t = ch.data, k = t.toLowerCase().indexOf(lower);
      if (k < 0) continue;
      const frag = document.createDocumentFragment();
      while (k >= 0) {
        if (k) frag.append(t.slice(0, k));
        const sp = document.createElement('span'); sp.className = 'pf-field'; sp.dataset.field = fid; sp.contentEditable = 'false'; sp.textContent = t.slice(k, k + text.length); frag.append(sp); n++;
        t = t.slice(k + text.length); k = t.toLowerCase().indexOf(lower);
      }
      if (t) frag.append(t);
      ch.replaceWith(frag);
    }
  };
  walk(d); if (n) o.html = d.innerHTML;
  return n;
}
// El mismo dato suele repetirse (el nombre del arrendatario aparece 5 veces): se ofrece marcarlo en todas.
async function offerRepeats(f, text) {
  if (text.length < 3) return;
  const target = normText(text).replace(/\s+/g, ' ').trim();
  const opened = allOverlays().filter(({ o }) => o.type === 'rich' && (() => { const d = document.createElement('div'); d.innerHTML = o.html; d.querySelectorAll('.pf-field').forEach((x) => x.remove()); return normText(d.textContent).replace(/\s+/g, ' ').includes(target); })());
  const usedBlocks = new Set(allOverlays().map(({ page, o }) => page + ':' + o.blockId));
  const closed = [];
  for (let i = 0; i < ed.count; i++) {
    let bl = []; try { bl = await blocksFor(i); } catch {}
    for (const b of bl) if (!usedBlocks.has(i + ':' + b.id) && normText(b.text).replace(/\s+/g, ' ').includes(target)) closed.push({ page: i, b });
  }
  const n = opened.length + closed.length; if (!n) return;
  modal(`<h2>El mismo dato aparece en otras partes</h2><p>«${esc(text.slice(0, 80))}» aparece en <strong>${n}</strong> párrafo(s) más del documento.</p><p class="muted">¿Usar el campo «${esc(f.label)}» también ahí? Así se llena una sola vez.</p>
    <div class="actions"><button class="secondary" id="mCancel">No</button><button class="primary" id="mOk">Sí, en todas</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    closeModal();
    await step('Marcando el campo en el documento…', async () => {
      const keep = ed.current; let count = 0;
      const byPage = {}; for (const c of closed) (byPage[c.page] ||= []).push(c.b);
      for (const [p, bl] of Object.entries(byPage)) { const os = await openBlocks(Number(p), bl); for (const o of os) count += wrapText(o, text, f.id); }
      for (const { o } of opened) count += wrapText(o, text, f.id);
      if (ed.current !== keep) window.editor.goto(keep);
      for (let i = 0; i < ed.count; i++) renderOverlaysFor(i);
      ed.tpl.dirty = true; setDirty(true); renderPanel();
      toast(`Campo «${f.label}» agregado en ${count} lugar(es) más.`);
    });
  };
}


// ============================================================================
// Detectar campos con IA: el asistente lee el documento y propone los campos;
// el usuario revisa la lista y se marcan todas las apariciones de una vez.
// ============================================================================
const DETECT_PROMPT = (text) => `VARIABLES
Este documento se va a convertir en una plantilla reutilizable. Identifica los DATOS VARIABLES: lo que cambia de un contrato a otro (nombres de las partes, RUT, domicilios, fechas, montos, plazos, direcciones de inmuebles, correos, teléfonos, números de cuotas…). NO incluyas texto fijo del contrato (cláusulas, títulos, nombres de leyes, roles como "el ARRENDADOR").
Devuelve un objeto JSON:
{"campos": [{"etiqueta": "nombre corto y claro, ej. 'Arrendatario: nombre'",
  "tipo": "texto|rut|fecha|monto|numero|email|telefono|parrafo",
  "apariciones": ["texto EXACTO como aparece en el documento (mismas mayúsculas y puntos); incluye cada forma distinta en que aparece el mismo dato"],
  "firmante": {"rol": "ej. Arrendatario", "dato": "fullName|rut|email|phone"} o null}]}
Reglas: cada aparición debe estar copiada literalmente del documento y ser solo el dato (sin "don", "RUT", ni puntuación alrededor); un mismo dato = un solo campo aunque aparezca varias veces; usa el mismo "rol" para los datos de la misma persona; máximo 40 campos.
Documento:
<<<
${text}
>>>`;

async function detectWithAi() {
  if (!window.isMember()) return window.members(detectWithAi, 'Detectar campos con IA es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta.');
  const A = window.Asistente; if (!A) return;
  if (ed.editing) stopEditing();
  const s = await A.status(true);
  if (!s.hasKey) return toast('El asistente no está configurado. Abre «Asistente» → Ajustes.', 5000);
  if (!(await A.ensureConsent())) return;
  const T = ed; let list = null;
  await step('La IA está buscando los datos variables del documento…', async () => {
    const { text } = await A.docText();
    if (!text.replace(/\[Página \d+\]/g, '').trim()) throw new Error('El documento no tiene texto legible. Si es una fotocopia, usa primero «Reconocer texto».');
    const out = A.parseJson(await A.ask({ action: 'detect', system: A.SYSTEM, messages: [{ role: 'user', content: DETECT_PROMPT(text) }], json: true }));
    const flat = normText(text).replace(/\s+/g, ' ');
    const taken = new Set(T.tpl.def.fields.flatMap((f) => [normText(f.sample || '').trim()]));
    list = (Array.isArray(out.campos) ? out.campos : []).map((c) => {
      const aps = [...new Set((c.apariciones || []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 2))]
        .filter((x) => flat.includes(normText(x)) && !taken.has(normText(x)));
      if (!aps.length || !c.etiqueta) return null;
      const g = guessField(aps[0]); const type = FIELD_TYPES[c.tipo] ? c.tipo : g.type;
      const signer = c.firmante && c.firmante.rol && SIGNER_ATTRS[c.firmante.dato] ? { role: String(c.firmante.rol).trim(), attr: c.firmante.dato } : null;
      return { label: String(c.etiqueta).trim().slice(0, 60), type, format: type === g.type ? g.format || {} : {}, aps, signer, on: true };
    }).filter(Boolean);
  });
  if (!list || ed !== T) return;
  if (!list.length) return toast('La IA no encontró datos variables nuevos en el documento.', 5000);
  modal(`<h2>${icon('sparkle', 18)} Campos detectados</h2>
    <p class="muted small">Revisa la lista: desmarca lo que no deba cambiar y corrige los nombres. Después puedes editar cada campo.</p>
    <div class="ai-detect">${list.map((c, n) => `<label class="ai-det"><input type="checkbox" data-n="${n}" checked />
      <span><input class="ai-det-lbl" data-l="${n}" value="${esc(c.label)}" /><em>${FIELD_TYPES[c.type]}${c.signer ? ` · firmante «${esc(c.signer.role)}»` : ''}</em>
      <small>${c.aps.map((x) => '«' + esc(x.slice(0, 60)) + '»').join(' · ')}</small></span></label>`).join('')}</div>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Crear campos</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    document.querySelectorAll('.ai-det input[type=checkbox]').forEach((b) => (list[b.dataset.n].on = b.checked));
    document.querySelectorAll('.ai-det-lbl').forEach((i) => { const v = i.value.trim(); if (v) list[i.dataset.l].label = v; });
    closeModal();
    await applyDetected(list.filter((c) => c.on));
  };
}

// Crea los campos y marca todas sus apariciones (primero los textos más largos, para que
// «MARIA GONZALEZ ROJAS» no quede partido por un campo «MARIA»).
async function applyDetected(list, { quiet = false } = {}) {
  if (!list.length) return { made: 0, missing: [] };
  let made = 0, marks = 0; const missing = [];
  await step('Marcando los campos en el documento…', async () => {
    if (!quiet) snapshot();
    const keep = ed.current;
    const fields = list.map((c) => { const f = { id: newFieldId(), sample: c.aps[0], label: c.label, type: c.type, format: c.format, required: true, signer: c.signer }; return { f, c }; });
    const jobs = fields.flatMap(({ f, c }) => c.aps.map((text) => ({ f, text }))).sort((a, b) => b.text.length - a.text.length);
    const hits = new Map();
    for (const { f, text } of jobs) {
      const target = normText(text).replace(/\s+/g, ' ');
      const usedBlocks = new Set(allOverlays().map(({ page, o }) => page + ':' + o.blockId));
      for (let i = 0; i < ed.count; i++) {
        let bl = []; try { bl = await blocksFor(i); } catch {}
        const closed = bl.filter((b) => !usedBlocks.has(i + ':' + b.id) && normText(b.text).replace(/\s+/g, ' ').includes(target));
        if (closed.length) await openBlocks(i, closed);
        for (const o of ed.overlays[i] || []) if (o.type === 'rich' && !o.locked) { const k = wrapText(o, text, f.id); if (k) hits.set(f.id, (hits.get(f.id) || 0) + k); }
      }
    }
    for (const { f, c } of fields) {
      if (hits.get(f.id)) { ed.tpl.def.fields.push(f); made++; marks += hits.get(f.id); } else missing.push(c.label);
    }
    if (ed.current !== keep) window.editor.goto(keep);
    for (let i = 0; i < ed.count; i++) renderOverlaysFor(i);
    ed.tpl.dirty = true; setDirty(true); renderPanel();
  });
  if (!quiet) toast(`${made} campo(s) creados en ${marks} lugar(es).${missing.length ? ` No pude ubicar: ${missing.join(', ')} (márcalos a mano).` : ' Revisa la lista y guarda la plantilla.'}`, 7000);
  return { made, missing };
}

// ============================================================================
// Documento redactado por la IA → se abre directo como formulario
// (si `T0` viene, se rehace en esa misma pestaña conservando los datos ya escritos)
// ============================================================================
async function buildAiDoc(spec, T0) {
  const A = window.Asistente; let ok = false; const prev = ed;
  const old = T0?.tpl ? Object.fromEntries(T0.tpl.def.fields.map((f) => [f.label, T0.tpl.values[f.id]]).filter(([, v]) => v != null && v !== '')) : {};
  await step(T0 ? 'Actualizando el documento…' : 'Preparando el formulario…', async () => {
    const r = await pf.aiDraftPdf(A._specHtml(spec), spec.titulo.slice(0, 60)); if (!r.ok) throw new Error(r.error);
    let T = T0;
    if (!T) { T = newState(); tabs.push(T); ed = T; window.studio?.goEditor(); }
    else { ed = T; if (ed.editing) stopEditing(); T.overlays = {}; T.tpl = null; T.blocks = {}; T.ocr = {}; }
    T.name = spec.titulo.charAt(0) + spec.titulo.slice(1).toLowerCase() + '.pdf'; T.path = null;
    await setBytes(new Uint8Array(r.data.bytes), { keepPage: !!T0, structural: true });
    // marcar los [Etiqueta] del texto como campos
    T.tpl = { mode: 'design', def: { name: spec.titulo, fields: [] } };
    const inText = spec.campos.filter((c) => !c.solo_formulario);
    const list = inText.map((c) => {
      const type = FIELD_TYPES[c.tipo] ? c.tipo : 'texto';
      const format = type === 'monto' ? { words: true } : type === 'fecha' ? { date: 'largo' } : type === 'numero' ? { words: false } : { case: 'normal' };
      return { label: c.etiqueta, type, format, aps: ['[' + c.etiqueta + ']'], signer: c.firmante ? { role: c.firmante.rol, attr: c.firmante.dato } : null, on: true };
    });
    const res = await applyDetected(list, { quiet: true });
    if (res.missing.length) console.warn('campos sin ubicar', res.missing);
    const extra = spec.campos.filter((c) => c.solo_formulario).map((c) => ({ id: newFieldId(), label: c.etiqueta, type: FIELD_TYPES[c.tipo] ? c.tipo : 'texto', format: {}, required: c.tipo === 'email' ? false : true, signer: c.firmante ? { role: c.firmante.rol, attr: c.firmante.dato } : null, sample: '' }));
    for (const f of T.tpl.def.fields) f.sample = ''; // el ejemplo es solo «[Etiqueta]»
    const tpl = { v: 1, app: 'PortalFirma Studio', name: spec.titulo, fields: [...T.tpl.def.fields, ...extra], blocks: templateBlocks() };
    await materialize(tpl, 'fill');
    for (const f of T.tpl.def.fields) {
      const c = spec.campos.find((x) => x.etiqueta === f.label);
      const v = old[f.label] ?? (c?.valor != null ? String(c.valor) : null);
      if (v != null && v !== '') T.tpl.values[f.id] = f.type === 'fecha' && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? '' : String(v).replace(f.type === 'monto' ? /[^\d]/g : /^$/, '');
    }
    T.aiDoc = spec;
    T.notice = spec.modelo ? `Documento basado en el modelo «${spec.modelo.nombre}» de Portalfirma. Completa los datos en el panel derecho. Las firmas se agregan al enviar a firmar.` : 'Documento redactado por el asistente. Completa los datos en el panel derecho y revisa el texto antes de firmar. Las firmas se agregan al enviar a firmar.';
    const host = $('#edPanel'); if (host) host.dataset.built = '';
    await activate();
    await applyValues(true);
    ok = true;
  });
  if (!ok && !T0 && ed !== prev && !ed.bytes) { const i = tabs.indexOf(ed); if (i >= 0) tabs.splice(i, 1); ed = tabs.includes(prev) ? prev : (tabs[tabs.length - 1] || newState()); await activate(); }
  return ok;
}

// ---------- Guardar ----------
function templateBlocks() {
  const blocks = [];
  for (const { page, o } of allOverlays()) {
    if (o.type !== 'rich' || !fieldsIn(o.html).length) continue;
    const el = document.querySelector(`.ov[data-id="${o.id}"]`); if (el) syncRichHeight(o, el);
    const { id, tplHtml, locked, baseSize, maxBottom, ...rest } = o; void id; void tplHtml; void locked; void baseSize; void maxBottom;
    blocks.push({ page, o: JSON.parse(JSON.stringify(rest)) });
  }
  return blocks;
}
async function saveTemplate() {
  if (ed.editing) stopEditing();
  const blocks = templateBlocks();
  const used = new Set(blocks.flatMap((b) => fieldsIn(b.o.html)));
  const fields = ed.tpl.def.fields.filter((f) => used.has(f.id));
  if (!fields.length) return toast('Agrega al menos un campo antes de guardar la plantilla.', 4000);
  modal(`<h2>Guardar plantilla</h2><label>Nombre<input id="tName" value="${esc(ed.tpl.def.name || baseName())}" /></label>
    <p class="muted small">${fields.length} campo(s) en ${blocks.length} párrafo(s). Queda en «Mis plantillas» en el inicio.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const name = $('#tName').value.trim() || 'Plantilla'; closeModal();
    if (name !== ed.tpl.def.saved && (await pf.tplExists(name)).data) {
      const go = await new Promise((res) => { modal(`<h2>Ya existe «${esc(name)}»</h2><p>¿Reemplazar la plantilla guardada?</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Reemplazar</button></div>`); $('#mCancel').onclick = () => { closeModal(); res(false); }; $('#mOk').onclick = () => { closeModal(); res(true); }; });
      if (!go) return;
    }
    await step('Guardando plantilla…', async () => {
      const tpl = { v: 1, app: 'PortalFirma Studio', name, fields, blocks };
      const doc = await loadLib(await bakeDoc(false));
      await doc.attach(new TextEncoder().encode(JSON.stringify(tpl)), TPL_FILE, { mimeType: 'application/json', description: 'Plantilla de PortalFirma Studio', creationDate: new Date(), modificationDate: new Date() });
      const bytes = await saveLib(doc);
      const r = await pf.tplSave(name, bytes, { fields: fields.length, pages: ed.count, signers: [...new Set(fields.filter((f) => f.signer).map((f) => f.signer.role))] });
      if (!r.ok) throw new Error(r.error);
      ed.tpl.def.name = name; ed.tpl.def.saved = name; ed.tpl.dirty = false; ed.tpl.file = r.data; renderPanel();
      modal(`<h2>Plantilla guardada</h2><p>«${esc(name)}» está en <strong>Mis plantillas</strong>, en el inicio.</p>
        <div class="actions"><button class="secondary" id="mExp">Exportar archivo…</button><button class="secondary" id="mCancel">Seguir editando</button><button class="primary" id="mOk">Llenar ahora</button></div>`);
      $('#mCancel').onclick = closeModal;
      $('#mExp').onclick = async () => { closeModal(); await pf.edSaveAs(bytes, name + ' (plantilla).pdf'); };
      $('#mOk').onclick = () => { closeModal(); openTemplateFile(r.data, 'fill'); };
    });
  };
}

// ============================================================================
// Abrir una plantilla (para llenarla o editarla)
// ============================================================================
async function readTemplate(pdfDoc) {
  try {
    const at = await pdfDoc.getAttachments(); if (!at) return null;
    const a = Object.values(at).find((x) => x.filename === TPL_FILE) || at[TPL_FILE];
    if (!a) return null;
    const t = JSON.parse(new TextDecoder().decode(a.content));
    return t && Array.isArray(t.fields) && Array.isArray(t.blocks) ? t : null;
  } catch { return null; }
}
async function openTemplateFile(file, mode) {
  const r = await pf.tplRead(file); if (!r.ok) return toast(r.error, 5000);
  return openTemplateBytes(r.data, mode);
}
async function openTemplateBytes(bytes, mode, tplKnown) {
  let ok = false; const prev = ed; let T = null;
  await step('Abriendo plantilla…', async () => {
    T = newState(); tabs.push(T); ed = T; window.studio?.goEditor();
    await setBytes(new Uint8Array(bytes), { keepPage: false, structural: true });
    const tpl = tplKnown || await readTemplate(T.pdf);
    if (!tpl) throw new Error('Este archivo no es una plantilla de PortalFirma Studio.');
    T.name = tpl.name + (mode === 'fill' ? '' : ' (plantilla)') + '.pdf';
    await materialize(tpl, mode);
    ok = true;
  });
  if (!ok && T && tabs.includes(T)) { tabs.splice(tabs.indexOf(T), 1); ed = tabs.includes(prev) ? prev : (tabs[tabs.length - 1] || newState()); await activate(); }
  return ok;
}
// Borra del PDF el texto de ejemplo de los párrafos con campos y los vuelve objetos de texto.
async function materialize(tpl, mode) {
  const T = ed; const byPage = {};
  for (const b of tpl.blocks) (byPage[b.page] ||= []).push(b);
  T.overlays = {};
  for (const [p, list] of Object.entries(byPage)) {
    const page = Number(p);
    const rects = list.map(({ o }) => { const c = o.cover || o; const x = Math.min(c.x, o.x), y = Math.min(c.y, o.y); return { x, y, w: Math.max(c.x + c.w, o.x + o.w) - x, h: Math.max(c.y + c.h, o.y + o.h) - y }; });
    try { await removeOriginal(page, rects); } catch (e) { console.warn(e); }
  }
  // espacio libre bajo cada párrafo (hasta el siguiente texto o el margen inferior)
  for (const [p, list] of Object.entries(byPage)) {
    const page = Number(p); const v = await vp1(page);
    let others = []; try { others = await detectDigitalBlocks(page); } catch {}
    for (const b of list) {
      const o = { ...JSON.parse(JSON.stringify(b.o)), id: 'o' + (++uid), transparent: true };
      const bottom = Math.max(o.y + o.h, o.cover ? o.cover.y + o.cover.h : 0);
      // lo que hay debajo: texto que quedó en el PDF y los otros párrafos de la plantilla
      const boxes = [...others.map((x) => x.box), ...list.filter((x) => x !== b).map((x) => x.o.cover || x.o)];
      const below = boxes.filter((q) => q.y >= bottom - 2 && q.x < o.x + o.w && q.x + q.w > o.x).map((q) => q.y);
      o.maxBottom = (below.length ? Math.min(...below) - 2 : v.height - 36);
      if (mode === 'fill') { o.tplHtml = o.html; o.locked = true; o.baseSize = o.size; }
      (T.overlays[page] ||= []).push(o);
    }
  }
  T.tpl = { mode, def: { name: tpl.name, fields: tpl.fields, saved: tpl.name }, values: {}, status: {}, src: tpl };
  T.undo = []; T.dirty = false;
  if (mode === 'design') setTool('edittext'); else setTool('select');
  for (let i = 0; i < T.count; i++) renderOverlaysFor(i);
  if (mode === 'fill') await applyValues(true);
  renderPanel(); setDirty(false);
}
// Al abrir un PDF cualquiera: si trae una plantilla, se ofrece llenarla.
async function checkOpened(T) {
  const tpl = await readTemplate(T.pdf); if (!tpl || ed !== T) return;
  modal(`<h2>${icon('template', 18)} Plantilla «${esc(tpl.name)}»</h2><p>Este PDF es una plantilla con <strong>${tpl.fields.length}</strong> campo(s).</p>
    <div class="actions"><button class="secondary" id="mCancel">Ver como PDF</button><button class="secondary" id="mEd">Editar plantilla</button><button class="primary" id="mOk">Llenar</button></div>`);
  $('#mCancel').onclick = closeModal;
  const go = async (mode) => { closeModal(); T.name = tpl.name + (mode === 'fill' ? '' : ' (plantilla)') + '.pdf'; T.path = null; await step('Abriendo plantilla…', () => materialize(tpl, mode)); };
  $('#mEd').onclick = () => go('design'); $('#mOk').onclick = () => go('fill');
}

// ============================================================================
// Llenado
// ============================================================================
function substitute(html, final) {
  const d = document.createElement('div'); d.innerHTML = html;
  d.querySelectorAll('.pf-field').forEach((sp) => {
    const f = ed.tpl.def.fields.find((x) => x.id === sp.dataset.field); if (!f) return;
    const r = formatField(f, ed.tpl.values[f.id]);
    sp.textContent = r.text || (final ? '' : `[${f.label}]`);
    sp.classList.toggle('pf-empty', !r.text);
    if (['rut', 'telefono', 'email', 'numero'].includes(f.type)) sp.classList.add('pf-nowrap'); // un RUT no se corta entre líneas
    sp.classList.toggle('pf-bad', !final && !!ed.tpl.status[f.id]?.overflow);
    if (final) { sp.removeAttribute('contenteditable'); }
  });
  return d.innerHTML;
}
let fitTimer = null;
async function applyValues(now) {
  const T = ed; if (T.tpl?.mode !== 'fill') return;
  for (const { o } of allOverlays()) if (o.tplHtml) o.html = substitute(o.tplHtml, false);
  for (let i = 0; i < T.count; i++) renderOverlaysFor(i);
  clearTimeout(fitTimer);
  const run = async () => { if (ed !== T) return; await fitAll(); for (const { o } of allOverlays()) if (o.tplHtml) o.html = substitute(o.tplHtml, false); for (let i = 0; i < T.count; i++) renderOverlaysFor(i); updateFillStatus(); };
  if (now) await run(); else fitTimer = setTimeout(run, 200);
}
// Reglas para que no se descomponga: reacomodar en el párrafo, usar el blanco de abajo, achicar hasta medio punto, si no avisar.
async function fitAll() {
  const T = ed; const st = {};
  for (const f of T.tpl.def.fields) st[f.id] = { overflow: false };
  for (const { o } of allOverlays()) {
    if (!o.tplHtml) continue;
    o.size = o.baseSize; o.shrunk = 0; o.overflow = false;
    const limit = o.maxBottom - o.y;
    const measure = async () => { const tmp = { ...o, html: substitute(o.tplHtml, true) }; return (await layoutRich(tmp)).height; };
    let h = await measure();
    if (h > limit + 0.5) {
      for (const d of [0.25, MAX_SHRINK]) { o.size = o.baseSize - d; h = await measure(); if (h <= limit + 0.5) { o.shrunk = d; break; } }
      if (h > limit + 0.5) {
        o.size = o.baseSize; o.overflow = true;
        // se marca el dato que creció respecto del ejemplo (si ninguno, todos los del párrafo)
        const ids = [...new Set(fieldsIn(o.tplHtml))];
        const grown = ids.filter((id) => { const f = T.tpl.def.fields.find((x) => x.id === id); return f && formatField(f, T.tpl.values[id]).text.length > (f.sample || '').length + 2; });
        for (const id of grown.length ? grown : ids) st[id].overflow = true;
      }
    }
  }
  T.tpl.status = st;
}
function fillPanel(host) {
  const t = ed.tpl; const fs = t.def.fields;
  const input = (f) => {
    const v = esc(t.values[f.id] ?? '');
    if (f.type === 'fecha') return `<div class="prow"><input type="date" data-in="${f.id}" value="${v}" /><button class="ghost small fixed" data-today="${f.id}">Hoy</button></div>`;
    if (f.type === 'opcion') return `<select data-in="${f.id}"><option value="">— Elegir —</option>${(f.options || []).map((x) => `<option ${x === t.values[f.id] ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    if (f.type === 'parrafo') return `<textarea data-in="${f.id}" rows="3">${v}</textarea>`;
    const ph = { rut: '12.345.678-9', monto: '500000', numero: '12', email: 'nombre@correo.cl', telefono: '9 1234 5678' }[f.type] || esc(f.sample || '');
    return `<input data-in="${f.id}" value="${v}" placeholder="${ph}" ${['monto', 'numero', 'telefono'].includes(f.type) ? 'inputmode="numeric"' : ''} spellcheck="false" />`;
  };
  const groups = []; const seen = new Set();
  for (const f of fs) { const g = f.signer ? 'Firmante: ' + f.signer.role : 'Datos del documento'; if (!seen.has(g)) { seen.add(g); groups.push(g); } }
  host.innerHTML = `<div class="sec tpl-fill"><h4>${icon(ed.aiDoc ? 'sparkle' : 'template', 13)} ${ed.aiDoc ? 'Completar documento' : 'Llenar plantilla'}</h4><div class="tpl-title">${esc(t.def.name)}</div>
      <p class="hint">Completa los datos: el documento se actualiza mientras escribes. Los campos con * son obligatorios.</p>
      ${groups.map((g) => `<div class="tpl-group"><div class="tpl-gname">${esc(g)}</div>${fs.filter((f) => (f.signer ? 'Firmante: ' + f.signer.role : 'Datos del documento') === g).map((f) => `<label class="tf" data-f="${f.id}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input(f)}<em class="err"></em></label>`).join('')}</div>`).join('')}
      <div class="tpl-status" id="tplStatus"></div>
      <button class="primary pbtn" id="tplGen">${icon('file', 15)} Generar documento</button>
      <button class="ghost small" id="tplToDesign">${ed.aiDoc ? 'Guardar como plantilla…' : 'Editar plantilla'}</button></div>${ed.aiDoc && window.Asistente ? window.Asistente.aiDocSection() : ''}`;
  if (ed.aiDoc && window.Asistente) window.Asistente.bindAiDoc(host);
  host.querySelectorAll('[data-in]').forEach((el) => {
    const id = el.dataset.in;
    el.addEventListener('input', () => { t.values[id] = el.value; applyValues(); showErr(id, false); });
    el.addEventListener('change', () => { t.values[id] = el.value; applyValues(); showErr(id, true); });
    el.addEventListener('blur', () => showErr(id, true));
  });
  host.querySelectorAll('[data-today]').forEach((b) => (b.onclick = () => { const d = new Date(); const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; t.values[b.dataset.today] = v; host.querySelector(`[data-in="${b.dataset.today}"]`).value = v; applyValues(); showErr(b.dataset.today, true); }));
  host.querySelector('#tplGen').onclick = generate;
  host.querySelector('#tplToDesign').onclick = () => { const tpl = t.src; materialize(tpl, 'design'); };
  updateFillStatus();
}
function showErr(id, strict) {
  const f = ed.tpl.def.fields.find((x) => x.id === id); const lab = document.querySelector(`.tf[data-f="${id}"]`); if (!f || !lab) return;
  const r = formatField(f, ed.tpl.values[id]); const of = ed.tpl.status[id]?.overflow;
  const msg = of ? 'No cabe en el espacio del documento: acorta el dato' : (r.error && (strict || !r.empty) && !(r.empty && !strict)) ? r.error : '';
  lab.querySelector('.err').textContent = msg; lab.classList.toggle('bad', !!msg);
}
function updateFillStatus() {
  const t = ed.tpl; if (!t || t.mode !== 'fill') return;
  for (const f of t.def.fields) if (t.status[f.id]?.overflow || document.querySelector(`.tf[data-f="${f.id}"].bad`)) showErr(f.id, false);
  const s = $('#tplStatus'); if (!s) return;
  const filled = t.def.fields.filter((f) => !formatField(f, t.values[f.id]).empty).length;
  const shr = allOverlays().filter(({ o }) => o.shrunk).length, ovf = allOverlays().filter(({ o }) => o.overflow).length;
  s.innerHTML = `${filled} de ${t.def.fields.length} campos completos${shr ? ` · ${shr} párrafo(s) con la letra ajustada para que quepa` : ''}${ovf ? ` · <b class="bad">${ovf} párrafo(s) no caben</b>` : ''}`;
}
function focusField(id) { const el = document.querySelector(`[data-in="${id}"]`); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } }

function signersFromValues() {
  const t = ed.tpl; const by = new Map();
  for (const f of t.def.fields) {
    if (!f.signer) continue; const r = formatField(f, t.values[f.id]); if (!r.text) continue;
    const s = by.get(f.signer.role) || { alias: f.signer.role, fullName: '', rut: '', email: '', phone: '' };
    s[f.signer.attr] = f.signer.attr === 'phone' ? r.text.replace(/\s/g, '') : r.text; by.set(f.signer.role, s);
  }
  return [...by.values()];
}
async function generate() {
  const t = ed.tpl; await fitAll();
  let bad = 0;
  for (const f of t.def.fields) { showErr(f.id, true); if (document.querySelector(`.tf[data-f="${f.id}"].bad`)) bad++; }
  updateFillStatus();
  if (bad) { toast(`Revisa ${bad} campo(s) marcado(s) en rojo.`, 4000); document.querySelector('.tf.bad [data-in]')?.focus(); return; }
  const src = ed; const signers = signersFromValues();
  const first = t.def.fields.find((f) => f.type === 'texto' && t.values[f.id]);
  const name = `${t.def.name}${first ? ' - ' + formatField(first, t.values[first.id]).text : ''}`.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.pdf';
  const overlays = {};
  for (const [p, list] of Object.entries(src.overlays)) overlays[p] = list.map((o) => { const c = { ...o, cover: o.cover && { ...o.cover } }; if (o.tplHtml) { c.html = substitute(o.tplHtml, true); delete c.tplHtml; delete c.locked; } return c; });
  await step('Generando documento…', async () => {
    const T = newState(); T.name = name; tabs.push(T); ed = T; window.studio?.goEditor();
    await setBytes(src.bytes.slice(), { keepPage: false });
    T.overlays = overlays; T.signers = signers;
    await bakeAll();
    T.dirty = true;
    T.notice = `Documento generado desde la plantilla «${t.def.name}». Revísalo y guárdalo o presiona «Enviar a firmar»${signers.length ? ` (los ${signers.length} firmante(s) ya vienen cargados)` : ''}.`;
    await activate();
  });
}

// ============================================================================
// Mis plantillas (inicio)
// ============================================================================
async function librarySection() {
  const r = await pf.tplList(); const list = r.ok ? r.data : [];
  const fmtD = (iso) => { try { return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };
  return `<div class="recent-head" id="tplLib"><h3>Mis plantillas</h3><span class="muted small">Abre un contrato y usa «Plantilla» para crear una</span><button class="secondary small with-ic" id="tplDrive">${icon('drive', 15)}<span>Importar de Google Drive</span></button></div>
    <div class="recent-list tpl-lib">${list.length ? list.map((x) => `<div class="recent-item tpl-item" data-file="${esc(x.file)}">
        <span class="fi tpl">${icon('template', 18)}</span><span><div class="nm">${esc(x.name)}</div><div class="pt">${x.fields} campo(s)${x.signers?.length ? ' · firmantes: ' + esc(x.signers.join(', ')) : ''}</div></span>
        <span class="muted small">${fmtD(x.updated)}</span>
        <span class="tpl-acts"><button class="primary small" data-fill>Llenar</button><button class="ghost small" data-edit>Editar</button><button class="ghost small" data-exp title="Guardar una copia para compartir">Exportar</button><button class="ibtn danger" data-del title="Eliminar">${icon('trash', 15)}</button></span></div>`).join('')
      : '<div class="recent-empty">Aún no tienes plantillas. Abre uno de tus contratos, presiona <strong>Plantilla</strong> y marca los datos que cambian.</div>'}</div>`;
}
function bindLibrary(root, rerender) {
  const dr = root.querySelector('#tplDrive'); if (dr) dr.onclick = () => driveDialog();
  root.querySelectorAll('.tpl-item').forEach((it) => {
    const file = it.dataset.file;
    it.onclick = (e) => {
      if (e.target.closest('[data-edit]')) return openTemplateFile(file, 'design');
      if (e.target.closest('[data-exp]')) return (async () => { const r = await pf.tplRead(file); if (r.ok) pf.edSaveAs(r.data, file.split(/[\\/]/).pop().replace(/\.pdf$/, ' (plantilla).pdf')); })();
      if (e.target.closest('[data-del]')) {
        modal(`<h2>Eliminar plantilla</h2><p>¿Eliminar «${esc(it.querySelector('.nm').textContent)}» de Mis plantillas? Los documentos ya generados no se afectan.</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mOk">Eliminar</button></div>`);
        $('#mCancel').onclick = closeModal; $('#mOk').onclick = async () => { closeModal(); await pf.tplDelete(file); rerender(); };
        return;
      }
      return openTemplateFile(file, 'fill');
    };
  });
}

// ============================================================================
// Importar desde Google Drive: elegir un Word, Google Docs o PDF y convertirlo en plantilla
// ============================================================================
const DRIVE_KIND = { 'application/vnd.google-apps.document': 'Google Docs', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word', 'application/msword': 'Word', 'application/pdf': 'PDF' };
// Google Drive: el explorador vive en drive.js; desde aquí se abre para convertir un documento en plantilla
function driveDialog() { return window.Drive.open({ purpose: 'template' }); }
async function importFromDrive(f) {
  let file = null;
  await step(`Descargando «${f.name}» desde Google Drive…`, async () => { const r = await pf.driveDownload(f.id); if (!r.ok) throw new Error(r.error); file = r.data; });
  if (!file) return;
  const before = tabs.length;
  await window.editor.openPaths([file], true);
  if (tabs.length === before && !ed.bytes) return;
  enterDesign();
  modal(`<h2>${icon('template', 18)} «${esc(f.name)}» importado</h2><p>Ahora marca los datos que cambian para convertirlo en plantilla.</p>
    <p class="muted">¿Quieres que la IA detecte los campos (nombres, RUT, fechas, montos…)?</p>
    <div class="actions"><button class="secondary" id="mCancel">Los marco yo</button><button class="primary" id="mOk">${icon('sparkle', 15)} Detectar con IA <small class="tk-cost">2 tokens</small></button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => { closeModal(); detectWithAi(); };
}

window.Plantillas = { driveDialog, importFromDrive, buildAiDoc, detectWithAi, _applyDetected: applyDetected, enterDesign, exitDesign, designSection, bindDesign, fillPanel, focusField, checkOpened, openTemplateFile, openTemplateBytes, librarySection, bindLibrary,
  _formatField: formatField, _numeroALetras: numeroALetras, _montoEnPalabras: montoEnPalabras, _guessField: guessField, _wrapText: wrapText };
