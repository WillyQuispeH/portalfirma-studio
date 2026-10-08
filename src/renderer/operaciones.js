/* global pf, $, esc, toast, modal, closeModal, icon, api, pdfjsLib */
'use strict';
(() => { // módulo aislado: sus funciones no pisan las del editor
// ============================================================================
// Mis operaciones: sincronizadas con Portalfirma, con etapas (Enviado → Firmado → Legalizado),
// vista previa, descargar y compartir.
// ============================================================================
const OPS = { items: [], lastSync: null, filter: 'all', q: '', sel: null, detail: null, version: null, pdf: null, page: 1, timer: null, prefetching: false };
const STAGE = {
  finalized: ['Firmado', 'ok'], process: ['En firma', 'wait'], in_progress: ['En firma', 'wait'], starting: ['Iniciada', 'muted'],
  unPayed: ['Pendiente de pago', 'bad'], unData: ['Faltan datos', 'bad'], pending: ['Pendiente', 'wait'],
};
const PROC = { none: 'Firma electrónica', legalization: 'Legalizado ante notario', protocolization: 'Protocolizado' };
const fmtD = (iso) => { try { return iso ? new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; } catch { return ''; } };
const ago = (iso) => { if (!iso) return 'nunca'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : fmtD(iso); };
function chip(it) {
  if ((it.stage === 'finalized' || it.status === 'finalized') && it.signers && it.signed < it.signers) return ['Cerrada sin todas las firmas', 'muted'];
  if ((it.stage === 'finalized' || it.status === 'finalized') && it.proc && it.proc !== 'none') return it.proc === 'legalization' ? ['Legalizado', 'legal'] : ['Protocolizado', 'proto'];
  return STAGE[it.stage] || STAGE[it.status] || [it.stage || '—', 'muted'];
}
const group = (it) => { const [l] = chip(it); return l === 'Cerrada sin todas las firmas' ? 'action' : l === 'Firmado' ? 'signed' : l === 'Legalizado' || l === 'Protocolizado' ? 'notary' : l === 'Pendiente de pago' || l === 'Faltan datos' ? 'action' : 'pending'; };
const FILTERS = [['all', 'Todas'], ['pending', 'En firma'], ['signed', 'Firmadas'], ['notary', 'Legalizadas / protocolizadas'], ['action', 'Requieren acción']];

async function openOps() {
  const st = (await pf.opsStatus()).data;
  if (st?.apiAvailable && !st.api) return window.ApiDiag.login(() => { OPS.items = []; openOps(); }, 'Para traer las operaciones de tu cuenta, inicia sesión con el correo y la contraseña de Portalfirma.');
  if (!st?.api && !st?.phone) return askPhone();
  OPS.account = st.api ? st.account : '';
  renderShell();
  const l = await pf.opsList(); if (l.ok) { Object.assign(OPS, { items: l.data.items, lastSync: l.data.lastSync }); renderList(); }
  if (!OPS.lastSync || Date.now() - new Date(OPS.lastSync) > 5 * 60000) syncNow();
  else prefetch();
  clearInterval(OPS.timer);
  OPS.timer = setInterval(() => { if (!$('#view-ops').classList.contains('hidden')) syncNow(true); else clearInterval(OPS.timer); }, 5 * 60000);
}
function askPhone(prefill = '') {
  modal(`<h2>${icon('listCheck', 18)} Tus operaciones de Portalfirma</h2>
    <p>Para traer las operaciones de tu cuenta, escribe el <strong>teléfono con el que te registraste en Portalfirma</strong>. Se guarda en este computador.</p>
    <label>Teléfono<input id="opPhone" value="${esc(prefill)}" placeholder="9 1234 5678" inputmode="tel" /></label>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Traer mis operaciones</button></div>`);
  $('#mCancel').onclick = () => { closeModal(); if (!OPS.items.length) window.studio.goHome(); };
  const go = async () => { const r = await pf.opsSetPhone($('#opPhone').value); if (!r.ok) return toast(r.error, 4000); closeModal(); OPS.items = []; openOps(); };
  $('#mOk').onclick = go; $('#opPhone').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  setTimeout(() => $('#opPhone')?.focus(), 30);
}
async function syncNow(quiet) {
  const b = $('#opsSync'); if (b) { b.disabled = true; b.classList.add('spin'); }
  const r = await pf.opsSync(false);
  if (b) { b.disabled = false; b.classList.remove('spin'); }
  if (!r.ok) { if (r.code === 'NO_PHONE') return askPhone(); if (!quiet) toast('No se pudo sincronizar: ' + r.error, 5000); return; }
  Object.assign(OPS, { items: r.data.items, lastSync: r.data.lastSync }); renderList(); prefetch();
  if (!quiet && r.data.found != null) toast(`Sincronizado: ${r.data.items.length} operación(es).`);
}
// Trae en segundo plano el detalle de las operaciones (de a 2) para saber si están legalizadas y cuántos firmaron
async function prefetch() {
  if (OPS.prefetching) return; OPS.prefetching = true;
  try {
    const todo = OPS.items.filter((x) => x.status == null).slice(0, 150); let i = 0;
    const worker = async () => { while (i < todo.length && !$('#view-ops').classList.contains('hidden')) { const it = todo[i++]; const r = await pf.opsDetail(it.operation); if (r.ok) { Object.assign(it, { status: r.data.status, proc: r.data.protocolizationNumber || 'none', signed: (r.data.signatories || []).filter((s) => s.signed).length, signers: (r.data.signatories || []).length }); paintRow(it); } } };
    await Promise.all([worker(), worker()]); renderCounts();
  } finally { OPS.prefetching = false; }
}

function renderShell() {
  $('#view-ops').innerHTML = `<div class="ops">
    <div class="ops-head"><div><h2>Mis operaciones</h2><span class="muted small" id="opsWhen"></span></div>
      <div class="ops-head-r"><button class="ghost small" id="opsPhone" title="Cambiar el teléfono de la cuenta">${icon('edit', 14)}</button>
      <button class="secondary small with-ic" id="opsPlz">${icon('calendar', 15)}<span>Plazos</span></button>
      <button class="secondary small with-ic" id="opsBulk">${icon('files', 15)}<span>Carga masiva</span></button>
      <button class="primary small with-ic" id="opsSync">${icon('rotateR', 15)}<span>Sincronizar</span></button></div></div>
    <div class="ops-tools"><div class="ops-search">${icon('search', 15)}<input id="opsQ" placeholder="Buscar por documento o número de operación" spellcheck="false" /></div>
      <div class="ops-filters" id="opsFilters"></div></div>
    <div class="ops-grid"><div class="ops-list" id="opsList"></div><div class="ops-detail" id="opsDetail"><div class="ops-empty">${icon('file', 34)}<p>Elige una operación para ver su documento, etapas y firmantes.</p></div></div></div></div>`;
  $('#opsSync').onclick = () => syncNow();
  if (OPS.account) { $('#opsPhone').title = 'Cuenta: ' + OPS.account + ' · cerrar sesión'; $('#opsPhone').innerHTML = icon('user', 14); $('#opsPhone').onclick = () => window.ApiDiag.open(); }
  else $('#opsPhone').onclick = async () => askPhone((await pf.opsStatus()).data?.phone || '');
  $('#opsBulk').onclick = () => window.Masiva?.open();
  $('#opsPlz').onclick = () => window.Plazos?.open();
  $('#opsQ').oninput = (e) => { OPS.q = e.target.value.trim().toLowerCase(); renderList(); };
  $('#opsQ').onkeydown = (e) => { if (e.key === 'Enter' && /^\d{3,}$/.test(OPS.q) && !visible().length) select(Number(OPS.q)); };
  $('#opsFilters').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { OPS.filter = b.dataset.f; renderList(); } };
  $('#opsList').onclick = (e) => { const r = e.target.closest('[data-op]'); if (r) select(Number(r.dataset.op)); };
}
const visible = () => OPS.items.filter((it) => (OPS.filter === 'all' || group(it) === OPS.filter) && (!OPS.q || String(it.operation).includes(OPS.q) || String(it.name).toLowerCase().includes(OPS.q)));
function renderCounts() {
  const n = (f) => (f === 'all' ? OPS.items.length : OPS.items.filter((x) => group(x) === f).length);
  const h = $('#opsFilters'); if (!h) return;
  h.innerHTML = FILTERS.map(([k, l]) => `<button class="ops-f ${OPS.filter === k ? 'on' : ''}" data-f="${k}">${l}<b>${n(k)}</b></button>`).join('');
  const w = $('#opsWhen'); if (w) w.textContent = `${OPS.items.length} operaciones · actualizado ${ago(OPS.lastSync)}`;
}
const rowHtml = (it) => { const [l, c] = chip(it); return `<div class="ops-row ${OPS.sel === it.operation ? 'sel' : ''}" data-op="${it.operation}">
  <span class="ops-ic ${c}">${icon('file', 17)}</span>
  <span class="ops-main"><b>${esc(String(it.name).replace(/\.pdf$/i, ''))}</b><small>N° ${it.operation} · ${fmtD(it.updated || it.created)}${it.signers ? ` · ${it.signed}/${it.signers} firmaron` : ''}</small></span>
  <span class="ops-chip ${c}">${l}</span></div>`; };
function renderList() {
  renderCounts(); const host = $('#opsList'); if (!host) return;
  const v = visible();
  host.innerHTML = v.length ? v.map(rowHtml).join('') : `<div class="ops-empty small"><p>${OPS.items.length ? 'No hay operaciones con ese filtro.' : 'Sincronizando tus operaciones…'}</p></div>`;
}
function paintRow(it) { const el = document.querySelector(`.ops-row[data-op="${it.operation}"]`); if (el) el.outerHTML = rowHtml(it); }

async function select(n, refresh) {
  OPS.sel = n; document.querySelectorAll('.ops-row').forEach((r) => r.classList.toggle('sel', Number(r.dataset.op) === n));
  const host = $('#opsDetail'); if (!host) return; host.innerHTML = '<div class="ops-empty"><div class="spinner"></div></div>';
  const r = await pf.opsDetail(n, refresh);
  if (OPS.sel !== n) return;
  if (!r.ok) { host.innerHTML = `<div class="ops-empty"><p class="error">${esc(r.error)}</p></div>`; return; }
  OPS.detail = r.data;
  const it = OPS.items.find((x) => x.operation === n);
  if (it) { Object.assign(it, { status: r.data.status, proc: r.data.protocolizationNumber || 'none', signed: (r.data.signatories || []).filter((s) => s.signed).length, signers: (r.data.signatories || []).length }); paintRow(it); renderCounts(); }
  else if (!OPS.items.length || !OPS.items.some((x) => x.operation === n)) { const l = await pf.opsList(); if (l.ok) { OPS.items = l.data.items; renderList(); } }
  renderDetail();
}
function renderDetail() {
  const d = OPS.detail; const host = $('#opsDetail'); if (!d) return;
  const it = OPS.items.find((x) => x.operation === d.operation) || { name: `Operación ${d.operation}`, stage: d.status };
  const [l, c] = chip({ ...it, status: d.status, proc: d.protocolizationNumber });
  const sig = d.signatories || []; const vs = d.versions; const cur = !!d.processId;
  host.innerHTML = `<div class="opd">
    <div class="opd-head"><div><h3>${esc(String(it.name).replace(/\.pdf$/i, ''))}</h3>
      <div class="muted small">Operación N° ${d.operation} · ${esc(PROC[d.protocolizationNumber] || 'Firma electrónica')}${d.repertoireNumber ? ` · Repertorio ${esc(d.repertoireNumber)}` : ''}</div>
      <div class="muted small">Creada ${fmtD(d.createdDateAt)} · Actualizada ${fmtD(d.updatedDateAt)}</div></div>
      <div class="opd-hr"><span class="ops-chip ${c} big">${l}</span><button class="ibtn" id="opdRef" title="Actualizar">${icon('rotateR', 15)}</button></div></div>
    <div class="opd-steps">${vs.map((v, i) => `${i ? `<span class="opd-line ${v.done ? 'done' : ''}"></span>` : ''}<div class="opd-step ${v.done ? 'done' : ''}">
        <span class="dot">${v.done ? icon('check', 15) : icon('rotateR', 12)}</span><b>${v.label}</b><small>${v.done ? 'Listo' : 'Pendiente'}</small></div>`).join('')}</div>
    <div class="opd-body">
      <div class="opd-prev"><div class="opd-canvas" id="opdCanvas">${cur ? '<div class="spinner"></div>' : '<p class="muted">Esta operación no trae su identificador de documento.</p>'}</div>
        <div class="opd-pager" id="opdPager"></div></div>
      <div class="opd-side">
        <div class="opd-acts">
          <button class="primary with-ic" id="opdDl" ${cur ? '' : 'disabled'}>${icon('export', 15)}<span>Descargar documento</span></button>
          <button class="secondary with-ic" id="opdShare" ${cur ? '' : 'disabled'}>${icon('upload', 15)}<span>Compartir</span></button>
          <button class="ghost with-ic" id="opdOpen" ${cur ? '' : 'disabled'}>${icon('edit', 15)}<span>Abrir en Studio</span></button>
        </div>
        <h4>Firmantes <span class="muted small">${sig.filter((s) => s.signed).length} de ${sig.length} firmaron</span></h4>
        <div class="opd-sigs">${sig.map((s, i) => { const nm = [s.name, s.paternalLastName, s.maternalLastName].filter(Boolean).join(' '); const ini = nm.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase(); return `<div class="opd-sig">
          <span class="av ${s.signed ? 'ok' : ''}">${esc(ini || '?')}</span>
          <span class="nm"><b>${esc(nm || 'Firmante')}</b><small>${esc(s.rut || '')}${s.email ? ' · ' + esc(s.email) : ''}</small></span>
          ${s.signed ? '<span class="ops-chip ok">Firmó</span>' : `<span class="opd-sig-acts"><span class="ops-chip wait">Pendiente</span>
            <button class="ghost small" data-copy="${i}" title="Copiar enlace de firma">Copiar enlace</button><button class="ghost small" data-mail="${i}">Correo</button><button class="ghost small" data-wa="${i}">WhatsApp</button></span>`}</div>`; }).join('')}</div>
      </div></div></div>`;
  $('#opdRef').onclick = () => select(d.operation, true);
  $('#opdDl').onclick = async () => { const r = await pf.opsSaveFile(d.operation); if (!r.ok) return fileErr(r); if (r.data) toast('Guardado en ' + r.data, 4000); };
  $('#opdShare').onclick = async () => { const r = await pf.opsShare(d.operation); if (!r.ok) return fileErr(r); if (r.data === 'folder') toast('El archivo quedó marcado en la carpeta: arrástralo a tu correo o WhatsApp.', 5000); };
  $('#opdOpen').onclick = async () => { const r = await pf.opsFile(d.operation); if (!r.ok) return fileErr(r); window.editor.openPaths([r.data.path], true); };
  host.querySelector('.opd-sigs').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return; const s = sig[b.dataset.copy ?? b.dataset.mail ?? b.dataset.wa];
    if (b.dataset.copy != null) { await navigator.clipboard.writeText((s.url || '').trim()); return toast('Enlace de firma copiado'); }
    const how = b.dataset.mail != null ? `por correo a ${s.email}` : `por WhatsApp a ${s.phone || 'su teléfono'}`;
    modal(`<h2>Reenviar enlace de firma</h2><p>¿Enviar el enlace de firma de la operación ${d.operation} ${esc(how)}?</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Enviar</button></div>`);
    $('#mCancel').onclick = closeModal;
    $('#mOk').onclick = async () => {
      closeModal();
      try {
        if (b.dataset.mail != null) await api('manage', { action: 'send_signature_link_by_email', email: s.email, name: s.name, link: (s.url || '').trim(), operation: d.operation });
        else await api('manage', { action: 'send_signature_link_by_whatsapp', operation: d.operation, personId: s.personId });
        toast('Enlace enviado ' + how);
      } catch (err) { toast('No se pudo enviar: ' + err.message, 5000); }
    };
  };
  if (cur) preview(d.operation);
}
function fileErr(r, retry) {
  if (r.code === 'NO_FILE_KEY') return askKey(retry);
  modal(`<h2>No se pudo obtener el documento</h2><p>${esc(r.error)}</p>
    <div class="actions"><button class="secondary" id="mCancel">Cerrar</button><button class="primary" id="mOk">Ir a mis contratos en Portalfirma</button></div>`);
  $('#mCancel').onclick = closeModal; $('#mOk').onclick = () => { closeModal(); pf.openUrl('https://cliente.portalfirma.cl/'); };
}
// Código de acceso al servicio de archivos de Portalfirma (lo entrega Portalfirma; queda cifrado en este equipo)
function askKey(after) {
  modal(`<h2>Acceso a los documentos</h2><p>Para mostrar los PDF, Studio usa el servicio oficial de archivos de Portalfirma. Ingresa el código de acceso que te entregó Portalfirma.</p>
    <label>Código de acceso<input id="fkVal" type="password" autocomplete="off" spellcheck="false"></label><p class="error small" id="fkErr"></p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => { const r = await pf.opsSetFileKey($('#fkVal').value); if (!r.ok) { $('#fkErr').textContent = r.error; return; } closeModal(); toast('Acceso guardado'); after?.(); };
}
// Vista previa: el PDF viene SOLO del servicio oficial de archivos de Portalfirma (getById)
async function preview(op) {
  const box = $('#opdCanvas'); const key = String(op);
  const r = await pf.opsFile(op);
  if (OPS.detail?.operation !== op || !box.isConnected) return;
  if (!r.ok && r.code === 'NO_FILE_KEY') { box.innerHTML = `<div class="opd-nofile">${icon('file', 30)}<p><b>Falta el acceso a los documentos</b><br><small>${esc(r.error)}</small></p><button class="secondary small" id="opdKey">Configurar acceso</button></div>`; $('#opdKey').onclick = () => askKey(() => preview(op)); return; }
  if (!r.ok) { box.innerHTML = `<div class="opd-nofile">${icon('file', 30)}<p><b>Vista previa no disponible</b><br><small>${esc(r.error)}</small></p><button class="secondary small" id="opdWeb">Ver en portalfirma.cl</button></div>`; $('#opdWeb').onclick = () => pf.openUrl('https://cliente.portalfirma.cl/'); return; }
  try { OPS.pdf?.destroy?.(); } catch {}
  OPS.pdf = await pdfjsLib.getDocument({ data: r.data.bytes, isEvalSupported: false, standardFontDataUrl: 'vendor/standard_fonts/', cMapUrl: 'vendor/cmaps/', cMapPacked: true }).promise;
  OPS.pdfKey = key; OPS.page = 1; drawPage();
}
async function drawPage() {
  const box = $('#opdCanvas'); const pdf = OPS.pdf; if (!box || !pdf) return;
  const page = await pdf.getPage(OPS.page); const w = Math.max(240, box.clientWidth - 24);
  const vp0 = page.getViewport({ scale: 1 }); const scale = (w / vp0.width) * (window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = w + 'px';
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  box.innerHTML = ''; box.append(c);
  const pg = $('#opdPager');
  pg.innerHTML = pdf.numPages > 1 ? `<button class="ibtn" data-p="-1" ${OPS.page <= 1 ? 'disabled' : ''}>${icon('chevL', 15)}</button><span>Página ${OPS.page} de ${pdf.numPages}</span><button class="ibtn" data-p="1" ${OPS.page >= pdf.numPages ? 'disabled' : ''}>${icon('chevR', 15)}</button>` : '';
  pg.onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { OPS.page += Number(b.dataset.p); drawPage(); } };
}

window.Operaciones = { open: openOps, select, askKey, _ops: OPS };

})();
