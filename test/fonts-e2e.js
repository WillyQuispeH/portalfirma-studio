// Catálogo de fuentes: reconocimiento en PDF, texto nuevo con fuentes del catálogo y su incrustación.
const { _electron: electron } = require('playwright'); const path = require('path'); const fs = require('fs');
const F = (n) => path.resolve(__dirname, 'fixtures', n);
const ok = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✔ ' + m); };
(async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: path.join(__dirname, '..'), env: { ...process.env, PF_MOCK: '1' } });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push('PAGE: ' + e.message));
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForSelector('.hub-card');
  const idle = () => w.waitForFunction(() => document.querySelector('#edBusy')?.classList.contains('hidden') ?? true, null, { timeout: 120000 });
  const n = await w.evaluate(() => Object.keys(window.PF_FONTS).length); ok(n >= 90, `${n} familias en el catálogo`);
  await w.evaluate((p) => window.editor.openPaths([p], true), F('fuentes.pdf')); await idle(); await w.waitForTimeout(800);
  const res = await w.evaluate(async () => {
    const E = window.editor, out = [];
    for (let i = 0; i < E._state.count; i++) {
      const p = await E._state.pdf.getPage(i + 1); const tc = await p.getTextContent(); await p.getOperatorList();
      for (const it of tc.items) {
        if (!it.str.includes(':')) continue;
        const raw = p.commonObjs.has(it.fontName) ? p.commonObjs.get(it.fontName).name : it.fontName;
        const label = it.str.split(':')[0].replace(/ (Bold|Italic|BoldItalic)\s*$/, '').trim();
        const exp = Object.values(window.PF_FONTS).find((f) => f.label === label)?.key || ({ LiberationSans: 'sans', LiberationSerif: 'serif', LiberationMono: 'mono', Carlito: 'calibri', Caladea: 'cambria' })[label];
        out.push([label, raw, E._mapFont(raw).family, exp]);
      }
    }
    return out;
  });
  const bad = res.filter((r) => r[3] && r[2] !== r[3]).map((r) => `${r[0]} [${r[1]}] → ${r[2]} (esperado ${r[3]})`); const good = res.length - bad.length;
  console.log('  no reconocidas:', bad.length ? bad : 'ninguna');
  ok(good / res.length > 0.9, `fuente reconocida en ${good} de ${res.length} líneas`);
  // texto nuevo con Garamond negrita cursiva y Great Vibes
  await w.evaluate(() => window.editor.createBlank()); await w.click('#mOk'); await idle(); await w.waitForTimeout(600);
  for (const [fam, txt, y] of [['garamond', 'Garamond negrita cursiva: Señor Pérez', 120], ['greatvibes', 'Great Vibes: Firma del declarante', 200], ['palatino', 'Palatino: «documento» válido', 280]]) {
    await w.click('.tool[data-tool="text"]'); await w.selectOption('#pfFam', fam); const lay = await (await w.$('#edLayer')).boundingBox();
    await w.mouse.click(lay.x + 60, lay.y + y); await w.waitForSelector('.ov-rich.editing .rt');
    if (fam === 'garamond') { await w.click('#pf-bold'); await w.click('#pf-italic'); }
    await w.keyboard.type(txt); await w.keyboard.press('Escape'); await w.keyboard.press('Escape');
  }
  await w.screenshot({ path: path.join(__dirname, 'f1-fuentes.png') });
  const b64 = await w.evaluate(() => window.editor.exportBase64()); fs.writeFileSync(path.join(__dirname, 'out-fuentes.pdf'), Buffer.from(b64, 'base64'));
  console.log('errores:', errs);
  await w.evaluate(() => window.pf.closeNow()).catch(() => {}); await app.close().catch(() => {}); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
