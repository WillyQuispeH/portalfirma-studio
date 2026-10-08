const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const { openForEditor, EXTENSIONS, tmpDir, htmlToPdf } = require('./convert');
const ai = require('./ai');
const updater = require('./updater');
const pf = process.env.PF_MOCK === '1' ? require('./mock') : require('./portalfirma');

const MAX_BYTES = 20 * 1024 * 1024; // límite del conector (~20 MB)
const APP_NAME = 'PortalFirma Studio';
app.setName(APP_NAME);
let win = null;
let pendingFiles = []; // archivos abiertos antes de que la ventana esté lista
let docState = { name: '', dirty: false, hasDoc: false, dirtyNames: [] };
let quitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 980, minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#f6f7fb',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => { if (pendingFiles.length) { openInEditor(pendingFiles); pendingFiles = []; } });
  win.on('close', (e) => { // aviso de cambios sin guardar
    const names = docState.dirtyNames?.length ? docState.dirtyNames : (docState.dirty ? [docState.name] : []);
    if (!names.length || win.__forceClose) return;
    e.preventDefault();
    const many = names.length > 1;
    const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: [many ? 'Guardar todo' : 'Guardar', 'Cancelar', 'No guardar'], defaultId: 0, cancelId: 1,
      message: many ? `Hay ${names.length} documentos con cambios sin guardar` : `¿Guardar los cambios de «${names[0]}»?`,
      detail: (many ? names.map((n) => '• ' + n).join('\n') + '\n\n' : '') + 'Si no guardas, se perderán los cambios.' });
    if (r === 0) win.webContents.send('menu', 'saveAndClose');
    if (r === 2) { win.__forceClose = true; win.close(); }
    if (r === 1) quitting = false;
  });
  buildMenu();
  // Los enlaces externos se abren en el navegador del sistema.
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function readDoc(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.pdf', '.docx'].includes(ext)) throw new Error('Solo se aceptan archivos PDF o DOCX.');
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) throw new Error('El archivo supera los 20 MB permitidos.');
  return { name: path.basename(filePath), size: stat.size, path: filePath };
}
const SUPPORTED = new RegExp(`\\.(${EXTENSIONS.join('|')})$`, 'i');
function openInEditor(paths) { win.webContents.send('open-in-editor', paths); }

// Mac: arrastrar al ícono del Dock o "Abrir con…" → se abre en el editor
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (win && !win.webContents.isLoading()) openInEditor([filePath]); else pendingFiles.push(filePath);
});
// Windows: el archivo llega como argumento
pendingFiles.push(...process.argv.slice(1).filter((a) => SUPPORTED.test(a)));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => {
  const f = argv.filter((a) => SUPPORTED.test(a));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f.length) openInEditor(f); }
});

app.whenReady().then(() => { createWindow(); updater.init(() => win); });
app.on('before-quit', () => { quitting = true; });

