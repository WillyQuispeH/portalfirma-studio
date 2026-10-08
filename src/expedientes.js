// Expedientes: una carpeta por caso (una propiedad, un cliente, un trámite) con todos sus documentos
// (contratos, cédulas, fotos, escrituras…) y el historial de lo que se hizo con ellos.
// Cada expediente vive en el computador (Documentos/Expedientes PortalFirma) o en Google Drive
// (carpeta «Expedientes PortalFirma» que crea la app). La app guarda solo la lista y el historial.
const fs = require('fs'); const path = require('path');
const { app, shell } = require('electron');
const store = require('./store');
const gdrive = require('./gdrive');

const ROOT_NAME = 'Expedientes PortalFirma';
const TYPES = ['propiedad', 'persona', 'empresa', 'tramite', 'otro'];
const uid = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const safe = (n) => String(n || 'Expediente').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Expediente';
const all = () => store.get('expedientes') || [];
const save = (l) => store.set('expedientes', l);
const get = (id) => { const e = all().find((x) => x.id === id); if (!e) throw new Error('El expediente ya no existe.'); return e; };
const localRoot = () => { const d = process.env.PF_EXP_DIR || path.join(app.getPath('documents'), ROOT_NAME); fs.mkdirSync(d, { recursive: true }); return d; };
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp', txt: 'text/plain' };
const mimeOf = (n) => MIME[String(n).split('.').pop().toLowerCase()] || 'application/octet-stream';

function list() { return all().map(summary); }
const summary = (e) => ({ ...e, history: undefined, last: e.history?.[0] || null, count: e.count ?? null });

function log(id, entry) {
  const l = all(); const e = l.find((x) => x.id === id); if (!e) return null;
  e.history = [{ at: new Date().toISOString(), ...entry }, ...(e.history || [])].slice(0, 500); e.updated = new Date().toISOString();
  save(l); return e;
}

async function create({ name, type = 'otro', storage = 'local', notes = '' }) {
  name = safe(name); if (!TYPES.includes(type)) type = 'otro';
  const e = { id: uid(), name, type, storage: storage === 'drive' ? 'drive' : 'local', notes: String(notes || '').slice(0, 500), created: new Date().toISOString(), updated: new Date().toISOString(), history: [] };
  if (e.storage === 'local') {
    let dir = path.join(localRoot(), name); let n = 2; while (fs.existsSync(dir)) dir = path.join(localRoot(), `${name} (${n++})`);
    fs.mkdirSync(dir, { recursive: true }); e.path = dir;
  } else {
    let root = store.get('expDriveRoot');
    if (!root) { root = (await gdrive.createFolder(ROOT_NAME)).id; store.set('expDriveRoot', root); }
    let f; try { f = await gdrive.createFolder(name, root); } catch (err) {
      if (!/not ?found|404/i.test(err.message)) throw err; // la carpeta raíz se borró en Drive: se crea otra
      root = (await gdrive.createFolder(ROOT_NAME)).id; store.set('expDriveRoot', root); f = await gdrive.createFolder(name, root);
    }
    e.driveId = f.id;
  }
  e.history.push({ at: e.created, kind: 'created', text: `Expediente creado ${e.storage === 'drive' ? 'en Google Drive' : 'en este computador'}` });
  const l = all(); l.unshift(e); save(l); return summary(e);
}
function update(id, patch) {
  const l = all(); const e = l.find((x) => x.id === id); if (!e) throw new Error('El expediente ya no existe.');
  if (patch.type && TYPES.includes(patch.type)) e.type = patch.type;
  if (patch.notes !== undefined) e.notes = String(patch.notes).slice(0, 500);
  if (patch.name) e.name = safe(patch.name); // el nombre de la carpeta no se cambia (podría estar abierta)
  e.updated = new Date().toISOString(); save(l); return summary(e);
}
// Quitar de la lista no borra la carpeta ni sus archivos
function remove(id) { save(all().filter((x) => x.id !== id)); return list(); }
const history = (id) => get(id).history || [];

