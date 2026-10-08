# PortalFirma Studio

Editor PDF de escritorio de Portalfirma: crea, edita, convierte y prepara documentos, y envíalos a firmar, visar o legalizar con Portalfirma.

- **Mac** (Intel; en Apple Silicon funciona con Rosetta) y **Windows 10/11 de 64 bits:** versión 1.0.0-beta.

## Desarrollo (Windows)

Requisitos: Node.js 18+, Yarn 1 y Python 3. Las credenciales que no van en el repo están en `CREDENCIALES.md`.

| Comando | Qué hace |
|---|---|
| `yarn install` | Instala las dependencias |
| `yarn start` | Abre la app desde el código |
| `yarn demo` | Abre la app en modo de prueba (sin cuenta ni cobros) |
| `yarn instalador` | Genera `dist/PortalFirma-Studio-Setup-X.exe` |
| `yarn instalar` | Genera el instalador, lo instala en este equipo y abre la app |
| `yarn dist:mac` | Genera los instaladores de Mac (`.dmg` y `.zip`, Intel y Apple Silicon). Solo en un Mac |
| `yarn publicar` | Publica una versión nueva para Windows **y** Mac (ver abajo) |

**Publicar:** `yarn publicar` sube la versión (`1.0.0-beta.N`; o `yarn publicar 1.0.0` para una exacta), hace commit, crea la etiqueta `vX` y la sube. GitHub Actions (`.github/workflows/release.yml`) compila en una máquina Windows y otra Mac, y publica todo en la misma [release](https://github.com/WillyQuispeH/portalfirma-studio/releases). No hace falta token ni un Mac propio. Progreso en la pestaña [Actions](https://github.com/WillyQuispeH/portalfirma-studio/actions).

**Actualizaciones automáticas** (`src/updater.js`): la app revisa las releases al abrir y cada 4 horas (también en Ayuda → Buscar actualizaciones…).
- **Windows:** descarga la versión nueva sola y ofrece reiniciar.
- **Mac:** mientras la app no esté firmada con un certificado Developer ID de Apple, solo avisa y abre la página de descarga (Apple no permite que una app sin ese certificado se reemplace sola). Con el certificado: agregar los secretos `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` y poner `MAC_FIRMADA = true` en `src/updater.js`.
- **Mac sin firmar, primera vez:** clic derecho sobre la app → Abrir (o Configuración del Sistema → Privacidad y seguridad → Abrir igualmente).

---

## Si recibiste el instalador en partes

Los instaladores son un solo archivo: **Instalar PortalFirma Studio 1.0.0-beta.exe** (Windows, ~95 MB) e **Instalar PortalFirma Studio 1.0.0-beta.pkg** (Mac, ~140 MB). Así se publican en la web.

Cuando se envían por un canal que no acepta archivos grandes, van en partes de 19 MB junto con un archivo que las une, verifica que el instalador no esté dañado y lo abre:

- **Windows:** deja las partes `….exe.part0…part5` en una carpeta y haz doble clic en **Armar instalador 1.0.0-beta.bat**. El `.exe` queda en esa misma carpeta.
- **Mac:** deja las partes `….pkg.part0…part7` en una carpeta, abre **Armar instalador 1.0.0-beta.zip** y haz doble clic en **Armar instalador 1.0.0-beta**. El `.pkg` queda en esa carpeta y se abre el instalador.

Desde ahí, sigue los pasos de abajo.

## Instalar en Mac

1. Doble clic en **Instalar PortalFirma Studio 1.0.0-beta.pkg**. Se abre el instalador de macOS.
2. Sigue los pasos:
   - **Introducción:** qué hace el programa.
   - **Licencia:** lee los términos y condiciones y presiona **Aceptar**.
   - **Instalar:** macOS pide la contraseña de tu Mac.
   - **Resumen:** la app queda en Aplicaciones y en el Launchpad.
3. Si ya tenías una versión anterior, se reemplaza. Tus documentos, plantillas y configuración se conservan.
4. Si macOS dice que no puede verificar al desarrollador:
   - en versiones anteriores a macOS 15 (Sequoia), haz clic derecho sobre el instalador y elige **Abrir**;
   - en macOS 15 o posterior, ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso del instalador y presiona **Abrir igualmente**.
   - Esto pasa mientras el instalador no tenga la firma oficial de Apple.

La primera vez, macOS puede pedir la **contraseña del llavero**. Es la contraseña de tu Mac; elige **Permitir siempre**.

---

## Instalar en Windows (64 bits)

1. Doble clic en **Instalar PortalFirma Studio 1.0.0-beta.exe**.
   - Si Windows muestra «Windows protegió su PC», presiona **Más información** y luego **Ejecutar de todas formas**. Esto pasa mientras el instalador no tenga firma de código.
2. Sigue el asistente:
   - **Bienvenida.**
   - **Acuerdo de licencia:** lee los términos y condiciones y presiona **Acepto**.
   - **Para quién:** todos los usuarios del equipo o solo tú.
   - **Carpeta de instalación.**
   - **Instalar.**
   - **Finalizar:** con la opción de abrir PortalFirma Studio.
3. La app queda en el menú Inicio y en el escritorio como **PortalFirma Studio**. Se desinstala desde **Configuración → Aplicaciones**.
4. Los PDF, Word, Excel e imágenes aparecen con **Abrir con → PortalFirma Studio**. El programa predeterminado de cada tipo de archivo no cambia.
5. En Windows, los atajos usan **Ctrl** en vez de ⌘ (por ejemplo, Ctrl+F para buscar y Ctrl+P para imprimir). La pantalla completa es **F11**. La app muestra los atajos así en sus botones.

---

## Novedades de la 1.0 beta (antes 0.37): Agente Portalfirma

- **Agente Portalfirma**: botón **Agente** en la barra superior (o el buscador del inicio). Pídele lo que necesites en lenguaje natural y usa por ti **todas las herramientas de Portalfirma** (13 hoy; las que Portalfirma agregue aparecen solas):
  - sesión de la empresa, saldo y recarga;
  - subir documentos, buscar en ellos y extraer firmantes;
  - enviar a firmar (con código de descuento);
  - detalle de operaciones y búsqueda por RUT o teléfono;
  - reenviar enlaces, cambiar el correo o el tipo de firma de un firmante;
  - firma masiva con certificado CDS;
  - plantillas notariales y propiedades.
- **Documentos:** con el clip adjuntas el documento abierto en el editor o un PDF/Word del computador. El archivo va directo a Portalfirma, no al modelo de IA.
- **Confirmación:** las consultas corren solas. Lo que cobra, envía o notifica muestra una tarjeta con el detalle (firmantes en orden, pagador, monto) y espera tu **Confirmar**:
  - enviar a firmar y plantillas;
  - recarga;
  - reenvíos y cambios de firmante;
  - firma con certificado.
- **Firma con certificado:** la clave del certificado y el código SMS se escriben en un campo protegido de la tarjeta. Van directo a Portalfirma: nunca pasan por la IA ni se guardan.
- **Actividad:** registro de cada acción del agente, sin claves ni documentos.
- **Modelo y costo:** usa el modelo «mini» más nuevo de OpenAI. Cuesta 1 token del asistente cada 3 mensajes.

## Novedades de la 0.36

- **Instaladores completos:** un solo archivo por sistema, con asistente paso a paso y aceptación de los términos y condiciones.
  - Windows: `.exe`.
  - Mac: `.pkg`, con el instalador de macOS.
- **Inicio renovado:**
  - imagen de fondo y paneles de vidrio;
  - botones más claros;
  - al centro, el bloque **Notaría**, con **Gestión de firmas presenciales** (antes «Trámites notariales») y la **Notaría virtual**.
- **Recientes:**
  - el inicio muestra los 3 últimos y el botón **Ver todos**;
  - la pestaña **Recientes** tiene búsqueda, filtro por tipo (PDF, Word, Excel, imágenes) y páginas de 20;
  - desde cada documento puedes mostrarlo en su carpeta o quitarlo de la lista.
  - La lista guarda hasta 500 documentos.
- **Agregar un acto que no detectamos:** en la revisión del trámite, el cliente indica el acto y la frase donde aparece. Si el acto está en la planilla, se suma al cobro.
- **Reglas de detección** (interno Portalfirma, solo administradores):
  - las correcciones de los clientes quedan como casos, sin RUT, correos ni teléfonos;
  - la IA propone reglas y cada una se prueba contra los casos;
  - una persona las aprueba o descarta;
  - las aprobadas funcionan sin IA y se pueden exportar para publicarlas desde el servidor.

---

## Al abrir: inicio

El **Inicio** muestra las acciones principales y los **documentos recientes**:

- Abrir PDF
- Crear PDF
- Combinar archivos
- Convertir a PDF
- Editar texto e imágenes
- Reconocer texto (OCR)
- Organizar páginas
- Dividir PDF
- Comprimir PDF
- Exportar PDF
- Imprimir
- Firmar plano arquitectónico
- Enviar a firmar
- Notaría virtual
- Mis operaciones

La sesión de Portalfirma se pide **solo** para enviar a firmar, la Notaría virtual y Mis operaciones. El editor funciona sin iniciar sesión.

## Lector de PDF (nuevo en 0.8)

- **Pestañas:** cada documento se abre en su propia pestaña, junto a *Inicio*, como en Acrobat. El punto naranjo indica cambios sin guardar. Para cambiar de pestaña: clic, o ⌃Tab / ⌃⇧Tab. Para cerrar: la ✕ de la pestaña o ⌘W. Si abres un archivo que ya está abierto, la app cambia a su pestaña.
- **Desplazamiento continuo:** las páginas van una tras otra; se dibujan solo las que están cerca de la vista, así que los documentos largos abren rápido. Escribe un número en la barra de página para saltar a esa página.
- **Seleccionar y copiar texto** con la herramienta *Seleccionar* (⌘C).
- **Buscar (⌘F):** no distingue mayúsculas ni tildes ("garantia" encuentra "Garantía"). Enter o ⌘G va al siguiente resultado; ⇧Enter o ⇧⌘G, al anterior. En fotocopias, primero usa *Reconocer texto*.
- **Enlaces:** los enlaces internos llevan a la página. Los enlaces a sitios web piden confirmación antes de abrirse en el navegador.
- **Marcadores:** pestaña *Marcadores* del panel izquierdo, con el índice del PDF.
- **Imprimir (⌘P):** se abre el diálogo de impresión del sistema, donde puedes elegir impresora, páginas y tamaño de papel. Se imprime con los cambios todavía no guardados. Las páginas se ajustan a la hoja y las horizontales se giran solas.
- **Pantalla completa (⌃⌘F):** modo lectura sin barras. Esc para salir.
- La barra superior tiene íconos de **Abrir, Guardar, Imprimir, Buscar y Combinar**. El botón rojo **Reconocer texto** está siempre a la vista.

## Menú Archivo

| | |
|---|---|
| Inicio | ⇧⌘H |
| Crear PDF… | ⌘N |
| Abrir… | ⌘O |
| Abrir reciente ▸ | |
| Combinar archivos… | ⇧⌘M |
| Convertir a PDF… | |
| Guardar | ⌘S |
| Guardar como… | ⇧⌘S |
| Exportar ▸ | Word, PNG, JPG, texto |
| Imprimir… | ⌘P |
| Firmar plano arquitectónico… | |
| Enviar a firmar… | ⌘↩ |
| Cerrar documento | ⌘W |

- **Herramientas:** Editar texto (⌘E), Agregar texto (⌘T), Imagen, Tapar, Reconocer texto (⇧⌘R), Comprimir, Dividir, Numerar, Marca de agua.
- **Edición:** Buscar (⌘F), Buscar siguiente (⌘G), Buscar anterior (⇧⌘G).
- **Ver:** zoom, pantalla completa (⌃⌘F), pestaña siguiente y anterior (⌃Tab y ⌃⇧Tab).
- Si cierras con cambios sin guardar, la app pregunta si quieres guardarlos. Los PDF también se pueden abrir con "Abrir con…" o arrastrándolos al Dock.

## Novedades de la 0.31

- **Menú del usuario** (arriba a la derecha): iniciales, nombre y tokens del asistente siempre visibles. Al abrirlo muestra empresa y rol, saldo de Portalfirma (con «Recargar»), tokens (con «Comprar / código»), accesos a Mis operaciones, Plazos, Expedientes y Google Drive, ayuda, recorrido, soporte, la cuenta en la web, cerrar sesión y la versión.
- **Google Drive:** el selector de archivos ahora se abre en tu navegador, donde ya tienes la sesión de Google (dentro de la app Google pedía iniciar sesión y la ventana no se podía cerrar). En Studio queda un aviso con «Cancelar» y «Abrir de nuevo en el navegador»; al elegir, Studio vuelve al frente solo.

## Novedades de la 0.30

- **Inicio por niveles:** «Lo esencial», «Para ahorrar tiempo» y «Avanzado», cada función con una línea que explica para qué sirve. Las funciones nuevas llevan «Nuevo» hasta que se abren.
- **Ayuda:** botón «?» abajo a la derecha en todas las pantallas, con guías paso a paso, un buscador de dudas (no usa IA ni gasta tokens), el recorrido de la pantalla y el contacto con soporte. La primera vez que entras a cada pantalla se muestra un recorrido corto.
- **Editor:**
  - **Mover (mano, tecla H o barra espaciadora):** mueve textos, imágenes y campos, o desplaza la página.
  - **Agregar texto:** dibujas el recuadro y escribes dentro; después vuelve a Seleccionar. En el panel hay modelos listos (Título y párrafo, Título, Subtítulo, Párrafo, Cláusula y Nota) con texto de ejemplo que se reemplaza al escribir.
  - **Seleccionar un área:** toma los objetos que quedan completos dentro del recuadro, incluidas las imágenes del PDF (un logo, por ejemplo), que quedan movibles. Varios objetos se mueven o se quitan juntos.
  - **Zoom:** ahora se puede desplazar hacia los lados.
  - **Panel derecho:** pestañas Edición, Asistente y Plantilla, y ancho ajustable arrastrando su borde (doble clic para volver al ancho normal).
  - **Reconocer texto:** ahora con el mismo azul de «Enviar a firmar».

## Mis operaciones por la API de Portalfirma (nuevo en 0.29)

- Mis operaciones ya no pide el teléfono: se inicia sesión con el **correo y la contraseña** de la cuenta de empresa y Studio trae todas las operaciones de la cuenta (en firma, firmadas, legalizadas y por pagar), con firmantes y documento, directo desde la API.
- La sesión se guarda cifrada y se renueva sola. El ícono de persona en Mis operaciones muestra la cuenta y permite cerrar sesión.
- Enviar a firmar, Notaría virtual, firma masiva y reenvío de enlaces siguen por la conexión anterior mientras se completan en la API.

## Conexión directa con Portalfirma (prueba, 0.27–0.28)

- 0.28: la sesión usa las cookies «auth-token» / «refresh-token» que define la API y se renueva sola cuando vence.

- **Ayuda › Conexión directa con Portalfirma (diagnóstico)…** (o «Probar inicio con correo y contraseña» en la pantalla de inicio de sesión): inicia sesión con el correo y la contraseña de la cuenta de empresa, directo contra la API de Portalfirma. Studio guarda solo la sesión cifrada; la contraseña no se guarda.
- «Ejecutar diagnóstico» consulta en modo lectura las operaciones, el saldo y un documento, y guarda en Descargas un archivo con la **estructura** de las respuestas (sin nombres, RUT, correos ni montos). Con ese archivo se completa el paso de toda la app a la API.
- Los documentos de Mis operaciones ya no piden el código de acceso: viene incluido.

## Documentos de Portalfirma por el servicio oficial (nuevo en 0.26)

- Los PDF de tus operaciones (vista previa y descarga en Mis operaciones, «Traer de Portalfirma» en Plazos, «Ver» desde el historial de un expediente) se obtienen **solo** del servicio oficial de archivos de Portalfirma (`POST https://api.portalfirma.cl/api/file/getById`). Se eliminó la descarga por el enlace anterior.
- Cada operación muestra un único documento; las etapas (Enviado → Firmado → Legalizado/Protocolizado) quedan como estado.
- La primera vez Studio pide el **código de acceso** al servicio de archivos que entrega Portalfirma; queda cifrado en este equipo.

## Plazos y vencimientos en la barra superior (nuevo en 0.20)

- Botón **«Plazos y vencimientos»** en la barra de arriba, a la derecha de Mis operaciones.
- **Traer de Portalfirma:** sincroniza Mis operaciones y agrega la versión firmada (o legalizada) de cada operación finalizada que aún no esté en la lista. Hoy Portalfirma todavía no entrega los PDF a la app; la app lo explica y, cuando se corrija, el botón funciona sin cambios.

## Plazos y vencimientos (0.19)

- Agrega tus contratos (PDF o Word, desde el computador o Google Drive). La IA lee cada uno (1 token por documento) y extrae partes, objeto, inicio, plazo, término, renovación automática, aviso y reajuste.
- **Tabla ordenada por la fecha clave**, de la más cercana a la más lejana: 🔴 30 días o menos (o vencida), 🟡 hasta 90 días, 🟢 más de 90 días o indefinido. Si el contrato se renueva solo, la fecha clave es el **último día para avisar**; si ese día ya pasó, se avisa que se renovará.
- Al elegir uno: sugerencias de la IA (carta de término anticipado o de no renovación, anexo de reajuste o de renovación, o «Déjalo así» si es indefinido). **Redactar** (2 tokens) crea el documento con los datos de las partes y el objeto del original, listo para completar y enviar a firmar.
- **Agregar al calendario** (.ics con aviso 7 días antes) y una notificación del sistema cuando algo vence en los próximos 30 días.

## Google Drive → firma (0.18)

- Explorador de Google Drive: **Mi unidad** con carpetas, **Compartidos conmigo** y búsqueda en todo el Drive. Se marcan uno o varios documentos, o **toda una carpeta**.
- **Enviar a firmar:** un documento va al flujo normal (firmantes detectados); varios o una carpeta completa pasan a la **carga masiva**.
- También: **Abrir en Studio** y **Convertir en plantilla**.
- Se abre desde el inicio («o tráelos desde Google Drive»), desde Enviar a firmar, desde la carga masiva y desde Mis plantillas.
- Mis operaciones: una operación cerrada sin todas las firmas ya no aparece como firmada/legalizada. Si Portalfirma no entrega el PDF, se explica y se ofrece ir a portalfirma.cl.

## Mis operaciones sincronizadas (0.17)

- Trae todas las operaciones de tu cuenta de Portalfirma: la primera vez pide el teléfono con el que te registraste. Se actualiza sola cada 5 minutos y con el botón **Sincronizar**; queda una copia en el computador para abrir rápido.
- Filtros (En firma, Firmadas, Legalizadas/protocolizadas, Requieren acción) y buscador por documento o número.
- En cada operación: **versiones** Original → Firmado → Legalizado/Protocolizado, vista previa, **Descargar** (una versión o todas), **Compartir** (en Mac, el menú del sistema; en Windows, el archivo queda marcado en su carpeta), **Abrir en Studio**, y los firmantes con su estado; a los pendientes se les puede reenviar el enlace (con confirmación).

## Carga masiva (nuevo en 0.17)

- Arrastra muchos PDF o Word: se revisan en el computador (formato, peso, duplicados), Word se convierte a PDF y se suben y analizan **de a 2**, con reintentos automáticos y una pausa breve si Portalfirma responde con errores. **Pausar / Reanudar**; la cola se guarda si cierras la app.
- Revisa los firmantes detectados en cada documento (o usa los mismos en todos) y envía con **una sola confirmación**; los envíos van de a uno y nunca se reintentan solos, para no duplicar operaciones ni cobros. Avisa si un archivo ya se había enviado.
- **Firma masiva con certificado:** RUT → operaciones pendientes → clave del certificado → código por SMS/WhatsApp → se firman todas. La clave va directo a Portalfirma y no se guarda.

## Acceso para clientes de Portalfirma (0.16)

- Al abrir la app sin sesión aparece la bienvenida, con tres opciones: **Iniciar sesión con Portalfirma**, **Crear una cuenta en Portalfirma** o **Continuar solo con las funciones básicas**.
- **Sin cuenta** se puede abrir, crear, combinar, convertir, editar, organizar, dividir, comprimir, exportar e imprimir PDF, armar plantillas a mano e importar desde Google Drive.
- **Solo para clientes** (con candado hasta iniciar sesión): Enviar a firmar, Notaría virtual, Mis operaciones, Firmar plano arquitectónico y todo lo que usa IA (Asistente legal, Redactar, Mejorar con IA, Detectar con IA). Al presionarlos se pide iniciar sesión y luego se continúa donde estabas.
- El bloqueo de la IA también se aplica en el proceso principal de la app, no solo en los botones.

## Nuevo inicio (0.15)

Pantalla de inicio en tres columnas: a la izquierda Enviar a firmar, Notaría virtual y las utilidades de PDF; al centro el área para arrastrar o abrir documentos, con Crear PDF, Enviar a firmar y Plantillas con campos, más Recientes y Mis plantillas; a la derecha Mis operaciones, el Asistente legal y las funciones especializadas.

## Importar plantillas desde Google Drive (0.14)

En el inicio, **Mis plantillas → Importar de Google Drive**: conectas tu cuenta de Google (en el navegador), buscas un Google Docs, Word o PDF y se abre listo para marcar sus campos, a mano o con «Detectar con IA». La app solo lee los archivos que eliges y nunca modifica tu Drive.

**Ya viene activado:** la credencial de Google de Portalfirma (proyecto «portalfirma-studio») va incluida en la app. Mientras Google no verifique la app, solo pueden conectar las cuentas agregadas como usuarios de prueba en Google Cloud (hasta 100).

## Redactar documentos con IA (0.13)

- **Asistente legal → Redactar** (o la tarjeta del inicio): describes el documento y se abre **directo como formulario**, con todos los datos variables ya convertidos en campos. Los datos que mencionaste vienen prellenados. Se agrega el correo de cada firmante para enviarlo a firmar.
- **Mejorar con IA** (1 token por cambio): «agrega una cláusula de codeudor solidario», «plazo indefinido con aviso de 60 días»… Se conservan los datos ya escritos.
- **Editar el texto a mano** (gratis): el texto con los campos entre [[ ]].
- Siempre termina con la leyenda fija de firma electrónica avanzada (Ley N° 19.799). No lleva pies de firma: los agrega Portalfirma al firmar.
- **No se redactan** pagarés (se ofrece un mandato para suscribir el pagaré), autorizaciones de salida del país de menores ni finiquitos, porque requieren presencialidad en notaría. El bloqueo no gasta tokens.
- «Guardar como plantilla…» deja el documento en Mis plantillas.

## Tokens del asistente (0.12)

| Acción | Tokens |
|---|---|
| Revisar documento | 1 |
| Preguntar (bloque de 3 preguntas) | 1 |
| Detectar campos de una plantilla | 2 |
| Redactar un documento | 2 |
| Cada cambio pedido a la IA | 1 |
| Analizar los plazos de un documento | 1 |
| Chequeos de RUT y montos, aplicar sugerencias | Gratis |

- Al instalar: **5 tokens de bienvenida**.
- **Paquete de tokens:** 20 tokens por $10.000. Se compra con el botón **Comprar por WhatsApp** (soporte +56 92525400) y se activa con el código que envía soporte.
- Solo se descuenta si la respuesta llega bien.
- El saldo se ve en el panel del asistente (Comprar / código).
- **Etapa de prueba:** el saldo vive en el computador y el código es fijo. Antes del lanzamiento, el saldo pasará a la cuenta Portalfirma.

## Detectar campos con IA (nuevo en 0.12)

En **Plantilla → Detectar con IA**, la IA lee el documento y propone los campos: nombres, RUT, fechas, montos y datos de cada firmante. Revisas la lista (desmarcas o renombras) y se marcan todas sus apariciones de una vez.

## Soporte por WhatsApp (nuevo en 0.12)

Botón verde **Soporte** en la barra del editor.

## Asistente legal con IA (0.11)

Botón **Asistente** en la barra del editor (o la tarjeta «Asistente legal» en el inicio).

- **Revisar:** ortografía, redacción, datos que no calzan, lo que falta (plazo, término, forma de pago…) y riesgos. Cada observación se **aplica** con un clic (el párrafo se reescribe con la misma fuente y el texto anterior se borra del PDF), se **ve** en el documento o se **descarta**. ⌘Z deshace.
- **Chequeos exactos sin IA:** dígito verificador de los RUT y monto en cifras vs. monto en palabras.
- **Redactar:** describe el documento y se abre un borrador como PDF editable en una pestaña nueva, con los datos faltantes como [CAMPOS]. Se puede convertir en plantilla.
- **Preguntar:** consultas sobre el documento abierto.
- Las normas citadas se marcan en amarillo «por verificar». El asistente **no reemplaza la revisión de un abogado**.
- La primera vez pide consentimiento: el texto del documento se envía al proveedor de IA.

## Tamaño del texto (0.10.3)

- El panel **Formato** tiene botones **−** y **+** que cambian el tamaño de a 0,5 pt sin perder la selección. También puedes escribir el tamaño y presionar **Enter**.
- **Con palabras seleccionadas**, cambia solo esas palabras.
- **Sin selección**, cambia todo el párrafo en la misma proporción, incluidos los trozos que tenían otro tamaño (algo frecuente en textos reconocidos por OCR). El tamaño que muestra el panel es el del texto bajo el cursor.
- Antes, en textos reconocidos por OCR, achicar podía agrandar el párrafo, y el número que se escribía se borraba mientras se escribía.

## Plantillas con campos (nuevo en 0.10)

Convierte tus propios contratos en plantillas: marcas los datos que cambian, los llenas en un formulario y generas el PDF listo para firmar.

**Crear una plantilla**

1. Abre el contrato (PDF, Word o fotocopia) y presiona **Plantilla** en la barra superior (o **Archivo → Crear plantilla con este documento**).
2. Haz clic en un párrafo y selecciona con el mouse las palabras que cambian, por ejemplo un nombre.
3. Presiona **Convertir en campo**. La app propone el tipo según el texto: RUT, fecha, monto, correo, teléfono o texto.
4. Si el mismo dato aparece en otras partes (por ejemplo, el nombre en la zona de firmas), la app ofrece marcarlo en todas para llenarlo una sola vez.
5. Opcional: marca el campo como **dato de un firmante** (rol + nombre, RUT, correo o teléfono). Al enviar a firmar, esos firmantes ya vienen cargados.
6. **Guardar plantilla.** Queda en **Mis plantillas**, en el inicio. También puedes exportarla como un PDF para compartirla: en cualquier otro lector se ve como el contrato original.

**Llenar una plantilla**

1. En **Mis plantillas**, presiona **Llenar**.
2. Completa el formulario de la derecha; el documento se actualiza mientras escribes.
3. Presiona **Generar documento**. Se crea un PDF nuevo en otra pestaña (la plantilla no cambia), listo para guardar o **Enviar a firmar**.

**Tipos de campo y formatos**

| Tipo | Escribes | Queda en el documento |
|---|---|---|
| Texto | juan pérez | Juan Pérez o JUAN PÉREZ (como el original) |
| RUT | 123456785 | 12.345.678-5 (se valida el dígito verificador) |
| Fecha | 15/10/2026 | 15 de octubre de 2026, 15-10-2026 o 15/10/2026 |
| Monto | 1250000 | $1.250.000 (un millón doscientos cincuenta mil pesos) |
| Número | 12 | 12, doce o doce (12) |
| Correo y teléfono | 987654321 | +56 9 8765 4321 |
| Lista de opciones y texto largo | | |

**Para que el documento no se descomponga:**
- El párrafo se vuelve a armar con la misma fuente, tamaño, alineación e interlineado.
- Si el dato es más largo, el párrafo usa el espacio en blanco de abajo.
- Si aun así no cabe, la letra se achica hasta medio punto.
- Si tampoco alcanza, el campo se marca en rojo con «No cabe» y el documento no se genera hasta acortar el dato.
- Un RUT, teléfono o correo nunca se corta entre dos líneas.
- Las firmas en dos columnas se tratan como dos párrafos separados.

## Enviar a firmar un Word (0.10.1)

Portalfirma recibe PDF. Si eliges o arrastras un Word (.docx) en **Enviar a firmar**:

- La app lo convierte a PDF antes de subirlo.
- Muestra un aviso con el botón **Ver PDF** para revisar cómo quedó el formato.
- Si el servidor rechaza el envío (por ejemplo, con un error 500), la app lo dice claramente y sugiere revisar **Mis operaciones** antes de reintentar. Ya no muestra «Enviado a firmar».
- **Mis operaciones** solo lista los envíos que Portalfirma aceptó, con su número de operación. Los errores técnicos del servidor se muestran con un mensaje simple (0.10.2).

## Texto transparente (nuevo en 0.10)

Al editar un párrafo de un PDF digital, el texto original **se borra de verdad del archivo**: ya no se tapa con un recuadro del color del papel.

- El fondo (líneas, logos, timbres, marcas de agua) queda intacto.
- Nadie puede copiar el texto antiguo desde el PDF.
- Lo mismo pasa con **Tapar**: además del recuadro, el texto que queda debajo se borra del archivo.
- En fotocopias y escaneos el texto es parte de la imagen, así que ahí se sigue usando el color del papel.

## Fuentes (nuevo en 0.9)

El editor trae **98 familias de fuentes** en normal, **negrita**, *cursiva* y ***negrita cursiva***. Las fuentes manuscritas solo traen su estilo normal. En el panel **Formato** se ordenan en cinco grupos y se ve una muestra de la fuente elegida:

| Grupo | Ejemplos |
|---|---|
| Equivalentes a fuentes de Office | Arial, Times New Roman, Calibri, Cambria, Courier New, Georgia, Garamond, Century Gothic, Book Antiqua / Palatino, Bookman Old Style, Century Schoolbook, Arial Narrow, Verdana / Tahoma, Franklin Gothic, Baskerville, Comic Sans, Monotype Corsiva, Segoe UI, Trebuchet MS |
| Sin serifa | Roboto, Open Sans, Lato, Montserrat, Poppins, Raleway, Inter, Nunito, Source Sans, Noto Sans, PT Sans, Work Sans, Fira Sans, IBM Plex Sans, Ubuntu, Oswald y otras |
| Con serifa | Merriweather, Lora, Playfair Display, PT Serif, Noto Serif, Source Serif, Crimson Pro, Cormorant Garamond, Roboto Slab, Spectral, Vollkorn, Cinzel y otras |
| Monoespaciadas | Roboto Mono, Source Code Pro, IBM Plex Mono, Courier Prime, Inconsolata (Consolas), JetBrains Mono, Fira Code, Special Elite (máquina de escribir) |
| Manuscritas y decorativas | Dancing Script, Great Vibes, Pacifico, Caveat, Allura, Parisienne, Alex Brush, Pinyon Script, Homemade Apple, Lobster, Bebas Neue, Abril Fatface y otras |

- Al **editar un PDF**, la app reconoce estas fuentes por su nombre y usa la misma o su equivalente. En la prueba con las 98 familias acertó en las 299 líneas.
- Las fuentes «equivalentes a Office» son libres y tienen las mismas medidas, o muy parecidas, que las originales de Microsoft, para que el texto ocupe el mismo espacio.
- Al **exportar a Word**, cada texto queda con el nombre de la fuente de Office correspondiente (Georgia, Garamond, Century Gothic…).
- Todas las fuentes son de licencia libre (SIL OFL, Apache, GUST, Bitstream Vera/DejaVu) y se incrustan en el PDF.

## Editar texto (como en Acrobat)

1. Elige **Editar texto**. La app marca cada **párrafo** del PDF con un recuadro.
2. Haz clic en un párrafo y escribe. El texto se reacomoda dentro del párrafo.
3. **Reconocimiento de fuente:** se identifica la fuente original y se usa una equivalente con las mismas medidas.

   | Fuente original | Fuente equivalente que usa la app |
   |---|---|
   | Arial / Helvetica | Liberation Sans |
   | Times New Roman | Liberation Serif |
   | Calibri | Carlito |
   | Cambria | Caladea |
   | Courier | Liberation Mono |

   Se conservan el tamaño, el color de la tinta, las negritas y cursivas, la alineación y el interlineado. La fuente detectada aparece en el panel **Formato**.
4. **Panel Formato:** fuente, tamaño, color, negrita, cursiva, subrayado, superíndice, subíndice, alineación e interlineado. Si seleccionas palabras, el cambio se aplica solo a ellas; si no, a todo el párrafo.
5. Al guardar, el texto queda en el PDF **exactamente como se ve en pantalla**, con la fuente incrustada (tildes y ñ incluidas).

Otras herramientas de edición:
- **Agregar texto:** clic donde quieras escribir, con la fuente que elijas.
- **Imagen:** logos, timbres escaneados o fotos.
- **Tapar:** cubre un área con el color del fondo.

> **Importante:** en un PDF digital, el texto original queda **tapado** bajo el nuevo, invisible pero presente en el archivo. Si debe desaparecer por completo (por ejemplo, un dato sensible), usa **Aplanar** en la barra de páginas: la página pasa a ser una imagen de alta resolución, y luego puedes reconocer su texto.

## Fotocopias y escaneos: Reconocer texto (OCR)

- Al abrir una página que es solo imagen, aparece el aviso **Reconocer esta página / Reconocer todo**.
- El OCR funciona **sin internet** y en español. Toma unos 3 a 4 segundos por página.
- Después del reconocimiento:
  - **Buscar y copiar:** el texto queda como capa invisible bajo la imagen.
  - **Editar:** se usa *Editar texto* igual que en un PDF digital.
  - **Fuente:** la app compara cada línea escaneada con las fuentes candidatas y elige la más parecida. En la prueba reconoció Times New Roman y el título en negrita, con un tamaño de 16,2 pt frente a los 15,8 reales.
  - **Tono del papel:** al reescribir se usa el color del papel y de la tinta, para que no quede un parche blanco.
- La calidad depende de la nitidez del escaneo. Revisa números y signos: por ejemplo, "N°" puede salir como "N*".

## Firmar plano arquitectónico

**Archivo → Firmar plano arquitectónico** (o el botón del inicio):

1. Junta las láminas en un PDF.
2. Si pesan mucho, las comprime. Un plano A0 de prueba pasó de 31,9 MB a 1,0 MB.
3. Agrega al final una **hoja de firmas tamaño carta** con:
   - proyecto, dirección o rol y profesional responsable,
   - el detalle de cada lámina (formato A0, A1… y medidas),
   - la huella digital SHA-256 de las láminas,
   - una cláusula que vincula las firmas con todas las láminas.
4. Las firmas quedan a tamaño normal en esa hoja. Luego: **Enviar a firmar**.

> Hay que confirmar con el equipo de Portalfirma que el servidor pone las firmas en la **última página**, que es la hoja de firmas.

## Organizar, convertir, exportar

- **Combinar / Convertir:** PDF, Word (.docx), Excel (.xlsx, .xls, .csv, .ods) e imágenes, en un solo PDF.
- **Páginas:** reordenar arrastrando, rotar, insertar en blanco, extraer, **dividir** (cada N páginas o por rangos), aplanar y eliminar.
- **Numerar / foliar** y **marca de agua**.
- **Comprimir:** solo recomprime las imágenes. Los planos vectoriales pesan por el dibujo.
- **Exportar:**
  - **Word (.docx):** texto editable con negritas y cursivas; las páginas escaneadas se reconocen antes.
  - **Imágenes PNG o JPG:** a 150 o 300 ppp.
  - **Texto (.txt).**

---

## Para el equipo técnico

### Estructura

```
src/main.js                 ventana, menú nativo, recientes, guardar/exportar (docx), aviso de cambios sin guardar
src/convert.js              Word/Excel/CSV → PDF (mammoth, SheetJS, impresión de Chromium)
src/portalfirma.js          inicio de sesión OAuth + herramientas del conector (MCP)
src/renderer/home.js        pantalla de inicio, recientes, acciones del menú
src/renderer/editor.js      editor y lector: pestañas, vista continua, búsqueda, enlaces, impresión (pdf.js + pdf-lib + fontkit + Tesseract)
src/renderer/icons.js       íconos SVG de la interfaz
src/renderer/fonts.js       catálogo de fuentes (generado), declara las @font-face
src/renderer/templates.js   Notaría virtual
src/renderer/vendor/        pdf.js, pdf-lib, fontkit, tesseract (+ modelo español), fuentes
test/*.js                   pruebas de punta a punta (modo demostración); reader-e2e.js prueba el lector
```

### Cómo funciona la edición de texto

1. pdf.js entrega los fragmentos de texto con su fuente, tamaño y posición.
2. Se agrupan en líneas y luego en párrafos, y se detecta la alineación y el interlineado.
3. Al editar, el párrafo se vuelve un bloque editable con la fuente equivalente, el kerning desactivado para que la pantalla coincida con el PDF, y la línea base calculada con las métricas de la fuente.
4. Al guardar:
   - se mide la posición exacta de cada palabra en pantalla,
   - se tapa el original con el color de fondo muestreado,
   - y se escribe cada palabra en esa misma posición con la fuente incrustada (subconjunto).

### OCR

- Tesseract.js 6, modelo `spa` *best_int*, en WebAssembly, sin red.
- Para reconocer la fuente se compara, por correlación, cada línea escaneada con el mismo texto dibujado en 8 variantes de fuente (familia y negrita).

### Lector

- **Pestañas:** cada pestaña guarda su propio estado (documento, cambios, deshacer, OCR, búsqueda y posición). Mientras corre una operación (OCR, comprimir…), no se puede cambiar de pestaña.
- **Vista continua:** un `IntersectionObserver` dibuja las páginas a menos de 900 px de la vista y libera las que se alejan. La página activa recibe la capa de edición.
- **Texto, búsqueda y enlaces:**
  - la capa de texto es `renderTextLayer` de pdf.js;
  - la búsqueda normaliza tildes y mayúsculas y resalta dentro de esa capa;
  - los enlaces salen de `getAnnotations`.
- **Impresión:** cada página se rasteriza a unos 200 ppp, se arma un HTML con una página por hoja y se imprime con `webContents.print`.

### Texto transparente y plantillas

- `src/renderer/pdftext.js` lee las instrucciones de dibujo de la página:
  - calcula la posición de cada letra (matriz de texto, anchos de la fuente, espaciado, fuentes Type0/Identity-H, TrueType, Type1 estándar y Type3, formularios XObject);
  - borra solo las letras dentro de la zona, reemplazándolas por un desplazamiento equivalente para que el resto no se mueva.
- Después del borrado, la app comprueba con pdf.js que no quede texto en la zona. Si queda algo (por ejemplo, una codificación no soportada), vuelve al recuadro de color.
- `src/renderer/plantillas.js` maneja el diseño, el formulario, los formatos chilenos (RUT, fechas, montos en palabras) y las reglas de reflujo.
- La plantilla es un PDF con un adjunto `portalfirma-plantilla.json`. Mis plantillas se guardan en la carpeta de datos de la app.

### Asistente (IA)
- `src/ai.js` (proceso principal) llama a OpenAI o Anthropic. La clave **nunca llega a la ventana**.
- **Clave incluida** (la usa Portalfirma): `node tools/ia/incluir-clave.js <archivo> openai [modelo]` antes de compilar → `build/ia/clave.bin` (va a los recursos de la app). Los usuarios no ven ni cambian la clave. Ojo: la clave va ofuscada, no cifrada; quien desarme la app podría extraerla. Por eso: clave exclusiva para la app, con límite de gasto mensual. Para que sea imposible de extraer, las llamadas deben pasar por el servidor de Portalfirma.
- Sin clave incluida, cada usuario ingresa la suya en Asistente → Ajustes (se guarda cifrada con el llavero del sistema).
- `src/renderer/asistente.js`: panel, revisión (JSON), aplicar sugerencias, borrador (markdown → HTML → PDF carta), preguntas.

### Google Drive
- `src/gdrive.js`: OAuth de escritorio (navegador del sistema, redirección a 127.0.0.1, PKCE), permiso `drive.readonly`, token cifrado. Google Docs se exportan a PDF; Word pasa por la conversión de la app.
- Credenciales: el cliente OAuth «App de escritorio» de Portalfirma va en `build/google/oauth.json` (el JSON que descarga Google Cloud) y se incluye al compilar.
- Para el lanzamiento, Google exige verificar la app; `drive.readonly` es un permiso restringido que además pide una evaluación de seguridad. Alternativa sin evaluación: `drive.file` con el selector de Google (Picker) alojado en una página web de Portalfirma.

### Fuentes

- Para regenerar el catálogo, usa `tools/fonts/build_fonts.py` y `tools/fonts/fix_names.py`. Hacen lo siguiente:
  - descargan las fuentes de Google Fonts y de los paquetes TeX Gyre y DejaVu;
  - fijan las fuentes variables en peso 400 y 700;
  - convierten las OTF (CFF) a TrueType;
  - recortan cada fuente a los caracteres latinos;
  - corrigen los nombres y pesos internos.
- Los glifos se guardan alineados a 4 bytes porque, sin eso, fontkit (pdf-lib) corrompe algunas fuentes al recortarlas.

### Compilar

```bash
npm install
npm start            # desarrollo
PF_MOCK=1 npm start  # demostración sin cuenta
npm run dist:mac     # Mac
npm run dist:win     # Windows 64 bits (en Windows, o en Linux con Wine): dist/PortalFirma-Studio-Setup-<versión>-x64.exe
```

### Pendiente

- Firma y notarización de Apple, y firma de código en Windows, para que no aparezcan advertencias al instalar. Con la firma de Apple también se puede distribuir como `.dmg` estándar.
- Plantillas: correr el resto de la página cuando un párrafo crece, pasar a una página nueva, detección automática de campos sin seleccionar y llenado masivo desde Excel (fases 3 a 5 de la estrategia).
- Confirmar con el servidor de Portalfirma la posición de las firmas (hoja de firmas), el formato de fecha de las plantillas y la respuesta de `send_sign`.
