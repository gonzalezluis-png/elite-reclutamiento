//  AI PANEL — Panel IA, Team Chat, Entrevistas, Plantillas
// ════════════════════════════════════════════
function _hideAllViews() {
  document.getElementById('kanban-wrap').style.display       = 'none';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('table-view-wrap').style.display = 'none';
  document.getElementById('calendar-view').classList.remove('active');
  document.getElementById('config-view').style.display      = 'none';
  document.getElementById('messaging-view').classList.remove('active');
  document.getElementById('messaging-view').style.display = 'none';
  document.getElementById('conversations-view').classList.remove('active');
  document.getElementById('conversations-view').style.display = 'none';
  document.getElementById('ai-view').style.display                = 'none';
  document.getElementById('ai-entrevistas-view').style.display    = 'none';
  document.getElementById('team-chat-view').style.display         = 'none';
  document.getElementById('monitor-view').style.display           = 'none';
  document.getElementById('wa-inbox-view').style.display          = 'none';
  clearInterval(_waInboxPollInt);
  document.getElementById('leads-today-bar').style.display        = 'none';
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
    const [cs, ss, hs, tpls] = await Promise.all([
      fetch(`${SERVER_URL}/ai/config`).then(r=>r.json()),
      fetch(`${SERVER_URL}/ai/settings`).then(r=>r.json()),
      fetch(`${SERVER_URL}/ai/history`).then(r=>r.json()),
      fetch(`${SERVER_URL}/ai/templates`).then(r=>r.json()).catch(()=>({templates:{}})),
    ]);

    _aiConfig = cs.config || {};
    document.getElementById('ai-general-ta').value   = _aiConfig.general  || '';
    document.getElementById('ai-webinar-ta').value   = _aiConfig.webinar  || '';
    document.getElementById('ai-forbidden-ta').value = _aiConfig.forbidden || '';
    aiRenderQA(_aiConfig.qa || []);
    aiRenderCases(_aiConfig.cases || []);
    aiRenderTriggers(_aiConfig.triggers || []);
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

// ════════════════════════════════════════════
//  ASISTENTE IA · ENTREVISTAS
// ════════════════════════════════════════════
let _aieConfig = null;

async function showAIEntrevistas() {
  _hideAllViews();
  activeView = 'ai-entrevistas';
  document.getElementById('board-title').textContent = 'Asistente IA · Entrevistas';
  const el = document.getElementById('ai-entrevistas-view');
  el.style.display = 'block';
  renderSidebar();

  el.innerHTML = `<div style="max-width:820px;margin:0 auto;padding-bottom:40px;">
    <div style="border-bottom:1px solid var(--border);padding-bottom:18px;margin-bottom:20px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Grupo Élite · CRM</div>
          <h2 style="font-size:20px;font-weight:800;color:var(--text);margin:0;letter-spacing:-.2px;">🎙 Asistente IA · Entrevistas</h2>
          <p style="font-size:12px;color:var(--text2);margin:4px 0 0;line-height:1.5;">Instrucciones que Ana sigue <strong>desde que el candidato confirma interés en la entrevista</strong> hasta que asiste o no. Se activa cuando Ana detecta que el candidato ya vio el webinar y quiere continuar.</p>
        </div>
        <button onclick="aiLoadEntrevistasPanel()" style="flex-shrink:0;background:var(--card2);border:1px solid var(--border);color:var(--text2);padding:7px 14px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;">↻ Actualizar</button>
      </div>
    </div>

    ${[
      { id:'config',   icon:'🎙', title:'Configuración de entrevistas',             desc:'Entrevistador, horario semanal, Zoom, recordatorios y confirmaciones.' },
      { id:'general',  icon:'📄', title:'Instrucciones para la fase de entrevistas', desc:'Cómo debe comportarse Ana una vez que el candidato confirma que quiere ir a la entrevista.' },
      { id:'qa',       icon:'❔', title:'Preguntas frecuentes sobre entrevistas',    desc:'Dudas comunes que tiene el candidato al agendar: Zoom, duración, qué llevar, etc.' },
      { id:'forbidden',icon:'🚫', title:'Temas prohibidos',                          desc:'Lo que Ana nunca debe mencionar ni responder en esta fase.' },
      { id:'cases',    icon:'⚡', title:'Situaciones específicas',                   desc:'Cómo manejar casos puntuales: candidato quiere cambiar fecha, no tiene Zoom, etc.' },
      { id:'triggers', icon:'🚨', title:'Cuándo buscar un manager',                  desc:'Situaciones en la fase de entrevistas que activan una alerta al equipo.' },
      { id:'templates',icon:'📋', title:'Plantillas de WhatsApp para entrevistas',   desc:'Plantillas de confirmación, recordatorio y avisos de la entrevista.' },
    ].map(s => `
    <div style="border:1px solid var(--border);border-radius:10px;margin-bottom:6px;overflow:hidden;background:var(--card);">
      <button onclick="aieToggleSection('${s.id}')" style="width:100%;display:flex;align-items:center;gap:12px;padding:13px 16px;background:none;border:none;cursor:pointer;text-align:left;user-select:none;">
        <span style="font-size:14px;width:20px;text-align:center;flex-shrink:0;">${s.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:var(--text);">${s.title}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:1px;">${s.desc}</div>
        </div>
        <span id="aie-chevron-${s.id}" style="color:var(--text2);font-size:10px;transition:transform .18s;flex-shrink:0;">▼</span>
      </button>
      <div id="aie-section-${s.id}" style="display:none;border-top:1px solid var(--border);padding:16px;"></div>
    </div>`).join('')}
  </div>`;

  await aiLoadEntrevistasPanel();
}

function aieToggleSection(id) {
  const pane    = document.getElementById(`aie-section-${id}`);
  const chevron = document.getElementById(`aie-chevron-${id}`);
  if (!pane) return;
  const open = pane.style.display === 'none';
  pane.style.display      = open ? 'block' : 'none';
  chevron.style.transform = open ? 'rotate(180deg)' : '';
  if (open) _aieInjectSection(id);
}

function _aieInjectSection(id) {
  const el = document.getElementById(`aie-section-${id}`);
  if (!el || el.dataset.loaded) return;
  el.dataset.loaded = '1';

  if (id === 'config') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px;padding-top:4px;" id="iv-config-wrap">
      <div style="color:var(--text2);font-size:12px;">Cargando configuración…</div>
    </div>`;
    ivRenderConfig(_ivConfig || {});
  }

  else if (id === 'general') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding-top:4px;">
      <div style="font-size:11px;color:var(--text2);line-height:1.6;">Describe cómo debe comportarse Ana en esta fase: tono, pasos a seguir, cómo confirmar la cita, qué información pedir, etc.</div>
      <textarea id="aie-general-ta" style="width:100%;height:240px;background:#0d0f1a;border:1px solid rgba(120,75,209,.35);border-radius:8px;color:#e2d9f3;font-size:12px;font-family:monospace;padding:14px;line-height:1.7;resize:vertical;outline:none;box-sizing:border-box;" placeholder="Ej: Una vez que el candidato confirma que vio el webinar y quiere la entrevista, Ana debe:\n1. Felicitarlo y confirmar su interés\n2. Ofrecer horarios disponibles\n3. Confirmar los datos de Zoom\n...">${esc(_aieConfig?.general||'')}</textarea>
      <div style="text-align:right;"><button class="btn-primary" onclick="aieSaveGeneral()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button></div>
    </div>`;
  }

  else if (id === 'qa') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding-top:4px;">
      <div id="aie-qa-list" style="display:flex;flex-direction:column;gap:12px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary" onclick="aieAddQA()" style="font-size:11px;padding:6px 12px;">+ Agregar</button>
        <button class="btn-primary"   onclick="aieSaveQA()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button>
      </div>
    </div>`;
    aieRenderQA(_aieConfig?.qa || []);
  }

  else if (id === 'forbidden') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding-top:4px;">
      <textarea id="aie-forbidden-ta" style="width:100%;height:160px;background:#1a0d0d;border:1px solid rgba(226,68,92,.3);border-radius:8px;color:#fca5a5;font-size:12px;font-family:monospace;padding:14px;line-height:1.7;resize:vertical;outline:none;box-sizing:border-box;" placeholder="Ej: No mencionar salarios específicos. No comparar con otras empresas...">${esc(_aieConfig?.forbidden||'')}</textarea>
      <div style="text-align:right;"><button class="btn-primary" onclick="aieSaveForbidden()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button></div>
    </div>`;
  }

  else if (id === 'cases') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding-top:4px;">
      <div id="aie-cases-list" style="display:flex;flex-direction:column;gap:12px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary" onclick="aieAddCase()" style="font-size:11px;padding:6px 12px;">+ Agregar</button>
        <button class="btn-primary"   onclick="aieSaveCases()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button>
      </div>
    </div>`;
    aieRenderCases(_aieConfig?.cases || []);
  }

  else if (id === 'triggers') {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding-top:4px;">
      <div id="aie-triggers-list" style="display:flex;flex-direction:column;gap:8px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-secondary" onclick="aieAddTrigger()" style="font-size:11px;padding:6px 12px;">+ Agregar</button>
        <button class="btn-primary"   onclick="aieSaveTriggers()" style="font-size:11px;padding:6px 14px;">💾 Guardar</button>
      </div>
    </div>`;
    aieRenderTriggers(_aieConfig?.triggers || []);
  }

  else if (id === 'templates') {
    const IV_TEMPLATES = {
      'registrado_en_una_entrevista':                     { name:'registrado_en_una_entrevista',                     desc:'Confirmación al agendar entrevista',       vars:['nombre','fecha'],              recipient:'candidate' },
      'link_de_entrevista_con_globe_life':                { name:'link_de_entrevista_con_globe_life',                desc:'Link de entrevista (5 min antes)',         vars:['nombre','hora','link'],         recipient:'candidate' },
      'aviso_entrevista_con_manager_30_minutos_antes':    { name:'aviso_entrevista_con_manager_30_minutos_antes',    desc:'Aviso 30 min antes al candidato',          vars:['nombre','hora','link_zoom'],    recipient:'candidate' },
      'agenda_de_cita_para_manager':                      { name:'agenda_de_cita_para_manager',                     desc:'Notificación de nueva cita al manager',    vars:['nombre_candidato','dia','hora'], recipient:'manager'   },
    };
    const COLORS = { candidate:'#22c55e', manager:'#f97316', interviewer:'#a5b4fc' };
    const LABELS = { candidate:'📱 Candidato', manager:'👤 Manager', interviewer:'🎙 Entrevistador' };
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px;padding-top:4px;">
      <div style="background:rgba(234,179,8,.07);border:1px solid rgba(234,179,8,.25);border-radius:8px;padding:10px 14px;font-size:11px;color:#fde68a;line-height:1.6;">
        <strong>Estas plantillas se usan en la fase de entrevistas.</strong> Para activarlas entra a <strong>Meta Business Manager → Plantillas de mensajes</strong> y crea cada una con categoría <strong>UTILITY</strong>, idioma <strong>Español (es)</strong>.
      </div>
      ${Object.entries(IV_TEMPLATES).map(([key, tpl]) => {
        const color = COLORS[tpl.recipient] || '#94a3b8';
        const label = LABELS[tpl.recipient] || tpl.recipient;
        return `<div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);">
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:12px;font-weight:700;color:var(--text);">${esc(tpl.desc)}</span>
                <span style="font-size:10px;background:rgba(0,0,0,.2);color:${color};border-radius:10px;padding:2px 8px;">${label}</span>
              </div>
              <div style="font-size:10px;color:var(--text2);margin-top:2px;">Nombre en Meta: <code style="color:#c4b5fd;">${esc(tpl.name)}</code> · Variables: ${tpl.vars.map(v=>`{${v}}`).join(', ')}</div>
            </div>
            <button onclick="navigator.clipboard.writeText('${esc(tpl.name)}').then(()=>showToast('Nombre copiado ✓'))"
              style="flex-shrink:0;background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;color:var(--text2);cursor:pointer;font-size:10px;">📋 Copiar</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }
}

async function aiLoadEntrevistasPanel() {
  try {
    const [entData, ivData] = await Promise.all([
      fetch(`${SERVER_URL}/ai/config/entrevistas`).then(r=>r.json()),
      fetch(`${SERVER_URL}/interviews/config`).then(r=>r.json()).catch(()=>({config:{}})),
    ]);
    _aieConfig = entData.config || {};
    _ivConfig  = ivData.config  || {};
  } catch(e) { showToast('Error cargando config entrevistas: ' + e.message); }
  // Re-inject open sections
  ['config','general','qa','forbidden','cases','triggers','templates'].forEach(id => {
    const el = document.getElementById(`aie-section-${id}`);
    if (el && el.style.display !== 'none') { el.dataset.loaded = ''; _aieInjectSection(id); }
  });
}

async function _aieSave(partial, label) {
  try {
    if (!_aieConfig) { showToast('⚠️ Cargando configuración'); return; }
    const r = await fetch(`${SERVER_URL}/ai/config/entrevistas`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ config: partial }),
    });
    const d = await r.json();
    showToast(d.ok ? `✅ ${label} guardado` : `⚠️ ${label} activo solo en memoria`);
  } catch(e) { showToast(`❌ Error: ${e.message}`); }
}

async function aieSaveGeneral() {
  if (!_aieConfig) return;
  _aieConfig.general = document.getElementById('aie-general-ta')?.value || '';
  await _aieSave({ general: _aieConfig.general }, 'Instrucciones de entrevistas');
}
async function aieSaveForbidden() {
  if (!_aieConfig) return;
  _aieConfig.forbidden = document.getElementById('aie-forbidden-ta')?.value || '';
  await _aieSave({ forbidden: _aieConfig.forbidden }, 'Temas prohibidos');
}
async function aieSaveQA() {
  if (!_aieConfig) return;
  await _aieSave({ qa: _aieConfig.qa }, 'Preguntas frecuentes');
}
async function aieSaveCases() {
  if (!_aieConfig) return;
  await _aieSave({ cases: _aieConfig.cases }, 'Situaciones específicas');
}
async function aieSaveTriggers() {
  if (!_aieConfig) return;
  await _aieSave({ triggers: _aieConfig.triggers }, 'Disparadores de manager');
}

// ── QA, Cases, Triggers (mirror of ai* functions but for entrevistas) ─────────
function aieRenderQA(qa) {
  const el = document.getElementById('aie-qa-list'); if (!el) return;
  el.innerHTML = !qa.length ? `<div style="color:rgba(255,255,255,.2);font-size:12px;text-align:center;padding:16px;">Sin preguntas — haz clic en "+ Agregar"</div>`
  : qa.map((p,i) => `<div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px;position:relative;" id="aie-qa-${p.id}">
      <button onclick="aieDeleteQA('${p.id}')" style="position:absolute;top:10px;right:10px;background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px;">✕</button>
      <div style="font-size:10px;font-weight:700;color:#6ee7b7;text-transform:uppercase;margin-bottom:6px;">Pregunta ${i+1}</div>
      <input value="${esc(p.question)}" onchange="aieUpdateQA('${p.id}','question',this.value)" placeholder="¿Qué pregunta el candidato?" style="width:100%;background:#0d1a12;border:1px solid rgba(110,231,183,.25);border-radius:7px;color:#e2f3ea;font-size:12px;padding:8px 10px;outline:none;margin-bottom:8px;box-sizing:border-box;" />
      <textarea onchange="aieUpdateQA('${p.id}','answer',this.value)" placeholder="¿Qué debe responder Ana?" style="width:100%;height:80px;background:#0d1220;border:1px solid rgba(125,211,252,.25);border-radius:7px;color:#e2eeff;font-size:12px;padding:8px 10px;outline:none;resize:vertical;box-sizing:border-box;">${esc(p.answer)}</textarea>
    </div>`).join('');
}
function aieAddQA() {
  if (!_aieConfig) return;
  const n = { id: Date.now().toString(), question:'', answer:'' };
  _aieConfig.qa = [...(_aieConfig.qa||[]), n]; aieRenderQA(_aieConfig.qa);
  document.getElementById(`aie-qa-${n.id}`)?.scrollIntoView({behavior:'smooth'});
}
function aieDeleteQA(id) { if (!_aieConfig) return; _aieConfig.qa = (_aieConfig.qa||[]).filter(p=>p.id!==id); aieRenderQA(_aieConfig.qa); }
function aieUpdateQA(id,field,value) { const p=(_aieConfig?.qa||[]).find(p=>p.id===id); if(p) p[field]=value; }

function aieRenderCases(cases) {
  const el = document.getElementById('aie-cases-list'); if (!el) return;
  el.innerHTML = !cases.length ? `<div style="color:rgba(255,255,255,.2);font-size:12px;text-align:center;padding:16px;">Sin situaciones — haz clic en "+ Agregar"</div>`
  : cases.map((c,i) => `<div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px;position:relative;" id="aie-case-${c.id}">
      <button onclick="aieDeleteCase('${c.id}')" style="position:absolute;top:10px;right:10px;background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:2px 8px;cursor:pointer;font-size:12px;">✕</button>
      <div style="font-size:10px;font-weight:700;color:#fcd34d;text-transform:uppercase;margin-bottom:6px;">Situación ${i+1}</div>
      <input value="${esc(c.situation)}" onchange="aieUpdateCase('${c.id}','situation',this.value)" placeholder="En caso de que…" style="width:100%;background:#1a1500;border:1px solid rgba(252,211,77,.25);border-radius:7px;color:#fef9c3;font-size:12px;padding:8px 10px;outline:none;margin-bottom:8px;box-sizing:border-box;" />
      <textarea onchange="aieUpdateCase('${c.id}','response',this.value)" placeholder="¿Cómo debe reaccionar Ana?" style="width:100%;height:80px;background:#0d1220;border:1px solid rgba(125,211,252,.25);border-radius:7px;color:#e2eeff;font-size:12px;padding:8px 10px;outline:none;resize:vertical;box-sizing:border-box;">${esc(c.response)}</textarea>
    </div>`).join('');
}
function aieAddCase() {
  if (!_aieConfig) return;
  const n = { id:Date.now().toString(), situation:'', response:'' };
  _aieConfig.cases = [...(_aieConfig.cases||[]), n]; aieRenderCases(_aieConfig.cases);
  document.getElementById(`aie-case-${n.id}`)?.scrollIntoView({behavior:'smooth'});
}
function aieDeleteCase(id) { if (!_aieConfig) return; _aieConfig.cases=(_aieConfig.cases||[]).filter(c=>c.id!==id); aieRenderCases(_aieConfig.cases); }
function aieUpdateCase(id,field,value) { const c=(_aieConfig?.cases||[]).find(c=>c.id===id); if(c) c[field]=value; }

function aieRenderTriggers(triggers) {
  const el = document.getElementById('aie-triggers-list'); if (!el) return;
  el.innerHTML = !triggers.length ? `<div style="color:rgba(255,255,255,.2);font-size:12px;text-align:center;padding:16px;">Sin disparadores — haz clic en "+ Agregar"</div>`
  : triggers.map((t,i) => `<div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;align-items:flex-start;gap:10px;" id="aie-trigger-${t.id}">
      <span style="font-size:18px;flex-shrink:0;padding-top:2px;">${esc(t.icon||'🚨')}</span>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;gap:6px;">
          <input value="${esc(t.icon||'')}" onchange="aieUpdateTrigger('${t.id}','icon',this.value)" placeholder="🚨" style="width:42px;text-align:center;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 6px;color:var(--text);font-size:14px;outline:none;flex-shrink:0;" />
          <input value="${esc(t.title)}" onchange="aieUpdateTrigger('${t.id}','title',this.value)" placeholder="Nombre del disparador" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:5px 10px;color:var(--text);font-size:12px;font-weight:600;outline:none;" />
        </div>
        <textarea onchange="aieUpdateTrigger('${t.id}','description',this.value)" placeholder="Cuándo Ana debe activar este disparador…" style="width:100%;height:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text2);font-size:11px;outline:none;resize:vertical;box-sizing:border-box;line-height:1.5;">${esc(t.description)}</textarea>
      </div>
      <button onclick="aieDeleteTrigger('${t.id}')" style="flex-shrink:0;background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:12px;margin-top:2px;">✕</button>
    </div>`).join('');
}
function aieAddTrigger() {
  if (!_aieConfig) return;
  const id = 't'+Date.now();
  const n = {id, escKey:id, icon:'🚨', title:'', description:''};
  _aieConfig.triggers = [...(_aieConfig.triggers||[]), n]; aieRenderTriggers(_aieConfig.triggers);
  document.getElementById(`aie-trigger-${n.id}`)?.scrollIntoView({behavior:'smooth'});
}
function aieDeleteTrigger(id) { if (!_aieConfig) return; _aieConfig.triggers=(_aieConfig.triggers||[]).filter(t=>t.id!==id); aieRenderTriggers(_aieConfig.triggers); }
function aieUpdateTrigger(id,field,value) { const t=(_aieConfig?.triggers||[]).find(t=>t.id===id); if(t) t[field]=value; }

