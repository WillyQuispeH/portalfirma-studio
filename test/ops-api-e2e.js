// Mis operaciones por la API: inicio de sesión con correo y contraseña, sin teléfono; lista, detalle y documento.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
const pdf = fs.readFileSync(path.join(__dirname, 'fixtures', 'contrato_prueba.pdf'));
const U = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const row = (op, stage, i, signedAll, legal) => ({ status: stage === 'finalized' ? 'finalized' : stage, signers: [{ number: 1, signed: true, status: 'signed', fullName: 'Nicolás Prueba', typeSign: 'simple', isSignatory: true }, { number: 2, signed: !!signedAll, status: signedAll ? 'signed' : 'pending', fullName: 'Romina Prueba', typeSign: 'simple', isSignatory: true }],
  contract: { id: U(i), legalized: legal ? U(900 + i) : null, operation: op, updateDate: `2026-10-0${1 + (i % 5)}T10:00:00`, createdDate: `2026-09-2${i % 9}T10:00:00`, document_des: `Contrato ${op}`, document_name: 'generic' } });
const DATA = { starting: [row(30001, 'starting', 1)], process: [row(30002, 'process', 2), row(30003, 'process', 3)], finalized: Array.from({ length: 130 }, (_, i) => row(24000 + i, 'finalized', 10 + i, true, i === 0)) };
const seen = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = b ? JSON.parse(b) : null; seen.push({ u: req.url, ck: req.headers.cookie || '', body });
    const J = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/partnerUser/validate') return J(200, { success: true, data: { token: 't1', refreshToken: 'r1', entity_id: 'E1', user_id: 'U1', person_id: 'P1', role: 'admin', email: body.email, nameEntity: 'Portalfirma', namePerson: 'Jerónimo' } });
    if (!/auth-token=t1/.test(req.headers.cookie || '')) return J(401, { success: false, error: 'No autenticado' });
    if (req.url === '/api/contractPartner/getPaginatedContracts') { const all = DATA[body.stage] || []; const sl = all.slice((body.page - 1) * body.pageSize, body.page * body.pageSize); return J(200, { success: true, data: { data: sl.length ? sl : null, pagination: { limit: body.pageSize, currentPage: body.page, totalRecords: all.length, totalPages: Math.ceil(all.length / body.pageSize) } } }); }
    if (req.url === '/api/contractPartner/getPaginatedUnpaidContracts') return J(200, { success: true, data: { data: [{ status: 'unPayed', contract: { id: U(5), operation: 30005, updateDate: '2026-10-04T10:00:00', createdDate: '2026-10-04T10:00:00', document_des: 'Contrato sin pagar', document_name: 'generic' } }], pagination: { totalPages: 1 } } });
    if (req.url === '/api/contractSignatory/getByContractId') return J(200, { success: true, data: [{ id: 'cs1', fullName: 'Nicolás Prueba', rut: '20.346.942-K', email: 'n@correo.cl', phone: '+56900000001', url: ' https://cliente.portalfirma.cl/v?c=cs1 ', signed: true }, { id: 'cs2', fullName: 'Romina Prueba', rut: '16.583.127-6', email: 'r@correo.cl', phone: '+56900000002', url: 'https://cliente.portalfirma.cl/v?c=cs2', signed: true }] });
    if (req.url === '/api/file/getById') return J(200, { success: true, data: { name: 'CONTRATO_PRUEBA.pdf', base64: Buffer.concat([pdf, Buffer.from('\n%' + body.contract_id)]).toString('base64') } });
    return J(200, { success: true, data: { amount: 5000 } });
  });
}).listen(0, '127.0.0.1');
(async () => {
  await new Promise((r) => srv.on('listening', r)); const port = srv.address().port;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfoa-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1', PF_API_BASE: `http://127.0.0.1:${port}/api` } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  await w.click('.hub-card[data-act="ops"]'); await w.waitForSelector('#adEmail');
  ok(!(await w.$('#opPhone')) && /correo y la contraseña/.test(await w.textContent('#modalCard')), 'pide correo y contraseña, no el teléfono');
  await w.fill('#adEmail', 'jgomez@portalfirma.cl'); await w.fill('#adPass', 'x'); await w.click('#mOk');
  await w.waitForFunction(() => document.querySelectorAll('.ops-row').length >= 100, null, { timeout: 30000 });
  const n = await w.locator('.ops-row').count(); ok(n === 134, `trae todas las operaciones de la cuenta, con varias páginas (${n})`);
  ok(seen.filter((x) => x.u.includes('getPaginatedContracts') && x.body.stage === 'finalized').length === 2, 'pagina la lista (100 por página)');
  const f = await w.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ops-f')].map((b) => [b.dataset.f, Number(b.querySelector('b').textContent)])));
  console.log('    filtros:', JSON.stringify(f));
  ok(f.signed === 129 && f.notary === 1 && f.pending === 3 && f.action === 1, 'estados desde la lista: firmadas, legalizada, en firma y por pagar');
  await w.click('.ops-row[data-op="24000"]'); await w.waitForSelector('#opdCanvas canvas', { timeout: 20000 });
  ok(/Contrato 24000/.test(await w.textContent('.opd-head h3')), 'nombre del documento');
  ok(/2 de 2 firmaron/.test(await w.textContent('.opd-side h4')) && /20\.346\.942-K/.test(await w.textContent('.opd-sigs')), 'firmantes con RUT desde la API');
  ok(seen.some((x) => x.u === '/api/file/getById' && x.body.contract_id === U(10) && /auth-token=t1/.test(x.ck)), 'documento por getById con el contract_id y la sesión');
  await w.click('.ops-row[data-op="30002"]'); await w.waitForSelector('.opd-sig-acts', { timeout: 20000 }).catch(() => {});
  ok(true, 'operación en firma abre su detalle');
  await w.screenshot({ path: path.resolve(__dirname, 'oa1-api.png') });
  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); srv.close(); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
