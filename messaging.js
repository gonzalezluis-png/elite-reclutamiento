//  TWILIO VOICE — llamadas desde el navegador
// ════════════════════════════════════════════
let _twilioDevice = null;
let _twilioConn   = null;
let _cpTimerInt   = null;
let _cpSeconds    = 0;
let _cpMuted      = false;
let _cpReady      = false;

async function cpInit() {
  if (_cpReady) return true;
  try {
    const res  = await fetch(`${SERVER_URL}/twilio/token?identity=${encodeURIComponent(currentUser?.name||'agent')}`);
    const data = await res.json();
    if (!data.token) throw new Error(data.error || 'Sin token');
    _twilioDevice = new Twilio.Device(data.token, { codecPreferences: ['opus','pcmu'], logLevel: 1 });
    _twilioDevice.on('error', e => {
      const msg = e?.message || String(e);
      cpSetStatus('Error: ' + msg, '#e2445c');
      console.error('Twilio error:', e);
    });
    // Mark ready immediately — register() only needed for inbound calls
    _cpReady = true;
    cpSetStatus('Listo ✓', '#00c875');
    document.getElementById('cp-status-dot').style.background = '#00c875';
    return true;
  } catch (e) {
    cpSetStatus('Error: ' + (e?.message || String(e)), '#e2445c');
    console.error('cpInit:', e);
    return false;
  }
}

function cpTogglePanel() {
  const panel = document.getElementById('call-panel');
  const fab   = document.getElementById('phone-fab');
  const shown = panel.style.display !== 'none';
  if (shown) {
    panel.style.display = 'none';
    fab.style.background = '#00c875';
  } else {
    panel.style.display = 'block';
    fab.style.background = '#00a865';
    cpSetStatus('Listo', '#00c875');
    cpInit();
    setTimeout(() => document.getElementById('cp-manual-num')?.focus(), 80);
  }
}

