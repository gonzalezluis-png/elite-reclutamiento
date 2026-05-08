//  OPEN / CLOSE LEAD MODAL
// ════════════════════════════════════════════
let _mlSnapshot = null;

// ── Lead navigation (prev / next) ────────────────────────────────────────────
function _buildNavLeads() {
  // Pull IDs from the current rendered table rows (respects filters & sort)
  const ids = [];
  document.querySelectorAll('#table-view-wrap tr[onclick]').forEach(tr => {
    const m = (tr.getAttribute('onclick') || '').match(/openLead\('([^']+)'\)/);
    if (m) ids.push(m[1]);
  });
  if (ids.length) return ids;
  // Kanban card view fallback
  document.querySelectorAll('.kc-card[onclick]').forEach(card => {
    const m = (card.getAttribute('onclick') || '').match(/openLead\('([^']+)'\)/);
    if (m) ids.push(m[1]);
  });
  if (ids.length) return ids;
  // Last resort: full leads array
  return (leads || []).map(l => l.id);
}

function _updateNavPos() {
  const navEl = document.getElementById('mlh-nav-pos');
  if (!navEl || !currentLeadId) return;
  const navLeads = _buildNavLeads();
  const idx = navLeads.indexOf(currentLeadId);
  if (idx === -1 || !navLeads.length) { navEl.textContent = ''; return; }
  navEl.textContent = `${idx + 1} / ${navLeads.length}`;
  const prevBtn = document.querySelector('.mlh-nav-btn:first-child');
  const nextBtn = document.querySelector('.mlh-nav-btn:last-child');
  if (prevBtn) prevBtn.disabled = idx === 0;
  if (nextBtn) nextBtn.disabled = idx === navLeads.length - 1;
}

function _leadNavPrev() {
  const navLeads = _buildNavLeads();
  const idx = navLeads.indexOf(currentLeadId);
  if (idx > 0) openLead(navLeads[idx - 1]);
}

function _leadNavNext() {
  const navLeads = _buildNavLeads();
  const idx = navLeads.indexOf(currentLeadId);
  if (idx !== -1 && idx < navLeads.length - 1) openLead(navLeads[idx + 1]);
}

// Keyboard nav: ← → when modal is open
document.addEventListener('keydown', e => {
  if (!currentLeadId) return;
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); _leadNavPrev(); }
  if (e.key === 'ArrowRight') { e.preventDefault(); _leadNavNext(); }
});

function _mlUpdateAvatar() {
  const name = document.getElementById('ml-nombre')?.value || '';
  const initials = name.split(' ').filter(Boolean).map(w => w[0].toUpperCase()).slice(0,2).join('') || '?';
  const av = document.getElementById('ml-avatar');
  if (av) av.textContent = initials;
}

function _mlSetMode(editing) {
  const modal = document.querySelector('.modal-lead');
  modal.classList.toggle('ml-view-mode', !editing);
  document.getElementById('ml-btn-edit').style.display        = editing ? 'none' : '';
  document.getElementById('ml-btn-save').style.display        = editing ? '' : 'none';
  document.getElementById('ml-btn-cancel-edit').style.display = editing ? '' : 'none';
}

function _mlEdit() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (lead) _mlSnapshot = JSON.parse(JSON.stringify(lead));
  _mlSetMode(true);
}

function _mlCancelEdit() {
  if (_mlSnapshot) {
    const idx = leads.findIndex(l => l.id === currentLeadId);
    if (idx !== -1) leads[idx] = _mlSnapshot;
    _mlSnapshot = null;
    openLead(currentLeadId);
    return;
  }
  _mlSetMode(false);
}

function openLead(id, tabName) {
  const lead = leads.find(l => l.id === id);
  if (!lead) return;
  currentLeadId = id;

  // populate header
  document.getElementById('ml-nombre').value = lead.nombre || '';
  const _folioEl = document.getElementById('ml-folio');
  if (_folioEl) _folioEl.textContent = typeof _leadFolio === 'function' ? _leadFolio(id) : '';
  _mlUpdateAvatar();

  // populate pipeline/etapa selects
  const pSel = document.getElementById('ml-pipeline');
  pSel.innerHTML = PIPELINES.map(p => `<option value="${p.id}" ${p.id===lead.pipeline_id?'selected':''}>${p.nombre}</option>`).join('');
  updateEtapasSelect(lead.etapa);

  // info tab
  document.getElementById('ml-contacto').value = lead.contacto || lead.nombre || '';
  document.getElementById('ml-correo').value = lead.correo || '';
  document.getElementById('ml-telefono').value = lead.telefono || '';
  document.getElementById('ml-propietario').value = lead.propietario || '';
  document.getElementById('ml-inscrito-por').value = lead.inscrito_por || '';
  document.getElementById('ml-ubicacion').value = lead.ubicacion || '';
  document.getElementById('ml-fecha-inscripcion-webinar').value = lead.fecha_inscripcion_webinar || '';
  _mlRenderProgreso(lead);
  document.getElementById('ml-fuente').value = lead.fuente || 'Meta / Facebook';
  document.getElementById('ml-seguidores').value = (lead.seguidores||[]).join(', ');

  // extra phones
  const phonesList = document.getElementById('phones-list');
  const extras = lead.telefonos_extra || [];
  phonesList.innerHTML = `<div class="phone-row"><input id="ml-telefono" placeholder="+52 55 0000 0000" value="${esc(lead.telefono||'')}" /></div>`;
  extras.forEach(ph => addPhoneRow(ph));

  // cita
  document.getElementById('cita-fecha').value = lead.cita?.fecha || '';
  document.getElementById('cita-hora').value  = lead.cita?.hora  || '';
  document.getElementById('cita-tipo').value  = lead.cita?.tipo  || 'Entrevista inicial';
  document.getElementById('cita-notas').value = lead.cita?.notas || '';
  renderCitaActual(lead.cita);

  // tareas, notas, historial
  renderNotas(lead.notas || []);

  // entrevista section
  ivInitSection(lead);

  // metadatos
  _mlRenderMetadata(lead);

  document.getElementById('lead-modal').classList.remove('hidden');
  _mlSetMode(false);
  lcOpen();
  loadRecordings(lead.telefono);
  _updateNavPos();
}

function closeLead() {
  clearInterval(_lcPollInt);
  document.getElementById('lead-modal').classList.add('hidden');
  currentLeadId = null;
}

