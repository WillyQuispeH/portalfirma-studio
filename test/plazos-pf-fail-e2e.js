// Plazos: si el servicio getById falla, se explica; si falta el código de acceso, se pide.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpf-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1', PF_MOCK_FILE_FAIL: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  await w.evaluate(() => window.pf.opsSetPhone('987276858'));
  await w.click('.tab[data-view="plazos"]'); await w.waitForSelector('#plPf'); await w.click('#plPf');
  await w.waitForSelector('#modalCard:has-text("no entregó el documento")', { timeout: 60000 });
  ok(true, 'muestra el error que devuelve el servicio de archivos');
  ok(await w.evaluate(() => window.Plazos._p.items.length) === 0, 'no agrega nada roto');
  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
