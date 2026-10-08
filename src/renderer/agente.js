/* global pf, $, esc, toast, modal, closeModal, icon */
'use strict';
// ============================================================================
// Agente Portalfirma: panel lateral, disponible desde cualquier pantalla.
// Conversa en lenguaje natural y usa todas las herramientas del MCP de Portalfirma con la sesión de Studio.
// Lo que cobra, envía o notifica se confirma aquí; la clave del certificado y el código SMS se escriben
// en un campo protegido y van directo a Portalfirma (nunca al modelo de IA).
// ============================================================================
(() => {
const A = { open: false, items: [], adjuntos: [], busy: false, tools: null };
const SUGIERE = ['¿Cuál es mi saldo?', '¿Quién falta por firmar en la operación 4424?', 'Sube el documento abierto, extrae los firmantes y envíalo a firmar', 'Busca una plantilla de mandato especial', 'Muéstrame mis operaciones de los últimos 30 días'];
const NOMBRE = {
  get_partner_session: 'Sesión de la empresa', ingest_document_tools: 'Subir documento', search_document_content: 'Buscar en el documento', extract_signers_document_tools: 'Extraer firmantes',
  send_to_sign_document_tools: 'Enviar a firmar', process_detail_get_by_operation: 'Detalle de operación', operation_get_operation_by_rut: 'Operaciones por RUT', operation_get_operation_by_phone: 'Operaciones por teléfono',
  operation_manage_signing_tools: 'Gestionar firmantes', sign_documents_cds_massive_tools: 'Firma con certificado CDS', wallet_manage_balance_tools: 'Saldo', template_manage_tools: 'Plantillas', property_manage_tools: 'Propiedades',
};
const nombre = (n) => NOMBRE[n] || n.replace(/_/g, ' ');
const SECRETO = { clave_certificado: ['Clave del certificado', 'password'], segundo_factor: ['Código recibido por SMS o WhatsApp', 'text'] };

// texto del agente: enlaces clicables, negritas, listas y saltos de línea
function md(t) {
  const fmt = (l) => l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<)]+)/g, (u) => `<a href="#" data-url="${u}">${/flow\.cl/.test(u) ? 'Pagar en Flow' : u.length > 48 ? u.slice(0, 46) + '…' : u}</a>`);
  let out = ''; let ul = false;
  for (const l0 of esc(t || '').split('\n')) {
    const l = fmt(l0);
    if (/^\s*[-•*]\s+/.test(l)) { if (!ul) { out += '<ul>'; ul = true; } out += '<li>' + l.replace(/^\s*[-•*]\s+/, '') + '</li>'; }
    else { if (ul) { out += '</ul>'; ul = false; } out += l + '<br>'; }
  }
  return (ul ? out + '</ul>' : out).replace(/(<br>)+$/, '');
}

function shell() {
  if ($('#agDrawer')) return;
  const d = document.createElement('aside'); d.id = 'agDrawer'; d.className = 'ag hidden';
  d.innerHTML = `<div class="ag-head"><span class="ag-logo">${icon('sparkle', 16)}</span><div class="ag-t"><b>Agente Portalfirma</b><small id="agSub">Firmas, operaciones, plantillas y saldo</small></div>
      <button class="ibtn" id="agTools" title="Herramientas disponibles">${icon('grid', 15)}</button><button class="ibtn" id="agLog" title="Actividad">${icon('listCheck', 15)}</button><button class="ibtn" id="agNew" title="Nueva conversación">${icon('plus', 15)}</button><button class="ibtn" id="agClose" title="Cerrar">${icon('x', 15)}</button></div>
    <div class="ag-body" id="agBody"></div>
    <div class="ag-foot">
      <div class="ag-att" id="agAtt"></div>
      <div class="ag-row"><button class="ibtn" id="agClip" title="Adjuntar PDF o Word">${icon('upload', 16)}</button><textarea id="agQ" rows="2" placeholder="Escribe qué necesitas… (Enter envía, Mayús+Enter salto)"></textarea><button class="primary ag-send" id="agSend" title="Enviar">${icon('arrowR', 16)}</button></div>
      <small class="ag-note">${icon('lock', 11)} Lo que cobra o envía te pide confirmación. Las claves van directo a Portalfirma.</small></div>`;
  document.body.appendChild(d);
  $('#agClose').onclick = close; $('#agNew').onclick = nueva; $('#agTools').onclick = verTools; $('#agLog').onclick = verLog;
  $('#agClip').onclick = adjuntarMenu; $('#agSend').onclick = () => enviar();
  const q = $('#agQ'); q.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } };
  d.addEventListener('click', (e) => { const a = e.target.closest('[data-url]'); if (a) { e.preventDefault(); pf.openUrl(a.dataset.url); } });
}