function cpOpen(leadId) {
  const id   = leadId || currentLeadId;
  const lead = leads.find(l => l.id === id);
  const panel = document.getElementById('call-panel');
  const manualRow = document.getElementById('cp-manual-row');
  if (lead) {
    const phone = document.getElementById('ml-telefono')?.value?.trim() || lead.telefono || '';
    if (!phone) { showToast('Este lead no tiene teléfono'); return; }
    const initials = (lead.nombre||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
    document.getElementById('cp-avatar').textContent  = initials;
    document.getElementById('cp-name').textContent    = lead.nombre || 'Desconocido';
    document.getElementById('cp-number').textContent  = phone;
    document.getElementById('cp-call-btn').dataset.phone = phone;
    document.getElementById('cp-manual-num').value    = phone;
    manualRow.style.display = 'block';
  } else {
    document.getElementById('cp-avatar').textContent  = '📞';
    document.getElementById('cp-name').textContent    = 'Softphone';
    document.getElementById('cp-number').textContent  = 'Listo para marcar';
    document.getElementById('cp-call-btn').dataset.phone = '';
    document.getElementById('cp-manual-num').value    = '';
    manualRow.style.display = 'block';
  }
  panel.style.display = 'block';
  document.getElementById('phone-fab').style.background = '#00a865';
  cpSetStatus('Iniciando…', '#f59e0b');
  cpInit();
}

async function cpDial() {
  const manual = document.getElementById('cp-manual-num')?.value?.trim();
  const phone  = manual || document.getElementById('cp-call-btn').dataset.phone;
  if (!phone) { showToast('Ingresa un número para marcar'); document.getElementById('cp-manual-num')?.focus(); return; }
  document.getElementById('cp-call-btn').dataset.phone = phone;
  document.getElementById('cp-number').textContent = phone;
  if (!_cpReady) {
    const ok = await cpInit();
    if (!ok) return;
  }
  cpSetStatus('Llamando…', '#f59e0b');
  document.getElementById('cp-call-btn').style.display = 'none';
  _cpMuted = false;
  document.getElementById('cp-mute-btn').textContent = '🎤';
  try {
    _twilioConn = await _twilioDevice.connect({ params: { To: phone } });
    _twilioConn.on('accept',     () => cpOnConnect());
    _twilioConn.on('disconnect', () => cpOnHangup());
    _twilioConn.on('error',      e  => { cpSetStatus('Error en llamada', '#e2445c'); console.error(e); });
  } catch (e) {
    cpSetStatus('Error al marcar', '#e2445c');
    document.getElementById('cp-call-btn').style.display = 'flex';
  }
}

function cpOnConnect() {
  cpSetStatus('En llamada', '#00c875');
  document.getElementById('cp-status-dot').style.background = '#00c875';
  _cpSeconds = 0;
  _cpTimerInt = setInterval(() => {
    _cpSeconds++;
    const m = Math.floor(_cpSeconds / 60), s = _cpSeconds % 60;
    document.getElementById('cp-timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
  }, 1000);
}

function cpOnHangup() {
  clearInterval(_cpTimerInt);
  cpSetStatus('Llamada terminada', 'rgba(255,255,255,.4)');
  document.getElementById('cp-status-dot').style.background = '#555';
  document.getElementById('cp-call-btn').style.display = 'flex';
  document.getElementById('cp-timer').textContent = '0:00';
  _twilioConn = null;
  // Log note on the lead
  if (currentLeadId) {
    const lead = leads.find(l => l.id === currentLeadId);
    if (lead) {
      const dur = `${Math.floor(_cpSeconds/60)}:${(_cpSeconds%60).toString().padStart(2,'0')}`;
      if (!lead.notas) lead.notas = [];
      lead.notas.unshift({ texto: `📞 Llamada realizada · Duración: ${dur}`, fecha: new Date().toISOString(), autor: currentUser?.name || 'Sistema' });
      addHistorial(currentLeadId, `Llamada realizada (${dur})`, '📞');
      saveLeads();
      renderNotas(lead.notas);
    }
  }
  setTimeout(() => { if (!_twilioConn) document.getElementById('call-panel').style.display = 'none'; }, 3000);
}

function cpHangup() {
  if (_twilioConn) { _twilioConn.disconnect(); }
  else { clearInterval(_cpTimerInt); document.getElementById('call-panel').style.display = 'none'; document.getElementById('phone-fab').style.background = '#00c875'; }
}

function cpToggleMute() {
  if (!_twilioConn) return;
  _cpMuted = !_cpMuted;
  _twilioConn.mute(_cpMuted);
  document.getElementById('cp-mute-btn').textContent = _cpMuted ? '🔇' : '🎤';
  document.getElementById('cp-mute-btn').style.background = _cpMuted ? 'rgba(226,68,92,.3)' : 'rgba(255,255,255,.08)';
}

function cpSetStatus(text, color) {
  document.getElementById('cp-status').textContent = text;
  document.getElementById('cp-status').style.color = color || 'rgba(255,255,255,.6)';
}

// ── Messaging Page ────────────────────────────────────────────────────────────
let _msgFilter   = 'all';   // all | sms | wa | unread
let _msgSearch   = '';
let _msgLeadId   = null;
let _msgChannel  = 'sms';   // sms | wa
let _msgPollInt  = null;
let _msgLastCount = 0;

function showMessaging() {
  _hideAllViews();
  activeView = 'messaging';
  document.getElementById('board-title').textContent = 'Mensajería';
  document.getElementById('messaging-view').classList.add('active');
  document.getElementById('messaging-view').style.display = 'flex';
  document.getElementById('phone-fab').style.display = 'none';
  renderSidebar();
  _msgBuildPage();
  _msgSyncAllContacts();
  clearInterval(_msgPollInt);
  _msgPollInt = setInterval(_msgPollActive, 4000);
}

async function _msgSyncAllContacts() {
  try {
    const data = await fetch(`${SERVER_URL}/meta/wa-contacts`).then(r => r.json());
    if (!data.contacts || !data.contacts.length) return;
    let anyUpdated = false;
    for (const { phone, messages } of data.contacts) {
      if (!messages.length) continue;
      const digits = phone.replace(/\D/g, '');
      const lead = leads.find(l => {
        const ld = (l.telefono || '').replace(/\D/g, '');
        return ld && (ld === digits || ld.slice(-10) === digits.slice(-10));
      });
      if (!lead) continue;
      if (!lead.metaWa) lead.metaWa = [];
      for (const m of messages) {
        const ex = lead.metaWa.find(s => s.sid === m.sid);
        if (!ex) { lead.metaWa.push(m); anyUpdated = true; }
        else if (m.status && ex.status !== m.status) { ex.status = m.status; anyUpdated = true; }
      }
    }
    if (anyUpdated) {
      saveLeads();
      // Re-render messaging list only if view is open
      if (document.getElementById('msg-conv-list')) _msgRenderList();
    }
  } catch {}
}

function _msgMobBack() {
  document.getElementById('messaging-view')?.classList.remove('mob-chat-open');
}

function _msgBuildPage() {
  const view = document.getElementById('messaging-view');
  view.classList.remove('mob-chat-open'); // reset mobile state on rebuild
  view.innerHTML = `
    <div class="msg-sidebar">
      <div class="msg-sidebar-hdr">
        <h2>💬 Mensajería</h2>
        <input class="msg-search" placeholder="🔍 Buscar contacto o mensaje…" oninput="_msgSearch=this.value;_msgRenderList()" />
        <div class="msg-filters">
          <button class="msg-filter ${_msgFilter==='all'?'active':''}"   onclick="_msgSetFilter('all')">Todo</button>
          <button class="msg-filter ${_msgFilter==='sms'?'active':''}"   onclick="_msgSetFilter('sms')">📱 SMS</button>
          <button class="msg-filter ${_msgFilter==='wa'?'active':''}"    onclick="_msgSetFilter('wa')">💬 WhatsApp</button>
          <button class="msg-filter ${_msgFilter==='unread'?'active':''}" onclick="_msgSetFilter('unread')">🔴 No leídos</button>
        </div>
      </div>
      <div class="msg-conv-list" id="msg-conv-list"></div>
    </div>
    <div class="msg-main" id="msg-main">
      <div class="msg-empty-state">
        <div class="icon">💬</div>
        <div style="font-size:14px;font-weight:600;">Selecciona una conversación</div>
        <div style="font-size:12px;opacity:.6;">o inicia una nueva desde un lead</div>
      </div>
    </div>`;
  _msgRenderList();
}

function _msgSetFilter(f) {
  _msgFilter = f;
  document.querySelectorAll('.msg-filter').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  _msgRenderList();
}

function _msgGetConversations() {
  const convs = [];
  for (const lead of leads) {
    if (lead.invisible) continue;
    const hasSms    = lead.sms     && lead.sms.length > 0;
    const hasWaTwi  = lead.whatsapp && lead.whatsapp.length > 0;
    const hasWaMeta = lead.metaWa  && lead.metaWa.length > 0;
    const hasWa     = hasWaTwi || hasWaMeta;
    if (!hasSms && !hasWa) continue;
    if (_msgFilter === 'sms' && !hasSms) continue;
    if (_msgFilter === 'wa'  && !hasWa)  continue;

    const ts = m => new Date(m.dateSent || m.date || 0);

    // Build combined timeline
    const allMsgs = [
      ...(hasSms    ? lead.sms.map(m => ({...m, ch:'sms'}))      : []),
      ...(hasWaTwi  ? lead.whatsapp.map(m => ({...m, ch:'wa'}))  : []),
      ...(hasWaMeta ? lead.metaWa.map(m => ({...m, ch:'wa'}))    : []),
    ].sort((a,b) => ts(b) - ts(a));

    const last   = allMsgs[0];
    const unread = allMsgs.filter(m => m.direction === 'inbound' && !m.read).length;
    if (_msgFilter === 'unread' && unread === 0) continue;

    const q = _msgSearch.toLowerCase();
    if (q && !lead.nombre.toLowerCase().includes(q) && !(lead.telefono||'').includes(q) &&
        !allMsgs.some(m => (m.body||'').toLowerCase().includes(q))) continue;

    convs.push({ lead, last, unread, hasSms, hasWa });
  }
  return convs.sort((a,b) => new Date(b.last.dateSent||b.last.date||0) - new Date(a.last.dateSent||a.last.date||0));
}

function _msgRenderList() {
  const list  = document.getElementById('msg-conv-list');
  if (!list) return;
  const convs = _msgGetConversations();
  if (!convs.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text2);font-size:12px;">Sin conversaciones</div>';
    return;
  }
  const colors = ['#6366f1','#0073ea','#f59e0b','#00c875','#e2445c','#8b5cf6'];
  list.innerHTML = convs.map(({lead, last, unread, hasSms, hasWa}) => {
    const initials = (lead.nombre||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
    const color    = colors[(lead.nombre||'').charCodeAt(0) % colors.length];
    const chIcon   = last.ch === 'wa' ? '💬' : '📱';
    const preview  = (last.direction==='outbound' ? '↗ ':'↙ ') + (last.body||'').slice(0,40);
    const t        = (last.dateSent || last.date) ? fmtDateTime(last.dateSent || last.date) : '';
    const isActive = _msgLeadId === lead.id;
    const iaColor  = lead.ia_paused ? '#22c55e' : '#a855f7';
    const iaTitle  = lead.ia_paused ? 'Ana pausada (modo manual)' : 'Ana activa';
    const etapaLabel = lead.etapa ? esc(lead.etapa.length > 18 ? lead.etapa.slice(0,17)+'…' : lead.etapa) : '';
    return `<div class="msg-conv-item${isActive?' active':''}" onclick="_msgOpenConv('${lead.id}')">
      <div style="position:relative;">
        <div class="msg-conv-avatar" style="background:${color}">${initials}</div>
        <span title="${iaTitle}" style="position:absolute;bottom:0;right:0;width:9px;height:9px;border-radius:50%;background:${iaColor};border:1.5px solid var(--card);display:block;"></span>
      </div>
      <div class="msg-conv-info">
        <div class="msg-conv-name">${esc(lead.nombre||'Sin nombre')}</div>
        <div class="msg-conv-preview">${esc(preview)}</div>
        ${etapaLabel ? `<div style="font-size:9.5px;color:var(--text3);margin-top:1px;opacity:.75;">${etapaLabel}</div>` : ''}
      </div>
      <div class="msg-conv-meta">
        <div class="msg-conv-time">${t}</div>
        <div style="display:flex;gap:4px;align-items:center;">
          ${unread ? `<div class="msg-conv-badge">${unread}</div>` : ''}
          <span class="msg-conv-channel">${hasSms && hasWa ? '📱💬' : chIcon}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function _msgOpenConv(leadId) {
  _msgLeadId = leadId;
  _msgLastCount = 0;
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  // Mobile: show chat pane
  document.getElementById('messaging-view')?.classList.add('mob-chat-open');
  // Mark inbound as read
  (lead.sms||[]).forEach(m => { if(m.direction==='inbound') m.read = true; });
  (lead.whatsapp||[]).forEach(m => { if(m.direction==='inbound') m.read = true; });
  (lead.metaWa||[]).forEach(m => { if(m.direction==='inbound') m.read = true; });
  saveLeads();
  _msgRenderList();
  _msgRenderThread();
  if (typeof mobUpdateUnreadBadge === 'function') mobUpdateUnreadBadge();
  // Fetch fresh messages from server (fills in metaWa if empty)
  if (lead.telefono) {
    lcFetchMessages(lead).then(() => {
      if (_msgLeadId === leadId) { _msgRenderList(); _msgRenderThread(); }
    }).catch(() => {});
  }
}

function _msgRenderThread() {
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!lead) return;
  const main  = document.getElementById('msg-main');
  const phone = lead.telefono || '';
  const hasSms = (lead.sms||[]).length > 0;
  const hasWa  = (lead.whatsapp||[]).length > 0 || (lead.metaWa||[]).length > 0;
  if (!_msgChannel || (_msgChannel==='sms' && !hasSms && hasWa)) _msgChannel = hasWa ? 'wa' : 'sms';

  const colors = ['#6366f1','#0073ea','#f59e0b','#00c875','#e2445c','#8b5cf6'];
  const color  = colors[(lead.nombre||'').charCodeAt(0) % colors.length];
  const initials = (lead.nombre||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();

  const msgs = dedupMsgs([
    ...(lead.sms||[]).map(m => ({...m, ch:'sms'})),
    ...(lead.whatsapp||[]).map(m => ({...m, ch:'wa'})),
    ...(lead.metaWa||[]),
  ].sort((a,b) => new Date(a.dateSent||a.date||0) - new Date(b.dateSent||b.date||0)));

  const threadHtml = msgs.length ? msgs.map(m => {
    const out    = m.direction === 'outbound';
    const failed = out && m.status === 'failed';
    const _d     = m.dateSent || m.date;
    const time   = _d ? fmtDateTime(_d) : '';
    const ch     = m.ch;
    const tick   = failed ? '❌' : (out && ch==='wa' ? (m.status==='read' ? '<span style="color:#4fc3f7">✓✓</span>' : m.status==='delivered' ? '<span style="color:rgba(255,255,255,.5)">✓✓</span>' : '<span style="color:rgba(255,255,255,.35)">✓</span>') : '');
    const _errCode = m.error_code ? Number(m.error_code) : 0;
    const _errMsg  = _errCode === 131047 ? 'Ventana 24h expirada — usa una plantilla para recontactar'
                   : _errCode === 190    ? 'Token expirado — reconectar integración Meta'
                   : _errCode === 130429 ? 'Límite de mensajes alcanzado — intenta más tarde'
                   : _errCode === 131026 ? 'Número no válido en WhatsApp'
                   : _errCode ? `Error Meta ${_errCode}`
                   : 'No entregado';
    const failNote = failed ? `<div style="font-size:10px;color:#f87171;margin-top:2px;">${_errMsg}</div>` : '';
    return `<div class="msg-bubble-wrap ${out?'out':'in'}">
      <div class="msg-bubble ${out?'out':'in'} ${ch}${failed?' failed':''}">${esc(m.body||'')}</div>
      <div class="msg-bubble-meta">
        <span class="msg-channel-tag ${ch}">${ch==='wa'?'WhatsApp':'SMS'}</span>
        ${time}${m.autor?' · '+esc(m.autor):''}${tick?' '+tick:''}
      </div>
      ${failNote}
    </div>`;
  }).join('') : '<div style="text-align:center;color:var(--text2);font-size:12px;padding:20px;">Sin mensajes aún</div>';

  const _iaPaused = !!lead.ia_paused;
  const _iaColor  = _iaPaused ? '#22c55e' : '#a855f7';
  const _iaLabel  = _iaPaused ? '⏸ IA pausada — modo manual' : '🤖 IA activa — Ana está respondiendo';
  const _iaPill   = _iaPaused ? 'MANUAL' : 'ACTIVA';

  main.innerHTML = `
  <div style="display:flex;height:100%;overflow:hidden;min-width:0">
    <div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden">
      <div class="msg-thread-hdr">
        <button class="mob-back-btn" onclick="_msgMobBack()" aria-label="Volver">‹</button>
        <div class="msg-conv-avatar" style="background:${color};width:36px;height:36px;font-size:13px;font-weight:700;flex-shrink:0;">${initials}</div>
        <div class="msg-thread-hdr-info">
          <div class="msg-thread-hdr-name">${esc(lead.nombre||'Sin nombre')}</div>
          <div class="msg-thread-hdr-sub">${esc(phone)} ${lead.ubicacion?'· '+esc(lead.ubicacion):''}</div>
        </div>
        <button onclick="_msgToggleIA('${lead.id}')" style="background:${_iaPaused?'rgba(34,197,94,.15)':'rgba(168,85,247,.15)'};border:1px solid ${_iaPaused?'rgba(34,197,94,.3)':'rgba(168,85,247,.3)'};border-radius:7px;color:${_iaColor};font-size:11px;font-family:var(--font);padding:5px 11px;cursor:pointer;font-weight:700;">${_iaPill}</button>
        <button class="mob-hide" onclick="_msgForceAna('${lead.id}')" title="Fuerza a Ana a leer el historial y responder siguiendo el guión" style="background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3);border-radius:7px;color:#fbbf24;font-size:11px;font-family:var(--font);padding:5px 11px;cursor:pointer;font-weight:700;">⚡ Forzar Ana</button>
        <button class="mob-hide" onclick="_msgToggleLeadPanel()" id="msg-lead-panel-btn" title="Ver datos del lead" style="background:${_msgLeadPanelOpen?'rgba(79,127,255,.2)':'rgba(255,255,255,.07)'};border:1px solid ${_msgLeadPanelOpen?'rgba(79,127,255,.4)':'var(--border)'};border-radius:7px;color:${_msgLeadPanelOpen?'#93c5fd':'var(--text)'};font-size:11px;font-family:var(--font);padding:5px 11px;cursor:pointer;font-weight:700;">📋 Lead</button>
      </div>
      <div style="padding:6px 14px;font-size:11px;color:${_iaColor};background:${_iaPaused?'rgba(34,197,94,.06)':'rgba(168,85,247,.06)'};border-bottom:1px solid var(--border);">${_iaLabel}</div>
      <div class="msg-thread-body" id="msg-thread-body">${threadHtml}</div>
      <div class="msg-compose">
        <div class="msg-compose-top">
          <div class="msg-channel-btns">
            <button class="msg-ch-btn ${_msgChannel==='sms'?'active sms':''}" onclick="_msgSetChannel('sms')">📱 SMS</button>
            <button class="msg-ch-btn ${_msgChannel==='wa'?'active wa':''}"  onclick="_msgSetChannel('wa')">💬 WhatsApp</button>
          </div>
          <div style="flex:1;"></div>
          <span style="font-size:11px;color:var(--text2);">${esc(phone)}</span>
        </div>
        ${_msgChannel==='wa' ? `
        <div id="msg-24h-warning" style="display:none;padding:3px 8px;font-size:10px;color:rgba(251,191,36,.5);margin-bottom:4px">
          Ventana 24h cerrada · usa una plantilla para reabrir
        </div>
        <div class="msg-tpl-row">
          <select class="msg-tpl-sel" id="msg-tpl-sel" onchange="_msgLoadTpl()">
            <option value="">📋 Plantilla WhatsApp…</option>
          </select>
        </div>
        <div id="msg-tpl-preview" style="display:none;background:rgba(37,211,102,.06);border:1px solid rgba(37,211,102,.2);border-radius:6px;padding:8px 10px;font-size:12px;color:var(--text1,#fff);margin-top:4px;white-space:pre-wrap;line-height:1.5"></div>
        <div class="msg-tpl-vars" id="msg-tpl-vars"></div>` : ''}
        <div class="msg-input-row">
          <textarea class="msg-textarea" id="msg-inp" placeholder="${_msgChannel==='wa'?'Mensaje de WhatsApp… (Ctrl+Enter enviar)':'Mensaje SMS… (Ctrl+Enter enviar)'}" onkeydown="if(event.ctrlKey&&event.key==='Enter')_msgSend()" rows="2"></textarea>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="msg-send-btn" id="msg-send-btn" onclick="_msgSend()" style="background:${_msgChannel==='wa'?'#25d366':'#0073ea'};">➤</button>
            ${_msgChannel==='wa' ? `<button onclick="_msgSendVideo()" title="Enviar video intro" style="background:rgba(37,211,102,.15);color:#25d366;border:1px solid rgba(37,211,102,.35);border-radius:6px;padding:4px 6px;font-size:13px;cursor:pointer;line-height:1">🎬</button>` : ''}
          </div>
        </div>
        <div id="msg-video-panel" style="display:none;margin-top:8px;background:rgba(37,211,102,.06);border:1px solid rgba(37,211,102,.25);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:#25d366;font-weight:600;margin-bottom:8px">🎬 Enviar video intro Globe Life</div>
          <input id="msg-video-caption" placeholder="Caption (opcional)" style="width:100%;background:var(--bg2,#1a1a2e);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:6px;padding:7px 10px;font-size:12px;margin-bottom:8px;box-sizing:border-box" />
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="msg-video-status" style="font-size:11px;color:#888"></span>
            <button onclick="_msgSendVideoConfirm()" style="background:#25d366;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer" id="msg-video-btn">Enviar video</button>
          </div>
        </div>
      </div>
    </div>
    <div id="msg-lead-col" style="width:300px;min-width:280px;display:${_msgLeadPanelOpen?'flex':'none'};flex-direction:column;border-left:1px solid var(--border);overflow-y:auto;background:var(--card2,#181830);flex-shrink:0;">
    </div>
  </div>`;

  // Scroll to bottom
  setTimeout(() => {
    const tb = document.getElementById('msg-thread-body');
    if (tb) tb.scrollTop = tb.scrollHeight;
  }, 50);

  // Load templates when WA channel is active
  if (_msgChannel === 'wa') _msgLoadTemplates();

  // Render lead info panel
  if (_msgLeadPanelOpen) _msgRenderLeadPanel(lead);
}

function _msgSetChannel(ch) {
  _msgChannel = ch;
  _msgRenderThread();
}

async function _msgToggleIA(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  const pausando = !lead.ia_paused;
  if (pausando && !confirm(`¿Pausar la IA para ${lead.nombre || 'este lead'}?\n\nAna dejará de responder y podrás escribir manualmente.`)) return;
  lead.ia_paused = pausando;
  saveLeads(lead.id);
  showToast(pausando ? '⏸ IA pausada' : '🤖 IA reactivada');
  try {
    await fetch(`${SERVER_URL}/ai/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: lead.telefono, paused: lead.ia_paused }),
    });
  } catch {}
  _msgRenderThread();
}

