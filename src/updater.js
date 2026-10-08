// Actualizaciones automáticas desde GitHub Releases (WillyQuispeH/portalfirma-studio).
// Al abrir busca una versión nueva, la descarga en segundo plano y ofrece reiniciar.
// Solo corre en la app instalada (no en `yarn start`) ni en modo de prueba.
// Mac: Apple solo permite reemplazar la app si está firmada con un certificado Developer ID.
// Mientras no lo tengamos, en Mac solo avisamos y abrimos la página de descarga.
const { app, dialog, shell } = require('electron');

const MAC_FIRMADA = false; // cambiar a true cuando el workflow firme con el certificado de Apple
const RELEASES = 'https://github.com/WillyQuispeH/portalfirma-studio/releases/latest';
const soloAviso = process.platform === 'darwin' && !MAC_FIRMADA;

let autoUpdater = null;
let manual = false; // el usuario pidió buscar desde el menú: avisar también si no hay nada
let getWin = () => null;

function enabled() { return app.isPackaged && process.env.PF_MOCK !== '1' && process.env.PF_NO_UPDATE !== '1'; }

function init(winGetter) {
  getWin = winGetter;
  if (!enabled()) return;
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = !soloAviso;
  autoUpdater.autoInstallOnAppQuit = !soloAviso;

  let avisada = null; // en Mac, avisar una sola vez por versión
  autoUpdater.on('update-available', async (ev) => {
    if (!soloAviso || (avisada === ev.version && !manual)) return;
    avisada = ev.version; manual = false;
    const r = await dialog.showMessageBox(getWin(), {
      type: 'info', buttons: ['Descargar', 'Más tarde'], defaultId: 0, cancelId: 1,
      message: `Hay una nueva versión de PortalFirma Studio (${ev.version})`,
      detail: 'Descárgala e instálala sobre la actual. Tus documentos y configuración se conservan.',
    });
    if (r.response === 0) shell.openExternal(RELEASES);
  });

  autoUpdater.on('update-not-available', () => {
    if (manual) info('Tienes la última versión', `PortalFirma Studio ${app.getVersion()} está al día.`);
    manual = false;
  });
  autoUpdater.on('update-downloaded', async (ev) => {
    manual = false;
    const r = await dialog.showMessageBox(getWin(), {
      type: 'info', buttons: ['Reiniciar ahora', 'Más tarde'], defaultId: 0, cancelId: 1,
      message: `Hay una nueva versión de PortalFirma Studio (${ev.version})`,
      detail: 'Ya está descargada. Reinicia para instalarla; si eliges «Más tarde», se instalará al cerrar la app.',
    });
    if (r.response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err?.message || err);
    if (manual) info('No se pudo buscar actualizaciones', 'Revisa tu conexión a internet e inténtalo de nuevo.', 'warning');
    manual = false;
  });

  setTimeout(check, 8000); // tras abrir, sin frenar el arranque
  setInterval(check, 4 * 60 * 60 * 1000); // y cada 4 horas
}

function check() { autoUpdater?.checkForUpdates().catch(() => {}); }

// Menú Ayuda → Buscar actualizaciones…
function checkManual() {
  if (!enabled()) return info('Actualizaciones', 'La búsqueda de actualizaciones solo funciona en la app instalada.');
  manual = true;
  check();
}

function info(message, detail, type = 'info') { dialog.showMessageBox(getWin(), { type, message, detail, buttons: ['Aceptar'] }); }

module.exports = { init, checkManual };
