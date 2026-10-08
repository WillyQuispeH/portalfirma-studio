/* Motor notarial de PortalFirma Studio: análisis de minutas de escrituras, paso de cifras a palabras,
   armado del texto notarial (30 líneas por hoja) y de la carátula de protocolización.
   Sin dependencias: funciona en la app (window.Notarial) y en Node (pruebas). */
(function (root) {
'use strict';

// ---------------------------------------------------------------- números a palabras
const U = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const D = { 3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta', 7: 'setenta', 8: 'ochenta', 9: 'noventa' };
const C = { 1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos', 5: 'quinientos', 6: 'seiscientos', 7: 'setecientos', 8: 'ochocientos', 9: 'novecientos' };
function lt100(n) { if (n < 30) return U[n]; const d = Math.floor(n / 10), u = n % 10; return D[d] + (u ? ' y ' + U[u] : ''); }
function lt1000(n) { if (n === 100) return 'cien'; const c = Math.floor(n / 100), r = n % 100; return [c ? C[c] : '', r ? lt100(r) : ''].filter(Boolean).join(' '); }
// «uno» → «un» delante de mil, millones o un sustantivo masculino (veintiuno → veintiún)
const apoc = (s) => s.replace(/veintiuno$/, 'veintiún').replace(/(^|\s)uno$/, '$1un');
function numToWords(n, { apocope = false } = {}) {
  n = Math.floor(Math.abs(Number(n)));
  if (!Number.isFinite(n)) return '';
  if (n === 0) return 'cero';
  const parts = [];
  const bill = Math.floor(n / 1e12); n %= 1e12;
  const mill = Math.floor(n / 1e6); n %= 1e6;
  const th = Math.floor(n / 1000); const r = n % 1000;
  if (bill) parts.push(bill === 1 ? 'un billón' : apoc(lt1000(bill)) + ' billones');
  if (mill) parts.push(mill === 1 ? 'un millón' : apoc(milesDe(mill)) + ' millones');
  if (th) parts.push(th === 1 ? 'mil' : apoc(lt1000(th)) + ' mil');
  if (r) parts.push(lt1000(r));
  const s = parts.join(' ');
  return apocope ? apoc(s) : s;
}
function milesDe(n) { const th = Math.floor(n / 1000), r = n % 1000; return [th ? (th === 1 ? 'mil' : apoc(lt1000(th)) + ' mil') : '', r ? lt1000(r) : ''].filter(Boolean).join(' '); }
const DIG = ['CERO', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];

// Palabras → número (para validar un RUT escrito en palabras). Devuelve null si no se entiende.
const W = {}; U.forEach((w, i) => (W[w] = i)); W.un = 1; W.una = 1; W.veintiún = 21; W.veintiun = 21; W.veintidos = 22; W.veintitres = 23; W.veintiseis = 26; W.dieciseis = 16;
Object.entries(D).forEach(([k, v]) => (W[v] = Number(k) * 10)); Object.entries(C).forEach(([k, v]) => (W[v] = Number(k) * 100)); W.cien = 100; W.quinientos = 500;
function wordsToNumber(text) {
  const toks = String(text).toLowerCase().normalize('NFC').replace(/[^a-záéíóúñü ]/g, ' ').split(/\s+/).filter((t) => t && t !== 'y');
  if (!toks.length) return null;
  let total = 0, cur = 0, ok = false;
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    if (t === 'cientos' && i > 0) { cur = cur - (W[toks[i - 1]] || 0) + (W[toks[i - 1]] || 0) * 100; continue; } // «seis cientos»
    if (t === 'mil') { total += (cur || 1) * 1000; cur = 0; ok = true; continue; }
    if (t === 'millón' || t === 'millon' || t === 'millones') { total = (total + (cur || 1)) * 1e6; cur = 0; ok = true; continue; }
    if (t in W) { cur += W[t]; ok = true; continue; }
    return null;
  }
  return ok ? total + cur : null;
}

// ---------------------------------------------------------------- RUT
function rutDV(n) { let s = 0, m = 2; for (let x = Math.floor(n); x > 0; x = Math.floor(x / 10)) { s += (x % 10) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (s % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); }
const dvWord = (dv) => (String(dv).toUpperCase() === 'K' ? 'ka' : U[Number(dv)]);
const dvFromWord = (w) => { w = String(w).toLowerCase().trim(); if (/^(k|ka)$/.test(w)) return 'K'; const i = U.indexOf(w); return i >= 0 && i < 10 ? String(i) : /^\d$/.test(w) ? w : null; };
function rutToWords(num, dv) { return `${numToWords(num, { apocope: true })} guión ${dvWord(dv)}`; }

// ---------------------------------------------------------------- fechas
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dayWords = (d) => (d === 1 ? 'primero' : numToWords(d));
function dateToWords(d) { return `${dayWords(d.getDate())} de ${MESES[d.getMonth()]} de ${numToWords(d.getFullYear())}`; }
function dateNumeric(d) { return `${d.getDate()} de ${MESES[d.getMonth()][0].toUpperCase() + MESES[d.getMonth()].slice(1)} de ${d.getFullYear()}`; }

// ---------------------------------------------------------------- cifras → palabras en un texto
const toInt = (s) => Number(String(s).replace(/\./g, ''));
function spellCode(code) { // patentes, chasis, motores: letras separadas y dígitos en palabras
  return code.split('').map((c) => (/\d/.test(c) ? DIG[c] : c === '-' ? 'GUIÓN' : c.toUpperCase())).join(' ').replace(/\s+/g, ' ').trim();
}
function decimalWords(intPart, dec) { return numToWords(toInt(intPart)) + (dec ? ' coma ' + (/^0/.test(dec) ? dec.split('').map((x) => U[x]).join(' ') : numToWords(Number(dec))) : ''); }
function convertNumbers(text, { count } = {}) {
  let n = 0; const hit = (s) => { n++; return s; };
  let t = String(text);
  t = t.replace(/\bN\s*[°ºo]\s*\.?\s*(?=\d)/g, 'número ').replace(/\bN[°º]\b/g, 'número').replace(/\bNro\.?\s*(?=\d)/gi, 'número ');
  // RUT con puntos o sin ellos
  t = t.replace(/\b(\d{1,2}(?:\.\d{3}){2}|\d{7,8})\s*-\s*([\dkK])\b/g, (_, a, dv) => hit(rutToWords(toInt(a), dv)));
  // montos en pesos: $ 13.107.981.- / $412.660 pesos
  t = t.replace(/\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?:\.-|-)?(\s+pesos)?/g, (_, a, dec) => hit(numToWords(toInt(a), { apocope: true }) + (dec ? ' coma ' + numToWords(Number(dec)) : '') + ' pesos'));
  // UF
  t = t.replace(/\b(?:UF|U\.F\.)\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?/g, (_, a, dec) => hit(decimalWords(a, dec) + ' unidades de fomento'));
  // fechas: 19 de Enero de 2023 · 19/01/2023 · 2023-01-19
  t = t.replace(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de|del)\s+(?:año\s+)?(\d{4})\b/gi, (_, d, m, y) => hit(`${dayWords(Number(d))} de ${m.toLowerCase()} de ${numToWords(Number(y))}`));
  t = t.replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g, (_, d, m, y) => (m > 0 && m <= 12 ? hit(`${dayWords(Number(d))} de ${MESES[m - 1]} de ${numToWords(Number(y))}`) : _));
  // porcentajes
  t = t.replace(/\b(\d+)(?:[.,](\d+))?\s*(%|por\s+ciento)/g, (_, a, dec) => hit(decimalWords(a, dec) + ' por ciento'));
  // códigos alfanuméricos (patentes, chasis, motor)
  t = t.replace(/\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9]{2,}(?:-[A-Za-z0-9]+)*\b/g, (m) => (/^\d+(º|°)$/.test(m) ? m : hit(spellCode(m))));
  // ordinales 49º / 1°
  t = t.replace(/\b(\d+)\s*[º°ª]/g, (_, a) => hit(ordinal(Number(a)).toLowerCase()));
  // números con decimales y enteros (incluye 3.365)
  t = t.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+),(\d+)\b/g, (_, a, dec) => hit(decimalWords(a, dec)));
  t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b|\b\d+\b/g, (m) => hit(numToWords(toInt(m))));
  if (count) count.n = n;
  return t;
}
const ORD1 = ['', 'Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta', 'Séptima', 'Octava', 'Novena'];
const ORD10 = ['', 'Décima', 'Vigésima', 'Trigésima', 'Cuadragésima', 'Quincuagésima', 'Sexagésima', 'Septuagésima', 'Octogésima', 'Nonagésima'];
function ordinal(n) { n = Number(n); if (!(n > 0 && n < 100)) return String(n); const d = Math.floor(n / 10), u = n % 10; if (n === 11) return 'Undécima'; if (n === 12) return 'Duodécima'; return [ORD10[d], ORD1[u]].filter(Boolean).join(' '); }

