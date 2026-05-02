// ── Interview config ─────────────────────────────────────────────────────────
let _ivConfig = {};

const IV_DAYS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const IV_TRIGGERS = { morning_of:'Mañana de la cita a las', hours_before:'Horas antes de la cita', minutes_after:'Minutos después de la cita (sin respuesta)' };

function ivRenderConfig(cfg) {
  _ivConfig = JSON.parse(JSON.stringify(cfg));
  const el = document.getElementById('iv-config-wrap');
  if (!el) return;
  const s  = cfg.schedule   || {};
  const r  = cfg.rules      || {};
  const iv = cfg.interviewer || {};
  const co = cfg.confirmation|| {};
  const days = s.days || [1,2,3,4,5];

  el.innerHTML = `
    <!-- Entrevistador -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Entrevistador</div>
      <div style="display:flex;gap:8px;">
        <input id="iv-name" value="${esc(iv.name||'')}" placeholder="Nombre"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;" />
        <input id="iv-phone" value="${esc(iv.phone||'')}" placeholder="+1234567890"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;font-family:monospace;" />
      </div>
    </div>

    <!-- Zoom -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Link de Zoom (fijo y reutilizable)</div>
      <input id="iv-zoom" value="${esc(cfg.zoomLink||'')}" placeholder="https://zoom.us/j/XXXXXXXXXX"
        style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;box-sizing:border-box;font-family:monospace;" />
    </div>

    <!-- Horario -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Horario base semanal</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
        ${[0,1,2,3,4,5,6].map(d => `
          <button onclick="ivToggleDay(${d})" id="iv-day-${d}"
            style="padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid var(--border);
            background:${days.includes(d)?'var(--accent)':'var(--bg)'};color:${days.includes(d)?'#fff':'var(--text2)'};">
            ${IV_DAYS[d]}
          </button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="font-size:11px;color:var(--text2);flex-shrink:0;">De</label>
        <input id="iv-start" type="number" min="0" max="23" value="${s.startHour??9}"
          style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
        <label style="font-size:11px;color:var(--text2);">:00 a</label>
        <input id="iv-end" type="number" min="0" max="23" value="${s.endHour??18}"
          style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
        <label style="font-size:11px;color:var(--text2);">:00 hs</label>
      </div>
    </div>

    <!-- Reglas de tiempo -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Reglas de tiempo</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:12px;color:var(--text);flex:1;">Mínimo de horas antes de la cita</label>
          <input id="iv-minhours" type="number" min="1" max="48" value="${r.minHoursAhead??3}"
            style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
          <span style="font-size:11px;color:var(--text2);">h</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:12px;color:var(--text);flex:1;">Máximo de días después del webinar</label>
          <input id="iv-maxdays" type="number" min="1" max="14" value="${r.maxDaysOut??3}"
            style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
          <span style="font-size:11px;color:var(--text2);">días</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:12px;color:var(--text);flex:1;">Máximo de opciones a ofrecer</label>
          <input id="iv-maxopts" type="number" min="1" max="5" value="${r.maxOptions??3}"
            style="width:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
          <span style="font-size:11px;color:var(--text2);">opciones</span>
        </div>
      </div>
    </div>

    <!-- Confirmación de cita -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Confirmación al agendar</div>
      <textarea id="iv-confirm-msg" style="width:100%;height:100px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:12px;outline:none;resize:vertical;box-sizing:border-box;line-height:1.6;">${esc(co.message||'')}</textarea>
      <div style="font-size:10px;color:var(--text2);margin-top:5px;">Variables: {nombre} {fecha} {hora} {entrevistador} {zoom}</div>
    </div>

    <!-- Recordatorios -->
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;">Recordatorios y alertas</div>
        <button onclick="ivAddReminder()" class="btn-secondary" style="font-size:11px;padding:4px 10px;">+ Agregar</button>
      </div>
      <div id="iv-reminders-list" style="display:flex;flex-direction:column;gap:10px;">
        ${(cfg.reminders||[]).map((rem,i) => ivReminderHTML(rem,i)).join('')}
      </div>
      <div style="font-size:10px;color:var(--text2);margin-top:8px;">Variables: {nombre} {fecha} {hora} {entrevistador}</div>
    </div>

    <div style="text-align:right;">
      <button class="btn-primary" onclick="ivSaveConfig()" style="font-size:11px;padding:6px 14px;">💾 Guardar configuración</button>
    </div>`;
}

function ivReminderHTML(rem, i) {
  return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;" id="iv-rem-${rem.id}">
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      <input value="${esc(rem.label||'')}" onchange="ivUpdateReminder('${rem.id}','label',this.value)"
        placeholder="Nombre del recordatorio"
        style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px;font-weight:600;outline:none;" />
      <button onclick="ivDeleteReminder('${rem.id}')" style="background:rgba(226,68,92,.15);border:none;color:var(--red);border-radius:5px;padding:3px 8px;cursor:pointer;font-size:12px;">✕</button>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
      <select onchange="ivUpdateReminder('${rem.id}','trigger',this.value)"
        style="flex:1;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:11px;outline:none;">
        ${Object.entries(IV_TRIGGERS).map(([k,v])=>`<option value="${k}" ${rem.trigger===k?'selected':''}>${v}</option>`).join('')}
      </select>
      <input type="number" min="0" max="120" value="${rem.value??0}" onchange="ivUpdateReminder('${rem.id}','value',+this.value)"
        style="width:55px;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-size:12px;outline:none;text-align:center;" />
    </div>
    <textarea onchange="ivUpdateReminder('${rem.id}','message',this.value)"
      placeholder="Mensaje…" style="width:100%;height:70px;background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:7px 9px;color:var(--text);font-size:11px;outline:none;resize:vertical;box-sizing:border-box;line-height:1.5;">${esc(rem.message||'')}</textarea>
    <div style="margin-top:6px;display:flex;gap:12px;">
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);cursor:pointer;">
        <input type="checkbox" ${rem.notifyManager?'checked':''} onchange="ivUpdateReminder('${rem.id}','notifyManager',this.checked)"
          style="accent-color:var(--green);" /> Notificar manager
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);cursor:pointer;">
        <input type="checkbox" ${rem.notifyInterviewer?'checked':''} onchange="ivUpdateReminder('${rem.id}','notifyInterviewer',this.checked)"
          style="accent-color:var(--green);" /> Notificar entrevistador
      </label>
    </div>
  </div>`;
}

