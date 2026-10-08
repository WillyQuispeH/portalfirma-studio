/* global pf, $, esc, toast, modal, closeModal, icon, ed, blocksFor, openBlocks, renderOverlaysFor, renderPanel, setDirty, snapshot, findOv, step, busy, normText */
'use strict';
// ============================================================================
// PortalFirma Studio — Asistente legal (IA)
//  · Revisar: ortografía, redacción, coherencia de datos, lo que falta y riesgos; cada sugerencia
//    se acepta o descarta y al aceptarla se reescribe el párrafo con la misma fuente.
//  · Redactar: un borrador desde instrucciones, que se abre como PDF editable.
//  · Preguntar: consultas sobre el documento abierto.
// La clave de API vive cifrada en el proceso principal; aquí nunca se ve.
// ============================================================================
const SYSTEM = `Eres un asistente legal para Chile que ayuda a redactar y revisar documentos (contratos, poderes, declaraciones, escritos).
Escribes en español de Chile, con lenguaje jurídico claro y preciso.
Reglas:
- No inventes leyes, artículos ni jurisprudencia. Si mencionas una norma, cítala solo si estás seguro, y siempre se entenderá como "por verificar".
- No inventes datos de las partes (nombres, RUT, montos, fechas, direcciones): si faltan, usa marcadores entre corchetes como [NOMBRE], [RUT], [FECHA].
- Tu trabajo es un apoyo: el documento final debe revisarlo una persona responsable.`;
const TYPES = { ortografia: 'Ortografía', redaccion: 'Redacción', coherencia: 'Datos', falta: 'Falta', riesgo: 'Riesgo' };
const MAX_CHARS = 120000;

let st = null; // estado del proveedor (sin la clave)
async function status(refresh) { if (!st || refresh) { const r = await pf.aiStatus(); st = r.ok ? r.data : { hasKey: false, providers: {} }; } return st; }

// ---------- texto del documento (con lo editado) ----------
const htmlText = (html) => { const d = document.createElement('div'); d.innerHTML = html; d.querySelectorAll('br').forEach((b) => b.replaceWith(' ')); return d.textContent.replace(/\s+/g, ' ').trim(); };
async function docText() {
  const parts = []; let scanned = 0;
  for (let i = 0; i < ed.count; i++) {
    let bl = []; try { bl = await blocksFor(i); } catch {}
    const ovs = (ed.overlays[i] || []).filter((o) => o.type === 'rich');
    const lines = bl.map((b) => { const o = ovs.find((x) => x.blockId === b.id); return o ? htmlText(o.html) : b.text.replace(/\s*\n\s*/g, ' '); });
    for (const o of ovs) if (!o.blockId) lines.push(htmlText(o.html));
    if (!lines.join('').trim()) scanned++;
    parts.push(`[Página ${i + 1}]\n` + lines.filter(Boolean).join('\n\n'));
  }
  let text = parts.join('\n\n');
  const cut = text.length > MAX_CHARS; if (cut) text = text.slice(0, MAX_CHARS);
  return { text, cut, scanned };
}

// ---------- consentimiento ----------
async function ensureConsent() {
  const s = await status();
  if (s.consent) return true;
  const prov = s.providers?.[s.provider]?.label || s.provider;
  return new Promise((res) => {
    modal(`<h2>${icon('sparkle', 18)} Antes de usar el asistente</h2>
      <p>Para revisar o responder, el <strong>texto del documento se envía a ${esc(prov)}</strong>, que lo procesa con su modelo de IA. Revisa con tu equipo si los documentos de tus clientes pueden enviarse a ese servicio.</p>
      <p class="muted small">El asistente puede equivocarse. Sus sugerencias y las normas que cite deben verificarse; no reemplaza la revisión de un abogado.</p>
      <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Entiendo, continuar</button></div>`);
    $('#mCancel').onclick = () => { closeModal(); res(false); };
    $('#mOk').onclick = async () => { closeModal(); await pf.aiConfig({ consent: true }); await status(true); res(true); };
  });
}
async function ask(req) {
  if (!ed.ai) ed.ai = { tab: 'review', items: null, chat: [] };
  const T = ed; const r = await pf.aiChat(req);
  if (!r.ok) {
    if (r.code === 'NEEDS_ACCOUNT') { setTimeout(() => window.members(() => {}), 50); const e = new Error(r.error); e.silent = true; throw e; }
    if (r.code === 'NO_TOKENS') { if (r.data) wal = r.data; setTimeout(() => tokensDialog(r.error), 50); const e = new Error(r.error); e.silent = true; throw e; }
    throw new Error(r.error);
  }
  if (T.ai) { T.ai.model = r.data.model; T.ai.usage = r.data.usage; } if (r.data.tokens) { wal = r.data.tokens; paintTokens(); }
  return r.data.text;
}

