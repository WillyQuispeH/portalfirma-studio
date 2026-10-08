/* global pf, $, esc, toast, modal, closeModal, icon, show, state, pdfjsLib */
'use strict';
(() => { // módulo aislado
// ============================================================================
// Flujos documentales (Fase 1): asistente de 5 pasos que se guarda como «receta».
//   1 Plantilla → 2 Nómina → 3 Campos (de qué columna sale cada dato) → 4 Revisión (errores y muestra) → 5 Firma
// El texto del modelo no se modifica: solo se llenan sus campos. Los PDF van a la cola de la carga masiva
// con los firmantes ya asignados, y se envían con una sola confirmación.
// ============================================================================
const FL = { view: 'home', models: [], recipes: [], runs: [], bulk: { items: [] }, ops: null, gen: null, w: null };
const STEPS = ['Plantilla', 'Nómina', 'Campos', 'Revisión', 'Firma'];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const fmtD = (iso) => { try { return new Date(iso).toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

async function open() {
  if (!window.isMember()) return window.members(open, 'Los flujos documentales envían documentos a firmar: son exclusivos para clientes de Portalfirma.');
  show('flujos'); FL.view = 'home';
  await reload(); renderHome();
}
async function reload() {
  const [m, r, x, b] = await Promise.all([pf.flujosModels(), pf.flujosRecipes(), pf.flujosRuns(), pf.bulkState()]);
  if (m.ok) FL.models = m.data; if (r.ok) FL.recipes = r.data; if (x.ok) FL.runs = x.data; if (b.ok) FL.bulk = b.data;
}
pf.onFlujos((st) => { FL.gen = st.running; if (FL.view === 'wizard' && FL.w?.step === 5) paintRun(); });
pf.onBulk((st) => { FL.bulk = st; if (FL.view === 'wizard' && FL.w?.step === 5) paintRun(); if (FL.view === 'home') paintRuns(); });

// ---------- inicio: recetas y ejecuciones ----------
function renderHome() {
  FL.view = 'home';
  $('#view-flujos').innerHTML = `<div class="bulk fl">
    <div class="ops-head"><div><h2>Flujos documentales</h2><span class="muted small">Una receta une una plantilla, una nómina y sus firmantes. Prepárala una vez y vuelve a usarla con cada nómina nueva.</span></div>
      <div class="ops-head-r"><button class="secondary small with-ic" id="flBulk">${icon('files', 15)}<span>Carga masiva</span></button><button class="primary small with-ic" id="flNew">${icon('plus', 15)}<span>Nuevo flujo</span></button></div></div>
    <h3 class="fl-h">Mis recetas</h3>
    <div class="fl-recipes">${FL.recipes.length ? FL.recipes.map((r) => { const m = FL.models.find((x) => x.id === r.modelId); const last = FL.runs.find((x) => x.recipeId === r.id);
      return `<div class="fl-recipe" data-r="${r.id}"><div class="fl-r-ic">${icon('flow', 22)}</div><div class="fl-r-tx"><b>${esc(r.name)}</b><small>${esc(m?.nombre || 'Modelo no disponible')}</small><small class="muted">${last ? `Última ejecución: ${fmtD(last.date)} · ${plural(last.total, 'documento', 'documentos')}` : 'Sin ejecuciones todavía'}</small></div>
        <div class="fl-r-acts"><button class="primary small" data-a="run" ${m ? '' : 'disabled'}>${icon('upload', 14)} Ejecutar con nueva nómina</button><button class="ghost small" data-a="edit" ${m ? '' : 'disabled'}>Editar</button><button class="ibtn" data-a="del" title="Eliminar receta">${icon('trash', 14)}</button></div></div>`; }).join('')
      : `<div class="ops-empty fl-empty"><div>${icon('flow', 34)}<p><b>Todavía no tienes recetas.</b><br>Ejemplo: «Mandatos de pagaré mensuales»: eliges el modelo, cargas la nómina de deudores y la app genera un documento por persona y lo envía a firmar.</p><button class="primary" id="flNew2">${icon('plus', 15)} Crear mi primer flujo</button></div></div>`}</div>
    <h3 class="fl-h">Ejecuciones</h3><div class="fl-runs" id="flRuns"></div></div>`;
  $('#flNew').onclick = () => startWizard();
  const n2 = $('#flNew2'); if (n2) n2.onclick = () => startWizard();
  $('#flBulk').onclick = () => window.Masiva.open('load');
  $('#view-flujos').querySelector('.fl-recipes').onclick = (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const r = FL.recipes.find((x) => x.id === b.closest('[data-r]').dataset.r);
    if (b.dataset.a === 'run') startWizard(r, 2);
    if (b.dataset.a === 'edit') startWizard(r, 3);
    if (b.dataset.a === 'del') {
      modal(`<h2>Eliminar receta</h2><p>¿Eliminar «${esc(r.name)}»? Las ejecuciones anteriores y los documentos enviados no se tocan.</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mOk">Eliminar</button></div>`);
      $('#mCancel').onclick = closeModal; $('#mOk').onclick = async () => { closeModal(); await pf.flujosDeleteRecipe(r.id); await reload(); renderHome(); };
    }
  };
  paintRuns();
}
// Estado de cada fila de una ejecución: cola de carga masiva → operación → firmas (Mis operaciones)
function rowStatus(row) {
  const it = FL.bulk.items.find((x) => x.id === row.bulkId || (x.flow && x.flow.runId && x.path === row.file));
  if (!it) return row.operation ? opStatus(row.operation) : ['Fuera de la cola', 'muted'];
  if (it.status === 'sent') { row.operation = it.operation; return opStatus(it.operation); }
  const map = { queued: ['En cola', 'muted'], converting: ['Preparando', 'run'], uploading: ['Subiendo', 'run'], analyzing: ['Revisando', 'run'], ready: ['Listo para enviar', 'ok'], needs_data: ['Faltan datos', 'wait'], sending: ['Enviando', 'run'], error: ['Error', 'bad'], send_error: ['No se envió', 'bad'], skipped: ['Omitido', 'muted'] };
  return map[it.status] || [it.status, 'muted'];
}
function opStatus(op) {
  const o = FL.ops?.items?.find((x) => String(x.operation) === String(op));
  if (!o) return [`Enviado · N° ${op}`, 'ok'];
  if (o.stage === 'finalized' || o.status === 'finalized') return o.signers && o.signed < o.signers ? [`Cerrada sin todas las firmas · N° ${op}`, 'wait'] : [`Firmado · N° ${op}`, 'ok'];
  return [`Firmando ${o.signed ?? 0}/${o.signers ?? '?'} · N° ${op}`, 'run'];
}
function runCounts(run) {
  const c = { ready: 0, sent: 0, signed: 0, error: 0, busy: 0 };
  for (const row of run.rows || []) {
    const [l, cl] = rowStatus(row);
    if (/^Firmado/.test(l)) c.signed++; else if (/Enviado|Firmando|Cerrada/.test(l)) c.sent++; else if (/Listo/.test(l)) c.ready++; else if (cl === 'bad' || /Faltan/.test(l)) c.error++; else if (cl === 'run' || /cola/.test(l)) c.busy++;
  }
  return c;
}
function paintRuns() {
  const host = $('#flRuns'); if (!host) return;
  host.innerHTML = FL.runs.length ? FL.runs.slice(0, 20).map((r) => { const c = runCounts(r);
    return `<div class="fl-run" data-x="${r.id}"><span class="fl-run-tx"><b>${esc(r.recipeName)}</b><small>${fmtD(r.date)} · ${esc(r.nomina || '')} · ${plural(r.total, 'documento', 'documentos')}</small></span>
      <span class="fl-run-ch">${c.signed ? `<span class="ops-chip ok">Firmados ${c.signed}</span>` : ''}${c.sent ? `<span class="ops-chip run">En firma ${c.sent}</span>` : ''}${c.ready ? `<span class="ops-chip ok">Listos ${c.ready}</span>` : ''}${c.busy ? `<span class="ops-chip muted">Preparando ${c.busy}</span>` : ''}${c.error ? `<span class="ops-chip bad">Con problemas ${c.error}</span>` : ''}${r.status === 'error' ? `<span class="ops-chip bad">${esc(r.error || 'Error')}</span>` : ''}</span>
      <span class="fl-r-acts"><button class="ghost small" data-a="see">Ver</button><button class="ibtn" data-a="rm" title="Borrar los documentos generados">${icon('trash', 14)}</button></span></div>`; }).join('')
    : '<div class="ops-empty small"><p>Aquí verás cada ejecución con el estado de sus firmas.</p></div>';
  host.onclick = (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const run = FL.runs.find((x) => x.id === b.closest('[data-x]').dataset.x);
    if (b.dataset.a === 'see') return showRun(run);
    modal(`<h2>Borrar documentos generados</h2><p>Se borrarán de este computador los ${run.total} PDF generados en esta ejecución (tienen datos personales de la nómina). Las operaciones ya enviadas a Portalfirma no se tocan.</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mOk">Borrar</button></div>`);
    $('#mCancel').onclick = closeModal; $('#mOk').onclick = async () => { closeModal(); const q = await pf.flujosDeleteRun(run.id); if (q.ok) { FL.runs = q.data; paintRuns(); } };
  };
}
function showRun(run) {
  FL.w = { step: 5, run, recipe: FL.recipes.find((x) => x.id === run.recipeId) || null, model: null, readonly: true };
  FL.view = 'wizard'; renderWizard();
}

// ---------- asistente ----------
async function startWizard(recipe, step = 1) {
  FL.w = { step: 1, recipe: recipe || null, modelId: recipe?.modelId || null, model: null, mapping: recipe ? JSON.parse(JSON.stringify(recipe.mapping || {})) : {}, nomina: null, check: null, name: recipe?.name || '', opts: { protocolization: 'none', typeSign: 'simple', ...(recipe?.opts || {}) }, run: null };
  if (FL.w.modelId) await loadModel(FL.w.modelId);
  FL.w.step = recipe ? step : 1; FL.view = 'wizard';
  if (FL.w.step >= 3 && !FL.w.nomina) FL.w.step = 2;
  renderWizard();
}
async function loadModel(id) { const r = await pf.flujosModel(id); if (!r.ok || !r.data) throw new Error('No encontré el modelo.'); FL.w.model = r.data; FL.w.modelId = id; }
function renderWizard() {
  const w = FL.w;
  $('#view-flujos').innerHTML = `<div class="bulk fl">
    <div class="ops-head"><div><h2>${esc(w.recipe?.name || w.name || 'Nuevo flujo')}</h2><span class="muted small">${w.model ? esc(w.model.nombre) : 'Flujo documental'}</span></div>
      <div class="ops-head-r"><button class="ghost small with-ic" id="flBack">${icon('chevL', 15)}<span>Volver a mis flujos</span></button></div></div>
    <div class="fl-steps">${STEPS.map((s, i) => `<button class="fl-step ${w.step === i + 1 ? 'on' : ''} ${w.step > i + 1 ? 'done' : ''}" data-s="${i + 1}" ${canGo(i + 1) && !w.readonly ? '' : 'disabled'}><b>${w.step > i + 1 ? icon('check', 13) : i + 1}</b><span>${s}</span></button>`).join('<i></i>')}</div>
    <div class="fl-body" id="flBody"></div></div>`;
  $('#flBack').onclick = async () => { await reload(); renderHome(); };
  $('#view-flujos').querySelector('.fl-steps').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b && !b.disabled) go(Number(b.dataset.s)); };
  [null, stepModel, stepNomina, stepFields, stepReview, stepSign][w.step]();
}
function canGo(s) { const w = FL.w; if (s <= 1) return true; if (s === 2) return !!w.model; if (s === 3) return !!(w.model && w.nomina); if (s === 4) return !!(w.model && w.nomina); if (s === 5) return !!(w.check && w.check.ok); return false; }
function go(s) { if (!canGo(s)) return; FL.w.step = s; renderWizard(); }

// 1) Plantilla
function stepModel() {
  const w = FL.w; const cats = [...new Set(FL.models.map((m) => m.categoria))];
  $('#flBody').innerHTML = `<div class="fl-card"><h3>1. Elige la plantilla</h3><p class="muted small">Modelos aprobados de la Notaría Virtual de Portalfirma. El texto no se modifica: solo se llenan sus datos.</p>
    <input id="flQ" class="fl-q" placeholder="Buscar: mandato, pagaré, arriendo, poder…" />
    <div class="fl-models" id="flModels"></div></div>`;
  const draw = () => {
    const q = norm($('#flQ').value);
    const list = FL.models.filter((m) => !q || norm(m.nombre + ' ' + m.categoria + ' ' + m.descripcion).includes(q));
    $('#flModels').innerHTML = cats.map((c) => { const ms = list.filter((m) => m.categoria === c); return ms.length ? `<h4>${esc(c)}</h4>` + ms.map((m) => `<button class="fl-model ${w.modelId === m.id ? 'on' : ''}" data-m="${m.id}"><b>${esc(m.nombre)}</b><small>${esc(m.descripcion || '')}</small><span class="fl-tags"><span class="ops-chip muted">${m.fields.length} datos</span>${m.roles.map((r) => `<span class="ops-chip run">Firma: ${esc(r.alias)}</span>`).join('')}</span></button>`).join('') : ''; }).join('') || '<p class="muted">No encontré plantillas con esa búsqueda.</p>';
  };
  $('#flQ').oninput = draw; draw();
  $('#flModels').onclick = async (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (w.modelId !== b.dataset.m) { w.mapping = {}; w.check = null; }
    await loadModel(b.dataset.m); go(2);
  };
}

// 2) Nómina
function stepNomina() {
  const w = FL.w; const m = w.model;
  $('#flBody').innerHTML = `<div class="fl-card"><h3>2. Carga la nómina</h3><p class="muted small">Un Excel o CSV con una fila por documento y los títulos de las columnas en la primera fila. La nómina no se guarda en la app: solo se usa para generar los documentos.</p>
    <div class="bk-drop" id="flDrop" role="button" tabindex="0">${icon('upload', 30)}<b>Arrastra aquí la nómina o haz clic para elegirla</b><span>Excel (.xlsx) o CSV · hasta 2.000 filas</span></div>
    <div class="fl-row-acts"><button class="ghost small with-ic" id="flTpl">${icon('download', 14)}<span>Descargar nómina de ejemplo para esta plantilla</span></button></div>
    <div id="flPrev"></div></div>`;
  $('#flDrop').onclick = async () => { const r = await pf.flujosPickNomina(); if (!r.ok) return toast(r.error, 5000); if (r.data) setNomina(r.data); };
  $('#flDrop').ondragover = (e) => { e.preventDefault(); e.currentTarget.classList.add('over'); };
  $('#flDrop').ondragleave = (e) => e.currentTarget.classList.remove('over');
  $('#flDrop').ondrop = (e) => e.currentTarget.classList.remove('over'); // el archivo lo recibe la ventana (dropFiles)
  $('#flTpl').onclick = () => exampleCsv(m);
  if (w.nomina) preview();
}
function setNomina(n) { const w = FL.w; w.nomina = n; w.check = null; autoMap(); preview(); }
function preview() {
  const n = FL.w.nomina; const host = $('#flPrev'); if (!host || !n) return;
  host.innerHTML = `<div class="fl-ok">${icon('check', 15)} <b>${esc(n.name)}</b> · ${plural(n.rows.length, 'fila', 'filas')} · ${plural(n.headers.length, 'columna', 'columnas')}</div>
    <div class="fl-table-wrap"><table class="fl-table"><thead><tr>${n.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${n.rows.slice(0, 5).map((r) => `<tr>${r.map((c) => `<td>${esc(c.s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${n.rows.length > 5 ? `<p class="muted small">… y ${n.rows.length - 5} filas más.</p>` : ''}
    <div class="fl-nav"><span></span><button class="primary" id="flNext">Siguiente: unir columnas con los datos ${icon('chevR', 15)}</button></div>`;
  $('#flNext').onclick = () => go(3);
}
// Nómina de ejemplo con una columna por dato que no es fijo
function exampleCsv(m) {
  const cols = m.fields.filter((f) => !/^(ciudad|fecha)/i.test(f.key) || f.group !== 'documento').map((f) => colName(f));
  const uniq = [...new Set(cols)];
  const csv = '﻿' + uniq.map((c) => `"${c.replace(/"/g, '""')}"`).join(';') + '\r\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Nómina - ${m.nombre.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Nómina de ejemplo descargada: ábrela en Excel, llénala y vuelve a cargarla.', 5000);
}
const nice = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/^\S/, (c) => c.toUpperCase()).replace(/\brut\b/g, 'RUT').replace(/\buf\b/g, 'UF').replace(/\bdom\b/g, 'DOM') : t);
const shortLabel = (f) => nice(f.label.replace(/\s*\(.*$/, '').trim());
const colName = (f) => (f.group === 'documento' ? shortLabel(f) : `${f.groupLabel} - ${shortLabel(f)}`);

// 3) Campos: de dónde sale cada dato
// Regla por campo: {type:'col', header} · {type:'fixed', value} · {type:'today'} · {type:'empty'}
function autoMap() {
  const w = FL.w; const m = w.model; const hs = w.nomina.headers.map((h) => ({ h, n: norm(h) }));
  for (const f of m.fields) {
    const cur = w.mapping[f.id];
    if (cur && (cur.type !== 'col' || hs.some((x) => x.h === cur.header))) continue; // regla guardada que sigue sirviendo
    const cands = [colName(f), `${f.groupLabel} ${f.label}`, f.label, `${f.key} ${f.group}`, f.key].map(norm);
    let best = hs.find((x) => cands.slice(0, 2).includes(x.n));
    const many = m.fields.filter((g) => norm(g.label) === norm(f.label)).length > 1; // «Nombre» se repite en cada firmante
    if (!best && !many) best = hs.find((x) => cands.slice(2).includes(x.n));
    if (!best) best = hs.find((x) => x.n.includes(norm(f.groupLabel)) && x.n.includes(norm(shortLabel(f))));
    if (!best && !many) best = hs.find((x) => x.n === norm(shortLabel(f)) || (norm(shortLabel(f)).length > 4 && x.n.includes(norm(shortLabel(f)))));
    if (best) w.mapping[f.id] = { type: 'col', header: best.h };
    else if (/^fecha/i.test(f.key) && f.group === 'documento') w.mapping[f.id] = { type: 'today' };
    else if (cur?.type === 'col') delete w.mapping[f.id];
  }
}
function stepFields() {
  const w = FL.w; const m = w.model; const n = w.nomina; autoMap();
  const groups = [...new Set(m.fields.map((f) => f.group))];
  const opt = (f) => { const r = w.mapping[f.id] || { type: 'empty' }; const sel = (v) => ((r.type === 'col' ? 'col:' + r.header : r.type) === v ? 'selected' : '');
    return `<select data-f="${esc(f.id)}"><option value="empty" ${sel('empty')}>— Dejar vacío —</option><optgroup label="Columna de la nómina">${n.headers.map((h) => `<option value="col:${esc(h)}" ${sel('col:' + h)}>${esc(h)}</option>`).join('')}</optgroup><optgroup label="Otro"><option value="fixed" ${sel('fixed')}>Valor fijo (igual para todos)</option>${/fecha/i.test(f.label) ? `<option value="today" ${sel('today')}>Fecha del día en que se genera</option>` : ''}</optgroup></select>`; };
  const sample = (f) => { const r = w.mapping[f.id]; if (!r) return ''; if (r.type === 'today') return new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }); if (r.type === 'col') { const i = n.headers.indexOf(r.header); return n.rows[0]?.[i]?.s || ''; } return ''; };
  const missing = m.fields.filter((f) => f.required && !w.mapping[f.id]).length;
  $('#flBody').innerHTML = `<div class="fl-card"><h3>3. ¿De dónde sale cada dato?</h3>
    <p class="muted small">Ya uní las columnas que reconocí. Los datos que son iguales para todos (por ejemplo, tu empresa como acreedora o el representante que firma siempre) van como <b>valor fijo</b> y quedan guardados en la receta.</p>
    ${missing ? `<div class="fl-warn">${icon('alert', 15)} ${plural(missing, 'dato obligatorio sin asignar', 'datos obligatorios sin asignar')}.</div>` : ''}
    <div class="fl-map">${groups.map((g) => { const fs = m.fields.filter((f) => f.group === g); const signer = fs.some((f) => f.signer);
      return `<div class="fl-group"><h4>${esc(fs[0].groupLabel)}${signer ? ' <span class="ops-chip run">Firma el documento</span>' : ''}</h4>${fs.map((f) => { const r = w.mapping[f.id];
        return `<div class="fl-mrow ${f.required && !r ? 'miss' : ''}"><span class="fl-lab">${esc(shortLabel(f))}${f.required ? '' : ' <small class="muted">(opcional)</small>'}${f.signerKey ? ` <small class="muted">· ${{ fullName: 'nombre del firmante', rut: 'RUT del firmante', email: 'correo del firmante', phone: 'teléfono del firmante' }[f.signerKey]}</small>` : ''}</span>
          <span>${opt(f)}</span>
          <span>${r?.type === 'fixed' ? `<input data-fx="${esc(f.id)}" value="${esc(r.value || '')}" placeholder="Escribe el valor" />` : `<small class="muted fl-sample">${esc(sample(f)) || '&nbsp;'}</small>`}</span></div>`; }).join('')}</div>`; }).join('')}</div>
    <div class="fl-nav"><button class="ghost" id="flPrevS">${icon('chevL', 15)} Nómina</button><button class="primary" id="flNext">Revisar las ${n.rows.length} filas ${icon('chevR', 15)}</button></div></div>`;
  $('#flBody').onchange = (e) => {
    const s = e.target.closest('[data-f]'); if (!s) return; const id = s.dataset.f; const v = s.value;
    w.mapping[id] = v === 'empty' ? { type: 'empty' } : v === 'today' ? { type: 'today' } : v === 'fixed' ? { type: 'fixed', value: w.mapping[id]?.value || '' } : { type: 'col', header: v.slice(4) };
    if (v === 'empty') delete w.mapping[id];
    w.check = null; stepFields();
    if (v === 'fixed') $(`[data-fx="${CSS.escape(id)}"]`)?.focus();
  };
  $('#flBody').oninput = (e) => { const i = e.target.closest('[data-fx]'); if (i) { w.mapping[i.dataset.fx] = { type: 'fixed', value: i.value }; w.check = null; } };
  $('#flPrevS').onclick = () => go(2);
  $('#flNext').onclick = () => go(4);
}
// La regla con nombre de columna se traduce a su posición en esta nómina
function resolved() {
  const w = FL.w; const out = {};
  for (const [id, r] of Object.entries(w.mapping)) {
    if (r.type === 'col') { const i = w.nomina.headers.indexOf(r.header); if (i >= 0) out[id] = { type: 'col', col: i }; }
    else out[id] = r;
  }
  return out;
}
const spec = () => ({ modelId: FL.w.modelId, mapping: resolved(), nomina: FL.w.nomina });

