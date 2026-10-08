// Flujos documentales: receta «Mandatos de pagaré» = modelo + nómina + valores fijos → revisión → generar → enviar → volver a ejecutar.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const pdfText = async (file) => { const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false }).promise; let t = ''; for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n'; return t.replace(/\s+/g, ' '); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pffl-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pffn-'));
  const H = 'Mandante - Nombre;Mandante - Rut;Mandante - Nacionalidad;Mandante - Direccion;Mandante - Telefono;Mandante - Email;Monto';
  const nom1 = path.join(tmp, 'Nomina septiembre.csv');
  fs.writeFileSync(nom1, '﻿' + [H,
    'María González Rojas;22.222.222-2;Chilena;Los Leones 200, Providencia;+56911111111;maria@correo.cl;1500000',
    'Pedro Soto Lagos;11.111.111-1;Chilena;Av. Italia 1000, Ñuñoa;+56922222222;pedro@correo.cl;890000',
    'Ana Muñoz Pérez;12.919.383-2;Peruana;Calle Nueva 120, Santiago;+56933333333;ana@correo.cl;2300000',
    'Luis Error Díaz;12.345.678-0;Chilena;Sin número;+56944444444;luis@correo;100',
    'Pedro Soto Lagos;11.111.111-1;Chilena;Av. Italia 1000, Ñuñoa;+56922222222;pedro@correo.cl;890000'].join('\r\n'));
  const nom2 = path.join(tmp, 'Nomina octubre.csv');
  fs.writeFileSync(nom2, '﻿' + [H, 'Carla Vera Rojas;18.544.340-K;Chilena;Los Olmos 5, La Reina;+56955555555;carla@correo.cl;700000', 'Jorge Paz Núñez;18.532.685-3;Chilena;Pasaje 3, Maipú;+56966666666;jorge@correo.cl;650000'].join('\r\n'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const sleep = (ms) => w.waitForTimeout(ms);
  ok(await w.$('.hub-card[data-act="flows"][data-member]'), 'tarjeta «Flujos documentales» en el inicio (exclusiva para clientes)');
  await w.click('.hub-card[data-act="flows"]'); await w.waitForSelector('#flNew');
  ok(/Todavía no tienes recetas/.test(await w.textContent('#view-flujos')), 'inicio vacío con ejemplo de pagarés');
  await w.click('#flNew'); await w.waitForSelector('#flQ');
  ok(await w.$$eval('.fl-model', (l) => l.length) >= 19, 'biblioteca con los modelos de Portalfirma');
  await w.fill('#flQ', 'pagaré'); await sleep(200);
  await w.click('.fl-model:has-text("Mandato Irrevocable")'); await w.waitForSelector('#flDrop');
  ok(/Mandato Irrevocable/.test(await w.textContent('.ops-head')), 'paso 2: nómina, con el modelo elegido');
  const r = await w.evaluate((f) => window.pf.flujosReadNomina(f), nom1); ok(r.ok && r.data.rows.length === 5, 'lee la nómina CSV (5 filas)');
  await w.evaluate((n) => window.Flujos._setNomina(n), r.data); await w.waitForSelector('#flNext');
  await w.screenshot({ path: path.resolve(__dirname, 'fl1-nomina.png') });
  await w.click('#flNext'); await w.waitForSelector('.fl-map');
  const sel = (label) => w.$eval(`.fl-group:has(h4:has-text("Mandante")) .fl-mrow:has(.fl-lab:text-is("${label}")) select`, (s) => s.value).catch(() => w.$eval(`.fl-group:has(h4:has-text("Mandante")) .fl-mrow:has-text("${label}") select`, (s) => s.value));
  ok((await sel('Nombre')) === 'col:Mandante - Nombre' && (await sel('Rut')) === 'col:Mandante - Rut' && (await sel('Email')) === 'col:Mandante - Email', 'une sola las columnas con los datos del firmante');
  ok(/datos obligatorios sin asignar/.test(await w.textContent('.fl-card')), 'avisa los datos obligatorios sin asignar (acreedor y ciudad)');
  // valores fijos: ciudad y acreedor (iguales para todos)
  const setFixed = async (rowText, value) => {
    const row = w.locator('.fl-mrow', { hasText: rowText }).first();
    await row.locator('select').selectOption('fixed'); await sleep(150);
    await w.locator('.fl-mrow', { hasText: rowText }).first().locator('input[data-fx]').fill(value);
  };
  await setFixed('Ciudad', 'Santiago');
  await setFixed('Nombre o empresa mandatario', 'Inversiones Andes SpA');
  await setFixed('RUT empresa o persona', '76.463.284-2');
  await w.screenshot({ path: path.resolve(__dirname, 'fl-campos.png'), fullPage: true });
  await w.click('#flNext'); await w.waitForSelector('.fl-sum');
  const sum = await w.textContent('.fl-sum');
  ok(/3\s*listas/.test(sum) && /2\s*con problemas/.test(sum), 'revisión: 3 listas y 2 con problemas');
  const errsTxt = await w.textContent('.fl-errs');
  ok(/RUT inválido/.test(errsTxt) && /correo inválido/.test(errsTxt) && /fila repetida/.test(errsTxt), 'detecta RUT inválido, correo inválido y fila repetida');
  await w.screenshot({ path: path.resolve(__dirname, 'fl2-revision.png') });
  await w.click('[data-sm] >> nth=0'); await w.waitForSelector('#flPdf canvas', { timeout: 30000 });
  ok(/María González Rojas/.test(await w.textContent('.fl-sig')) && /Mandante/.test(await w.textContent('.fl-sig')), 'muestra del documento con su firmante');
  await sleep(1500); await w.screenshot({ path: path.resolve(__dirname, 'fl3-muestra.png') });
  await w.click('#mCancel');
  await w.click('#flNext'); await w.waitForSelector('#flName');
  await w.fill('#flName', 'Mandatos de pagaré mensuales');
  await w.click('#flGo');
  await w.waitForSelector('#flRunTable', { timeout: 60000 });
  await w.waitForFunction(() => { const run = window.Flujos._fl.w.run; const b = window.Flujos._fl.bulk.items; return run && run.rows.length === 3 && run.rows.every((r) => b.find((x) => x.id === r.bulkId)?.status === 'ready'); }, null, { timeout: 60000 });
  await sleep(500);
  const run = await w.evaluate(() => window.Flujos._fl.w.run);
  const t = await pdfText(run.rows[0].file);
  ok(/MANDATO ESPECIAL E IRREVOCABLE/.test(t) && /María González Rojas/.test(t) && /Inversiones Andes SpA/.test(t) && /Santiago/.test(t) && !/\[\[/.test(t), 'PDF generado con los datos de la fila y los valores fijos, sin marcas');
  ok(new RegExp(new Date().getFullYear()).test(t), 'fecha del día puesta sola');
  const sigs = await w.evaluate(() => { const r = window.Flujos._fl.w.run.rows[0]; return window.Flujos._fl.bulk.items.find((x) => x.id === r.bulkId).signers; });
  ok(sigs.length === 1 && sigs[0].alias === 'Mandante' && sigs[0].rut === '22.222.222-2' && sigs[0].email === 'maria@correo.cl', 'en la cola con su firmante ya asignado (sin detectarlo con IA)');
  await w.screenshot({ path: path.resolve(__dirname, 'fl4-listos.png') });
  await w.click('[data-a="send"]'); await w.waitForSelector('#flPay');
  ok(/3 operaciones/.test(await w.textContent('#modalCard')) && /descuenta saldo/.test(await w.textContent('#modalCard')), 'confirma antes de enviar: cantidad y cobro');
  await w.fill('#flPay', 'pagos@andes.cl'); await w.click('#mOk');
  await w.waitForFunction(() => { const run = window.Flujos._fl.w.run; const b = window.Flujos._fl.bulk.items; return run.rows.every((r) => b.find((x) => x.id === r.bulkId)?.status === 'sent'); }, null, { timeout: 60000 }); await sleep(400);
  ok(/Enviado · N°/.test(await w.textContent('#flRunTable')), 'enviados: cada fila con su número de operación');
  await w.screenshot({ path: path.resolve(__dirname, 'fl5-enviados.png') });
  // volver a ejecutar la receta con la nómina de octubre
  await w.click('#flBack'); await w.waitForSelector('.fl-recipe');
  ok(/Mandatos de pagaré mensuales/.test(await w.textContent('.fl-recipe')) && /3 documentos/.test(await w.textContent('.fl-recipe')), 'receta guardada con su última ejecución');
  ok(/En firma 3/.test(await w.textContent('#flRuns')), 'ejecución con el estado de sus firmas');
  await w.screenshot({ path: path.resolve(__dirname, 'fl6-recetas.png') });
  await w.click('.fl-recipe [data-a="run"]'); await w.waitForSelector('#flDrop');
  const r2 = await w.evaluate((f) => window.pf.flujosReadNomina(f), nom2); await w.evaluate((n) => window.Flujos._setNomina(n), r2.data);
  await w.click('#flNext'); await w.waitForSelector('.fl-map');
  ok(!/sin asignar/.test(await w.textContent('.fl-card')) && (await w.$eval('input[data-fx]', (i) => i.value)) === 'Santiago', 'la receta recuerda las columnas y los valores fijos');
  await w.click('#flNext'); await w.waitForSelector('.fl-sum');
  ok(/2\s*listas/.test(await w.textContent('.fl-sum')), 'nómina nueva: 2 listas');
  await w.click('#flNext'); await w.waitForSelector('#flGo'); await w.click('#flGo');
  await w.waitForFunction(() => window.Flujos._fl.w.run?.rows.length === 2, null, { timeout: 60000 });
  const runs = (await w.evaluate(() => window.pf.flujosRuns())).data;
  ok(runs.length === 2 && runs[0].nomina === 'Nomina octubre.csv', 'segunda ejecución registrada');
  ok(!JSON.stringify(runs).includes('maria@correo.cl') && !JSON.stringify(runs).includes('1500000'), 'la nómina no se guarda (solo nombre y RUT para el seguimiento)');
  // borrar documentos generados
  const f0 = runs[1].rows[0].file; ok(fs.existsSync(f0), 'PDF generado en el computador');
  await w.evaluate((id) => window.pf.flujosDeleteRun(id), runs[1].id); ok(!fs.existsSync(f0), 'se pueden borrar los PDF de una ejecución');
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
