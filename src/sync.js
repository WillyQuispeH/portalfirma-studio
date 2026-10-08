// Sincronización de «Mis operaciones» con Portalfirma.
// Trae las operaciones de la cuenta (por el teléfono del usuario, en rangos de hasta 1 año y 100 por consulta),
// guarda una copia local para abrir rápido y consulta el detalle (firmantes y versiones) solo cuando se abre.
const fs = require('fs'); const path = require('path'); const { app } = require('electron');
const store = require('./store');

const YEARS_BACK = 3;            // historia que se trae la primera vez
const PAGE = 100;                // máximo del conector por consulta
const DETAIL_TTL = 2 * 60 * 1000; // detalle de una operación en curso: se refresca a los 2 minutos
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

let pf = null; let api = null; let running = null;
function init(client, apiClient) { pf = client; api = apiClient || null; }
const useApi = () => !!api?.user();

const cache = () => store.get('opsCache') || { items: {}, details: {}, lastSync: null, phone: '' };
const save = (c) => store.set('opsCache', c);

function status() {
  const c = cache();
  const u = useApi() ? api.user() : null;
  return { phone: store.get('syncPhone') || '', apiAvailable: !!api, api: !!u, account: u ? (u.nameEntity || u.email) : '', lastSync: (u ? c.mode === 'api' : c.mode !== 'api') ? c.lastSync : null, count: Object.keys(c.items).length };
}
function setPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8) throw new Error('Escribe el teléfono con el que te registraste en Portalfirma (ej. 9 8727 6858).');
  if (store.get('syncPhone') !== d) { store.set('syncPhone', d); save({ items: {}, details: {}, lastSync: null }); }
  return status();
}

// Lista un rango de fechas; si el rango tiene más de 100 operaciones, se parte en dos.
async function listRange(phone, start, end, depth = 0) {
  const r = await pf.byPhone(phone, iso(start), iso(end), PAGE);
  const ops = r?.operations || [];
  if ((r?.totalInRange || 0) > ops.length && end - start > DAY && depth < 8) {
    const mid = start + Math.floor((end - start) / 2 / DAY) * DAY;
    return [...await listRange(phone, start, mid, depth + 1), ...await listRange(phone, mid + DAY, end, depth + 1)];
  }
  return ops;
}

// Sincroniza: la primera vez trae los últimos años; después, solo desde la última sincronización (con margen).
async function sync({ full = false } = {}) {
  if (running) return running;
  running = (async () => {
    if (useApi()) return apiSync();
    const phone = store.get('syncPhone'); if (!phone) { const e = new Error('Falta el teléfono de la cuenta.'); e.code = 'NO_PHONE'; throw e; }
    let c = cache(); if (c.mode === 'api') c = { items: {}, details: {}, lastSync: null }; const now = Date.now();
    const from = !full && c.lastSync ? new Date(c.lastSync).getTime() - 45 * DAY : now - YEARS_BACK * 365 * DAY;
    const ranges = []; for (let end = now; end > from; end -= 366 * DAY) ranges.push([Math.max(from, end - 365 * DAY), end]);
    let found = 0;
    for (const [s, e] of ranges) {
      for (const o of await listRange(phone, s, e)) {
        if (o?.operation == null) continue; found++;
        const prev = c.items[o.operation];
        const item = { operation: Number(o.operation), contractId: o.contract_id || prev?.contractId || '', stage: o.stage || prev?.stage || '', name: o.document_name || prev?.name || 'Documento',
          created: o.createdAt || o.created_at || o.createdDateAt || prev?.created || '', updated: o.updatedAt || o.updated_at || o.updatedDateAt || prev?.updated || '' };
        if (prev && prev.updated !== item.updated) delete c.details[o.operation]; // cambió: el detalle se vuelve a pedir
        c.items[o.operation] = { ...prev, ...item };
      }
    }
    // los envíos hechos desde esta app también aparecen (aunque se hayan creado con otro teléfono)
    for (const h of store.get('history') || []) {
      const n = Number(String(h.operation ?? '').replace(/\D/g, '')); if (!n || c.items[n]) continue;
      c.items[n] = { operation: n, name: h.name || 'Documento', stage: 'process', created: h.date, updated: h.date, local: true };
    }
    c.lastSync = new Date().toISOString(); save(c);
    return { ...list(), found };
  })();
  try { return await running; } finally { running = null; }
}