async function _msgForceAna(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  const phone = lead.telefono;
  if (!phone) { showToast('⚠️ Sin número de WhatsApp para este lead'); return; }
  showToast('⚡ Forzando respuesta de Ana…');
  try {
    const res = await fetch(`${SERVER_URL}/ai/force-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': _sessionToken || '' },
      body: JSON.stringify({ phone }),
    });
    if (!res.ok) { const d = await res.json().catch(()=>{}); showToast('⚠️ Error: ' + (d?.error || res.status)); return; }
    showToast('✅ Ana está respondiendo — mensaje en ~20 seg');
    setTimeout(_msgRenderThread, 20000);
  } catch(e) {
    showToast('⚠️ Error al forzar respuesta: ' + e.message);
  }
}

let _msgLeadPanelOpen = true;

function _msgToggleLeadPanel() {
  _msgLeadPanelOpen = !_msgLeadPanelOpen;
  const col = document.getElementById('msg-lead-col');
  const btn = document.getElementById('msg-lead-panel-btn');
  if (col) col.style.display = _msgLeadPanelOpen ? 'flex' : 'none';
  if (btn) {
    btn.style.background = _msgLeadPanelOpen ? 'rgba(79,127,255,.2)' : 'rgba(255,255,255,.07)';
    btn.style.borderColor = _msgLeadPanelOpen ? 'rgba(79,127,255,.4)' : 'var(--border)';
    btn.style.color = _msgLeadPanelOpen ? '#93c5fd' : 'var(--text)';
  }
  if (_msgLeadPanelOpen) {
    const lead = leads.find(l => l.id === _msgLeadId);
    if (lead) _msgRenderLeadPanel(lead);
  }
}

function _msgRenderLeadPanel(lead) {
  const col = document.getElementById('msg-lead-col');
  if (!col || !lead) return;

  // Pipeline / etapa selects
  const pipelineOpts = (typeof PIPELINES !== 'undefined' ? PIPELINES : [])
    .map(p => `<option value="${esc(p.id)}" ${p.id===lead.pipeline_id?'selected':''}>${esc(p.nombre)}</option>`).join('');
  const currentPipe  = (typeof PIPELINES !== 'undefined' ? PIPELINES : []).find(p => p.id === lead.pipeline_id);
  const etapaOpts    = (currentPipe?.etapas || []).map(e => `<option value="${esc(e)}" ${e===lead.etapa?'selected':''}>${esc(e)}</option>`).join('');

  // Funnel progress
  const progresoHtml = (() => {
    const steps = [
      { pct: 5,   label: 'Aplicó',             check: () => true },
      { pct: 10,  label: 'Nombre y ciudad',     check: l => l.nombre && !l.nombre.startsWith('WA ') && !l.nombre.startsWith('+') && l.ubicacion },
      { pct: 20,  label: 'Experiencia laboral', check: l => l.tiene_experiencia },
      { pct: 45,  label: 'Interés en webinar',  check: l => l.webinar_intent },
      { pct: 50,  label: 'Papeles y mayoría',   check: l => l.tiene_papeles && l.mayor_edad },
      { pct: 60,  label: 'Correo registrado',   check: l => !!l.correo },
      { pct: 70,  label: 'Vio el webinar',      check: l => l.webinar_visto || l.vio_webinar },
      { pct: 80,  label: 'Entrevista agendada', check: l => !!(l.cita?.fecha) || l.pipeline_id === 'entrevistas-generales' },
      { pct: 100, label: 'Asistió',             check: l => /asist|ENTREVISTADO|ENTREVISTADA/i.test(l.etapa||'') },
    ];
    const pct = typeof calcProgreso === 'function' ? calcProgreso(lead) : 0;
    const barColor = pct >= 100 ? '#fbbf24' : pct >= 70 ? '#00c875' : '#4f7fff';
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px;"></div>
        </div>
        <span style="font-size:14px;font-weight:800;color:${barColor};">${pct}%</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;">
        ${steps.map(s => {
          const done = s.check(lead);
          return `<div style="display:flex;align-items:center;gap:7px;padding:4px 7px;border-radius:6px;background:${done?'rgba(0,200,117,.05)':'transparent'};">
            <span style="font-size:11px;">${done?'✅':'⬜'}</span>
            <span style="font-size:11px;color:${done?'#d1fae5':'var(--text2)'};">${s.label}</span>
            <span style="margin-left:auto;font-size:9px;color:${done?'#00c875':'var(--text3,rgba(255,255,255,.2))'};">${s.pct}%</span>
          </div>`;
        }).join('')}
      </div>`;
  })();

  // Notes
  const notasHtml = (lead.notas || []).slice(0,8).map(n => `
    <div style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);">
      <div style="width:26px;height:26px;border-radius:50%;background:#4f7fff;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;">${esc((n.autor||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase())}</div>
      <div style="min-width:0">
        <div style="font-size:10px;color:var(--text2);">${esc(n.autor||'Sistema')} · ${n.fecha ? new Date(n.fecha).toLocaleDateString('es-MX',{month:'short',day:'numeric'}) : ''}</div>
        <div style="font-size:12px;color:var(--text);margin-top:2px;word-break:break-word;">${esc(n.texto||'')}</div>
      </div>
    </div>`).join('') || '<div style="font-size:11px;color:var(--text2);padding:8px 0;text-align:center;opacity:.5">Sin notas</div>';

  // Metadata
  const fmtDate = v => v ? new Date(v).toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'}) : null;
  const bool    = v => v === true ? '✅ Sí' : v === false ? '❌ No' : null;
  const metaRow = (icon, label, value) => value
    ? `<div style="display:flex;gap:6px;font-size:11px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);">
        <span style="opacity:.5;flex-shrink:0">${icon}</span>
        <span style="color:var(--text2);flex-shrink:0;min-width:90px">${label}</span>
        <span style="color:var(--text);word-break:break-all">${esc(String(value))}</span>
       </div>` : '';

  const metaHtml = [
    metaRow('📣','Fuente', lead.fuente),
    metaRow('📋','Anuncio', lead.ad_nombre || lead.campaign_name),
    metaRow('📅','Creado', fmtDate(lead.created_at)),
    metaRow('🆔','Lead ID', lead.id),
    metaRow('🔑','Pipeline', lead.pipeline_id),
    metaRow('🤖','IA pausada', bool(lead.ia_paused)),
    metaRow('👁️','Vio webinar', bool(lead.vio_webinar)),
    metaRow('📊','Progreso web.', lead.webinar_visto_pct != null ? Math.round(lead.webinar_visto_pct)+'%' : null),
    metaRow('🔞','Mayor de edad', bool(lead.mayor_edad)),
    metaRow('💼','Experiencia', bool(lead.tiene_experiencia)),
    metaRow('📄','Tiene papeles', bool(lead.tiene_papeles)),
  ].filter(Boolean).join('') || '<div style="font-size:11px;color:var(--text2);padding:4px 0;opacity:.5">Sin metadatos</div>';

  const inp = s => `style="width:100%;background:var(--bg,#0f0f1e);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:6px;padding:5px 8px;font-size:12px;font-family:var(--font);outline:none;box-sizing:border-box;${s||''}"`;
  const lbl = t => `<label style="font-size:10px;color:var(--text2);display:block;margin-bottom:3px;text-transform:uppercase;letter-spacing:.4px;">${t}</label>`;

  const propietarioOpts = (() => {
    const u = typeof users !== 'undefined' ? users : [];
    return `<option value="">Sin asignar</option>` + u.map(u => `<option value="${esc(u.nombre)}" ${u.nombre===lead.propietario?'selected':''}>${esc(u.nombre)}</option>`).join('');
  })();
  const fuenteOpts = ['Meta / Facebook','Facebook','Instagram','WhatsApp','Indeed','Glassdoor','OCC / Indeed','Referido','LinkedIn','Otro']
    .map(f => `<option value="${f}" ${f===lead.fuente?'selected':''}>${f}</option>`).join('');

  col.innerHTML = `
    <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
      <span style="font-size:13px;font-weight:700;color:var(--text);">📋 Datos del Lead</span>
      <button onclick="openLead('${esc(lead.id)}')" style="background:rgba(255,255,255,.07);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;font-family:var(--font);padding:4px 10px;cursor:pointer;">Ver completo ↗</button>
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <div style="flex:1;min-width:0">
          ${lbl('Pipeline')}
          <select id="msg-lead-pipeline" onchange="_msgUpdateEtapasSel()" ${inp()}>${pipelineOpts}</select>
        </div>
        <div style="flex:1;min-width:0">
          ${lbl('Etapa')}
          <select id="msg-lead-etapa" ${inp()}>${etapaOpts}</select>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button onclick="_msgExtractFromChat()" id="msg-extract-btn" style="flex:1;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3);border-radius:6px;color:#fbbf24;font-size:11.5px;font-family:var(--font);padding:6px 10px;cursor:pointer;font-weight:700;">🤖 Leer chat</button>
        <button onclick="_msgSaveLeadInfo()" style="flex:1;background:#4f7fff;border:none;border-radius:6px;color:#fff;font-size:11.5px;font-family:var(--font);padding:6px 10px;cursor:pointer;font-weight:700;">💾 Guardar</button>
      </div>
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
      <div>
        ${lbl('Nombre')}
        <input id="msg-lead-nombre" value="${esc(lead.nombre||'')}" placeholder="Nombre" ${inp()} />
      </div>
      <div>
        ${lbl('Correo')}
        <input id="msg-lead-correo" value="${esc(lead.correo||'')}" placeholder="email@ejemplo.com" type="email" ${inp()} />
      </div>
      <div>
        ${lbl('Teléfono')}
        <input value="${esc(lead.telefono||'')}" readonly ${inp('opacity:.5;cursor:default')} />
      </div>
      <div>
        ${lbl('Ubicación')}
        <input id="msg-lead-ubicacion" value="${esc(lead.ubicacion||'')}" placeholder="Ciudad, Estado" ${inp()} />
      </div>
      <div style="display:flex;gap:6px;">
        <div style="flex:1;min-width:0">
          ${lbl('Fuente')}
          <select id="msg-lead-fuente" ${inp()}>${fuenteOpts}</select>
        </div>
        <div style="flex:1;min-width:0">
          ${lbl('Propietario')}
          <select id="msg-lead-propietario" ${inp()}>${propietarioOpts}</select>
        </div>
      </div>
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:10px;">Progreso del funnel</div>
      ${progresoHtml}
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:8px;">Notas</div>
      <div style="margin-bottom:8px;">
        <textarea id="msg-nota-inp" placeholder="Agregar nota…" rows="2" style="width:100%;background:var(--bg,#0f0f1e);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:6px;padding:6px 8px;font-size:12px;font-family:var(--font);resize:none;outline:none;box-sizing:border-box;"></textarea>
        <button onclick="_msgAddNota()" style="margin-top:4px;width:100%;background:rgba(255,255,255,.07);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11.5px;font-family:var(--font);padding:5px;cursor:pointer;">Guardar nota</button>
      </div>
      <div id="msg-notas-list">${notasHtml}</div>
    </div>

    <div style="padding:12px 16px;flex-shrink:0;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;" onclick="const m=document.getElementById('msg-meta-body');const a=document.getElementById('msg-meta-arrow');const o=m.style.display==='none';m.style.display=o?'block':'none';a.textContent=o?'▾':'▸'">
        <span>📊 Metadatos</span><span id="msg-meta-arrow">▸</span>
      </div>
      <div id="msg-meta-body" style="display:none;">${metaHtml}</div>
    </div>`;
}

