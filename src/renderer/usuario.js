/* global $, esc, icon, toast, pf, state, clp */
'use strict';
// Menú del usuario (arriba a la derecha): nombre, empresa, saldo, tokens del asistente, Google Drive,
// accesos rápidos, ayuda y cierre de sesión.
(() => {
const U = { user: null, amount: null, tokens: null, drive: null };
const initials = (n) => String(n || '').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';
const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const tk = (n) => (n == null ? '…' : `${n} token${n === 1 ? '' : 's'}`);
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('es-CL'));
const logged = () => !!(U.user || state.session);

async function refresh() {
  const r = await pf.apiUser(); U.user = r.ok ? r.data : null;
  paint();
  // datos que tardan: saldo y tokens (sin bloquear la barra)
  if (U.user) pf.apiWallet().then((w) => { if (w.ok) { U.amount = w.data.amount; paint(); } });
  else U.amount = state.session?.balance ?? null;
  window.Asistente?.wallet(true).then((w) => { U.tokens = typeof w?.balance === 'number' ? w.balance : null; paint(); }).catch(() => {});
}
function paint() {
  const b = $('#userBtn'); if (!b) return;
  const on = logged();
  document.body.classList.toggle('guest', !on); // con la cuenta de Portalfirma (API o conector) no se muestran candados
  b.classList.toggle('hidden', !on);
  $('#topLoginBtn')?.classList.toggle('hidden', on); $('#balance')?.classList.add('hidden'); $('#logoutBtn')?.classList.add('hidden');
  if (!on) { closeMenu(); return; }
  const name = U.user?.namePerson || U.user?.email || 'Mi cuenta';
  b.innerHTML = `<span class="u-av">${esc(initials(name))}</span><span class="u-n">${esc(first(name) || name)}</span><span class="u-tk" title="Tokens del asistente">${icon('sparkle', 12)}${U.tokens ?? '…'}</span>${icon('chevD', 14)}`;
  if ($('#userMenu')) renderMenu();
}
function renderMenu() {
  let m = $('#userMenu'); if (!m) { m = document.createElement('div'); m.id = 'userMenu'; m.className = 'user-menu'; document.body.appendChild(m); }
  const u = U.user || {}; const name = u.namePerson || 'Cuenta de Portalfirma';
  const amount = U.user ? U.amount : state.session?.balance;
  m.innerHTML = `
    <div class="um-head"><span class="u-av big">${esc(initials(name))}</span><div><b>${esc(name)}</b>${u.email ? `<small>${esc(u.email)}</small>` : ''}${u.nameEntity ? `<small>${esc(u.nameEntity)}${u.role ? ' · ' + esc(u.role === 'admin' ? 'Administrador' : u.role) : ''}</small>` : ''}</div></div>
    <div class="um-cards">
      <div class="um-card"><small>Saldo Portalfirma</small><b>${money(amount)}</b><button class="ghost small" data-um="topup">Recargar</button></div>
      <div class="um-card"><small>Tokens del asistente</small><b>${tk(U.tokens)}</b><button class="ghost small" data-um="tokens">Comprar / código</button></div>
    </div>
    <div class="um-sec">
      <button data-um="ops">${icon('listCheck', 15)}<span>Mis operaciones</span></button>
      <button data-um="plazos">${icon('calendar', 15)}<span>Plazos y vencimientos</span></button>
      <button data-um="exp">${icon('folderOpen', 15)}<span>Expedientes</span></button>
      <button data-um="drive">${icon('drive', 15)}<span>Google Drive</span><small id="umDrive">${U.drive ? esc(U.drive) : ''}</small></button>
    </div>
    <div class="um-sec">
      <button data-um="help">${icon('help', 15)}<span>Ayuda y guías</span></button>
      <button data-um="tour">${icon('compass', 15)}<span>Ver el recorrido de esta pantalla</span></button>
      <button data-um="wa">${icon('whatsapp', 15)}<span>Soporte por WhatsApp</span></button>
      <button data-um="web">${icon('building', 15)}<span>Abrir mi cuenta en la web</span></button>
    </div>
    <div class="um-sec"><button data-um="out" class="danger">${icon('logout', 15)}<span>Cerrar sesión</span></button></div>
    <div class="um-foot">PortalFirma Studio ${esc(pf.cfg?.()?.version || '')}</div>`;
  pf.driveStatus().then((r) => { const el = $('#umDrive'); if (el && r.ok) { U.drive = r.data.connected ? r.data.email || 'Conectado' : 'Sin conectar'; el.textContent = U.drive; } });
}
function openMenu() { renderMenu(); $('#userBtn').classList.add('on'); refresh(); }
function closeMenu() { $('#userMenu')?.remove(); $('#userBtn')?.classList.remove('on'); }
document.addEventListener('click', async (e) => {
  if (e.target.closest('#userBtn')) { return $('#userMenu') ? closeMenu() : openMenu(); }
  const b = e.target.closest('#userMenu [data-um]');
  if (!b) { if (!e.target.closest('#userMenu')) closeMenu(); return; }
  const k = b.dataset.um; closeMenu();
  if (k === 'topup') pf.openUrl('https://empresa.portalfirma.cl/dashboard/wallet');
  else if (k === 'tokens') window.Asistente?.tokensDialog();
  else if (k === 'ops') { show('ops'); window.Operaciones.open(); }
  else if (k === 'plazos') window.Plazos.open();
  else if (k === 'exp') window.Expedientes.open();
  else if (k === 'drive') window.Drive.open({ purpose: 'connect' });
  else if (k === 'help') window.Ayuda.open();
  else if (k === 'tour') { const v = [...document.querySelectorAll('.view')].find((x) => !x.classList.contains('hidden'))?.id?.replace('view-', '') || 'home'; window.Ayuda.startTour(v === 'editor' ? 'editor' : v); }
  else if (k === 'wa') window.studio.whatsapp();
  else if (k === 'web') pf.openUrl('https://empresa.portalfirma.cl/dashboard');
  else if (k === 'out') {
    await pf.apiLogout(); await pf.logout(); U.user = null; state.session = null; setAccount(); paint(); toast('Sesión cerrada'); window.studio?.goHome();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.Usuario = { refresh, close: closeMenu, _u: U };
refresh();
})();
