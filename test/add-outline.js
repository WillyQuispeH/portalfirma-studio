// Agrega un índice (marcadores) a test/fixtures/lector.pdf con pdf-lib.
const { PDFDocument, PDFName, PDFString, PDFNumber, PDFNull } = require('pdf-lib'); const fs = require('fs'); const path = require('path');
(async () => {
  const f = path.join(__dirname, 'fixtures', 'lector.pdf');
  const doc = await PDFDocument.load(fs.readFileSync(f)); const ctx = doc.context; const pages = doc.getPages();
  const items = [['Índice', 0], ['1. Partes', 1], ['2. Renta', 2], ['3. Garantía', 3], ['4. Término', 4]];
  const outlineRef = ctx.nextRef(); const refs = items.map(() => ctx.nextRef());
  items.forEach(([t, p], k) => {
    const d = ctx.obj({ Title: PDFString.of(t), Parent: outlineRef, Dest: [pages[p].ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull] });
    if (k > 0) d.set(PDFName.of('Prev'), refs[k - 1]); if (k < items.length - 1) d.set(PDFName.of('Next'), refs[k + 1]);
    ctx.assign(refs[k], d);
  });
  ctx.assign(outlineRef, ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(items.length) }));
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
  fs.writeFileSync(f, await doc.save()); console.log('outline ok');
})();