function _msgUpdateEtapasSel() {
  const pid  = document.getElementById('msg-lead-pipeline')?.value;
  const pipe = (typeof PIPELINES !== 'undefined' ? PIPELINES : []).find(p => p.id === pid);
  const sel  = document.getElementById('msg-lead-etapa');
  if (!sel) return;
  const lead = leads.find(l => l.id === _msgLeadId);
  sel.innerHTML = (pipe?.etapas || []).map(e => `<option value="${esc(e)}" ${e===lead?.etapa?'selected':''}>${esc(e)}</option>`).join('');
}

async function _msgSaveLeadInfo() {
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!lead) return;
  const g = id => document.getElementById(id)?.value?.trim() ?? '';
  const fields = {
    nombre:      g('msg-lead-nombre')     || lead.nombre,
    correo:      g('msg-lead-correo'),
    ubicacion:   g('msg-lead-ubicacion'),
    fuente:      g('msg-lead-fuente')     || lead.fuente,
    propietario: g('msg-lead-propietario'),
    pipeline_id: g('msg-lead-pipeline')   || lead.pipeline_id,
    etapa:       g('msg-lead-etapa')      || lead.etapa,
  };
  try {
    const res = await fetch(`${SERVER_URL}/leads/${_msgLeadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-session-token': _sessionToken || '' },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    Object.assign(lead, fields);
    saveLeads();
    showToast('✅ Lead actualizado');
    _msgRenderLeadPanel(lead);
    _msgRenderList();
  } catch(e) {
    showToast('⚠️ Error al guardar: ' + e.message);
  }
}

async function _msgExtractFromChat() {
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!lead) return;
  const btn = document.getElementById('msg-extract-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Leyendo…'; }
  try {
    const res = await fetch(`${SERVER_URL}/leads/${_msgLeadId}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': _sessionToken || '' },
    });
    const data = await res.json();
    if (!data.ok) { showToast('⚠️ ' + (data.error || 'Sin historial')); return; }
    const idx = leads.findIndex(l => l.id === _msgLeadId);
    if (idx >= 0) leads[idx] = { ...leads[idx], ...data.lead };
    showToast('✅ Datos actualizados desde el chat');
    _msgRenderLeadPanel(leads.find(l => l.id === _msgLeadId));
    _msgRenderList();
  } catch(e) {
    showToast('❌ Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Leer chat'; }
  }
}

async function _msgAddNota() {
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!lead) return;
  const ta    = document.getElementById('msg-nota-inp');
  const texto = ta?.value?.trim();
  if (!texto) return;
  const nota = { texto, autor: currentUser?.name || 'Agente', fecha: new Date().toISOString() };
  if (!lead.notas) lead.notas = [];
  lead.notas.unshift(nota);
  saveLeads();
  ta.value = '';
  await fetch(`${SERVER_URL}/leads/${_msgLeadId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-session-token': _sessionToken || '' },
    body: JSON.stringify({ notas: lead.notas }),
  }).catch(() => {});
  _msgRenderLeadPanel(lead);
  showToast('✅ Nota guardada');
}

let _msgTemplates = [];

const _TPL_NAMES = {
  'grupo_elite_bienvenida':                   '👋 Bienvenida — primer contacto',
  'grupo_elite_cerrado':                      '🕐 Oficina cerrada',
  'vi_que_completaste_nuestro_formulario_':   '📋 Completaste nuestro formulario',
  'link_de_webinar_sin_inscripcion':          '🎥 Enviar link del webinar (sin registrar)',
  '1er_intento_de_contacto_no_webinar':       '📲 1er intento — sin webinar',
  'no_recibimos_mas_repuestas_del_postualdo': '🔇 Sin respuesta del postulado',
  'ultimo_intento_de_contacto':               '🚪 Último intento de contacto',
  'hello_world':                              '🧪 Prueba de conectividad',
};
function _tplLabel(name) {
  if (_TPL_NAMES[name]) return _TPL_NAMES[name];
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _tplFavsKey() {
  return `tpl_favs_${currentUser?.email || 'default'}`;
}
function _tplGetFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(_tplFavsKey()) || '[]')); } catch { return new Set(); }
}
function _tplToggleFav(name) {
  const favs = _tplGetFavs();
  if (favs.has(name)) favs.delete(name); else favs.add(name);
  localStorage.setItem(_tplFavsKey(), JSON.stringify([...favs]));
  _msgRebuildTplDropdown();
  _lcRebuildTplDropdown();
  _msgLoadTpl();
  lcLoadTpl();
}
function _msgRebuildTplDropdown() {
  const sel = document.getElementById('msg-tpl-sel');
  if (!sel) return;
  const favs = _tplGetFavs();
  const favList   = _msgTemplates.filter(t => favs.has(t.name));
  const otherList = _msgTemplates.filter(t => !favs.has(t.name));
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">📋 Plantilla WhatsApp…</option>';
  if (favList.length) {
    const grp = document.createElement('optgroup');
    grp.label = '⭐ Favoritas';
    for (const t of favList) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = '⭐ ' + _tplLabel(t.name);
      grp.appendChild(opt);
    }
    sel.appendChild(grp);
  }
  if (otherList.length) {
    const grp = document.createElement('optgroup');
    grp.label = favList.length ? 'Todas las plantillas' : 'Plantillas';
    for (const t of otherList) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = _tplLabel(t.name);
      grp.appendChild(opt);
    }
    sel.appendChild(grp);
  }
  if (currentVal) sel.value = currentVal;
}
function _lcRebuildTplDropdown() {
  const sel = document.getElementById('lc-tpl-select');
  if (!sel) return;
  const favs = _tplGetFavs();
  const favList   = _msgTemplates.filter(t => favs.has(t.name));
  const otherList = _msgTemplates.filter(t => !favs.has(t.name));
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">📋 Plantilla WhatsApp…</option>';
  if (favList.length) {
    const grp = document.createElement('optgroup');
    grp.label = '⭐ Favoritas';
    for (const t of favList) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = '⭐ ' + _tplLabel(t.name);
      grp.appendChild(opt);
    }
    sel.appendChild(grp);
  }
  if (otherList.length) {
    const grp = document.createElement('optgroup');
    grp.label = favList.length ? 'Todas las plantillas' : 'Plantillas';
    for (const t of otherList) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = _tplLabel(t.name);
      grp.appendChild(opt);
    }
    sel.appendChild(grp);
  }
  if (currentVal) sel.value = currentVal;
}

async function _msgLoadTemplates() {
  const sel = document.getElementById('msg-tpl-sel');
  if (!sel) return;
  try {
    const res  = await fetch(`${SERVER_URL}/meta/wa-templates`);
    const data = await res.json();
    _msgTemplates = data.templates || [];
    _msgRebuildTplDropdown();
  } catch(e) { console.warn('No se pudieron cargar plantillas:', e.message); }

  // Check 24h window
  const lead = leads.find(l => l.id === _msgLeadId);
  const warn    = document.getElementById('msg-24h-warning');
  const sendBtn = document.getElementById('msg-send-btn');
  const inp     = document.getElementById('msg-inp');
  if (lead) {
    const allMsgs = [...(lead.metaWa||[]), ...(lead.whatsapp||[])];
    const lastInbound = allMsgs.filter(m => m.direction === 'inbound').sort((a,b) => new Date(b.dateSent||b.date||0) - new Date(a.dateSent||a.date||0))[0];
    const hoursSince = lastInbound ? (Date.now() - new Date(lastInbound.dateSent||lastInbound.date).getTime()) / 36e5 : 999;
    if (warn) warn.style.display = hoursSince > 24 ? 'block' : 'none';
  }
}

function _msgLoadTpl() {
  const sel     = document.getElementById('msg-tpl-sel');
  const key     = sel?.value;
  const tpl     = _msgTemplates.find(t => t.name === key);
  const preview = document.getElementById('msg-tpl-preview');
  const varsEl  = document.getElementById('msg-tpl-vars');
  const inp     = document.getElementById('msg-inp');
  if (!preview || !varsEl) return;
  if (!key || !tpl) {
    preview.style.display = 'none';
    varsEl.innerHTML = '';
    if (inp) { inp.value = ''; inp.style.opacity = '1'; }
    return;
  }
  const lead     = leads.find(l => l.id === _msgLeadId);
  const firstName = (lead?.nombre||'').split(' ')[0] || lead?.nombre || '';
  // Show preview with {{1}} replaced by name
  const previewText = tpl.body.replace(/\{\{1\}\}/g, firstName || '{{nombre}}');
  preview.style.display = 'block';
  preview.textContent = previewText;
  // Var input for {{1}} (nombre)
  const isFav = _tplGetFavs().has(key);
  const hasVar = tpl.body.includes('{{1}}');
  varsEl.innerHTML = (hasVar ? `<div class="msg-tpl-var" style="margin-top:6px">
    <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">{{1}} Nombre</label>
    <input id="msg-var-0" value="${esc(firstName)}" placeholder="Nombre" style="width:100%;background:var(--bg2,#1a1a2e);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:6px;padding:5px 8px;font-size:12px;box-sizing:border-box" oninput="_msgUpdateTplPreview()" />
  </div>` : '') +
  `<div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
    <button onclick="_tplToggleFav('${esc(key)}')" title="${isFav ? 'Quitar de favoritas' : 'Marcar como favorita'}" style="background:${isFav ? 'rgba(251,191,36,.15)' : 'rgba(255,255,255,.06)'};border:1px solid ${isFav ? 'rgba(251,191,36,.4)' : 'rgba(255,255,255,.12)'};border-radius:6px;color:${isFav ? '#fbbf24' : 'var(--text2)'};font-size:13px;padding:5px 10px;cursor:pointer;line-height:1" id="msg-tpl-fav-btn">${isFav ? '⭐ Favorita' : '☆ Favorita'}</button>
    <button onclick="_msgSendTemplate()" style="background:#25d366;color:#fff;border:none;padding:6px 16px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Enviar plantilla ➤</button>
  </div>`;
  if (inp) { inp.value = ''; inp.style.opacity = '1'; }
}

function _msgUpdateTplPreview() {
  const sel  = document.getElementById('msg-tpl-sel');
  const tpl  = _msgTemplates.find(t => t.name === sel?.value);
  const prev = document.getElementById('msg-tpl-preview');
  const val  = document.getElementById('msg-var-0')?.value || '';
  if (prev && tpl) prev.textContent = tpl.body.replace(/\{\{1\}\}/g, val || '{{nombre}}');
}

async function _msgSendTemplate() {
  const sel  = document.getElementById('msg-tpl-sel');
  const key  = sel?.value;
  const tpl  = _msgTemplates.find(t => t.name === key);
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!key || !tpl || !lead?.telefono) { showToast('⚠️ Selecciona una plantilla'); return; }
  const param1 = document.getElementById('msg-var-0')?.value?.trim() || '';
  const btn    = document.querySelector('[onclick="_msgSendTemplate()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    const res  = await fetch(`${SERVER_URL}/meta/wa-send-template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lead.telefono, templateName: key, language: tpl.language || 'es', params: param1 ? [param1] : [], leadId: lead.id, renderedBody: tpl.body.replace(/\{\{1\}\}/g, param1 || '') }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    showToast('✅ Plantilla enviada');
    sel.value = '';
    _msgLoadTpl();
    setTimeout(_msgRenderThread, 1500);
  } catch(e) {
    showToast('⚠️ ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Enviar plantilla ➤'; }
}

