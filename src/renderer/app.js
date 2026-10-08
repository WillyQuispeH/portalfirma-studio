/* global pf */
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clp = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('es-CL'));
if (navigator.userAgent.includes('Windows')) document.body.classList.add('win');
// En Windows los atajos se muestran como Ctrl / Shift (los textos de la app usan los símbolos de Mac).
const IS_WIN = navigator.userAgent.includes('Windows');
function winKeys(t) {
  if (!IS_WIN || !t || !/[⌘⌃⇧]/.test(t)) return t;
  return t.replace(/⌃⌘F/g, 'F11').replace(/⌘\/Ctrl/g, 'Ctrl').replace(/([⌃⇧⌘]+)/g, (m) => [...new Set([...m].map((c) => ({ '⌃': 'Ctrl', '⌘': 'Ctrl', '⇧': 'Shift' })[c]))].sort((a, b) => (a === 'Ctrl' ? -1 : b === 'Ctrl' ? 1 : 0)).join('+') + '+').replace(/\+(\s|\)|$)/g, '$1').replace(/Ctrl\+↩/g, 'Ctrl+Enter');
}
if (IS_WIN) {
  const fix = (root) => {
    if (root.nodeType === 1) { if (root.title) root.title = winKeys(root.title); root.querySelectorAll?.('[title]').forEach((n) => { n.title = winKeys(n.title); }); }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/[⌘⌃⇧]/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    for (let n; (n = tw.nextNode());) n.data = winKeys(n.data);
  };
  new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') { const v = winKeys(m.target.title); if (v !== m.target.title) m.target.title = v; } else m.addedNodes.forEach((n) => fix(n)); } })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  document.addEventListener('DOMContentLoaded', () => fix(document.body)); fix(document.body);
}

const SIGN_LABEL = { avanzada: 'Firma electrónica avanzada (FEA)', simple: 'Firma electrónica simple (FES)', visada: 'Visada por Portalfirma', enrolada: 'FEA enrolada' };
const PROC_LABEL = { none: 'Ninguno', legalization: 'Legalización', protocolization: 'Protocolización' };

const state = { session: null, file: null, analysis: null, signers: [], required: {}, lastOp: null, busy: false };

