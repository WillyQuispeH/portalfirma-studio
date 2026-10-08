// Agente Portalfirma: conversa con el usuario y usa TODAS las herramientas del MCP de Portalfirma
// (las que publique el servidor, incluidas las que se agreguen en el futuro) a través de la sesión OAuth de Studio.
//
// Reglas de seguridad (se cumplen aquí, no dependen del modelo):
//  · Las consultas corren solas. Lo que cobra, envía o notifica espera la confirmación del usuario en Studio.
//  · La clave del certificado CDS y el código SMS/WhatsApp nunca pasan por el modelo: el usuario los escribe en
//    un campo protegido de la tarjeta de confirmación y Studio los entrega directo a Portalfirma. No se guardan.
//  · Los documentos no viajan al modelo: el usuario los adjunta y Studio los sube con ingest_document_tools.
//  · Cada acción queda en el registro de actividad (sin datos sensibles).
const store = require('./store');

const MAX_STEPS = 14; const MAX_RESULT = 14000;
const SECRETS = ['clave_certificado', 'segundo_factor'];
// Herramientas (o acciones) de solo lectura: corren sin preguntar
const READ_TOOLS = new Set(['get_partner_session', 'search_document_content', 'extract_signers_document_tools', 'process_detail_get_by_operation', 'operation_get_operation_by_rut', 'operation_get_operation_by_phone', 'property_manage_tools']);
const READ_ACTIONS = { wallet_manage_balance_tools: ['get_balance'], template_manage_tools: ['search', 'get_forms'], sign_documents_cds_massive_tools: ['list_pending'] };
const NO_CONFIRM = new Set(['ingest_document_tools']); // subir un documento adjuntado por el usuario no cobra ni envía

function needsConfirm(name, args, tool) {
  if (READ_TOOLS.has(name) || NO_CONFIRM.has(name)) return false;
  if (READ_ACTIONS[name]) return !READ_ACTIONS[name].includes(args.action);
  return !(tool?.annotations?.readOnlyHint === true); // herramienta nueva: se confirma salvo que el servidor diga que es de lectura
}
const secretsFor = (name, args) => (name === 'sign_documents_cds_massive_tools' ? (args.action === 'sign_documents' ? SECRETS : args.action === 'request_sign_code' ? ['clave_certificado'] : []) : []);

