/* global pf, $, esc, toast, modal, closeModal, icon, show, api, startAnalysis */
'use strict';
(() => { // módulo aislado
// ============================================================================
// Expedientes: una carpeta por caso (propiedad, persona, empresa, trámite) con sus documentos
// (contratos, cédulas, fotos…) y su historial. Se guarda en el computador o en Google Drive.
// Los archivos se eligen aquí y se usan en Studio: abrir, combinar, enviar a firmar, agregar a Plazos.
// ============================================================================
const X = { list: [], sel: null, files: [], pick: new Set(), tab: 'docs', q: '', hist: [], ops: null, loading: false };
const TYPES = { propiedad: ['Propiedad', 'home'], persona: ['Persona', 'user'], empresa: ['Empresa', 'building'], tramite: ['Trámite', 'listCheck'], otro: ['Otro', 'folder'] };
const ic = (t) => icon(TYPES[t]?.[1] || 'folder', 18);
const fmtD = (iso) => { try { return new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');
const ext = (n) => String(n).split('.').pop().toLowerCase();
const KIND = (n) => (ext(n) === 'pdf' ? ['PDF', 'file'] : /^(docx?|odt|rtf)$/.test(ext(n)) ? ['Word', 'textEdit'] : /^(xlsx?|csv|ods)$/.test(ext(n)) ? ['Planilla', 'grid'] : /^(jpe?g|png|heic|webp|gif)$/.test(ext(n)) ? ['Imagen', 'image'] : ['Archivo', 'file']);
const usable = (n) => /^(pdf|docx?|xlsx?|csv|ods|jpe?g|png|webp)$/.test(ext(n)); // lo que Studio sabe abrir

async function open(id) {
  show('expedientes'); render();
  const r = await pf.expList(); if (r.ok) X.list = r.data;
  if (id) X.sel = id; else if (!X.sel && X.list.length) X.sel = X.list[0].id;
  paintList(); if (X.sel) select(X.sel); else paintDetail();
}

function render() {
  $('#view-expedientes').innerHTML = `<div class="bulk xp">
    <div class="ops-head"><div><h2>Expedientes</h2><span class="muted small">Una carpeta por caso con todos sus documentos (contratos, cédulas, fotos…) y su historial. En tu computador o en Google Drive.</span></div>
      <div class="ops-head-r"><button class="primary small with-ic" id="xpNew">${icon('plus', 15)}<span>Nuevo expediente</span></button></div></div>
    <div class="xp-grid"><div class="xp-side"><div class="ops-search">${icon('search', 14)}<input id="xpQ" placeholder="Buscar expediente…" value="${esc(X.q)}" /></div><div class="xp-list" id="xpList"></div></div>
      <div class="xp-detail" id="xpDetail"></div></div></div>`;
  $('#xpNew').onclick = () => createDialog();
  $('#xpQ').oninput = (e) => { X.q = e.target.value; paintList(); };
  $('#xpList').onclick = (e) => { const r = e.target.closest('[data-x]'); if (r) select(r.dataset.x); };
}
function paintList() {
  const host = $('#xpList'); if (!host) return;
  const q = X.q.trim().toLowerCase(); const list = X.list.filter((x) => !q || x.name.toLowerCase().includes(q));
  host.innerHTML = list.length ? list.map((x) => `<button class="xp-item ${X.sel === x.id ? 'on' : ''}" data-x="${x.id}"><span class="xp-ic t-${x.type}">${ic(x.type)}</span>
      <span class="xp-tx"><b>${esc(x.name)}</b><small>${esc(TYPES[x.type]?.[0] || 'Otro')} · ${x.storage === 'drive' ? 'Google Drive' : 'Este computador'}${x.count != null ? ` · ${x.count} archivo${x.count === 1 ? '' : 's'}` : ''}</small></span></button>`).join('')
    : `<div class="ops-empty small"><p>${X.list.length ? 'Sin resultados.' : 'Todavía no tienes expedientes.'}</p></div>`;
}
async function select(id) {
  X.sel = id; X.pick = new Set(); X.files = []; paintList(); X.loading = true; paintDetail();
  const [f, h] = await Promise.all([pf.expFiles(id), pf.expHistory(id)]);
  X.loading = false;
  if (!f.ok) { X.err = f.error; X.files = []; } else { X.err = ''; X.files = f.data; }
  X.hist = h.ok ? h.data : [];
  const l = await pf.expList(); if (l.ok) { X.list = l.data; paintList(); }
  paintDetail();
}
function paintDetail() {
  const host = $('#xpDetail'); if (!host) return;
  const e = X.list.find((x) => x.id === X.sel);
  if (!e) {
    host.innerHTML = `<div class="ops-empty"><div>${icon('folderOpen', 38)}<p><b>Ordena tus documentos por caso.</b><br>Ej.: «Depto Calle Nueva 120»: el contrato, las cédulas de las partes, fotos del inventario y lo que se envió a firmar.</p><button class="primary" id="xpNew2">${icon('plus', 15)} Crear mi primer expediente</button></div></div>`;
    const b = $('#xpNew2'); if (b) b.onclick = () => createDialog(); return;
  }
  const n = X.pick.size; const sel = X.files.filter((f) => X.pick.has(f.id));
  host.innerHTML = `<div class="xp-head"><span class="xp-ic big t-${e.type}">${ic(e.type)}</span><div class="xp-h-tx"><h3>${esc(e.name)}</h3>
      <div class="xp-chips"><span class="ops-chip muted">${esc(TYPES[e.type]?.[0] || 'Otro')}</span><span class="ops-chip ${e.storage === 'drive' ? 'run' : 'ok'}">${e.storage === 'drive' ? icon('drive', 12) + ' Google Drive' : icon('folder', 12) + ' Este computador'}</span>${e.notes ? `<span class="muted small">${esc(e.notes)}</span>` : ''}</div></div>
      <div class="xp-h-acts"><button class="ghost small with-ic" id="xpReveal">${icon('folderOpen', 14)}<span>Abrir carpeta</span></button><button class="ibtn" id="xpMore" title="Más opciones">${icon('settings', 15)}</button></div></div>
    <div class="ai-tabs xp-tabs"><button data-t="docs" class="${X.tab === 'docs' ? 'on' : ''}">Documentos${X.files.length ? ` (${X.files.length})` : ''}</button><button data-t="hist" class="${X.tab === 'hist' ? 'on' : ''}">Historial${X.hist.length ? ` (${X.hist.length})` : ''}</button></div>
    ${X.tab === 'docs' ? `
    <div class="xp-add"><button class="secondary small with-ic" id="xpAdd">${icon('upload', 14)}<span>Agregar desde el computador</span></button><button class="secondary small with-ic" id="xpDrive">${icon('drive', 14)}<span>Desde Google Drive</span></button><span class="muted small">o arrastra los archivos aquí (PDF, Word, Excel, fotos de cédulas…)</span></div>
    ${n ? `<div class="xp-selbar"><b>${n} seleccionado${n === 1 ? '' : 's'}</b>
      <button class="secondary small" data-do="open">Abrir en Studio</button>
      ${n > 1 ? '<button class="secondary small" data-do="combine">Combinar en un PDF</button>' : ''}
      <button class="secondary small" data-do="plazos">${icon('calendar', 13)} Agregar a Plazos</button>
      <button class="primary small" data-do="sign" data-member>${icon('sign', 13)} Enviar a firmar${n > 1 ? ` (${n})` : ''}</button>
      <button class="ghost small" data-do="none">Quitar selección</button></div>` : ''}
    <div class="xp-files" id="xpFiles">${X.loading ? '<p class="hint"><i class="bk-spin"></i> Cargando…</p>' : X.err ? `<p class="hint bad">${esc(X.err)}</p>` : X.files.length ? X.files.map((f) => { const [k, i] = KIND(f.name);
      return `<div class="xp-file ${X.pick.has(f.id) ? 'sel' : ''}" data-f="${esc(f.id)}"><input type="checkbox" ${X.pick.has(f.id) ? 'checked' : ''} ${usable(f.name) ? '' : 'disabled title="Studio no abre este tipo de archivo"'} />
        <span class="fi">${icon(i, 18)}</span><span class="xp-f-tx"><b>${esc(f.name)}</b><small>${k} · ${kb(f.size)} · ${fmtD(f.modified)}</small></span>
        <span class="xp-f-acts">${usable(f.name) ? `<button class="ghost small" data-fa="view">Ver</button>` : ''}<button class="ibtn" data-fa="rm" title="Enviar a la papelera">${icon('trash', 14)}</button></span></div>`; }).join('')
      : `<div class="ops-empty small"><p>Este expediente todavía no tiene archivos.</p></div>`}</div>`
    : `<div class="xp-hist">${X.hist.length ? X.hist.map(histRow).join('') : '<p class="hint">Sin movimientos todavía.</p>'}</div>`}`;
  host.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { X.tab = b.dataset.t; if (X.tab === 'hist') loadOps(); paintDetail(); }));
  $('#xpReveal').onclick = async () => { const r = await pf.expReveal(e.id); if (!r.ok) toast(r.error, 5000); };
  $('#xpMore').onclick = () => moreDialog(e);
  if (X.tab === 'hist') { host.querySelector('.xp-hist').onclick = (ev) => { const b = ev.target.closest('[data-op]'); if (b) { show('ops'); window.Operaciones.open().then(() => window.Operaciones.select(Number(b.dataset.op))); } }; return; }
  $('#xpAdd').onclick = async () => afterAdd(await pf.expPickFiles(e.id));
  $('#xpDrive').onclick = () => fromDrive(e);
  host.querySelectorAll('[data-do]').forEach((b) => (b.onclick = () => act(b.dataset.do, sel)));
  const fl = $('#xpFiles');
  fl.onchange = (ev) => { const r = ev.target.closest('[data-f]'); if (!r) return; ev.target.checked ? X.pick.add(r.dataset.f) : X.pick.delete(r.dataset.f); paintDetail(); };
  fl.onclick = async (ev) => {
    const b = ev.target.closest('[data-fa]'); const r = ev.target.closest('[data-f]'); if (!r) return; const f = X.files.find((x) => x.id === r.dataset.f);
    if (!b) { if (ev.target.tagName !== 'INPUT' && usable(f.name)) { X.pick.has(f.id) ? X.pick.delete(f.id) : X.pick.add(f.id); paintDetail(); } return; }
    if (b.dataset.fa === 'view') return act('open', [f]);
    if (b.dataset.fa === 'rm') {
      modal(`<h2>Enviar a la papelera</h2><p>¿Enviar «${esc(f.name)}» a la papelera ${e.storage === 'drive' ? 'de Google Drive' : 'del computador'}? Puedes recuperarlo desde ahí.</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mOk">Enviar a la papelera</button></div>`);
      $('#mCancel').onclick = closeModal; $('#mOk').onclick = async () => { closeModal(); const q = await pf.expRemoveFile(e.id, f.id); if (!q.ok) return toast(q.error, 5000); select(e.id); };
    }
  };
}
const HK = { created: 'folder', added: 'upload', removed: 'trash', sent: 'sign', plazos: 'calendar', saved: 'file', note: 'textEdit' };
function histRow(h) {
  let st = '';
  if (h.kind === 'sent' && h.op != null) {
    const o = X.ops?.items?.find((x) => String(x.operation) === String(h.op));
    const lab = !o ? 'Enviado' : (o.stage === 'finalized' || o.status === 'finalized') ? (o.signers && o.signed < o.signers ? 'Cerrada sin todas las firmas' : 'Firmado') : `Firmando ${o.signed ?? 0}/${o.signers ?? '?'}`;
    st = `<span class="ops-chip ${/Firmado/.test(lab) ? 'ok' : /Cerrada/.test(lab) ? 'wait' : 'run'}">${lab} · N° ${esc(h.op)}</span><button class="ghost small" data-op="${esc(h.op)}">Ver</button>`;
  }
  return `<div class="xp-h"><span class="xp-h-ic">${icon(HK[h.kind] || 'file', 15)}</span><span class="xp-h-tx"><b>${esc(h.text || '')}</b><small>${fmtD(h.at)}</small></span><span class="xp-h-st">${st}</span></div>`;
}
async function loadOps() { if (X.ops) return; const r = await pf.opsList(); if (r.ok) { X.ops = r.data; if (X.tab === 'hist') paintDetail(); } }

function afterAdd(r) {
  if (!r?.ok) return r && toast(r.error, 5000);
  if (r.data.skipped?.length) toast(`No se agregaron: ${r.data.skipped.join(' · ')}`, 7000);
  else if (r.data.added?.length) toast(r.data.added.length === 1 ? `Se agregó «${r.data.added[0]}».` : `Se agregaron ${r.data.added.length} archivos.`);
  select(X.sel);
}
// Archivos de Drive: se copian al expediente (quedan guardados en su carpeta)
async function fromDrive(e) {
  const st = (await pf.driveStatus()).data || {};
  if (!st.picker) return window.Drive.open({ purpose: 'exp' });
  if (!st.connected) return window.Drive.open({ purpose: 'exp' });
  const r = await pf.drivePick({ multi: true, folders: false }); if (!r.ok) return toast(r.error, 5000);
  if (!r.data.length) return;
  modal(`<h2>${icon('drive', 18)} Copiando desde Google Drive…</h2><p class="muted">${r.data.length} archivo(s)</p>`);
  const paths = []; for (const f of r.data) { const d = await pf.driveDownload(f.id); if (d.ok) paths.push(d.data); }
  closeModal(); afterAdd(await pf.expAddFiles(e.id, paths, { note: `Se copiaron ${paths.length} archivo(s) desde Google Drive` }));
}
// Llamado por el explorador de Drive (modo sin selector) con los archivos ya descargados
async function addPaths(paths, note) { if (!X.sel) return toast('Primero elige un expediente.'); afterAdd(await pf.expAddFiles(X.sel, paths, { note })); }

async function paths(files) {
  const out = [];
  if (files.length > 1) modal(`<h2>Preparando ${files.length} archivos…</h2>`);
  for (const f of files) { const r = await pf.expLocalPath(X.sel, f.id); if (r.ok) out.push({ f, path: r.data }); else toast(`${f.name}: ${r.error}`, 5000); }
  if (files.length > 1) closeModal();
  return out;
}
async function act(what, files) {
  if (what === 'none') { X.pick = new Set(); return paintDetail(); }
  files = files.filter((f) => usable(f.name)); if (!files.length) return;
  const e = X.list.find((x) => x.id === X.sel);
  if (what === 'sign' && !window.isMember()) return window.members(() => act(what, files), 'Enviar a firmar es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta.');
  const got = await paths(files); if (!got.length) return;
  if (what === 'open') { window.studio.goEditor(); return window.editor.openEach(got.map((x) => x.path)); }
  if (what === 'combine') { show('editor'); window.editor.open(); window.editor.openPaths(got.map((x) => x.path), true); return toast('Se abrieron juntos en el editor: ordénalos y guarda el PDF combinado.', 5000); }
  if (what === 'plazos') {
    const r = await pf.plazosAdd(got.map((x) => x.path)); if (!r.ok) return toast(r.error, 5000);
    await pf.expLog(e.id, { kind: 'plazos', text: `Agregado a Plazos y vencimientos: ${got.map((x) => '«' + x.f.name + '»').join(', ')}` });
    window.Plazos.open(); setTimeout(() => window.Plazos.afterAdd(r), 300); return;
  }
  if (what === 'sign') {
    if (got.length === 1) { window.__expCtx = { id: e.id, file: got[0].f.name }; show('drop'); try { startAnalysis(await api('checkFile', got[0].path)); } catch (err) { toast(err.message, 5000); } return; }
    await pf.bulkAdd(got.map((x) => ({ path: x.path, flow: { expId: e.id, file: x.f.name } })));
    window.Masiva.open('load'); toast(`${got.length} documento(s) del expediente en la carga masiva: revisa los firmantes y envía.`, 6000);
  }
}

function createDialog(after) {
  modal(`<h2>${icon('folderOpen', 18)} Nuevo expediente</h2>
    <label>Nombre<input id="xnName" placeholder="Ej.: Depto Calle Nueva 120, torre 2" maxlength="90" /></label>
    <label>Tipo<select id="xnType">${Object.entries(TYPES).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <div class="xp-store"><span>¿Dónde se guarda?</span>
      <label class="xp-opt on"><input type="radio" name="xnSt" value="local" checked /><span><b>${icon('folder', 14)} En este computador</b><small>Carpeta «Expedientes PortalFirma» en Documentos.</small></span></label>
      <label class="xp-opt"><input type="radio" name="xnSt" value="drive" /><span><b>${icon('drive', 14)} En Google Drive</b><small>Carpeta «Expedientes PortalFirma» en tu Drive: la ves desde cualquier equipo.</small></span></label></div>
    <label>Notas (opcional)<input id="xnNotes" placeholder="Ej.: arriendo 2026, corredora SEC Propiedades" maxlength="200" /></label>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Crear</button></div>`);
  $('#modalCard').querySelectorAll('input[name="xnSt"]').forEach((r) => (r.onchange = () => $('#modalCard').querySelectorAll('.xp-opt').forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked))));
  $('#mCancel').onclick = closeModal; $('#xnName').focus();
  $('#mOk').onclick = async () => {
    const name = $('#xnName').value.trim(); if (!name) { $('#xnName').classList.add('invalid'); return; }
    const storage = $('#modalCard').querySelector('input[name="xnSt"]:checked').value;
    const o = { name, type: $('#xnType').value, storage, notes: $('#xnNotes').value.trim() };
    if (storage === 'drive') { const st = (await pf.driveStatus()).data || {}; if (!st.connected) { closeModal(); toast('Primero conecta Google Drive; después vuelve a crear el expediente.', 6000); return window.Drive.open({ purpose: 'connect' }); } }
    $('#mOk').disabled = true; $('#mOk').innerHTML = '<i class="bk-spin"></i> Creando…';
    const r = await pf.expCreate(o); if (!r.ok) { $('#mOk').disabled = false; $('#mOk').textContent = 'Crear'; return toast(r.error, 6000); }
    closeModal(); if (after) return after(r.data);
    await open(r.data.id); toast('Expediente creado. Agrega sus documentos.');
  };
}
function moreDialog(e) {
  modal(`<h2>${esc(e.name)}</h2>
    <label>Tipo<select id="xmType">${Object.entries(TYPES).map(([k, [l]]) => `<option value="${k}" ${e.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Notas<input id="xmNotes" value="${esc(e.notes || '')}" maxlength="200" /></label>
    <p class="muted small">Creado el ${fmtD(e.created)} · ${e.storage === 'drive' ? 'Google Drive' : esc(e.path || '')}</p>
    <div class="actions"><button class="ghost danger-t" id="xmDel" style="margin-right:auto">Quitar de la lista</button><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => { closeModal(); await pf.expUpdate(e.id, { type: $('#xmType').value, notes: $('#xmNotes').value }); open(e.id); };
  $('#xmDel').onclick = () => {
    modal(`<h2>Quitar de la lista</h2><p>«${esc(e.name)}» deja de aparecer en Studio. <b>La carpeta y sus archivos no se borran</b>: siguen ${e.storage === 'drive' ? 'en tu Google Drive' : 'en tu computador'}.</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mOk">Quitar</button></div>`);
    $('#mCancel').onclick = closeModal; $('#mOk').onclick = async () => { closeModal(); await pf.expRemove(e.id); X.sel = null; open(); };
  };
}
// Guardar el documento abierto en el editor dentro de un expediente
async function saveCurrent() {
  const l = await pf.expList(); const list = l.ok ? l.data : [];
  const name = (window.editor._state?.name || 'Documento.pdf').replace(/\.[^.]+$/, '') + '.pdf';
  modal(`<h2>${icon('folderOpen', 18)} Guardar en un expediente</h2>
    <label>Nombre del archivo<input id="xsName" value="${esc(name)}" /></label>
    ${list.length ? `<label>Expediente<select id="xsExp">${list.map((x) => `<option value="${x.id}">${esc(x.name)}${x.storage === 'drive' ? ' (Drive)' : ''}</option>`).join('')}</select></label>` : '<p class="muted">Todavía no tienes expedientes: crea uno.</p>'}
    <div class="actions"><button class="ghost" id="xsNew" style="margin-right:auto">${icon('plus', 13)} Nuevo expediente</button><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk" ${list.length ? '' : 'disabled'}>Guardar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#xsNew').onclick = () => { const nm = $('#xsName').value; createDialog(async (x) => { await doSave(x.id, nm); }); };
  $('#mOk').onclick = async () => { const id = $('#xsExp').value; const nm = $('#xsName').value; closeModal(); await doSave(id, nm); };
}
async function doSave(id, name) {
  const b64 = await window.editor.exportBase64(); const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const r = await pf.expAddBytes(id, /\.pdf$/i.test(name) ? name : name + '.pdf', bytes, { note: `Se guardó desde el editor «${name}»` });
  if (!r.ok) return toast(r.error, 6000);
  toast(`Guardado en el expediente como «${r.data}».`, 5000);
}
// Archivos soltados en la ventana mientras se ve un expediente
async function dropFiles(paths) { if (!X.sel) return toast('Primero crea o elige un expediente.'); afterAdd(await pf.expAddFiles(X.sel, paths)); }

window.Expedientes = { open, dropFiles, addPaths, saveCurrent, createDialog, _x: X };
})();
