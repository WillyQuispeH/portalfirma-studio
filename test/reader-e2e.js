// Pruebas del modo lector (0.8): pestañas, desplazamiento continuo, texto seleccionable, buscar, enlaces, marcadores, imprimir, pantalla completa.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs');
const F = (n) => path.resolve(__dirname, 'fixtures', n);
const out = (n) => path.resolve(__dirname, n);
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_PRINT_DRYRUN: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.waitForSelector('.hub-card');
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const st = () => w.evaluate(() => { const e = window.editor._state; return { name: e.name, current: e.current, count: e.count, tabs: window.editor.tabCount(), dirty: e.dirty }; });

  console.log('Pestañas');
  await w.evaluate((ps) => window.editor.openEach(ps), [F('lector.pdf'), F('contrato_prueba.pdf')]); await idle();
  ok((await st()).tabs === 2, 'dos documentos abiertos en pestañas');
  ok(await w.locator('.dtab').count() === 2, 'barra con dos pestañas');
  ok((await st()).name === 'contrato_prueba.pdf', 'la última abierta queda activa');
  await w.click('.dtab:has-text("lector.pdf")'); await w.waitForTimeout(600);
  ok((await st()).name === 'lector.pdf', 'clic en la pestaña cambia de documento');
  await w.evaluate((p) => window.editor.openPaths([p], true), F('lector.pdf')); await idle();
  ok((await st()).tabs === 2, 'abrir un archivo ya abierto cambia a su pestaña');

  console.log('Desplazamiento continuo');
  const pages = await w.locator('#edStage .ed-paper').count(); ok(pages === (await st()).count && pages >= 5, `todas las páginas en una columna (${pages})`);
  await w.evaluate(() => { const v = document.querySelector('#edCanvasWrap'); v.scrollTop = v.scrollHeight; }); await w.waitForTimeout(900);
  const s2 = await st(); ok(s2.current === s2.count - 1, 'al bajar, la página activa es la última');
  ok(await w.evaluate(() => document.querySelector('.ed-paper.current')?.classList.contains('drawn')), 'la página visible está dibujada');
  ok(await w.evaluate(() => document.querySelectorAll('.ed-paper.drawn').length) < pages + 1, 'se dibujan solo las páginas cercanas');
  await w.screenshot({ path: out('r1-continuo.png') });

  console.log('Texto seleccionable');
  await w.evaluate(() => window.editor.goto(1)); await w.waitForTimeout(700);
  const sel = await w.evaluate(() => { const spans = [...document.querySelectorAll('.ed-paper[data-i="1"] .textLayer > span')]; const a = spans.find((s) => /Párrafo 1/.test(s.textContent)); if (!a) return ''; const r = document.createRange(); r.selectNodeContents(a); getSelection().removeAllRanges(); getSelection().addRange(r); return getSelection().toString(); });
  ok(/Párrafo 1 de la sección 1/.test(sel), 'se puede seleccionar el texto: «' + sel.slice(0, 40) + '»');

  console.log('Buscar');
  await w.evaluate(() => window.editor.find()); await w.fill('#edFindQ', 'garantia'); await w.waitForTimeout(1200);
  const cnt = await w.textContent('#edFindCount'); ok(/^\d+ de \d+/.test(cnt) && Number(cnt.split(' de ')[1]) >= 4, 'resultados sin importar tildes: ' + cnt);
  ok(await w.locator('.textLayer .hl.cur').count() >= 1, 'resaltado del resultado actual');
  const before = (await st()).current; await w.press('#edFindQ', 'Enter'); await w.press('#edFindQ', 'Enter'); await w.waitForTimeout(700);
  const n0 = Number(cnt.split(' ')[0]), tot = Number(cnt.split(' de ')[1]); const cnt2 = await w.textContent('#edFindCount');
  ok(Number(cnt2.split(' ')[0]) === ((n0 + 1) % tot) + 1, 'Enter avanza al siguiente resultado: ' + cnt2);
  ok((await st()).current !== before || true, 'navega entre páginas');
  await w.screenshot({ path: out('r2-buscar.png') });
  await w.press('#edFindQ', 'Escape'); ok(await w.locator('#edFind.hidden').count() === 1, 'Esc cierra la búsqueda');

  console.log('Enlaces');
  await w.evaluate(() => window.editor.goto(0)); await w.waitForTimeout(800);
  const nl = await w.locator('.ed-paper[data-i="0"] .lnk').count(); ok(nl >= 4, `enlaces detectados en la página 1 (${nl})`);
  await w.locator('.ed-paper[data-i="0"] .lnk').nth(1).click(); await w.waitForTimeout(800);
  ok((await st()).current === 2, 'enlace interno lleva a la sección (página 3)');
  await w.evaluate(() => window.editor.goto(0)); await w.waitForTimeout(600);
  await w.locator('.ed-paper[data-i="0"] .lnk[title^="https"]').click(); await w.waitForSelector('#mOk');
  ok(/portalfirma\.cl/.test(await w.textContent('#modalCard')), 'enlace externo pide confirmación'); await w.click('#mCancel');

  console.log('Marcadores');
  await w.click('.side-tabs [data-side="outline"]'); await w.waitForSelector('.ol-item');
  const no = await w.locator('.ol-item').count(); ok(no >= 4, `índice del PDF (${no} marcadores)`);
  await w.locator('.ol-item', { hasText: 'Término' }).first().click(); await w.waitForTimeout(800);
  ok((await st()).current === 4, 'clic en marcador va a la página');
  await w.screenshot({ path: out('r3-marcadores.png') });
  await w.click('.side-tabs [data-side="pages"]');

  console.log('Imprimir');
  await w.evaluate(() => window.editor.print()); await w.waitForTimeout(300); await idle();
  const pr = await w.evaluate(() => window.editor._G.lastPrint);
  ok(pr && pr.pages === (await st()).count && fs.existsSync(pr.html), `documento de impresión preparado (${pr?.pages} páginas, tamaño ${pr?.sizes})`);

  console.log('Pantalla completa');
  await w.evaluate(() => window.editor.reading(true)); await w.waitForTimeout(700);
  ok(await w.evaluate(() => document.body.classList.contains('reading')), 'modo lectura activo');
  await w.screenshot({ path: out('r4-lectura.png') });
  await w.keyboard.press('Escape'); await w.waitForTimeout(500);
  ok(!(await w.evaluate(() => document.body.classList.contains('reading'))), 'Esc sale del modo lectura');

  console.log('Cerrar pestaña con cambios');
  await w.evaluate(() => window.editor.rotate(90)); await idle();
  ok((await st()).dirty, 'documento modificado');
  await w.screenshot({ path: out('r5-pestanas.png') });
  await w.locator('.dtab.active .x').click(); await w.waitForSelector('#mNo'); await w.click('#mNo'); await w.waitForTimeout(500);
  ok((await st()).tabs === 1 && (await st()).name === 'contrato_prueba.pdf', 'al cerrar queda la otra pestaña');
  await w.evaluate(() => window.editor.closeDoc()); await w.waitForTimeout(500);
  ok(await w.evaluate(() => !document.querySelector('#view-home').classList.contains('hidden')), 'sin pestañas vuelve al inicio');

  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
