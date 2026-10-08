// API directa: inicio de sesión con correo y contraseña contra un servidor de prueba local + diagnóstico.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
const seen = [];
let valid = 't1'; let refreshOk = 'r1'; let refreshed = 0;
const ck = (req, n) => ((req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]+)')) || [])[1];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = b ? JSON.parse(b) : null; seen.push({ m: req.method, u: req.url, id: req.headers.id, auth: req.headers.authorization || '', ck: req.headers.cookie || '', body });
    const J = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.id !== '957902342') return J(403, { success: false, error: 'id' });
    if (req.url === '/api/partnerUser/validate') return body.password === 'clave-correcta' ? J(200, { success: true, data: { token: 't1', refreshToken: 'r1', entity_id: 'E1', user_id: 'U1', person_id: 'P1', role: 'admin', email: body.email, nameEntity: 'Portalfirma', namePerson: 'Jerónimo' } }) : J(401, { success: false, error: 'Credenciales inválidas' });
    if (req.url === '/api/auth/refresh') { const r = ck(req, 'refresh-token'); if (!r) return J(400, { success: false, error: 'Refresh token requerido' }); if (r !== refreshOk) return J(401, { success: false, error: 'Refresh token expirado' }); refreshed++; valid = 't2'; refreshOk = 'r2'; return J(200, { success: true, data: { token: 't2', refreshToken: 'r2' }, error: null }); }
    const tok = ck(req, 'auth-token');
    if (!tok) return J(401, { success: false, error: 'No autenticado' });
    if (tok !== valid) return J(401, { success: false, error: 'Token expirado' });
    if (req.url === '/api/contractPartner/getPaginatedContracts') { if (body.type !== 'operation' || body.userId !== null || body.pageSize !== 100 && body.pageSize !== 5) return J(200, { success: true, data: { data: null, pagination: {} } }); if (body.stage === 'finalized') valid = 'expira-ahora'; return J(200, { success: true, data: { data: [{ contract_id: '60620f36-de93-488a-a8c0-7de7ad33a460', operation: 24088, document_name: 'Contrato.pdf', stage: body.stage }], pagination: { totalRecords: 1 } } }); }
    if (req.url === '/api/file/getById') return J(200, { success: true, data: { name: 'Contrato.pdf', base64: Buffer.from('%PDF-1.4 x').toString('base64') } });
    return J(200, { success: true, data: { ok: 1 } });
  });
}).listen(0, '127.0.0.1');
(async () => {
  await new Promise((r) => srv.on('listening', r)); const port = srv.address().port;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfad-')); const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'pfadd-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_API_BASE: `http://127.0.0.1:${port}/api`, PF_DIAG_DIR: dl } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  await w.evaluate(() => window.ApiDiag.open()); await w.waitForSelector('#adEmail');
  await w.fill('#adEmail', 'jgomez@portalfirma.cl'); await w.fill('#adPass', 'mala'); await w.click('#mOk');
  await w.waitForSelector('#adErr:has-text("Credenciales")'); ok(true, 'contraseña incorrecta: muestra el error de la API');
  ok(seen[0].u === '/api/partnerUser/validate' && seen[0].body.appOrigin === 'portalfirma' && seen[0].id === '957902342', 'POST /partnerUser/validate con {email, password, appOrigin} y cabecera id');
  await w.fill('#adPass', 'clave-correcta'); await w.click('#mOk'); await w.waitForSelector('#adOut');
  ok(/Jerónimo/.test(await w.textContent('#modalCard')), 'inicia sesión y muestra la cuenta');
  const raw = fs.readFileSync(path.join(userData, 'portalfirma.json'), 'utf8');
  ok(!raw.includes('clave-correcta') && !raw.includes('eyJhbGciOi'), 'no guarda la contraseña y el token queda cifrado');
  await w.click('#mOk'); await w.waitForSelector('text=Diagnóstico listo', { timeout: 30000 });
  const f = fs.readdirSync(dl).find((x) => /diagnostico-API/.test(x)); ok(!!f, 'guarda el diagnóstico en Descargas');
  const d = fs.readFileSync(path.join(dl, f), 'utf8');
  ok(!/Jerónimo|jgomez|24088|60620f36|Contrato\.pdf/.test(d), 'el diagnóstico no contiene datos personales ni de contratos');
  const j = JSON.parse(d); ok(j.tests.some((t) => t.name === 'documento (getById)' && t.status === 200), 'incluye la prueba del documento con el contract_id de la lista');
  ok(seen.filter((x) => x.u !== '/api/partnerUser/validate' && x.u !== '/api/auth/refresh' && x.ck).every((x) => /^auth-token=t[12]$/.test(x.ck) && !x.auth), 'cada petición lleva solo la cookie auth-token con el JWT tal cual (sin Bearer)');
  const rf = seen.find((x) => x.u === '/api/auth/refresh'); ok(rf && rf.ck === 'refresh-token=r1' && rf.body === null, 'token expirado: renueva con POST /auth/refresh, cuerpo vacío y cookie refresh-token');
  ok(refreshed === 1 && seen.some((x) => x.ck === 'auth-token=t2'), 'reemplaza ambos tokens y reintenta con el nuevo');
  ok(seen.some((x) => x.u.includes('getPaginatedContracts') && x.body.type === 'operation' && x.body.userId === null && x.body.pageSize === 100), 'lista con type «operation», 100 por página y userId null (administrador)');
  ok(j.muestra.tiene_contract_id && j.muestra.tiene_operacion, 'toma el contrato de muestra de la lista');
  ok(seen.some((x) => x.u.includes('getPaginatedContracts') && !x.ck), 'prueba de seguridad: misma consulta sin cookie');
  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); srv.close(); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