async function _msgSend() {
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!lead) return;
  const phone = lead.telefono || '';
  if (!phone) { showToast('Lead sin teléfono'); return; }
  const btn = document.getElementById('msg-send-btn');
  if (btn) { btn.disabled=true; btn.style.opacity='.5'; }

  try {
    let payload, displayBody;

    if (_msgChannel === 'wa') {
      const inp = document.getElementById('msg-inp');
      const body = inp?.value.trim();
      if (!body) return;
      payload = { to: phone, body, leadId: lead.id };
      displayBody = body;
      const res  = await fetch(`${SERVER_URL}/meta/wa-send`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      if (!lead.metaWa) lead.metaWa = [];
      lead.metaWa.push({ direction:'outbound', body: displayBody, dateSent: new Date(data.ts||Date.now()).toISOString(), autor: currentUser?.name||'Agente', sid: data.msgId || `meta_${data.ts||Date.now()}`, status:'sent', ch:'wa' });
      addHistorial(lead.id, `WhatsApp: "${displayBody.slice(0,60)}"`, '💬');
    } else {
      const inp  = document.getElementById('msg-inp');
      const body = inp?.value.trim();
      if (!body) return;
      const res  = await fetch(`${SERVER_URL}/twilio/sms`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, body, leadId: lead.id }) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      if (!lead.sms) lead.sms = [];
      lead.sms.push({ direction:'outbound', body, date: new Date().toISOString(), autor: currentUser?.name||'Agente', sid: data.sid });
      displayBody = body;
      addHistorial(lead.id, `SMS: "${body.slice(0,60)}"`, '📱');
    }

    saveLeads();
    _msgRenderList();
    _msgRenderThread();
  } catch(e) {
    showToast('Error: ' + e.message);
  } finally {
    if (btn) { btn.disabled=false; btn.style.opacity='1'; }
  }
}

async function _msgPollActive() {
  if (!_msgLeadId || activeView !== 'messaging') return;
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!lead || !lead.telefono) return;
  const phone = lead.telefono;
  let updated = false;
  try {
    // Poll SMS (Twilio)
    const r1 = await fetch(`${SERVER_URL}/twilio/sms-inbox?phone=${encodeURIComponent(phone)}`);
    const d1 = await r1.json();
    if (d1.messages) for (const m of d1.messages) {
      if (!lead.sms) lead.sms = [];
      const ex1 = lead.sms.find(s => s.sid === m.sid);
      if (!ex1) { lead.sms.push(m); updated = true; }
      else if (!ex1.dateSent && m.dateSent) { Object.assign(ex1, m); updated = true; }
    }
    // Poll Meta WA
    const r2 = await fetch(`${SERVER_URL}/meta/wa-inbox?phone=${encodeURIComponent(phone)}`);
    const d2 = await r2.json();
    if (d2.messages) for (const m of d2.messages) {
      if (!lead.metaWa) lead.metaWa = [];
      const ex2 = lead.metaWa.find(s => s.sid === m.sid);
      if (!ex2) { lead.metaWa.push({...m, ch:'wa'}); updated = true; }
      else if (m.status && ex2.status !== m.status) { ex2.status = m.status; ex2.error_code = m.error_code; updated = true; }
    }
    // Detect if 15s lead sync already added messages behind our back
    const curCount = (lead.metaWa||[]).length + (lead.sms||[]).length;
    if (!updated && curCount !== _msgLastCount) updated = true;
    if (updated) { _msgLastCount = curCount; saveLeads(lead.id); _msgRenderList(); _msgRenderThread(); lcRenderTimeline(lead); }
  } catch {}
}

// ── Lead Conversation Tab ─────────────────────────────────────────────────────
let _lcChannel  = 'wa';   // 'sms' | 'wa'  (SMS disabled)
let _lcPollInt  = null;
let _lcLoading  = false;

function lcOpen() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;
  clearInterval(_lcPollInt);
  const phone = lead.telefono || '';
  document.getElementById('lc-contact-num').textContent = phone || '(sin número)';
  const inboxEl = document.getElementById('lc-inbox-num');
  if (inboxEl) {
    if (lead.wa_inbox_number) {
      inboxEl.textContent = `📲 Escribió al: +${lead.wa_inbox_number}`;
      inboxEl.style.display = 'block';
    } else {
      inboxEl.style.display = 'none';
    }
  }
  lcUpdateIAState(lead.ia_paused);
  lcRenderActivity(lead);
  lcRenderTimeline(lead);
  // Load dynamic templates and check 24h window
  lcSetChannel('wa');
  if (_msgTemplates.length) {
    _lcRebuildTplDropdown();
  } else {
    fetch(`${SERVER_URL}/meta/wa-templates`).then(r => r.json()).then(data => {
      if (data.templates) { _msgTemplates = data.templates; _lcRebuildTplDropdown(); _msgRebuildTplDropdown(); }
    }).catch(() => {});
  }
  const allMsgs = [...(lead.metaWa||[]), ...(lead.whatsapp||[])];
  const lastInbound = allMsgs.filter(m => m.direction === 'inbound').sort((a,b) => new Date(b.dateSent||b.date||0) - new Date(a.dateSent||a.date||0))[0];
  const hoursSince = lastInbound ? (Date.now() - new Date(lastInbound.dateSent||lastInbound.date).getTime()) / 36e5 : 999;
  const warn = document.getElementById('lc-24h-warning');
  if (warn) warn.style.display = hoursSince > 24 ? 'block' : 'none';
  if (phone) {
    lcFetchCalls(lead);
    lcFetchMessages(lead);
    _lcPollInt = setInterval(() => lcFetchMessages(leads.find(l => l.id === currentLeadId)), 10000);
  }
}