// ── Extract lead data from chat ───────────────────────────────────────────────
async function mlExtractFromChat() {
  if (!currentLeadId) return;
  const btn = document.getElementById('ml-extract-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Leyendo…'; }
  try {
    const res  = await fetch(`${SERVER_URL}/leads/${currentLeadId}/extract`, {
      method: 'POST', headers: _leadHeaders(),
    });
    const data = await res.json();
    if (!data.ok) {
      showToast('⚠️ ' + (data.error || 'Sin historial suficiente'));
      return;
    }
    // Update lead in memory and reload modal
    const idx = leads.findIndex(l => l.id === currentLeadId);
    if (idx >= 0) leads[idx] = { ...leads[idx], ...data.lead };
    else leads.unshift(data.lead);
    openLead(currentLeadId);
    showToast('✅ Datos actualizados desde el chat');
    renderKanban();
  } catch (e) {
    showToast('❌ Error al leer conversación');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Leer chat'; }
  }
}

// ════════════════════════════════════════════
//  SAVE LEAD
// ════════════════════════════════════════════
function saveLead() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;

  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
  const oldPipeline = lead.pipeline_id;
  const oldEtapa    = lead.etapa;

  lead.nombre      = document.getElementById('ml-nombre').value.trim();
  lead.pipeline_id = document.getElementById('ml-pipeline').value;
  lead.etapa       = document.getElementById('ml-etapa').value;
  lead.contacto    = document.getElementById('ml-contacto').value.trim();
  lead.correo      = document.getElementById('ml-correo').value.trim();
  lead.telefono    = document.getElementById('ml-telefono').value.trim();
  lead.propietario  = document.getElementById('ml-propietario').value;
  lead.inscrito_por              = document.getElementById('ml-inscrito-por').value;
  lead.ubicacion                 = document.getElementById('ml-ubicacion').value.trim();
  lead.fecha_inscripcion_webinar = document.getElementById('ml-fecha-inscripcion-webinar').value;
  lead.fuente                    = document.getElementById('ml-fuente').value;
  lead.seguidores  = document.getElementById('ml-seguidores').value.split(',').map(s=>s.trim()).filter(Boolean);

  // Si se mueve a En Webinar y antes no estaba ahí, registrar y enviar correo
  if (lead.pipeline_id === 'en-webinar' && oldPipeline !== 'en-webinar') {
    _registrarEnWebinar(lead, oldEtapa).then(() => { renderKanban(); renderSidebar(); });
    _mlSnapshot = null;
    _mlSetMode(false);
    showToast('🎥 Inscribiendo en Webinar y enviando correo…');
    return;
  }

  if (oldEtapa !== lead.etapa || oldPipeline !== lead.pipeline_id) {
    const pipeName = PIPELINES.find(p => p.id === lead.pipeline_id)?.nombre || lead.pipeline_id;
    addHistorial(lead.id, `Movido a: ${pipeName} → ${lead.etapa}`, '↕️');
  } else {
    addHistorial(lead.id, 'Información actualizada', '✏️');
  }
  saveLeads(currentLeadId);
  _mlSnapshot = null;
  _mlSetMode(false); // return to view (locked) mode
  _mlRenderProgreso(lead);
  renderKanban();
  renderSidebar();
  showToast('✏️ Aplicante guardado', true);
}

