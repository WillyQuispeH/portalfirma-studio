/* global pf, $, esc, show, toast, requireLogin, state, modal, closeModal, icon */
'use strict';
// Pantalla de inicio de PortalFirma Studio: acciones y documentos recientes.

const HOME_ACTIONS = [
  ['open', 'folderOpen', 'Abrir PDF', 'Abre un PDF para verlo y editarlo', 'c-blue'],
  ['new', 'filePlus', 'Crear PDF', 'Documento en blanco carta, oficio o A4', 'c-indigo'],
  ['combine', 'files', 'Combinar archivos', 'Une PDF, Word, Excel e imágenes en uno', 'c-violet'],
  ['convert', 'convert', 'Convertir a PDF', 'Word, Excel o imágenes a PDF listo para firmar', 'c-teal'],
  ['edittext', 'textEdit', 'Editar texto e imágenes', 'Corrige el texto respetando la fuente original', 'c-blue'],
  ['ocr', 'scanText', 'Reconocer texto (OCR)', 'Fotocopias y escaneos: texto buscable y editable', 'c-red'],
  ['organize', 'grid', 'Organizar páginas', 'Reordena, rota, inserta, elimina o extrae', 'c-green'],
  ['split', 'scissors', 'Dividir PDF', 'Separa en varios archivos por páginas o rangos', 'c-pink'],
  ['compress', 'compress', 'Comprimir PDF', 'Reduce el peso para enviarlo (máx. 20 MB)', 'c-amber'],
  ['export', 'export', 'Exportar PDF', 'A Word, imágenes PNG/JPG o texto', 'c-cyan'],
  ['print', 'print', 'Imprimir', 'Imprime el documento abierto', 'c-slate'],
  ['ai', 'sparkle', 'Asistente legal (IA)', 'Revisa y corrige tus documentos o redacta un borrador nuevo', 'c-ai'],
  ['tpls', 'template', 'Plantillas con campos', 'Tus contratos como plantillas: llenas los datos y envías a firmar', 'c-violet'],
  ['plan', 'plan', 'Firmar plano arquitectónico', 'Láminas + hoja de firmas tamaño carta', 'c-indigo'],
  ['send', 'sign', 'Enviar a firmar', 'Firma simple, avanzada, visada o legalización', 'pf'],
  ['tpl', 'notary', 'Notaría virtual', 'Poderes, declaraciones y contratos de Portalfirma', 'pf'],
  ['ops', 'listCheck', 'Mis operaciones', 'Estado de firmas y documentos firmados', 'pf'],
  ['plazos', 'calendar', 'Plazos y vencimientos', 'Tus contratos ordenados por vencimiento, con sugerencias de la IA', 'c-amber'],
  ['escr', 'users', 'Gestión de firmas presenciales', 'Escrituras públicas, protocolizaciones y reducciones: revisamos el documento, calculamos el valor y coordinamos la firma en la notaría', 'c-slate'],
  ['exp', 'folderOpen', 'Expedientes', 'Una carpeta por caso con sus documentos, fotos de cédulas e historial', 'c-amber'],
  ['flows', 'flow', 'Flujos documentales', 'Recetas: una plantilla + una nómina → muchos documentos enviados a firmar', 'c-teal'],
  ['bulk', 'files', 'Carga masiva', 'Sube muchos documentos y envíalos a firmar de una vez; firma masiva con certificado', 'c-indigo'],
];

