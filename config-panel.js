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

      ${typeof _originalAdminSession !== 'undefined' && _originalAdminSession ? `
      <!-- BANNER IMPERSONACIÓN -->
      <div class="cfg-section" style="border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.05);margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div class="cfg-section-title" style="color:#f59e0b;margin-bottom:4px;">👁 Vista de otro usuario</div>
            <p style="font-size:13px;color:var(--text3);margin:0;">Estás viendo el sistema como <strong style="color:var(--text);">${u.name}</strong>. Tus acciones afectan esta cuenta.</p>
          </div>
          <button onclick="returnAsAdmin()" style="padding:9px 18px;background:rgba(245,158,11,.2);border:1px solid rgba(245,158,11,.4);border-radius:8px;color:#f59e0b;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:var(--font);">⬅ Volver como Admin</button>
        </div>
      </div>` : ''}

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
        </div>
        <button class="cfg-save-btn" onclick="saveConfigProfile()">Guardar nombre</button>
      </div>

      <!-- SEGURIDAD -->
      <div class="cfg-section">
        <div class="cfg-section-title">🔐 Cambiar credenciales</div>
        <p style="font-size:13px;color:var(--text3);margin-bottom:16px;line-height:1.6;">
          Necesitas tu contraseña actual para confirmar cualquier cambio.
        </p>
        <div class="cfg-field-grid">
          <div class="cfg-field">
            <label>Contraseña actual <span style="color:var(--red);">*</span></label>
            <input id="sec-current-pass" type="password" placeholder="Tu contraseña actual" autocomplete="current-password" />
          </div>
          <div class="cfg-field">
            <label>Nuevo correo electrónico</label>
            <input id="sec-new-email" type="email" value="${u.email || ''}" placeholder="nuevo@correo.com" autocomplete="email" />
          </div>
          <div class="cfg-field">
            <label>Nueva contraseña</label>
            <input id="sec-new-pass" type="password" placeholder="Dejar vacío para no cambiar" autocomplete="new-password" />
          </div>
          <div class="cfg-field">
            <label>Confirmar nueva contraseña</label>
            <input id="sec-confirm-pass" type="password" placeholder="Repite la nueva contraseña" autocomplete="new-password" />
          </div>
        </div>
        <div id="sec-error" style="font-size:12px;color:var(--red);margin-bottom:10px;display:none;padding:8px 12px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:7px;"></div>
        <button class="cfg-save-btn" onclick="saveCredentials()">Actualizar credenciales</button>
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
  const name = document.getElementById('cfg-name').value.trim();
  if (!name) { showToast('⚠️ El nombre es requerido'); return; }
  currentUser.name = name;
  const sess = JSON.parse(localStorage.getItem('er_session') || '{}');
  sess.name = name;
  localStorage.setItem('er_session', JSON.stringify(sess));
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-avatar').textContent = name[0];
  showToast('✅ Nombre actualizado');
  renderConfig();
}

