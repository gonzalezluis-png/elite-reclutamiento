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
  const sorted = dedupMsgs([...messages].sort((a,b) => new Date(a.date||a.dateSent||0)-new Date(b.date||b.dateSent||0)));
  thread.innerHTML = sorted.map(m => {
    const out  = m.direction === 'outbound';
    const time = m.date ? fmtDateTime(m.date) : '';
    const tick = out ? (m.status === 'read' ? '<span style="color:#4fc3f7">✓✓</span>' : m.status === 'delivered' ? '<span style="color:rgba(255,255,255,.5)">✓✓</span>' : '<span style="color:rgba(255,255,255,.35)">✓</span>') : '';
    return `<div class="${out?'sms-out-wrap':'sms-in-wrap'}">
      <div class="sms-bubble ${out?'wa-out':'wa-in'}">${esc(m.body)}</div>
      <div class="sms-meta">${time}${m.autor?' · '+esc(m.autor):''} ${tick}</div>
    </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

const WA_TEMPLATES = {}; // Templates Twilio removidos — usar Meta Cloud API

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

    // All WhatsApp sends go through Meta Cloud API
    const body = inp.value.trim();
    if (!body) { btn.disabled=false; btn.style.opacity='1'; return; }
    displayBody = body;
    const res  = await fetch(`${SERVER_URL}/meta/wa-send`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: phone, body, leadId: lead.id }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error al enviar');
    if (!lead.metaWa) lead.metaWa = [];
    lead.metaWa.push({ direction:'outbound', body, dateSent: new Date(data.ts||Date.now()).toISOString(), autor: currentUser?.name||'Agente', sid: `meta_${data.ts||Date.now()}`, ch:'wa' });

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
    const res  = await fetch(`${SERVER_URL}/meta/wa-inbox?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    if (!data.messages) return;
    if (!lead.metaWa) lead.metaWa = [];
    let updated = false;
    for (const msg of data.messages) {
      const ex = lead.metaWa.find(s => s.sid === msg.sid);
      if (!ex) {
        lead.metaWa.push({...msg, ch:'wa'});
        if (msg.direction === 'inbound')
          addHistorial(lead.id, `WhatsApp recibido: "${(msg.body||'').slice(0,50)}"`, '📩');
        updated = true;
      } else if (msg.status && ex.status !== msg.status) {
        ex.status = msg.status; ex.error_code = msg.error_code; updated = true;
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