function lcUpdateIAState(paused) {
  const banner = document.getElementById('lc-ia-banner');
  const dot    = document.getElementById('lc-ia-dot');
  const label  = document.getElementById('lc-ia-label');
  const sub    = document.getElementById('lc-ia-sub');
  const pill   = document.getElementById('lc-ia-pill');
  const compose = document.querySelector('.lc-compose');
  if (!banner) return;

  if (paused) {
    banner.style.background   = 'rgba(34,197,94,.08)';
    banner.style.borderColor  = 'rgba(34,197,94,.25)';
    dot.style.background      = '#22c55e';
    dot.style.boxShadow       = '0 0 6px #22c55e';
    label.textContent         = 'IA pausada — modo manual';
    label.style.color         = '#22c55e';
    sub.textContent           = 'Puedes escribir mensajes manualmente. Haz clic para reactivar la IA.';
    sub.style.color           = 'rgba(34,197,94,.7)';
    pill.textContent          = 'MANUAL';
    pill.style.background     = 'rgba(34,197,94,.2)';
    pill.style.color          = '#22c55e';
    if (compose) compose.style.opacity = '1';
    document.getElementById('lc-textarea')?.removeAttribute('disabled');
    document.getElementById('lc-send-btn')?.removeAttribute('disabled');
    document.getElementById('lc-ch-sms')?.removeAttribute('disabled');
    document.getElementById('lc-ch-wa')?.removeAttribute('disabled');
    // Re-apply contratado lock after IA state change
    if (typeof _mlEnforceChatLock === 'function') _mlEnforceChatLock();
  } else {
    banner.style.background   = 'rgba(168,85,247,.08)';
    banner.style.borderColor  = 'rgba(168,85,247,.25)';
    dot.style.background      = '#a855f7';
    dot.style.boxShadow       = '0 0 6px #a855f7';
    label.textContent         = '🤖 IA activa — Ana está respondiendo';
    label.style.color         = '#c084fc';
    sub.textContent           = 'Los mensajes manuales están bloqueados. Haz clic para pausar la IA.';
    sub.style.color           = 'rgba(192,132,252,.6)';
    pill.textContent          = 'ACTIVA';
    pill.style.background     = 'rgba(168,85,247,.2)';
    pill.style.color          = '#c084fc';
    if (compose) compose.style.opacity = '.4';
    document.getElementById('lc-textarea')?.setAttribute('disabled', 'true');
    document.getElementById('lc-send-btn')?.setAttribute('disabled', 'true');
    document.getElementById('lc-ch-sms')?.setAttribute('disabled', 'true');
    document.getElementById('lc-ch-wa')?.setAttribute('disabled', 'true');
  }
}

async function lcToggleIA() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;
  const pausando = !lead.ia_paused;
  if (pausando && !confirm(`¿Pausar la IA para ${lead.nombre || 'este lead'}?\n\nAna dejará de responder y podrás escribir manualmente.`)) return;
  lead.ia_paused = pausando;
  lcUpdateIAState(lead.ia_paused);
  saveLeads(lead.id);
  showToast(lead.ia_paused
    ? '⏸ IA pausada — ahora puedes escribir manualmente'
    : '🤖 IA reactivada — Ana vuelve a responder'
  );

  // Sync ia_paused to server so Ana stops/resumes immediately
  try {
    await fetch(`${SERVER_URL}/ai/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: lead.telefono, paused: lead.ia_paused }),
    });
  } catch {}
}

function lcSetChannel(ch) {
  _lcChannel = ch;
  document.getElementById('lc-ch-sms')?.classList.toggle('active', ch === 'sms');
  document.getElementById('lc-ch-sms')?.classList.toggle('sms',    ch === 'sms');
  document.getElementById('lc-ch-wa')?.classList.toggle('active',  ch === 'wa');
  document.getElementById('lc-ch-wa')?.classList.toggle('wa',      ch === 'wa');
  const tplRow  = document.getElementById('lc-tpl-row');
  const tplVars = document.getElementById('lc-tpl-vars');
  const preview = document.getElementById('lc-tpl-preview');
  if (tplRow) tplRow.style.display = ch === 'wa' ? '' : 'none';
  if (tplVars) { tplVars.style.display = 'none'; tplVars.innerHTML = ''; }
  if (preview) { preview.style.display = 'none'; preview.textContent = ''; }
  const sel = document.getElementById('lc-tpl-select');
  if (sel) sel.value = '';
  document.getElementById('lc-textarea').value = '';
  document.getElementById('lc-send-btn').style.background = ch === 'wa' ? '#128c7e' : '#0073ea';
}

function lcLoadTpl() {
  const key     = document.getElementById('lc-tpl-select')?.value;
  const lead    = leads.find(l => l.id === currentLeadId);
  const tplVars = document.getElementById('lc-tpl-vars');
  const preview = document.getElementById('lc-tpl-preview');
  const inp     = document.getElementById('lc-textarea');
  if (!key) {
    if (tplVars) { tplVars.style.display = 'none'; tplVars.innerHTML = ''; }
    if (preview) { preview.style.display = 'none'; preview.textContent = ''; }
    if (inp) { inp.value = ''; inp.style.opacity = '1'; }
    return;
  }
  const tpl = _msgTemplates.find(t => t.name === key);
  if (!tpl) return;
  const firstName = (lead?.nombre || '').split(' ')[0] || lead?.nombre || '';
  if (preview) {
    preview.style.display = 'block';
    preview.textContent = tpl.body.replace(/\{\{1\}\}/g, firstName || '{{nombre}}');
  }
  if (inp) { inp.value = ''; inp.style.opacity = '.4'; }
  const isFav = _tplGetFavs().has(key);
  const hasVar = tpl.body.includes('{{1}}');
  if (tplVars) {
    tplVars.style.display = 'flex';
    tplVars.innerHTML = (hasVar ? `
      <div>
        <label style="font-size:11px;color:var(--text2);display:block;margin-bottom:3px">{{1}} Nombre</label>
        <input id="lc-var-0" value="${esc(firstName)}" placeholder="Nombre"
          style="width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#fff;border-radius:6px;padding:5px 8px;font-size:12px;box-sizing:border-box"
          oninput="lcUpdateTplPreview()" />
      </div>` : '') +
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <button onclick="_tplToggleFav('${esc(key)}')" id="lc-tpl-fav-btn"
          title="${isFav ? 'Quitar de favoritas' : 'Marcar como favorita'}"
          style="background:${isFav ? 'rgba(251,191,36,.15)' : 'rgba(255,255,255,.06)'};border:1px solid ${isFav ? 'rgba(251,191,36,.4)' : 'rgba(255,255,255,.12)'};border-radius:6px;color:${isFav ? '#fbbf24' : 'var(--text2)'};font-size:13px;padding:5px 10px;cursor:pointer"
          >${isFav ? '⭐ Favorita' : '☆ Favorita'}</button>
        <button onclick="lcSendTemplate()"
          style="background:#25d366;color:#fff;border:none;padding:6px 16px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">Enviar plantilla ➤</button>
      </div>`;
  }
}

function lcUpdateTplPreview() {
  const sel  = document.getElementById('lc-tpl-select');
  const tpl  = _msgTemplates.find(t => t.name === sel?.value);
  const prev = document.getElementById('lc-tpl-preview');
  const val  = document.getElementById('lc-var-0')?.value || '';
  if (prev && tpl) prev.textContent = tpl.body.replace(/\{\{1\}\}/g, val || '{{nombre}}');
}

async function lcSendTemplate() {
  const key  = document.getElementById('lc-tpl-select')?.value;
  const tpl  = _msgTemplates.find(t => t.name === key);
  const lead = leads.find(l => l.id === currentLeadId);
  if (!key || !tpl || !lead?.telefono) { showToast('⚠️ Selecciona una plantilla'); return; }
  const param1 = document.getElementById('lc-var-0')?.value?.trim() || '';
  const btn = document.querySelector('[onclick="lcSendTemplate()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    const res = await fetch(`${SERVER_URL}/meta/wa-send-template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lead.telefono, templateName: key, language: tpl.language || 'es', params: param1 ? [param1] : [], leadId: lead.id, renderedBody: tpl.body.replace(/\{\{1\}\}/g, param1 || '') }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    if (!lead.metaWa) lead.metaWa = [];
    lead.metaWa.push({ direction:'outbound', body: tpl.body.replace(/\{\{1\}\}/g, param1 || ''), dateSent: new Date().toISOString(), autor: currentUser?.name||'Agente', sid: `meta_tpl_${Date.now()}`, status:'sent', ch:'wa' });
    saveLeads(lead.id);
    lcRenderTimeline(lead);
    showToast('✅ Plantilla enviada');
    const sel = document.getElementById('lc-tpl-select');
    if (sel) sel.value = '';
    lcLoadTpl();
  } catch(e) { showToast('⚠️ ' + e.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Enviar plantilla ➤'; }
}

async function lcSend() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead?.telefono) { showToast('Lead sin número de teléfono'); return; }
  if (window._currentLeadLocked) { showToast('🔒 Lead contratado — comunicación bloqueada.'); return; }
  const phone = lead.telefono.replace(/[\s\-().]/g, '');
  const btn = document.getElementById('lc-send-btn');
  btn.disabled = true;
  try {
    if (_lcChannel === 'sms') {
      const body = document.getElementById('lc-textarea').value.trim();
      if (!body) { btn.disabled = false; return; }
      const res = await fetch(`${SERVER_URL}/twilio/sms`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ to: phone, body, leadId: lead.id }),
      });
      if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error || `Error SMS (${res.status})`); }
      if (!lead.sms) lead.sms = [];
      lead.sms.push({ body, direction: 'outbound', dateSent: new Date().toISOString(), sid: 'local_' + Date.now() });
    } else {
      // All WhatsApp sends go through Meta Cloud API
      const body = document.getElementById('lc-textarea').value.trim();
      if (!body) { btn.disabled = false; return; }
      const res = await fetch(`${SERVER_URL}/meta/wa-send`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, body, leadId: lead.id }) });
      const metaData = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(metaData.error || `Error WhatsApp (${res.status})`);
      if (!lead.metaWa) lead.metaWa = [];
      lead.metaWa.push({ body, direction:'outbound', dateSent: new Date(metaData.ts||Date.now()).toISOString(), autor: currentUser?.name||'Agente', sid: metaData.msgId || `meta_${metaData.ts||Date.now()}`, ch:'wa' });
    }
    document.getElementById('lc-textarea').value = '';
    document.getElementById('lc-tpl-select').value = '';
    document.getElementById('lc-tpl-vars').style.display = 'none';
    document.getElementById('lc-tpl-vars').innerHTML = '';
    saveLeads();
    lcRenderTimeline(lead);
    showToast('Mensaje enviado ✓');
  } catch (e) {
    showToast('Error al enviar: ' + e.message);
  }
  btn.disabled = false;
}

async function lcFetchCalls(lead) {
  if (!lead?.telefono) return;
  try {
    const res  = await fetch(`${SERVER_URL}/twilio/calls/by-number?phone=${encodeURIComponent(lead.telefono)}&limit=30`);
    const data = await res.json();
    if (data.calls) {
      lead.calls = data.calls;
      lcRenderActivity(lead);
      lcRenderTimeline(lead);
    }
  } catch {}
}

async function lcFetchMessages(lead) {
  if (!lead?.telefono) return;
  try {
    const [r1, r2] = await Promise.all([
      fetch(`${SERVER_URL}/twilio/sms-inbox?phone=${encodeURIComponent(lead.telefono)}`),
      fetch(`${SERVER_URL}/meta/wa-inbox?phone=${encodeURIComponent(lead.telefono)}`),
    ]);
    let updated = false;
    const d1 = await r1.json();
    if (d1.messages) {
      if (!lead.sms) lead.sms = [];
      for (const m of d1.messages) {
        const ex = lead.sms.find(s => s.sid === m.sid);
        if (!ex) { lead.sms.push(m); updated = true; }
        else if (!ex.dateSent && m.dateSent) { Object.assign(ex, m); updated = true; }
      }
    }
    const d2 = await r2.json();
    if (d2.messages) {
      if (!lead.metaWa) lead.metaWa = [];
      for (const m of d2.messages) {
        const ex = lead.metaWa.find(s => s.sid === m.sid);
        if (!ex) { lead.metaWa.push({...m, ch:'wa'}); updated = true; }
        else if (m.status && ex.status !== m.status) { ex.status = m.status; ex.error_code = m.error_code; updated = true; }
      }
    }
    if (updated) saveLeads(lead.id);
    lcRenderTimeline(lead);
  } catch {}
}