function _mlRenderProgreso(lead) {
  const el = document.getElementById('ml-progreso-tracker');
  if (!el) return;
  const steps = [
    { pct: 5,   label: 'Aplicó',               check: () => true },
    { pct: 10,  label: 'Nombre y ciudad',       check: l => l.nombre && !l.nombre.startsWith('WA ') && !l.nombre.startsWith('+') && l.ubicacion },
    { pct: 20,  label: 'Experiencia laboral',   check: l => l.tiene_experiencia },
    { pct: 45,  label: 'Interés en webinar',    check: l => l.webinar_intent },
    { pct: 50,  label: 'Papeles y mayoría',     check: l => l.tiene_papeles && l.mayor_edad },
    { pct: 60,  label: 'Correo registrado',     check: l => !!l.correo },
    { pct: 70,  label: 'Vio el webinar',        check: l => l.webinar_visto || l.vio_webinar || (l.pipeline_id === 'en-webinar' && l.etapa !== 'En Webinar sin actividad') },
    { pct: 80,  label: 'Entrevista agendada',   check: l => !!(l.cita?.fecha) || ['entrevistas-generales','caritza-rojas','maria-lugo','brayan-alexander'].includes(l.pipeline_id) },
    { pct: 100, label: 'Asistió a entrevista',  check: l => /asist|ENTREVISTADO|ENTREVISTADA/i.test(l.etapa||'') },
  ];
  const current = calcProgreso(lead);
  el.innerHTML = `
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text2);margin-bottom:10px;">Progreso del funnel</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${current}%;background:${current>=100?'#fbbf24':current>=70?'#00c875':'#4f7fff'};border-radius:3px;transition:width .5s;"></div>
      </div>
      <span style="font-size:16px;font-weight:800;color:${current>=100?'#fbbf24':current>=70?'#00c875':'#4f7fff'};">${current}%</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px;">
      ${steps.map(s => {
        const done = s.check(lead);
        const active = s.pct === current;
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;background:${done?'rgba(0,200,117,.06)':active?'rgba(79,127,255,.06)':'transparent'};border:1px solid ${done?'rgba(0,200,117,.15)':active?'rgba(79,127,255,.15)':'transparent'};">
          <span style="font-size:13px;">${done?'✅':active?'🔵':'⬜'}</span>
          <span style="font-size:12px;color:${done?'#e2fef3':active?'#c4d9ff':'var(--text2)'};">${s.label}</span>
          <span style="margin-left:auto;font-size:10px;font-weight:700;color:${done?'#00c875':active?'#4f7fff':'var(--text2)'};">${s.pct}%</span>
        </div>`;
      }).join('')}
    </div>`;
}

function deleteLead() {
  if (!currentLeadId) return;
  if (!confirm('¿Eliminar este aplicante?')) return;
  const lead = leads.find(l => l.id === currentLeadId);
  if (lead) pushUndo('lead_delete', JSON.parse(JSON.stringify(lead)));
  leads = leads.filter(l => l.id !== currentLeadId);
  saveLeads();
  closeLead();
  renderKanban();
  renderSidebar();
  showToast('🗑️ Aplicante eliminado', true);
}

async function deleteLeadFull() {
  const leadId = _openMenuLeadId || currentLeadId;
  if (!leadId) return;
  const lead = leads.find(l => l.id === leadId);
  const nombre = lead?.nombre || 'este contacto';

  // Double confirmation for legal data deletion
  if (!confirm(`⚠️ ELIMINACIÓN DE DATOS\n\nVas a eliminar permanentemente a "${nombre}" incluyendo:\n• Su perfil y toda su información\n• Historial de conversaciones con Ana\n• Registros de escalación\n\nEsta acción NO se puede deshacer.\n\n¿Continuar?`)) return;
  if (!confirm(`Confirma una vez más: ¿eliminar TODOS los datos de "${nombre}"?`)) return;

  closeAllMenus();
  closeLead();

  // Remove from local state immediately for responsiveness
  leads = leads.filter(l => l.id !== leadId);
  saveLeads();
  renderKanban();
  renderSidebar();
  showToast('Eliminando datos…');

  try {
    const r = await fetch(`${SERVER_URL}/leads/${leadId}`, { method: 'DELETE', headers: { 'x-session-token': _sessionToken || '' } });
    const d = await r.json();
    if (d.ok) {
      const histCount = d.deleted?.history?.length || 0;
      const escCount  = d.deleted?.escalations?.length || 0;
      showToast(`✅ Datos de "${nombre}" eliminados${histCount ? ` · ${histCount} conv.` : ''}${escCount ? ` · ${escCount} esc.` : ''}`);
    } else {
      showToast('⚠️ Lead eliminado localmente, pero hubo un error en el servidor: ' + d.error);
    }
  } catch (e) {
    showToast('⚠️ Lead eliminado localmente. Error de conexión: ' + e.message);
  }
}

// ════════════════════════════════════════════
//  NEW LEAD MODAL
// ════════════════════════════════════════════
function populatePipelineSelects() {
  ['nml-pipeline'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    sel.innerHTML = PIPELINES.map(p => `<option value="${p.id}" ${p.id===activePipelineId?'selected':''}>${p.nombre}</option>`).join('');
  });
  updateNmlEtapas();
}

function updateNmlEtapas() {
  const pid = document.getElementById('nml-pipeline').value;
  const pipe = PIPELINES.find(p => p.id === pid);
  const sel = document.getElementById('nml-etapa');
  sel.innerHTML = (pipe?.etapas || []).map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
}

function openNewLead() {
  populatePipelineSelects();
  document.getElementById('nml-nombre').value = '';
  document.getElementById('nml-tel').value = '';
  document.getElementById('nml-correo').value = '';
  document.getElementById('new-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('nml-nombre').focus(), 50);
}

function openNewLeadInStage(etapa) {
  openNewLead();
  const pSel = document.getElementById('nml-pipeline');
  pSel.value = activePipelineId;
  updateNmlEtapas();
  document.getElementById('nml-etapa').value = etapa;
}

function closeNewLead() {
  document.getElementById('new-modal').classList.add('hidden');
}

function saveNewLead() {
  const nombre = document.getElementById('nml-nombre').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio'); return; }
  const numero = (leads.length > 0 ? Math.max(...leads.map(l => l.numero||0)) : 0) + 1;
  const lead = {
    id: 'lead-' + Date.now(),
    numero,
    nombre,
    telefono:    document.getElementById('nml-tel').value.trim(),
    correo:      document.getElementById('nml-correo').value.trim(),
    fuente:      document.getElementById('nml-fuente').value,
    pipeline_id: document.getElementById('nml-pipeline').value,
    etapa:       document.getElementById('nml-etapa').value,
    propietario: document.getElementById('nml-propietario').value,
    estado: 'abierto',
    notas:[], tareas:[], historial:[],
    created_at: new Date().toISOString(),
  };
  const pipeName = PIPELINES.find(p => p.id === lead.pipeline_id)?.nombre || lead.pipeline_id;
  addHistorial(lead.id, `Lead creado en ${pipeName} → ${lead.etapa}`, '🌟');
  leads.unshift(lead);
  pushUndo('lead_create', lead.id);
  saveLeads();
  closeNewLead();
  renderKanban();
  renderSidebar();
  showToast('🌟 Aplicante creado', true);
}

// ════════════════════════════════════════════
//  APLICANTES EXTERNOS
// ════════════════════════════════════════════
function openExternalApplicant() {
  document.getElementById('ext-nombre').value = '';
  document.getElementById('ext-tel').value = '';
  document.getElementById('ext-correo').value = '';
  document.getElementById('ext-ubicacion').value = '';
  document.getElementById('ext-notas').value = '';
  document.getElementById('ext-fuente').value = 'Indeed';
  _extUpdatePreview();
  document.getElementById('ext-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('ext-nombre').focus(), 50);
}

function closeExternalApplicant() {
  document.getElementById('ext-modal').classList.add('hidden');
}

function _extUpdatePreview() {
  const fuente = document.getElementById('ext-fuente').value;
  const isIndeed = fuente === 'Indeed' || fuente === 'Glassdoor';
  const pipeName = isIndeed ? 'Postulados por Indeed' : 'Postulados por Meta';
  const lbl = document.getElementById('ext-pipeline-label');
  if (lbl) lbl.textContent = `${fuente} → ${pipeName} · New Lead`;
}

// wired via onchange in HTML

function submitExternalApplicant() {
  const nombre = document.getElementById('ext-nombre').value.trim();
  const tel    = document.getElementById('ext-tel').value.trim();
  if (!nombre) { showToast('El nombre es obligatorio'); return; }
  if (!tel)    { showToast('El teléfono es obligatorio'); return; }

  const fuente = document.getElementById('ext-fuente').value;
  const isIndeed = fuente === 'Indeed' || fuente === 'Glassdoor';
  const pipeline_id = isIndeed ? 'postulados-indeed' : 'postulados-meta';

  const notasTxt = document.getElementById('ext-notas').value.trim();
  const notas = notasTxt
    ? [{ texto: notasTxt, fecha: new Date().toISOString(), autor: currentUser?.name || 'Sistema' }]
    : [];

  const numero = (leads.length > 0 ? Math.max(...leads.map(l => l.numero || 0)) : 0) + 1;
  const lead = {
    id:          'lead-' + Date.now(),
    numero,
    nombre,
    telefono:    tel,
    correo:      document.getElementById('ext-correo').value.trim(),
    fuente,
    ubicacion:   document.getElementById('ext-ubicacion').value.trim(),
    pipeline_id,
    etapa:       'New Lead',
    propietario: currentUser?.name || '',
    estado:      'abierto',
    notas,
    tareas:      [],
    historial:   [],
    created_at:  new Date().toISOString(),
  };

  const pipeName = PIPELINES.find(p => p.id === pipeline_id)?.nombre || pipeline_id;
  addHistorial(lead.id, `Aplicante externo creado en ${pipeName} · Fuente: ${fuente}`, '📥');
  leads.unshift(lead);
  pushUndo('lead_create', lead.id);
  saveLeads();
  closeExternalApplicant();
  renderKanban();
  renderSidebar();
  showToast('📥 Aplicante externo agregado', true);
}

// ════════════════════════════════════════════
//  PIPELINE/ETAPA SELECTS IN MODAL
// ════════════════════════════════════════════
function updateEtapasSelect(currentEtapa) {
  const pid = document.getElementById('ml-pipeline').value;
  const pipe = PIPELINES.find(p => p.id === pid);
  const sel = document.getElementById('ml-etapa');
  sel.innerHTML = (pipe?.etapas || []).map(e => `<option value="${esc(e)}" ${e===(currentEtapa||'')? 'selected':''}>${esc(e)}</option>`).join('');
}


// ════════════════════════════════════════════
//  TABS
// ════════════════════════════════════════════
function showTab(name) { /* kept for backward-compat call sites */ }

function lcToggleCita(hdr) {
  const body  = document.getElementById('ml-cita-body');
  const arrow = document.getElementById('ml-cita-arrow');
  const open  = body.classList.toggle('open');
  if (arrow) arrow.textContent = open ? '▾' : '▸';
}

function lcToggleMeta(hdr) {
  const body  = document.getElementById('ml-meta-body');
  const arrow = document.getElementById('ml-meta-arrow');
  const open  = body.classList.toggle('open');
  if (arrow) arrow.textContent = open ? '▾' : '▸';
}

function _mlRenderMetadata(lead) {
  const el = document.getElementById('ml-meta-content');
  if (!el) return;

  const row = (icon, label, value, mono) => value
    ? `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);">
        <span style="width:16px;flex-shrink:0;opacity:.5">${icon}</span>
        <span style="color:var(--text2);flex-shrink:0;min-width:80px">${label}</span>
        <span style="color:var(--text);word-break:break-all;${mono?'font-family:monospace;font-size:10px;':''}">${esc(String(value))}</span>
       </div>`
    : '';

  const _fmtDate = v => v ? new Date(v).toLocaleString('es-MX', { dateStyle:'medium', timeStyle:'short' }) : '';
  const createdAt = _fmtDate(lead.created_at || lead.createdAt);
  const updatedAt = _fmtDate(lead.updated_at || lead.updatedAt);

  const bool = v => v === true ? '✅ Sí' : v === false ? '❌ No' : null;
  const sec  = label => `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:rgba(255,255,255,.3);padding:10px 0 4px;margin-top:4px">${label}</div>`;
  const fmtSec = v => v ? parseInt(v) + ' seg' : null;
  const fmtPct = v => v != null ? Math.round(v) + '%' : null;

  const webinarMin = lead.webinar_tiempo_visto
    ? (() => { const s = parseInt(lead.webinar_tiempo_visto); return `${Math.floor(s/60)}m ${s%60}s`; })()
    : null;

  el.innerHTML = [
    sec('Origen'),
    row('📣', 'Fuente',       lead.fuente),
    row('📋', 'Anuncio',      lead.ad_nombre || lead.campaign_name),
    row('🎯', 'Click ID',     lead.ad_clid,        true),
    row('📅', 'Creado',       createdAt),
    row('🔄', 'Actualizado',  updatedAt),

    sec('Sistema'),
    row('🆔', 'Lead ID',      lead.id,             true),
    row('🔑', 'Pipeline ID',  lead.pipeline_id,    true),
    row('🤖', 'IA pausada',   bool(lead.ia_paused)),
    row('💬', 'Estado entrevista', lead.interview_state),
    row('📅', 'Quiere cita',  bool(lead.quiere_entrevista)),

    sec('Webinar'),
    row('👁️', 'Visto',         bool(lead.vio_webinar || lead.webinar_completado)),
    row('📊', 'Progreso',      fmtPct(lead.webinar_visto_pct)),
    row('⏱️', 'Tiempo visto',  webinarMin),
    row('⏸️', 'Pausas',        lead.webinar_pausas != null ? String(lead.webinar_pausas) : null),
    row('📧', 'Email enviado', bool(lead.webinar_email_enviado)),
    row('💡', 'Intent',        lead.webinar_intent),
    row('🕐', 'Última sesión', lead.webinar_ultima_sesion ? _fmtDate(lead.webinar_ultima_sesion) : null),

    sec('Cualificación'),
    row('🔞', 'Mayor de edad',  bool(lead.mayor_edad)),
    row('💼', 'Tiene experiencia', bool(lead.tiene_experiencia)),
    row('📄', 'Tiene papeles',  bool(lead.tiene_papeles)),
  ].filter(Boolean).join('') || '<div style="color:var(--text2);padding:4px 0">Sin metadatos registrados</div>';
}

