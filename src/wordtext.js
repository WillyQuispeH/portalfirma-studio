// Texto de documentos Word en todas sus variantes, leído de forma exacta (sin OCR ni IA):
//   .docx .docm .dotx .dotm (Office Open XML) · .doc .dot (Word 97-2003) · .rtf · .odt (OpenDocument)
// Conserva párrafos, saltos de línea manuales y tabulaciones, que es donde suelen ir las firmas
// («____ / NOMBRE / Arrendador»).
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const WORD_EXT = ['.docx', '.docm', '.dotx', '.dotm', '.doc', '.dot', '.rtf', '.odt'];
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');

async function ooxml(buf) {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml'); if (!f) throw new Error('El archivo Word está dañado o no es un documento de texto.');
  const xml = await f.async('string');
  const body = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, ''); // cambios eliminados (control de cambios)
  const paras = body.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  return paras.map((p) => {
    let t = '';
    p.replace(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>|<w:noBreakHyphen\/>/g, (m, txt) => {
      if (txt !== undefined) t += ent(txt); else if (m.startsWith('<w:tab')) t += '\t'; else if (m.startsWith('<w:noBreak')) t += '-'; else t += '\n';
      return m;
    });
    return t;
  }).join('\n');
}

async function odt(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('content.xml').async('string');
  const paras = xml.match(/<text:(p|h)\b[^>]*?(?:\/>|>[\s\S]*?<\/text:\1>)/g) || [];
  return paras.map((p) => ent(p.replace(/<text:line-break\/>/g, '\n').replace(/<text:tab\/>/g, '\t').replace(/<text:s(?:\s+text:c="(\d+)")?\/>/g, (_, n) => ' '.repeat(Number(n) || 1)).replace(/<[^>]+>/g, ''))).join('\n');
}

// RTF: grupos de destino ignorados, \par y \line como saltos, \'hh en Windows-1252 y \uN en Unicode.
const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
function rtf(buf) {
  const s = buf.toString('latin1'); let out = ''; const stack = []; let skip = false; let uc = 1; let pendingSkip = 0;
  const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|fldinst)$/;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { stack.push({ skip, uc }); continue; }
    if (c === '}') { const st = stack.pop(); if (st) { skip = st.skip; uc = st.uc; } continue; }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === '\\' || n === '{' || n === '}') { if (!skip) out += n; i++; continue; }
      if (n === "'") { const h = parseInt(s.substr(i + 2, 2), 16); i += 3; if (pendingSkip) { pendingSkip--; continue; } if (!skip) out += CP1252[h] || String.fromCharCode(h); continue; }
      if (n === '*') { skip = true; i++; continue; }
      if (n === '~') { if (!skip) out += ' '; i++; continue; }
      if (n === '-' || n === '_') { if (!skip && n === '_') out += '-'; i++; continue; }
      const m = /^([a-z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 40)); if (!m) continue;
      i += m[0].length; const w = m[1]; const arg = m[2] !== undefined ? Number(m[2]) : null;
      if (SKIP.test(w)) skip = true;
      else if (skip) { /* nada */ } else if (w === 'par' || w === 'line' || w === 'sect' || w === 'page') out += '\n';
      else if (w === 'tab') out += '\t';
      else if (w === 'uc') uc = arg ?? 1;
      else if (w === 'u') { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); pendingSkip = uc; }
      else if (w === 'emdash') out += '—'; else if (w === 'endash') out += '–'; else if (w === 'lquote') out += '‘'; else if (w === 'rquote') out += '’'; else if (w === 'ldblquote') out += '“'; else if (w === 'rdblquote') out += '”'; else if (w === 'bullet') out += '•';
      continue;
    }
    if (c === '\r' || c === '\n') continue;
    if (pendingSkip) { pendingSkip--; continue; }
    if (!skip) out += c;
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

async function doc(file) {
  const WordExtractor = require('word-extractor');
  const d = await new WordExtractor().extract(file);
  return d.getBody().replace(/\r/g, '\n');
}

async function wordText(file) {
  const ext = path.extname(file).toLowerCase();
  if (!WORD_EXT.includes(ext)) throw new Error('No es un documento Word.');
  if (ext === '.doc' || ext === '.dot') return doc(file);
  const buf = fs.readFileSync(file);
  if (ext === '.rtf') return rtf(buf);
  if (ext === '.odt') return odt(buf);
  return ooxml(buf);
}
const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// HTML sencillo para convertir a PDF variantes que no son .docx (la notaría recibe también el Word original)
const textToHtml = (t) => t.split('\n').map((p) => `<p style="margin:0 0 8px;text-align:justify;white-space:pre-wrap">${escH(p) || '&nbsp;'}</p>`).join('');

module.exports = { WORD_EXT, wordText, textToHtml, _rtf: rtf };
