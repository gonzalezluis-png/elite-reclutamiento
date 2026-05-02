let currentUser = { name:'Luis González', role:'Administrador' };
let activePipelineId = 'postulados-meta';
const webinarLink = 'https://crm.grupoelitework.com/webinar.html';
let activeView = 'kanban'; // 'kanban' | 'calendario'
if (new URLSearchParams(location.search).get('reset') === 'leads') {
  localStorage.removeItem('er_leads');
  location.replace(location.pathname);
}
let leads = JSON.parse(localStorage.getItem('er_leads') || '[]');
let currentLeadId = null;
let currentTags = [];
let dragLeadId = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let pipeTabState = {};
function getPipelineTabs(pipe) {
  if (pipe.tabs) return pipe.tabs;
  const allTab = { id:'all', nombre:'Todos', sidebar:false, etapas: pipe.etapas.map(e => ({v:e, l:e})) };
  const stageTabs = pipe.etapas.map((e, i) => ({ id:'s'+i, nombre:e, sidebar:false, etapas:[{v:e, l:e}] }));
  return [allTab, ...stageTabs];
}
function getPipeTab(pipeId) {
  const pipe = PIPELINES.find(p => p.id === pipeId);
  const tabs = pipe ? getPipelineTabs(pipe) : null;
  if (!tabs) return null;
  return pipeTabState[pipeId] || tabs[0].id;
}
function setPipeTab(pipeId, tabId) { pipeTabState[pipeId] = tabId; }

let subTabState = {};
function getSubTab(pipeId, tabId) { return subTabState[`${pipeId}:${tabId}`] || 'all'; }
function setSubTab(pipeId, tabId, subId) { subTabState[`${pipeId}:${tabId}`] = subId; }
function selectSubTab(pipeId, tabId, subId) { setSubTab(pipeId, tabId, subId); renderKanban(); }


// ════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════
function doLogin() {
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  const user = USERS.find(u => u.email === email && u.password === pass);
  if (user) {
    currentUser = user;
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
    document.getElementById('user-name').textContent = user.name;
    document.getElementById('user-role').textContent = user.role;
    document.getElementById('user-avatar').textContent = user.name[0];
    renderSidebar();
    const _lp = localStorage.getItem('er_active_pipeline') || 'postulados-meta';
    const _lt = localStorage.getItem('er_active_tab');
    if (_lt) setPipeTab(_lp, _lt);
    selectPipeline(_lp);
    populatePipelineSelects();
  } else {
    errEl.textContent = 'Correo o contraseña incorrectos.';
  }
}
async function resetAllLeads() {
  if (!confirm('¿Seguro que quieres borrar TODOS los leads? Esta acción no se puede deshacer.')) return;
  const toDelete = [...leads];
  leads = [];
  localStorage.setItem('er_leads', '[]');
  localStorage.setItem('er_seed_v', SEED_VERSION);
  renderKanban();
  renderSidebar();
  await Promise.all(toDelete.map(l => fsDeleteLead(l.id)));
  alert('Todos los leads han sido eliminados.');
}

