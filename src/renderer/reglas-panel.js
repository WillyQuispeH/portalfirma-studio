/* global pf, $, esc, toast, modal, closeModal, icon */
'use strict';
// Panel interno de Portalfirma: aprendizaje de reglas para detectar materias.
// Casos corregidos por los clientes → la IA propone reglas → una persona aprueba o descarta →
// las reglas aprobadas se ejecutan sin IA en todas las apps (publicadas desde el servidor).
(() => {
const MT = window.Materias;
const P = { casos: [], reglas: null, abierto: null };
const TIPO = { acto: ['Acto nuevo', '#3f4fe6'], materia: ['Materia por título', '#0d9488'], excepcion: ['Excepción', '#b26a00'] };
const fecha = (iso) => new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
const matLbl = (v) => MT.BY[v]?.label || v || '—';
const tr = { escritura: 'Escritura', protocolizacion: 'Protocolización', reduccion: 'Reducción' };

function resumenCaso(c) {
  const p = [];
  if (c.materiaAuto && c.materiaFinal && c.materiaAuto !== c.materiaFinal) p.push(`Materia: ${matLbl(c.materiaAuto)} → <b>${esc(matLbl(c.materiaFinal))}</b>`);
  c.descartados.forEach((x) => p.push(`Descartó <b>${esc(x.nombre)}</b>`));
  c.agregados.forEach((x) => p.push(`Agregó <b>${esc(x.nombre)}</b> «${esc(x.frase)}»`));
  return p.join(' · ');
}
function objetivo(r) {
  return r.tipo === 'acto' ? `${esc(r.nombre)}${r.codigo ? (matLbl(r.codigo) === r.nombre ? ' <small class="muted">(de la planilla)</small>' : ` <small class="muted">(${esc(matLbl(r.codigo))})</small>`) : ' <small class="muted">(informativo, fuera de la planilla)</small>'}`
    : r.tipo === 'materia' ? `${r.campo === 'cuerpo' ? 'Texto' : 'Título'} → ${esc(matLbl(r.materia))}` : `No es «${esc(r.acto)}» cuando aparece…`;
}
function pruebaHtml(ev) {
  if (!ev) return '';
  if (ev.error) return `<div class="rg-ev bad">${icon('alert', 13)} ${esc(ev.error)}</div>`;
  const ok = ev.positivos ? ev.aciertos.length / ev.positivos : 0;
  return `<div class="rg-ev ${ev.otros.length ? 'warn' : ok >= 1 ? 'ok' : ''}">${icon(ev.otros.length ? 'alert' : 'check', 13)}
    Detecta ${ev.aciertos.length} de ${ev.positivos} ${ev.positivos === 1 ? 'caso que lo requiere' : 'casos que lo requieren'}${ev.otros.length ? ` · <b>también coincide en ${ev.otros.length} ${ev.otros.length === 1 ? 'caso' : 'casos'} distinto${ev.otros.length === 1 ? '' : 's'}</b> (revisa que no sea un falso positivo)` : ' · sin coincidencias en otros casos'} <span class="muted">· ${ev.total} casos revisados</span></div>`;
}

async function cargar() {
  const [c, r] = await Promise.all([pf.reglasCasos(), pf.reglasGet()]);
  P.casos = c.ok ? c.data : []; P.reglas = r.ok ? r.data : { actos: [], materias: [], excepciones: [], propuestas: [] };
}

async function render(host, ctx) {
  P.host = host; P.ctx = ctx;
  if (!P.reglas) { host.innerHTML = '<div class="muted small es-wait">Cargando…</div>'; await cargar(); }
  const R = P.reglas; const C = P.casos;
  const n = { mat: C.filter((c) => c.materiaAuto && c.materiaFinal && c.materiaAuto !== c.materiaFinal).length, desc: C.reduce((s, c) => s + c.descartados.length, 0), agr: C.reduce((s, c) => s + c.agregados.length, 0) };
  const aprobadas = [...R.actos.map((x) => ({ ...x, tipo: 'acto' })), ...R.materias.map((x) => ({ ...x, tipo: 'materia' })), ...(R.excepciones || []).map((x) => ({ ...x, tipo: 'excepcion' }))];
  const activas = aprobadas.filter((x) => x.activo !== false).length;
  // señales: actos que los clientes descartan seguido (posible regla demasiado amplia)
  const cuenta = {}; C.forEach((c) => c.descartados.forEach((x) => { cuenta[x.nombre] = (cuenta[x.nombre] || 0) + 1; }));
  const senales = Object.entries(cuenta).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const props = R.propuestas || [];
  host.innerHTML = `<div class="es-dh"><div><h3>Reglas de detección</h3><div class="muted small">Interno Portalfirma. La IA propone reglas a partir de los casos que los clientes corrigieron; una persona las aprueba y desde ahí funcionan <b>sin IA</b>.${R.version ? ` Versión ${esc(R.version)}.` : ''}</div></div>
      <div class="ops-head-r"><button class="ghost small with-ic" id="rgExport">${icon('fileOut', 14)}<span>Exportar</span></button><button class="primary small with-ic" id="rgProponer" ${C.length ? '' : 'disabled'}>${icon('sparkle', 14)}<span>Proponer reglas con IA</span></button></div></div>
    <div class="rg-stats">
      <div><b id="rgNCasos">${C.length}</b><small>casos corregidos</small></div>
      <div><b>${n.mat}</b><small>materias cambiadas</small></div>
      <div><b>${n.desc}</b><small>actos descartados</small></div>
      <div><b>${n.agr}</b><small>actos agregados</small></div>
      <div><b id="rgNActivas">${activas}</b><small>reglas activas · ${MT.actosRevisados()} actos revisados</small></div></div>
    ${senales.length ? `<div class="rg-sig small">${icon('alert', 13)} Más descartados por los clientes: ${senales.map(([k, v]) => `<b>${esc(k)}</b> (${v})`).join(' · ')}. Si se repite, conviene una excepción.</div>` : ''}

    <div class="es-h"><h3>Propuestas por revisar</h3><small class="muted">${props.length}</small></div>
    <div class="rg-list" id="rgProps">${props.length ? props.map((p) => `<div class="rg-card ${p.estado === 'invalida' ? 'bad' : ''}" data-pid="${esc(p.id)}">
        <div class="rg-top"><span class="ops-chip" style="--c:${TIPO[p.tipo][1]}">${TIPO[p.tipo][0]}</span><b>${objetivo(p)}</b>${p.principal ? '<span class="ops-chip" style="--c:#c0362c">Cambia la materia principal</span>' : ''}</div>
        <p class="small">${esc(p.explicacion || '')}</p>
        <label class="rg-pat"><span class="muted small">Patrón (texto en minúsculas y sin tildes)</span><input class="es-in mono" data-pat value="${esc(p.patron)}" spellcheck="false" /></label>
        <div data-ev>${pruebaHtml(p.prueba)}</div>
        <div class="row-end"><button class="ghost small" data-probar>Probar</button><button class="ghost small" data-descartar>Descartar</button>${p.estado === 'invalida' ? '' : '<button class="primary small" data-aprobar>Aprobar</button>'}</div>
      </div>`).join('') : `<p class="muted small">${C.length ? 'No hay propuestas pendientes. Pide nuevas a la IA cuando se junten más casos.' : 'Aún no hay casos. Se juntan solos cada vez que un cliente cambia la materia, descarta un acto oculto o agrega uno que faltaba.'}</p>`}</div>

    <div class="es-h"><h3>Reglas aprobadas</h3><small class="muted">${aprobadas.length}</small></div>
    <div class="rg-list" id="rgReglas">${aprobadas.length ? aprobadas.map((r) => `<div class="rg-card sm ${r.activo === false ? 'off' : ''}" data-rid="${esc(r.id)}">
        <div class="rg-top"><span class="ops-chip" style="--c:${TIPO[r.tipo][1]}">${TIPO[r.tipo][0]}</span><b>${objetivo(r)}</b><small class="muted">Aprobada ${fecha(r.aprobada)}</small>
          <label class="es-sw" title="Activa"><input type="checkbox" data-activa ${r.activo === false ? '' : 'checked'}/><span></span></label><button class="ghost small" data-eliminar title="Eliminar">${icon('x', 13)}</button></div>
        <code class="rg-code">${esc(r.patron)}</code></div>`).join('') : '<p class="muted small">Todavía no hay reglas aprobadas.</p>'}</div>

    <div class="es-h"><h3>Casos recogidos</h3><small class="muted">sin RUT, correos ni teléfonos</small></div>
    <div class="rg-list" id="rgCasos">${C.slice(0, 40).map((c) => `<div class="rg-caso" data-cid="${esc(c.id)}"><div><b>${esc(c.titulo || 'Sin título')}</b><small class="muted">${tr[c.tramite] || ''} · ${fecha(c.creado)}</small><span class="small">${resumenCaso(c)}</span></div><button class="ghost small" data-borrar title="Borrar caso">${icon('x', 13)}</button></div>`).join('') || '<p class="muted small">—</p>'}</div>`;

  $('#rgExport').onclick = async () => { const r = await pf.reglasExportar(); if (!r.ok) return toast(r.error); if (r.data) toast('Reglas exportadas'); };
  $('#rgProponer').onclick = () => confirmarPropuesta();
  host.querySelectorAll('[data-pid]').forEach((card) => {
    const id = card.dataset.pid; const p = props.find((x) => x.id === id); const pat = () => card.querySelector('[data-pat]').value.trim();
    card.querySelector('[data-probar]').onclick = async () => { const r = await pf.reglasProbar({ ...p, patron: pat() }); card.querySelector('[data-ev]').innerHTML = pruebaHtml(r.ok ? r.data : { error: r.error }); };
    card.querySelector('[data-descartar]').onclick = () => decidir(id, 'descartar');
    const ap = card.querySelector('[data-aprobar]'); if (ap) ap.onclick = () => decidir(id, 'aprobar', pat());
  });
  host.querySelectorAll('[data-rid]').forEach((card) => {
    const id = card.dataset.rid;
    card.querySelector('[data-activa]').onchange = async (e) => { const r = await pf.reglasActivar({ id, activo: e.target.checked }); if (!r.ok) return toast(r.error); P.reglas = r.data; await P.ctx.recargar(); toast(e.target.checked ? 'Regla activada' : 'Regla desactivada'); render(host, ctx); };
    card.querySelector('[data-eliminar]').onclick = () => {
      modal(`<h3>¿Eliminar la regla?</h3><p class="muted small">Deja de aplicarse en este computador. Si ya se publicó, hay que publicar de nuevo.</p><div class="row-end"><button class="ghost" id="rgNo">Cancelar</button><button class="primary" id="rgSi">Eliminar</button></div>`);
      $('#rgNo').onclick = closeModal; $('#rgSi').onclick = async () => { closeModal(); const r = await pf.reglasEliminar(id); if (!r.ok) return toast(r.error); P.reglas = r.data; await P.ctx.recargar(); render(host, ctx); };
    };
  });
  host.querySelectorAll('[data-cid]').forEach((row) => (row.querySelector('[data-borrar]').onclick = async () => { await pf.reglasBorrarCaso(row.dataset.cid); await cargar(); render(host, ctx); }));
}

function confirmarPropuesta() {
  const n = P.casos.length;
  modal(`<h3>Proponer reglas con IA</h3><p class="small">Se enviarán <b>${Math.min(n, 80)} ${n === 1 ? 'caso' : 'casos'}</b> (sin RUT, correos ni teléfonos) al modelo de IA más económico de la cuenta. La IA solo propone: nada se aplica hasta que lo apruebes.</p><p class="muted small">El costo va por cuenta de Portalfirma; no descuenta tokens del asistente.</p>
    <div class="row-end"><button class="ghost" id="rgNo">Cancelar</button><button class="primary" id="rgGo">Proponer</button></div>`);
  $('#rgNo').onclick = closeModal;
  $('#rgGo').onclick = async () => {
    const b = $('#rgGo'); b.disabled = true; b.textContent = 'Analizando…';
    const r = await pf.reglasProponer({ actos: MT.actosNombres(), materias: MT.CATALOGO.filter((x) => x.value !== 'otro').map((x) => ({ value: x.value, label: x.label })) });
    closeModal();
    if (!r.ok) return toast('No se pudo: ' + r.error, 5000);
    const nv = r.data.propuestas; const u = r.data.uso;
    toast(`${nv.length} ${nv.length === 1 ? 'propuesta nueva' : 'propuestas nuevas'}${u?.modelo ? ` · ${u.modelo}` : ''}`);
    await cargar(); render(P.host, P.ctx);
  };
}

async function decidir(id, accion, patron) {
  const r = await pf.reglasDecidir({ id, accion, patron }); if (!r.ok) return toast(r.error, 5000);
  P.reglas = r.data; await P.ctx.recargar();
  toast(accion === 'aprobar' ? 'Regla aprobada: ya se aplica en los trámites' : 'Propuesta descartada');
  render(P.host, P.ctx);
}

async function abrir(host, ctx) { host.innerHTML = '<div class="muted small es-wait">Cargando…</div>'; await cargar(); return render(host, ctx); }
window.ReglasPanel = { abrir, render, _p: P };
})();
