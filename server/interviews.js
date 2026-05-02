const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
const CONFIG_DOC = `${FS_BASE}/config/interview_config?key=${FS_KEY}`;

const { sendWhatsAppTemplate, sendTemplateOrFallback, TEMPLATES } = require('./templates');

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_INTERVIEW_CONFIG = {
  interviewer: {
    name:  'Entrevistador',
    phone: '+584142055978',
  },
  zoomLink: 'https://zoom.us/j/XXXXXXXXXX',
  schedule: {
    // days: array of weekday numbers 1=Mon…5=Fri
    days:      [1, 2, 3, 4, 5],
    startHour: 9,    // 9:00 AM
    endHour:   18,   // 6:00 PM
    // overrides: [{ date:'YYYY-MM-DD', startHour, endHour, enabled:bool }]
    overrides: [],
  },
  rules: {
    minHoursAhead: 3,   // minimum hours from now
    maxDaysOut:    3,   // max days after webinar
    maxOptions:    3,   // max slot options to offer
    slotDuration:  60,  // minutes per interview
  },
  reminders: [
    {
      id:      'r1',
      label:   'Recordatorio mañana',
      trigger: 'morning_of',    // 'morning_of' | 'hours_before' | 'minutes_after'
      value:   8,               // 8:00 AM for morning_of; N hours/minutes for others
      message: 'Hola {nombre}, te recordamos que hoy tienes tu entrevista a las {hora} vía Zoom. ¡Te esperamos!',
    },
    {
      id:      'r2',
      label:   'Recordatorio 1h antes',
      trigger: 'hours_before',
      value:   1,
      message: '¿Podrías confirmarme si asistirás a tu entrevista de hoy a las {hora}?',
    },
    {
      id:      'r3',
      label:   'Sin confirmación',
      trigger: 'minutes_after',
      value:   28,
      message: 'El aplicante {nombre} no ha confirmado asistencia a la entrevista de las {hora}.',
      notifyManager: true,
      notifyInterviewer: true,
    },
  ],
  confirmation: {
    hoursAfterBooking: 0,   // 0 = immediate
    message: '✅ Tu entrevista ha sido agendada para el {fecha} a las {hora}.\n\nTe enviaremos el link de Zoom el día de la entrevista.\n\n¡Nos vemos pronto!',
  },
};

// ── Firestore helpers ─────────────────────────────────────────────────────────
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } };
  return { nullValue: null };
}

function fsParse(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v.stringValue  !== undefined) out[k] = v.stringValue;
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.doubleValue  !== undefined) out[k] = v.doubleValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.nullValue    !== undefined) out[k] = null;
    else if (v.arrayValue)  out[k] = (v.arrayValue.values || []).map(i => i.mapValue ? fsParse(i.mapValue.fields || {}) : fsParseSingle(i));
    else if (v.mapValue)    out[k] = fsParse(v.mapValue.fields || {});
  }
  return out;
}

function fsParseSingle(v) {
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.doubleValue  !== undefined) return v.doubleValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.nullValue    !== undefined) return null;
  if (v.mapValue)    return fsParse(v.mapValue.fields || {});
  if (v.arrayValue)  return (v.arrayValue.values || []).map(fsParseSingle);
  return null;
}

// ── Config load/save ──────────────────────────────────────────────────────────
let _configCache = null;

async function loadInterviewConfig() {
  try {
    const res  = await fetch(CONFIG_DOC);
    const data = await res.json();
    if (data.fields) {
      const cfg = fsParse(data.fields);
      return deepMerge(DEFAULT_INTERVIEW_CONFIG, cfg);
    }
  } catch {}
  return { ...DEFAULT_INTERVIEW_CONFIG };
}

async function saveInterviewConfig(cfg) {
  _configCache = cfg;
  try {
    const res = await fetch(CONFIG_DOC, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields: fsVal(cfg).mapValue.fields }),
    });
    return res.ok;
  } catch { return false; }
}