function doLogout() {
  currentUser = null;
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('app').style.display = 'none';
}
document.getElementById('li-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('li-email').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

// ════════════════════════════════════════════
//  SIDEBAR
// ════════════════════════════════════════════
function renderSidebar() {
  const q = (document.getElementById('pipe-search').value || '').toLowerCase();
  const isAdmin = currentUser?.role === 'Administrador';
  const el = document.getElementById('pipe-list');

  const GROUPS = [
    {
      label: '📌 Postulados',
      ids: ['postulados-meta','postulados-indeed','postulados-whatsapp-meta']
    },
    {
      label: '🎥 Webinar',
      ids: ['en-webinar'],
      webinar: true,
      extra: `<div class="pipe-item pipe-item-cal ${activeView==='calendario'?'active':''}" onclick="selectCalendario()">
        <span class="pipe-icon">📅</span>
        <span class="pipe-name">Calendario Entrevistas</span>
      </div>`
    },
    {
      label: '🤝 Entrevistas',
      ids: ['entrevistas-generales']
    }
  ];

  const _grpCollapsed = JSON.parse(localStorage.getItem('er_grp_collapsed') || '{}');

  let html = '';
  for (const group of GROUPS) {
    const grpKey = group.label.replace(/\s+/g,'_');
    const collapsed = !!_grpCollapsed[grpKey];
    const pipes = group.ids
      .map(id => PIPELINES.find(p => p.id === id))
      .filter(p => p && (p.visible || isAdmin) && p.nombre.toLowerCase().includes(q));
    if (!pipes.length) continue;

    const arrow = collapsed ? '▸' : '▾';
    html += `<div class="sidebar-section-hdr" onclick="toggleSidebarGroup('${grpKey}',this)">${group.label}<span class="grp-arrow">${arrow}</span></div>`;
    html += `<div class="sidebar-group-body${collapsed ? ' collapsed' : ''}">`;
    for (const p of pipes) {
      const count = leads.filter(l => l.pipeline_id === p.id).length;
      const active = activePipelineId === p.id && activeView === 'kanban' ? 'active' : '';
      const webinarCls = group.webinar ? 'pipe-item-webinar' : '';
      html += `<div class="pipe-item ${webinarCls} ${active}" onclick="selectPipeline('${p.id}')">
        <span class="pipe-icon">${p.icon}</span>
        <span class="pipe-name">${p.nombre}</span>
        <span class="pipe-count">${count}</span>
      </div>`;
      if (p.tabs) {
        for (const tab of p.tabs) {
          if (tab.sidebar === false) continue;
          const tabCount = leads.filter(l => l.pipeline_id === p.id && tab.etapas.some(e => e.v === l.etapa)).length;
          const tabActive = activePipelineId === p.id && activeView === 'kanban' && getPipeTab(p.id) === tab.id ? 'active' : '';
          html += `<div class="pipe-subtab ${tabActive}" onclick="selectPipelineTab('${p.id}','${tab.id}')">
            <span class="pipe-subtab-dot"></span>
            <span style="flex:1">${tab.nombre}</span>
            <span class="pipe-count" style="font-size:10px">${tabCount}</span>
          </div>`;
        }
      }
    }
    if (group.extra) html += group.extra;
    html += `</div>`;
  }
  el.innerHTML = html;
  const cfgBtn = document.getElementById('sidebar-config-btn');
  if (cfgBtn) { cfgBtn.classList.toggle('active', activeView === 'config'); }
  const wLink = document.getElementById('sidebar-webinar-link');
  if (wLink) wLink.href = webinarLink;
}

function toggleSidebarGroup(key, hdr) {
  const body = hdr.nextElementSibling;
  const _grpCollapsed = JSON.parse(localStorage.getItem('er_grp_collapsed') || '{}');
  const nowCollapsed = !body.classList.contains('collapsed');
  body.classList.toggle('collapsed', nowCollapsed);
  _grpCollapsed[key] = nowCollapsed;
  localStorage.setItem('er_grp_collapsed', JSON.stringify(_grpCollapsed));
  const arrow = hdr.querySelector('.grp-arrow');
  if (arrow) arrow.textContent = nowCollapsed ? '▸' : '▾';
}

function selectPipeline(id) {
  activePipelineId = id;
  activeView = 'kanban';
  const pipe = PIPELINES.find(p => p.id === id);
  if (pipe && !pipeTabState[id]) setPipeTab(id, getPipelineTabs(pipe)[0].id);
  document.getElementById('board-title').textContent = pipe?.nombre || id;
  document.getElementById('kanban-wrap').style.display = '';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('calendar-view').classList.remove('active');
  document.getElementById('config-view').style.display = 'none';
  document.getElementById('search-input').style.display = '';
  localStorage.setItem('er_active_pipeline', id);
  localStorage.setItem('er_active_tab', getPipeTab(id));
  renderSidebar();
  renderKanban();
}

function selectWebinarTab(tabId) {
  setPipeTab(activePipelineId, tabId);
  localStorage.setItem('er_active_tab', tabId);
  renderSidebar();
  renderKanban();
}

function selectPipelineTab(pipeId, tabId) {
  activePipelineId = pipeId;
  setPipeTab(pipeId, tabId);
  activeView = 'kanban';
  const pipe = PIPELINES.find(p => p.id === pipeId);
  document.getElementById('board-title').textContent = pipe?.nombre || pipeId;
  document.getElementById('kanban-wrap').style.display = '';
  document.getElementById('table-view-wrap').classList.remove('active');
  document.getElementById('calendar-view').classList.remove('active');
  document.getElementById('config-view').style.display = 'none';
  document.getElementById('search-input').style.display = '';
  localStorage.setItem('er_active_pipeline', pipeId);
  localStorage.setItem('er_active_tab', tabId);
  renderSidebar();
  renderKanban();
}

function selectCalendario() {
  activeView = 'calendario';
  document.getElementById('board-title').textContent = 'Calendario de Entrevistas';
  document.getElementById('kanban-wrap').style.display = 'none';
  document.getElementById('calendar-view').classList.add('active');
  document.getElementById('config-view').style.display = 'none';
  document.getElementById('search-input').style.display = '';
  renderSidebar();
  renderCalendario();
}

function calNavMonth(dir) { calMonth += dir; if (calMonth > 11) { calMonth=0; calYear++; } if (calMonth < 0) { calMonth=11; calYear--; } renderCalendario(); }


// ── INDICADOR ONLINE/OFFLINE ──
function updateOnlineStatus() {
  const ind  = document.getElementById('online-indicator');
  const dot  = document.getElementById('online-dot');
  const text = document.getElementById('online-text');
  if (!ind) return;
  if (navigator.onLine) {
    ind.style.background = 'rgba(0,200,117,.12)';
    ind.style.color      = '#00c875';
    ind.style.borderColor= 'rgba(0,200,117,.25)';
    dot.style.background = '#00c875';
    text.textContent     = 'En línea';
  } else {
    ind.style.background = 'rgba(226,68,92,.12)';
    ind.style.color      = '#e2445c';
    ind.style.borderColor= 'rgba(226,68,92,.25)';
    dot.style.background = '#e2445c';
    text.textContent     = 'Sin conexión';
  }
}
window.addEventListener('online',  updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// Cerrar menú al hacer click fuera
document.addEventListener('click', e => {
  const menu = document.getElementById('global-move-menu');
  if (menu && !menu.contains(e.target)) closeAllMenus();
});
// Cerrar modal No califica al click en overlay
document.getElementById('no-califica-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('no-califica-overlay')) closeNoCalifica();
});


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

