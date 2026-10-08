// Redactar con IA: documento con campos listo para completar, mejoras con el chat, texto a mano, bloqueos y leyenda.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execSync } = require('child_process');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfdoc-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const sleep = (ms) => w.waitForTimeout(ms);
  const bal = async () => (await w.evaluate(() => window.pf.aiWallet())).data.balance;
  const pdfText = async (n) => { const b64 = await w.evaluate(() => window.editor.exportBase64()); const f = path.resolve(__dirname, n); fs.writeFileSync(f, Buffer.from(b64, 'base64')); return execSync(`pdftotext "${f}" -`).toString().replace(/\s+/g, ' '); };

  console.log('Bloqueos (sin gastar tokens)');
  for (const [q, re] of [['Pagaré por $5.000.000 a favor de Juan Pérez con vencimiento en marzo', /pagaré no puede firmarse/], ['Autorización para que mi hijo de 10 años salga del país con su abuela', /menor salga del país/], ['Finiquito del trabajador Pedro Soto por renuncia voluntaria', /finiquito no puede/i]]) {
    await w.click('.hub-card:has-text("Asistente legal")'); await w.waitForSelector('#dq'); await w.fill('#dq', q); await w.click('#mOk');
    await w.waitForSelector('#modalCard:has-text("presencialidad")'); ok(re.test(await w.textContent('#modalCard')), 'bloquea: ' + q.slice(0, 30) + '…');
    if (/Pagaré/.test(q)) { ok(await w.locator('#mOk:has-text("mandato")').count() === 1, 'sugiere el mandato para el pagaré'); }
    await w.click('#mCancel'); await sleep(200);
  }
  ok(await bal() === 5, 'los bloqueos no gastan tokens');

  console.log('Redactar');
  await w.click('.hub-card:has-text("Asistente legal")'); await w.waitForSelector('#dq');
  await w.fill('#dq', 'Contrato de arriendo de oficina en Providencia por 12 meses, renta de $800.000 reajustable por IPC.'); await w.click('#mOk');
  await w.waitForSelector('#aiFree'); ok(/modelo de Portalfirma/.test(await w.textContent('#modalCard')) && /Contrato de Arriendo Sin codeudor/.test(await w.textContent('#modalCard')), 'antes de redactar, ofrece el modelo de Portalfirma');
  await w.screenshot({ path: path.resolve(__dirname, 'g0-modelo.png') });
  await w.click('#aiFree');
  await w.waitForSelector('#mOk:has-text("Entiendo")'); await w.click('#mOk');
  await w.waitForSelector('.tpl-fill', { timeout: 60000 }); await idle(); await sleep(1500);
  const st = await w.evaluate(() => ({ mode: window.editor._state.tpl?.mode, n: window.editor._state.tpl.def.fields.length, labels: window.editor._state.tpl.def.fields.map((f) => f.label), name: window.editor._state.name }));
  console.log('   ', JSON.stringify(st));
  ok(st.mode === 'fill', 'abre directo en el formulario');
  ok(st.n === 12 && !st.labels.includes('Sobra'), '10 campos del texto + 2 correos de firmantes (sin campos sobrantes)');
  ok(await bal() === 3, 'redactar usa 2 tokens');
  ok(await w.evaluate(() => [...document.querySelectorAll('[data-in]')].some((x) => x.value === '800000')), 'el dato conocido (renta) viene prellenado');
  ok(await w.locator('#aiImpGo').count() === 1 && await w.locator('#aiEditTxt').count() === 1, 'panel con «Mejorar con IA» y «Editar el texto a mano»');
  await w.screenshot({ path: path.resolve(__dirname, 'g1-formulario.png') });
  let txt = await pdfText('out-g0.pdf');
  ok(/Ley N° 19\.799/.test(txt) && /firma electrónica avanzada/.test(txt), 'leyenda de firma electrónica al final');
  ok(!/____|Arrendador: _/.test(txt), 'sin pies de firma');
  const fid = (l) => w.evaluate((x) => window.editor._state.tpl.def.fields.find((f) => f.label === x).id, l);
  const fill = async (l, v) => { const id = await fid(l); await w.fill(`[data-in="${id}"]`, v); await w.locator(`[data-in="${id}"]`).blur(); };
  await fill('Arrendatario: nombre', 'Comercial Andes SpA'); await fill('Arrendatario: RUT', '12.345.678-5'); await sleep(600);

  console.log('Mejorar con IA');
  await w.fill('#aiImp', 'Agrega una cláusula de codeudor solidario'); await w.click('#aiImpGo');
  await w.waitForFunction(() => window.editor._state.tpl?.def.fields.some((f) => f.label === 'Codeudor: nombre'), null, { timeout: 60000 }); await idle(); await sleep(1500);
  ok(await bal() === 2, 'cada modificación usa 1 token');
  const v = await w.evaluate(() => { const t = window.editor._state.tpl; return t.def.fields.filter((f) => /Arrendatario: (nombre|RUT)/.test(f.label)).map((f) => t.values[f.id]); });
  ok(v.includes('Comercial Andes SpA') && v.includes('12.345.678-5'), 'los datos ya escritos se conservan');
  ok(/codeudor solidario/i.test(await w.textContent('.ai-hist')), 'historial de cambios');
  txt = await pdfText('out-g1.pdf');
  ok(/Codeudor solidario/i.test(txt) && /\[Codeudor: nombre\]/.test(txt), 'la cláusula nueva con sus campos');
  await w.screenshot({ path: path.resolve(__dirname, 'g2-mejorado.png') });

  console.log('Pedir un pagaré en el chat');
  await w.fill('#aiImp', 'agrega un pagaré como garantía'); await w.click('#aiImpGo'); await w.waitForSelector('#modalCard:has-text("presencialidad")'); await w.click('#mCancel');
  ok(await bal() === 2, 'bloqueado sin cobrar');

  console.log('Editar el texto a mano');
  await w.click('#aiEditTxt'); await w.waitForSelector('#eBody');
  const body = await w.inputValue('#eBody');
  await w.fill('#eBody', body.replace('tendrá una duración de doce meses', 'tendrá una duración de [[Plazo en meses]] meses'));
  await w.click('#mOk'); await w.waitForFunction(() => window.editor._state.tpl?.def.fields.some((f) => f.label === 'Plazo en meses'), null, { timeout: 60000 }); await idle(); await sleep(1200);
  ok(await bal() === 2, 'editar a mano no cobra');
  await fill('Plazo en meses', '24');
  await fill('Ciudad', 'Providencia'); await fill('Arrendador: nombre', 'María Soto'); await fill('Arrendador: RUT', '11.111.111-1'); await fill('Arrendador: domicilio', 'Av. Italia 1000');
  await fill('Dirección de la oficina', 'Av. Providencia 1234, oficina 501'); await fill('Codeudor: nombre', 'Luis Rojas'); await fill('Codeudor: RUT', '22.222.222-2');
  for (const l of ['Fecha del contrato', 'Fecha de inicio']) await w.fill(`[data-in="${await fid(l)}"]`, '2026-11-01');
  await fill('Arrendador: correo', 'maria@correo.cl'); await fill('Arrendatario: correo', 'andes@correo.cl'); await sleep(900);

  console.log('Generar');
  await w.click('#tplGen'); await idle(); await sleep(1500);
  const g = await w.evaluate(() => ({ signers: window.editor._state.signers, tpl: !!window.editor._state.tpl }));
  ok(!g.tpl && g.signers.length === 3 && g.signers.find((s) => s.alias === 'Arrendatario').email === 'andes@correo.cl', 'documento final con 3 firmantes (y el correo del formulario)');
  txt = await pdfText('out-g2.pdf');
  ok(/Comercial Andes SpA/.test(txt) && /\$800\.000 \(ochocientos mil pesos\)/.test(txt) && /1 de noviembre de 2026/.test(txt) && /24 meses/.test(txt), 'datos con formato en el PDF');
  ok(!/\[/.test(txt.replace(/\[Página/g, '')), 'sin marcadores pendientes');
  ok(/Ley N° 19\.799/.test(txt), 'mantiene la leyenda');
  await w.screenshot({ path: path.resolve(__dirname, 'g3-final.png') });
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