// Con la API: la cuenta completa (sin teléfono), por etapa y con el resumen de firmas de cada operación
async function apiSync() {
  let c = cache(); if (c.mode !== 'api') c = { items: {}, details: {}, lastSync: null, mode: 'api' };
  const seen = new Set();
  for (const [stage, key] of [['unpaid', 'unPayed'], ['starting', 'starting'], ['process', 'process'], ['finalized', 'finalized']]) {
    for (const row of await api.contracts(stage)) {
      const k = row?.contract || row || {}; const op = Number(k.operation); if (!op) continue;
      seen.add(op); const prev = c.items[op];
      const sg = Array.isArray(row.signers) ? row.signers.filter((x) => x.isSignatory !== false) : null;
      const item = { operation: op, contractId: k.id || k.contract_id || prev?.contractId || '', stage: key, name: k.document_des || k.document_name || prev?.name || 'Documento', kind: k.document_name || '',
        created: k.createdDate || prev?.created || '', updated: k.updateDate || prev?.updated || '', legalized: k.legalized || null, apiStatus: row.status || '',
        sig: sg ? sg.map((x) => ({ fullName: x.fullName || '', signed: !!x.signed, status: x.status || '', number: x.number })) : prev?.sig || null };
      if (prev && prev.updated !== item.updated) delete c.details[op];
      c.items[op] = item;
    }
  }
  for (const op of Object.keys(c.items)) if (!seen.has(Number(op))) { delete c.items[op]; delete c.details[op]; }
  c.lastSync = new Date().toISOString(); save(c);
  return { ...list(), found: seen.size };
}
const apiSummary = (it) => (it.sig ? { status: it.stage === 'finalized' ? 'finalized' : it.stage, proc: it.legalized ? 'legalization' : undefined, signed: it.sig.filter((x) => x.signed).length, signers: it.sig.length } : {});

function list() {
  const c = cache();
  const items = Object.values(c.items).map((it) => ({ ...it, ...apiSummary(it), ...summary(c.details[it.operation]?.d) }))
    .sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  return { items, lastSync: c.lastSync, phone: store.get('syncPhone') || '' };
}
// Resumen que se agrega a la lista cuando ya se conoce el detalle
function summary(d) {
  if (!d) return {};
  const sig = d.signatories || [];
  return { status: d.status, proc: d.protocolizationNumber || 'none', signed: sig.filter((s) => s.signed).length, signers: sig.length, closedUnsigned: d.status === 'finalized' && sig.length > 0 && !sig.every((s) => s.signed) };
}

// Etapas del documento (solo estado: el PDF se obtiene siempre del servicio oficial getById)
function versions(d) {
  const fin = d.status === 'finalized'; const proc = d.protocolizationNumber || 'none';
  const sig = d.signatories || []; const allSigned = fin && (!sig.length || sig.every((s) => s.signed));
  const has = (re) => (d.files || []).some((f) => re.test(f.fileName || ''));
  const steps = [{ key: 'original', label: 'Enviado', done: true }, { key: 'firmado', label: 'Firmado', done: allSigned }];
  if (proc === 'legalization') steps.push({ key: 'legalizado', label: 'Legalizado', done: allSigned && (has(/legaliz/i) || !!d.repertoireNumber) });
  if (proc === 'protocolization') steps.push({ key: 'protocolizado', label: 'Protocolizado', done: allSigned && (has(/protocol/i) || !!d.repertoireNumber) });
  return steps;
}