function pintar() {
  const b = $('#agBody'); if (!b) return;
  b.innerHTML = A.items.length ? A.items.map(item).join('') : `<div class="ag-empty"><span class="ag-big">${icon('sparkle', 26)}</span><b>¿Qué hacemos hoy?</b><p>Puedo usar todas las herramientas de Portalfirma por ti: subir documentos, enviarlos a firmar, revisar operaciones, reenviar enlaces, plantillas, propiedades, saldo y firma con certificado.</p>
    <div class="ag-sug">${SUGIERE.map((s) => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
  b.querySelectorAll('[data-sug]').forEach((x) => (x.onclick = () => { $('#agQ').value = x.dataset.sug; enviar(); }));
  b.querySelectorAll('[data-conf]').forEach((card) => {
    const id = card.dataset.conf;
    card.querySelector('[data-no]').onclick = () => confirmar(id, false, card);
    card.querySelector('[data-si]').onclick = () => confirmar(id, true, card);
    card.querySelectorAll('input[data-sec]').forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') confirmar(id, true, card); }));
  });
  b.scrollTop = b.scrollHeight;
  $('#agAtt').innerHTML = A.adjuntos.map((a) => `<span class="ag-chip">${icon('file', 12)} ${esc(a.name)}${a.subido ? ' <i>subido</i>' : ''}<button data-rm="${esc(a.name)}" title="Quitar">${icon('x', 11)}</button></span>`).join('');
  $('#agAtt').querySelectorAll('[data-rm]').forEach((x) => (x.onclick = async () => { const r = await pf.agentUnattach(x.dataset.rm); if (r.ok) { A.adjuntos = r.data; pintar(); } }));
  $('#agSend').disabled = A.busy; $('#agQ').disabled = A.busy;
}
function item(m) {
  if (m.k === 'user') return `<div class="ag-msg user">${esc(m.text).replace(/\n/g, '<br>')}</div>`;
  if (m.k === 'bot') return `<div class="ag-msg bot">${md(m.text)}</div>`;
  if (m.k === 'nota') return `<div class="ag-msg bot soft">${md(m.text)}</div>`;
  if (m.k === 'error') return `<div class="ag-msg err">${icon('alert', 13)} ${esc(m.text)}</div>`;
  if (m.k === 'pensando') return '<div class="ag-think"><span></span><span></span><span></span></div>';
  if (m.k === 'tool') return `<div class="ag-tool ${m.estado}" title="${esc(m.name)}"><span class="ag-dot"></span>${esc(nombre(m.name))}${m.args?.action ? ` · ${esc(m.args.action.replace(/_/g, ' '))}` : ''}<em>${{ corriendo: 'trabajando…', ok: 'listo', error: 'error', cancelado: 'cancelado', esperando: 'esperando tu confirmación' }[m.estado] || ''}</em>${m.resumen ? `<small>${esc(m.resumen)}</small>` : ''}${m.url ? `<a href="#" data-url="${esc(m.url)}">${/flow\.cl/.test(m.url) ? 'Pagar en Flow' : 'Abrir enlace'}</a>` : ''}</div>`;
  if (m.k === 'confirm') {
    if (m.hecho) return `<div class="ag-conf done ${m.hecho}"><b>${esc(m.titulo)}</b><small>${m.hecho === 'si' ? 'Confirmado' : 'Cancelado'}</small></div>`;
    return `<div class="ag-conf" data-conf="${esc(m.id)}"><div class="ag-conf-h">${icon('alert', 14)}<b>${esc(m.titulo)}</b></div>
      ${(m.detalle || []).length ? `<ul>${m.detalle.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}${m.aviso ? `<p>${esc(m.aviso)}</p>` : ''}
      ${(m.secretos || []).map((k) => `<label class="ag-sec">${icon('lock', 12)} ${SECRETO[k][0]}<input data-sec="${k}" type="${SECRETO[k][1]}" autocomplete="off" spellcheck="false" /></label>`).join('')}
      ${(m.secretos || []).length ? '<small class="muted">Se entrega directo a Portalfirma. No se guarda ni pasa por la IA.</small>' : ''}
      <div class="ag-conf-b"><button class="ghost small" data-no>Cancelar</button><button class="primary small" data-si>Confirmar</button></div></div>`;
  }
  return '';
}

