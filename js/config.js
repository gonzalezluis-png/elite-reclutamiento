// ════════════════════════════════════════════
//  PIPELINES
// ════════════════════════════════════════════
function makePostuladosTabs() {
  return [
    { id:'all', nombre:'Todos', sidebar:false,
      etapas:[
        {v:'New Lead',                  l:'New Lead'},
        {v:'1er intento de contacto',   l:'1er intento de contacto'},
        {v:'2do intento de contacto',   l:'2do intento de contacto'},
        {v:'3er intento de contacto',   l:'3er intento de contacto'},
      ]},
    { id:'1er', nombre:'1er intento de contacto', sidebar:true,
      etapas:[{v:'1er intento de contacto', l:'1er intento de contacto'}] },
    { id:'2do', nombre:'2do intento de contacto', sidebar:true,
      etapas:[{v:'2do intento de contacto', l:'2do intento de contacto'}] },
    { id:'3er', nombre:'3er intento de contacto', sidebar:true,
      etapas:[{v:'3er intento de contacto', l:'3er intento de contacto'}] },
  ];
}

const PIPELINES = [
  { id:'postulados-meta', nombre:'POSTULADOS POR META', icon:'📌', visible:true,
    tabs: makePostuladosTabs(),
    etapas:['New Lead','1er intento de contacto','2do intento de contacto','3er intento de contacto'] },
  { id:'postulados-indeed', nombre:'POSTULADOS POR INDEED', icon:'📋', visible:true,
    tabs: makePostuladosTabs(),
    etapas:['New Lead','1er intento de contacto','2do intento de contacto','3er intento de contacto'] },
  { id:'postulados-whatsapp-meta', nombre:'POSTULADOS POR WHATSAPP-META', icon:'💬', visible:true,
    tabs: makePostuladosTabs(),
    etapas:['New Lead','1er intento de contacto','2do intento de contacto','3er intento de contacto'] },
  { id:'en-webinar', nombre:'EN WEBINAR', icon:'🎥', visible:true,
    tabs: [
      { id:'inscrito', nombre:'Inscrito en Webinar', sidebar:false, tableView:true,
        etapas:[{v:'Inscrito en Webinar', l:'Inscrito en Webinar'}] },
      { id:'no-asistente', nombre:'No Asistente', sidebar:true, tableView:true,
        etapas:[
          {v:'NA - No Asistente',            l:'No Asistente'},
          {v:'NA - 1er intento de contacto', l:'1er intento de contacto'},
          {v:'NA - 2do intento de contacto', l:'2do intento de contacto'},
          {v:'NA - 3er intento de contacto', l:'3er intento de contacto'},
          {v:'NA - Reinscrito en Webinar',   l:'Reinscrito en Webinar'},
          {v:'NA - No contactado',           l:'No contactado'},
          {v:'NA - No interesado',           l:'No interesado'},
          {v:'NA - No Califica',             l:'No Califica'},
          {v:'NA - Para Entrevista',         l:'Para Entrevista'},
        ],
        subTabs: true,
        subTabVisible: ['NA - No Asistente','NA - 1er intento de contacto','NA - 2do intento de contacto','NA - 3er intento de contacto','NA - Reinscrito en Webinar'] },
      { id:'asistente', nombre:'Asistente', sidebar:true, tableView:true,
        etapas:[
          {v:'AS - Asistente',               l:'Asistente'},
          {v:'AS - 1er intento de contacto', l:'1er intento de contacto'},
          {v:'AS - 2do intento de contacto', l:'2do intento de contacto'},
          {v:'AS - 3er intento de contacto', l:'3er intento de contacto'},
          {v:'AS - No contactado',           l:'No contactado'},
          {v:'AS - No interesado',           l:'No interesado'},
          {v:'AS - No Califica',             l:'No Califica'},
          {v:'AS - Para Entrevista',         l:'Para Entrevista'},
        ],
        subTabs: true,
        subTabVisible: ['AS - Asistente','AS - 1er intento de contacto','AS - 2do intento de contacto','AS - 3er intento de contacto'] },
    ],
    etapas:['Inscrito en Webinar','NA - No Asistente','NA - 1er intento de contacto','NA - 2do intento de contacto','NA - 3er intento de contacto','NA - Reinscrito en Webinar','NA - No contactado','NA - No interesado','NA - No Califica','NA - Para Entrevista','AS - Asistente','AS - 1er intento de contacto','AS - 2do intento de contacto','AS - 3er intento de contacto','AS - No contactado','AS - No interesado','AS - No Califica','AS - Para Entrevista'] },
  { id:'entrevistas-generales', nombre:'ENTREVISTAS GENERALES', icon:'🤝', visible:true,
    etapas:['EN ENTREVISTA','NO SHOW','ENVIAR a Caritza Rojas','ENVIAR a Maria Lugo','ENVIAR a Bryan Palacios','Contratados Personales'] },
  { id:'maria-lugo', nombre:'ENTREVISTA: MARIA LUGO', icon:'👤', visible:false,
    etapas:['ENTREVISTADO','REAGENDADA','PENDING PAYMENT','CONTRATADO','NO INTERESADO - NO CALIFICA'] },
  { id:'brayan-alexander', nombre:'ENTREVISTA: BRAYAN & ALEXANDER', icon:'👤', visible:false,
    etapas:['ENTREVISTADO','REAGENDADA','PENDING PAYMENT','CONTRATADO','NO INTERESADO - NO CALIFICA'] },
  { id:'caritza-rojas', nombre:'ENTREVISTA: CARITZA ROJAS', icon:'👤', visible:false,
    etapas:['ENTREVISTADOS','REAGENDADA','PENDING PAYMENT','CONTRATADO','NO INTERESADO - NO CALIFICA'] },
  { id:'eliminados', nombre:'ELIMINADOS', icon:'🗑️', visible:true,
    etapas:['APLICANTE - NO CONTACTADO','APLICANTE - NO INTERESADO - NO CALIFICA','WEBINAR - NO CONTACTADO','WEBINAR - NO INTERESADO','ENTREVISTA - NO CONTACTADO','ENTREVISTA - NO INTERESADO'] },
  { id:'no-contactados', nombre:'NO CONTACTADOS', icon:'📵', visible:true,
    etapas:['Sin respuesta - 1er intento','Sin respuesta - 2do intento','Sin respuesta - 3er intento','Número incorrecto','Fuera de servicio'] },
  { id:'no-interesados-no-califica', nombre:'NO INTERESADOS / NO CALIFICA', icon:'🚫', visible:true,
    etapas:['No interesado','No califica - Sin documentos','No califica - Menor de edad','No califica - No habla Español','No califica - Otros'] },
];