// Detalle con la API: firmantes del contrato (si la API no los entrega, los de la lista)
const pickS = (o, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, x) => a?.[x], o); if (v != null && v !== '') return v; } return ''; };
function normSigner(x) {
  const full = pickS(x, 'fullName', 'person.fullName') || [pickS(x, 'name', 'person.name'), pickS(x, 'paternalLastName', 'person.paternalLastName'), pickS(x, 'maternalLastName', 'person.maternalLastName')].filter(Boolean).join(' ');
  const st = String(pickS(x, 'status')).toLowerCase();
  return { name: full, paternalLastName: '', maternalLastName: '', rut: pickS(x, 'rut', 'person.rut'), email: pickS(x, 'email', 'person.email'), phone: pickS(x, 'phone', 'person.phone'),
    url: String(pickS(x, 'url', 'link', 'urlSign', 'signUrl')).trim(), personId: pickS(x, 'personId', 'person_id', 'person.id'), contractSignatoryId: pickS(x, 'contractSignatoryId', 'id'),
    signed: x.signed != null ? !!x.signed : /sign|firm/.test(st) && !/pend|unsign/.test(st) };
}
const arrOf = (r) => (Array.isArray(r) ? r : ['signatories', 'signers', 'data', 'contractSignatory', 'contractSignatories', 'persons'].map((k) => r?.[k]).find(Array.isArray) || null);
async function apiDetail(n) {
  let it = cache().items[n];
  if (!it) { await apiSync(); it = cache().items[n]; }
  if (!it) throw new Error(`No encuentro la operación ${n} en tu cuenta.`);
  let arr = null;
  if (it.contractId) try { arr = arrOf(await api.signersByContract(it.contractId)); } catch {}
  if (!arr?.length) try { arr = arrOf(await api.signersByOperation(n)); } catch {}
  const sig = (arr?.length ? arr : it.sig || []).map(normSigner);
  return { processId: it.contractId, operation: n, status: it.stage === 'finalized' ? 'finalized' : it.stage, protocolizationNumber: it.legalized ? 'legalization' : 'none', repertoireNumber: '',
    createdDateAt: it.created, updatedDateAt: it.updated, signatories: sig, files: [], source: 'api' };
}

async function detail(op, { refresh = false } = {}) {
  const n = Number(op); const c = cache(); const hit = c.details[n];
  const fresh = hit && (hit.d.status === 'finalized' || Date.now() - hit.t < DETAIL_TTL);
  if (hit && fresh && !refresh) return { ...hit.d, versions: versions(hit.d), cached: true };
  const d = useApi() ? await apiDetail(n) : await pf.processDetail(n);
  c.details[n] = { t: Date.now(), d };
  if (c.items[n]) Object.assign(c.items[n], { stage: d.status === 'finalized' ? 'finalized' : c.items[n].stage, updated: d.updatedDateAt || c.items[n].updated });
  else c.items[n] = { operation: n, name: (d.files || []).find((f) => !/^(original|legaliz|protocol)/i.test(f.fileName))?.fileName || `Operación ${n}`, stage: d.status, created: d.createdDateAt, updated: d.updatedDateAt };
  save(c);
  return { ...d, versions: versions(d) };
}

// Archivos descargados: quedan en una carpeta de la app para ver, compartir o guardar sin volver a bajarlos
const filesDir = () => { const d = path.join(app.getPath('userData'), 'operaciones'); fs.mkdirSync(d, { recursive: true }); return d; };
const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
// Copia local del documento; se vuelve a pedir cuando la operación cambia (nuevas firmas, cierre…)
const metaFile = () => path.join(filesDir(), 'documentos.json');
const metaRead = () => { try { return JSON.parse(fs.readFileSync(metaFile(), 'utf8')); } catch { return {}; } };
async function file(op) {
  const n = Number(op); const d = await detail(n);
  const stamp = [d.processId, d.status, d.updatedDateAt || '', (d.signatories || []).filter((s) => s.signed).length].join('|');
  const meta = metaRead(); const m = meta[n];
  if (m && m.stamp === stamp && fs.existsSync(m.path)) return m.path;
  const r = useApi() ? await api.fileById(d.processId) : await pf.fileById(d.processId);
  const base = safe(String(r.name || cache().items[n]?.name || 'Documento').replace(/\.pdf$/i, '')) || 'Documento';
  const out = path.join(filesDir(), `${n} - ${base}.pdf`);
  fs.writeFileSync(out, r.bytes); meta[n] = { stamp, path: out }; fs.writeFileSync(metaFile(), JSON.stringify(meta));
  return out;
}

module.exports = { init, status, setPhone, sync, list, detail, file, versions };
