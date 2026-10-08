// Tokens del asistente: bienvenida, costos, sin saldo, compra por WhatsApp y código de activación.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pftk-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const sleep = (ms) => w.waitForTimeout(ms);
  const bal = async () => (await w.evaluate(() => window.pf.aiWallet())).data.balance;
  await w.evaluate((p) => window.editor.openPaths([p], true), path.resolve(__dirname, 'fixtures', 'contrato_prueba.pdf')); await idle(); await sleep(800);

  console.log('Bienvenida');
  ok(await bal() === 5, '5 tokens de bienvenida');
  await w.click('#edAi'); await w.waitForSelector('.tk-bar');
  ok(/5 tokens/.test(await w.textContent('.tk-bar')), 'saldo visible en el panel');
  ok(/1 token/.test(await w.textContent('#aiReview')), 'el botón muestra su costo');

  console.log('Costos');
  await w.click('#aiReview'); await w.waitForSelector('#mOk:has-text("Entiendo")'); await w.click('#mOk'); await w.waitForSelector('.ai-item', { timeout: 30000 }); await idle();
  ok(await bal() === 4 && /4 tokens/.test(await w.textContent('.tk-bar')), 'revisar descuenta 1');
  await w.click('[data-aitab="ask"]');
  for (let i = 1; i <= 4; i++) { await w.waitForSelector('#aiQ'); await w.fill('#aiQ', `Pregunta ${i}`); await w.press('#aiQ', 'Enter'); await w.waitForFunction((n) => document.querySelectorAll('.ai-msg.assistant').length >= n, i, { timeout: 30000 }); await idle(); }
  ok(await bal() === 2, '4 preguntas = 2 tokens (bloques de 3)');
  ok(/2 pregunta/.test(await w.textContent('[data-askleft]')), 'avisa cuántas preguntas quedan pagadas');
  await w.click('#aiClose'); await w.click('#edTpl'); await w.waitForSelector('#tplAi'); await w.click('#tplAi'); await w.waitForSelector('.ai-det', { timeout: 30000 }); await idle();
  ok(await bal() === 0, 'detectar campos descuenta 2');
  await w.click('#mCancel');

  console.log('Sin saldo');
  await w.click('#tplAi'); await w.waitForSelector('.tk-big', { timeout: 30000 });
  ok(/No te quedan tokens/.test(await w.textContent('#modalCard')), 'sin tokens: explica y ofrece comprar');
  await w.screenshot({ path: path.resolve(__dirname, 't1-sin-tokens.png') });
  await w.click('#tkWa'); await sleep(300);
  const u = (await app.evaluate(() => global.__opened)).at(-1);
  ok(/^https:\/\/wa\.me\/5692525400\?text=/.test(u) && /Paquete%20de%20tokens/.test(u), 'compra por WhatsApp con el mensaje listo');
  await w.fill('#tkCode', 'otro-codigo'); await w.click('#tkGo'); await sleep(300);
  ok(/no es válido/.test(await w.textContent('#toast')) && await bal() === 0, 'código inválido rechazado');
  await w.fill('#tkCode', 'PortalFirma123-'); await w.click('#tkGo'); await sleep(400);
  ok(await bal() === 20, 'código de soporte activa el paquete (20 tokens)');
  await w.click('#tplAi'); await w.waitForSelector('.ai-det', { timeout: 30000 }); await idle();
  ok(await bal() === 18, 'vuelve a funcionar con el paquete');
  await w.click('#mCancel');
  const log = (await w.evaluate(() => window.pf.aiWallet())).data.log.map((x) => x.what + ' ' + x.d);
  console.log('    historial:', log.join(' | '));
  ok(log.includes('Paquete de tokens 20') && log.includes('Bienvenida 5'), 'historial de movimientos');
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
