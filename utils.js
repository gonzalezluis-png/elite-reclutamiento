//  UTILS
// ════════════════════════════════════════════

function _leadHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (typeof _sessionToken !== 'undefined' && _sessionToken) h['x-session-token'] = _sessionToken;
  return h;
}

async function fsLoadLeads() {
  try {
    const res  = await fetch(`${SERVER_URL}/leads`, { headers: _leadHeaders() });
    const data = await res.json();
    return data.leads || [];
  } catch(e) { return []; }
}

async function dismissLlamada(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  lead.quiere_entrevista = false;
  addHistorial(leadId, 'Alerta de llamada revisada por el equipo', '📞');
  renderKanban();
  renderSidebar();
  try {
    await fetch(`${SERVER_URL}/leads/${leadId}`, {
      method: 'PATCH',
      headers: _leadHeaders(),
      body: JSON.stringify({ quiere_entrevista: false }),
    });
  } catch(e) {}
}

async function dismissSinManager(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  lead.sin_manager = false;
  addHistorial(leadId, 'Alerta sin manager atendida', '🚨');
  renderKanban();
  renderSidebar();
  try {
    await fetch(`${SERVER_URL}/leads/${leadId}`, {
      method: 'PATCH',
      headers: _leadHeaders(),
      body: JSON.stringify({ sin_manager: false }),
    });
  } catch(e) {}
}

async function dismissUnread(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  lead.unread_msg = false;
  renderKanban();
  renderSidebar();
  try {
    await fetch(`${SERVER_URL}/leads/${leadId}`, {
      method: 'PATCH',
      headers: _leadHeaders(),
      body: JSON.stringify({ unread_msg: false }),
    });
  } catch(e) {}
}

async function fsSaveLead(lead) {
  try {
    const { id, ...fields } = lead;
    const res = await fetch(`${SERVER_URL}/leads/${id}`, {
      method: 'PATCH',
      headers: _leadHeaders(),
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      console.warn('Lead save error:', res.status);
      showToast(`❌ Error al guardar (${res.status})`);
      return false;
    }
    return true;
  } catch(e) {
    console.warn('Lead save failed', e);
    showToast('❌ Error de red al guardar');
    return false;
  }
}

function fsSaveAll() {
  Promise.all(leads.map(lead => fsSaveLead(lead)));
}

async function fsDeleteLead(id) {
  try {
    await fetch(`${SERVER_URL}/leads/${id}`, { method: 'DELETE', headers: _leadHeaders() });
  } catch(e) {}
}

function addHistorial(leadId, accion, icono) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  if (!Array.isArray(lead.historial)) lead.historial = [];
  lead.historial.unshift({
    accion,
    icono: icono || '📋',
    fecha: new Date().toISOString(),
    usuario: currentUser?.name || 'Sistema'
  });
}

function renderHistorial(historial) {
  const el = document.getElementById('historial-list');
  if (!el) return;
  if (!historial || !historial.length) {
    el.innerHTML = '<div class="hist-empty">Sin actividad registrada</div>';
    return;
  }
  el.innerHTML = historial.map(h => {
    const fecha = new Date(h.fecha);
    const fechaStr = fecha.toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'});
    const horaStr  = fecha.toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'});
    return `<div class="hist-item">
      <div class="hist-dot" style="background:rgba(100,180,255,.12)">${h.icono||'📋'}</div>
      <div class="hist-body">
        <div class="hist-accion">${esc(h.accion)}</div>
        <div class="hist-meta">${fechaStr} · ${horaStr} &nbsp;·&nbsp; ${esc(h.usuario)}</div>
      </div>
    </div>`;
  }).join('');
}

let _lastSaveTs = 0;

function saveLeads(changedLeadId) {
  localStorage.setItem('er_leads', JSON.stringify(leads));
  _lastSaveTs = Date.now();
  if (changedLeadId) {
    const lead = leads.find(l => l.id === changedLeadId);
    if (lead) fsSaveLead(lead);
  } else {
    fsSaveAll();
  }
}

