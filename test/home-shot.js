const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfh-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  for (const [W, H, n] of [[1440, 900, 'h1'], [1100, 800, 'h2']]) { await w.setViewportSize({ width: W, height: H }); await w.waitForSelector('.hub-card'); await w.waitForTimeout(700); await w.screenshot({ path: path.resolve(__dirname, n + '-inicio.png') }); }
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.click('.hub-card[data-act="new"]').catch(() => {}); await w.waitForTimeout(500);
  console.log('cards', await w.locator('.hub-card').count(), 'errores', errs);
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(0);
})();
