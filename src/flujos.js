// Flujos documentales (Fase 1): receta = modelo de Portalfirma + forma de llenarlo desde una nómina + firmantes.
// Ejecutar una receta: lee la nómina (Excel o CSV), genera un PDF por fila con el texto del modelo (sin IA,
// el texto no se toca), y los deja en la cola de la carga masiva con sus firmantes ya asignados.
// La nómina NO se guarda: de cada ejecución solo queda el nombre y RUT de cada fila para el seguimiento.
const fs = require('fs'); const path = require('path');
const { app } = require('electron');
const XLSX = require('xlsx');
const store = require('./store');

let toPdf = null; let bulk = null; let emit = () => {};
const MAX_ROWS = 2000;
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const runsDir = () => { const d = path.join(app.getPath('userData'), 'flujos'); fs.mkdirSync(d, { recursive: true }); return d; };

function init({ htmlToPdf, bulkModule, onUpdate }) { toPdf = htmlToPdf; bulk = bulkModule; emit = onUpdate || emit; }

// ---------- modelos ----------
let MODELS = null;
function models() {
  if (MODELS) return MODELS;
  const cands = [process.env.PF_MODELOS, process.resourcesPath && path.join(process.resourcesPath, 'modelos', 'modelos-portalfirma.json'), path.join(__dirname, '..', 'build', 'modelos', 'modelos-portalfirma.json')].filter(Boolean);
  for (const f of cands) { try { MODELS = JSON.parse(fs.readFileSync(f, 'utf8')).map(describe); return MODELS; } catch {} }
  MODELS = []; return MODELS;
}
const OPTIONAL = /si corresponde|dejar en blanco|si aplica|si existe|no aplica|opcional/i;
const SIGNER_KEYS = { nombre: 'fullName', rut: 'rut', email: 'email', telefono: 'phone' };
const title = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
// Cada campo viene como [[campo_grupo_signer|Etiqueta]]: «signer» = dato de alguien que firma.
function describe(m) {
  const fields = []; const seen = new Set();
  for (const [, id, label] of m.texto.matchAll(/\[\[([^|\]]+)\|([^\]]*)\]\]/g)) {
    if (seen.has(id)) continue; seen.add(id);
    const parts = id.split('_'); const kind = parts.length >= 3 ? parts.pop() : 'nosigner'; const group = parts.length >= 2 ? parts.pop() : 'documento'; const key = parts.join('_');
    const signer = kind === 'signer';
    fields.push({ id, label: label.trim(), key, group, groupLabel: title(group), signer, signerKey: signer ? SIGNER_KEYS[key] || null : null, required: !OPTIONAL.test(label) });
  }
  const roles = [...new Set(fields.filter((f) => f.signer).map((f) => f.group))].map((g) => ({ group: g, alias: title(g) }));
  return { id: m.template_version_id, nombre: m.nombre, categoria: m.categoria, descripcion: m.descripcion, precio: m.precio, texto: m.texto, fields, roles };
}
const model = (id) => models().find((m) => m.id === id);
const modelList = () => models().map(({ texto, ...m }) => m);

// ---------- recetas ----------
const recipes = () => store.get('flujos') || [];
function saveRecipe(r) {
  const list = recipes(); const now = new Date().toISOString();
  const clean = { id: r.id || uid('r'), name: String(r.name || 'Receta').trim().slice(0, 80), modelId: r.modelId, mapping: r.mapping || {}, opts: r.opts || {}, updated: now, created: r.created || now };
  const i = list.findIndex((x) => x.id === clean.id); if (i >= 0) list[i] = { ...list[i], ...clean }; else list.unshift(clean);
  store.set('flujos', list); return clean;
}
function deleteRecipe(id) { store.set('flujos', recipes().filter((x) => x.id !== id)); return recipes(); }

// ---------- nómina ----------
function readNomina(file) {
  const ext = path.extname(file).toLowerCase();
  if (!['.xlsx', '.xls', '.csv', '.ods'].includes(ext)) throw new Error('La nómina debe ser Excel (.xlsx) o CSV.');
  const buf = fs.readFileSync(file);
  const wb = ext === '.csv' ? XLSX.read(buf.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]]; if (!ws) throw new Error('La planilla está vacía.');
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false });
  const hi = grid.findIndex((r) => r.filter((c) => String(c).trim()).length >= 2); // primera fila con títulos
  if (hi < 0) throw new Error('No encontré los títulos de las columnas (la primera fila debe tenerlos).');
  const headers = grid[hi].map((h, i) => String(h).trim() || `Columna ${i + 1}`);
  const rows = grid.slice(hi + 1).filter((r) => r.some((c) => String(c).trim())).map((r) => headers.map((_, i) => cell(r[i])));
  if (!rows.length) throw new Error('La nómina no tiene filas con datos.');
  if (rows.length > MAX_ROWS) throw new Error(`La nómina tiene ${rows.length} filas; el máximo por ejecución es ${MAX_ROWS}. Divídela en partes.`);
  return { name: path.basename(file), headers, rows };
}
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const longDate = (d) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
function cell(v) {
  if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600000); return { t: 'd', v: d.toISOString().slice(0, 10), s: longDate(d) }; }
  if (typeof v === 'number') return { t: 'n', v, s: String(v) };
  return { t: 's', v: String(v ?? '').trim(), s: String(v ?? '').trim() };
}

