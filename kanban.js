//  KANBAN (all views now use table layout)
// ════════════════════════════════════════════

// ── Global search ─────────────────────────────────────────────────────────────
let _gsIdx = -1;

function openGlobalSearch() {
  document.getElementById('global-search-overlay').style.display = 'block';
  const inp = document.getElementById('global-search-input');
  inp.value = '';
  _gsIdx = -1;
  document.getElementById('global-search-results').innerHTML = '<div style="padding:28px;text-align:center;color:var(--text2);font-size:13px;">Escribe para buscar…</div>';
  setTimeout(() => inp.focus(), 50);
}

function closeGlobalSearch() {
  document.getElementById('global-search-overlay').style.display = 'none';
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openGlobalSearch(); }
  if (e.key === 'Escape' && document.getElementById('global-search-overlay').style.display !== 'none') closeGlobalSearch();
});

function _gsScore(lead, q) {
  const fields = [
    lead.nombre      || '',
    lead.correo      || '',
    lead.telefono    || '',
    lead.ubicacion   || '',
    lead.fuente      || '',
    lead.propietario || '',
    (lead.notas || []).map(n => n.texto || n).join(' '),
    lead.created_at  ? new Date(lead.created_at).toLocaleDateString('es-MX', {day:'2-digit',month:'long',year:'numeric'}) : '',
    lead.created_at  ? new Date(lead.created_at).toLocaleDateString('es-MX', {day:'2-digit',month:'2-digit',year:'numeric'}) : '',
    lead.etiquetas   ? lead.etiquetas.join(' ') : '',
  ].join(' ').toLowerCase();
  const qWords = q.toLowerCase().trim().split(/\s+/);
  if (!qWords.every(w => fields.includes(w))) return 0;
  // exact name match scores highest
  if ((lead.nombre || '').toLowerCase().includes(q.toLowerCase())) return 3;
  if ((lead.telefono || '').replace(/\D/g,'').includes(q.replace(/\D/g,''))) return 2;
  return 1;
}

function _pipeLabel(pipeId) {
  const p = (typeof PIPELINES !== 'undefined' ? PIPELINES : []).find(p => p.id === pipeId);
  return p ? p.nombre : pipeId || '—';
}

// ── Lead folio: stable short code derived from ID (no DB column needed) ────────
function _leadFolio(id) {
  const digits = (id.match(/\d+/g) || []).join('');
  return '#' + digits.slice(-6);
}

