// Sin código de acceso al servicio de archivos: Studio lo pide, lo guarda y muestra el documento.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pffk-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1', PF_MOCK_NO_KEY: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  await w.click('.hub-card[data-act="ops"]'); await w.waitForSelector('#opPhone'); await w.fill('#opPhone', '9 8727 6858'); await w.click('#mOk');
  await w.waitForSelector('.ops-row[data-op="20900"]', { timeout: 30000 });
  await w.click('.ops-row[data-op="20900"]'); await w.waitForSelector('#opdKey', { timeout: 20000 });
  ok(/Falta el acceso a los documentos/.test(await w.textContent('#opdCanvas')), 'sin código de acceso: lo explica en la vista previa');
  await w.click('#opdKey'); await w.waitForSelector('#fkVal');
  await w.fill('#fkVal', 'a b'); await w.click('#mOk'); await w.waitForSelector('#fkErr:has-text("no es válido")');
  ok(true, 'valida el código');
  await w.fill('#fkVal', '123456789'); await w.click('#mOk');
  await w.waitForSelector('#opdCanvas canvas', { timeout: 20000 });
  ok(true, 'guarda el código y muestra el documento');
  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
