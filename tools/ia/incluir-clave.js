// Incluye la clave del asistente en la app antes de compilar.
// Uso: node tools/ia/incluir-clave.js <archivo-con-la-clave> [openai|anthropic] [modelo]
// Lee la clave desde un archivo (nunca por línea de comandos ni en pantalla) y escribe build/ia/clave.bin.
const fs = require('fs'); const path = require('path');
const MASK = Buffer.from('portalfirma-studio·asistente-legal');
const [file, provider = 'openai', model = ''] = process.argv.slice(2);
if (!file) { console.error('Falta el archivo con la clave.'); process.exit(1); }
const all = fs.readFileSync(file, 'utf8').match(/sk-[A-Za-z0-9_-]{20,}/g) || []; // admite .txt o .rtf
const key = all[0] || '';
if (all.length !== 1) { console.error(all.length > 1 ? 'El archivo tiene más de una clave.' : 'El archivo no contiene una clave con el formato esperado (sk-…).'); process.exit(1); }
const raw = Buffer.from(JSON.stringify({ provider, key, model }));
const out = Buffer.from(raw.map((x, i) => x ^ MASK[i % MASK.length]));
const dest = path.join(__dirname, '..', '..', 'build', 'ia', 'clave.bin');
fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, out);
console.log(`Clave incluida (${provider}, termina en …${key.slice(-4)}).`);