// Texto humano de cada acción (tarjeta de confirmación y registro)
const clp = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
function describe(name, a) {
  const firm = (l) => (l || []).map((s) => `${s.fullName || s.rut}${s.alias ? ` (${s.alias})` : ''}${s.email ? ' · ' + s.email : ''}${s.phone ? ' · ' + s.phone : ''}`);
  switch (name) {
    case 'send_to_sign_document_tools': return { titulo: 'Enviar el documento a firmar', detalle: [`Pagador: ${a.email || '—'}`, `Trámite: ${a.document_config_id ? 'según el tipo de documento' : ({ none: 'sin trámite notarial', legalization: 'legalización', protocolization: 'protocolización' }[a.protocolization] || '—')}`, ...(a.code ? [`Código de descuento: ${a.code}`] : []), 'Firmantes (en este orden):', ...firm(a.signatories)], aviso: 'Se crea la operación, se genera el cobro y los firmantes reciben el enlace.' };
    case 'template_manage_tools': return { titulo: 'Generar el documento desde la plantilla y enviarlo a firmar', detalle: Object.entries(a.values || {}).slice(0, 30).map(([k, v]) => `${k}: ${v}`), aviso: 'Se cobra del saldo de la cuenta y se envía a los firmantes.' };
    case 'wallet_manage_balance_tools': return { titulo: `Recargar saldo por ${clp(a.amount)}`, detalle: [`Correo: ${a.email || '—'}`], aviso: 'Se genera un enlace de pago en Flow; el cobro ocurre solo si pagas.' };
    case 'operation_manage_signing_tools': return a.action === 'resend_signatory_to_sign' ? { titulo: 'Reenviar el enlace de firma', detalle: [`Contrato: ${a.contract_id}`, `Firmante: ${a.contractSignatoryId}`], aviso: 'El firmante recibe un nuevo correo.' }
      : a.action === 'update_signatory_data' ? { titulo: 'Cambiar el correo del firmante', detalle: [`Persona: ${a.person_id}`, `Nuevo correo: ${a.email}`] }
        : { titulo: `Cambiar el tipo de firma a «${a.typeSign}»`, detalle: [`Contrato: ${a.contract_id}`, `Firmante: ${a.contractSignatoryId}`] };
    case 'sign_documents_cds_massive_tools': return a.action === 'request_sign_code' ? { titulo: 'Pedir el código para firmar con el certificado', detalle: [`RUT: ${a.rut}`, `Operaciones: ${(a.operations || []).join(', ')}`], aviso: 'Se valida tu certificado y llega un código por SMS o WhatsApp.' }
      : { titulo: `Firmar ${(a.operations || []).length} operaciones con tu certificado`, detalle: [`RUT: ${a.rut}`, `Operaciones: ${(a.operations || []).join(', ')}`], aviso: 'La firma es definitiva y puede descontar saldo según la tarifa.' };
    default: return { titulo: `Ejecutar «${name}»`, detalle: Object.entries(a).filter(([k]) => !SECRETS.includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`) };
  }
}

// Esquemas para el modelo: sin campos secretos y con la subida de documentos por nombre de adjunto
function forModel(t) {
  const p = JSON.parse(JSON.stringify(t.inputSchema || { type: 'object', properties: {} })); delete p.$schema;
  let description = t.description || '';
  if (t.name === 'ingest_document_tools') {
    return { name: t.name, description: 'Sube a Portalfirma un documento que el usuario adjuntó en Studio (PDF o Word) y devuelve su id (fileId) para extraer firmantes, buscar en él o enviarlo a firmar. Indica el nombre exacto del adjunto.', parameters: { type: 'object', properties: { archivo: { type: 'string', description: 'Nombre exacto del archivo adjunto.' }, ...(p.properties?.folder_id ? { folder_id: p.properties.folder_id } : {}) }, required: ['archivo'] } };
  }
  if (p.properties) for (const k of SECRETS) if (p.properties[k]) { delete p.properties[k]; p.required = (p.required || []).filter((x) => x !== k); description += ` La clave del certificado y el código SMS NO los envías tú: Studio se los pide al usuario en un campo protegido al confirmar.`; }
  return { name: t.name, description: description.slice(0, 1000), parameters: p };
}

function systemPrompt(ctx) {
  const hoy = new Date(); const iso = hoy.toISOString().slice(0, 10);
  return `Eres el Agente de Portalfirma dentro de PortalFirma Studio. Ayudas a la empresa del usuario con firma electrónica en Chile: subir documentos, extraer firmantes, enviar a firmar, consultar operaciones, reenviar enlaces, plantillas notariales, propiedades, saldo y firma masiva con certificado CDS.
Hoy es ${iso}. Escribe en español de Chile, breve y claro.
Reglas:
- Usa las herramientas para obtener datos reales. Nunca inventes ids (document_id, fileId, template_version_id, contract_id, operation, property_id): cópialos de resultados anteriores.
- Para buscar operaciones usa rangos de fechas de máximo 366 días (por defecto, los últimos 90 días hasta hoy).
- Documentos: no puedes leer archivos del computador. El usuario adjunta archivos en Studio; luego usas ingest_document_tools con el nombre del adjunto.${ctx.adjuntos.length ? ` Adjuntos disponibles: ${ctx.adjuntos.map((a) => `«${a.name}»${a.fileId ? ` (ya subido, fileId ${a.fileId})` : ''}`).join(', ')}.` : ' Ahora no hay adjuntos.'}
- Antes de enviar a firmar, confirma con el usuario los datos que falten (correo, teléfono, tipo de firma, trámite) según missing_fields; no los inventes.
- Studio pide confirmación al usuario antes de cualquier acción que cobre, envíe o notifique. Arma la llamada completa y correcta; si el usuario la cancela, no la repitas sin que te lo pida.
- Firma con certificado CDS: nunca pidas ni repitas la clave del certificado ni el código SMS por el chat; Studio los pide en un campo protegido. Si el usuario los escribe en el chat, dile que no lo haga y que use el campo.
- Muestra los enlaces de pago o de firma tal como vienen.${ctx.email ? `\n- El correo del usuario (pagador por defecto) es ${ctx.email}.` : ''}`;
}

// ---------------------------------------------------------------- sesión de conversación
function crear({ pf, ai, emit }) {
  const S = { messages: [], adjuntos: [], tools: null, pend: new Map(), busy: false };
  const log = (e) => { const l = store.get('agentLog') || []; l.unshift({ t: new Date().toISOString(), ...e }); store.set('agentLog', l.slice(0, 300)); };
  async function herramientas() { if (!S.tools) S.tools = await pf.listTools(); return S.tools; }
  function esperar(id) { return new Promise((resolve) => S.pend.set(id, resolve)); }
  function responder(id, r) { const f = S.pend.get(id); if (!f) return false; S.pend.delete(id); f(r || { ok: false }); return true; }

  async function ejecutar(tc, toolsByName) {
    const name = tc.function.name; let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
    const tool = toolsByName[name];
    if (!tool) return { content: JSON.stringify({ error: `La herramienta «${name}» no existe.` }) };
    for (const k of SECRETS) delete args[k]; // aunque el modelo los mande, no se usan
    const id = tc.id || ('t' + Date.now());
    emit({ type: 'tool', id, name, args, estado: 'corriendo' });
    // subida del adjunto: Studio pone los bytes
    if (name === 'ingest_document_tools') {
      const a = S.adjuntos.find((x) => x.name === args.archivo) || (S.adjuntos.length === 1 ? S.adjuntos[0] : null);
      if (!a) { emit({ type: 'tool', id, name, estado: 'error', resumen: 'No hay un adjunto con ese nombre' }); return { content: JSON.stringify({ error: `No hay un adjunto llamado «${args.archivo}». Pide al usuario que lo adjunte.` }) }; }
      const real = { source: 'base64', base64: Buffer.from(a.bytes).toString('base64'), filename: a.name, ...(args.folder_id ? { folder_id: args.folder_id } : {}) };
      const r = await pf.callRaw(name, real);
      try { const j = JSON.parse(r.text); a.fileId = j.fileId || j.document_id || a.fileId; } catch {}
      log({ tool: name, ok: !r.isError, resumen: `Subió «${a.name}»` });
      emit({ type: 'tool', id, name, estado: r.isError ? 'error' : 'ok', resumen: r.isError ? r.text.slice(0, 200) : `Subido: ${a.name}` });
      return { content: r.text.slice(0, MAX_RESULT) };
    }
    let secretos = {};
    if (needsConfirm(name, args, tool)) {
      const pide = secretsFor(name, args);
      emit({ type: 'confirm', id, name, args, ...describe(name, args), secretos: pide });
      const r = await esperar(id);
      if (!r.ok) { log({ tool: name, action: args.action, ok: false, resumen: 'Cancelado por el usuario' }); emit({ type: 'tool', id, name, estado: 'cancelado' }); return { content: JSON.stringify({ cancelado: true, mensaje: 'El usuario canceló esta acción.' }) }; }
      for (const k of pide) { if (!r.secretos?.[k]) { emit({ type: 'tool', id, name, estado: 'cancelado' }); return { content: JSON.stringify({ cancelado: true, mensaje: 'Faltó un dato protegido.' }) }; } secretos[k] = String(r.secretos[k]); }
    }
    const res = await pf.callRaw(name, { ...args, ...secretos });
    let text = res.text; for (const v of Object.values(secretos)) if (v) text = text.split(v).join('••••'); secretos = null;
    const d = describe(name, args);
    log({ tool: name, action: args.action, ok: !res.isError, resumen: res.isError ? 'Error: ' + text.slice(0, 160) : (needsConfirm(name, args, tool) ? d.titulo : 'Consulta') });
    emit({ type: 'tool', id, name, estado: res.isError ? 'error' : 'ok', resumen: res.isError ? text.slice(0, 240) : '' , url: (text.match(/https:\/\/[^\s"']+/) || [])[0] || null });
    return { content: text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) + '\n…(resultado recortado)' : text };
  }

  async function enviar(texto, ctx = {}) {
    if (S.busy) throw new Error('El agente todavía está trabajando en el mensaje anterior.');
    S.busy = true;
    try {
      ai.agentCheck();
      const all = await herramientas(); const byName = Object.fromEntries(all.map((t) => [t.name, t])); const tools = all.map(forModel);
      const nuevos = S.adjuntos.filter((a) => !a.anunciado); nuevos.forEach((a) => (a.anunciado = true));
      S.messages.push({ role: 'user', content: String(texto) + (nuevos.length ? `\n(Adjunto: ${nuevos.map((a) => `«${a.name}»`).join(', ')})` : '') });
      let final = '';
      for (let i = 0; i < MAX_STEPS; i++) {
        const r = await ai.toolChat({ system: systemPrompt({ adjuntos: S.adjuntos, email: ctx.email }), messages: S.messages, tools });
        const calls = (r.tool_calls || []).slice(0, 6);
        S.messages.push({ role: 'assistant', content: r.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
        if (r.content && calls.length) emit({ type: 'nota', text: r.content });
        if (!calls.length) { final = r.content || ''; break; }
        for (const tc of calls) { const out = await ejecutar(tc, byName); S.messages.push({ role: 'tool', tool_call_id: tc.id, content: out.content }); }
        if (i === MAX_STEPS - 1) final = 'Me detuve porque la tarea necesitaba demasiados pasos. Dime cómo seguir.';
      }
      // la conversación no crece sin límite: se conservan los últimos ~40 mensajes, sin cortar una llamada de su resultado
      if (S.messages.length > 60) { let k = S.messages.length - 40; while (k < S.messages.length && S.messages[k].role !== 'user') k++; S.messages = S.messages.slice(k); }
      const tokens = ai.agentCharge();
      return { text: final, tokens };
    } finally { S.busy = false; for (const [id] of S.pend) responder(id, { ok: false }); }
  }
  return {
    enviar, responder,
    adjuntar(name, bytes) { if (bytes.length > 20 * 1024 * 1024) throw new Error('El archivo supera los 20 MB que acepta Portalfirma.'); if (!/\.(pdf|docx?)$/i.test(name)) throw new Error('Adjunta un PDF o un Word.'); S.adjuntos = S.adjuntos.filter((a) => a.name !== name); S.adjuntos.push({ name, bytes: Buffer.from(bytes) }); return S.adjuntos.map((a) => ({ name: a.name, size: a.bytes.length, subido: !!a.fileId })); },
    quitar(name) { S.adjuntos = S.adjuntos.filter((a) => a.name !== name); return S.adjuntos.map((a) => ({ name: a.name, size: a.bytes.length, subido: !!a.fileId })); },
    reiniciar() { S.messages = []; S.adjuntos = []; S.tools = null; return true; },
    async herramientas() { return (await herramientas()).map((t) => ({ name: t.name, description: t.description, lectura: !needsConfirm(t.name, {}, t) || !!READ_ACTIONS[t.name] })); },
    actividad: () => (store.get('agentLog') || []).slice(0, 100),
    _estado: () => S,
  };
}

module.exports = { crear, needsConfirm, forModel, describe, _secretsFor: secretsFor };
