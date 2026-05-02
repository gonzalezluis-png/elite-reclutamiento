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


// ── Escalation managers in Config ─────────────────────────────────────────────
let _cfgManagers = [];

function cfgRenderManagers(managers, interviewer) {
  _cfgManagers = managers.length ? managers : [
    { level:1, phone:'+17863060642',  name:'Luis (Admin)' },
    { level:2, phone:'+14695285231',  name:'Encargado 2' },
    { level:3, phone:'+584143605411', name:'Encargado 3' },
  ];
  const el = document.getElementById('cfg-managers-list');
  if (!el) return;
  const levelColors = ['#22c55e','#f59e0b','#f97316'];
  const levelIcons  = ['1️⃣','2️⃣','3️⃣'];
  const levelDesc   = ['Recibe la alerta primero · 5 min para responder','Si el Encargado 1 no responde · 10 min','Última instancia'];
  el.innerHTML = _cfgManagers.map((m, i) => `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="font-size:16px;">${levelIcons[i]}</span>
        <div style="flex:1;">
          <div style="font-size:12px;font-weight:700;color:${levelColors[i]};">${esc(m.name)}</div>
          <div style="font-size:10px;color:var(--text3);">${levelDesc[i]}</div>
        </div>
        <button onclick="cfgUnlockManager(${i})" id="cfg-mgr-lock-${i}" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;color:var(--text3);cursor:pointer;font-size:11px;">🔒 Editar</button>
      </div>
      <div style="display:flex;gap:8px;">
        <input id="cfg-mgr-name-${i}" value="${esc(m.name)}" disabled
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;" placeholder="Nombre" />
        <input id="cfg-mgr-phone-${i}" value="${esc(m.phone)}" disabled
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text);font-size:12px;outline:none;font-family:monospace;" placeholder="+1234567890" />
      </div>
    </div>`).join('');

  // Interviewer card
  const ivCard = document.getElementById('cfg-interviewer-card');
  if (!ivCard) return;
  const iv = interviewer || { name: 'Entrevistador', phone: '+584142055978' };
  ivCard.innerHTML = `
    <div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.3);border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="font-size:16px;">🎙</span>
        <div>
          <div style="font-size:12px;font-weight:700;color:#a5b4fc;">${esc(iv.name)}</div>
          <div style="font-size:10px;color:var(--text3);">Entrevistador · recibe notificaciones de entrevistas agendadas</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <div style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text3);font-size:12px;">${esc(iv.name)}</div>
        <div style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:7px 10px;color:var(--text3);font-size:12px;font-family:monospace;">${esc(iv.phone || '+584142055978')}</div>
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px;">Para cambiar estos datos, ve a Asistente IA → 🎙 Entrevistas.</div>
    </div>`;
}

function cfgUnlockManager(i) {
  if (!confirm('¿Editar este encargado?')) return;
  document.getElementById(`cfg-mgr-name-${i}`).disabled  = false;
  document.getElementById(`cfg-mgr-phone-${i}`).disabled = false;
  document.getElementById(`cfg-mgr-lock-${i}`).textContent = '✏️ Editando';
  document.getElementById(`cfg-mgr-lock-${i}`).style.color = '#f97316';
  const btn = document.getElementById('cfg-managers-save-btn');
  if (btn) btn.style.display = '';
}

