// Plantillas con campos: diseñar sobre un contrato, guardar, llenar y generar. Más el borrado real del texto.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execSync } = require('child_process');
const F = (n) => path.resolve(__dirname, 'fixtures', n);
const out = (n) => path.resolve(__dirname, n);
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfst-')); // biblioteca de plantillas limpia
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const sleep = (ms) => w.waitForTimeout(ms);
  // selecciona `text` dentro del párrafo en edición
  const select = (text) => w.evaluate((t) => {
    const rt = document.querySelector('.ov-rich.editing .rt'); const walker = document.createTreeWalker(rt, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { if (n.parentElement.closest('.pf-field')) continue; const k = n.data.indexOf(t); if (k >= 0) { const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k + t.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } }
    return false;
  }, text);
  // abre para editar el párrafo que contiene `text`
  const openBlock = async (text) => {
    await w.keyboard.press('Escape'); await w.keyboard.press('Escape'); await sleep(200);
    const pos = await w.evaluate(async (t) => {
      const E = window.editor._state; const o = (E.overlays[E.current] || []).find((x) => x.type === 'rich' && x.html.replace(/<[^>]+>/g, '').includes(t));
      if (o) { const r = document.querySelector(`.ov[data-id="${o.id}"] .rt`).getBoundingClientRect(); return { x: r.right - 8, y: r.top + 6, dbl: true }; }
      const bl = await window.editor._blocksFor(E.current); const b = bl.find((x) => x.text.includes(t)); const n = document.querySelector(`.tb[data-block="${b.id}"]`); const r = n.getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6 };
    }, text);
    if (pos.dbl) await w.mouse.dblclick(pos.x, pos.y); else await w.mouse.click(pos.x, pos.y);
    await w.waitForSelector('.ov-rich.editing .rt'); await idle(); await sleep(300);
  };
  const makeField = async (text, { label, type, role, attr, words } = {}) => {
    ok(await select(text), `seleccionado «${text}»`);
    await w.click('#tplConv'); await w.waitForSelector('#fLabel');
    if (label) await w.fill('#fLabel', label);
    if (type) await w.selectOption('#fType', type);
    if (words) await w.selectOption('#fWords', words);
    if (role) { await w.check('#fSigner'); await w.fill('#fRole', role); await w.selectOption('#fAttr', attr); }
    await w.click('#mOk'); await sleep(400);
  };

  console.log('Borrado real del texto («texto transparente»)');
  await w.evaluate((p) => window.editor.openPaths([p], true), F('contrato_prueba.pdf')); await idle(); await sleep(800);
  await w.click('#edTpl'); await w.waitForSelector('#tplConv');
  ok(await w.evaluate(() => window.editor._state.tpl?.mode === 'design'), 'modo plantilla activo');
  await openBlock('MARIA GONZALEZ');
  ok(await w.evaluate(() => { const o = window.editor._state.overlays[0].at(-1); return o.transparent === true; }), 'el párrafo quedó sin parche (el original se borró del PDF)');
  ok(await w.locator('.ov-cover').count() === 0, 'no hay rectángulo de fondo');

  console.log('Diseñar la plantilla');
  await makeField('MARIA GONZALEZ ROJAS', { label: 'Cliente: nombre', role: 'Cliente', attr: 'fullName' });
  const rep = await w.locator('#mOk').count();
  if (rep) { ok(/aparece/.test(await w.textContent('#modalCard')), 'ofrece marcar el mismo dato en otros párrafos'); await w.click('#mOk'); await idle(); await sleep(500); }
  ok(await w.evaluate(() => Object.values(window.editor._state.overlays).flat().reduce((n, o) => n + (o.html.match(/data-field/g) || []).length, 0)) >= 2, 'el nombre quedó marcado en más de un lugar');
  await openBlock('MARIA GONZALEZ');
  await makeField('22.222.222-2', { role: 'Cliente', attr: 'rut' });
  ok(await w.evaluate(() => window.editor._state.tpl.def.fields.find((f) => f.type === 'rut')?.label === 'RUT'), 'tipo RUT reconocido solo');
  await makeField('2 de octubre de 2026', { label: 'Fecha del contrato' });
  ok(await w.evaluate(() => window.editor._state.tpl.def.fields.find((f) => f.label === 'Fecha del contrato')?.type === 'fecha'), 'tipo fecha reconocido solo');
  await openBlock('$500.000');
  await makeField('$500.000', { label: 'Precio mensual', words: '1' });
  await w.keyboard.press('Escape'); await sleep(300);
  await w.screenshot({ path: out('p1-diseno.png') });
  ok(await w.locator('.tpl-f').count() === 4, '4 campos en el panel');

  console.log('Guardar y llenar');
  await w.click('#tplSave'); await w.waitForSelector('#tName'); await w.fill('#tName', 'Contrato de servicios'); await w.click('#mOk');
  await w.waitForSelector('#mOk:has-text("Llenar ahora")', { timeout: 30000 }); await w.click('#mOk'); await idle(); await sleep(1000);
  ok(await w.evaluate(() => window.editor._state.tpl?.mode === 'fill'), 'plantilla abierta para llenar en otra pestaña');
  ok(await w.locator('.tf').count() === 4, 'formulario con 4 campos');
  ok(await w.evaluate(() => [...document.querySelectorAll('.pf-field')].some((x) => /\[Cliente: nombre\]/.test(x.textContent))), 'los campos vacíos se ven como [nombre del campo]');
  const fid = (label) => w.evaluate((l) => window.editor._state.tpl.def.fields.find((f) => f.label === l).id, label);
  const fillIn = async (label, v) => { const id = await fid(label); await w.fill(`[data-in="${id}"]`, v); await w.locator(`[data-in="${id}"]`).blur(); };
  await fillIn('Cliente: nombre', 'Josefina Alejandra Valenzuela Etcheverry');
  await fillIn('RUT', '123456785');
  await w.fill(`[data-in="${await fid('Fecha del contrato')}"]`, '2026-10-15');
  await fillIn('Precio mensual', '1250000'); await sleep(900);
  await w.screenshot({ path: out('p2-llenado.png') });
  const st = await w.textContent('#tplStatus'); console.log('   estado:', st);
  ok(/4 de 4/.test(st), 'los 4 campos completos');
  // RUT inválido
  await fillIn('RUT', '123456789'); await sleep(300);
  ok(/inválido/.test(await w.textContent(`.tf[data-f="${await fid('RUT')}"] .err`)), 'RUT inválido avisado');
  await fillIn('RUT', '12.345.678-5'); await sleep(300);

  console.log('Dato demasiado largo');
  await fillIn('Cliente: nombre', 'Josefina Alejandra Valenzuela Etcheverry de los Santos Montenegro y Sotomayor Larraín '.repeat(4)); await sleep(1200);
  ok(/no caben/.test(await w.textContent('#tplStatus')), 'avisa que el dato no cabe');
  await w.click('#tplGen'); await sleep(500);
  ok(await w.evaluate(() => window.editor._state.tpl?.mode === 'fill'), 'no genera mientras no quepa');
  await w.screenshot({ path: out('p3-no-cabe.png') });
  await fillIn('Cliente: nombre', 'Josefina Alejandra Valenzuela Etcheverry'); await sleep(1200);

  console.log('Generar');
  await w.click('#tplGen'); await idle(); await sleep(1200);
  const g = await w.evaluate(() => ({ name: window.editor._state.name, signers: window.editor._state.signers, tabs: window.editor.tabCount() }));
  console.log('   ', JSON.stringify(g));
  ok(/Contrato de servicios - /.test(g.name), 'documento generado en pestaña nueva');
  ok(g.signers?.[0]?.rut === '12.345.678-5' && /JOSEFINA/i.test(g.signers[0].fullName), 'firmante listo para enviar (nombre y RUT)');
  await w.screenshot({ path: out('p4-generado.png') });
  const b64 = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(out('out-plantilla.pdf'), Buffer.from(b64, 'base64'));
  const raw = execSync(`pdftotext "${out('out-plantilla.pdf')}" -`).toString(); const txt = raw.replace(/\s+/g, ' ');
  console.log(raw.split('\n').filter(Boolean).slice(0, 12).map((l) => '    | ' + l).join('\n'));
  ok(/JOSEFINA ALEJANDRA VALENZUELA ETCHEVERRY/.test(txt), 'nombre en mayúsculas como el original');
  ok(/12\.345\.678-5/.test(txt), 'RUT con formato');
  ok(/15 de octubre de 2026/.test(txt), 'fecha en palabras');
  ok(/\$1\.250\.000 \(un millón doscientos cincuenta mil pesos\)/.test(txt), 'monto con palabras');
  ok(!/MARIA GONZALEZ|22\.222\.222-2|2 de octubre de 2026|500\.000/.test(txt), 'no queda ningún dato de ejemplo (ni oculto)');
  ok(!/\[/.test(txt), 'sin marcas de campos');

  console.log('Mis plantillas');
  await w.click('.tab[data-view="home"]'); await sleep(800);
  ok(await w.locator('.tpl-item').count() === 1, 'la plantilla aparece en el inicio');
  await w.screenshot({ path: out('p5-inicio.png'), fullPage: false });
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
