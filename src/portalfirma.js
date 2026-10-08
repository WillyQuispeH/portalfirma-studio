// Cliente de Portalfirma. Habla con el MISMO servidor y las MISMAS herramientas
// que usa el conector de Portalfirma en Claude (protocolo MCP sobre HTTPS),
// con inicio de sesión OAuth 2.1 + PKCE y registro dinámico del cliente.
const fs = require('fs'); const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const store = require('./store');

const DEFAULT_SERVER = 'https://mcp.portalfirma.cl/api/mcp';
const CALLBACK_PORT = 47821; // puerto fijo: queda registrado como redirect_uri
const REDIRECT_URL = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

function serverUrl() { return store.get('serverUrl') || DEFAULT_SERVER; }

// ---- Proveedor OAuth (guarda todo cifrado en el llavero del sistema) ----
class DesktopOAuthProvider {
  constructor() { this._state = null; }
  get redirectUrl() { return REDIRECT_URL; }
  get clientMetadata() {
    return {
      client_name: 'PortalFirma Studio',
      redirect_uris: [REDIRECT_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp',
    };
  }
  state() { this._state = crypto.randomBytes(16).toString('hex'); return this._state; }
  clientInformation() { return store.getSecret('oauthClient'); }
  saveClientInformation(info) { store.setSecret('oauthClient', info); }
  tokens() { return store.getSecret('oauthTokens'); }
  saveTokens(t) { store.setSecret('oauthTokens', t); }
  saveCodeVerifier(v) { store.setSecret('pkceVerifier', v); }
  codeVerifier() { return store.getSecret('pkceVerifier'); }
  async redirectToAuthorization(url) {
    // Solo abrimos el navegador cuando el usuario pidió iniciar sesión.
    if (this.interactive) await shell.openExternal(url.toString());
  }
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') store.setSecret('oauthTokens', undefined);
    if (scope === 'all' || scope === 'client') store.setSecret('oauthClient', undefined);
    if (scope === 'all' || scope === 'verifier') store.setSecret('pkceVerifier', undefined);
  }
}

const provider = new DesktopOAuthProvider();
let client = null;

function newTransport() {
  return new StreamableHTTPClientTransport(new URL(serverUrl()), { authProvider: provider });
}

async function connectWithStoredTokens() {
  const c = new Client({ name: 'portalfirma-studio', version: '0.25.0' });
  await c.connect(newTransport());
  client = c;
  return c;
}

