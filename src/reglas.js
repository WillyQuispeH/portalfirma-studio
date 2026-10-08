// Aprendizaje de reglas para detectar materias (trámites notariales).
//   1. Casos: cada vez que el cliente corrige la detección (cambia la materia, descarta un acto oculto o
//      agrega uno que faltaba) se guarda un caso, con los datos personales tachados (RUT, correos, teléfonos).
//   2. Propuestas: la IA revisa los casos en lote y propone reglas (expresiones regulares). Cada propuesta
//      se valida aquí: debe compilar y se prueba contra todos los casos guardados.
//   3. Aprobación: una persona de Portalfirma aprueba o descarta. Las aprobadas se ejecutan sin IA.
//   4. Publicación: Portalfirma las publica desde el servidor (GET /notarial/reglas) como las tarifas.
//      Mientras la ruta no exista, las reglas aprobadas quedan en este computador.
// Rutas de la API pendientes:
//   GET  /notarial/reglas         → { version, actos: [...], materias: [...], excepciones: [...] }
//   POST /notarial/reglas/casos   { caso } → { ok }        (los casos de todos los clientes llegan a Portalfirma)
//   POST /notarial/reglas         { version, actos, materias, excepciones } → { ok }   (solo administradores)
const fs = require('fs'); const path = require('path');
const store = require('./store');
const API_LISTA = process.env.PF_NOTARIAL_API === '1';
const MAX_CASOS = 500;
const file = () => path.join(require('electron').app.getPath('userData'), 'reglas', 'casos.json');

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
// Datos personales fuera: los casos solo sirven por su redacción, no por quién firma.
function tachar(s) {
  return String(s || '')
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]\b/g, '[RUT]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[CORREO]')
    .replace(/(?:\+?56\s*)?(?:\(?\d\)?[\s-]*)?\d{4}[\s-]?\d{4}\b/g, '[TELÉFONO]');
}

function leer() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; } }
function escribir(l) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(l, null, 1)); }

// Un caso por documento: si el cliente vuelve a enviar el mismo, se reemplaza.
async function agregarCaso(pfapi, c) {
  const texto = tachar(String(c.texto || '').slice(0, 6000));
  const caso = {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), clave: String(c.clave || ''), creado: new Date().toISOString(),
    tramite: c.tramite, titulo: tachar(c.titulo || ''), materiaAuto: c.materiaAuto || null, materiaFinal: c.materiaFinal || null,
    confianza: c.confianza || null,
    descartados: (c.descartados || []).map((x) => ({ codigo: x.codigo || null, nombre: x.nombre, cita: tachar(x.cita || '') })),
    agregados: (c.agregados || []).map((x) => ({ codigo: x.codigo || null, nombre: x.nombre, frase: tachar(x.frase || '') })),
    texto,
  };
  const l = leer().filter((x) => !caso.clave || x.clave !== caso.clave);
  escribir([caso, ...l].slice(0, MAX_CASOS));
  if (API_LISTA) { try { await pfapi.call('POST', '/notarial/reglas/casos', { caso }); } catch {} }
  return { id: caso.id };
}
const listarCasos = () => leer();
function borrarCaso(id) { escribir(leer().filter((x) => x.id !== id)); return true; }

// ---------------------------------------------------------------- reglas
const vacio = () => ({ version: null, actos: [], materias: [], excepciones: [], propuestas: [] });
const local = () => ({ ...vacio(), ...(store.get('reglasNotariales') || {}) });
const guardarLocal = (r) => { store.set('reglasNotariales', r); return r; };
async function obtener(pfapi) {
  const r = local();
  if (API_LISTA) {
    try { const s = await pfapi.call('GET', '/notarial/reglas'); if (s && (s.actos || s.materias)) { Object.assign(r, { version: s.version, actos: s.actos || [], materias: s.materias || [], excepciones: s.excepciones || [] }); guardarLocal(r); } } catch {}
  }
  return r;
}

