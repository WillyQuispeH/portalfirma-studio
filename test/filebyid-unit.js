// Unidad: fileById usa SOLO POST https://api.portalfirma.cl/api/file/getById con { contract_id } y la cabecera «id».
const Module = require('module'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
const secrets = {};
const orig = Module._load;
Module._load = function (req, ...a) {
  if (req === 'electron') return { shell: {}, app: { getPath: () => os.tmpdir() }, safeStorage: { isEncryptionAvailable: () => false } };
  if (req === './store') return { get: () => null, set() {}, getSecret: (k) => secrets[k], setSecret: (k, v) => { secrets[k] = v; } };
  return orig.call(this, req, ...a);
};
const cfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pfcfg-')), 'api.json'); fs.writeFileSync(cfg, '{"id":""}');
process.env.PF_API_CONFIG = cfg; delete process.env.PF_FILE_ID;
const pf = require('../src/portalfirma');
const pdf = fs.readFileSync(path.join(__dirname, 'fixtures', 'contrato_prueba.pdf'));
const calls = []; let reply;
global.fetch = async (url, o) => { calls.push({ url, ...o }); return reply(); };
const json = (status, body) => () => ({ ok: status < 400, status, json: async () => body });
(async () => {
  await pf.fileById('abc').then(() => { throw new Error('debió fallar'); }, (e) => ok(e.code === 'NO_FILE_KEY' && !calls.length, 'sin código de acceso no llama a nada y avisa'));
  fs.writeFileSync(cfg, '{"id":"123456789"}');
  const uuid = '0b0c3c9e-1111-4a2b-9c3d-123456789abc';
  reply = json(200, { success: true, data: { id: 7, name: 'Contrato.pdf', type: 'application/pdf', base64: pdf.toString('base64') }, error: null });
  const r = await pf.fileById(uuid);
  const c = calls[0];
  ok(c.url === 'https://api.portalfirma.cl/api/file/getById' && c.method === 'POST', 'POST a api/file/getById');
  ok(c.headers.Accept === 'application/json' && c.headers['Content-Type'] === 'application/json' && c.headers.id === '123456789', 'cabeceras Accept, Content-Type e id');
  ok(JSON.parse(c.body).contract_id === uuid && Object.keys(JSON.parse(c.body)).length === 1, 'cuerpo { contract_id }');
  ok(r.name === 'Contrato.pdf' && Buffer.compare(r.bytes, pdf) === 0, 'decodifica data.base64 al PDF');
  reply = json(200, { success: false, data: null, error: 'Archivo no encontrado' });
  await pf.fileById(uuid).then(() => { throw new Error('x'); }, (e) => ok(e.code === 'FILE_UNAVAILABLE' && /Archivo no encontrado/.test(e.message), 'success:false → muestra el error del servicio'));
  reply = json(200, { success: true, data: { name: 'x.pdf', base64: Buffer.from('<html>').toString('base64') } });
  await pf.fileById(uuid).then(() => { throw new Error('x'); }, (e) => ok(/no es un PDF/.test(e.message), 'rechaza contenido que no es PDF'));
  reply = json(401, {});
  await pf.fileById(uuid).then(() => { throw new Error('x'); }, (e) => ok(e.code === 'NO_FILE_KEY', '401 → pide revisar el código de acceso'));
  ok(calls.every((x) => x.url === 'https://api.portalfirma.cl/api/file/getById'), 'ninguna otra ruta');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'portalfirma.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'src', 'sync.js'), 'utf8');
  ok(!/mcp\/file|fetchFile|fileUrl/.test(src), 'se eliminó la descarga por el enlace del conector');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
