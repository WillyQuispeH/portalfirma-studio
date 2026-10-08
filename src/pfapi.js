// Cliente de la API de Portalfirma (https://api.portalfirma.cl/api), en reemplazo del conector MCP.
// Inicio de sesión local con correo y contraseña (POST /partnerUser/validate). Se guarda SOLO el token
// (cifrado), nunca la contraseña. Cada petición lleva la cabecera «id» y la cookie «auth-token»;
// al vencer, se renueva con POST /auth/refresh (cookie «refresh-token») y se reemplazan ambos tokens.
const fs = require('fs'); const path = require('path');
const store = require('./store');

const BASE = process.env.PF_API_BASE || 'https://api.portalfirma.cl/api';

function apiKey() {
  if (process.env.PF_FILE_ID) return String(process.env.PF_FILE_ID).trim();
  const cands = process.env.PF_API_CONFIG ? [process.env.PF_API_CONFIG] : [process.resourcesPath && path.join(process.resourcesPath, 'portalfirma', 'api.json'), path.join(__dirname, '..', 'build', 'portalfirma', 'api.json')].filter(Boolean);
  for (const c of cands) { try { const j = JSON.parse(fs.readFileSync(c, 'utf8')); const v = String(j.id || j.file_id || '').trim(); if (v) return v; } catch {} }
  return String(store.getSecret('pfFileId') || '').trim();
}

// Autenticación según la especificación de Portalfirma: el token viaja en la cookie «auth-token»
// (JWT tal cual) y se renueva con POST /auth/refresh enviando la cookie «refresh-token».
const sess = () => store.getSecret('pfApiSession') || null;
const setSess = (s) => store.setSecret('pfApiSession', s);
const user = () => sess()?.user || null;

class ApiError extends Error { constructor(msg, status, code, body) { super(msg); this.status = status; this.code = code; this.body = body; } }
const errText = (j) => (j && (typeof j.error === 'string' ? j.error : j.error?.message || j.message)) || '';

// cookie: 'auth' (por defecto) | 'refresh' | 'none'
async function raw(method, route, body, { cookie = 'auth', timeout = 30000 } = {}) {
  const key = apiKey(); if (!key) throw new ApiError('Falta configurar el código de acceso a la API de Portalfirma.', 0, 'NO_FILE_KEY');
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', id: key };
  const s = sess();
  if (cookie === 'auth' && s?.token) headers.Cookie = 'auth-token=' + s.token;
  if (cookie === 'refresh' && s?.refreshToken) headers.Cookie = 'refresh-token=' + s.refreshToken;
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
  let r;
  try { r = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal }); }
  catch (e) { throw new ApiError('No pude conectarme con Portalfirma (' + (e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message) + ').', 0, 'NETWORK'); }
  finally { clearTimeout(tm); }
  let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch {}
  return { status: r.status, ok: r.ok, json: j, text: j ? null : txt.slice(0, 300) };
}