// ---- Menú nativo ----
const send = (action, arg) => () => win?.webContents.send('menu', action, arg);
function recents() { return (store.get('recent') || []).filter((r) => r && r.path); }
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const rec = recents().slice(0, 12);
  const template = [
    ...(isMac ? [{ label: APP_NAME, submenu: [{ role: 'about', label: `Acerca de ${APP_NAME}` }, { type: 'separator' }, { role: 'hide', label: 'Ocultar' }, { role: 'hideOthers', label: 'Ocultar otros' }, { type: 'separator' }, { role: 'quit', label: 'Salir' }] }] : []),
    { label: 'Archivo', submenu: [
      { label: 'Inicio', accelerator: 'CmdOrCtrl+Shift+H', click: send('home') },
      { type: 'separator' },
      { label: 'Crear PDF…', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Abrir reciente', submenu: rec.length ? [...rec.map((r) => ({ label: r.name, click: send('openRecent', r.path) })), { type: 'separator' }, { label: 'Borrar lista', click: () => { store.set('recent', []); buildMenu(); win?.webContents.send('recent-changed'); } }] : [{ label: 'Sin documentos recientes', enabled: false }] },
      { label: 'Combinar archivos…', accelerator: 'CmdOrCtrl+Shift+M', click: send('combine') },
      { label: 'Convertir a PDF (Word, Excel, imágenes)…', click: send('convert') },
      { type: 'separator' },
      { label: 'Guardar', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
      { label: 'Exportar', submenu: [
        { label: 'Word (.docx)…', click: send('export', 'docx') },
        { label: 'Imágenes PNG…', click: send('export', 'png') },
        { label: 'Imágenes JPG…', click: send('export', 'jpg') },
        { label: 'Texto (.txt)…', click: send('export', 'txt') },
      ] },
      { type: 'separator' },
      { label: 'Imprimir…', accelerator: 'CmdOrCtrl+P', click: send('print') },
      { type: 'separator' },
      { label: 'Crear plantilla con este documento…', click: send('tplDesign') },
      { label: 'Mis plantillas…', click: send('tplList') },
      { type: 'separator' },
      { label: 'Firmar plano arquitectónico…', click: send('plan') },
      { label: 'Enviar a firmar…', accelerator: 'CmdOrCtrl+Enter', click: send('send') },
      { type: 'separator' },
      { label: 'Cerrar documento', accelerator: 'CmdOrCtrl+W', click: send('close') },
      ...(isMac ? [] : [{ role: 'quit', label: 'Salir' }]),
    ] },
    { label: 'Edición', submenu: [{ role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' }, { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
      { type: 'separator' },
      { label: 'Buscar…', accelerator: 'CmdOrCtrl+F', click: send('find') },
      { label: 'Buscar siguiente', accelerator: 'CmdOrCtrl+G', click: send('findNext') },
      { label: 'Buscar anterior', accelerator: 'CmdOrCtrl+Shift+G', click: send('findPrev') }] },
    { label: 'Herramientas', submenu: [
      { label: 'Editar texto', accelerator: 'CmdOrCtrl+E', click: send('tool', 'edittext') },
      { label: 'Agregar texto', accelerator: 'CmdOrCtrl+T', click: send('tool', 'text') },
      { label: 'Agregar imagen', click: send('tool', 'image') },
      { label: 'Tapar', click: send('tool', 'whiteout') },
      { type: 'separator' },
      { label: 'Reconocer texto (OCR)…', accelerator: 'CmdOrCtrl+Shift+R', click: send('ocr') },
      { label: 'Comprimir PDF', click: send('compress') },
      { label: 'Dividir PDF…', click: send('split') },
      { label: 'Numerar páginas…', click: send('number') },
      { label: 'Marca de agua…', click: send('watermark') },
    ] },
    { label: 'Ver', submenu: [
      { label: 'Acercar', accelerator: 'CmdOrCtrl+Plus', click: send('zoom', 1) },
      { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: send('zoom', -1) },
      { label: 'Tamaño ajustado', accelerator: 'CmdOrCtrl+0', click: send('zoom', 0) },
      { type: 'separator' },
      { label: 'Pantalla completa (modo lectura)', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: send('fullscreen') },
      { type: 'separator' },
      { label: 'Pestaña siguiente', accelerator: 'Ctrl+Tab', click: send('nextTab') },
      { label: 'Pestaña anterior', accelerator: 'Ctrl+Shift+Tab', click: send('prevTab') },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
    ] },
    { role: 'windowMenu', label: 'Ventana' },
    { label: 'Ayuda', submenu: [{ label: 'Conexión directa con Portalfirma (diagnóstico)…', click: send('apiDiag') }, { type: 'separator' }, { label: 'Buscar actualizaciones…', click: () => updater.checkManual() }, { label: `Versión ${app.getVersion()}`, enabled: false }, { type: 'separator' }, { label: 'Portalfirma', click: () => shell.openExternal('https://www.portalfirma.cl') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function addRecent(p) {
  if (!p || !fs.existsSync(p)) return;
  const list = recents().filter((r) => r.path !== p);
  list.unshift({ path: p, name: path.basename(p), date: new Date().toISOString(), size: fs.statSync(p).size });
  store.set('recent', list.slice(0, 500)); app.addRecentDocument(p); buildMenu();
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---- IPC: cada handler devuelve {ok, data} o {ok:false, error, code} ----
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) {
      let msg = e.message || String(e);
      if (/MCP error -32602|Input validation error/i.test(msg)) msg = 'Portalfirma rechazó los datos de la consulta (formato inválido).'; // no mostrar el error técnico completo
      else if (/MCP error -?\d+/i.test(msg)) msg = 'Portalfirma no respondió correctamente. Intenta de nuevo en unos minutos.';
      return { ok: false, error: msg, code: e.code, data: e.data };
    }
  });
}

ipcMain.on('cfg:sync', (e) => { e.returnValue = { version: app.getVersion(), noTours: process.env.PF_NO_TOURS === '1' || (process.env.PF_MOCK === '1' && process.env.PF_TOURS !== '1') }; });
let lastSession = null;
const remember = (s) => { lastSession = s; return s; };
handle('auth:restore', async () => remember(await pf.tryRestore()));
handle('auth:login', async () => remember(await pf.login()));
handle('auth:logout', async () => { lastSession = null; return pf.logout(); });
handle('auth:session', async () => remember(await pf.session()));

// ---- Editor PDF ----
handle('editor:pick', async (multi) => {
  const r = await dialog.showOpenDialog(win, { properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'Documentos e imágenes', extensions: EXTENSIONS }] });
  return r.canceled ? [] : r.filePaths;
});
handle('editor:open', (p) => openForEditor(p));
handle('editor:save', async (bytes, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), suggested || 'documento.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});
handle('editor:saveTo', (p, bytes) => { fs.writeFileSync(p, Buffer.from(bytes)); addRecent(p); return p; });
handle('editor:saveAs', async (bytes, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), (suggested || 'documento').replace(/\.[^.]+$/, '') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes)); addRecent(r.filePath);
  return r.filePath;
});
handle('editor:chooseDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Guardar aquí' });
  return r.canceled ? null : r.filePaths[0];
});
handle('editor:writeFile', (dir, name, bytes) => { const f = path.join(dir, name.replace(/[\\/:*?"<>|]/g, '-')); fs.writeFileSync(f, Buffer.from(bytes)); return f; });
handle('editor:saveText', async (txt, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), suggested), filters: [{ name: 'Texto', extensions: ['txt'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, txt, 'utf8'); return r.filePath;
});
handle('editor:exportDocx', async (pages, families, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), suggested), filters: [{ name: 'Word', extensions: ['docx'] }] });
  if (r.canceled || !r.filePath) return null;
  const { Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak } = require('docx');
  const AL = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
  const children = [];
  pages.forEach((pg, pi) => {
    pg.paragraphs.forEach((pa, k) => {
      const runs = [];
      for (const r2 of pa.runs) r2.text.split('\n').forEach((t, n) => { if (n) runs.push(new TextRun({ break: 1 })); if (t) runs.push(new TextRun({ text: t, bold: !!r2.bold, italics: !!r2.italic, underline: r2.underline ? {} : undefined, size: Math.round((r2.size || 11) * 2), font: families[r2.family] || 'Arial' })); });
      if (pi > 0 && k === 0) runs.unshift(new PageBreak());
      children.push(new Paragraph({ children: runs, alignment: AL[pa.align] || AlignmentType.LEFT, spacing: { after: 120 } }));
    });
    if (!pg.paragraphs.length && pi > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
  });
  const doc = new Document({ creator: APP_NAME, sections: [{ children }] });
  fs.writeFileSync(r.filePath, await Packer.toBuffer(doc));
  return r.filePath;
});
handle('recent:list', () => recents().map((r) => ({ ...r, exists: fs.existsSync(r.path) })));
handle('recent:add', (p) => { addRecent(p); return true; });
handle('recent:remove', (p) => { store.set('recent', recents().filter((r) => r.path !== p)); buildMenu(); return true; });
handle('recent:clear', () => { store.set('recent', []); buildMenu(); return true; });
handle('doc:state', (st) => {
  docState = { ...docState, ...st };
  if (win) { win.setTitle(st.hasDoc ? `${st.name}${st.dirty ? ' •' : ''} — ${APP_NAME}` : APP_NAME); win.setDocumentEdited?.(!!st.dirty); if (st.path) win.setRepresentedFilename?.(st.path); }
  return true;
});
// ---- Asistente legal (IA) ----
handle('ai:status', () => ai.status());
handle('ai:config', (p) => ai.setConfig(p || {}));
handle('ai:models', () => ai.models());
handle('ai:chat', (req) => { if (!lastSession) { const e = new Error('El asistente legal es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta.'); e.code = 'NEEDS_ACCOUNT'; throw e; } return ai.chat(req || {}); });
const gdrive = require('./gdrive');
handle('gdrive:status', () => gdrive.status());
handle('gdrive:connect', () => gdrive.connect());
handle('gdrive:setClient', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Credencial OAuth de Google (JSON)', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return gdrive.setClientFile(r.filePaths[0]);
});
handle('gdrive:disconnect', () => gdrive.disconnect());
handle('gdrive:list', (opts) => gdrive.list(opts || {}));
handle('gdrive:folderDocs', (id) => gdrive.listFolderDocs(id));
handle('gdrive:download', (id) => gdrive.download(id));
handle('gdrive:pick', async (opts) => {
  try { return await gdrive.pick(win, opts || {}); }
  finally { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (process.platform === 'darwin') app.focus({ steal: true }); } } // vuelve a Studio al terminar en el navegador
});
handle('gdrive:pickCancel', () => gdrive.cancelPick());
handle('gdrive:pickReopen', () => gdrive.reopenPick());
handle('ai:wallet', () => ai.walletStatus());
handle('ai:redeem', (code) => ai.redeem(code));
handle('ai:draftPdf', async (html, name) => {
  const pdf = await htmlToPdf(`<style>@page{size:Letter;margin:2.5cm 2.5cm}body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;text-align:justify}h1{font-size:14pt;text-align:center;margin:0 0 18pt}h2{font-size:12pt;margin:14pt 0 6pt}p{margin:0 0 9pt}.ph{white-space:nowrap}.leyenda{margin-top:18pt;font-size:10.5pt;font-style:italic}</style>${html}`);
  const file = path.join(tmpDir(), String(name || 'Borrador').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 90) + '.pdf');
  fs.writeFileSync(file, pdf); return { file, bytes: new Uint8Array(pdf) };
});

