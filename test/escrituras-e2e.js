// Trámites notariales (cliente final), con diseño de lista + detalle como «Mis operaciones».
//  · Escritura: solo Word; revisión, materias ocultas, firmas con su calidad, vista «cómo llegó / cómo va».
//  · Protocolización: Word exacto; PDF o foto con IA (con aviso). El cliente no edita la carátula.
//  · Reducción: la hacemos nosotros, reescrita como escritura pública; el cliente puede modificar el escrito.
// Los documentos de prueba son reales: no se guardan en el proyecto (PF_ESCR_FX apunta a ellos).
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const JSZip = require('jszip');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
const FX = process.env.PF_ESCR_FX || '/home/claude/scratch/escr/fx2';
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfes-')); const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pfes-out-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_SAVE_DIR: out } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1500, height: 920 }); await w.waitForSelector('.hub-card'); await w.waitForTimeout(400);
  const drop = (files) => w.evaluate((ps) => window.Escrituras.dropFiles(ps), [].concat(files).map((f) => path.join(FX, f)));
  const txt = (sel) => w.textContent(sel).then((t) => t || '');
  const nuevo = async (tipo) => { await w.click('#esNuevo'); await w.waitForTimeout(150); if (await w.isVisible('#nSi')) await w.click('#nSi'); await w.click(`[data-tr="${tipo}"]`); await w.waitForSelector('#esPick'); };
  const notaria = async (id = 'np-01') => { await w.click('[data-notsel]'); await w.waitForSelector('#nLista [data-nid]'); await w.click(`[data-nid="${id}"]`); await w.click('#nOk'); await w.waitForTimeout(500); };
  const pagar = async () => { await w.click('#esPrim'); await w.waitForSelector('#esAcc'); await w.check('#esAcc'); await w.click('#esPay'); await w.waitForSelector('.es-item.on:not([data-sel="draft"])', { timeout: 20000 }); await w.waitForTimeout(400); };

  await w.click('[data-act="escr"]'); await w.waitForSelector('.es-layout');
  ok(await w.$('.es-list') && (await w.$$('.es-card')).length === 3, 'diseño de lista + detalle; tres trámites');
  await w.screenshot({ path: path.resolve(__dirname, 'es0-tramites.png') });

  // ===== ESCRITURA
  await w.click('[data-tr="escritura"]'); await w.waitForSelector('#esPick');
  await drop('4424-contrato.pdf'); await w.waitForTimeout(600);
  ok(/sube la minuta en Word/.test(await txt('#toast')), 'escritura: un PDF se rechaza');
  await drop('minuta1.docx'); await w.waitForSelector('.es-work'); await w.waitForSelector('#esVn .es-page', { timeout: 30000 }); await w.waitForTimeout(400);
  ok(/Revisión/.test(await txt('.es-track')) && /Cómo va a la notaría/.test(await txt('.es-seg2')), 'seguimiento y visor «cómo llegó / cómo va a la notaría»');
  await w.click('[data-v="ambos"]'); await w.waitForSelector('#esVo .es-page', { timeout: 30000 }); await w.waitForSelector('#esVn .es-page', { timeout: 30000 }); await w.waitForTimeout(500);
  ok(true, 'lado a lado: original y versión para la notaría');
  await w.screenshot({ path: path.resolve(__dirname, 'es1-lado-a-lado.png') });
  ok(/después de las firmas/.test(await txt('.es-alerts')), 'observaciones en el mismo panel');
  await w.click('#esFixAll'); await w.waitForTimeout(400);
  const nIn = await w.$$eval('[data-f="email"]', (x) => x.length); ok(nIn === 7, `comparecientes como tarjetas con contacto (${nIn})`);
  for (let i = 0; i < nIn; i++) { await w.fill(`[data-ct="${i}"][data-f="email"]`, `p${i}@ejemplo.cl`); await w.fill(`[data-ct="${i}"][data-f="tel"]`, '+56 9 1234 567' + i); }
  await w.click('#esEdit'); await w.waitForSelector('#eTit'); await w.fill('#eTit', 'PRÓRROGA DE PROMESA DE COMPRAVENTA'); await w.click('#tOk'); await w.waitForTimeout(600);
  ok(/PRÓRROGA DE PROMESA DE COMPRAVENTA/.test(await txt('.es-dh h3')), 'el cliente modifica el texto y el título');
  await w.click('#esPrim'); await w.waitForTimeout(300); ok(/elegir la notaría/.test(await txt('#toast')), 'no deja pagar sin elegir la notaría');
  await w.click('[data-notsel]'); await w.waitForSelector('#nLista [data-nid]');
  ok((await w.$$('#nLista [data-nid]')).length === 4 && /Prueba/.test(await txt('#nLista')), 'tres notarías de prueba + asignación automática');
  await w.selectOption('#nComuna', 'Providencia'); await w.waitForTimeout(200); ok((await w.$$('#nLista [data-nid]')).length === 2, 'filtro por comuna');
  await w.screenshot({ path: path.resolve(__dirname, 'es9-notarias.png') });
  await w.click('[data-nid="np-02"]'); await w.click('#nOk'); await w.waitForTimeout(600);
  ok(/Segunda Notaría de Prueba/.test(await txt('#esNotNom')) && /Pago/.test(await txt('.es-tk.on')), 'notaría elegida; el seguimiento avanza a Pago');
  await w.click('#esDocx'); await w.waitForTimeout(1500);
  const dx = fs.readdirSync(out).find((f) => f.endsWith('.docx')); const xml = await (await JSZip.loadAsync(fs.readFileSync(path.join(out, dx)))).file('word/document.xml').async('string');
  ok(/NOTARIA DE PRUEBA DOS/.test(xml) && /Segunda Notaría/.test(xml) && /Avenida de Prueba/.test(xml) && /\[FECHA\]/.test(xml), 'el Word lleva los datos de la notaría elegida; la fecha queda para la notaría');
  await w.click('#esPrim'); await w.waitForSelector('#adEmail', { timeout: 5000 }).catch(() => {}); ok(await w.isVisible('#adEmail') || await w.isVisible('#view-login'), 'sin sesión pide iniciar sesión para pagar');
  await w.evaluate(() => { window.closeModal?.(); window.Usuario._u.user = { name: 'Prueba' }; window.Escrituras.open(); }); await w.waitForSelector('#esPrim');
  await pagar();
  ok(/Pagado/.test(await txt('.es-item.on')) && /Pagado — pendiente de toma/.test(await txt('.es-dh')) && /En notaría/.test(await txt('.es-track')) && /Segunda Notaría de Prueba/.test(await txt('.es-wr')), 'pagado: queda en la lista con su seguimiento y su notaría');
  await w.waitForSelector('#esVn .es-page', { timeout: 20000 }); ok((await w.$$('.es-file-b')).length >= 3, 'muestra lo que recibió la notaría y sus archivos');
  await w.screenshot({ path: path.resolve(__dirname, 'es2-enviado.png') });

  // firmas con calidad y cierre notarial
  await nuevo('escritura'); await drop('arriendo-saltos.docx'); await w.waitForSelector('.es-work'); await w.waitForTimeout(300);
  const b = await w.evaluate(() => { const S = window.Escrituras._s; return window.Notarial.buildEscritura({ ...S.a, title: S.o.titulo, parties: S.o.partes }, { fecha: null }); });
  const sig = b.find((x) => x.k === 'sigs'); const bodyTxt = b.filter((x) => x.k === 'body').map((x) => x.text).join(' ');
  ok(sig.sigs.length === 2 && sig.sigs[0].rol === 'Arrendador' && !/dos ejemplares/.test(bodyTxt), 'arriendo: firmas con su calidad y cierre notarial');
  // materias ocultas
  await nuevo('escritura'); await drop('mandato-oculto.docx'); await w.waitForSelector('.es-hid');
  ok(/se presenta como/.test(await txt('.es-hid')), 'materias ocultas: un «mandato» que vende e hipoteca');
  // cotización
  await nuevo('escritura'); await drop('minuta2.docx'); await w.waitForSelector('#esMat'); await w.selectOption('#esMat', 'donacion'); await w.waitForTimeout(300);
  await w.fill('[data-ct="0"][data-f="email"]', 'n@ejemplo.cl'); await w.fill('[data-ct="0"][data-f="tel"]', '+56 9 8765 4321');
  await notaria('auto');
  await w.click('#esPrim'); await w.waitForSelector('.es-item.on:not([data-sel="draft"])', { timeout: 20000 }); await w.waitForTimeout(300);
  ok(/Cotización/.test(await txt('.es-item.on')), 'materia sin precio: cotización sin cobro');

  // ===== PROTOCOLIZACIÓN
  await nuevo('protocolizacion'); await drop('contrato-4424.docx'); await w.waitForSelector('.es-ficha', { timeout: 60000 }); await w.waitForTimeout(300);
  ok(/Word · lectura exacta/.test(await txt('.es-ficha')) && /Lo completa la notaría/.test(await txt('.es-ficha')), 'protocolización desde Word: lectura exacta, requirente para la notaría');
  ok(!(await w.$('#esEdit')) && /se protocoliza tal como lo subiste/.test(await txt('.es-wr')), 'el cliente no modifica la carátula');
  await w.waitForSelector('#esVn .es-page', { timeout: 30000 });
  const hj = await w.evaluate(() => window.Escrituras._s.proto.docs.reduce((a, x) => a + x.pages, 0));
  await w.waitForTimeout(1500); console.log('paginas', (await w.$$('#esVn .es-page')).length, hj);
  ok((await w.$$('#esVn .es-page')).length === hj + 1, `cómo va a la notaría: carátula + las ${hj} hojas del documento`);
  await w.fill('[data-k="email"]', 'cliente@ejemplo.cl'); await w.waitForTimeout(100);
  ok((await txt('#esTotal')) === '$40.000', 'tarifa fija $40.000');
  await w.click('[data-notsel]'); await w.waitForSelector('#nLista [data-nid]');
  ok(await w.$eval('[data-nid="np-03"]', (b) => b.disabled) && /No realiza protocolizaciones/.test(await txt('#nLista')), 'la notaría que no protocoliza no se puede elegir');
  await w.click('[data-nid="np-01"]'); await w.click('#nOk'); await w.waitForTimeout(500);
  ok(/Primera Notaría/.test(await txt('#prTxt')) && /Calle de Prueba/.test(await txt('#prTxt')) && /\[REQUIRENTE\]/.test(await txt('#prTxt')), 'la carátula lleva la notaría elegida; el requirente sigue en blanco');
  await pagar(); ok(/Pagado/.test(await txt('.es-item.on')), 'protocolización pagada');
  await nuevo('protocolizacion'); await drop(['scan-contrato.pdf', 'foto-pagina1.jpg']); await w.waitForSelector('#iaSi');
  ok(/no es Word/.test(await txt('#modalCard')), 'PDF o foto: avisa que se leerá con IA');
  await w.click('#iaSi'); await w.waitForSelector('.es-ficha', { timeout: 120000 });
  ok(/leído con IA/.test(await txt('.es-ficha')) && /Hojas4/.test((await txt('.es-ficha')).replace(/\s/g, '')), 'escaneo + foto leídos con IA');

  // ===== REDUCCIÓN: la hacemos nosotros como escritura pública
  await nuevo('reduccion'); await drop('contrato-4424.docx'); await w.waitForSelector('.es-ficha', { timeout: 60000 });
  ok(/Comparecen las mismas partes/.test(await txt('.es-ficha')), 'reducción: comparecen las partes del documento');
  const red = await w.evaluate(() => window.Escrituras._s.red.cuerpo);
  ok(/^comparecen: Uno\) FORUM SERVICIOS FINANCIEROS/.test(red) && /quienes exponen: Que vienen en reducir a escritura pública el documento privado denominado «CONTRATO DE PRENDA SIN DESPLAZAMIENTO»/.test(red) && /noventa y seis millones/.test(red) && /PRIMERO: Bien de propiedad/.test(red), 'escrito en formato de escritura pública: comparecencia en palabras y transcripción');
  await w.waitForSelector('#esVn .es-page', { timeout: 30000 });
  await w.click('#esEdit'); await w.waitForSelector('#esRed'); await w.fill('#esRed', (await w.inputValue('#esRed')).replace('cuyo texto es el siguiente', 'cuyo texto íntegro es el siguiente')); await w.click('#rOk'); await w.waitForTimeout(600);
  ok(/cuyo texto íntegro es el siguiente/.test(await w.evaluate(() => window.Escrituras._s.redCuerpo)), 'el cliente puede modificar el escrito de reducción');
  await w.fill('[data-k="email"]', 'c@ejemplo.cl'); await w.fill('[data-k="tel"]', '+56 9 1111 2222'); await w.waitForTimeout(100);
  await w.click('#esPrim'); await w.waitForTimeout(300); ok(/declarar que el documento está firmado/.test(await txt('#esFalta')), 'no deja pagar sin declarar que está firmado');
  await w.check('#esDecl'); await w.waitForTimeout(300);
  await w.fill('[data-k="email"]', 'c@ejemplo.cl'); await w.fill('[data-k="tel"]', '+56 9 1111 2222');
  await notaria('np-03');
  ok(/NOTARIO DE PRUEBA TRES/.test(await w.evaluate(() => window.Notarial.reduccionBlocks(window.Escrituras._s.proto.info, '', { red: window.Escrituras._s.red, notaria: { nombre: 'Notario de Prueba Tres', suplente: true, titular: 'Notaria Titular de Prueba', ordinal: 'Tercera', ciudad: 'Santiago', direccion: 'x' } }).find((b) => b.k === 'body').text)), 'reducción con notario suplente');
  await w.screenshot({ path: path.resolve(__dirname, 'es7-reduccion.png') });
  await pagar(); ok(/Pagado/.test(await txt('.es-item.on')) && (await w.$$('.es-item')).length >= 4, 'reducción pagada; todos los trámites quedan en la lista');

  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
