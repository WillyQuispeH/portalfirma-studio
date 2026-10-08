// Plantillas: detectar campos con IA (modo de prueba) + botón de soporte por WhatsApp.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execSync } = require('child_process');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfdet-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const sleep = (ms) => w.waitForTimeout(ms);
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  await w.evaluate((p) => window.editor.openPaths([p], true), path.resolve(__dirname, 'fixtures', 'contrato_prueba.pdf')); await idle(); await sleep(800);

  console.log('WhatsApp');
  await w.click('#edWa'); await sleep(300);
  const opened = await app.evaluate(() => global.__opened);
  ok(opened.length === 1 && /^https:\/\/wa\.me\/5692525400\?text=/.test(opened[0]), 'abre WhatsApp de soporte');

  console.log('Detectar campos');
  await w.click('#edTpl'); await w.waitForSelector('#tplAi');
  await w.click('#tplAi');
  await w.waitForSelector('#mOk:has-text("Entiendo")'); await w.click('#mOk');
  await w.waitForSelector('.ai-det', { timeout: 30000 }); await idle();
  const n = await w.locator('.ai-det').count(); ok(n === 7, `7 campos propuestos; el inventado se descarta (${n})`);
  await w.screenshot({ path: path.resolve(__dirname, 'd1-detectados.png') });
  await w.locator('.ai-det:has-text("Santiago") input[type=checkbox]').uncheck();
  await w.locator('.ai-det-lbl >> nth=4').fill('Fecha de firma');
  await w.click('#mOk'); await idle(); await sleep(1200);
  const def = await w.evaluate(() => window.editor._state.tpl.def.fields.map((f) => ({ l: f.label, t: f.type, s: f.signer?.role })));
  console.log('   ', JSON.stringify(def));
  ok(def.length === 6, '6 campos creados (uno desmarcado)');
  ok(def.some((f) => f.l === 'Fecha de firma' && f.t === 'fecha'), 'nombre corregido y tipo fecha');
  ok(def.filter((f) => f.s === 'Cliente').length === 2 && def.filter((f) => f.s === 'Prestador').length === 2, 'firmantes Cliente y Prestador');
  const marks = await w.evaluate(() => document.querySelectorAll('.pf-field').length);
  ok(marks >= 8, `campos marcados en el documento (${marks}: los nombres también en las firmas)`);
  await w.screenshot({ path: path.resolve(__dirname, 'd2-campos.png') });

  console.log('Guardar y llenar');
  await w.click('#tplSave'); await w.waitForSelector('#tName'); await w.fill('#tName', 'Servicios IA'); await w.click('#mOk');
  await w.waitForSelector('#mOk:has-text("Llenar ahora")', { timeout: 30000 }); await w.click('#mOk'); await idle(); await sleep(1000);
  ok(await w.locator('.tf').count() === 6, 'formulario con 6 campos');
  const fid = (l) => w.evaluate((x) => window.editor._state.tpl.def.fields.find((f) => f.label === x).id, l);
  const fill = async (l, v) => { const id = await fid(l); await w.fill(`[data-in="${id}"]`, v); await w.locator(`[data-in="${id}"]`).blur(); };
  await fill('Cliente: nombre', 'Ana Pérez Lagos'); await fill('Cliente: RUT', '12345678-5'); await fill('Prestador: nombre', 'Pedro Soto Vera'); await fill('Prestador: RUT', '11.111.111-1');
  await w.fill(`[data-in="${await fid('Fecha de firma')}"]`, '2026-11-03'); await fill('Precio mensual', '750000'); await sleep(900);
  await w.click('#tplGen'); await idle(); await sleep(1200);
  const b64 = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(path.resolve(__dirname, 'out-detectar.pdf'), Buffer.from(b64, 'base64'));
  const txt = execSync(`pdftotext "${path.resolve(__dirname, 'out-detectar.pdf')}" -`).toString().replace(/\s+/g, ' ');
  ok(/ANA PÉREZ LAGOS/i.test(txt) && /12\.345\.678-5/.test(txt) && /3 de noviembre de 2026/.test(txt) && /\$750\.000/.test(txt), 'documento generado con los datos');
  ok(!/MARIA GONZALEZ|JUAN PEREZ|500\.000/.test(txt), 'sin datos del ejemplo');
  ok(/Santiago/.test(txt), 'lo desmarcado queda como texto fijo');
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