// ---------- Tokens (Paquete de tokens) ----------
let wal = null;
async function wallet(refresh) { if (!wal || refresh) { const r = await pf.aiWallet(); if (r.ok) wal = r.data; } return wal || { balance: 0, costs: {}, pack: {} }; }
const tk = (n) => `${n} token${n === 1 ? '' : 's'}`;
const fmtClp = (n) => '$' + Number(n || 0).toLocaleString('es-CL');
function tokenBar() { const w = wal || { balance: '…' }; return `<div class="tk-bar"><span class="tk-coin">${icon('sparkle', 13)}</span><span class="tk-n" data-tk>${typeof w.balance === 'number' ? tk(w.balance) : '…'}</span><button class="ghost small" data-tkbuy>Comprar / código</button></div>`; }
function paintTokens() { document.querySelectorAll('[data-tk]').forEach((el) => (el.textContent = tk(wal?.balance ?? 0))); const h = document.querySelector('[data-askleft]'); if (h && wal) h.textContent = askHint(); }
const askHint = () => (wal?.askLeft > 0 ? `Te quedan ${wal.askLeft} pregunta(s) ya pagadas.` : `Cada 3 preguntas usan ${tk(wal?.costs?.ask ?? 1)}.`);
async function tokensDialog(reason) {
  const w = await wallet(true); const p = w.pack || {};
  modal(`<h2>${icon('sparkle', 18)} Tokens del asistente</h2>
    ${reason ? `<p class="tk-warn">${esc(reason)}</p>` : ''}
    <div class="tk-big"><b>${tk(w.balance)}</b><span>disponibles</span></div>
    <table class="tk-costs"><tr><td>Revisar documento</td><td>${tk(w.costs.review)}</td></tr><tr><td>Preguntar (bloque de ${w.askPerToken} preguntas)</td><td>${tk(w.costs.ask)}</td></tr>
      <tr><td>Detectar campos de una plantilla</td><td>${tk(w.costs.detect)}</td></tr><tr><td>Redactar un documento</td><td>${tk(w.costs.draft)}</td></tr><tr><td>Cada cambio pedido a la IA en un documento</td><td>${tk(w.costs.edit)}</td></tr><tr><td>Analizar los plazos de un documento</td><td>${tk(w.costs.plazo)}</td></tr>
      <tr><td>Chequeos de RUT y montos, aplicar sugerencias, editar el texto a mano</td><td>Gratis</td></tr></table>
    <div class="tk-pack"><div><b>${esc(p.name || 'Paquete de tokens')}</b><span>${p.tokens} tokens por ${fmtClp(p.price)}</span></div>
      <button class="primary wa-btn with-ic" id="tkWa">${icon('whatsapp', 16)}<span>Comprar por WhatsApp</span></button></div>
    <label>¿Ya pagaste? Ingresa el código que te envió soporte<div class="tk-row"><input id="tkCode" autocomplete="off" spellcheck="false" placeholder="Código de activación" /><button class="secondary" id="tkGo">Activar</button></div></label>
    <div class="actions"><button class="secondary" id="mCancel">Cerrar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#tkWa').onclick = () => window.studio.whatsapp(`Hola, quiero comprar un ${p.name || 'Paquete de tokens'} (${p.tokens} tokens por ${fmtClp(p.price)}) para el asistente de PortalFirma Studio.`);
  const go = async () => {
    const r = await pf.aiRedeem($('#tkCode').value);
    if (!r.ok) { $('#tkCode').classList.add('invalid'); toast(r.error, 5000); return; }
    wal = r.data; closeModal(); paintTokens(); toast(`Paquete activado: ahora tienes ${tk(wal.balance)}.`, 4000);
  };
  $('#tkGo').onclick = go; $('#tkCode').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
const parseJson = (t) => { try { return JSON.parse(t); } catch { const m = /\{[\s\S]*\}/.exec(t); if (m) try { return JSON.parse(m[0]); } catch {} } throw new Error('La respuesta del asistente no vino en el formato esperado. Intenta de nuevo.'); };

// ---------- chequeos exactos (sin IA) ----------
function localChecks(text) {
  const out = [];
  const rutDv = (body) => { let s = 0, m = 2; for (let i = body.length - 1; i >= 0; i--) { s += Number(body[i]) * m; m = m === 7 ? 2 : m + 1; } const r = 11 - (s % 11); return r === 11 ? '0' : r === 10 ? 'K' : String(r); };
  for (const m of text.matchAll(/\b(\d{1,2}\.?\d{3}\.?\d{3})-([\dkK])\b/g)) {
    const body = m[1].replace(/\./g, ''); if (rutDv(body) !== m[2].toUpperCase()) out.push({ tipo: 'coherencia', gravedad: 'alta', cita: m[0], sugerencia: null, explicacion: `El RUT ${m[0]} tiene el dígito verificador incorrecto (debería terminar en ${rutDv(body)}). Revisa el número con la parte.`, local: true });
  }
  const words = window.Plantillas?._montoEnPalabras;
  if (words) for (const m of text.matchAll(/\$\s?([\d.]{4,})\s*\(([^)]{6,120})\)/g)) {
    const n = Number(m[1].replace(/\./g, '')); const expect = normText(words(n)).replace(/\s+/g, ' ');
    const got = normText(m[2]).replace(/\s+/g, ' ').replace(/\s*de\s+pesos|\s*pesos.*$/, '').trim();
    if (got && !expect.startsWith(got.replace(/ de$/, ''))) out.push({ tipo: 'coherencia', gravedad: 'alta', cita: m[0], sugerencia: null, explicacion: `El monto en cifras ($${m[1]}) no coincide con el monto en palabras («${m[2].trim()}»). En cifras corresponde a «${words(n)}».`, local: true });
  }
  return out;
}

// ---------- aplicar una sugerencia en el documento ----------
// Reemplaza `quote` por `repl` dentro del html, aunque el texto cruce negritas o cursivas.
function replaceInHtml(html, quote, repl) {
  const d = document.createElement('div'); d.innerHTML = html;
  const nodes = []; const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  // texto normalizado (espacios colapsados) con su mapa a (nodo, posición)
  let norm = ''; const map = []; let prevSpace = true;
  nodes.forEach((n, ni) => { for (let k = 0; k < n.data.length; k++) { const c = n.data[k]; const sp = /\s/.test(c); if (sp && prevSpace) continue; norm += sp ? ' ' : c; map.push([ni, k]); prevSpace = sp; } if (!prevSpace) { /* salto entre nodos sin espacio */ } });
  const q = quote.replace(/\s+/g, ' ').trim(); let at = norm.indexOf(q);
  if (at < 0) at = norm.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return null;
  const [n0, k0] = map[at], [n1, k1] = map[at + q.length - 1];
  if (n0 === n1) { const n = nodes[n0]; n.data = n.data.slice(0, k0) + repl + n.data.slice(k1 + 1); }
  else {
    nodes[n0].data = nodes[n0].data.slice(0, k0) + repl;
    for (let x = n0 + 1; x < n1; x++) nodes[x].data = '';
    nodes[n1].data = nodes[n1].data.slice(k1 + 1);
  }
  return d.innerHTML;
}
async function applySuggestion(item) {
  const q = item.cita.replace(/\s+/g, ' ').trim(); const nq = normText(q).toLowerCase();
  for (let i = 0; i < ed.count; i++) {
    // 1) párrafos ya abiertos (editados)
    for (const o of ed.overlays[i] || []) {
      if (o.type !== 'rich' || o.locked) continue;
      if (!normText(htmlText(o.html)).toLowerCase().includes(nq)) continue;
      const html = replaceInHtml(o.html, q, item.sugerencia); if (!html) continue;
      snapshot(); o.html = html; renderOverlaysFor(i); setDirty(true); return i;
    }
    // 2) párrafos del PDF aún sin abrir
    let bl = []; try { bl = await blocksFor(i); } catch {}
    const used = new Set((ed.overlays[i] || []).map((o) => o.blockId));
    const b = bl.find((x) => !used.has(x.id) && normText(x.text.replace(/\s+/g, ' ')).toLowerCase().includes(nq));
    if (!b) continue;
    snapshot();
    let o; await step('Aplicando la sugerencia…', async () => { [o] = await openBlocks(i, [b]); });
    if (!o) return -1;
    const html = replaceInHtml(o.html, q, item.sugerencia);
    if (html) { o.html = html; renderOverlaysFor(i); setDirty(true); return i; }
    return -1;
  }
  return -1;
}
async function gotoQuote(item) {
  if (!item.cita) return;
  const r = await window.editor.runFind(item.cita.slice(0, 60));
  void r; window.editor.find();
}

// ============================================================================
// Panel
// ============================================================================
// El panel se reconstruye solo cuando cambia su contenido (así no se pierde lo que se está escribiendo).
function refresh(T = ed) { if (!T.ai) return; T.ai.v = (T.ai.v || 0) + 1; if (T === ed) renderPanel(); }
// ============================================================================
function open() { if (!window.isMember()) return window.members(open); if (!ed.bytes) return draftDialog(); ed.ai = ed.ai || { tab: 'review', items: null, chat: [] }; ed.ai.open = true; refresh(); }
function close() { if (ed.ai) ed.ai.open = false; const h = $('#edPanel'); if (h) h.dataset.built = ''; renderPanel(); }
const verifyMarks = (s) => esc(s).replace(/((?:Ley|D\.?F\.?L\.?|Decreto(?: Ley)?)\s+(?:N[°º.]?\s*)?[\d.]+|art[íi]culos?\s+\d+[^\s,.;]*(?:\s+(?:del|de la)\s+(?:C[óo]digo|Ley)\s+[A-ZÁÉÍÓÚ][\wáéíóú]*(?:\s+N[°º]?\s*[\d.]+)?)?)/gi, '<mark class="verify" title="Cita legal: verifícala antes de usarla">$1</mark>');

async function panel(host) {
  const s = await status(); await wallet(true);
  const a = ed.ai;
  const head = `<div class="ai-head"><h4>${icon('sparkle', 14)} Asistente legal</h4><button class="ibtn" id="aiClose" title="Volver a Formato">${icon('x', 14)}</button></div>`;
  if (!s.hasKey || a.tab === 'settings') { host.innerHTML = `<div class="sec ai">${head}${settingsHtml(s)}</div>`; bindSettings(host); return; }
  const tabs = `<div class="ai-tabs">${[['review', 'Revisar'], ['draft', 'Redactar'], ['ask', 'Preguntar']].map(([k, l]) => `<button data-aitab="${k}" class="${a.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (a.tab === 'review') {
    const items = a.items;
    body = `<p class="hint">Revisa ortografía, redacción, datos que no calzan (RUT, montos), lo que falta y los riesgos del documento.</p>
      <button class="primary pbtn" id="aiReview">${icon('sparkle', 15)} ${items ? 'Revisar de nuevo' : 'Revisar documento'} <small class="tk-cost">${tk(wal?.costs?.review ?? 1)}</small></button>
      ${a.summary ? `<div class="ai-summary">${esc(a.summary)}</div>` : ''}
      ${items ? (items.length ? `<div class="ai-items">${items.map((it, n) => `<div class="ai-item g-${esc(it.gravedad || 'media')} ${it.done ? 'done' : ''}" data-n="${n}">
          <div class="ai-tag">${TYPES[it.tipo] || 'Observación'}${it.local ? ' · verificado' : ''}${it.done ? ` · ${it.done}` : ''}</div>
          ${it.cita ? `<div class="ai-quote">«${esc(it.cita)}»</div>` : ''}
          ${it.sugerencia ? `<div class="ai-sug">${icon('chevR', 12)} «${esc(it.sugerencia)}»</div>` : ''}
          <div class="ai-exp">${verifyMarks(it.explicacion || '')}</div>
          ${it.done ? '' : `<div class="ai-acts">${it.sugerencia && it.cita ? '<button class="primary small" data-apply>Aplicar</button>' : ''}${it.cita ? '<button class="ghost small" data-go>Ver</button>' : ''}<button class="ghost small" data-skip>Descartar</button></div>`}
        </div>`).join('')}</div>` : '<p class="hint">No se encontraron observaciones.</p>') : ''}`;
  } else if (a.tab === 'draft') {
    body = `<p class="hint">Describe el documento: tipo, partes, plazos, montos y condiciones. Los datos que no indiques quedan como [CAMPOS] para completar.</p>
      <textarea id="aiDraftQ" rows="7" placeholder="Ej.: Contrato de arriendo de oficina en Providencia por 12 meses, renta de $800.000 reajustable por IPC, garantía de un mes, término anticipado con 60 días de aviso.">${esc(a.draftQ || '')}</textarea>
      <button class="primary pbtn" id="aiDraft">${icon('sparkle', 15)} Crear borrador <small class="tk-cost">${tk(wal?.costs?.draft ?? 2)}</small></button>
      <p class="hint">Se abre en una pestaña nueva, listo para completar los datos en un formulario. Después puedes pedir cambios al texto.</p>`;
  } else {
    body = `<div class="ai-chat" id="aiChat">${(a.chat || []).filter((m) => !m.ctx).map((m) => `<div class="ai-msg ${m.role}">${m.role === 'assistant' ? verifyMarks(m.content).replace(/\n/g, '<br>') : esc(m.content)}</div>`).join('') || '<p class="hint">Pregunta sobre el documento abierto: plazos, obligaciones, riesgos, qué falta…</p>'}</div>
      <div class="ai-askrow"><textarea id="aiQ" rows="2" placeholder="Ej.: ¿Qué pasa si el cliente no paga?"></textarea><button class="primary small" id="aiAsk">Preguntar</button></div><p class="hint" data-askleft>${askHint()}</p>`;
  }
  host.innerHTML = `<div class="sec ai">${head}${tokenBar()}${tabs}${body}
    <p class="ai-foot">${icon('scanText', 12)} Puede equivocarse: verifica sus sugerencias y las normas marcadas en <mark class="verify">amarillo</mark>. No reemplaza la revisión de un abogado.<br>
    <a href="#" id="aiSettings">Ajustes</a>${a.model ? ` · modelo ${esc(a.model)}` : ''}</p></div>`;
  bindPanel(host);
  const c = host.querySelector('#aiChat'); if (c) c.scrollTop = c.scrollHeight;
}
function settingsHtml(s) {
  const prov = s.providers || {};
  if (s.managed) return `<p class="hint">El asistente viene incluido con PortalFirma Studio (${esc(prov[s.provider]?.label || s.provider)}${s.model ? ', modelo ' + esc(s.model) : ''}). No necesitas configurar nada.</p>
    <p class="hint">El texto de los documentos que revises se envía a ese proveedor para procesarlo.</p>
    <button class="ghost small" id="aiBack">Volver al asistente</button>`;
  return `<p class="hint">El asistente usa tu propia cuenta de un proveedor de IA. Crea una clave de API solo para esta app, con un límite de gasto, e ingrésala aquí. Queda cifrada en este computador.</p>
    <label class="tf"><span>Proveedor</span><select id="aiProv">${Object.entries(prov).map(([k, v]) => `<option value="${k}" ${k === s.provider ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
    <label class="tf"><span>Clave de API ${s.keyEnd ? `<em class="muted">(guardada, termina en …${esc(s.keyEnd)})</em>` : ''}</span><input type="password" id="aiKey" autocomplete="off" spellcheck="false" placeholder="${s.keyEnd ? 'Pega otra clave para reemplazarla' : 'Pega aquí tu clave'}" /></label>
    <p class="hint"><a href="#" id="aiKeySite">¿Dónde se crea la clave?</a></p>
    <label class="tf"><span>Modelo</span><div class="prow"><select id="aiModel"><option value="${esc(s.model || '')}">${esc(s.model || 'Automático (el más capaz disponible)')}</option></select><button class="ghost small fixed" id="aiLoadModels">Ver modelos</button></div></label>
    <div class="prow"><button class="primary pbtn" id="aiSave">Guardar</button></div>
    ${s.keyEnd ? '<button class="ghost small" id="aiDelKey">Borrar la clave de este computador</button>' : ''}
    ${s.hasKey ? '<button class="ghost small" id="aiBack">Volver al asistente</button>' : ''}`;
}
function bindSettings(host) {
  host.querySelector('#aiClose').onclick = close;
  if (st?.managed) { host.querySelector('#aiBack').onclick = () => { ed.ai.tab = 'review'; refresh(); }; return; }
  const prov = host.querySelector('#aiProv');
  host.querySelector('#aiKeySite').onclick = (e) => { e.preventDefault(); const u = st.providers?.[prov.value]?.site; if (u) pf.openUrl(u); };
  host.querySelector('#aiLoadModels').onclick = async () => {
    const r = await pf.aiModels(); if (!r.ok) return toast(r.error, 5000);
    const sel = host.querySelector('#aiModel'); const cur = sel.value;
    sel.innerHTML = `<option value="">Automático (el más capaz disponible)</option>` + r.data.map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
  };
  host.querySelector('#aiSave').onclick = async () => {
    const key = host.querySelector('#aiKey').value.trim();
    const p = { provider: prov.value, model: host.querySelector('#aiModel').value };
    if (key) p.key = key;
    const r = await pf.aiConfig(p); host.querySelector('#aiKey').value = '';
    if (!r.ok) return toast(r.error, 5000);
    st = r.data; toast(key ? 'Clave guardada de forma cifrada en este computador.' : 'Ajustes guardados.');
    if (st.hasKey) ed.ai.tab = 'review'; refresh();
  };
  const del = host.querySelector('#aiDelKey'); if (del) del.onclick = async () => { const r = await pf.aiConfig({ key: '' }); if (r.ok) { st = r.data; toast('Clave borrada.'); refresh(); } };
  const back = host.querySelector('#aiBack'); if (back) back.onclick = () => { ed.ai.tab = 'review'; refresh(); };
}
function bindPanel(host) {
  host.querySelector('#aiClose').onclick = close;
  host.querySelector('[data-tkbuy]').onclick = () => tokensDialog();
  host.querySelectorAll('[data-aitab]').forEach((b) => (b.onclick = () => { ed.ai.tab = b.dataset.aitab; refresh(); }));
  host.querySelector('#aiSettings').onclick = (e) => { e.preventDefault(); ed.ai.tab = 'settings'; refresh(); };
  const rv = host.querySelector('#aiReview'); if (rv) rv.onclick = review;
  const dr = host.querySelector('#aiDraft'); if (dr) dr.onclick = () => { ed.ai.draftQ = host.querySelector('#aiDraftQ').value; draft(ed.ai.draftQ); };
  const ak = host.querySelector('#aiAsk'); if (ak) { ak.onclick = askDoc; host.querySelector('#aiQ').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askDoc(); } }; }
  const items = host.querySelector('.ai-items');
  if (items) items.onclick = async (e) => {
    const card = e.target.closest('.ai-item'); if (!card) return; const it = ed.ai.items[Number(card.dataset.n)];
    if (e.target.closest('[data-skip]')) { it.done = 'descartada'; refresh(); }
    else if (e.target.closest('[data-go]')) gotoQuote(it);
    else if (e.target.closest('[data-apply]')) {
      const p = await applySuggestion(it);
      if (p >= 0) { it.done = 'aplicada'; window.editor.goto(p); refresh(); toast('Sugerencia aplicada. Puedes deshacerla con ⌘Z.'); }
      else toast('No encontré ese texto exacto en el documento. Aplícalo a mano con «Editar texto».', 5000);
    }
  };
}

// ---------- acciones ----------
async function review() {
  if (!(await ensureConsent())) return;
  const T = ed;
  await step('El asistente está revisando el documento…', async () => {
    const { text, cut, scanned } = await docText();
    if (!text.replace(/\[Página \d+\]/g, '').trim()) throw new Error('El documento no tiene texto legible. Si es una fotocopia, usa primero «Reconocer texto».');
    const prompt = `REVISAR\nRevisa el siguiente documento.${cut ? ' (El documento es largo: se envía solo la primera parte).' : ''}
Devuelve un objeto JSON con esta forma:
{"resumen": "2 a 3 frases sobre qué es el documento y su estado",
 "observaciones": [{"tipo": "ortografia|redaccion|coherencia|falta|riesgo", "gravedad": "alta|media|baja",
   "cita": "texto EXACTO copiado del documento, máximo 200 caracteres, o null si es algo que falta",
   "sugerencia": "texto que reemplaza exactamente a la cita, o null si no corresponde reemplazar",
   "explicacion": "por qué, en una o dos frases"}]}
Reglas: la cita debe ser literal (mismas palabras y mayúsculas) para poder ubicarla; máximo 25 observaciones, primero las más importantes; no repitas observaciones; si algo falta (plazo, domicilio, jurisdicción, firma, fecha de pago…) usa tipo "falta" y cita null.
Documento:
<<<
${text}
>>>`;
    const out = parseJson(await ask({ system: SYSTEM, messages: [{ role: 'user', content: prompt }], json: true, action: 'review' }));
    const items = [...localChecks(text), ...(Array.isArray(out.observaciones) ? out.observaciones : [])]
      .filter((x) => x && x.explicacion).map((x) => ({ ...x, cita: x.cita ? String(x.cita) : null, sugerencia: x.sugerencia ? String(x.sugerencia) : null }));
    const rank = { alta: 0, media: 1, baja: 2 }; items.sort((a, b) => (rank[a.gravedad] ?? 1) - (rank[b.gravedad] ?? 1));
    T.ai.items = items; T.ai.summary = (out.resumen || '') + (scanned ? ` (${scanned} página(s) sin texto: usa «Reconocer texto» para incluirlas.)` : '');
  });
  refresh(T);
}
function mdToHtml(md) {
  const lines = String(md).replace(/\r/g, '').split('\n'); let html = ''; let para = [];
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>');
  const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  for (const l of lines) {
    const t = l.trim();
    if (!t) { flush(); continue; }
    if (/^#\s+/.test(t)) { flush(); html += `<h1>${inline(t.replace(/^#\s+/, ''))}</h1>`; continue; }
    if (/^#{2,}\s+/.test(t)) { flush(); html += `<h2>${inline(t.replace(/^#+\s+/, ''))}</h2>`; continue; }
    if (/^[-*]\s+/.test(t)) { flush(); html += `<p>• ${inline(t.replace(/^[-*]\s+/, ''))}</p>`; continue; }
    para.push(t);
  }
  flush(); return html;
}
// ============================================================================
// Redactar documentos: la IA entrega el texto con los datos variables marcados;
// se abre directo como formulario para completar, y se puede mejorar con el chat.
// ============================================================================
const LEYENDA = 'El presente documento ha sido suscrito por los comparecientes mediante firma electrónica avanzada, acogiéndose a lo dispuesto en la Ley N° 19.799 sobre Documentos Electrónicos, Firma Electrónica y Servicios de Certificación de dicha Firma, y su reglamento. Conforme a dicha ley, los actos y contratos suscritos por medio de firma electrónica son válidos de la misma manera y producen los mismos efectos que los celebrados por escrito y en soporte de papel.';

// Documentos que no se pueden firmar electrónicamente (requieren comparecer en notaría)
function blockedDoc(text) {
  const t = normText(String(text || ''));
  if (/\bpagar[e]s?\b/.test(t) && !/\b(mandato|poder)\b/.test(t)) return { kind: 'pagare', title: 'Pagaré', msg: 'Un pagaré no puede firmarse de manera electrónica: requiere firma ante notario, en forma presencial.', suggest: 'Mandato para la suscripción de un pagaré: el mandante faculta a un mandatario para que, en su nombre y representación, suscriba ante notario un pagaré a favor de [beneficiario], por el monto y en las condiciones que se indiquen.' };
  if (/\b(sal(ida|ir|ga|gan)|viaj\w*)\b.{0,40}\b(pais|extranjero|chile)\b|\bpermiso de viaje\b/.test(t) && /\b(menor|menores|hij[oa]s?|nin[oa]s?|adolescentes?)\b/.test(t)) return { kind: 'menor', title: 'Autorización de salida del país de un menor', msg: 'La autorización para que un menor salga del país no puede firmarse de manera electrónica: requiere comparecer en notaría.' };
  if (/\bfiniquitos?\b/.test(t)) return { kind: 'finiquito', title: 'Finiquito', msg: 'Un finiquito no puede firmarse de manera electrónica en Portalfirma: requiere ratificación presencial ante un ministro de fe.' };
  return null;
}
function showBlocked(b, onSuggest) {
  modal(`<h2>${esc(b.title)}: requiere presencialidad</h2><p>${esc(b.msg)}</p>
    ${b.suggest ? `<p class="muted">Lo que sí se puede firmar electrónicamente es un <strong>mandato</strong> para que otra persona suscriba el pagaré en tu nombre ante notario.</p>` : ''}
    <div class="actions"><button class="secondary" id="mCancel">Cerrar</button>${b.suggest ? '<button class="primary" id="mOk">Redactar el mandato</button>' : ''}</div>`);
  $('#mCancel').onclick = closeModal;
  if (b.suggest) $('#mOk').onclick = () => { closeModal(); onSuggest?.(b.suggest); };
}

const DRAFT_SYSTEM = `Eres un abogado chileno experto en redacción de contratos y documentos privados, que trabaja para Portalfirma, una plataforma de firma electrónica avanzada.
Redactas documentos que cumplen la normativa chilena vigente (Código Civil, Código de Comercio, Código del Trabajo, Ley 18.101 de arrendamiento de predios urbanos, Ley 19.496 del consumidor, Ley 19.628 de datos personales y demás leyes especiales que correspondan al tipo de documento).

ESTILO
- Español jurídico de Chile, claro y preciso; sin anglicismos ni fórmulas de otros países.
- Comparecencia completa al inicio: «En [[Ciudad]], a [[Fecha del contrato]], comparecen: …». De cada persona natural: nombre, nacionalidad, estado civil, profesión u oficio, cédula de identidad y domicilio. De una persona jurídica: razón social, RUT, domicilio y su representante legal con su cédula. Cierra con «…los comparecientes mayores de edad, quienes acreditan su identidad con las cédulas citadas y exponen:».
- Cláusulas numeradas en palabras y en negrita: «**PRIMERO: Objeto.** …», «**SEGUNDO: …**». Incluye todos los elementos esenciales y de la naturaleza del acto (objeto, precio o contraprestación, forma y fecha de pago, plazo, obligaciones de cada parte, término anticipado, incumplimiento, garantías si corresponden) y una cláusula de domicilio y competencia de los Tribunales Ordinarios de Justicia.
- Cita normas solo si estás seguro del número de ley o artículo; si no, describe la regla sin citar.

DATOS VARIABLES
- TODO dato que cambia de un documento a otro va como marcador [[Etiqueta]]: nombres, RUT, nacionalidad, estado civil, profesión, domicilios, fechas, montos, plazos en días o meses, direcciones de inmuebles, patentes, números de cuotas, porcentajes, correos, etc.
- La etiqueta es corta y clara (máximo 40 caracteres); para los datos de una parte usa «Rol: dato» (ej. [[Arrendatario: nombre]], [[Arrendatario: RUT]]). Un mismo dato lleva SIEMPRE la misma etiqueta exacta, aunque aparezca varias veces.
- Montos: solo el marcador, sin «$» ni palabras (el sistema escribe «$800.000 (ochocientos mil pesos)»). Fechas: solo el marcador (el sistema escribe «3 de noviembre de 2026»). RUT y cédulas: solo el marcador.
- Si la descripción trae un dato concreto, igual va como marcador y pon ese dato en "valor" para que el formulario venga prellenado.
- Para cada parte que firma, agrega también su correo como campo solo de formulario (no va en el texto): {"etiqueta": "Rol: correo", "tipo": "email", "firmante": {"rol": "Rol", "dato": "email"}, "solo_formulario": true}.

PROHIBIDO
- No incluyas firmas, líneas para firmar, «p.p.», nombres bajo una línea ni lugares para huella: la plataforma agrega las firmas al firmar.
- No escribas la leyenda de firma electrónica ni menciones la Ley 19.799: la plataforma la agrega al final.
- No digas que se firma «en dos ejemplares» ni en papel: el documento es electrónico.
- No redactes pagarés, autorizaciones de salida del país de menores ni finiquitos (requieren presencialidad en notaría): en ese caso devuelve "bloqueado" con el motivo.

RESPUESTA
Solo un objeto JSON:
{"bloqueado": null o "motivo",
 "titulo": "TÍTULO EN MAYÚSCULAS",
 "cuerpo": "texto del documento en markdown (sin el título), párrafos separados por una línea en blanco, con los [[marcadores]]",
 "campos": [{"etiqueta": "igual al marcador", "tipo": "texto|rut|fecha|monto|numero|email|telefono|parrafo", "firmante": {"rol": "Arrendatario", "dato": "fullName|rut|email|phone"} o null, "valor": "dato ya conocido" o null, "solo_formulario": false}]}`;

// limpia lo que el modelo no debe poner (firmas, leyenda) y deja la estructura lista
function cleanSpec(out, prev) {
  if (!out || typeof out !== 'object') throw new Error('La respuesta del asistente no vino en el formato esperado. Intenta de nuevo.');
  let body = String(out.cuerpo || '').replace(/\r/g, '');
  body = body.split(/\n{2,}/).filter((p) => !/19\.?799/.test(p) && !/_{4,}|\[FIRMAS?\]|^\s*(firma|p\.p\.)\b/im.test(p)).join('\n\n').trim();
  body = body.replace(/^#\s+.+\n+/, '');
  const used = [...new Set([...body.matchAll(/\[\[([^\]\n]{1,60})\]\]/g)].map((m) => m[1].trim()))];
  const byLabel = new Map((Array.isArray(out.campos) ? out.campos : []).map((c) => [String(c.etiqueta || '').trim(), c]));
  const okType = (t) => ['texto', 'rut', 'fecha', 'monto', 'numero', 'email', 'telefono', 'parrafo'].includes(t) ? t : 'texto';
  const sig = (f) => (f && f.rol && ['fullName', 'rut', 'email', 'phone'].includes(f.dato) ? { rol: String(f.rol).trim(), dato: f.dato } : null);
  const campos = used.map((l) => { const c = byLabel.get(l) || {}; return { etiqueta: l, tipo: okType(c.tipo), firmante: sig(c.firmante), valor: c.valor ?? null }; });
  for (const c of byLabel.values()) if (c.solo_formulario && c.etiqueta && !used.includes(c.etiqueta.trim())) campos.push({ etiqueta: c.etiqueta.trim(), tipo: okType(c.tipo), firmante: sig(c.firmante), valor: c.valor ?? null, solo_formulario: true });
  if (!body || !used.length) throw new Error('El asistente no entregó un documento con datos para completar. Intenta describirlo de nuevo.');
  return { titulo: String(out.titulo || prev?.titulo || 'Documento').trim().slice(0, 90), cuerpo: body, campos };
}
function specHtml(spec) {
  return `<h1>${esc(spec.titulo)}</h1>` + mdToHtml(spec.cuerpo).replace(/\[\[([^\]]+)\]\]/g, '<span class="ph">[$1]</span>') + `<p class="leyenda">${esc(LEYENDA)}</p>`;
}
// ---------- Redactar: primero se busca un modelo aprobado de Portalfirma; la IA solo si no hay uno que calce ----------
const STOP = new Set('para con por del los las una uno que mis sus mas sin entre sobre desde hasta este esta como donde cuando necesito quiero hacer documento contrato'.split(' '));
const SYN = { arrendamiento: 'arriendo', arrendar: 'arriendo', arrienda: 'arriendo', arrendatario: 'arriendo', arrendador: 'arriendo', pagare: 'pagare', pagares: 'pagare', nda: 'confidencialidad', confidencial: 'confidencialidad', domestica: 'particular', nana: 'particular', apoderado: 'poder', mandato: 'mandato', mandatos: 'mandato', poderes: 'poder', auto: 'vehiculo', vehiculos: 'vehiculo', camioneta: 'vehiculo', menor: 'menor', hijo: 'menor', hija: 'menor', deuda: 'deuda', deudas: 'deuda', mudanza: 'mudanza', trasteo: 'mudanza' };
const normTx = (s) => String(s || '').replace(/\b([A-Za-z])\.(?=[A-Za-z]\.)/g, '$1').replace(/\b([A-Za-z])\.(?![A-Za-z])/g, '$1').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => normTx(s).split(' ').map((w) => SYN[w] || w.replace(/(es|s)$/, '')).filter((w) => w.length > 2 && !STOP.has(w));
let MODELS = null;
async function findModels(q) {
  if (!MODELS) { const r = await pf.flujosModels(); MODELS = r.ok ? r.data : []; }
  const qt = [...new Set(toks(q))]; if (!qt.length) return [];
  const nq = normTx(q).replace(/^(un|una|el|la)\s+/, '');
  return MODELS.map((m) => {
    const nt = new Set(toks(m.nombre)); const ot = new Set(toks(`${m.descripcion} ${m.categoria}`));
    let score = 0; let inName = 0;
    for (const t of qt) { if (nt.has(t)) { score += 3; inName++; } else if (ot.has(t)) score += 1; }
    if (nq.length > 8 && normTx(m.nombre).includes(nq)) score += 4;
    return { m, score, inName, head: nt.has(qt[0]) };
  }).filter((x) => x.inName && x.score >= 3 && (x.head || x.score >= 6)) // el tipo de documento (primera palabra) debe calzar
    .sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.m);
}
// Modelo de la biblioteca → mismo formato que entrega la IA (texto con [[Etiqueta]] y lista de campos)
const niceLb = (t) => { t = String(t || '').replace(/\s*\(.*$/, '').trim(); return t === t.toUpperCase() ? t.toLowerCase().replace(/^\S/, (c) => c.toUpperCase()).replace(/\brut\b/g, 'RUT').replace(/\buf\b/g, 'UF') : t; };
function modelSpec(m) {
  const lines = m.texto.replace(/\r/g, '').split('\n'); let i = lines.findIndex((l) => l.trim());
  const titulo = lines[i].replace(/^#\s+/, '').replace(/\*\*/g, '').trim();
  let body = lines.slice(i + 1).join('\n').trim();
  const paras = body.split(/\n{2,}/); if (/^El presente documento ha sido suscrito/i.test(paras[paras.length - 1]?.replace(/\*\*/g, '').trim())) paras.pop(); // la leyenda la pone la app
  body = paras.join('\n\n');
  const fields = new Map(m.fields.map((f) => [f.id, f])); const labelOf = new Map(); const used = new Set();
  const cut = (t) => { if (t.length <= 34) return t; let o = ''; for (const w of t.split(' ')) { if ((o + ' ' + w).trim().length > 34) break; o = (o + ' ' + w).trim(); } return o.replace(/\s+(de|del|la|las|el|los|y|o|a|en|con|por|para)$/i, ''); };
  const plain = (f) => cut(niceLb(f.label).replace(/\s*["“”«»]?si existe["“”«»]?/i, '').replace(/["“”«»]/g, '').replace(/\s+/g, ' ').trim()); // datos cortos: caben en una línea
  const dupPlain = (f) => m.fields.some((g) => g.id !== f.id && plain(g).toLowerCase() === plain(f).toLowerCase());
  for (const f of m.fields) {
    // quien firma: «Arrendador: Nombre»; el resto, solo el dato (con su grupo si el nombre se repite)
    let l = f.signer ? `${f.groupLabel}: ${plain(f)}` : f.group === 'documento' || !dupPlain(f) ? plain(f) : `${plain(f)} (${f.groupLabel.toLowerCase()})`;
    let k = l; let n = 2; while (used.has(k)) k = `${l} ${n++}`; used.add(k); labelOf.set(f.id, k);
  }
  body = body.replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, (_, id) => `[[${labelOf.get(id) || id}]]`)
    .replace(/\*\*\s*(\[\[[^\]]+\]\])\s*\*\*/g, '$1') // el dato sin negrita (igual que en los documentos de la IA)
    .replace(/([^\s(«"“$])\[\[/g, '$1 [[').replace(/\]\]([^\s.,;:)»"”])/g, ']] $1') // espacio alrededor de cada dato
    .replace(/\]\]\s+([,.;:])/g, ']]$1').replace(/\*\*\s*\*\*/g, '').replace(/ {2,}/g, ' ');
  const tipo = (f) => (/(^|-)rut(-|$)/.test(f.key) && !/pasaporte/i.test(f.label) ? 'rut' : /^fecha/i.test(f.key) || /^FECHA/.test(f.label) ? 'fecha' : f.key === 'email' ? 'email' : /^tel[eé]fono/.test(f.key) ? 'telefono' : 'texto');
  const campos = m.fields.map((f) => ({ etiqueta: labelOf.get(f.id), tipo: tipo(f), firmante: f.signer && f.signerKey ? { rol: f.groupLabel, dato: f.signerKey } : null, valor: null }));
  void fields;
  return { titulo, cuerpo: body, campos, modelo: { id: m.id, nombre: m.nombre } };
}
async function useModel(id, q) {
  let spec = null;
  await step('Preparando el modelo de Portalfirma…', async () => {
    const r = await pf.flujosModel(id); if (!r.ok || !r.data) throw new Error('No encontré el modelo.');
    spec = modelSpec(r.data); spec.desc = q; spec.history = [];
  });
  if (spec) await window.Plantillas.buildAiDoc(spec);
}
function chooseModel(q, cands) {
  let pick = cands[0].id;
  modal(`<h2>${icon('template', 18)} Hay un modelo de Portalfirma para esto</h2>
    <p class="muted small">Son modelos aprobados de la Notaría Virtual: el texto ya está revisado y solo completas los datos. No gasta tokens.</p>
    <div class="ai-models">${cands.map((m, i) => `<label class="ai-model ${i ? '' : 'on'}"><input type="radio" name="aiM" value="${m.id}" ${i ? '' : 'checked'} /><span><b>${esc(m.nombre)}</b><small>${esc(m.descripcion || '')}</small><small class="muted">${m.roles?.length ? 'Firman: ' + m.roles.map((r) => esc(r.alias)).join(', ') : ''}</small></span></label>`).join('')}</div>
    <div class="actions"><button class="ghost" id="mCancel">Cancelar</button><button class="secondary" id="aiFree">Prefiero que la IA lo redacte <small class="tk-cost">${tk(wal?.costs?.draft ?? 2)}</small></button><button class="primary" id="mOk">Usar este modelo</button></div>`);
  $('#modalCard').querySelectorAll('input[name="aiM"]').forEach((r) => (r.onchange = () => { pick = r.value; $('#modalCard').querySelectorAll('.ai-model').forEach((l) => l.classList.toggle('on', l.contains(r))); }));
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = () => { closeModal(); useModel(pick, q); };
  $('#aiFree').onclick = () => { closeModal(); draft(q, { models: false }); };
}
async function draft(q, opts = {}) {
  if (!q || q.trim().length < 15) return toast('Describe el documento con un poco más de detalle.');
  const b = blockedDoc(q); if (b) return showBlocked(b, (s) => draft(s));
  if (opts.models !== false) { const c = await findModels(q).catch(() => []); if (c.length) return chooseModel(q, c); }
  if (!(await ensureConsent())) return;
  let spec = null;
  await step('El asistente está redactando el documento… (puede tardar hasta un minuto)', async () => {
    const out = parseJson(await ask({ action: 'draft', json: true, system: DRAFT_SYSTEM, messages: [{ role: 'user', content: `REDACTAR\nRedacta el documento que se describe:\n${q}` }] }));
    if (out.bloqueado) { spec = { blocked: String(out.bloqueado) }; return; }
    spec = cleanSpec(out); spec.desc = q; spec.history = [];
  });
  if (!spec) return;
  if (spec.blocked) return showBlocked({ title: 'Documento no disponible', msg: spec.blocked });
  await window.Plantillas.buildAiDoc(spec);
}
// Mejorar el documento con instrucciones (1 token por modificación)
async function improveDoc(instr) {
  if (!window.isMember()) return window.members(() => improveDoc(instr));
  const T = ed; const spec = T.aiDoc; if (!spec || !instr || instr.trim().length < 4) return;
  const b = blockedDoc(instr); if (b && b.kind !== 'pagare') return showBlocked(b);
  if (b) return showBlocked(b, (s) => draft(s));
  if (!(await ensureConsent())) return;
  let next = null; let note = '';
  await step('El asistente está modificando el documento…', async () => {
    const cur = { titulo: spec.titulo, cuerpo: spec.cuerpo, campos: spec.campos };
    const out = parseJson(await ask({ action: 'edit', json: true, system: DRAFT_SYSTEM, messages: [{ role: 'user', content: `MODIFICAR\nEste es el documento actual (JSON):\n<<<JSON\n${JSON.stringify(cur)}\nJSON>>>\nAplica este cambio y devuelve el documento COMPLETO con el mismo formato JSON, conservando las etiquetas de los marcadores que no cambian. Agrega "resumen_cambio" con una frase sobre lo que cambiaste.\nCambio pedido: ${instr}` }] }));
    if (out.bloqueado) { next = { blocked: String(out.bloqueado) }; return; }
    next = cleanSpec(out, spec); note = String(out.resumen_cambio || instr).slice(0, 200);
  });
  if (!next) return;
  if (next.blocked) return showBlocked({ title: 'Cambio no disponible', msg: next.blocked });
  next.desc = spec.desc; next.history = [...(spec.history || []), { instr, note }];
  await window.Plantillas.buildAiDoc(next, T);
  toast('Documento modificado: ' + note, 5000);
}
// Editar el texto a mano (gratis): el texto con los [[marcadores]]
function editDocText() {
  const spec = ed.aiDoc; if (!spec) return;
  modal(`<h2>Editar texto</h2><p class="muted small">Los datos entre [[ ]] son los campos del formulario: puedes moverlos, borrarlos o crear nuevos escribiendo [[Nombre del dato]]. Las cláusulas van en **negrita** con doble asterisco.</p>
    <label>Título<input id="eTitle" value="${esc(spec.titulo)}" /></label>
    <textarea id="eBody" rows="18" style="width:100%;font:13px/1.45 ui-monospace,Menlo,monospace">${esc(spec.cuerpo)}</textarea>
    <p class="muted small">La leyenda de firma electrónica avanzada (Ley 19.799) se agrega siempre al final.</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Aplicar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const titulo = $('#eTitle').value.trim(), cuerpo = $('#eBody').value; closeModal();
    const b = blockedDoc(titulo); if (b && b.kind !== 'pagare') return showBlocked(b);
    let next; try { next = cleanSpec({ titulo, cuerpo, campos: spec.campos }, spec); } catch (e) { return toast(e.message, 5000); }
    next.desc = spec.desc; next.history = spec.history || [];
    await window.Plantillas.buildAiDoc(next, ed);
  };
}
// Sección del panel al completar un documento redactado por la IA
function aiDocSection() {
  const spec = ed.aiDoc; if (!spec) return '';
  return `<div class="sec ai ai-doc"><h4>${icon('sparkle', 13)} Mejorar con IA</h4>
    <p class="hint">Pide cambios al texto: «agrega una cláusula de codeudor solidario», «el plazo es indefinido con aviso de 60 días»…</p>
    <textarea id="aiImp" rows="3" placeholder="¿Qué quieres cambiar?"></textarea>
    <button class="primary pbtn" id="aiImpGo">${icon('sparkle', 15)} Aplicar cambio <small class="tk-cost">${tk(wal?.costs?.edit ?? 1)}</small></button>
    ${(spec.history || []).length ? `<div class="ai-hist">${spec.history.map((h) => `<div>${icon('chevR', 11)} ${esc(h.note)}</div>`).join('')}</div>` : ''}
    <button class="ghost small" id="aiEditTxt">${icon('textEdit', 14)} Editar el texto a mano</button></div>`;
}
function bindAiDoc(host) {
  const go = host.querySelector('#aiImpGo'); if (!go) return;
  wallet(true).then(() => { const c = go.querySelector('.tk-cost'); if (c && wal) c.textContent = tk(wal.costs.edit ?? 1); });
  go.onclick = () => improveDoc(host.querySelector('#aiImp').value.trim());
  host.querySelector('#aiEditTxt').onclick = editDocText;
}
function draftDialog(prefill = '') {
  if (!window.isMember()) return window.members(() => draftDialog(prefill), 'Redactar con IA es exclusivo para clientes de Portalfirma. Inicia sesión con tu cuenta.');
  modal(`<h2>${icon('sparkle', 18)} Redactar con el asistente</h2>
    <label>Describe el documento<textarea id="dq" rows="7" style="width:100%;margin-top:6px" placeholder="Ej.: Contrato de arriendo de una oficina en Providencia por 12 meses, renta de $800.000 reajustable por IPC, con garantía de un mes.">${esc(prefill)}</textarea></label>
    <p class="muted small">Se abre listo para completar los datos en un formulario; después puedes pedir cambios al texto. El asistente puede equivocarse: revisa el documento. No se pueden redactar pagarés, autorizaciones de salida del país de menores ni finiquitos (requieren notaría).</p>
    <div class="actions"><button class="secondary" id="mCancel">Cancelar</button><button class="primary" id="mOk">Redactar <small class="tk-cost">${tk(wal?.costs?.draft ?? 2)}</small></button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const q = $('#dq').value; closeModal();
    const s = await status(true);
    if (!s.hasKey) { toast('El asistente no está configurado. Abre «Asistente» → Ajustes.', 6000); return; }
    draft(q);
  };
}
async function askDoc() {
  const qEl = $('#aiQ'); const q = qEl?.value.trim(); if (!q) return;
  if (!(await ensureConsent())) return;
  const T = ed; const a = T.ai;
  if (!a.chat.some((m) => m.ctx)) { const { text } = await docText(); a.chat.push({ role: 'user', ctx: true, content: `Este es el documento sobre el que te voy a preguntar:\n<<<\n${text}\n>>>` }, { role: 'assistant', ctx: true, content: 'Entendido. ¿Qué quieres saber del documento?' }); }
  a.chat.push({ role: 'user', content: q }); refresh();
  await step('El asistente está respondiendo…', async () => {
    const ans = await ask({ action: 'ask', system: SYSTEM + '\nResponde de forma breve y concreta, citando la cláusula del documento cuando corresponda.', messages: a.chat.map(({ role, content }) => ({ role, content })) });
    a.chat.push({ role: 'assistant', content: ans });
  });
  refresh(T);
}

window.Asistente = { open, close, panel, draftDialog, draft, _findModels: findModels, _modelSpec: modelSpec, _useModel: useModel, improveDoc, aiDocSection, bindAiDoc, blockedDoc, _cleanSpec: cleanSpec, _specHtml: specHtml, LEYENDA, tokensDialog, wallet, SYSTEM, ensureConsent, status, docText, parseJson, ask: (req) => { ed.ai = ed.ai || { tab: 'review', items: null, chat: [] }; return ask(req); }, _localChecks: localChecks, _replaceInHtml: replaceInHtml, _mdToHtml: mdToHtml };
