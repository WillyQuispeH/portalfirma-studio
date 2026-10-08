// Conversión de Word, Excel y CSV a PDF dentro de la app (sin programas externos).
// Word: mammoth (docx → HTML). Excel/CSV: SheetJS (hoja → tabla HTML).
// Luego Chromium imprime ese HTML a PDF con tamaño carta/A4 y márgenes de documento.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

const BASE_CSS = `
  @page { size: A4; margin: 18mm 18mm 20mm 18mm; }
  body { font-family: Calibri, "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #111; }
  h1 { font-size: 18pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; }
  p { margin: 0 0 8pt; text-align: justify; }
  img { max-width: 100%; }
  table { border-collapse: collapse; margin: 6pt 0; }
  td, th { border: 1px solid #999; padding: 3pt 5pt; vertical-align: top; }
  .sheet { page-break-after: always; } .sheet:last-child { page-break-after: auto; }
  .sheet h2 { font-size: 12pt; color: #444; margin: 0 0 6pt; }
  .sheet table { font-size: 8.5pt; width: 100%; }
  .sheet td { white-space: nowrap; }
`;

function tmpDir() {
  const d = path.join(app.getPath('userData'), 'tmp');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function htmlToPdf(html, { landscape = false } = {}) {
  const file = path.join(tmpDir(), `conv-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${landscape ? '@page{size:A4 landscape}' : ''}</style></head><body>${html}</body></html>`);
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadFile(file);
    return await w.webContents.printToPDF({ pageSize: 'A4', landscape, printBackground: true, preferCSSPageSize: true });
  } finally { w.destroy(); fs.rmSync(file, { force: true }); }
}

async function docxToPdf(buffer) {
  const r = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement((img) => img.read('base64').then((b) => ({ src: `data:${img.contentType};base64,${b}` }))),
  });
  return htmlToPdf(r.value || '<p></p>');
}

async function sheetToPdf(buffer, ext) {
  const wb = ext === '.csv' ? XLSX.read(buffer.toString('utf8'), { type: 'string' }) : XLSX.read(buffer, { type: 'buffer' });
  let maxCols = 0;
  const parts = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) return '';
    const range = XLSX.utils.decode_range(ws['!ref']);
    maxCols = Math.max(maxCols, range.e.c - range.s.c + 1);
    const table = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' }).replace(/^[\s\S]*?(<table[\s\S]*<\/table>)[\s\S]*$/i, '$1');
    const title = wb.SheetNames.length > 1 ? `<h2>${name.replace(/[<>&]/g, '')}</h2>` : '';
    return `<div class="sheet">${title}${table}</div>`;
  }).filter(Boolean);
  if (!parts.length) throw new Error('La planilla está vacía.');
  return htmlToPdf(parts.join(''), { landscape: maxCols > 7 });
}

const KINDS = {
  '.pdf': 'pdf', '.docx': 'docx', '.xlsx': 'sheet', '.xls': 'sheet', '.csv': 'sheet', '.ods': 'sheet',
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image',
};
const EXTENSIONS = Object.keys(KINDS).map((e) => e.slice(1));

// Devuelve { name, kind: 'pdf' | 'image', mime?, bytes } listo para el editor.
async function openForEditor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const kind = KINDS[ext];
  const name = path.basename(filePath);
  if (!kind) {
    if (ext === '.doc') throw new Error('Los archivos .doc antiguos no se pueden convertir. Ábrelo en Word y guárdalo como .docx.');
    throw new Error(`Formato no soportado: ${ext || name}`);
  }
  const buf = fs.readFileSync(filePath);
  if (kind === 'pdf') return { name, kind: 'pdf', bytes: buf };
  if (kind === 'image') return { name, kind: 'image', mime: ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : `image/${ext.slice(1)}`, bytes: buf };
  if (kind === 'docx') return { name: name.replace(/\.docx$/i, '.pdf'), kind: 'pdf', converted: 'Word', bytes: await docxToPdf(buf) };
  return { name: name.replace(/\.[^.]+$/, '.pdf'), kind: 'pdf', converted: 'Excel', bytes: await sheetToPdf(buf, ext) };
}

module.exports = { openForEditor, EXTENSIONS, tmpDir, htmlToPdf };
