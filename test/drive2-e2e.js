// Google Drive: navegar carpetas y llevar documentos a firma (uno o una carpeta completa a la carga masiva).
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfdv-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('#hubDrive');
  const sleep = (ms) => w.waitForTimeout(ms);
  await w.click('#hubDrive'); await w.waitForSelector('#mOk:has-text("Conectar")'); await w.click('#mOk');
  await w.waitForSelector('.drv-item'); await sleep(200);
  const names = await w.locator('.drv-item .drv-nm b').allTextContents();
  ok(names[0] === 'Contratos octubre' && names.length === 4, 'Mi unidad: carpetas primero, luego documentos');
  await w.click('.drv-scope [data-sc="shared"]'); await w.waitForSelector('.drv-item:has-text("Mandato compartido")'); ok(true, 'compartidos conmigo');
  await w.click('.drv-scope [data-sc="mine"]'); await w.waitForSelector('.drv-item[data-dir]');
  await w.click('.drv-item[data-dir]'); await w.waitForSelector('.drv-item:has-text("Arriendo depto 1")');
  ok(/Mi unidad.*Contratos octubre/.test(await w.textContent('.drv-crumbs')), 'entrar a una carpeta (ruta)');
  await w.screenshot({ path: path.resolve(__dirname, 'v2-drive.png') });
  await w.click('#drvAll'); await sleep(300);
  ok(/5 documento/.test(await w.textContent('#drvCount')) && /Enviar a firmar \(5\)/.test(await w.textContent('[data-do="sign"]')), 'seleccionar toda la carpeta');
  ok(await w.locator('[data-do="template"]').isDisabled(), '«Convertir en plantilla» solo con uno');
  await w.click('[data-do="sign"]');
  await w.waitForSelector('#view-bulk:not(.hidden)', { timeout: 30000 });
  await w.waitForFunction(() => window.Masiva._bk.st.items.length === 5 && window.Masiva._bk.st.items.every((x) => ['ready', 'needs_data'].includes(x.status)), null, { timeout: 60000 });
  ok(true, 'toda la carpeta pasa a la carga masiva y se analiza');
  await w.screenshot({ path: path.resolve(__dirname, 'v3-drive-masiva.png') });
  // un solo documento → flujo normal de envío
  await w.click('#bkDrive'); await w.waitForSelector('.drv-item');
  await w.click('[data-crumb="0"]'); await w.waitForSelector('.drv-item:has-text("Contrato prueba.pdf")');
  await w.click('.drv-item:has-text("Contrato prueba.pdf")'); await w.click('[data-do="sign"]');
  await w.waitForSelector('#view-review:not(.hidden), #view-working:not(.hidden)', { timeout: 30000 });
  ok(true, 'un documento → Enviar a firmar con firmantes detectados');
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
