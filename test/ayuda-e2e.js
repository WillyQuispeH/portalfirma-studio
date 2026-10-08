// 0.30 — inicio por niveles, botón de ayuda, buscador de dudas (local) y recorridos guiados.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pfay-'));
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1', PF_MOCK_LOGGED: '1', PF_TOURS: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const sleep = (ms) => w.waitForTimeout(ms);
  // inicio por niveles
  const lv = await w.$$eval('.lvl-h h3', (l) => l.map((x) => x.textContent));
  ok(lv.join('|') === 'Lo esencial|Para ahorrar tiempo|Avanzado', 'inicio ordenado en tres niveles');
  ok(/Una carpeta por caso/.test(await w.textContent('.hub-row[data-act="exp"]')), 'cada función muestra para qué sirve');
  ok(await w.$('.hub-row[data-act="flows"] .new-badge') && await w.$('.hub-row[data-act="exp"] .new-badge'), 'las funciones nuevas llevan «Nuevo»');
  // recorrido automático la primera vez
  await w.waitForSelector('.tour-tip', { timeout: 5000 });
  ok(/Empieza aquí/.test(await w.textContent('.tour-tip')), 'la primera vez se muestra el recorrido del inicio');
  await w.screenshot({ path: path.resolve(__dirname, 'ay1-recorrido.png') });
  let n = 1; while (await w.$('.tour-tip')) { await w.click('[data-tour="next"]'); await sleep(120); n++; if (n > 10) break; }
  ok(n >= 5, `recorrido de ${n - 1} pasos, con Siguiente / Listo`);
  await w.click('.hub-card[data-act="ops"]').catch(() => {}); await sleep(300); await w.evaluate(() => { closeModal(); window.studio.goHome(); }); await sleep(1300);
  ok(!(await w.$('.tour-tip')), 'no se repite al volver al inicio');
  // Nuevo desaparece al abrir
  await w.click('.hub-row[data-act="exp"]'); await sleep(400); await w.evaluate(() => window.Ayuda.endTour()); await w.evaluate(() => window.studio.goHome()); await sleep(500);
  ok(!(await w.$('.hub-row[data-act="exp"] .new-badge')), '«Nuevo» se quita después de abrirla');
  await w.evaluate(() => window.Ayuda.endTour());
  // ayuda
  await w.click('#helpFab'); await w.waitForSelector('#helpPanel.open');
  ok(/En esta pantalla/.test(await w.textContent('#helpPanel')) && /Lo esencial/.test(await w.textContent('#helpPanel')), 'panel de ayuda con guías de la pantalla y por nivel');
  await w.fill('#hpQ', '¿cómo muevo un logo?'); await sleep(400);
  ok(/Mover textos, campos e imágenes/.test(await w.textContent('#hpRes')), 'el buscador entiende la duda («cómo muevo un logo»)');
  await w.fill('#hpQ', 'cuando vence mi contrato de arriendo'); await sleep(400);
  ok(/plazos y vencimientos/i.test(await w.textContent('#hpRes')), 'otra duda: vencimientos');
  await w.screenshot({ path: path.resolve(__dirname, 'ay2-ayuda.png') });
  ok(await w.$('#hpWa'), 'contacto con soporte');
  await w.click('#hpTour'); await w.waitForSelector('.tour-tip'); ok(true, 'el recorrido se puede repetir desde la ayuda');
  await w.keyboard.press('Escape'); await sleep(200); ok(!(await w.$('.tour-tip')), 'Esc cierra el recorrido');
  // ayuda por nivel desde el inicio
  await w.click('.lvl-help[data-help="avanzado"]'); await w.waitForSelector('#helpPanel.open');
  const t = await w.textContent('#helpPanel'); ok(/Flujos documentales/.test(t) && !/Corregir el texto/.test(t), 'el «?» de cada nivel muestra solo sus guías');
  console.log('errores:', errs); if (errs.length) process.exitCode = 1;
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
