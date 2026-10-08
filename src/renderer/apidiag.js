// Prueba de conexión directa con la API de Portalfirma (correo y contraseña) + diagnóstico.
// El diagnóstico guarda en Descargas SOLO la estructura de las respuestas (campos y tipos), sin datos.
(() => {
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function open() {
  const u = (await pf.apiUser()).data;
  if (!u) return loginForm();
  modal(`<h2>Conexión directa con Portalfirma</h2>
    <p>Sesión iniciada como <b>${esc(u.namePerson || u.email)}</b>${u.nameEntity ? ` · ${esc(u.nameEntity)}` : ''}.</p>
    <p class="muted small">El diagnóstico consulta (solo lectura) tus operaciones, saldo y un documento, y guarda en Descargas un archivo con la <b>estructura</b> de las respuestas, sin nombres, RUT, correos ni montos. No envía ni cobra nada.</p>
    <p class="small" id="adStep"></p>
    <div class="actions"><button class="ghost" id="adOut">Cerrar sesión</button><button class="secondary" id="mCancel">Cerrar</button><button class="primary" id="mOk">Ejecutar diagnóstico</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#adOut').onclick = async () => { await pf.apiLogout(); closeModal(); toast('Sesión cerrada'); window.Usuario?.refresh(); };
  $('#mOk').onclick = async () => {
    const b = $('#mOk'); b.disabled = true; $('#adStep').textContent = 'Consultando…';
    const r = await pf.apiDiag();
    if (!r.ok) { b.disabled = false; $('#adStep').innerHTML = `<span class="error">${esc(r.error)}</span>`; return; }
    const t = r.data.tests;
    modal(`<h2>Diagnóstico listo</h2><p>Se guardó <b>${esc(r.data.file)}</b> en tu carpeta Descargas.</p>
      <div class="ad-list">${t.map((x) => `<div class="ad-row"><span class="pill ${x.ok && x.success !== false ? 'ok' : 'wait'}">${x.status || '—'}</span> ${esc(x.name)}</div>`).join('')}</div>
      <p class="muted small">Avísale a Claude que el diagnóstico está listo.</p>
      <div class="actions"><button class="primary" id="mCancel">Entendido</button></div>`);
    $('#mCancel').onclick = closeModal;
  };
}
function loginForm(after, why) {
  modal(`<h2>Iniciar sesión en Portalfirma</h2>
    ${why ? `<p>${esc(why)}</p>` : ''}<p class="muted small">Con el correo y la contraseña de tu cuenta de empresa. Studio guarda solo la sesión (cifrada); la contraseña no se guarda.</p>
    <label>Correo<input id="adEmail" type="email" autocomplete="username" spellcheck="false"></label>
    <label>Contraseña<input id="adPass" type="password" autocomplete="current-password"></label>
    <p class="error small" id="adErr"></p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Iniciar sesión</button></div>`);
  $('#mCancel').onclick = closeModal;
  const go = async () => {
    const b = $('#mOk'); b.disabled = true; $('#adErr').textContent = '';
    const r = await pf.apiLogin($('#adEmail').value, $('#adPass').value);
    $('#adPass').value = '';
    if (!r.ok) { b.disabled = false; $('#adErr').textContent = r.error; return; }
    toast('Sesión iniciada'); window.Usuario?.refresh(); if (after) { closeModal(); after(); } else open();
  };
  $('#mOk').onclick = go; $('#adPass').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('#adEmail').focus();
}
window.ApiDiag = { open, login: loginForm };
})();
