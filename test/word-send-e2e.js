// Enviar a firmar un Word: se convierte a PDF antes de subirlo; un error del servidor no se muestra como éxito.
const { _electron: electron } = require('playwright'); const path = require('path');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_SEND_500: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1300, height: 860 }); await w.waitForSelector('.hub-card');
  await w.click('.tab[data-view="send"]'); await w.waitForSelector('#loginBtn'); await w.click('#loginBtn'); await w.waitForSelector('#view-drop:not(.hidden)', { timeout: 15000 });
  await w.evaluate(async (p) => { const f = await window.pf.checkFile(p); startAnalysis(f.data); }, path.join(__dirname, 'fixtures', 'contrato.docx'));
  await w.waitForSelector('#view-review:not(.hidden)', { timeout: 60000 });
  const f = await w.evaluate(() => state.file);
  ok(/\.pdf$/i.test(f.name) && f.converted === 'Word', `se subió como PDF: ${f.name}`);
  ok(await w.locator('#convNote:not(.hidden)').count() === 1, 'aviso de conversión con botón «Ver PDF»');
  await w.screenshot({ path: path.join(__dirname, 'w1-word.png') });
  // completa y envía (el servidor de prueba responde error 500)
  await w.evaluate(() => { state.signers = [{ fullName: 'Ana Rojas', rut: '11.111.111-1', email: 'ana@correo.cl', phone: '+56911111111', alias: 'Arrendataria', typeSign: 'simple' }]; renderSigners(); });
  await w.fill('#payerEmail', 'pagos@correo.cl');
  await w.click('#sendBtn'); await w.waitForSelector('#mOk'); await w.click('#mOk'); await w.waitForTimeout(1500);
  ok(await w.evaluate(() => document.querySelector('#view-done').classList.contains('hidden')), 'no muestra «Enviado a firmar» cuando falla');
  const msg = await w.textContent('#reviewError'); console.log('   mensaje:', msg);
  ok(/error 500/.test(msg), 'explica el error del servidor');
  await w.screenshot({ path: path.join(__dirname, 'w2-error.png') });
  console.log('errores:', errs); await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