// ---------------------------------------------------------------- lectura de la minuta
const isUpperName = (s) => { const l = s.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, ''); return l.length >= 4 && l === l.toUpperCase(); };
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9Ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ROL = /\b(representante|arrendador|arrendatari|vendedor|comprador|promitente|mandante|mandatari|deudor|acreedor|codeudor|fiador|aval|gerente|apoderad|socio|cedente|cesionari|donante|donatari|constituyente|propietari|due[ñn]o|legal|p\.\s?p\.|por\s+sí|en\s+representaci)/i;
const isNameLine = (l) => { const w = l.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü ]/g, ' ').trim().split(/\s+/).filter(Boolean); return w.length >= 2 && w.length <= 7 && l.length <= 70 && !/[.:;]$/.test(l) && w.every((x) => /^[A-ZÁÉÍÓÚÑÜ]/.test(x) || /^(de|del|la|las|los|y)$/i.test(x)); };
const isCiLine = (l) => /^(c\.?\s*n?\.?\s*i\.?|rut|r\.u\.t\.?|c\.i\.|c[ée]dula)\b/i.test(l) || /^\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]$/.test(l);
const isRule = (l) => /^[_.\-–—]{4,}$/.test(l) || /^firma\s*:?$/i.test(l);
// Bloque de firmas: «____ / NOMBRE / Rol / C.I.», también en columnas separadas por tabulación.
function leerFirmas(lines) {
  const cols = lines.some((l) => /\t/.test(l.trim())) ? Math.max(...lines.map((l) => l.trim().split(/\t+/).length)) : 1;
  const seqs = Array.from({ length: cols }, () => []);
  lines.forEach((l) => { const cells = cols > 1 ? l.trim().split(/\t+/) : [l]; cells.forEach((c, k) => { const t = c.replace(/\s+/g, ' ').trim(); if (t) seqs[Math.min(k, cols - 1)].push(t); }); });
  const out = [];
  for (const seq of seqs) {
    let cur = null; const close = () => { if (cur && cur.name) out.push({ ...cur, rol: cur.rol.join(' ').trim() }); cur = null; };
    for (const l of seq) {
      if (isRule(l)) { close(); cur = { name: '', rol: [], ci: '', linea: true }; continue; }
      if (isCiLine(l)) { if (cur) { const m = l.match(/\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]/); cur.ci = m ? m[0].replace(/\s/g, '') : ''; } continue; }
      if (!cur) cur = { name: '', rol: [], ci: '', linea: false };
      if (!cur.name) { if (isNameLine(l) || isUpperName(l)) cur.name = l.replace(/^[\s_.-]+|[\s_.-]+$/g, ''); else cur.rol.push(l); continue; }
      if (isUpperName(l) && isNameLine(l) && !ROL.test(l) && !cur.linea) { close(); cur = { name: l, rol: [], ci: '', linea: false }; continue; }
      if (isUpperName(l) && isNameLine(l) && !ROL.test(l) && cur.rol.length) { close(); cur = { name: l, rol: [], ci: '', linea: false }; continue; }
      cur.rol.push(l);
    }
    close();
  }
  return out;
}
function parseMinuta(raw) {
  // «______NOMBRE» (línea de firma pegada al nombre) se separa en dos renglones
  const lines = String(raw).replace(/\r/g, '').split('\n').flatMap((l) => l.replace(/(_{4,})[ \t]*(?=[^\s_])/g, '$1\n').replace(/([^\s_])[ \t]*(_{4,})/g, '$1\n$2').split('\n')).map((l) => l.replace(/[  ]+/g, ' ').replace(/^ +| +$/g, '')).filter((l) => l.trim());
  const paras = lines.map((l) => l.replace(/\t+/g, ' ').trim());
  let bodyStart = paras.findIndex((p) => /^(compare(ce|cen)\b|en\s+[a-záéíóúñ ]+,?\s+(de\s+chile,?\s+)?a\s)/i.test(p) || p.length > 260);
  if (bodyStart < 0) bodyStart = Math.min(1, paras.length);
  const head = paras.slice(0, bodyStart);
  const title = head[0] || '';
  const rest = head.slice(1);
  const sepI = rest.findIndex((p) => /^-?\s*a\s*[-–]?$/i.test(p));
  const parties = sepI >= 0 ? [rest.slice(0, sepI).join(' '), rest.slice(sepI + 1).join(' ')] : rest.length ? [rest.join(' '), ''] : ['', ''];
  // bloque de firmas: tramo de renglones cortos con líneas de firma o al menos dos nombres (no un subtítulo suelto)
  const short = (p) => p.length < 100 && !/^(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[EÉ]PTIMO|OCTAVO|NOVENO|D[EÉ]CIMO)\b.{25,}/i.test(p);
  let end = paras.length; let stop = paras.length;
  for (let i = bodyStart + 1; i < paras.length; i++) {
    if (!(isRule(paras[i]) || isShortSig(paras[i]) || isNameLine(paras[i]))) continue;
    let k = i; while (k < paras.length && short(paras[k])) k++;
    const run = paras.slice(i, k);
    const names = run.filter((p) => isUpperName(p) || isNameLine(p)).length;
    if (run.some(isRule) || names >= 2 || k === paras.length) { end = i; stop = k; break; }
    i = k;
  }
  const sigInfo = end < paras.length ? leerFirmas(lines.slice(lines.findIndex((l, n) => n >= end && l.replace(/\t+/g, ' ').trim() === paras[end]), lines.length).slice(0, stop - end)) : [];
  const body = paras.slice(bodyStart, end);
  const after = paras.slice(stop);
  return { title, parties, body, signatures: sigInfo.map((g) => g.name), sigInfo, leftovers: after, paragraphs: paras };
}
const isShortSig = (p) => (p.length < 70 && (isUpperName(p) || /^(c\.?\s*n?\.?\s*i\.?|rut|r\.u\.t|c\.i\.)\b/i.test(p) || /^_{3,}/.test(p) || /^p\.p\./i.test(p)));

