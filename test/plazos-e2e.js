// Plazos y vencimientos: informe básico automático (sin IA), informe inteligente opcional (1 token), varios contratos por PDF, redactar.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execSync } = require('child_process');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpl-'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpd-'));
  const { DOCS, pdf } = require('./plazos-docs');
  const docs = []; for (const [n, t] of Object.entries(DOCS)) { const f = path.join(tmp, n); fs.writeFileSync(f, await pdf(t)); docs.push(f); }
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1' } });
  const w = await app.firstWindow(); const errs = global.__errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message)); w.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const sleep = (ms) => w.waitForTimeout(ms);
  await w.click('.hub-card[data-act="plazos"]'); await w.waitForSelector('#plAdd');
  ok(true, 'tarjeta «Plazos y vencimientos» en el inicio');
  const r = await w.evaluate((p) => window.pf.plazosAdd(p), docs); await w.evaluate((r) => window.Plazos.afterAdd(r), r);
  await w.waitForFunction(() => window.Plazos._p.items.length === 4 && window.Plazos._p.items.every((x) => x.status === 'done') && !window.Plazos._p.running, null, { timeout: 60000 }); await sleep(400);
  ok(!(await w.$('#modal:not(.hidden)')), 'informe básico automático: sin pedir permiso de IA');
  ok((await w.evaluate(() => window.pf.aiWallet())).data.balance === 5, 'el informe básico no gasta tokens');
  const rows = await w.evaluate(() => [...document.querySelectorAll('.plz-row:not(.bk-th)')].map((r) => ({ dot: r.querySelector('.plz-dot').className, t: r.textContent.replace(/\s+/g, ' ').trim() })));
  rows.forEach((x) => console.log('   ', x.dot.replace('plz-dot ', ''), '|', x.t.slice(0, 140)));
  ok(/bad/.test(rows[0].dot) && /2 contratos/.test(rows[0].t) && /contrato 2 de 2/.test(rows[0].t), 'PDF con 2 contratos: manda la fecha más próxima (contrato 2), en rojo');
  ok(/bad/.test(rows[1].dot) && /Se renueva sola/.test(rows[1].t), 'arriendo con aviso vencido: rojo, «se renueva sola»');
  ok(/wait/.test(rows[2].dot) && /ok/.test(rows[3].dot) && /Sin vencimiento/.test(rows[3].t), 'luego amarillo y al final verde (indefinido)');
  ok(rows.every((x) => /Informe básico/.test(x.t)), 'la tabla indica «Informe básico»');
  await w.screenshot({ path: path.resolve(__dirname, 'pz1-tabla.png') });
  // detalle del básico
  await w.click('.plz-row:not(.bk-th) >> nth=0'); await w.waitForSelector('#plSmart');
  const d0 = await w.textContent('#plDetail');
  ok(/Informe básico · sin IA/.test(d0) && /Contrato 1 de 2/.test(d0) && /Contrato 2 de 2/.test(d0) && /Calle Nueva 120/.test(d0), 'detalle básico: cada contrato con sus datos');
  ok(/María González Rojas/.test(d0) && /Inversiones Los Robles SpA/.test(d0) && /rep\. por Juan Pérez Soto/.test(d0), 'partes con su representante');
  ok(/1 token/.test(await w.textContent('#plSmart')), 'botón «Generar informe inteligente · 1 token»');
  await w.screenshot({ path: path.resolve(__dirname, 'pz2-basico.png') });
  // inteligente (opcional)
  await w.click('.plz-row:not(.bk-th) >> nth=1'); await w.waitForSelector('#plSmart');
  await w.click('#plSmart');
  await w.waitForSelector('#mOk:has-text("Entiendo")'); await w.click('#mOk');
  await w.waitForSelector('.plz-act', { timeout: 30000 }); await sleep(300);
  ok(/Informe inteligente/.test(await w.textContent('.plz-mode')) && /Aviso de no renovación|no renovación/.test(await w.textContent('.plz-acts')), 'informe inteligente con sugerencias');
  ok((await w.evaluate(() => window.pf.aiWallet())).data.balance === 4, 'el informe inteligente cuesta 1 token');
  ok(/Aviso de no renovación/.test(await w.textContent('.plz-row.sel')), 'la sugerencia aparece en la tabla');
  await w.screenshot({ path: path.resolve(__dirname, 'pz3-inteligente.png') });
  // indefinido → déjalo así
  await w.click('.plz-row:not(.bk-th) >> nth=3'); await w.waitForSelector('#plSmart'); await w.click('#plSmart'); await w.waitForSelector('[data-ok]', { timeout: 30000 });
  ok(/Déjalo así/.test(await w.textContent('.plz-acts')), 'indefinido: «Déjalo así»');
  await w.click('[data-ok]'); await sleep(300);
  ok(/Revisado/.test(await w.textContent('.plz-row:not(.bk-th) >> nth=3')), 'marcado como revisado');
  // redactar la carta sugerida
  const idx = await w.evaluate(() => [...document.querySelectorAll('.plz-row:not(.bk-th)')].findIndex((r) => /Aviso de no renovación/.test(r.textContent)));
  await w.click(`.plz-row:not(.bk-th) >> nth=${idx}`); await w.waitForSelector('[data-draft]');
  const tabs0 = await w.evaluate(() => window.editor.tabCount());
  await w.click('[data-draft] >> nth=0');
  await w.waitForFunction((t) => window.editor.tabCount() > t && window.editor._state.tpl?.mode === 'fill', tabs0, { timeout: 60000 }); await sleep(800);
  ok(true, 'la IA redacta el documento y abre el formulario para completar y firmar');
  await w.evaluate(() => window.Plazos.open()); await sleep(500);
  ok(await w.evaluate(() => window.Plazos._p.items.some((x) => /Redactado/.test(x.done || ''))), 'queda registrado que se redactó');
  ok((await w.evaluate(() => window.pf.aiWallet())).data.balance === 1, 'tokens: 2 informes inteligentes + 1 redacción');
  // calendario
  await app.evaluate(({ dialog, shell }, d) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: d + '/plazo.ics' }); shell.openPath = async () => ''; }, tmp);
  await w.click('.plz-row:not(.bk-th) >> nth=0'); await w.waitForSelector('#plIcs'); await w.click('#plIcs'); await sleep(400);
  const ics = fs.readFileSync(path.join(tmp, 'plazo.ics'), 'utf8'); ok(/BEGIN:VEVENT/.test(ics) && /TRIGGER:-P7D/.test(ics), 'recordatorio para el calendario (.ics, aviso 7 días antes)');
  console.log('Traer de Portalfirma');
  await w.evaluate(() => window.pf.opsSetPhone('987276858'));
  await w.click('.tab[data-view="plazos"]'); await w.waitForSelector('#plPf');
  ok(/Plazos y vencimientos/.test(await w.textContent('.tab[data-view="plazos"]')) && await w.evaluate(() => document.querySelector('.tab[data-view="plazos"]').classList.contains('active')), 'botón «Plazos y vencimientos» en la barra superior');
  const n0 = await w.evaluate(() => window.Plazos._p.items.length);
  await w.click('#plPf');
  await w.waitForFunction((n) => window.Plazos._p.items.length > n, n0, { timeout: 60000 }); await sleep(800);
  const n1 = await w.evaluate(() => window.Plazos._p.items.length);
  ok(n1 - n0 >= 5, `trae los contratos firmados de Portalfirma (${n1 - n0})`);
  await w.waitForSelector('#mOk:has-text("Entiendo"), .tk-big', { timeout: 15000 }).catch(() => {});
  const bad = errs.filter((e) => !/Warning|deprecated|font|TT:/i.test(e)); console.log('errores:', bad); if (bad.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); console.error(global.__errs); process.exit(1); });