function deepMerge(defaults, override) {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(override || {})) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof defaults[k] === 'object' && !Array.isArray(defaults[k])) {
      out[k] = deepMerge(defaults[k], v);
    } else if (v !== null && v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

// ── Available slots ───────────────────────────────────────────────────────────
async function getAvailableSlots(cfg, fromDate) {
  const now      = fromDate || new Date();
  const rules    = cfg.rules;
  const sched    = cfg.schedule;
  const minMs    = (rules.minHoursAhead || 3) * 60 * 60 * 1000;
  const earliest = new Date(now.getTime() + minMs);
  const booked   = await getBookedSlots();
  const SLOTS_PER_DAY = 3;
  const MAX_LOOK = 14; // days to scan

  function getSlotsForDay(date) {
    const weekday  = date.getDay();
    const override = (sched.overrides || []).find(o => o.date === toDateStr(date));
    const enabled  = override ? override.enabled !== false : (sched.days || [1,2,3,4,5]).includes(weekday);
    if (!enabled) return [];
    const startH = override ? override.startHour : (sched.startHour ?? 9);
    const endH   = override ? override.endHour   : (sched.endHour   ?? 18);
    // Collect all available hours for the day
    const allHours = [];
    for (let h = startH; h < endH; h++) {
      const slotTime = new Date(date);
      slotTime.setHours(h, 0, 0, 0);
      if (slotTime < earliest) continue;
      const slotKey = toDateStr(date) + 'T' + String(h).padStart(2,'0') + ':00';
      if (booked.has(slotKey)) continue;
      allHours.push(h);
    }
    if (!allHours.length) return [];
    // Pick SLOTS_PER_DAY spread across the day (not consecutive)
    const picked = [];
    if (allHours.length <= SLOTS_PER_DAY) {
      picked.push(...allHours);
    } else {
      // Divide day into thirds and pick one random hour from each third
      const third = Math.floor(allHours.length / SLOTS_PER_DAY);
      for (let i = 0; i < SLOTS_PER_DAY; i++) {
        const segStart = i * third;
        const segEnd   = i === SLOTS_PER_DAY - 1 ? allHours.length : (i + 1) * third;
        const seg      = allHours.slice(segStart, segEnd);
        picked.push(seg[Math.floor(Math.random() * seg.length)]);
      }
    }
    return picked.map(h => {
      const slotTime = new Date(date);
      slotTime.setHours(h, 0, 0, 0);
      return { date: toDateStr(date), hour: h, iso: slotTime.toISOString(), label: formatSlotLabel(slotTime) };
    });
  }

  // Day 1: today (or first available day)
  let day1Slots = [], day1Offset = -1;
  for (let offset = 0; offset < MAX_LOOK; offset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    const s = getSlotsForDay(date);
    if (s.length) { day1Slots = s; day1Offset = offset; break; }
  }

  // Day 2: next available day after day1
  let day2Slots = [];
  for (let offset = day1Offset + 1; offset < MAX_LOOK; offset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    const s = getSlotsForDay(date);
    if (s.length) { day2Slots = s; break; }
  }

  return [...day1Slots, ...day2Slots];
}

async function getBookedSlots() {
  try {
    const res  = await fetch(`${FS_BASE}/interviews?key=${FS_KEY}&pageSize=200`);
    const data = await res.json();
    const set  = new Set();
    for (const doc of data.documents || []) {
      const f = doc.fields || {};
      const iso = f.slotIso?.stringValue;
      if (iso && f.status?.stringValue !== 'cancelled') {
        const d = new Date(iso);
        set.add(toDateStr(d) + 'T' + String(d.getHours()).padStart(2,'0') + ':00');
      }
    }
    return set;
  } catch { return new Set(); }
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function formatSlotLabel(d) {
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} · ${h12}:00 ${ampm}`;
}

// ── Book interview ────────────────────────────────────────────────────────────
async function bookInterview({ leadPhone, leadName, slotIso, convKey }) {
  const id   = 'int_' + Date.now();
  const cfg  = await loadInterviewConfig();
  const slot = new Date(slotIso);
  const doc  = {
    id, leadPhone, leadName, slotIso, convKey,
    interviewer: cfg.interviewer.name,
    zoomLink:    cfg.zoomLink,
    status:      'scheduled',
    createdAt:   new Date().toISOString(),
    reminders:   {},
  };
  await fetch(`${FS_BASE}/interviews/${id}?key=${FS_KEY}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields: fsVal(doc).mapValue.fields }),
  });

  // Build fecha/hora strings for templates
  const { fecha, hora } = _fmtSlot(slot);
  const firstName = (leadName || 'Candidato').split(' ')[0];
  const phoneClean = (leadPhone || '').replace(/^\+/, '');

  // Confirmation to candidate
  const confFallback = `¡Hola ${firstName}! 🎉\n\nTu entrevista con Grupo Élite Work ha sido confirmada.\n\n📅 Fecha: ${fecha}\n🕐 Hora: ${hora}\n🔗 Enlace Zoom: ${cfg.zoomLink}\n\n¡Te esperamos!`;
  sendTemplateOrFallback(phoneClean, 'confirmacion_entrevista', [firstName, fecha, hora, cfg.zoomLink], confFallback, null).catch(() => {});

  return { id, cfg, doc };
}

function _fmtSlot(d) {
  const days   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const h   = d.getHours();
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return {
    fecha: `${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]}`,
    hora:  `${h12}:00 ${ampm}`,
  };
}

// ── List interviews ───────────────────────────────────────────────────────────
async function listInterviews() {
  try {
    const res  = await fetch(`${FS_BASE}/interviews?key=${FS_KEY}&pageSize=500`);
    const data = await res.json();
    return (data.documents || []).map(d => fsParse(d.fields || {}));
  } catch { return []; }
}

