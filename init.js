// ── SESSION RESTORE ──────────────────────────────────────────────────────────
(async () => {
  const stored = sessionStorage.getItem('er_session');
  if (stored) {
    try {
      const { token, name, role } = JSON.parse(stored);
      // Validate session is still alive on server
      const r    = await fetch(`${SERVER_URL}/auth/status/${token}`);
      const data = await r.json();
      if (data.verified && !data.expired) {
        initAppWithUser({ token, name: data.name || name, role: data.role || role });
        postLoginInit();
        return;
      }
    } catch(e) {}
    sessionStorage.removeItem('er_session');
  }
  // Show login if no valid session
  document.getElementById('login-page').classList.remove('hidden');
})();

let _postLoginInitDone = false;
function postLoginInit() {
  if (_postLoginInitDone) return;
  _postLoginInitDone = true;
  autoMoverVistos();
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
        if (typeof _updateLeadsTodayBar === 'function') _updateLeadsTodayBar();
        showToast(`☁️ ${fsLeads.length} leads cargados`);
      } else {
        await fsSaveAll();
      }
    } catch(e) {
      showToast('⚠️ Sin conexión a Firestore — usando datos locales');
    }
  })();

  // Pedir permiso de notificaciones al iniciar
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Sync automático + detección de leads nuevos
  let _knownLeadIds = new Set(leads.map(l => l.id));
  setInterval(async () => {
    if (Date.now() - _lastSaveTs < 10000) return;
    try {
      const fsLeads = await fsLoadLeads();
      if (fsLeads.length > 0) {
        // Detectar leads nuevos
        const newLeads = fsLeads.filter(l => !_knownLeadIds.has(l.id));
        leads = fsLeads;
        _knownLeadIds = new Set(leads.map(l => l.id));
        localStorage.setItem('er_leads', JSON.stringify(leads));
        autoMoverVistos();
        renderSidebar();
        renderKanban();
        if (typeof _updateLeadsTodayBar === 'function') _updateLeadsTodayBar();
        if (activeView === 'monitor' && typeof renderMonitor === 'function') renderMonitor();
        // Notificar por cada lead nuevo
        newLeads.forEach(l => _notifyNewLead(l));
      }
    } catch(e) {}
  }, 15 * 1000);

  // Close modals on overlay click
  document.getElementById('lead-modal').addEventListener('click', e => { if(e.target===document.getElementById('lead-modal')) closeLead(); });
  document.getElementById('new-modal').addEventListener('click', e => { if(e.target===document.getElementById('new-modal')) closeNewLead(); });
}

function autoMoverVistos() {
  let changed = false;
  const ahora = Date.now();
  leads.forEach(ld => {
    if (ld.pipeline_id === 'en-webinar' && ld.etapa === 'Inscrito en Webinar') {
      const pct = ld.webinar_visto_pct != null ? Number(ld.webinar_visto_pct) : null;
      if (pct !== null && pct > 0) {
        ld.etapa = 'AS - Asistente';
        addHistorial(ld.id, `Movido a Asistente automáticamente (${pct}% del webinar visto)`, '✅');
        fsSaveLead(ld);
        changed = true;
      } else {
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