// Stage color hints
function stageColor(etapa) {
  const e = etapa.toLowerCase();
  if (e.includes('new lead') || e.includes('inscrito')) return '#0073ea';
  if (e.includes('1er') || e.includes('2do') || e.includes('3er')) return '#fdab3d';
  if (e.includes('webinar') || e.includes('webianr')) return '#784bd1';
  if (e.includes('no contactado') || e.includes('no asistente') || e.includes('no show')) return '#676a82';
  if (e.includes('no interesado') || e.includes('no califica') || e.includes('eliminar')) return '#e2445c';
  if (e.includes('asistente')) return '#00bcd4';
  if (e.includes('para entrevista')) return '#00c875';
  if (e.includes('entrevistado') || e.includes('en entrevista') || e.includes('enviar')) return '#fdab3d';
  if (e.includes('contratado') || e.includes('ganado')) return '#00c875';
  if (e.includes('pending payment')) return '#ff9800';
  if (e.includes('reagendada')) return '#9c27b0';
  return '#676a82';
}


const SERVER_URL = localStorage.getItem('er_server_url') || 'https://elite-reclutamiento-production.up.railway.app';

const WEBINAR_PROGRESSIONS = {
  'NA - No Asistente':            'NA - 1er intento de contacto',
  'NA - 1er intento de contacto': 'NA - 2do intento de contacto',
  'NA - 2do intento de contacto': 'NA - 3er intento de contacto',
  'NA - 3er intento de contacto': null,
  'AS - Asistente':               'AS - 1er intento de contacto',
  'AS - 1er intento de contacto': 'AS - 2do intento de contacto',
  'AS - 2do intento de contacto': 'AS - 3er intento de contacto',
  'AS - 3er intento de contacto': null,
};