function confirmar(id, ok, card) {
  const secretos = {}; let falta = false;
  card.querySelectorAll('input[data-sec]').forEach((i) => { secretos[i.dataset.sec] = i.value; if (ok && !i.value.trim()) falta = true; i.value = ''; });
  if (falta) return toast('Completa el dato protegido para continuar.');
  const m = A.items.find((x) => x.k === 'confirm' && x.id === id); if (m) m.hecho = ok ? 'si' : 'no';
  const t = A.items.find((x) => x.k === 'tool' && x.id === id); if (t) t.estado = ok ? 'corriendo' : 'cancelado';
  pf.agentConfirm(id, { ok, secretos: ok ? secretos : {} });
  pintar();
}

pf.onAgentEvent((e) => {
  if (e.type === 'tool') {
    let t = A.items.find((x) => x.k === 'tool' && x.id === e.id);
    if (!t) { t = { k: 'tool', id: e.id }; const p = A.items.findIndex((x) => x.k === 'pensando'); if (p >= 0) A.items.splice(p, 0, t); else A.items.push(t); }
    Object.assign(t, { name: e.name, estado: e.estado, ...(e.args ? { args: e.args } : {}), resumen: e.resumen || '', url: e.url || null });
    if (e.name === 'ingest_document_tools' && e.estado === 'ok') A.adjuntos.forEach((a) => { if (e.resumen?.includes(a.name)) a.subido = true; });
  } else if (e.type === 'confirm') {
    const t = A.items.find((x) => x.k === 'tool' && x.id === e.id); if (t) t.estado = 'esperando';
    const p = A.items.findIndex((x) => x.k === 'pensando'); const c = { k: 'confirm', ...e }; if (p >= 0) A.items.splice(p, 0, c); else A.items.push(c);
    if (!A.open) openPanel();
  } else if (e.type === 'nota') { const p = A.items.findIndex((x) => x.k === 'pensando'); A.items.splice(p >= 0 ? p : A.items.length, 0, { k: 'nota', text: e.text }); }
  pintar();
  if (e.type === 'confirm') setTimeout(() => $(`[data-conf="${e.id}"] input`)?.focus(), 50);
});

async function enviar(texto) {
  const q = $('#agQ'); const t = (texto ?? q.value).trim(); if (!t || A.busy) return;
  if (!(await window.Asistente.ensureConsent())) return;
  q.value = ''; A.busy = true; A.items.push({ k: 'user', text: t }, { k: 'pensando' }); pintar();
  const r = await pf.agentSend(t);
  A.items = A.items.filter((x) => x.k !== 'pensando'); A.busy = false;
  if (r.ok) { if (r.data.text) A.items.push({ k: 'bot', text: r.data.text }); window.Usuario?.refresh?.(); }
  else if (r.code === 'NEEDS_LOGIN') { A.items.push({ k: 'error', text: 'Tu sesión de Portalfirma expiró. Inicia sesión de nuevo.' }); }
  else A.items.push({ k: 'error', text: r.error || 'No se pudo completar.' });
  pintar(); $('#agQ').focus();
}

