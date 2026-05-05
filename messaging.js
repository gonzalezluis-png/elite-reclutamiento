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

function showMessaging() {
  _hideAllViews();
  activeView = 'messaging';
  document.getElementById('board-title').textContent = 'Mensajería';
  document.getElementById('messaging-view').classList.add('active');
  document.getElementById('messaging-view').style.display = 'flex';
  renderSidebar();
  _msgBuildPage();
  clearInterval(_msgPollInt);
  _msgPollInt = setInterval(_msgPollActive, 8000);
}

function _msgBuildPage() {
  const view = document.getElementById('messaging-view');
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
    const hasSms = lead.sms && lead.sms.length > 0;
    const hasWa  = lead.whatsapp && lead.whatsapp.length > 0;
    if (!hasSms && !hasWa) continue;
    if (_msgFilter === 'sms' && !hasSms) continue;
    if (_msgFilter === 'wa'  && !hasWa)  continue;

    // Build combined timeline
    const allMsgs = [
      ...(hasSms ? lead.sms.map(m => ({...m, ch:'sms'}))  : []),
      ...(hasWa  ? lead.whatsapp.map(m => ({...m, ch:'wa'})) : []),
    ].sort((a,b) => new Date(b.date) - new Date(a.date));

    const last   = allMsgs[0];
    const unread = allMsgs.filter(m => m.direction === 'inbound' && !m.read).length;
    if (_msgFilter === 'unread' && unread === 0) continue;

    const q = _msgSearch.toLowerCase();
    if (q && !lead.nombre.toLowerCase().includes(q) && !(lead.telefono||'').includes(q) &&
        !allMsgs.some(m => m.body.toLowerCase().includes(q))) continue;

    convs.push({ lead, last, unread, hasSms, hasWa });
  }
  return convs.sort((a,b) => new Date(b.last.date) - new Date(a.last.date));
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
    const t        = last.date ? fmtDateTime(last.date) : '';
    const isActive = _msgLeadId === lead.id;
    return `<div class="msg-conv-item${isActive?' active':''}" onclick="_msgOpenConv('${lead.id}')">
      <div class="msg-conv-avatar" style="background:${color}">${initials}</div>
      <div class="msg-conv-info">
        <div class="msg-conv-name">${esc(lead.nombre||'Sin nombre')}</div>
        <div class="msg-conv-preview">${esc(preview)}</div>
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
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  // Mark inbound as read
  (lead.sms||[]).forEach(m => { if(m.direction==='inbound') m.read = true; });
  (lead.whatsapp||[]).forEach(m => { if(m.direction==='inbound') m.read = true; });
  saveLeads();
  _msgRenderList();
  _msgRenderThread();
}

function _msgRenderThread() {
  const lead = leads.find(l => l.id === _msgLeadId);
  if (!lead) return;
  const main  = document.getElementById('msg-main');
  const phone = lead.telefono || '';
  const hasSms = (lead.sms||[]).length > 0;
  const hasWa  = (lead.whatsapp||[]).length > 0;
  if (!_msgChannel || (_msgChannel==='sms' && !hasSms && hasWa)) _msgChannel = hasWa ? 'wa' : 'sms';

  const colors = ['#6366f1','#0073ea','#f59e0b','#00c875','#e2445c','#8b5cf6'];
  const color  = colors[(lead.nombre||'').charCodeAt(0) % colors.length];
  const initials = (lead.nombre||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();

  // Build combined timeline — Twilio WA + Meta WA are separate arrays so no cross-source duplicates
  const msgs = [
    ...(lead.sms||[]).map(m => ({...m, ch:'sms'})),
    ...(lead.whatsapp||[]).map(m => ({...m, ch:'wa'})),
    ...(lead.metaWa||[]),
  ].sort((a,b) => new Date(a.dateSent||a.date||0) - new Date(b.dateSent||b.date||0));

  const threadHtml = msgs.length ? msgs.map(m => {
    const out    = m.direction === 'outbound';
    const failed = out && m.status === 'failed';
    const _d     = m.dateSent || m.date;
    const time   = _d ? fmtDateTime(_d) : '';
    const ch     = m.ch;
    const tick   = failed ? '❌' : (out && ch==='wa' ? (m.status==='read' ? '<span style="color:#4fc3f7">✓✓</span>' : m.status==='delivered' ? '<span style="color:rgba(255,255,255,.5)">✓✓</span>' : '<span style="color:rgba(255,255,255,.35)">✓</span>') : '');
    const failNote = failed ? `<div style="font-size:10px;color:#f87171;margin-top:2px;">No entregado — ventana 24h expirada</div>` : '';
    return `<div class="msg-bubble-wrap ${out?'out':'in'}">
      <div class="msg-bubble ${out?'out':'in'} ${ch}${failed?' failed':''}">${esc(m.body||'')}</div>
      <div class="msg-bubble-meta">
        <span class="msg-channel-tag ${ch}">${ch==='wa'?'WhatsApp':'SMS'}</span>
        ${time}${m.autor?' · '+esc(m.autor):''}${tick?' '+tick:''}
      </div>
      ${failNote}
    </div>`;
  }).join('') : '<div style="text-align:center;color:var(--text2);font-size:12px;padding:20px;">Sin mensajes aún</div>';

  main.innerHTML = `
    <div class="msg-thread-hdr">
      <div class="msg-conv-avatar" style="background:${color};width:36px;height:36px;font-size:13px;font-weight:700;">${initials}</div>
      <div class="msg-thread-hdr-info">
        <div class="msg-thread-hdr-name">${esc(lead.nombre||'Sin nombre')}</div>
        <div class="msg-thread-hdr-sub">${esc(phone)} ${lead.ubicacion?'· '+esc(lead.ubicacion):''}</div>
      </div>
      <button onclick="openLead('${lead.id}')" style="background:rgba(255,255,255,.07);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:11.5px;font-family:var(--font);padding:5px 11px;cursor:pointer;">Ver Lead ↗</button>
    </div>
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
      <div class="msg-tpl-row">
        <select class="msg-tpl-sel" id="msg-tpl-sel" onchange="_msgLoadTpl()">
          <option value="">📋 Plantilla WhatsApp…</option>
          <option value="aplicacante_registrado">✅ Aplicante registrado</option>
          <option value="webinar_con_video">🎥 Webinar con video</option>
          <option value="en_webinar_aplicantes">📩 En webinar — confirmación</option>
          <option value="en_webinar_webinar_visto">👀 Webinar visto</option>
          <option value="no_visto_webinar">⚠️ No vio el webinar</option>
          <option value="registrado_en_una_entrevista">📅 Registrado en entrevista</option>
          <option value="link_de_entrevista_con_globe_life">🔗 Link entrevista (5 min)</option>
          <option value="aviso_entrevista_con_manager_30_minutos_antes">⏰ Aviso 30 min antes</option>
          <option value="agenda_de_cita_para_manager">🗓️ Cita para manager</option>
          <option value="3er_intento_de_contacto">📵 3er intento</option>
          <option value="2do_intento_de_contacto_webinar_no_visto_eliminacion">🚫 2do intento eliminación</option>
          <option value="eliminacion_por_webinar_visto">❌ Eliminación</option>
        </select>
      </div>
      <div class="msg-tpl-vars" id="msg-tpl-vars"></div>` : ''}
      <div class="msg-input-row">
        <textarea class="msg-textarea" id="msg-inp" placeholder="${_msgChannel==='wa'?'Mensaje de WhatsApp… (Ctrl+Enter enviar)':'Mensaje SMS… (Ctrl+Enter enviar)'}" onkeydown="if(event.ctrlKey&&event.key==='Enter')_msgSend()" rows="2"></textarea>
        <button class="msg-send-btn" id="msg-send-btn" onclick="_msgSend()" style="background:${_msgChannel==='wa'?'#25d366':'#0073ea'};">➤</button>
      </div>
    </div>`;

  // Scroll to bottom
  setTimeout(() => {
    const tb = document.getElementById('msg-thread-body');
    if (tb) tb.scrollTop = tb.scrollHeight;
  }, 50);
}

