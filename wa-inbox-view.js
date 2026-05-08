// ── WA Inbox View — registro de quién escribe al número ──────────────────────
let _waInboxData    = [];
let _waInboxSearch  = '';
let _waInboxPollInt = null;

async function showWAInbox() {
  _hideAllViews();
  activeView = 'wa-inbox';
  document.getElementById('board-title').textContent = 'Entradas WhatsApp';
  const view = document.getElementById('wa-inbox-view');
  view.style.display = 'flex';
  renderSidebar();
  await _waInboxLoad();
  clearInterval(_waInboxPollInt);
  _waInboxPollInt = setInterval(_waInboxLoad, 30000);
}

async function _waInboxLoad() {
  try {
    const data = await fetch(`${SERVER_URL}/meta/wa-contacts`).then(r => r.json());
    _waInboxData = (data.contacts || []).map(({ phone, messages }) => {
      const sorted = [...messages].sort((a, b) => new Date(a.dateSent) - new Date(b.dateSent));
      const lead   = leads.find(l => {
        const ld = (l.telefono || '').replace(/\D/g, '');
        const ph = phone.replace(/\D/g, '');
        return ld && (ld === ph || ld.slice(-10) === ph.slice(-10));
      });
      return {
        phone,
        lead,
        firstMsg:  sorted[0]  || null,
        lastMsg:   sorted[sorted.length - 1] || null,
        totalMsgs: messages.length,
        inbound:   messages.filter(m => m.direction === 'inbound').length,
      };
    }).sort((a, b) => {
      const ta = a.lastMsg?.dateSent || '';
      const tb = b.lastMsg?.dateSent || '';
      return tb.localeCompare(ta);
    });
    _waInboxRender();
  } catch(e) {
    const el = document.getElementById('wa-inbox-body');
    if (el) el.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text2);">Error cargando datos</td></tr>`;
  }
}

function _waInboxRender() {
  const view = document.getElementById('wa-inbox-view');
  if (!view || view.style.display === 'none') return;

  const q = _waInboxSearch.toLowerCase();
  const rows = _waInboxData.filter(r => {
    if (r.lead?.invisible) return false;
    if (!q) return true;
    const name  = (r.lead?.nombre || '').toLowerCase();
    const phone = r.phone.toLowerCase();
    const body  = (r.lastMsg?.body || '').toLowerCase();
    return name.includes(q) || phone.includes(q) || body.includes(q);
  });

  const colors = ['#6366f1','#0073ea','#f59e0b','#00c875','#e2445c','#8b5cf6'];
  const tbody  = document.getElementById('wa-inbox-body');
  if (!tbody) { _waInboxBuild(); return; }

  tbody.innerHTML = rows.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text2);font-size:13px;">Sin resultados</td></tr>`
    : rows.map(r => {
        const name    = r.lead?.nombre || r.phone;
        const initials = name.split(' ').map(w => w[0]||'').join('').slice(0,2).toUpperCase() || '?';
        const color   = colors[name.charCodeAt(0) % colors.length];
        const first   = r.firstMsg ? fmtDateTime(r.firstMsg.dateSent) : '—';
        const last    = r.lastMsg  ? fmtDateTime(r.lastMsg.dateSent)  : '—';
        const preview = (r.lastMsg?.body || '').slice(0, 60) + (r.lastMsg?.body?.length > 60 ? '…' : '');
        const dir     = r.lastMsg?.direction === 'outbound' ? '↗ ' : '↙ ';

        const statusBadge = r.lead
          ? `<span style="background:rgba(0,200,117,.15);color:#00c875;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600;cursor:pointer;" onclick="openLead('${r.lead.id}')">✅ En CRM</span>`
          : `<span style="background:rgba(245,158,11,.12);color:#f59e0b;padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600;">⚠️ Sin lead</span>`;

        const actionBtn = r.lead
          ? `<button style="padding:4px 10px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--card2);color:var(--text);cursor:pointer;" onclick="openLead('${r.lead.id}')">Ver lead</button>`
          : `<button style="padding:4px 10px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--card2);color:var(--text);cursor:pointer;" onclick="_waInboxCreateLead('${r.phone}')">+ Crear lead</button>`;

        return `<tr style="border-bottom:1px solid var(--border);transition:background .15s;" onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
          <td style="padding:12px 16px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;">${esc(initials)}</div>
              <div>
                <div style="font-weight:600;font-size:13px;">${esc(name)}</div>
                <div style="font-size:11px;color:var(--text2);">+${r.phone}</div>
              </div>
            </div>
          </td>
          <td style="padding:12px 16px;font-size:12px;color:var(--text2);">${first}</td>
          <td style="padding:12px 16px;font-size:12px;color:var(--text2);">${last}</td>
          <td style="padding:12px 16px;font-size:12px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(dir + preview)}</td>
          <td style="padding:12px 16px;text-align:center;font-size:12px;"><span style="background:var(--card2);padding:3px 8px;border-radius:20px;">${r.inbound} entrada${r.inbound !== 1 ? 's' : ''}</span></td>
          <td style="padding:12px 16px;text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:8px;">${statusBadge} ${actionBtn}</td>
        </tr>`;
      }).join('');

  document.getElementById('wa-inbox-count').textContent = `${rows.length} contacto${rows.length !== 1 ? 's' : ''}`;
}

function _waInboxBuild() {
  const view = document.getElementById('wa-inbox-view');
  view.innerHTML = `
    <div style="flex:1;overflow-y:auto;padding:28px 32px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:20px;font-weight:700;">📥 Entradas WhatsApp</div>
          <span id="wa-inbox-count" style="background:var(--card2);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-size:12px;color:var(--text2);">—</span>
        </div>
        <div style="display:flex;gap:8px;">
          <input placeholder="🔍 Buscar por nombre, número o mensaje…" value="${esc(_waInboxSearch)}"
            oninput="_waInboxSearch=this.value;_waInboxRender()"
            style="padding:7px 12px;background:var(--card2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;width:260px;outline:none;" />
          <button onclick="_waInboxLoad()" style="padding:7px 14px;background:var(--card2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;cursor:pointer;">↻ Actualizar</button>
        </div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:var(--card2);border-bottom:1px solid var(--border);">
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Contacto</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Primer Contacto</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Última Actividad</th>
              <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Último Mensaje</th>
              <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Mensajes</th>
              <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Estado</th>
            </tr>
          </thead>
          <tbody id="wa-inbox-body">
            <tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text2);">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>`;
  _waInboxRender();
}

async function _waInboxCreateLead(phone) {
  if (!confirm(`¿Crear lead manualmente para +${phone}?`)) return;
  try {
    await fetch(`${SERVER_URL}/leads/create-wa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    showToast('Lead creado ✓');
    await _waInboxLoad();
    const fsLeads = await fsLoadLeads();
    if (fsLeads.length > 0) { leads = fsLeads; renderKanban(); renderSidebar(); }
  } catch(e) {
    showToast('Error al crear lead');
  }
}