const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return ''; } };
const fmtSize = (n) => (n ? (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') : '');

// Inicio ordenado por niveles: lo esencial para empezar, lo que ahorra tiempo y lo avanzado.
// Cada función muestra para qué sirve; las nuevas llevan «Nuevo» hasta que se abren por primera vez.
const LEVELS = [
  { key: 'esencial', title: 'Lo esencial', sub: 'Para empezar: abrir, preparar y enviar a firmar', big: ['send', 'ops'], small: ['open', 'new', 'combine', 'convert'] },
  { key: 'ahorro', title: 'Para ahorrar tiempo', sub: 'Cuando ya envías documentos seguido', rows: ['tpls', 'ai', 'plazos', 'exp'] },
  { key: 'avanzado', title: 'Avanzado', sub: 'Volúmenes grandes y casos especiales', rows: ['flows', 'bulk', 'plan'] },
];
const PDF_TOOLS = ['edittext', 'ocr', 'organize', 'split', 'compress', 'export', 'print'];
const NEW_ACTS = { escr: 'Gestión de firmas presenciales', exp: 'Expedientes', flows: 'Flujos documentales', plazos: 'Plazos y vencimientos' };
const seen = (k) => { try { return localStorage.getItem('pf.seen.' + k) === '1'; } catch { return true; } };
const markSeen = (k) => { try { localStorage.setItem('pf.seen.' + k, '1'); } catch {} };
const newBadge = (k) => (NEW_ACTS[k] && !seen(k) ? '<span class="new-badge">Nuevo</span>' : '');
const ACT = Object.fromEntries(HOME_ACTIONS.map((a) => [a[0], a]));
const MEMBER_ACTS = new Set(['send', 'tpl', 'ops', 'ai', 'plan', 'bulk', 'flows', 'plazos']); // IA y firma: solo clientes de Portalfirma
const lockBadge = () => `<span class="lock-badge" title="Exclusivo para clientes de Portalfirma">${icon('lock', 12)}</span>`;
const card = (k, big) => { const [, ic, t, d, cls] = ACT[k]; const m = MEMBER_ACTS.has(k); return `<button class="hub-card ${big ? 'big' : ''} ${cls || ''}" data-act="${k}" ${m ? 'data-member' : ''} title="${esc(d)}${m ? ' · Exclusivo para clientes de Portalfirma' : ''}"><span class="ic">${icon(ic, big ? 30 : 24)}</span><strong>${t}</strong>${big ? `<small class="hc-d">${esc(d)}</small>` : ''}${m ? lockBadge() : ''}${newBadge(k)}</button>`; };
// Fila con descripción visible (niveles «Para ahorrar tiempo» y «Avanzado»)
const row = (k) => { const [, ic, t, d, cls] = ACT[k]; const m = MEMBER_ACTS.has(k); return `<button class="hub-card hub-row ${cls || ''}" data-act="${k}" ${m ? 'data-member' : ''} title="${m ? 'Exclusivo para clientes de Portalfirma' : esc(t)}"><span class="ic">${icon(ic, 20)}</span><span class="hr-t"><strong>${t}${newBadge(k)}</strong><small>${esc(d)}</small></span>${m ? lockBadge() : ''}</button>`; };
const levelHead = (L) => `<div class="lvl-h"><div><h3>${L.title}</h3><small>${L.sub}</small></div><button class="ghost small lvl-help" data-help="${L.key}" title="Ver guías de este nivel">${icon('help', 15)}</button></div>`;
const docArt = `<svg class="hub-doc" viewBox="0 0 120 140" aria-hidden="true"><defs><linearGradient id="hdg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe6f3"/></linearGradient><linearGradient id="hdf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef2fa"/><stop offset="1" stop-color="#c9d3e6"/></linearGradient><filter id="hds" x="-30%" y="-20%" width="160%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#3a4a78" flood-opacity=".22"/></filter></defs>
  <g filter="url(#hds)"><path d="M18 10h58l26 26v88a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z" fill="url(#hdg)" stroke="#c4cee2"/><path d="M76 10v20a6 6 0 0 0 6 6h20z" fill="url(#hdf)" stroke="#c4cee2"/></g>
  <g stroke="#4a5d86" stroke-width="5" stroke-linecap="round"><path d="M30 64h52M30 78h60M30 92h60M30 106h40"/></g></svg>`;

const HOME_RECENTS = 3;
const ext = (n) => (String(n).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const KIND = (n) => { const e = ext(n); return e === 'pdf' ? ['PDF', 'pdf'] : /^(docx?|odt|rtf)$/.test(e) ? ['DOC', 'doc'] : /^(xlsx?|csv|ods)$/.test(e) ? ['XLS', 'xls'] : /^(png|jpe?g|webp)$/.test(e) ? ['IMG', 'img'] : [e.toUpperCase().slice(0, 4), 'oth']; };
const recentItem = (x) => { const [k, c] = KIND(x.name); return `<div class="recent-item" data-path="${esc(x.path)}" title="${esc(x.path)}">
  <span class="fi k-${c}">${icon(c === 'img' ? 'image' : 'file', 18)}<i>${esc(k)}</i></span><span class="rc-tx"><div class="nm">${esc(x.name)}</div><div class="pt">${esc(x.path.replace(/[\\/][^\\/]+$/, ''))}${x.exists ? '' : ' · <b class="es-bad">no encontrado</b>'}</div></span>
  <span class="muted small">${fmtSize(x.size)}</span><span class="muted small">${fmtDate(x.date)}</span></div>`; };
async function openRecent(p) { const ok = await window.editor.openPaths([p], true); if (ok === false) toast('No se pudo abrir: el archivo ya no está en esa ubicación.', 4000); }
// Bloque «Notaría»: firmas presenciales ante notario y Notaría virtual
function notariaPanel() {
  const [, , t, d] = ACT.escr; const m = MEMBER_ACTS.has('tpl');
  return `<div class="hub-panel hub-not">
    <div class="hn-h"><span class="hn-ic">${icon('notary', 20)}</span><div><h3>Notaría</h3><small>Firmas ante notario y documentos notariales, sin filas</small></div></div>
    <div class="hn-grid">
      <button class="hn-card main" data-act="escr"><span class="hn-cic">${icon('users', 26)}</span><span class="hn-tx"><strong>${t}${newBadge('escr')}</strong><small>${esc(d)}</small></span><span class="hn-go">Comenzar ${icon('arrowR', 15)}</span></button>
      <button class="hn-card" data-act="tpl" ${m ? 'data-member' : ''}><span class="hn-cic alt">${icon('notary', 22)}</span><span class="hn-tx"><strong>Notaría virtual</strong><small>${esc(ACT.tpl[3])}</small></span>${m ? lockBadge() : ''}<span class="hn-go">Abrir ${icon('arrowR', 15)}</span></button>
    </div></div>`;
}
async function renderHome() {
  const r = await pf.recentList(); const all = r.ok ? r.data : []; const rec = all.slice(0, HOME_RECENTS);
  $('#homeBody').innerHTML = `
    <div class="hub-title"><h1>PortalFirma Studio</h1><p>Crea, edita y prepara tus documentos, y envíalos a firmar con Portalfirma.</p>
      <form class="hub-agent" id="hubAg"><span class="ha-ic">${icon('sparkle', 16)}</span><input id="hubAgQ" placeholder="Pídele al Agente Portalfirma: «¿quién falta por firmar en la operación 4424?»" autocomplete="off" /><button class="primary small" type="submit">Preguntar</button></form></div>
    <div class="hub">
      <div class="hub-col">
        ${levelHead(LEVELS[0])}
        <div class="hub-grid top">${LEVELS[0].big.map((k) => card(k, true)).join('')}</div>
        <div class="hub-grid" style="margin-top:12px">${LEVELS[0].small.map((k) => card(k)).join('')}</div>
        <h3 class="hub-h">Herramientas de PDF</h3>
        <div class="tool-chips">${PDF_TOOLS.map((k) => { const [, ic, t, d] = ACT[k]; return `<button class="tool-chip" data-act="${k}" title="${esc(d)}">${icon(ic, 16)}<span>${t}</span></button>`; }).join('')}</div>
      </div>
      <div class="hub-center">
        <div class="hub-panel hub-drop-panel">
          <div class="hub-drop" id="hubDrop" role="button" tabindex="0" title="Abrir PDF">
            ${docArt}
            <span class="hd-tx"><strong>Arrastra archivos a esta ventana para abrirlos</strong>
            <span>PDF, Word, Excel o imágenes · o haz clic para elegir</span>
            <button class="ghost small with-ic hub-drive" id="hubDrive">${icon('drive', 15)}<span>o tráelos desde Google Drive</span></button></span>
          </div>
          <div class="hub-btns"><button class="secondary" data-act="new">Crear PDF</button><button class="primary" data-act="send" data-member>Enviar a firmar${lockBadge()}</button><button class="secondary" data-act="tpls">Plantillas con campos</button></div>
        </div>
        ${notariaPanel()}
        <div class="hub-panel">
          <div class="recent-head"><h3>${icon('clock', 17)} Recientes</h3>${all.length > HOME_RECENTS ? `<button class="ghost small with-ic" id="recAll"><span>Ver todos (${all.length})</span>${icon('arrowR', 14)}</button>` : ''}</div>
          <div class="recent-list">${rec.length ? rec.map(recentItem).join('') : '<div class="recent-empty">Aquí aparecerán los documentos que abras o guardes.</div>'}</div>
        </div>
        <div class="hub-panel" id="tplLibHost"></div>
      </div>
      <div class="hub-col">
        ${levelHead(LEVELS[1])}
        <div class="hub-rows">${LEVELS[1].rows.map(row).join('')}</div>
        ${levelHead(LEVELS[2])}
        <div class="hub-rows">${LEVELS[2].rows.map(row).join('')}</div>
      </div>
    </div>`;
  const body = $('#homeBody');
  body.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => { const k = b.dataset.act; if (NEW_ACTS[k] && !seen(k)) { markSeen(k); b.querySelector('.new-badge')?.remove(); } homeAction(k); }));
  body.querySelectorAll('[data-help]').forEach((b) => (b.onclick = () => window.Ayuda?.open({ level: b.dataset.help })));
  const dz = $('#hubDrop'); dz.onclick = (e) => { if (e.target.closest('#hubDrive')) return window.Drive.open({ purpose: 'sign' }); homeAction('open'); }; dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); homeAction('open'); } };
  body.querySelector('.recent-list').onclick = (e) => { const it = e.target.closest('[data-path]'); if (it) openRecent(it.dataset.path); };
  renderTplLib();
  const ra = $('#recAll'); if (ra) ra.onclick = () => window.Recientes.open();
  $('#hubAg').onsubmit = (e) => { e.preventDefault(); const t = $('#hubAgQ').value.trim(); window.members(() => { window.Agente.open(); if (t) window.Agente.enviar(t); }, 'El Agente Portalfirma trabaja con tu cuenta. Inicia sesión para usarlo.'); };
}