function _msgSetChannel(ch) {
  _msgChannel = ch;
  _msgRenderThread();
}

function _msgLoadTpl() {
  const sel  = document.getElementById('msg-tpl-sel');
  const key  = sel?.value;
  const tpl  = WA_TEMPLATES[key];
  const varsEl = document.getElementById('msg-tpl-vars');
  const inp  = document.getElementById('msg-inp');
  if (!varsEl) return;
  if (!key || !tpl) { varsEl.innerHTML=''; if(inp){inp.value='';inp.style.opacity='1';} return; }
  const lead = leads.find(l => l.id === _msgLeadId);
  const auto = { nombre: lead?.nombre||'', fuente: lead?.fuente||'', correo: lead?.correo||'', nombre_candidato: lead?.nombre||'' };
  varsEl.innerHTML = tpl.vars.map((v,i) =>
    `<div class="msg-tpl-var">
      <label>{{${i+1}}} ${v}</label>
      <input id="msg-var-${i}" value="${esc(auto[v]||'')}" placeholder="${v}" />
    </div>`).join('');
  if (inp) { inp.value='← Plantilla: '+key.replace(/_/g,' '); inp.style.opacity='.4'; }
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
      const selEl  = document.getElementById('msg-tpl-sel');
      const tplKey = selEl?.value;
      const tpl    = WA_TEMPLATES[tplKey];
      if (tplKey && tpl) {
        const vars = {};
        tpl.vars.forEach((v,i) => { const el=document.getElementById(`msg-var-${i}`); vars[(i+1).toString()]=el?el.value.trim():''; });
        payload = { to: phone, contentSid: tpl.sid, contentVariables: vars, leadId: lead.id };
        displayBody = `[${tplKey.replace(/_/g,' ')}] ${Object.values(vars).join(' · ')}`;
      } else {
        const inp = document.getElementById('msg-inp');
        const body = inp?.value.trim();
        if (!body) return;
        payload = { to: phone, body, leadId: lead.id };
        displayBody = body;
      }
      const res  = await fetch(`${SERVER_URL}/twilio/whatsapp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      if (!lead.whatsapp) lead.whatsapp = [];
      lead.whatsapp.push({ direction:'outbound', body: displayBody, date: new Date().toISOString(), autor: currentUser?.name||'Agente', sid: data.sid, status:'sent', ch:'wa' });
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
    // Poll SMS
    const r1   = await fetch(`${SERVER_URL}/twilio/sms-inbox?phone=${encodeURIComponent(phone)}`);
    const d1   = await r1.json();
    if (d1.messages) for (const m of d1.messages) {
      if (!lead.sms) lead.sms = [];
      const ex1 = lead.sms.find(s => s.sid === m.sid);
      if (!ex1) { lead.sms.push(m); updated = true; }
      else if (!ex1.dateSent && m.dateSent) { Object.assign(ex1, m); updated = true; }
    }
    // Poll WA
    const r2   = await fetch(`${SERVER_URL}/twilio/whatsapp-inbox?phone=${encodeURIComponent(phone)}`);
    const d2   = await r2.json();
    if (d2.messages) for (const m of d2.messages) {
      if (!lead.whatsapp) lead.whatsapp = [];
      const ex2 = lead.whatsapp.find(s => s.sid === m.sid);
      if (!ex2) { lead.whatsapp.push(m); updated = true; }
      else if (!ex2.dateSent && m.dateSent) { Object.assign(ex2, m); updated = true; }
    }
    if (updated) { saveLeads(); _msgRenderList(); _msgRenderThread(); }
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
  lcUpdateIAState(lead.ia_paused);
  lcRenderActivity(lead);
  lcRenderTimeline(lead);
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
  document.getElementById('lc-ch-sms').classList.toggle('active', ch === 'sms');
  document.getElementById('lc-ch-sms').classList.toggle('sms',    ch === 'sms');
  document.getElementById('lc-ch-wa').classList.toggle('active',  ch === 'wa');
  document.getElementById('lc-ch-wa').classList.toggle('wa',      ch === 'wa');
  const tplRow  = document.getElementById('lc-tpl-select');
  const tplVars = document.getElementById('lc-tpl-vars');
  tplRow.style.display  = ch === 'wa' ? '' : 'none';
  tplVars.style.display = 'none';
  tplRow.value = '';
  document.getElementById('lc-textarea').value = '';
  document.getElementById('lc-send-btn').style.background = ch === 'wa' ? '#128c7e' : '#0073ea';
}

function lcLoadTpl() {
  const key  = document.getElementById('lc-tpl-select').value;
  const lead = leads.find(l => l.id === currentLeadId);
  const tplVars = document.getElementById('lc-tpl-vars');
  if (!key) { tplVars.style.display = 'none'; tplVars.innerHTML = ''; return; }
  const tpl = WA_TEMPLATES[key];
  if (!tpl || !tpl.vars.length) { tplVars.style.display = 'none'; tplVars.innerHTML = ''; return; }
  tplVars.style.display = 'flex';
  tplVars.innerHTML = tpl.vars.map(v => {
    const prefill = v === 'nombre' ? (lead?.nombre || '') : v === 'correo' ? (lead?.correo || '') : '';
    return `<input data-var="${v}" placeholder="${v}" value="${esc(prefill)}"
      style="background:rgba(255,255,255,.06);border:1px solid rgba(37,211,102,.2);border-radius:6px;color:#fff;font-size:11.5px;font-family:var(--font);padding:5px 9px;outline:none;width:100%;box-sizing:border-box;" />`;
  }).join('');
}

async function lcSend() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead?.telefono) { showToast('Lead sin número de teléfono'); return; }
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
      const key = document.getElementById('lc-tpl-select').value;
      const isMetaLead = (lead.metaWa?.length > 0) || lead.pipeline_id === 'postulados-whatsapp-meta';
      if (key) {
        // Templates via Twilio
        const tpl  = WA_TEMPLATES[key];
        const vars = {};
        document.querySelectorAll('#lc-tpl-vars input').forEach(inp => { vars[inp.dataset.var] = inp.value.trim(); });
        const payload = { to: phone, contentSid: tpl.sid, contentVariables: vars, leadId: lead.id };
        const res = await fetch(`${SERVER_URL}/twilio/whatsapp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error || `Error WhatsApp (${res.status})`); }
        if (!lead.whatsapp) lead.whatsapp = [];
        lead.whatsapp.push({ body: `[Plantilla: ${key}]`, direction:'outbound', dateSent: new Date().toISOString(), sid: 'local_'+Date.now() });
      } else if (isMetaLead) {
        // Free text to Meta lead → use Meta Cloud API (same number candidate knows)
        const body = document.getElementById('lc-textarea').value.trim();
        if (!body) { btn.disabled = false; return; }
        const res = await fetch(`${SERVER_URL}/meta/wa-send`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, body, leadId: lead.id }) });
        const metaData = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error(metaData.error || `Error WhatsApp (${res.status})`);
        if (!lead.metaWa) lead.metaWa = [];
        lead.metaWa.push({ body, direction:'outbound', dateSent: new Date(metaData.ts||Date.now()).toISOString(), autor: currentUser?.name||'Agente', sid:`meta_${metaData.ts||Date.now()}`, ch:'wa' });
      } else {
        // Free text to Twilio lead
        const body = document.getElementById('lc-textarea').value.trim();
        if (!body) { btn.disabled = false; return; }
        const res = await fetch(`${SERVER_URL}/twilio/whatsapp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, body, leadId: lead.id }) });
        if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error || `Error WhatsApp (${res.status})`); }
        if (!lead.whatsapp) lead.whatsapp = [];
        lead.whatsapp.push({ body, direction:'outbound', dateSent: new Date().toISOString(), sid:'local_'+Date.now() });
      }
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
  const since = lead.created_at ? new Date(lead.created_at).getTime() : 0;
  try {
    const [r1, r2, r3] = await Promise.all([
      fetch(`${SERVER_URL}/twilio/sms-inbox?phone=${encodeURIComponent(lead.telefono)}`),
      fetch(`${SERVER_URL}/twilio/whatsapp-inbox?phone=${encodeURIComponent(lead.telefono)}`),
      fetch(`${SERVER_URL}/meta/wa-inbox?phone=${encodeURIComponent(lead.telefono)}`),
    ]);
    let updated = false;
    const d1 = await r1.json();
    if (d1.messages) {
      if (!lead.sms) lead.sms = [];
      for (const m of d1.messages) {
        if (since && m.dateSent && new Date(m.dateSent).getTime() < since) continue;
        const ex = lead.sms.find(s => s.sid === m.sid);
        if (!ex) { lead.sms.push(m); updated = true; }
        else if (!ex.dateSent && m.dateSent) { Object.assign(ex, m); updated = true; }
      }
    }
    const d2 = await r2.json();
    if (d2.messages) {
      if (!lead.whatsapp) lead.whatsapp = [];
      for (const m of d2.messages) {
        if (since && m.dateSent && new Date(m.dateSent).getTime() < since) continue;
        const ex = lead.whatsapp.find(s => s.sid === m.sid);
        if (!ex) { lead.whatsapp.push(m); updated = true; }
        else if (!ex.dateSent && m.dateSent) { Object.assign(ex, m); updated = true; }
      }
    }
    // Meta WA messages — stored in separate array to avoid mixing with Twilio
    const d3 = await r3.json();
    if (d3.messages) {
      if (!lead.metaWa) lead.metaWa = [];
      for (const m of d3.messages) {
        if (since && m.dateSent && new Date(m.dateSent).getTime() < since) continue;
        const ex = lead.metaWa.find(s => s.sid === m.sid);
        if (!ex) { lead.metaWa.push({...m, ch:'wa'}); updated = true; }
        else if (m.status && ex.status !== m.status) { ex.status = m.status; ex.error_code = m.error_code; updated = true; }
      }
    }
    if (updated) { saveLeads(); lcRenderTimeline(lead); }
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
  const items = [];
  // SMS
  for (const m of (lead.sms || [])) {
    items.push({ type:'sms', out: m.direction?.startsWith('outbound'), body: m.body, date: new Date(m.dateSent || m.dateCreated || m.date || 0) });
  }
  // WhatsApp (Twilio)
  for (const m of (lead.whatsapp || [])) {
    items.push({ type:'wa', out: m.direction?.startsWith('outbound'), body: m.body, date: new Date(m.dateSent || m.dateCreated || m.date || 0) });
  }
  // WhatsApp (Meta)
  for (const m of (lead.metaWa || [])) {
    items.push({ type:'wa', out: m.direction?.startsWith('outbound'), body: m.body, date: new Date(m.dateSent || m.dateCreated || m.date || 0) });
  }
  // Calls from Twilio
  for (const c of (lead.calls || [])) {
    const out  = c.direction?.startsWith('outbound');
    const miss = c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed';
    const dur  = parseInt(c.duration) > 0 ? `${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}` : '';
    items.push({ type:'call', out, miss, dur, status: c.status, date: new Date(c.startTime || 0) });
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
      daySep = `<div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
        <div style="flex:1;height:1px;background:var(--border)"></div>
        <span style="font-size:10px;color:var(--text2);white-space:nowrap">${dayKey}</span>
        <div style="flex:1;height:1px;background:var(--border)"></div>
      </div>`;
    }
    const timeStr = d.getTime() ? d.toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'}) : '';

    if (item.type === 'call') {
      const cls  = item.miss ? 'miss' : item.out ? 'out' : 'in';
      const icon = item.miss ? '📵' : item.out ? '↗' : '↙';
      const lbl  = item.miss ? 'Llamada perdida' : item.out ? 'Llamada saliente' : 'Llamada entrante';
      return daySep + `<div style="display:flex;justify-content:center;margin:2px 0;">
        <div class="lc-bubble call">
          <span class="lc-call-pill ${cls}">${icon} ${lbl}${item.dur ? ' · ' + item.dur : ''}</span>
          ${timeStr ? `<span style="font-size:10px;color:var(--text2);margin-left:auto">${timeStr}</span>` : ''}
        </div>
      </div>`;
    }
    const wrapCls = item.out ? 'out' : 'in';
    const bubCls  = `${item.out?'out':'in'} ${item.type}`;
    const chLabel = item.type === 'sms' ? '💬' : '📱';
    return daySep + `<div class="lc-bubble-wrap ${wrapCls}">
      <div class="lc-bubble ${bubCls}">${esc(item.body || '')}</div>
      <div class="lc-bubble-meta">${chLabel} ${timeStr}</div>
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
  document.getElementById('board-title').textContent = 'Conversaciones';
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
        <h2>📞 Conversaciones</h2>
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
  list.innerHTML = entries.map(([num, calls]) => {
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

