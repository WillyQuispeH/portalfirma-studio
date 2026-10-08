/* global pf, $, esc, toast, modal, closeModal, icon, show, pdfjsLib */
'use strict';
(() => { // módulo aislado
// ============================================================================
// Plazos y vencimientos: tabla de documentos ordenada por su fecha clave (rojo / amarillo / verde).
// Dos informes por documento:
//  · Básico (automático, gratis, sin IA ni internet): reglas que leen partes, plazo, renovación, aviso y renta.
//  · Inteligente (opcional, 1 token): la IA confirma los datos, resume y sugiere qué hacer; al elegir una
//    sugerencia redacta el documento con los datos de las partes, listo para firmar.
// Un PDF puede traer varios contratos: cada uno se lee por separado y manda la fecha clave más próxima.
// ============================================================================
const P = { items: [], sel: null, running: false, smart: new Set() };
const DAY = 86400000;
const ACT = { termino_anticipado: 'Término anticipado', aviso_no_renovacion: 'Aviso de no renovación', reajuste: 'Reajuste', renovacion: 'Renovación', anexo: 'Anexo', ninguna: 'Sin acción' };
const fmt = (iso) => { try { return iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; } catch { return '—'; } };
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00');
const addMonths = (iso, m) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(new Date(iso + 'T12:00:00').getTime() + n * DAY).toISOString().slice(0, 10);

// Fecha clave de UN contrato: el aviso (si renueva sola) o el término; en indefinidos, el próximo reajuste.
function keyDate(a) {
  if (!a) return {};
  const t = today().toISOString().slice(0, 10);
  if (!a.indefinido && a.fecha_termino) {
    let end = a.fecha_termino; const per = Number(a.periodo_renovacion_meses) || 12;
    if (a.renovacion_automatica) { let guard = 0; while (end < t && guard++ < 40) end = addMonths(end, per); }
    const aviso = Number(a.aviso_dias) || 0;
    if (a.renovacion_automatica && aviso) {
      const notice = addDays(end, -aviso);
      if (notice >= t) return { deadline: notice, label: 'Último día para avisar la no renovación', end };
      return { deadline: end, label: 'Se renueva sola (ya pasó el plazo de aviso)', end, missed: true };
    }
    return { deadline: end, label: end < t ? 'Venció' : 'Vence', end };
  }
  if (a.reajuste?.proxima_fecha) return { deadline: a.reajuste.proxima_fecha, label: 'Próximo reajuste' };
  if (a.encontrado === false) return { deadline: null, label: 'Sin fechas detectadas' };
  return { deadline: null, label: 'Indefinido' };
}
// Un documento puede traer varios contratos: manda la fecha clave más próxima.
const contratos = (a) => (!a ? [] : Array.isArray(a.contratos) && a.contratos.length ? a.contratos : [a]);
function keyFor(a) {
  const list = contratos(a); const ks = list.map((c, i) => ({ ...keyDate(c), idx: i }));
  const withDate = ks.filter((k) => k.deadline).sort((x, y) => x.deadline.localeCompare(y.deadline));
  const k = withDate[0] || ks[0] || { deadline: null, label: 'Sin fechas detectadas' };
  if (list.length > 1) k.label += ` · contrato ${k.idx + 1} de ${list.length}`;
  return k;
}
const view = (it) => it.analysis || it.basic || null; // el inteligente, si existe; si no, el básico
const isSmart = (it) => !!it.analysis;
function light(it) {
  if (it.status !== 'done') return ['', 'muted'];
  if (!it.deadline) return [/Sin fechas/.test(it.deadlineLabel || '') ? 'Sin fechas' : 'Sin vencimiento', /Sin fechas/.test(it.deadlineLabel || '') ? 'muted' : 'ok'];
  const d = Math.round((new Date(it.deadline + 'T12:00:00') - today()) / DAY);
  if (d < 0) return [`Hace ${-d} día${d === -1 ? '' : 's'}`, 'bad'];
  if (d <= 30) return [d === 0 ? 'Hoy' : `En ${d} día${d === 1 ? '' : 's'}`, 'bad'];
  if (d <= 90) return [`En ${d} días`, 'wait'];
  return [`En ${d} días`, 'ok'];
}
const order = (a, b) => {
  const rank = (x) => (x.status !== 'done' ? 3 : x.deadline ? 0 : 2);
  return rank(a) - rank(b) || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || String(a.name).localeCompare(String(b.name));
};

async function open() {
  if (!window.isMember()) return window.members(open, 'Plazos y vencimientos es exclusivo para clientes de Portalfirma.');
  show('plazos'); render();
  const r = await pf.plazosList(); if (r.ok) { P.items = r.data; paint(); readAll(); }
}
pf.onOpenPlazos(() => open());

function render() {
  $('#view-plazos').innerHTML = `<div class="bulk plz">
    <div class="ops-head"><div><h2>Plazos y vencimientos</h2><span class="muted small">Tus contratos ordenados por su fecha clave. Cada documento trae su informe básico gratis; el informe inteligente con IA te sugiere qué hacer y redacta el documento.</span></div>
      <div class="ops-head-r"><button class="secondary small with-ic" id="plPf" title="Traer los contratos firmados de Mis operaciones">${icon('rotateR', 15)}<span>Traer de Portalfirma</span></button><button class="secondary small with-ic" id="plDrive">${icon('drive', 15)}<span>Desde Google Drive</span></button><button class="primary small with-ic" id="plAdd">${icon('plus', 15)}<span>Agregar documentos</span></button></div></div>
    <div class="plz-legend"><span class="ops-chip bad">Rojo · 30 días o menos</span><span class="ops-chip wait">Amarillo · hasta 90 días</span><span class="ops-chip ok">Verde · más de 90 días o indefinido</span>
      <span class="plz-run" id="plRun"></span></div>
    <div class="plz-grid"><div class="bk-table plz-table" id="plTable"></div><div class="ops-detail plz-detail" id="plDetail"></div></div></div>`;
  $('#plAdd').onclick = async () => { const r = await pf.plazosPick(); afterAdd(r); };
  $('#plDrive').onclick = () => window.Drive.open({ purpose: 'plazos' });
  $('#plPf').onclick = fromPortalfirma;
  $('#plTable').onclick = (e) => { const r = e.target.closest('[data-id]'); if (r) select(r.dataset.id); };
}
function afterAdd(r) {
  if (!r?.ok) return r && toast(r.error, 5000);
  P.items = r.data.items; paint();
  if (r.data.skipped?.length) toast(`Omitidos: ${r.data.skipped.join(' · ')}`, 6000);
  if (r.data.added) readAll();
}
function paint() {
  const t = $('#plTable'); if (!t) return;
  const list = [...P.items].sort(order);
  $('#plRun').innerHTML = P.running ? `<i class="bk-spin"></i> Leyendo… quedan ${P.items.filter((x) => x.status === 'pending').length}` : '';
  t.innerHTML = list.length ? `<div class="bk-row plz-row bk-th"><span></span><span>Documento</span><span>Fecha clave</span><span>Sugerencia</span><span></span></div>` + list.map((it) => {
    const [l, c] = light(it); const a = view(it); const s = it.analysis?.acciones?.[0];
    const ps = contratos(a).flatMap((x) => x.partes || []).map((p) => p.nombre).filter(Boolean);
    const n = contratos(a).length;
    return `<div class="bk-row plz-row ${P.sel === it.id ? 'sel' : ''}" data-id="${it.id}">
      <span class="plz-dot ${c}"></span>
      <span class="bk-doc"><b>${esc(a?.tipo || it.name.replace(/\.pdf$/i, ''))}${n > 1 ? ` <small class="plz-n">${n} contratos</small>` : ''}</b><small>${esc(it.name)}${ps.length ? ' · ' + esc(ps.slice(0, 2).join(' / ')) : ''}</small></span>
      <span>${it.status === 'done' ? `<b class="plz-when ${c}">${esc(l)}</b><small class="muted">${esc(it.deadlineLabel || '')}${it.deadline ? ' · ' + fmt(it.deadline) : ''}</small>`
        : it.status === 'reading' ? '<span class="ops-chip run"><i class="bk-spin"></i>Leyendo</span>' : it.status === 'error' ? `<span class="ops-chip bad">Error</span><small class="bk-err">${esc(it.error || '')}</small>` : '<span class="ops-chip muted">Por leer</span>'}</span>
      <span class="plz-sug">${s ? `<b>${esc(ACT[s.tipo] || s.titulo)}</b><small>${esc(s.titulo)}</small>` : it.status === 'done' ? `<small class="muted plz-basic">Informe básico</small>` : ''}${P.smart.has(it.id) ? '<small class="muted"><i class="bk-spin"></i> Preparando informe inteligente…</small>' : ''}${it.done ? `<small class="ok-t">${icon('check', 12)} ${esc(it.done)}</small>` : ''}</span>
      <span>${icon('chevR', 15)}</span></div>`;
  }).join('') : `<div class="ops-empty"><div>${icon('calendar', 34)}<p>Agrega tus contratos (PDF o Word) para ver sus vencimientos.<br><small>También puedes traerlos desde Google Drive.</small></p></div></div>`;
  if (P.sel) detail();
  else if ($('#plDetail')) $('#plDetail').innerHTML = `<div class="ops-empty"><p>Elige un documento para ver su informe.</p></div>`;
}

// ---------- texto del PDF ----------
async function pdfText(id) {
  const r = await pf.plazosBytes(id); if (!r.ok) throw new Error(r.error);
  const doc = await pdfjsLib.getDocument({ data: r.data, isEvalSupported: false, standardFontDataUrl: 'vendor/standard_fonts/', cMapUrl: 'vendor/cmaps/', cMapPacked: true }).promise;
  let txt = '';
  for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    txt += c.items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n\n';
    if (txt.length > 60000) break;
  }
  doc.destroy();
  return txt.replace(/[ \t]+/g, ' ').trim();
}
const SCAN = 'No tiene texto legible (¿es un escaneo?). Ábrelo en el editor y usa «Reconocer texto».';

// ---------- informe básico (sin IA, automático y gratis) ----------
async function readBasic(it) {
  const set = async (patch) => { const r = await pf.plazosUpdate(it.id, patch); if (r.ok) P.items = r.data; };
  P.items.find((x) => x.id === it.id).status = 'reading'; paint();
  try {
    const text = await pdfText(it.id);
    if (text.replace(/\s/g, '').length < 80) throw new Error(SCAN);
    const list = window.PlazosReglas.extraer(text);
    const basic = { tipo: list[0]?.tipo || 'Documento', contratos: list, fuente: 'reglas' };
    const k = keyFor(it.analysis || basic);
    await set({ status: 'done', basic, deadline: k.deadline || null, deadlineLabel: k.label, end: k.end || null, error: '' });
  } catch (e) { await set({ status: 'error', error: e.message }); }
  paint();
}
async function readAll() {
  if (P.running) return; P.running = true; paint();
  try { let it; while ((it = P.items.find((x) => x.status === 'pending' || (x.status === 'done' && !x.basic && !x.analysis)))) await readBasic(it); }
  finally { P.running = false; paint(); }
}

// ---------- informe inteligente (IA, 1 token, opcional) ----------
const PROMPT = (name, text, basic) => `PLAZOS
Archivo: ${name}
Fecha de hoy: ${new Date().toISOString().slice(0, 10)}
Analiza este documento (derecho chileno) para un sistema de recordatorio de plazos. Un mismo PDF puede traer VARIOS contratos distintos: devuelve uno por cada contrato en "contratos". Devuelve SOLO un objeto JSON:
{"tipo": "tipo de documento (ej. Contrato de arrendamiento)",
 "resumen": "2 o 3 frases sobre la situación de los plazos, considerando la fecha de hoy",
 "contratos": [{"titulo": "identificación breve (ej. Arriendo Calle Nueva 120, depto 1411)",
   "partes": [{"rol": "Arrendador|Arrendatario|Propietario|Aval|…", "nombre": "...", "rut": "...", "domicilio": "...", "representante": "nombre y RUT si es persona jurídica o actúa por otro, o null"}],
   "objeto": "qué se contrata, con la dirección o identificación del bien", "monto": "precio o renta tal como aparece, o null",
   "fecha_inicio": "YYYY-MM-DD o null", "plazo": "texto (ej. 12 meses) o indefinido", "indefinido": true/false,
   "fecha_termino": "YYYY-MM-DD o null", "renovacion_automatica": true/false, "periodo_renovacion_meses": número o null,
   "aviso_dias": número o null, "reajuste": {"tipo": "IPC|UF|otro", "periodicidad_meses": número, "proxima_fecha": "YYYY-MM-DD"} o null}],
 "acciones": [{"contrato": índice (desde 0) del contrato al que se refiere, "tipo": "termino_anticipado|aviso_no_renovacion|reajuste|renovacion|anexo|ninguna", "titulo": "nombre del documento a redactar", "motivo": "por qué conviene y hasta cuándo", "urgente": true/false}]}
Reglas: no inventes datos; si algo no está usa null. Distingue a quien firma como arrendador (o su representante o corredor) del propietario del bien: el propietario va con rol "Propietario". Un contrato con plazo fijo y renovación automática NO es indefinido. Ordena las acciones de la más conveniente a la menos. Si no hay nada que hacer, una sola acción "ninguna" con título "Déjalo así". No sugieras pagarés, finiquitos ni autorizaciones de viaje de menores.
${basic ? `Lectura automática previa (puede tener errores, verifícala contra el texto): ${JSON.stringify(basic.contratos.map(({ encontrado, ...c }) => c))}\n` : ''}Documento:
<<<
${text}
>>>`;
async function smartReport(it) {
  if (P.smart.has(it.id)) return;
  if (!(await window.Asistente.ensureConsent())) return;
  P.smart.add(it.id); paint();
  try {
    const text = await pdfText(it.id);
    if (text.replace(/\s/g, '').length < 80) throw new Error(SCAN);
    const A = window.Asistente;
    const a = A.parseJson(await A.ask({ action: 'plazo', json: true, system: A.SYSTEM, messages: [{ role: 'user', content: PROMPT(it.name, text, it.basic) }] }));
    if (!Array.isArray(a.contratos) || !a.contratos.length) { const { acciones, resumen, tipo, ...c } = a; a.contratos = [c]; }
    const k = keyFor(a);
    const r = await pf.plazosUpdate(it.id, { status: 'done', analysis: a, smartAt: new Date().toISOString(), deadline: k.deadline || null, deadlineLabel: k.label, end: k.end || null, summary: a.resumen || '', error: '' });
    if (r.ok) P.items = r.data;
  } catch (e) { if (!e.silent) toast(e.message, 5000); } // sin tokens o sin sesión: el aviso ya se mostró
  finally { P.smart.delete(it.id); paint(); }
}

// ---------- detalle ----------
function select(id) {
  P.sel = id; document.querySelectorAll('.plz-row').forEach((r) => r.classList.toggle('sel', r.dataset.id === id)); detail();
  const it = P.items.find((x) => x.id === id); if (it && it.status === 'pending' && !P.running) readBasic(it); // automático al elegirlo
}
const facts = (a, it, one) => `<div class="plz-facts">
      <div><span>Objeto</span><b>${esc(a.objeto || '—')}</b></div>
      <div><span>Inicio</span><b>${fmt(a.fecha_inicio)}</b></div><div><span>Plazo</span><b>${esc(a.plazo || '—')}</b></div>
      <div><span>Término</span><b>${a.indefinido ? 'Indefinido' : fmt(one ? it.end || a.fecha_termino : keyDate(a).end || a.fecha_termino)}</b></div>
      <div><span>Renovación</span><b>${a.renovacion_automatica ? `Automática${a.periodo_renovacion_meses ? ` cada ${a.periodo_renovacion_meses} meses` : ''}` : 'No'}</b></div>
      <div><span>Aviso</span><b>${a.aviso_dias ? a.aviso_dias + ' días antes' : '—'}</b></div>
      <div><span>Reajuste</span><b>${a.reajuste ? `${esc(a.reajuste.tipo)}${a.reajuste.periodicidad_meses ? ` cada ${a.reajuste.periodicidad_meses} meses` : ''}` : '—'}</b></div>
      <div><span>Monto</span><b>${esc(a.monto || '—')}</b></div></div>
    <h4>Partes</h4><div class="opd-sigs">${(a.partes || []).length ? a.partes.map((p) => `<div class="opd-sig"><span class="av">${esc((p.nombre || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase())}</span><span class="nm"><b>${esc(p.nombre || '—')}</b><small>${esc(p.rol || '')}${p.rut ? ' · ' + esc(p.rut) : ''}${p.representante ? ' · rep. por ' + esc(p.representante) : ''}${p.domicilio ? ' · ' + esc(p.domicilio) : ''}</small></span></div>`).join('') : '<p class="muted small">No se identificaron las partes.</p>'}</div>`;
function detail() {
  const it = P.items.find((x) => x.id === P.sel); const host = $('#plDetail'); if (!it || !host) return;
  if (it.status !== 'done') {
    host.innerHTML = `<div class="opd"><h3>${esc(it.name)}</h3><p class="muted">${it.status === 'reading' || it.status === 'pending' ? '<i class="bk-spin"></i> Leyendo el documento…' : esc(it.error)}</p>
      <div class="opd-acts">${it.status === 'error' ? `<button class="secondary" id="plBasic">${icon('rotateR', 15)} Volver a leer</button><button class="ghost" id="plOpen">${icon('file', 14)} Ver documento</button>` : ''}<button class="ghost" id="plDel">Quitar de la lista</button></div></div>`;
    if ($('#plBasic')) $('#plBasic').onclick = () => readBasic(it);
    if ($('#plOpen')) $('#plOpen').onclick = () => openDoc(it);
    $('#plDel').onclick = () => del(it);
    return;
  }
  const a = view(it); const [l, c] = light(it); const smart = isSmart(it); const list = contratos(a); const busy = P.smart.has(it.id);
  const upsell = `<div class="plz-smart">
      <div><b>${icon('sparkle', 15)} Informe inteligente</b><p>La IA revisa el contrato completo, confirma estos datos, te explica la situación y te sugiere qué documento preparar (aviso de no renovación, término anticipado, reajuste o renovación) para redactarlo con un clic.</p></div>
      <button class="primary" id="plSmart" ${busy ? 'disabled' : ''}>${busy ? '<i class="bk-spin"></i> Preparando…' : `${icon('sparkle', 14)} Generar informe <small class="tk-cost">1 token</small>`}</button></div>`;
  host.innerHTML = `<div class="opd">
    <div class="opd-head"><div><h3>${esc(a.tipo || it.name)}</h3><div class="muted small">${esc(it.name)} · <span class="plz-mode ${smart ? 'smart' : ''}">${smart ? 'Informe inteligente' : 'Informe básico · sin IA'}</span></div></div><span class="ops-chip ${c} big">${esc(l)}</span></div>
    <div class="plz-key ${c}"><b>${esc(it.deadlineLabel)}${it.deadline ? ': ' + fmt(it.deadline) : ''}</b><span>${esc(smart ? a.resumen || '' : basicSummary(list))}</span></div>
    ${smart ? `<h4>Sugerencias</h4><div class="plz-acts">${(a.acciones || []).map((s, i) => `<div class="plz-act ${s.urgente ? 'urg' : ''}">
        <div><b>${esc(s.titulo)}</b><small>${esc(ACT[s.tipo] || '')}${list.length > 1 && Number.isInteger(s.contrato) ? ` · contrato ${s.contrato + 1}` : ''}${s.urgente ? ' · urgente' : ''}</small><p>${esc(s.motivo || '')}</p></div>
        ${s.tipo === 'ninguna' ? `<button class="secondary small" data-ok="${i}">Entendido</button>` : `<button class="primary small" data-draft="${i}">${icon('sparkle', 13)} Redactar <small class="tk-cost">2 tokens</small></button>`}</div>`).join('')}</div>` : upsell}
    ${list.map((x, i) => `${list.length > 1 ? `<h4 class="plz-ct">Contrato ${i + 1} de ${list.length}${x.titulo || x.objeto ? ' · ' + esc(x.titulo || x.objeto) : ''}</h4>` : ''}${facts(x, it, list.length === 1)}`).join('')}
    <div class="plz-foot"><button class="ghost small" id="plIcs" ${it.deadline ? '' : 'disabled'}>${icon('calendar', 14)} Agregar al calendario</button><button class="ghost small" id="plOpen">${icon('file', 14)} Ver documento</button>${smart ? `<button class="ghost small" id="plRe" ${busy ? 'disabled' : ''}>${icon('sparkle', 14)} Actualizar informe <small class="tk-cost">1 token</small></button>` : `<button class="ghost small" id="plBasic">${icon('rotateR', 14)} Volver a leer</button>`}<button class="ghost small" id="plDel">${icon('trash', 14)} Quitar</button></div></div>`;
  host.querySelectorAll('[data-draft]').forEach((b) => (b.onclick = () => draftFor(it, a.acciones[Number(b.dataset.draft)])));
  host.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = async () => { const r = await pf.plazosUpdate(it.id, { done: 'Revisado: se deja así' }); if (r.ok) { P.items = r.data; paint(); } }));
  if ($('#plSmart')) $('#plSmart').onclick = () => smartReport(it);
  if ($('#plRe')) $('#plRe').onclick = () => smartReport(it);
  if ($('#plBasic')) $('#plBasic').onclick = () => readBasic(it);
  $('#plIcs').onclick = async () => { const r = await pf.plazosIcs(it.id); if (!r.ok) toast(r.error, 4000); else if (r.data) toast('Recordatorio creado: ábrelo para agregarlo a tu calendario.', 4000); };
  $('#plOpen').onclick = () => openDoc(it);
  $('#plDel').onclick = () => del(it);
}
// Resumen del informe básico, armado con los datos encontrados
function basicSummary(list) {
  const f = list.filter((x) => x.encontrado !== false);
  if (!f.length) return 'La lectura automática no encontró fechas en este documento. El informe inteligente puede leerlo con más detalle.';
  const one = (x) => x.indefinido ? 'de duración indefinida' : `${x.plazo ? 'por ' + x.plazo : ''}${x.fecha_inicio ? ' desde el ' + fmt(x.fecha_inicio) : ''}${x.renovacion_automatica ? `, se renueva sola${x.periodo_renovacion_meses ? ` cada ${x.periodo_renovacion_meses} meses` : ''}` : ''}${x.aviso_dias ? ` y hay que avisar con ${x.aviso_dias} días de anticipación para terminarlo` : ''}`;
  return list.length > 1 ? `Este documento trae ${list.length} contratos. ` + list.map((x, i) => `Contrato ${i + 1}: ${one(x)}.`).join(' ') : `Contrato ${one(f[0])}.`;
}
async function openDoc(it) { const r = await pf.plazosBytes(it.id); if (r.ok) { const t = await pf.edTemp(r.data, it.name); if (t.ok) window.editor.openPaths([t.data.path || t.data], true); } }
function del(it) {
  modal(`<h2>Quitar de Plazos</h2><p>¿Quitar «${esc(it.name)}» de la lista? El archivo original no se toca.</p><div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="danger" id="mOk">Quitar</button></div>`);
  $('#mCancel').onclick = closeModal; $('#mOk').onclick = async () => { closeModal(); const r = await pf.plazosRemove(it.id); if (r.ok) { P.items = r.data; P.sel = null; paint(); } };
}
// La IA redacta el documento sugerido con los datos del contrato al que se refiere (partes, objeto, motivo)
async function draftFor(it, s) {
  const all = it.analysis; const list = contratos(all);
  const a = list[Number.isInteger(s.contrato) && list[s.contrato] ? s.contrato : 0];
  const end = list.length === 1 ? it.end || a.fecha_termino : keyDate(a).end || a.fecha_termino;
  const partes = (a.partes || []).map((p) => `${p.rol || 'Parte'}: ${p.nombre || '[NOMBRE]'}${p.rut ? ', RUT ' + p.rut : ''}${p.domicilio ? ', domicilio ' + p.domicilio : ''}${p.representante ? ', representada por ' + p.representante : ''}`).join('; ');
  const q = `${s.titulo}, referido al ${all.tipo || 'contrato'} de fecha ${a.fecha_inicio || '[FECHA DEL CONTRATO]'}.
Partes del contrato original (usa estos datos como "valor" de los campos): ${partes}.
Objeto del contrato: ${a.objeto || '[OBJETO]'}.${a.monto ? ` Precio o renta vigente: ${a.monto}.` : ''}
Plazo: ${a.plazo || ''}${end ? `, término el ${end}` : ''}${a.renovacion_automatica ? `, con renovación automática${a.periodo_renovacion_meses ? ` cada ${a.periodo_renovacion_meses} meses` : ''}` : ''}${a.aviso_dias ? `, aviso de ${a.aviso_dias} días` : ''}.${a.reajuste ? ` Reajuste: ${a.reajuste.tipo}${a.reajuste.periodicidad_meses ? ` cada ${a.reajuste.periodicidad_meses} meses` : ''}.` : ''}
Motivo: ${s.motivo || ''}
Redacta el documento completo para que lo firmen las partes que correspondan, citando el contrato original.`;
  const before = window.editor.tabCount();
  await window.Asistente.draft(q, { models: false }); // cartas y anexos: no hay modelo, redacta la IA con los datos del contrato
  if (window.editor.tabCount() > before) { const r = await pf.plazosUpdate(it.id, { done: `Redactado: ${s.titulo}` }); if (r.ok) P.items = r.data; }
}