// Una sola renovación a la vez (si varias peticiones vencen juntas, esperan la misma)
let refreshing = null;
function refresh() {
  if (!refreshing) refreshing = (async () => {
    const s = sess(); if (!s?.refreshToken) return false;
    const r = await raw('POST', '/auth/refresh', undefined, { cookie: 'refresh' }).catch(() => null);
    const d = r?.json?.data;
    if (r?.ok && d?.token && d?.refreshToken) { setSess({ ...sess(), token: d.token, refreshToken: d.refreshToken, t: Date.now() }); return true; }
    if (r && (r.status === 401 || r.status === 400)) setSess({ ...s, token: null, refreshToken: null }); // «Refresh token expirado/requerido»: volver a iniciar sesión
    return false;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// Llamada autenticada: ante 401 («Token expirado») renueva y reintenta una sola vez
async function call(method, route, body, opts) {
  if (!sess()?.token && !(await refresh())) throw new ApiError('Inicia sesión en Portalfirma.', 401, 'NEEDS_LOGIN');
  let r = await raw(method, route, body, opts);
  if (r.status === 401) { if (await refresh()) r = await raw(method, route, body, opts); }
  if (r.status === 401) throw new ApiError('Tu sesión de Portalfirma expiró. Vuelve a iniciar sesión.', 401, 'NEEDS_LOGIN');
  const j = r.json;
  if (!r.ok || (j && j.success === false)) throw new ApiError('Portalfirma respondió: ' + (errText(j) || r.text || 'error ' + r.status), r.status, 'API_ERROR', j);
  return j && 'data' in j ? j.data : j;
}

async function login(email, password) {
  email = String(email || '').trim(); password = String(password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError('Escribe un correo válido.', 0, 'BAD_INPUT');
  if (!password) throw new ApiError('Escribe tu contraseña.', 0, 'BAD_INPUT');
  const r = await raw('POST', '/partnerUser/validate', { email, password, appOrigin: 'portalfirma' }, { cookie: 'none' });
  const d = r.json?.data;
  if (!r.ok || !d?.token) {
    const why = errText(r.json);
    throw new ApiError(r.status === 401 || r.status === 400 || r.status === 404 ? (why || 'Correo o contraseña incorrectos.') : 'No se pudo iniciar sesión: ' + (why || 'error ' + r.status), r.status, 'LOGIN_FAILED');
  }
  const u = { user_id: d.user_id, person_id: d.person_id, entity_id: d.entity_id, role: d.role, type: d.type, email: d.email || email, nameEntity: d.nameEntity, namePerson: d.namePerson, rutUser: d.rutUser, origin: d.origin, legalization: d.legalization, protocolization: d.protocolization, logo_url: d.logo_url };
  setSess({ token: d.token, refreshToken: d.refreshToken || null, user: u, t: Date.now() });
  return u;
}
function logout() {
  store.setSecret('pfApiSession', undefined); return true;
}

// ---- Diagnóstico: guarda SOLO la forma de las respuestas (campos y tipos), sin datos personales ----
function shape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [`array(${v.length})`, shape(v[0], depth + 1)] : 'array(0)';
  if (typeof v === 'object') { if (depth > 6) return 'object…'; const o = {}; for (const [k, x] of Object.entries(v)) o[k] = /base64/i.test(k) ? `base64(${String(x || '').length})` : shape(x, depth + 1); return o; }
  if (typeof v === 'string') { if (/^\d{4}-\d\d-\d\dT/.test(v)) return 'fecha'; if (/^[0-9a-f-]{36}$/i.test(v)) return 'uuid'; if (/^eyJ/.test(v)) return 'jwt'; if (/^https?:/.test(v)) return 'url:' + v.split('/')[2]; return `texto(${v.length})`; }
  return typeof v === 'number' ? 'número' : typeof v;
}
const firstList = (d) => (Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.contracts) ? d.contracts : Array.isArray(d?.items) ? d.items : null);
const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null) return o[k]; return null; };

