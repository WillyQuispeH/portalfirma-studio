/* PortalFirma Studio — reemplazo real de texto.
 * Lee las instrucciones de dibujo de una página PDF, calcula dónde cae cada letra y
 * borra las que están dentro de las zonas indicadas, sin tocar nada más (líneas,
 * imágenes, logos, timbres, el resto del texto). Así el texto editado no queda "tapado"
 * con un parche: desaparece del archivo y el fondo sigue visible.
 * Funciona en la app (window.PdfText) y en Node para las pruebas (module.exports). */
'use strict';
(function (root) {
  const L = root.PDFLib || (typeof require !== 'undefined' ? require('pdf-lib') : null);
  const { PDFName, PDFArray, PDFDict, PDFNumber, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream, PDFDocument, StandardFonts } = L;

  // ---------- utilidades ----------
  const bin = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };
  const unbin = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const ID = [1, 0, 0, 1, 0, 0];
  const num = (o) => (o && typeof o.asNumber === 'function' ? o.asNumber() : typeof o === 'number' ? o : 0);
  const fmt = (n) => { const r = Math.round(n * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
  const hexOf = (s) => { let h = '<'; for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0'); return h + '>'; };
  // WinAnsi (cp1252) → Unicode, para medir fuentes estándar
  const CP1252 = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };

  function streamBytes(ctx, obj) {
    const s = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
    if (!s) return new Uint8Array(0);
    if (typeof s.getUnencodedContents === 'function') return s.getUnencodedContents();
    if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
    if (typeof s.getContents === 'function') return s.getContents();
    return new Uint8Array(0);
  }

  // ---------- analizador léxico del contenido ----------
  const WS = new Set([0, 9, 10, 12, 13, 32]);
  const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
  function parseOps(s) {
    const ops = []; let i = 0; const n = s.length;
    let stack = [], opStart = -1; const arrStack = [];
    const push = (v, at) => { if (opStart < 0) opStart = at; if (arrStack.length) arrStack[arrStack.length - 1].push(v); else stack.push(v); };
    while (i < n) {
      const c = s[i], cc = s.charCodeAt(i);
      if (WS.has(cc)) { i++; continue; }
      if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      const at = i;
      if (c === '(') { // cadena literal
        let depth = 1, out = ''; i++;
        while (i < n && depth) {
          const ch = s[i];
          if (ch === '\\') {
            const nx = s[i + 1];
            if (nx === 'n') { out += '\n'; i += 2; } else if (nx === 'r') { out += '\r'; i += 2; } else if (nx === 't') { out += '\t'; i += 2; }
            else if (nx === 'b') { out += '\b'; i += 2; } else if (nx === 'f') { out += '\f'; i += 2; }
            else if (nx === '\r') { i += s[i + 2] === '\n' ? 3 : 2; } else if (nx === '\n') { i += 2; }
            else if (nx >= '0' && nx <= '7') { let k = 1, o = ''; while (k <= 3 && s[i + k] >= '0' && s[i + k] <= '7') { o += s[i + k]; k++; } out += String.fromCharCode(parseInt(o, 8) & 255); i += k; }
            else { out += nx ?? ''; i += 2; }
          } else if (ch === '(') { depth++; out += ch; i++; } else if (ch === ')') { depth--; if (depth) out += ch; i++; } else { out += ch; i++; }
        }
        push({ str: out }, at); continue;
      }
      if (c === '<' && s[i + 1] === '<') { // diccionario (operandos de BDC, etc.): se guarda sin interpretar
        let depth = 0;
        while (i < n) {
          if (s[i] === '<' && s[i + 1] === '<') { depth++; i += 2; } else if (s[i] === '>' && s[i + 1] === '>') { depth--; i += 2; if (!depth) break; }
          else if (s[i] === '(') { let d = 1; i++; while (i < n && d) { if (s[i] === '\\') i++; else if (s[i] === '(') d++; else if (s[i] === ')') d--; i++; } } else i++;
        }
        push({ dict: true }, at); continue;
      }
      if (c === '<') { const j = s.indexOf('>', i); let h = s.slice(i + 1, j < 0 ? n : j).replace(/[^0-9a-fA-F]/g, ''); if (h.length % 2) h += '0'; let out = ''; for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.substr(k, 2), 16)); i = j < 0 ? n : j + 1; push({ str: out, hex: true }, at); continue; }
      if (c === '[') { if (opStart < 0) opStart = at; arrStack.push([]); i++; continue; }
      if (c === ']') { const a = arrStack.pop() || []; i++; if (arrStack.length) arrStack[arrStack.length - 1].push(a); else stack.push(a); continue; }
      if (c === '/') { let j = i + 1; while (j < n && !WS.has(s.charCodeAt(j)) && !DELIM.has(s[j])) j++; push({ name: s.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) }, at); i = j; continue; }
      if (c === '{' || c === '}' || c === ')' || c === '>') { i++; continue; }
      // número u operador
      let j = i; while (j < n && !WS.has(s.charCodeAt(j)) && !DELIM.has(s[j])) j++;
      const tok = s.slice(i, j); i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { push(parseFloat(tok), at); continue; }
      if (tok === 'true' || tok === 'false' || tok === 'null') { push(tok, at); continue; }
      if (tok === 'BI') { // imagen en línea: se salta hasta EI
        const m = /\sID[\s]/.exec(s.slice(i)); let k = m ? i + m.index + m[0].length : n;
        const re = /\sEI(?=[\s]|$)/g; re.lastIndex = k; const e = re.exec(s); i = e ? e.index + e[0].length : n;
        ops.push({ op: 'BI', args: [], start: opStart < 0 ? at : opStart, end: i }); stack = []; opStart = -1; continue;
      }
      ops.push({ op: tok, args: stack, start: opStart < 0 ? at : opStart, end: i }); stack = []; opStart = -1;
    }
    return ops;
  }

  // ---------- fuentes ----------
  async function fontInfo(ctx, fontDict, cache) {
    if (!fontDict) return null;
    if (cache.has(fontDict)) return cache.get(fontDict);
    const P = (k) => fontDict.lookup(PDFName.of(k));
    const sub = P('Subtype')?.asString?.() || '';
    const info = { twoByte: false, supported: true, widths: null, first: 0, missing: 0, scale: 0.001, std: null, dw: 1000 };
    if (sub === '/Type0') {
      const enc = P('Encoding'); const encName = enc instanceof PDFName ? enc.asString() : null;
      info.twoByte = true;
      if (encName !== '/Identity-H') info.supported = false; // vertical o CMap especial: no se toca
      const desc = P('DescendantFonts'); const cid = desc instanceof PDFArray ? ctx.lookup(desc.get(0)) : null;
      if (cid instanceof PDFDict) {
        info.dw = num(cid.lookup(PDFName.of('DW'))) || 1000;
        const W = cid.lookup(PDFName.of('W')); const map = new Map();
        if (W instanceof PDFArray) {
          const a = W.asArray().map((x) => ctx.lookup(x) ?? x);
          for (let k = 0; k < a.length;) {
            const c1 = num(a[k]); const nx = a[k + 1];
            if (nx instanceof PDFArray) { nx.asArray().forEach((w, q) => map.set(c1 + q, num(ctx.lookup(w) ?? w))); k += 2; }
            else { const c2 = num(nx), w = num(a[k + 2]); for (let q = c1; q <= c2; q++) map.set(q, w); k += 3; }
          }
        }
        info.cidW = map;
      }
    } else {
      if (sub === '/Type3') { const fm = P('FontMatrix'); if (fm instanceof PDFArray) info.scale = num(fm.get(0)); }
      const W = P('Widths');
      if (W instanceof PDFArray) { info.widths = W.asArray().map((x) => num(ctx.lookup(x) ?? x)); info.first = num(P('FirstChar')); }
      const fd = P('FontDescriptor'); if (fd instanceof PDFDict) info.missing = num(fd.lookup(PDFName.of('MissingWidth')));
      if (!info.widths) { // una de las 14 fuentes estándar sin anchos: se miden con pdf-lib
        const base = (P('BaseFont')?.asString?.() || '').replace(/^\/([A-Z]{6}\+)?/, '');
        const std = Object.values(StandardFonts).find((v) => v.toLowerCase() === base.toLowerCase().replace(/,/g, '-').replace(/arial/i, 'Helvetica').replace(/timesnewroman(ps)?(mt)?/i, 'Times-Roman')) || (/bold/i.test(base) ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
        if (!cache.scratch) cache.scratch = await PDFDocument.create();
        info.std = await cache.scratch.embedFont(std);
      }
    }
    cache.set(fontDict, info);
    return info;
  }
  function glyphs(info, str) {
    const out = [];
    if (info.twoByte) {
      for (let k = 0; k + 1 < str.length; k += 2) { const code = (str.charCodeAt(k) << 8) | str.charCodeAt(k + 1); out.push({ bytes: str.substr(k, 2), w: (info.cidW?.get(code) ?? info.dw), space: false }); }
      return out;
    }
    for (let k = 0; k < str.length; k++) {
      const code = str.charCodeAt(k); let w;
      if (info.widths) { const v = info.widths[code - info.first]; w = (v == null ? info.missing : v) * info.scale * 1000; }
      else if (info.std) { const ch = String.fromCharCode(CP1252[code] || code); try { w = info.std.widthOfTextAtSize(ch, 1000); } catch { w = 500; } }
      else w = 500;
      out.push({ bytes: str[k], w, space: code === 32 });
    }
    return out;
  }

  // ---------- intérprete ----------
  // Recorre las operaciones, ubica cada letra y reescribe las que muestran texto dentro de las zonas.
  async function processStream(ctx, s, resources, ctm0, hit, cache, depth) {
    const ops = parseOps(s);
    const fonts = resources?.lookup(PDFName.of('Font'));
    const xobjs = resources?.lookup(PDFName.of('XObject'));
    let gs = { ctm: ctm0.slice(), font: null, info: null, size: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0 };
    const gstack = []; let Tm = ID, Tlm = ID;
    const edits = []; let removed = 0, kept = 0, unsupported = 0;
    const formsChanged = [];
    for (const o of ops) {
      const a = o.args;
      switch (o.op) {
        case 'q': gstack.push({ ...gs, ctm: gs.ctm.slice() }); break;
        case 'Q': if (gstack.length) gs = gstack.pop(); break;
        case 'cm': gs.ctm = mul(a.map(Number), gs.ctm); break;
        case 'BT': Tm = ID; Tlm = ID; break;
        case 'Tf': {
          gs.size = Number(a[1]) || 0; const nm = a[0]?.name;
          const fd = nm && fonts instanceof PDFDict ? fonts.lookup(PDFName.of(nm)) : null;
          gs.font = nm; gs.info = fd instanceof PDFDict ? await fontInfo(ctx, fd, cache) : null; break;
        }
        case 'Tc': gs.Tc = Number(a[0]) || 0; break;
        case 'Tw': gs.Tw = Number(a[0]) || 0; break;
        case 'Tz': gs.Th = (Number(a[0]) || 100) / 100; break;
        case 'TL': gs.TL = Number(a[0]) || 0; break;
        case 'Ts': gs.Ts = Number(a[0]) || 0; break;
        case 'Td': Tlm = mul([1, 0, 0, 1, Number(a[0]) || 0, Number(a[1]) || 0], Tlm); Tm = Tlm; break;
        case 'TD': gs.TL = -(Number(a[1]) || 0); Tlm = mul([1, 0, 0, 1, Number(a[0]) || 0, Number(a[1]) || 0], Tlm); Tm = Tlm; break;
        case 'Tm': Tlm = a.slice(0, 6).map(Number); Tm = Tlm; break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm; break;
        case 'Tj': case 'TJ': case "'": case '"': {
          let prefix = '';
          if (o.op === "'" || o.op === '"') {
            if (o.op === '"') { gs.Tw = Number(a[0]) || 0; gs.Tc = Number(a[1]) || 0; prefix = `${fmt(gs.Tw)} Tw ${fmt(gs.Tc)} Tc `; }
            Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm; prefix += 'T* ';
          }
          const items = o.op === 'TJ' ? (Array.isArray(a[0]) ? a[0] : []) : [a[a.length - 1]];
          const info = gs.info;
          if (!info || !info.supported) { // no se puede ubicar cada letra con seguridad: se deja igual
            unsupported++;
            for (const it of items) {
              if (typeof it === 'number') Tm = mul([1, 0, 0, 1, -it / 1000 * gs.size * gs.Th, 0], Tm);
              else if (it && it.str != null && info) for (const gl of glyphs(info, it.str)) Tm = mul([1, 0, 0, 1, (gl.w / 1000 * gs.size + gs.Tc + (gl.space ? gs.Tw : 0)) * gs.Th, 0], Tm);
            }
            break;
          }
          const parts = []; let changed = false; let run = '';
          const flush = () => { if (run) { parts.push(hexOf(run)); run = ''; } };
          for (const it of items) {
            if (typeof it === 'number') { flush(); parts.push(fmt(it)); Tm = mul([1, 0, 0, 1, -it / 1000 * gs.size * gs.Th, 0], Tm); continue; }
            if (!it || it.str == null) continue;
            for (const gl of glyphs(info, it.str)) {
              const M = mul(mul([gs.size * gs.Th, 0, 0, gs.size, 0, gs.Ts], Tm), gs.ctm);
              const [cx, cy] = apply(M, gl.w / 2000, 0.3);
              const adv = (gl.w / 1000 * gs.size + gs.Tc + (gl.space ? gs.Tw : 0)) * gs.Th;
              if (hit(cx, cy)) { flush(); changed = true; removed++; parts.push(gs.size ? fmt(-adv / gs.Th / gs.size * 1000) : '0'); }
              else { run += gl.bytes; kept++; }
              Tm = mul([1, 0, 0, 1, adv, 0], Tm);
            }
          }
          flush();
          if (changed) edits.push({ start: o.start, end: o.end, text: `${prefix}[${parts.join(' ')}] TJ` });
          break;
        }
        case 'Do': {
          if (depth > 4 || !(xobjs instanceof PDFDict)) break;
          const nm = a[0]?.name; const ref = nm && xobjs.get(PDFName.of(nm)); const x = ref && ctx.lookup(ref);
          if (!(x instanceof PDFStream) || x.dict.lookup(PDFName.of('Subtype'))?.asString?.() !== '/Form') break;
          const mtx = x.dict.lookup(PDFName.of('Matrix')); const fm = mtx instanceof PDFArray ? mtx.asArray().map((v) => num(v)) : ID;
          const res = x.dict.lookup(PDFName.of('Resources')) || resources;
          const r = await processStream(ctx, bin(streamBytes(ctx, x)), res, mul(fm, gs.ctm), hit, cache, depth + 1);
          removed += r.removed; kept += r.kept; unsupported += r.unsupported; formsChanged.push(...r.formsChanged);
          if (r.removed && ref instanceof PDFRef) formsChanged.push({ ref, stream: x, text: r.text });
          break;
        }
        default: break;
      }
    }
    let text = s;
    for (const e of edits.sort((p, q) => q.start - p.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    return { text, removed, kept, unsupported, formsChanged };
  }

  /**
   * Borra el texto cuyas letras caen dentro de `rects` en la página `pageIndex`.
   * rects: [{x, y, w, h}] en coordenadas "de pantalla" a escala 1 (origen arriba a la izquierda), las mismas del editor.
   * toView(x, y) → [vx, vy]: convierte un punto del PDF a esas coordenadas (viewport de pdf.js a escala 1).
   * Devuelve { removed, unsupported } y modifica el documento pdf-lib.
   */
  async function removeTextInRects(doc, pageIndex, rects, toView, opts = {}) {
    if (!rects?.length) return { removed: 0, unsupported: 0 };
    const ctx = doc.context; const page = doc.getPage(pageIndex);
    const pad = opts.pad ?? 0.5;
    const hit = (x, y) => { const [vx, vy] = toView(x, y); return rects.some((r) => vx >= r.x - pad && vx <= r.x + r.w + pad && vy >= r.y - pad && vy <= r.y + r.h + pad); };
    const contents = page.node.get(PDFName.of('Contents'));
    const list = []; const cv = contents instanceof PDFRef ? ctx.lookup(contents) : contents;
    if (cv instanceof PDFArray) cv.asArray().forEach((r) => list.push(r)); else if (contents) list.push(contents);
    const src = list.map((r) => bin(streamBytes(ctx, r))).join('\n');
    const cache = new Map();
    const r = await processStream(ctx, src, page.node.Resources(), ID, hit, cache, 0);
    if (r.removed) {
      const stream = ctx.flateStream(unbin(r.text));
      page.node.set(PDFName.of('Contents'), ctx.register(stream));
    }
    for (const f of r.formsChanged) { // formularios (XObject) con texto borrado: se reemplaza su contenido
      const dict = {}; for (const [k, v] of f.stream.dict.entries()) { const kk = k.asString().slice(1); if (!['Filter', 'DecodeParms', 'Length'].includes(kk)) dict[kk] = v; }
      ctx.assign(f.ref, ctx.flateStream(unbin(f.text), dict));
    }
    return { removed: r.removed, unsupported: r.unsupported };
  }

  const api = { removeTextInRects, parseOps, _bin: bin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PdfText = api;
})(typeof window !== 'undefined' ? window : globalThis);
