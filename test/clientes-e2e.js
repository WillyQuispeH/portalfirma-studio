// Acceso: sin cuenta solo funciones básicas; IA y firma piden iniciar sesión (clientes de Portalfirma).
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfcl-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_WELCOME: '1' } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 });
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const sleep = (ms) => w.waitForTimeout(ms);
  await w.waitForSelector('.welcome', { timeout: 20000 });
  ok(/clientes de Portalfirma/.test(await w.textContent('#modalCard')), 'bienvenida: la app es para clientes de Portalfirma');
  await w.screenshot({ path: path.resolve(__dirname, 'c1-bienvenida.png') });
  await w.click('#wBasic'); await sleep(300);
  ok(await w.evaluate(() => document.body.classList.contains('guest')), 'continúa en modo básico');
  const locks = await w.evaluate(() => [...document.querySelectorAll('.hub-card[data-member]')].map((c) => c.dataset.act).sort().join(','));
  ok(locks === 'ai,bulk,flows,ops,plan,plazos,send,tpl', 'candado en IA y firma: ' + locks);
  ok(await w.evaluate(() => [...document.querySelectorAll('.hub-card[data-member] .lock-badge')].every((b) => getComputedStyle(b).display !== 'none')), 'candados visibles');
  await w.screenshot({ path: path.resolve(__dirname, 'c2-basico.png') });

  console.log('Funciones básicas sin cuenta');
  await w.evaluate((p) => window.editor.openPaths([p], true), path.resolve(__dirname, 'fixtures', 'contrato_prueba.pdf')); await idle(); await sleep(700);
  ok(await w.evaluate(() => window.editor.hasDoc()), 'abre y edita PDF sin cuenta');
  await w.click('#edTpl'); await w.waitForSelector('#tplConv');
  ok(true, 'plantillas a mano sin cuenta');

  console.log('IA y firma piden iniciar sesión');
  ok(!(await w.evaluate(() => window.pf.aiChat({ system: 'x', messages: [{ role: 'user', content: 'hola' }] }))).ok, 'el asistente se niega sin sesión (también en el proceso principal)');
  await w.click('#tplAi'); await w.waitForSelector('#view-login:not(.hidden)');
  ok(/exclusivo para clientes/.test(await w.textContent('#loginWhy')), 'Detectar con IA pide iniciar sesión');
  await w.click('#loginBack'); await sleep(400);
  await w.click('#edSend'); await w.waitForSelector('#view-login:not(.hidden)'); ok(true, 'Enviar a firmar pide iniciar sesión');
  await w.click('#loginBack'); await sleep(400);
  await w.click('#edAi'); await w.waitForSelector('#view-login:not(.hidden)');
  await w.click('#loginBtn'); await w.waitForSelector('.ai-head', { timeout: 20000 });
  ok(await w.evaluate(() => !document.body.classList.contains('guest')), 'tras iniciar sesión vuelve al editor y abre el asistente');
  ok(await w.evaluate(() => [...document.querySelectorAll('.lock-badge')].every((b) => getComputedStyle(b).display === 'none')), 'sin candados con sesión');
  const r = await w.evaluate(() => window.pf.aiChat({ system: 'x', messages: [{ role: 'user', content: 'hola' }] }));
  ok(r.ok, 'con sesión, el asistente responde');
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
