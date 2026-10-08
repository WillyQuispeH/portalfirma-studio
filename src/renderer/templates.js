/* global pf, $, esc, show, toast, modal, closeModal, state, api, validRut, formatRut, validEmail, validPhone, normPhone, clp, showDone */
'use strict';

// Categorías de la Notaría virtual (mismas de empresa.portalfirma.cl). La búsqueda del
// conector es semántica, así que cada categoría se consulta por su nombre.
const TPL_CATEGORIES = [
  'Poderes Notariales', 'Trámites Municipales', 'Empresas y Sociedades', 'Declaraciones juradas', 'Salvoconducto',
  'Vehículos', 'Autorización Notarial', 'Contratos y Acuerdos', 'Contratos de Arriendo', 'Documentos de cobro',
  'Certificados', 'Autorización de Menor', 'Cartas de Invitación', 'Finiquitos',
  'Contratos de Servicio Doméstico y Personal', 'Documentos TAG', 'Minería', 'Postulaciones',
];
const ESTADO_CIVIL = ['Soltero(a)', 'Casado(a)', 'Divorciado(a)', 'Viudo(a)', 'Conviviente civil', 'Separado(a) judicialmente'];
const ACCENTS = { vehiculo: 'vehículo', direccion: 'dirección', telefono: 'teléfono', dias: 'días', numero: 'número', garantia: 'garantía', duracion: 'duración', razon: 'razón', informacion: 'información', descripcion: 'descripción', credito: 'crédito' };

const tpl = { loaded: false, current: null, values: {}, touched: false, category: TPL_CATEGORIES[0], results: [] };

function nice(txt) {
  let t = String(txt || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === t.toUpperCase()) t = t.toLowerCase();
  t = t.replace(/\b([a-záéíóúñ]+)\b/gi, (w) => ACCENTS[w.toLowerCase()] || w);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const todayISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
const isoToCL = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('-') : iso);

