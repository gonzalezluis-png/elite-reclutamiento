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