async function adjuntarMenu() {
  const doc = window.editor?.docName?.();
  if (!doc) return elegir();
  modal(`<h3>Adjuntar al agente</h3><div class="ag-pick"><button class="secondary with-ic" id="agDoc">${icon('file', 15)}<span>Documento abierto: «${esc(doc)}»</span></button><button class="secondary with-ic" id="agFile">${icon('folderOpen', 15)}<span>Elegir PDF o Word…</span></button></div><div class="row-end"><button class="ghost" id="agNo">Cancelar</button></div>`);
  $('#agNo').onclick = closeModal; $('#agFile').onclick = () => { closeModal(); elegir(); };
  $('#agDoc').onclick = async () => {
    closeModal(); let bytes; try { bytes = await window.editor.finalBytes(); } catch (e) { return toast('No se pudo preparar el documento: ' + (e.message || e), 4000); } if (!bytes) return;
    const name = /\.pdf$/i.test(doc) ? doc : doc.replace(/\.[^.]+$/, '') + '.pdf';
    const r = await pf.agentAttach(name, bytes); if (!r.ok) return toast(r.error, 4000); A.adjuntos = r.data; pintar(); $('#agQ').focus();
  };
}
async function elegir() { const r = await pf.agentPick(); if (!r.ok) return toast(r.error, 4000); if (r.data) { A.adjuntos = r.data; pintar(); } }

async function nueva() {
  if (A.busy) return toast('Espera a que el agente termine.');
  await pf.agentReset(); A.items = []; A.adjuntos = []; pintar();
}
async function verTools() {
  const r = await pf.agentTools(); if (!r.ok) return toast(r.code === 'NEEDS_LOGIN' ? 'Inicia sesión en Portalfirma.' : r.error);
  modal(`<h3>Herramientas de Portalfirma</h3><p class="muted small">El agente usa las ${r.data.length} herramientas que publica hoy el servidor de Portalfirma. Si Portalfirma agrega nuevas, aparecen solas.</p>
    <div class="ag-tl">${r.data.map((t) => `<div><b>${esc(nombre(t.name))}</b><code>${esc(t.name)}</code><small>${esc((t.description || '').slice(0, 220))}</small></div>`).join('')}</div><div class="row-end"><button class="primary" id="agOk">Cerrar</button></div>`);
  $('#agOk').onclick = closeModal;
}
async function verLog() {
  const r = await pf.agentLog(); const l = r.ok ? r.data : [];
  modal(`<h3>Actividad del agente</h3><p class="muted small">Acciones realizadas en este computador (sin claves ni documentos).</p>
    <div class="ag-tl">${l.length ? l.map((x) => `<div class="${x.ok ? '' : 'bad'}"><b>${esc(x.resumen || nombre(x.tool))}</b><code>${esc(nombre(x.tool))}${x.action ? ' · ' + esc(x.action) : ''}</code><small>${new Date(x.t).toLocaleString('es-CL')}</small></div>`).join('') : '<p class="muted small">Todavía no hay actividad.</p>'}</div><div class="row-end"><button class="primary" id="agOk">Cerrar</button></div>`);
  $('#agOk').onclick = closeModal;
}

function openPanel() {
  shell(); A.open = true; $('#agDrawer').classList.remove('hidden'); document.body.classList.add('ag-on'); $('#agBtn')?.classList.add('on'); pintar(); setTimeout(() => $('#agQ')?.focus(), 60);
}
function open() { return window.members(openPanel, 'El Agente Portalfirma trabaja con tu cuenta. Inicia sesión para usarlo.'); }
function close() { A.open = false; $('#agDrawer')?.classList.add('hidden'); document.body.classList.remove('ag-on'); $('#agBtn')?.classList.remove('on'); }
function toggle() { return A.open ? close() : open(); }

// botón en la barra superior
const b = document.createElement('button'); b.id = 'agBtn'; b.className = 'ag-btn'; b.title = 'Agente Portalfirma';
b.innerHTML = `${icon('sparkle', 15)}<span>Agente</span>`; b.onclick = toggle;
const acc = $('#account'); acc?.parentNode.insertBefore(b, acc);

window.Agente = { open, close, toggle, enviar, _a: A };
})();