async function renderTplLib() {
  const host = $('#tplLibHost'); if (!host || !window.Plantillas) return;
  host.innerHTML = await window.Plantillas.librarySection();
  window.Plantillas.bindLibrary(host, renderTplLib);
}
// Acciones que necesitan un documento: si no hay uno abierto, se pide primero.
async function withDoc(fn) {
  if (window.editor.hasDoc()) { window.studio.goEditor(); return fn(); }
  const ok = await window.editor.openDialog(false); if (ok) return fn();
}
async function homeAction(k) {
  const E = window.editor;
  switch (k) {
    case 'open': return E.openDialog(true);
    case 'new': return E.createBlank();
    case 'combine': case 'convert': { const r = await pf.edPick(true); if (r.ok && r.data.length) return E.openPaths(r.data, true); return; }
    case 'edittext': return withDoc(() => E.tool('edittext'));
    case 'ocr': return withDoc(() => E.ocrDialog());
    case 'organize': return withDoc(() => E.tool('select'));
    case 'split': return withDoc(() => E.splitDialog());
    case 'compress': return withDoc(() => E.compress());
    case 'export': return withDoc(() => E.exportDialog());
    case 'print': return withDoc(() => E.print());
    case 'plan': return window.members(() => { window.studio.goEditor(); return E.planWizard(); });
    case 'ai': return window.members(() => { if (E.hasDoc()) { window.studio.goEditor(); return window.Asistente.open(); } return window.Asistente.draftDialog(); }, 'El asistente legal con IA es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta para usarlo.');
    case 'tpls': return $('#tplLib')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    case 'send': return E.hasDoc() ? window.members(() => { window.studio.goEditor(); return E.sendToSign(); }) : requireLogin(() => show('drop'), 'Para enviar documentos a firmar, inicia sesión en Portalfirma.', 'send');
    case 'tpl': return requireLogin(() => { show('tpl'); window.openTemplates && window.openTemplates(); }, 'Para usar la Notaría virtual, inicia sesión en Portalfirma.', 'tpl');
    case 'ops': { show('ops'); return window.Operaciones.open(); }
    case 'bulk': return window.Masiva.open();
    case 'flows': return window.Flujos.open();
    case 'exp': return window.Expedientes.open();
    case 'plazos': return window.Plazos.open();
    case 'escr': return window.Escrituras.open();
  }
}

