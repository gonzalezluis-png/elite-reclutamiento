// ════════════════════════════════════════════
//  MONITOR DE LEADS
// ════════════════════════════════════════════

let _monitorAlertHours = parseInt(localStorage.getItem('er_monitor_alert_hours') || '4', 10);

function showMonitor() {
  _hideAllViews();
  activeView = 'monitor';
  document.getElementById('board-title').textContent = 'Monitor de Leads';
  const el = document.getElementById('monitor-view');
  el.style.display = 'block';
  renderSidebar();
  renderMonitor();
  // If leads haven't loaded from Firestore yet, fetch them now
  if (leads.length === 0) {
    fsLoadLeads().then(fsLeads => {
      if (fsLeads.length > 0 && activeView === 'monitor') {
        leads = fsLeads;
        localStorage.setItem('er_leads', JSON.stringify(leads));
        renderMonitor();
        renderSidebar();
      }
    }).catch(() => {});
  }
}

function renderMonitor() {
  const el = document.getElementById('monitor-view');
  if (!el) return;

  const now   = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);

  const sorted = [...leads]
    .filter(l => l.created_at)
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  const recent20 = sorted.slice(0, 20);
  const todayLeads = sorted.filter(l => new Date(l.created_at) >= today);

  // Stats by pipeline source
  const byPipeline = {};
  todayLeads.forEach(l => {
    const k = l.pipeline_id === 'postulados-meta'            ? 'Meta Ads'
            : l.pipeline_id === 'postulados-whatsapp-meta'   ? 'WA Meta'
            : l.pipeline_id === 'postulados-indeed'           ? 'Indeed'
            : l.pipeline_id === 'en-webinar'                  ? 'Webinar'
            : (l.fuente || 'Otro');
    byPipeline[k] = (byPipeline[k] || 0) + 1;
  });
  const statsHtml = Object.entries(byPipeline).map(([k,v]) =>
    `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(79,127,255,.12);border:1px solid rgba(79,127,255,.25);border-radius:20px;font-size:11px;font-weight:600;color:#7aa3ff">${k} <strong style="color:#fff">${v}</strong></span>`
  ).join('');

  // Alert: no lead for X hours
  const latestTs = sorted.length > 0 ? new Date(sorted[0].created_at).getTime() : 0;
  const hoursSince = latestTs ? (now - latestTs) / 3600000 : Infinity;
  const alertHtml = (hoursSince >= _monitorAlertHours)
    ? `<div style="padding:12px 18px;background:rgba(226,68,92,.1);border:1px solid rgba(226,68,92,.4);border-radius:10px;color:#f87171;font-size:13px;font-weight:600;display:flex;align-items:center;gap:10px;animation:blink-dot 2s ease-in-out infinite;margin-bottom:20px;">
        🚨 <span>Sin nuevos leads en <strong>${hoursSince === Infinity ? '—' : hoursSince.toFixed(1)} horas</strong>. Revisa que las integraciones estén activas.</span>
       </div>` : '';

  function relTime(iso) {
    const diff = now - new Date(iso).getTime();
    if (diff < 60000)    return 'hace <1 min';
    if (diff < 3600000)  return `hace ${Math.floor(diff/60000)} min`;
    if (diff < 86400000) return `hace ${Math.floor(diff/3600000)}h`;
    return new Date(iso).toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
  }

  function primerMsg(l) {
    const msgs = [
      ...(l.metaWa  || []).filter(m => m.direction === 'inbound'),
      ...(l.whatsapp || []).filter(m => m.direction === 'inbound'),
      ...(l.sms      || []).filter(m => m.direction === 'inbound'),
    ].sort((a,b) => new Date(a.dateSent||a.date||0) - new Date(b.dateSent||b.date||0));
    if (!msgs.length) return '<span style="color:var(--text3)">—</span>';
    const body = msgs[0].body || '';
    return `<span title="${esc(body)}" style="color:var(--text2);max-width:180px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(body.slice(0,60))||'—'}</span>`;
  }

  function anaRespondio(l) {
    const out = [
      ...(l.metaWa  || []).filter(m => m.direction === 'outbound'),
      ...(l.whatsapp || []).filter(m => m.direction === 'outbound'),
      ...(l.sms      || []).filter(m => m.direction === 'outbound'),
    ];
    return out.length > 0
      ? '<span style="color:#00c875;font-weight:700">✓ Sí</span>'
      : '<span style="color:var(--text3)">—</span>';
  }

  const rowsHtml = recent20.length > 0 ? recent20.map((l, i) => {
    const src = l.pipeline_id === 'postulados-meta'          ? '<span style="background:rgba(0,115,234,.15);color:#0073ea;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">META</span>'
              : l.pipeline_id === 'postulados-whatsapp-meta' ? '<span style="background:rgba(37,211,102,.12);color:#25d366;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">WA META</span>'
              : l.pipeline_id === 'postulados-indeed'        ? '<span style="background:rgba(253,171,61,.12);color:#fdab3d;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">INDEED</span>'
              : `<span style="background:rgba(124,92,255,.12);color:#a78bfa;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700">${esc(l.fuente||'OTRO')}</span>`;
    const inbox = l.wa_inbox_number ? `<span style="font-size:10px;color:#60a5fa">📲 ${esc(l.wa_inbox_number)}</span>` : '<span style="color:var(--text3)">—</span>';
    return `<tr onclick="openLead('${l.id}')" style="cursor:pointer">
      <td style="color:var(--text3)">${i+1}</td>
      <td style="font-weight:600;color:#fff">${esc(l.nombre||'—')}</td>
      <td style="color:var(--text2)">${esc(l.telefono||'—')}</td>
      <td>${src}</td>
      <td>${inbox}</td>
      <td style="white-space:nowrap;color:var(--text2)">${relTime(l.created_at)}</td>
      <td>${primerMsg(l)}</td>
      <td>${anaRespondio(l)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:32px">Sin leads recientes</td></tr>`;

  el.innerHTML = `
  <div style="max-width:1100px;width:100%;margin:0 auto;padding:28px 32px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <div>
        <div style="font-size:20px;font-weight:800;color:#fff">📊 Monitor de Leads</div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px">Últimos 20 registros · Se actualiza en tiempo real</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;padding:6px 14px;background:rgba(0,200,117,.1);border:1px solid rgba(0,200,117,.25);border-radius:20px;font-size:13px;font-weight:700;color:#00c875">
          📅 Hoy: <strong>${todayLeads.length}</strong> leads
        </div>
        ${statsHtml}
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--text3)">Alerta si no hay leads en</span>
          <select onchange="_monitorSetAlertHours(+this.value)" style="background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 7px;font-size:11px;font-family:var(--font)">
            ${[1,2,3,4,6,8,12,24].map(h => `<option value="${h}" ${h===_monitorAlertHours?'selected':''}>${h}h</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    ${alertHtml}

    <div style="overflow-x:auto;border-radius:12px;border:1px solid var(--border);">
      <table class="leads-table" style="width:100%">
        <thead><tr>
          <th>#</th><th>Nombre</th><th>Teléfono</th><th>Fuente</th>
          <th>Nº destino</th><th>Recibido</th><th>1er mensaje</th><th>Ana respondió</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </div>`;
}

function _monitorSetAlertHours(h) {
  _monitorAlertHours = h;
  localStorage.setItem('er_monitor_alert_hours', String(h));
  renderMonitor();
}

function _updateLeadsTodayBar() {
  const bar = document.getElementById('leads-today-bar');
  if (!bar) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const todayLeads = leads.filter(l => l.created_at && new Date(l.created_at) >= today);
  const total = todayLeads.length;

  if (total === 0) {
    bar.style.display = 'none';
    return;
  }

  const bySource = {};
  todayLeads.forEach(l => {
    const k = l.pipeline_id === 'postulados-meta'          ? 'Meta'
            : l.pipeline_id === 'postulados-whatsapp-meta' ? 'WA Meta'
            : l.pipeline_id === 'postulados-indeed'        ? 'Indeed'
            : (l.fuente || 'Otro');
    bySource[k] = (bySource[k] || 0) + 1;
  });
  const breakdown = Object.entries(bySource)
    .map(([k,v]) => `<span style="color:var(--text2)">${k}: <strong style="color:#fff">${v}</strong></span>`)
    .join('<span style="color:var(--border);margin:0 6px">·</span>');

  bar.style.display = 'flex';
  bar.innerHTML = `
    <span style="font-size:11px;font-weight:700;color:#7aa3ff;margin-right:10px">📅 HOY</span>
    <span style="font-size:13px;font-weight:800;color:#fff;margin-right:12px">${total} leads</span>
    <span style="font-size:11px">${breakdown}</span>
    <button onclick="showMonitor()" style="margin-left:auto;padding:3px 10px;background:rgba(79,127,255,.15);border:1px solid rgba(79,127,255,.3);color:#7aa3ff;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;font-family:var(--font)">Ver monitor →</button>`;
}