function compilar(src) {
  if (!src || String(src).length > 400) return { error: 'Expresión vacía o demasiado larga.' };
  try { const re = new RegExp(String(src)); if (re.test('')) return { error: 'La expresión coincide con un texto vacío.' }; if (re.test('a b c d e f g h i j')) return { error: 'La expresión es demasiado general.' }; return { re }; } catch (e) { return { error: 'No compila: ' + e.message }; }
}
// Prueba una regla contra los casos guardados.
//   positivos: casos donde el cliente dijo que la regla debía actuar (agregó ese acto / eligió esa materia / descartó ese acto)
//   aciertos: positivos donde la regla coincide · otros: casos no positivos donde también coincide (posibles falsos positivos)
function evaluar(r, casos = leer()) {
  const c = compilar(r.patron); if (c.error) return { error: c.error };
  const iguala = (a, b) => a && b && fold(a) === fold(b);
  const pos = (k) => r.tipo === 'acto' ? (k.agregados || []).some((a) => iguala(a.codigo, r.codigo) || iguala(a.nombre, r.nombre))
    : r.tipo === 'materia' ? k.materiaFinal === r.materia && k.materiaAuto !== r.materia
      : (k.descartados || []).some((a) => iguala(a.codigo, r.acto) || iguala(a.nombre, r.acto));
  const campo = (k) => r.tipo === 'materia' ? fold(r.campo === 'cuerpo' ? String(k.texto).slice(0, 1500) : k.titulo)
    : r.tipo === 'excepcion' ? fold((k.descartados || []).filter((a) => iguala(a.codigo, r.acto) || iguala(a.nombre, r.acto)).map((a) => a.cita).join(' ')) : fold(k.texto);
  const out = { positivos: 0, aciertos: [], otros: [], total: casos.length };
  for (const k of casos) {
    const p = pos(k); const hit = c.re.test(campo(k)); if (p) out.positivos++;
    if (hit && p) out.aciertos.push(k.id); else if (hit) out.otros.push(k.id);
  }
  return out;
}
const limpiar = (p) => ({
  tipo: ['acto', 'materia', 'excepcion'].includes(p.tipo) ? p.tipo : 'acto', nombre: String(p.nombre || p.acto || p.materia || '').slice(0, 80), codigo: p.codigo || null,
  materia: p.materia || null, acto: p.acto || null, campo: p.campo === 'cuerpo' ? 'cuerpo' : 'titulo', patron: String(p.patron || ''), incluido: p.incluido || null,
  principal: !!p.principal, explicacion: String(p.explicacion || '').slice(0, 300), casos: Array.isArray(p.casos) ? p.casos.slice(0, 50) : [],
});

async function proponer({ actos, materias }) {
  const casos = leer(); if (!casos.length) { const e = new Error('Todavía no hay casos corregidos para analizar.'); e.code = 'SIN_CASOS'; throw e; }
  const ai = require('./ai');
  const muestra = casos.slice(0, 80).map((k) => ({ id: k.id, tramite: k.tramite, titulo: k.titulo, materiaAuto: k.materiaAuto, materiaFinal: k.materiaFinal, descartados: k.descartados, agregados: k.agregados, extracto: String(k.texto).slice(0, 1800) }));
  const r = await ai.proponerReglas({ casos: muestra, actos, materias });
  const R = local(); const nuevas = [];
  for (const p0 of r.propuestas) {
    const p = limpiar(p0); const ev = evaluar(p, casos);
    nuevas.push({ ...p, id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), estado: ev.error ? 'invalida' : 'propuesta', prueba: ev, creado: new Date().toISOString() });
  }
  R.propuestas = [...nuevas, ...R.propuestas.filter((x) => x.estado === 'propuesta')].slice(0, 100);
  guardarLocal(R);
  return { propuestas: nuevas, uso: r._uso };
}

function probar(p) { return evaluar(limpiar(p)); }

// Aprobar: pasa a reglas activas (con el patrón que dejó la persona) · descartar: se elimina la propuesta.
function decidir({ id, accion, patron }) {
  const R = local(); const p = R.propuestas.find((x) => x.id === id); if (!p) throw new Error('La propuesta ya no existe.');
  R.propuestas = R.propuestas.filter((x) => x.id !== id);
  if (accion === 'aprobar') {
    const q = { ...p, patron: patron != null ? String(patron) : p.patron }; const ev = evaluar(q); if (ev.error) throw new Error(ev.error);
    const regla = { id: 'r' + Date.now().toString(36), activo: true, aprobada: new Date().toISOString(), patron: q.patron, explicacion: q.explicacion, prueba: ev };
    if (q.tipo === 'acto') R.actos.push({ ...regla, nombre: q.nombre, codigo: q.codigo, incluido: q.incluido, principal: q.principal });
    else if (q.tipo === 'materia') R.materias.push({ ...regla, materia: q.materia, campo: q.campo });
    else R.excepciones.push({ ...regla, acto: q.acto });
    R.version = new Date().toISOString().slice(0, 10) + '-local';
  }
  return guardarLocal(R);
}
function activar({ id, activo }) {
  const R = local(); for (const k of ['actos', 'materias', 'excepciones']) R[k].forEach((x) => { if (x.id === id) x.activo = !!activo; });
  return guardarLocal(R);
}
function eliminar(id) { const R = local(); for (const k of ['actos', 'materias', 'excepciones']) R[k] = R[k].filter((x) => x.id !== id); return guardarLocal(R); }
// Lo que Portalfirma publica a todas las apps
function exportar() { const R = local(); const strip = (x) => { const { prueba, ...y } = x; return y; }; return { version: R.version, actos: R.actos.map(strip), materias: R.materias.map(strip), excepciones: R.excepciones.map(strip) }; }

module.exports = { agregarCaso, listarCasos, borrarCaso, obtener, proponer, probar, decidir, activar, eliminar, exportar, _tachar: tachar, _evaluar: evaluar };
