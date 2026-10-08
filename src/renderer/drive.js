/* global pf, $, esc, toast, modal, closeModal, icon, show, api, startAnalysis */
'use strict';
(() => { // módulo aislado
// ============================================================================
// Google Drive: navegar carpetas, elegir uno o varios documentos y
//  · enviarlos a firmar (uno → flujo normal; varios o una carpeta completa → carga masiva),
//  · abrirlos en Studio, o convertir uno en plantilla.
// ============================================================================
const FOLDER = 'application/vnd.google-apps.folder';
const KIND = { 'application/vnd.google-apps.document': 'Google Docs', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word', 'application/msword': 'Word', 'application/pdf': 'PDF', [FOLDER]: 'Carpeta' };
const D = { purpose: 'sign', scope: 'mine', path: [{ id: 'root', name: 'Mi unidad' }], q: '', files: [], next: '', sel: new Map(), email: '' };
const fmtD = (iso) => { try { return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };

async function open(opts = {}) {
  D.purpose = opts.purpose || 'sign';
  const r = await pf.driveStatus(); const st = r.ok ? r.data : { configured: false };
  if (!st.configured) return setup();
  if (!st.connected) return connect(st.reconnect);
  if (D.purpose === 'connect') { closeModal(); return toast('Google Drive conectado.'); }
  D.email = st.email; D.sel = new Map(); D.q = '';
  if (st.picker) return pickFlow(); // selector oficial de Google (permiso solo sobre lo que eliges)
  render(); load();
}
// ---------- Selector de Google ----------
async function pickFlow() {
  modal(`<h2>${icon('drive', 18)} Google Drive</h2><p><i class="bk-spin"></i> Se abrió Google Drive <b>en tu navegador</b>: elige ahí ${D.purpose === 'template' ? 'el documento' : 'uno o varios documentos (o una carpeta)'} y vuelve a Studio.</p>
    <p class="muted small">Se usa tu navegador porque ahí ya tienes iniciada tu sesión de Google. Si tienes varias cuentas, elige la misma que conectaste a Studio${D.email ? ` (${esc(D.email)})` : ''}. PortalFirma Studio solo puede abrir los archivos que elijas; no ve el resto de tu Drive.</p>
    <div class="actions"><button class="secondary" id="gpCancel">Cancelar</button><button class="primary" id="gpAgain">Abrir de nuevo en el navegador</button></div>`);
  $('#gpCancel').onclick = () => pf.drivePickCancel(); $('#gpAgain').onclick = () => pf.drivePickReopen();
  const r = await pf.drivePick({ multi: D.purpose !== 'template', folders: D.purpose !== 'template' });
  if (!r.ok) { if (/Conecta/.test(r.error)) return connect(); closeModal(); return toast(r.error, 6000); }
  const files = []; const fails = [];
  for (const f of r.data) {
    if (!f.isFolder) { files.push(f); continue; }
    const x = await pf.driveFolderDocs(f.id);
    if (x.ok && x.data.length) files.push(...x.data); else fails.push(f.name);
  }
  if (fails.length) toast(`No pude abrir los documentos de la carpeta «${fails.join('», «')}». Entra a la carpeta en el selector y elige los archivos (puedes marcar varios).`, 8000);
  if (!files.length) return closeModal();
  D.sel = new Map(files.map((f) => [f.id, f]));
  if (D.purpose === 'template' && files.length === 1) { closeModal(); return act('template'); }
  if (D.purpose === 'exp') return act('exp');
  pickedView();
}
function pickedView() {
  const files = [...D.sel.values()]; const n = files.length;
  modal(`<div class="drv"><div class="drv-top"><h2>${icon('drive', 18)} ${n === 1 ? 'Documento elegido' : `${n} documentos elegidos`}</h2><span class="muted small">${esc(D.email || 'Google Drive')} · <a href="#" id="drvOut">Desconectar</a></span></div>
    <div class="drv-list">${files.map((f) => `<div class="drv-item sel"><span class="fi">${icon(f.mimeType === 'application/pdf' ? 'file' : 'textEdit', 17)}</span><span class="drv-nm"><b>${esc(f.name)}</b><small>${KIND[f.mimeType] || ''}</small></span></div>`).join('')}</div>
    <div class="drv-foot"><button class="ghost small" id="drvAgain">${icon('drive', 14)} Elegir otros</button>
      <div class="drv-acts"><button class="secondary" id="mCancel">Cerrar</button>
        <button class="secondary" data-do="open">Abrir en Studio</button>
        ${n === 1 ? '<button class="secondary" data-do="template">Convertir en plantilla</button>' : ''}
        ${D.purpose === 'plazos' ? `<button class="primary" data-do="plazos">${icon('calendar', 15)} Agregar a Plazos</button>` : ''}
        <button class="${D.purpose === 'plazos' ? 'secondary' : 'primary'}" data-do="sign">${icon('sign', 15)} Enviar a firmar${n > 1 ? ` (${n})` : ''}</button></div></div></div>`);
  $('#mCancel').onclick = closeModal;
  $('#drvAgain').onclick = () => pickFlow();
  $('#drvOut').onclick = async (e) => { e.preventDefault(); await pf.driveDisconnect(); closeModal(); toast('Google Drive desconectado.'); };
  document.querySelectorAll('[data-do]').forEach((b) => (b.onclick = () => act(b.dataset.do)));
}
function setup() {
  // Los usuarios no configuran nada: la credencial viene incluida en la app. Si falta, se ofrece soporte.
  modal(`<h2>${icon('drive', 18)} Google Drive</h2><p>La conexión con Google Drive todavía no está disponible en esta versión de PortalFirma Studio. Estará lista en la próxima actualización.</p>
    <p class="muted small">Mientras tanto, descarga el archivo desde Drive y arrástralo a la app.</p>
    <div class="actions"><a href="#" id="drvAdmin" class="muted small" style="margin-right:auto">Soy administrador</a><button class="secondary" id="mCancel">Cerrar</button><button class="primary wa-btn with-ic" id="mOk">${icon('whatsapp', 15)}<span>Escribir a soporte</span></button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => { closeModal(); window.studio.whatsapp('Hola, quiero usar Google Drive en PortalFirma Studio y aparece como no disponible.'); };
  $('#drvAdmin').onclick = async (e) => { e.preventDefault(); const c = await pf.driveSetClient(); if (!c.ok) return toast(c.error, 6000); if (!c.data) return; closeModal(); toast('Google Drive activado.'); open({ purpose: D.purpose }); };
}
function connect(again) {
  modal(`<h2>${icon('drive', 18)} ${again ? 'Vuelve a conectar Google Drive' : 'Conectar Google Drive'}</h2>
    ${again ? '<p class="muted small">Cambiamos la forma de conectar Google Drive para que sea más segura: ahora la app solo accede a los archivos que tú eliges.</p>' : ''}
    <p>Se abrirá tu navegador para que inicies sesión en Google y autorices a PortalFirma Studio. La app <strong>solo puede abrir los archivos que elijas</strong> en el selector de Google; no ve el resto de tu Drive y nunca modifica ni borra nada.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Conectar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    $('#modalCard').innerHTML = `<h2>${icon('drive', 18)} Esperando la autorización…</h2><p>Termina de autorizar en el navegador y vuelve aquí.</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button></div>`;
    $('#mCancel').onclick = closeModal;
    const c = await pf.driveConnect();
    if (!c.ok) { closeModal(); return toast(c.error, 6000); }
    open({ purpose: D.purpose });
  };
}

function render() {
  const n = D.sel.size; const here = D.path[D.path.length - 1];
  modal(`<div class="drv">
    <div class="drv-top"><h2>${icon('drive', 18)} Google Drive</h2><span class="muted small">${esc(D.email || 'Conectado')} · <a href="#" id="drvOut">Desconectar</a></span></div>
    <div class="drv-bar">
      <div class="drv-scope"><button data-sc="mine" class="${D.scope === 'mine' && !D.q ? 'on' : ''}">Mi unidad</button><button data-sc="shared" class="${D.scope === 'shared' && !D.q ? 'on' : ''}">Compartidos conmigo</button></div>
      <div class="ops-search">${icon('search', 14)}<input id="drvQ" placeholder="Buscar en todo tu Drive…" value="${esc(D.q)}" spellcheck="false" /></div>
    </div>
    <div class="drv-crumbs">${D.q ? `Resultados para «${esc(D.q)}»` : D.scope === 'shared' ? 'Compartidos conmigo' : D.path.map((p, i) => `<a href="#" data-crumb="${i}">${esc(p.name)}</a>`).join(` ${icon('chevR', 12)} `)}
      ${!D.q && D.scope === 'mine' ? `<button class="ghost small" id="drvAll" title="Seleccionar todos los documentos de esta carpeta">Seleccionar toda la carpeta</button>` : ''}</div>
    <div class="drv-list" id="drvList"><p class="hint">Cargando…</p></div>
    <div class="drv-foot"><span class="muted small" id="drvCount">${n ? `${n} documento(s) seleccionado(s)` : 'Marca uno o varios documentos'}</span>
      <div class="drv-acts">
        <button class="secondary" id="mCancel">Cerrar</button>
        <button class="secondary" data-do="open" ${n ? '' : 'disabled'}>Abrir en Studio</button>
        <button class="secondary" data-do="template" ${n === 1 ? '' : 'disabled'} title="Solo un documento a la vez">Convertir en plantilla</button>
        ${D.purpose === 'plazos' ? `<button class="secondary" data-do="plazos" ${n ? '' : 'disabled'}>${icon('calendar', 15)} Agregar a Plazos</button>` : ''}
        ${D.purpose === 'exp' ? `<button class="secondary" data-do="exp" ${n ? '' : 'disabled'}>${icon('folderOpen', 15)} Agregar al expediente</button>` : ''}
        <button class="primary" data-do="sign" ${n ? '' : 'disabled'}>${icon('sign', 15)} Enviar a firmar${n > 1 ? ` (${n})` : ''}</button>
      </div></div></div>`);
  void here;
  $('#mCancel').onclick = closeModal;
  $('#drvOut').onclick = async (e) => { e.preventDefault(); await pf.driveDisconnect(); closeModal(); toast('Google Drive desconectado.'); };
  document.querySelectorAll('[data-sc]').forEach((b) => (b.onclick = () => { D.scope = b.dataset.sc; D.q = ''; D.path = [{ id: 'root', name: 'Mi unidad' }]; render(); load(); }));
  const q = $('#drvQ'); q.onkeydown = (e) => { if (e.key === 'Enter') { D.q = q.value.trim(); render(); load(); } };
  document.querySelectorAll('[data-crumb]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); D.path = D.path.slice(0, Number(a.dataset.crumb) + 1); render(); load(); }));
  const all = $('#drvAll'); if (all) all.onclick = selectFolder;
  $('#drvList').onclick = listClick;
  document.querySelectorAll('[data-do]').forEach((b) => (b.onclick = () => act(b.dataset.do)));
  paint();
}
async function load(append) {
  const here = D.path[D.path.length - 1];
  const r = await pf.driveList({ search: D.q, folder: here.id, scope: D.scope, pageToken: append ? D.next : '' });
  if (!$('#drvList')) return;
  if (!r.ok) { if (/Conecta|cerró la conexión/.test(r.error)) return connect(); $('#drvList').innerHTML = `<p class="hint bad">${esc(r.error)}</p>`; return; }
  D.files = append ? [...D.files, ...r.data.files] : r.data.files; D.next = r.data.next; paint();
}
function paint() {
  const host = $('#drvList'); if (!host) return;
  host.innerHTML = D.files.length ? D.files.map((f) => {
    const dir = f.mimeType === FOLDER;
    return `<div class="drv-item ${D.sel.has(f.id) ? 'sel' : ''}" data-id="${esc(f.id)}" ${dir ? 'data-dir' : ''}>
      ${dir ? `<span class="drv-cb"></span><span class="fi dir">${icon('folder', 17)}</span>` : `<input type="checkbox" class="drv-cb" ${D.sel.has(f.id) ? 'checked' : ''} /><span class="fi">${icon(f.mimeType === 'application/pdf' ? 'file' : 'textEdit', 17)}</span>`}
      <span class="drv-nm"><b>${esc(f.name)}</b><small>${KIND[f.mimeType] || ''}${f.modifiedTime ? ' · ' + fmtD(f.modifiedTime) : ''}${f.owner ? ' · ' + esc(f.owner) : ''}</small></span>
      ${dir ? `<span class="muted">${icon('chevR', 15)}</span>` : ''}</div>`;
  }).join('') + (D.next ? '<button class="ghost small" id="drvMore">Ver más</button>' : '') : `<p class="hint">${D.q ? 'No hay documentos que coincidan.' : 'Esta carpeta no tiene documentos PDF, Word ni Google Docs.'}</p>`;
  const more = $('#drvMore'); if (more) more.onclick = () => load(true);
  counts();
}
function counts() {
  const n = D.sel.size; const c = $('#drvCount'); if (!c) return;
  c.textContent = n ? `${n} documento(s) seleccionado(s)` : 'Marca uno o varios documentos';
  document.querySelector('[data-do="open"]').disabled = !n;
  document.querySelector('[data-do="template"]').disabled = n !== 1;
  const pz = document.querySelector('[data-do="plazos"]'); if (pz) pz.disabled = !n;
  const xp = document.querySelector('[data-do="exp"]'); if (xp) xp.disabled = !n;
  const s = document.querySelector('[data-do="sign"]'); s.disabled = !n; s.innerHTML = `${icon('sign', 15)} Enviar a firmar${n > 1 ? ` (${n})` : ''}`;
}
function listClick(e) {
  const it = e.target.closest('.drv-item'); if (!it) return;
  const f = D.files.find((x) => x.id === it.dataset.id); if (!f) return;
  if (it.hasAttribute('data-dir')) { D.path.push({ id: f.id, name: f.name }); D.scope = 'mine'; D.q = ''; render(); load(); return; }
  if (D.sel.has(f.id)) D.sel.delete(f.id); else D.sel.set(f.id, f);
  it.classList.toggle('sel', D.sel.has(f.id)); it.querySelector('input').checked = D.sel.has(f.id); counts();
}
async function selectFolder() {
  const here = D.path[D.path.length - 1];
  const r = await pf.driveFolderDocs(here.id); if (!r.ok) return toast(r.error, 5000);
  for (const f of r.data) D.sel.set(f.id, f);
  paint(); toast(`${r.data.length} documento(s) de «${here.name}» seleccionados.`);
}

// Descarga lo elegido (de a 2) mostrando el avance
async function downloadAll(files) {
  const out = []; let i = 0; let done = 0; const errs = [];
  modal(`<h2>${icon('drive', 18)} Descargando de Google Drive…</h2><div class="bk-prog"><div class="bk-prog-in" id="dlProg" style="width:0%"></div></div><p class="muted small" id="dlTxt">0 de ${files.length}</p>`);
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++]; const r = await pf.driveDownload(f.id);
      if (r.ok) out.push({ f, path: r.data }); else errs.push(`${f.name}: ${r.error}`);
      done++; const p = $('#dlProg'); if (p) { p.style.width = Math.round((done / files.length) * 100) + '%'; $('#dlTxt').textContent = `${done} de ${files.length}`; }
    }
  };
  await Promise.all([worker(), worker()]);
  closeModal();
  if (errs.length) toast(`No se pudieron descargar ${errs.length} archivo(s): ${errs[0]}`, 7000);
  return out;
}
async function act(what) {
  const files = [...D.sel.values()]; if (!files.length) return;
  if (what === 'template') { closeModal(); return window.Plantillas.importFromDrive(files[0]); }
  if (what === 'exp') { const got = await downloadAll(files); if (got.length) window.Expedientes.addPaths(got.map((x) => x.path), `Se copiaron ${got.length} archivo(s) desde Google Drive`); return; }
  if (what === 'plazos') { const got = await downloadAll(files); if (!got.length) return; const r = await pf.plazosAdd(got.map((x) => x.path)); window.Plazos.open(); setTimeout(() => window.Plazos.afterAdd(r), 300); return; }
  if (what === 'open') { const got = await downloadAll(files); if (got.length) { window.studio.goEditor(); window.editor.openEach(got.map((x) => x.path)); } return; }
  // Enviar a firmar (solo clientes de Portalfirma)
  if (!window.isMember()) { closeModal(); return window.members(() => open({ purpose: D.purpose }), 'Enviar a firmar es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta.'); }
  const got = await downloadAll(files); if (!got.length) return;
  if (got.length === 1) { show('drop'); try { startAnalysis(await api('checkFile', got[0].path)); } catch (e) { toast(e.message, 5000); } return; }
  await pf.bulkAdd(got.map((x) => x.path));
  window.Masiva.open('load');
  toast(`${got.length} documento(s) de Google Drive en la carga masiva: revisa los firmantes y envía.`, 6000);
}

window.Drive = { open, _d: D };
})();