function toggleAccionMenu(event, leadId) {
  event.stopPropagation();
  document.querySelectorAll('.lt-accion-menu.open').forEach(m => { if (m.id !== 'accion-menu-'+leadId) m.classList.remove('open'); });
  document.getElementById('accion-menu-'+leadId)?.classList.toggle('open');
}
document.addEventListener('click', () => document.querySelectorAll('.lt-accion-menu.open').forEach(m => m.classList.remove('open')));

const MAILER_URL = 'https://script.google.com/macros/s/AKfycbzU2_ZaSRlfWI2g8EPESYXw4EqJwPPgMndXmFn-E_yA6_VHGtIiwz-3FXFGQK97lWLs/exec';

function copyWebinarLink(id, nombre, correo) {
  const url = `${location.origin}/webinar.html?id=${id}&nombre=${nombre}&correo=${correo}`;
  navigator.clipboard.writeText(url).then(() => showToast('📋 Link copiado al portapapeles'));
}

async function enviarLinkPorCorreo(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  if (!lead.correo) { showToast('⚠️ Este lead no tiene correo registrado'); return; }

  const link = `${location.origin}/webinar.html?id=${lead.id}&nombre=${encodeURIComponent(lead.nombre||'')}&correo=${encodeURIComponent(lead.correo||'')}`;
  showToast('📧 Enviando correo…');

  try {
    const params = new URLSearchParams({
      nombre: lead.nombre || 'Candidato',
      to_email: lead.correo,
      link,
    });
    await fetch(MAILER_URL + '?' + params.toString(), { mode: 'no-cors' });
    showToast('✅ Correo enviado a ' + lead.correo);
    addHistorial(leadId, `Link del webinar enviado por correo a ${lead.correo}`, '📧');
    lead.webinar_email_enviado = new Date().toISOString();
    saveLeads(lead.id);
  } catch(e) {
    showToast('❌ Error al enviar correo');
  }
}

function setWebinarAccion(leadId, accion) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  lead.webinar_accion = accion;
  if (accion === 'en-entrevista') {
    lead.etapa = 'En Entrevista';
    addHistorial(leadId, 'Entrevista agendada — marcado como EN ENTREVISTA', '🗓️');
  } else if (accion === 'asistente') {
    lead.etapa = 'AS - Asistente';
    lead.inscrito_webinar = true;
    addHistorial(leadId, 'Marcado como ASISTENTE al Webinar', '✅');
  } else if (accion === 'no-asistente') {
    lead.etapa = 'NA - No Asistente';
    lead.inscrito_webinar = true;
    addHistorial(leadId, 'Marcado como NO ASISTENTE al Webinar', '✗');
  } else if (accion === 'no-interesado') {
    lead.etapa = 'No Interesado';
    addHistorial(leadId, 'Marcado como NO INTERESADO', '👎');
  } else if (accion === 'no-califica') {
    lead.etapa = 'No Califica';
    addHistorial(leadId, 'Marcado como NO CALIFICA', '🚫');
  } else {
    lead.etapa = 'Inscrito en Webinar';
    lead.inscrito_webinar = false;
    addHistorial(leadId, 'Registro de Webinar restablecido a Sin Registro', '—');
  }
  saveLeads(leadId);
  renderKanban();
  renderSidebar();
}
// ════════════════════════════════════════════
//  RESIZABLE COLUMNS
// ════════════════════════════════════════════
let _colWidths = JSON.parse(localStorage.getItem('er_col_widths') || '{}');

function saveColWidths() {
  localStorage.setItem('er_col_widths', JSON.stringify(_colWidths));
}