// ════════════════════════════════════════════
//  ENTREVISTAS (manual scheduling from lead modal)
// ════════════════════════════════════════════
let _ivCurrentLeadPhone = null;
let _ivCurrentLeadName  = null;
let _ivCurrentInterview = null;

function lcToggleEntrevista(hdr) {
  const body  = document.getElementById('ml-entrevista-body');
  const arrow = document.getElementById('ml-entrevista-arrow');
  const open  = body.classList.toggle('open');
  if (arrow) arrow.textContent = open ? '▾' : '▸';
}

async function ivInitSection(lead) {
  _ivCurrentLeadPhone = lead.telefono || '';
  _ivCurrentLeadName  = lead.nombre  || lead.contacto || '';
  _ivCurrentInterview = null;

  const sec    = document.getElementById('ml-entrevista-section');
  const booked = document.getElementById('iv-booked-info');
  const list   = document.getElementById('iv-slots-list');
  const status = document.getElementById('iv-slots-status');

  if (lead.pipeline_id !== 'en-webinar') { sec.style.display = 'none'; return; }
  sec.style.display = 'block';

  // Reset state
  list.innerHTML = '';
  booked.style.display = 'none';
  status.textContent = 'Haz clic en "Ver disponibilidad" para ver los horarios.';

  // Check if lead already has a booked interview
  try {
    const res  = await fetch(`/interviews?phone=${encodeURIComponent(_ivCurrentLeadPhone)}`);
    const data = await res.json();
    const raw = (data.interviews || []).find(i => i.status === 'scheduled' || i.status === 'booked');
    if (raw) {
      const active = { ...raw, slot: raw.slot || raw.slotIso, zoom_link: raw.zoom_link || raw.zoomLink };
      _ivCurrentInterview = active;
      _ivShowBookedInfo(active);
      status.textContent = '';
    }
  } catch (e) { /* ignore */ }
}

