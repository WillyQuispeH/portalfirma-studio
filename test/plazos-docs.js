// Contratos de prueba con texto real (fechas relativas a hoy) para el informe básico de Plazos.
const { PDFDocument, StandardFonts } = require('pdf-lib');
const M = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dia = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getDate()} de ${M[d.getMonth()]} de ${d.getFullYear()}`; };
const relleno = 'El Arrendatario se obliga a mantener la propiedad en buen estado de conservación y aseo, a pagar puntualmente los gastos comunes y consumos, y a restituirla al término del contrato en el mismo estado en que la recibió, habida consideración del desgaste por el uso legítimo. ';
const arriendo = (ini, extra = '') => `CONTRATO DE ARRENDAMIENTO

En Santiago de Chile, a ${dia(ini - 10)}, comparecen, por una parte, Inversiones Los Robles SpA, RUT 76.111.222-3, representada por don Juan Pérez Soto, cédula de identidad número 11.111.111-1, ambos domiciliados en Av. Italia 1000, Providencia, en adelante "EL ARRENDADOR", y por la otra doña María González Rojas, cédula de identidad número 22.222.222-2, domiciliada en Los Leones 200, Providencia, en adelante "EL ARRENDATARIO", quienes convienen el siguiente contrato:

PRIMERO: PROPIEDAD. El Arrendador da en arrendamiento el departamento ubicado en Av. Providencia 1234, depto 501, comuna de Providencia.

SEGUNDO: PLAZO. La duración del presente contrato será de 12 meses, a partir del día ${dia(ini)}, y se renovará en forma tácita y automáticamente por períodos iguales y sucesivos de 12 meses si ninguna de las partes diera aviso a la otra de su voluntad de ponerle término, mediante carta certificada con a lo menos 60 días de anticipación al vencimiento del período inicial o de cualquiera de sus prórrogas.

TERCERO: RENTA. La renta de arrendamiento mensual será la cantidad de $650.000, reajustable anualmente según la variación del IPC.
${extra}
CUARTO: OBLIGACIONES. ${relleno.repeat(4)}`;
const DOCS = {
  'Arriendo que vence.pdf': arriendo(-345),
  'Servicios anual.pdf': `CONTRATO DE PRESTACIÓN DE SERVICIOS

En Santiago, a ${dia(-300)}, entre Contadores Asociados Limitada, RUT 77.333.444-5, representada por don Pedro Rojas Lagos, en adelante "EL PRESTADOR", y Comercial Andes SpA, RUT 76.555.666-7, representada por doña Ana Silva Muñoz, en adelante "EL CLIENTE", se conviene:

PRIMERO: OBJETO. Servicios de asesoría contable mensual.

SEGUNDO: PLAZO. El presente contrato tendrá una duración de doce (12) meses a contar del ${dia(-290)}.

TERCERO: PRECIO. El precio de los servicios será de $500.000 mensuales.

CUARTO: OTROS. ${relleno.repeat(4)}`,
  'Contrato indefinido.pdf': `CONTRATO DE PRESTACIÓN DE SERVICIOS

En Santiago, a ${dia(-100)}, entre Aseo Total SpA, RUT 76.777.888-9, representada por don Luis Mena Díaz, en adelante "EL PRESTADOR", y Edificio Central, en adelante "EL CLIENTE", se conviene:

PRIMERO: OBJETO. Servicios de aseo de áreas comunes.

SEGUNDO: DURACIÓN. El presente contrato es de plazo indefinido y cualquiera de las partes podrá ponerle término con 30 días de aviso.

TERCERO: OTROS. ${relleno.repeat(4)}`,
  'Dos contratos.pdf': [arriendo(-160), arriendo(-300).replace('Av. Providencia 1234, depto 501', 'Calle Nueva 120, depto 1411')],
};
async function pdf(text) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  const parts = Array.isArray(text) ? text : [text];
  for (const t of parts) {
    let page = doc.addPage([612, 792]); let y = 750;
    for (const para of t.split('\n')) {
      const words = para.split(' '); let line = '';
      const flush = () => { if (y < 50) { page = doc.addPage([612, 792]); y = 750; } page.drawText(line, { x: 50, y, size: 10, font }); y -= 14; line = ''; };
      for (const w of words) { if (font.widthOfTextAtSize(line + ' ' + w, 10) > 510) flush(); line = line ? line + ' ' + w : w; }
      flush();
    }
  }
  return Buffer.from(await doc.save());
}
module.exports = { DOCS, pdf };