// ---------------------------------------------------------------- comparecientes
const NAME = "[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'.\\-]+(?:[ ,]+(?:DE |DEL |LA |LOS |Y )?[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'.\\-]+){1,6}";
const NAC = '(chilen[oa]s?|extranjer[oa]|argentin[oa]|peruan[oa]|venezolan[oa]|colombian[oa]|bolivian[oa]|ecuatorian[oa]|español[a]?|haitian[oa]|uruguay[oa]|paraguay[oa]|brasileñ[oa]|cuban[oa]|chin[oa]|estadounidense|frances[a]?|italian[oa]|aleman[a]?)';
const EC = /\b(solter[oa]|casad[oa](?:\s+(?:y\s+)?(?:bajo|en|abajo)\s+(?:el\s+)?(?:régimen\s+de\s+)?(?:separación\s+(?:total\s+)?de\s+bienes|sociedad\s+conyugal|participación\s+en\s+los\s+gananciales))?|divorciad[oa]|viud[oa]|separad[oa](?:\s+judicialmente)?|conviviente\s+civil)\b/i;
function extractComparecientes(bodyText) {
  const txt = bodyText.replace(/\s+/g, ' ');
  const re = new RegExp(`(?:\\b(?:don|doña|señor|señora|Don|Doña)\\s+)?(${NAME})(\\s*,)?\\s+${NAC}\\s*,`, 'g');
  const hits = []; let m;
  while ((m = re.exec(txt))) {
    const before = txt.slice(Math.max(0, m.index - 160), m.index);
    hits.push({ i: m.index, name: m[1].replace(/\s+/g, ' ').replace(/,$/, '').trim(), nac: m[3], sinComa: !m[2],
      repr: /(?:representaci[oó]n[^;]{0,90}?\bde|\by\s+de|representad[oa]\s+por)\s*(?:(?:don|doña)\s+)?$/i.test(before),
      porRepr: /representad[oa]\s+por\s*(?:(?:don|doña)\s+)?$/i.test(before) });
  }
  const out = [];
  for (let k = 0; k < hits.length; k++) {
    const h = hits[k]; const seg = txt.slice(h.i, k + 1 < hits.length ? hits[k + 1].i : Math.min(txt.length, h.i + 900));
    const p = { sinComa: h.sinComa, nombre: h.name.replace(/,/g, ''), nombreOriginal: h.name, nacionalidad: h.nac.toLowerCase(), estadoCivil: '', profesion: '', cedula: '', rut: null, dv: null, rutOk: null, domicilio: '', calidad: '', representa: '' };
    const ec = seg.match(EC); if (ec) p.estadoCivil = ec[1].replace(/\s+/g, ' ');
    const afterEc = ec ? seg.slice(seg.indexOf(ec[0]) + ec[0].length) : seg;
    const prof = afterEc.match(/^\s*,\s*([^,;]{2,60}?)\s*,\s*(?:c[ée]dula|rut|rol)/i); if (prof) p.profesion = prof[1].trim();
    const ced = seg.match(/(?:c[ée]dula(?:\s+nacional)?\s+de\s+identidad|rut|rol\s+[uú]nico\s+tributario)(?:\s+(?:n[uú]mero|n[°º]))?\s*[:,]?\s*((?:\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK])|(?:[a-záéíóúñ ]+?\s+gui[oó]n\s+(?:[a-z]+|\d|k)))/i);
    if (ced) {
      p.cedula = ced[1].trim();
      const dig = p.cedula.match(/^(\d{1,2}\.?\d{3}\.?\d{3})\s*-\s*([\dkK])$/);
      if (dig) { p.rut = toInt(dig[1]); p.dv = dig[2].toUpperCase(); }
      else { const w = p.cedula.match(/^(.+?)\s+gui[oó]n\s+(\S+)$/i); if (w) { p.rut = wordsToNumber(w[1]); p.dv = dvFromWord(w[2]); } }
      if (p.rut && p.dv) p.rutOk = rutDV(p.rut) === p.dv;
    }
    const dom = seg.match(/domiciliad[oa]s?\s+(?:para\s+estos\s+efectos\s+)?en\s+(.+?)(?=;|,?\s*en\s+adelante|,?\s*en\s+representaci|,?\s*quien\s+(?:comparece|act[uú]a)|\s+[yY]\s+de\s|,\s*quien|\s+y\s+(?:por\s+otra|de\s+don|de\s+doña)|\.\s|,\s*mayor|,\s*todos|$)/i);
    if (dom) p.domicilio = dom[1].replace(/[,.\s]+$/, '').trim();
    const cal = seg.match(/en\s+adelante\s+(?:también\s+)?(?:indistintamente\s+)?(?:todos\s+como\s+)?(?:el|la|los|las)?\s*[“"«]([^”"»]+)[”"»]/i); if (cal) p.calidad = cal[1].trim();
    out.push(p);
  }
  // representación: «X, …, en representación de Y y de Z» → Y y Z quedan representados por X
  let rep = null;
  hits.forEach((h, k) => {
    const p = out[k];
    if (h.repr && rep && !h.porRepr) { p.representadoPor = rep.nombre; rep.representa = rep.representa ? rep.representa + ', ' + p.nombre : p.nombre; }
    else rep = /en\s+representaci[oó]n/i.test(txt.slice(h.i, h.i + 500).split(/;/)[0]) ? p : null;
  });
  return out;
}

// ---------------------------------------------------------------- materia y actos
const MATERIAS = [
  [/pr[oó]rroga|ampliaci[oó]n\s+de\s+plazo/i, /promesa/i, 'Prórroga de promesa de compraventa'],
  [/rectificaci/i, null, 'Rectificación de escritura'],
  [/modificaci[oó]n/i, /prenda/i, 'Modificación de prenda'],
  [/alzamiento/i, null, 'Alzamiento'],
  [/cesi[oó]n\s+de\s+derechos/i, null, 'Cesión de derechos'],
  [/promesa/i, /compraventa/i, 'Promesa de compraventa'],
  [/compraventa/i, null, 'Compraventa'],
  [/mutuo/i, null, 'Mutuo'],
  [/hipoteca/i, null, 'Hipoteca'],
  [/prenda/i, null, 'Prenda'],
  [/constituci[oó]n\s+de\s+sociedad|sociedad/i, null, 'Sociedad'],
  [/mandato|poder/i, null, 'Mandato o poder'],
  [/arrendamiento|arriendo/i, null, 'Arrendamiento'],
  [/testamento/i, null, 'Testamento'],
  [/reconocimiento\s+de\s+deuda/i, null, 'Reconocimiento de deuda'],
];
function materia(title, body) {
  for (const [a, b, l] of MATERIAS) if (a.test(title) && (!b || b.test(title) || b.test(body.slice(0, 3000)))) return l;
  for (const [a, b, l] of MATERIAS) if (a.test(body.slice(0, 1500)) && (!b || b.test(body.slice(0, 3000)))) return l;
  return 'Otra materia';
}
function actosAdicionales(mat, body) {
  const out = [];
  if (!/hipoteca/i.test(mat) && /constituye\s+hipoteca|hipoteca\s+de\s+primer\s+grado/i.test(body)) out.push('Hipoteca');
  if (!/prenda/i.test(mat) && /constituye\s+prenda/i.test(body)) out.push('Prenda');
  if (/prohibici[oó]n\s+de\s+(?:gravar|enajenar)/i.test(body) && !/prenda|hipoteca/i.test(mat)) out.push('Prohibición de gravar y enajenar');
  if (!/mandato|poder/i.test(mat) && /(?:confiere|otorga)\s+(?:mandato|poder)/i.test(body)) out.push('Mandato');
  return out;
}

