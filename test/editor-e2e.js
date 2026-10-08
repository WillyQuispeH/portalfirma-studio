const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs');
const F = (n) => path.resolve(__dirname, 'fixtures', n);
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1400, height: 900 });
  await w.click('#loginBtn'); await w.waitForSelector('#dropzone:visible');
  await w.click('.tab[data-view="editor"]'); await w.waitForSelector('#edOpenBtn');
  await w.screenshot({ path: 'test/e0-empty.png' });
  const waitIdle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden'), null, { timeout: 120000 });
  // 1) combinar: Word + Excel + imagen + PDF
  const t0 = Date.now();
  await w.evaluate((ps) => window.editor.openPaths(ps, true), [F('contrato.docx'), F('cotizacion.xlsx'), F('cedula.jpg'), F('contrato_prueba.pdf')]);
  await w.waitForSelector('#edCanvas'); await waitIdle(); await w.waitForTimeout(800);
  const count1 = await w.evaluate(() => window.editor._state.count);
  console.log('combined pages:', count1, 'in', Date.now() - t0, 'ms');
  await w.screenshot({ path: 'test/e1-combined.png' });
  // 2) herramientas en página 1: texto, tapar, sello, imagen omitida
  const box = await (await w.$('#edLayer')).boundingBox();
  await w.click('.tool[data-tool="text"]'); await w.mouse.click(box.x + 60, box.y + 40);
  await w.keyboard.type('Anexo N° 1 — revisado'); await w.click('.tool[data-tool="select"]');
  await w.click('.tool[data-tool="whiteout"]'); await w.mouse.move(box.x + 300, box.y + 200); await w.mouse.down(); await w.mouse.move(box.x + 450, box.y + 230); await w.mouse.up();
  await w.click('.tool[data-tool="stamp"]'); await w.mouse.move(box.x + 380, box.y + 500); await w.mouse.down(); await w.mouse.move(box.x + 620, box.y + 560); await w.mouse.up();
  await w.click('.tool[data-tool="select"]'); await w.waitForTimeout(300);
  await w.screenshot({ path: 'test/e2-tools.png' });
  // 3) organizar: mover última página al inicio, rotar la 2
  await w.evaluate(async () => { await window.editor.move(window.editor._state.count - 1, 0); }); await waitIdle();
  await w.evaluate(async () => { window.editor._state.selected = new Set([1]); await window.editor.rotate(90); window.editor._state.selected.clear(); }); await waitIdle();
  const b64a = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync('test/out-combined.pdf', Buffer.from(b64a, 'base64'));
  // 4) plano A0: abrir, marcar cajetín con 2 firmantes, comprimir
  await w.evaluate((p) => window.editor.openPaths([p], true), F('plano_A0.pdf')); await waitIdle(); await w.waitForTimeout(1500);
  const size0 = await w.evaluate(() => window.editor._state.bytes.length);
  const box2 = await (await w.$('#edLayer')).boundingBox();
  await w.click('.tool[data-tool="sig"]'); await w.fill('#oSigner', 'Propietario'); await w.dispatchEvent('#oSigner', 'change');
  // el cajetín está abajo a la derecha: ~ (W-640..W-40, 40..300) en puntos → en pantalla proporcional
  const sx = (x) => box2.x + x / 3370.39 * box2.width, sy = (y) => box2.y + y / 2383.94 * box2.height;
  await w.mouse.move(sx(3370 - 630), sy(2384 - 150)); await w.mouse.down(); await w.mouse.move(sx(3370 - 350), sy(2384 - 50)); await w.mouse.up();
  await w.click('.tool[data-tool="sig"]'); await w.fill('#oSigner', 'Arquitecto'); await w.dispatchEvent('#oSigner', 'change');
  await w.mouse.move(sx(3370 - 300), sy(2384 - 140)); await w.mouse.down(); await w.mouse.move(sx(3370 - 50), sy(2384 - 50)); await w.mouse.up();
  await w.click('.tool[data-tool="select"]'); await w.screenshot({ path: 'test/e3-plano.png' });
  console.log('box2', JSON.stringify(box2), 'overlays:', JSON.stringify(await w.evaluate(() => Object.fromEntries(Object.entries(window.editor._state.overlays).map(([k, v]) => [k, v.map((o) => o.type + ':' + (o.label || '') + '@' + Math.round(o.x) + ',' + Math.round(o.y))])))), 'current', await w.evaluate(() => window.editor._state.current));
  // enviar sin comprimir → debe avisar > 20 MB
  await w.click('#edSend'); await w.waitForSelector('#mOk', { timeout: 60000 }); console.log('size warning:', (await w.textContent('.modal-card h2')));
  await w.screenshot({ path: 'test/e4-toobig.png' });
  await w.click('#mOk'); await w.waitForTimeout(500); await waitIdle(); await w.waitForTimeout(500);
  const size1 = await w.evaluate(() => window.editor._state.bytes.length);
  console.log('plan size', (size0 / 1e6).toFixed(1), 'MB →', (size1 / 1e6).toFixed(1), 'MB');
  await w.evaluate(() => window.editor.number()); await w.click('#mOk'); await waitIdle();
  const b64b = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync('test/out-plano.pdf', Buffer.from(b64b, 'base64'));
  await w.screenshot({ path: 'test/e5-plano-final.png' });
  // 5) enviar a firmar → debe ir al flujo de revisión
  await w.click('#edSend'); await w.waitForSelector('#view-review:visible', { timeout: 60000 });
  console.log('send → review OK');
  console.log('page errors:', errs.filter((e) => !/Warning|font/i.test(e)));
  await app.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
