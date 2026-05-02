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

function _hideAllViews() {
  document.getElementById('kanban-wrap').style.display       = 'none';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('calendar-view').classList.remove('active');
  document.getElementById('config-view').style.display      = 'none';
  document.getElementById('messaging-view').classList.remove('active');
  document.getElementById('conversations-view').classList.remove('active');
  document.getElementById('conversations-view').style.display = 'none';
  document.getElementById('ai-view').style.display           = 'none';
  document.getElementById('team-chat-view').style.display    = 'none';
  document.getElementById('pipeline-tabs').style.display    = 'none';
  document.getElementById('pipeline-subtabs').style.display = 'none';
  document.getElementById('search-input').style.display     = 'none';
  clearInterval(_cvPollInt);
}

async function showTeamChat() {
  _hideAllViews();
  activeView = 'team-chat';
  document.getElementById('board-title').textContent = 'Conversación con el equipo';
  const el = document.getElementById('team-chat-view');
  el.style.display = 'block';
  renderSidebar();

  el.innerHTML = `
  <div style="max-width:900px;margin:0 auto;padding-bottom:40px;">
    <div style="border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:20px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Grupo Élite · CRM</div>
        <h2 style="font-size:20px;font-weight:800;color:var(--text);margin:0;">💬 Conversación con el equipo</h2>
        <p style="font-size:12px;color:var(--text2);margin:4px 0 0;">Mensajes de WhatsApp entre Ana y los encargados / entrevistador.</p>
      </div>
      <button class="btn-secondary" onclick="_tcRefresh()" style="font-size:12px;padding:7px 14px;flex-shrink:0;">🔄 Actualizar</button>
    </div>
    <div style="display:flex;gap:16px;align-items:flex-start;">
      <!-- Members list -->
      <div id="tc-members" style="width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;"></div>
      <!-- Chat area -->
      <div style="flex:1;min-width:0;">
        <div id="tc-chat" style="background:var(--card);border:1px solid var(--border);border-radius:12px;min-height:300px;max-height:560px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;">
          <div style="color:var(--text2);font-size:12px;text-align:center;padding:20px 0;">Selecciona un integrante para ver la conversación.</div>
        </div>
      </div>
    </div>
  </div>`;

  try {
    const [mData, tData] = await Promise.all([
      fetch(`${SERVER_URL}/ai/managers`).then(r=>r.json()).catch(()=>({managers:[],interviewer:null})),
      fetch(`${SERVER_URL}/ai/team-messages`).then(r=>r.json()).catch(()=>({messages:[]})),
    ]);
    aiInitTeamChat(mData.managers || [], mData.interviewer || null, tData.messages || []);
    _tcRenderMembers();
    if (_teamMembers.length) aiSelectTeamTab(_teamMembers[0].phone);
  } catch(e) {
    document.getElementById('tc-chat').innerHTML = `<div style="color:var(--red);font-size:12px;">Error: ${e.message}</div>`;
  }
}

function _tcRenderMembers() {
  const el = document.getElementById('tc-members');
  if (!el) return;
  el.innerHTML = _teamMembers.map(m => {
    const msgs  = _teamMessages.filter(msg => (msg.phone||'').replace(/^\+/,'') === m.phone.replace(/^\+/,'')).length;
    const color = m.role === 'interviewer' ? '#a5b4fc' : '#fdba74';
    const bg    = m.role === 'interviewer' ? 'rgba(99,102,241,.1)' : 'rgba(249,115,22,.08)';
    const border= m.role === 'interviewer' ? 'rgba(99,102,241,.3)' : 'rgba(249,115,22,.25)';
    return `<button id="tc-tab-${m.phone.replace(/[^0-9]/g,'')}" onclick="aiSelectTeamTab('${m.phone}');_tcRenderMembers();"
      style="text-align:left;background:${bg};border:1px solid ${border};border-radius:10px;padding:10px 12px;cursor:pointer;width:100%;">
      <div style="font-size:12px;font-weight:700;color:${color};">${esc(m.name)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:2px;">${m.role==='interviewer'?'Entrevistador':'Encargado nivel '+(_teamMembers.indexOf(m)+1)} · ${msgs} msg</div>
    </button>`;
  }).join('');
}

async function _tcRefresh() {
  try {
    const data = await fetch(`${SERVER_URL}/ai/team-messages`).then(r=>r.json());
    _teamMessages = data.messages || [];
    _tcRenderMembers();
    if (_teamActiveTab) _aiRenderTeamMessages(_teamActiveTab);
    showToast('Actualizado ✓');
  } catch(e) { showToast('Error: '+e.message, 'error'); }
}

async function showAIPanel() {
  _hideAllViews();
  activeView = 'ai';
  document.getElementById('board-title').textContent = 'Asistente IA — Ana';
  const el = document.getElementById('ai-view');
  el.style.display = 'block';
  renderSidebar();
  el.innerHTML = `<div style="max-width:820px;margin:0 auto;padding-bottom:40px;">

    <!-- Header institucional -->
    <div style="border-bottom:1px solid var(--border);padding-bottom:18px;margin-bottom:20px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Grupo Élite · CRM</div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text);margin:0;letter-spacing:-.2px;">Asistente IA — Ana</h2>
          <p style="font-size:12px;color:var(--text2);margin:4px 0 0;line-height:1.5;">Agente conversacional que responde WhatsApp, SMS y llamadas automáticamente usando inteligencia artificial.</p>
        </div>
        <button onclick="aiLoadPanel()" style="flex-shrink:0;background:var(--card2);border:1px solid var(--border);color:var(--text2);padding:7px 14px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">↻ Actualizar</button>
      </div>
      <!-- Canal status row -->
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;" id="ai-channel-status">
        <div style="font-size:11px;color:var(--text2);">Cargando canales…</div>
      </div>
    </div>

    <!-- Secciones -->
    ${[
      { id:'interviews',icon:'🎙', title:'Entrevistas',                  desc:'Entrevistador, horario semanal, Zoom, recordatorios y confirmaciones.' },
      { id:'history',  icon:'💬', title:'Conversaciones activas',      desc:'Historial de chats en memoria de Ana.' },
      { id:'general',  icon:'📄', title:'Personalidad e instrucciones', desc:'Prompt base: rol, misión y flujo de conversación.' },
      { id:'qa',       icon:'❔', title:'Preguntas frecuentes',          desc:'Respuestas predefinidas para las consultas más comunes.' },
      { id:'forbidden',icon:'🚫', title:'Temas prohibidos',              desc:'Lo que Ana nunca debe mencionar ni responder.' },
      { id:'cases',    icon:'⚡', title:'Situaciones especiales',        desc:'Instrucciones para casos específicos que Ana puede encontrar.' },
      { id:'webinar',  icon:'🎥', title:'Manejo del Webinar',             desc:'Flujo e instrucciones para cuando el candidato tiene problemas con el webinar.' },
      { id:'triggers', icon:'🚨', title:'Cuándo buscar un manager',      desc:'Situaciones que activan una alerta al equipo de escalada.' },
      { id:'templates',  icon:'📋', title:'Plantillas de WhatsApp',        desc:'Mensajes automáticos que deben aprobarse en Meta Business Manager.' },
    ].map(s => `
    <div style="border:1px solid var(--border);border-radius:10px;margin-bottom:6px;overflow:hidden;background:var(--card);">
      <button onclick="aiToggleSection('${s.id}')" style="width:100%;display:flex;align-items:center;gap:12px;padding:13px 16px;background:none;border:none;cursor:pointer;text-align:left;user-select:none;">
        <span style="font-size:14px;width:20px;text-align:center;flex-shrink:0;">${s.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text);">${s.title}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:1px;">${s.desc}</div>
        </div>
        <span id="ai-chevron-${s.id}" style="color:var(--text2);font-size:10px;transition:transform .18s;flex-shrink:0;">▼</span>
      </button>
      <div id="ai-section-${s.id}" style="display:none;border-top:1px solid var(--border);padding:16px;"></div>
    </div>`).join('')}
  </div>`;
  await aiLoadPanel();
}