async function updateInterview(id, updates) {
  const existing = await getInterview(id);
  if (!existing) return false;
  const merged = { ...existing, ...updates };
  try {
    const res = await fetch(`${FS_BASE}/interviews/${id}?key=${FS_KEY}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields: fsVal(merged).mapValue.fields }),
    });
    return res.ok;
  } catch { return false; }
}

async function getInterview(id) {
  try {
    const res  = await fetch(`${FS_BASE}/interviews/${id}?key=${FS_KEY}`);
    const data = await res.json();
    return data.fields ? fsParse(data.fields) : null;
  } catch { return null; }
}

// ── Reminder checker (called every minute by server) ─────────────────────────
async function checkInterviewReminders(sendWA) {
  const cfg         = await loadInterviewConfig();
  const interviews  = await listInterviews();
  const now         = new Date();

  for (const iv of interviews) {
    if (iv.status === 'cancelled' || iv.status === 'done') continue;
    const slotTime = new Date(iv.slotIso);
    const reminders = iv.reminders || {};

    for (const rem of cfg.reminders || []) {
      if (reminders[rem.id]) continue; // already sent

      let shouldSend = false;
      if (rem.trigger === 'morning_of') {
        // Send at rem.value:00 AM on the day of the interview
        const sameDay  = toDateStr(slotTime) === toDateStr(now);
        const rightHour = now.getHours() === rem.value && now.getMinutes() < 5;
        shouldSend = sameDay && rightHour;
      } else if (rem.trigger === 'hours_before') {
        const diffH = (slotTime - now) / (1000 * 60 * 60);
        shouldSend = diffH <= rem.value && diffH > 0;
      } else if (rem.trigger === 'minutes_after') {
        const diffMin = (now - slotTime) / (1000 * 60);
        shouldSend = diffMin >= rem.value && diffMin < rem.value + 5;
      }

      if (!shouldSend) continue;

      const msg       = fillTemplate(rem.message, iv, slotTime);
      const firstName = (iv.leadName || 'Candidato').split(' ')[0];
      const { fecha, hora } = _fmtSlot(slotTime);

      if (rem.notifyManager || rem.notifyInterviewer) {
        // Notify interviewer via template
        if (cfg.interviewer.phone) {
          const ivPhone  = cfg.interviewer.phone.replace(/^\+/, '');
          const ivFallback = `📅 Recordatorio: tienes una entrevista con ${iv.leadName || 'un candidato'} el ${fecha} a las ${hora}.\nZoom: ${iv.zoomLink}`;
          await sendTemplateOrFallback(ivPhone, 'entrevista_agendada_int',
            [iv.leadName || 'Candidato', iv.leadPhone || '', `${fecha} · ${hora}`, iv.zoomLink || ''],
            ivFallback, sendWA
          ).catch(() => {});
        }
      } else {
        // Notify candidate via template
        const phone = (iv.leadPhone || '').replace(/^\+/, '');
        if (phone) {
          let tplKey = 'recordatorio_dia_antes';
          let tplParams = [firstName, fecha, hora, iv.zoomLink || ''];

          if (rem.trigger === 'hours_before') {
            tplKey   = 'recordatorio_horas_antes';
            tplParams = [firstName, String(rem.value), iv.zoomLink || ''];
          }

          await sendTemplateOrFallback(phone, tplKey, tplParams, msg, sendWA).catch(() => {});
        }
      }

      // Mark reminder as sent
      reminders[rem.id] = new Date().toISOString();
      await updateInterview(iv.id, { reminders });
    }

    // Send Zoom link at exact slot time
    if (!reminders['zoom_sent']) {
      const diffMin = (now - slotTime) / (1000 * 60);
      if (diffMin >= 0 && diffMin < 5) {
        const phone = (iv.leadPhone || '').replace(/^\+/, '');
        if (phone) {
          const firstName = (iv.leadName || 'Candidato').split(' ')[0];
          const zoomFallback = `🎥 Tu entrevista comienza ahora. Únete aquí:\n${iv.zoomLink}`;
          await sendTemplateOrFallback(phone, 'enlace_zoom_inicio',
            [firstName, iv.zoomLink || ''], zoomFallback, sendWA
          ).catch(() => {});
        }
        reminders['zoom_sent'] = new Date().toISOString();
        await updateInterview(iv.id, { reminders });
      }
    }
  }
}

function fillTemplate(template, iv, slotTime) {
  const days   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const h   = slotTime.getHours();
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hora  = `${h12}:00 ${ampm}`;
  const fecha = `${days[slotTime.getDay()]} ${slotTime.getDate()} de ${months[slotTime.getMonth()]}`;
  return template
    .replace(/\{nombre\}/g,       iv.leadName  || 'Candidato')
    .replace(/\{hora\}/g,         hora)
    .replace(/\{fecha\}/g,        fecha)
    .replace(/\{entrevistador\}/g, iv.interviewer || '')
    .replace(/\{zoom\}/g,         iv.zoomLink   || '');
}

module.exports = {
  loadInterviewConfig,
  saveInterviewConfig,
  getAvailableSlots,
  bookInterview,
  listInterviews,
  updateInterview,
  checkInterviewReminders,
  fillTemplate,
  DEFAULT_INTERVIEW_CONFIG,
};
