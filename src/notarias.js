// Trámites notariales (escrituras, protocolizaciones, reducciones): pago e inicio de la operación.
// Portalfirma actúa como puente: cobra, identifica la materia y entrega el expediente a la notaría por la API;
// la notaría descarga los archivos y asigna repertorio y número.
//
// Rutas de la API que faltan (las debe entregar el técnico). Mientras no existan, en modo real se informa
// «PENDIENTE_API» y no se cobra nada. En modo de prueba (PF_MOCK=1) todo se simula.
//   POST /notarial/operation           { tramite, materia, actos, hojas, total, comparecientes, observaciones } → { operation, status }
//   POST /notarial/operation/:op/file   multipart (minuta original, escritura formateada Word/PDF, documentos, ficha) → { ok }
//   POST /notarial/operation/:op/pay    { method: 'wallet' }  → descuenta del saldo { status: 'pagado', amount }
//   POST /notarial/operation/:op/quote  → solicita cotización (materias sin precio)        { status: 'cotizacion' }
//   GET  /notarial/notarias              → red de notarías (formato estándar más abajo)
//   GET  /notarial/tarifas               → { protocolizacion, reduccion, materias: { codigo: monto }, vigencia }
//   GET  /notarial/operation/:op        → estado (pagado, aceptado, ajuste de tarifa, citado, firmado, cerrado)
const store = require('./store');
const fs = require('fs'); const path = require('path');
// copia local de lo enviado, para mostrar el trámite después (carpeta de datos de la app)
const dir = (op) => path.join(require('electron').app.getPath('userData'), 'tramites', String(op).replace(/[^\w-]/g, '_'));
const MOCK = process.env.PF_MOCK === '1' && !process.env.PF_API_BASE;
const API_LISTA = process.env.PF_NOTARIAL_API === '1'; // se activa cuando el técnico confirme las rutas

const ESTADOS = {
  cotizacion: 'Cotización solicitada',
  pagado: 'Pagado — pendiente de toma por la notaría',
  aceptado: 'Aceptado por la notaría',
  pausado_ajuste_tarifa: 'Pausado — ajuste de tarifa pendiente de pago',
  citado: 'Citación agendada',
  firmado: 'Firmado — pendiente de despacho',
  cerrado: 'Cerrado / despachado',
};
let mockSaldo = 247424;
const list = () => store.get('notarialOps') || [];
const save = (ops) => store.set('notarialOps', ops);
function pendiente() { const e = new Error('El pago y el envío a la notaría todavía no están conectados con Portalfirma (faltan las rutas de la API para trámites notariales).'); e.code = 'PENDIENTE_API'; throw e; }

async function saldo(pfapi) {
  if (MOCK) return mockSaldo;
  try { const w = await pfapi.wallet(); return w?.amount ?? null; } catch { return null; }
}