let _aiConfig = null;

function aiToggleSection(id) {
  const pane    = document.getElementById(`ai-section-${id}`);
  const chevron = document.getElementById(`ai-chevron-${id}`);
  if (!pane) return;
  const open = pane.style.display === 'none';
  pane.style.display    = open ? 'block' : 'none';
  chevron.style.transform = open ? 'rotate(180deg)' : '';
}

function _aiInjectSectionContent() {
  // Interviews
  document.getElementById('ai-section-interviews').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;padding-top:4px;" id="iv-config-wrap">
      <div style="color:var(--text2);font-size:12px;">Cargando configuración…</div>
    </div>`;

  // History
  document.getElementById('ai-section-history').innerHTML = `
    <div style="padding-top:4px;display:flex;flex-direction:column;gap:10px;">
      <div id="ai-history-list" style="display:flex;flex-direction:column;gap:4px;max-height:320px;overflow-y:auto;"><div style="color:var(--text2);font-size:12px;text-align:center;padding:16px;">Cargando…</div></div>
      <div style="text-align:right;"><button class="btn-secondary" onclick="aiClearHistory()" style="font-size:11px;padding:6px 12px;">🗑 Borrar todo</button></div>
    </div>`;

  // Prompt general
  document.getElementById('ai-section-general').innerHTML = `
    <div style="padding-top:14px;display:flex;flex-direction:column;gap:10px;">
      <textarea id="ai-general-ta" style="width:100%;height:220px;background:#0d0f1a;border:1px solid rgba(120,75,209,.35);border-radius:8px;color:#e2d9f3;font-size:12px;font-family:monospace;padding:14px;line-height:1.7;resize:vertical;outline:none;box-sizing:border-box;" placeholder="Cargando…"></textarea>
      <div style="text-align:right;"><button class="btn-primary" onclick="aiSaveGeneral()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button></div>
    </div>`;

  // Q&A
  document.getElementById('ai-section-qa').innerHTML = `
    <div style="padding-top:14px;display:flex;flex-direction:column;gap:10px;">
      <div id="ai-qa-list" style="display:flex;flex-direction:column;gap:12px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary" onclick="aiAddQA()" style="font-size:11px;padding:6px 12px;">+ Agregar</button>
        <button class="btn-primary" onclick="aiSaveQA()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button>
      </div>
    </div>`;

  // Forbidden
  document.getElementById('ai-section-forbidden').innerHTML = `
    <div style="padding-top:14px;display:flex;flex-direction:column;gap:10px;">
      <textarea id="ai-forbidden-ta" style="width:100%;height:160px;background:#1a0d0d;border:1px solid rgba(226,68,92,.3);border-radius:8px;color:#fca5a5;font-size:12px;font-family:monospace;padding:14px;line-height:1.7;resize:vertical;outline:none;box-sizing:border-box;" placeholder="Cargando…"></textarea>
      <div style="text-align:right;"><button class="btn-primary" onclick="aiSaveForbidden()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button></div>
    </div>`;

  // Cases
  document.getElementById('ai-section-cases').innerHTML = `
    <div style="padding-top:14px;display:flex;flex-direction:column;gap:10px;">
      <div id="ai-cases-list" style="display:flex;flex-direction:column;gap:12px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary" onclick="aiAddCase()" style="font-size:11px;padding:6px 12px;">+ Agregar</button>
        <button class="btn-primary" onclick="aiSaveCases()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button>
      </div>
    </div>`;

  // Webinar
  document.getElementById('ai-section-webinar').innerHTML = `
    <div style="padding-top:4px;display:flex;flex-direction:column;gap:10px;">
      <textarea id="ai-webinar-ta" style="width:100%;height:260px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;font-family:monospace;padding:14px;line-height:1.7;resize:vertical;outline:none;box-sizing:border-box;" placeholder="Cargando…"></textarea>
      <div style="text-align:right;"><button class="btn-primary" onclick="aiSaveWebinar()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button></div>
    </div>`;

  // Triggers
  document.getElementById('ai-section-triggers').innerHTML = `
    <div style="padding-top:4px;display:flex;flex-direction:column;gap:10px;">
      <div id="ai-triggers-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary" onclick="aiAddTrigger()" style="font-size:11px;padding:6px 12px;">+ Agregar</button>
        <button class="btn-primary" onclick="aiSaveTriggers()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button>
      </div>
    </div>`;

  // Templates section
  document.getElementById('ai-section-templates').innerHTML = `
    <div style="padding-top:4px;display:flex;flex-direction:column;gap:12px;">
      <div style="background:rgba(234,179,8,.07);border:1px solid rgba(234,179,8,.25);border-radius:8px;padding:10px 14px;font-size:11px;color:#fde68a;line-height:1.6;">
        <strong>¿Cómo activar las plantillas?</strong><br>
        1. Entra a <strong>Meta Business Manager → Herramientas de cuenta → Plantillas de mensajes</strong>.<br>
        2. Crea cada plantilla con el nombre exacto, categoría <strong>UTILITY</strong>, idioma <strong>Español (es)</strong>.<br>
        3. Copia el texto del cuerpo y reemplaza los <code>{{n}}</code> con variables de texto.<br>
        4. Envía a revisión. Una vez aprobadas, el sistema las usará automáticamente.
      </div>
      <div id="ai-templates-list" style="display:flex;flex-direction:column;gap:10px;">
        <div style="color:var(--text2);font-size:12px;">Cargando plantillas…</div>
      </div>
    </div>`;

}

async function aiLoadPanel() {
  _aiInjectSectionContent();
  try {
    const [cs, ss, hs, iv, tpls] = await Promise.all([
      fetch(`${SERVER_URL}/ai/config`).then(r=>r.json()),
      fetch(`${SERVER_URL}/ai/settings`).then(r=>r.json()),
      fetch(`${SERVER_URL}/ai/history`).then(r=>r.json()),
      fetch(`${SERVER_URL}/interviews/config`).then(r=>r.json()).catch(()=>({config:{}})),
      fetch(`${SERVER_URL}/ai/templates`).then(r=>r.json()).catch(()=>({templates:{}})),
    ]);

    _aiConfig = cs.config || {};
    document.getElementById('ai-general-ta').value   = _aiConfig.general  || '';
    document.getElementById('ai-webinar-ta').value   = _aiConfig.webinar  || '';
    document.getElementById('ai-forbidden-ta').value = _aiConfig.forbidden || '';
    aiRenderQA(_aiConfig.qa || []);
    aiRenderCases(_aiConfig.cases || []);
    aiRenderTriggers(_aiConfig.triggers || []);
    ivRenderConfig(iv.config || {});
    aiRenderTemplates(tpls.templates || {});

    // Channel status pills
    const channels = [
      { key:'voice', label:'📞 Llamadas' },
      { key:'sms',   label:'💬 SMS' },
      { key:'wa',    label:'📱 WhatsApp' },
    ];
    document.getElementById('ai-channel-status').innerHTML = channels.map(c => {
      const on = ss.enabled?.[c.key] !== false;
      return `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;background:var(--card2);border:1px solid ${on?'rgba(34,197,94,.4)':'var(--border)'};border-radius:20px;padding:5px 12px;user-select:none;">
        <input type="checkbox" id="ai-tog-${c.key}" ${on?'checked':''} onchange="aiToggle('${c.key}',this.checked)"
          style="width:13px;height:13px;accent-color:var(--green);cursor:pointer;" />
        <span style="font-size:11px;font-weight:600;color:var(--text)">${c.label}</span>
        <span style="font-size:10px;color:${on?'var(--green)':'var(--text2)'};font-weight:700;">${on?'ON':'OFF'}</span>
      </label>`;
    }).join('');

    // History list
    const hist   = hs.history || {};
    const phones = Object.keys(hist);
    document.getElementById('ai-history-list').innerHTML = phones.length
      ? phones.map(ph => {
          const msgs    = hist[ph];
          const last    = msgs[msgs.length-1];
          const preview = (last?.content||'').slice(0,70) + ((last?.content||'').length > 70 ? '…' : '');
          return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--card2);border-radius:7px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;font-weight:600;color:var(--text)">${esc(ph)}</div>
              <div style="font-size:10px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(preview)}</div>
            </div>
            <span style="font-size:10px;color:var(--text2);white-space:nowrap">${msgs.length} msg</span>
            <button onclick="aiClearPhone('${esc(ph)}')" style="background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:2px 7px;cursor:pointer;font-size:11px;">✕</button>
          </div>`;
        }).join('')
      : '<div style="color:rgba(255,255,255,.2);font-size:11px;text-align:center;padding:16px 0;">Sin conversaciones activas</div>';
  } catch (e) {
    showToast('Error cargando panel IA: ' + e.message);
  }
}

