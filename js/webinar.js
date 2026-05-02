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

function calGoToday() { calYear = new Date().getFullYear(); calMonth = new Date().getMonth(); renderCalendario(); }

function renderCalendario() {
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  document.getElementById('cal-month-label').textContent = `${MESES[calMonth]} ${calYear}`;

  const hoy = new Date();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const daysInPrev  = new Date(calYear, calMonth, 0).getDate();

  // Leads con cita en este mes
  const citaLeads = leads.filter(l => {
    if (!l.cita?.fecha) return false;
    const d = new Date(l.cita.fecha + 'T00:00:00');
    return d.getFullYear() === calYear && d.getMonth() === calMonth;
  });

  let html = DIAS.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  // Días del mes anterior
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month"><div class="cal-day-num">${daysInPrev - i}</div></div>`;
  }

  // Días del mes actual
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === hoy.getDate() && calMonth === hoy.getMonth() && calYear === hoy.getFullYear();
    const dayLeads = citaLeads.filter(l => new Date(l.cita.fecha + 'T00:00:00').getDate() === d);
    const events = dayLeads.map(l => `
      <div class="cal-event" onclick="openLead('${l.id}','cita')" title="${esc(l.nombre)} — ${l.cita.tipo||''}">
        <div class="cal-event-name">${esc(l.nombre)}</div>
        <div class="cal-event-time">${l.cita.hora||''} · ${esc(l.cita.tipo||'')}</div>
      </div>`).join('');
    html += `<div class="cal-day${isToday?' today':''}">
      <div class="cal-day-num">${d}</div>
      ${events}
    </div>`;
  }

  // Días del mes siguiente para completar la grilla
  const total = firstDay + daysInMonth;
  const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-day other-month"><div class="cal-day-num">${i}</div></div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;
}


// ── Core: move lead to En Webinar + send email ────────────────────────────────
async function _registrarEnWebinar(lead, prevEtapa) {
  if (lead.webinar_email_enviado) return; // already sent, skip duplicate
  const personalUrl = `${location.origin}/webinar.html?id=${lead.id}&nombre=${encodeURIComponent(lead.nombre||'')}&correo=${encodeURIComponent(lead.correo||'')}`;

  lead.pipeline_id               = 'en-webinar';
  lead.etapa                     = 'Inscrito en Webinar';
  lead.fecha_inscripcion_webinar = lead.fecha_inscripcion_webinar || new Date().toISOString();
  lead.link_webinar              = personalUrl;
  addHistorial(lead.id, `Inscrito en Webinar${prevEtapa ? ` (desde ${prevEtapa})` : ''} — link personalizado generado`, '🎥');
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
    { match: e => /^en webinar$/i.test(e),                         pipeline:'en-webinar',             etapa:'Inscrito en Webinar',    msg:'EN WEBINAR → Inscrito en Webinar' },
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
    const res   = await fetch('/interviews/slots');
    const data  = await res.json();
    const slots = data.slots || [];
    if (!slots.length) {
      document.getElementById('agendar-cita-status').textContent = 'No hay horarios disponibles. Revisa la configuración del calendario.';
      return;
    }
    document.getElementById('agendar-cita-status').textContent = 'Selecciona un horario:';
    document.getElementById('agendar-cita-slots').innerHTML = slots.map(s => {
      const d   = new Date(s);
      const lbl = d.toLocaleString('es-MX', { weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<button onclick="_acBookSlot('${s}')" style="text-align:left;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.3);color:var(--text);border-radius:8px;padding:9px 14px;cursor:pointer;font-size:12.5px;font-family:var(--font);transition:background .15s;" onmouseover="this.style.background='rgba(99,102,241,.25)'" onmouseout="this.style.background='rgba(99,102,241,.12)'">📅 ${lbl}</button>`;
    }).join('');
  } catch(e) {
    document.getElementById('agendar-cita-status').textContent = 'Error cargando horarios: ' + e.message;
  }
}

function closeAgendarCitaModal() {
  document.getElementById('agendar-cita-modal').classList.add('hidden');
  _acLead = null;
}

async function _acBookSlot(slot) {
  if (!_acLead) return;
  const d   = new Date(slot);
  const lbl = d.toLocaleString('es-MX', { weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  if (!confirm(`¿Confirmar entrevista el ${lbl}?`)) return;

  document.getElementById('agendar-cita-status').textContent = 'Agendando...';
  document.getElementById('agendar-cita-slots').innerHTML = '';

  try {
    const res  = await fetch('/interviews/book', {
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

    const fields = {
      pipeline_id: toFsVal('entrevistas-generales'),
      etapa:       toFsVal('EN ENTREVISTA'),
      historial:   toFsVal(hist),
    };
    const mask = Object.keys(fields).join('&updateMask.fieldPaths=');
    await fetch(`${FS_BASE}/leads/${_acLead.id}?key=${FS_KEY}&updateMask.fieldPaths=${mask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });

    // Update local state
    _acLead.pipeline_id = 'entrevistas-generales';
    _acLead.etapa       = 'EN ENTREVISTA';
    _acLead.historial   = hist;

    closeAgendarCitaModal();
    showToast(`✅ Entrevista agendada — ${_acLead.nombre} movido a Entrevistas Generales`);
    renderKanban();
    renderSidebar();
  } catch(e) {
    document.getElementById('agendar-cita-status').textContent = 'Error: ' + e.message;
  }
}

