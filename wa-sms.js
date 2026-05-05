//  WHATSAPP + SMS
// ════════════════════════════════════════════
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
  waRenderThread([...(lead.whatsapp||[]), ...(lead.metaWa||[])]);
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
  const pausando = !lead.ia_paused;
  if (pausando && !confirm(`¿Pausar la IA para ${lead.nombre || 'este lead'}?\n\nAna dejará de responder y podrás escribir manualmente.`)) return;
  lead.ia_paused = pausando;
  _waUpdateIABtn(lead.ia_paused);
  saveLeads(lead.id);
  showToast(lead.ia_paused ? '⏸ IA pausada — responderás tú manualmente' : '🤖 IA reactivada — Ana responderá ahora');
  try {
    await fetch(`${SERVER_URL}/ai/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: lead.telefono, paused: lead.ia_paused }),
    });
  } catch {}
}

function waRenderThread(messages) {
  const thread = document.getElementById('wa-thread');
  if (!messages || !messages.length) {
    thread.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,.25);font-size:12px;margin-top:40px">Sin mensajes aún</div>';
    return;
  }
  const sorted = [...messages].sort((a,b) => new Date(a.date||a.dateSent||0)-new Date(b.date||b.dateSent||0));
  thread.innerHTML = sorted.map(m => {
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

    // Route through Meta if this is a Meta WA lead (same number the candidate knows)
    const isMetaLead = (lead.metaWa?.length > 0) || lead.pipeline_id === 'postulados-whatsapp-meta';

    if (tplKey && WA_TEMPLATES[tplKey]) {
      // Templates always go through Twilio (Meta templates require different setup)
      const tpl  = WA_TEMPLATES[tplKey];
      const vars = {};
      tpl.vars.forEach((v,i) => {
        const el = document.getElementById(`wa-var-${i}`);
        vars[(i+1).toString()] = el ? el.value.trim() : '';
      });
      payload = { to: phone, contentSid: tpl.sid, contentVariables: vars, leadId: lead.id };
      displayBody = `[Plantilla: ${tplKey.replace(/_/g,' ')}] ${Object.values(vars).join(' · ')}`;
      const res  = await fetch(`${SERVER_URL}/twilio/whatsapp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error al enviar');
      if (!lead.whatsapp) lead.whatsapp = [];
      lead.whatsapp.push({ direction:'outbound', body: displayBody, date: new Date().toISOString(), autor: currentUser?.name||'Agente', sid: data.sid, status:'sent' });
    } else {
      // Free text — use Meta if this is a Meta lead, Twilio otherwise
      const body = inp.value.trim();
      if (!body) { btn.disabled=false; btn.style.opacity='1'; return; }
      displayBody = body;
      if (isMetaLead) {
        const res  = await fetch(`${SERVER_URL}/meta/wa-send`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, body, leadId: lead.id }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error al enviar');
        if (!lead.metaWa) lead.metaWa = [];
        lead.metaWa.push({ direction:'outbound', body, dateSent: new Date(data.ts||Date.now()).toISOString(), autor: currentUser?.name||'Agente', sid: `meta_${data.ts||Date.now()}`, ch:'wa' });
      } else {
        const res  = await fetch(`${SERVER_URL}/twilio/whatsapp`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, body, leadId: lead.id }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error al enviar');
        if (!lead.whatsapp) lead.whatsapp = [];
        lead.whatsapp.push({ direction:'outbound', body, date: new Date().toISOString(), autor: currentUser?.name||'Agente', sid: data.sid, status:'sent' });
      }
    }

    addHistorial(lead.id, `WhatsApp enviado: "${displayBody.slice(0,60)}${displayBody.length>60?'…':''}"`, '📱');
    saveLeads();
    // Reset
    inp.value = ''; inp.style.opacity = '1';
    sel.value = '';
    document.getElementById('wa-tpl-vars').style.display = 'none';
    document.getElementById('wa-tpl-vars').innerHTML = '';
    waRenderThread([...(lead.whatsapp||[]), ...(lead.metaWa||[])]);
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
    if (updated) { saveLeads(); waRenderThread([...(lead.whatsapp||[]), ...(lead.metaWa||[])]); }
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
