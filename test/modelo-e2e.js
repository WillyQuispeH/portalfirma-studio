// Redactar desde un modelo de Portalfirma: «contrato de arriendo» ofrece el modelo aprobado y lo abre como formulario, sin gastar tokens.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execSync } = require('child_process');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfmod-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') console.log('   [warn]', m.text().slice(0, 600)); });
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const sleep = (ms) => w.waitForTimeout(ms);
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const bal = async () => (await w.evaluate(() => window.pf.aiWallet())).data.balance;
  await w.click('.hub-card:has-text("Asistente legal")'); await w.waitForSelector('#dq');
  await w.fill('#dq', 'contrato de arriendo de mi departamento'); await w.click('#mOk');
  await w.waitForSelector('.ai-model'); const opts = await w.$$eval('.ai-model b', (l) => l.map((x) => x.textContent));
  ok(/Contrato de Arriendo Sin codeudor/.test(opts[0]), 'propone primero el modelo de arriendo: ' + opts.join(' | '));
  ok(/No gasta tokens/.test(await w.textContent('#modalCard')), 'aclara que el modelo no gasta tokens');
  await w.click('#mOk');
  await w.waitForFunction(() => window.editor._state.tpl?.mode === 'fill', null, { timeout: 60000 }); await idle(); await sleep(1200);
  const st = await w.evaluate(() => ({ n: window.editor._state.tpl.def.fields.length, labels: window.editor._state.tpl.def.fields.map((f) => f.label), signers: window.editor._state.tpl.def.fields.filter((f) => f.signer).map((f) => f.signer.role + '/' + f.signer.attr), notice: window.editor._state.notice, modelo: window.editor._state.aiDoc?.modelo?.nombre }));
  console.log('   ', st.n, 'campos ·', st.labels.slice(0, 6).join(', '), '…');
  ok(st.n >= 25 && st.labels.includes('Arrendador: Nombre') && st.labels.includes('Canon de arriendo'), 'abre como formulario con los campos del modelo');
  ok(st.signers.includes('Arrendador/fullName') && st.signers.includes('Arrendatario/rut'), 'los firmantes salen del modelo (arrendador y arrendatario)');
  ok(/modelo «Contrato de Arriendo Sin codeudor o Aval\.» de Portalfirma/.test(st.notice), 'avisa que el documento viene del modelo');
  ok(await bal() === 5, 'no gasta tokens');
  const b64 = await w.evaluate(() => window.editor.exportBase64()); const f = path.resolve(__dirname, 'out-modelo.pdf'); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const t = execSync(`pdftotext "${f}" -`).toString().replace(/\s+/g, ' ');
  ok(/CONTRATO DE ARRENDAMIENTO/.test(t) && /RENTA Y PAGOS/.test(t) && /MASCOTAS/.test(t), 'el texto es el del modelo (cláusulas de Portalfirma)');
  ok((t.match(/19\.799/g) || []).length === 1, 'la leyenda de la Ley 19.799 aparece una sola vez');
  ok(!/\[\[|\|/.test(t), 'sin marcas internas');
  await w.screenshot({ path: path.resolve(__dirname, 'm1-modelo.png') });
  // sin modelo: redacta la IA directo
  await w.evaluate(() => window.studio.goHome?.() || window.show?.('home')); await sleep(300);
  await w.evaluate(() => window.Asistente.draftDialog('Contrato de prestación de servicios de diseño gráfico por 6 meses')); await w.waitForSelector('#dq'); await w.click('#mOk');
  await w.waitForSelector('#mOk:has-text("Entiendo"), .ai-model', { timeout: 20000 });
  ok(!(await w.$('.ai-model')), 'si no hay modelo que calce, redacta la IA sin preguntar');
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
