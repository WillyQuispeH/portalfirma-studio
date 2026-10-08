// ============================================================================
// Catálogo de materias notariales y precios (planilla «Materias y valores» de Portalfirma, 17-08-2026,
// tal como viene en el prototipo de la Red de Notarías). Clasificador de materia y cálculo del cobro.
// Fila: [código, nombre, tipo (E escritura · P protocolización · A ambos), tarifa ('f' fija · 'h' por hoja · 's' sin definir), monto o base, $ por hoja]
// UMD: window.Materias en la app, module.exports en Node (pruebas).
// ============================================================================
(function (root) {
'use strict';
const ROWS = [
  ["aclaracion_y_rectificacion","Aclaración y Rectificación","E","f",18000],
  ["aclaratoria","Aclaratoria","E","f",18000],
  ["acta","Acta","E","f",80000],
  ["acta_asamblea_extraordinaria","Acta Asamblea Extraordinaria","E","f",80000],
  ["acta_asamblea_general","Acta Asamblea General","E","f",80000],
  ["acta_asamblea_general_extraordinaria","Acta Asamblea General Extraordinaria","E","f",80000],
  ["acta_asamblea_general_ordinaria_de_copropietarios","Acta Asamblea General Ordinaria de Copropietarios","E","f",80000],
  ["acta_asamblea_ordinaria","Acta Asamblea Ordinaria","E","f",80000],
  ["acta_asamblea_ordinaria_de_copropietarios","Acta Asamblea Ordinaria de Copropietarios","E","f",80000],
  ["acta_junta_de_accionistas","Acta Junta de Accionistas","E","f",80000],
  ["acta_junta_extraordinaria_de_accionistas","Acta Junta Extraordinaria de Accionistas","E","f",80000],
  ["acta_junta_general_extraordinaria_de_accionistas","Acta Junta General Extraordinaria de Accionistas","E","f",80000],
  ["acta_junta_ordinaria","Acta Junta Ordinaria","E","f",80000],
  ["acta_reunion_extraordinaria_de_directorio","Acta Reunión Extraordinaria de Directorio","E","f",80000],
  ["acuerdo_completo_y_suficiente","Acuerdo Completo y Suficiente","E","f",18000],
  ["acuerdo_completo_y_suficiente_de_divorcio","Acuerdo Completo y Suficiente de Divorcio","E","f",18000],
  ["acuerdo_compromiso_y_obligacion_de_pago","Acuerdo Compromiso y Obligacion de Pago","E","f",18000],
  ["acuerdo_de_accionistas","Acuerdo de Accionistas","E","f",18000],
  ["acuerdo_regulador","Acuerdo Regulador","E","s"],
  ["adjudicacion","Adjudicacion","E","f",80000],
  ["adjudicacion_en_remate","Adjudicacion en Remate","E","f",80000],
  ["alzamiento_de_hipoteca","Alzamiento de Hipoteca","E","f",100000],
  ["alzamiento_de_hipoteca_y_prohibicion","Alzamiento de Hipoteca y Prohibicion","E","f",18000],
  ["alzamiento_de_prenda","Alzamiento de Prenda","E","f",18000],
  ["alzamiento_de_prenda_y_prohibicion","Alzamiento de Prenda y Prohibicion","E","f",18000],
  ["alzamiento_de_prohibicion","Alzamiento de Prohibicion","E","f",18000],
  ["alzamiento_mera_tenencia","Alzamiento Mera Tenencia","E","f",18000],
  ["autorizacion","Autorizacion","E","f",23000],
  ["autorizacion_de_menor","Autorizacion de Menor","E","f",23000],
  ["autorizacion_para_viajar_fuera_del_pais","Autorización para Viajar Fuera del Pais","E","f",23000],
  ["cancelacion","Cancelacion","E","f",18000],
  ["cancelacion_y_alzamiento","Cancelacion y Alzamiento","E","f",35000],
  ["cancelacion_saldo_de_precio","Cancelación Saldo de Precio","E","f",18000],
  ["caucion","Caucion","E","s"],
  ["cese_de_convivencia","Cese de Convivencia","E","f",18000],
  ["cesion_de_contratos_de_promesa_de_compraventa","Cesion de Contratos de Promesa de Compraventa","E","f",25000],
  ["cesion_de_derechos","Cesion de Derechos","E","f",95000],
  ["cesion_de_derechos_hereditarios","Cesion de Derechos Hereditarios","E","f",95000],
  ["cesion_de_nuda_propiedad_y_reserva_de_usufructo","Cesion de Nuda Propiedad y Reserva de Usufructo","E","f",95000],
  ["complementacion","Complementacion","E","f",18000],
  ["complementacion_de_compraventa","Complementacion de Compraventa","E","f",18000],
  ["complementacion_y_rectificacion_de_compraventa","Complementacion y Rectificacion de Compraventa","E","f",18000],
  ["compraventa","Compraventa","E","f",95000],
  ["compraventa_con_subsidio_habitacional","Compraventa con Subsidio Habitacional","E","f",95000],
  ["compraventa_de_acciones","Compraventa de Acciones","E","f",95000],
  ["compraventa_bien_raiz","Compraventa de Bien Inmueble","E","f",95000],
  ["compraventa_de_derechos","Compraventa de Derechos","E","f",95000],
  ["compraventa_de_inmueble","Compraventa de Inmueble","E","f",95000],
  ["compraventa_en_remate","Compraventa en Remate","E","f",95000],
  ["compraventa_y_alzamiento","Compraventa y Alzamiento","E","f",95000],
  ["compraventa_y_constitucion_de_servidumbre_de_transito","Compraventa y Constitucion de Servidumbre de Tránsito","E","f",95000],
  ["compraventa_y_usufructo","Compraventa y Usufructo","E","f",95000],
  ["constitucion_sociedad","Constitución de Sociedad (SPA, Limitada, EIRL u otra)","E","f",100000],
  ["contrato","Contrato","E","f",23000],
  ["contrato_de_compraventa_vehiculo","Contrato de Compraventa Vehiculo","E","f",23000],
  ["contrato_de_promesa_de_compraventa","Contrato de Promesa de Compraventa","E","f",25000],
  ["dacion_en_pago_escritura_publica","Dacion en Pago Escritura Publica","E","f",18000],
  ["declaracion","Declaracion","E","f",18000],
  ["declaracion_jurada","Declaracion Jurada","E","f",18000],
  ["delegacion_de_facultades","Delegacion de Facultades","E","f",18000],
  ["desistimiento_pago_renuncia_y_finiquito","Desistimiento, Pago, Renuncia y Finiquito","E","f",18000],
  ["donacion","Donacion","E","s"],
  ["escritura_de_rectificacion","Escritura de Rectificacion","E","f",18000],
  ["garantia","Garantia","E","f",23000],
  ["hipoteca","Hipoteca","E","f",23000],
  ["junta_de_accionistas","Junta de Accionistas","E","f",18000],
  ["junta_extraordinaria_de_accionistas","Junta Extraordinaria de Accionistas","E","f",18000],
  ["liquidacion_y_adjudicacion_de_comunidad_hereditaria","Liquidación y Adjudicación de Comunidad Hereditaria","E","s"],
  ["mandato","Mandato","E","f",18000],
  ["mandato_especial_y_judicial","Mandato Especial y Judicial","E","f",18000],
  ["mandato_bancario","Mandato Bancario","E","f",18000],
  ["mandato_especial","Mandato Especial","E","f",18000],
  ["mandato_especial_bancario","Mandato Especial Bancario","E","f",18000],
  ["mandato_especial_con_administracion_y_disposicion_de_bienes","Mandato Especial con Administracion y Disposicion de Bienes","E","f",25000],
  ["mandato_especial_de_compra","Mandato Especial de Compra","E","f",18000],
  ["mandato_especial_de_venta","Mandato Especial de Venta","E","f",18000],
  ["mandato_especial_de_venta_y_administracion","Mandato Especial de Venta y Administracion","E","f",18000],
  ["mandato_general","Mandato General","E","f",28000],
  ["mandato_general_de_administracion","Mandato General de Administracion","E","f",18000],
  ["mandato_judicial","Mandato Judicial","E","f",18000],
  ["mandato_judicial_y_especial","Mandato Judicial y Especial","E","f",18000],
  ["mandato_judicial_y_extrajudicial","Mandato Judicial y Extrajudicial","E","f",18000],
  ["modificacion_de_cuidado_personal","Modificacion de Cuidado Personal","E","f",18000],
  ["modificacion_de_sociedad","Modificacion de Sociedad","E","f",120000],
  ["modificacion_y_transformacion_de_sociedad","Modificacion y Transformacion de Sociedad","E","f",120000],
  ["modificacion_de_sociedad_y_cesion_de_derechos","Modificación de Sociedad y Cesión de Derechos","E","f",120000],
  ["mutacion_de_cuidado_personal","Mutacion de Cuidado Personal","E","f",18000],
  ["particion_de_bienes","Particion de Bienes","E","f",18000],
  ["particion_y_adjudicacion","Particion y Adjudicacion","E","f",18000],
  ["permuta","Permuta","E","s"],
  ["poder_general","Poder General","E","f",18000],
  ["poder_especial","Poder Especial","E","f",18000],
  ["prenda","Prenda","E","f",18000],
  ["prenda_sin_desplazamiento","Prenda sin Desplazamiento","E","f",18000],
  ["promesa_de_cesion_de_derechos","Promesa de Cesion de Derechos","E","h",15000,1000],
  ["promesa_de_compraventa","Promesa de Compraventa","E","h",15000,1000],
  ["prot_junta_extraordinaria_de_accionistas","Prot. Junta Extraordinaria de Accionistas","P","h",15000,1000],
  ["protocolizacion_privado","Protocolización de Documento Privado (genérica)","P","h",15000,1000],
  ["protocolizacion_acta_junta_de_accionistas","Protocolizacion Acta Junta de Accionistas","P","h",15000,1000],
  ["protocolizacion_acta_junta_extraordinaria_accionistas","Protocolizacion Acta Junta Extraordinaria Accionistas","P","h",15000,1000],
  ["protocolizacion_acuerdo_de_accionistas","Protocolizacion Acuerdo de Accionistas","P","h",15000,1000],
  ["protocolizacion_alzamiento_prenda_y_prohibicion","Protocolizacion Alzamiento Prenda y Prohibición","P","s"],
  ["protocolizacion_anotacion_de_sociedad","Protocolizacion Anotacion de Sociedad","P","h",15000,1000],
  ["protocolizacion_bases_de_concurso","Protocolizacion Bases de Concurso","P","h",15000,1000],
  ["protocolizacion_bases_legales","Protocolizacion Bases Legales","P","h",15000,1000],
  ["protocolizacion_certificado_de_accionistas","Protocolizacion Certificado de Accionistas","P","h",15000,1000],
  ["protocolizacion_certificado_de_vigencia_de_accionistas","Protocolizacion Certificado de Vigencia de Accionistas","P","h",15000,1000],
  ["protocolizacion_compraventa_de_acciones","Protocolizacion Compraventa de Acciones","P","h",15000,1000],
  ["protocolizacion_constitucion_de_sociedad","Protocolizacion Constitucion de Sociedad","P","h",15000,1000],
  ["protocolizacion_constitucion_sociedad_por_acciones","Protocolizacion Constitucion Sociedad por Acciones","P","h",15000,1000],
  ["protocolizacion_contrato_de_arrendamiento","Protocolizacion Contrato de Arrendamiento","P","h",15000,1000],
  ["protocolizacion_de_compraventa","Protocolizacion de Compraventa","P","h",15000,1000],
  ["protocolizacion_de_extracto_de_constitucion","Protocolizacion de Extracto de Constitucion","P","h",15000,1000],
  ["protocolizacion_de_inventario_simple_de_bienes","Protocolizacion de Inventario Simple de Bienes","P","h",15000,1000],
  ["protocolizacion_de_promesa_de_compraventa","Protocolizacion de Promesa de Compraventa","P","h",15000,1000],
  ["protocolizacion_decreto","Protocolizacion Decreto","P","h",15000,1000],
  ["protocolizacion_extracto","Protocolizacion Extracto","P","h",15000,1000],
  ["protocolizacion_extracto_soc_por_acciones","Protocolizacion Extracto Soc. por Acciones","P","h",15000,1000],
  ["protocolizacion_inventario","Protocolizacion Inventario","P","h",15000,1000],
  ["protocolizacion_inventario_solemne","Protocolizacion Inventario Solemne","P","h",15000,1000],
  ["protocolizacion_mandato_especial","Protocolizacion Mandato Especial","P","h",15000,1000],
  ["protocolizacion_mandato_judicial","Protocolizacion Mandato Judicial","P","h",15000,1000],
  ["protocolizacion_modificacion_de_sociedad","Protocolizacion Modificacion de Sociedad","P","h",15000,1000],
  ["protocolizacion_poder","Protocolizacion Poder","P","h",15000,1000],
  ["protocolizacion_prenda_sin_desplazamiento","Protocolizacion Prenda sin Desplazamiento","P","s"],
  ["protocolizacion_primera_junta_extraordinaria_de_accionistas","Protocolizacion Primera Junta Extraordinaria de Accionistas","P","h",15000,1000],
  ["protocolizacion_rectificacion","Protocolizacion Rectificacion","P","h",15000,1000],
  ["protocolizacion_resolucion_mop","Protocolización Resolución MOP","P","h",15000,1000],
  ["reconocimiento_deuda","Reconocimiento de Deuda","E","f",18000],
  ["rectifica_escritura_compraventa","Rectifica Escritura Compraventa","E","f",18000],
  ["rectificacion","Rectificacion","E","f",18000],
  ["rectificacion_de_compraventa","Rectificacion de Compraventa","E","f",18000],
  ["rectificacion_escritura_de_compraventa_en_remate","Rectificacion Escritura de Compraventa en Remate","E","f",18000],
  ["rectificacion_particion_parcial_de_sucesiones","Rectificacion Particion Parcial de Sucesiones","E","f",18000],
  ["rectificacion_y_aclaracion","Rectificacion y Aclaracion","E","f",18000],
  ["rectificacion_y_complementacion","Rectificacion y Complementacion","E","f",18000],
  ["rectificacion_y_complementacion_de_compraventa","Rectificacion y Complementacion de Compraventa","E","f",18000],
  ["rectificacion_cesion_de_derechos","Rectificación Cesión de Derechos","E","f",18000],
  ["rectificacion_de_usufructo","Rectificación de Usufructo","E","f",18000],
  ["reduccion_escritura_acta_junta","Reduccion Escritura Acta Junta","E","f",35000],
  ["reduccion_escritura_publica","Reduccion Escritura Publica","E","f",35000],
  ["reduccion_escritura_publica_acta","Reduccion Escritura Publica Acta","E","f",35000],
  ["reforma_de_estatutos","Reforma de Estatutos","E","f",80000],
  ["renuncia_de_gananciales","Renuncia de Gananciales","E","f",28000],
  ["renuncia_de_usufructo","Renuncia de Usufructo","E","f",28000],
  ["resciliacion","Resciliacion","E","f",28000],
  ["resciliacion_de_compraventa","Resciliacion de Compraventa","E","f",18000],
  ["resciliacion_de_promesa_de_compraventa","Resciliacion de Promesa de Compraventa","E","f",18000],
  ["revocacion","Revocacion","E","f",18000],
  ["revocacion_de_poder","Revocacion de Poder","E","f",18000],
  ["revocacion_mandato_judicial","Revocacion Mandato Judicial","E","f",18000],
  ["saneamiento","Saneamiento","E","f",18000],
  ["saneamiento_de_sociedad","Saneamiento de Sociedad","E","f",18000],
  ["separacion_bienes","Separacion de Bienes","E","f",18000],
  ["separacion_total_de_bienes_y_liquidacion_de_sociedad_conyugal","Separacion Total de Bienes y Liquidacion de Sociedad Conyugal","E","f",18000],
  ["separacion_total_de_bienes_liquidacion_de_sociedad_conyugal_y_adjudicacion","Separacion Total de Bienes, Liquidacion de Sociedad Conyugal y Adjudicacion","E","f",18000],
  ["sesion_de_directorio","Sesion de Directorio","E","f",100000],
  ["suscripcion_y_pago_de_acciones","Suscripcion y Pago de Acciones","E","f",18000],
  ["termino_de_acuerdo_de_union_civil","Termino de Acuerdo de Union Civil","E","f",18000],
  ["testamento_2","Testamento","E","f",38000],
  ["testamento","Testamento Abierto","E","f",38000],
  ["transaccion","Transaccion","E","f",18000],
  ["transaccion_extrajudicial","Transaccion Extrajudicial","E","f",18000],
  ["transaccion_y_finiquito","Transacción y Finiquito","E","f",18000],
  ["transformacion_de_sociedad","Transformacion de Sociedad","E","f",120000],
  ["mutuo_hipotecario","Mutuo Hipotecario","E","s"],
  ["otro","Otro (a especificar)","A","s"],
];
const CATALOGO = ROWS.map(([value, label, t, tar, a, b]) => ({ value, label, tipo: t === 'P' ? 'protocolizacion' : t === 'A' ? 'ambos' : 'escritura', tarifa: tar === 'f' ? { tipo: 'fija', monto: a } : tar === 'h' ? { tipo: 'hoja', base: a, porHoja: b } : { tipo: 'sin_definir' } }));
const BY = Object.fromEntries(CATALOGO.map((m) => [m.value, m]));
// Valores vigentes (sujetos a modificación). Se pueden reemplazar sin publicar una versión nueva con
// setTarifas(): Studio los toma de la API de Portalfirma (GET /notarial/tarifas) cuando esté disponible.
const TARIFAS = {
  vigencia: '2026-10-06',
  protocolizacion: 40000, // toda protocolización: tarifa fija, sin importar materia ni hojas
  reduccion: 45500, // reducción a escritura pública: tarifa fija
  materias: {}, // { codigo: monto } reemplaza el valor de la planilla para esa materia
};
function setTarifas(t) {
  if (!t || typeof t !== 'object') return;
  ['protocolizacion', 'reduccion'].forEach((k) => { if (Number(t[k]) > 0) TARIFAS[k] = Number(t[k]); });
  if (t.materias && typeof t.materias === 'object') Object.entries(t.materias).forEach(([k, v]) => { if (BY[k] && Number(v) > 0) TARIFAS.materias[k] = Number(v); });
  if (t.vigencia) TARIFAS.vigencia = String(t.vigencia);
}
// Tarifa efectiva de una materia (con los reemplazos vigentes)
function tarifaDe(m) {
  if (!m) return { tipo: 'sin_definir' };
  if (TARIFAS.materias[m.value]) return { tipo: 'fija', monto: TARIFAS.materias[m.value] };
  if (m.tipo === 'protocolizacion') return { tipo: 'fija', monto: TARIFAS.protocolizacion };
  return m.tarifa;
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'con', 'para', 'por', 'a', 'al', 'su', 'sus', 'un', 'una', 'o', 'sin', 'escritura', 'publica', 'contrato', 'protocolizacion', 'prot', 'privado', 'ley', 'n', 'no', 'numero']);
const stem = (w) => w.slice(0, 6);
const toks = (s) => [...new Set(fold(s).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem))];
CATALOGO.forEach((m) => { m._t = toks(m.label); if (!m._t.length) m._t = [stem(fold(m.label).split(/\s+/)[0])]; });