function initResizableCols(tableKey) {
  const table = document.querySelector(`#table-view-wrap .leads-table`);
  if (!table) return;
  const ths = table.querySelectorAll('th');
  ths.forEach((th, i) => {
    const key = `${tableKey}:${i}`;
    // Apply saved width
    if (_colWidths[key]) th.style.width = _colWidths[key] + 'px';
    // Add resizer handle
    const resizer = document.createElement('div');
    resizer.className = 'col-resizer';
    th.appendChild(resizer);
    // Drag logic
    let startX, startW;
    resizer.addEventListener('mousedown', e => {
      e.preventDefault();
      startX = e.clientX;
      startW = th.offsetWidth;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      const onMove = ev => {
        const newW = Math.max(50, startW + ev.clientX - startX);
        th.style.width = newW + 'px';
        _colWidths[key] = newW;
      };
      const onUp = () => {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        saveColWidths();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Deduplicate messages by body+direction within a 30-second window.
// Handles stale localStorage data where the same message may be in both
// lead.whatsapp and lead.metaWa after the array-separation migration.
function dedupMsgs(msgs) {
  const seen = [];
  return msgs.filter(m => {
    const ts  = new Date(m.dateSent || m.date || 0).getTime();
    const dup = seen.find(s =>
      s.dir  === m.direction &&
      s.body === (m.body || '') &&
      Math.abs(s.ts - ts) < 30000
    );
    if (dup) return false;
    seen.push({ dir: m.direction, body: m.body || '', ts });
    return true;
  });
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});
}
// ════════════════════════════════════════════
//  UNDO SYSTEM
// ════════════════════════════════════════════
let _undoAction = null;
let _undoTimer  = null;

function pushUndo(type, data) {
  _undoAction = { type, data };
}

function undoLastAction() {
  if (!_undoAction) return;
  const { type, data } = _undoAction;
  _undoAction = null;
  if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
  document.getElementById('toast').classList.remove('show');

  if (type === 'lead_change') {
    const idx = leads.findIndex(l => l.id === data.id);
    if (idx >= 0) leads[idx] = JSON.parse(JSON.stringify(data));
    else leads.unshift(JSON.parse(JSON.stringify(data)));
    saveLeads(data.id);
  } else if (type === 'lead_delete') {
    leads.unshift(JSON.parse(JSON.stringify(data)));
    saveLeads();
  } else if (type === 'lead_create') {
    leads = leads.filter(l => l.id !== data);
    saveLeads();
  }
  renderKanban(); renderSidebar();
  showToast('↩️ Acción deshecha');
}

function showToast(msg, undoable = false) {
  const t = document.getElementById('toast');
  if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
  if (undoable) {
    t.innerHTML = `<span class="toast-msg">${msg}</span><button class="toast-undo-btn" onclick="undoLastAction()">Deshacer</button>`;
  } else {
    t.innerHTML = `<span class="toast-msg">${msg}</span>`;
  }
  t.classList.add('show');
  _undoTimer = setTimeout(() => {
    t.classList.remove('show');
    _undoTimer = null;
    if (!undoable) _undoAction = null;
  }, 4000);
}

// ── Notificaciones de nuevo lead ─────────────────────────────────────────────
function _playLeadSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[520, 0, 0.15], [780, 0.18, 0.15]].forEach(([freq, start, dur]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + start + 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });
  } catch(e) {}
}

function _notifyNewLead(lead) {
  _playLeadSound();
  if ('Notification' in window && Notification.permission === 'granted') {
    const nombre = lead.nombre && !lead.nombre.startsWith('WA ') && !lead.nombre.startsWith('+')
      ? lead.nombre : 'Nuevo candidato';
    const n = new Notification('📥 Nuevo lead — Elite CRM', {
      body:  `${nombre} · ${lead.fuente || 'WhatsApp'}`,
      icon:  '/favicon.ico',
      tag:   'new-lead-' + lead.id,
    });
    n.onclick = () => { window.focus(); openLead(lead.id); n.close(); };
    setTimeout(() => n.close(), 8000);
  }
  showToast(`📥 Nuevo lead: ${lead.nombre || lead.telefono || 'desconocido'}`);
}