function ivToggleDay(d) {
  if (!_ivConfig.schedule) _ivConfig.schedule = {};
  const days = _ivConfig.schedule.days || [1,2,3,4,5];
  const idx  = days.indexOf(d);
  if (idx >= 0) days.splice(idx,1); else days.push(d);
  _ivConfig.schedule.days = days;
  const btn = document.getElementById(`iv-day-${d}`);
  if (btn) {
    const on = days.includes(d);
    btn.style.background = on ? 'var(--accent)' : 'var(--bg)';
    btn.style.color      = on ? '#fff' : 'var(--text2)';
  }
}

function ivUpdateReminder(id, field, value) {
  const rem = (_ivConfig.reminders||[]).find(r=>r.id===id);
  if (rem) rem[field] = value;
}

function ivAddReminder() {
  if (!_ivConfig.reminders) _ivConfig.reminders = [];
  const newRem = { id:'r'+Date.now(), label:'Nuevo recordatorio', trigger:'hours_before', value:1, message:'', notifyManager:false, notifyInterviewer:false };
  _ivConfig.reminders.push(newRem);
  const list = document.getElementById('iv-reminders-list');
  if (list) list.insertAdjacentHTML('beforeend', ivReminderHTML(newRem, _ivConfig.reminders.length-1));
}

function ivDeleteReminder(id) {
  _ivConfig.reminders = (_ivConfig.reminders||[]).filter(r=>r.id!==id);
  document.getElementById(`iv-rem-${id}`)?.remove();
}

async function ivSaveConfig() {
  // Read form values back into _ivConfig
  const g = id => { const el=document.getElementById(id); return el?el.value.trim():''; };
  _ivConfig.interviewer = { name: g('iv-name'), phone: g('iv-phone') };
  _ivConfig.zoomLink    = g('iv-zoom');
  _ivConfig.schedule    = { ..._ivConfig.schedule, startHour: +g('iv-start'), endHour: +g('iv-end') };
  _ivConfig.rules       = { ..._ivConfig.rules, minHoursAhead:+g('iv-minhours'), maxDaysOut:+g('iv-maxdays'), maxOptions:+g('iv-maxopts'), slotDuration:60 };
  _ivConfig.confirmation= { ..._ivConfig.confirmation, message: document.getElementById('iv-confirm-msg')?.value||'' };
  try {
    const r = await fetch(`${SERVER_URL}/interviews/config`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ config: _ivConfig }),
    });
    const d = await r.json();
    showToast(d.ok ? '✅ Configuración de entrevistas guardada' : '⚠️ Error al guardar');
  } catch(e) { showToast('❌ Error: '+e.message); }
}