async function files(id) {
  const e = get(id); let out;
  if (e.storage === 'local') {
    if (!fs.existsSync(e.path)) throw new Error('No encuentro la carpeta del expediente en este computador (¿se movió o se borró?).');
    out = fs.readdirSync(e.path).filter((f) => !f.startsWith('.') && !f.startsWith('~$')).map((f) => { const p = path.join(e.path, f); const st = fs.statSync(p); return st.isFile() ? { id: f, name: f, size: st.size, modified: st.mtime.toISOString(), path: p } : null; }).filter(Boolean);
  } else {
    out = (await gdrive.children(e.driveId)).map((f) => ({ id: f.id, name: f.name, size: Number(f.size) || 0, modified: f.modifiedTime, mime: f.mimeType }));
  }
  out.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  const l = all(); const x = l.find((y) => y.id === id); if (x && x.count !== out.length) { x.count = out.length; save(l); }
  return out;
}
const uniqueName = (taken, name) => { const ext = path.extname(name); const base = name.slice(0, name.length - ext.length); let n = name; let i = 2; while (taken.has(n.toLowerCase())) n = `${base} (${i++})${ext}`; taken.add(n.toLowerCase()); return n; };
async function addFiles(id, paths, { note } = {}) {
  const e = get(id); const taken = new Set((await files(id)).map((f) => f.name.toLowerCase())); const added = []; const skipped = [];
  for (const p of paths) {
    try {
      const st = fs.statSync(p); if (!st.isFile()) { skipped.push(`${path.basename(p)}: no es un archivo`); continue; }
      if (st.size > 50 * 1024 * 1024) { skipped.push(`${path.basename(p)}: pesa más de 50 MB`); continue; }
      const name = uniqueName(taken, path.basename(p));
      if (e.storage === 'local') fs.copyFileSync(p, path.join(e.path, name));
      else await gdrive.upload(e.driveId, name, fs.readFileSync(p), mimeOf(name));
      added.push(name);
    } catch (err) { skipped.push(`${path.basename(p)}: ${err.message}`); }
  }
  if (added.length) log(id, { kind: 'added', text: note || (added.length === 1 ? `Se agregó «${added[0]}»` : `Se agregaron ${added.length} archivos`), files: added });
  return { added, skipped };
}
async function addBytes(id, name, bytes, { note } = {}) {
  const e = get(id); const taken = new Set((await files(id)).map((f) => f.name.toLowerCase())); const n = uniqueName(taken, safe(name));
  if (e.storage === 'local') fs.writeFileSync(path.join(e.path, n), Buffer.from(bytes));
  else await gdrive.upload(e.driveId, n, Buffer.from(bytes), mimeOf(n));
  log(id, { kind: 'added', text: note || `Se guardó «${n}»`, files: [n] });
  return n;
}
// Ruta local para usar el archivo en la app (de Drive se descarga una copia temporal)
async function localPath(id, fileId) {
  const e = get(id);
  if (e.storage === 'local') { const p = path.join(e.path, path.basename(fileId)); if (!fs.existsSync(p)) throw new Error('El archivo ya no está en la carpeta.'); return p; }
  const f = (await gdrive.children(e.driveId)).find((x) => x.id === fileId);
  return gdrive.downloadAny(fileId, f?.name);
}
async function removeFile(id, fileId) {
  const e = get(id);
  let name = path.basename(fileId);
  if (e.storage === 'local') { const p = path.join(e.path, name); await shell.trashItem(p).catch(() => fs.unlinkSync(p)); }
  else { name = (await gdrive.children(e.driveId)).find((x) => x.id === fileId)?.name || 'archivo'; await gdrive.trash(fileId); }
  log(id, { kind: 'removed', text: `Se envió a la papelera «${name}»` });
  return true;
}
async function reveal(id) {
  const e = get(id);
  if (e.storage === 'local') { const r = await shell.openPath(e.path); if (r) throw new Error(r); return true; }
  const u = gdrive.folderUrl(e.driveId); if (/^https:/.test(u)) await shell.openExternal(u); else await shell.openPath(u);
  return true;
}

module.exports = { list, create, update, remove, history, files, addFiles, addBytes, localPath, removeFile, reveal, log, TYPES };
