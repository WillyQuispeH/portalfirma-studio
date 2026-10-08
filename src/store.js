// Almacenamiento local. Los secretos (tokens OAuth) se cifran con el llavero
// del sistema (Keychain en Mac, DPAPI en Windows) vía Electron safeStorage.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'portalfirma.json');

function readAll() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}
function writeAll(data) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

function get(key) { return readAll()[key]; }
function set(key, value) {
  const d = readAll();
  if (value === undefined) delete d[key]; else d[key] = value;
  writeAll(d);
}

function getSecret(key) {
  const v = get(key);
  if (!v) return undefined;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(v, 'base64')));
    }
    return JSON.parse(Buffer.from(v, 'base64').toString('utf8'));
  } catch { return undefined; }
}
function setSecret(key, value) {
  if (value === undefined) return set(key, undefined);
  const raw = JSON.stringify(value);
  const enc = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(raw).toString('base64')
    : Buffer.from(raw, 'utf8').toString('base64');
  set(key, enc);
}

module.exports = { get, set, getSecret, setSecret };
