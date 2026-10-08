// Prueba del borrado real de texto: lo de adentro de la zona desaparece y lo demás queda idéntico.
const fs = require('fs'); const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const PdfText = require('../src/renderer/pdftext.js');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const ok = (c, m) => { if (!c) { console.error('FALLÓ: ' + m); process.exitCode = 1; } else console.log('  ✔ ' + m); };
async function textItems(bytes, pi = 0) {
  const d = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise; const p = await d.getPage(pi + 1); const vp = p.getViewport({ scale: 1 });
  const tc = await p.getTextContent(); const out = tc.items.filter((i) => i.str.trim()).map((i) => { const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]); return { s: i.str, x, y }; });
  return { out, vp };
}
async function run(name, bytes, pi, rect, mustGo, mustStay) {
  console.log(name);
  const before = await textItems(bytes, pi);
  const doc = await PDFDocument.load(bytes);
  const r = await PdfText.removeTextInRects(doc, pi, [rect], (x, y) => before.vp.convertToViewportPoint(x, y));
  const outBytes = await doc.save(); const after = await textItems(outBytes, pi);
  const all = after.out.map((i) => i.s).join(' '); if (process.env.V) console.log('   →', JSON.stringify(all.slice(0, 200)));
  ok(r.removed > 0, `${r.removed} letras borradas`);
  for (const t of mustGo) ok(!all.includes(t), `ya no está «${t}»`);
  for (const t of mustStay) ok(all.includes(t), `sigue «${t}»`);
  return outBytes;
}
(async () => {
  // 1) PDF simple con Helvetica (fuente estándar, sin anchos en el archivo)
  const d = await PDFDocument.create(); const pg = d.addPage([612, 792]); const f = await d.embedFont(StandardFonts.Helvetica);
  pg.drawText('Arrendador: JUAN PEREZ SOTO, RUT 11.111.111-1', { x: 72, y: 700, size: 12, font: f });
  pg.drawText('Arrendatario: MARIA GONZALEZ, RUT 22.222.222-2', { x: 72, y: 680, size: 12, font: f });
  pg.drawRectangle({ x: 60, y: 600, width: 200, height: 40, color: rgb(0.9, 0.9, 1) });
  const simple = await d.save();
  // zona: la primera línea completa (y visual ~ 792-700-12 .. 792-700+3)
  await run('Helvetica estándar', simple, 0, { x: 70, y: 80, w: 480, h: 16 }, ['JUAN PEREZ'], ['MARIA GONZALEZ', 'Arrendatario']);
  // 2) zona parcial: solo el nombre dentro de la línea
  const x0 = 72 + f.widthOfTextAtSize('Arrendador: ', 12), x1 = 72 + f.widthOfTextAtSize('Arrendador: JUAN PEREZ SOTO', 12);
  const part = await run('Borrado parcial dentro de una línea', simple, 0, { x: x0 - 1, y: 80, w: x1 - x0 + 1, h: 16 }, ['JUAN PEREZ'], ['Arrendador:', ', RUT 11.111.111-1', 'MARIA']);
  const rest = (await textItems(part, 0)).out.find((i) => i.s.startsWith(', RUT')); const want = 72 + [...'Arrendador: JUAN PEREZ SOTO'].reduce((t, ch) => t + f.widthOfTextAtSize(ch, 12), 0); // sin kerning, como se dibuja
  ok(rest && Math.abs(rest.x - want) < 0.05, `el texto que sigue no se movió (x = ${rest?.x.toFixed(2)}, esperado ${want.toFixed(2)})`);
  // 3) PDF de Chromium (fuentes Type0 Identity-H, como Word/Google Docs)
  const lector = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'lector.pdf')));
  const it = (await textItems(lector, 1)).out; const p1 = it.find((i) => /Párrafo 1 de la sección 1/.test(i.s));
  await run('Chromium / Identity-H', lector, 1, { x: p1.x - 2, y: p1.y - 14, w: 600, h: 18 }, ['Párrafo 1 de la sección 1'], ['Párrafo 2 de la sección 1', '1. Partes']);
  // 4) contrato de prueba
  const contrato = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'contrato_prueba.pdf')));
  const ci = (await textItems(contrato, 0)).out; const m = ci.find((i) => /MARIA GONZALEZ/.test(i.s));
  await run('Contrato de prueba', contrato, 0, { x: m.x - 1, y: m.y - 13, w: 520, h: 16 }, ['22.222.222-2'], ['JUAN PEREZ SOTO, RUT 11.111.111-1', 'PRIMERO']);
  // 5) fuentes del catálogo incrustadas por la app (TrueType recortada)
  const fu = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'fuentes.pdf')));
  const fi = (await textItems(fu, 0)).out; const g = fi.find((i) => /^Georgia Bold/.test(i.s));
  await run('Fuentes TrueType incrustadas', fu, 0, { x: g.x - 1, y: g.y - 12, w: 560, h: 14 }, ['Georgia Bold:'], ['Georgia Italic:', 'Georgia:']);
})().catch((e) => { console.error(e); process.exit(1); });
