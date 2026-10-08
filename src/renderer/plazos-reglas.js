'use strict';
// ============================================================================
// Informe básico de Plazos (sin IA): lee el texto del contrato con reglas y saca partes, inicio,
// duración, término, renovación automática, aviso, renta y propiedad. Corre en el computador del
// usuario, es gratis, instantáneo y funciona sin internet. Un PDF puede traer varios contratos.
// ============================================================================
(() => {
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, dieciocho: 18, veinte: 20, veinticuatro: 24, treinta: 30, cuarenta: 40, sesenta: 60, noventa: 90, ciento: 120 };
const FECHA = `(\\d{1,2})\\s*(?:de\\s+)?(${MESES.join('|')})\\s*(?:de|del)?\\s*(?:año\\s*)?(\\d{4})`;
const RUT = '\\d{1,2}\\.?\\d{3}\\.?\\d{3}\\s?-\\s?[\\dkK]';
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

function fecha(s) {
  let m = new RegExp(FECHA, 'i').exec(s || '');
  if (m) return iso(+m[3], MESES.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s || '');
  return m ? iso(+m[3], +m[2], +m[1]) : null;
}
function num(s) {
  s = String(s || '').toLowerCase();
  const m = /\((\d+)\)|\b(\d+)\b/.exec(s); if (m) return +(m[1] || m[2]);
  for (const [k, v] of Object.entries(NUM)) if (new RegExp(`\\b${k}\\b`).test(s)) return v;
  return null;
}
function addMonths(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, d));
  return t.toISOString().slice(0, 10);
}
const addDays = (isoDate, n) => new Date(Date.parse(isoDate + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const title = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[,.;:]+$/, '');

// Cláusula de plazo: «TERCERO: PLAZO», «DURACIÓN DEL CONTRATO», «VIGENCIA»…
function clausulaPlazo(t) {
  const ord = '(?:PRIMER[OA]|SEGUND[OA]|TERCER[OA]|CUART[OA]|QUINT[OA]|SEXT[OA]|S[ÉE]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[ÉE]CIM[OA]|CL[ÁA]USULA[^:]{0,20})';
  for (const n of ['PLAZO', 'DURACI[ÓO]N', 'VIGENCIA']) {
    const m = new RegExp(`${ord}\\s*[:.\\-]*\\s*(?:DEL?\\s+)?${n}[\\s\\S]{0,1600}`, 'i').exec(t);
    if (m) return m[0].replace(/\s+/g, ' ');
  }
  const m = /(?:duraci[óo]n|plazo) (?:del presente contrato|de este contrato|del arrendamiento)[\s\S]{0,1200}/i.exec(t);
  return m ? m[0].replace(/\s+/g, ' ') : '';
}

// Partes: lo que va antes de «en adelante EL ARRENDADOR / EL ARRENDATARIO» (o el rol que corresponda)
const ROLES = [['ARRENDADOR', 'Arrendador'], ['ARRENDATARI[OA]S?', 'Arrendatario'], ['MANDANTE', 'Mandante'], ['MANDATARI[OA]', 'Mandatario'], ['PRESTADOR(?:A)?', 'Prestador'], ['CLIENTE', 'Cliente'], ['EMPLEADOR(?:A)?', 'Empleador'], ['TRABAJADOR(?:A)?', 'Trabajador'], ['VENDEDOR(?:A)?', 'Vendedor'], ['COMPRADOR(?:A)?', 'Comprador'], ['PROMITENTE VENDEDOR(?:A)?', 'Promitente vendedor'], ['PROMITENTE COMPRADOR(?:A)?', 'Promitente comprador']];
const EMPRESA = /((?:[A-ZÁÉÍÓÚÑ0-9&][\wÁÉÍÓÚÑáéíóúñ.&-]*\s+){0,7}?(?:S\.?\s?A\.?|SpA|S\.?P\.?A\.?|E\.?I\.?R\.?L\.?|LTDA\.?|Limitada|PROPIEDADES|INVERSIONES[\w ]{0,30}?))\s*,?\s*(?:RUT|R\.U\.T\.?)\s*(?:N°|Nº|número)?\s*:?\s*(\d{1,2}\.?\d{3}\.?\d{3}\s?-\s?[\dkK])/;
function partes(head) {
  const out = []; let from = 0;
  const marks = [];
  for (const [re, rol] of ROLES) {
    const r = new RegExp(`en adelante\\W{0,4}(?:(?:indistintamente|también)\\s+)?(?:(?:el|la|los|las)\\s+)?(?:parte\\s+)?["“<«]?\\s*(?:EL|LA|LOS|LAS)?\\s*${re}\\b|(?:EL|LA|LOS|LAS)\\s+${re}\\s*[»”"=]`, 'gi');
    let m; while ((m = r.exec(head))) { marks.push({ at: m.index, end: r.lastIndex, rol }); break; }
  }
  marks.sort((a, b) => a.at - b.at);
  for (const k of marks) {
    const seg = head.slice(from, k.at); from = k.end;
    if (out.some((p) => p.rol === k.rol)) continue;
    const emp = seg.match(new RegExp(EMPRESA.source, 'g'));
    const per = [...seg.matchAll(/\b(?:[Dd]on|[Dd]oña|[Ss]e[ñn]or(?:a)?)\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+(?:de\s+(?:la\s+)?)?[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]+){1,5})/g)].map((m) => clean(m[1]));
    const ruts = [...seg.matchAll(new RegExp(RUT, 'g'))].map((m) => m[0].replace(/\s/g, ''));
    if (emp) {
      const e = EMPRESA.exec(emp[emp.length - 1]);
      const nombre = clean(e[1]).replace(/^.*?\b(?:de|la|entre)\s+(?=[A-ZÁÉÍÓÚÑ]{3})/, '').replace(/^(?:entre|por una parte)\W+/i, '');
      out.push({ rol: k.rol, nombre, rut: e[2].replace(/\s/g, ''), representante: per[0] ? title(per[0]) : null });
    } else if (per.length) {
      per.forEach((p, i) => out.push({ rol: k.rol, nombre: title(p), rut: ruts[i] || null }));
    }
  }
  return out;
}