function lcRenderActivity(lead) {
  const el = document.getElementById('ml-act-list');
  if (!el) return;
  const COLOR_MAP = {
    '🟢':'#00c875','✅':'#00c875','📞':'#0073ea','📵':'#e2445c','❌':'#e2445c',
    '🚫':'#e2445c','📩':'#784bd1','📱':'#25d366','💬':'#0073ea','📅':'#fdab3d',
    '🗓️':'#fdab3d','⏰':'#fdab3d','🔗':'#00bcd4','⭐':'#fdab3d','📋':'#676a82',
    '↗':'#0073ea','↙':'#00c875','➡':'#fdab3d','⚠️':'#fdab3d',
  };
  const items = [];
  for (const h of (lead.historial || [])) {
    items.push({ icono: h.icono || '📋', accion: h.accion, usuario: h.usuario, date: new Date(h.fecha || 0) });
  }
  for (const c of (lead.calls || [])) {
    const out  = c.direction?.startsWith('outbound');
    const miss = c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed';
    const dur  = parseInt(c.duration) > 0 ? ` · ${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}` : '';
    const icono = miss ? '📵' : out ? '↗' : '↙';
    const accion = (miss ? 'Llamada perdida' : out ? 'Llamada saliente' : 'Llamada entrante') + dur;
    items.push({ icono, accion, usuario: '', date: new Date(c.startTime || 0) });
  }
  items.sort((a, b) => b.date - a.date);
  if (!items.length) {
    el.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,.18);padding:6px 0;text-align:center">Sin actividad</div>`;
    return;
  }
  el.innerHTML = items.map(item => {
    const color = COLOR_MAP[item.icono] || '#676a82';
    const timeStr = item.date.getTime()
      ? item.date.toLocaleDateString('es-MX',{day:'2-digit',month:'short'}) + ' ' + item.date.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})
      : '';
    return `<div class="ml-act-item">
      <div class="ml-act-dot" style="background:${color}22;color:${color};border-color:${color}44">${item.icono}</div>
      <div class="ml-act-label">${esc(item.accion)}</div>
      <div class="ml-act-meta">${item.usuario ? esc(item.usuario) + ' · ' : ''}${timeStr}</div>
    </div>`;
  }).join('');
}

function lcRenderTimeline(lead) {
  const el = document.getElementById('lc-timeline');
  if (!el) return;

  // Build unified timeline: messages + calls sorted by time
  const items = [];
  const _allMsgs = dedupMsgs([
    ...(lead.sms||[]).map(m => ({...m, ch:'sms'})),
    ...(lead.whatsapp||[]).map(m => ({...m, ch:'wa'})),
    ...(lead.metaWa||[]).map(m => ({...m, ch:'wa'})),
  ].sort((a,b) => new Date(a.dateSent||a.dateCreated||a.date||0) - new Date(b.dateSent||b.dateCreated||b.date||0)));

  for (const m of _allMsgs) {
    items.push({ _msg: m, ch: m.ch, out: m.direction?.startsWith('outbound'), date: new Date(m.dateSent||m.dateCreated||m.date||0) });
  }
  for (const c of (lead.calls || [])) {
    const out  = c.direction?.startsWith('outbound');
    const miss = c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed';
    const dur  = parseInt(c.duration) > 0 ? `${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}` : '';
    items.push({ _call: c, out, miss, dur, date: new Date(c.startTime||0) });
  }
  items.sort((a, b) => a.date - b.date);

  if (!items.length) {
    el.innerHTML = `<div class="lc-loading">Sin mensajes aún.<br><span style="font-size:10px;opacity:.5">Las llamadas y mensajes aparecerán aquí.</span></div>`;
    return;
  }

  let lastDay = '';
  el.innerHTML = items.map(item => {
    const d = item.date;
    const dayKey = d.getTime() ? d.toLocaleDateString('es-MX', {day:'2-digit',month:'short',year:'numeric'}) : '';
    let daySep = '';
    if (dayKey && dayKey !== lastDay) {
      lastDay = dayKey;
      daySep = `<div style="display:flex;align-items:center;gap:8px;margin:8px 0 4px;">
        <div style="flex:1;height:1px;background:var(--border)"></div>
        <span style="font-size:10px;color:var(--text2);white-space:nowrap">${dayKey}</span>
        <div style="flex:1;height:1px;background:var(--border)"></div>
      </div>`;
    }
    const timeStr = d.getTime() ? d.toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '';

    if (item._call) {
      const cls  = item.miss ? 'miss' : item.out ? 'out' : 'in';
      const icon = item.miss ? '📵' : item.out ? '↗' : '↙';
      const lbl  = item.miss ? 'Llamada perdida' : item.out ? 'Llamada saliente' : 'Llamada entrante';
      return daySep + `<div style="display:flex;justify-content:center;margin:4px 0;">
        <div class="lc-bubble call">
          <span class="lc-call-pill ${cls}">${icon} ${lbl}${item.dur ? ' · '+item.dur : ''}</span>
          ${timeStr ? `<span style="font-size:10px;color:var(--text2);margin-left:auto">${timeStr}</span>` : ''}
        </div>
      </div>`;
    }

    // Message — same style as _msgRenderThread
    const m      = item._msg;
    const out    = item.out;
    const ch     = item.ch;
    const failed = out && m.status === 'failed';
    const tick   = failed ? '❌' : (out && ch==='wa'
      ? (m.status==='read'      ? '<span style="color:#4fc3f7">✓✓</span>'
       : m.status==='delivered' ? '<span style="color:rgba(255,255,255,.5)">✓✓</span>'
       :                          '<span style="color:rgba(255,255,255,.35)">✓</span>')
      : '');
    const _errCode = m.error_code ? Number(m.error_code) : 0;
    const _errMsg  = _errCode === 131047 ? 'Ventana 24h expirada — usa una plantilla'
                   : _errCode === 190    ? 'Token expirado — reconectar integración Meta'
                   : _errCode === 130429 ? 'Límite de mensajes alcanzado'
                   : _errCode === 131026 ? 'Número no válido en WhatsApp'
                   : _errCode ? `Error Meta ${_errCode}` : 'No entregado';
    const failNote = failed ? `<div style="font-size:10px;color:#f87171;margin-top:2px;">${_errMsg}</div>` : '';
    return daySep + `<div class="msg-bubble-wrap ${out?'out':'in'}">
      <div class="msg-bubble ${out?'out':'in'} ${ch}${failed?' failed':''}">${esc(m.body||'')}</div>
      <div class="msg-bubble-meta">
        <span class="msg-channel-tag ${ch}">${ch==='wa'?'WhatsApp':'SMS'}</span>
        ${timeStr}${m.autor?' · '+esc(m.autor):''}${tick?' '+tick:''}
      </div>
      ${failNote}
    </div>`;
  }).join('');

  el.scrollTop = el.scrollHeight;
}

// ── Conversations (Call Log) ──────────────────────────────────────────────────
let _cvFilter    = 'all';   // all | outbound | inbound | missed
let _cvSearch    = '';
let _cvContactId = null;    // selected lead id
let _cvAllCalls  = [];      // raw call array from Twilio
let _cvPollInt   = null;

function _hideAllViewsConv() {
  _hideAllViews();
  document.getElementById('conversations-view').classList.remove('active');
  document.getElementById('conversations-view').style.display = 'none';
}

function showConversations() {
  _hideAllViews();
  activeView = 'conversations';
  document.getElementById('board-title').textContent = 'Llamadas';
  const el = document.getElementById('conversations-view');
  el.classList.add('active');
  el.style.display = 'flex';
  renderSidebar();
  _cvBuildPage();
  _cvLoadCalls();
  clearInterval(_cvPollInt);
  _cvPollInt = setInterval(_cvLoadCalls, 30000);
}

function _cvBuildPage() {
  const el = document.getElementById('conversations-view');
  el.innerHTML = `
  <div class="cv-wrap">
    <div class="cv-sidebar">
      <div class="cv-sidebar-hdr">
        <h2>📞 Llamadas</h2>
        <div class="cv-filters">
          <button class="cv-filter active" data-f="all"      onclick="_cvSetFilter('all')">Todas</button>
          <button class="cv-filter"        data-f="inbound"  onclick="_cvSetFilter('inbound')">Entrantes</button>
          <button class="cv-filter"        data-f="outbound" onclick="_cvSetFilter('outbound')">Salientes</button>
          <button class="cv-filter"        data-f="missed"   onclick="_cvSetFilter('missed')">Perdidas</button>
          <button class="cv-filter"        data-f="voicemail" onclick="_cvSetFilter('voicemail')">Buzón</button>
        </div>
      </div>
      <div class="cv-search">
        <input placeholder="🔍 Buscar por número o nombre…" oninput="_cvSearch=this.value;_cvRenderList()" />
      </div>
      <div class="cv-list" id="cv-list"><div class="cv-loading">Cargando llamadas…</div></div>
    </div>
    <div class="cv-main" id="cv-main">
      <div class="cv-empty"><span style="font-size:48px;opacity:.3">📞</span><span>Selecciona una conversación</span></div>
    </div>
  </div>`;
}

function _cvSetFilter(f) {
  _cvFilter = f;
  document.querySelectorAll('.cv-filter').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  _cvRenderList();
}

async function _cvLoadCalls() {
  if (activeView !== 'conversations') return;
  try {
    const [r1, r2] = await Promise.all([
      fetch(`${SERVER_URL}/twilio/calls?limit=100`).then(r => r.json()).catch(() => ({ calls: [] })),
      fetch(`${SERVER_URL}/call-log?limit=200`).then(r => r.json()).catch(() => ({ calls: [] })),
    ]);
    const twilCalls = (r1.calls || []).map(c => ({ ...c, _src: 'twilio' }));
    const fsCalls   = (r2.calls || []).map(c => ({
      sid:       c.callSid,
      from:      c.from,
      to:        c.to,
      status:    c.status,
      direction: c.direction,
      duration:  c.duration,
      startTime: c.startTime,
      type:      c.type,
      label:     c.label,
      recordingUrl: c.recordingUrl,
      transcription: c.transcription,
      _src: 'firestore',
    }));
    // Merge: prefer Firestore record for same callSid; dedupe by callSid
    const byId = {};
    for (const c of twilCalls) byId[c.sid] = c;
    for (const c of fsCalls)   if (c.sid) byId[c.sid] = { ...byId[c.sid], ...c }; // FS wins for voicemail fields
    const merged = Object.values(byId).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    _cvAllCalls = merged;
    _cvRenderList();
  } catch (e) { console.error('cv load:', e); }
}

function _cvGroupByContact(calls) {
  const map = {};
  for (const c of calls) {
    const num = c.direction === 'outbound-api' || c.direction === 'outbound-dial'
      ? c.to : c.from;
    if (!map[num]) map[num] = [];
    map[num].push(c);
  }
  return map;
}

