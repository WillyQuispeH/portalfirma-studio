/* global $, esc, icon, modal, closeModal, toast, pf */
'use strict';
// Ayuda de PortalFirma Studio: botón «?» siempre visible, guías paso a paso por nivel, buscador de dudas
// (local, no gasta tokens), recorridos guiados por pantalla y contacto con soporte.
(() => {
const LEVEL_NAMES = { esencial: 'Lo esencial', ahorro: 'Para ahorrar tiempo', avanzado: 'Avanzado' };
// screens: vistas donde la guía aparece en «En esta pantalla»
const GUIDES = [
  { id: 'abrir', level: 'esencial', screens: ['home', 'editor'], title: 'Abrir o crear un documento', kw: 'abrir crear nuevo archivo pdf word excel imagen arrastrar drive',
    steps: ['Arrastra el archivo a la ventana de Studio, o usa «Abrir PDF» en el inicio.', 'Word, Excel e imágenes se convierten a PDF automáticamente.', 'Para un documento en blanco usa «Crear PDF» y elige carta, oficio o A4.', 'También puedes traer archivos desde Google Drive.'] },
  { id: 'enviar', level: 'esencial', screens: ['home', 'editor', 'send'], title: 'Enviar un documento a firmar', kw: 'enviar firmar firma firmantes correo telefono rut legalizar notario avanzada simple',
    steps: ['Abre el documento y presiona «Enviar a firmar» (arriba a la derecha).', 'Studio detecta los firmantes; revisa nombre, RUT, correo y teléfono de cada uno.', 'Elige el tipo de firma: simple, avanzada, visada o con legalización ante notario.', 'Confirma el envío: cada firmante recibe su enlace por correo y WhatsApp.', 'El avance lo ves en «Mis operaciones».'] },
  { id: 'ops', level: 'esencial', screens: ['home', 'ops'], title: 'Ver el estado de mis firmas y descargar el firmado', kw: 'operaciones estado firmas firmado descargar documento firmado pendiente reenviar enlace',
    steps: ['Abre «Mis operaciones» e inicia sesión con el correo y la contraseña de tu cuenta.', 'Usa los filtros (En firma, Firmadas, Legalizadas, Requieren acción) o busca por nombre o número.', 'Al elegir una operación ves el documento, las etapas y quién firmó.', '«Descargar documento» guarda el PDF; «Abrir en Studio» lo abre en el editor.', 'A un firmante pendiente le puedes reenviar el enlace.'] },
  { id: 'editar', level: 'esencial', screens: ['editor'], title: 'Corregir el texto de un PDF', kw: 'editar corregir texto cambiar palabra fuente parrafo error',
    steps: ['En el editor elige «Editar texto».', 'Haz clic en el párrafo que quieres cambiar: se abre con la misma fuente y tamaño.', 'Escribe la corrección; puedes cambiar formato en el panel derecho.', 'Presiona Esc para terminar y guarda con ⌘S / Ctrl+S.'] },
  { id: 'texto', level: 'esencial', screens: ['editor'], title: 'Agregar texto, títulos y párrafos', kw: 'agregar texto titulo parrafo escribir recuadro modelo nota clausula fuente tamaño',
    steps: ['Elige «Agregar texto» y dibuja en la página el recuadro donde irá el texto.', 'Al soltar ya estás escribiendo dentro; la herramienta vuelve a «Seleccionar».', 'Para un formato listo, en el panel derecho usa «Agregar texto con formato»: Título y párrafo, Título, Subtítulo, Párrafo, Cláusula o Nota.', 'El texto de ejemplo («Agrega un título aquí») se reemplaza al empezar a escribir.'] },
  { id: 'mover', level: 'esencial', screens: ['editor'], title: 'Mover textos, campos e imágenes', kw: 'mover mano arrastrar seleccionar area imagen logo varios objetos desplazar',
    steps: ['«Mover» (la mano, o mantén la barra espaciadora) arrastra textos, imágenes y campos sin entrar a editarlos.', 'Con la mano, arrastrar la página desplaza la vista (útil con zoom).', 'Con «Seleccionar», arrastra en un espacio vacío para dibujar un área: entran los objetos que queden completos dentro.', 'Las imágenes del PDF (por ejemplo un logo) también se pueden tomar así: enciérralas completas y quedan movibles.', 'Con varios seleccionados, arrástralos juntos o presiona Supr para quitarlos.'] },
  { id: 'combinar', level: 'esencial', screens: ['home', 'editor'], title: 'Combinar, convertir y ordenar páginas', kw: 'combinar unir juntar convertir paginas ordenar rotar eliminar dividir extraer',
    steps: ['«Combinar archivos» une PDF, Word, Excel e imágenes en un solo PDF.', 'En el editor, la columna izquierda muestra las páginas: arrástralas para reordenar.', 'Los botones de arriba de las miniaturas rotan, insertan, extraen, dividen o eliminan páginas.'] },
  { id: 'ocr', level: 'esencial', screens: ['home', 'editor'], title: 'Hacer buscable una fotocopia (Reconocer texto)', kw: 'ocr escaneo fotocopia escaneado reconocer texto buscar copiar',
    steps: ['Abre el PDF escaneado y presiona «Reconocer texto».', 'Elige si reconocer solo las páginas sin texto, la actual o todas.', 'Después podrás buscar, copiar y editar el texto. Funciona sin internet.'] },
  { id: 'plantilla', level: 'ahorro', screens: ['home', 'editor'], title: 'Convertir un contrato en plantilla con campos', kw: 'plantilla campos variables contrato modelo reutilizar nombre rut fecha',
    steps: ['Abre el contrato y elige la pestaña «Plantilla» del panel derecho.', 'Selecciona las palabras que cambian en cada uso (nombre, RUT, fecha…) y presiona «Convertir en campo».', 'O usa «Detectar con IA» para que proponga los campos.', 'Guarda la plantilla: queda en el inicio, en «Plantillas con campos».'] },
  { id: 'llenar', level: 'ahorro', screens: ['home'], title: 'Llenar una plantilla y enviarla', kw: 'llenar plantilla formulario completar datos generar documento',
    steps: ['En el inicio, en «Plantillas con campos», abre la plantilla.', 'Completa el formulario del panel derecho.', 'Presiona «Generar documento» y luego «Enviar a firmar».'] },
  { id: 'ia', level: 'ahorro', screens: ['home', 'editor'], title: 'Revisar o redactar con el asistente legal', kw: 'asistente ia inteligencia artificial revisar redactar borrador tokens corregir',
    steps: ['Con un documento abierto, elige la pestaña «Asistente» del panel derecho.', '«Revisar» busca errores y cláusulas que conviene corregir; aplicas cada sugerencia con un clic.', '«Redactar» primero busca un modelo de Portalfirma (sin costo) y, si no hay, lo redacta con IA.', 'Cada uso con IA indica cuántos tokens consume antes de hacerlo.'] },
  { id: 'notaria', level: 'ahorro', screens: ['home', 'tpl'], title: 'Notaría virtual: poderes, declaraciones y contratos', kw: 'notaria virtual poder declaracion jurada mandato tramite municipal',
    steps: ['Abre «Notaría virtual» y busca el trámite (por ejemplo, «poder simple» o «declaración jurada»).', 'Completa los datos del formulario.', 'Revisa la vista previa y envíalo a firmar.'] },
  { id: 'plazos', level: 'ahorro', screens: ['home', 'plazos'], title: 'Controlar plazos y vencimientos', kw: 'plazos vencimientos vencer renovacion aviso termino contrato arriendo calendario',
    steps: ['Abre «Plazos y vencimientos» y agrega tus contratos (desde el computador, Drive o «Traer de Portalfirma»).', 'El informe básico (gratis) detecta fechas, plazos, renovación y avisos.', 'Los colores muestran la urgencia: rojo, amarillo o verde.', 'El informe inteligente (1 token) sugiere qué hacer y puede redactar el documento.', 'Con «Calendario» agregas un recordatorio a tu agenda.'] },
  { id: 'exp', level: 'ahorro', screens: ['home', 'expedientes'], title: 'Ordenar un caso en un expediente', kw: 'expediente carpeta caso propiedad cliente cedula fotos historial',
    steps: ['Abre «Expedientes» y crea uno (propiedad, persona, empresa o trámite).', 'Elige dónde se guarda: en este computador o en Google Drive.', 'Agrega contratos, cédulas, fotos y planillas arrastrándolos.', 'Desde ahí puedes abrirlos, combinarlos, enviarlos a firmar o llevarlos a Plazos.', 'El historial registra todo lo que se hizo, con número de operación.'] },
  { id: 'escrituras', level: 'avanzado', screens: ['home', 'escrituras'], title: 'Iniciar un trámite notarial (escritura pública)', kw: 'escritura minuta notaria notario formatear revisar comparecientes materia precio pagar saldo firma presencial reduccion',
    steps: ['Abre «Gestión de firmas presenciales» y elige Escritura pública (o Reducción a escritura pública).', 'Sube la minuta: revisamos comparecientes, RUT, firmas y redacción, e identificamos la materia y su valor según la planilla de la notaría.', 'Corrige con «Corregir» o «Corregir todo» y completa el correo y teléfono de quienes firman.', 'Revisa la vista previa con formato notarial (oficio, 30 líneas, cifras en palabras).', 'Paga con el saldo de tu cuenta (o recarga); la notaría recibe los archivos y te contacta para la firma presencial.'] },
  { id: 'protocolizar', level: 'avanzado', screens: ['escrituras'], title: 'Protocolizar un documento', kw: 'protocolizar protocolizacion caratula documento privado fotocopia escaneo foto fecha cierta registro publico requirente hojas',
    steps: ['En «Gestión de firmas presenciales» pulsa «Nuevo trámite» y elige Protocolización.', 'Sube el documento, de preferencia en Word (lectura exacta). Si solo tienes PDF, foto o escaneo, se lee con IA, incluido en el valor.', 'Studio detecta qué es, cuántas hojas tiene, quiénes participan y si tiene firmas, y arma la carátula. Esos datos no se editan.', 'Elige la notaría y paga la tarifa fija. El requirente, el repertorio y el número los completa el ejecutivo de la notaría.'] },
  { id: 'reducir', level: 'avanzado', screens: ['escrituras'], title: 'Reducir un documento privado a escritura pública', kw: 'reduccion reducir escritura publica documento privado firmado original',
    steps: ['Elige Reducción a escritura pública y sube el documento privado ya firmado.', 'Studio lo reescribe como escritura pública: comparecen las mismas partes y el texto se transcribe a continuación.', 'Revisa «Cómo llegó» y «Cómo va a la notaría»; con «Modificar el escrito» puedes corregirlo.', 'Declara que el documento está firmado, elige la notaría y paga. El día de la firma lleva el original.'] },
  { id: 'elegirNotaria', level: 'avanzado', screens: ['escrituras'], title: 'Elegir la notaría', kw: 'notaria elegir red notarias comuna horario asignacion automatica',
    steps: ['Antes de pagar, todo trámite pide elegir la notaría (columna derecha, «Elegir notaría»).', 'Filtra por comuna; cada notaría muestra notario, dirección, horario, en cuánto tiempo toma el caso y qué trámites realiza.', 'Los datos de la notaría elegida quedan en la escritura o la carátula. Repertorio y fecha los pone la notaría.', 'Si te da lo mismo, usa «Asignación automática»: la primera notaría disponible toma el caso.'] },
  { id: 'ocultas', level: 'avanzado', screens: ['escrituras'], title: 'Materias ocultas en un escrito', kw: 'materia oculta acto adicional compraventa hipoteca prenda poder cesion donacion revision cobro',
    steps: ['Además de la materia del título, Studio lee el texto completo buscando más de 25 tipos de actos (compraventas, hipotecas, prendas, poderes, cesiones, donaciones, alzamientos…).', 'Cada hallazgo muestra la cláusula y la cita exacta que lo prueba.', 'Si el contenido no coincide con la materia declarada (por ejemplo, un «mandato» que vende), se avisa y puedes cambiar la materia principal con un clic.', 'Los actos adicionales se cobran según la planilla; si desmarcas uno, la notaría recibe el aviso y puede pedir un ajuste.', 'Si falta un acto, pulsa «Agregar un acto que no detectamos», elígelo y copia la frase del escrito donde aparece. Se suma al cobro y nos ayuda a detectarlo solos la próxima vez.'] },
  { id: 'agente', level: 'esencial', screens: ['home', 'editor', 'ops'], title: 'Agente Portalfirma', kw: 'agente ia chat herramientas mcp enviar firmar operacion saldo recarga plantilla propiedad certificado cds reenviar',
    steps: ['Pulsa «Agente» arriba a la derecha (o escribe en el buscador del inicio) y pide lo que necesitas en tus palabras.', 'Para trabajar con un documento, usa el clip: adjunta el documento abierto o un PDF/Word. El agente lo sube a Portalfirma.', 'Las consultas se hacen solas. Lo que cobra, envía o notifica muestra una tarjeta con el detalle: revisa y pulsa Confirmar o Cancelar.', 'Para firmar con certificado, escribe la clave y el código en los campos protegidos de la tarjeta, nunca en el chat.', 'El botón de lista muestra la actividad del agente. Cuesta 1 token del asistente cada 3 mensajes.'] },
  { id: 'reglas', level: 'avanzado', screens: ['escrituras'], title: 'Reglas de detección (interno Portalfirma)', kw: 'reglas aprendizaje ia propuesta aprobar casos corregidos deteccion materia acto excepcion exportar',
    steps: ['Cada vez que un cliente cambia la materia, descarta un acto oculto o agrega uno que faltaba, queda un caso sin RUT, correos ni teléfonos.', 'En «Reglas de detección» (solo administradores) pulsa «Proponer reglas con IA»: el modelo más económico revisa los casos y propone reglas.', 'Cada propuesta se prueba contra todos los casos: cuántos detecta y si coincide en otros (posible falso positivo). Puedes editar el patrón y volver a probar.', 'Aprueba o descarta. Las aprobadas funcionan al instante y sin IA; puedes desactivarlas o exportarlas para publicarlas desde el servidor.'] },
  { id: 'materias', level: 'avanzado', screens: ['escrituras'], title: '¿Cómo se calcula el valor de un trámite notarial?', kw: 'precio valor cobro materia tarifa planilla cotizacion acto adicional hipoteca ajuste',
    steps: ['El valor sale de la planilla de materias de la notaría. Toda protocolización tiene tarifa fija ($40.000). Los valores pueden cambiar; la pantalla de pago muestra su fecha de vigencia.', 'Si el texto contiene otro acto (por ejemplo, una hipoteca dentro de una compraventa), se cobra aparte; puedes desmarcarlo si no corresponde.', 'La reducción a escritura pública tiene tarifa fija.', 'Si la materia no tiene precio en la planilla, se solicita una cotización y no se cobra hasta que la apruebes.'] },
  { id: 'flujos', level: 'avanzado', screens: ['home', 'flujos'], title: 'Flujos documentales: muchos documentos desde una nómina', kw: 'flujo nomina excel masivo muchos documentos pagare receta plantilla',
    steps: ['Abre «Flujos documentales» y crea una receta.', 'Elige la plantilla y sube la nómina (Excel o CSV, una fila por documento).', 'Relaciona cada campo con una columna de la nómina.', 'Revisa los datos marcados (RUT, correos, duplicados) y genera los documentos.', 'Se envían a firmar en la carga masiva.'] },
  { id: 'masiva', level: 'avanzado', screens: ['home', 'bulk', 'ops'], title: 'Carga masiva y firma con certificado', kw: 'carga masiva muchos documentos firma masiva certificado cds clave',
    steps: ['«Carga masiva» sube muchos documentos y los analiza en paralelo.', 'Completa los firmantes que falten (puedes usar los mismos en todos).', 'Envía todos con una sola confirmación.', 'Para firmar con tu certificado varios documentos a la vez, usa «Firma masiva»: la clave del certificado nunca se guarda.'] },
  { id: 'plano', level: 'avanzado', screens: ['home'], title: 'Firmar un plano arquitectónico', kw: 'plano arquitectura lamina a0 a1 hoja de firmas',
    steps: ['Elige «Firmar plano arquitectónico».', 'Studio arma las láminas y agrega una hoja de firmas tamaño carta.', 'Revisa y envía a firmar como cualquier documento.'] },
  { id: 'cuenta', level: 'esencial', screens: ['home', 'ops', 'login'], title: 'Conectar mi cuenta de Portalfirma', kw: 'cuenta iniciar sesion login contraseña correo conectar cerrar sesion saldo',
    steps: ['Las funciones de firma necesitan tu cuenta de empresa de Portalfirma.', 'En «Mis operaciones» inicia sesión con tu correo y contraseña: Studio guarda solo la sesión, cifrada.', 'Si olvidaste la contraseña, recupérala en empresa.portalfirma.cl.'] },
];
const SYN = { firma: 'firmar', firme: 'firmar', firmas: 'firmar', mandar: 'enviar', envio: 'enviar', mover: 'mover', arrastrar: 'mover', escanear: 'ocr', escaneado: 'ocr', fotocopia: 'ocr', juntar: 'combinar', unir: 'combinar', vence: 'vencimientos', vencimiento: 'vencimientos', modelo: 'plantilla', plantillas: 'plantilla', ia: 'asistente', clave: 'contraseña' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOP = new Set(['como', 'que', 'para', 'por', 'una', 'uno', 'los', 'las', 'del', 'con', 'puedo', 'quiero', 'hago', 'hacer', 'mis', 'mi', 'el', 'la', 'de', 'en', 'un', 'y', 'o', 'a', 'se', 'es', 'me', 'al', 'lo']);
function search(q) {
  const toks = norm(q).split(/[^a-z0-9ñ]+/).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => norm(SYN[t] || t));
  if (!toks.length) return [];
  return GUIDES.map((g) => {
    const T = norm(g.title), K = norm(g.kw), S = norm(g.steps.join(' '));
    let sc = 0; for (const t of toks) { const st = t.length > 4 ? t.slice(0, t.length - 1) : t; if (T.includes(st)) sc += 3; if (K.includes(st)) sc += 2; if (S.includes(st)) sc += 1; }
    return { g, sc };
  }).filter((x) => x.sc >= 2).sort((a, b) => b.sc - a.sc).slice(0, 3).map((x) => x.g);
}

// ---- Recorridos guiados ----
const TOURS = {
  home: [
    ['#hubDrop', 'Empieza aquí', 'Arrastra a la ventana cualquier PDF, Word, Excel o imagen, o haz clic para elegirlo.'],
    ['.hub-card[data-act="send"]', 'Enviar a firmar', 'Prepara el documento y lo envía a los firmantes con Portalfirma.'],
    ['.hub-card[data-act="ops"]', 'Mis operaciones', 'El estado de cada firma y los documentos firmados, listos para descargar.'],
    ['.tool-chips', 'Herramientas de PDF', 'Editar, reconocer texto, dividir, comprimir y más, siempre a mano.'],
    ['.hub-col:last-child .lvl-h', 'Para ahorrar tiempo y avanzado', 'Cuando ya envías documentos seguido: plantillas, asistente con IA, plazos, expedientes y flujos masivos.'],
    ['#helpFab', '¿Dudas? Aquí', 'Este botón abre las guías paso a paso, el buscador de dudas y el contacto con soporte, en cualquier pantalla.'],
  ],
  editor: [
    ['.tool[data-tool="select"]', 'Seleccionar', 'Clic en un objeto para moverlo; arrastra en un espacio vacío para elegir un área completa.'],
    ['.tool[data-tool="hand"]', 'Mover', 'La mano solo mueve: textos, imágenes y campos, o la página cuando hay zoom. Atajo: barra espaciadora.'],
    ['.tool[data-tool="text"]', 'Agregar texto', 'Dibuja el recuadro y escribe dentro. En el panel derecho hay modelos con título y párrafo.'],
    ['#edOcr', 'Reconocer texto', 'Convierte fotocopias y escaneos en texto buscable y editable.'],
    ['#edPanelTabs', 'Panel derecho', 'Cambia entre Edición, Asistente y Plantilla cuando quieras. Arrastra su borde izquierdo para ensancharlo.'],
    ['#edSend', 'Enviar a firmar', 'Cuando el documento esté listo, envíalo desde aquí.'],
  ],
  ops: [
    ['#opsFilters', 'Filtros', 'Separa lo que está en firma, lo firmado, lo legalizado y lo que requiere tu acción.'],
    ['#opsList', 'Tus operaciones', 'Elige una para ver el documento, sus etapas y quién falta por firmar.'],
    ['#opsSync', 'Sincronizar', 'Trae los cambios recientes de Portalfirma (también se hace solo cada 5 minutos).'],
  ],
  plazos: [
    ['#plAdd', 'Agrega contratos', 'Desde el computador, Google Drive o directamente desde Portalfirma.'],
    ['#plTable', 'Ordenados por urgencia', 'Rojo: actúa ya · Amarillo: pronto · Verde: sin apuro. Haz clic en uno para ver el detalle.'],
  ],
  expedientes: [
    ['#xpNew', 'Nuevo expediente', 'Una carpeta por caso: una propiedad, un cliente o un trámite.'],
    ['#xpList', 'Tus expedientes', 'Cada uno guarda sus documentos y el historial de lo que se hizo.'],
  ],
  escrituras: [
    ['.es-list', 'Tus trámites', 'El que estás preparando y los enviados, con su estado.'],
    ['.es-cards', 'Elige el trámite', 'Escritura pública, protocolización o reducción a escritura pública.'],
    ['#esNuevo', 'Nuevo trámite', 'Empieza otro trámite cuando quieras.'],
  ],
  flujos: [
    ['#flNew', 'Nueva receta', 'Una plantilla + una nómina = muchos documentos listos para firmar.'],
  ],
};
let tour = null;
function visible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
function startTour(screen) {
  const steps = (TOURS[screen] || []).map(([sel, t, d]) => ({ el: document.querySelector(sel), t, d })).filter((s) => visible(s.el));
  if (!steps.length) { toast('Esta pantalla no tiene recorrido guiado.'); return; }
  endTour();
  const root = document.createElement('div'); root.className = 'tour'; root.innerHTML = '<div class="tour-hole"></div><div class="tour-tip" role="dialog"></div>';
  document.body.appendChild(root);
  tour = { screen, steps, i: 0, root };
  try { localStorage.setItem('pf.tour.' + screen, '1'); } catch {}
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]'); if (!b) return;
    if (b.dataset.tour === 'next') { if (tour.i < tour.steps.length - 1) { tour.i++; paintTour(); } else endTour(); }
    else if (b.dataset.tour === 'prev') { tour.i = Math.max(0, tour.i - 1); paintTour(); }
    else endTour();
  });
  paintTour();
}
function paintTour() {
  if (!tour) return; const s = tour.steps[tour.i]; s.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = s.el.getBoundingClientRect(); const pad = 6;
  Object.assign(tour.root.querySelector('.tour-hole').style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  const tip = tour.root.querySelector('.tour-tip'); const n = tour.steps.length;
  tip.innerHTML = `<div class="tour-n">${tour.i + 1} de ${n}</div><h4>${esc(s.t)}</h4><p>${esc(s.d)}</p>
    <div class="tour-acts"><button class="ghost small" data-tour="skip">Saltar recorrido</button><span>${tour.i ? '<button class="secondary small" data-tour="prev">Anterior</button>' : ''}<button class="primary small" data-tour="next">${tour.i === n - 1 ? 'Listo' : 'Siguiente'}</button></span></div>`;
  const tw = 300; const th = tip.offsetHeight || 150; const W = innerWidth, H = innerHeight;
  let x = r.left, y = r.bottom + 14;
  if (y + th > H - 10) y = r.top - th - 14;
  if (y < 10) { y = Math.min(H - th - 10, Math.max(10, r.top)); x = r.right + 14 > W - tw ? r.left - tw - 14 : r.right + 14; }
  tip.style.left = Math.max(10, Math.min(W - tw - 10, x)) + 'px'; tip.style.top = Math.max(10, y) + 'px';
}
function endTour() { if (tour) { tour.root.remove(); tour = null; } }
window.addEventListener('resize', () => { if (tour) paintTour(); });
document.addEventListener('keydown', (e) => { if (!tour) return; if (e.key === 'Escape') { e.stopPropagation(); endTour(); } else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); tour.root.querySelector('[data-tour="next"]').click(); } else if (e.key === 'ArrowLeft') tour.root.querySelector('[data-tour="prev"]')?.click(); }, true);