const USERS = JSON.parse(localStorage.getItem('er_users') || JSON.stringify([
  { email:'admin@elitereclutamiento.com', password:'admin123', name:'Admin', role:'Administrador' },
  { email:'luis@grupoelitework.com', password:'elite2026', name:'Luis González', role:'Administrador' },
]));

// Load some sample data if empty or seed version changed
const SEED_VERSION = '4';
const _d = daysAgo => { const dt = new Date(); dt.setDate(dt.getDate()-daysAgo); return dt.toISOString(); };

// ════════════════════════════════════════════
//  CONFIGURACIONES
// ════════════════════════════════════════════
function showConfig() {
  activeView = 'config';
  document.getElementById('board-title').textContent = 'Configuraciones';
  document.getElementById('kanban-wrap').style.display = 'none';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('calendar-view').classList.remove('active');
  document.getElementById('pipeline-tabs').innerHTML = '';
  document.getElementById('pipeline-subtabs').innerHTML = '';
  document.getElementById('search-input').style.display = 'none';
  document.getElementById('config-view').style.display = 'flex';
  document.getElementById('config-view').style.flexDirection = 'column';
  document.getElementById('sidebar-config-btn').classList.add('active');
  renderSidebar();
  renderConfig();
  // Load managers async after DOM is ready
  Promise.all([
    fetch(`${SERVER_URL}/ai/managers`).then(r=>r.json()).catch(()=>({managers:[],interviewer:null})),
  ]).then(([ms]) => {
    cfgRenderManagers(ms.managers || [], ms.interviewer || null);
  });
}

