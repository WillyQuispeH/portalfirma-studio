// Asistente legal: llamadas al modelo de lenguaje desde el proceso principal.
// La clave de API se guarda cifrada (llavero del sistema) y nunca llega a la ventana de la app.
const store = require('./store');

const PROVIDERS = {
  openai: { label: 'OpenAI (ChatGPT)', keyHint: 'sk-…', site: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic (Claude)', keyHint: 'sk-ant-…', site: 'https://console.anthropic.com/settings/keys' },
};
const MOCK = process.env.PF_MOCK === '1';
const fs = require('fs'); const path = require('path');

// ---- Clave incluida en la app (la pone Portalfirma al compilar; los usuarios no la ven ni la cambian) ----
// Archivo: <recursos>/ia/clave.bin = {provider, key, model} ofuscado. No es un secreto criptográfico:
// cualquier binario de escritorio puede inspeccionarse, por eso la clave debe tener límite de gasto.
const MASK = Buffer.from('portalfirma-studio·asistente-legal');
const unmask = (b) => Buffer.from(b.map((x, i) => x ^ MASK[i % MASK.length]));
let managedCache; let autoModel = '';
function managed() {
  if (managedCache !== undefined) return managedCache;
  managedCache = null;
  if (process.env.PF_AI_MANAGED === 'none') return null; // pruebas: sin clave incluida
  const cands = [process.env.PF_AI_MANAGED, process.resourcesPath && path.join(process.resourcesPath, 'ia', 'clave.bin'), path.join(__dirname, '..', 'build', 'ia', 'clave.bin')].filter(Boolean);
  for (const f of cands) {
    try { const j = JSON.parse(unmask(fs.readFileSync(f)).toString('utf8')); if (j.key && PROVIDERS[j.provider]) { managedCache = j; break; } } catch {}
  }
  return managedCache;
}

function config() {
  const c = { provider: 'openai', model: '', consent: false, ...(store.get('ai') || {}) };
  const m = managed(); if (m) { c.provider = m.provider; c.model = m.model || c.model; if (m.docModel && !c.docModel) c.docModel = m.docModel; }
  return c;
}
function status() {
  const c = config(); const m = managed(); const key = m ? m.key : store.getSecret('aiKey:' + c.provider);
  return { provider: c.provider, model: c.model, consent: !!c.consent, hasKey: !!key || MOCK, keyEnd: key && !m ? key.slice(-4) : '', managed: !!m, providers: PROVIDERS, mock: MOCK };
}
function setConfig(p) {
  if (managed()) { // asistente incluido: solo se guarda el consentimiento
    const c = { ...(store.get('ai') || {}) }; if (p.consent !== undefined) c.consent = !!p.consent; if (p.docModel !== undefined) c.docModel = String(p.docModel || ''); store.set('ai', c); docModelCache = ''; return status();
  }
  const c = config();
  if (p.provider && PROVIDERS[p.provider]) c.provider = p.provider;
  if (p.model !== undefined) c.model = String(p.model || '');
  if (p.docModel !== undefined) { c.docModel = String(p.docModel || ''); docModelCache = ''; }
  if (p.consent !== undefined) c.consent = !!p.consent;
  store.set('ai', c);
  if (p.key !== undefined) {
    const k = String(p.key || '').trim();
    if (k && !/^sk-[A-Za-z0-9_-]{20,}$/.test(k)) throw new Error('La clave no tiene el formato esperado (empieza con «sk-»).');
    store.setSecret('aiKey:' + c.provider, k || undefined);
  }
  return status();
}
function key() {
  const c = config(); const m = managed(); const k = m ? m.key : store.getSecret('aiKey:' + c.provider);
  if (!k) { const e = new Error('Falta la clave de API del asistente. Agrégala en «Asistente → Ajustes».'); e.code = 'NO_KEY'; throw e; }
  return { c, k };
}

async function http(url, opts, ms = 180000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) {
      const msg = j?.error?.message || txt.slice(0, 300);
      if (r.status === 401) throw new Error('El proveedor rechazó la clave de API (inválida o anulada). Revisa «Asistente → Ajustes».');
      if (r.status === 429) throw new Error('Se alcanzó el límite de uso o no hay saldo en la cuenta del proveedor. Detalle: ' + msg);
      if (r.status === 404 && /model/i.test(msg)) throw new Error('El modelo elegido no está disponible para esta cuenta. Elige otro en «Asistente → Ajustes».');
      throw new Error(`El proveedor respondió con error ${r.status}: ${msg}`);
    }
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('El asistente tardó demasiado en responder. Intenta con un documento más corto o de nuevo en un momento.');
    if (/fetch failed|ENOTFOUND|ECONN/i.test(String(e.message))) throw new Error('No hay conexión con el proveedor de IA. Revisa tu internet.');
    throw e;
  } finally { clearTimeout(t); }
}