// ---------------------------------------------------------------- revisión
const TYPOS = [
  [/\bprominente(s)?\s+(comprador|vendedor|compradora|vendedora|compradores|vendedores)/gi, 'promitente$1 $2', '«prominente» debería ser «promitente»'],
  [/\babajo\s+el\s+r[ée]gimen/gi, 'bajo el régimen', '«abajo el régimen» debería ser «bajo el régimen»'],
  [/\b(dos|tres|cuatro|seis|siete|ocho|nove)\s+cientos\b/gi, (m, a) => (a.toLowerCase() === 'siete' ? 'setecientos' : a.toLowerCase() === 'nove' ? 'novecientos' : a.toLowerCase() + 'cientos'), 'número mal escrito («seis cientos» → «seiscientos»)'],
  [/\bpr[oó]rrogandolo\b/gi, 'prorrogándolo', '«prórrogandolo» debería ser «prorrogándolo»'],
  [/\bProrroga\b/g, 'Prórroga', 'falta tilde en «Prórroga»'],
  [/\bguion\b/g, 'guión', 'uniformar «guion» como «guión» (estilo notarial)'],
  [/ +([,;.:])/g, '$1', 'espacio antes de un signo de puntuación'],
  [/([;:])(?=[A-Za-zÁÉÍÓÚÑ])/g, '$1 ', 'falta un espacio después de «;» o «:»'],
  [/ {2,}/g, ' ', 'espacios dobles'],
  [/,\s*,/g, ',', 'coma repetida'],
  [/\b(veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\s+(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/gi, '$1 y $2', 'cifra en palabras sin «y» (p. ej. «sesenta un» → «sesenta y un»)'],
  [/\b(S\.A|Ltda|SpA)\.\./g, '$1.', 'punto repetido después de la razón social'],
];
function analyze(raw) {
  const p = parseMinuta(raw);
  const bodyText = p.body.join(' ');
  const comp = extractComparecientes(bodyText);
  const mat = materia(p.title, bodyText);
  const alerts = [];
  const add = (sev, text, fix) => alerts.push({ id: 'a' + alerts.length, sev, text, fix });
  // texto sobrante después de las firmas
  if (p.leftovers.length) add('error', `Hay ${p.leftovers.length === 1 ? 'un párrafo' : p.leftovers.length + ' párrafos'} después de las firmas («${p.leftovers[0].slice(0, 70)}…»). Parece texto sobrante de otra versión.`, { type: 'dropLeftovers' });
  // partes del encabezado que no aparecen en el texto
  const fb = fold(bodyText);
  p.parties.forEach((pt) => {
    const clean = pt.replace(/\by\s+otros\.?$/i, '').trim(); if (!clean) return;
    if (!fb.includes(fold(clean))) add('error', `La parte del encabezado «${clean}» no aparece en el texto de la escritura. Revisa si el encabezado corresponde a este documento.`);
    else if (clean.replace(/[^A-ZÁÉÍÓÚÑ ]/gi, '') !== clean.replace(/[,]/g, '').replace(/[^A-ZÁÉÍÓÚÑ ]/gi, '') || /,/.test(clean)) add('warn', `En el encabezado, «${clean}» tiene una coma que no está en el nombre.`, { type: 'replace', find: clean, repl: clean.replace(/,/g, ''), where: 'parties' });
  });
  // nombres escritos distinto (tildes) entre el texto y las firmas
  p.signatures.forEach((s) => {
    const c = comp.find((x) => fold(x.nombre) === fold(s));
    if (!c) { if (!comp.some((x) => fold(s).includes(fold(x.nombre)) || fold(x.nombre).includes(fold(s)))) add('warn', `La firma «${s}» no corresponde a ningún compareciente del texto.`); return; }
    if (c.nombre.replace(/\s+/g, ' ') !== s.replace(/\s+/g, ' ').trim()) add('warn', `El nombre se escribe distinto en el texto («${c.nombre}») y en la firma («${s.trim()}»).`, { type: 'replace', find: c.nombre, repl: s.trim().replace(/\s+/g, ' '), where: 'body' });
  });
  // comparecientes sin firma (salvo representados)
  comp.forEach((c) => { if (!c.representadoPor && p.signatures.length && !p.signatures.some((s) => fold(s) === fold(c.nombre))) add('warn', `${c.nombre} comparece pero no tiene línea de firma.`); });
  comp.forEach((c) => { if (c.sinComa) add('warn', `Falta una coma después del nombre de ${c.nombre}.`, { type: 'regex', re: c.nombreOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(?=' + c.nacionalidad + ')', flags: 'g', repl: c.nombreOriginal + ', ' }); });
  // RUT
  comp.forEach((c) => {
    if (c.rutOk === false) add('error', `El RUT de ${c.nombre} no es válido: el dígito verificador debería ser ${rutDV(c.rut)} y dice ${c.dv}.`);
    if (!c.cedula) add('warn', `No encontré la cédula de identidad de ${c.nombre}.`);
    if (!c.domicilio) add('warn', `No encontré el domicilio de ${c.nombre}.`);
    if (!c.estadoCivil && /chilen|extranjer/.test(c.nacionalidad)) add('warn', `Falta el estado civil de ${c.nombre}.`);
  });
  // errores de escritura y estilo
  const all = [p.title, ...p.parties, ...p.body].join('\n');
  TYPOS.forEach(([re, repl, msg]) => { re.lastIndex = 0; const m = all.match(re); if (m) add('warn', `${msg}${m.length > 1 ? ` (${m.length} veces)` : ''}.`, { type: 'regex', re: re.source, flags: re.flags, repl: typeof repl === 'string' ? repl : null, fn: typeof repl === 'function' ? TYPOS.indexOf(TYPOS.find((x) => x[0] === re)) : null }); });
  // cifras que se pasarán a palabras
  const cnt = {}; convertNumbers(bodyText, { count: cnt });
  if (cnt.n) add('info', `${cnt.n} ${cnt.n === 1 ? 'cifra se pasará' : 'cifras se pasarán'} a palabras (RUT, montos, fechas, direcciones).`);
  if (/en\s+señal\s+de\s+(conformidad|aceptación)|ejemplares\s+del\s+mismo\s+tenor/i.test(bodyText)) add('warn', 'La minuta termina con el cierre de un contrato privado («firman… en dos ejemplares del mismo tenor»). En la escritura se reemplaza por la frase notarial.', { type: 'cierre' });
  if (!/en\s+comprobante\s+y\s+previa\s+lectura/i.test(bodyText)) add('warn', 'Falta la frase de cierre («En comprobante y previa lectura, firman…»). Se agregará al formatear.', { type: 'cierre' });
  // rectificaciones: las partes de la escritura rectificada deberían comparecer (o estar representadas)
  if (/rectificaci/i.test(mat)) {
    const pri = (bodyText.replace(/\s+/g, ' ').match(/PRIMERO\s*[:.\-]+(.{0,1500}?)(?:SEGUNDO\s*[:.\-]|$)/) || [])[1] || '';
    const re = new RegExp(`\\b(?:don|doña)\\s+(${NAME})`, 'g'); let m; const otros = [];
    while ((m = re.exec(pri))) { const nm = m[1].replace(/,/g, '').trim(); const after = pri.slice(m.index + m[0].length, m.index + m[0].length + 60); if (/notari/i.test(after) || /notari\w*\s+suplente\s+de\s*$/i.test(pri.slice(Math.max(0, m.index - 40), m.index))) continue; if (nm.split(' ').length >= 3 && !otros.includes(nm)) otros.push(nm); }
    const nuestros = comp.map((c) => fold(c.nombre));
    const ajenos = otros.filter((o) => !nuestros.includes(fold(o)));
    if (otros.length && ajenos.length === otros.length) add('error', `La escritura que se rectifica fue otorgada por ${ajenos.join(' y ')}, pero ${ajenos.length > 1 ? 'ninguno comparece' : 'no comparece'} ni está representado en esta rectificación (comparecen ${comp.map((c) => c.nombre).join(', ') || '—'}). Revisa si la comparecencia o el encabezado corresponden a otro documento.`);
  }
  const reps = comp.filter((c) => c.representadoPor);
  if (reps.length > 1 && /quien\s+acredita\s+su\s+identidad/i.test(bodyText)) add('info', '«quien acredita su identidad» está en singular, pero hay varias personas individualizadas. Confirma a quién se refiere.');
  if (/^compare(?:ce|cen)\s*;/i.test(bodyText.trim())) add('warn', 'Después de «Comparece» va dos puntos, no punto y coma.', { type: 'regex', re: '^(\\s*Compare(?:ce|cen))\\s*;', flags: 'mi', repl: '$1:' });
  const red = bodyText.match(/minuta\s+(?:enviada\s+y\s+)?redactada\s+por\s+(?:el|la)\s+abogad[oa]\s+(?:don|doña)?\s*([^.,]+)/i);
  if (red) add('info', `La minuta indica su redactor: ${red[1].trim()}. Se mantiene la mención en el texto.`);
  const actos = actosAdicionales(mat, bodyText);
  if (actos.length) add('info', `Además de la materia principal, el texto contiene: ${actos.join(', ')}.`);
  const order = { error: 0, warn: 1, info: 2 }; alerts.sort((a, b) => order[a.sev] - order[b.sev]);
  return { ...p, materia: mat, actos, comparecientes: comp, alerts };
}
// Aplica una corrección sugerida al texto de la minuta (devuelve el texto nuevo)
function applyFix(raw, fix) {
  if (!fix) return raw;
  if (fix.type === 'dropLeftovers') { const p = parseMinuta(raw); let t = raw; p.leftovers.forEach((l) => { t = t.replace(l, ''); }); return t; }
  if (fix.type === 'replace') { const re = new RegExp(fix.find.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g'); return raw.replace(re, fix.repl); }
  if (fix.type === 'regex') { const re = new RegExp(fix.re, fix.flags); const f = fix.fn != null ? TYPOS[fix.fn][1] : fix.repl; return raw.replace(re, f); }
  return raw;
}

// ---------------------------------------------------------------- texto notarial de la escritura
const lc1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
// Si la notaría aún no está asignada, quedan marcas [ ] que completa la notaría al tomar el trámite.
function notarioIntro(n, fecha) {
  n = n || {};
  const ciudad = (n.ciudad || '').trim();
  const nom = n.nombre ? n.nombre.toUpperCase() : '[NOMBRE DEL NOTARIO]';
  const calidad = !n.nombre ? 'Notario Público' : n.suplente ? `Notario Público suplente de don ${n.titular}, Notario Público Titular` : 'Notario Público Titular';
  const ord = n.ordinal || (n.numero ? ordinal(n.numero) : '[NÚMERO]');
  const dir = n.direccion || '[DIRECCIÓN DE LA NOTARÍA]';
  const ciu = ciudad || '[CIUDAD]';
  return `EN ${ciudad ? ciudad.toUpperCase() + ' DE CHILE' : '[CIUDAD]'}, a ${fecha ? dateToWords(fecha) : '[FECHA]'}, ante mí, ${nom}, abogado, ${calidad} de la ${ord} Notaría, ubicada en ${dir}${/ciudad\s+de/i.test(dir) ? '' : ', ciudad de ' + ciu}, `;
}
function buildEscritura(a, opt = {}) {
  const n = opt.notaria || {}; const fecha = opt.fecha || new Date();
  let body = a.body.join(' ').replace(/\s+/g, ' ').trim();
  body = body.replace(/^compare(cen|ce)\s*[;:,]?\s*(por\s+una\s+parte\s*[,:]?\s*)?/i, (_, s, pu) => `compare${s.toLowerCase()}: ${pu ? 'por una parte, ' : ''}`);
  if (!/^compare/i.test(body)) body = 'comparecen: ' + lc1(body);
  // la frase de cierre va en su propio párrafo, siempre junto a las firmas
  // el cierre de un contrato privado («En señal de conformidad, firman… en dos ejemplares») no va en una escritura
  if (opt.cierre !== false) body = body.replace(/\s*(?:En\s+señal\s+de\s+(?:conformidad|aceptación)[^.]*|[^.]*\bfirma(?:n)?\b[^.]*\b(?:dos|tres|cuatro)\s+ejemplares[^.]*)\.\s*$/i, '');
  let cierre = '';
  const mc = body.match(/\s*(En\s+comprobante\s+y\s+previa\s+lectura[\s\S]*)$/i);
  if (mc) { cierre = mc[1].trim(); body = body.slice(0, mc.index).trim(); }
  else if (opt.cierre !== false) { const plural = a.signatures.length !== 1; cierre = `En comprobante y previa lectura, ${plural ? 'firman los comparecientes' : 'firma el compareciente'}. Se da copia. Doy fe.-`; }
  if (opt.convertir !== false) { body = convertNumbers(body); cierre = convertNumbers(cierre); }
  const intro = notarioIntro(n, opt.fecha === null ? null : fecha);
  const blocks = [];
  blocks.push({ k: 'meta', text: `REPERTORIO Nº ${opt.repertorio || '[_______]'}   ·   ${opt.anio || (opt.fecha === null ? '[AÑO]' : fecha.getFullYear())}` });
  if (opt.protocolizacion) blocks.push({ k: 'meta', text: `PROTOCOLIZACIÓN Nº ${opt.protocolizacion}` });
  if (opt.ot) blocks.push({ k: 'meta', text: String(opt.ot) });
  blocks.push({ k: 'blank' }, { k: 'blank' });
  blocks.push({ k: 'title', text: a.title.toUpperCase() });
  blocks.push({ k: 'blank' });
  const [pa, pb] = a.parties;
  if (pa) blocks.push({ k: 'party', text: pa.toUpperCase().replace(/,/g, '') });
  if (pb) { blocks.push({ k: 'and', text: 'A' }); blocks.push({ k: 'party', text: pb.toUpperCase().replace(/(\S),(\s)/g, '$1$2') }); }
  blocks.push({ k: 'blank' }, { k: 'sep' }, { k: 'blank' });
  blocks.push({ k: 'body', text: intro + body });
  if (cierre) blocks.push({ k: 'body', text: cierre, cierre: true });
  const info = a.sigInfo && a.sigInfo.length ? a.sigInfo : (a.signatures || []).map((n) => ({ name: n, rol: '', ci: '' }));
  const sigs = info.map((g) => { const c = (a.comparecientes || []).find((x) => fold(x.nombre) === fold(g.name)); return { name: g.name.toUpperCase().replace(/\s+/g, ' ').trim(), rol: g.rol || '', ci: c && c.rut ? fmtRut(c.rut, c.dv) : g.ci || '' }; });
  if (sigs.length) blocks.push({ k: 'sigs', sigs });
  return blocks;
}

// ---------------------------------------------------------------- diagramación (30 líneas por hoja)
// measure(text, bold, size) → ancho en puntos. Devuelve hojas con líneas posicionadas.
const OFICIO = { w: 612, h: 1008 };
// Diseño sobrio: oficio, márgenes simétricos (interior más ancho para el empaste), Arial 12 con interlineado
// de 22 pt, sin regla ni numeración lateral. Las firmas van en dos columnas y nunca quedan solas en una hoja.
const LAYOUT = { top: 118, pitch: 22, bottom: 92, odd: { left: 102, right: 72 }, even: { left: 72, right: 102 }, size: 11.5, track: 0.1, metaSize: 8.5, titleSize: 13, titleTrack: 1.6, partySize: 11, partyTrack: 1.2, sigSize: 9.5, pageNumY: 960, narrow: 1, carry: 4 };
LAYOUT.lines = Math.floor((OFICIO.h - LAYOUT.top - LAYOUT.bottom) / LAYOUT.pitch) + 1;
function wrapWords(words, width, wordW, space) {
  const lines = []; let cur = []; let w = 0;
  for (const word of words) {
    const ww = wordW(word);
    if (cur.length && w + space + ww > width) { lines.push(cur); cur = [word]; w = ww; }
    else { w += (cur.length ? space : 0) + ww; cur.push(word); }
  }
  if (cur.length) lines.push(cur);
  return lines;
}
function layoutEscritura(blocks, measure, opt = {}) {
  const L = { ...LAYOUT, ...opt };
  const W = Math.min(OFICIO.w - L.odd.left - L.odd.right, OFICIO.w - L.even.left - L.even.right);
  const out = []; // renglones lógicos (h = renglones que ocupa)
  const tw = (s, bold, size, track) => measure(s, bold, size) + track * s.length;
  for (const b of blocks) {
    if (b.k === 'blank') { out.push({ k: 'blank', h: 1 }); continue; }
    if (b.k === 'meta') { out.push({ k: 'meta', text: b.text, bold: false, size: L.metaSize, align: 'left', track: 0.6, h: 1 }); continue; }
    if (b.k === 'sep') { out.push({ k: 'sep', h: 1 }); continue; }
    if (b.k === 'and') { out.push({ k: 'and', text: b.text, bold: false, size: L.partySize - 1, align: 'center', track: 2, h: 1 }); continue; }
    if (b.k === 'title' || b.k === 'party') {
      const size = b.k === 'title' ? L.titleSize : L.partySize; const track = b.k === 'title' ? L.titleTrack : L.partyTrack; const space = measure(' ', true, size) + track;
      wrapWords(b.text.split(/\s+/).filter(Boolean), W - 40, (w) => tw(w, true, size, track), space).forEach((ws) => out.push({ k: b.k, words: ws, bold: true, size, align: 'center', track, h: 1 }));
      continue;
    }
    if (b.k === 'body') {
      const size = L.size; const track = L.track; const space = measure(' ', false, size) + track;
      const lines = wrapWords(b.text.split(/\s+/).filter(Boolean), W, (w) => tw(w, false, size, track), space);
      lines.forEach((ws, i) => out.push({ k: 'body', words: ws, bold: false, size, align: i === lines.length - 1 ? 'left' : 'justify', track, h: 1, cierre: !!b.cierre }));
      continue;
    }
    if (b.k === 'sigs') {
      const cols = b.sigs.length === 1 ? 1 : 2; const colW = W / cols - 16;
      for (let i = 0; i < b.sigs.length; i += cols) {
        const cells = b.sigs.slice(i, i + cols).map((g) => {
          const lines = wrapWords(g.name.split(' '), colW, (w) => tw(w, true, L.sigSize, 0.8), measure(' ', true, L.sigSize) + 0.8);
          const rol = g.rol ? wrapWords(g.rol.split(' '), colW, (w) => tw(w, false, L.sigSize - 1, 0.2), measure(' ', false, L.sigSize - 1) + 0.2).map((x) => x.join(' ')) : [];
          return { name: lines.map((x) => x.join(' ')), rol, ci: g.ci };
        });
        const nl = Math.max(...cells.map((c) => c.name.length + c.rol.length));
        out.push({ k: 'sigrow', cells, cols, h: 4 + Math.max(0, Math.ceil((nl - 1) / 2)), first: i === 0 });
      }
    }
  }
  // paginar: un renglón de firmas no se corta y las firmas nunca quedan solas en una hoja:
  // si no caben, pasan a la hoja siguiente junto con las últimas líneas del texto.
  const pages = []; let cur = []; let used = 0;
  const flush = () => { if (cur.length) pages.push(cur); cur = []; used = 0; };
  const place = (it) => { cur.push({ ...it, slot: used }); used += it.h; };
  for (let i = 0; i < out.length; i++) {
    const it = out[i];
    if (it.k === 'sigrow' && it.first) {
      const rest = out.slice(i).filter((x) => x.k === 'sigrow'); const total = rest.reduce((s, x) => s + x.h, 0);
      if (used + total > L.lines) {
        const room = L.lines - used; const firstRow = rest[0].h;
        // ¿Cabe al menos la primera fila con texto antes? Si no caben todas, se arrastran líneas del texto.
        const textHere = cur.filter((x) => x.k === 'body').length;
        const carry = Math.min(L.carry, Math.max(0, textHere - 2));
        if (room < firstRow || total <= L.lines - carry) {
          const moved = []; let n = 0;
          while (cur.length && n < carry && cur[cur.length - 1].k === 'body') { moved.unshift(cur.pop()); n++; }
          while (cur.length && cur[cur.length - 1].k === 'blank') cur.pop();
          flush(); moved.forEach((m) => place(m));
        }
      }
    }
    if (it.k === 'blank' && used === 0) continue; // sin renglones vacíos al inicio de hoja
    const air = it.k === 'sigrow' && it.first && used > 0 ? 1 : 0; // aire entre el cierre y las firmas
    if (used + air + it.h > L.lines) flush();
    if (air && used > 0) used += 1;
    place(it);
  }
  flush();
  return { pages, L, W };
}
const fmtRut = (n, dv) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;

// ---------------------------------------------------------------- protocolización
function analyzeProtocol(text, { pages = 0, name = '' } = {}) {
  const t = String(text).replace(/\r/g, '');
  const lines = t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const titleI = lines.findIndex((l) => /^(contrato|mandato|poder|pagar[ée]|acuerdo|convenio|declaraci[oó]n|escritura|instrumento|reconocimiento)\b/i.test(l) && isUpperName(l));
  const titulo = titleI >= 0 ? lines[titleI] : (lines.find((l) => isUpperName(l) && l.length > 12) || name.replace(/\.[a-z]+$/i, ''));
  let partes = ['', ''];
  if (titleI >= 0) { const sep = lines.slice(titleI + 1, titleI + 6).findIndex((l) => /^a$/i.test(l)); if (sep > 0) partes = [lines[titleI + sep], lines[titleI + sep + 2] || '']; }
  const fea = []; const reFea = /firma\s+electr[oó]nica\s+avanzada\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ \n]+?)\s+(\d{4})[.\-/](\d{2})[.\-/](\d{2})/gi; let m;
  while ((m = reFea.exec(t))) { const nm = m[1].replace(/\s+/g, ' ').trim(); if (!fea.some((f) => f.nombre === nm)) fea.push({ nombre: nm, fecha: new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4])) }); }
  const pat = t.match(/(?:placa\s+patente(?:\s+[uú]nica)?|inscrito\s+en\s+el\s+registro\s+nacional\s+de\s+veh[ií]culos\s+motorizados\s+bajo\s+el\s+n[uú]mero)\s*[:\s]*([A-Z]{2,4}[\s.-]?\d{2,4}[\s-]?[\dkK]?)/i);
  const ley = t.match(/ley\s+(?:n[uú]mero|n[°º]|n\.?)\s*([\d.]+)/i);
  const fechaDoc = t.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i);
  const acreedor = (t.replace(/\s+/g, ' ').match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .&]+?(?:S\.A\.|SPA|LIMITADA|LTDA\.?))\.*,?\s*(?:RUT|R\.U\.T)[^,]*,\s*representad[ao]/) || [])[1];
  const alertas = [];
  const und = t.match(/\b(undefined|null|NaN)\b/g); if (und) alertas.push({ sev: 'error', text: `El documento contiene ${und.length} ${und.length === 1 ? 'campo vacío' : 'campos vacíos'} («${und[0]}»): faltan datos de alguna de las partes. Revisa con quien lo emitió antes de protocolizar.` });
  if (/\b(S\.A|SPA|Ltda)\.\./i.test(t)) alertas.push({ sev: 'info', text: 'Hay razones sociales con punto repetido («S.A..»). En la carátula se escriben correctamente.' });
  if (/_{4,}|\[\s*\]|\.{6,}/.test(t)) alertas.push({ sev: 'warn', text: 'El documento tiene espacios en blanco por llenar (líneas o corchetes vacíos).' });
  return {
    alertas, titulo: titulo.toUpperCase(), partes: partes.map((x) => x.toUpperCase()), fea,
    requirente: (acreedor || partes[1] || '').replace(/\.+$/, '.').trim().toUpperCase(),
    patente: pat ? pat[1].replace(/\s+/g, '').toUpperCase() : '', ley: ley ? ley[1] : '',
    fechaDocumento: fechaDoc ? new Date(Number(fechaDoc[3]), MESES.indexOf(fechaDoc[2].toLowerCase()), Number(fechaDoc[1])) : null,
    hojas: pages,
  };
}
// ---------------------------------------------------------------- documentos privados (protocolización y reducción)
// Cualquier documento sirve (firmado electrónicamente, a mano, o una fotocopia): se identifica qué es, cuántas
// hojas tiene, quiénes participan y si tiene firmas. Nada de esto lo edita el cliente.
const TITULOS = /^(contrato|mandato|poder|pagar[ée]|acuerdo|convenio|declaraci[oó]n|escritura|instrumento|reconocimiento|acta|certificado|finiquito|carta|inventario|estatutos?|factura|boleta|recibo|reglamento|bases|resoluci[oó]n|decreto|extracto|testamento|compromiso|promesa|anexo|addendum|ad[eé]ndum|liquidaci[oó]n|informe|solicitud|autorizaci[oó]n|cesi[oó]n|minuta|protocolo)\b/i;
function analizarPrivado(text, { pages = 0, name = '' } = {}) {
  const base = analyzeProtocol(text, { pages, name });
  const t = String(text || '').replace(/\r/g, ''); const flat = t.replace(/\s+/g, ' ');
  const lines = t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // título: el de analyzeProtocol, o la primera línea con forma de título en el comienzo del documento
  let titulo = base.titulo;
  if (!titulo || titulo === name.replace(/\.[a-z]+$/i, '').toUpperCase()) {
    const c = lines.slice(0, 25).find((l) => TITULOS.test(l) && l.length <= 140 && l.split(' ').length <= 18) || lines.slice(0, 15).find((l) => isUpperName(l) && l.length >= 8 && l.length <= 120);
    titulo = (c || name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ')).toUpperCase();
  }
  // participantes: comparecientes con formato, razones sociales, firmantes electrónicos y «don/doña Nombre»
  const people = new Map(); const add = (nombre, extra = {}) => {
    nombre = String(nombre || '').replace(/[,;:]+$/, '').replace(/(?<!S\.A)\.+$/, '').replace(/\s+/g, ' ').trim(); if (nombre.split(' ').length < 2 || nombre.length > 70) return;
    if (/^(el|la|los|las|don|doña|señor|señora|notario|firma|electr|repertorio)\b/i.test(nombre)) return;
    const k = fold(nombre).replace(/\b(S A|SPA|LIMITADA|LTDA)\b/g, '').trim(); if (!k) return;
    const tk = k.split(' ');
    for (const [kk, v] of people) {
      const tv = kk.split(' '); const sub = (a, b) => a.every((x) => b.includes(x));
      if (sub(tk, tv) || sub(tv, tk)) { // misma persona con o sin segundo nombre: se queda el nombre más completo
        if (tk.length > tv.length) { people.delete(kk); people.set(k, { ...v, nombre: nombre.toUpperCase(), ...Object.fromEntries(Object.entries(extra).filter(([, x]) => x)) }); }
        else Object.assign(v, Object.fromEntries(Object.entries(extra).filter(([, x]) => x)));
        return;
      }
    }
    people.set(k, { nombre: nombre.toUpperCase(), ...extra });
  };
  extractComparecientes(flat).forEach((c) => add(c.nombre, { rut: c.rut ? fmtRut(c.rut, c.dv) : '', rol: c.calidad || '' }));
  const reCo = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9&'\- ]{2,60}?\s(?:S\.\s?A\.?|SPA|SpA|LIMITADA|LTDA\.?|E\.I\.R\.L\.?))(?=[\s.,;:)"”]|$)/g; let m;
  lines.forEach((l) => { reCo.lastIndex = 0; while ((m = reCo.exec(l))) { const nm = m[1].replace(TITULOS, '').replace(/^(?:[A-ZÁÉÍÓÚÑ]+\s+){0,6}?(?=\S+\s+(?:S\.|SPA|SpA|LIMITADA|LTDA|E\.I))/, (x) => (/\b(DE|SIN|DEL|LA|EL|Y|A)\b/.test(x) ? '' : x)).trim(); add(nm.replace(/\s+S\.\s?A\.?$/, ' S.A.').replace(/\bSpA\b/, 'SPA'), { tipo: 'empresa' }); } });
  const reRut = /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{5,60}?),?\s*(?:R\.?U\.?T\.?|C\.?I\.?|c[ée]dula(?:\s+de\s+identidad)?)\s*(?:N[°º]\.?|n[uú]mero)?\s*:?\s*(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])/g;
  while ((m = reRut.exec(flat))) add(m[1], { rut: m[2] });
  base.fea.forEach((f) => add(f.nombre, { firma: 'electrónica' }));
  const reDon = /\b(?:don|doña)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+(?:de\s+(?:la\s+)?)?[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+){1,4})/g;
  while ((m = reDon.exec(flat))) add(m[1]);
  base.partes.filter(Boolean).forEach((x) => add(x));
  const participantes = [...people.values()].slice(0, 14);
  // firmas
  const lineasFirma = []; lines.forEach((l, i) => { if (/^_{6,}\s*$|^\.{8,}\s*$|^firma\s*:?\s*$/i.test(l)) { const nx = lines[i + 1]; if (nx && isUpperName(nx) && nx.length < 70) lineasFirma.push(nx.toUpperCase()); } });
  const firmaTexto = /firmado\s+(?:digital|electr[oó]nicamente)\s+por|firma\s+electr[oó]nica|hay\s+firma|p\.\s?p\./i.test(flat);
  const firmas = { electronicas: base.fea, lineas: [...new Set(lineasFirma)], otras: firmaTexto && !base.fea.length };
  firmas.hay = !!(base.fea.length || firmas.lineas.length || firmas.otras);
  return { ...base, titulo, participantes, firmas, hojas: pages };
}
// Reducción a escritura pública: se transcribe íntegro el documento privado ya firmado.
function textoTranscrito(text) {
  const src = String(text || '').replace(/\r/g, '')
    .replace(/firma\s+electr[oó]nica\s+avanzada\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ \n]+?)\s+\d{4}[.\-/]\d{2}[.\-/]\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?(?:\s*[-+]\d{4})?/gi, (_, n) => `\n(Hay firma electrónica avanzada de ${n.replace(/\s+/g, ' ').trim()}).\n`);
  const lines = src.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const out = []; let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  lines.forEach((l) => {
    if (!l) { push(); return; }
    if (/^(p[aá]gina\s+)?\d+\s*(de\s+\d+)?$/i.test(l)) return; // números de página
    if (/^\(Hay firma electrónica avanzada de .+\)\.$/.test(l)) { push(); out.push(l); return; }
    if (/^_{6,}$/.test(l)) { push(); out.push('(Hay firma).'); return; }
    if (/^(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[EÉ]PTIMO|OCTAVO|NOVENO|D[EÉ]CIMO)\b/.test(l)) push();
    cur += (cur ? ' ' : '') + l;
    if (/[:]$/.test(l) && l.length < 60) push();
  });
  push();
  return out;
}
// Reducción hecha por nosotros: el documento privado se reescribe como escritura pública.
//  · Si el documento trae su comparecencia, comparecen las mismas partes (números en palabras) y «exponen:
//    Que vienen en reducir a escritura pública…»; el texto del documento se transcribe a continuación.
//  · Si no la trae (pagaré, carta, acta…), comparece quien lo presenta: esos datos los completa la notaría.
// Devuelve el cuerpo como texto editable (párrafos separados por una línea en blanco) y las firmas.
function reduccionTexto(info, text) {
  const parr = textoTranscrito(text).filter((p) => !/^\(Hay firma/.test(p));
  const flat = parr.join('\n\n');
  const fecha = info.fechaDocumento ? `, de fecha ${dateToWords(info.fechaDocumento)}` : '';
  const hojas = info.hojas ? `, que consta de ${numToWords(info.hojas).replace(/^un$/, 'una')} ${info.hojas === 1 ? 'hoja' : 'hojas'}` : '';
  const iC = flat.search(/\bcompare(?:cen|ce)\b\s*[:;,]?/i);
  const tail = iC >= 0 ? flat.slice(iC) : '';
  const iE = tail.search(/[,;]?\s*(?:y\s+|quienes\s+)?exponen?\b\s*(?:que\s*)?[:,]?/i);
  const limpiar = (paras) => {
    let ps = paras.map((p) => p.trim()).filter(Boolean);
    while (ps.length && (ps[ps.length - 1].length < 90 && !/[.;:]$/.test(ps[ps.length - 1]) || /^[_.\-–—\s]{4,}$/.test(ps[ps.length - 1]) || isCiLine(ps[ps.length - 1]))) ps.pop(); // firmas al final
    if (ps.length) ps[ps.length - 1] = ps[ps.length - 1].replace(/\s*(?:En\s+señal\s+de\s+(?:conformidad|aceptación)[^.]*|[^.]*\bfirma(?:n)?\b[^.]*\b(?:dos|tres|cuatro)\s+ejemplares[^.]*)\.\s*$/i, '').trim();
    return ps.filter(Boolean);
  };
  if (iC >= 0 && iE > 20 && iE < 4000) {
    const compRaw = tail.slice(0, iE).replace(/^compare(?:cen|ce)\s*[:;,]?\s*/i, '').replace(/\s+/g, ' ').replace(/[\s,;]+$/, '');
    const comp = convertNumbers(compRaw);
    const restoParas = limpiar(tail.slice(iE).replace(/^[,;]?\s*(?:y\s+|quienes\s+)?exponen?\b\s*(?:que\s*)?[:,]?\s*/i, '').split(/\n\n+/));
    const plural = /\by\s+dos\)|;\s*y\s|\by\s+(?:don|doña)\b/i.test(compRaw) || extractComparecientes(compRaw).length > 1;
    const cuerpo = [`comparece${plural ? 'n' : ''}: ${comp}; ${plural ? 'quienes exponen: Que vienen' : 'quien expone: Que viene'} en reducir a escritura pública el documento privado denominado «${info.titulo}»${fecha}${hojas}, cuyo texto es el siguiente:`,
      ...restoParas.map((p, k) => (k === 0 ? '«' + p.charAt(0).toUpperCase() + p.slice(1) : p) + (k === restoParas.length - 1 ? '»' : ''))].join('\n\n');
    const comps = extractComparecientes(compRaw.replace(/\s+/g, ' '));
    const sigs = []; comps.filter((c) => !c.representadoPor && c.cedula).forEach((c) => { if (!sigs.some((g) => fold(g.name) === fold(c.nombre) || fold(g.name).includes(fold(c.nombre)) || fold(c.nombre).includes(fold(g.name)))) sigs.push({ name: c.nombre, rol: c.calidad || '', ci: c.rut ? fmtRut(c.rut, c.dv) : '' }); });
    // representantes de empresas: «representada por NOMBRE»
    const reRep = /representad[oa]s?,?\s+(?:seg[uú]n\s+se\s+acreditar[aá],?\s+)?por\s+(?:don\s+|doña\s+)?([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ]+){1,4})/g; let m;
    while ((m = reRep.exec(compRaw))) { const nm = m[1].trim(); if (/^\s*(?:S\.\s?A|SPA|LIMITADA|LTDA|E\.I)/i.test(compRaw.slice(m.index + m[0].length, m.index + m[0].length + 8))) continue; if (!sigs.some((g) => fold(g.name).includes(fold(nm)) || fold(nm).includes(fold(g.name)))) sigs.push({ name: nm, rol: '', ci: '' }); }
    return { modo: 'partes', cuerpo, sigs: sigs.length ? sigs : [{ name: '[NOMBRE DEL COMPARECIENTE]', rol: '', ci: '[_______]' }], plural };
  }
  const firmantes = [...new Set([...info.firmas.electronicas.map((f) => f.nombre), ...info.firmas.lineas])];
  const susc = firmantes.length ? `, suscrito por ${firmantes.join(', ').replace(/, ([^,]*)$/, ' y $1')}` : '';
  const ps = limpiar(parr);
  const cuerpo = [`comparece: [NOMBRE DEL COMPARECIENTE], [NACIONALIDAD], [ESTADO CIVIL], [PROFESIÓN], cédula nacional de identidad número [_______], domiciliado en [DOMICILIO], mayor de edad, quien acredita su identidad con la cédula antes citada y expone: Que viene en reducir a escritura pública el documento privado denominado «${info.titulo}»${fecha}${susc}${hojas}, cuyo texto íntegro es el siguiente:`,
    ...ps.map((p, k) => (k === 0 ? '«' : '') + p + (k === ps.length - 1 ? '»' : ''))].join('\n\n');
  return { modo: 'transcripcion', cuerpo, sigs: [{ name: '[NOMBRE DEL COMPARECIENTE]', rol: '', ci: '[_______]' }], plural: false };
}
function reduccionBlocks(info, text, opt = {}) {
  const r = opt.red || reduccionTexto(info, text);
  const cuerpo = opt.cuerpo != null ? opt.cuerpo : r.cuerpo;
  const plural = r.sigs.length > 1 || r.plural;
  const blocks = [
    { k: 'meta', text: 'REPERTORIO Nº [_______]   ·   [AÑO]' }, { k: 'blank' }, { k: 'blank' },
    { k: 'title', text: 'REDUCCIÓN A ESCRITURA PÚBLICA' }, { k: 'blank' }, { k: 'party', text: info.titulo },
  ];
  const partes = (info.partes || []).filter(Boolean);
  if (partes.length === 2) blocks.push({ k: 'and', text: partes[0] }, { k: 'and', text: 'A' }, { k: 'and', text: partes[1] });
  blocks.push({ k: 'blank' }, { k: 'sep' }, { k: 'blank' });
  String(cuerpo).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach((p, i) => blocks.push({ k: 'body', text: (i === 0 ? notarioIntro(opt.notaria || {}, null) : '') + p }));
  blocks.push({ k: 'body', text: `Conforme con su original, que he tenido a la vista y devuelvo ${plural ? 'a los interesados' : 'al interesado'}. En comprobante y previa lectura, ${plural ? 'firman los comparecientes' : 'firma el compareciente'}. Se da copia. Doy fe.-`, cierre: true });
  blocks.push({ k: 'sigs', sigs: r.sigs });
  return blocks;
}
function caratulaTexto(d, n) {
  n = n || {};
  const ciudad = (n.ciudad || '').trim();
  const calidad = !n.nombre ? 'Notario Público' : n.suplente ? `Notario Público suplente de don ${n.titular}, Notario Público Titular` : 'Notario Público Titular';
  const nom = n.nombre ? n.nombre.toUpperCase() : '[NOMBRE DEL NOTARIO]';
  const ord = n.ordinal || (n.numero ? ordinal(n.numero) : '[NÚMERO]');
  const dir = n.direccion || '[DIRECCIÓN DE LA NOTARÍA]';
  const firm = d.firmante ? `, suscrito con firma electrónica avanzada${d.fechaFirma ? ' con fecha ' + (d.fecha && sameDay(d.fechaFirma, d.fecha) ? 'de hoy' : dateNumeric(d.fechaFirma)) : ''} por ${d.firmante}` : '';
  const obj = d.patente ? `, sobre el vehículo motorizado Placa Patente Única **${d.patente}**` : d.objeto ? `, ${d.objeto}` : '';
  const hojas = Number(d.hojas) > 0 ? ` y que consta de ${numToWords(d.hojas, { apocope: false }).replace(/^uno$/, 'una')} ${Number(d.hojas) === 1 ? 'hoja' : 'hojas'}` : '';
  const varios = (d.documentos || []).length > 1 || /\by\b/.test(d.descripcion || '');
  return `**En ${ciudad || '[CIUDAD]'}, a ${d.fecha ? dateNumeric(d.fecha) : '[FECHA]'},** ante mí, **${nom}**, abogado, ${calidad} de la ${ord} Notaría, ubicada en ${dir}${/ciudad\s+de/i.test(dir) ? '' : ', ciudad de ' + (ciudad || '[CIUDAD]')}, certifico que con fecha de hoy, a requerimiento de **${d.requirente || '[REQUIRENTE]'}**, procedo a protocolizar ${varios ? 'los siguientes documentos privados' : 'el siguiente documento privado'}: ${d.descripcion}${firm}${d.calidad ? `, en su calidad de ${d.calidad}` : ''}${obj}${hojas}, quedando agregado al final del Registro Público de este mes en curso bajo el Nº **${d.numero || '[_______]'}, DOY FÉ.-**`;
}
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const api = { analizarPrivado, reduccionBlocks, reduccionTexto, textoTranscrito, numToWords, wordsToNumber, rutDV, rutToWords, dateToWords, dateNumeric, convertNumbers, ordinal, parseMinuta, extractComparecientes, analyze, applyFix, buildEscritura, layoutEscritura, analyzeProtocol, caratulaTexto, fold, OFICIO, LAYOUT, MESES, fmtRut };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Notarial = api;
})(typeof window !== 'undefined' ? window : globalThis);