// ---- Mis plantillas (biblioteca local: un PDF con la definición incrustada + una ficha .json) ----
const tplDir = () => { const d = path.join(app.getPath('userData'), 'plantillas'); fs.mkdirSync(d, { recursive: true }); return d; };
const safeName = (n) => String(n || 'Plantilla').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Plantilla';
handle('plantillas:list', () => fs.readdirSync(tplDir()).filter((f) => f.endsWith('.json')).map((f) => {
  try { const m = JSON.parse(fs.readFileSync(path.join(tplDir(), f), 'utf8')); const pdf = path.join(tplDir(), f.replace(/\.json$/, '.pdf')); return fs.existsSync(pdf) ? { ...m, file: pdf } : null; } catch { return null; }
}).filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated))));
handle('plantillas:exists', (name) => fs.existsSync(path.join(tplDir(), safeName(name) + '.pdf')));
handle('plantillas:save', (name, bytes, meta) => {
  const base = path.join(tplDir(), safeName(name));
  fs.writeFileSync(base + '.pdf', Buffer.from(bytes));
  fs.writeFileSync(base + '.json', JSON.stringify({ ...meta, name: safeName(name), updated: new Date().toISOString() }, null, 1));
  return base + '.pdf';
});
handle('plantillas:read', (file) => { if (!file.startsWith(tplDir())) throw new Error('Ruta no permitida'); return new Uint8Array(fs.readFileSync(file)); });
handle('plantillas:delete', (file) => { if (!file.startsWith(tplDir())) throw new Error('Ruta no permitida'); for (const f of [file, file.replace(/\.pdf$/, '.json')]) try { fs.unlinkSync(f); } catch {} return true; });

