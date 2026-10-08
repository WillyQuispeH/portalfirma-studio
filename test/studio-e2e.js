const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs');
const F = (n) => path.resolve(__dirname, 'fixtures', n);
const out = (n) => path.resolve(__dirname, n);
// abre un archivo; si hay cambios sin guardar, elige "Descartar"
async function openDoc(w, p) {
  const pr = w.evaluate((pp) => window.editor.openPaths([pp], true), p);
  const m = await w.waitForSelector('#mNo', { timeout: 3000 }).catch(() => null); if (m) await m.click();
  await pr;
}
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.waitForSelector('.hub-card'); await w.waitForTimeout(400); await w.screenshot({ path: out('s1-home.png') });
  console.log('title:', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()));
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 180000 });
  // ---- 1) Edición de texto digital
  await w.evaluate((p) => window.editor.openPaths([p], true), F('contrato_prueba.pdf')); await w.waitForSelector('#edCanvas'); await idle(); await w.waitForTimeout(800);
  await w.click('.tool[data-tool="edittext"]'); await w.waitForSelector('.tb', { timeout: 15000 });
  const blocks = await w.evaluate(async () => (await window.editor._blocksFor(0)).map((b) => ({ full: b.text, t: b.text.slice(0, 60), f: b.family, sz: Math.round(b.size), al: b.align, det: b.detected })));
  console.log('blocks:', blocks.length, JSON.stringify(blocks.slice(0, 5).map(({ full, ...r }) => r)));
  await w.screenshot({ path: out('s2-blocks.png') });
  // editar el párrafo con el RUT del cliente: clic en el bloque que contiene "MARIA"
  const idx = blocks.findIndex((b) => /MARIA/.test(b.full));
  const bb = await w.evaluate((id) => { const n = document.querySelector(`.tb[data-block="b${id}"]`); const r = n.getBoundingClientRect(); return { x: r.right - 4, y: r.top + r.height / 2 }; }, idx);
  await w.mouse.click(bb.x, bb.y); await w.waitForSelector('.ov-rich.editing .rt');
  await w.keyboard.press('End'); await w.keyboard.type(' (EDITADO)');
  // seleccionar palabra y ponerla en negrita
  await w.evaluate(() => { const rt = document.querySelector('.ov-rich.editing .rt'); const tn = [...rt.childNodes].find((n) => n.nodeType === 3 && /CLIENTE/.test(n.data)) || rt.lastChild; const r = document.createRange(); const i = tn.data ? tn.data.indexOf('CLIENTE') : -1; if (i >= 0) { r.setStart(tn, i); r.setEnd(tn, i + 7); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } });
  await w.click('#pf-bold');
  await w.waitForTimeout(200); await w.screenshot({ path: out('s3-editing.png') });
  const panel = await w.textContent('#edPanel'); console.log('panel detected:', /Fuente detectada: [^\n]+/.exec(panel)?.[0]);
  await w.keyboard.press('Escape');
  const b64 = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(out('out-edit.pdf'), Buffer.from(b64, 'base64'));
  await w.screenshot({ path: out('s4-after.png') });
  // ---- 2) Agregar texto nuevo con Calibri
  await w.click('.tool[data-tool="text"]'); await w.selectOption('#pfFam', 'calibri'); const lay = await (await w.$('#edLayer')).boundingBox();
  await w.mouse.click(lay.x + 80, lay.y + 560); await w.keyboard.type('Nota agregada en Calibri con tildes: áéíóú ñ');
  await w.keyboard.press('Escape');
  const b64b = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(out('out-edit2.pdf'), Buffer.from(b64b, 'base64'));
  // ---- 3) Fotocopia: OCR + edición
  await openDoc(w, F('fotocopia.pdf'));
  await w.waitForSelector('[data-ocr="page"]', { timeout: 20000 }); await w.screenshot({ path: out('s5-scan-banner.png') });
  const t0 = Date.now(); await w.click('[data-ocr="page"]'); await w.waitForTimeout(500); await idle();
  console.log('OCR time', Date.now() - t0, 'ms');
  await w.waitForSelector('.tb', { timeout: 20000 });
  const ob = await w.evaluate(async () => (await window.editor._blocksFor(0)).map((b) => ({ t: b.text.replace(/\s+/g, ' ').slice(0, 40), sz: b.size.toFixed(1), fam: b.family, det: b.detected, al: b.align })));
  console.log('ocr blocks:', ob.length, JSON.stringify(ob));
  const k = ob.findIndex((b) => /Juan|declaro|Yo,/.test(b.t));
  const bb2 = await w.evaluate((id) => { const n = document.querySelector(`.tb[data-block="b${id}"]`); const r = n.getBoundingClientRect(); return { x: r.left + 30, y: r.top + 8 }; }, k >= 0 ? k : 1);
  await w.mouse.click(bb2.x, bb2.y); await w.waitForSelector('.ov-rich.editing .rt');
  await w.evaluate(() => { const rt = document.querySelector('.ov-rich.editing .rt'); rt.innerHTML = rt.innerHTML.replace(/Juan P[eé]rez Soto/, 'María González Rojas'); rt.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await w.keyboard.press('Escape'); await w.waitForTimeout(300); await w.screenshot({ path: out('s6-scan-edited.png') });
  const b64c = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(out('out-scan.pdf'), Buffer.from(b64c, 'base64'));
  // ---- 4) Plano: asistente
  await openDoc(w, F('plano_A0.pdf')); await idle();
  await w.evaluate(() => window.editor.planWizard()); await w.fill('#plName', 'Vivienda Los Aromos'); await w.fill('#plPro', 'Arq. Ana Díaz'); await w.click('#mOk');
  await w.waitForTimeout(800); await idle(); await w.waitForTimeout(800); await w.screenshot({ path: out('s7-plan.png') });
  const st = await w.evaluate(() => ({ count: window.editor._state.count, mb: (window.editor._state.bytes.length / 1048576).toFixed(1), notice: window.editor._state.notice }));
  console.log('plan:', JSON.stringify(st));
  const b64d = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(out('out-plan.pdf'), Buffer.from(b64d, 'base64'));
  // ---- 5) inicio y login a demanda
  await w.click('.tab[data-view="tpl"]'); await w.waitForSelector('#view-login:visible'); console.log('login requested for Notaría: OK');
  await w.click('#loginBtn'); await w.waitForSelector('.tpl-card, #tplBody', { timeout: 10000 }); console.log('after login →', await w.evaluate(() => [...document.querySelectorAll('.view')].find((v) => !v.classList.contains('hidden')).id));
  console.log('errors:', errs.filter((e) => !/Warning|deprecated|font/i.test(e)));
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