function renderConfig() {
  const u = currentUser || {};
  const initials = (u.name || 'U').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);

  const OTROS_IDS = ['no-contactados','no-interesados-no-califica','eliminados'];
  const ENTREVISTAS_IDS = ['caritza-rojas','maria-lugo','brayan-alexander'];
  const boardIds = [...OTROS_IDS, ...ENTREVISTAS_IDS];

  let boardsHtml = boardIds.map(id => {
    const p = PIPELINES.find(x => x.id === id);
    if (!p) return '';
    const count = leads.filter(l => l.pipeline_id === p.id).length;
    return `<div class="cfg-board-card" onclick="selectPipeline('${p.id}')">
      <span class="cb-icon">${p.icon}</span>
      <div class="cb-info">
        <div class="cb-name">${p.nombre}</div>
        <div class="cb-count">${count} leads</div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('config-view').innerHTML = `
    <div style="max-width:780px;width:100%;">

      <!-- PERFIL -->
      <div class="cfg-section">
        <div class="cfg-section-title">👤 Mi Perfil</div>
        <div class="cfg-profile-row">
          <div class="cfg-avatar">${initials}</div>
          <div class="cfg-profile-info">
            <div class="cfg-profile-name">${u.name || '—'}</div>
            <div class="cfg-profile-email">${u.email || '—'}</div>
            <span class="cfg-profile-role">${u.role || '—'}</span>
          </div>
        </div>
        <div class="cfg-field-grid">
          <div class="cfg-field">
            <label>Nombre completo</label>
            <input id="cfg-name" value="${u.name || ''}" placeholder="Tu nombre" />
          </div>
          <div class="cfg-field">
            <label>Correo electrónico</label>
            <input id="cfg-email" value="${u.email || ''}" placeholder="correo@empresa.com" type="email" />
          </div>
          <div class="cfg-field">
            <label>Rol</label>
            <select id="cfg-role">
              <option ${u.role==='Administrador'?'selected':''}>Administrador</option>
              <option ${u.role==='Reclutador'?'selected':''}>Reclutador</option>
              <option ${u.role==='Supervisor'?'selected':''}>Supervisor</option>
            </select>
          </div>
          <div class="cfg-field">
            <label>Nueva contraseña</label>
            <input id="cfg-pass" type="password" placeholder="Dejar vacío para no cambiar" />
          </div>
        </div>
        <button class="cfg-save-btn" onclick="saveConfigProfile()">Guardar cambios</button>
      </div>

      <!-- FORMULARIO DE REGISTRO WEBINAR -->
      <div class="cfg-section">
        <div class="cfg-section-title">📝 Formulario de Registro Webinar</div>
        <p style="font-size:13px;color:var(--text3);margin-bottom:14px;line-height:1.6;">
          Comparte este enlace con candidatos o terceros para que se registren al webinar. Al completar el formulario quedan inscritos automáticamente en el CRM.
        </p>
        <div style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;">
          <span id="reg-url-text" style="font-size:13px;color:var(--accent);flex:1;word-break:break-all;">https://crm.grupoelitework.com/registro.html</span>
          <button onclick="copyRegUrl()" style="background:rgba(79,127,255,.15);border:1px solid rgba(79,127,255,.3);color:var(--accent);border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:var(--font);">Copiar</button>
        </div>
        <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="/registro.html" target="_blank" rel="noopener" style="font-size:12px;color:var(--green);text-decoration:none;">↗ Abrir formulario</a>
          <a href="/webinar.html" target="_blank" rel="noopener" style="font-size:12px;color:var(--text3);text-decoration:none;">↗ Abrir webinar</a>
        </div>
      </div>

      <!-- SERVIDOR WEBINAR (BACKEND) -->
      <!-- BOARDS ADICIONALES -->
      <div class="cfg-section">
        <div class="cfg-section-title">📂 Boards Adicionales</div>
        <div class="cfg-board-grid">${boardsHtml}</div>
      </div>

      <!-- EQUIPO DE ESCALADA -->
      <div class="cfg-section">
        <div class="cfg-section-title">👥 Equipo de escalada</div>
        <p style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.6;">
          Encargados que reciben alertas de Ana por WhatsApp en cadena. Responde <strong>SI</strong> u <strong>OK</strong> para tomar el caso · <strong>SIGUIENTE</strong> para pasar al próximo.
        </p>
        <div id="cfg-managers-list" style="display:flex;flex-direction:column;gap:10px;">
          <div style="color:var(--text3);font-size:12px;">Cargando…</div>
        </div>
        <div id="cfg-interviewer-card" style="margin-top:10px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
          <span style="font-size:10px;color:var(--text3);">🔒 Haz clic en Editar para modificar los datos de cada encargado.</span>
          <button class="cfg-save-btn" onclick="cfgSaveManagers()" id="cfg-managers-save-btn" style="display:none;padding:7px 18px;">💾 Guardar encargados</button>
        </div>
      </div>

    </div>`;
}

function saveConfigProfile() {
  const name  = document.getElementById('cfg-name').value.trim();
  const email = document.getElementById('cfg-email').value.trim();
  const role  = document.getElementById('cfg-role').value;
  const pass  = document.getElementById('cfg-pass').value;
  if (!name || !email) { showToast('⚠️ Nombre y correo son requeridos'); return; }
  currentUser.name  = name;
  currentUser.email = email;
  currentUser.role  = role;
  if (pass) currentUser.password = pass;
  const idx = USERS.findIndex(u => u.email === email);
  if (idx >= 0) USERS[idx] = { ...USERS[idx], ...currentUser };
  localStorage.setItem('er_users', JSON.stringify(USERS));
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-role').textContent = role;
  document.getElementById('user-avatar').textContent = name[0];
  showToast('✅ Perfil actualizado');
  renderConfig();
}



// ════════════════════════════════════════════
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