async function saveCredentials() {
  const currentPass = document.getElementById('sec-current-pass').value;
  const newEmail    = document.getElementById('sec-new-email').value.trim();
  const newPass     = document.getElementById('sec-new-pass').value;
  const confirmPass = document.getElementById('sec-confirm-pass').value;
  const errEl       = document.getElementById('sec-error');
  errEl.style.display = 'none';

  const origEmail = currentUser.email || '';
  const emailChanged = newEmail && newEmail.toLowerCase() !== origEmail.toLowerCase();

  if (!currentPass) { errEl.textContent = 'Ingresa tu contraseña actual para confirmar.'; errEl.style.display = 'block'; return; }
  if (!emailChanged && !newPass) { errEl.textContent = 'Ingresa al menos un cambio (correo o contraseña nueva).'; errEl.style.display = 'block'; return; }
  if (newPass && newPass !== confirmPass) { errEl.textContent = 'Las contraseñas nuevas no coinciden.'; errEl.style.display = 'block'; return; }
  if (newPass && newPass.length < 6) { errEl.textContent = 'La contraseña nueva debe tener al menos 6 caracteres.'; errEl.style.display = 'block'; return; }

  const btn = document.querySelector('#sec-error ~ button') || document.querySelector('[onclick="saveCredentials()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const body = { current_password: currentPass };
    if (emailChanged) body.new_correo = newEmail;
    if (newPass)      body.new_password = newPass;

    const r    = await fetch(`${SERVER_URL}/auth/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-token': _sessionToken },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!data.ok) { errEl.textContent = data.error; errEl.style.display = 'block'; return; }

    if (emailChanged) {
      currentUser.email = newEmail;
      const sess = JSON.parse(localStorage.getItem('er_session') || '{}');
      sess.correo = newEmail;
      localStorage.setItem('er_session', JSON.stringify(sess));
    }
    showToast('✅ Credenciales actualizadas');
    document.getElementById('sec-current-pass').value = '';
    document.getElementById('sec-new-pass').value = '';
    document.getElementById('sec-confirm-pass').value = '';
    renderConfig();
  } catch(e) {
    errEl.textContent = 'Error de conexión. Intenta de nuevo.';
    errEl.style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Actualizar credenciales'; }
  }
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

    await fetch(`${SERVER_URL}/leads`, {
      method: 'POST',
      headers: _leadHeaders(),
      body: JSON.stringify({
        id:           leadId,
        nombre,       telefono,    correo,
        fuente:       'Registro Manual Webinar',
        etapa:        'En Webinar sin actividad',
        pipeline_id:  'en-webinar',
        estado:       'abierto',
        valor:        0,
        propietario:  currentUser?.nombre || 'Admin',
        link_webinar: personalUrl,
        webinar_email_enviado: now,
        created_at:   now,
        notas: [], tareas: [], pagos: [], etiquetas: [],
        historial: [{ icono:'📝', accion:`Inscrito manualmente en el webinar por ${currentUser?.nombre||'Admin'}`, fecha:now, usuario:currentUser?.nombre||'Admin' }],
      }),
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
      fuente: 'Registro Manual Webinar', etapa: 'En Webinar sin actividad',
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
    const WURL = 'https://crm.grupoelitework.com/webinar.html';
    const personalUrl = `${WURL}?id=${lead.id}&nombre=${encodeURIComponent(nombre)}&correo=${encodeURIComponent(correo)}`;
    const now         = new Date().toISOString();

    // Build new historial entry
    const hist = (lead.historial || []).concat([{
      icono: '🎥',
      accion: `Enviado a Webinar manualmente por ${currentUser?.nombre || 'Admin'} — link personalizado generado`,
      fecha:   now,
      usuario: currentUser?.nombre || 'Admin',
    }]);

    await fetch(`${SERVER_URL}/leads/${lead.id}`, {
      method:  'PATCH',
      headers: _leadHeaders(),
      body:    JSON.stringify({
        pipeline_id:  'en-webinar',
        etapa:        'En Webinar sin actividad',
        link_webinar: personalUrl,
        historial:    hist,
      }),
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
    lead.etapa        = 'En Webinar sin actividad';
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
  const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const MESES_LONG  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const MESES_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(calWeekStart);
    d.setDate(d.getDate() + i);
    week.push(d);
  }

  // Topbar label
  const w0 = week[0], w6 = week[6];
  const sameMonth = w0.getMonth() === w6.getMonth();
  const weekLabel = sameMonth
    ? `${w0.getDate()} – ${w6.getDate()} de ${MESES_LONG[w6.getMonth()]} ${w6.getFullYear()}`
    : `${w0.getDate()} ${MESES_SHORT[w0.getMonth()]} – ${w6.getDate()} ${MESES_SHORT[w6.getMonth()]} ${w6.getFullYear()}`;
  document.getElementById('cal-month-label').textContent = weekLabel;

  let cfg = {};
  try { cfg = (await fetch(`${SERVER_URL}/interviews/config`).then(r=>r.json())).config || {}; } catch {}
  const sched     = cfg.schedule || {};
  const availDays = sched.days ?? [1,2,3,4,5];
  const startH    = sched.startHour ?? 9;
  const endH      = sched.endHour   ?? 18;

  let booked = [];
  try { booked = (await fetch(`${SERVER_URL}/interviews`).then(r=>r.json())).interviews || []; } catch {}

  const now   = new Date();
  const today = new Date(); today.setHours(0,0,0,0);
  const hours = [];
  for (let h = startH; h < endH; h++) hours.push(h);

  function citaLeadsAt(date, h) {
    const ds = date.toISOString().slice(0,10);
    return leads.filter(l => {
      if (!l.cita?.fecha) return false;
      const [lh] = (l.cita.hora || '0:00').split(':');
      return l.cita.fecha === ds && parseInt(lh) === h;
    });
  }
  function bookedAt(date, h) {
    const ds = date.toISOString().slice(0,10);
    return booked.filter(iv => {
      if (!iv.slotIso) return false;
      const d = new Date(iv.slotIso);
      return d.toISOString().slice(0,10) === ds && d.getHours() === h && iv.status !== 'cancelled';
    });
  }

  // Header
  let headerHtml = `<div class="cwk-corner"></div>`;
  week.forEach((d, i) => {
    const isToday    = d.getTime() === today.getTime();
    const isAvailDay = availDays.includes(d.getDay());
    headerHtml += `<div class="cwk-day-hdr${isToday?' today':''}${isAvailDay?'':' unavail'}">
      <div class="cwk-day-name">${DIAS[i]}</div>
      <div class="cwk-day-num${isToday?' today':''}">${d.getDate()}</div>
    </div>`;
  });

  // Body
  let bodyHtml = '';
  const todayInView = week.some(d => d.getTime() === today.getTime());
  const nowMinutes  = now.getHours() * 60 + now.getMinutes();
  const rangeMinutes= startH * 60;
  const totalMin    = (endH - startH) * 60;

  for (const h of hours) {
    const hLabel = `${String(h).padStart(2,'0')}:00`;
    bodyHtml += `<div class="cwk-hour-label">${hLabel}</div>`;

    week.forEach(d => {
      const isAvail = availDays.includes(d.getDay()) && d >= today;
      const isToday = d.getTime() === today.getTime();
      const clead   = citaLeadsAt(d, h);
      const blist   = bookedAt(d, h);

      let cellContent = '';
      blist.forEach(iv => {
        cellContent += `<div class="cwk-event interview" title="${esc(iv.leadName||'Entrevista')}">
          <div class="cwk-event-name">🎙 ${esc(iv.leadName || 'Entrevista')}</div>
          <div class="cwk-event-meta">${hLabel}</div>
        </div>`;
      });
      clead.forEach(l => {
        cellContent += `<div class="cwk-event cita" onclick="openLead('${l.id}','cita')" title="${esc(l.nombre)}">
          <div class="cwk-event-name">📋 ${esc(l.nombre)}</div>
          <div class="cwk-event-meta">${l.cita.hora||hLabel}${l.cita.tipo ? ' · '+esc(l.cita.tipo) : ''}</div>
        </div>`;
      });

      const cellCls = ['cwk-cell', isAvail?'avail':'unavail', isToday?'today':''].filter(Boolean).join(' ');
      bodyHtml += `<div class="${cellCls}">
        ${!cellContent && isAvail ? `<div class="cwk-free"></div>` : cellContent}
      </div>`;
    });
  }

  // Current-time line
  let nowLineHtml = '';
  if (todayInView && nowMinutes >= rangeMinutes && nowMinutes < rangeMinutes + totalMin) {
    const pct = ((nowMinutes - rangeMinutes) / totalMin * 100).toFixed(2);
    const todayColIdx = week.findIndex(d => d.getTime() === today.getTime()); // 0-based
    nowLineHtml = `<div style="grid-column:1/-1;position:relative;height:0;pointer-events:none;z-index:4;">
      <div style="position:absolute;top:0;left:0;right:0;display:grid;grid-template-columns:56px repeat(7,1fr);">
        <div></div>
        ${week.map((_, ci) => ci === todayColIdx
          ? `<div style="position:relative;"><div style="position:absolute;top:0;left:0;right:0;height:2px;background:rgba(239,68,68,.8);"></div><div style="position:absolute;top:-4px;left:-4px;width:8px;height:8px;border-radius:50%;background:#ef4444;"></div></div>`
          : `<div></div>`
        ).join('')}
      </div>
    </div>`;
  }

  document.getElementById('cal-grid').innerHTML = `
    <div class="cwk-grid">
      ${headerHtml}
      ${bodyHtml}
    </div>`;
}

// ════════════════════════════════════════════