function uno(texto) {
  const t = texto.replace(/[ \t]+/g, ' ');
  const flat = t.replace(/\s+/g, ' ');
  const tipo = /CONTRATO DE ([A-ZÁÉÍÓÚÑ ]{4,40}?)\s*(?:\n|SEC|ENTRE|$)/.exec(t)?.[1];
  const c = clausulaPlazo(t);
  const ini = new RegExp(`(?:a partir del?|a contar del?|comenzar[áa] a regir (?:el|a partir del)|regir[áa] desde el|desde el|con fecha)\\s*(?:d[ií]a\\s*)?(${FECHA}|\\d{1,2}/\\d{1,2}/\\d{4})`, 'i').exec(c);
  const dur = /(?:duraci[óo]n|plazo)\s+(?:del presente contrato\s+|de este contrato\s+|del arrendamiento\s+)?(?:ser[áa]\s+)?de\s*([\w() ]{1,25}?)\s*(mes|año)/i.exec(c);
  const fin = new RegExp(`(?:hasta el|antes del|vencer[áa] el|terminar[áa] el)\\s*(?:d[ií]a\\s*)?(${FECHA})`, 'i').exec(c);
  const renov = /renovar[áa]\s+(?:en forma\s+)?(?:t[áa]cita|autom[áa]tica)|t[áa]cita y sucesivamente|prorrogar[áa]\s+(?:t[áa]cita|autom[áa]tica)|renovaci[óo]n autom[áa]tica/i.test(c);
  const per = /per[ií]odos?\s+(?:iguales\s+(?:y\s+sucesivos\s+)?)?(?:y\s+sucesivos\s+)?de\s*([\w() ]{1,15}?)\s*(mes|año)/i.exec(c);
  const av = /(?:a lo menos|al menos|con|mínimo de)\s*([\w() ]{1,22}?)\s*d[ií]as\s+(?:corridos\s+|hábiles\s+)?de anticipaci/i.exec(c);
  const indef = /(?:plazo|duraci[óo]n) indefinid|tiempo indefinido/i.test(c || flat.slice(0, 6000));

  const a = { tipo: tipo ? 'Contrato de ' + tipo.trim().toLowerCase() : 'Contrato', partes: partes(flat.slice(0, 2600)) };
  a.fecha_inicio = ini ? fecha(ini[1]) : null;
  const meses = dur ? (num(dur[1]) || null) * (/añ/i.test(dur[2]) ? 12 : 1) : null;
  a.plazo = meses ? `${meses} meses` : indef ? 'indefinido' : null;
  a.indefinido = indef && !meses;
  a.fecha_termino = fin ? fecha(fin[1]) : a.fecha_inicio && meses ? addDays(addMonths(a.fecha_inicio, meses), 0) : null;
  a.renovacion_automatica = renov;
  a.periodo_renovacion_meses = per ? (num(per[1]) || 0) * (/añ/i.test(per[2]) ? 12 : 1) || null : renov ? meses : null;
  a.aviso_dias = av ? num(av[1]) : null;
  const r = /(?:renta|precio|honorario|remuneraci[óo]n)[^.]{0,90}?(\$\s?[\d.]+|UF\s?[\d,.]+|[\d,.]+\s?UF)/i.exec(flat);
  a.monto = r ? r[1].replace(/\s+/g, ' ') : null;
  const dom = /(?:ubicad[oa]s? en|con acceso por|situad[oa] en)\W{0,3}(?:calle\s+(?=Avenida|Av\.|Pasaje))?([^;]{5,90}?)(?:,\s*(?:Rol|comuna|inscrit)|\.\s|, Regi)/i.exec(flat);
  a.objeto = dom ? clean(dom[1]) : null;
  const rj = /reajust[^.]{0,80}?(IPC|UF)[^.]{0,60}/i.exec(flat);
  a.reajuste = rj ? { tipo: rj[1].toUpperCase(), periodicidad_meses: /semestral|seis meses|6 meses/i.test(rj[0]) ? 6 : /trimestral|tres meses/i.test(rj[0]) ? 3 : 12, proxima_fecha: null } : null;
  if (a.reajuste && a.fecha_inicio) { let n = addMonths(a.fecha_inicio, a.reajuste.periodicidad_meses); const hoy = new Date().toISOString().slice(0, 10); let g = 0; while (n < hoy && g++ < 200) n = addMonths(n, a.reajuste.periodicidad_meses); a.reajuste.proxima_fecha = n; }
  a.encontrado = !!(a.fecha_inicio || a.fecha_termino || a.indefinido);
  return a;
}

// Separa un PDF con varios contratos: cada título «CONTRATO DE …» en su propia línea abre uno nuevo
function extraer(texto) {
  const trozos = String(texto || '').split(/\n\s*(?=CONTRATO DE [A-ZÁÉÍÓÚÑ ]{5,45}\s*\n)/).filter((x) => x.replace(/\s/g, '').length > 1200);
  const list = (trozos.length ? trozos : [texto]).map(uno);
  const ok = list.filter((x) => x.encontrado || x.partes.length);
  return ok.length ? ok : list.slice(0, 1);
}

const api = { extraer, _fecha: fecha, _num: num };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PlazosReglas = api;
})();