// ---------- catálogo ----------
function renderCatalogShell() {
  $('#tplBody').innerHTML = `
    <div class="tpl-head">
      <div><h2>Notaría virtual</h2><p class="muted">Elige un trámite, completa los datos y envíalo a firmar.</p></div>
      <div class="row tpl-search"><input type="search" id="tplQuery" placeholder="Buscar trámite (ej. poder para retirar auto, declaración de domicilio…)" />
        <button class="secondary" id="tplGo">Buscar</button></div>
    </div>
    <div class="chips tpl-cats" id="tplCats">${TPL_CATEGORIES.map((c) => `<button class="chip ${c === tpl.category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="tplResults" class="tpl-grid"></div>`;
  $('#tplCats').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { tpl.category = b.dataset.cat; $('#tplQuery').value = ''; markCat(); runSearch(tpl.category); } };
  const go = () => { const q = $('#tplQuery').value.trim(); if (q.length >= 2) { tpl.category = null; markCat(); runSearch(q); } };
  $('#tplGo').onclick = go; $('#tplQuery').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('#tplResults').onclick = (e) => { const b = e.target.closest('[data-use]'); if (b) openTemplate(b.dataset.use); const w = e.target.closest('[data-web]'); if (w) pf.openUrl(w.dataset.web); };
}
function markCat() { document.querySelectorAll('#tplCats .chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === tpl.category)); }

async function runSearch(q) {
  const host = $('#tplResults');
  host.innerHTML = '<p class="muted">Buscando trámites…</p>';
  try {
    const r = await api('tplSearch', q);
    const seen = new Set();
    tpl.results = (Array.isArray(r) ? r : r?.results || []).filter((t) => t.template_version_id && !seen.has(t.template_version_id) && seen.add(t.template_version_id));
    if (!tpl.results.length) { host.innerHTML = '<p class="muted">No se encontraron trámites. Prueba con otras palabras.</p>'; return; }
    host.innerHTML = tpl.results.map((t) => `<div class="card tpl-card">
      <span class="pill">Plantilla</span>
      <h3>${esc(t.name)}</h3>
      <p class="muted small">${esc(t.description || 'Sin descripción')}</p>
      <div class="actions"><button class="primary small" data-use="${esc(t.template_version_id)}">Usar plantilla</button></div></div>`).join('');
  } catch (e) { host.innerHTML = `<p class="error">No se pudo cargar el catálogo: ${esc(e.message)}</p>`; }
}

window.openTemplates = function openTemplates() {
  if (!tpl.current && !tpl.loaded) { renderCatalogShell(); runSearch(tpl.category); tpl.loaded = true; }
};

// ---------- formulario ----------
async function openTemplate(id) {
  $('#tplBody').innerHTML = '<div class="card"><p class="muted">Cargando formulario…</p></div>';
  try {
    const f = await api('tplForms', id);
    const meta = tpl.results.find((t) => t.template_version_id === id) || {};
    tpl.current = { ...f, url: meta.url };
    tpl.values = {}; tpl.touched = false;
    for (const g of f.groups || []) for (const v of g.variables || []) if (v.input_type === 'date') tpl.values[v.id] = todayISO();
    renderForm();
  } catch (e) { toast('No se pudo abrir la plantilla: ' + e.message, 5000); backToCatalog(); }
}
function backToCatalog() { tpl.current = null; renderCatalogShell(); markCat(); if (tpl.results.length) runSearch(tpl.category || $('#tplQuery')?.value || TPL_CATEGORIES[0]); }

function fieldError(v, val) {
  val = (val ?? '').trim();
  if (!val) return v.required ? 'Obligatorio' : '';
  if (v.input_type === 'rut' && !validRut(val)) return 'RUT inválido';
  if (v.input_type === 'email' && !validEmail(val)) return 'Correo inválido';
  if (v.input_type === 'phone' && !validPhone(val)) return 'Teléfono inválido';
  return '';
}

function inputFor(v) {
  const val = tpl.values[v.id] ?? '';
  const err = tpl.touched ? fieldError(v, val) : '';
  const cls = err ? 'invalid' : '';
  const common = `data-f="${esc(v.id)}" class="${cls}"`;
  let ctl;
  switch (v.input_type) {
    case 'date': ctl = `<input type="date" ${common} value="${esc(val)}" />`; break;
    case 'email': ctl = `<input type="email" ${common} value="${esc(val)}" placeholder="nombre@correo.cl" />`; break;
    case 'phone': ctl = `<input type="tel" ${common} value="${esc(val)}" placeholder="+56 9 1234 5678" />`; break;
    case 'rut': ctl = `<input type="text" ${common} value="${esc(val)}" placeholder="12.345.678-9" />`; break;
    case 'select': ctl = `<input type="text" list="dl-${esc(v.id)}" ${common} value="${esc(val)}" placeholder="Elige o escribe" />
      <datalist id="dl-${esc(v.id)}">${(/civil/i.test(v.id) ? ESTADO_CIVIL : []).map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`; break;
    default: {
      const long = /texto|detalle|descrip|objeto|inventario|clausula|cláusula|facultad|acuerdo|libre/i.test(v.id);
      ctl = long ? `<textarea rows="3" ${common}>${esc(val)}</textarea>` : `<input type="text" ${common} value="${esc(val)}" />`;
    }
  }
  return `<label>${esc(nice(v.label || v.name))}${v.required ? ' *' : ''}${ctl}${err ? `<span class="missing">${esc(err)}</span>` : ''}</label>`;
}

function renderForm() {
  const f = tpl.current;
  const groups = f.groups || [];
  const signers = groups.filter((g) => g.type === 'signer');
  $('#tplBody').innerHTML = `
    <div class="review-head">
      <div><button class="ghost small" id="tplBack">${icon('chevL', 15)} Volver al catálogo</button>
        <h2>${esc(f.name)}</h2><p class="muted">${esc(f.description || '')}</p>
        ${signers.length ? `<p class="small">Firman: <strong>${signers.map((g) => esc(nice(g.group))).join(', ')}</strong>. Recibirán su enlace de firma al correo indicado.</p>` : ''}
        ${f.requires_property ? '<p class="notice small">Este trámite usa datos de una propiedad: complétalos en la sección correspondiente.</p>' : ''}</div>
      ${f.url ? `<button class="ghost small" id="tplWeb">Ver en la web</button>` : ''}
    </div>
    <div id="tplGroups">${groups.map((g, gi) => `<div class="card">
      <div class="row-between"><h3>${esc(nice(g.group))}</h3>${g.type === 'signer' ? '<span class="pill ok">Firma</span>' : ''}</div>
      <div class="signer-grid">${(g.variables || []).map(inputFor).join('')}</div></div>`).join('')}</div>
    <div class="actions"><span id="tplError" class="error"></span><button class="primary" id="tplSend">Generar y enviar a firmar</button></div>`;
  $('#tplBack').onclick = backToCatalog;
  if ($('#tplWeb')) $('#tplWeb').onclick = () => pf.openUrl(f.url);
  const host = $('#tplGroups');
  host.addEventListener('input', (e) => { const id = e.target.dataset.f; if (id) tpl.values[id] = e.target.value; });
  host.addEventListener('change', (e) => {
    const id = e.target.dataset.f; if (!id) return;
    const v = allVars().find((x) => x.id === id);
    if (v?.input_type === 'rut' && validRut(tpl.values[id])) tpl.values[id] = formatRut(tpl.values[id]);
    if (v?.input_type === 'phone') tpl.values[id] = normPhone(tpl.values[id]) || tpl.values[id];
    if (tpl.touched) { const keep = id; renderForm(); document.querySelector(`[data-f="${CSS.escape(keep)}"]`)?.focus(); }
    else e.target.value = tpl.values[id];
  });
  $('#tplSend').onclick = confirmSend;
}
const allVars = () => (tpl.current?.groups || []).flatMap((g) => g.variables || []);

function confirmSend() {
  tpl.touched = true;
  const bad = allVars().find((v) => fieldError(v, tpl.values[v.id]));
  if (bad) {
    renderForm();
    $('#tplError').textContent = `Revisa los campos marcados (${nice(bad.label || bad.name)}).`;
    document.querySelector('input.invalid, textarea.invalid')?.scrollIntoView({ block: 'center' });
    return;
  }
  const values = {};
  for (const v of allVars()) {
    let val = (tpl.values[v.id] ?? '').trim();
    if (!val) continue;
    if (v.input_type === 'date') val = isoToCL(val);
    if (v.input_type === 'rut') val = formatRut(val);
    if (v.input_type === 'phone') val = normPhone(val);
    values[v.id] = val;
  }
  const f = tpl.current;
  const signerRows = (f.groups || []).filter((g) => g.type === 'signer').map((g) => {
    const get = (k) => values[(g.variables || []).find((v) => v.name === k || v.input_type === k)?.id] || '';
    return `${esc(nice(g.group))}: ${esc(get('nombre'))} — ${esc(get('rut'))} — ${esc(get('email'))}`;
  });
  modal(`<h2>Confirmar envío</h2>
    <dl><dt>Trámite</dt><dd>${esc(f.name)}</dd>
    <dt>Firmantes</dt><dd>${signerRows.join('<br>') || '—'}</dd>
    <dt>Saldo actual</dt><dd>${clp(state.session?.balance)}</dd></dl>
    <p class="muted small">Portalfirma generará el documento con estos datos, cobrará el trámite de la billetera y enviará los enlaces de firma.</p>
    <div class="actions"><button class="secondary" id="mCancel">Volver</button><button class="primary" id="mOk">Confirmar y enviar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    $('#mOk').disabled = true; $('#mOk').textContent = 'Enviando…';
    const r = await pf.tplSend(f.template_version_id, values, f.name);
    closeModal();
    if (!r.ok) { $('#tplError').textContent = 'Portalfirma rechazó el envío: ' + r.error; return; }
    tpl.current = null; tpl.loaded = false;
    showDone(r.data);
  };
}