async function cfgSaveManagers() {
  const managers = _cfgManagers.map((m, i) => ({
    level: m.level,
    name:  document.getElementById(`cfg-mgr-name-${i}`)?.value?.trim()  || m.name,
    phone: document.getElementById(`cfg-mgr-phone-${i}`)?.value?.trim() || m.phone,
  }));
  try {
    const r = await fetch(`${SERVER_URL}/ai/managers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managers }),
    });
    const d = await r.json();
    if (d.ok) {
      showToast('Encargados guardados ✓', 'success');
      _cfgManagers = managers;
      document.getElementById('cfg-managers-save-btn').style.display = 'none';
      cfgRenderManagers(managers, null);
    } else { showToast('Error: ' + d.error, 'error'); }
  } catch(e) { showToast('Error de conexión: ' + e.message, 'error'); }
}

function copyRegUrl() {
  navigator.clipboard.writeText('https://crm.grupoelitework.com/registro.html')
    .then(() => showToast('✅ Enlace copiado'))
    .catch(() => showToast('⚠️ No se pudo copiar'));
}

// ── Registro Webinar modal ────────────────────────────────────────────────────
let _rwPersonalLink = '';

function openRegistroWebinar() {
  const modal = document.getElementById('registro-webinar-modal');
  modal.classList.remove('hidden');
  document.getElementById('rw-form-body').style.display = 'block';
  document.getElementById('rw-success').style.display   = 'none';
  document.getElementById('rw-nombre').value   = '';
  document.getElementById('rw-telefono').value = '';
  document.getElementById('rw-correo').value   = '';
  document.getElementById('rw-error').style.display = 'none';
  const btn = document.getElementById('rw-btn');
  btn.disabled = false;
  btn.textContent = 'Registrar e Ir al Webinar';
  _rwPersonalLink = '';
  setTimeout(() => document.getElementById('rw-nombre').focus(), 100);
}

function closeRegistroWebinar(e) {
  if (e && e.target !== document.getElementById('registro-webinar-modal')) return;
  document.getElementById('registro-webinar-modal').classList.add('hidden');
}

async function submitRegistroWebinar() {
  const nombre   = document.getElementById('rw-nombre').value.trim();
  const telefono = document.getElementById('rw-telefono').value.trim();
  const correo   = document.getElementById('rw-correo').value.trim();
  const errBox   = document.getElementById('rw-error');
  errBox.style.display = 'none';

  if (!nombre || !telefono || !correo || !/\S+@\S+\.\S+/.test(correo)) {
    errBox.textContent = 'Por favor completa todos los campos correctamente.';
    errBox.style.display = 'block';
    return;
  }

  const btn = document.getElementById('rw-btn');
  btn.disabled = true;
  btn.textContent = 'Registrando…';

  try {
    const leadId = 'lead-reg-' + Date.now();
    const now    = new Date().toISOString();
    const WURL   = 'https://crm.grupoelitework.com/webinar.html';
    const personalUrl = `${WURL}?id=${leadId}&nombre=${encodeURIComponent(nombre)}&correo=${encodeURIComponent(correo)}`;

    function fsV(v) {
      if (v === null || v === undefined) return { nullValue: null };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number')  return { doubleValue: v };
      if (typeof v === 'string')  return { stringValue: v };
      if (Array.isArray(v))       return { arrayValue: { values: v.map(fsV) } };
      if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k,x])=>[k,fsV(x)])) } };
      return { stringValue: String(v) };
    }

    const FS_PROJECT = 'elite-reclutamiento-crm';
    const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
    const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

    await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: {
        nombre:       fsV(nombre),
        telefono:     fsV(telefono),
        correo:       fsV(correo),
        fuente:       fsV('Registro Manual Webinar'),
        etapa:        fsV('Inscrito en Webinar'),
        pipeline_id:  fsV('en-webinar'),
        estado:       fsV('abierto'),
        valor:        fsV(0),
        propietario:  fsV(currentUser?.nombre || 'Admin'),
        link_webinar: fsV(personalUrl),
        webinar_email_enviado: fsV(now),
        created_at:   fsV(now),
        notas: fsV([]), tareas: fsV([]), pagos: fsV([]), etiquetas: fsV([]),
        historial: fsV([{ icono:'📝', accion:`Inscrito manualmente en el webinar por ${currentUser?.nombre||'Admin'}`, fecha:now, usuario:currentUser?.nombre||'Admin' }]),
      }}),
    });

    // Enviar correo con link personalizado
    fetch(`${SERVER_URL}/send-webinar-email`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ correo, nombre, personalUrl }),
    }).catch(() => {});

    // Add to local leads array
    leads.push({
      id: leadId, nombre, telefono, correo,
      fuente: 'Registro Manual Webinar', etapa: 'Inscrito en Webinar',
      pipeline_id: 'en-webinar', estado: 'abierto', valor: 0,
      propietario: currentUser?.nombre || 'Admin',
      link_webinar: personalUrl, webinar_email_enviado: now,
      created_at: now, notas: [], tareas: [], pagos: [], etiquetas: [],
      historial: [{ icono:'📝', accion:`Inscrito manualmente en el webinar por ${currentUser?.nombre||'Admin'}`, fecha:now, usuario:currentUser?.nombre||'Admin' }],
    });
    localStorage.setItem('er_leads', JSON.stringify(leads));
    renderKanban(); renderSidebar();

    _rwPersonalLink = personalUrl;
    document.getElementById('rw-webinar-link').href = _rwPersonalLink;
    document.getElementById('rw-success-msg').textContent =
      `${nombre} fue inscrito/a exitosamente. Correo enviado a ${correo}.`;
    document.getElementById('rw-form-body').style.display = 'none';
    document.getElementById('rw-success').style.display   = 'block';
  } catch(err) {
    btn.disabled = false;
    btn.textContent = 'Registrar e Ir al Webinar';
    errBox.textContent = 'Error al guardar. Intenta de nuevo.';
    errBox.style.display = 'block';
  }
}

function copyRwLink() {
  if (!_rwPersonalLink) return;
  navigator.clipboard.writeText(_rwPersonalLink)
    .then(() => { document.getElementById('rw-copy-btn').textContent = '✅ ¡Copiado!'; setTimeout(() => { document.getElementById('rw-copy-btn').textContent = '📋 Copiar link personalizado'; }, 2000); })
    .catch(() => showToast('⚠️ No se pudo copiar'));
}

// ── Enviar lead a Webinar desde el panel de conversación ──────────────────────
async function mlEnviarWebinar() {
  const lead = leads.find(l => l.id === currentLeadId);
  if (!lead) return;

  const btn    = document.getElementById('ml-webinar-btn');
  const msgEl  = document.getElementById('ml-webinar-msg');
  msgEl.style.display = 'none';

  if (lead.pipeline_id === 'en-webinar') {
    msgEl.style.background = 'rgba(0,200,117,.1)';
    msgEl.style.color = '#00c875';
    msgEl.style.border = '1px solid rgba(0,200,117,.25)';
    msgEl.textContent = '✓ Este lead ya está en el pipeline En Webinar.';
    msgEl.style.display = 'block';
    return;
  }

  const nombre = lead.nombre || '';
  const correo = lead.correo || '';
  if (!correo) {
    msgEl.style.background = 'rgba(248,113,113,.08)';
    msgEl.style.color = '#f87171';
    msgEl.style.border = '1px solid rgba(248,113,113,.25)';
    msgEl.textContent = '⚠️ Este lead no tiene correo. Agrégalo antes de enviarlo al webinar.';
    msgEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '⏳ Enviando…';

  try {
    const FS_PROJECT = 'elite-reclutamiento-crm';
    const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
    const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
    const WURL       = 'https://crm.grupoelitework.com/webinar.html';

    const personalUrl = `${WURL}?id=${lead.id}&nombre=${encodeURIComponent(nombre)}&correo=${encodeURIComponent(correo)}`;
    const now         = new Date().toISOString();

    function fsV(v) {
      if (v === null || v === undefined) return { nullValue: null };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number')  return { doubleValue: v };
      if (typeof v === 'string')  return { stringValue: v };
      if (Array.isArray(v))       return { arrayValue: { values: v.map(fsV) } };
      if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k,x])=>[k,fsV(x)])) } };
      return { stringValue: String(v) };
    }

    // Build new historial entry
    const hist = (lead.historial || []).concat([{
      icono: '🎥',
      accion: `Enviado a Webinar manualmente por ${currentUser?.nombre || 'Admin'} — link personalizado generado`,
      fecha:   now,
      usuario: currentUser?.nombre || 'Admin',
    }]);

    const fields = {
      pipeline_id:  fsV('en-webinar'),
      etapa:        fsV('Inscrito en Webinar'),
      link_webinar: fsV(personalUrl),
      historial:    fsV(hist),
    };
    const mask = Object.keys(fields).join('&updateMask.fieldPaths=');

    await fetch(`${FS_BASE}/leads/${lead.id}?key=${FS_KEY}&updateMask.fieldPaths=${mask}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields }),
    });

    // Also send the email via the server
    try {
      await fetch(`${SERVER_URL}/send-webinar-email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ correo, nombre, personalUrl }),
      });
    } catch (_) {}

    // Update local lead object
    lead.pipeline_id  = 'en-webinar';
    lead.etapa        = 'Inscrito en Webinar';
    lead.link_webinar = personalUrl;
    lead.historial    = hist;

    btn.innerHTML = '✅ Enviado a Webinar';
    msgEl.style.background = 'rgba(0,200,117,.1)';
    msgEl.style.color = '#00c875';
    msgEl.style.border = '1px solid rgba(0,200,117,.25)';
    msgEl.innerHTML = `✓ Lead movido a <strong>En Webinar</strong>. Correo enviado a ${correo}.`;
    msgEl.style.display = 'block';

    showToast(`✅ ${nombre} enviado al webinar`);
    renderKanban(); renderSidebar();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '🎥 Enviar a Webinar';
    msgEl.style.background = 'rgba(248,113,113,.08)';
    msgEl.style.color = '#f87171';
    msgEl.style.border = '1px solid rgba(248,113,113,.25)';
    msgEl.textContent = '❌ Error: ' + err.message;
    msgEl.style.display = 'block';
  }
}

async function renderCalendario() {
  const DIAS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  // Build week days (Mon–Sun)
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(calWeekStart);
    d.setDate(d.getDate() + i);
    week.push(d);
  }

  // Week label for topbar
  const w0 = week[0], w6 = week[6];
  const sameMonth = w0.getMonth() === w6.getMonth();
  const weekLabel = sameMonth
    ? `${w0.getDate()} – ${w6.getDate()} ${MESES[w6.getMonth()]} ${w6.getFullYear()}`
    : `${w0.getDate()} ${MESES[w0.getMonth()]} – ${w6.getDate()} ${MESES[w6.getMonth()]} ${w6.getFullYear()}`;
  document.getElementById('cal-month-label').textContent = weekLabel;

  // Fetch interview config
  let cfg = {};
  try { const r = await fetch(`${SERVER_URL}/interviews/config`); cfg = (await r.json()).config || {}; } catch {}
  const sched      = cfg.schedule || {};
  const availDays  = sched.days ?? [1,2,3,4,5]; // 0=Sun
  const startH     = sched.startHour ?? 9;
  const endH       = sched.endHour   ?? 18;

  // Fetch booked interviews
  let booked = [];
  try { const r = await fetch(`${SERVER_URL}/interviews`); booked = (await r.json()).interviews || []; } catch {}

  const today = new Date(); today.setHours(0,0,0,0);
  const hours = [];
  for (let h = startH; h < endH; h++) hours.push(h);

  // Helper: leads with cita on a given date+hour
  function citaLeadsAt(date, h) {
    const dateStr = date.toISOString().slice(0,10);
    return leads.filter(l => {
      if (!l.cita?.fecha) return false;
      const [lh] = (l.cita.hora || '0:00').split(':');
      return l.cita.fecha === dateStr && parseInt(lh) === h;
    });
  }

  // Helper: booked interviews at date+hour
  function bookedAt(date, h) {
    const dateStr = date.toISOString().slice(0,10);
    return booked.filter(iv => {
      if (!iv.slotIso) return false;
      const d = new Date(iv.slotIso);
      return d.toISOString().slice(0,10) === dateStr && d.getHours() === h && iv.status !== 'cancelled';
    });
  }

  // Build grid HTML
  const cols = 7;
  // Header row
  let headerHtml = `<div class="cwk-corner"></div>`;
  week.forEach((d, i) => {
    const isToday = d.getTime() === today.getTime();
    const dow = d.getDay(); // 0=Sun
    const isAvailDay = availDays.includes(dow);
    headerHtml += `<div class="cwk-day-hdr${isToday?' today':''}${isAvailDay?'':' unavail'}">
      <div class="cwk-day-name">${DIAS_SHORT[i]}</div>
      <div class="cwk-day-date${isToday?' today':''}">${d.getDate()} ${MESES[d.getMonth()]}</div>
    </div>`;
  });

  // Body rows (one per hour)
  let bodyHtml = '';
  for (const h of hours) {
    const hLabel = `${String(h).padStart(2,'0')}:00`;
    bodyHtml += `<div class="cwk-hour-label">${hLabel}</div>`;
    week.forEach(d => {
      const dow       = d.getDay();
      const isAvail   = availDays.includes(dow) && d >= today;
      const clead     = citaLeadsAt(d, h);
      const blist     = bookedAt(d, h);
      const isToday   = d.getTime() === today.getTime();

      let cellContent = '';
      // Booked interviews (from /interviews)
      blist.forEach(iv => {
        cellContent += `<div class="cwk-booked" title="${esc(iv.leadName||'')}">
          <div class="cwk-booked-name">🎙 ${esc(iv.leadName || 'Entrevista')}</div>
          <div class="cwk-booked-sub">${String(h).padStart(2,'0')}:00</div>
        </div>`;
      });
      // CRM cita leads
      clead.forEach(l => {
        cellContent += `<div class="cwk-booked cwk-cita" onclick="openLead('${l.id}','cita')" title="${esc(l.nombre)}">
          <div class="cwk-booked-name">📋 ${esc(l.nombre)}</div>
          <div class="cwk-booked-sub">${l.cita.hora||hLabel} · ${esc(l.cita.tipo||'')}</div>
        </div>`;
      });

      const isEmpty = !cellContent;
      const cellCls = [
        'cwk-cell',
        isAvail   ? 'avail'   : 'unavail',
        isToday   ? 'today'   : '',
        !isEmpty  ? 'has-event' : '',
      ].filter(Boolean).join(' ');

      bodyHtml += `<div class="${cellCls}">
        ${isEmpty && isAvail ? `<div class="cwk-free">Libre</div>` : cellContent}
      </div>`;
    });
  }

  document.getElementById('cal-grid').innerHTML =
    `<div class="cwk-grid" style="--cwk-cols:${cols};">
      ${headerHtml}
      ${bodyHtml}
    </div>`;
}

// ════════════════════════════════════════════
