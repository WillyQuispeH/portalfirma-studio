// Google Drive: el usuario elige sus documentos en el selector oficial de Google (Google Picker).
// Permiso acotado «drive.file»: la app solo puede abrir los archivos que el usuario elige; no ve el resto del Drive.
// OAuth 2.0 para apps de escritorio (navegador del sistema + redirección a 127.0.0.1 + PKCE).
// El token de actualización queda cifrado en este computador; la ventana principal de la app nunca lo ve.
const http = require('http'); const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const { shell } = require('electron');
const store = require('./store');
const { tmpDir } = require('./convert');

const MOCK = process.env.PF_MOCK === '1';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MIME = {
  gdoc: 'application/vnd.google-apps.document',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pdf: 'application/pdf',
};

// Credenciales del cliente OAuth «App de escritorio» de Portalfirma (se incluyen al compilar en build/google/oauth.json).
let clientCache;
function client() {
  if (clientCache !== undefined) return clientCache;
  clientCache = null;
  const saved = store.get('gdriveClient'); if (saved?.id && saved.picker) return (clientCache = saved);
  const cands = [process.env.PF_GOOGLE_OAUTH, process.resourcesPath && path.join(process.resourcesPath, 'google', 'oauth.json'), path.join(__dirname, '..', 'build', 'google', 'oauth.json')].filter(Boolean);
  for (const f of cands) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')); const c = j.installed || j;
      if (c.client_id) { clientCache = { id: c.client_id, secret: c.client_secret || '', picker: j.picker || null }; break; }
    } catch {}
  }
  return clientCache;
}