// Trae los contratos firmados de Mis operaciones (la versión firmada de cada operación finalizada)
async function fromPortalfirma() {
  const st = (await pf.opsStatus()).data;
  if (!st?.phone && !st?.api) { toast('Primero abre «Mis operaciones» para conectar tu cuenta de Portalfirma.', 5000); return; }
  const btn = $('#plPf'); btn.disabled = true; const lbl = btn.querySelector('span'); lbl.textContent = 'Sincronizando…';
  try {
    const sync = await pf.opsSync(false); const l = sync.ok ? sync.data : (await pf.opsList()).data;
    const done = new Set(P.items.map((x) => String(x.op || '')));
    const fin = (l?.items || []).filter((x) => (x.stage === 'finalized' || x.status === 'finalized') && !done.has(String(x.operation)) && !(x.signers && x.signed < x.signers));
    if (!fin.length) { toast('No hay contratos firmados nuevos en Portalfirma.', 4000); return; }
    const paths = []; const fails = []; let i = 0; let keyMissing = false;
    for (const it of fin) {
      lbl.textContent = `Descargando ${++i} de ${fin.length}…`;
      const f = await pf.opsFile(it.operation); // servicio oficial getById
      if (!f.ok) { if (f.code === 'NO_FILE_KEY') { keyMissing = true; break; } fails.push(`${it.operation}: ${f.error}`); continue; }
      paths.push({ op: it.operation, path: f.data.path });
    }
    if (paths.length) {
      const r = await pf.plazosAdd(paths.map((x) => x.path));
      if (r.ok) for (const x of r.data.items) { const m = paths.find((p) => x.name && p.path.endsWith(x.name)); if (m && !x.op) await pf.plazosUpdate(x.id, { op: m.op }); }
      afterAdd(await pf.plazosList().then((q) => ({ ok: true, data: { items: q.data, added: paths.length, skipped: [] } })));
    }
    if (keyMissing) { window.Operaciones.askKey(() => fromPortalfirma()); return; }
    if (fails.length) {
      modal(`<h2>Traer de Portalfirma</h2><p>${paths.length ? `Se agregaron ${paths.length} contrato(s).` : 'No se pudo traer ningún contrato.'}</p>
        <p class="muted small">${fails.slice(0, 5).map(esc).join('<br>')}</p>
        <div class="actions"><button class="primary" id="mCancel">Entendido</button></div>`);
      $('#mCancel').onclick = closeModal;
    }
  } finally { btn.disabled = false; lbl.textContent = 'Traer de Portalfirma'; }
}

window.Plazos = { open, afterAdd, _p: P, _keyDate: keyDate, _keyFor: keyFor };
})();
