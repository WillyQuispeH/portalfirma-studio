// Aprendizaje de reglas (interno Portalfirma):
//  · El cliente corrige la detección: cambia la materia, descarta un acto oculto y agrega uno que faltaba.
//  · Al enviar, queda un caso sin datos personales.
//  · Panel «Reglas de detección»: la IA (simulada) propone, se prueba contra los casos, se aprueba o descarta.
//  · Las reglas aprobadas se aplican sin IA en el siguiente trámite; se pueden desactivar y exportar.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
const FX = process.env.PF_ESCR_FX || '/home/claude/scratch/escr/fx2';
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfrg-')); const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pfrg-out-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_SAVE_DIR: out } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1500, height: 920 }); await w.waitForSelector('.hub-card'); await w.waitForTimeout(400);
  const drop = (f) => w.evaluate((p) => window.Escrituras.dropFiles(p), [path.join(FX, f)]);
  const txt = (sel) => w.textContent(sel).then((t) => t || '');
  const total = async () => txt('#esTotal');
  try {
    await w.evaluate(() => { window.Usuario._u.user = { name: 'Prueba' }; });
    await w.click('[data-act="escr"]'); await w.waitForSelector('.es-layout');
    ok(await w.isVisible('[data-sel="reglas"]'), 'el panel de reglas aparece (modo de prueba / administradores)');
    await w.click('[data-tr="escritura"]'); await w.waitForSelector('#esPick');
    await drop('mandato-oculto.docx'); await w.waitForSelector('.es-hid'); await w.waitForTimeout(300);

    // 1. el cliente corrige la detección
    await w.click('[data-main="compraventa"]'); await w.waitForTimeout(300);
    await w.click('label.es-sw:has([data-acto="hipoteca"])'); await w.waitForTimeout(300);
    const t0 = await total();
    await w.click('#esAddActo'); await w.waitForSelector('#aaActo');
    await w.selectOption('#aaActo', '__otro'); await w.fill('#aaOtro', 'Facultad para inscribir'); await w.fill('#aaFrase', 'una frase que no está en el escrito');
    await w.click('#aaOk'); ok(/No encontramos esa frase/.test(await txt('#aaMsg')), 'la frase debe existir en el documento');
    await w.fill('#aaFrase', 'Se faculta al portador de copia autorizada'); await w.click('#aaOk'); await w.waitForTimeout(300);
    ok(/Facultad para inscribir/.test(await txt('.es-hid')) && /Agregado por ti/.test(await txt('.es-hid')) && (await total()) === t0, 'acto fuera de la planilla: se agrega como informativo, sin cambiar el total');
    const cat = await w.evaluate(() => window.Materias.CATALOGO.find((x) => x.tipo === 'escritura' && x.value !== 'compraventa' && window.Materias.precio(x.value).monto > 0 && /usufructo/i.test(x.label))?.value
      || window.Materias.CATALOGO.find((x) => x.tipo === 'escritura' && x.value !== 'compraventa' && window.Materias.precio(x.value).monto > 0).value);
    await w.click('#esAddActo'); await w.waitForSelector('#aaActo'); await w.selectOption('#aaActo', cat); await w.fill('#aaFrase', 'el inmueble de calle Tres 789'); await w.click('#aaOk'); await w.waitForTimeout(400);
    ok((await total()) !== t0 && (await w.$$('.es-line')).length >= 2, `acto de la planilla agregado: se suma al cobro (${t0} → ${await total()})`);
    await w.screenshot({ path: path.resolve(__dirname, 'rg1-agregar.png') });

    // 2. enviar → queda el caso
    for (let i = 0; i < 2; i++) { await w.fill(`[data-ct="${i}"][data-f="email"]`, `p${i}@ejemplo.cl`); await w.fill(`[data-ct="${i}"][data-f="tel"]`, '+56 9 1234 567' + i); }
    await w.click('[data-notsel]'); await w.waitForSelector('#nLista [data-nid]'); await w.click('[data-nid="np-01"]'); await w.click('#nOk'); await w.waitForTimeout(500);
    await w.click('#esPrim'); await w.waitForSelector('#esAcc'); await w.check('#esAcc'); await w.click('#esPay'); await w.waitForSelector('.es-item.on:not([data-sel="draft"])', { timeout: 20000 }); await w.waitForTimeout(500);
    const casos = await w.evaluate(() => window.pf.reglasCasos()); const c = casos.data[0];
    ok(casos.data.length === 1 && c.materiaAuto === 'mandato_especial' && c.materiaFinal === 'compraventa' && c.descartados[0].codigo === 'hipoteca' && c.agregados.length === 2, 'caso guardado: materia cambiada, acto descartado y dos actos agregados');
    ok(!/6\.375\.107-3|4\.910\.008-6/.test(JSON.stringify(c)) && /\[RUT\]/.test(c.texto), 'el caso no guarda los RUT');
    const ficha = JSON.parse(Buffer.from((await w.evaluate(async (op) => { const r = await window.pf.notArchivo(op, 'Ficha del trámite.json'); return Array.from(r.data); }, await w.evaluate(() => window.Escrituras._s.sel)))).toString());
    ok(ficha.actosAgregadosPorCliente.length === 2 && ficha.actosAgregadosPorCliente.some((x) => x.cobrado), 'la ficha para la notaría informa los actos agregados por el cliente');

    // 3. panel de reglas: propuestas de la IA
    await w.click('[data-sel="reglas"]'); await w.waitForSelector('#rgProponer');
    ok((await txt('#rgNCasos')) === '1' && /Hipoteca/.test(await txt('.rg-sig')), 'estadísticas y señales de actos descartados');
    await w.click('#rgProponer'); await w.waitForSelector('#rgGo'); ok(/sin RUT/.test(await txt('#modal, .modal, body')), 'confirma antes de enviar los casos a la IA');
    await w.click('#rgGo'); await w.waitForSelector('[data-pid]', { timeout: 15000 }); await w.waitForTimeout(300);
    const cards = await w.$$eval('[data-pid]', (x) => x.map((e) => e.textContent));
    ok(cards.length === 4, `la IA propone ${cards.length} reglas`);
    ok(cards.some((t) => /No compila/.test(t)), 'una expresión inválida se marca y no se puede aprobar');
    ok(cards.some((t) => /Facultad para inscribir/.test(t) && /Detecta 1 de 1/.test(t)), 'cada propuesta se prueba contra los casos guardados');
    await w.screenshot({ path: path.resolve(__dirname, 'rg2-propuestas.png'), fullPage: true });
    // probar un patrón editado
    const fac = await w.$('[data-pid]:has-text("Facultad para inscribir")');
    await (await fac.$('[data-pat]')).fill('\\bmandatario\\b'); await (await fac.$('[data-probar]')).click(); await w.waitForTimeout(300);
    ok(/Detecta 0 de 1/.test(await fac.textContent()), 'probar con un patrón editado');
    await (await fac.$('[data-pat]')).fill('\\bse\\s+faculta\\s+al\\s+portador\\b');
    await (await fac.$('[data-aprobar]')).click(); await w.waitForTimeout(500);
    await (await w.$('[data-pid]:has-text("No compila")')).$('[data-descartar]').then((b) => b.click()); await w.waitForTimeout(400);
    const mat = await w.$('[data-pid]:has-text("Materia por título")'); await (await mat.$('[data-aprobar]')).click(); await w.waitForTimeout(500);
    ok((await w.$$('#rgReglas [data-rid]')).length === 2 && (await txt('#rgNActivas')) === '2' && (await w.$$('[data-pid]')).length === 1, 'aprobadas 2 reglas; la inválida descartada');

    // 4. las reglas aprobadas funcionan sin IA en el siguiente trámite
    const cl = await w.evaluate(() => window.Materias.clasificar('MANDATO ESPECIAL', '')[0]);
    ok(cl.value === 'compraventa' && cl.regla && cl.confianza === 'alta', 'regla de materia: el título ahora se clasifica como compraventa');
    await w.click('#esNuevo'); await w.click('[data-tr="escritura"]'); await w.waitForSelector('#esPick');
    await drop('mandato-oculto.docx'); await w.waitForSelector('.es-hid'); await w.waitForTimeout(300);
    ok(/Facultad para inscribir/.test(await txt('.es-hid')) && !/Agregado por ti/.test(await txt('.es-hid')) && /Compraventa/.test(await txt('#esMatLbl')), 'el siguiente documento detecta solo el acto y la materia aprendidos');
    await w.screenshot({ path: path.resolve(__dirname, 'rg3-aplicada.png') });

    // 5. desactivar y exportar
    await w.click('[data-sel="reglas"]'); await w.waitForSelector('#rgReglas [data-rid]');
    await (await w.$('#rgReglas [data-rid]:has-text("Materia por título")')).$('[data-activa]').then((x) => x.evaluate((e) => e.closest('label').click())); await w.waitForTimeout(500);
    ok((await w.evaluate(() => window.Materias.clasificar('MANDATO ESPECIAL', '')[0].value)) === 'mandato_especial', 'una regla desactivada deja de aplicarse');
    await w.click('#rgExport'); await w.waitForTimeout(500);
    const ex = JSON.parse(fs.readFileSync(path.join(out, 'reglas-notariales.json'), 'utf8'));
    ok(ex.actos.length === 1 && ex.materias.length === 1 && ex.materias[0].activo === false && !ex.actos[0].prueba, 'exporta las reglas para publicarlas desde el servidor');
    await w.screenshot({ path: path.resolve(__dirname, 'rg4-reglas.png'), fullPage: true });
    ok(!errs.length, 'sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
    console.log('OK reglas');
  } catch (e) { console.error(e.message); await w.screenshot({ path: path.resolve(__dirname, 'rg-error.png') }); process.exitCode = 1; } finally { await app.close(); }
})();
