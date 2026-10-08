// Cambiar el tamaño de un texto reconocido por OCR (con trozos de otro tamaño) y de una selección.
const { _electron: electron } = require('playwright'); const path = require('path');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  await w.evaluate((p) => window.editor.openPaths([p], true), path.join(__dirname, 'fixtures', 'fotocopia.pdf')); await idle();
  await w.waitForSelector('[data-ocr="page"]', { timeout: 20000 }); await w.click('[data-ocr="page"]'); await w.waitForTimeout(500); await idle();
  await w.waitForSelector('.tb', { timeout: 20000 });
  const bb = await w.evaluate(() => { const r = document.querySelectorAll('.tb')[1].getBoundingClientRect(); return { x: r.left + 20, y: r.top + 8 }; });
  await w.mouse.click(bb.x, bb.y); await w.waitForSelector('.ov-rich.editing .rt'); await idle(); await w.waitForTimeout(300);
  // simula trozos con otro tamaño (como deja el OCR)
  await w.evaluate(() => { const o = Object.values(window.editor._state.overlays).flat().at(-1); o.html = `<span style="font-size:${(o.size * 1.2).toFixed(1)}px">${o.html}</span>`; document.querySelector('.ov-rich.editing .rt').innerHTML = o.html; });
  const s0 = await w.evaluate(() => Object.values(window.editor._state.overlays).flat().at(-1).size);
  // sin selección: botón achicar (todo el párrafo)
  await w.evaluate(() => getSelection().collapseToStart());
  await w.click('#pfSizeDown'); await w.click('#pfSizeDown'); await w.waitForTimeout(200);
  const r1 = await w.evaluate(() => { const o = Object.values(window.editor._state.overlays).flat().at(-1); return { size: o.size, inner: Number(/font-size:([\d.]+)px/.exec(o.html)[1]) }; });
  ok(r1.size < s0 - 0.5, `párrafo achicado de ${s0} a ${r1.size} pt (antes se agrandaba)`);
  ok(r1.inner < s0 * 1.2 - 0.5, `los trozos de otro tamaño también se achican (${(s0 * 1.2).toFixed(1)} → ${r1.inner})`);
  // escribir el tamaño a mano mientras el texto está en edición (el valor no se pisa)
  await w.click('#pfSize', { clickCount: 3 }); await w.keyboard.type('9.5', { delay: 120 }); await w.waitForTimeout(200);
  ok(await w.inputValue('#pfSize') === '9.5', 'lo que se escribe no se borra mientras se escribe');
  await w.press('#pfSize', 'Enter'); await w.waitForTimeout(200);
  ok(await w.evaluate(() => { const o = Object.values(window.editor._state.overlays).flat().at(-1); return Math.abs(Number(/font-size:([\d.]+)px/.exec(o.html)[1]) - 9.5) < 0.06 || Math.abs(o.size - 9.5) < 0.06; }), 'tamaño escrito a mano aplicado al texto bajo el cursor (9,5 pt)');
  // con una selección: solo esas palabras
  await w.evaluate(() => { const rt = document.querySelector('.ov-rich.editing .rt'); rt.focus(); const tw = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT); const n = tw.nextNode(); const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, Math.min(5, n.data.length)); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const before = await w.evaluate(() => currentFmt().size);
  await w.click('#pfSizeUp'); await w.waitForTimeout(200);
  const sel = await w.evaluate(() => { const o = Object.values(window.editor._state.overlays).flat().at(-1); return [...o.html.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])); });
  ok(sel.some((v) => Math.abs(v - (before + 0.5)) < 0.06), `solo la selección sube 0,5 pt (${before} → ${(before + 0.5).toFixed(1)})`);
  await w.screenshot({ path: path.join(__dirname, 'z1-tamano.png') });
  console.log('errores:', errs); await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