const tipoOk = (m, tipo) => m.tipo === 'ambos' ? false : tipo === 'protocolizacion' ? m.tipo === 'protocolizacion' : m.tipo === 'escritura';
// Devuelve las materias más probables: [{value,label,score,confianza,motivo}]
function clasificar(titulo, cuerpo, tipo = 'escritura') {
  const T = toks(titulo); const B = new Set(toks(String(cuerpo || '').slice(0, 4000)));
  const out = [];
  CATALOGO.forEach((m, i) => {
    if (!tipoOk(m, tipo)) return;
    const L = m._t; const inT = L.filter((x) => T.includes(x)).length; const inB = L.filter((x) => B.has(x)).length;
    if (!inT && !inB) return;
    const cT = inT / L.length; const cB = inB / L.length; const titleCov = T.length ? inT / T.length : 0;
    let score = cT * 3 + cB + titleCov * 1.5 + (cT === 1 ? 1 + L.length * 0.15 : 0) - i * 0.0001;
    if (m.value === 'otro') score = 0;
    out.push({ value: m.value, label: m.label, score, cT, titleCov });
  });
  // reglas aprendidas (aprobadas por Portalfirma): un patrón del título o del inicio del texto fija la materia
  const ft = fold(titulo); const fb = fold(String(cuerpo || '').slice(0, 1500));
  for (const r of REGLAS.materias) {
    if (!r.activo || !r._re || !BY[r.materia] || !tipoOk(BY[r.materia], tipo)) continue;
    if (!r._re.test(r.campo === 'cuerpo' ? fb : ft)) continue;
    const prev = out.find((x) => x.value === r.materia);
    const top0 = Math.max(0, ...out.map((x) => x.score));
    const row = prev || { value: r.materia, label: BY[r.materia].label, cT: 1, titleCov: 1 };
    Object.assign(row, { score: top0 + 5, cT: 1, titleCov: 1, regla: r.id });
    if (!prev) out.push(row);
  }
  out.sort((a, b) => b.score - a.score);
  const top = out.slice(0, 6);
  if (top[0]) {
    const t = top[0]; const faltan = T.filter((x) => !BY[t.value]._t.includes(x));
    t.confianza = t.regla || (t.cT === 1 && t.titleCov >= 0.75) ? 'alta' : t.cT === 1 ? 'media' : 'baja';
    if (t.regla) t.motivo = 'Detectada por una regla aprendida de casos corregidos.';
    else if (t.confianza !== 'alta' && faltan.length) {
      const words = fold(titulo).replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter((w) => faltan.includes(stem(w)));
      t.motivo = `El título incluye «${[...new Set(words)].join(', ')}», que no aparece en la planilla de materias. Confirma la materia o elige otra.`;
    }
  }
  return top;
}
// ---------------------------------------------------------------- materias ocultas
// Un escrito puede declararse como una materia y contener otras (p. ej. un «mandato» que en realidad vende,
// o una compraventa que además constituye hipoteca). Se busca en TODO el texto la fórmula operativa de cada
// acto (verbos en presente: «vende, cede y transfiere», «constituye hipoteca»…), no solo palabras sueltas,
// y se ignoran las menciones a escrituras anteriores («mediante escritura de fecha…, vendió…»).
// Cada hallazgo trae la cláusula y la cita que lo prueba.
const ACTOS = [
  // [código, nombre, expresión (sobre texto sin tildes, en minúsculas), principal?, incluido en (materias que ya lo cubren)]
  ['compraventa', 'Compraventa', /\b(?:vende|venden),?\s+(?:cede|ceden)?,?\s*(?:y\s+)?(?:transfiere|transfieren)\b|\bcompra,?\s+acepta\s+y\s+adquiere\b/, true, /compraventa|dacion/],
  ['contrato_de_compraventa_vehiculo', 'Compraventa de vehículo', /\b(?:vende|venden)\b[^.;]{0,160}\b(?:vehiculo|automovil|camioneta|motocicleta|placa patente)\b/, true, /vehiculo|compraventa/],
  ['promesa_de_compraventa', 'Promesa de compraventa', /\bpromete(?:n)?\s+(?:vender|comprar|ceder)\b/, true, /promesa/],
  ['cesion_de_derechos', 'Cesión de derechos', /\b(?:cede|ceden)\s+y\s+(?:transfiere|transfieren)\b[^.;]{0,120}\bderechos?\b/, true, /cesion|compraventa_de_derechos/],
  ['donacion', 'Donación', /\b(?:dona|donan)\s+(?:a|en favor|irrevocablemente)\b|\bdonacion\s+(?:irrevocable|entre vivos)\b/, true, /donacion/],
  ['dacion_en_pago_escritura_publica', 'Dación en pago', /\bdacion\s+en\s+pago\b|\ben\s+pago\s+de\b[^.;]{0,80}\b(?:cede|transfiere|entrega)\b/, true, /dacion/],
  ['constitucion_sociedad', 'Constitución de sociedad', /\b(?:vienen\s+en\s+)?constitu(?:yen|ir)\s+una\s+sociedad\b/, true, /sociedad/],
  ['hipoteca', 'Hipoteca', /\bconstituye(?:n)?(?:\s+\w+){0,3}\s+hipoteca\b|\bhipoteca\s+de\s+primer\s+grado\b/, false, /hipotec/],
  ['mutuo_hipotecario', 'Mutuo hipotecario', /\b(?:da|otorga|entrega)(?:n)?\s+en\s+prestamo\b|\bmutuo\s+hipotecario\b|\botorga(?:n)?\s+un\s+mutuo\b/, false, /mutuo/],
  ['prenda_sin_desplazamiento', 'Prenda sin desplazamiento', /\bconstituye(?:n)?(?:\s+\w+){0,3}\s+prenda\s+sin\s+desplazamiento\b/, false, /prenda/],
  ['prenda', 'Prenda', /\bconstituye(?:n)?(?:\s+\w+){0,3}\s+prenda\b(?!\s+sin)/, false, /prenda/],
  ['garantia', 'Fianza o codeudoría solidaria', /\bse\s+constituye(?:n)?\s+en\s+(?:fiador|fiadora|aval|codeudor|codeudora)\b|\bfiador\s+y\s+codeudor\s+solidario\b/, false, /garantia|caucion/],
  ['alzamiento_de_hipoteca', 'Alzamiento de hipoteca', /\b(?:alza|alzan|viene\s+en\s+alzar|vienen\s+en\s+alzar)\b[^.;]{0,80}\bhipoteca\b/, false, /alzamiento|cancelacion_y_alzamiento/],
  ['alzamiento_de_prenda', 'Alzamiento de prenda', /\b(?:alza|alzan|viene\s+en\s+alzar|vienen\s+en\s+alzar)\b[^.;]{0,80}\bprenda\b/, false, /alzamiento/],
  ['alzamiento_de_prohibicion', 'Alzamiento de prohibición', /\b(?:alza|alzan|viene\s+en\s+alzar|vienen\s+en\s+alzar)\b[^.;]{0,80}\bprohibicion\b/, false, /alzamiento/],
  ['cancelacion', 'Cancelación (carta de pago)', /\b(?:declara|declaran)\s+(?:integramente\s+|totalmente\s+)?(?:pagad[oa]s?|cancelad[oa]s?)\b|\botorga(?:n)?\s+(?:el\s+mas\s+amplio\s+)?(?:recibo|carta)\s+de\s+pago\b/, false, /cancelacion|alzamiento/],
  ['poder_general', 'Poder general', /\b(?:confiere|confieren|otorga|otorgan)\s+(?:\w+\s+){0,3}(?:poder|mandato)\s+general\b|\bamplio\s+poder\s+general\b/, false, /mandato|poder/],
  ['poder_especial', 'Poder o mandato especial', /\b(?:confiere|confieren|otorga|otorgan)\s+(?:\w+\s+){0,3}(?:poder|mandato)\b(?!\s+general)|\bdesigna(?:n)?\s+(?:como\s+)?(?:su\s+)?mandatari[oa]\b/, false, /mandato|poder|revocacion/],
  ['revocacion_de_poder', 'Revocación de poder', /\b(?:revoca|revocan|viene\s+en\s+revocar)\b[^.;]{0,60}\b(?:poder|mandato)\b/, false, /revocacion/],
  ['reconocimiento_deuda', 'Reconocimiento de deuda', /\breconoce(?:n)?\s+(?:adeudar|deber|que\s+adeuda)\b/, false, /reconocimiento/],
  ['transaccion', 'Transacción', /\b(?:transigen|vienen\s+en\s+transigir)\b/, false, /transaccion/],
  ['resciliacion', 'Resciliación', /\b(?:resciliar|rescilian|vienen\s+en\s+resciliar)\b/, false, /resciliacion/],
  ['renuncia_de_gananciales', 'Renuncia de gananciales', /\brenuncia(?:n)?\s+a\s+los\s+gananciales\b/, false, /gananciales/],
  ['separacion_bienes', 'Separación de bienes', /\bpacta(?:n)?\s+(?:la\s+)?separacion\s+(?:total\s+)?de\s+bienes\b|\bsustituye(?:n)?\s+el\s+regimen\s+de\s+sociedad\s+conyugal\b/, false, /separacion/],
  ['cesion_de_nuda_propiedad_y_reserva_de_usufructo', 'Usufructo / nuda propiedad', /\breserva(?:n)?\s+(?:para\s+si\s+)?(?:el\s+)?(?:derecho\s+de\s+)?usufructo\b|\bconstituye(?:n)?\s+(?:un\s+)?(?:derecho\s+de\s+)?usufructo\b/, false, /usufructo/],
  ['compraventa_y_constitucion_de_servidumbre_de_transito', 'Servidumbre', /\bconstituye(?:n)?\s+(?:una\s+)?servidumbre\b/, false, /servidumbre/],
  [null, 'Arrendamiento', /\b(?:da|dan)\s+en\s+arrendamiento\b|\btoma(?:n)?\s+en\s+arriendo\b/, false, /arrend/],
  [null, 'Subrogación de crédito', /\bsubroga(?:cion|rse|n)?\b/, false, /subrog/],
];
const PASADO = /(?:mediante|por)\s+escritura\s+publica[^.;]{0,160}$|(?:con\s+fecha|de\s+fecha)[^.;]{0,120}$/;
const CLAUSULAS = /\b(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[EÉ]PTIMO|OCTAVO|NOVENO|D[EÉ]CIMO(?:\s+\w+)?|UND[EÉ]CIMO|DUOD[EÉ]CIMO)\s*[:.\-]/g;
// minúsculas y sin tildes conservando el largo, para citar el texto original
const foldKeep = (s) => [...String(s || '')].map((c) => (c.normalize('NFD')[0] || c).toLowerCase()[0] || c).join('');
function detectarActos(texto, materia, { tipo = 'escritura' } = {}) {
  const orig = String(texto || '').replace(/\s+/g, ' '); const t = foldKeep(orig);
  const mf = fold(BY[materia]?.value || materia || '') + ' ' + fold(BY[materia]?.label || '');
  const heads = []; let h; CLAUSULAS.lastIndex = 0; while ((h = CLAUSULAS.exec(orig))) heads.push({ i: h.index, n: h[1].toUpperCase() });
  const out = [];
  const aprendidas = REGLAS.actos.filter((r) => r.activo && r._re).map((r) => [r.codigo || null, r.nombre, r._re, !!r.principal, r._incl || /^$a/, r.id]);
  for (const [value, label, re, principal, incl, regla] of [...ACTOS, ...aprendidas]) {
    if (out.some((x) => x.value && x.value === value)) continue;
    if (incl.test(mf)) continue; // la materia declarada ya lo cubre
    const exc = REGLAS.excepciones.filter((e) => e.activo && (e.acto === value || fold(e.acto) === fold(label)));
    const g = new RegExp(re.source, 'g'); let m; let hit = null;
    while ((m = g.exec(t))) {
      if (PASADO.test(t.slice(Math.max(0, m.index - 200), m.index))) continue;
      if (exc.length && exc.some((e) => e._re.test(t.slice(Math.max(0, m.index - 120), m.index + m[0].length + 120)))) continue;
      hit = m; break;
    }
    if (!hit) continue;
    if (value === 'prenda' && out.some((x) => x.value === 'prenda_sin_desplazamiento')) continue;
    const a = Math.max(0, orig.lastIndexOf(' ', Math.max(0, hit.index - 70))); const b = orig.indexOf(' ', Math.min(orig.length, hit.index + hit[0].length + 70));
    const cita = (a > 0 ? '…' : '') + orig.slice(a, b < 0 ? orig.length : b).trim() + (b > 0 ? '…' : '');
    const cl = heads.filter((x) => x.i < hit.index).pop();
    const cat = value ? BY[value] : null;
    out.push({ value, label: cat ? cat.label : label, nombre: label, principal, cita, ...(regla ? { regla } : {}), clausula: cl ? cl.n : (hit.index < 1500 ? 'comparecencia' : ''), cobra: tipo === 'escritura' && !!cat });
  }
  // compraventa de vehículo es más precisa que compraventa genérica
  if (out.some((x) => x.value === 'contrato_de_compraventa_vehiculo')) return out.filter((x) => x.value !== 'compraventa');
  return out;
}
// ---------------------------------------------------------------- reglas aprendidas
// Las propone la IA a partir de casos corregidos, las aprueba una persona de Portalfirma y se ejecutan
// de forma determinista (sin IA). Formato:
//   actos:    { id, codigo (materia de la planilla o null), nombre, patron (regex sobre texto sin tildes y en minúsculas),
//               principal, incluido (regex de materias que ya lo cubren), activo }
//   materias: { id, materia, patron, campo: 'titulo'|'cuerpo', activo }
//   excepciones: { id, acto (código o nombre), patron, activo }: si el patrón aparece junto al hallazgo, no es ese acto
const REGLAS = { version: null, actos: [], materias: [], excepciones: [] };
function compilar(src) { if (!src) return null; try { const re = new RegExp(String(src)); if (re.test('')) return null; return re; } catch { return null; } }
function setReglas(r) {
  const prep = (x) => ({ ...x, activo: x.activo !== false, _re: compilar(x.patron), _incl: compilar(x.incluido) });
  REGLAS.version = r?.version || null;
  REGLAS.actos = (r?.actos || []).map(prep).filter((x) => x._re && x.nombre);
  REGLAS.materias = (r?.materias || []).map(prep).filter((x) => x._re && BY[x.materia]);
  REGLAS.excepciones = (r?.excepciones || []).map(prep).filter((x) => x._re && x.acto);
  return { actos: REGLAS.actos.length, materias: REGLAS.materias.length, excepciones: REGLAS.excepciones.length };
}
const ACTOS_REVISADOS = ACTOS.length;
const actosNombres = () => [...new Set([...ACTOS.map((a) => a[1]), ...REGLAS.actos.map((r) => r.nombre)])];
const actosRevisados = () => ACTOS.length + REGLAS.actos.filter((r) => r.activo).length;
// compatibilidad: actos que se cobran aparte
function actosAdicionales(materia, cuerpo) { return detectarActos(cuerpo, Object.values(BY).find((m) => m.label === materia)?.value || materia).filter((x) => x.cobra).map((x) => BY[x.value]); }
function precio(value, hojas = 1) {
  const m = BY[value]; if (!m) return { monto: null, detalle: 'Materia fuera de la planilla: requiere cotización.' };
  const t = tarifaDe(m); const h = Math.max(1, Number(hojas) || 1);
  if (t.tipo === 'fija') return { monto: t.monto, detalle: m.tipo === 'protocolizacion' ? 'Tarifa fija de protocolización' : 'Tarifa fija' };
  if (t.tipo === 'hoja') return { monto: t.base + t.porHoja * h, detalle: `${clp(t.base)} + ${clp(t.porHoja)} por hoja × ${h}` };
  return { monto: null, detalle: 'Sin precio en la planilla: requiere cotización' };
}
// Cobro total del trámite
function cotizar({ tramite, materia, actos = [], hojas = 1 }) {
  const lineas = [];
  if (tramite === 'reduccion') {
    lineas.push({ concepto: 'Reducción a escritura pública', detalle: `Tarifa fija · instrumento: ${BY[materia]?.label || '—'}`, monto: TARIFAS.reduccion });
    actos.forEach((a) => lineas.push({ concepto: a.label, detalle: 'Incluido en la tarifa fija', monto: 0 }));
  } else {
    const p = precio(materia, hojas); lineas.push({ concepto: BY[materia]?.label || 'Materia', detalle: p.detalle, monto: p.monto });
    actos.forEach((a) => { const q = precio(a.value, hojas); lineas.push({ concepto: a.label + ' (acto adicional)', detalle: q.detalle, monto: q.monto }); });
  }
  const pendiente = lineas.some((l) => l.monto == null);
  return { lineas, total: pendiente ? null : lineas.reduce((s, l) => s + l.monto, 0), cotizacion: pendiente };
}
const clp = (n) => (n == null ? 'Por cotizar' : '$' + Math.round(n).toLocaleString('es-CL'));

const api = { CATALOGO, BY, TARIFAS, setTarifas, tarifaDe, detectarActos, ACTOS_REVISADOS, actosRevisados, actosNombres, setReglas, REGLAS, compilar, foldKeep, clasificar, actosAdicionales, precio, cotizar, clp, fold };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Materias = api;
})(typeof window !== 'undefined' ? window : globalThis);