function runGlobalSearch() {
  const q = (document.getElementById('global-search-input').value || '').trim();
  const wrap = document.getElementById('global-search-results');
  _gsIdx = -1;
  if (q.length < 2) {
    wrap.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text2);font-size:13px;">Escribe al menos 2 caracteres…</div>';
    return;
  }
  const scored = (leads || [])
    .map(l => ({ l, s: _gsScore(l, q) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 30);

  if (!scored.length) {
    wrap.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text2);font-size:13px;">Sin resultados para "<strong style=\'color:#fff\'>' + esc(q) + '</strong>"</div>';
    return;
  }

  wrap.innerHTML = scored.map(({ l }, i) => {
    const srcClass = {'Meta / Facebook':'meta','Instagram':'ig','WhatsApp':'wa','Referido':'ref','LinkedIn':'otro','OCC / Indeed':'otro'}[l.fuente]||'otro';
    const date = l.created_at ? new Date(l.created_at).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '';
    const pipe = _pipeLabel(l.pipeline_id);
    const stageClr = stageColor(l.etapa);
    return `<div class="gs-result" data-idx="${i}" data-id="${l.id}" onclick="gsOpen('${l.id}')" onmouseenter="gsHover(${i})">
      <div style="display:flex;align-items:center;gap:10px;padding:9px 18px;cursor:pointer;border-radius:0;transition:background .12s;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <span style="font-weight:700;color:#fff;font-size:13px;">${esc(l.nombre||'Sin nombre')}</span>
            <span class="lt-badge ${srcClass}" style="font-size:9px;">${esc(l.fuente||'')}</span>
            ${l.solicita_entrevista ? '<span style="font-size:9px;color:#00c875;font-weight:700;">🤝 Quiere entrevista</span>' : ''}
            ${l.quiere_entrevista   ? '<span style="font-size:9px;color:#fdab3d;font-weight:700;">🔔 Quiere llamada</span>'   : ''}
          </div>
          <div style="display:flex;gap:12px;margin-top:3px;flex-wrap:wrap;">
            ${l.telefono ? `<span style="color:var(--text2);font-size:11px;">📞 ${esc(l.telefono)}</span>` : ''}
            ${l.correo   ? `<span style="color:var(--text2);font-size:11px;">✉️ ${esc(l.correo)}</span>`   : ''}
            ${l.ubicacion? `<span style="color:var(--text2);font-size:11px;">📍 ${esc(l.ubicacion)}</span>`: ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:10px;color:var(--text2);">${esc(pipe)}</div>
          <div style="margin-top:2px;"><span style="display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:600;background:${stageClr}22;color:${stageClr};border:1px solid ${stageClr}44;">${esc(l.etapa||'')}</span></div>
          <div style="font-size:10px;color:var(--text2);margin-top:2px;">${date}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function gsHover(idx) {
  _gsIdx = idx;
  document.querySelectorAll('.gs-result').forEach((el, i) => {
    el.querySelector('div').style.background = i === idx ? 'rgba(120,75,209,.18)' : '';
  });
}

function globalSearchKey(e) {
  const items = document.querySelectorAll('.gs-result');
  if (e.key === 'ArrowDown') { e.preventDefault(); gsHover(Math.min(_gsIdx + 1, items.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); gsHover(Math.max(_gsIdx - 1, 0)); }
  else if (e.key === 'Enter') {
    const active = document.querySelector(`.gs-result[data-idx="${_gsIdx}"]`);
    if (active) gsOpen(active.dataset.id);
    else if (items.length === 1) gsOpen(items[0].dataset.id);
  }
}

function gsOpen(leadId) {
  closeGlobalSearch();
  // Navigate to the lead's pipeline first, then open modal
  const lead = (leads || []).find(l => l.id === leadId);
  if (lead && lead.pipeline_id && lead.pipeline_id !== activePipelineId) {
    activePipelineId = lead.pipeline_id;
    renderSidebar();
    renderKanban();
  }
  setTimeout(() => openLead(leadId), 100);
}
function renderKanban() {
  if (activeView !== 'kanban') return;
  const pipe = PIPELINES.find(p => p.id === activePipelineId);
  if (!pipe) return;
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const tabsEl   = document.getElementById('pipeline-tabs');
  const tableWrap = document.getElementById('table-view-wrap');
  const kanbanWrap = document.getElementById('kanban-wrap');

  kanbanWrap.style.display = 'none';
  tableWrap.classList.add('active');

  const allTabs  = getPipelineTabs(pipe);
  const curTabId = getPipeTab(activePipelineId);
  const curTab   = allTabs.find(t => t.id === curTabId) || allTabs[0];

  tabsEl.className = 'visible';
  tabsEl.innerHTML = allTabs.map(t => {
    const cnt = leads.filter(l => l.pipeline_id === activePipelineId && t.etapas.some(e => e.v === l.etapa)).length;
    const colorSrc = t.etapas[0]?.v || t.nombre;
    const clr = stageColor(colorSrc);
    const isActive = curTab.id === t.id;
    const activeStyle = isActive ? `border-bottom-color:${clr};color:#fff;` : '';
    return `<div class="ptab${isActive ? ' active' : ''}" style="${activeStyle}" onclick="selectWebinarTab('${t.id}')">
      <span class="ptab-dot" style="background:${clr}"></span>${esc(t.nombre)} <span style="font-size:10px;opacity:.6">(${cnt})</span>
    </div>`;
  }).join('');

  // Ocultar sub-pestañas salvo que la pestaña las tenga
  if (!curTab.subTabs) document.getElementById('pipeline-subtabs').className = '';

  // Webinar → tabla unificada para todas las sub-pestañas
  if (curTab.tableView) {
    const srcClass = s => ({'Meta / Facebook':'meta','Instagram':'ig','WhatsApp':'wa','Referido':'ref'}[s]||'otro');

    // Renderizar sub-pestañas si las hay
    const subTabsEl = document.getElementById('pipeline-subtabs');
    let activeEtapas = curTab.etapas;
    let showEtapaCol = false;
    if (curTab.subTabs) {
      const curSubId = getSubTab(activePipelineId, curTab.id);
      const visibleEtapas = curTab.subTabVisible
        ? curTab.etapas.filter(e => curTab.subTabVisible.includes(e.v))
        : curTab.etapas;
      const allSubs = [{id:'all', nombre:'Todos', etapas: curTab.etapas}]
        .concat(visibleEtapas.map(e => ({id: e.v, nombre: e.l, etapas:[e]})));
      subTabsEl.className = 'visible';
      subTabsEl.innerHTML = allSubs.map(s => {
        const cnt = leads.filter(l => l.pipeline_id === activePipelineId && s.etapas.some(e => e.v === l.etapa)).length;
        const clr = stageColor(s.etapas[0]?.v || s.nombre);
        const isActive = curSubId === s.id;
        return `<div class="ptab2${isActive ? ' active' : ''}" style="${isActive ? `border-bottom-color:${clr};color:#fff;` : ''}" onclick="selectSubTab('${activePipelineId}','${curTab.id}','${s.id}')">
          <span class="ptab2-dot" style="background:${clr}"></span>${esc(s.nombre)} <span style="font-size:10px;opacity:.6">(${cnt})</span>
        </div>`;
      }).join('');
      const activeSub = allSubs.find(s => s.id === curSubId) || allSubs[0];
      activeEtapas = activeSub.etapas;
      showEtapaCol = activeSub.id === 'all';
    } else {
      subTabsEl.className = '';
    }

    const tableEtapas = activeEtapas.map(e => e.v);
    const rows = leads.filter(ld =>
      ld.pipeline_id === activePipelineId &&
      (tableEtapas.includes(ld.etapa) || (curTab.id === 'inscrito' && ld.inscrito_webinar && ld.pipeline_id === 'en-webinar')) &&
      (!q || [ld.nombre, ld.correo, ld.telefono, ld.fuente, ld.nombre_lead].join(' ').toLowerCase().includes(q)) &&
      (currentUser?.role === 'developer' || !ld.invisible)
    ).map(ld => { const eo = curTab.etapas.find(e => e.v === ld.etapa); return {...ld, _etapaLabel: eo ? eo.l : ld.etapa}; });

    const noticeHtml = curTab.id === 'no-asistente'
      ? `<div style="margin-bottom:14px;padding:12px 16px;background:rgba(253,171,61,.08);border:1px solid rgba(253,171,61,.25);border-radius:10px;font-size:12.5px;color:#fdab3d;line-height:1.6;">
          <strong>ℹ️ ¿Qué es No Asistente?</strong> Los candidatos aquí fueron inscritos en el webinar. Pasadas <strong>24 horas</strong> sin haber visto el video, entran automáticamente a esta sección.
         </div>` : '';

    const colSpan = showEtapaCol ? 13 : 12;
    tableWrap.innerHTML = noticeHtml + `
      <table class="leads-table">
        <thead><tr>
          <th>Folio</th><th>Nombre</th><th>Correo</th><th style="text-align:center">Ana</th><th>Teléfono</th><th>Fuente</th>
          <th>Ubicación</th><th>Inscrito por</th><th>Fecha de inscripción</th>
          ${showEtapaCol ? '<th>Etapa</th>' : ''}
          <th>Avance</th><th>% Visto</th><th>Tiempo visto</th><th>Link Webinar</th><th>Acciones</th>
        </tr></thead>
        <tbody>${rows.length ? rows.map((ld, i) => {
          const accion = ld.webinar_accion || 'sin-registro';
          const accionLabel = accion==='asistente'?'ASISTENTE':accion==='no-asistente'?'NO ASISTENTE':accion==='en-entrevista'?'EN ENTREVISTA':accion==='no-interesado'?'NO INTERESADO':accion==='no-califica'?'NO CALIFICA':'SIN REGISTRO';
          const resuelto = accion !== 'sin-registro' ? 'lead-resuelto' : '';
          const fechaIns = ld.fecha_inscripcion_webinar ? new Date(ld.fecha_inscripcion_webinar).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—';
          const icon = accion==='asistente'?`<span class="lead-status-icon asistente">✓</span>`:accion==='no-asistente'?`<span class="lead-status-icon no-asistente">✗</span>`:'';
          const pct = ld.webinar_visto_pct != null ? Number(ld.webinar_visto_pct) : null;
          const pctColor = pct == null ? 'var(--text2)' : pct >= 50 ? '#00c875' : pct >= 25 ? '#0073ea' : '#e2445c';
          const pctHtml = pct != null ? `<span style="font-weight:700;color:${pctColor}">${pct}%</span>` : `<span style="color:var(--text2)">—</span>`;
          const segs = ld.webinar_tiempo_visto != null ? Number(ld.webinar_tiempo_visto) : null;
          const tiempoHtml = segs != null && segs > 0
            ? (() => { const m = Math.floor(segs/60), s = Math.round(segs%60); return `<span style="color:var(--text);font-weight:600">${m}m ${s.toString().padStart(2,'0')}s</span>`; })()
            : `<span style="color:var(--text2)">—</span>`;
          const clr = stageColor(ld.etapa);
          const llamadaBadge = ld.quiere_entrevista
            ? `<span onclick="event.stopPropagation();dismissLlamada('${ld.id}')" title="Clic para marcar como atendido" style="display:inline-flex;align-items:center;gap:4px;background:rgba(253,171,61,.15);border:1px solid rgba(253,171,61,.4);color:#fdab3d;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;cursor:pointer;animation:blink-dot 1.4s ease-in-out infinite;">🔔 Quiere llamada</span>`
            : '';
          const sinMgrBadge = ld.sin_manager
            ? `<span onclick="event.stopPropagation();dismissSinManager('${ld.id}')" title="Marcar como atendido" style="display:inline-flex;align-items:center;gap:4px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#f87171;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;cursor:pointer;animation:blink-dot 1.4s ease-in-out infinite;">🚨 Sin manager</span>`
            : '';
          const ivBadgeW = ld.solicita_entrevista
            ? `<span onclick="event.stopPropagation();dismissSolicitaEntrevista('${ld.id}')" title="Marcar como atendido" style="display:inline-flex;align-items:center;gap:4px;background:rgba(0,200,117,.15);border:1px solid rgba(0,200,117,.4);color:#00c875;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;cursor:pointer;animation:blink-dot 1.4s ease-in-out infinite;">🤝 Quiere entrevista</span>`
            : '';
          return `<tr class="${resuelto}${ld.quiere_entrevista ? ' tr-llamada-alert' : ''}${ld.sin_manager ? ' tr-sinmgr-alert' : ''}${ld.solicita_entrevista ? ' tr-iv-alert' : ''}" onclick="openLead('${ld.id}')" ${ld.invisible ? 'style="opacity:.45;border-left:2px dashed rgba(148,163,184,.4);"' : ''}>
            <td style="color:var(--text2);display:flex;align-items:center;gap:6px;min-height:36px;font-size:10px;font-family:monospace">${icon}${_leadFolio(ld.id)}</td>
            <td style="font-weight:600;color:#fff">${esc(ld.nombre)}${sinMgrBadge ? '<br>'+sinMgrBadge : ''}${ivBadgeW ? '<br>'+ivBadgeW : ''}${llamadaBadge ? '<br>'+llamadaBadge : ''}</td>
            <td style="color:var(--text2)">${esc(ld.correo||'')}</td>
            <td style="text-align:center" title="${ld.ia_paused ? 'Ana pausada' : 'Ana activa'}">
              ${ld.ia_paused
                ? '<span style="background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.3);border-radius:20px;padding:1px 5px;font-size:9px;font-weight:600;white-space:nowrap">⏸ Pausada</span>'
                : '<span style="background:rgba(0,200,117,.12);color:#00c875;border:1px solid rgba(0,200,117,.25);border-radius:20px;padding:1px 5px;font-size:9px;font-weight:600;white-space:nowrap">🤖 Activa</span>'}
            </td>
            <td>${esc(ld.telefono||'')}</td>
            <td><span class="lt-badge ${srcClass(ld.fuente)}">${esc(ld.fuente||'')}</span></td>
            <td style="color:var(--text2)">${esc(ld.ubicacion||'—')}</td>
            <td style="color:#c4a8ff;font-weight:600">${esc(ld.inscrito_por||ld.propietario||'—')}</td>
            <td style="color:var(--text2);white-space:nowrap">${fechaIns}</td>
            ${showEtapaCol ? `<td><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:600;background:${clr}22;color:${clr};border:1px solid ${clr}44">${esc(ld._etapaLabel)}</span></td>` : ''}
            <td style="white-space:nowrap">${(() => { const p=calcProgreso(ld); const c=p>=100?'#fbbf24':p>=70?'#00c875':p>=40?'#4f7fff':'#8890a4'; return `<span style="font-size:13px;font-weight:800;color:${c};">${p}%</span>`; })()}</td>
            <td>${pctHtml}</td>
            <td>${tiempoHtml}</td>
            <td onclick="event.stopPropagation()" style="white-space:nowrap">
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                <button onclick="copyWebinarLink('${ld.id}','${encodeURIComponent(ld.nombre||'')}','${encodeURIComponent(ld.correo||'')}')" style="padding:3px 8px;background:rgba(0,115,234,.15);border:1px solid rgba(0,115,234,.3);color:#0073ea;border-radius:5px;font-size:11px;cursor:pointer;font-family:var(--font);">📋 Copiar</button>
                <button onclick="enviarLinkPorCorreo('${ld.id}')" title="${ld.webinar_email_enviado ? 'Enviado el '+new Date(ld.webinar_email_enviado).toLocaleDateString('es-MX',{day:'2-digit',month:'short'}) : 'Enviar link por correo'}" style="padding:3px 8px;background:${ld.webinar_email_enviado ? 'rgba(0,200,117,.15)' : 'rgba(120,75,209,.15)'};border:1px solid ${ld.webinar_email_enviado ? 'rgba(0,200,117,.3)' : 'rgba(120,75,209,.3)'};color:${ld.webinar_email_enviado ? '#00c875' : '#a78bfa'};border-radius:5px;font-size:11px;cursor:pointer;font-family:var(--font);">${ld.webinar_email_enviado ? '✅ Enviado' : '📧 Enviar'}</button>
              </div>
            </td>
            <td onclick="event.stopPropagation()" style="overflow:visible;position:relative;">
              <div class="lt-accion-btn">
                <button class="lt-accion-trigger ${accion}" onclick="toggleAccionMenu(event,'${ld.id}')">${accionLabel} ▾</button>
                <div class="lt-accion-menu" id="accion-menu-${ld.id}">
                  ${(() => {
                    const etapa = ld.etapa;
                    if (etapa === 'En Webinar sin actividad') {
                      return `<div style="padding:4px 10px 2px;font-size:10px;color:var(--text2);font-weight:600;letter-spacing:.5px">MOVER A SIGUIENTE ETAPA</div>
                        <div class="lt-accion-opt" style="color:#00c875;font-weight:700" onclick="event.stopPropagation();moveLead('${ld.id}','AS - Asistente');closeAccionMenu('${ld.id}')">✅ Asistente (vio el webinar)</div>
                        <div class="lt-accion-opt" style="color:#fdab3d;font-weight:700" onclick="event.stopPropagation();moveLead('${ld.id}','NA - No Asistente');closeAccionMenu('${ld.id}')">✗ No Asistente (no lo vio)</div>
                        <div style="border-top:1px solid var(--border);margin:3px 0"></div>`;
                    }
                    const next = WEBINAR_PROGRESSIONS[etapa];
                    if (next) {
                      const nextLabel = next.replace(/^(?:AS|NA) - /, '');
                      const color = next.startsWith('NA') ? '#fdab3d' : '#4f7fff';
                      return `<div style="padding:4px 10px 2px;font-size:10px;color:var(--text2);font-weight:600;letter-spacing:.5px">MOVER A SIGUIENTE ETAPA</div>
                        <div class="lt-accion-opt" style="color:${color};font-weight:700" onclick="event.stopPropagation();moveLead('${ld.id}','${next.replace(/'/g,"\\'")}');closeAccionMenu('${ld.id}')">➡️ ${esc(nextLabel)}</div>
                        <div style="border-top:1px solid var(--border);margin:3px 0"></div>`;
                    }
                    return '';
                  })()}
                  <div class="lt-accion-opt opt-en-entrevista"   onclick="event.stopPropagation();setWebinarAccion('${ld.id}','en-entrevista')">🗓️ EN ENTREVISTA</div>
                  <div class="lt-accion-opt opt-asistente"      onclick="event.stopPropagation();setWebinarAccion('${ld.id}','asistente')">✅ ASISTENTE</div>
                  <div class="lt-accion-opt opt-no-asistente"   onclick="event.stopPropagation();setWebinarAccion('${ld.id}','no-asistente')">✗ NO ASISTENTE</div>
                  <div class="lt-accion-opt opt-no-interesado"  onclick="event.stopPropagation();setWebinarAccion('${ld.id}','no-interesado')">👎 NO INTERESADO</div>
                  <div class="lt-accion-opt opt-no-califica"    onclick="event.stopPropagation();setWebinarAccion('${ld.id}','no-califica')">🚫 NO CALIFICA</div>
                  <div class="lt-accion-opt opt-sin-registro"   onclick="event.stopPropagation();setWebinarAccion('${ld.id}','sin-registro')">— SIN REGISTRO</div>
                  <div style="border-top:1px solid var(--border);margin:3px 0"></div>
                  <div class="lt-accion-opt" style="color:#a5b4fc" onclick="event.stopPropagation();openAgendarCitaModal('${ld.id}')">📅 Agendar entrevista</div>
                  ${currentUser?.role === 'developer' ? `<div style="border-top:1px solid var(--border);margin:3px 0"></div>
                  <div class="lt-accion-opt" style="color:${ld.invisible ? '#00c875' : '#94a3b8'}" onclick="event.stopPropagation();toggleInvisible('${ld.id}')">${ld.invisible ? '👁 Hacer visible' : '👁‍🗨 Ocultar (solo admin)'}</div>` : ''}
                  <div style="border-top:1px solid var(--border);margin:3px 0"></div>
                  <div class="lt-accion-opt" style="color:#f87171" onclick="event.stopPropagation();_openMenuLeadId='${ld.id}';deleteLeadFull()">🗑️ Eliminar todos los datos</div>
                </div>
              </div>
            </td>
          </tr>`;
        }).join('') : `<tr><td colspan="${colSpan}" style="text-align:center;padding:40px;color:var(--text2)">Sin leads en esta sección</td></tr>`}
        </tbody>
      </table>`;
    initResizableCols('webinar-' + curTab.id);
    return;
  }

  // Todos los demás pipelines → tabla universal
  const subTabsEl = document.getElementById('pipeline-subtabs');
  if (curTab.subTabs) {
    const curSubId = getSubTab(activePipelineId, curTab.id);
    const visibleEtapas = curTab.subTabVisible
      ? curTab.etapas.filter(e => curTab.subTabVisible.includes(e.v))
      : curTab.etapas;
    const allSubs = [{id:'all', nombre:'Todos', etapas: curTab.etapas}]
      .concat(visibleEtapas.map(e => ({id: e.v, nombre: e.l, etapas:[e]})));
    subTabsEl.className = 'visible';
    subTabsEl.innerHTML = allSubs.map(s => {
      const cnt = leads.filter(l => l.pipeline_id === activePipelineId && s.etapas.some(e => e.v === l.etapa)).length;
      const clr = stageColor(s.etapas[0]?.v || s.nombre);
      const isActive = curSubId === s.id;
      return `<div class="ptab2${isActive ? ' active' : ''}" style="${isActive ? `border-bottom-color:${clr};color:#fff;` : ''}" onclick="selectSubTab('${activePipelineId}','${curTab.id}','${s.id}')">
        <span class="ptab2-dot" style="background:${clr}"></span>${esc(s.nombre)} <span style="font-size:10px;opacity:.6">(${cnt})</span>
      </div>`;
    }).join('');
    const activeSub = allSubs.find(s => s.id === curSubId) || allSubs[0];
    renderUniversalTable(activeSub.etapas, activePipelineId, q, activeSub.etapas.length > 1);
  } else {
    subTabsEl.className = '';
    renderUniversalTable(curTab.etapas, activePipelineId, q, curTab.etapas.length > 1);
  }
  initResizableCols(activePipelineId + ':' + curTab.id);
}

function renderUniversalTable(stageDefs, pipelineId, q, showEtapa) {
  const srcClass = s => ({'Meta / Facebook':'meta','Instagram':'ig','WhatsApp':'wa','Referido':'ref','LinkedIn':'otro','OCC / Indeed':'otro'}[s]||'otro');
  const rows = stageDefs.flatMap(({v, l: label}) =>
    leads.filter(ld =>
      ld.pipeline_id === pipelineId && ld.etapa === v &&
      (!q || [ld.nombre,ld.correo,ld.telefono,ld.fuente,ld.nombre_lead].join(' ').toLowerCase().includes(q)) &&
      (currentUser?.role === 'developer' || !ld.invisible)
    ).map(ld => ({...ld, _etapaLabel: label}))
  );
  const isEntrevistas = pipelineId === 'entrevistas-generales';
  const extraCols = isEntrevistas ? 3 : 0;
  const cols = (showEtapa ? 11 : 10) + extraCols;

  const resultadoColor = r => ({
    'Contratado':      '#00c875',
    'No contratado':   '#e2445c',
    'No show':         '#f97316',
    'Reagenda':        '#facc15',
    'No califica':     '#94a3b8',
    'No interesado':   '#64748b',
  }[r] || '#8890a4');

  document.getElementById('table-view-wrap').innerHTML = `
    <table class="leads-table">
      <thead><tr>
        <th>Folio</th>
        <th>Nombre</th>
        <th>Correo</th>
        <th style="text-align:center;width:60px">Ana</th>
        <th>Teléfono</th>
        <th>Fuente</th>
        ${showEtapa ? '<th>Etapa</th>' : ''}
        <th>Avance</th>
        <th>Propietario</th>
        <th>Ubicación</th>
        <th>Fecha</th>
        <th>Notas</th>
        ${isEntrevistas ? '<th>Fecha / Hora Entrevista</th><th>Resultado</th><th>Manager</th>' : ''}
        <th>Acciones</th>
      </tr></thead>
      <tbody>${rows.length ? rows.map((ld, i) => {
        const date = ld.created_at ? new Date(ld.created_at).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '';
        const notasCnt = (ld.notas||[]).length;
        const clr = stageColor(ld.etapa);

        let interviewSlotHtml = '';
        if (isEntrevistas) {
          // Convert stored ISO to datetime-local value (in Chicago time)
          let dtLocalVal = '';
          let displayStr = '';
          if (ld.interview_slot) {
            const slotD = new Date(ld.interview_slot);
            displayStr = slotD.toLocaleDateString('es-MX',{weekday:'short',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'America/Chicago'});
            // datetime-local needs local browser value; store as ISO
            const pad = n => String(n).padStart(2,'0');
            const local = new Date(slotD.toLocaleString('en-US',{timeZone:'America/Chicago'}));
            dtLocalVal = `${local.getFullYear()}-${pad(local.getMonth()+1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
          }
          interviewSlotHtml = `<div style="display:flex;flex-direction:column;gap:2px;">
            ${displayStr ? `<span style="color:#c4a8ff;font-weight:600;font-size:11px;white-space:nowrap">${esc(displayStr)}</span>` : ''}
            <input type="datetime-local" value="${dtLocalVal}"
              onchange="updateInterviewSlot('${ld.id}',this.value)"
              onclick="event.stopPropagation()"
              style="background:var(--card2);border:1px solid var(--border);color:var(--text2);border-radius:6px;padding:2px 5px;font-size:10px;width:155px;outline:none;cursor:pointer;" />
          </div>`;
        }

        const resultado = ld.resultado_entrevista || '';
        const rColor = resultadoColor(resultado);
        const resultadoHtml = isEntrevistas ? `
          <select onchange="updateLeadField('${ld.id}','resultado_entrevista',this.value)" onclick="event.stopPropagation()"
            style="background:${resultado ? rColor+'22' : 'var(--card2)'};border:1px solid ${resultado ? rColor+'66' : 'var(--border)'};color:${resultado ? rColor : 'var(--text2)'};border-radius:6px;padding:3px 6px;font-size:11px;font-weight:700;cursor:pointer;outline:none;">
            <option value="" ${!resultado?'selected':''}>— Pendiente —</option>
            <option value="Contratado"    ${resultado==='Contratado'?'selected':''}>✅ Contratado</option>
            <option value="No contratado" ${resultado==='No contratado'?'selected':''}>❌ No contratado</option>
            <option value="No show"       ${resultado==='No show'?'selected':''}>👻 No show</option>
            <option value="Reagenda"      ${resultado==='Reagenda'?'selected':''}>🔄 Reagenda</option>
            <option value="No califica"   ${resultado==='No califica'?'selected':''}>🚫 No califica</option>
            <option value="No interesado" ${resultado==='No interesado'?'selected':''}>👋 No interesado</option>
          </select>` : '';

        const manager = ld.manager_entrevista || '';
        const managerHtml = isEntrevistas ? `
          <input type="text" value="${esc(manager)}" placeholder="Asignar manager…"
            onblur="updateLeadField('${ld.id}','manager_entrevista',this.value)"
            onkeydown="if(event.key==='Enter'){this.blur()}"
            onclick="event.stopPropagation()"
            style="background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 8px;font-size:11px;width:130px;outline:none;" />` : '';

        return `<tr onclick="openLead('${ld.id}')" ${ld.invisible ? 'style="opacity:.45;border-left:2px dashed rgba(148,163,184,.4);"' : ''}>
          <td style="color:var(--text2);font-size:10px;font-family:monospace">${_leadFolio(ld.id)}</td>
          <td style="font-weight:600;color:#fff">${esc(ld.nombre)}</td>
          <td style="color:var(--text2)">${esc(ld.correo||'')}</td>
          <td style="text-align:center" title="${ld.ia_paused ? 'Ana pausada' : 'Ana activa'}">
            ${ld.ia_paused
              ? '<span style="background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.3);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:600;white-space:nowrap">⏸ Pausada</span>'
              : '<span style="background:rgba(0,200,117,.12);color:#00c875;border:1px solid rgba(0,200,117,.25);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:600;white-space:nowrap">🤖 Activa</span>'}
          </td>
          <td>${esc(ld.telefono||'')}</td>
          <td><span class="lt-badge ${srcClass(ld.fuente)}">${esc(ld.fuente||'')}</span></td>
          ${showEtapa ? `<td><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:600;background:${clr}22;color:${clr};border:1px solid ${clr}44">${esc(ld._etapaLabel)}</span></td>` : ''}
          <td style="white-space:nowrap">${(() => { const p=calcProgreso(ld); const c=p>=100?'#fbbf24':p>=70?'#00c875':p>=40?'#4f7fff':'#8890a4'; return `<span style="font-size:13px;font-weight:800;color:${c};">${p}%</span>`; })()}</td>
          <td style="color:var(--text2)">${esc(ld.propietario||'—')}</td>
          <td style="color:var(--text2)">${esc(ld.ubicacion||'—')}</td>
          <td style="color:var(--text2);white-space:nowrap">${date}</td>
          <td>${notasCnt?`<span style="background:rgba(0,115,234,.18);color:#4da6ff;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600">${notasCnt}</span>`:'<span style="color:var(--text2);font-size:10px">—</span>'}</td>
          ${isEntrevistas ? `<td onclick="event.stopPropagation()">${interviewSlotHtml}</td><td onclick="event.stopPropagation()">${resultadoHtml}</td><td onclick="event.stopPropagation()">${managerHtml}</td>` : ''}
          <td onclick="event.stopPropagation()">
            <div class="lt-actions">
              <button class="lt-btn" onclick="quickAction('call','${ld.id}')">📞</button>
              <button class="lt-btn" onclick="quickAction('msg','${ld.id}')">💬</button>
              <button class="lt-btn" onclick="openLead('${ld.id}','notas')">📝</button>
              <button class="lt-btn" onclick="openLead('${ld.id}','tareas')">✅</button>
              <button class="lt-btn" onclick="toggleMoveMenu(event,'${ld.id}')">Mover ↕</button>
              <button class="lt-btn" style="color:#f87171;" onclick="openNoInteresado('${ld.id}')">✗ NI</button>
            </div>
          </td>
        </tr>`;
      }).join('') : `<tr><td colspan="${cols}" style="text-align:center;padding:40px;color:var(--text2)">Sin leads en esta etapa</td></tr>`}
      </tbody>
    </table>`;
}

function updateLeadField(leadId, field, value) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  if (lead[field] === value) return;
  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
  lead[field] = value;
  saveLeads(leadId);
  renderKanban();
}

function updateInterviewSlot(leadId, datetimeLocalValue) {
  if (!datetimeLocalValue) return;
  // datetime-local value is in browser local time → store as ISO
  const isoSlot = new Date(datetimeLocalValue).toISOString();
  updateLeadField(leadId, 'interview_slot', isoSlot);
}

function calcProgreso(lead) {
  const etapa = (lead.etapa || '').toLowerCase();
  let max = 5;
  // 10%
  if (lead.nombre && !lead.nombre.startsWith('WA ') && !lead.nombre.startsWith('+') && lead.ubicacion) max = Math.max(max, 10);
  // 20%
  if (lead.tiene_experiencia === true) max = Math.max(max, 20);
  // 45%
  if (lead.webinar_intent === true) max = Math.max(max, 45);
  // 50%
  if (lead.tiene_papeles === true && lead.mayor_edad === true) max = Math.max(max, 50);
  // 60%
  if (lead.correo) max = Math.max(max, 60);
  // 70%
  if (lead.webinar_visto === true || lead.vio_webinar === true || (lead.pipeline_id === 'en-webinar' && lead.etapa !== 'En Webinar sin actividad')) max = Math.max(max, 70);
  // 80%
  if ((lead.cita && lead.cita.fecha) || ['entrevistas-generales','caritza-rojas','maria-lugo','brayan-alexander'].includes(lead.pipeline_id)) max = Math.max(max, 80);
  // 100%
  if (/asist|ENTREVISTADO|ENTREVISTADA/i.test(lead.etapa || '')) max = Math.max(max, 100);
  return max;
}

function renderCard(l) {
  const sourceBadgeClass = {
    'Meta / Facebook':'meta','Instagram':'ig','WhatsApp':'wa','Referido':'ref','LinkedIn':'otro','OCC / Indeed':'otro','Otro':'otro'
  }[l.fuente] || 'otro';
  const initials = l.propietario ? l.propietario.split(' ').map(w=>w[0]).join('').slice(0,2) : '?';
  const tagsHtml = (l.etiquetas||[]).slice(0,2).map(t=>`<span class="kc-tag">${esc(t)}</span>`).join('');
  const dateStr = l.created_at ? new Date(l.created_at).toLocaleDateString('es-MX',{day:'2-digit',month:'short'}) : '';

  const llamadaAlert = l.quiere_entrevista
    ? `<div class="kcard-llamada-alert">
        <span class="kcard-llamada-dot"></span>
        Quiere ser llamado
        <button class="kcard-llamada-dismiss" title="Marcar como visto" onclick="event.stopPropagation();dismissLlamada('${l.id}')">✕</button>
       </div>`
    : '';

  const sinMgrAlert = l.sin_manager
    ? `<div class="kcard-sinmgr-alert">
        <span class="kcard-llamada-dot" style="background:#ef4444"></span>
        Sin manager disponible
        <button class="kcard-llamada-dismiss" style="color:rgba(239,68,68,.6)" title="Marcar como atendido" onclick="event.stopPropagation();dismissSinManager('${l.id}')">✕</button>
       </div>`
    : '';

  const ivAlert = l.solicita_entrevista
    ? `<div class="kcard-llamada-alert" style="background:rgba(0,200,117,.1);border-color:rgba(0,200,117,.3);">
        <span class="kcard-llamada-dot" style="background:#00c875"></span>
        Quiere entrevista
        <button class="kcard-llamada-dismiss" title="Marcar como atendido" onclick="event.stopPropagation();dismissSolicitaEntrevista('${l.id}')">✕</button>
       </div>`
    : '';

  const now24h = Date.now() - 24 * 60 * 60 * 1000;
  const isActive = l.last_msg_ts && Number(l.last_msg_ts) > now24h;
  const unreadAlert = l.unread_msg
    ? `<div class="kcard-unread-alert">
        <span class="kcard-unread-dot"></span>
        Mensaje sin responder
        <button class="kcard-llamada-dismiss" title="Marcar como leído" onclick="event.stopPropagation();dismissUnread('${l.id}')">✕</button>
       </div>`
    : '';

  const prog = calcProgreso(l);
  const progColor = prog >= 100 ? '#fbbf24' : prog >= 70 ? '#00c875' : prog >= 40 ? '#4f7fff' : '#8890a4';

  return `
  <div class="kcard${l.quiere_entrevista ? ' kcard--alert' : ''}${l.sin_manager ? ' kcard--sinmgr' : ''}${l.unread_msg ? ' kcard--unread' : ''}${l.solicita_entrevista ? ' kcard--iv' : ''}${l.invisible ? ' kcard--invisible' : ''}" draggable="true" id="kcard-${l.id}"
       ondragstart="handleDragStart(event,'${l.id}')"
       ondragend="this.classList.remove('dragging')"
       onclick="openLead('${l.id}')">
    ${sinMgrAlert}${ivAlert}${llamadaAlert}${unreadAlert}
    <div class="kc-top">
      <div class="kc-name">${esc(l.nombre)}${isActive ? '<span class="kc-active-dot" title="Conversación activa en últimas 24h"></span>' : ''}</div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;">
        <span style="font-size:8px;font-weight:700;letter-spacing:.8px;color:var(--text2);text-transform:uppercase;line-height:1;">AVANCE</span>
        <span style="font-size:20px;font-weight:900;color:${progColor};line-height:1;">${prog}%</span>
      </div>
    </div>
    <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin:4px 0 6px;">
      <div style="height:100%;width:${prog}%;background:${progColor};border-radius:2px;transition:width .4s;"></div>
    </div>
    <div class="kc-mid">
      <span class="kc-badge ${sourceBadgeClass}">${esc(l.fuente||'')}</span>
      ${l.wa_inbox_number ? `<span style="font-size:9px;color:rgba(99,214,141,.7);background:rgba(99,214,141,.08);border:1px solid rgba(99,214,141,.2);border-radius:4px;padding:1px 5px;font-weight:600;">📲 +${esc(l.wa_inbox_number)}</span>` : ''}
      ${tagsHtml}
    </div>
    <div class="kc-bottom">
      <div class="kc-avatar" title="${esc(l.propietario||'')}">${esc(initials)}</div>
      <div class="kc-date">${dateStr}</div>
      <div class="kc-actions">
        <button class="kca-btn" title="Llamar" onclick="event.stopPropagation();quickAction('call','${l.id}')">📞</button>
        <button class="kca-btn" title="Mensaje" onclick="event.stopPropagation();quickAction('msg','${l.id}')">💬</button>
        <button class="kca-btn" title="Notas" onclick="event.stopPropagation();openLead('${l.id}','notas')">📝</button>
        <button class="kca-btn" title="Tareas" onclick="event.stopPropagation();openLead('${l.id}','tareas')">✅</button>
        <button class="kca-btn" title="Agendar cita" onclick="event.stopPropagation();openLead('${l.id}','cita')">📅</button>
        <button class="kca-btn-move" title="Mover etapa" onclick="event.stopPropagation();toggleMoveMenu(event,'${l.id}')">Mover ↕</button>
        <button class="kca-btn" title="No interesado / No califica" style="color:#f87171;" onclick="event.stopPropagation();openNoInteresado('${l.id}')">✗ NI</button>
      </div>
    </div>
  </div>`;
}

let _openMenuLeadId = null;

function toggleMoveMenu(event, leadId) {
  const menu = document.getElementById('global-move-menu');
  // Si ya está abierto para este lead, ciérralo
  if (_openMenuLeadId === leadId && menu.classList.contains('open')) {
    closeAllMenus(); return;
  }
  _openMenuLeadId = leadId;

  // Poblar opciones
  const lead = leads.find(l => l.id === leadId);
  const pipe = PIPELINES.find(p => p.id === lead?.pipeline_id);
  const etapas = pipe?.etapas || [];
  const etapaActual = lead?.etapa || '';
  const esPostulados    = ['postulados-meta','postulados-indeed','postulados-whatsapp-meta'].includes(lead?.pipeline_id);
  const estaEnNewLead   = /^new lead$/i.test(etapaActual);
  const estaEn1er       = /^1er intento de contacto$/i.test(etapaActual);
  const estaEn2do       = /^2do intento de contacto$/i.test(etapaActual);
  const estaEn3er       = /^3er intento de contacto$/i.test(etapaActual);
  const esModoSimplificado = esPostulados && (estaEnNewLead || estaEn1er || estaEn2do || estaEn3er);
  const esWebinarIntento = lead?.pipeline_id === 'en-webinar' && Object.prototype.hasOwnProperty.call(WEBINAR_PROGRESSIONS, etapaActual);

  // Ocultar botón global "En Webinar" en modo simplificado (se pone dentro del menú)
  const webinarSection = document.getElementById('move-menu-webinar-section');
  if (webinarSection) webinarSection.style.display = (lead?.pipeline_id === 'en-webinar' || esModoSimplificado || esWebinarIntento) ? 'none' : '';

  // Botón invisible — solo para developer/admin
  const invisBtn = document.getElementById('move-menu-invisible-btn');
  if (invisBtn) {
    if (currentUser?.role === 'developer') {
      const isInvis = lead?.invisible;
      invisBtn.style.display = 'flex';
      invisBtn.textContent   = isInvis ? '👁 Hacer visible' : '👁‍🗨 Ocultar (solo admin)';
      invisBtn.style.borderColor = isInvis ? '#00c875' : '#94a3b8';
      invisBtn.style.color       = isInvis ? '#00c875' : '#94a3b8';
    } else {
      invisBtn.style.display = 'none';
    }
  }

  if (esWebinarIntento) {
    const siguienteEtapa = WEBINAR_PROGRESSIONS[etapaActual];
    const esNA = etapaActual.startsWith('NA - ');
    const noRespondioBtn = siguienteEtapa
      ? `<div class="move-option" onclick="moveLead('${leadId}','${siguienteEtapa.replace(/'/g,"\\'")}');closeAllMenus()">
          <span class="move-option-dot" style="background:#fdab3d"></span>
          <span>No respondió la llamada</span>
        </div>`
      : `<div class="move-option" onclick="moveWebinarNoContactado('${leadId}');closeAllMenus()">
          <span class="move-option-dot" style="background:#676a82"></span>
          <span>No respondió / Sin contacto</span>
        </div>`;
    const reinscritoBtn = esNA
      ? `<div class="move-option" onclick="moveReinscritoWebinar('${leadId}');closeAllMenus()">
          <span class="move-option-dot" style="background:#784bd1"></span>
          <span>Reinscrito en Webinar</span>
        </div>`
      : '';
    const niContext = esNA ? 'webinar-na' : 'webinar-as';
    const ncContext = esNA ? 'webinar-na' : 'webinar-as';
    document.getElementById('move-menu-options').innerHTML = `
      ${noRespondioBtn}
      ${reinscritoBtn}
      <div class="move-option" onclick="moveParaEntrevista('${leadId}');closeAllMenus()">
        <span class="move-option-dot" style="background:#00c875"></span>
        <span>Para Entrevista</span>
      </div>
      <div style="border-top:1px solid var(--border);margin:4px 0"></div>
      <div class="move-option-special no-interesado" onclick="openNoInteresado('${leadId}','${niContext}')">
        <span class="move-option-dot" style="background:#fdab3d"></span>
        <span>No interesado</span>
      </div>
      <div class="move-option-special no-califica" onclick="openNoCalifica('${leadId}','${ncContext}')">
        <span class="move-option-dot" style="background:#e2445c"></span>
        <span>No califica</span>
      </div>`;
  } else if (esModoSimplificado) {
    let siguienteEtapa = null;
    if (estaEnNewLead) siguienteEtapa = etapas.find(e => /^1er intento de contacto$/i.test(e));
    if (estaEn1er)     siguienteEtapa = etapas.find(e => /^2do intento de contacto$/i.test(e));
    if (estaEn2do)     siguienteEtapa = etapas.find(e => /^3er intento de contacto$/i.test(e));

    // "No respondió" → siguiente etapa o no-contactados en 3er
    const noRespondioBtn = estaEn3er
      ? `<div class="move-option" onclick="moveNoContactado('${leadId}');closeAllMenus()">
          <span class="move-option-dot" style="background:#676a82"></span>
          <span>No respondió / No contactado</span>
        </div>`
      : siguienteEtapa
        ? `<div class="move-option" onclick="moveLead('${leadId}','${siguienteEtapa.replace(/'/g,"\\'")}');closeAllMenus()">
            <span class="move-option-dot" style="background:#fdab3d"></span>
            <span>No contestó la llamada</span>
          </div>`
        : '';

    // No interesado / No califica solo en 1er, 2do, 3er (no en New Lead)
    const extraOpts = (!estaEnNewLead) ? `
      <div style="border-top:1px solid var(--border);margin:4px 0"></div>
      <div class="move-option-special no-interesado" onclick="openNoInteresado('${leadId}')">
        <span class="move-option-dot" style="background:#fdab3d"></span>
        <span>No interesado</span>
      </div>
      <div class="move-option-special no-califica" onclick="openNoCalifica('${leadId}')">
        <span class="move-option-dot" style="background:#e2445c"></span>
        <span>No califica</span>
      </div>` : '';

    const webinarBtn = `
      <div style="padding:8px 13px;border-top:1px solid var(--border);">
        <button class="move-menu-webinar-btn" onclick="sendToWebinar()">
          🎥 <span>Enviar a En Webinar</span>
        </button>
      </div>`;

    document.getElementById('move-menu-options').innerHTML = noRespondioBtn + extraOpts + webinarBtn;
  } else {
    document.getElementById('move-menu-options').innerHTML = etapas
      .filter(e => {
        if (/^new lead$/i.test(e)) return false;
        if (/^no contactado$/i.test(e) && !estaEn3er) return false;
        return true;
      })
      .map(e => {
        const isCurrent = e === etapaActual;
        const color = stageColor(e);
        return `<div class="move-option ${isCurrent?'current':''}"
          onclick="${isCurrent ? '' : `moveLead('${leadId}','${e.replace(/'/g,"\\'")}');closeAllMenus()`}">
          <span class="move-option-dot" style="background:${color}"></span>
          <span>${esc(e)}</span>
          ${isCurrent ? '<span class="move-option-check">✓ actual</span>' : ''}
        </div>`;
      }).join('');
    if (lead?.pipeline_id !== 'en-webinar') {
      document.getElementById('move-menu-options').innerHTML +=
        `<div style="padding:8px 13px;border-top:1px solid var(--border);">
          <button class="move-menu-webinar-btn" onclick="sendToWebinar()">
            🎥 <span>Enviar a En Webinar</span>
          </button>
        </div>`;
    }
    if (webinarSection) webinarSection.style.display = 'none';
  }

  // Posicionar el menú cerca del botón, evitando salirse de pantalla
  const btn  = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  menu.style.display = 'block'; // temporal para medir
  menu.classList.add('open');
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top  = rect.bottom + 6;
  let left = rect.left;
  if (left + mw > vw - 8) left = vw - mw - 8;
  if (top  + mh > vh - 8) top  = rect.top - mh - 6;
  if (top < 8) top = 8;

  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';
}

function closeAllMenus() {
  const menu = document.getElementById('global-move-menu');
  menu.classList.remove('open');
  menu.style.display = 'none';
  _openMenuLeadId = null;
}

function moveNoContactado(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
  const prev = lead.etapa;
  lead.pipeline_id = 'no-contactados';
  lead.etapa = 'Sin respuesta - 3er intento';
  addHistorial(leadId, `No contactado después de 3 intentos (desde ${prev})`, '📵');
  saveLeads(leadId); renderKanban(); renderSidebar();
  showToast('📵 Movido a No Contactados', true);
}

function moveWebinarNoContactado(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
  const prefix = lead.etapa.startsWith('AS - ') ? 'AS - ' : 'NA - ';
  const prev = lead.etapa;
  lead.etapa = prefix + 'No contactado';
  addHistorial(leadId, `Sin contacto en 3er intento (desde ${prev})`, '📵');
  saveLeads(leadId); renderKanban(); renderSidebar();
  showToast('📵 Sin contacto — 3er intento agotado', true);
}

function moveParaEntrevista(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
  const prev = lead.etapa;
  lead.pipeline_id    = 'entrevistas-generales';
  lead.etapa          = 'EN ENTREVISTA';
  lead.inscrito_webinar = false;
  addHistorial(leadId, `Enviado a Entrevistas Generales (desde ${prev})`, '🤝');
  saveLeads(leadId); renderKanban(); renderSidebar();
  showToast('🤝 Movido a Entrevistas Generales', true);
}

function moveReinscritoWebinar(leadId) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
  const prev = lead.etapa;
  lead.etapa = 'En Webinar sin actividad';
  lead.reinscrito_from_na = true;
  lead.webinar_accion = 'sin-registro';
  lead.inscrito_webinar = false;
  addHistorial(leadId, `Reinscrito en Webinar (desde ${prev})`, '🔄');
  saveLeads(leadId);
  setPipeTab('en-webinar', 'inscrito');
  renderKanban(); renderSidebar();
  showToast('🔄 Reinscrito en Webinar', true);
}

let _niLeadId = null;
let _niContext = 'default';

function openNoInteresado(leadId, context) {
  closeAllMenus();
  _niLeadId = leadId;
  _niContext = context || 'default';
  document.querySelectorAll('input[name="ni-reason"]').forEach(r => r.checked = false);
  document.querySelectorAll('.ni-option').forEach(o => o.classList.remove('selected'));
  document.getElementById('ni-otros-text').style.display = 'none';
  document.getElementById('ni-otros-text').value = '';
  document.querySelectorAll('input[name="ni-reason"]').forEach(r => {
    r.onchange = () => {
      document.querySelectorAll('.ni-option').forEach(o => o.classList.remove('selected'));
      r.closest('.ni-option').classList.add('selected');
      document.getElementById('ni-otros-text').style.display = r.value === 'otros' ? 'block' : 'none';
    };
  });
  document.getElementById('no-interesado-overlay').classList.remove('hidden');
}

function closeNoInteresado() {
  document.getElementById('no-interesado-overlay').classList.add('hidden');
  _niLeadId = null;
}

function confirmNoInteresado() {
  if (!_niLeadId) return;
  const selected = document.querySelector('input[name="ni-reason"]:checked');
  if (!selected) { alert('Selecciona un motivo'); return; }
  let motivo = selected.value;
  if (motivo === 'otros') {
    const txt = document.getElementById('ni-otros-text').value.trim();
    if (!txt) { alert('Explica el motivo'); return; }
    motivo = 'Otros: ' + txt;
  }
  const lead = leads.find(l => l.id === _niLeadId);
  if (lead) {
    pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
    lead.notas = Array.isArray(lead.notas) ? lead.notas : [];
    lead.notas.push({ texto: '[No interesado] ' + motivo, fecha: new Date().toISOString(), autor: currentUser?.name || '' });
    if (_niContext === 'webinar-na') {
      lead.etapa = 'NA - No interesado';
    } else if (_niContext === 'webinar-as') {
      lead.etapa = 'AS - No interesado';
    } else {
      lead.pipeline_id = 'no-interesados-no-califica';
      lead.etapa = 'No interesado';
    }
  }
  if (lead) addHistorial(_niLeadId, `No interesado: ${motivo}`, '⚠️');
  closeNoInteresado();
  saveLeads(_niLeadId); renderKanban(); renderSidebar();
  showToast('⚠️ Movido a No Interesados', true);
}

let _ncLeadId = null;
let _ncContext = 'default';

function openNoCalifica(leadId, context) {
  closeAllMenus();
  _ncLeadId = leadId;
  _ncContext = context || 'default';
  // Reset selección
  document.querySelectorAll('input[name="nc-reason"]').forEach(r => r.checked = false);
  document.querySelectorAll('.nc-option').forEach(o => o.classList.remove('selected'));
  document.getElementById('nc-otros-text').style.display = 'none';
  document.getElementById('nc-otros-text').value = '';
  // Radio change listeners
  document.querySelectorAll('input[name="nc-reason"]').forEach(r => {
    r.onchange = () => {
      document.querySelectorAll('.nc-option').forEach(o => o.classList.remove('selected'));
      r.closest('.nc-option').classList.add('selected');
      document.getElementById('nc-otros-text').style.display = r.value === 'otros' ? 'block' : 'none';
    };
  });
  document.getElementById('no-califica-overlay').classList.remove('hidden');
}

function closeNoCalifica() {
  document.getElementById('no-califica-overlay').classList.add('hidden');
  _ncLeadId = null;
}

function confirmNoCalifica() {
  if (!_ncLeadId) return;
  const selected = document.querySelector('input[name="nc-reason"]:checked');
  if (!selected) { alert('Selecciona un motivo'); return; }
  let motivo = selected.value;
  if (motivo === 'otros') {
    const txt = document.getElementById('nc-otros-text').value.trim();
    if (!txt) { alert('Explica el motivo'); return; }
    motivo = 'Otros: ' + txt;
  }
  const lead = leads.find(l => l.id === _ncLeadId);
  if (lead) {
    pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
    lead.notas = Array.isArray(lead.notas) ? lead.notas : (lead.notas ? [lead.notas] : []);
    lead.notas.push({ texto: `[No califica] ${motivo}`, fecha: new Date().toISOString(), autor: currentUser?.name || '' });
    if (_ncContext === 'webinar-na') {
      lead.etapa = 'NA - No Califica';
    } else if (_ncContext === 'webinar-as') {
      lead.etapa = 'AS - No Califica';
    } else {
      const etapaMap = {
        'No posee documentos':     'No califica - Sin documentos',
        'Aún no es mayor de edad': 'No califica - Menor de edad',
        'No habla Español':        'No califica - No habla Español',
      };
      const etapaDestino = motivo.startsWith('Otros:')
        ? 'No califica - Otros'
        : (etapaMap[motivo] || 'No califica - Otros');
      lead.pipeline_id = 'no-interesados-no-califica';
      lead.etapa = etapaDestino;
    }
  }
  if (lead) addHistorial(_ncLeadId, `No califica: ${motivo}`, '🚫');
  closeNoCalifica();
  saveLeads(_ncLeadId); renderKanban(); renderSidebar();
  showToast('🚫 Movido a No Califica', true);
}

// ── Core: move lead to En Webinar + send email ────────────────────────────────
async function _registrarEnWebinar(lead, prevEtapa) {
  if (lead.webinar_email_enviado) return; // already sent, skip duplicate
  const personalUrl = `${location.origin}/webinar.html?id=${lead.id}&nombre=${encodeURIComponent(lead.nombre||'')}&correo=${encodeURIComponent(lead.correo||'')}`;

  lead.pipeline_id               = 'en-webinar';
  lead.etapa                     = 'En Webinar sin actividad';
  lead.fecha_inscripcion_webinar = lead.fecha_inscripcion_webinar || new Date().toISOString();
  lead.link_webinar              = personalUrl;
  addHistorial(lead.id, `En Webinar sin actividad${prevEtapa ? ` (desde ${prevEtapa})` : ''} — link personalizado generado`, '🎥');
  saveLeads(lead.id);

  if (lead.correo) {
    try {
      const r = await fetch(`${SERVER_URL}/send-webinar-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ correo: lead.correo, nombre: lead.nombre || '', personalUrl }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        addHistorial(lead.id, `Link del webinar enviado por correo a ${lead.correo}`, '📧');
        lead.webinar_email_enviado = new Date().toISOString();
        saveLeads(lead.id);
        showToast(`✅ Correo de webinar enviado a ${lead.correo}`);
      } else {
        const motivo = data.error || `HTTP ${r.status}`;
        console.error('[Webinar Email]', motivo);
        showToast(`❌ Correo no enviado: ${motivo}`);
      }
    } catch(e) {
      console.error('[Webinar Email]', e);
      showToast('❌ Error de red al enviar correo del webinar');
    }
  } else {
    showToast('⚠️ Lead en Webinar — sin correo registrado');
  }
}

async function sendToWebinar() {
  const leadId = _openMenuLeadId || currentLeadId;
  if (!leadId) return;
  closeAllMenus();
  closeLead();
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;

  if (lead.pipeline_id === 'en-webinar') {
    showToast('ℹ️ Este lead ya está en En Webinar');
    return;
  }

  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
  const prev = lead.etapa;
  await _registrarEnWebinar(lead, prev);
  celebrateWebinar();
  renderKanban();
  renderSidebar();
}


function celebrateWebinar() {
  const el = document.getElementById('webinar-celebrate');
  const msg = document.getElementById('webinar-celebrate-msg');
  // Lanzar confeti
  const colors = ['#16a34a','#4ade80','#fbbf24','#f472b6','#60a5fa','#fff'];
  for (let i = 0; i < 28; i++) {
    const c = document.createElement('div');
    c.className = 'celebrate-confetti';
    c.style.cssText = `left:${20+Math.random()*60}%;top:${30+Math.random()*20}%;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*.4}s;animation-duration:${.9+Math.random()*.5}s;`;
    el.appendChild(c);
  }
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.querySelectorAll('.celebrate-confetti').forEach(c=>c.remove()); }, 250);
  }, 1600);
}

function moveLead(leadId, newEtapa) {
  const lead = leads.find(l => l.id === leadId);
  if (!lead || lead.etapa === newEtapa) return;

  pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));

  // ── TRANSICIONES AUTOMÁTICAS DE BOARD ──
  const AUTO_TRANSITIONS = [
    { match: e => /^en webinar$/i.test(e),                         pipeline:'en-webinar',             etapa:'En Webinar sin actividad',    msg:'EN WEBINAR → En Webinar sin actividad' },
    { match: e => /para entrevista.*enviar/i.test(e),              pipeline:'entrevistas-generales',   etapa:'EN ENTREVISTA',           msg:'ENTREVISTAS GENERALES → En Entrevista' },
    { match: e => /enviar a caritza/i.test(e),                     pipeline:'caritza-rojas',           etapa:'ENTREVISTADOS',           msg:'ENTREVISTA: CARITZA ROJAS → Entrevistados' },
    { match: e => /enviar a maria/i.test(e),                       pipeline:'maria-lugo',              etapa:'ENTREVISTADO',            msg:'ENTREVISTA: MARIA LUGO → Entrevistado' },
    { match: e => /enviar a br(y|a)an/i.test(e),                   pipeline:'brayan-alexander',        etapa:'ENTREVISTADO',            msg:'ENTREVISTA: BRAYAN & ALEXANDER → Entrevistado' },
    { match: e => /^no contactado$/i.test(e), pipeline:'no-contactados', etapa:'Sin respuesta - 3er intento', msg:'NO CONTACTADOS → Sin respuesta 3er intento' },
    { match: e => /no contactado.*enviar|no interesado.*enviar/i.test(e), pipeline:'eliminados', etapa:'APLICANTE - NO CONTACTADO', msg:'ELIMINADOS → No contactado' },
  ];

  const transition = AUTO_TRANSITIONS.find(t => t.match(newEtapa));
  if (transition) {
    const prevEtapa = lead.etapa;
    if (transition.pipeline === 'en-webinar') {
      _registrarEnWebinar(lead, prevEtapa).then(() => { renderKanban(); renderSidebar(); celebrateWebinar(); });
      showToast('🎥 Inscribiendo en Webinar…', true);
      return;
    }
    lead.pipeline_id = transition.pipeline;
    lead.etapa       = transition.etapa;
    addHistorial(leadId, `Movido de ${prevEtapa} → ${transition.etapa} (${PIPELINES.find(p=>p.id===transition.pipeline)?.nombre||transition.pipeline})`, '↕️');
    saveLeads(leadId); renderKanban(); renderSidebar();
    showToast('✅ Movido a ' + transition.msg, true);
    return;
  }

  const prevEtapa = lead.etapa;
  lead.etapa = newEtapa;
  addHistorial(leadId, `Etapa cambiada: ${prevEtapa} → ${newEtapa}`, '↕️');
  saveLeads(leadId); renderKanban(); renderSidebar();
  showToast('↕️ Movido a: ' + newEtapa, true);
}

// ── INVISIBLE TOGGLE ──
async function toggleInvisible(leadId) {
  closeAllMenus();
  const lead = leads.find(l => l.id === leadId);
  if (!lead) return;
  const nowInvisible = !lead.invisible;
  lead.invisible = nowInvisible;
  saveLeads(leadId);
  renderKanban();
  renderSidebar();
  showToast(nowInvisible ? '👁‍🗨 Lead oculto — solo tú lo puedes ver' : '👁 Lead visible para todos', true);
}

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

// ════════════════════════════════════════════
//  DRAG & DROP
// ════════════════════════════════════════════
function handleDragStart(event, leadId) {
  dragLeadId = leadId;
  document.getElementById('kcard-'+leadId)?.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
}
function handleDrop(event, etapa) {
  event.preventDefault();
  event.currentTarget.querySelector('.kanban-col-body').classList.remove('drag-over');
  if (!dragLeadId) return;
  const lead = leads.find(l => l.id === dragLeadId);
  if (lead && lead.etapa !== etapa) {
    pushUndo('lead_change', JSON.parse(JSON.stringify(lead)));
    lead.etapa = etapa;
    addHistorial(lead.id, `Etapa cambiada (arrastre) → ${etapa}`, '↕️');
    saveLeads(lead.id);
    renderKanban();
    renderSidebar();
    showToast(`↕️ Movido a: ${etapa}`, true);
  }
  dragLeadId = null;
}

// ════════════════════════════════════════════