function status() {
  const tok = store.getSecret('gdrive'); const c = client();
  const ok = !!tok?.refresh && tok.scope === SCOPE; // una conexión antigua (permiso «ver todo el Drive») se vuelve a pedir
  return { configured: MOCK || !!c?.picker, picker: !MOCK && !!c?.picker, connected: MOCK ? !!store.get('gdriveMock') : ok, reconnect: !MOCK && !!tok?.refresh && !ok, email: tok?.email || (MOCK && store.get('gdriveMock') ? 'prueba@gmail.com' : '') };
}

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function post(url, form) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Google respondió con error ${r.status}`);
  return j;
}

// Abre el navegador para que el usuario autorice; espera la redirección en 127.0.0.1
async function connect() {
  if (MOCK) { store.set('gdriveMock', true); return status(); }
  const c = client(); if (!c) throw new Error('La integración con Google Drive no está configurada en esta versión.');
  const verifier = b64url(crypto.randomBytes(32)); const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const { code, redirect } = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>PortalFirma Studio</title><body style="font:16px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:90vh;color:#1b1f2a"><div style="text-align:center"><h2>${ok ? 'Listo: Google Drive quedó conectado' : 'No se pudo conectar'}</h2><p>Ya puedes cerrar esta pestaña y volver a PortalFirma Studio.</p></div>`);
      clearTimeout(timer); srv.close();
      if (ok) resolve({ code: u.searchParams.get('code'), redirect: `http://127.0.0.1:${port}` });
      else reject(new Error(u.searchParams.get('error') === 'access_denied' ? 'No se autorizó el acceso a Google Drive.' : 'Google no devolvió la autorización.'));
    });
    let port = 0;
    const timer = setTimeout(() => { srv.close(); reject(new Error('Se acabó el tiempo para autorizar en el navegador. Intenta de nuevo.')); }, 5 * 60 * 1000);
    srv.listen(0, '127.0.0.1', () => {
      port = srv.address().port;
      const q = new URLSearchParams({ client_id: c.id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPE + ' openid email', code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'select_account consent' });
      shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + q);
    });
  });
  const t = await post('https://oauth2.googleapis.com/token', { client_id: c.id, client_secret: c.secret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
  let email = '';
  try { email = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64').toString()).email || ''; } catch {}
  store.setSecret('gdrive', { refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000, email, scope: SCOPE });
  return status();
}
function disconnect() {
  const tok = store.getSecret('gdrive');
  if (tok?.refresh) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tok.refresh), { method: 'POST' }).catch(() => {});
  store.setSecret('gdrive', undefined); store.set('gdriveMock', undefined);
  return status();
}
async function accessToken() {
  const tok = store.getSecret('gdrive'); if (!tok?.refresh || tok.scope !== SCOPE) { const e = new Error('Conecta tu cuenta de Google Drive.'); e.code = 'NO_DRIVE'; throw e; }
  if (tok.access && tok.exp > Date.now()) return tok.access;
  const c = client();
  try {
    const t = await post('https://oauth2.googleapis.com/token', { client_id: c.id, client_secret: c.secret, refresh_token: tok.refresh, grant_type: 'refresh_token' });
    tok.access = t.access_token; tok.exp = Date.now() + (t.expires_in - 60) * 1000; store.setSecret('gdrive', tok);
    return tok.access;
  } catch (e) {
    if (/invalid_grant/i.test(e.message)) { store.setSecret('gdrive', undefined); const x = new Error('Google cerró la conexión. Vuelve a conectar Google Drive.'); x.code = 'NO_DRIVE'; throw x; }
    throw e;
  }
}
async function api(pathq, { raw } = {}) {
  const r = await fetch('https://www.googleapis.com/drive/v3/' + pathq, { headers: { Authorization: 'Bearer ' + await accessToken() } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error?.message ? 'Google Drive: ' + j.error.message : `Google Drive respondió con error ${r.status}`); }
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

// Documentos que sirven como plantilla: Google Docs, Word y PDF
// Carpetas y documentos (modo demostración)
const FOLDER = 'application/vnd.google-apps.folder';
const MOCK_FILES = [
  { id: 'm1', name: 'Contrato de arriendo (modelo)', mimeType: MIME.gdoc, modifiedTime: '2026-09-30T14:00:00Z', owner: 'prueba@gmail.com', parent: 'root' },
  { id: 'm2', name: 'Contrato de servicios.docx', mimeType: MIME.docx, modifiedTime: '2026-09-21T10:00:00Z', size: '21576', owner: 'prueba@gmail.com', parent: 'root' },
  { id: 'm3', name: 'Contrato prueba.pdf', mimeType: MIME.pdf, modifiedTime: '2026-08-02T10:00:00Z', size: '13624', owner: 'prueba@gmail.com', parent: 'root' },
  { id: 'f1', name: 'Contratos octubre', mimeType: FOLDER, modifiedTime: '2026-10-01T10:00:00Z', owner: 'prueba@gmail.com', parent: 'root' },
  ...[1, 2, 3, 4, 5].map((i) => ({ id: 'm1' + i, name: `Arriendo depto ${i}.pdf`, mimeType: MIME.pdf, modifiedTime: `2026-10-0${i}T10:00:00Z`, size: '13624', owner: 'prueba@gmail.com', parent: 'f1' })),
  { id: 'm20', name: 'Mandato compartido.docx', mimeType: MIME.docx, modifiedTime: '2026-09-11T10:00:00Z', size: '21576', owner: 'Estudio Jurídico', parent: 'shared', shared: true },
];
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
// Lista una carpeta («root» = Mi unidad), lo compartido conmigo o una búsqueda en todo el Drive.
// Devuelve carpetas primero y solo documentos que sirven (Google Docs, Word, PDF).
async function list(opts = {}) {
  if (typeof opts === 'string') opts = { search: opts };
  const { search = '', folder = 'root', scope = 'mine', pageToken = '' } = opts;
  const s = String(search || '').trim();
  if (MOCK) {
    const all = MOCK_FILES.filter((f) => (s ? f.mimeType !== FOLDER && f.name.toLowerCase().includes(s.toLowerCase()) : scope === 'shared' ? f.shared : f.parent === folder));
    return { files: all.sort((x, y) => (x.mimeType === FOLDER) === (y.mimeType === FOLDER) ? 0 : x.mimeType === FOLDER ? -1 : 1), next: '' };
  }
  const types = [...Object.values(MIME), ...(s ? [] : [FOLDER])].map((m) => `mimeType='${m}'`).join(' or ');
  let q = `(${types}) and trashed=false`;
  if (s) q += ` and name contains '${esc(s)}'`;
  else if (scope === 'shared') q += ' and sharedWithMe';
  else q += ` and '${esc(folder || 'root')}' in parents`;
  const p = new URLSearchParams({ q, orderBy: 'folder,modifiedTime desc', pageSize: '60', fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,owners(displayName,emailAddress))', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  if (pageToken) p.set('pageToken', pageToken);
  const j = await api('files?' + p);
  return { files: (j.files || []).map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: f.size, owner: f.owners?.[0]?.displayName || '' })), next: j.nextPageToken || '' };
}
// Todos los documentos de una carpeta (para «enviar toda la carpeta a firmar»), sin entrar a subcarpetas
async function listFolderDocs(folder) {
  const out = []; let page = '';
  do { const r = await list({ folder, pageToken: page }); out.push(...r.files.filter((f) => f.mimeType !== FOLDER)); page = r.next; } while (page && out.length < 500);
  return out;
}
// Descarga el archivo a una carpeta temporal (Google Docs se exportan a PDF, con su formato)
async function download(id) {
  let meta; let bytes;
  if (MOCK) {
    meta = MOCK_FILES.find((f) => f.id === id); if (!meta) throw new Error('Archivo no encontrado.');
    const fx = path.join(__dirname, '..', 'test', 'fixtures', meta.mimeType === MIME.docx ? 'contrato.docx' : 'contrato_prueba.pdf');
    bytes = fs.readFileSync(fx); if (/pdf$/.test(fx)) bytes = Buffer.concat([bytes, Buffer.from('\n%' + id + '\n')]); // cada archivo de prueba distinto
  } else {
    meta = await api(`files/${encodeURIComponent(id)}?fields=id,name,mimeType,size&supportsAllDrives=true`);
    if (Number(meta.size) > 40 * 1024 * 1024) throw new Error('El archivo pesa más de 40 MB.');
    bytes = meta.mimeType === MIME.gdoc
      ? await api(`files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(MIME.pdf)}`, { raw: true })
      : await api(`files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { raw: true });
  }
  const ext = meta.mimeType === MIME.docx ? '.docx' : meta.mimeType === MIME.doc ? '.doc' : '.pdf';
  const base = String(meta.name).replace(/\.(docx?|pdf)$/i, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 90) || 'Documento';
  const dir = path.join(tmpDir(), 'drive-' + Date.now()); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, base + ext); fs.writeFileSync(file, bytes);
  return file;
}

// Cargar la credencial desde el archivo JSON que entrega Google Cloud (sin recompilar la app)
function setClientFile(file) {
  let j; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('El archivo no es un JSON válido.'); }
  const c = j.installed || j;
  if (!c.client_id || !/\.apps\.googleusercontent\.com$/.test(c.client_id)) throw new Error('El archivo no es una credencial OAuth de Google («App de escritorio»).');
  if (!j.installed) throw new Error('La credencial debe ser de tipo «App de escritorio» (en Google Cloud: Clientes → Crear cliente → App de escritorio).');
  if (!j.picker?.api_key || !j.picker?.app_id) throw new Error('Al archivo le falta la sección «picker» (clave de API del selector y número del proyecto).');
  store.set('gdriveClient', { id: c.client_id, secret: c.client_secret || '', picker: j.picker }); clientCache = undefined;
  return status();
}

// ---------- Selector de Google (Picker) ----------
// Se abre en el NAVEGADOR del usuario (donde ya tiene su sesión de Google), con una página servida en
// 127.0.0.1. Dentro de una ventana de la app Google pide iniciar sesión de nuevo y bloquea el acceso,
// por eso no se usa una ventana propia. La página devuelve a la app solo los archivos elegidos.
const PICK_MIME = [MIME.pdf, MIME.docx, MIME.doc, MIME.gdoc];
let picking = null;
async function pick(parent, { multi = true, folders = false } = {}) {
  if (MOCK) throw new Error('El selector de Google no está disponible en modo de prueba.');
  const c = client(); if (!c?.picker) throw new Error('La integración con Google Drive no está configurada en esta versión.');
  if (picking) { picking.reopen(); throw Object.assign(new Error('El selector de Google Drive ya está abierto en tu navegador.'), { silent: true }); }
  const token = await accessToken();
  const nonce = b64url(crypto.randomBytes(18));
  return new Promise((resolve, reject) => {
    let done = false; let url = '';
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); setTimeout(() => { try { srv.close(); } catch {} }, 1500); picking = null; err ? reject(err) : resolve(val); };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && u.pathname === `/p/${nonce}`) {
        if (done) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><p style="font:16px sans-serif;padding:40px">Esta selección ya terminó. Puedes cerrar esta pestaña.</p>'); }
        const cfg = { token, key: c.picker.api_key, appId: String(c.picker.app_id), multi, folders, origin: `http://127.0.0.1:${srv.address().port}`, mimes: [...PICK_MIME, ...(folders ? [FOLDER] : [])].join(','), ret: `/r/${nonce}` };
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(pickerHtml(cfg));
      }
      if (req.method === 'POST' && u.pathname === `/r/${nonce}`) {
        let body = ''; req.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
        req.on('end', () => {
          res.writeHead(204); res.end();
          let j = {}; try { j = JSON.parse(body); } catch {}
          if (j.error) return finish(new Error(j.error));
          finish(null, j.ok ? (j.docs || []).map((d) => ({ id: String(d.id), name: String(d.name || 'Documento'), mimeType: String(d.mimeType || ''), isFolder: d.mimeType === FOLDER })) : []);
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    const timer = setTimeout(() => finish(null, []), 15 * 60 * 1000);
    srv.listen(0, '127.0.0.1', () => {
      url = `http://127.0.0.1:${srv.address().port}/p/${nonce}`;
      picking = { cancel: () => finish(null, []), reopen: () => shell.openExternal(url) };
      shell.openExternal(url).catch((e) => finish(new Error('No se pudo abrir el navegador: ' + e.message)));
    });
  });
}
const cancelPick = () => { if (picking) picking.cancel(); return true; };
const reopenPick = () => { if (picking) picking.reopen(); return !!picking; };
function pickerHtml(cfg) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Elegir de Google Drive</title>
<style>html,body{margin:0;height:100%;font:15px -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f2a;background:#f6f7fb}#bar{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:#fff;border-bottom:1px solid #e3e6ef;z-index:1}#bar b{color:#3550e0}#bar button{font:inherit;padding:8px 16px;border-radius:9px;border:1px solid #d5d9e4;background:#fff;cursor:pointer}#msg{position:fixed;inset:52px 0 0;display:grid;place-items:center;text-align:center;padding:30px;font-size:17px}</style></head>
<body><div id="bar"><span><b>PortalFirma Studio</b> · Elige tus documentos de Google Drive</span><button id="cancel">Cancelar</button></div><div id="msg">Abriendo Google Drive…</div>
<script>
const CFG = ${JSON.stringify(cfg).replace(/</g, '\\u003c')};
let sent = false;
function send(r) {
  if (sent) return; sent = true;
  fetch(CFG.ret, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) }).catch(() => {});
  document.getElementById('cancel').style.display = 'none';
  document.getElementById('msg').innerHTML = r.error ? r.error : r.ok ? '✔ Listo. Ya puedes volver a <b>PortalFirma Studio</b>.<br><small style="color:#666">Esta pestaña se puede cerrar.</small>' : 'Selección cancelada. Puedes cerrar esta pestaña.';
  setTimeout(() => { try { window.close(); } catch (e) {} }, 1200);
}
document.getElementById('cancel').onclick = () => send({ ok: false });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') send({ ok: false }); });
function init() {
  gapi.load('picker', { callback: () => {
    try {
      const P = google.picker;
      const lab = (v, t) => (typeof v.setLabel === 'function' ? v.setLabel(t) : v);
      const mine = lab(new P.DocsView(P.ViewId.DOCS).setParent('root').setIncludeFolders(true).setSelectFolderEnabled(CFG.folders).setMimeTypes(CFG.mimes), 'Mi unidad');
      const shared = lab(new P.DocsView(P.ViewId.DOCS).setOwnedByMe(false).setIncludeFolders(true).setSelectFolderEnabled(CFG.folders).setMimeTypes(CFG.mimes), 'Compartido conmigo');
      const drives = lab(new P.DocsView(P.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true).setSelectFolderEnabled(CFG.folders).setMimeTypes(CFG.mimes), 'Unidades compartidas');
      const recent = lab(new P.DocsView(P.ViewId.DOCS).setMimeTypes(CFG.mimes), 'Buscar en todo');
      const b = new P.PickerBuilder().addView(mine).addView(shared).addView(drives).addView(recent)
        .setOAuthToken(CFG.token).setDeveloperKey(CFG.key).setAppId(CFG.appId).setOrigin(CFG.origin).setLocale('es')
        .setTitle(CFG.multi ? 'Elige uno o varios documentos (PDF, Word o Google Docs)' : 'Elige un documento (PDF, Word o Google Docs)')
        .enableFeature(P.Feature.SUPPORT_DRIVES).setSize(Math.max(600, innerWidth - 40), Math.max(420, innerHeight - 100))
        .setCallback((d) => { if (d.action === P.Action.PICKED) send({ ok: true, docs: d.docs.map((x) => ({ id: x.id, name: x.name, mimeType: x.mimeType })) }); else if (d.action === P.Action.CANCEL) send({ ok: false }); });
      if (CFG.multi) b.enableFeature(P.Feature.MULTISELECT_ENABLED);
      b.build().setVisible(true);
      document.getElementById('msg').textContent = '';
    } catch (e) { send({ error: 'Google Drive: ' + e.message }); }
  }, onerror: () => send({ error: 'No se pudo cargar el selector de Google Drive. Revisa tu conexión a internet.' }) });
}
</script><script src="https://apis.google.com/js/api.js" onload="init()" onerror="send({ error: 'No se pudo cargar el selector de Google Drive. Revisa tu conexión a internet.' })"></script></body></html>`;
}

// ---------- Carpetas que crea la app (expedientes) ----------
// Con el permiso «drive.file» la app tiene acceso completo a las carpetas y archivos que ella misma crea.
const MOCK_DIR = () => { const d = path.join(tmpDir(), 'drive-prueba'); fs.mkdirSync(d, { recursive: true }); return d; };
async function apiJson(method, url, body, headers = {}) {
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await accessToken(), ...headers }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message ? 'Google Drive: ' + j.error.message : `Google Drive respondió con error ${r.status}`);
  return j;
}
async function createFolder(name, parent) {
  if (MOCK) { const id = 'mf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); fs.mkdirSync(path.join(MOCK_DIR(), id), { recursive: true }); return { id, name }; }
  const j = await apiJson('POST', 'https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true', JSON.stringify({ name, mimeType: FOLDER, parents: parent ? [parent] : undefined }), { 'content-type': 'application/json' });
  return { id: j.id, name: j.name };
}
async function children(folderId) {
  if (MOCK) {
    const d = path.join(MOCK_DIR(), folderId); if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => !f.startsWith('.')).map((f) => { const st = fs.statSync(path.join(d, f)); return { id: folderId + '/' + f, name: f, size: st.size, modifiedTime: st.mtime.toISOString(), mimeType: '' }; });
  }
  const out = []; let page = '';
  do {
    const p = new URLSearchParams({ q: `'${esc(folderId)}' in parents and trashed=false and mimeType!='${FOLDER}'`, fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)', pageSize: '200', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    if (page) p.set('pageToken', page);
    const j = await api('files?' + p); out.push(...(j.files || [])); page = j.nextPageToken || '';
  } while (page && out.length < 2000);
  return out;
}
async function upload(folderId, name, bytes, mimeType = 'application/octet-stream') {
  if (MOCK) { fs.writeFileSync(path.join(MOCK_DIR(), folderId, name), bytes); return { id: folderId + '/' + name, name }; }
  const boundary = 'pf' + crypto.randomBytes(8).toString('hex');
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--`)]);
  return apiJson('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name&supportsAllDrives=true', body, { 'content-type': `multipart/related; boundary=${boundary}` });
}
async function trash(fileId) {
  if (MOCK) { try { fs.unlinkSync(path.join(MOCK_DIR(), fileId)); } catch {} return true; }
  await apiJson('PATCH', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, JSON.stringify({ trashed: true }), { 'content-type': 'application/json' });
  return true;
}
// Descarga cualquier archivo (también imágenes) conservando su nombre
async function downloadAny(id, name) {
  const dir = path.join(tmpDir(), 'exp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, String(name || 'archivo').replace(/[\\/:*?"<>|]+/g, '-'));
  if (MOCK) { fs.copyFileSync(path.join(MOCK_DIR(), id), file); return file; }
  const meta = await api(`files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`);
  const bytes = meta.mimeType === MIME.gdoc ? await api(`files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(MIME.pdf)}`, { raw: true }) : await api(`files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { raw: true });
  const f2 = meta.mimeType === MIME.gdoc ? file.replace(/(\.[^.]+)?$/, '.pdf') : file;
  fs.writeFileSync(f2, bytes); return f2;
}
const folderUrl = (id) => (MOCK ? path.join(MOCK_DIR(), id) : `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`);

module.exports = { createFolder, children, upload, trash, downloadAny, folderUrl, pick, cancelPick, reopenPick, listFolderDocs, FOLDER, setClientFile, status, connect, disconnect, list, download };