handle('app:closeNow', () => { if (win) { win.__forceClose = true; win.close(); } return true; });

// Guarda una copia temporal para enviarla al flujo de firma (subir + detectar firmantes).
handle('editor:temp', (bytes, name) => {
  const file = path.join(tmpDir(), (name || 'documento.pdf').replace(/[\\/:*?"<>|]/g, '-').replace(/\.[^.]+$/, '') + '.pdf');
  fs.writeFileSync(file, Buffer.from(bytes));
  return readDoc(file);
});

// ---- Notaría virtual ----
handle('tpl:search', (q) => pf.templateSearch(q, 20));
handle('tpl:forms', (id) => pf.templateForms(id));
handle('tpl:send', async (id, values, name) => {
  const r = await pf.templateSend(id, values);
  const operation = r?.operation ?? r?.operationNumber ?? r?.data?.operation ?? findKey(r, /operation/i);
  const history = store.get('history') || [];
  history.unshift({ operation, name: name || 'Plantilla notarial', date: new Date().toISOString() });
  store.set('history', history.slice(0, 200));
  return { raw: r, operation };
});
handle('open:path', (p) => { shell.showItemInFolder(p); return true; });
handle('wallet:balance', () => pf.balance());
handle('wallet:topup', async (amount, email) => {
  const r = await pf.topUp(amount, email);
  const url = r?.url || r?.payment_url || r?.paymentUrl || findUrl(r);
  if (url) shell.openExternal(url);
  return r;
});

handle('file:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Documentos', extensions: ['pdf', 'docx'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDoc(r.filePaths[0]);
});
handle('file:check', (p) => readDoc(p));

// Paso 1+2: subir el documento y detectar firmantes (igual que el conector)
// Portalfirma recibe PDF: un Word se convierte antes de subirlo (el servidor falla al enviar un .docx).
async function asPdfForSigning(filePath) {
  if (!/\.docx$/i.test(filePath)) return { path: filePath };
  const r = await openForEditor(filePath);
  const out = path.join(tmpDir(), r.name.replace(/[\\/:*?"<>|]/g, '-'));
  fs.writeFileSync(out, Buffer.from(r.bytes));
  return { path: out, converted: 'Word', original: path.basename(filePath) };
}
handle('doc:analyze', async (originalPath) => {
  const conv = await asPdfForSigning(originalPath);
  const filePath = conv.path;
  const info = { ...readDoc(filePath), converted: conv.converted, original: conv.original };
  const b64 = fs.readFileSync(filePath).toString('base64');
  const ing = await pf.ingest(b64, info.name);
  if (!ing?.document_id) throw new Error(ing?.message || 'Portalfirma no devolvió el documento.');
  const ext = await pf.extractSigners(ing.document_id);
  return { file: info, ingest: ing, extract: ext };
});
handle('doc:reextract', (documentId, configId) => pf.extractSigners(documentId, configId));

// Paso 3: enviar a firmar
handle('doc:send', async (payload) => {
  const r = await pf.sendToSign(payload);
  const operation = r?.operation ?? r?.operationNumber ?? r?.numberOperation ?? findKey(r, /operation/i);
  // Sin número de operación y con un mensaje de error, el envío falló (aunque el servidor no lo marque como error).
  const msg = typeof r?.message === 'string' ? r.message : '';
  if (operation == null && /error|fall[oó]|failed|status code/i.test(msg)) {
    const code = /status code (\d+)/.exec(msg)?.[1];
    throw new Error(code ? `Portalfirma no pudo crear la operación (error ${code} del servidor). Revisa «Mis operaciones» antes de reintentar, para no duplicarla.` : msg);
  }
  const history = store.get('history') || [];
  history.unshift({ operation, name: payload.__fileName, date: new Date().toISOString() });
  store.set('history', history.slice(0, 200));
  return { raw: r, operation };
});

// ---- Mis operaciones sincronizadas con Portalfirma ----
const sync = require('./sync'); sync.init(pf, process.env.PF_MOCK === '1' && !process.env.PF_API_BASE ? null : require('./pfapi'));
handle('ops:status', () => sync.status());
handle('ops:setPhone', (p) => sync.setPhone(p));
handle('ops:sync', (full) => sync.sync({ full: !!full }));
handle('ops:list', () => sync.list());
handle('ops:detail', (n, refresh) => sync.detail(n, { refresh: !!refresh }));
handle('ops:file', async (n) => { const f = await sync.file(n); return { path: f, bytes: new Uint8Array(fs.readFileSync(f)) }; });
handle('ops:saveFile', async (n) => {
  const f = await sync.file(n);
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), path.basename(f)), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null; fs.copyFileSync(f, r.filePath); return r.filePath;
});
handle('ops:share', async (n) => {
  const f = await sync.file(n);
  if (process.platform === 'darwin') { const { ShareMenu } = require('electron'); new ShareMenu({ filePaths: [f] }).popup({ window: win }); return 'menu'; }
  shell.showItemInFolder(f); return 'folder';
});
handle('ops:fileKey', () => !!pf.fileKey());
handle('ops:setFileKey', (v) => pf.setFileKey(v));

// ---- API directa de Portalfirma (inicio de sesión local + diagnóstico) ----
const pfapi = require('./pfapi');
handle('api:login', (email, password) => pfapi.login(email, password));
handle('api:logout', () => { store.set('opsCache', undefined); return pfapi.logout(); });
handle('api:user', () => pfapi.user());
handle('api:wallet', async () => { const w = await pfapi.wallet(); return { amount: w?.amount ?? null }; });
handle('api:diag', async () => {
  const out = await pfapi.diagnostic();
  const name = `PortalFirma-diagnostico-API-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const dir = process.env.PF_DIAG_DIR || app.getPath('downloads');
  fs.writeFileSync(path.join(dir, name), JSON.stringify(out, null, 2));
  return { file: name, tests: out.tests.map((t) => ({ name: t.name, status: t.status, ok: t.ok, success: t.success })) };
});

// ---- Plazos y vencimientos ----
// ---- Escrituras y protocolizaciones ----
// Lee minutas (Word, texto) y documentos privados (PDF: el texto se extrae en la ventana con pdf.js).
// Escrituras: solo Word (todas sus variantes). Un PDF no siempre deja leer su texto con exactitud.
const W = require('./wordtext');
async function escrRead(file) {
  const ext = path.extname(file).toLowerCase(); const name = path.basename(file);
  if (!W.WORD_EXT.includes(ext)) throw new Error(`«${name}»: para escrituras sube la minuta en Word (.doc, .docx, .rtf u .odt). Los PDF no se aceptan porque su texto no siempre se puede leer con exactitud.`);
  const st = fs.statSync(file); if (st.size > 40 * 1024 * 1024) throw new Error(`«${name}» supera los 40 MB.`);
  const text = await W.wordText(file);
  const pdf = ext === '.docx' ? (await openForEditor(file)).bytes : await htmlToPdf(W.textToHtml(text)); // «cómo llegó»
  return { path: file, name, ext, text, raw: new Uint8Array(fs.readFileSync(file)), pdf: new Uint8Array(pdf) };
}
handle('escr:open', async (kind) => {
  const r = await dialog.showOpenDialog(win, { title: 'Abrir minuta (Word)', properties: ['openFile'], filters: [{ name: 'Word', extensions: W.WORD_EXT.map((e) => e.slice(1)) }] });
  if (r.canceled) return [];
  const out = []; for (const f of r.filePaths) out.push(await escrRead(f)); return out;
});
// Documentos privados (protocolización y reducción): se pide Word (lectura exacta). Si solo hay PDF o una
// foto/escaneo, la ventana lo lee con IA. Word se convierte también a PDF para adjuntarlo y contar hojas.
const PRIV_EXT = [...W.WORD_EXT.map((e) => e.slice(1)), 'pdf', 'jpg', 'jpeg', 'png', 'webp'];
async function privRead(file) {
  const ext = path.extname(file).toLowerCase(); const name = path.basename(file);
  if (!PRIV_EXT.includes(ext.slice(1))) throw new Error(`«${name}»: se acepta Word (.doc, .docx, .rtf, .odt), PDF o una imagen (JPG, PNG).`);
  if (fs.statSync(file).size > 40 * 1024 * 1024) throw new Error(`«${name}» supera los 40 MB.`);
  if (W.WORD_EXT.includes(ext)) {
    const text = await W.wordText(file); const raw = fs.readFileSync(file);
    const pdf = ext === '.docx' ? (await openForEditor(file)).bytes : await htmlToPdf(W.textToHtml(text));
    return { path: file, name, kind: 'word', text, bytes: new Uint8Array(pdf), raw: new Uint8Array(raw) };
  }
  const r = await openForEditor(file);
  return { path: file, name, kind: r.kind, mime: r.mime || 'application/pdf', bytes: new Uint8Array(r.bytes) };
}
handle('escr:openPriv', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Documento privado (de preferencia en Word)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Word', extensions: W.WORD_EXT.map((e) => e.slice(1)) }, { name: 'PDF o imagen (se lee con IA)', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }] });
  if (r.canceled) return []; const out = []; for (const f of r.filePaths) out.push(await privRead(f)); return out;
});
handle('escr:readPriv', async (paths) => { const out = []; for (const f of paths) out.push(await privRead(f)); return out; });
// Lectura con IA de un PDF o una imagen (incluida en el valor del trámite: no descuenta tokens)
handle('ai:leerDoc', (args) => ai.leerDocumento(args));
handle('escr:read', async (paths) => { const out = []; for (const f of paths) out.push(await escrRead(f)); return out; });
handle('escr:cfg', () => store.get('escrNotaria') || null);
handle('escr:setCfg', (c) => { store.set('escrNotaria', c); return true; });
handle('escr:saveDocx', async (kind, data, notaria, suggested) => {
  const X = require('./escrituras-docx');
  const buf = kind === 'caratula' ? await X.caratulaDocx(data, notaria) : await X.escrituraDocx(data, notaria);
  if (process.env.PF_SAVE_DIR) { const f = path.join(process.env.PF_SAVE_DIR, suggested); fs.writeFileSync(f, buf); return f; }
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), suggested), filters: [{ name: 'Word', extensions: ['docx'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, buf); return r.filePath;
});
handle('escr:docxBytes', async (kind, data, notaria) => { const X = require('./escrituras-docx'); return new Uint8Array(kind === 'caratula' ? await X.caratulaDocx(data, notaria) : await X.escrituraDocx(data, notaria)); });
handle('escr:savePdf', async (bytes, suggested) => {
  if (process.env.PF_SAVE_DIR) { const f = path.join(process.env.PF_SAVE_DIR, suggested); fs.writeFileSync(f, Buffer.from(bytes)); return f; }
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), suggested), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes)); addRecent(r.filePath); return r.filePath;
});

// ---- Trámites notariales: pago e inicio (Portalfirma como puente con la notaría) ----
const notarias = require('./notarias');
handle('not:saldo', () => notarias.saldo(pfapi));
handle('not:list', () => notarias.list());
handle('not:tarifas', () => notarias.tarifas(pfapi));
handle('not:archivo', (op, name) => notarias.archivo(op, name));
handle('not:red', () => notarias.red(pfapi));
handle('not:iniciar', (payload, files) => notarias.iniciar(pfapi, payload, files));
// Agente Portalfirma: conversa y usa todas las herramientas del MCP con la sesión de Studio
const agente = require('./agente').crear({ pf, ai: require('./ai'), emit: (e) => win?.webContents.send('agent:event', e) });
if (process.env.PF_MOCK === '1') global.__agente = agente;
handle('agent:send', (texto) => agente.enviar(texto, { email: store.get('payerEmail') || '' }));
handle('agent:confirm', (id, r) => agente.responder(id, r));
handle('agent:attach', (name, bytes) => agente.adjuntar(String(name), bytes));
handle('agent:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF o Word', extensions: ['pdf', 'docx', 'doc'] }] });
  if (r.canceled) return null; let l = null; for (const f of r.filePaths) l = agente.adjuntar(path.basename(f), fs.readFileSync(f)); return l;
});
handle('agent:unattach', (name) => agente.quitar(String(name)));
handle('agent:reset', () => agente.reiniciar());
handle('agent:tools', () => agente.herramientas());
handle('agent:log', () => agente.actividad());
// Aprendizaje de reglas: casos corregidos → propuestas de la IA → aprobación de Portalfirma
const reglas = require('./reglas');
handle('reglas:get', () => reglas.obtener(pfapi));
handle('reglas:caso', (c) => reglas.agregarCaso(pfapi, c || {}));
handle('reglas:casos', () => reglas.listarCasos());
handle('reglas:borrarCaso', (id) => reglas.borrarCaso(id));
handle('reglas:proponer', (ctx) => reglas.proponer(ctx || {}));
handle('reglas:probar', (p) => reglas.probar(p || {}));
handle('reglas:decidir', (d) => reglas.decidir(d || {}));
handle('reglas:activar', (d) => reglas.activar(d || {}));
handle('reglas:eliminar', (id) => reglas.eliminar(id));
handle('reglas:exportar', async () => {
  const data = JSON.stringify(reglas.exportar(), null, 2);
  if (process.env.PF_SAVE_DIR) { const f = path.join(process.env.PF_SAVE_DIR, 'reglas-notariales.json'); fs.writeFileSync(f, data); return f; }
  const r = await dialog.showSaveDialog(win, { defaultPath: 'reglas-notariales.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, data); return r.filePath;
});

const plazos = require('./plazos');
plazos.init({ asPdf: (p) => asPdfForSigning(p), open: () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send('open:plazos'); } } });
handle('plazos:list', () => plazos.list());
handle('plazos:add', (paths) => plazos.add((paths || []).filter((p) => typeof p === 'string')));
handle('plazos:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documentos', extensions: ['pdf', 'docx'] }] });
  if (r.canceled) return { items: plazos.list(), added: 0, skipped: [] }; return plazos.add(r.filePaths);
});
handle('plazos:bytes', (id) => plazos.bytes(id));
handle('plazos:update', (id, patch) => plazos.update(id, patch || {}));
handle('plazos:remove', (id) => plazos.remove(id));
handle('plazos:ics', async (id) => {
  const txt = plazos.ics(id); const it = plazos.list().find((x) => x.id === id);
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), (it.name.replace(/\.pdf$/i, '') + ' - plazo.ics').replace(/[\\/:*?"<>|]+/g, '-')), filters: [{ name: 'Calendario', extensions: ['ics'] }] });
  if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, txt); shell.openPath(r.filePath); return r.filePath;
});

// ---- Carga masiva ----
const bulk = require('./bulk');
bulk.init(pf, { asPdf: (p) => asPdfForSigning(p), onUpdate: (st) => win && !win.isDestroyed() && win.webContents.send('bulk:update', st),
  sent: (it) => { if (it.flow?.expId) require('./expedientes').log(it.flow.expId, { kind: 'sent', op: it.operation, text: `Enviado a firmar «${it.flow.file || it.name}»`, files: [it.flow.file || it.name] }); } });
handle('bulk:state', () => bulk.state());
handle('bulk:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documentos', extensions: ['pdf', 'docx'] }] });
  if (r.canceled) return bulk.state(); return bulk.add(r.filePaths);
});
handle('bulk:add', (paths) => bulk.add((paths || []).filter((p) => typeof p === 'string' || (p && typeof p.path === 'string')).map((p) => (typeof p === 'string' ? p : { path: p.path, flow: p.flow && typeof p.flow === 'object' ? { expId: String(p.flow.expId || ''), file: String(p.flow.file || '') } : undefined }))));
handle('bulk:update', (id, patch) => bulk.update(id, patch || {}));
handle('bulk:applySigners', (signers) => bulk.applySigners(signers || []));
handle('bulk:retry', (id) => bulk.retry(id));
handle('bulk:remove', (id) => bulk.remove(id));
handle('bulk:clear', (which) => bulk.clear(which));
handle('bulk:pause', (v) => bulk.pause(v));
handle('bulk:send', (ids, opts) => bulk.send(ids || [], opts || {}));
handle('bulk:stopSend', () => bulk.stopSend());
handle('bulk:rearm', (id) => bulk.rearm(id));
// ---- Expedientes (carpetas por caso, en el computador o en Google Drive) ----
const exped = require('./expedientes');
handle('exp:list', () => exped.list());
handle('exp:create', (o) => exped.create(o || {}));
handle('exp:update', (id, p) => exped.update(id, p || {}));
handle('exp:remove', (id) => exped.remove(id));
handle('exp:history', (id) => exped.history(id));
handle('exp:files', (id) => exped.files(id));
handle('exp:addFiles', (id, paths, o) => exped.addFiles(id, (paths || []).filter((p) => typeof p === 'string'), o || {}));
handle('exp:pickFiles', async (id) => {
  const r = await dialog.showOpenDialog(win, { title: 'Agregar archivos al expediente', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documentos e imágenes', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'jpg', 'jpeg', 'png', 'heic', 'webp', 'txt'] }, { name: 'Todos', extensions: ['*'] }] });
  return r.canceled ? { added: [], skipped: [] } : exped.addFiles(id, r.filePaths);
});
handle('exp:addBytes', (id, name, bytes, o) => exped.addBytes(id, name, bytes, o || {}));
handle('exp:localPath', (id, fid) => exped.localPath(id, fid));
handle('exp:removeFile', (id, fid) => exped.removeFile(id, fid));
handle('exp:reveal', (id) => exped.reveal(id));
handle('exp:log', (id, entry) => exped.log(id, entry || {}) && true);
// ---- Flujos documentales (recetas: modelo + nómina + firmantes → carga masiva) ----
const flujos = require('./flujos');
flujos.init({ htmlToPdf, bulkModule: bulk, onUpdate: (st) => win && !win.isDestroyed() && win.webContents.send('flujos:update', st) });
handle('flujos:models', () => flujos.modelList());
handle('flujos:model', (id) => flujos.model(id));
handle('flujos:recipes', () => flujos.recipes());
handle('flujos:saveRecipe', (r) => flujos.saveRecipe(r || {}));
handle('flujos:deleteRecipe', (id) => flujos.deleteRecipe(id));
handle('flujos:pickNomina', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Elige la nómina', properties: ['openFile'], filters: [{ name: 'Planillas', extensions: ['xlsx', 'xls', 'csv', 'ods'] }] });
  return r.canceled ? null : flujos.readNomina(r.filePaths[0]);
});
handle('flujos:readNomina', (file) => flujos.readNomina(String(file)));
handle('flujos:check', (spec) => flujos.check(spec));
handle('flujos:sample', (spec) => flujos.sample(spec));
handle('flujos:run', (spec) => flujos.run(spec));
handle('flujos:runs', () => flujos.runs());
handle('flujos:deleteRun', (id) => flujos.deleteRun(id));
handle('flujos:state', () => flujos.state());
// Firma masiva con certificado: la clave va directo a Portalfirma; no se guarda ni se registra
handle('cds:pending', (rut) => pf.cds({ action: 'list_pending', rut }));
handle('cds:code', (rut, operations, clave) => pf.cds({ action: 'request_sign_code', rut, operations, clave_certificado: clave }));
handle('cds:sign', (rut, operations, clave, code) => pf.cds({ action: 'sign_documents', rut, operations, clave_certificado: clave, segundo_factor: code }));

// Seguimiento
handle('op:detail', (n) => {
  const num = String(n ?? '').replace(/\D/g, '');
  if (!num) throw new Error('Esta entrada no tiene número de operación: el envío no se completó en Portalfirma.');
  return pf.processDetail(Number(num));
});
handle('op:manage', (args) => pf.manage(args));
handle('op:byRut', (rut, start, end) => pf.byRut(rut, start, end));
handle('history:list', () => { // los envíos que fallaron (sin número de operación) no se muestran
  const h = (store.get('history') || []).filter((x) => x && x.operation != null && x.operation !== '');
  store.set('history', h); return h;
});

handle('prefs:get', () => ({ payerEmail: store.get('payerEmail') || '', serverUrl: pf.serverUrl(), mock: process.env.PF_MOCK === '1', welcome: process.env.PF_WELCOME === '1' }));
handle('prefs:set', (p) => { if (p.payerEmail !== undefined) store.set('payerEmail', p.payerEmail); return true; });
handle('open:url', (u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return true; });
// Enlaces dentro de un PDF (el usuario ya confirmó en la app)
handle('open:link', (u) => { if (/^(https?:|mailto:)/i.test(String(u))) shell.openExternal(String(u)); return true; });
handle('win:fullscreen', (v) => { if (win) win.setFullScreen(v === undefined || v === null ? !win.isFullScreen() : !!v); return true; });

// Imprimir: las páginas llegan como imágenes; se arma una página HTML con el tamaño de cada hoja y se abre el diálogo del sistema.
handle('print:pages', async (pages, name) => {
  if (!Array.isArray(pages) || !pages.length) throw new Error('No hay páginas para imprimir.');
  const dir = fs.mkdtempSync(path.join(tmpDir(), 'imprimir-'));
  // Todas las hojas usan el tamaño de la primera (el usuario puede cambiarlo en el diálogo); cada página se ajusta a la hoja.
  const sizes = [`${Number(pages[0].w).toFixed(2)} ${Number(pages[0].h).toFixed(2)}`];
  const body = pages.map((p, i) => { const f = `p${i}.jpg`; fs.writeFileSync(path.join(dir, f), Buffer.from(p.bytes)); return `<div class="pg"><img src="${f}"></div>`; }).join('');
  const [W0, H0] = sizes[0].split(' ');
  const title = String(name || 'documento.pdf').replace(/[<>&"]/g, '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    @page { size: ${W0}pt ${H0}pt; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }
    .pg { width: 100vw; height: 100vh; break-after: page; overflow: hidden; display: flex; align-items: center; justify-content: center; } .pg:last-child { break-after: auto; }
    .pg img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }</style></head><body>${body}</body></html>`;
  const htmlPath = path.join(dir, 'imprimir.html'); fs.writeFileSync(htmlPath, html);
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await pw.loadFile(htmlPath);
  const cleanup = () => { try { pw.destroy(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  if (process.env.PF_PRINT_DRYRUN === '1') { const out = { html: htmlPath, pages: pages.length, sizes }; try { pw.destroy(); } catch {} return out; }
  pw.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, () => cleanup());
  return { pages: pages.length };
});

function findKey(obj, re) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (re.test(k) && (typeof v === 'number' || /^\d+$/.test(String(v)))) return v;
    const inner = findKey(v, re); if (inner !== undefined) return inner;
  }
}
function findUrl(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && /^https:\/\//.test(v)) return v;
    const inner = findUrl(v); if (inner) return inner;
  }
}
