// 0.30 — editor: mano, recuadro de texto, modelos de texto, selección de área (con imágenes del PDF), zoom lateral, panel con pestañas y ancho ajustable.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe30-'));
  const doc = await PDFDocument.create(); const pg = doc.addPage([595, 842]); const f = await doc.embedFont(StandardFonts.Helvetica);
  pg.drawText('CONTRATO DE PRUEBA CON LOGO', { x: 60, y: 780, size: 16, font: f });
  const png = await doc.embedPng(fs.readFileSync(path.join(__dirname, 'fixtures', 'foto.png')));
  pg.drawImage(png, { x: 380, y: 640, width: 140, height: 100 });
  pg.drawText('Texto del cuerpo del contrato.', { x: 60, y: 600, size: 11, font: f });
  const file = path.join(tmp, 'logo.pdf'); fs.writeFileSync(file, await doc.save());
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfe30u-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const sleep = (ms) => w.waitForTimeout(ms);
  await w.evaluate((p) => window.editor.openPaths([p], true), file); await w.waitForSelector('#edCanvas', { timeout: 30000 }); await sleep(800);
  ok(await w.$('.tool[data-tool="hand"]'), 'herramienta «Mover» (mano) en la barra');
  ok(await w.evaluate(() => getComputedStyle(document.querySelector('#edOcr')).backgroundImage === getComputedStyle(document.querySelector('#edSend')).backgroundImage), '«Reconocer texto» con el mismo azul de «Enviar a firmar»');
  const box = async () => { const b = await w.$('#edCanvas'); return b.boundingBox(); };
  // recuadro de texto
  await w.click('.tool[data-tool="text"]'); let b = await box();
  await w.mouse.move(b.x + 80, b.y + 300); await w.mouse.down(); await w.mouse.move(b.x + 260, b.y + 330, { steps: 6 }); await w.mouse.up(); await sleep(200);
  ok(await w.evaluate(() => !!document.activeElement?.closest('.ov-rich.editing')), 'dibujas el recuadro y quedas escribiendo dentro');
  await w.keyboard.type('Hola mundo');
  const tb = await w.evaluate(() => { const o = window.editor._state.overlays[0].at(-1); return { w: o.w, html: o.html, tool: window.editor._state.tool, n: window.editor._state.overlays[0].length }; });
  ok(tb.html.includes('Hola mundo') && tb.w > 100 && tb.w < 200, `el ancho es el del recuadro dibujado (${Math.round(tb.w)} pt)`);
  ok(tb.tool === 'select', 'después de crear el texto vuelve a Seleccionar (no crea otro con cada clic)');
  await w.keyboard.press('Escape');
  // modelos de texto
  await w.click('[data-preset="titlePar"]'); await sleep(300);
  const pr = await w.evaluate(() => window.editor._state.overlays[0].slice(-2).map((o) => ({ ph: o.ph, size: o.size, html: o.html })));
  ok(pr.length === 2 && pr[0].size === 20 && pr[1].size === 11 && pr.every((x) => x.ph), 'modelo «Título y párrafo»: dos textos de ejemplo con distinto tamaño');
  await w.keyboard.type('Mi título');
  const t1 = await w.evaluate(() => window.editor._state.overlays[0].slice(-2)[0]);
  ok(/Mi título/.test(t1.html) && !/Agrega/.test(t1.html) && !t1.ph, 'al escribir se reemplaza el texto de ejemplo');
  await w.keyboard.press('Escape'); await w.keyboard.press('Escape');
  // selección de área con la imagen del PDF (debe quedar completa dentro)
  await w.click('.tool[data-tool="select"]'); b = await box(); const k = b.width / 595;
  const L = (x) => b.x + x * k, Tp = (y) => b.y + y * k;
  await w.mouse.move(L(370), Tp(110)); await w.mouse.down(); await w.mouse.move(L(450), Tp(150), { steps: 5 }); await w.mouse.up(); await sleep(600);
  ok(!(await w.evaluate(() => window.editor._state.overlays[0].some((o) => o.type === 'image'))), 'un recuadro que no encierra la imagen completa no la toma');
  await w.mouse.move(L(370), Tp(92)); await w.mouse.down(); await w.mouse.move(L(530), Tp(212), { steps: 5 }); await w.mouse.up();
  await w.waitForFunction(() => window.editor._state.overlays[0].some((o) => o.type === 'image'), null, { timeout: 15000 });
  const im = await w.evaluate(() => { const s = window.editor._state; const o = s.overlays[0].find((x) => x.type === 'image'); return { x: o.x, y: o.y, w: o.w, h: o.h, sel: s.sel === o.id, cover: s.overlays[0].some((x) => x.type === 'whiteout' && x.lift) }; });
  ok(Math.abs(im.x - 380) < 3 && Math.abs(im.y - 102) < 3 && Math.abs(im.w - 140) < 3 && im.sel && im.cover, 'encerrando la imagen completa se vuelve un objeto movible (y su lugar se cubre)');
  // mover con la mano
  await w.click('.tool[data-tool="hand"]'); b = await box();
  const ib = await (await w.$('.ov-image')).boundingBox();
  await w.mouse.move(ib.x + 20, ib.y + 20); await w.mouse.down(); await w.mouse.move(ib.x - 80, ib.y + 60, { steps: 6 }); await w.mouse.up(); await sleep(200);
  const im2 = await w.evaluate(() => window.editor._state.overlays[0].find((x) => x.type === 'image'));
  ok(im2.x < im.x - 50 && im2.y > im.y + 25, 'la mano mueve la imagen');
  ok(!(await w.evaluate(() => !!window.editor._state.editing)), 'la mano no entra a editar');
  // varios objetos a la vez
  await w.click('.tool[data-tool="select"]'); b = await box();
  await w.mouse.move(b.x + 5, b.y + 5); await w.mouse.down(); await w.mouse.move(b.x + b.width - 5, b.y + b.height * 0.6, { steps: 6 }); await w.mouse.up(); await sleep(400);
  const multi = await w.evaluate(() => window.editor._state.multi.length);
  ok(multi >= 3, `seleccionar un área toma varios objetos (${multi})`);
  // zoom: se puede desplazar hacia los lados
  for (let i = 0; i < 6; i++) await w.evaluate(() => window.editor.zoom(1));
  await sleep(800);
  const z = await w.evaluate(() => { const v = document.querySelector('#edCanvasWrap'); const p = document.querySelector('#edStage .ed-paper.current'); v.scrollLeft = 0; const left0 = p.getBoundingClientRect().left - v.getBoundingClientRect().left; v.scrollLeft = 99999; return { sw: v.scrollWidth, cw: v.clientWidth, left0, sl: v.scrollLeft }; });
  ok(z.sw > z.cw && z.left0 >= 0 && z.sl > 0, 'con zoom se ve el borde izquierdo y se puede desplazar hacia los lados');
  await w.evaluate(() => window.editor.zoom(0)); await sleep(500);
  // panel: pestañas y ancho
  ok(await w.$('#edPanelTabs [data-pt="tpl"]') && await w.$('#edPanelTabs [data-pt="ai"]'), 'pestañas Edición · Asistente · Plantilla');
  await w.click('#edPanelTabs [data-pt="ai"]'); await sleep(500);
  ok(await w.evaluate(() => !!window.editor._state.ai?.open), 'abre el asistente');
  await w.click('#edPanelTabs [data-pt="tpl"]'); await sleep(500);
  ok(await w.evaluate(() => !window.editor._state.ai?.open && window.editor._state.tpl?.mode === 'design'), 'desde el asistente se pasa a Plantilla');
  await w.click('#edPanelTabs [data-pt="edit"]'); await sleep(300);
  const r = await (await w.$('#edResizer')).boundingBox(); const w0 = (await (await w.$('#edPanelWrap')).boundingBox()).width;
  await w.mouse.move(r.x + 3, r.y + 200); await w.mouse.down(); await w.mouse.move(r.x - 150, r.y + 200, { steps: 8 }); await w.mouse.up(); await sleep(300);
  const w1 = (await (await w.$('#edPanelWrap')).boundingBox()).width;
  ok(w1 > w0 + 100, `la barra derecha se ensancha arrastrando su borde (${Math.round(w0)} → ${Math.round(w1)} px)`);
  await w.screenshot({ path: path.resolve(__dirname, 'e30-editor.png') });
  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
