/* global pf, $, esc, toast, modal, closeModal, icon, show, state */
'use strict';
(() => { // módulo aislado: sus funciones no pisan las del editor
// ============================================================================
// Carga masiva: arrastrar muchos documentos, revisar sus firmantes y enviarlos con una sola confirmación.
// Firma masiva con certificado: firmar muchas operaciones pendientes con un solo código.
// ============================================================================
const BK = { st: { items: [] }, tab: 'load', frame: 0, opts: { protocolization: 'none', typeSign: 'simple' } };
const BS = {
  queued: ['En cola', 'muted'], converting: ['Convirtiendo a PDF', 'run'], uploading: ['Subiendo', 'run'], analyzing: ['Detectando firmantes', 'run'],
  ready: ['Listo', 'ok'], needs_data: ['Faltan datos', 'wait'], sending: ['Enviando', 'run'], sent: ['Enviado', 'ok'],
  error: ['Error', 'bad'], send_error: ['No se envió', 'bad'], skipped: ['Omitido', 'muted'],
};
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB');

function open(tab) {
  if (!window.isMember()) return window.members(() => open(tab), 'La carga masiva es exclusiva para clientes de Portalfirma. Inicia sesión con tu cuenta.');
  if (tab) BK.tab = tab;
  show('bulk'); render();
  pf.bulkState().then((r) => { if (r.ok) { BK.st = r.data; paint(); } });
}
pf.onBulk((st) => { BK.st = st; cancelAnimationFrame(BK.frame); BK.frame = requestAnimationFrame(paint); });

function render() {
  $('#view-bulk').innerHTML = `<div class="bulk">
    <div class="ops-head"><div><h2>Carga masiva</h2><span class="muted small">Sube muchos documentos, revisa sus firmantes y envíalos a firmar de una vez.</span></div>
      <div class="ops-head-r"><button class="secondary small with-ic" id="bkOps">${icon('listCheck', 15)}<span>Mis operaciones</span></button></div></div>
    <div class="ai-tabs bk-tabs"><button data-bt="load" class="${BK.tab === 'load' ? 'on' : ''}">Cargar y enviar a firmar</button><button data-bt="cds" class="${BK.tab === 'cds' ? 'on' : ''}">Firma masiva con certificado</button></div>
    <div id="bkBody"></div></div>`;
  $('#bkOps').onclick = () => { show('ops'); window.Operaciones.open(); };
  document.querySelectorAll('[data-bt]').forEach((b) => (b.onclick = () => { BK.tab = b.dataset.bt; render(); }));
  if (BK.tab === 'cds') return renderCds();
  $('#bkBody').innerHTML = `
    <div class="bk-drop" id="bkDrop" role="button" tabindex="0">${icon('upload', 30)}<b>Arrastra aquí tus documentos o haz clic para elegirlos</b><span>PDF o Word, hasta 20 MB cada uno. Se procesan de a 2 para no saturar Portalfirma.</span>
      <button class="secondary small with-ic" id="bkDrive">${icon('drive', 15)}<span>Traer desde Google Drive</span></button></div>
    <div class="bk-bar" id="bkBar"></div>
    <div class="bk-table" id="bkTable"></div>
    <div class="bk-foot" id="bkFoot"></div>`;
  $('#bkDrop').onclick = (e) => { if (e.target.closest('#bkDrive')) return window.Drive.open({ purpose: 'sign' }); pf.bulkPick(); };
  $('#bkDrop').onkeydown = (e) => { if (e.key === 'Enter') pf.bulkPick(); };
  $('#bkBar').onclick = barClick; $('#bkTable').onclick = tableClick; $('#bkTable').onchange = tableChange; $('#bkFoot').onclick = footClick;
  paint();
}
const counts = () => { const c = {}; for (const it of BK.st.items) c[it.status] = (c[it.status] || 0) + 1; return c; };
function paint() {
  if (BK.tab !== 'load' || !$('#bkTable')) return;
  const st = BK.st; const c = counts(); const n = st.items.length;
  const busy = (c.queued || 0) + (c.converting || 0) + (c.uploading || 0) + (c.analyzing || 0);
  const done = n - busy - (c.skipped || 0);
  $('#bkBar').innerHTML = n ? `<div class="bk-prog"><div class="bk-prog-in" style="width:${n ? Math.round(((n - busy) / n) * 100) : 0}%"></div></div>
    <div class="bk-stats">${Object.entries(BS).filter(([k]) => c[k]).map(([k, [l, cl]]) => `<span class="ops-chip ${cl}">${l}: ${c[k]}</span>`).join('')}
      ${st.coolUntil > Date.now() ? '<span class="ops-chip wait">Portalfirma responde lento: pausa breve</span>' : ''}</div>
    <div class="bk-bar-acts">${busy ? `<button class="ghost small" data-a="pause">${st.paused ? 'Reanudar' : 'Pausar'}</button>` : ''}
      ${c.error ? '<button class="ghost small" data-a="retry">Reintentar errores</button>' : ''}
      ${c.sent || c.skipped ? '<button class="ghost small" data-a="clearDone">Quitar enviados y omitidos</button>' : ''}
      ${!busy && !st.sending ? '<button class="ghost small" data-a="clearAll">Vaciar la lista</button>' : ''}</div>` : '';
  void done;
  $('#bkTable').innerHTML = n ? `<div class="bk-row bk-th"><span></span><span>Documento</span><span>Estado</span><span>Firmantes</span><span></span></div>` + st.items.map((it) => {
    const [l, cl] = BS[it.status] || [it.status, 'muted'];
    const can = it.status === 'ready';
    const sig = (it.signers || []).map((s) => `${esc(s.fullName || s.rut || '?')}${s.alias ? ` <em>(${esc(s.alias)})</em>` : ''}`).join(', ');
    return `<div class="bk-row ${it.status}" data-id="${it.id}">
      <span>${can ? `<input type="checkbox" data-sel ${it.selected !== false ? 'checked' : ''} />` : ''}</span>
      <span class="bk-doc"><b title="${esc(it.path)}">${esc(it.name)}</b><small>${kb(it.size)}${it.typeDocument ? ' · ' + esc(it.typeDocument) : ''}${it.operation ? ` · Operación N° ${it.operation}` : ''}</small></span>
      <span><span class="ops-chip ${cl}">${cl === 'run' ? '<i class="bk-spin"></i>' : ''}${l}</span>${it.error ? `<small class="bk-err">${esc(it.error)}</small>` : ''}${it.missing?.length && it.status === 'needs_data' ? `<small class="bk-err">${esc(it.missing.join(' · '))}</small>` : ''}</span>
      <span class="bk-sig">${sig || '<span class="muted">—</span>'}</span>
      <span class="bk-acts">${['ready', 'needs_data'].includes(it.status) ? '<button class="ghost small" data-a="edit">Firmantes</button>' : ''}
        ${it.status === 'error' ? '<button class="ghost small" data-a="retry1">Reintentar</button>' : ''}
        ${it.status === 'send_error' ? '<button class="ghost small" data-a="rearm" title="Revisa antes en Mis operaciones que no se haya creado">Volver a listo</button>' : ''}
        ${it.status === 'sent' ? '<button class="ghost small" data-a="seeop">Ver</button>' : ''}
        ${!['uploading', 'analyzing', 'converting', 'sending'].includes(it.status) ? `<button class="ibtn" data-a="rm" title="Quitar">${icon('x', 14)}</button>` : ''}</span></div>`;
  }).join('') : '<div class="ops-empty small"><p>Todavía no hay documentos en la cola.</p></div>';
  const ready = st.items.filter((x) => x.status === 'ready' && x.selected !== false);
  $('#bkFoot').innerHTML = st.items.some((x) => ['ready', 'needs_data', 'sending', 'sent', 'send_error'].includes(x.status)) ? `
    <div class="bk-opts"><label>Trámite<select id="bkProc"><option value="none">Solo firma electrónica</option><option value="legalization">Legalizar ante notario</option><option value="protocolization">Protocolizar</option></select></label>
      <label>Tipo de firma<select id="bkType"><option value="simple">Simple</option><option value="avanzada">Avanzada</option><option value="visada">Visada</option><option value="enrolada">Enrolada</option></select></label>
      <span class="muted small">Si Portalfirma reconoce el tipo de documento, usa su trámite y firma.</span></div>
    ${st.sending ? '<button class="secondary" data-a="stop">Detener el envío</button>' : `<button class="primary" data-a="send" ${ready.length ? '' : 'disabled'}>${icon('sign', 16)} Enviar ${ready.length} documento(s) a firmar</button>`}` : '';
  const p = $('#bkProc'); if (p) { p.value = BK.opts.protocolization; p.onchange = () => (BK.opts.protocolization = p.value); }
  const t = $('#bkType'); if (t) { t.value = BK.opts.typeSign; t.onchange = () => (BK.opts.typeSign = t.value); }
}
async function barClick(e) {
  const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'pause') await pf.bulkPause(!BK.st.paused);
  if (a === 'retry') await pf.bulkRetry(null);
  if (a === 'clearDone') await pf.bulkClear('done');
  if (a === 'clearAll') await pf.bulkClear('all');
}
async function tableClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return; const id = b.closest('[data-id]').dataset.id; const it = BK.st.items.find((x) => x.id === id);
  if (b.dataset.a === 'rm') await pf.bulkRemove(id);
  if (b.dataset.a === 'retry1') await pf.bulkRetry(id);
  if (b.dataset.a === 'rearm') await pf.bulkRearm(id);
  if (b.dataset.a === 'seeop') { show('ops'); await window.Operaciones.open(); window.Operaciones.select(Number(it.operation)); }
  if (b.dataset.a === 'edit') editSigners(it);
}
function tableChange(e) { const c = e.target.closest('[data-sel]'); if (c) pf.bulkUpdate(c.closest('[data-id]').dataset.id, { selected: c.checked }); }
function editSigners(it) {
  let rows = (it.signers || []).map((s) => ({ ...s })); if (!rows.length) rows = [{ fullName: '', rut: '', email: '', phone: '', alias: '' }];
  const req = it.required || {};
  const draw = () => {
    $('#bkSig').innerHTML = rows.map((s, i) => `<div class="bk-sigrow" data-i="${i}"><b>${i + 1}</b>
      <input data-k="fullName" placeholder="Nombre completo${req.name ? ' *' : ''}" value="${esc(s.fullName)}" />
      <input data-k="rut" placeholder="RUT *" value="${esc(s.rut)}" />
      <input data-k="alias" placeholder="Rol * (arrendador…)" value="${esc(s.alias)}" />
      <input data-k="email" placeholder="Correo${req.email ? ' *' : ''}" value="${esc(s.email)}" />
      <input data-k="phone" placeholder="Teléfono${req.phone ? ' *' : ''}" value="${esc(s.phone)}" />
      <button class="ibtn danger" data-rm="${i}" title="Quitar">${icon('trash', 14)}</button></div>`).join('');
  };
  modal(`<h2>Firmantes de «${esc(it.name)}»</h2>${it.typeDocument ? `<p class="muted small">${esc(it.typeDocument)}</p>` : ''}
    <div id="bkSig" class="bk-sigs"></div><button class="ghost small" id="bkAdd">${icon('plus', 13)} Agregar firmante</button>
    <p class="muted small">El orden es el orden de firma.</p>
    <div class="actions"><button class="secondary" id="bkAll" title="Copiar estos firmantes a todos los documentos listos">Usar en todos</button><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Guardar</button></div>`);
  draw();
  $('#bkSig').oninput = (e) => { const r = e.target.closest('[data-i]'); if (r && e.target.dataset.k) rows[r.dataset.i][e.target.dataset.k] = e.target.value; };
  $('#bkSig').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { rows.splice(Number(b.dataset.rm), 1); draw(); } };
  $('#bkAdd').onclick = () => { rows.push({ fullName: '', rut: '', email: '', phone: '', alias: '' }); draw(); };
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => { closeModal(); await pf.bulkUpdate(it.id, { signers: rows }); };
  $('#bkAll').onclick = async () => { closeModal(); await pf.bulkApplySigners(rows); toast('Firmantes aplicados a todos los documentos listos.'); };
}
async function footClick(e) {
  const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
  if (a === 'stop') return pf.bulkStopSend();
  if (a !== 'send') return;
  const ready = BK.st.items.filter((x) => x.status === 'ready' && x.selected !== false);
  const prefs = (await pf.prefs()).data || {};
  let bal = state.session?.balance; try { const b = await pf.balance(); if (b.ok) bal = b.data; } catch {}
  modal(`<h2>Enviar ${ready.length} documento(s) a firmar</h2>
    <p>Se crearán <strong>${ready.length} operaciones</strong> en Portalfirma, una por documento, de a una. <strong>Cada envío descuenta saldo</strong> según el tipo de firma y el trámite.</p>
    <dl><dt>Saldo actual</dt><dd>${bal != null ? '$' + Number(bal).toLocaleString('es-CL') : '—'}</dd><dt>Trámite</dt><dd>${{ none: 'Solo firma electrónica', legalization: 'Legalizar', protocolization: 'Protocolizar' }[BK.opts.protocolization]}</dd></dl>
    <label>Correo del pagador<input id="bkPay" value="${esc(prefs.payerEmail || '')}" placeholder="pagos@empresa.cl" /></label>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Enviar ${ready.length}</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const email = $('#bkPay').value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#bkPay').classList.add('invalid'); return; }
    closeModal(); pf.setPrefs({ payerEmail: email });
    const r = await pf.bulkSend(ready.map((x) => x.id), { email, ...BK.opts });
    if (!r.ok) return toast(r.error, 5000);
    const sent = r.data.items.filter((x) => ready.some((y) => y.id === x.id) && x.status === 'sent').length;
    toast(`${sent} de ${ready.length} documento(s) enviados a firmar.`, 5000);
  };
}

// ---------- Firma masiva con certificado ----------
// La clave del certificado vive solo en esta variable mientras dura el proceso; va directo a Portalfirma.
const CDS = { rut: '', list: [], sel: new Set(), clave: '', step: 'rut', result: null };
function renderCds() {
  const b = $('#bkBody');
  b.innerHTML = `<div class="cds">
    <p class="muted">Firma de una vez todas las operaciones que tienes pendientes como firmante, con tu certificado de firma electrónica avanzada. Recibirás un código por SMS o WhatsApp.</p>
    <div class="cds-step"><b>1</b><div><label>RUT del firmante<div class="tk-row"><input id="cdsRut" value="${esc(CDS.rut)}" placeholder="12.345.678-9" /><button class="secondary" id="cdsList">Ver pendientes</button></div></label></div></div>
    <div class="cds-step ${CDS.list.length ? '' : 'off'}"><b>2</b><div><div class="cds-list">${CDS.list.length ? CDS.list.map((o) => `<label class="cds-op"><input type="checkbox" data-op="${esc(o.operation)}" ${CDS.sel.has(String(o.operation)) ? 'checked' : ''} /> <span><b>${esc(o.document_name || o.name || 'Documento')}</b><small>Operación N° ${esc(o.operation)}</small></span></label>`).join('') : '<p class="muted small">Primero busca las operaciones pendientes.</p>'}</div></div></div>
    <div class="cds-step ${CDS.sel.size ? '' : 'off'}"><b>3</b><div>
      ${CDS.step === 'code' ? `<label>Código recibido por SMS o WhatsApp<div class="tk-row"><input id="cdsCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" /><button class="primary" id="cdsSign">Firmar ${CDS.sel.size} documento(s)</button></div></label><button class="ghost small" id="cdsBack">Cancelar</button>`
        : `<label>Clave de tu certificado<div class="tk-row"><input id="cdsKey" type="password" autocomplete="off" placeholder="Clave del certificado" /><button class="primary" id="cdsAsk" ${CDS.sel.size ? '' : 'disabled'}>Pedir código</button></div></label>
          <p class="muted small">La clave se envía directo a Portalfirma para validar tu certificado; la app no la guarda.</p>`}
    </div></div>
    ${CDS.result ? `<div class="cds-res">${CDS.result}</div>` : ''}</div>`;
  $('#cdsList').onclick = async () => {
    CDS.rut = $('#cdsRut').value.trim(); if (!CDS.rut) return;
    const r = await pf.cdsPending(CDS.rut); if (!r.ok) return toast(r.error, 5000);
    CDS.list = r.data?.operations || r.data?.pending || (Array.isArray(r.data) ? r.data : []);
    CDS.sel = new Set(CDS.list.map((o) => String(o.operation))); CDS.result = null; CDS.step = 'rut';
    if (!CDS.list.length) toast('No tienes operaciones pendientes de firma con ese RUT.', 4000);
    renderCds();
  };
  b.querySelectorAll('[data-op]').forEach((c) => (c.onchange = () => { c.checked ? CDS.sel.add(c.dataset.op) : CDS.sel.delete(c.dataset.op); renderCds(); }));
  const ask = $('#cdsAsk'); if (ask) ask.onclick = async () => {
    const k = $('#cdsKey').value; if (!k) return;
    ask.disabled = true; const r = await pf.cdsCode(CDS.rut, [...CDS.sel], k); ask.disabled = false;
    if (!r.ok) return toast(r.error, 5000);
    CDS.clave = k; CDS.step = 'code'; renderCds(); toast(r.data?.message || 'Código enviado.', 4000);
  };
  const sign = $('#cdsSign'); if (sign) sign.onclick = async () => {
    const code = $('#cdsCode').value.trim(); if (!code) return;
    sign.disabled = true; const r = await pf.cdsSign(CDS.rut, [...CDS.sel], CDS.clave, code); sign.disabled = false;
    if (!r.ok) return toast(r.error, 6000);
    CDS.clave = ''; CDS.step = 'rut';
    const res = r.data?.signed || r.data?.results || [];
    CDS.result = `<b>${icon('listCheck', 15)} Listo.</b> ${res.length ? `${res.filter((x) => x.ok !== false).length} de ${res.length} documento(s) firmados.` : esc(r.data?.message || 'Documentos firmados.')}`;
    CDS.list = CDS.list.filter((o) => !CDS.sel.has(String(o.operation))); CDS.sel = new Set(); renderCds();
  };
  const back = $('#cdsBack'); if (back) back.onclick = () => { CDS.clave = ''; CDS.step = 'rut'; renderCds(); };
}

window.Masiva = { open, _bk: BK, _cds: CDS };

})();
