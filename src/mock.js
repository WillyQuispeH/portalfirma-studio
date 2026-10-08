// Modo demostración (PF_MOCK=1): respuestas con la misma forma que el conector real,
// para probar la interfaz sin iniciar sesión ni generar cobros.
let logged = process.env.PF_MOCK_LOGGED === '1';
let op = 90000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const partner = { entity_id: 'demo-entity', user_id: 'demo-user', person_id: 'demo-person', source: 'oauth' };
const ops = {};
let mockKey = ''; const getByIdCalls = [];

// Operaciones de ejemplo para «Mis operaciones»
const DEMO_NAMES = ['Contrato de arrendamiento.pdf', 'Mandato especial.pdf', 'Contrato de prestación de servicios.pdf', 'Promesa de compraventa.pdf', 'Anexo de contrato.pdf', 'Declaración jurada.pdf'];
function demoOps() {
  const out = []; const now = Date.now(); const stages = ['finalized', 'finalized', 'process', 'finalized', 'starting', 'unPayed', 'finalized', 'process'];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now - i * 9 * 86400000 - 3600000);
    out.push({ operation: 20900 - i * 7, stage: stages[i % stages.length], name: DEMO_NAMES[i % DEMO_NAMES.length], proc: i % 3 === 0 ? 'legalization' : i % 5 === 1 ? 'protocolization' : 'none', created: d.toISOString(), updated: new Date(d.getTime() + 86400000).toISOString() });
  }
  out.push({ operation: 19001, stage: 'finalized', name: 'Contrato antiguo.pdf', proc: 'none', created: new Date(now - 420 * 86400000).toISOString(), updated: new Date(now - 419 * 86400000).toISOString() });
  return out;
}
function demoDetail(o) {
  const fin = o.stage === 'finalized';
  const files = [{ fileName: o.name, fileUrl: 'demo://f/' + o.operation + '/s' }, { fileName: 'original.pdf', fileUrl: 'demo://f/' + o.operation + '/o' }];
  if (!fin) files.splice(0, 1);
  if (fin && o.proc === 'legalization') files.push({ fileName: 'legalized.pdf', fileUrl: 'demo://f/' + o.operation + '/l' });
  if (fin && o.proc === 'protocolization') files.push({ fileName: 'protocolized.pdf', fileUrl: 'demo://f/' + o.operation + '/p' });
  return { processId: 'demo-' + o.operation, operation: o.operation, status: fin ? 'finalized' : 'in_progress', protocolizationNumber: o.proc, repertoireNumber: fin && o.proc !== 'none' ? '1234-2026' : '',
    createdDateAt: o.created, updatedDateAt: o.updated, files,
    signatories: [
      { personId: 'pa' + o.operation, contractSignatoryId: 'csa', contractEntityPerson_id: 'cepa', rut: '11.111.111-1', name: 'Juan', paternalLastName: 'Pérez', maternalLastName: 'Soto', email: 'juan@correo.cl', phone: '+56911111111', url: 'https://cliente.portalfirma.cl/v?c=demoa' + o.operation, signed: true },
      { personId: 'pb' + o.operation, contractSignatoryId: 'csb', contractEntityPerson_id: 'cepb', rut: '22.222.222-2', name: 'María', paternalLastName: 'González', maternalLastName: 'Rojas', email: 'maria@correo.cl', phone: '+56922222222', url: 'https://cliente.portalfirma.cl/v?c=demob' + o.operation, signed: fin },
    ] };
}