// Crea la operación, sube los archivos y la paga con el saldo (o deja la cotización solicitada).
async function iniciar(pfapi, payload, files) {
  const { total, cotizacion } = payload;
  if (!MOCK && !API_LISTA) pendiente();
  let operation; let status;
  if (MOCK) {
    if (!cotizacion) { if (mockSaldo < total) { const e = new Error('Saldo insuficiente.'); e.code = 'SALDO'; throw e; } mockSaldo -= total; }
    operation = 'NOT-' + String(Date.now()).slice(-6); status = cotizacion ? 'cotizacion' : 'pagado';
  } else {
    const r = await pfapi.call('POST', '/notarial/operation', payload);
    operation = r.operation || r.id; if (!operation) throw new Error('La API no devolvió el número de operación.');
    for (const f of files) await pfapi.call('POST', `/notarial/operation/${encodeURIComponent(operation)}/file`, { name: f.name, kind: f.kind, base64: Buffer.from(f.bytes).toString('base64') });
    const p = await pfapi.call('POST', `/notarial/operation/${encodeURIComponent(operation)}/${cotizacion ? 'quote' : 'pay'}`, cotizacion ? {} : { method: 'wallet' });
    status = p.status || (cotizacion ? 'cotizacion' : 'pagado');
  }
  try { fs.mkdirSync(dir(operation), { recursive: true }); files.forEach((f) => fs.writeFileSync(path.join(dir(operation), f.name.replace(/[\\/:*?"<>|]/g, '-')), Buffer.from(f.bytes))); } catch {}
  const op = { operation, status, estado: ESTADOS[status] || status, tramite: payload.tramite, materia: payload.materiaLabel, total, titulo: payload.titulo, hojas: payload.hojas, notaria: payload.notaria || null, archivos: files.map((f) => ({ name: f.name.replace(/[\\/:*?"<>|]/g, '-'), kind: f.kind })), creado: new Date().toISOString(), historial: [{ t: new Date().toISOString(), texto: cotizacion ? 'Cotización solicitada' : `Pagado ${payload.totalTexto} con el saldo de la cuenta` }] };
  save([op, ...list()]);
  return op;
}

// Red de notarías. Mientras Portalfirma no publique la red (GET /notarial/notarias), se usan 3 notarías DE PRUEBA
// con datos ficticios, para probar la selección. Formato estándar de cada notaría:
//   { id, nombre, notario, titular, numero, ordinal, ciudad, comuna, region, direccion, telefono, email,
//     horario, servicios: ['escritura','protocolizacion','reduccion'], tomaHoras, prueba }
const NOTARIAS_PRUEBA = [
  { id: 'np-01', nombre: 'Primera Notaría de Prueba', notario: 'Notario de Prueba Uno', titular: true, numero: 1, ordinal: 'Primera', ciudad: 'Santiago', comuna: 'Santiago', region: 'Metropolitana', direccion: 'Calle de Prueba número cien, oficina uno', dirCorta: 'Calle de Prueba 100, of. 1', telefono: '+56 2 0000 0001', email: 'notaria1@prueba.portalfirma.cl', horario: 'Lunes a viernes, 9:00 a 14:00 y 15:00 a 18:00', servicios: ['escritura', 'protocolizacion', 'reduccion'], tomaHoras: 4, prueba: true },
  { id: 'np-02', nombre: 'Segunda Notaría de Prueba', notario: 'Notaria de Prueba Dos', titular: true, numero: 2, ordinal: 'Segunda', ciudad: 'Santiago', comuna: 'Providencia', region: 'Metropolitana', direccion: 'Avenida de Prueba número doscientos, piso dos', dirCorta: 'Av. de Prueba 200, piso 2', telefono: '+56 2 0000 0002', email: 'notaria2@prueba.portalfirma.cl', horario: 'Lunes a viernes, 9:00 a 17:00 · sábado 10:00 a 13:00', servicios: ['escritura', 'protocolizacion', 'reduccion'], tomaHoras: 8, prueba: true },
  { id: 'np-03', nombre: 'Tercera Notaría de Prueba', notario: 'Notario de Prueba Tres', titular: false, titularDe: 'Notaria Titular de Prueba', numero: 3, ordinal: 'Tercera', ciudad: 'Santiago', comuna: 'Las Condes', region: 'Metropolitana', direccion: 'Pasaje de Prueba número trescientos', dirCorta: 'Pasaje de Prueba 300', telefono: '+56 2 0000 0003', email: 'notaria3@prueba.portalfirma.cl', horario: 'Lunes a viernes, 8:30 a 16:30', servicios: ['escritura', 'reduccion'], tomaHoras: 24, prueba: true },
];
async function red(pfapi) {
  if (API_LISTA) { try { const l = await pfapi.call('GET', '/notarial/notarias'); if (Array.isArray(l) && l.length) { store.set('redNotarias', l); return l; } } catch {} }
  return store.get('redNotarias') || NOTARIAS_PRUEBA;
}

// Valores vigentes: los publica Portalfirma (GET /notarial/tarifas) o quedan los de la versión instalada.
async function tarifas(pfapi) {
  if (API_LISTA) { try { const t = await pfapi.call('GET', '/notarial/tarifas'); if (t) { store.set('tarifasNotariales', t); return t; } } catch {} }
  return store.get('tarifasNotariales') || null;
}

function archivo(op, name) { const f = path.join(dir(op), path.basename(String(name))); return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null; }

module.exports = { ESTADOS, list, saldo, iniciar, tarifas, archivo, red, NOTARIAS_PRUEBA, _setMockSaldo: (n) => { mockSaldo = n; } };
