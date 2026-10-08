// Genera test/fixtures/lector.pdf: varias páginas con títulos (índice), enlaces internos y externos.
const { app, BrowserWindow } = require('electron'); const fs = require('fs'); const path = require('path');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  const sec = (n, t) => `<h1 id="s${n}">${n}. ${t}</h1>` + Array.from({ length: 9 }, (_, k) => `<p>Párrafo ${k + 1} de la sección ${n}. El arrendatario declara conocer el inmueble ubicado en Avenida Providencia 1234, comuna de Providencia. ${k === 4 ? 'La garantía equivale a un mes de renta.' : ''}</p>`).join('') + '<div style="break-after:page"></div>';
  const html = `<html><head><meta charset="utf-8"><style>body{font-family:Arial;font-size:13pt} h1{font-size:20pt}</style></head><body>
    <h1>Índice</h1><p><a href="#s1">Ir a 1. Partes</a></p><p><a href="#s2">Ir a 2. Renta</a></p><p><a href="#s3">Ir a 3. Garantía</a></p>
    <p>Sitio: <a href="https://www.portalfirma.cl">www.portalfirma.cl</a></p><div style="break-after:page"></div>
    ${sec(1, 'Partes')}${sec(2, 'Renta')}${sec(3, 'Garantía')}${sec(4, 'Término')}</body></html>`;
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await w.webContents.printToPDF({ pageSize: 'Letter', generateDocumentOutline: true, generateTaggedPDF: false });
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'lector.pdf'), pdf); console.log('ok', pdf.length); app.quit();
});