// 4) Revisión
async function stepReview() {
  const w = FL.w;
  $('#flBody').innerHTML = `<div class="fl-card"><h3>4. Revisión</h3><p class="muted"><i class="bk-spin"></i> Revisando RUT, correos y datos obligatorios…</p></div>`;
  const r = await pf.flujosCheck(spec()); if (!r.ok) return toast(r.error, 5000);
  w.check = r.data; const c = w.check;
  const bad = c.rows.filter((x) => !x.ok); const good = c.rows.filter((x) => x.ok);
  $('#flBody').innerHTML = `<div class="fl-card"><h3>4. Revisión</h3>
    <div class="fl-sum"><div class="ok"><b>${c.ok}</b><span>listas para generar</span></div><div class="${c.bad ? 'bad' : 'muted'}"><b>${c.bad}</b><span>con problemas${c.bad ? ' (se omiten)' : ''}</span></div></div>
    ${bad.length ? `<h4>Filas con problemas</h4><div class="fl-errs">${bad.slice(0, 100).map((x) => `<div><b>Fila ${x.n + 2}</b> <span class="muted">${esc(x.label)}</span><small>${esc(x.errors.join(' · '))}</small></div>`).join('')}${bad.length > 100 ? `<p class="muted small">… y ${bad.length - 100} más.</p>` : ''}</div>
      <p class="muted small">Corrige esas filas en tu planilla y vuelve a cargarla, o sigue solo con las ${c.ok} filas correctas. (La fila 1 de la planilla son los títulos.)</p>` : ''}
    ${good.length ? `<h4>Muestra</h4><p class="muted small">Revisa cómo queda el documento antes de generar ${c.ok === 1 ? 'el documento' : `los ${c.ok}`}.</p>
      <div class="fl-samples">${good.slice(0, 3).map((x) => `<button class="secondary small" data-sm="${x.n}">${icon('file', 14)} Ver ${esc(x.label)}</button>`).join('')}</div>` : ''}
    <div class="fl-nav"><button class="ghost" id="flPrevS">${icon('chevL', 15)} Campos</button><button class="primary" id="flNext" ${c.ok ? '' : 'disabled'}>Siguiente: firma ${icon('chevR', 15)}</button></div></div>`;
  $('#flBody').querySelectorAll('[data-sm]').forEach((b) => (b.onclick = () => showSample(Number(b.dataset.sm))));
  $('#flPrevS').onclick = () => go(3);
  $('#flNext').onclick = () => go(5);
}
async function showSample(n) {
  modal(`<h2>Muestra</h2><p class="muted"><i class="bk-spin"></i> Generando…</p>`);
  const r = await pf.flujosSample({ ...spec(), n }); if (!r.ok) { closeModal(); return toast(r.error, 5000); }
  const sig = r.data.signers.map((s) => `<li><b>${esc(s.alias)}</b>: ${esc(s.fullName || '—')} · ${esc(s.rut || 'sin RUT')} · ${esc(s.email || 'sin correo')}</li>`).join('');
  $('#modalCard').innerHTML = `<h2>Muestra · fila ${n + 2}</h2><div class="fl-pdf" id="flPdf"></div><h4>Firmantes</h4><ul class="fl-sig">${sig}</ul>
    <div class="actions"><button class="secondary" id="flOpenEd">Abrir en el editor</button><button class="primary" id="mCancel">Cerrar</button></div>`;
  $('#mCancel').onclick = closeModal;
  $('#flOpenEd').onclick = () => { closeModal(); window.editor.openPaths([r.data.file], true); };
  try {
    const doc = await pdfjsLib.getDocument({ data: r.data.bytes, isEvalSupported: false, standardFontDataUrl: 'vendor/standard_fonts/', cMapUrl: 'vendor/cmaps/', cMapPacked: true }).promise;
    for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
      const p = await doc.getPage(i); const vp = p.getViewport({ scale: 1.1 }); const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height; $('#flPdf')?.appendChild(c); await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
    doc.destroy();
  } catch {}
}

