// Google Drive sin modo de prueba: cargar la credencial y el inicio del OAuth (URL, PKCE, redirección local).
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfdr2-'));
  const env = { ...process.env }; delete env.PF_MOCK;
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env });
  const w = await app.firstWindow(); await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('#tplDrive');
  await app.evaluate(({ dialog, shell }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); global.__urls = []; shell.openExternal = async (u) => { global.__urls.push(u); }; }, process.env.OAUTH);
  await w.waitForSelector('.welcome', { timeout: 10000 }).then(() => w.click('#wBasic')).catch(() => {});
  await w.click('#tplDrive'); await w.waitForSelector('#drvAdmin');
  ok(/próxima actualización/.test(await w.textContent('#modalCard')), 'sin credencial: mensaje simple para el usuario, con soporte');
  await w.click('#drvAdmin'); await w.waitForSelector('#mOk:has-text("Conectar")');
  ok((await w.evaluate(() => window.pf.driveStatus())).data.configured, 'credencial cargada');
  await w.click('#mOk'); await w.waitForFunction(() => /Esperando/.test(document.querySelector('#modalCard').textContent));
  await w.waitForTimeout(500);
  const u = new URL((await app.evaluate(() => global.__urls))[0]);
  console.log('    ', u.origin + u.pathname, '…', [...u.searchParams.keys()].join(','));
  ok(u.host === 'accounts.google.com' && u.searchParams.get('client_id') === '123-abc.apps.googleusercontent.com', 'abre el login de Google con el cliente');
  ok(/drive\.readonly/.test(u.searchParams.get('scope')) && u.searchParams.get('code_challenge_method') === 'S256' && u.searchParams.get('access_type') === 'offline', 'permiso de solo lectura, PKCE y acceso sin conexión');
  const red = u.searchParams.get('redirect_uri'); ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(red), 'redirección local ' + red);
  // el navegador vuelve con un estado falso → se rechaza
  const r1 = await fetch(red + '/?code=abc&state=otro').then((r) => r.text());
  ok(/No se pudo conectar/.test(r1), 'rechaza una respuesta con estado distinto (protección CSRF)');
  await w.waitForSelector('#toast:not(.hidden)'); console.log('    toast:', await w.textContent('#toast'));
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
