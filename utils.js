//  UTILS
// ════════════════════════════════════════════
// ════════════════════════════════════════════
//  FIRESTORE
// ════════════════════════════════════════════
const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

function toFsVal(v) {
  if (v === null || v === undefined) return {nullValue: null};
  if (typeof v === 'boolean')  return {booleanValue: v};
  if (typeof v === 'number')   return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  if (typeof v === 'string')   return {stringValue: v};
  if (Array.isArray(v))        return {arrayValue: {values: v.map(toFsVal)}};
  if (typeof v === 'object')   return {mapValue: {fields: Object.fromEntries(Object.entries(v).map(([k,x]) => [k, toFsVal(x)]))}};
  return {stringValue: String(v)};
}
function fromFsVal(fv) {
  if (!fv) return null;
  if ('nullValue'      in fv) return null;
  if ('booleanValue'   in fv) return fv.booleanValue;
  if ('integerValue'   in fv) return parseInt(fv.integerValue);
  if ('doubleValue'    in fv) return fv.doubleValue;
  if ('stringValue'    in fv) return fv.stringValue;
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('arrayValue'     in fv) return (fv.arrayValue.values || []).map(fromFsVal);
  if ('mapValue'       in fv) return Object.fromEntries(Object.entries(fv.mapValue.fields || {}).map(([k,v]) => [k, fromFsVal(v)]));
  return null;
}
function toFsDoc(obj) {
  const {id, ...fields} = obj;
  return {fields: Object.fromEntries(Object.entries(fields).map(([k,v]) => [k, toFsVal(v)]))};
}
function fromFsDoc(doc) {
  const obj = Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v]) => [k, fromFsVal(v)]));
  obj.id = doc.name.split('/').pop();
  return obj;
}

async function fsLoadLeads() {
  try {
    const res  = await fetch(`${FS_BASE}/leads?key=${FS_KEY}&pageSize=500`);
    const data = await res.json();
    return (data.documents || []).map(fromFsDoc);
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
    const fields = { quiere_entrevista: { booleanValue: false } };
    await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}&updateMask.fieldPaths=quiere_entrevista`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
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
    const fields = { sin_manager: { booleanValue: false } };
    await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}&updateMask.fieldPaths=sin_manager`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
  } catch(e) {}
}

async function fsSaveLead(lead) {
  try {
    const doc = toFsDoc(lead);
    const res = await fetch(`${FS_BASE}/leads/${lead.id}?key=${FS_KEY}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(doc)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Firestore save error:', res.status, err);
      showToast(`❌ Error al guardar en Firestore (${res.status})`);
      return false;
    }
    return true;
  } catch(e) {
    console.warn('Firestore save failed', e);
    showToast('❌ Error de red al guardar');
    return false;
  }
}

function fsSaveAll() {
  Promise.all(leads.map(lead => fsSaveLead(lead)));
}

async function fsDeleteLead(id) {
  try {
    await fetch(`${FS_BASE}/leads/${id}?key=${FS_KEY}`, {method: 'DELETE'});
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
  if (accion === 'asistente') {
    lead.etapa = 'AS - Asistente';
    lead.inscrito_webinar = true;
    addHistorial(leadId, 'Marcado como ASISTENTE al Webinar', '✅');
  } else if (accion === 'no-asistente') {
    lead.etapa = 'NA - No Asistente';
    lead.inscrito_webinar = true;
    addHistorial(leadId, 'Marcado como NO ASISTENTE al Webinar', '✗');
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

// ── AUTO INIT (sin login) ──
document.getElementById('login-page').classList.add('hidden');
document.getElementById('app').style.display = 'flex';
document.getElementById('user-name').textContent = currentUser.name;
document.getElementById('user-role').textContent = currentUser.role;
document.getElementById('user-avatar').textContent = currentUser.name[0];
populatePipelineSelects();
renderSidebar();
const _savedPipeline = localStorage.getItem('er_active_pipeline') || 'postulados-meta';
const _savedTab      = localStorage.getItem('er_active_tab');
if (_savedTab) setPipeTab(_savedPipeline, _savedTab);
selectPipeline(_savedPipeline);

function autoMoverVistos() {
  let changed = false;
  const ahora = Date.now();
  leads.forEach(ld => {
    if (ld.pipeline_id === 'en-webinar' && ld.etapa === 'Inscrito en Webinar') {
      const pct = ld.webinar_visto_pct != null ? Number(ld.webinar_visto_pct) : null;
      if (pct !== null && pct > 0) {
        // Vio aunque sea 1% → Asistente
        ld.etapa = 'AS - Asistente';
        addHistorial(ld.id, `Movido a Asistente automáticamente (${pct}% del webinar visto)`, '✅');
        fsSaveLead(ld);
        changed = true;
      } else {
        // Sin datos de visualización → revisar 24h
        const inscrito = ld.fecha_inscripcion_webinar ? new Date(ld.fecha_inscripcion_webinar).getTime() : null;
        if (inscrito && (ahora - inscrito) >= 24 * 60 * 60 * 1000) {
          ld.etapa = 'NA - No Asistente';
          addHistorial(ld.id, 'Movido a No Asistente automáticamente (24h sin ver el webinar)', '⏰');
          fsSaveLead(ld);
          changed = true;
        }
      }
    }
  });
  if (changed) { renderKanban(); renderSidebar(); }
}

// Cargar desde Firestore
(async () => {
  try {
    const fsLeads = await fsLoadLeads();
    if (fsLeads.length > 0) {
      leads = fsLeads;
      localStorage.setItem('er_leads', JSON.stringify(leads));
      autoMoverVistos();
      renderSidebar();
      renderKanban();
      showToast(`☁️ ${fsLeads.length} leads cargados desde Firestore`);
    } else {
      // Firestore vacío → subir seed
      await fsSaveAll();
      showToast('☁️ Datos sincronizados con Firestore');
    }
  } catch(e) {
    console.error('Firestore error:', e);
    showToast('⚠️ Sin conexión a Firestore — usando datos locales');
  }
})();

// Sync automático para detectar nuevas visualizaciones
setInterval(async () => {
  if (Date.now() - _lastSaveTs < 10000) return; // skip if a save just happened
  try {
    const fsLeads = await fsLoadLeads();
    if (fsLeads.length > 0) {
      leads = fsLeads;
      localStorage.setItem('er_leads', JSON.stringify(leads));
      autoMoverVistos();
      renderSidebar();
      renderKanban();
    }
  } catch(e) {}
}, 15 * 1000);

// Close modals on overlay click
document.getElementById('lead-modal').addEventListener('click', e => { if(e.target===document.getElementById('lead-modal')) closeLead(); });
document.getElementById('new-modal').addEventListener('click', e => { if(e.target===document.getElementById('new-modal')) closeNewLead(); });

// ════════════════════════════════════════════
