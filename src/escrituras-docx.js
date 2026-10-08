// Exporta una escritura (bloques de Notarial.buildEscritura) o una carátula de protocolización a Word.
// Diseño sobrio: oficio, márgenes simétricos (espejo), Arial 12 con interlineado de 22 pt, sin regla ni
// numeración lateral. Las firmas van en una tabla de dos columnas que no se corta y queda unida al cierre.
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, PageNumber,
  LineRuleType, BorderStyle, Table, TableRow, TableCell, WidthType,
} = require('docx');
const JSZip = require('jszip');

const PT = 20; // twips por punto
// Las marcas [ ] (datos que completa la notaría) van destacadas en amarillo
const runs = (text, o) => String(text).split(/(\[[^\]]+\])/).filter(Boolean).map((x) => new TextRun({ ...o, text: x, ...(x.startsWith('[') ? { highlight: 'yellow' } : {}) }));
const OFICIO = { width: 612 * PT, height: 1008 * PT };

function membrete(n) {
  if (!n || !n.nombre) return [new Paragraph({ suppressLineNumbers: true, children: [] })]; // membrete lo pone la notaría
  const t = (s, o = {}) => new Paragraph({ suppressLineNumbers: true, spacing: { line: 200, lineRule: LineRuleType.EXACT, before: 0, after: 0 }, children: [new TextRun({ text: s, font: 'Arial', size: 14, ...o })] });
  const nombre = (n.nombre || '').toUpperCase().split(/\s+/);
  const mitad = Math.ceil(nombre.length / 2);
  return [
    t(nombre.slice(0, mitad).join(' '), { bold: true }),
    t(nombre.slice(mitad).join(' '), { bold: true }),
    t(n.suplente ? 'NOTARIO PÚBLICO SUPLENTE' : 'NOTARIO PÚBLICO'),
    t(`${n.numero || ''}º Notaría de ${n.ciudad || 'Santiago'}`),
  ];
}

function escrituraDoc(blocks, n) {
  n = n || {};
  const base = { font: 'Arial', size: 23 }; // 11,5 pt
  const sp = { line: 22 * PT, lineRule: LineRuleType.EXACT, before: 0, after: 0 };
  const TEXT_W = 612 - 102 - 72; // pt
  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const children = [];
  for (const b of blocks) {
    if (b.k === 'blank') children.push(new Paragraph({ spacing: sp, children: [] }));
    else if (b.k === 'meta') children.push(new Paragraph({ spacing: sp, children: runs(b.text, { ...base, size: 17, characterSpacing: 12, color: '555B66' }) }));
    else if (b.k === 'title') children.push(new Paragraph({ spacing: sp, alignment: AlignmentType.CENTER, keepNext: true, children: [new TextRun({ ...base, size: 26, bold: true, characterSpacing: 32, text: b.text })] }));
    else if (b.k === 'party') children.push(new Paragraph({ spacing: sp, alignment: AlignmentType.CENTER, keepNext: true, children: [new TextRun({ ...base, size: 22, bold: true, characterSpacing: 24, text: b.text })] }));
    else if (b.k === 'and') children.push(new Paragraph({ spacing: sp, alignment: AlignmentType.CENTER, keepNext: true, children: [new TextRun({ ...base, size: 20, characterSpacing: 40, text: b.text })] }));
    else if (b.k === 'sep') { const ind = ((TEXT_W - 70) / 2) * PT; children.push(new Paragraph({ spacing: { ...sp, line: 10 * PT }, indent: { left: ind, right: ind }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '8C9099', space: 1 } }, children: [] })); }
    else if (b.k === 'body') children.push(new Paragraph({ spacing: sp, alignment: AlignmentType.JUSTIFIED, keepNext: !!b.cierre, keepLines: !!b.cierre, widowControl: true, children: runs(b.text, { ...base, characterSpacing: 2 }) }));
    else if (b.k === 'sigs') {
      const cols = b.sigs.length === 1 ? 1 : 2; const rows = [];
      const cell = (g, span = 1) => new TableCell({ columnSpan: span, width: { size: Math.floor(100 * span / cols), type: WidthType.PERCENTAGE }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: g ? [
        new Paragraph({ spacing: { before: 46 * PT, after: 0 }, keepNext: true, alignment: AlignmentType.CENTER, children: [new TextRun({ ...base, size: 19, text: '_______________________________' })] }),
        new Paragraph({ spacing: { before: 40, after: 0 }, keepNext: true, alignment: AlignmentType.CENTER, children: [new TextRun({ ...base, size: 19, bold: true, characterSpacing: 16, text: g.name })] }),
        ...(g.rol ? [new Paragraph({ spacing: { before: 10, after: 0 }, keepNext: true, alignment: AlignmentType.CENTER, children: [new TextRun({ ...base, size: 17, text: g.rol })] })] : []),
        new Paragraph({ spacing: { before: 20, after: 180 }, keepNext: true, alignment: AlignmentType.CENTER, children: [new TextRun({ ...base, size: 17, text: g.ci ? `C.I. N° ${g.ci}` : '' })] }),
      ] : [new Paragraph({ children: [] })] });
      for (let i = 0; i < b.sigs.length; i += cols) { const solo = cols === 2 && !b.sigs[i + 1]; rows.push(new TableRow({ cantSplit: true, children: solo ? [cell(b.sigs[i], 2)] : Array.from({ length: cols }, (_, c) => cell(b.sigs[i + c])) })); }
      children.push(new Paragraph({ spacing: sp, keepNext: true, children: [] }));
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }, rows }));
    }
  }
  const pie = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: 'Arial', size: 18, color: '555B66', children: [PageNumber.CURRENT] })] })] });
  return new Document({
    evenAndOddHeaderAndFooters: true,
    styles: { default: { document: { run: { font: 'Arial', size: 24 } } } },
    sections: [{
      properties: { page: { size: OFICIO, margin: { top: 104 * PT, bottom: 92 * PT, left: 102 * PT, right: 72 * PT, header: 36 * PT, footer: 40 * PT } } },
      headers: { default: new Header({ children: membrete(n) }), even: new Header({ children: [new Paragraph({ children: [] })] }) },
      footers: { default: pie, even: pie },
      children,
    }],
  });
}