module.exports = {
  DEFAULT_SERVER: 'demo://portalfirma', REDIRECT_URL: 'demo', serverUrl: () => 'demo://portalfirma',
  async login() { await wait(600); logged = true; return { partner, balance: 247424 }; },
  async logout() { logged = false; },
  async tryRestore() { return logged ? { partner, balance: 247424 } : null; },
  async session() { return { partner, balance: 247424 }; },
  async balance() { return 247424; },
  async ingest(_b64, filename) { await wait(700); return { document_id: 'demo-doc-' + Date.now(), name: filename, indexed: true }; },
  async extractSigners() {
    await wait(900);
    return {
      typeDocument: 'Contrato de prestación de servicios',
      summary: 'El prestador se compromete a entregar servicios de asesoría al cliente a cambio de un pago mensual de $500.000.',
      firmantes: [
        { fullName: 'JUAN PEREZ SOTO', rut: '11.111.111-1', email: '', phone: '', alias: 'prestador', isRepresentative: false },
        { fullName: 'MARIA GONZALEZ ROJAS', rut: '22.222.222-2', email: '', phone: '', alias: 'cliente', isRepresentative: false },
      ],
      documentConfig: null, document_config_id: null, type_sign: null, notarial_procedure: null,
      required_fields: { rut: true, alias: true, name: true, email: true, phone: true, idDocument: false },
      missing_fields: [{ index: 0, alias: 'prestador', fields: ['email', 'phone'] }, { index: 1, alias: 'cliente', fields: ['email', 'phone'] }],
      ask_type_sign: true,
    };
  },
  async sendToSign(p) {
    await wait(900);
    if (process.env.PF_MOCK_SEND_500 === '1') return { message: 'Error enviar a firmar: Request failed with status code 500' }; // como responde hoy el servidor real
    const n = ++op;
    ops[n] = {
      processId: 'demo-process-' + n, operation: n, status: 'in_progress', protocolizationNumber: p.protocolization || 'none',
      createdDateAt: new Date().toISOString(), updatedDateAt: new Date().toISOString(),
      signatories: p.signatories.map((s, i) => ({
        personId: 'p' + i, contractSignatoryId: 'cs' + i, contractEntityPerson_id: 'cep' + i, rut: s.rut,
        name: s.fullName, paternalLastName: '', maternalLastName: '', email: s.email, phone: s.phone,
        url: `https://cliente.portalfirma.cl/v?c=demo${n}${i}&h=portalfirma`, signed: false,
      })),
      files: [],
    };
    return { operation: n, message: `Operación ${n} creada y enviada a firmar (demo).` };
  },
  async processDetail(n) { await wait(300); if (ops[n]) return ops[n]; const d = demoOps().find((o) => o.operation === Number(n)); if (!d) throw new Error('Operación no encontrada (demo)'); return demoDetail(d); },
  async manage(a) { await wait(400); return { ok: true, message: `Acción ${a.action} realizada (demo).` }; },
  async byRut() { return { totalInRange: 0, operations: [] }; },
  // Operaciones de la cuenta (modo demostración): varias etapas y trámites
  async byPhone(phone, start, end, limit) {
    await wait(250);
    const all = demoOps().filter((o) => o.created.slice(0, 10) >= start && o.created.slice(0, 10) <= end);
    return { totalInRange: all.length, operations: all.slice(0, limit).map((o) => ({ contract_id: 'c' + o.operation, operation: o.operation, stage: o.stage, document_name: o.name, createdAt: o.created, updatedAt: o.updated })) };
  },
  async cds(a) {
    await wait(400);
    if (a.action === 'list_pending') return { operations: [{ operation: 70001, document_name: 'Contrato de arriendo Depto 21.pdf' }, { operation: 70002, document_name: 'Anexo de contrato.pdf' }, { operation: 70003, document_name: 'Mandato especial.pdf' }] };
    if (a.action === 'request_sign_code') { if (!a.clave_certificado) throw new Error('Falta la clave del certificado'); return { message: 'Código enviado por SMS al +56 9 ****6858' }; }
    if (a.action === 'sign_documents') { if (a.segundo_factor !== '123456') throw new Error('Código incorrecto'); return { signed: a.operations.map((o) => ({ operation: Number(o), ok: true })) }; }
    return {};
  },
  // Servicio oficial de archivos (POST api/file/getById): mismo formato de respuesta y errores
  fileKey() { return process.env.PF_MOCK_NO_KEY === '1' && !mockKey ? '' : (mockKey || 'demo-key'); },
  setFileKey(v) { v = String(v || '').trim(); if (!/^[A-Za-z0-9._-]{4,200}$/.test(v)) throw new Error('El código de acceso no es válido.'); mockKey = v; return true; },
  async fileById(contractId) {
    await wait(150);
    if (!this.fileKey()) { const e = new Error('Falta configurar el acceso al servicio de archivos de Portalfirma.'); e.code = 'NO_FILE_KEY'; throw e; }
    if (process.env.PF_MOCK_FILE_FAIL === '1') { const e = new Error('Portalfirma no entregó el documento: archivo no encontrado.'); e.code = 'FILE_UNAVAILABLE'; throw e; }
    getByIdCalls.push(String(contractId));
    const b = require('fs').readFileSync(require('path').join(__dirname, '..', 'test', 'fixtures', 'contrato_prueba.pdf'));
    const n = String(contractId).replace(/\D+/g, ''); const o = demoOps().find((x) => String(x.operation) === n) || ops[n];
    return { name: o?.name || o?.files?.[0]?.fileName || 'Documento.pdf', bytes: Buffer.concat([b, Buffer.from('\n%' + String(contractId) + '\n')]) };
  },
  _getByIdCalls: () => getByIdCalls,
  async topUp() { return { url: 'https://www.flow.cl' }; },
  // Las 13 herramientas que publica hoy el MCP real (esquemas resumidos)
  async listTools() {
    const o = (props, req = []) => ({ type: 'object', properties: props, required: req });
    const str = { type: 'string' }; const act = (...e) => ({ type: 'string', enum: e });
    return [
      { name: 'get_partner_session', description: 'Contexto de la empresa de la sesión.', inputSchema: o({}), annotations: { readOnlyHint: true } },
      { name: 'ingest_document_tools', description: 'Ingesta PDF/DOCX en base64.', inputSchema: o({ source: str, base64: str, filename: str, folder_id: str }, ['source', 'base64', 'filename']) },
      { name: 'search_document_content', description: 'Búsqueda en un documento subido.', inputSchema: o({ document_id: str, query: str }, ['document_id', 'query']) },
      { name: 'extract_signers_document_tools', description: 'Extrae firmantes.', inputSchema: o({ document_id: str }, ['document_id']) },
      { name: 'send_to_sign_document_tools', description: 'Envía a firmar.', inputSchema: o({ document_id: str, document_config_id: str, email: str, protocolization: act('none', 'legalization', 'protocolization'), code: str, signatories: { type: 'array', items: o({ rut: str, fullName: str, email: str, phone: str, alias: str }, ['rut', 'alias']) } }, ['document_id', 'email', 'signatories']) },
      { name: 'process_detail_get_by_operation', description: 'Detalle de una operación.', inputSchema: o({ operation: { type: 'integer' } }, ['operation']) },
      { name: 'operation_get_operation_by_rut', description: 'Operaciones por RUT.', inputSchema: o({ rut: str, startDate: str, endDate: str, limit: { type: 'integer' } }, ['rut', 'startDate', 'endDate', 'limit']) },
      { name: 'operation_get_operation_by_phone', description: 'Operaciones por teléfono.', inputSchema: o({ phone: str, startDate: str, endDate: str, limit: { type: 'integer' } }, ['phone', 'startDate', 'endDate', 'limit']) },
      { name: 'operation_manage_signing_tools', description: 'Reenviar, actualizar firmante o tipo de firma.', inputSchema: o({ action: act('resend_signatory_to_sign', 'update_signatory_data', 'update_type_signature'), contract_id: str, contractSignatoryId: str, person_id: str, email: str, contractEntityPersonId: str, typeSign: str }, ['action']) },
      { name: 'sign_documents_cds_massive_tools', description: 'Firma masiva CDS.', inputSchema: o({ action: act('list_pending', 'request_sign_code', 'sign_documents'), rut: str, clave_certificado: str, segundo_factor: str, operations: { type: 'array', items: { type: 'integer' } } }, ['action', 'rut']) },
      { name: 'wallet_manage_balance_tools', description: 'Saldo y recarga.', inputSchema: o({ action: act('get_balance', 'add_amount_flow'), amount: { type: 'number' }, email: str }, ['action']) },
      { name: 'template_manage_tools', description: 'Plantillas notariales.', inputSchema: o({ action: act('search', 'get_forms', 'send_sign'), query: str, template_version_id: str, values: { type: 'object' }, property_id: str, top_k: { type: 'integer' } }, ['action']) },
      { name: 'property_manage_tools', description: 'Propiedades de la cuenta.', inputSchema: o({ action: act('search', 'get', 'districts'), id_property: str, search_term: str }, ['action']) },
    ];
  },
  _agentCalls: [],
  async callRaw(name, args) {
    await wait(200); this._agentCalls.push({ name, args: { ...args, ...(args.base64 ? { base64: '[' + args.base64.length + ']' } : {}) } });
    const ok = (j) => ({ text: JSON.stringify(j), isError: false }); const err = (m) => ({ text: m, isError: true });
    switch (name) {
      case 'process_detail_get_by_operation': return ok({ processId: 'demo', operation: Number(args.operation), status: 'in_progress',
        signatories: [{ name: 'Juan Pérez Soto', rut: '11.111.111-1', email: 'demo@correo.cl', signed: true }, { name: 'María González Rojas', rut: '22.222.222-2', signed: false }],
        files: [{ fileName: 'signed.pdf', fileUrl: 'https://cliente.portalfirma.cl/mcp/file?fileId=demo' }] });
      case 'wallet_manage_balance_tools': return args.action === 'add_amount_flow' ? ok({ url: 'https://www.flow.cl/app/web/pay.php?token=demo', amount: args.amount, email: args.email }) : ok({ amount: 247424, history: [] });
      case 'ingest_document_tools': return args.base64 && args.filename ? ok({ fileId: 'demo-file-1', name: args.filename }) : err('Falta base64');
      case 'extract_signers_document_tools': return ok({ typeDocument: 'Contrato', firmantes: [{ rut: '11.111.111-1', fullName: 'JUAN PEREZ SOTO', alias: 'prestador' }, { rut: '22.222.222-2', fullName: 'MARIA GONZALEZ ROJAS', alias: 'cliente' }], missing_fields: [] });
      case 'send_to_sign_document_tools': return ok({ operation: ++op, contractId: 'demo-contract', payment: { url: 'https://www.flow.cl/app/web/pay.php?token=op', amount: 5000 } });
      case 'sign_documents_cds_massive_tools':
        if (args.action === 'list_pending') return ok({ operations: [{ operation: 70001, stage: 'pendiente' }, { operation: 70002, stage: 'pendiente' }] });
        if (args.action === 'request_sign_code') return args.clave_certificado === 'clave-demo' ? ok({ message: 'Código enviado por SMS', status: 'ok', echo: args.clave_certificado }) : err('Clave del certificado incorrecta');
        return args.segundo_factor === '123456' && args.clave_certificado === 'clave-demo' ? ok({ signedCount: args.operations.length, failedCount: 0 }) : err('Código incorrecto');
      case 'template_manage_tools': return ok({ results: [{ template_version_id: 'tpl-mandato', name: 'Mandato especial' }] });
      default: return ok({ ok: true });
    }
  },
  accessToken: () => null,
  async templateSearch(query) {
    await wait(400);
    const base = [
      { template_version_id: 'tpl-vehiculo', name: 'PODER ESPECIAL PARA GESTIÓN DE VEHÍCULO v1', description: 'Documento para trámites automotrices. Incluye facultades para recuperar el auto de aparcaderos municipales y gestionar duplicados de documentos.', url: 'https://www.portalfirma.cl/servicios/notaria-virtual/completar/tpl-vehiculo' },
      { template_version_id: 'tpl-domicilio', name: 'DECLARACIÓN JURADA DE DOMICILIO', description: 'Documento para confirmar oficialmente dónde vives. Ideal para trámites bancarios, comerciales o municipales.' },
      { template_version_id: 'tpl-arriendo', name: 'Contrato de Arriendo Sin codeudor o Aval.', description: 'Contrato íntegro y exhaustivo para arrendamiento de vivienda.' },
    ];
    return base.map((b) => ({ ...b, similarity: 0.6, snippet: query }));
  },
  async templateForms(id) {
    await wait(400);
    const v = (id, label, group, type, input_type) => ({ id, label, name: id, group, type, required: true, synthetic: false, kind: 'text', input_type });
    return { template_version_id: id, name: 'PODER ESPECIAL PARA GESTIÓN DE VEHÍCULO v1', description: 'Documento para trámites automotrices.', requires_property: false, groups: [
      { group: 'documento', type: 'nosigner', variables: [v('ciudad_documento_nosigner', 'CIUDAD', 'documento', 'nosigner', 'text'), v('fecha-documento_documento_nosigner', 'FECHA DOCUMENTO', 'documento', 'nosigner', 'date')] },
      { group: 'mandante', type: 'signer', variables: [v('nombre_mandante_signer', 'Nombre', 'mandante', 'signer', 'text'), v('rut_mandante_signer', 'Rut', 'mandante', 'signer', 'rut'), v('email_mandante_signer', 'Email', 'mandante', 'signer', 'email'), v('telefono_mandante_signer', 'Telefono', 'mandante', 'signer', 'phone'), v('estado-civil_mandante_signer', 'Estado Civil', 'mandante', 'signer', 'select'), v('direccion_mandante_signer', 'Direccion', 'mandante', 'signer', 'address')] },
      { group: 'datos-del-vehiculo', type: 'nosigner', variables: [v('placa-patente_datos-del-vehiculo_nosigner', 'PLACA PATENTE', 'datos-del-vehiculo', 'nosigner', 'text')] },
    ] };
  },
  async templateSend(id, values) {
    await wait(700);
    const n = ++op;
    ops[n] = { processId: 'demo-process-' + n, operation: n, status: 'in_progress', protocolizationNumber: 'none', createdDateAt: new Date().toISOString(),
      signatories: [{ personId: 'p0', contractSignatoryId: 'cs0', contractEntityPerson_id: 'cep0', rut: values.rut_mandante_signer, name: values.nombre_mandante_signer, email: values.email_mandante_signer, phone: values.telefono_mandante_signer, url: 'https://cliente.portalfirma.cl/v?c=demo&h=portalfirma', signed: false }], files: [] };
    return { success: true, operation: n, message: 'Documento generado y enviado a firmar (demo).' };
  },
};