function aiRenderQA(qa) {
  const el = document.getElementById('ai-qa-list');
  if (!el) return;
  if (!qa.length) {
    el.innerHTML = `<div style="color:rgba(255,255,255,.2);font-size:12px;text-align:center;padding:16px;">Sin preguntas — haz clic en "+ Agregar"</div>`;
    return;
  }
  el.innerHTML = qa.map((p, i) => `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px;position:relative;" id="ai-qa-${p.id}">
      <button onclick="aiDeleteQA('${p.id}')" style="position:absolute;top:10px;right:10px;background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px;">✕</button>
      <div style="font-size:10px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Pregunta ${i+1}</div>
      <input value="${esc(p.question)}" onchange="aiUpdateQA('${p.id}','question',this.value)"
        placeholder="¿Qué pregunta el candidato?"
        style="width:100%;background:#0d1a12;border:1px solid rgba(110,231,183,.25);border-radius:7px;color:#e2f3ea;font-size:12px;padding:8px 10px;outline:none;margin-bottom:8px;box-sizing:border-box;" />
      <div style="font-size:10px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Respuesta de Ana</div>
      <textarea onchange="aiUpdateQA('${p.id}','answer',this.value)"
        placeholder="¿Qué debe responder Ana?"
        style="width:100%;height:80px;background:#0d1220;border:1px solid rgba(125,211,252,.25);border-radius:7px;color:#e2eeff;font-size:12px;padding:8px 10px;outline:none;resize:vertical;box-sizing:border-box;">${esc(p.answer)}</textarea>
    </div>`).join('');
}

function aiAddQA() {
  if (!_aiConfig) return;
  const newItem = { id: Date.now().toString(), question: '', answer: '' };
  _aiConfig.qa = [...(_aiConfig.qa || []), newItem];
  aiRenderQA(_aiConfig.qa);
  document.getElementById(`ai-qa-${newItem.id}`)?.scrollIntoView({ behavior:'smooth' });
}

function aiDeleteQA(id) {
  if (!_aiConfig) return;
  _aiConfig.qa = (_aiConfig.qa || []).filter(p => p.id !== id);
  aiRenderQA(_aiConfig.qa);
}

function aiUpdateQA(id, field, value) {
  if (!_aiConfig) return;
  const item = (_aiConfig.qa || []).find(p => p.id === id);
  if (item) item[field] = value;
}