function _ivShowBookedInfo(interview) {
  const booked = document.getElementById('iv-booked-info');
  const detail = document.getElementById('iv-booked-detail');
  const list   = document.getElementById('iv-slots-list');
  const btnVer = document.querySelector('#ml-entrevista-body button');

  booked.style.display = 'block';
  if (btnVer) btnVer.style.display = 'none';

  const d = new Date(interview.slot);
  const fmt = d.toLocaleString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  detail.innerHTML = `<div>${fmt}</div>${interview.zoom_link ? `<div style="margin-top:4px;"><a href="${esc(interview.zoom_link)}" target="_blank" style="color:#a5b4fc;font-size:11px;">🔗 Enlace Zoom</a></div>` : ''}`;
  list.innerHTML = '';
}

async function ivLoadSlots() {
  const list   = document.getElementById('iv-slots-list');
  const status = document.getElementById('iv-slots-status');
  list.innerHTML = '<div style="font-size:12px;color:var(--text2);">Cargando horarios...</div>';
  status.textContent = '';
  try {
    const res  = await fetch(`${SERVER_URL}/interviews/slots`);
    const data = await res.json();
    const slots = data.slots || [];
    if (!slots.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text2);">No hay horarios disponibles. Revisa la configuración del calendario.</div>';
      return;
    }
    list.innerHTML = slots.map(s => {
      const iso = s.iso || s;
      const lbl = s.label || new Date(iso).toLocaleString('es-MX', { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<button onclick="ivBookSlot('${iso}')" style="text-align:left;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);color:var(--text);border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;">📅 ${lbl}</button>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="font-size:12px;color:var(--red);">Error cargando horarios.</div>';
  }
}

async function ivBookSlot(slot) {
  const d   = new Date(slot);
  const lbl = d.toLocaleString('es-MX', { weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  if (!confirm(`¿Confirmar entrevista el ${lbl}?`)) return;

  const status = document.getElementById('iv-slots-status');
  status.textContent = 'Agendando...';
  document.getElementById('iv-slots-list').innerHTML = '';

  try {
    const res  = await fetch(`${SERVER_URL}/interviews/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: _ivCurrentLeadPhone, name: _ivCurrentLeadName, slot }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    _ivCurrentInterview = data.interview;
    _ivShowBookedInfo(data.interview);
    status.textContent = '';
    showToast('Entrevista agendada ✓');
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
  }
}

async function ivCancelBooking() {
  if (!_ivCurrentInterview) return;
  if (!confirm('¿Cancelar la entrevista agendada?')) return;

  try {
    await fetch(`/interviews/${_ivCurrentInterview.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    _ivCurrentInterview = null;
    document.getElementById('iv-booked-info').style.display = 'none';
    const btnVer = document.querySelector('#ml-entrevista-body button');
    if (btnVer) btnVer.style.display = '';
    document.getElementById('iv-slots-status').textContent = 'Haz clic en "Ver disponibilidad" para ver los horarios.';
    showToast('Entrevista cancelada');
  } catch (e) {
    showToast('Error cancelando entrevista');
  }
}

// ════════════════════════════════════════════
//  AGENDAR CITA DESDE EN WEBINAR
// ════════════════════════════════════════════
let _acLead = null;

async function openAgendarCitaModal(leadId) {
  document.querySelectorAll('.lt-accion-menu.open').forEach(m => m.classList.remove('open'));
  _acLead = leads.find(l => l.id === leadId);
  if (!_acLead) return;

  document.getElementById('agendar-cita-nombre').textContent = _acLead.nombre || _acLead.telefono || '';
  document.getElementById('agendar-cita-status').textContent = 'Cargando horarios disponibles...';
  document.getElementById('agendar-cita-slots').innerHTML = '';
  document.getElementById('agendar-cita-modal').classList.remove('hidden');

  try {
    const res   = await fetch(`${SERVER_URL}/interviews/slots`);
    const data  = await res.json();
    const slots = data.slots || [];
    if (!slots.length) {
      document.getElementById('agendar-cita-status').textContent = 'No hay horarios disponibles. Revisa la configuración del calendario.';
      return;
    }
    document.getElementById('agendar-cita-status').textContent = 'Selecciona un horario:';
    document.getElementById('agendar-cita-slots').innerHTML = slots.map(s => {
      const iso = s.iso || s;
      const lbl = s.label || new Date(iso).toLocaleString('es-MX', { weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<button onclick="_acBookSlot('${iso}')" style="text-align:left;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);color:var(--text);border-radius:8px;padding:9px 14px;cursor:pointer;font-size:12.5px;font-family:var(--font);transition:background .15s;" onmouseover="this.style.background='rgba(99,102,241,.25)'" onmouseout="this.style.background='rgba(99,102,241,.12)'">📅 ${lbl}</button>`;
    }).join('');
  } catch(e) {
    document.getElementById('agendar-cita-status').textContent = 'Error cargando horarios: ' + e.message;
  }
}

function closeAgendarCitaModal() {
  document.getElementById('agendar-cita-modal').classList.add('hidden');
  _acLead = null;
  _acManualOpen = false;
}

async function _acBookSlot(slot) {
  if (!_acLead) return;
  const d   = new Date(slot);
  const lbl = d.toLocaleString('es-MX', { weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  if (!confirm(`¿Confirmar entrevista el ${lbl}?`)) return;

  document.getElementById('agendar-cita-status').textContent = 'Agendando...';
  document.getElementById('agendar-cita-slots').innerHTML = '';

  try {
    const res  = await fetch(`${SERVER_URL}/interviews/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: _acLead.telefono, name: _acLead.nombre, slot }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al agendar');

    // Move lead to Entrevistas Generales
    const now  = new Date().toISOString();
    const hist = (_acLead.historial || []).concat([{
      icono:   '📅',
      accion:  `Entrevista agendada manualmente para ${lbl} — movido a Entrevistas Generales`,
      fecha:   now,
      usuario: currentUser?.nombre || 'Admin',
    }]);

    await fetch(`${SERVER_URL}/leads/${_acLead.id}`, {
      method: 'PATCH',
      headers: _leadHeaders(),
      body: JSON.stringify({
        pipeline_id:    'entrevistas-generales',
        etapa:          'En Entrevista',
        webinar_accion: 'en-entrevista',
        historial:      hist,
      }),
    });

    // Update local state
    _acLead.pipeline_id    = 'entrevistas-generales';
    _acLead.etapa          = 'En Entrevista';
    _acLead.webinar_accion = 'en-entrevista';
    _acLead.historial      = hist;

    closeAgendarCitaModal();
    showToast(`✅ Entrevista agendada — ${_acLead.nombre} movido a Entrevistas Generales`);
    renderKanban();
    renderSidebar();
  } catch(e) {
    document.getElementById('agendar-cita-status').textContent = 'Error: ' + e.message;
  }
}

// ── Calendario manual de citas ───────────────────────────────────────────────
let _acManualOpen   = false;
let _acManualCfg    = null;
let _acManualYear   = null;
let _acManualMonth  = null;
let _acManualDay    = null;

async function _acToggleManual() {
  _acManualOpen = !_acManualOpen;
  const wrap = document.getElementById('agendar-manual-wrap');
  const btn  = document.getElementById('agendar-manual-btn');
  if (!_acManualOpen) { wrap.style.display = 'none'; btn.textContent = '🗓️ Buscar cita manualmente'; return; }
  btn.textContent = '🗓️ Buscar cita manualmente ▲';
  wrap.style.display = 'block';
  wrap.innerHTML = '<div style="font-size:12px;color:var(--text2);">Cargando configuración…</div>';
  try {
    const res  = await fetch(`${SERVER_URL}/interviews/config`);
    const data = await res.json();
    _acManualCfg = data.config || {};
    const now = new Date();
    _acManualYear  = now.getFullYear();
    _acManualMonth = now.getMonth();
    _acManualDay   = null;
    _acRenderCalendar();
  } catch(e) {
    wrap.innerHTML = `<div style="font-size:12px;color:var(--red);">Error: ${e.message}</div>`;
  }
}

function _acRenderCalendar() {
  const wrap     = document.getElementById('agendar-manual-wrap');
  const cfg      = _acManualCfg;
  const schedule = cfg.schedule || {};
  const allowedDays = schedule.days ?? [1,2,3,4,5];
  const startH   = schedule.startHour ?? 9;
  const endH     = schedule.endHour   ?? 18;

  const y = _acManualYear, m = _acManualMonth;
  const firstDay  = new Date(y, m, 1).getDay();
  const daysInMon = new Date(y, m + 1, 0).getDate();
  const today     = new Date(); today.setHours(0,0,0,0);
  const monthName = new Date(y, m, 1).toLocaleDateString('es-MX', { month:'long', year:'numeric' });

  let cells = '';
  for (let i = 0; i < firstDay; i++) cells += '<div></div>';
  for (let d = 1; d <= daysInMon; d++) {
    const date    = new Date(y, m, d);
    const dayOfW  = date.getDay();
    const isAvail = allowedDays.includes(dayOfW) && date >= today;
    const isSel   = _acManualDay === d;
    const bg      = isSel ? 'rgba(99,102,241,.5)' : isAvail ? 'rgba(99,102,241,.1)' : 'transparent';
    const border  = isSel ? 'rgba(99,102,241,.8)' : isAvail ? 'rgba(99,102,241,.3)' : 'transparent';
    const color   = isSel ? '#fff' : isAvail ? 'var(--text)' : 'rgba(255,255,255,.15)';
    const onclick = isAvail ? `onclick="_acSelectDay(${d})"` : '';
    cells += `<div style="text-align:center;padding:5px 2px;font-size:12px;font-weight:600;cursor:${isAvail?'pointer':'default'};background:${bg};border:1px solid ${border};border-radius:6px;color:${color};" ${onclick}>${d}</div>`;
  }

  const dayNames = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'].map(d =>
    `<div style="text-align:center;font-size:10px;font-weight:700;color:var(--text2);padding-bottom:4px;">${d}</div>`
  ).join('');

  wrap.innerHTML = `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <button onclick="_acCalNav(-1)" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--text2);padding:3px 9px;cursor:pointer;font-size:13px;">‹</button>
        <span style="font-size:12px;font-weight:700;color:var(--text);text-transform:capitalize;">${monthName}</span>
        <button onclick="_acCalNav(1)"  style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--text2);padding:3px 9px;cursor:pointer;font-size:13px;">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:6px;">${dayNames}</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;">${cells}</div>
      <div style="margin-top:8px;font-size:10px;color:var(--text2);">Días disponibles: ${startH}:00 – ${endH}:00 hs</div>
    </div>
    <div id="ac-manual-slots" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;"></div>`;

  if (_acManualDay) _acRenderManualSlots(startH, endH);
}

function _acCalNav(dir) {
  _acManualMonth += dir;
  if (_acManualMonth < 0)  { _acManualMonth = 11; _acManualYear--; }
  if (_acManualMonth > 11) { _acManualMonth = 0;  _acManualYear++; }
  _acManualDay = null;
  _acRenderCalendar();
}

function _acSelectDay(d) {
  _acManualDay = d;
  _acRenderCalendar();
}

function _acRenderManualSlots(startH, endH) {
  const el = document.getElementById('ac-manual-slots');
  if (!el) return;
  const slots = [];
  for (let h = startH; h < endH; h++) {
    const iso = new Date(_acManualYear, _acManualMonth, _acManualDay, h, 0, 0).toISOString();
    slots.push({ iso, lbl: `${String(h).padStart(2,'0')}:00` });
  }
  el.innerHTML = slots.map(s =>
    `<button onclick="_acBookSlot('${s.iso}')" style="background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);color:var(--text);border-radius:7px;padding:6px 12px;cursor:pointer;font-size:12px;font-family:var(--font);">🕐 ${s.lbl}</button>`
  ).join('');
}

// ════════════════════════════════════════════
//  PHONES
// ════════════════════════════════════════════
function addPhone() { addPhoneRow(''); }
function addPhoneRow(val) {
  const list = document.getElementById('phones-list');
  const div = document.createElement('div');
  div.className = 'phone-row';
  div.innerHTML = `<input placeholder="+52 55 0000 0000" value="${esc(val)}" /><button class="phone-del" onclick="this.parentElement.remove()">✕</button>`;
  list.appendChild(div);
}

// ════════════════════════════════════════════
//  TAGS
// ════════════════════════════════════════════
function renderTagsWrap() {
  const wrap = document.getElementById('tags-wrap');
  const inp = document.getElementById('tags-input');
  wrap.innerHTML = '';
  currentTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${esc(tag)}<button onclick="removeTag(${i})">×</button>`;
    wrap.appendChild(chip);
  });
  wrap.appendChild(inp);
}
function handleTagKey(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,/g,'');
    if (val && !currentTags.includes(val)) { currentTags.push(val); renderTagsWrap(); }
    e.target.value = '';
  }
}
function removeTag(i) { currentTags.splice(i,1); renderTagsWrap(); }

// ════════════════════════════════════════════
//  NOTAS
// ════════════════════════════════════════════
function fmtDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const now = new Date();
  const isToday = dt.toDateString() === now.toDateString();
  const time = dt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `hoy · ${time}`;
  const date = dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  return `${date} · ${time}`;
}
function _initials(name) {
  return (name || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}
function _renderNoteText(text) {
  return esc(text).replace(/@([\w\u00C0-\u024F][\w\u00C0-\u024F\s]*?)(?=\s|$|[^\w\u00C0-\u024F\s])/g,
    '<span style="color:#a5b4fc;font-weight:600;background:rgba(165,180,252,.12);border-radius:4px;padding:0 3px;">@$1</span>');
}

function renderNotas(notas) {
  const el = document.getElementById('notas-list');
  if (!notas || !notas.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--text2);font-size:12px;padding:16px 0;opacity:.6">Sin notas aún</div>';
    return;
  }
  el.innerHTML = notas.map(n => `
    <div class="note-entry">
      <div class="note-avatar">${_initials(n.autor)}</div>
      <div class="note-bubble">
        <div class="note-meta">
          <span class="note-author">${esc(n.autor || 'Sistema')}</span>
          <span class="note-time">${fmtDateTime(n.fecha)}</span>
        </div>
        <div class="note-text">${_renderNoteText(n.texto)}</div>
      </div>
    </div>`).join('');
}

// ── @mention autocomplete ─────────────────────────────────────────────────────
let _mentionUsers = [];
let _mentionQuery = null;
let _mentionStart = -1;
let _mentionActiveIdx = 0;

async function _loadMentionUsers() {
  if (_mentionUsers.length) return _mentionUsers;
  try {
    const r = await fetch(`${SERVER_URL}/team`, { headers: _leadHeaders() });
    const d = await r.json();
    _mentionUsers = (d.users || []);
  } catch {}
  return _mentionUsers;
}

function handleNotaMention(e) {
  const ta  = e.target;
  const val = ta.value;
  const pos = ta.selectionStart;
  // Find the last @ before cursor
  const before = val.slice(0, pos);
  const atIdx  = before.lastIndexOf('@');
  if (atIdx === -1 || (atIdx > 0 && /\S/.test(val[atIdx - 1]))) {
    closeMentionDropdown(); return;
  }
  const query = before.slice(atIdx + 1);
  if (query.includes('\n')) { closeMentionDropdown(); return; }
  _mentionQuery = query;
  _mentionStart = atIdx;
  _showMentionDropdown(query);
}

async function _showMentionDropdown(query) {
  const users = await _loadMentionUsers();
  const q = query.toLowerCase();
  const matches = users.filter(u => u.nombre.toLowerCase().includes(q) && u.id !== currentUser?.userId);
  const dd = document.getElementById('mention-dropdown');
  if (!matches.length) { closeMentionDropdown(); return; }
  _mentionActiveIdx = 0;
  dd.style.display = 'block';
  dd.innerHTML = matches.map((u, i) => `
    <div class="mention-opt${i === 0 ? ' active' : ''}" data-idx="${i}" data-name="${esc(u.nombre)}" data-id="${esc(u.id)}"
         onmousedown="event.preventDefault();insertMention('${esc(u.nombre)}','${esc(u.id)}')"
         onmouseover="setMentionActive(${i})">
      <div style="width:26px;height:26px;border-radius:50%;background:#4f7fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;">${esc(u.nombre.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase())}</div>
      <div>
        <div style="font-size:12px;font-weight:600;color:#fff;">${esc(u.nombre)}</div>
        <div style="font-size:10px;color:var(--text3);">${esc(u.role)}</div>
      </div>
    </div>`).join('');
  dd._matches = matches;
}

function setMentionActive(idx) {
  _mentionActiveIdx = idx;
  document.querySelectorAll('#mention-dropdown .mention-opt').forEach((el, i) =>
    el.classList.toggle('active', i === idx));
}

function insertMention(name, userId) {
  const ta  = document.getElementById('nota-inp');
  const val = ta.value;
  const pos = ta.selectionStart;
  const before = val.slice(0, _mentionStart);
  const after  = val.slice(pos);
  ta.value = before + '@' + name + ' ' + after;
  const newPos = (before + '@' + name + ' ').length;
  ta.setSelectionRange(newPos, newPos);
  ta.focus();
  closeMentionDropdown();
  // Store the userId for later notification dispatch
  if (!ta._pendingMentions) ta._pendingMentions = [];
  ta._pendingMentions.push({ name, userId });
}

function closeMentionDropdown() {
  const dd = document.getElementById('mention-dropdown');
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
  _mentionQuery = null; _mentionStart = -1;
}

function notaKeydown(e) {
  const dd = document.getElementById('mention-dropdown');
  if (!dd || dd.style.display === 'none') {
    if (e.ctrlKey && e.key === 'Enter') addNota();
    return;
  }
  const opts = dd._matches || [];
  if (e.key === 'ArrowDown') {
    e.preventDefault(); setMentionActive(Math.min(_mentionActiveIdx + 1, opts.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); setMentionActive(Math.max(_mentionActiveIdx - 1, 0));
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const sel = opts[_mentionActiveIdx];
    if (sel) insertMention(sel.nombre, sel.id);
  } else if (e.key === 'Escape') {
    closeMentionDropdown();
  }
}

function addNota() {
  const ta    = document.getElementById('nota-inp');
  const texto = ta.value.trim();
  if (!texto || !currentLeadId) return;
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;
  if (!lead.notas) lead.notas = [];
  lead.notas.unshift({ texto, fecha: new Date().toISOString(), autor: currentUser?.name || 'Sistema' });
  addHistorial(currentLeadId, `Nota agregada: "${texto.slice(0,60)}${texto.length>60?'…':''}"`, '📝');
  saveLeads();
  renderNotas(lead.notas);

  // Dispatch notifications for @mentions
  const pendingMentions = ta._pendingMentions || [];
  ta.value = '';
  ta._pendingMentions = [];
  closeMentionDropdown();
  showToast('Nota agregada');

  if (pendingMentions.length) {
    pendingMentions.forEach(m => {
      fetch(`${SERVER_URL}/notifications`, {
        method: 'POST',
        headers: _leadHeaders(),
        body: JSON.stringify({
          user_id:     m.userId,
          lead_id:     lead.id,
          lead_nombre: lead.nombre || lead.telefono || '',
          pipeline_id: lead.pipeline_id || '',
          note_text:   texto,
        }),
      }).catch(() => {});
    });
    showToast(`📣 Notificación enviada a ${pendingMentions.map(m => m.name).join(', ')}`);
  }
}

// ════════════════════════════════════════════
//  TAREAS
// ════════════════════════════════════════════
function renderTareas(tareas) {
  const el = document.getElementById('tareas-list');
  if (!el) return;
  if (!tareas.length) { el.innerHTML = '<div class="empty-tab" style="padding:20px 0"><div class="et-icon">✅</div><p>Sin tareas</p></div>'; return; }
  el.innerHTML = tareas.map((t,i) => `
    <div class="tarea-item">
      <input type="checkbox" class="tarea-check" ${t.done?'checked':''} onchange="toggleTarea(${i})" />
      <span class="tarea-text ${t.done?'done':''}">${esc(t.texto)}</span>
      <button class="tarea-del" onclick="delTarea(${i})">✕</button>
    </div>`).join('');
}
function addTarea() {
  const texto = document.getElementById('tarea-inp').value.trim();
  if (!texto || !currentLeadId) return;
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;
  if (!lead.tareas) lead.tareas = [];
  lead.tareas.push({ id:'t'+Date.now(), texto, done:false });
  saveLeads(); renderTareas(lead.tareas);
  document.getElementById('tarea-inp').value = '';
}
function toggleTarea(i) {
  const lead = leads.find(l => l.id === currentLeadId); if (!lead) return;
  lead.tareas[i].done = !lead.tareas[i].done;
  saveLeads(); renderTareas(lead.tareas);
}
function delTarea(i) {
  const lead = leads.find(l => l.id === currentLeadId); if (!lead) return;
  lead.tareas.splice(i,1);
  saveLeads(); renderTareas(lead.tareas);
}

// ════════════════════════════════════════════
//  PAGOS
// ════════════════════════════════════════════
function renderPagos(pagos) {
  const el = document.getElementById('pagos-list');
  if (!pagos.length) { el.innerHTML = '<div class="empty-tab" style="padding:20px 0"><div class="et-icon">💳</div><p>Sin pagos registrados</p></div>'; return; }
  el.innerHTML = pagos.map(p => `
    <div class="pago-item">
      <div class="pago-left">${esc(p.concepto)}<small>${fmtDate(p.fecha)}</small></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="pago-amount">$${parseFloat(p.monto||0).toFixed(2)}</span>
        <span class="pago-status ${p.pagado?'paid':''}">${p.pagado?'Pagado':'Pendiente'}</span>
      </div>
    </div>`).join('');
}
function addPago() {
  const monto = parseFloat(document.getElementById('pago-monto').value) || 0;
  const concepto = document.getElementById('pago-concepto').value.trim();
  if (!concepto || !currentLeadId) return;
  const lead = leads.find(l => l.id === currentLeadId); if (!lead) return;
  if (!lead.pagos) lead.pagos = [];
  lead.pagos.unshift({ id:'p'+Date.now(), monto, concepto, fecha: new Date().toISOString(), pagado:false });
  saveLeads(); renderPagos(lead.pagos);
  document.getElementById('pago-monto').value = '';
  document.getElementById('pago-concepto').value = '';
  showToast('Pago registrado');
}

// ════════════════════════════════════════════
//  CITA
// ════════════════════════════════════════════
function saveCita() {
  if (!currentLeadId) return;
  const lead = leads.find(l => l.id === currentLeadId); if (!lead) return;
  lead.cita = {
    fecha: document.getElementById('cita-fecha').value,
    hora:  document.getElementById('cita-hora').value,
    tipo:  document.getElementById('cita-tipo').value,
    notas: document.getElementById('cita-notas').value,
  };
  saveLeads(); renderCitaActual(lead.cita);
  showToast('Cita guardada');
}
function renderCitaActual(cita) {
  const el = document.getElementById('cita-actual');
  if (!el) return;
  if (!cita?.fecha) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="nota-item" style="margin-top:12px;">
    <div class="nota-meta">📅 Cita agendada</div>
    <div class="nota-text"><strong>${esc(cita.tipo)}</strong><br>${fmtDate(cita.fecha)} ${cita.hora||''}<br><span style="color:var(--text2)">${esc(cita.notas||'')}</span></div>
  </div>`;
}

// ════════════════════════════════════════════
//  QUICK ACTIONS
// ════════════════════════════════════════════
function quickAction(type, leadId) {
  const lead = leads.find(l => l.id === leadId); if (!lead) return;
  if (type === 'call' && lead.telefono) window.open('tel:'+lead.telefono.replace(/\s/g,''));
  else if (type === 'msg' && lead.telefono) window.open('https://wa.me/'+lead.telefono.replace(/[^0-9]/g,''));
  else showToast('Sin teléfono registrado');
}

// ════════════════════════════════════════════
//  GRABACIONES DE LLAMADAS
// ════════════════════════════════════════════
async function loadRecordings(telefono) {
  const box = document.getElementById('ml-recordings');
  if (!box) return;
  box.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.2);">Cargando…</div>';
  if (!telefono) { box.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.2);">Sin teléfono</div>'; return; }

  try {
    const phone = telefono.replace(/\D/g, '');
    const res   = await fetch(`/recordings?phone=${phone}`);
    const data  = await res.json();
    if (!data.recordings?.length) {
      box.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.2);">Sin grabaciones</div>';
      return;
    }
    box.innerHTML = data.recordings.map(r => {
      const d    = new Date(r.date);
      const fecha = d.toLocaleDateString('es-MX', { month:'short', day:'numeric', year:'2-digit' });
      const hora  = d.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
      const min   = Math.floor(r.duration / 60);
      const seg   = String(r.duration % 60).padStart(2,'0');
      const dur   = min > 0 ? `${min}:${seg} min` : `${r.duration}s`;
      return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:8px 10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:rgba(255,255,255,.5);">${fecha} ${hora}</span>
          <span style="font-size:10px;color:rgba(255,255,255,.3);">${dur}</span>
        </div>
        <audio controls style="width:100%;height:28px;" src="${r.url}"></audio>
      </div>`;
    }).join('');
  } catch(e) {
    box.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.2);">Error al cargar</div>';
  }
}

// ════════════════════════════════════════════
