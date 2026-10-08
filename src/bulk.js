// Carga masiva: cola de documentos que se suben y analizan de a pocos (Portalfirma procesa uno por uno).
// · Revisa cada archivo en el computador (formato, peso, duplicados) y convierte Word a PDF.
// · Sube y detecta firmantes con 2 documentos a la vez; si Portalfirma responde con errores, se frena sola.
// · Enviar a firmar es un paso aparte, con una sola confirmación, y de a uno (descuenta saldo).
// · La cola se guarda en disco: si se cierra la app, sigue donde quedó.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const store = require('./store');

const CONCURRENCY = 2;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_TRIES = 3;
let pf = null; let toPdf = null; let emit = () => {}; let onSent = () => {};
let items = []; let paused = false; let active = 0; let coolUntil = 0; let failStreak = 0; let sending = false; let cancelSend = false;

function init(client, { asPdf, onUpdate, sent }) {
  pf = client; toPdf = asPdf; emit = onUpdate; if (sent) onSent = sent;
  items = (store.get('bulkQueue') || []).map((it) => (['uploading', 'analyzing', 'converting'].includes(it.status) ? { ...it, status: 'queued' } : it.status === 'sending' ? { ...it, status: 'send_error', error: 'La app se cerró mientras se enviaba: revisa «Mis operaciones» antes de reintentar.' } : it));
  paused = !!store.get('bulkPaused');
}
let saveT = null;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set('bulkQueue', items.map(({ b64, ...x }) => x)), 300); };
let emitT = null;
const changed = () => { persist(); clearTimeout(emitT); emitT = setTimeout(() => emit(state()), 80); };
const state = () => ({ items, paused, running: active, sending, coolUntil });
const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sha = (file) => new Promise((res, rej) => { const h = crypto.createHash('sha1'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

async function add(paths) {
  const known = new Set(items.map((x) => x.hash));
  const sent = new Set(store.get('bulkSentHashes') || []);
  for (const entry of paths) {
    // Cada entrada es una ruta, o {path, signers, flow} cuando viene de un flujo documental (firmantes ya definidos)
    const p = typeof entry === 'string' ? entry : entry.path;
    const name = path.basename(p); const it = { id: uid(), path: p, name, status: 'queued', tries: 0, added: Date.now() };
    if (typeof entry === 'object' && entry) { if (Array.isArray(entry.signers)) it.preset = entry.signers; if (entry.flow) it.flow = entry.flow; }
    try {
      const st = fs.statSync(p);
      it.size = st.size;
      if (!/\.(pdf|docx)$/i.test(p)) Object.assign(it, { status: 'skipped', error: 'Formato no admitido: usa PDF o Word (.docx).' });
      else if (st.size > MAX_BYTES && /\.pdf$/i.test(p)) Object.assign(it, { status: 'skipped', error: 'Pesa más de 20 MB: ábrelo en el editor y usa «Comprimir PDF».' });
      else {
        it.hash = await sha(p);
        if (sent.has(it.hash)) Object.assign(it, { status: 'skipped', error: 'Este mismo archivo ya se envió a firmar desde la carga masiva.', dupSent: true });
        else if (known.has(it.hash)) Object.assign(it, { status: 'skipped', error: 'Está repetido en la cola.' });
        known.add(it.hash);
      }
    } catch { Object.assign(it, { status: 'skipped', error: 'No se pudo leer el archivo.' }); }
    items.push(it);
  }
  changed(); pump();
  return state();
}

const transient = (e) => /timeout|tard|ECONN|ENOTFOUND|fetch failed|socket|429|50\d|status code 5|rate|demasiad/i.test(String(e?.message || e));
function pump() {
  if (paused) return;
  const wait = coolUntil - Date.now();
  if (wait > 0) { setTimeout(pump, wait + 50); return; }
  while (active < CONCURRENCY) {
    const it = items.find((x) => x.status === 'queued' && (!x.retryAt || x.retryAt <= Date.now()));
    if (!it) { const next = items.filter((x) => x.status === 'queued' && x.retryAt).map((x) => x.retryAt).sort()[0]; if (next) setTimeout(pump, Math.max(200, next - Date.now())); break; }
    active++; work(it).finally(() => { active--; changed(); pump(); });
  }
}
let convertLock = Promise.resolve(); // las conversiones de Word van de a una (son pesadas)
async function work(it) {
  try {
    let file = it.path;
    if (/\.docx$/i.test(file)) {
      it.status = 'converting'; changed();
      const run = convertLock.then(() => toPdf(file)); convertLock = run.catch(() => {});
      file = (await run).path; it.pdfPath = file;
      if (fs.statSync(file).size > MAX_BYTES) throw Object.assign(new Error('Convertido a PDF pesa más de 20 MB.'), { final: true });
    }
    it.status = 'uploading'; changed();
    const b64 = (await fs.promises.readFile(file)).toString('base64');
    const ing = await pf.ingest(b64, path.basename(file).replace(/\.docx$/i, '.pdf'));
    if (!ing?.document_id) throw new Error(ing?.message || 'Portalfirma no devolvió el documento.');
    it.documentId = ing.document_id;
    it.status = 'analyzing'; changed();
    const ext = await pf.extractSigners(ing.document_id);
    it.typeDocument = ext?.typeDocument || ''; it.configId = ext?.document_config_id || null;
    it.required = ext?.required_fields || {}; it.typeSign = ext?.type_sign || null; it.notarial = ext?.notarial_procedure || null;
    it.signers = (ext?.firmantes || []).map((s) => ({ fullName: s.fullName || '', rut: s.rut || '', email: s.email || '', phone: s.phone || '', alias: s.alias || '' }));
    if (it.preset?.length) it.signers = it.preset.map((s) => ({ ...s })); // el flujo ya sabe quién firma
    it.status = 'ready'; it.error = ''; failStreak = 0;
    validate(it);
  } catch (e) {
    it.tries++;
    if (!e.final && transient(e) && it.tries < MAX_TRIES) {
      it.status = 'queued'; it.retryAt = Date.now() + [2000, 6000, 15000][it.tries - 1]; it.error = 'Reintentando…';
      failStreak++; if (failStreak >= 3) { coolUntil = Date.now() + 30000; failStreak = 0; } // Portalfirma con problemas: pausa breve
    } else { it.status = 'error'; it.error = e.message || String(e); }
  }
}
// Datos que faltan para enviar
function validate(it) {
  const req = it.required || {}; const miss = [];
  if (!it.signers?.length) miss.push('sin firmantes');
  (it.signers || []).forEach((s, i) => {
    const f = []; if (!s.rut) f.push('RUT'); if (!s.alias) f.push('rol');
    if (req.name && !s.fullName) f.push('nombre'); if (req.email && !s.email) f.push('correo'); if (req.phone && !s.phone) f.push('teléfono');
    if (f.length) miss.push(`firmante ${i + 1}: ${f.join(', ')}`);
  });
  it.missing = miss;
  if (it.status === 'ready' || it.status === 'needs_data') it.status = miss.length ? 'needs_data' : 'ready';
  return it;
}
function update(id, patch) {
  const it = items.find((x) => x.id === id); if (!it) return state();
  if (patch.signers) it.signers = patch.signers.map((s) => ({ fullName: String(s.fullName || '').trim(), rut: String(s.rut || '').trim(), email: String(s.email || '').trim(), phone: String(s.phone || '').trim(), alias: String(s.alias || '').trim() }));
  if (patch.selected !== undefined) it.selected = !!patch.selected;
  validate(it); changed(); return state();
}
function applySigners(signers) {
  for (const it of items) if (['ready', 'needs_data'].includes(it.status)) { it.signers = signers.map((s) => ({ ...s })); validate(it); }
  changed(); return state();
}
function retry(id) { for (const it of items) if ((id ? it.id === id : true) && it.status === 'error') { it.status = 'queued'; it.tries = 0; it.retryAt = 0; it.error = ''; } changed(); pump(); return state(); }
function remove(id) { items = items.filter((x) => x.id !== id || ['uploading', 'analyzing', 'converting', 'sending'].includes(x.status)); changed(); return state(); }
function clear(which) {
  const keep = (x) => ['uploading', 'analyzing', 'converting', 'sending'].includes(x.status);
  items = items.filter((x) => keep(x) || (which === 'done' ? x.status !== 'sent' && x.status !== 'skipped' : false)); changed(); return state();
}
function pause(v) { paused = !!v; store.set('bulkPaused', paused); changed(); if (!paused) pump(); return state(); }

// Envío: de a uno, nunca se reintenta solo (para no duplicar operaciones ni cobros)
async function send(ids, { email, protocolization = 'none', typeSign = 'simple' }) {
  if (sending) throw new Error('Ya hay un envío en curso.');
  if (!email) throw new Error('Falta el correo del pagador.');
  const list = items.filter((x) => ids.includes(x.id) && x.status === 'ready');
  if (!list.length) throw new Error('No hay documentos listos para enviar.');
  sending = true; cancelSend = false; changed();
  const sentHashes = new Set(store.get('bulkSentHashes') || []);
  const history = store.get('history') || [];
  try {
    for (const it of list) {
      if (cancelSend) break;
      it.status = 'sending'; changed();
      try {
        const payload = { document_id: it.documentId, email, signatories: it.signers.map((s) => ({ ...s, ...(it.configId ? {} : { typeSign }) })) };
        if (it.configId) payload.document_config_id = it.configId; else payload.protocolization = protocolization;
        const r = await pf.sendToSign(payload);
        const op = r?.operation ?? r?.operationNumber ?? null;
        const msg = typeof r?.message === 'string' ? r.message : '';
        if (op == null) throw new Error(/status code (\d+)/.test(msg) ? `Portalfirma no pudo crear la operación (error ${/status code (\d+)/.exec(msg)[1]}). Revisa «Mis operaciones» antes de reintentar.` : msg || 'Portalfirma no devolvió el número de operación.');
        it.status = 'sent'; it.operation = op; it.error = '';
        if (it.hash) sentHashes.add(it.hash);
        history.unshift({ operation: op, name: it.name, date: new Date().toISOString(), bulk: true });
        try { onSent(it); } catch {}
      } catch (e) { it.status = 'send_error'; it.error = e.message || String(e); }
      store.set('bulkSentHashes', [...sentHashes].slice(-2000)); store.set('history', history.slice(0, 500));
      changed();
    }
  } finally { sending = false; changed(); }
  return state();
}
function stopSend() { cancelSend = true; return state(); }
// Un envío con error queda para revisar; se puede volver a «listo» a mano (después de revisar Mis operaciones)
function rearm(id) { const it = items.find((x) => x.id === id); if (it && it.status === 'send_error') { it.status = 'ready'; validate(it); } changed(); return state(); }

module.exports = { init, state, add, update, applySigners, retry, remove, clear, pause, send, stopSend, rearm };