async function diagnostic(onStep = () => {}) {
  const u = user(); if (!u) throw new ApiError('Primero inicia sesión.', 0, 'NEEDS_LOGIN');
  const out = { version: require('../package.json').version, at: new Date().toISOString(), base: BASE, login: { campos: Object.keys(u).filter((k) => u[k] != null), refreshToken: !!sess()?.refreshToken }, tests: [] };
  const test = async (name, method, route, body, opts) => {
    onStep(name);
    let r; try { r = opts?.cookie === 'none' ? await raw(method, route, body, opts) : await raw(method, route, body, opts).then(async (x) => (x.status === 401 && await refresh() ? raw(method, route, body, opts) : x)); }
    catch (e) { r = { status: 0, error: e.message }; }
    out.tests.push({ name, method, route: route.replace(/[0-9a-f-]{36}/gi, '<uuid>').replace(/\/\d{3,}/g, '/<n>'), status: r.status, ok: r.ok, success: r.json?.success, error: r.error || (r.json && r.json.success === false ? errText(r.json).slice(0, 200) : undefined), shape: r.json ? shape(r.json) : r.text ? 'no-json: ' + r.text.slice(0, 80) : null });
    return r;
  };
  const E = u.entity_id; const UID = u.role === 'admin' ? null : u.user_id;
  const list = (stage, size = 100) => ({ page: 1, pageSize: size, entity_id: E, stage, type: 'operation', userId: UID });
  await test('lista SIN cookie (seguridad)', 'POST', '/contractPartner/getPaginatedContracts', list('finalized', 5), { cookie: 'none' });
  await test('plantillas SIN cookie (seguridad)', 'GET', '/template/getAllByEntityId/' + E, undefined, { cookie: 'none' });
  await test('saldo SIN cookie (seguridad)', 'GET', '/walletPartner/getById/' + E, undefined, { cookie: 'none' });
  const lists = {};
  for (const st of ['starting', 'process', 'finalized']) lists[st] = await test('lista ' + st, 'POST', '/contractPartner/getPaginatedContracts', list(st));
  await test('lista sin pagar', 'POST', '/contractPartner/getPaginatedUnpaidContracts', { page: 1, pageSize: 100, entity_id: E, type: 'operation', userId: UID });
  await test('saldo', 'GET', '/walletPartner/getById/' + E);
  await test('plantillas', 'GET', '/template/getAllByEntityId/' + E);
  const rows = firstList(lists.finalized?.json?.data) || firstList(lists.process?.json?.data) || firstList(lists.starting?.json?.data) || [];
  const c = rows[0] || null;
  const cid = pick(c?.contract, 'id', 'contract_id') || pick(c, 'contract_id', 'contractId', 'id'); const op = pick(c?.contract, 'operation') ?? pick(c, 'operation');
  out.muestra = { campos_contrato: c ? Object.keys(c) : [], campos_contract: c?.contract ? Object.keys(c.contract) : [], tiene_contract_id: !!cid, tiene_operacion: op != null };
  if (cid) {
    await test('firmantes por contrato', 'POST', '/contractSignatory/getByContractId', { contract_id: cid });
    await test('estado del flujo', 'POST', '/flow/getStatusContractId', { contract_id: cid });
    await test('documento (getById)', 'POST', '/file/getById', { contract_id: cid });
    await test('documento original', 'POST', '/file/getByIdContractOriginal', { contract_id: cid });
    await test('documento legalizado', 'POST', '/file/getByIdContractLegalized', { contract_id: cid });
  }
  if (op != null) {
    await test('firmantes por operación', 'GET', '/contractSignatory/getByOperation/' + op);
    await test('pago por operación', 'POST', '/contractPayment/getDetailByOperation', { operation: op });
  }
  onStep('listo');
  return out;
}

// ---- Operaciones de la cuenta ----
const listArgs = (stage, page, size) => { const u = user() || {}; return { page, pageSize: size, entity_id: u.entity_id, stage, type: 'operation', userId: u.role === 'admin' ? null : u.user_id }; };
// Todas las páginas de una etapa (starting | process | finalized | unpaid)
async function contracts(stage, { size = 100, maxPages = 60 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const d = stage === 'unpaid' ? await call('POST', '/contractPartner/getPaginatedUnpaidContracts', (({ stage: _s, ...a }) => a)(listArgs(stage, page, size))) : await call('POST', '/contractPartner/getPaginatedContracts', listArgs(stage, page, size));
    const rows = Array.isArray(d?.data) ? d.data : []; out.push(...rows);
    const pg = d?.pagination || {}; if (!rows.length || (pg.totalPages != null ? page >= pg.totalPages : rows.length < size)) break;
  }
  return out;
}
const wallet = () => call('GET', '/walletPartner/getById/' + (user() || {}).entity_id);
const signersByContract = (contract_id) => call('POST', '/contractSignatory/getByContractId', { contract_id });
const signersByOperation = (op) => call('GET', '/contractSignatory/getByOperation/' + encodeURIComponent(op));

// Documento de la operación (servicio oficial POST /file/getById), con la sesión de la cuenta
async function fileById(contract_id) {
  const d = await call('POST', '/file/getById', { contract_id });
  if (!d?.base64) throw Object.assign(new Error('Portalfirma no entregó el documento.'), { code: 'FILE_UNAVAILABLE' });
  const bytes = Buffer.from(String(d.base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (bytes.slice(0, 5).toString() !== '%PDF-') throw Object.assign(new Error('El archivo que entregó Portalfirma no es un PDF válido.'), { code: 'FILE_UNAVAILABLE' });
  return { name: d.name || null, bytes };
}

module.exports = { contracts, fileById, wallet, signersByContract, signersByOperation, BASE, apiKey, login, logout, user, call, raw, refresh, diagnostic, shape };