// 5) Firma: guardar receta, generar, enviar y seguir
function stepSign() {
  const w = FL.w;
  if (w.run) return paintRun(true);
  $('#flBody').innerHTML = `<div class="fl-card"><h3>5. Firma</h3>
    <div class="fl-sumline">${icon('file', 16)} Se generarán <b>${plural(w.check.ok, 'documento', 'documentos')}</b> con «${esc(w.model.nombre)}». Firma${w.model.roles.length === 1 ? '' : 'n'}: ${w.model.roles.map((r) => `<b>${esc(r.alias)}</b>`).join(', ')}.</div>
    <label class="fl-lbl">Nombre de la receta<input id="flName" value="${esc(w.name || w.recipe?.name || '')}" placeholder="Ej.: Mandatos de pagaré mensuales" /></label>
    <div class="bk-opts"><label>Trámite<select id="flProc"><option value="none">Solo firma electrónica</option><option value="legalization">Legalizar ante notario</option><option value="protocolization">Protocolizar</option></select></label>
      <label>Tipo de firma<select id="flType"><option value="simple">Simple</option><option value="avanzada">Avanzada</option><option value="visada">Visada</option><option value="enrolada">Enrolada</option></select></label></div>
    <p class="muted small">Primero se generan los PDF y se suben a Portalfirma (no se cobra nada). Después confirmas el envío a firmar, que sí descuenta saldo.</p>
    <div class="fl-nav"><button class="ghost" id="flPrevS">${icon('chevL', 15)} Revisión</button><span><button class="secondary" id="flSave">Solo guardar la receta</button> <button class="primary" id="flGo">${icon('flow', 15)} Guardar y generar ${w.check.ok}</button></span></div></div>`;
  $('#flProc').value = w.opts.protocolization; $('#flType').value = w.opts.typeSign;
  $('#flProc').onchange = () => (w.opts.protocolization = $('#flProc').value);
  $('#flType').onchange = () => (w.opts.typeSign = $('#flType').value);
  $('#flPrevS').onclick = () => go(4);
  const save = async () => {
    const name = $('#flName').value.trim(); if (!name) { $('#flName').classList.add('invalid'); $('#flName').focus(); return null; }
    w.name = name;
    const r = await pf.flujosSaveRecipe({ id: w.recipe?.id, created: w.recipe?.created, name, modelId: w.modelId, mapping: w.mapping, opts: w.opts });
    if (!r.ok) { toast(r.error, 5000); return null; }
    w.recipe = r.data; return r.data;
  };
  $('#flSave').onclick = async () => { if (await save()) { toast('Receta guardada.'); await reload(); renderHome(); } };
  $('#flGo').onclick = async () => {
    const rec = await save(); if (!rec) return;
    $('#flGo').disabled = true; $('#flGo').innerHTML = '<i class="bk-spin"></i> Generando…';
    const r = await pf.flujosRun({ ...spec(), recipeId: rec.id, recipeName: rec.name });
    if (!r.ok) { toast(r.error, 6000); $('#flGo').disabled = false; return; }
    w.run = r.data; await reload(); renderWizard();
  };
}
function paintRun(full) {
  const w = FL.w; const run = w.run; if (!run || !$('#flBody')) return;
  if (full || !$('#flRunTable')) {
    $('#flBody').innerHTML = `<div class="fl-card"><h3>${w.readonly ? esc(run.recipeName) : '5. Firma'}</h3><p class="muted small">${fmtD(run.date)} · ${esc(run.nomina || '')} · ${esc(run.modelName || '')}</p>
      <div id="flRunBar"></div><div class="bk-table fl-rt" id="flRunTable"></div><div class="bk-foot" id="flRunFoot"></div></div>`;
    $('#flRunFoot').onclick = runFoot;
  }
  const rows = run.rows || []; const st = rows.map(rowStatus);
  const ready = rows.filter((r, i) => /Listo/.test(st[i][0]));
  const busy = st.filter(([l, c]) => c === 'run' && !/Firmando/.test(l) || /cola/.test(l)).length;
  const sending = FL.bulk.sending;
  $('#flRunBar').innerHTML = `<div class="bk-prog"><div class="bk-prog-in" style="width:${rows.length ? Math.round(((rows.length - busy) / rows.length) * 100) : 0}%"></div></div>
    <div class="bk-stats">${(() => { const c = runCounts(run); return `${c.busy ? `<span class="ops-chip muted">Preparando ${c.busy}</span>` : ''}${c.ready ? `<span class="ops-chip ok">Listos ${c.ready}</span>` : ''}${c.sent ? `<span class="ops-chip run">En firma ${c.sent}</span>` : ''}${c.signed ? `<span class="ops-chip ok">Firmados ${c.signed}</span>` : ''}${c.error ? `<span class="ops-chip bad">Con problemas ${c.error}</span>` : ''}`; })()}</div>`;
  $('#flRunTable').innerHTML = `<div class="bk-row bk-th"><span></span><span>Documento</span><span>Estado</span><span></span><span></span></div>` + rows.map((r, i) => { const [l, c] = st[i]; const it = FL.bulk.items.find((x) => x.id === r.bulkId);
    return `<div class="bk-row"><span>${r.n + 2}</span><span class="bk-doc"><b>${esc(r.label)}</b><small>${esc(String(r.file || '').split(/[\\/]/).pop())}</small></span><span><span class="ops-chip ${c}">${c === 'run' && !/Firmando/.test(l) ? '<i class="bk-spin"></i>' : ''}${esc(l)}</span>${it?.error ? `<small class="bk-err">${esc(it.error)}</small>` : ''}${it?.missing?.length && it.status === 'needs_data' ? `<small class="bk-err">${esc(it.missing.join(' · '))}</small>` : ''}</span><span></span><span></span></div>`; }).join('');
  $('#flRunFoot').innerHTML = `${sending ? '<button class="secondary" data-a="stop">Detener el envío</button>' : `<button class="ghost" data-a="sync">${icon('rotateR', 14)} Actualizar firmas</button><button class="ghost" data-a="bulk">Ver en Carga masiva</button>${ready.length ? `<button class="primary" data-a="send">${icon('sign', 16)} Enviar ${ready.length} a firmar</button>` : ''}`}`;
}
async function runFoot(e) {
  const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; const w = FL.w;
  if (a === 'stop') return pf.bulkStopSend();
  if (a === 'bulk') return window.Masiva.open('load');
  if (a === 'sync') { const r = await pf.opsSync(false); if (r.ok) FL.ops = r.data; else { const l = await pf.opsList(); if (l.ok) FL.ops = l.data; } return paintRun(); }
  if (a !== 'send') return;
  const ids = w.run.rows.filter((r) => { const it = FL.bulk.items.find((x) => x.id === r.bulkId); return it && it.status === 'ready'; }).map((r) => r.bulkId);
  const prefs = (await pf.prefs()).data || {};
  let bal = state.session?.balance; try { const b = await pf.balance(); if (b.ok) bal = b.data; } catch {}
  const opts = { ...(w.recipe?.opts || {}), ...(w.opts || {}) };
  modal(`<h2>Enviar ${ids.length} documento(s) a firmar</h2>
    <p>Se crearán <strong>${ids.length} operaciones</strong> en Portalfirma, una por documento. <strong>Cada envío descuenta saldo</strong> según el tipo de firma y el trámite.</p>
    <dl><dt>Saldo actual</dt><dd>${bal != null ? '$' + Number(bal).toLocaleString('es-CL') : '—'}</dd><dt>Trámite</dt><dd>${{ none: 'Solo firma electrónica', legalization: 'Legalizar', protocolization: 'Protocolizar' }[opts.protocolization || 'none']}</dd></dl>
    <label>Correo del pagador<input id="flPay" value="${esc(prefs.payerEmail || '')}" placeholder="pagos@empresa.cl" /></label>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Enviar ${ids.length}</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const email = $('#flPay').value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#flPay').classList.add('invalid'); return; }
    closeModal(); pf.setPrefs({ payerEmail: email });
    const r = await pf.bulkSend(ids, { email, protocolization: opts.protocolization || 'none', typeSign: opts.typeSign || 'simple' });
    if (!r.ok) return toast(r.error, 5000);
    FL.bulk = r.data; const sent = ids.filter((id) => r.data.items.find((x) => x.id === id)?.status === 'sent').length;
    toast(`${sent} de ${ids.length} documento(s) enviados a firmar.`, 5000); paintRun();
  };
}

// Archivo soltado en la ventana mientras se ve Flujos: solo sirve como nómina en el paso 2
async function dropFiles(paths) {
  if (FL.view !== 'wizard' || FL.w?.step !== 2) return toast('Para cargar una nómina, ve al paso 2 de un flujo.', 4000);
  const r = await pf.flujosReadNomina(paths[0]); if (!r.ok) return toast(r.error, 5000); setNomina(r.data);
}
window.Flujos = { open, dropFiles, _fl: FL, startWizard, _setNomina: (n) => { setNomina(n); }, _go: (s) => go(s) };
})();
