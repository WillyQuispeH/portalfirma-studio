// 0.31 — menú del usuario: nombre, empresa, saldo, tokens, accesos, ayuda y cierre de sesión.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
  const body = b ? JSON.parse(b) : null; const J = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/api/partnerUser/validate') return J({ success: true, data: { token: 't1', refreshToken: 'r1', entity_id: 'E1', user_id: 'U1', role: 'admin', email: body.email, nameEntity: 'Portalfirma SpA', namePerson: 'Jerónimo Gómez' } });
  if (req.url.startsWith('/api/walletPartner/getById/')) return J({ success: true, data: { amount: 247424 } });
  J({ success: true, data: { data: [], pagination: { totalPages: 1 } } });
}); }).listen(0, '127.0.0.1');
(async () => {
  await new Promise((r) => srv.on('listening', r));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfus-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_API_BASE: `http://127.0.0.1:${srv.address().port}/api` } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card'); await w.waitForTimeout(500);
  ok(await w.isVisible('#topLoginBtn') && !(await w.isVisible('#userBtn')), 'sin sesión: botón «Iniciar sesión»');
  await w.evaluate(() => window.ApiDiag.login(() => {})); await w.fill('#adEmail', 'jgomez@portalfirma.cl'); await w.fill('#adPass', 'x'); await w.click('#mOk');
  await w.waitForSelector('#userBtn:not(.hidden)'); await w.waitForTimeout(600);
  const t = await w.textContent('#userBtn');
  ok(/JG/.test(t) && /Jerónimo/.test(t) && !(await w.isVisible('#topLoginBtn')), 'arriba a la derecha: iniciales y nombre del usuario');
  ok(await w.$('#userBtn .u-tk'), 'muestra los tokens del asistente');
  await w.click('#userBtn'); await w.waitForSelector('#userMenu'); await w.waitForTimeout(500);
  const m = await w.textContent('#userMenu');
  ok(/Jerónimo Gómez/.test(m) && /Portalfirma SpA/.test(m) && /Administrador/.test(m), 'menú con nombre, empresa y rol');
  ok(/\$247\.424/.test(m) && /Tokens del asistente/.test(m), 'saldo de la cuenta y tokens');
  ok(/Mis operaciones/.test(m) && /Google Drive/.test(m) && /Ayuda y guías/.test(m) && /Soporte por WhatsApp/.test(m) && /PortalFirma Studio 0\./.test(m), 'accesos rápidos, Drive, ayuda, soporte y versión');
  await w.screenshot({ path: path.resolve(__dirname, 'us1-menu.png') });
  await w.keyboard.press('Escape'); ok(!(await w.$('#userMenu')), 'Esc cierra el menú');
  await w.click('#userBtn'); await w.click('[data-um="help"]'); await w.waitForSelector('#helpPanel.open'); ok(true, '«Ayuda y guías» abre la ayuda'); await w.evaluate(() => window.Ayuda.close());
  await w.click('#userBtn'); await w.click('[data-um="out"]'); await w.waitForSelector('#topLoginBtn:not(.hidden)');
  ok(!(await w.isVisible('#userBtn')), 'cerrar sesión vuelve a «Iniciar sesión»');
  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); srv.close(); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