async function _aiSave(partial, label) {
  try {
    if (!_aiConfig) { showToast('⚠️ Cargando configuración, espera un momento'); return; }
    const r = await fetch(`${SERVER_URL}/ai/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: partial }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    showToast(d.ok ? `✅ ${label} guardado` : `⚠️ ${label} activo solo en memoria`);
  } catch (e) {
    showToast(`❌ Error al guardar: ${e.message}`);
  }
}

async function aiSaveGeneral() {
  if (!_aiConfig) return;
  _aiConfig.general = document.getElementById('ai-general-ta')?.value || '';
  await _aiSave({ general: _aiConfig.general }, 'Prompt general');
}

async function aiSaveQA() {
  if (!_aiConfig) return;
  await _aiSave({ qa: _aiConfig.qa }, 'Preguntas y respuestas');
}

async function aiSaveWebinar() {
  if (!_aiConfig) return;
  _aiConfig.webinar = document.getElementById('ai-webinar-ta')?.value || '';
  await _aiSave({ webinar: _aiConfig.webinar }, 'Manejo del Webinar');
}

async function aiSaveForbidden() {
  if (!_aiConfig) return;
  _aiConfig.forbidden = document.getElementById('ai-forbidden-ta')?.value || '';
  await _aiSave({ forbidden: _aiConfig.forbidden }, 'Detalles prohibidos');
}

function aiRenderCases(cases) {
  const el = document.getElementById('ai-cases-list');
  if (!el) return;
  if (!cases.length) {
    el.innerHTML = `<div style="color:rgba(255,255,255,.2);font-size:12px;text-align:center;padding:16px;">Sin situaciones — haz clic en "+ Agregar"</div>`;
    return;
  }
  el.innerHTML = cases.map((c, i) => `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px;position:relative;" id="ai-case-${c.id}">
      <button onclick="aiDeleteCase('${c.id}')" style="position:absolute;top:10px;right:10px;background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px;">✕</button>
      <div style="font-size:10px;font-weight:700;color:#fcd34d;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Situación ${i+1}</div>
      <input value="${esc(c.situation)}" onchange="aiUpdateCase('${c.id}','situation',this.value)"
        placeholder="En caso de que…"
        style="width:100%;background:#1a1500;border:1px solid rgba(252,211,77,.25);border-radius:7px;color:#fef9c3;font-size:12px;padding:8px 10px;outline:none;margin-bottom:8px;box-sizing:border-box;" />
      <div style="font-size:10px;font-weight:700;color:#7dd3fc;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Ana debe…</div>
      <textarea onchange="aiUpdateCase('${c.id}','response',this.value)"
        placeholder="¿Cómo debe reaccionar Ana?"
        style="width:100%;height:80px;background:#0d1220;border:1px solid rgba(125,211,252,.25);border-radius:7px;color:#e2eeff;font-size:12px;padding:8px 10px;outline:none;resize:vertical;box-sizing:border-box;">${esc(c.response)}</textarea>
    </div>`).join('');
}

function aiAddCase() {
  if (!_aiConfig) return;
  const newItem = { id: Date.now().toString(), situation: '', response: '' };
  _aiConfig.cases = [...(_aiConfig.cases || []), newItem];
  aiRenderCases(_aiConfig.cases);
  document.getElementById(`ai-case-${newItem.id}`)?.scrollIntoView({ behavior: 'smooth' });
}

function aiDeleteCase(id) {
  if (!_aiConfig) return;
  _aiConfig.cases = (_aiConfig.cases || []).filter(c => c.id !== id);
  aiRenderCases(_aiConfig.cases);
}

function aiUpdateCase(id, field, value) {
  if (!_aiConfig) return;
  const c = (_aiConfig.cases || []).find(c => c.id === id);
  if (c) c[field] = value;
}

async function aiSaveCases() {
  if (!_aiConfig) return;
  await _aiSave({ cases: _aiConfig.cases }, 'En caso de');
}

// ── Interview config ─────────────────────────────────────────────────────────
let _ivConfig = {};

const IV_DAYS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const IV_TRIGGERS = { morning_of:'Mañana de la cita a las', hours_before:'Horas antes de la cita', minutes_after:'Minutos después de la cita (sin respuesta)' };

function ivRenderConfig(cfg) {
  _ivConfig = JSON.parse(JSON.stringify(cfg));
  const el = document.getElementById('iv-config-wrap');
  if (!el) return;
  const s  = cfg.schedule   || {};
  const r  = cfg.rules      || {};
  const iv = cfg.interviewer || {};
  const co = cfg.confirmation|| {};
  const days = s.days || [1,2,3,4,5];

  el.innerHTML = `
    <!-- Entrevistador -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Entrevistador</div>
      <div style="display:flex;gap:8px;">
        <input id="iv-name" value="${esc(iv.name||'')}" placeholder="Nombre"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;" />
        <input id="iv-phone" value="${esc(iv.phone||'')}" placeholder="+1234567890"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;font-family:monospace;" />
      </div>
    </div>

    <!-- Zoom -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Link de Zoom (fijo y reutilizable)</div>
      <input id="iv-zoom" value="${esc(cfg.zoomLink||'')}" placeholder="https://zoom.us/j/XXXXXXXXXX"
        style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;font-family:monospace;" />
    </div>

    <!-- Horario -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Horario base semanal</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        ${[0,1,2,3,4,5,6].map(d => `
          <button onclick="ivToggleDay(${d})" id="iv-day-${d}"
            style="padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--border);
            background:${days.includes(d)?'var(--accent)':'var(--bg)'};color:${days.includes(d)?'#fff':'var(--text2)'};">
            ${IV_DAYS[d]}
          </button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="font-size:11px;color:var(--text2);flex-shrink:0;">De</label>
        <input id="iv-start" type="number" min="0" max="23" value="${s.startHour??9}"
          style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
        <label style="font-size:11px;color:var(--text2);">:00 a</label>
        <input id="iv-end" type="number" min="0" max="23" value="${s.endHour??18}"
          style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
        <label style="font-size:11px;color:var(--text2);">:00 hs</label>
      </div>
    </div>

    <!-- Reglas de tiempo -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Reglas de tiempo</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:12px;color:var(--text);flex:1;">Mínimo de horas antes de la cita</label>
          <input id="iv-minhours" type="number" min="1" max="48" value="${r.minHoursAhead??3}"
            style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
          <span style="font-size:11px;color:var(--text2);">h</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:12px;color:var(--text);flex:1;">Máximo de días después del webinar</label>
          <input id="iv-maxdays" type="number" min="1" max="14" value="${r.maxDaysOut??3}"
            style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
          <span style="font-size:11px;color:var(--text2);">días</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:12px;color:var(--text);flex:1;">Máximo de opciones a ofrecer</label>
          <input id="iv-maxopts" type="number" min="1" max="5" value="${r.maxOptions??3}"
            style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
          <span style="font-size:11px;color:var(--text2);">opciones</span>
        </div>
      </div>
    </div>

    <!-- Confirmación de cita -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Confirmación al agendar</div>
      <textarea id="iv-confirm-msg" style="width:100%;height:100px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:12px;outline:none;resize:vertical;box-sizing:border-box;line-height:1.6;">${esc(co.message||'')}</textarea>
      <div style="font-size:10px;color:var(--text2);margin-top:5px;">Variables: {nombre} {fecha} {hora} {entrevistador} {zoom}</div>
    </div>

    <!-- Recordatorios -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;">Recordatorios y alertas</div>
        <button onclick="ivAddReminder()" class="btn-secondary" style="font-size:11px;padding:4px 10px;">+ Agregar</button>
      </div>
      <div id="iv-reminders-list" style="display:flex;flex-direction:column;gap:10px;">
        ${(cfg.reminders||[]).map((rem,i) => ivReminderHTML(rem,i)).join('')}
      </div>
      <div style="font-size:10px;color:var(--text2);margin-top:8px;">Variables: {nombre} {fecha} {hora} {entrevistador}</div>
    </div>

    <div style="text-align:right;">
      <button class="btn-primary" onclick="ivSaveConfig()" style="font-size:11px;padding:6px 14px;">💾 Guardar configuración</button>
    </div>`;
}

function ivReminderHTML(rem, i) {
  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;" id="iv-rem-${rem.id}">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      <input value="${esc(rem.label||'')}" onchange="ivUpdateReminder('${rem.id}','label',this.value)"
        placeholder="Nombre del recordatorio"
        style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px;font-weight:600;outline:none;" />
      <button onclick="ivDeleteReminder('${rem.id}')" style="background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:12px;">✕</button>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
      <select onchange="ivUpdateReminder('${rem.id}','trigger',this.value)"
        style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:11px;outline:none;">
        ${Object.entries(IV_TRIGGERS).map(([k,v])=>`<option value="${k}" ${rem.trigger===k?'selected':''}>${v}</option>`).join('')}
      </select>
      <input type="number" min="0" max="120" value="${rem.value??0}" onchange="ivUpdateReminder('${rem.id}','value',+this.value)"
        style="width:55px;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
    </div>
    <textarea onchange="ivUpdateReminder('${rem.id}','message',this.value)"
      placeholder="Mensaje…" style="width:100%;height:70px;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:7px 9px;color:var(--text);font-size:11px;outline:none;resize:vertical;box-sizing:border-box;line-height:1.5;">${esc(rem.message||'')}</textarea>
    <div style="margin-top:6px;display:flex;gap:12px;">
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);cursor:pointer;">
        <input type="checkbox" ${rem.notifyManager?'checked':''} onchange="ivUpdateReminder('${rem.id}','notifyManager',this.checked)"
          style="accent-color:var(--green);" /> Notificar manager
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);cursor:pointer;">
        <input type="checkbox" ${rem.notifyInterviewer?'checked':''} onchange="ivUpdateReminder('${rem.id}','notifyInterviewer',this.checked)"
          style="accent-color:var(--green);" /> Notificar entrevistador
      </label>
    </div>
  </div>`;
}

function ivToggleDay(d) {
  if (!_ivConfig.schedule) _ivConfig.schedule = {};
  const days = _ivConfig.schedule.days || [1,2,3,4,5];
  const idx  = days.indexOf(d);
  if (idx >= 0) days.splice(idx,1); else days.push(d);
  _ivConfig.schedule.days = days;
  const btn = document.getElementById(`iv-day-${d}`);
  if (btn) {
    const on = days.includes(d);
    btn.style.background = on ? 'var(--accent)' : 'var(--bg)';
    btn.style.color      = on ? '#fff' : 'var(--text2)';
  }
}

function ivUpdateReminder(id, field, value) {
  const rem = (_ivConfig.reminders||[]).find(r=>r.id===id);
  if (rem) rem[field] = value;
}

function ivAddReminder() {
  if (!_ivConfig.reminders) _ivConfig.reminders = [];
  const newRem = { id:'r'+Date.now(), label:'Nuevo recordatorio', trigger:'hours_before', value:1, message:'', notifyManager:false, notifyInterviewer:false };
  _ivConfig.reminders.push(newRem);
  const list = document.getElementById('iv-reminders-list');
  if (list) list.insertAdjacentHTML('beforeend', ivReminderHTML(newRem, _ivConfig.reminders.length-1));
}

function ivDeleteReminder(id) {
  _ivConfig.reminders = (_ivConfig.reminders||[]).filter(r=>r.id!==id);
  document.getElementById(`iv-rem-${id}`)?.remove();
}

async function ivSaveConfig() {
  // Read form values back into _ivConfig
  const g = id => { const el=document.getElementById(id); return el?el.value.trim():''; };
  _ivConfig.interviewer = { name: g('iv-name'), phone: g('iv-phone') };
  _ivConfig.zoomLink    = g('iv-zoom');
  _ivConfig.schedule    = { ..._ivConfig.schedule, startHour: +g('iv-start'), endHour: +g('iv-end') };
  _ivConfig.rules       = { ..._ivConfig.rules, minHoursAhead:+g('iv-minhours'), maxDaysOut:+g('iv-maxdays'), maxOptions:+g('iv-maxopts'), slotDuration:60 };
  _ivConfig.confirmation= { ..._ivConfig.confirmation, message: document.getElementById('iv-confirm-msg')?.value||'' };
  try {
    const r = await fetch(`${SERVER_URL}/interviews/config`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ config: _ivConfig }),
    });
    const d = await r.json();
    showToast(d.ok ? '✅ Configuración de entrevistas guardada' : '⚠️ Error al guardar');
  } catch(e) { showToast('❌ Error: '+e.message); }
}

// ── Escalation triggers ──────────────────────────────────────────────────────

function aiRenderTriggers(triggers) {
  if (_aiConfig) _aiConfig.triggers = triggers;
  const el = document.getElementById('ai-triggers-list');
  if (!el) return;
  if (!triggers.length) {
    el.innerHTML = `<div style="color:rgba(255,255,255,.2);font-size:12px;text-align:center;padding:16px;">Sin disparadores — haz clic en "+ Agregar"</div>`;
    return;
  }
  el.innerHTML = triggers.map((t, i) => `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;" id="ai-trigger-${t.id}">
      <span style="font-size:18px;flex-shrink:0;padding-top:2px;">${esc(t.icon||'🚨')}</span>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;gap:6px;">
          <input value="${esc(t.icon||'')}" onchange="aiUpdateTrigger('${t.id}','icon',this.value)"
            placeholder="🚨" style="width:42px;text-align:center;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 6px;color:var(--text);font-size:14px;outline:none;flex-shrink:0;" />
          <input value="${esc(t.title)}" onchange="aiUpdateTrigger('${t.id}','title',this.value)"
            placeholder="Nombre del disparador"
            style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 10px;color:var(--text);font-size:12px;font-weight:600;outline:none;" />
        </div>
        <textarea onchange="aiUpdateTrigger('${t.id}','description',this.value)"
          placeholder="Cuándo Ana debe activar este disparador…"
          style="width:100%;height:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text2);font-size:11px;outline:none;resize:vertical;box-sizing:border-box;line-height:1.5;">${esc(t.description)}</textarea>
        <div style="font-size:10px;color:var(--text2);font-family:monospace;">clave: ${esc(t.escKey)}</div>
      </div>
      <button onclick="aiDeleteTrigger('${t.id}')" style="flex-shrink:0;background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:12px;margin-top:2px;">✕</button>
    </div>`).join('');
}

function aiUpdateTrigger(id, field, value) {
  if (!_aiConfig) return;
  const t = (_aiConfig.triggers || []).find(t => t.id === id);
  if (t) t[field] = value;
}

function aiAddTrigger() {
  if (!_aiConfig) return;
  const id = 't' + Date.now();
  const newT = { id, escKey: id, icon: '🚨', title: '', description: '' };
  _aiConfig.triggers = [...(_aiConfig.triggers || []), newT];
  aiRenderTriggers(_aiConfig.triggers);
  document.getElementById(`ai-trigger-${newT.id}`)?.scrollIntoView({ behavior: 'smooth' });
}

function aiDeleteTrigger(id) {
  if (!_aiConfig) return;
  _aiConfig.triggers = (_aiConfig.triggers || []).filter(t => t.id !== id);
  aiRenderTriggers(_aiConfig.triggers);
}

async function aiSaveTriggers() {
  if (!_aiConfig) return;
  await _aiSave({ triggers: _aiConfig.triggers }, 'Disparadores');
}

// ── Team chat ────────────────────────────────────────────────────────────────
let _teamMessages  = [];
let _teamMembers   = [];   // { phone, name, role }
let _teamActiveTab = null;

function aiInitTeamChat(managers, interviewer, messages) {
  _teamMessages = messages;
  _teamMembers  = [
    ...managers.map(m => ({ phone: m.phone, name: m.name, role: 'manager' })),
  ];
  if (interviewer?.phone) {
    _teamMembers.push({ phone: interviewer.phone, name: interviewer.name || 'Entrevistador', role: 'interviewer' });
  }
  // Deduplicate by phone
  const seen = new Set();
  _teamMembers = _teamMembers.filter(m => { const k = m.phone.replace(/^\+/,''); if (seen.has(k)) return false; seen.add(k); return true; });

  _aiRenderTeamTabs();
  if (_teamMembers.length) aiSelectTeamTab(_teamMembers[0].phone);
}

function _aiRenderTeamTabs() {
  const tabs = document.getElementById('ai-team-tabs'); // only used in old inline panel (now standalone view)
  if (!tabs) return;
  tabs.innerHTML = _teamMembers.map(m => {
    const count = _teamMessages.filter(msg => msg.phone?.replace(/^\+/,'') === m.phone.replace(/^\+/,'')).length;
    const color = m.role === 'interviewer' ? 'rgba(99,102,241,.25)' : 'rgba(249,115,22,.2)';
    const textC = m.role === 'interviewer' ? '#a5b4fc' : '#fdba74';
    return `<button id="ai-team-tab-${m.phone.replace(/[^0-9]/g,'')}" onclick="aiSelectTeamTab('${m.phone}')"
      style="font-size:11px;padding:5px 12px;border-radius:20px;border:1px solid ${color};background:transparent;color:${textC};cursor:pointer;">
      ${esc(m.name)} ${count ? `<span style="opacity:.7">(${count})</span>` : ''}
    </button>`;
  }).join('');
}

function aiSelectTeamTab(phone) {
  _teamActiveTab = phone;
  _aiRenderTeamMessages(phone);
  if (document.getElementById('tc-members')) _tcRenderMembers();
}

function _aiRenderTeamMessages(phone) {
  const clean  = phone.replace(/^\+/, '');
  const msgs   = _teamMessages.filter(m => (m.phone || '').replace(/^\+/, '') === clean);
  const member = _teamMembers.find(m => m.phone.replace(/^\+/,'') === clean);
  const el     = document.getElementById('tc-chat');
  if (!el) return;

  if (!msgs.length) {
    el.innerHTML = `<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px;">Sin mensajes aún con ${esc(member?.name || phone)}.</div>`;
    return;
  }

  el.innerHTML = msgs.map(m => {
    const isOut = m.direction === 'out';
    const d     = m.ts ? new Date(m.ts) : null;
    const hora  = d ? d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) : '';
    const fecha = d ? d.toLocaleDateString('es-MX',{day:'numeric',month:'short'}) : '';
    return `<div style="display:flex;flex-direction:column;align-items:${isOut?'flex-end':'flex-start'};gap:2px;">
      <div style="max-width:82%;background:${isOut?'rgba(99,102,241,.18)':'var(--card2)'};border:1px solid ${isOut?'rgba(99,102,241,.3)':'var(--border)'};border-radius:${isOut?'12px 12px 2px 12px':'12px 12px 12px 2px'};padding:8px 12px;font-size:12px;color:var(--text);white-space:pre-wrap;word-break:break-word;">${esc(m.text||'')}</div>
      <div style="font-size:10px;color:var(--text2);">${isOut?'Ana →':('← '+esc(member?.name||''))} · ${fecha} ${hora}</div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// ── WhatsApp Templates UI ─────────────────────────────────────────────────────
const TEMPLATE_RECIPIENT_LABEL = { manager:'👤 Encargado', interviewer:'🎙 Entrevistador', candidate:'📱 Candidato' };
const TEMPLATE_RECIPIENT_COLOR = { manager:'#f97316', interviewer:'#a5b4fc', candidate:'#22c55e' };

function aiRenderTemplates(templates) {
  const el = document.getElementById('ai-templates-list');
  if (!el) return;
  const entries = Object.entries(templates);
  if (!entries.length) { el.innerHTML = '<div style="color:var(--text2);font-size:12px;">Sin plantillas.</div>'; return; }

  el.innerHTML = entries.map(([key, tpl]) => {
    const color  = TEMPLATE_RECIPIENT_COLOR[tpl.recipient] || '#94a3b8';
    const label  = TEMPLATE_RECIPIENT_LABEL[tpl.recipient] || tpl.recipient || '';
    const vars   = (tpl.variables || []).map(v =>
      `<div style="display:flex;gap:6px;font-size:11px;padding:3px 0;">
        <span style="background:rgba(99,102,241,.18);border-radius:4px;padding:1px 7px;font-family:monospace;color:#a5b4fc;flex-shrink:0;">{{${v.n}}}</span>
        <span style="color:var(--text2);">${esc(v.label)}</span>
        <span style="color:var(--text2);opacity:.55;">— ej: "${esc(v.ejemplo)}"</span>
      </div>`
    ).join('');
    const preview = (tpl.body || '').replace(/\n/g, '<br>');
    return `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:12px;font-weight:700;color:var(--text);">${esc(tpl.description || key)}</span>
            <span style="font-size:10px;background:rgba(${color==='#f97316'?'249,115,22':color==='#a5b4fc'?'165,180,252':'34,197,94'},.12);color:${color};border-radius:10px;padding:2px 8px;">${label}</span>
          </div>
          <div style="font-size:10px;color:var(--text2);margin-top:2px;">Nombre en Meta: <code style="color:#c4b5fd;">${esc(tpl.name)}</code></div>
        </div>
        <button onclick="navigator.clipboard.writeText(${JSON.stringify(tpl.name)}).then(()=>showToast('Nombre copiado ✓'))"
          style="flex-shrink:0;background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;color:var(--text2);cursor:pointer;font-size:10px;">📋 Copiar nombre</button>
      </div>
      <!-- Body preview -->
      <div style="padding:12px 14px;font-size:12px;color:var(--text);line-height:1.7;font-family:monospace;background:rgba(0,0,0,.15);">${preview}</div>
      <!-- Variables -->
      ${vars ? `<div style="padding:10px 14px;border-top:1px solid var(--border);">${vars}</div>` : ''}
    </div>`;
  }).join('');
}

async function aiLoadTeamChat() {
  try {
    const data = await fetch(`${SERVER_URL}/ai/team-messages`).then(r=>r.json());
    _teamMessages = data.messages || [];
    _aiRenderTeamTabs();
    if (_teamActiveTab) _aiRenderTeamMessages(_teamActiveTab);
  } catch(e) { showToast('Error cargando mensajes: '+e.message, 'error'); }
}

async function aiToggle(channel, enabled) {
  try {
    await fetch(`${SERVER_URL}/ai/settings`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ [channel]: enabled }) });
    const sp = document.querySelector(`#ai-tog-${channel}`)?.closest('label')?.querySelector('span:last-child');
    if (sp) { sp.textContent = enabled ? 'ACTIVO' : 'INACTIVO'; sp.style.color = enabled ? 'var(--green)' : 'var(--text2)'; }
    showToast(`IA ${channel.toUpperCase()} ${enabled ? 'activada' : 'desactivada'}`);
  } catch { showToast('Error al cambiar configuración'); }
}


async function aiClearHistory() {
  if (!confirm('¿Borrar todas las conversaciones activas de IA?')) return;
  await fetch(`${SERVER_URL}/ai/history`, { method:'DELETE' });
  showToast('Historial borrado');
  aiLoadPanel();
}

async function aiClearPhone(phone) {
  await fetch(`${SERVER_URL}/ai/history/${encodeURIComponent(phone)}`, { method:'DELETE' });
  showToast('Conversación eliminada');
  aiLoadPanel();
}

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

  // Build combined timeline
  const msgs = [
    ...(lead.sms||[]).map(m => ({...m, ch:'sms'})),
    ...(lead.whatsapp||[]).map(m => ({...m, ch:'wa'})),
  ].sort((a,b) => new Date(a.dateSent||a.date||0) - new Date(b.dateSent||b.date||0));

  const threadHtml = msgs.length ? msgs.map(m => {
    const out  = m.direction === 'outbound';
    const _d   = m.dateSent || m.date;
    const time = _d ? fmtDateTime(_d) : '';
    const ch   = m.ch;
    const tick = out && ch==='wa' ? (m.status==='read'?'✓✓':'✓') : '';
    return `<div class="msg-bubble-wrap ${out?'out':'in'}">
      <div class="msg-bubble ${out?'out':'in'} ${ch}">${esc(m.body||'')}</div>
      <div class="msg-bubble-meta">
        <span class="msg-channel-tag ${ch}">${ch==='wa'?'WhatsApp':'SMS'}</span>
        ${time}${m.autor?' · '+esc(m.autor):''}${tick?' '+tick:''}
      </div>
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
let _lcChannel  = 'sms';   // 'sms' | 'wa'
let _lcPollInt  = null;
let _lcLoading  = false;

function lcOpen() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;
  clearInterval(_lcPollInt);
  const phone = lead.telefono || '';
  document.getElementById('lc-contact-num').textContent = phone || '(sin número)';
  lcRenderActivity(lead);
  lcRenderTimeline(lead);
  if (phone) {
    lcFetchCalls(lead);
    lcFetchMessages(lead);
    _lcPollInt = setInterval(() => lcFetchMessages(leads.find(l => l.id === currentLeadId)), 10000);
  }
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
      let payload;
      if (key) {
        const tpl  = WA_TEMPLATES[key];
        const vars = {};
        document.querySelectorAll('#lc-tpl-vars input').forEach(inp => { vars[inp.dataset.var] = inp.value.trim(); });
        payload = { to: phone, contentSid: tpl.sid, contentVariables: vars, leadId: lead.id };
      } else {
        const body = document.getElementById('lc-textarea').value.trim();
        if (!body) { btn.disabled = false; return; }
        payload = { to: phone, body, leadId: lead.id };
      }
      const res = await fetch(`${SERVER_URL}/twilio/whatsapp`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error || `Error WhatsApp (${res.status})`); }
      if (!lead.whatsapp) lead.whatsapp = [];
      const body = key ? `[Plantilla: ${key}]` : document.getElementById('lc-textarea').value.trim();
      lead.whatsapp.push({ body, direction: 'outbound', dateSent: new Date().toISOString(), sid: 'local_' + Date.now() });
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
      fetch(`${SERVER_URL}/twilio/whatsapp-inbox?phone=${encodeURIComponent(lead.telefono)}`),
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
      if (!lead.whatsapp) lead.whatsapp = [];
      for (const m of d2.messages) {
        const ex = lead.whatsapp.find(s => s.sid === m.sid);
        if (!ex) { lead.whatsapp.push(m); updated = true; }
        else if (!ex.dateSent && m.dateSent) { Object.assign(ex, m); updated = true; }
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
  // WhatsApp
  for (const m of (lead.whatsapp || [])) {
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
          <button class="cv-filter"        data-f="outbound" onclick="_cvSetFilter('outbound')">Salientes</button>
          <button class="cv-filter"        data-f="inbound"  onclick="_cvSetFilter('inbound')">Entrantes</button>
          <button class="cv-filter"        data-f="missed"   onclick="_cvSetFilter('missed')">Perdidas</button>
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
    const res  = await fetch(`${SERVER_URL}/twilio/calls?limit=100`);
    const data = await res.json();
    if (data.calls) { _cvAllCalls = data.calls; _cvRenderList(); }
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
    if (_cvFilter === 'outbound' && !c.direction?.startsWith('outbound')) return false;
    if (_cvFilter === 'inbound'  && c.direction !== 'inbound') return false;
    if (_cvFilter === 'missed'   && c.status !== 'no-answer' && c.status !== 'busy' && c.status !== 'failed') return false;
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
    const dir    = last.direction?.startsWith('outbound') ? '↗' : '↙';
    const miss   = last.status === 'no-answer' || last.status === 'busy' || last.status === 'failed';
    const durFmt = last.duration > 0 ? `${Math.floor(last.duration/60)}:${String(last.duration%60).padStart(2,'0')}` : '—';
    const timeAgo = _cvTimeAgo(last.startTime);
    const active = _cvContactId === num ? 'active' : '';
    return `<div class="cv-item ${active}" onclick="_cvOpenContact('${num}')">
      <div class="cv-avatar" style="background:${miss?'rgba(226,68,92,.3)':color}">${initials}</div>
      <div class="cv-item-info">
        <div class="cv-item-name">${esc(name)}</div>
        <div class="cv-item-sub">${miss?'<span style="color:#e2445c">📵 Perdida</span>':dir+' '+durFmt} · ${esc(num)}</div>
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
  const out  = c.direction?.startsWith('outbound');
  const miss = c.status === 'no-answer' || c.status === 'busy' || c.status === 'failed';
  const durFmt = parseInt(c.duration) > 0
    ? `${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}`
    : '0:00';
  const iconCls = miss ? 'miss' : out ? 'out' : 'in';
  const icon    = miss ? '📵' : out ? '↗' : '↙';
  const dirLbl  = miss ? 'Perdida' : out ? 'Saliente' : 'Entrante';
  const numDisplay = out ? c.to : c.from;
  const dt = new Date(c.startTime);
  const dtFmt = dt.toLocaleDateString('es-MX', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  return `<div class="cv-call-card">
    <div class="cv-call-icon ${iconCls}">${icon}</div>
    <div class="cv-call-info">
      <div class="cv-call-dir">${dirLbl}</div>
      <div class="cv-call-num">${esc(numDisplay)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">${esc(dtFmt)}</div>
    </div>
    <div class="cv-call-meta">
      <div class="cv-call-dur">${durFmt}</div>
      <div style="font-size:10px;margin-top:2px;padding:2px 7px;border-radius:10px;display:inline-block;
        background:${miss?'rgba(226,68,92,.15)':out?'rgba(0,200,117,.15)':'rgba(96,165,250,.15)'};
        color:${miss?'#e2445c':out?'#00c875':'#60a5fa'}">${c.status||'—'}</div>
      <br><button class="cv-call-btn" style="margin-top:6px" onclick="cpOpen_num('${esc(contactNum)}','')">📞 Volver a llamar</button>
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

// ── WhatsApp Module ───────────────────────────────────────────────────────────
let _waLeadId  = null;
let _waPollInt = null;

function waOpen() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;
  const raw   = document.getElementById('ml-telefono')?.value?.trim() || lead.telefono || '';
  if (!raw) { showToast('Este lead no tiene teléfono'); return; }
  _waLeadId = lead.id;
  if (!lead.whatsapp) lead.whatsapp = [];
  const panel    = document.getElementById('wa-panel');
  const initials = (lead.nombre||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
  document.getElementById('wa-avatar').textContent = initials;
  document.getElementById('wa-name').textContent   = lead.nombre || 'Desconocido';
  document.getElementById('wa-number').textContent = raw;
  panel.style.display = 'flex';
  // offset if other panels open
  const others = [
    document.getElementById('call-panel').style.display !== 'none' ? 340 : 0,
    document.getElementById('sms-panel').style.display  !== 'none' ? 340 : 0,
  ];
  panel.style.right = (24 + others.reduce((a,b) => a+b, 0)) + 'px';
  waRenderThread(lead.whatsapp);
  _waUpdateIABtn(lead.ia_paused);
  clearInterval(_waPollInt);
  _waPollInt = setInterval(() => waPoll(raw), 8000);
}

function waClose() {
  document.getElementById('wa-panel').style.display = 'none';
  clearInterval(_waPollInt);
  _waPollInt = null;
}

function _waUpdateIABtn(paused) {
  const btn = document.getElementById('wa-ia-toggle');
  if (!btn) return;
  if (paused) {
    btn.textContent = '⏸ IA pausada';
    btn.style.background = 'rgba(248,113,113,.25)';
    btn.style.borderColor = 'rgba(248,113,113,.5)';
  } else {
    btn.textContent = '🤖 IA activa';
    btn.style.background = 'rgba(0,0,0,.3)';
    btn.style.borderColor = 'rgba(255,255,255,.2)';
  }
}

async function waToggleIA() {
  const lead = leads.find(l => l.id === _waLeadId);
  if (!lead) return;
  lead.ia_paused = !lead.ia_paused;
  _waUpdateIABtn(lead.ia_paused);
  saveLeads(lead.id);
  showToast(lead.ia_paused ? '⏸ IA pausada — responderás tú manualmente' : '🤖 IA reactivada');
}

function waRenderThread(messages) {
  const thread = document.getElementById('wa-thread');
  if (!messages || !messages.length) {
    thread.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,.25);font-size:12px;margin-top:40px">Sin mensajes aún</div>';
    return;
  }
  thread.innerHTML = messages.map(m => {
    const out  = m.direction === 'outbound';
    const time = m.date ? fmtDateTime(m.date) : '';
    const tick = out ? (m.status === 'read' ? '✓✓' : '✓') : '';
    return `<div class="${out?'sms-out-wrap':'sms-in-wrap'}">
      <div class="sms-bubble ${out?'wa-out':'wa-in'}">${esc(m.body)}</div>
      <div class="sms-meta">${time}${m.autor?' · '+esc(m.autor):''} ${tick}</div>
    </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

const WA_TEMPLATES = {
  'aplicacante_registrado':                               { sid:'HXa9fe464baefe349f755700e56ba26848', vars:['nombre','fuente'] },
  'link_de_entrevista_con_globe_life':                    { sid:'HXc1541737ff6cdd2907d6b371e751d1f9', vars:['nombre','hora','link'] },
  'registrado_en_una_entrevista':                         { sid:'HXa6d83e7faa46a987cd82239b997381b9', vars:['nombre','fecha'] },
  '2do_intento_de_contacto_webinar_no_visto_eliminacion': { sid:'HXa2f618ca272a83b16c56404ec34cd6f6', vars:['nombre'] },
  '3er_intento_de_contacto':                             { sid:'HX175470685668cd261272511c80c7788a', vars:['nombre'] },
  'en_webinar_webinar_visto':                            { sid:'HX2dec739e597fea20d78cfeddf2d20aef', vars:['nombre'] },
  'webinar_con_video':                                    { sid:'HXa2e2aa6c119a9cb0efde545427681f1c', vars:['nombre'] },
  'en_webinar_aplicantes':                               { sid:'HXca9415a238db82176a342470128892e8', vars:['nombre','correo'] },
  'no_visto_webinar':                                    { sid:'HX981dc91dfdd54bdb7d44abf125639ec5', vars:['nombre'] },
  'eliminacion_por_webinar_visto':                       { sid:'HXba2e7a22108e977fd04b9fc1423e7b3b', vars:['nombre'] },
  'agenda_de_cita_para_manager':                         { sid:'HX2c89da1a9a1df9d8fa355f27045513ce', vars:['nombre_candidato','dia','hora'] },
  'aviso_entrevista_con_manager_30_minutos_antes':        { sid:'HX073dda6f00a00001908811fe37978c41', vars:['nombre','hora','link_zoom'] },
};

function waLoadTemplate() {
  const sel   = document.getElementById('wa-tpl-select');
  const key   = sel.value;
  const tpl   = WA_TEMPLATES[key];
  const varsEl = document.getElementById('wa-tpl-vars');
  const inp   = document.getElementById('wa-inp');
  if (!key || !tpl) {
    varsEl.style.display = 'none';
    varsEl.innerHTML = '';
    inp.value = '';
    return;
  }
  const lead = leads.find(l => l.id === _waLeadId);
  // Auto-fill known values
  const autoFill = {
    nombre:           lead?.nombre || '',
    fuente:           lead?.fuente || '',
    correo:           lead?.correo || '',
    nombre_candidato: lead?.nombre || '',
  };
  varsEl.style.display = 'flex';
  varsEl.innerHTML = tpl.vars.map((v,i) =>
    `<div style="display:flex;gap:6px;align-items:center;margin-bottom:3px;">
      <label style="color:rgba(255,255,255,.5);font-size:10.5px;min-width:90px;">{{${i+1}}} ${v}</label>
      <input id="wa-var-${i}" value="${esc(autoFill[v]||'')}" placeholder="${v}" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(37,211,102,.15);border-radius:5px;color:#fff;font-size:11.5px;font-family:var(--font);padding:4px 7px;outline:none;" />
    </div>`
  ).join('');
  inp.value = '← Usando plantilla: ' + key.replace(/_/g,' ');
  inp.style.opacity = '.4';
}

async function waSend() {
  const sel   = document.getElementById('wa-tpl-select');
  const tplKey = sel.value;
  const inp   = document.getElementById('wa-inp');
  const lead  = leads.find(l => l.id === _waLeadId);
  if (!lead) return;
  const phone = document.getElementById('wa-number').textContent;
  const btn   = document.getElementById('wa-send-btn');
  btn.disabled = true; btn.style.opacity = '.5';

  try {
    let payload, displayBody;

    if (tplKey && WA_TEMPLATES[tplKey]) {
      // Template send
      const tpl  = WA_TEMPLATES[tplKey];
      const vars = {};
      tpl.vars.forEach((v,i) => {
        const el = document.getElementById(`wa-var-${i}`);
        vars[(i+1).toString()] = el ? el.value.trim() : '';
      });
      payload = { to: phone, contentSid: tpl.sid, contentVariables: vars, leadId: lead.id };
      displayBody = `[Plantilla: ${tplKey.replace(/_/g,' ')}] ${Object.values(vars).join(' · ')}`;
    } else {
      // Free text send
      const body = inp.value.trim();
      if (!body) { btn.disabled=false; btn.style.opacity='1'; return; }
      payload = { to: phone, body, leadId: lead.id };
      displayBody = body;
    }

    const res  = await fetch(`${SERVER_URL}/twilio/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error al enviar');

    if (!lead.whatsapp) lead.whatsapp = [];
    lead.whatsapp.push({ direction:'outbound', body: displayBody, date: new Date().toISOString(), autor: currentUser?.name||'Agente', sid: data.sid, status:'sent' });
    addHistorial(lead.id, `WhatsApp enviado: "${displayBody.slice(0,60)}${displayBody.length>60?'…':''}"`, '📱');
    saveLeads();
    // Reset
    inp.value = ''; inp.style.opacity = '1';
    sel.value = '';
    document.getElementById('wa-tpl-vars').style.display = 'none';
    document.getElementById('wa-tpl-vars').innerHTML = '';
    waRenderThread(lead.whatsapp);
  } catch (e) {
    showToast('Error: ' + e.message);
  } finally {
    btn.disabled = false; btn.style.opacity = '1';
  }
}

async function waPoll(phone) {
  if (!_waLeadId) return;
  const lead = leads.find(l => l.id === _waLeadId);
  if (!lead) return;
  try {
    const res  = await fetch(`${SERVER_URL}/twilio/whatsapp-inbox?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (!data.messages) return;
    if (!lead.whatsapp) lead.whatsapp = [];
    let updated = false;
    for (const msg of data.messages) {
      if (!lead.whatsapp.find(s => s.sid === msg.sid)) {
        lead.whatsapp.push(msg);
        if (msg.direction === 'inbound')
          addHistorial(lead.id, `WhatsApp recibido: "${msg.body.slice(0,50)}${msg.body.length>50?'…':''}"`, '📩');
        updated = true;
      }
    }
    if (updated) { saveLeads(); waRenderThread(lead.whatsapp); }
  } catch {}
}

// ── SMS Module ────────────────────────────────────────────────────────────────
let _smsLeadId = null;
let _smsPollInt = null;

function smsOpen() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;
  const phone = document.getElementById('ml-telefono')?.value?.trim() || lead.telefono || '';
  if (!phone) { showToast('Este lead no tiene teléfono'); return; }
  _smsLeadId = lead.id;
  if (!lead.sms) lead.sms = [];
  const panel = document.getElementById('sms-panel');
  const initials = (lead.nombre||'?').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
  document.getElementById('sms-avatar').textContent = initials;
  document.getElementById('sms-name').textContent   = lead.nombre || 'Desconocido';
  document.getElementById('sms-number').textContent = phone;
  panel.style.display = 'flex';
  // if call panel open, offset
  const callPanel = document.getElementById('call-panel');
  if (callPanel.style.display !== 'none') panel.style.right = '340px';
  else panel.style.right = '24px';
  smsRenderThread(lead.sms);
  clearInterval(_smsPollInt);
  _smsPollInt = setInterval(() => smsPoll(phone), 8000);
}

function smsClose() {
  document.getElementById('sms-panel').style.display = 'none';
  clearInterval(_smsPollInt);
  _smsPollInt = null;
}

function smsRenderThread(messages) {
  const thread = document.getElementById('sms-thread');
  if (!messages || !messages.length) {
    thread.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,.25);font-size:12px;margin-top:40px">Sin mensajes aún</div>';
    return;
  }
  thread.innerHTML = messages.map(m => {
    const out = m.direction === 'outbound';
    const time = m.date ? fmtDateTime(m.date) : '';
    return `<div class="${out?'sms-out-wrap':'sms-in-wrap'}">
      <div class="sms-bubble ${out?'sms-out':'sms-in'}">${esc(m.body)}</div>
      <div class="sms-meta">${time}${m.autor ? ' · ' + esc(m.autor) : ''}</div>
    </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

async function smsSend() {
  const inp  = document.getElementById('sms-inp');
  const body = inp.value.trim();
  if (!body) return;
  const lead = leads.find(l => l.id === _smsLeadId);
  if (!lead) return;
  const phone = document.getElementById('sms-number').textContent;
  const btn   = document.getElementById('sms-send-btn');
  btn.disabled = true;
  btn.style.opacity = '.5';
  try {
    const res  = await fetch(`${SERVER_URL}/twilio/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, body, leadId: lead.id })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error al enviar');
    if (!lead.sms) lead.sms = [];
    lead.sms.push({ direction: 'outbound', body, date: new Date().toISOString(), autor: currentUser?.name || 'Agente', sid: data.sid });
    addHistorial(lead.id, `SMS enviado: "${body.slice(0,50)}${body.length>50?'…':''}"`, '💬');
    saveLeads();
    inp.value = '';
    smsRenderThread(lead.sms);
  } catch (e) {
    showToast('Error al enviar SMS: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

async function smsPoll(phone) {
  if (!_smsLeadId) return;
  const lead = leads.find(l => l.id === _smsLeadId);
  if (!lead) return;
  try {
    const res  = await fetch(`${SERVER_URL}/twilio/sms-inbox?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (!data.messages) return;
    if (!lead.sms) lead.sms = [];
    let updated = false;
    for (const msg of data.messages) {
      if (msg.direction === 'inbound' && !lead.sms.find(s => s.sid === msg.sid)) {
        lead.sms.push(msg);
        addHistorial(lead.id, `SMS recibido: "${msg.body.slice(0,50)}${msg.body.length>50?'…':''}"`, '📩');
        updated = true;
      }
    }
    if (updated) { saveLeads(); smsRenderThread(lead.sms); }
  } catch {}
}
