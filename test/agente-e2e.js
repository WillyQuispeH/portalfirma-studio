// Agente Portalfirma: panel lateral con todas las herramientas del MCP (servidor y modelo simulados).
//  · Consultas sin confirmación; lo que cobra/envía pide confirmar; cancelar no ejecuta nada.
//  · Documento abierto → subir → extraer firmantes → enviar a firmar (con confirmación).
//  · Firma CDS: la clave y el código se escriben en campos protegidos y nunca llegan al modelo.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfag-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  const txt = (s) => w.textContent(s).then((t) => t || '');
  const ultimo = () => w.$$eval('.ag-msg.bot', (x) => x.map((e) => e.textContent).pop() || '');
  const decir = async (t) => { const n = (await w.$$('.ag-msg.bot')).length; await w.fill('#agQ', t); await w.press('#agQ', 'Enter'); if (await w.isVisible('#mOk').catch(() => false)) await w.click('#mOk'); return n; };
  const respuesta = async (n) => { await w.waitForFunction((k) => document.querySelectorAll('.ag-msg.bot').length > k, n, { timeout: 15000 }); await w.waitForTimeout(150); return ultimo(); };
  try {
    await w.setViewportSize({ width: 1500, height: 920 }); await w.waitForSelector('.hub-card'); await w.waitForTimeout(500);
    await w.evaluate(() => window.studio.goHome()); await w.waitForTimeout(300);
    ok(await w.isVisible('#agBtn') && await w.isVisible('#hubAgQ'), 'botón «Agente» en la barra y acceso desde el inicio');
    await w.click('#agBtn'); await w.waitForSelector('#agDrawer:not(.hidden)');
    ok((await w.$$('.ag-sug button')).length >= 4, 'panel lateral con sugerencias');
    await w.screenshot({ path: path.resolve(__dirname, 'ag1-panel.png') });

    let n = await decir('¿Cuál es mi saldo?'); let r = await respuesta(n);
    ok(/247\.424/.test(r) && /Saldo/.test(await txt('.ag-tool.ok')), 'consulta: usa la herramienta de saldo sin pedir confirmación');

    await w.click('#agTools'); await w.waitForSelector('.ag-tl > div'); ok((await w.$$('.ag-tl > div')).length === 13, 'dispone de las 13 herramientas del MCP'); await w.click('#agOk');

    n = await decir('Haz una recarga de saldo'); await w.waitForSelector('[data-conf]');
    ok(/Recargar saldo por \$10\.000/.test(await txt('[data-conf]')), 'recarga: pide confirmación con el detalle');
    await w.click('[data-conf] [data-no]'); r = await respuesta(n); ok(/no hice nada/.test(r), 'cancelar: no ejecuta la acción');
    n = await decir('Haz una recarga de saldo'); await w.waitForSelector('[data-conf]'); await w.click('[data-conf] [data-si]'); r = await respuesta(n);
    ok(await w.$('.ag-msg.bot a[data-url*="flow.cl"]') && /Pagar en Flow/.test(r), 'confirmar: entrega el enlace de pago de Flow');

    // documento abierto → subir → firmantes → enviar a firmar
    await w.evaluate((p) => window.editor.openPaths([p], true), path.join(__dirname, 'fixtures', 'contrato_prueba.pdf')); await w.waitForTimeout(1500);
    await w.click('#agClip'); await w.waitForSelector('#agDoc'); await w.click('#agDoc'); await w.waitForSelector('.ag-chip');
    ok(/contrato_prueba\.pdf/.test(await txt('#agAtt')), 'adjunta el documento abierto en el editor');
    n = await decir('Sube el documento, extrae los firmantes y envíalo a firmar'); await w.waitForSelector('[data-conf]', { timeout: 15000 });
    const conf = await txt('[data-conf]');
    ok(/Subir documento/.test(await txt('#agBody')) && /Extraer firmantes/.test(await txt('#agBody')), 'subió y extrajo firmantes sin preguntar');
    ok(/Enviar el documento a firmar/.test(conf) && /JUAN PEREZ SOTO \(prestador\)/.test(conf) && /MARIA GONZALEZ ROJAS/.test(conf), 'enviar a firmar: muestra firmantes en orden antes de confirmar');
    await w.screenshot({ path: path.resolve(__dirname, 'ag2-confirmar.png') });
    await w.click('[data-conf] [data-si]'); r = await respuesta(n); ok(/operación \d+/.test(r), 'operación creada tras confirmar');
    ok(/subido/.test(await txt('#agAtt')), 'el adjunto queda marcado como subido');

    // firma con certificado: datos protegidos
    n = await decir('Firma mis documentos pendientes con certificado cds'); await w.waitForSelector('[data-conf] input[data-sec="clave_certificado"]');
    ok(await w.getAttribute('[data-sec="clave_certificado"]', 'type') === 'password', 'la clave del certificado se pide en un campo protegido');
    await w.click('[data-conf] [data-si]'); ok(await w.isVisible('[data-conf] [data-si]'), 'no confirma sin la clave');
    await w.fill('[data-sec="clave_certificado"]', 'clave-demo'); await w.click('[data-conf] [data-si]');
    await w.waitForSelector('[data-conf] input[data-sec="segundo_factor"]', { timeout: 15000 });
    await w.fill('[data-conf] [data-sec="clave_certificado"]', 'clave-demo'); await w.fill('[data-sec="segundo_factor"]', '123456'); await w.click('[data-conf] [data-si]');
    r = await respuesta(n); ok(/signedCount/.test(r) || /Listo/.test(r), 'firma con certificado completada');
    const conv = await app.evaluate(() => JSON.stringify(global.__agente._estado().messages));
    ok(!/clave-demo|\b123456\b/.test(conv) && /••••/.test(conv), 'la clave y el código nunca llegan al modelo (y se tachan del resultado)');
    const logs = await app.evaluate(() => JSON.stringify(global.__agente.actividad()));
    ok(!/clave-demo|\b123456\b/.test(logs) && /Enviar el documento a firmar/.test(logs) && /Cancelado/.test(logs), 'registro de actividad sin datos sensibles');
    ok(!/JVBER/.test(conv), 'el contenido del PDF no pasa por el modelo');
    await w.click('#agLog'); await w.waitForSelector('.ag-tl > div'); ok((await w.$$('.ag-tl > div')).length >= 5, 'pantalla de actividad'); await w.click('#agOk');
    await w.screenshot({ path: path.resolve(__dirname, 'ag3-cds.png') });

    await w.click('#agNew'); await w.waitForTimeout(200); ok(await w.isVisible('.ag-empty') && !(await w.$('.ag-chip')), 'nueva conversación');
    await w.click('#agClose'); await w.evaluate(() => window.studio.goHome()); await w.waitForSelector('#hubAgQ');
    await w.fill('#hubAgQ', '¿Quién falta por firmar en la operación 4424?'); n = 0; await w.press('#hubAgQ', 'Enter');
    r = await respuesta(0); ok(await w.isVisible('#agDrawer') && /Detalle de operación/.test(await txt('#agBody')), 'desde el inicio abre el agente y consulta la operación');
    const tk = await w.evaluate(async () => (await window.pf.aiWallet()).data); ok(tk.balance < 5, `cobra tokens del asistente (saldo ${tk.balance})`);
    ok(!errs.length, 'sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
    console.log('OK agente');
  } catch (e) { console.error(e.message); await w.screenshot({ path: path.resolve(__dirname, 'ag-error.png') }); process.exitCode = 1; } finally { await app.close(); }
})();