// ---------- utilidades ----------
function show(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + view).classList.remove('hidden');
  const tabView = view === 'plazos' ? 'plazos' : view === 'recientes' ? 'recientes' : view === 'bulk' ? 'ops' : view === 'flujos' || view === 'expedientes' || view === 'escrituras' ? 'home' : ['ops', 'tpl', 'editor', 'home'].includes(view) ? view : view === 'login' ? (state.loginFor || 'send') : 'send';
  document.body.classList.toggle('wide', view === 'editor');
  document.body.classList.toggle('home-on', view === 'home');
  document.body.classList.toggle('ops-on', view === 'recientes' || view === 'ops' || view === 'bulk' || view === 'plazos' || view === 'flujos' || view === 'expedientes' || view === 'escrituras');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === tabView));
  window.editor?.refreshTabs?.();
  window.Ayuda?.onView(view);
  window.editor?.refreshBusy?.();
}
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), ms); }
function modal(html) { $('#modalCard').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
async function api(fn, ...args) {
  const r = await pf[fn](...args);
  if (!r.ok) {
    if (r.code === 'NEEDS_LOGIN' || r.error === 'NEEDS_LOGIN') { state.session = null; setAccount(); requireLogin(() => show('drop'), 'Tu sesión expiró. Inicia sesión nuevamente.'); }
    const e = new Error(r.error); e.data = r.data; throw e;
  }
  return r.data;
}

// RUT chileno: módulo 11
function cleanRut(r) { return String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); }
function validRut(r) {
  const c = cleanRut(r); if (c.length < 2) return false;
  const body = c.slice(0, -1), dv = c.slice(-1);
  let sum = 0, mul = 2;
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const res = 11 - (sum % 11);
  const exp = res === 11 ? '0' : res === 10 ? 'K' : String(res);
  return dv === exp;
}
function formatRut(r) {
  const c = cleanRut(r); if (c.length < 2) return r;
  const body = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${c.slice(-1)}`;
}
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const validPhone = (p) => (String(p || '').replace(/\D/g, '').length >= 5);
function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 9 && d.startsWith('9')) return '+56' + d; // celular chileno sin código
  return String(p).trim().startsWith('+') ? '+' + d : (d.startsWith('56') ? '+' + d : d);
}

// ---------- sesión (solo se pide para funciones de Portalfirma) ----------
function setAccount() {
  const on = !!state.session;
  document.body.classList.toggle('guest', !on);
  window.dispatchEvent(new Event('pf-account'));
  $('#balance').classList.toggle('hidden', !on); $('#logoutBtn').classList.toggle('hidden', !on); $('#topLoginBtn').classList.toggle('hidden', on);
  if (on) $('#balance').textContent = 'Saldo ' + clp(state.session?.balance);
  window.Usuario?.refresh();
}
function toLoggedIn(sess) {
  state.session = sess; setAccount();
  const next = state.afterLogin; state.afterLogin = null;
  if (next) next(); else if (!$('#view-login').classList.contains('hidden')) show('drop');
}
function toLoggedOut(msg) {
  state.session = null; setAccount();
  if (msg) { $('#loginHint').textContent = msg; show('login'); }
}
// Ejecuta `fn` si hay sesión; si no, muestra el inicio de sesión y continúa después.
function requireLogin(fn, why, forTab) {
  if (state.session) return fn();
  state.afterLogin = fn; state.loginFor = forTab || null;
  $('#loginWhy').textContent = why || 'Para enviar a firmar, visar o legalizar, usar la Notaría virtual y ver tus operaciones.';
  show('login');
}
// Funciones exclusivas para clientes de Portalfirma (IA y firma): piden iniciar sesión y vuelven a donde estaba.
const MEMBERS_WHY = 'Esta función es exclusiva para clientes de Portalfirma. Inicia sesión con tu cuenta para usarla.';
function members(fn, why) {
  if (state.session) return fn();
  const back = [...document.querySelectorAll('.view')].find((v) => !v.classList.contains('hidden'))?.id.replace('view-', '') || 'home';
  requireLogin(() => { if (back === 'editor') window.studio.goEditor(); else if (back === 'home') window.studio.goHome(); else show(back); return fn(); }, why || MEMBERS_WHY);
}
window.members = members;
window.isMember = () => !!state.session || !!window.Usuario?._u.user;
// Bienvenida: la app es para clientes de Portalfirma; sin cuenta solo se usan las funciones básicas.
const SIGNUP_URL = 'https://www.portalfirma.cl';
function welcome() {
  modal(`<div class="welcome"><img src="assets/logo.png" alt="Portalfirma" class="login-logo" />
    <h2>Bienvenido a PortalFirma Studio</h2>
    <p>PortalFirma Studio es para <strong>clientes de Portalfirma</strong>. Inicia sesión con tu cuenta para usar la firma electrónica, la Notaría virtual y el asistente legal con IA.</p>
    <div class="welcome-btns"><button class="primary" id="wLogin">Iniciar sesión con Portalfirma</button><button class="secondary" id="wSignup">Crear una cuenta en Portalfirma</button></div>
    <p class="muted small">Sin cuenta puedes usar las funciones básicas: abrir, crear, combinar, convertir, editar, organizar, dividir, comprimir, exportar e imprimir PDF.</p>
    <button class="ghost small" id="wBasic">Continuar solo con las funciones básicas</button></div>`);
  $('#wSignup').onclick = () => pf.openUrl(SIGNUP_URL);
  $('#wBasic').onclick = closeModal;
  $('#wLogin').onclick = async () => {
    const b = $('#wLogin'); b.disabled = true; b.textContent = 'Esperando inicio de sesión en el navegador…';
    try { const sess = await api('login'); closeModal(); state.session = sess; setAccount(); toast('Sesión iniciada. Ya tienes acceso a todas las funciones.'); }
    catch (e) { b.disabled = false; b.textContent = 'Iniciar sesión con Portalfirma'; toast('No se pudo iniciar sesión: ' + e.message, 5000); }
  };
}
async function refreshBalance() { try { const b = await api('balance'); $('#balance').textContent = 'Saldo ' + clp(b); if (state.session) state.session.balance = b; } catch {} }

$('#loginBtn').onclick = async () => {
  const b = $('#loginBtn'); b.disabled = true; b.textContent = 'Esperando inicio de sesión en el navegador…';
  try { toLoggedIn(await api('login')); }
  catch (e) { $('#loginHint').textContent = 'No se pudo iniciar sesión: ' + e.message; }
  finally { b.disabled = false; b.textContent = 'Iniciar sesión con Portalfirma'; }
};
$('#logoutBtn').onclick = async () => { await pf.logout(); toLoggedOut(); toast('Sesión cerrada'); window.studio?.goHome(); };
$('#topLoginBtn').onclick = () => requireLogin(() => show('drop'), 'Conecta tu cuenta para enviar documentos a firmar.');
$('#loginApi').onclick = () => window.ApiDiag.open();
$('#loginBack').onclick = () => { state.afterLogin = null; window.studio?.goEditor(); };
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
  const v = t.dataset.view;
  if (v === 'home') window.studio.goHome();
  else if (v === 'editor') window.studio.goEditor();
  else if (v === 'tpl') requireLogin(() => { show('tpl'); window.openTemplates && window.openTemplates(); }, 'Para usar la Notaría virtual, inicia sesión en Portalfirma.', 'tpl');
  else if (v === 'plazos') window.Plazos.open();
  else if (v === 'recientes') window.Recientes.open();
  else if (v === 'ops') { show('ops'); window.Operaciones.open(); }
  else requireLogin(() => show(state.analysis ? 'review' : 'drop'), 'Para enviar documentos a firmar, inicia sesión en Portalfirma.', 'send');
}));

// ---------- arrastrar y soltar ----------
let dragDepth = 0;
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { e.preventDefault(); if (!isFileDrag(e)) return; dragDepth++; $('#dragOverlay').classList.remove('hidden'); $('#dropzone').classList.add('over'); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { $('#dragOverlay').classList.add('hidden'); $('#dropzone').classList.remove('over'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('#dragOverlay').classList.add('hidden'); $('#dropzone').classList.remove('over');
  const files = [...e.dataTransfer.files]; const f = files[0]; if (!f) return;
  const paths = files.map((x) => pf.pathForFile(x));
  if (!$('#view-bulk').classList.contains('hidden')) return pf.bulkAdd(paths); // carga masiva: todo va a la cola
  if (!$('#view-expedientes').classList.contains('hidden')) return window.Expedientes.dropFiles(paths); // expedientes: los archivos se guardan en el caso elegido
  if (!$('#view-escrituras').classList.contains('hidden')) return window.Escrituras.dropFiles(paths); // escrituras: minuta o documentos a protocolizar
  if (!$('#view-flujos').classList.contains('hidden')) return window.Flujos.dropFiles(paths); // flujos: la nómina (en otros pasos no se abre nada)
  const onSend = !$('#view-drop').classList.contains('hidden') && state.session;
  // Fuera de "Enviar a firmar": cada PDF se abre en su pestaña; Word, Excel e imágenes se convierten.
  if (!onSend) { window.studio.goEditor(); return window.editor.openEach(paths); }
  // Varios archivos, o formatos que hay que convertir (Excel, imágenes): se abren en el editor.
  if (files.length > 1 || !/\.(pdf|docx)$/i.test(f.name)) {
    show('editor'); window.editor.open(); window.editor.openPaths(paths, true);
    return toast(files.length > 1 ? 'Se abrieron en el Editor PDF para combinarlos.' : 'Se abrió en el Editor PDF para convertirlo a PDF.', 4000);
  }
  try { startAnalysis(await api('checkFile', pf.pathForFile(f))); } catch (err) { toast(err.message, 4000); }
});
$('#toEditor').onclick = (e) => { e.preventDefault(); window.studio.goEditor(); };
$('#pickDrive').querySelector('.ic-drive').outerHTML = icon('drive', 16);
$('#pickDrive').onclick = () => window.Drive.open({ purpose: 'sign' });
$('#pickBtn').onclick = async () => { try { const f = await api('pickFile'); if (f) startAnalysis(f); } catch (e) { toast(e.message, 4000); } };
pf.onFile((f) => window.editor.openPaths([f.path], true));
pf.onOpenInEditor((paths) => window.editor.openPaths(paths, true));
pf.onFileError((m) => toast(m, 4000));

// ---------- análisis (ingest + extract) ----------
async function startAnalysis(file) {
  if (state.busy) return;
  state.busy = true; state.file = file; state.analysis = null;
  show('working');
  $('#workingTitle').textContent = 'Analizando ' + file.name + '…';
  const steps = [...document.querySelectorAll('#workingSteps li')];
  steps.forEach((s, i) => { s.className = i === 0 ? 'active' : ''; });
  const t = setTimeout(() => { steps[0].className = 'done'; steps[1].className = 'active'; }, 1200);
  try {
    const r = await api('analyze', file.path);
    clearTimeout(t); steps.forEach((s) => (s.className = 'done'));
    state.analysis = r;
    if (r.file?.converted) state.file = r.file; // se sube y se envía el PDF convertido
    setupReview(r);
    showConvertedNote(r.file);
    show('review');
  } catch (e) {
    clearTimeout(t); show('drop'); toast('No se pudo analizar: ' + e.message, 5000);
  } finally { state.busy = false; }
}

function setupReview(r) {
  const x = r.extract || {};
  $('#fileChip').textContent = r.file.name;
  $('#docType').textContent = x.typeDocument || 'Documento';
  $('#docSummary').textContent = x.summary || '';
  state.required = x.required_fields || { rut: true, alias: true, name: true, email: false, phone: false };
  const locked = !!x.document_config_id;
  $('#configLocked').classList.toggle('hidden', !locked);
  $('#configFree').classList.toggle('hidden', locked);
  if (locked) {
    const cfgName = x.documentConfig?.name || x.typeDocument || 'Tipo de documento';
    $('#configLocked').innerHTML = `<strong>${esc(cfgName)}</strong><br>Firma: ${esc(SIGN_LABEL[x.type_sign] || x.type_sign || 'según tipo')} · Trámite: ${esc(PROC_LABEL[x.notarial_procedure] || x.notarial_procedure || 'según tipo')}<br><span class="muted small">Definido por el tipo de documento en Portalfirma.</span>`;
  } else {
    $('#typeSignAll').value = x.type_sign || 'avanzada';
    $('#protocolization').value = x.notarial_procedure || 'none';
  }
  state.signers = (x.firmantes || []).map((s) => ({ fullName: s.fullName || '', rut: s.rut || '', email: s.email || '', phone: s.phone || '', alias: s.alias || '', typeSign: '' }));
  if (state.prefillSigners?.length) { // firmantes que vienen de una plantilla llenada
    const pre = state.prefillSigners; state.prefillSigners = null;
    pre.forEach((p, i) => {
      let s = state.signers.find((x) => x.alias && p.alias && x.alias.toLowerCase() === p.alias.toLowerCase()) || state.signers.find((x, k) => k >= i && !x.rut && !x._pre);
      if (!s) { s = emptySigner(); state.signers.push(s); }
      for (const k of ['fullName', 'rut', 'email', 'phone', 'alias']) if (p[k] && !s[k]) s[k] = p[k];
      s._pre = true;
    });
  }
  if (!state.signers.length) state.signers.push(emptySigner());
  pf.prefs().then((p) => { if (p.ok && !$('#payerEmail').value) $('#payerEmail').value = p.data.payerEmail || ''; });
  $('#discount').value = ''; $('#reviewError').textContent = '';
  renderSigners();
}
const emptySigner = () => ({ fullName: '', rut: '', email: '', phone: '', alias: '', typeSign: '' });

function signerErrors(s) {
  const req = state.required, e = {};
  if (!validRut(s.rut)) e.rut = 'RUT inválido';
  if (!s.alias.trim()) e.alias = 'Indica el rol';
  else if (/^firmante\s*\d*$/i.test(s.alias.trim())) e.alias = 'Usa el rol real (ej. arrendador)';
  if (req.name && !s.fullName.trim()) e.fullName = 'Obligatorio';
  if ((req.email || s.email) && !validEmail(s.email)) e.email = req.email && !s.email ? 'Obligatorio' : 'Correo inválido';
  if ((req.phone || s.phone) && !validPhone(s.phone)) e.phone = req.phone && !s.phone ? 'Obligatorio' : 'Teléfono inválido';
  return e;
}

function renderSigners() {
  const locked = !!state.analysis?.extract?.document_config_id;
  const host = $('#signers');
  host.innerHTML = state.signers.map((s, i) => {
    const err = signerErrors(s);
    const f = (key, label, type = 'text', ph = '') => `<label>${label}${state.required[key === 'fullName' ? 'name' : key] ? ' *' : ''}
      <input data-i="${i}" data-k="${key}" type="${type}" value="${esc(s[key])}" placeholder="${ph}" class="${s._touched && err[key] ? 'invalid' : ''}" />
      ${s._touched && err[key] ? `<span class="missing">${esc(err[key])}</span>` : ''}</label>`;
    const typeSel = locked ? '' : `<label>Tipo de firma (este firmante)
      <select data-i="${i}" data-k="typeSign"><option value="">Igual que el documento</option>
      ${Object.entries(SIGN_LABEL).map(([v, l]) => `<option value="${v}" ${s.typeSign === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    return `<div class="signer">
      <div class="signer-head"><span class="order">${i + 1}</span><strong>${esc(s.fullName || 'Nuevo firmante')}</strong>
        <span class="spacer"></span>
        <button class="ghost small" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Subir">${icon('chevU', 15)}</button>
        <button class="ghost small" data-act="down" data-i="${i}" ${i === state.signers.length - 1 ? 'disabled' : ''} title="Bajar">${icon('chevD', 15)}</button>
        <button class="danger small" data-act="del" data-i="${i}" ${state.signers.length === 1 ? 'disabled' : ''}>Quitar</button></div>
      <div class="signer-grid">
        ${f('fullName', 'Nombre completo')}${f('rut', 'RUT', 'text', '12.345.678-9')}${f('alias', 'Rol en el documento', 'text', 'arrendador, comprador…')}
        ${f('email', 'Correo', 'email', 'nombre@correo.cl')}${f('phone', 'Teléfono', 'tel', '+56 9 1234 5678')}${typeSel}
      </div></div>`;
  }).join('');
}
$('#signers').addEventListener('input', (e) => {
  const i = e.target.dataset.i, k = e.target.dataset.k; if (i == null || !k) return;
  state.signers[i][k] = e.target.value;
});
$('#signers').addEventListener('change', (e) => {
  const i = e.target.dataset.i, k = e.target.dataset.k; if (i == null || !k) return;
  const s = state.signers[i];
  if (k === 'rut' && validRut(s.rut)) s.rut = formatRut(s.rut);
  if (k === 'phone') s.phone = normPhone(s.phone) || s.phone;
  s._touched = true; renderSigners();
});
$('#signers').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = Number(b.dataset.i), a = b.dataset.act, arr = state.signers;
  if (a === 'del') arr.splice(i, 1);
  if (a === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  if (a === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  renderSigners();
});
$('#addSigner').onclick = () => { state.signers.push(emptySigner()); renderSigners(); };
$('#cancelReview').onclick = () => { state.analysis = null; show('drop'); };

// ---------- envío ----------
function buildPayload() {
  const x = state.analysis.extract || {};
  const locked = !!x.document_config_id;
  const all = $('#typeSignAll').value;
  const payload = {
    document_id: state.analysis.ingest.document_id,
    email: $('#payerEmail').value.trim(),
    signatories: state.signers.map((s) => {
      const o = { rut: formatRut(s.rut), alias: s.alias.trim(), fullName: s.fullName.trim(), email: s.email.trim(), phone: normPhone(s.phone) };
      if (!locked) o.typeSign = s.typeSign || all;
      return o;
    }),
  };
  if (locked) payload.document_config_id = x.document_config_id;
  else payload.protocolization = $('#protocolization').value;
  const code = $('#discount').value.trim(); if (code) payload.code = code;
  return payload;
}

$('#sendBtn').onclick = () => {
  state.signers.forEach((s) => (s._touched = true)); renderSigners();
  const bad = state.signers.findIndex((s) => Object.keys(signerErrors(s)).length);
  if (bad >= 0) { $('#reviewError').textContent = `Revisa los datos del firmante ${bad + 1}.`; return; }
  if (!validEmail($('#payerEmail').value)) { $('#reviewError').textContent = 'Ingresa el correo del pagador.'; return; }
  $('#reviewError').textContent = '';
  const p = buildPayload(); const x = state.analysis.extract || {};
  const firma = p.document_config_id ? (SIGN_LABEL[x.type_sign] || 'según tipo de documento') : [...new Set(p.signatories.map((s) => SIGN_LABEL[s.typeSign]))].join(', ');
  const tramite = p.document_config_id ? (PROC_LABEL[x.notarial_procedure] || 'según tipo de documento') : PROC_LABEL[p.protocolization];
  modal(`<h2>Confirmar envío</h2>
    <dl><dt>Documento</dt><dd>${esc(state.file.name)}</dd>
    <dt>Firma</dt><dd>${esc(firma)}</dd><dt>Trámite notarial</dt><dd>${esc(tramite)}</dd>
    <dt>Firmantes</dt><dd>${p.signatories.map((s, i) => `${i + 1}. ${esc(s.fullName)} (${esc(s.alias)}) — ${esc(s.rut)}`).join('<br>')}</dd>
    <dt>Pagador</dt><dd>${esc(p.email)}</dd><dt>Saldo actual</dt><dd>${clp(state.session?.balance)}</dd></dl>
    <p class="muted small">La operación se cobrará según la tarifa de Portalfirma. Los firmantes recibirán su enlace de firma.</p>
    <div class="actions"><button class="secondary" id="mCancel">Volver</button><button class="primary" id="mOk">Confirmar y enviar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    $('#mOk').disabled = true; $('#mOk').textContent = 'Enviando…';
    try {
      pf.setPrefs({ payerEmail: p.email });
      const r = await api('send', { ...p, __fileName: state.file.name });
      closeModal(); showDone(r);
    } catch (e) {
      closeModal(); $('#reviewError').textContent = /^Portalfirma/.test(e.message) ? e.message : 'Portalfirma rechazó el envío: ' + e.message;
    }
  };
};

function showConvertedNote(file) {
  let n = $('#convNote'); if (!n) { n = document.createElement('div'); n.id = 'convNote'; n.className = 'conv-note'; $('#view-review').prepend(n); }
  if (!file?.converted) { n.classList.add('hidden'); return; }
  n.classList.remove('hidden');
  n.innerHTML = `${icon('convert', 16)}<span>«${esc(file.original)}» se convirtió a PDF antes de subirlo. Revisa que el formato haya quedado bien.</span><button class="secondary small" id="convView">Ver PDF</button>`;
  $('#convView').onclick = () => window.editor.openPaths([file.path], true);
}
async function showDone(r) {
  if (r.operation == null && /error|fall[oó]|failed|status code/i.test(r.raw?.message || '')) { // no mostrar éxito si falló
    show('review'); $('#reviewError').textContent = 'Portalfirma rechazó el envío: ' + r.raw.message; return;
  }
  state.lastOp = r.operation; state.analysis = null;
  const ctx = window.__expCtx; window.__expCtx = null; // enviado desde un expediente: queda en su historial
  if (ctx && r.operation != null) pf.expLog(ctx.id, { kind: 'sent', op: r.operation, text: `Enviado a firmar «${ctx.file}»`, files: [ctx.file] });
  $('#doneOp').textContent = r.operation ?? '(ver en Mis operaciones)';
  $('#doneMsg').textContent = r.raw?.message || '';
  $('#doneDetail').innerHTML = '<p class="muted">Cargando enlaces de firma…</p>';
  show('done'); refreshBalance();
  if (r.operation != null) {
    try { renderDetail(await api('detail', r.operation), $('#doneDetail')); } catch (e) { $('#doneDetail').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  } else $('#doneDetail').innerHTML = `<pre class="small">${esc(JSON.stringify(r.raw, null, 2))}</pre>`;
}
$('#newDocBtn').onclick = () => show('drop');
$('#viewOpBtn').onclick = async () => { show('ops'); await window.Operaciones.open(); if (state.lastOp != null) window.Operaciones.select(Number(state.lastOp)); };

// ---------- seguimiento ----------
const STATUS = { finalized: ['Finalizado', 'ok'], in_progress: ['En firma', 'wait'], pending: ['Pendiente', 'wait'] };
function renderDetail(d, host) {
  const [lbl, cls] = STATUS[d.status] || [d.status || '—', ''];
  const sigs = d.signatories || [];
  host.innerHTML = `<div class="row-between"><h3>Operación ${esc(d.operation)}</h3><span class="pill ${cls}">${esc(lbl)}</span></div>
    <table><tr><th>#</th><th>Firmante</th><th>RUT</th><th>Estado</th><th>Enlace de firma</th></tr>
    ${sigs.map((s, i) => `<tr><td>${i + 1}</td><td>${esc([s.name, s.paternalLastName, s.maternalLastName].filter(Boolean).join(' '))}<br><span class="muted small">${esc(s.email)} ${esc(s.phone)}</span></td>
      <td>${esc(s.rut)}</td><td>${s.signed ? '<span class="pill ok">Firmó</span>' : '<span class="pill wait">Pendiente</span>'}</td>
      <td>${s.signed ? '' : `<div class="link-actions">
        <button class="secondary small" data-copy="${esc((s.url || '').trim())}">Copiar</button>
        <button class="secondary small" data-mail="${i}">Correo</button>
        <button class="secondary small" data-wa="${i}">WhatsApp</button></div>`}</td></tr>`).join('')}</table>
    ${d.processId ? '<h3 style="margin-top:14px">Documento</h3><button class="secondary small" data-doc>Ver documento</button>' : ''}
    <div class="actions" style="margin-top:12px"><button class="ghost small" data-refresh>Actualizar</button>
      ${d.status !== 'finalized' ? '<button class="secondary small" data-resend>Reenviar a todos</button>' : ''}</div>`;
  host.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.copy != null) { await navigator.clipboard.writeText(b.dataset.copy); toast('Enlace copiado'); }
      else if (b.hasAttribute('data-doc')) { const r = await pf.opsFile(d.operation); if (!r.ok) { if (r.code === 'NO_FILE_KEY') return window.Operaciones.askKey(); throw new Error(r.error); } window.editor.openPaths([r.data.path], true); }
      else if (b.dataset.mail != null) {
        const s = sigs[b.dataset.mail];
        await api('manage', { action: 'send_signature_link_by_email', email: s.email, name: s.name, link: (s.url || '').trim(), operation: d.operation });
        toast('Enlace enviado por correo a ' + s.email);
      } else if (b.dataset.wa != null) {
        const s = sigs[b.dataset.wa];
        await api('manage', { action: 'send_signature_link_by_whatsapp', operation: d.operation, personId: s.personId });
        toast('Enlace enviado por WhatsApp');
      } else if (b.hasAttribute('data-resend')) {
        await api('manage', { action: 'resend_operation_to_sign', contract_id: d.processId }); toast('Operación reenviada');
      } else if (b.hasAttribute('data-refresh')) renderDetail(await api('detail', d.operation), host);
    } catch (err) { toast('Error: ' + err.message, 4000); }
  };
}
async function loadHistory() {
  const h = await api('history').catch(() => []);
  const host = $('#historyList');
  host.innerHTML = '<h3>Enviados desde esta app</h3>' + (h.length ? h.map((x) => `<div class="list-item" data-op="${esc(x.operation)}">
    <span><strong>${esc(x.operation ?? '—')}</strong><br><span class="muted small">${esc(x.name || '')}</span></span>
    <span class="muted small">${esc(new Date(x.date).toLocaleDateString('es-CL'))}</span></div>`).join('') : '<p class="muted">Aún no envías documentos desde esta app.</p>');
  host.onclick = (e) => { const it = e.target.closest('[data-op]'); if (it) { host.querySelectorAll('.list-item').forEach((n) => n.classList.toggle('sel', n === it)); openOp(it.dataset.op); } };
}
async function openOp(n) {
  const host = $('#opDetail');
  if (n == null || !/\d/.test(String(n))) { host.innerHTML = '<p class="muted">Escribe un número de operación válido (por ejemplo, 23736).</p>'; return; }
  host.innerHTML = '<p class="muted">Cargando…</p>';
  try { renderDetail(await api('detail', isNaN(n) ? n : Number(n)), host); } catch (e) { host.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
$('#opSearchBtn').onclick = () => { const n = $('#opSearch').value.trim(); if (n) openOp(n); };
$('#opSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#opSearchBtn').click(); });

// ---------- inicio: se abre PortalFirma Studio; la sesión se recupera en segundo plano ----------
(async () => {
  setAccount();
  const r = await pf.restore();
  if (r.ok && r.data) { state.session = r.data; setAccount(); return; }
  const p = await pf.prefs?.(); const mock = p?.ok && p.data?.mock;
  if (!mock || p.data.welcome) welcome();
})();