// Lista de modelos de la cuenta (para elegir en Ajustes)
async function models() {
  if (MOCK) return ['modelo-de-prueba'];
  const { c, k } = key();
  if (c.provider === 'anthropic') {
    const j = await http('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }, 30000);
    return (j.data || []).map((m) => m.id);
  }
  const j = await http('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + k } }, 30000);
  return (j.data || []).map((m) => m.id).filter((id) => /^(gpt-|o\d|chatgpt)/.test(id) && !/audio|realtime|transcribe|tts|image|search|embedding|instruct/.test(id)).sort().reverse();
}
const pickDefault = (list) => list.find((m) => /^gpt-5(\.\d)?$/.test(m)) || list.find((m) => /^gpt-5/.test(m) && !/mini|nano/.test(m)) || list.find((m) => /^gpt-4\.1$/.test(m)) || list.find((m) => /^gpt-4o$/.test(m)) || list.find((m) => /claude.*(opus|sonnet)/.test(m)) || list[0];

// ---- Tokens (Paquete de tokens) ----
// Etapa de prueba: el saldo vive en este computador y el paquete se activa con un código de soporte.
// Cuando Portalfirma tenga el saldo en su servidor, esto se reemplaza por consultas a ese servicio.
const COSTS = { review: 1, ask: 1, detect: 2, draft: 2, edit: 1, plazo: 1, agent: 1 };   // agent = 1 token cada 3 mensajes al agente   // ask = 1 token cada 3 preguntas
const ASK_PER_TOKEN = 3; const WELCOME = 5;
const PACK = { tokens: 20, price: 10000, name: 'Paquete de tokens' };
const TEST_CODES = ['portalfirma123'];                        // código de prueba (cambiar antes del lanzamiento)
function wallet() {
  let w = store.get('aiTokens');
  if (!w) { w = { balance: WELCOME, askLeft: 0, log: [{ t: Date.now(), d: +WELCOME, what: 'Bienvenida' }] }; store.set('aiTokens', w); }
  return w;
}
const saveWallet = (w) => { w.log = (w.log || []).slice(-200); store.set('aiTokens', w); };
function walletStatus() { const w = wallet(); return { balance: w.balance, askLeft: w.askLeft || 0, costs: COSTS, askPerToken: ASK_PER_TOKEN, pack: PACK, log: (w.log || []).slice(-30).reverse() }; }
const costOf = (action, w) => (action === 'ask' ? ((w.askLeft || 0) > 0 ? 0 : COSTS.ask) : COSTS[action] ?? 1);
function redeem(code) {
  const c = String(code || '').trim().toLowerCase().replace(/[-\s]+$/, '');
  if (!TEST_CODES.includes(c)) throw new Error('El código no es válido. Revísalo o pide uno nuevo a soporte por WhatsApp.');
  const w = wallet(); w.balance += PACK.tokens; w.log.push({ t: Date.now(), d: +PACK.tokens, what: PACK.name }); saveWallet(w);
  return walletStatus();
}
const LABEL = { agent: 'Agente Portalfirma (3 mensajes)', review: 'Revisión', ask: 'Preguntas (3)', detect: 'Detectar campos', draft: 'Generar documento', edit: 'Modificación con IA', plazo: 'Análisis de plazos' };

// Llamada principal: system + mensajes; si json=true se pide un objeto JSON. `action` define el costo en tokens.
async function chat({ system, messages, json = false, action = 'review' }) {
  const w0 = wallet(); const cost = costOf(action, w0);
  if (w0.balance < cost) { const e = new Error(`No te quedan tokens suficientes (esta acción usa ${cost}, tienes ${w0.balance}).`); e.code = 'NO_TOKENS'; e.data = walletStatus(); throw e; }
  const r = await rawChat({ system, messages, json });
  // se descuenta solo si la respuesta llegó bien
  const w = wallet(); const c = costOf(action, w);
  if (action === 'ask') w.askLeft = c ? ASK_PER_TOKEN - 1 : w.askLeft - 1;
  if (c) { w.balance = Math.max(0, w.balance - c); w.log.push({ t: Date.now(), d: -c, what: LABEL[action] || action }); }
  saveWallet(w);
  return { ...r, tokens: walletStatus() };
}
async function rawChat({ system, messages, json, images, model: forced, extra }) {
  if (MOCK) return mockReply({ system, messages, json });
  const { c, k } = key();
  let model = forced || c.model;
  if (!model) model = autoModel; if (!model) { model = pickDefault(await models()); if (!model) throw new Error('No se encontró un modelo disponible en la cuenta.'); autoModel = model; if (!managed()) setConfig({ model }); }
  // imágenes (páginas de un documento) en el último mensaje del usuario, según el proveedor
  if (images && images.length) {
    const last = messages[messages.length - 1];
    last.content = c.provider === 'anthropic'
      ? [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })), { type: 'text', text: last.content }]
      : [{ type: 'text', text: last.content }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}`, detail: 'high' } }))];
  }
  if (c.provider === 'anthropic') {
    const j = await http('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 8000, system: system + (json ? '\nResponde SOLO con un objeto JSON válido, sin texto antes ni después.' : ''), messages }),
    });
    const text = (j.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
    return { text, model, usage: j.usage };
  }
  const body = { model, messages: [{ role: 'system', content: system }, ...messages], ...(extra || {}) };
  if (json) body.response_format = { type: 'json_object' };
  const go = (b) => http('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + k, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  let j;
  try { j = await go(body); } catch (e) { // si el modelo no acepta un parámetro de ahorro, se reintenta sin él
    if (extra && /reasoning|unsupported|not supported|unrecognized/i.test(e.message)) { const b2 = { ...body }; Object.keys(extra).forEach((x) => delete b2[x]); j = await go(b2); } else throw e;
  }
  return { text: j.choices?.[0]?.message?.content || '', model, usage: j.usage };
}

// Modelo para leer documentos: el más económico de la cuenta que acepte imágenes.
// Orden: la línea más barata («luna»), luego «nano» y luego «mini», siempre la versión más nueva.
// Se puede fijar con PF_DOC_MODEL o en la configuración (ai.docModel).
let docModelCache = '';
const verOf = (id) => { const m = id.match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };
async function docModel() {
  if (process.env.PF_DOC_MODEL) return process.env.PF_DOC_MODEL;
  const c = config(); if (c.docModel) return c.docModel;
  if (docModelCache) return docModelCache;
  const list = (await models()).filter((x) => !/audio|realtime|transcribe|tts|search|image|codex|cyber|embedding|moderation|research/.test(x));
  const fam = c.provider === 'anthropic' ? [/haiku/] : [/luna/, /nano/, /mini/];
  for (const re of fam) {
    const cand = list.filter((x) => re.test(x)).sort((a, b) => verOf(b) - verOf(a) || a.length - b.length);
    if (cand.length) return (docModelCache = cand[0]);
  }
  return '';
}

// Lectura de documentos para trámites notariales (PDF o fotos): datos y transcripción literal.
// Va incluida en el valor del trámite, por eso no descuenta tokens del asistente.
async function leerDocumento({ imagenes, desde = 1, total = 1 }) {
  const system = 'Eres un asistente de una notaría chilena. Lees páginas de un documento (PDF, foto o escaneo) con total exactitud. No inventes ni completes datos: si algo no se lee, usa null y anótalo en "ilegible". Responde SOLO con un objeto JSON válido.';
  const pide = `LEER_DOCUMENTO páginas ${desde} a ${desde + imagenes.length - 1} de ${total}. Devuelve exactamente este JSON:
{"titulo": "título del documento tal como aparece, o null si estas páginas no lo muestran",
 "tipo": "qué documento es, en pocas palabras",
 "fecha": "fecha del documento AAAA-MM-DD o null",
 "participantes": [{"nombre": "nombre completo o razón social", "rut": "RUT o cédula tal como aparece, o null", "rol": "calidad en que participa (vendedor, arrendador, representante legal…), o null"}],
 "firmas": [{"nombre": "quién firma, o null si no se lee", "tipo": "electronica | manuscrita | timbre", "fecha": "AAAA-MM-DD o null"}],
 "patente": "placa patente de un vehículo si aparece, o null",
 "texto": "transcripción LITERAL y COMPLETA de estas páginas: mismas palabras, cifras y signos, sin corregir ni resumir; párrafos separados por una línea en blanco; donde haya una firma manuscrita escribe (Hay firma) y donde haya un timbre de firma electrónica escribe (Hay firma electrónica avanzada de NOMBRE)",
 "ilegible": ["fragmentos que no se pudieron leer"]}`;
  const model = MOCK ? '' : await docModel();
  const r = await rawChat({ system, messages: [{ role: 'user', content: pide }], json: true, images: imagenes, model: model || undefined, extra: /gpt-5|gpt-6|luna|nano|mini/.test(model) && !/4o|4\.1/.test(model) ? { reasoning_effort: 'minimal' } : undefined });
  const t = String(r.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  const uso = { modelo: r.model, entrada: r.usage?.prompt_tokens ?? r.usage?.input_tokens ?? null, salida: r.usage?.completion_tokens ?? r.usage?.output_tokens ?? null };
  try { return { ...JSON.parse(t), _uso: uso }; } catch { throw new Error('La lectura con IA no devolvió un resultado válido. Intenta de nuevo o sube el documento en Word.'); }
}

// Propuesta de reglas nuevas a partir de casos corregidos (fuera de línea, en lote).
// La IA solo PROPONE: una persona de Portalfirma aprueba o descarta cada regla, y las aprobadas se ejecutan
// sin IA (expresiones regulares). Va por cuenta de Portalfirma: no descuenta tokens del asistente.
async function proponerReglas({ casos, actos, materias }) {
  const system = 'Eres un analista de una red de notarías chilenas. Revisas casos donde la detección automática de la materia de un escrito notarial falló y el cliente la corrigió. Propones reglas deterministas (expresiones regulares de JavaScript) que detecten esos casos en el futuro sin generar falsos positivos. Responde SOLO con un objeto JSON válido.';
  const pide = `PROPONER_REGLAS
Reglas del sistema:
- Las expresiones se aplican sobre texto en minúsculas y SIN tildes (á→a, ñ→n). Usa \\b y \\s+ entre palabras; no uses banderas.
- Busca la FÓRMULA OPERATIVA del acto (verbos en presente: «da en comodato», «constituye usufructo»), no palabras sueltas que puedan aparecer en menciones de actos anteriores.
- Tipos de regla:
  · "acto": un acto que el sistema NO detectó y el cliente agregó. Campos: nombre, codigo (código de la planilla o null), patron, incluido (regex de códigos de materia que ya cubren el acto, o null), principal (true si cambia la naturaleza del escrito).
  · "materia": el título del escrito debe clasificarse en otra materia. Campos: materia (código), campo ("titulo" o "cuerpo"), patron.
  · "excepcion": un acto detectado que el cliente descartó con razón (falso positivo). Campos: acto (código o nombre del acto), patron (lo que, presente en la cita, demuestra que NO es ese acto).
- No propongas nada si los casos no muestran un patrón claro. Cada propuesta indica los ids de los casos que la sustentan.
Actos que el sistema ya detecta: ${actos.join(', ')}
Materias de la planilla (código: nombre):
${materias.map((m) => `${m.value}: ${m.label}`).join('\n')}
Casos (JSON):
${JSON.stringify(casos)}
Devuelve exactamente: {"propuestas":[{"tipo":"acto|materia|excepcion","nombre":"…","codigo":null,"materia":null,"acto":null,"campo":null,"patron":"…","incluido":null,"principal":false,"explicacion":"por qué, en una frase","casos":["id"]}]}`;
  const model = MOCK ? '' : await docModel();
  const r = await rawChat({ system, messages: [{ role: 'user', content: pide }], json: true, model: model || undefined, extra: /gpt-5|gpt-6|luna|nano|mini/.test(model) && !/4o|4\.1/.test(model) ? { reasoning_effort: 'low' } : undefined });
  const t = String(r.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '');
  const uso = { modelo: r.model, entrada: r.usage?.prompt_tokens ?? r.usage?.input_tokens ?? null, salida: r.usage?.completion_tokens ?? r.usage?.output_tokens ?? null };
  try { const j = JSON.parse(t); return { propuestas: Array.isArray(j.propuestas) ? j.propuestas : [], _uso: uso }; } catch { throw new Error('La IA no devolvió propuestas válidas. Intenta de nuevo.'); }
}

// ---------------------------------------------------------------- Agente Portalfirma
// Un paso del agente: el modelo responde con texto o pide herramientas (function calling).
// Mensajes en formato OpenAI: {role:'user'|'assistant'|'tool', content, tool_calls?, tool_call_id?}.
// Modelo: el «mini» más nuevo de la cuenta (encadena herramientas de forma confiable a bajo costo).
let agentModelCache = '';
async function agentModel() {
  if (process.env.PF_AGENT_MODEL) return process.env.PF_AGENT_MODEL;
  const c = config(); const m = managed();
  if (c.agentModel) return c.agentModel; if (m?.agentModel) return m.agentModel;
  if (agentModelCache) return agentModelCache;
  const list = (await models()).filter((x) => !/audio|realtime|transcribe|tts|search|image|codex|embedding|moderation|research|nano/.test(x));
  if (c.provider === 'anthropic') return (agentModelCache = list.filter((x) => /haiku|sonnet/.test(x)).sort((a, b) => verOf(b) - verOf(a))[0] || c.model);
  const cand = list.filter((x) => /^gpt-[\d.]+-mini/.test(x)).sort((a, b) => verOf(b) - verOf(a) || a.length - b.length);
  return (agentModelCache = cand[0] || list.find((x) => /mini/.test(x)) || c.model || 'gpt-4o-mini');
}
// Cobro: 1 token cada 3 mensajes del usuario al agente (se verifica antes y se descuenta al terminar bien)
function agentCheck() { const w = wallet(); const c = (w.agentLeft || 0) > 0 ? 0 : COSTS.agent; if (w.balance < c) { const e = new Error(`No te quedan tokens del asistente (el agente usa 1 token cada 3 mensajes; tienes ${w.balance}).`); e.code = 'NO_TOKENS'; e.data = walletStatus(); throw e; } }
function agentCharge() { const w = wallet(); if ((w.agentLeft || 0) > 0) w.agentLeft -= 1; else { w.balance = Math.max(0, w.balance - COSTS.agent); w.agentLeft = 2; w.log.push({ t: Date.now(), d: -COSTS.agent, what: LABEL.agent }); } saveWallet(w); return walletStatus(); }
async function toolChat({ system, messages, tools }) {
  if (MOCK) return mockAgent(messages);
  const { c, k } = key(); const model = await agentModel();
  if (c.provider === 'anthropic') {
    const am = []; // tool_result consecutivos van en un solo mensaje del usuario
    for (const m of messages) {
      if (m.role === 'tool') { const blk = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }; const last = am[am.length - 1]; if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(blk); else am.push({ role: 'user', content: [blk] }); }
      else if (m.role === 'assistant') am.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...(m.tool_calls || []).map((t) => ({ type: 'tool_use', id: t.id, name: t.function.name, input: JSON.parse(t.function.arguments || '{}') }))] });
      else am.push({ role: 'user', content: m.content });
    }
    const j = await http('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 4000, system, messages: am, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }) });
    const blocks = j.content || [];
    return { model, usage: j.usage, content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
      tool_calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } })) };
  }
  const body = { model, messages: [{ role: 'system', content: system }, ...messages], tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' };
  const reasoning = /gpt-5|gpt-6|^o\d/.test(model) && !/4o|4\.1/.test(model);
  const go = (b) => http('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + k, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  let j;
  try { j = await go(reasoning ? { ...body, reasoning_effort: 'low' } : body); } catch (e) { if (reasoning && /reasoning|unsupported|not supported|unrecognized/i.test(e.message)) j = await go(body); else throw e; }
  const msg = j.choices?.[0]?.message || {};
  return { model, usage: j.usage, content: msg.content || '', tool_calls: msg.tool_calls || [] };
}
// Agente de prueba: guion fijo según el último mensaje (para pruebas automáticas sin proveedor)
function mockAgent(messages) {
  const last = messages[messages.length - 1]; let n = 0; const id = () => 'call_' + Date.now().toString(36) + (n++);
  const call = (name, args) => ({ model: 'modelo-de-prueba', content: '', tool_calls: [{ id: id(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const say = (t) => ({ model: 'modelo-de-prueba', content: t, tool_calls: [] });
  if (last.role === 'user') {
    const t = String(last.content).toLowerCase();
    if (/recarga/.test(t)) return call('wallet_manage_balance_tools', { action: 'add_amount_flow', amount: 10000, email: 'pagos@ejemplo.cl' });
    if (/saldo/.test(t)) return call('wallet_manage_balance_tools', { action: 'get_balance' });
    const op = t.match(/operaci[oó]n\s*(\d+)/); if (op) return call('process_detail_get_by_operation', { operation: Number(op[1]) });
    if (/env[ií]a.*firmar|sube/.test(t)) { const a = /adjunto: «([^»]+)»/i.exec(String(last.content)); return a ? call('ingest_document_tools', { archivo: a[1] }) : say('Adjunta el documento con el clip y lo subo.'); }
    if (/pendientes|cds/.test(t)) return call('sign_documents_cds_massive_tools', { action: 'list_pending', rut: '11.111.111-1' });
    if (/plantilla/.test(t)) return call('template_manage_tools', { action: 'search', query: 'mandato' });
    return say('Hola, soy el agente de Portalfirma. Puedo consultar operaciones, enviar documentos a firmar, usar plantillas y más.');
  }
  if (last.role === 'tool') {
    const prev = messages.slice().reverse().find((m) => m.role === 'assistant' && m.tool_calls?.length); const name = prev.tool_calls[0].function.name; const args = JSON.parse(prev.tool_calls[0].function.arguments);
    let r = {}; try { r = JSON.parse(last.content); } catch {}
    if (/cancel/i.test(last.content)) return say('Entendido: no hice nada.');
    if (name === 'ingest_document_tools' && r.fileId) return call('extract_signers_document_tools', { document_id: r.fileId });
    if (name === 'extract_signers_document_tools') return call('send_to_sign_document_tools', { document_id: args.document_id, email: 'pagos@ejemplo.cl', protocolization: 'none', signatories: (r.firmantes || []).map((f) => ({ rut: f.rut, fullName: f.fullName, alias: f.alias, email: 'a@b.cl', phone: '+56912345678' })) });
    if (name === 'sign_documents_cds_massive_tools' && args.action === 'list_pending') return call('sign_documents_cds_massive_tools', { action: 'request_sign_code', rut: args.rut, operations: (r.operations || []).map((o) => o.operation) });
    if (name === 'sign_documents_cds_massive_tools' && args.action === 'request_sign_code') return call('sign_documents_cds_massive_tools', { action: 'sign_documents', rut: args.rut, operations: args.operations });
    if (name === 'wallet_manage_balance_tools' && r.amount != null && !r.url) return say(`Tu saldo es de $${Number(r.amount).toLocaleString('es-CL')}.`);
    if (r.url) return say(`Listo. Paga aquí: ${r.url}`);
    if (r.operation) return say(`Listo: operación ${r.operation}. ${r.message || ''}`.trim());
    return say('Listo. Resultado: ' + String(last.content).slice(0, 200));
  }
  return say('¿En qué te ayudo?');
}

// Respuestas de prueba (modo demostración y pruebas automáticas)
function mockReply({ messages, json }) {
  if (/^PROPONER_REGLAS/.test(String(messages[messages.length - 1].content))) {
    const casos = JSON.parse(/Casos \(JSON\):\n([\s\S]*?)\nDevuelve/.exec(messages[messages.length - 1].content)[1]);
    const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const out = []; const vistos = new Set();
    for (const c of casos) {
      for (const a of c.agregados || []) {
        const w = fold(a.frase).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 4);
        const key = 'a:' + (a.codigo || a.nombre); if (w.length < 2 || vistos.has(key)) continue; vistos.add(key);
        out.push({ tipo: 'acto', nombre: a.nombre, codigo: a.codigo || null, patron: '\\b' + w.join('\\s+') + '\\b', incluido: null, principal: false, explicacion: `El cliente agregó «${a.nombre}» y el escrito lo expresa como «${a.frase}».`, casos: [c.id] });
      }
      if (c.materiaAuto && c.materiaFinal && c.materiaAuto !== c.materiaFinal && c.titulo) {
        const w = fold(c.titulo).replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter((x) => x.length > 3).slice(0, 2);
        const key = 'm:' + c.materiaFinal; if (!w.length || vistos.has(key)) continue; vistos.add(key);
        out.push({ tipo: 'materia', materia: c.materiaFinal, campo: 'titulo', patron: '\\b' + w.join('\\b.*\\b') + '\\b', explicacion: `Escritos titulados «${c.titulo}» se clasificaban mal; el cliente eligió otra materia.`, casos: [c.id] });
      }
    }
    out.push({ tipo: 'acto', nombre: 'Regla inválida de prueba', patron: '(sin cerrar', explicacion: 'Debe rechazarse por no compilar.', casos: [] });
    return { model: 'modelo-de-prueba', usage: { prompt_tokens: 3100, completion_tokens: 420 }, text: JSON.stringify({ propuestas: out }) };
  }
  if (/^LEER_DOCUMENTO/.test(String(messages[messages.length - 1].content))) {
    const pg = Number((String(messages[messages.length - 1].content).match(/páginas (\d+)/) || [])[1]) || 1;
    return { model: 'modelo-de-prueba', usage: { prompt_tokens: 2400, completion_tokens: 900 }, text: JSON.stringify(pg === 1 ? {
      titulo: 'CONTRATO DE PRENDA SIN DESPLAZAMIENTO', tipo: 'Contrato de prenda sin desplazamiento', fecha: '2023-01-19',
      participantes: [{ nombre: 'PRINTWORK SPA', rut: '77.120.447-3', rol: 'constituyente' }, { nombre: 'FORUM SERVICIOS FINANCIEROS S.A.', rut: '96.678.790-2', rol: 'acreedor' }, { nombre: 'MACARENA ANDREA DURAN QUIJADA', rut: '16.257.258-K', rol: 'representante' }],
      firmas: [{ nombre: 'MACARENA ANDREA DURAN QUIJADA', tipo: 'electronica', fecha: '2023-01-23' }], patente: 'SKDD91-7',
      texto: 'CONTRATO DE PRENDA SIN DESPLAZAMIENTO\n\nEN SANTIAGO DE CHILE, a 19 de Enero de 2023, comparecen: FORUM SERVICIOS FINANCIEROS S.A., representada por MACARENA ANDREA DURAN QUIJADA; y PRINTWORK SPA.\n\nPRIMERO: Bien de propiedad del constituyente. PRINTWORK SPA es dueño del vehículo placa patente SKDD91-7.\n\n(Hay firma electrónica avanzada de MACARENA ANDREA DURAN QUIJADA)', ilegible: [] }
      : { titulo: null, tipo: null, fecha: null, participantes: [], firmas: [{ nombre: null, tipo: 'manuscrita', fecha: null }], patente: null, texto: 'SEGUNDO: Prenda sin desplazamiento. El constituyente constituye prenda a favor del acreedor.\n\n(Hay firma)', ilegible: [] }) };
  }
  const last = String(messages.at(-1)?.content || '');
  if (json && /REVISAR/.test(last)) {
    const m = /comparecen:([^\n]*)/.exec(last);
    return { model: 'modelo-de-prueba', text: JSON.stringify({
      resumen: 'Contrato de prestación de servicios entre dos personas naturales, con un precio mensual.',
      observaciones: [
        { tipo: 'redaccion', gravedad: 'media', cita: 'servicios de asesoria al CLIENTE', sugerencia: 'servicios de asesoría al CLIENTE', explicacion: '«asesoría» lleva tilde.' },
        { tipo: 'redaccion', gravedad: 'baja', cita: 'El precio sera de', sugerencia: 'El precio será de', explicacion: '«será» lleva tilde.' },
        { tipo: 'falta', gravedad: 'alta', cita: null, sugerencia: null, explicacion: 'No se indica la duración del contrato ni cómo se pone término. Según el artículo 1545 del Código Civil, el contrato es ley para las partes: conviene fijar plazo y término.' },
        { tipo: 'riesgo', gravedad: 'media', cita: 'mensuales', sugerencia: null, explicacion: `No se indica fecha ni forma de pago.${m ? '' : ''}` },
      ] }) };
  }
  if (json && /^VARIABLES/.test(last)) return { model: 'modelo-de-prueba', text: JSON.stringify({ campos: [
    { etiqueta: 'Cliente: nombre', tipo: 'texto', apariciones: ['MARIA GONZALEZ ROJAS'], firmante: { rol: 'Cliente', dato: 'fullName' } },
    { etiqueta: 'Cliente: RUT', tipo: 'rut', apariciones: ['22.222.222-2'], firmante: { rol: 'Cliente', dato: 'rut' } },
    { etiqueta: 'Prestador: nombre', tipo: 'texto', apariciones: ['JUAN PEREZ SOTO'], firmante: { rol: 'Prestador', dato: 'fullName' } },
    { etiqueta: 'Prestador: RUT', tipo: 'rut', apariciones: ['11.111.111-1'], firmante: { rol: 'Prestador', dato: 'rut' } },
    { etiqueta: 'Fecha del contrato', tipo: 'fecha', apariciones: ['2 de octubre de 2026'], firmante: null },
    { etiqueta: 'Ciudad', tipo: 'texto', apariciones: ['Santiago'], firmante: null },
    { etiqueta: 'Precio mensual', tipo: 'monto', apariciones: ['$500.000'], firmante: null },
    { etiqueta: 'Inventado', tipo: 'texto', apariciones: ['TEXTO QUE NO EXISTE'], firmante: null },
  ] }) };
  if (json && /^PLAZOS/.test(last)) {
    const name = /Archivo: (.*)/.exec(last)?.[1] || ''; const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const partes = [{ rol: 'Arrendador', nombre: 'Juan Pérez Soto', rut: '11.111.111-1', domicilio: 'Av. Italia 1000, Providencia' }, { rol: 'Arrendatario', nombre: 'María González Rojas', rut: '22.222.222-2', domicilio: 'Los Leones 200, Providencia' }];
    const base = { tipo: 'Contrato de arrendamiento', partes, objeto: 'Arriendo del departamento ubicado en Av. Providencia 1234, depto 501, Providencia', monto: '$650.000 mensuales', fecha_inicio: day(-345), moneda: 'CLP' };
    let r;
    if (/vence/i.test(name)) r = { ...base, indefinido: false, plazo: '12 meses', fecha_termino: day(20), renovacion_automatica: true, periodo_renovacion_meses: 12, aviso_dias: 60, reajuste: { tipo: 'IPC', periodicidad_meses: 12, proxima_fecha: day(20) },
      resumen: 'Arriendo por 12 meses con renovación automática; para no renovar hay que avisar con 60 días de anticipación.', acciones: [{ tipo: 'aviso_no_renovacion', titulo: 'Carta de aviso de no renovación', motivo: 'El plazo para avisar ya pasó o está por pasar: si no se avisa, el contrato se renueva por 12 meses.', urgente: true }, { tipo: 'reajuste', titulo: 'Anexo de reajuste de renta por IPC', motivo: 'La renta se reajusta anualmente según el IPC.' }] };
    else if (/anual|servicio/i.test(name)) r = { ...base, tipo: 'Contrato de prestación de servicios', objeto: 'Servicios de asesoría contable mensual', monto: '$500.000 mensuales', indefinido: false, plazo: '1 año', fecha_termino: day(75), renovacion_automatica: false, aviso_dias: 30, reajuste: null,
      resumen: 'Servicios por 1 año sin renovación automática.', acciones: [{ tipo: 'renovacion', titulo: 'Anexo de renovación del contrato', motivo: 'Si quieren seguir, conviene renovar antes del término.' }, { tipo: 'termino_anticipado', titulo: 'Carta de término anticipado', motivo: 'Si no desean continuar, pueden ponerle término con 30 días de aviso.' }] };
    else r = { ...base, tipo: 'Contrato de prestación de servicios', indefinido: true, plazo: 'indefinido', fecha_termino: null, renovacion_automatica: false, aviso_dias: null, reajuste: null,
      resumen: 'Contrato de duración indefinida, sin fechas de término.', acciones: [{ tipo: 'ninguna', titulo: 'Déjalo así', motivo: 'Es de duración indefinida: no hay un plazo que se pueda pasar.' }] };
    return { model: 'modelo-de-prueba', text: JSON.stringify(r) };
  }
  if (/^MODIFICAR/.test(last)) {
    const cur = JSON.parse(/<<<JSON\n([\s\S]*?)\nJSON>>>/.exec(last)[1]);
    const n = (cur.cuerpo.match(/^\*\*[A-ZÁÉÍÓÚ]+:/gm) || []).length;
    return { model: 'modelo-de-prueba', text: JSON.stringify({ bloqueado: null, resumen_cambio: 'Se agregó una cláusula de codeudor solidario.', titulo: cur.titulo,
      cuerpo: cur.cuerpo + `\n\n**${['', 'PRIMERO', 'SEGUNDO', 'TERCERO', 'CUARTO', 'QUINTO', 'SEXTO', 'SÉPTIMO'][n + 1] || 'OCTAVO'}: Codeudor solidario.** Comparece también don [[Codeudor: nombre]], cédula de identidad N° [[Codeudor: RUT]], quien se constituye en fiador y codeudor solidario de todas las obligaciones del Arrendatario, en los términos de los artículos 1511 y siguientes del Código Civil.`,
      campos: [...cur.campos, { etiqueta: 'Codeudor: nombre', tipo: 'texto', firmante: { rol: 'Codeudor', dato: 'fullName' } }, { etiqueta: 'Codeudor: RUT', tipo: 'rut', firmante: { rol: 'Codeudor', dato: 'rut' } }, { etiqueta: 'Codeudor: correo', tipo: 'email', firmante: { rol: 'Codeudor', dato: 'email' }, solo_formulario: true }] }) };
  }
  if (/^REDACTAR/.test(last)) return { model: 'modelo-de-prueba', text: JSON.stringify({ bloqueado: null, titulo: 'CONTRATO DE ARRENDAMIENTO DE OFICINA',
    cuerpo: 'En [[Ciudad]], a [[Fecha del contrato]], comparecen: don [[Arrendador: nombre]], cédula de identidad N° [[Arrendador: RUT]], con domicilio en [[Arrendador: domicilio]], en adelante «el Arrendador»; y don [[Arrendatario: nombre]], cédula de identidad N° [[Arrendatario: RUT]], en adelante «el Arrendatario»; los comparecientes mayores de edad, quienes exponen:\n\n**PRIMERO: Objeto.** El Arrendador da en arrendamiento al Arrendatario la oficina ubicada en [[Dirección de la oficina]].\n\n**SEGUNDO: Plazo.** El arrendamiento comenzará el [[Fecha de inicio]] y tendrá una duración de doce meses.\n\n**TERCERO: Renta.** La renta mensual será de [[Renta mensual]], reajustable anualmente según la variación del IPC.\n\n**CUARTO: Garantía.** El Arrendatario entrega en este acto una garantía equivalente a un mes de renta.\n\n**QUINTO: Domicilio.** Para todos los efectos legales, las partes fijan su domicilio en la comuna de [[Ciudad]] y se someten a la competencia de sus Tribunales Ordinarios de Justicia.\n\nArrendador: ________________',
    campos: [
      { etiqueta: 'Ciudad', tipo: 'texto', valor: 'Santiago' }, { etiqueta: 'Fecha del contrato', tipo: 'fecha' },
      { etiqueta: 'Arrendador: nombre', tipo: 'texto', firmante: { rol: 'Arrendador', dato: 'fullName' } }, { etiqueta: 'Arrendador: RUT', tipo: 'rut', firmante: { rol: 'Arrendador', dato: 'rut' } },
      { etiqueta: 'Arrendador: domicilio', tipo: 'texto' }, { etiqueta: 'Arrendatario: nombre', tipo: 'texto', firmante: { rol: 'Arrendatario', dato: 'fullName' } },
      { etiqueta: 'Arrendatario: RUT', tipo: 'rut', firmante: { rol: 'Arrendatario', dato: 'rut' } }, { etiqueta: 'Dirección de la oficina', tipo: 'texto' },
      { etiqueta: 'Fecha de inicio', tipo: 'fecha' }, { etiqueta: 'Renta mensual', tipo: 'monto', valor: '800000' },
      { etiqueta: 'Arrendador: correo', tipo: 'email', firmante: { rol: 'Arrendador', dato: 'email' }, solo_formulario: true },
      { etiqueta: 'Arrendatario: correo', tipo: 'email', firmante: { rol: 'Arrendatario', dato: 'email' }, solo_formulario: true },
      { etiqueta: 'Sobra', tipo: 'texto' }] }) };
  return { model: 'modelo-de-prueba', text: 'Según el documento, el precio mensual es de $500.000. No se indica la fecha de pago (revisar con las partes).' };
}

module.exports = { toolChat, agentModel, agentCheck, agentCharge, MASK, walletStatus, redeem, status, setConfig, models, chat, leerDocumento, proponerReglas, docModel, PROVIDERS };
