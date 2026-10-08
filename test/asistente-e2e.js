// Asistente legal (IA) en modo de prueba: ajustes con la clave, revisar y aplicar, chequeos locales, redactar y preguntar.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execSync } = require('child_process');
const F = (n) => path.resolve(__dirname, 'fixtures', n);
const out = (n) => path.resolve(__dirname, n);
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfai-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1', PF_AI_MANAGED: 'none' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const sleep = (ms) => w.waitForTimeout(ms);

  console.log('Inicio');
  ok(await w.locator('.hub-card:has-text("Asistente legal")').count() === 1, 'tarjeta «Asistente legal» en el inicio');

  console.log('Chequeos exactos (sin IA)');
  const lc = await w.evaluate(() => window.Asistente._localChecks('Don X, RUT 12.345.678-9, pagará $1.250.000 (un millón doscientos mil pesos). RUT 12.345.678-5 ok. $500.000 (quinientos mil pesos).'));
  ok(lc.length === 2, `2 problemas detectados (${lc.length})`);
  ok(lc.some((x) => /12\.345\.678-9/.test(x.cita) && /terminar en 5/.test(x.explicacion)), 'RUT con dígito verificador incorrecto');
  ok(lc.some((x) => /no coincide/.test(x.explicacion)), 'monto en cifras distinto al monto en palabras');
  ok(await w.evaluate(() => window.Asistente._replaceInHtml('El <b>precio</b> sera de', 'precio sera', 'precio será')) === 'El <b>precio será</b> de', 'reemplazo que cruza una negrita');

  console.log('Ajustes y clave');
  await w.evaluate((p) => window.editor.openPaths([p], true), F('contrato_prueba.pdf')); await idle(); await sleep(800);
  await w.click('#edAi'); await w.waitForSelector('.ai-head');
  ok(await w.locator('#aiReview').count() === 1, 'panel del asistente abierto en «Revisar»');
  await w.click('#aiSettings'); await w.waitForSelector('#aiKey');
  ok(await w.getAttribute('#aiKey', 'type') === 'password', 'el campo de la clave es oculto');
  await w.fill('#aiKey', 'no-es-una-clave'); await w.click('#aiSave'); await sleep(400);
  ok(/formato/.test(await w.textContent('#toast')), 'rechaza una clave con formato inválido');
  const fake = 'sk-test-' + 'x'.repeat(30) + 'AB12';
  await w.fill('#aiKey', fake); await w.click('#aiSave'); await sleep(600);
  const st = await w.evaluate(() => window.pf.aiStatus());
  ok(st.ok && st.data.keyEnd === 'AB12' && !JSON.stringify(st).includes(fake), 'la clave se guarda y nunca vuelve a la ventana (solo los 4 últimos)');
  const cfg = fs.readFileSync(path.join(userData, 'portalfirma.json'), 'utf8');
  ok(!cfg.includes(fake), 'la clave no queda en texto plano en el disco');

  console.log('Revisar');
  await w.waitForSelector('#aiReview'); await w.click('#aiReview');
  await w.waitForSelector('#mOk:has-text("Entiendo")'); ok(/se envía a/.test(await w.textContent('#modalCard')), 'pide consentimiento antes de enviar el texto'); await w.click('#mOk');
  await w.waitForSelector('.ai-item', { timeout: 30000 }); await idle();
  const n = await w.locator('.ai-item').count(); ok(n === 4, `4 observaciones (${n})`);
  ok(await w.locator('.ai-item.g-alta').first().locator('.ai-tag').textContent().then((t) => /Falta/.test(t)), 'la más grave primero (falta plazo)');
  ok(await w.locator('mark.verify').count() >= 1, 'la cita legal queda marcada «por verificar»');
  await w.screenshot({ path: out('ai1-revision.png') });
  // escribir en otra parte del panel no lo reconstruye
  const card = w.locator('.ai-item:has-text("asesoria")'); await card.locator('[data-apply]').click(); await idle(); await sleep(800);
  ok(/aplicada/.test(await card.textContent()), 'sugerencia marcada como aplicada');
  await w.locator('.ai-item:has-text("sera de")').locator('[data-apply]').click(); await idle(); await sleep(800);
  await w.locator('.ai-item:has-text("fecha ni forma")').locator('[data-skip]').click(); await sleep(300);
  ok(await w.locator('.ai-item.done').count() === 3, '2 aplicadas y 1 descartada');
  await w.keyboard.press('Escape'); await w.keyboard.press('Escape'); await sleep(300);
  const b64 = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(out('out-asistente.pdf'), Buffer.from(b64, 'base64'));
  const txt = execSync(`pdftotext "${out('out-asistente.pdf')}" -`).toString().replace(/\s+/g, ' ');
  ok(/servicios de asesoría al CLIENTE/.test(txt) && /El precio será de \$500\.000/.test(txt), 'las correcciones quedan en el PDF');
  ok(!/asesoria|precio sera/.test(txt), 'el texto con error ya no está (ni oculto)');
  await w.screenshot({ path: out('ai2-aplicado.png') });

  console.log('Preguntar');
  await w.click('[data-aitab="ask"]'); await w.waitForSelector('#aiQ');
  await w.fill('#aiQ', '¿Cuánto es el precio?'); await w.press('#aiQ', 'Enter');
  await w.waitForSelector('.ai-msg.assistant', { timeout: 30000 }); await idle();
  ok(/500\.000/.test(await w.textContent('.ai-msg.assistant')), 'responde sobre el documento');
  const sent = await w.evaluate(() => window.editor._state.ai.chat.find((m) => m.ctx)?.content || '');
  ok(/asesoría/.test(sent), 'el asistente lee el documento con las correcciones');

  console.log('Redactar');
  await w.click('[data-aitab="draft"]'); await w.waitForSelector('#aiDraftQ');
  const tabs0 = await w.evaluate(() => window.editor.tabCount());
  await w.fill('#aiDraftQ', 'Contrato de arriendo de oficina por 12 meses con garantía de un mes.'); await w.click('#aiDraft');
  await w.waitForSelector('#aiFree'); await w.click('#aiFree');
  await w.waitForFunction((t) => window.editor.tabCount() > t && window.editor._state.tpl?.mode === 'fill', tabs0, { timeout: 60000 }); await idle(); await sleep(1200);
  const g = await w.evaluate(() => ({ name: window.editor._state.name, count: window.editor._state.count }));
  ok(/CONTRATO DE ARRENDAMIENTO/i.test(g.name), `borrador abierto en pestaña nueva (${g.name})`);
  const b2 = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(out('out-borrador.pdf'), Buffer.from(b2, 'base64'));
  const t2 = execSync(`pdftotext "${out('out-borrador.pdf')}" -`).toString().replace(/\s+/g, ' ');
  ok(/SEGUNDO: Plazo/.test(t2) && /\[Arrendador: nombre\]/.test(t2) && await w.evaluate(() => window.editor._state.tpl?.mode === 'fill'), 'el borrador tiene cláusulas y abre como formulario');
  await w.screenshot({ path: out('ai3-borrador.png') });

  console.log('Borrar la clave');
  await w.click('.dtab >> nth=0').catch(() => {}); await sleep(500);
  await w.evaluate(() => window.pf.aiConfig({ key: '' }));
  ok(!(await w.evaluate(() => window.pf.aiStatus())).data.keyEnd, 'clave borrada');

  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