function _cvFilterCalls(calls) {
  return calls.filter(c => {
    const isVM = c.type === 'voicemail' || c.status === 'voicemail';
    if (_cvFilter === 'voicemail' && !isVM) return false;
    if (_cvFilter === 'outbound'  && !c.direction?.startsWith('outbound')) return false;
    if (_cvFilter === 'inbound'   && (c.direction !== 'inbound' || isVM)) return false;
    if (_cvFilter === 'missed'    && c.status !== 'no-answer' && c.status !== 'busy' && c.status !== 'failed') return false;
    if (_cvSearch) {
      const q = _cvSearch.toLowerCase();
      const lead = leads.find(l => l.telefono && (c.to?.includes(l.telefono.replace(/\D/g,'').slice(-10)) || c.from?.includes(l.telefono.replace(/\D/g,'').slice(-10))));
      const name = lead?.nombre || '';
      if (!c.to?.includes(q) && !c.from?.includes(q) && !name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function _cvRenderList() {
  const list = document.getElementById('cv-list');
  if (!list) return;
  const filtered = _cvFilterCalls(_cvAllCalls);
  const grouped  = _cvGroupByContact(filtered);
  const entries  = Object.entries(grouped).sort((a, b) =>
    new Date(b[1][0].startTime) - new Date(a[1][0].startTime)
  );
  if (!entries.length) {
    list.innerHTML = '<div class="cv-loading">Sin llamadas para este filtro</div>';
    return;
  }
  const visibleEntries = entries.filter(([num]) => {
    const lead = leads.find(l => l.telefono && num.includes(l.telefono.replace(/\D/g,'').slice(-10)));
    return !lead?.invisible;
  });
  if (!visibleEntries.length) {
    list.innerHTML = '<div class="cv-loading">Sin llamadas para este filtro</div>';
    return;
  }
  list.innerHTML = visibleEntries.map(([num, calls]) => {
    const last   = calls[0];
    const lead   = leads.find(l => l.telefono && num.includes(l.telefono.replace(/\D/g,'').slice(-10)));
    const name   = lead?.nombre || num;
    const initials = name.split(' ').map(w => w[0]||'').join('').slice(0,2).toUpperCase();
    const color  = lead ? '#6366f1' : '#00c875';
    const isVM   = last.type === 'voicemail' || last.status === 'voicemail';
    const dir    = last.direction?.startsWith('outbound') ? '↗' : '↙';
    const miss   = !isVM && (last.status === 'no-answer' || last.status === 'busy' || last.status === 'failed');
    const durFmt = last.duration > 0 ? `${Math.floor(last.duration/60)}:${String(last.duration%60).padStart(2,'0')}` : '—';
    const timeAgo = _cvTimeAgo(last.startTime);
    const active = _cvContactId === num ? 'active' : '';
    const avatarBg = isVM ? 'rgba(167,139,250,.3)' : miss ? 'rgba(226,68,92,.3)' : color;
    const subLabel = isVM ? '<span style="color:#a78bfa">🎙 Buzón de voz</span>'
                   : miss ? '<span style="color:#e2445c">📵 Perdida</span>'
                   : dir + ' ' + durFmt;
    return `<div class="cv-item ${active}" onclick="_cvOpenContact('${num}')">
      <div class="cv-avatar" style="background:${avatarBg}">${initials}</div>
      <div class="cv-item-info">
        <div class="cv-item-name">${esc(name)}</div>
        <div class="cv-item-sub">${subLabel} · ${esc(num)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="cv-item-time">${timeAgo}</div>
        ${calls.length > 1 ? `<div class="cv-item-badge">${calls.length}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function _cvOpenContact(num) {
  _cvContactId = num;
  document.querySelectorAll('.cv-item').forEach(el => el.classList.toggle('active', el.onclick?.toString().includes(`'${num}'`)));
  const calls  = _cvFilterCalls(_cvAllCalls).filter(c => c.to === num || c.from === num);
  const lead   = leads.find(l => l.telefono && num.includes(l.telefono.replace(/\D/g,'').slice(-10)));
  const name   = lead?.nombre || num;
  const main   = document.getElementById('cv-main');
  if (!main) return;
  const totalDur  = calls.reduce((s, c) => s + (parseInt(c.duration)||0), 0);
  const totalMin  = Math.floor(totalDur/60);
  const outCount  = calls.filter(c => c.direction?.startsWith('outbound')).length;
  const inCount   = calls.filter(c => c.direction === 'inbound').length;
  const missCount = calls.filter(c => c.status === 'no-answer' || c.status === 'busy').length;

  main.innerHTML = `
    <div class="cv-main-hdr">
      <div class="cv-avatar" style="background:#6366f1;width:36px;height:36px;font-size:13px;">${name.split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <h3>${esc(name)}</h3>
        <div style="font-size:11px;color:var(--text2)">${esc(num)} · ${calls.length} llamadas · ${totalMin}m totales</div>
      </div>
      <button class="cv-call-btn" onclick="cpOpen_num('${num}','${esc(name)}')">📞 Llamar</button>
      ${lead ? `<button class="cv-call-btn" style="background:#6366f1;margin-left:6px" onclick="openLead('${lead.id}')">Ver lead →</button>` : ''}
    </div>
    <div style="display:flex;gap:10px;padding:12px 20px;border-bottom:1px solid var(--border);flex-shrink:0">
      <div style="flex:1;background:var(--card);border-radius:8px;padding:10px 14px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:var(--accent)">${outCount}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">Salientes</div>
      </div>
      <div style="flex:1;background:var(--card);border-radius:8px;padding:10px 14px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#60a5fa">${inCount}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">Entrantes</div>
      </div>
      <div style="flex:1;background:var(--card);border-radius:8px;padding:10px 14px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#e2445c">${missCount}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">Perdidas</div>
      </div>
      <div style="flex:1;background:var(--card);border-radius:8px;padding:10px 14px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:#f59e0b">${totalMin}m</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px">Tiempo total</div>
      </div>
    </div>
    <div class="cv-timeline" id="cv-timeline">
      ${calls.map(c => _cvCallCard(c, num)).join('')}
    </div>`;
}

function _cvCallCard(c, contactNum) {
  const isVM = c.type === 'voicemail' || c.status === 'voicemail';
  const out  = !isVM && (c.direction?.startsWith('outbound'));
  const miss = !isVM && (c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed');
  const durFmt = parseInt(c.duration) > 0
    ? `${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}`
    : '0:00';
  const iconCls = isVM ? 'vm' : miss ? 'miss' : out ? 'out' : 'in';
  const icon    = isVM ? '🎙' : miss ? '📵' : out ? '↗' : '↙';
  const dirLbl  = isVM ? 'Buzón de voz' : miss ? 'Perdida' : out ? 'Saliente' : 'Entrante';
  const numDisplay = out ? c.to : c.from;
  const dt = new Date(c.startTime);
  const dtFmt = dt.toLocaleDateString('es-MX', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const statusColor = isVM ? '#a78bfa' : miss ? '#e2445c' : out ? '#00c875' : '#60a5fa';
  const statusBg    = isVM ? 'rgba(167,139,250,.15)' : miss ? 'rgba(226,68,92,.15)' : out ? 'rgba(0,200,117,.15)' : 'rgba(96,165,250,.15)';

  const vmSection = isVM ? `
    <div style="margin-top:10px;padding:10px 12px;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.2);border-radius:8px;">
      ${c.recordingUrl ? `<audio controls style="width:100%;height:32px;accent-color:#a78bfa;margin-bottom:${c.transcription?'6px':'0'}">
        <source src="${esc(c.recordingUrl)}" type="audio/mpeg">
      </audio>` : '<div style="font-size:11px;color:var(--text2)">Audio no disponible</div>'}
      ${c.transcription ? `<div style="font-size:11px;color:var(--text2);font-style:italic;">"${esc(c.transcription)}"</div>` : ''}
    </div>` : '';

  return `<div class="cv-call-card" style="${isVM?'border-color:rgba(167,139,250,.25)':''}">
    <div class="cv-call-icon ${iconCls}" style="${isVM?'background:rgba(167,139,250,.15);color:#a78bfa':''}">
      ${icon}
    </div>
    <div class="cv-call-info" style="flex:1;min-width:0">
      <div class="cv-call-dir">${dirLbl}${c.label?` · ${esc(c.label)}`:''}</div>
      <div class="cv-call-num">${esc(numDisplay)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">${esc(dtFmt)}</div>
      ${vmSection}
    </div>
    <div class="cv-call-meta">
      <div class="cv-call-dur">${durFmt}</div>
      <div style="font-size:10px;margin-top:2px;padding:2px 7px;border-radius:10px;display:inline-block;
        background:${statusBg};color:${statusColor}">${isVM?'voicemail':c.status||'—'}</div>
      <br><button class="cv-call-btn" style="margin-top:6px" onclick="cpOpen_num('${esc(contactNum)}','')">📞 Llamar</button>
    </div>
  </div>`;
}

function cpOpen_num(phone, name) {
  const panel   = document.getElementById('call-panel');
  const initials = (name||phone).split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()||'📞';
  document.getElementById('cp-avatar').textContent  = initials;
  document.getElementById('cp-name').textContent    = name || 'Llamada';
  document.getElementById('cp-number').textContent  = phone;
  document.getElementById('cp-manual-num').value    = phone;
  document.getElementById('cp-call-btn').dataset.phone = phone;
  panel.style.display = 'block';
  document.getElementById('phone-fab').style.background = '#00a865';
  cpSetStatus('Iniciando…', '#f59e0b');
  cpInit();
}

function _cvTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d`;
  return new Date(iso).toLocaleDateString('es-MX', {day:'2-digit',month:'short'});
}


function _msgSendVideo() {
  const panel = document.getElementById('msg-video-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function _msgSendVideoConfirm() {
  const videoUrl = 'https://elite-webinar.b-cdn.net/file/elite-webinar/Video-Intro-Globe-Life-WA.mp4';
  const caption  = document.getElementById('msg-video-caption')?.value.trim();
  const status   = document.getElementById('msg-video-status');
  const btn      = document.getElementById('msg-video-btn');
  const lead     = leads.find(l => l.id === _msgLeadId);
  if (!lead?.telefono) { if(status){status.textContent='Lead sin teléfono';status.style.color='#e2445c';} return; }
  if(btn) btn.disabled = true;
  if(status){status.textContent='Enviando…';status.style.color='#888';}
  try {
    const res = await fetch(`${SERVER_URL}/meta/wa-send-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: lead.telefono, videoUrl, caption: caption||undefined, leadId: lead.id }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error');
    addHistorial(lead.id, `Video intro Globe Life enviado por WA`, '🎬');
    if(status){status.textContent='✓ Video enviado';status.style.color='#25d366';}
    setTimeout(() => { const p=document.getElementById('msg-video-panel'); if(p)p.style.display='none'; if(status)status.textContent=''; }, 2000);
  } catch(e) {
    if(status){status.textContent='⚠️ '+e.message;status.style.color='#e2445c';}
  }
  if(btn) btn.disabled = false;
}