// Soporte por WhatsApp
const WHATSAPP_SOPORTE = '56972525400';
function whatsapp(text = 'Hola, necesito ayuda con PortalFirma Studio.') { pf.openUrl(`https://wa.me/${WHATSAPP_SOPORTE}?text=${encodeURIComponent(text)}`); }

// ---- Pestaña «Recientes»: todos los documentos, con búsqueda y páginas de 20
const R = { page: 1, q: '', tipo: '' }; const PER_PAGE = 20;
async function renderRecientes() {
  const host = $('#view-recientes'); const r = await pf.recentList(); const all = r.ok ? r.data : [];
  const q = R.q.toLowerCase();
  const list = all.filter((x) => (!q || `${x.name} ${x.path}`.toLowerCase().includes(q)) && (!R.tipo || KIND(x.name)[1] === R.tipo));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE)); R.page = Math.min(Math.max(1, R.page), pages);
  const from = (R.page - 1) * PER_PAGE; const slice = list.slice(from, from + PER_PAGE);
  const faltan = all.filter((x) => !x.exists).length;
  const nums = []; for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - R.page) <= 2) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  const TIPOS = [['', 'Todos'], ['pdf', 'PDF'], ['doc', 'Word'], ['xls', 'Excel'], ['img', 'Imágenes']];
  host.innerHTML = `<div class="rec-page">
    <div class="ops-head"><div><h2>Recientes</h2><span class="muted small">${all.length} ${all.length === 1 ? 'documento' : 'documentos'} abiertos o guardados en este computador</span></div>
      <div class="ops-head-r">${faltan ? `<button class="ghost small" id="rcMiss">Quitar los ${faltan} que no existen</button>` : ''}${all.length ? '<button class="ghost small" id="rcClear">Borrar lista</button>' : ''}<button class="primary small with-ic" id="rcOpen">${icon('folderOpen', 15)}<span>Abrir documento…</span></button></div></div>
    <div class="rec-bar"><div class="ops-search">${icon('search', 14)}<input id="rcQ" placeholder="Buscar por nombre o carpeta…" value="${esc(R.q)}" /></div>
      <div class="rec-seg">${TIPOS.map(([k, t]) => `<button data-tipo="${k}" class="${R.tipo === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="rec-card">
      ${slice.length ? `<div class="rec-th"><span></span><span>Nombre</span><span>Tamaño</span><span>Última vez</span><span></span></div>` + slice.map((x) => { const [k, c] = KIND(x.name); return `<div class="rec-row ${x.exists ? '' : 'miss'}" data-path="${esc(x.path)}" title="${esc(x.path)}">
        <span class="fi k-${c}">${icon(c === 'img' ? 'image' : 'file', 18)}<i>${esc(k)}</i></span>
        <span class="rc-tx"><b>${esc(x.name)}</b><small>${esc(x.path.replace(/[\\/][^\\/]+$/, ''))}${x.exists ? '' : ' · <b class="es-bad">no encontrado</b>'}</small></span>
        <span class="muted small">${fmtSize(x.size)}</span><span class="muted small">${fmtDate(x.date)}</span>
        <span class="rec-act">${x.exists ? `<button class="ghost small" data-folder title="Mostrar en la carpeta">${icon('folder', 15)}</button>` : ''}<button class="ghost small" data-rm title="Quitar de la lista">${icon('x', 15)}</button></span></div>`; }).join('')
        : `<div class="recent-empty">${all.length ? 'Ningún documento coincide con la búsqueda.' : 'Aquí aparecerán los documentos que abras o guardes.'}</div>`}
    </div>
    ${list.length > PER_PAGE ? `<div class="rec-pag"><span class="muted small">Mostrando ${from + 1}–${from + slice.length} de ${list.length}</span>
      <div class="rec-pg"><button class="ghost small" data-pg="${R.page - 1}" ${R.page === 1 ? 'disabled' : ''}>${icon('chevL', 14)} Anterior</button>${nums.map((n) => n === '…' ? '<span class="muted">…</span>' : `<button class="ghost small ${n === R.page ? 'on' : ''}" data-pg="${n}">${n}</button>`).join('')}<button class="ghost small" data-pg="${R.page + 1}" ${R.page === pages ? 'disabled' : ''}>Siguiente ${icon('chevR', 14)}</button></div></div>` : ''}
  </div>`;
  const qi = $('#rcQ'); qi.oninput = () => { R.q = qi.value; R.page = 1; const pos = qi.selectionStart; renderRecientes().then(() => { const i = $('#rcQ'); i.focus(); i.setSelectionRange(pos, pos); }); };
  host.querySelectorAll('[data-tipo]').forEach((b) => (b.onclick = () => { R.tipo = b.dataset.tipo; R.page = 1; renderRecientes(); }));
  host.querySelectorAll('[data-pg]').forEach((b) => (b.onclick = () => { R.page = Number(b.dataset.pg); renderRecientes(); host.scrollIntoView({ block: 'start' }); }));
  host.querySelectorAll('.rec-row').forEach((row) => (row.onclick = async (e) => {
    const p = row.dataset.path;
    if (e.target.closest('[data-rm]')) { await pf.recentRemove(p); return renderRecientes(); }
    if (e.target.closest('[data-folder]')) return pf.showInFolder(p);
    openRecent(p);
  }));
  $('#rcOpen').onclick = () => window.editor.openDialog(true);
  const m = $('#rcMiss'); if (m) m.onclick = async () => { for (const x of all) if (!x.exists) await pf.recentRemove(x.path); renderRecientes(); };
  const c = $('#rcClear'); if (c) c.onclick = () => {
    modal(`<h3>¿Borrar la lista de recientes?</h3><p class="muted small">Solo se borra la lista; tus archivos no se eliminan.</p><div class="row-end"><button class="ghost" id="rcNo">Cancelar</button><button class="primary" id="rcSi">Borrar lista</button></div>`);
    $('#rcNo').onclick = closeModal; $('#rcSi').onclick = async () => { closeModal(); await pf.recentClear(); R.page = 1; renderRecientes(); };
  };
}
window.Recientes = { open() { show('recientes'); return renderRecientes(); }, render: renderRecientes, _r: R };

window.studio = {
  whatsapp,
  goHome() { show('home'); renderHome(); },
  goEditor() { if ($('#view-editor').classList.contains('hidden')) show('editor'); window.editor.open(); },
  editorVisible: () => !$('#view-editor').classList.contains('hidden'),
};

// Menú nativo (Archivo, Herramientas, Ver)
pf.onMenu(async (action, arg) => {
  const E = window.editor;
  switch (action) {
    case 'home': return window.studio.goHome();
    case 'apiDiag': return window.ApiDiag.open();
    case 'new': return E.createBlank();
    case 'open': return E.openDialog(true);
    case 'openRecent': return E.openPaths([arg], true);
    case 'combine': { const r = await pf.edPick(true); if (r.ok && r.data.length) E.openPaths(r.data, E.hasDoc() ? false : true); return; }
    case 'convert': { const r = await pf.edPick(true); if (r.ok && r.data.length) E.openPaths(r.data, true); return; }
    case 'save': return E.hasDoc() && E.save();
    case 'saveAs': return E.hasDoc() && E.saveAs();
    case 'saveAndClose': { const ok = await E.saveAll(); if (ok) pf.closeNow(); return; }
    case 'export': return withDoc(() => E.exportDialog(arg));
    case 'plan': return window.members(() => { window.studio.goEditor(); return E.planWizard(); });
    case 'send': return window.members(() => withDoc(() => E.sendToSign()));
    case 'close': if (!$('#view-editor').classList.contains('hidden')) return E.closeDoc(); return;
    case 'print': return withDoc(() => E.print());
    case 'tplDesign': return withDoc(() => window.Plantillas.enterDesign());
    case 'tplList': window.studio.goHome(); return setTimeout(() => $('#tplLib')?.scrollIntoView({ block: 'start' }), 200);
    case 'find': return withDoc(() => E.find());
    case 'findNext': return E.hasDoc() && E.findStep(1);
    case 'findPrev': return E.hasDoc() && E.findStep(-1);
    case 'fullscreen': return E.hasDoc() && !$('#view-editor').classList.contains('hidden') ? E.reading() : pf.setFullScreen();
    case 'nextTab': return E.cycleTab(1);
    case 'prevTab': return E.cycleTab(-1);
    case 'tool': return withDoc(() => E.tool(arg));
    case 'ocr': return withDoc(() => E.ocrDialog());
    case 'compress': return withDoc(() => E.compress());
    case 'split': return withDoc(() => E.splitDialog());
    case 'number': return withDoc(() => E.number());
    case 'watermark': return withDoc(() => E.watermark());
    case 'zoom': if (E.hasDoc()) E.zoom(arg); return;
  }
});
pf.onRecentChanged(() => { if (!$('#view-home').classList.contains('hidden')) renderHome(); if (!$('#view-recientes').classList.contains('hidden')) renderRecientes(); });

window.studio.goHome();