// Espera el código de autorización en el puerto local.
function waitForCallback(expectedStateGetter, timeoutMs = 5 * 60 * 1000) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URL);
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      const err = u.searchParams.get('error');
      const ok = code && !err && (!expectedStateGetter() || state === expectedStateGetter());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body style="font-family:-apple-system,Segoe UI,sans-serif;text-align:center;padding:60px">
        <h2>${ok ? 'Sesión iniciada' : 'No se pudo iniciar sesión'}</h2>
        <p>${ok ? 'Ya puedes volver a la aplicación Portalfirma.' : 'Cierra esta ventana e inténtalo de nuevo.'}</p></body></html>`);
      clearTimeout(timer);
      server.close();
      ok ? resolve(code) : reject(new Error(err || 'Respuesta de inicio de sesión inválida'));
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('Tiempo de espera agotado al iniciar sesión')); }, timeoutMs);
    server.on('error', (e) => reject(new Error(`No se pudo abrir el puerto ${CALLBACK_PORT}: ${e.message}`)));
    server.listen(CALLBACK_PORT, '127.0.0.1');
    cancel = () => { clearTimeout(timer); try { server.close(); } catch {} };
  });
  promise.catch(() => {});
  return { promise, cancel: () => cancel() };
}

async function login() {
  const cb = waitForCallback(() => provider._state);
  const transport = newTransport();
  const c = new Client({ name: 'portalfirma-studio', version: '0.25.0' });
  provider.interactive = true;
  try {
    try {
      await c.connect(transport); // tokens guardados válidos o renovados: no abre navegador
      cb.cancel(); client = c; return await session();
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) { cb.cancel(); throw e; }
    }
    const code = await cb.promise; // el navegador ya se abrió con la página de Portalfirma
    await transport.finishAuth(code);
  } finally { provider.interactive = false; }
  await connectWithStoredTokens();
  return await session();
}

async function tryRestore() {
  if (!store.getSecret('oauthTokens')) return null;
  try { await connectWithStoredTokens(); return await session(); } catch { return null; }
}

async function logout() {
  try { await client?.close(); } catch {}
  client = null;
  provider.invalidateCredentials('tokens');
  provider.invalidateCredentials('verifier');
}

// ---- Llamada genérica a herramientas del conector ----
async function call(name, args = {}) {
  if (!client) {
    try { await connectWithStoredTokens(); } catch { const e = new Error('NEEDS_LOGIN'); e.code = 'NEEDS_LOGIN'; throw e; }
  }
  let res;
  try {
    res = await client.callTool({ name, arguments: args });
  } catch (e) {
    if (e instanceof UnauthorizedError || /401/.test(String(e))) {
      client = null; const err = new Error('NEEDS_LOGIN'); err.code = 'NEEDS_LOGIN'; throw err;
    }
    throw e;
  }
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (res.isError) {
    const err = new Error(data?.message || data?.error || text || 'Error de Portalfirma');
    err.data = data; throw err;
  }
  return data;
}

// ---- Operaciones de alto nivel (mismo flujo que el conector en Claude) ----
const session = async () => {
  const [partner, wallet] = await Promise.all([
    call('get_partner_session'),
    call('wallet_manage_balance_tools', { action: 'get_balance' }).catch(() => null),
  ]);
  return { partner, balance: wallet?.amount ?? null };
};
const balance = async () => (await call('wallet_manage_balance_tools', { action: 'get_balance' })).amount;
const ingest = (base64, filename) => call('ingest_document_tools', { source: 'base64', base64, filename });
const extractSigners = (document_id, document_config_id) =>
  call('extract_signers_document_tools', document_config_id ? { document_id, document_config_id } : { document_id });
const sendToSign = (payload) => call('send_to_sign_document_tools', payload);
const processDetail = (operation) => call('process_detail_get_by_operation', { operation });
const manage = (args) => call('operation_manage_signing_tools', args);
const byRut = (rut, startDate, endDate, limit = 50) =>
  call('operation_get_operation_by_rut', { rut, startDate, endDate, limit });
const byPhone = (phone, startDate, endDate, limit = 100) =>
  call('operation_get_operation_by_phone', { phone, startDate, endDate, limit });
const cds = (args) => call('sign_documents_cds_massive_tools', args);
// Documento de una operación: por norma se usa SOLO el servicio oficial de archivos de Portalfirma
// POST https://api.portalfirma.cl/api/file/getById  { contract_id }  →  { success, data: { name, base64, … } }
const FILE_API = 'https://api.portalfirma.cl/api/file/getById';
// Credencial de acceso al servicio (cabecera «id»): variable PF_FILE_ID, archivo de configuración
// (resources/portalfirma/api.json → { "file_id": "…" }) o la que el usuario guardó en la app.
function fileKey() {
  if (process.env.PF_FILE_ID) return String(process.env.PF_FILE_ID).trim();
  const cands = process.env.PF_API_CONFIG ? [process.env.PF_API_CONFIG] : [process.resourcesPath && path.join(process.resourcesPath, 'portalfirma', 'api.json'), path.join(__dirname, '..', 'build', 'portalfirma', 'api.json')].filter(Boolean);
  for (const c of cands) { try { const v = (()=>{ const j = JSON.parse(fs.readFileSync(c, 'utf8')); return String(j.id || j.file_id || ''); })().trim(); if (v) return v; } catch {} }
  return String(store.getSecret('pfFileId') || '').trim();
}
const setFileKey = (v) => { v = String(v || '').trim(); if (!/^[A-Za-z0-9._-]{4,200}$/.test(v)) throw new Error('El código de acceso no es válido.'); store.setSecret('pfFileId', v); return true; };
async function fileById(contractId) {
  if (!contractId) throw new Error('La operación no trae su identificador de contrato.');
  const key = fileKey();
  if (!key) { const e = new Error('Falta configurar el acceso al servicio de archivos de Portalfirma.'); e.code = 'NO_FILE_KEY'; throw e; }
  let r;
  try {
    r = await fetch(FILE_API, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', id: key }, body: JSON.stringify({ contract_id: String(contractId) }) });
  } catch (err) { const e = new Error('No pude conectarme con Portalfirma para traer el documento (' + err.message + ').'); e.code = 'FILE_UNAVAILABLE'; throw e; }
  let j = null; try { j = await r.json(); } catch {}
  if (r.status === 401 || r.status === 403) { const e = new Error('Portalfirma rechazó el acceso al servicio de archivos (revisa el código de acceso).'); e.code = 'NO_FILE_KEY'; throw e; }
  if (!r.ok || !j?.success || !j.data?.base64) {
    const why = (j && (typeof j.error === 'string' ? j.error : j.error?.message)) || (r.ok ? 'respuesta sin archivo' : 'error ' + r.status);
    const e = new Error('Portalfirma no entregó el documento: ' + why + '.'); e.code = 'FILE_UNAVAILABLE'; throw e;
  }
  const buf = Buffer.from(String(j.data.base64).replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.slice(0, 5).toString() !== '%PDF-') { const e = new Error('El archivo que entregó Portalfirma no es un PDF válido.'); e.code = 'FILE_UNAVAILABLE'; throw e; }
  return { name: j.data.name || null, bytes: buf, updated: j.data.updated || null };
}
const topUp = (amount, email) => call('wallet_manage_balance_tools', { action: 'add_amount_flow', amount, email });

// ---- Acceso genérico para el asistente ----
async function ensureClient() {
  if (!client) {
    try { await connectWithStoredTokens(); } catch { const e = new Error('NEEDS_LOGIN'); e.code = 'NEEDS_LOGIN'; throw e; }
  }
  return client;
}
// Lista TODAS las herramientas que publica el servidor (incluye las que Portalfirma agregue en el futuro).
async function listTools() {
  const c = await ensureClient();
  const out = []; let cursor;
  do { const r = await c.listTools(cursor ? { cursor } : {}); out.push(...r.tools); cursor = r.nextCursor; } while (cursor);
  return out;
}
// Llama una herramienta y devuelve el texto tal cual (sin lanzar error si la herramienta falla).
async function callRaw(name, args = {}) {
  const c = await ensureClient();
  try {
    const res = await c.callTool({ name, arguments: args });
    const text = (res.content || []).map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
    return { text, isError: !!res.isError };
  } catch (e) {
    if (e instanceof UnauthorizedError || /401/.test(String(e))) { client = null; const err = new Error('NEEDS_LOGIN'); err.code = 'NEEDS_LOGIN'; throw err; }
    return { text: 'Error: ' + (e.message || String(e)), isError: true };
  }
}
const accessToken = () => store.getSecret('oauthTokens')?.access_token;

// ---- Notaría virtual (plantillas notariales del conector) ----
const templateSearch = (query, top_k = 20) => call('template_manage_tools', { action: 'search', query, top_k });
const templateForms = (template_version_id) => call('template_manage_tools', { action: 'get_forms', template_version_id });
const templateSend = (template_version_id, values) => call('template_manage_tools', { action: 'send_sign', template_version_id, values });

module.exports = {
  DEFAULT_SERVER, REDIRECT_URL, serverUrl,
  login, logout, tryRestore, session, balance,
  ingest, extractSigners, sendToSign, processDetail, manage, byRut, byPhone, cds, fileById, fileKey, setFileKey, topUp,
  listTools, callRaw, accessToken,
  templateSearch, templateForms, templateSend,
};