// La primera vez que se entra a cada pantalla se ofrece su recorrido (una sola vez)
let cfg = null; let current = 'home';
function onView(view) {
  current = view; closePanel();
  cfg = cfg || pf.cfg?.() || {};
  if (cfg.noTours || !TOURS[view]) return;
  let done = true; try { done = localStorage.getItem('pf.tour.' + view) === '1'; } catch {}
  if (done) return;
  setTimeout(() => { if (current === view && !tour && !document.querySelector('#modal:not(.hidden)')) startTour(view); }, 900);
}

// ---- Panel de ayuda ----
const guideHtml = (g, open) => `<details class="hg" ${open ? 'open' : ''} data-g="${g.id}"><summary>${esc(g.title)}</summary><ol>${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`;
function open(opts = {}) {
  endTour();
  let host = $('#helpPanel');
  if (!host) { host = document.createElement('aside'); host.id = 'helpPanel'; host.className = 'help-panel'; document.body.appendChild(host); }
  const here = GUIDES.filter((g) => g.screens.includes(current));
  const lv = opts.level;
  host.innerHTML = `<div class="hp-head"><h3>${icon('help', 18)} Ayuda</h3><button class="ibtn" id="hpX" title="Cerrar (Esc)">${icon('x', 16)}</button></div>
    <div class="hp-body">
      <div class="hp-ask"><input id="hpQ" placeholder="¿Qué quieres hacer? Ej.: mover un logo, enviar a firmar…" spellcheck="false" /><div id="hpRes"></div>
        <p class="muted small">Busca en las guías de Studio. No usa IA ni gasta tokens.</p></div>
      ${TOURS[current] ? `<button class="secondary small with-ic hp-tour" id="hpTour">${icon('compass', 15)}<span>Ver el recorrido de esta pantalla</span></button>` : ''}
      ${!lv && here.length ? `<h4>En esta pantalla</h4>${here.map((g) => guideHtml(g)).join('')}` : ''}
      ${Object.entries(LEVEL_NAMES).filter(([k]) => !lv || k === lv).map(([k, name]) => `<h4>${name}</h4>${GUIDES.filter((g) => g.level === k && (lv || !here.includes(g))).map((g) => guideHtml(g, !!lv && false)).join('')}`).join('')}
      ${lv ? '<button class="ghost small" id="hpAll">Ver todas las guías</button>' : ''}
      <div class="hp-support"><b>¿No encuentras la respuesta?</b><p class="muted small">Escríbenos y te ayudamos.</p><button class="secondary small with-ic wa-btn" id="hpWa">${icon('whatsapp', 15)}<span>Hablar con soporte</span></button></div>
    </div>`;
  host.classList.add('open'); document.body.classList.add('help-open');
  $('#hpX').onclick = closePanel;
  $('#hpWa').onclick = () => window.studio?.whatsapp('Hola, necesito ayuda con PortalFirma Studio.');
  const t = $('#hpTour'); if (t) t.onclick = () => { closePanel(); startTour(current); };
  const all = $('#hpAll'); if (all) all.onclick = () => open();
  const q = $('#hpQ'); let tm = 0;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => {
    const r = search(q.value); const box = $('#hpRes');
    box.innerHTML = !q.value.trim() ? '' : r.length ? r.map((g, i) => guideHtml(g, i === 0)).join('') : '<p class="muted small">No encontré una guía para eso. Prueba con otras palabras o escribe a soporte.</p>';
  }, 180); };
  setTimeout(() => q.focus(), 50);
}
function closePanel() { const h = $('#helpPanel'); if (h) h.classList.remove('open'); document.body.classList.remove('help-open'); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#helpPanel.open')) { closePanel(); } });

// Botón «?» flotante
function mountFab() {
  if ($('#helpFab')) return;
  const b = document.createElement('button'); b.id = 'helpFab'; b.className = 'help-fab'; b.title = 'Ayuda: guías, recorrido y soporte'; b.innerHTML = `${icon('help', 20)}<span>Ayuda</span>`;
  b.onclick = () => ($('#helpPanel.open') ? closePanel() : open());
  document.body.appendChild(b);
}
mountFab();

window.Ayuda = { open, close: closePanel, startTour, endTour, onView, search, GUIDES, TOURS };
})();