function caratulaDoc(d, n) {
  n = n || {};
  const f = { font: 'Verdana', size: 22 };
  const sp = { line: 360, before: 0, after: 0 };
  const P = (text, o = {}, po = {}) => new Paragraph({ spacing: sp, ...po, children: [new TextRun({ ...f, text, ...o })] });
  const blank = () => new Paragraph({ spacing: sp, children: [] });
  const rich = (s) => s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).flatMap((x) => (x.startsWith('**') ? runs(x.slice(2, -2), { ...f, bold: true }) : runs(x, f)));
  const children = [
    new Paragraph({ spacing: sp, children: runs(`REPERTORIO Nº ${d.repertorio || '[_______]'}`, { ...f, bold: true }) }),
    new Paragraph({ spacing: sp, children: runs(`PROTOCOLIZADO Nº ${d.numero || '[_______]'}`, { ...f, bold: true }) }),
    blank(), blank(),
    P('PROTOCOLIZACIÓN DE DOCUMENTOS', { bold: true }, { alignment: AlignmentType.CENTER }),
    P('*'.repeat(40), {}, { alignment: AlignmentType.CENTER }),
    P((d.titulo || '').toUpperCase(), { bold: true }, { alignment: AlignmentType.CENTER }),
    blank(),
  ];
  if (d.partes && d.partes[0]) {
    children.push(P(d.partes[0].toUpperCase(), { bold: true }, { alignment: AlignmentType.CENTER }));
    if (d.partes[1]) children.push(P('A', { bold: true }, { alignment: AlignmentType.CENTER }), P(`“${d.partes[1].toUpperCase()}”`, { bold: true }, { alignment: AlignmentType.CENTER }));
  }
  children.push(P('*'.repeat(40), {}, { alignment: AlignmentType.CENTER }), blank());
  children.push(new Paragraph({ spacing: sp, alignment: AlignmentType.JUSTIFIED, children: rich(d.texto || '') }));
  return new Document({
    styles: { default: { document: { run: { font: 'Verdana', size: 22 } } } },
    sections: [{
      properties: { page: { size: OFICIO, margin: { top: 150 * PT, bottom: 90 * PT, left: 110 * PT, right: 70 * PT, header: 40 * PT } } },
      headers: { default: new Header({ children: membrete(n) }) },
      children,
    }],
  });
}

// docx no expone «márgenes simétricos»: se agrega <w:mirrorMargins/> a settings.xml.
async function mirror(buf) {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/settings.xml');
  if (f) {
    let x = await f.async('string');
    if (!/w:mirrorMargins/.test(x)) x = x.replace(/(<w:settings[^>]*>)/, '$1<w:mirrorMargins/>');
    zip.file('word/settings.xml', x);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function escrituraDocx(blocks, notaria) { return mirror(await Packer.toBuffer(escrituraDoc(blocks, notaria))); }
async function caratulaDocx(data, notaria) { return Packer.toBuffer(caratulaDoc(data, notaria)); }

module.exports = { escrituraDocx, caratulaDocx };
