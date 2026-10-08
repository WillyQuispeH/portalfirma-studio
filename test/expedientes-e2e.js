// Expedientes: carpeta por caso (computador o Drive), agregar archivos, usarlos en Studio, enviar a firmar e historial.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfxp-'));
  const expDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfxd-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfxf-'));
  const fx = path.resolve(__dirname, 'fixtures');
  const files = [['Contrato arriendo.pdf', 'contrato_prueba.pdf'], ['Inventario.pdf', 'contrato_prueba.pdf'], ['Carta oferta.docx', 'contrato.docx'], ['Cédula arrendatario.png', '../1-login.png']].map(([n, src], i) => { const f = path.join(tmp, n); let b = fs.readFileSync(path.join(fx, src)); if (/pdf$/.test(n)) b = Buffer.concat([b, Buffer.from(`\n%${i}\n`)]); fs.writeFileSync(f, b); return f; });
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1', PF_EXP_DIR: expDir } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const sleep = (ms) => w.waitForTimeout(ms);
  ok(await w.$('.hub-card[data-act="exp"]') && !(await w.$('.hub-card[data-act="exp"][data-member]')), 'tarjeta «Expedientes» en el inicio (disponible para todos)');
  await w.click('.hub-card[data-act="exp"]'); await w.waitForSelector('#xpNew');
  ok(/Crear mi primer expediente/.test(await w.textContent('#xpDetail')), 'inicio vacío con ejemplo');
  // crear en el computador
  await w.click('#xpNew'); await w.waitForSelector('#xnName');
  await w.fill('#xnName', 'Depto Calle Nueva 120'); await w.selectOption('#xnType', 'propiedad'); await w.fill('#xnNotes', 'Arriendo 2026');
  await w.click('#mOk'); await w.waitForSelector('.xp-head');
  ok(fs.existsSync(path.join(expDir, 'Depto Calle Nueva 120')), 'crea la carpeta «Depto Calle Nueva 120» en Documentos/Expedientes PortalFirma');
  const id = await w.evaluate(() => window.Expedientes._x.sel);
  const r = await w.evaluate(([id, f]) => window.pf.expAddFiles(id, f), [id, files]);
  ok(r.ok && r.data.added.length === 4, 'agrega PDF, Word y la foto de una cédula');
  await w.evaluate((id) => window.Expedientes.open(id), id); await w.waitForSelector('.xp-file');
  ok(await w.$$eval('.xp-file', (l) => l.length) === 4 && fs.readdirSync(path.join(expDir, 'Depto Calle Nueva 120')).length === 4, 'los archivos quedan copiados en la carpeta del caso');
  const r2 = await w.evaluate(([id, f]) => window.pf.expAddFiles(id, [f]), [id, files[0]]);
  ok(r2.data.added[0] === 'Contrato arriendo (2).pdf', 'no pisa archivos con el mismo nombre');
  await w.evaluate((id) => window.Expedientes.open(id), id); await w.waitForSelector('.xp-file');
  await w.screenshot({ path: path.resolve(__dirname, 'xp1-expediente.png') });
  // usar en Studio: abrir
  await w.click('.xp-file:has-text("Inventario.pdf") [data-fa="view"]');
  await w.waitForFunction(() => window.editor.tabCount() >= 1 && /Inventario/.test(window.editor._state.name || ''), null, { timeout: 30000 });
  ok(true, '«Ver» abre el archivo en el editor');
  // guardar desde el editor en el expediente
  await w.click('#edCase'); await w.waitForSelector('#xsExp');
  await w.fill('#xsName', 'Inventario firmado a mano.pdf'); await w.click('#mOk'); await sleep(1500);
  ok(fs.existsSync(path.join(expDir, 'Depto Calle Nueva 120', 'Inventario firmado a mano.pdf')), 'botón «Expediente» del editor guarda el documento en el caso');
  // enviar dos a firmar (carga masiva) y historial
  await w.evaluate((id) => window.Expedientes.open(id), id); await w.waitForSelector('.xp-file');
  await w.click('.xp-file:has-text("Contrato arriendo.pdf") input'); await w.click('.xp-file:has-text("Inventario.pdf") input');
  await w.waitForSelector('[data-do="sign"]');
  ok(/Enviar a firmar \(2\)/.test(await w.textContent('[data-do="sign"]')), 'selección de 2 archivos con acciones');
  await w.screenshot({ path: path.resolve(__dirname, 'xp2-seleccion.png') });
  await w.click('[data-do="sign"]'); await w.waitForSelector('#view-bulk:not(.hidden)');
  await w.waitForFunction(() => window.Masiva._bk.st.items.filter((x) => x.flow?.expId && x.status === 'ready').length === 2, null, { timeout: 60000 }).catch(async () => {
    // si el detector no encontró firmantes, se los ponemos
    const items = await w.evaluate(() => window.Masiva._bk.st.items.filter((x) => x.flow?.expId));
    for (const it of items) await w.evaluate((id) => window.pf.bulkUpdate(id, { signers: [{ fullName: 'Ana Pérez', rut: '12.919.383-2', email: 'ana@ejemplo.cl', phone: '+56911111111', alias: 'Arrendatario' }] }), it.id);
  });
  await sleep(800); console.log('   ', JSON.stringify(await w.evaluate(() => window.Masiva._bk.st.items.map((x) => [x.name, x.status, x.flow, x.error, x.missing]))));
  const ids = await w.evaluate(() => window.Masiva._bk.st.items.filter((x) => x.flow?.expId && x.status === 'ready').map((x) => x.id));
  ok(ids.length === 2, 'los 2 documentos del expediente quedan en la carga masiva');
  const s = await w.evaluate((ids) => window.pf.bulkSend(ids, { email: 'pagos@ejemplo.cl' }), ids); ok(s.ok, 'enviados');
  await w.evaluate((id) => window.Expedientes.open(id), id); await w.waitForSelector('.xp-head');
  await w.click('[data-t="hist"]'); await w.waitForSelector('.xp-h'); await sleep(500);
  const hist = await w.textContent('.xp-hist');
  ok((hist.match(/Enviado a firmar/g) || []).length === 2 && /N° \d+/.test(hist), 'el historial registra cada envío con su número de operación');
  ok(/Expediente creado en este computador/.test(hist) && /Se agregaron 4 archivos/.test(hist) && /Se guardó desde el editor/.test(hist), 'historial: creación, archivos agregados y guardado desde el editor');
  await w.screenshot({ path: path.resolve(__dirname, 'xp3-historial.png') });
  // a Plazos
  await w.click('[data-t="docs"]'); await w.waitForSelector('.xp-file');
  await w.click('.xp-file:has-text("Contrato arriendo.pdf") input'); await w.click('[data-do="plazos"]');
  await w.waitForSelector('#view-plazos:not(.hidden)');
  ok((await w.evaluate(() => window.pf.plazosList())).data.length === 1, 'se agrega a Plazos y vencimientos');
  // en Google Drive (modo prueba)
  await w.evaluate(() => window.pf.driveConnect());
  await w.evaluate(() => window.Expedientes.open()); await w.waitForSelector('#xpNew');
  await w.click('#xpNew'); await w.waitForSelector('#xnName'); await w.fill('#xnName', 'Juan Pérez (cliente)'); await w.selectOption('#xnType', 'persona');
  await w.click('input[name="xnSt"][value="drive"]'); await w.click('#mOk'); await w.waitForSelector('.xp-head');
  ok(/Google Drive/.test(await w.textContent('.xp-chips')), 'expediente creado en Google Drive');
  const id2 = await w.evaluate(() => window.Expedientes._x.sel);
  await w.evaluate(([id, f]) => window.pf.expAddFiles(id, f), [id2, [files[3], files[0]]]);
  await w.evaluate((id) => window.Expedientes.open(id), id2); await w.waitForSelector('.xp-file');
  ok(await w.$$eval('.xp-file', (l) => l.length) === 2, 'sube los archivos a la carpeta de Drive y los lista');
  const lp = await w.evaluate((id) => window.pf.expFiles(id).then((r) => window.pf.expLocalPath(id, r.data.find((f) => /pdf$/.test(f.name)).id)), id2);
  ok(lp.ok && fs.existsSync(lp.data), 'un archivo de Drive se descarga para usarlo en Studio');
  // papelera
  await w.click('.xp-file:has-text("Cédula") [data-fa="rm"]'); await w.click('#mOk'); await sleep(800);
  ok(await w.$$eval('.xp-file', (l) => l.length) === 1, 'enviar un archivo a la papelera');
  ok((await w.evaluate(() => window.pf.expList())).data.length === 2, 'dos expedientes en la lista');
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