// ---------- llenar un modelo ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MONEY = /monto|renta|canon|sueldo|precio|valor|suma|capital|garant|deuda|pago|cuota/i;
const DATE = /fecha/i;
// Valor que va en el documento para un campo, según la regla de la receta
function valueFor(f, rule, row, ctx) {
  if (!rule || rule.type === 'empty') return '';
  if (rule.type === 'today') return longDate(ctx.today);
  if (rule.type === 'fixed') return String(rule.value || '').trim();
  if (rule.type === 'col') {
    const c = row[rule.col]; if (!c) return '';
    if (c.t === 'd') return c.s;
    if (c.t === 'n') {
      if (MONEY.test(f.label) && !/rut/i.test(f.key)) return c.v.toLocaleString('es-CL', { maximumFractionDigits: 2 });
      return String(c.v);
    }
    if (DATE.test(f.label) && /^\d{4}-\d{2}-\d{2}$/.test(c.v)) return longDate(new Date(c.v + 'T12:00:00'));
    if (DATE.test(f.label) && /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.test(c.v)) { const [, d, m, y] = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(c.v); return longDate(new Date(`${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T12:00:00`)); }
    return c.s;
  }
  return '';
}
const phone = (v) => { const d = String(v).replace(/[^\d+]/g, ''); if (/^56\d{9}$/.test(d)) return '+' + d; if (/^9\d{8}$/.test(d)) return '+56' + d; return String(v); };
function fillValues(m, mapping, row, ctx) { const out = {}; for (const f of m.fields) { let v = valueFor(f, mapping[f.id], row, ctx); if (v && /^tel[eé]fono/i.test(f.key)) v = phone(v); out[f.id] = v; } return out; }
function toHtml(texto, values) {
  const inline = (s) => esc(s).replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, (_, id) => `\u0000${id}\u0001`).replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>').replace(/\*\*/g, '')
    .replace(/\u0000([^\u0001]+)\u0001/g, (_, id) => esc(values[id] ?? '')).replace(/\s+([,.;:])/g, '$1').replace(/ {2,}/g, ' ');
  const out = []; let list = false;
  for (const raw of texto.split('\n')) {
    const line = raw.trim();
    if (!line) { if (list) { out.push('</ul>'); list = false; } continue; }
    if (line.startsWith('- ')) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (out.length === 0 && (/^\*\*[^*]+\*\*$/.test(line) || (line.length < 150 && line === line.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(line)))) out.push(`<h1>${inline(line)}</h1>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}
const CSS = '<style>@page{size:Letter;margin:2.5cm 2.5cm}body{font-family:"Times New Roman",serif;font-size:12pt;line-height:1.5;text-align:justify}h1{font-size:14pt;text-align:center;margin:0 0 18pt}p{margin:0 0 9pt}ul{margin:0 0 9pt 18pt;padding:0}li{margin:0 0 4pt}</style>';

// ---------- validación ----------
function rutOk(r) {
  const s = String(r || '').replace(/[.\s]/g, '').toUpperCase(); const m = /^(\d{1,8})-?([\dK])$/.exec(s); if (!m) return false;
  let sum = 0; let mul = 2; for (let i = m[1].length - 1; i >= 0; i--) { sum += Number(m[1][i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const dv = 11 - (sum % 11); return (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv)) === m[2];
}
const fmtRut = (r) => { const s = String(r || '').replace(/[.\s-]/g, '').toUpperCase(); if (s.length < 2) return r; const b = s.slice(0, -1); return b.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + s.slice(-1); };
const mailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
// Revisa cada fila: campos obligatorios, RUT, correos, firmantes repetidos y filas duplicadas
function check({ modelId, mapping, nomina }) {
  const m = model(modelId); if (!m) throw new Error('El modelo ya no existe.');
  const ctx = { today: new Date() }; const seen = new Map();
  const rows = nomina.rows.map((row, n) => {
    const v = fillValues(m, mapping, row, ctx); const errs = []; const warns = [];
    for (const f of m.fields) {
      const val = v[f.id];
      if (!val && f.required && !(f.signer && f.signerKey === 'phone')) errs.push(`falta ${f.groupLabel.toLowerCase()}: ${f.label.toLowerCase()}`);
      if (val && (/(^|-)rut(-|$)/i.test(f.key) || /rol [úu]nico tributario/i.test(f.label)) && !/pasaporte/i.test(f.label) && !rutOk(val)) errs.push(`RUT inválido (${f.groupLabel}): ${val}`);
      if (val && (f.key === 'email' || /correo|e-?mail/i.test(f.label)) && !mailOk(val)) errs.push(`correo inválido (${f.groupLabel}): ${val}`);
    }
    const signers = signersFor(m, v);
    const ruts = signers.map((s) => s.rut.replace(/[.\s-]/g, '').toUpperCase()).filter(Boolean);
    if (new Set(ruts).size !== ruts.length) warns.push('el mismo RUT aparece en dos firmantes');
    const key = JSON.stringify(v); if (seen.has(key)) errs.push(`fila repetida (igual a la fila ${seen.get(key) + 1})`); else seen.set(key, n);
    const who = signers[0] ? `${signers[0].fullName || ''}${signers[0].rut ? ' · ' + signers[0].rut : ''}` : `Fila ${n + 1}`;
    return { n, label: who, errors: errs, warnings: warns, ok: !errs.length };
  });
  return { rows, ok: rows.filter((r) => r.ok).length, bad: rows.filter((r) => !r.ok).length };
}
function signersFor(m, v) {
  return m.roles.map((r) => {
    const s = { alias: r.alias, fullName: '', rut: '', email: '', phone: '' };
    for (const f of m.fields) if (f.signer && f.group === r.group && f.signerKey) s[f.signerKey] = String(v[f.id] || '').trim();
    if (s.rut) s.rut = fmtRut(s.rut);
    return s;
  });
}

// ---------- muestra y ejecución ----------
const fileName = (m, v, n) => {
  const who = signersFor(m, v)[0]; const tag = who ? (who.fullName || who.rut || '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40) : '';
  return `${String(n + 1).padStart(3, '0')} - ${m.nombre.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)}${tag ? ' - ' + tag : ''}.pdf`;
};
async function render(m, mapping, row, ctx) { const v = fillValues(m, mapping, row, ctx); return { v, pdf: await toPdf(CSS + toHtml(m.texto, v)) }; }
async function sample({ modelId, mapping, nomina, n = 0 }) {
  const m = model(modelId); const row = nomina.rows[n]; if (!row) throw new Error('Esa fila no existe.');
  const { v, pdf } = await render(m, mapping, row, { today: new Date() });
  const dir = path.join(runsDir(), 'muestras'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Muestra ' + fileName(m, v, n)); fs.writeFileSync(file, pdf);
  return { file, bytes: new Uint8Array(pdf), signers: signersFor(m, v) };
}
let running = null;
async function run({ recipeId, recipeName, modelId, mapping, nomina, only }) {
  if (running) throw new Error('Ya se está ejecutando un flujo. Espera que termine.');
  const m = model(modelId); if (!m) throw new Error('El modelo ya no existe.');
  const chk = check({ modelId, mapping, nomina });
  const pick = chk.rows.filter((r) => r.ok && (!only || only.includes(r.n)));
  if (!pick.length) throw new Error('No hay filas válidas para generar.');
  const id = uid('x'); const dir = path.join(runsDir(), id); fs.mkdirSync(dir, { recursive: true });
  const ctx = { today: new Date() };
  const rec = { id, recipeId: recipeId || null, recipeName: recipeName || m.nombre, modelId, modelName: m.nombre, nomina: nomina.name, date: new Date().toISOString(), total: pick.length, rows: [], status: 'generating' };
  const runs = store.get('flujosRuns') || []; runs.unshift(rec); store.set('flujosRuns', runs.slice(0, 100));
  running = rec; emit(state());
  const items = [];
  try {
    for (const r of pick) {
      const { v, pdf } = await render(m, mapping, nomina.rows[r.n], ctx);
      const file = path.join(dir, fileName(m, v, r.n)); fs.writeFileSync(file, pdf);
      rec.rows.push({ n: r.n, label: r.label, file }); items.push({ path: file, signers: signersFor(m, v), flow: { runId: id, n: r.n } });
      if (rec.rows.length % 5 === 0 || rec.rows.length === pick.length) { saveRun(rec); emit(state()); }
    }
    const st = await bulk.add(items);
    const byPath = new Map(st.items.map((x) => [x.path, x.id]));
    for (const row of rec.rows) row.bulkId = byPath.get(row.file) || null;
    rec.status = 'queued';
  } catch (e) { rec.status = 'error'; rec.error = e.message; throw e; }
  finally { saveRun(rec); running = null; emit(state()); }
  return rec;
}
function saveRun(rec) { const runs = store.get('flujosRuns') || []; const i = runs.findIndex((x) => x.id === rec.id); if (i >= 0) runs[i] = { ...rec }; else runs.unshift({ ...rec }); store.set('flujosRuns', runs); }
const runsList = () => store.get('flujosRuns') || [];
// Borra los PDF generados de una ejecución (tienen datos personales) y su registro
function deleteRun(id) {
  const runs = runsList(); const rec = runs.find((x) => x.id === id);
  if (rec) { try { fs.rmSync(path.join(runsDir(), id), { recursive: true, force: true }); } catch {} }
  store.set('flujosRuns', runs.filter((x) => x.id !== id)); return runsList();
}
const state = () => ({ running: running ? { id: running.id, done: running.rows.length, total: running.total } : null });

module.exports = { init, modelList, model: (id) => { const m = model(id); return m && { ...m }; }, recipes, saveRecipe, deleteRecipe, readNomina, check, sample, run, runs: runsList, deleteRun, state, _rutOk: rutOk, _toHtml: toHtml, _describe: describe };
