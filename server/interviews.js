const db = require('./db');
const { sendTemplateOrFallback } = require('./templates');
const { ghlFindOrCreateContact, ghlBookAppointment, ghlGetFreeSlots } = require('./ghl');
const { isEnabled: _autoEnabled } = require('./automations');

// ── Office hours check (America/Chicago — Central Time) ───────────────────────
function isOfficeHours() {
  const ct      = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const day     = ct.getDay();   // 0=Sun,1=Mon…6=Sat
  const minutes = ct.getHours() * 60 + ct.getMinutes();
  if (day >= 1 && day <= 5) return minutes >= 9 * 60 && minutes < 18 * 60;  // Lun-Vie 9-18h
  if (day === 6)             return minutes >= 9 * 60 && minutes < 12 * 60;  // Sáb 9-12h
  return false;
}

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_INTERVIEW_CONFIG = {
  interviewer: {
    name:  'Entrevistador',
    phone: '+584142055978',
  },
  zoomLink: 'https://zoom.us/j/XXXXXXXXXX',
  schedule: {
    days:      [1, 2, 3, 4, 5],
    startHour: 9,
    endHour:   18,
    overrides: [],
  },
  rules: {
    minHoursAhead: 3,
    maxDaysOut:    3,
    maxOptions:    3,
    slotDuration:  60,
  },
  reminders: [
    {
      id:      'r1',
      label:   'Recordatorio mañana',
      trigger: 'morning_of',
      value:   8,
      message: 'Hola {nombre}, te recordamos que hoy tienes tu entrevista a las {hora} vía Zoom. ¡Te esperamos!',
      disabled: true,
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
    hoursAfterBooking: 0,
    message: '✅ Tu entrevista ha sido agendada para el {fecha} a las {hora}.\n\nTe enviaremos el link de Zoom el día de la entrevista.\n\n¡Nos vemos pronto!',
  },
};

// ── Row ↔ JS object ───────────────────────────────────────────────────────────
function rowToInterview(r) {
  return { id: r.id, ...r.data };
}

function interviewToRow(doc) {
  return {
    id:         doc.id,
    lead_phone: (doc.leadPhone || '').replace(/\D/g, ''),
    lead_name:  doc.leadName  || '',
    slot_iso:   doc.slotIso   || null,
    status:     doc.status    || 'scheduled',
    zoom_link:  doc.zoomLink  || '',
    conv_key:   doc.convKey   || '',
    data:       doc,
  };
}

// ── Config load/save ──────────────────────────────────────────────────────────
async function loadInterviewConfig() {
  try {
    const cfg = await db.sbGetConfig('interview_config');
    if (cfg) return deepMerge(DEFAULT_INTERVIEW_CONFIG, cfg);
  } catch {}
  return { ...DEFAULT_INTERVIEW_CONFIG };
}

async function saveInterviewConfig(cfg) {
  try {
    await db.sbSetConfig('interview_config', cfg);
    return true;
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

// ── Available slots — pulled from GHL calendar (fallback: internal logic) ─────
async function getAvailableSlots(cfg, fromDate) {
  try {
    const slots = await ghlGetFreeSlots(7, 'America/New_York');
    if (slots.length) return slots;
  } catch (e) {
    console.error('[GHL] getAvailableSlots fallback to internal:', e.message);
  }
  return _getAvailableSlotsInternal(cfg, fromDate);
}

async function _getAvailableSlotsInternal(cfg, fromDate) {
  const now      = fromDate || new Date();
  const rules    = cfg.rules;
  const sched    = cfg.schedule;
  const minMs    = (rules.minHoursAhead || 3) * 60 * 60 * 1000;
  const earliest = new Date(now.getTime() + minMs);
  const booked   = await getBookedSlots();
  const SLOTS_PER_DAY = 3;
  const MAX_LOOK = 14;

  function getSlotsForDay(date) {
    const weekday  = date.getDay();
    const override = (sched.overrides || []).find(o => o.date === toDateStr(date));
    const enabled  = override ? override.enabled !== false : (sched.days || [1,2,3,4,5]).includes(weekday);
    if (!enabled) return [];
    const startH = override ? override.startHour : (sched.startHour ?? 9);
    const endH   = override ? override.endHour   : (sched.endHour   ?? 18);
    const allHours = [];
    const dateStr = toDateStr(date);
    for (let h = startH; h < endH; h++) {
      const slotTime = makeETDate(dateStr, h);
      if (slotTime < earliest) continue;
      const slotKey = dateStr + 'T' + String(h).padStart(2,'0') + ':00';
      if (booked.has(slotKey)) continue;
      allHours.push(h);
    }
    if (!allHours.length) return [];
    const picked = [];
    if (allHours.length <= SLOTS_PER_DAY) {
      picked.push(...allHours);
    } else {
      const third = Math.floor(allHours.length / SLOTS_PER_DAY);
      for (let i = 0; i < SLOTS_PER_DAY; i++) {
        const segStart = i * third;
        const segEnd   = i === SLOTS_PER_DAY - 1 ? allHours.length : (i + 1) * third;
        const seg      = allHours.slice(segStart, segEnd);
        picked.push(seg[Math.floor(Math.random() * seg.length)]);
      }
    }
    return picked.map(h => {
      const dateStr  = toDateStr(date);
      const slotTime = makeETDate(dateStr, h);
      return { date: dateStr, hour: h, iso: slotTime.toISOString(), label: formatSlotLabel(slotTime) };
    });
  }

  let day1Slots = [], day1Offset = -1;
  for (let offset = 0; offset < MAX_LOOK; offset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    const s = getSlotsForDay(date);
    if (s.length) { day1Slots = s; day1Offset = offset; break; }
  }

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
    const rows = await db.sbGetInterviews();
    const set  = new Set();
    for (const r of rows) {
      const iso    = r.slot_iso || r.data?.slotIso;
      const status = r.status   || r.data?.status;
      if (iso && status !== 'cancelled') {
        const d     = new Date(iso);
        const etHour = parseInt(new Intl.DateTimeFormat('en-US', {
          timeZone: TEAM_TZ, hour: 'numeric', hour12: false,
        }).format(d));
        set.add(toDateStr(d) + 'T' + String(etHour).padStart(2,'0') + ':00');
      }
    }
    return set;
  } catch { return new Set(); }
}

const TEAM_TZ = 'America/New_York';

function makeETDate(dateStr, hour) {
  const provisional = new Date(`${dateStr}T${String(hour).padStart(2,'0')}:00:00Z`);
  const etHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: TEAM_TZ, hour: 'numeric', hour12: false,
  }).format(provisional));
  const diff = hour - etHour;
  return new Date(provisional.getTime() - diff * 3_600_000);
}

function toDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ }).format(d);
}

function formatSlotLabel(d, candidateTZ) {
  const fmtET = new Intl.DateTimeFormat('es-MX', {
    timeZone: TEAM_TZ,
    weekday: 'long', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  const label = fmtET.charAt(0).toUpperCase() + fmtET.slice(1) + ' ET';
  if (candidateTZ && candidateTZ !== TEAM_TZ) {
    const localTime = new Intl.DateTimeFormat('es-MX', {
      timeZone: candidateTZ, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
    return `${label} (${localTime} tu hora)`;
  }
  return label;
}

const STATE_TZ_MAP = {
  'florida': 'America/New_York', 'fl': 'America/New_York',
  'nueva york': 'America/New_York', 'new york': 'America/New_York', 'ny': 'America/New_York',
  'nueva jersey': 'America/New_York', 'new jersey': 'America/New_York', 'nj': 'America/New_York',
  'georgia': 'America/New_York', 'ga': 'America/New_York',
  'carolina del norte': 'America/New_York', 'north carolina': 'America/New_York', 'nc': 'America/New_York',
  'carolina del sur': 'America/New_York', 'south carolina': 'America/New_York', 'sc': 'America/New_York',
  'virginia': 'America/New_York', 'va': 'America/New_York',
  'pennsylvania': 'America/New_York', 'pa': 'America/New_York',
  'ohio': 'America/New_York', 'oh': 'America/New_York',
  'michigan': 'America/New_York', 'mi': 'America/New_York',
  'massachusetts': 'America/New_York', 'ma': 'America/New_York',
  'texas': 'America/Chicago', 'tx': 'America/Chicago',
  'illinois': 'America/Chicago', 'il': 'America/Chicago',
  'tennessee': 'America/Chicago', 'tn': 'America/Chicago',
  'alabama': 'America/Chicago', 'al': 'America/Chicago',
  'mississippi': 'America/Chicago', 'ms': 'America/Chicago',
  'louisiana': 'America/Chicago', 'la': 'America/Chicago',
  'arkansas': 'America/Chicago', 'ar': 'America/Chicago',
  'oklahoma': 'America/Chicago', 'ok': 'America/Chicago',
  'kansas': 'America/Chicago', 'ks': 'America/Chicago',
  'minnesota': 'America/Chicago', 'mn': 'America/Chicago',
  'wisconsin': 'America/Chicago', 'wi': 'America/Chicago',
  'iowa': 'America/Chicago', 'ia': 'America/Chicago',
  'missouri': 'America/Chicago', 'mo': 'America/Chicago',
  'nebraska': 'America/Chicago', 'ne': 'America/Chicago',
  'dakota del norte': 'America/Chicago', 'north dakota': 'America/Chicago', 'nd': 'America/Chicago',
  'dakota del sur': 'America/Chicago', 'south dakota': 'America/Chicago', 'sd': 'America/Chicago',
  'colorado': 'America/Denver', 'co': 'America/Denver',
  'utah': 'America/Denver', 'ut': 'America/Denver',
  'wyoming': 'America/Denver', 'wy': 'America/Denver',
  'montana': 'America/Denver', 'mt': 'America/Denver',
  'idaho': 'America/Denver', 'id': 'America/Denver',
  'nuevo mexico': 'America/Denver', 'new mexico': 'America/Denver', 'nm': 'America/Denver',
  'california': 'America/Los_Angeles', 'ca': 'America/Los_Angeles',
  'oregon': 'America/Los_Angeles', 'or': 'America/Los_Angeles',
  'washington': 'America/Los_Angeles', 'wa': 'America/Los_Angeles',
  'nevada': 'America/Los_Angeles', 'nv': 'America/Los_Angeles',
  'arizona': 'America/Phoenix', 'az': 'America/Phoenix',
};

function getCandidateTZ(location) {
  if (!location) return null;
  const loc = location.toLowerCase().trim();
  if (loc.includes('el paso')) return 'America/Denver';
  for (const [key, tz] of Object.entries(STATE_TZ_MAP)) {
    if (loc.includes(key)) return tz;
  }
  return null;
}

// ── Book interview ────────────────────────────────────────────────────────────
async function bookInterview({ leadPhone, leadName, slotIso, convKey }) {
  const id  = 'int_' + Date.now();
  const cfg = await loadInterviewConfig();
  const doc = {
    id, leadPhone, leadName, slotIso, convKey,
    interviewer: cfg.interviewer.name,
    zoomLink:    cfg.zoomLink,
    status:      'scheduled',
    createdAt:   new Date().toISOString(),
    reminders:   {},
  };
  await db.sbSaveInterview(id, interviewToRow(doc));

  // Sync to GHL calendar
  try {
    const { fsGetLeadByPhone: _ghlLead } = require('./pipeline');
    const _lead2 = await _ghlLead(leadPhone).catch(() => null);
    const _email = _lead2?.correo || null;
    const _tz    = getCandidateTZ(_lead2?.ubicacion) || TEAM_TZ;
    const ghlContactId = await ghlFindOrCreateContact(leadPhone, leadName, _email);
    const ghlAppointmentId = await ghlBookAppointment({ contactId: ghlContactId, slotIso, leadName, selectedTimezone: TEAM_TZ });
    if (ghlAppointmentId) {
      doc.ghlAppointmentId = ghlAppointmentId;
      await db.sbSaveInterview(id, interviewToRow(doc));
    }
  } catch (e) {
    console.error('[GHL] bookInterview sync error:', e.message);
  }

  // Move lead to entrevistas-generales pipeline
  const { fsGetLeadByPhone, fsUpdateLeadFields } = require('./pipeline');
  const _lead = await fsGetLeadByPhone(leadPhone).catch(() => null);
  if (_lead) {
    const _now  = new Date().toISOString();
    const _hist = Array.isArray(_lead.historial) ? [..._lead.historial] : [];
    _hist.push({ icono: '🤝', accion: 'Entrevista agendada — movido a Entrevistas Generales', fecha: _now, usuario: 'Ana (IA)' });
    await fsUpdateLeadFields(_lead.id, {
      pipeline_id:        'entrevistas-generales',
      etapa:              'EN ENTREVISTA',
      interview_slot:     slotIso,
      inscrito_webinar:   false,
      historial:          _hist,
    }).catch(() => {});
  }

  const slot = new Date(slotIso);
  const { fecha, hora } = _fmtSlot(slot);
  const _cleanName = (!leadName || leadName.startsWith('WA ') || leadName.startsWith('+')) ? '' : leadName;
  const firstName  = _cleanName.split(' ')[0] || 'Candidato';
  const phoneClean = (leadPhone || '').replace(/^\+/, '');

  return { id, cfg, doc };
}

function _fmtSlot(d) {
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: TEAM_TZ,
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', hour12: true,
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value || '';
  const weekday = get('weekday'); const day = get('day'); const month = get('month');
  const h   = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TZ, hour: 'numeric', hour12: false }).format(d));
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    fecha: `${cap(weekday)} ${day} de ${month}`,
    hora:  `${h12}:00 ${ampm} ET`,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function listInterviews() {
  try {
    const rows = await db.sbGetInterviews();
    return rows.map(rowToInterview);
  } catch { return []; }
}

async function getInterview(id) {
  try {
    const rows = await db.sbGetInterviews();
    const r    = rows.find(x => x.id === id);
    return r ? rowToInterview(r) : null;
  } catch { return null; }
}

async function updateInterview(id, updates) {
  const existing = await getInterview(id);
  if (!existing) return false;
  const merged = { ...existing, ...updates };
  try {
    await db.sbSaveInterview(id, interviewToRow(merged));
    return true;
  } catch { return false; }
}

// ── Reminder checker (called every minute by server) ─────────────────────────
async function checkInterviewReminders(sendWA, sendInternal, sendManager) {
  const cfg        = await loadInterviewConfig();
  const interviews = await listInterviews();
  const now        = new Date();

  for (const iv of interviews) {
    if (iv.status === 'cancelled' || iv.status === 'done') continue;
    const slotTime  = new Date(iv.slotIso);
    const reminders = iv.reminders || {};

    for (const rem of cfg.reminders || []) {
      if (rem.disabled) continue;
      if (rem.id === 'r2') continue; // removed per user request
      if (reminders[rem.id]) continue;

      let shouldSend = false;
      if (rem.trigger === 'morning_of') {
        const sameDay   = toDateStr(slotTime) === toDateStr(now);
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
        if (!await _autoEnabled('interview_noshow_alert')) { reminders[rem.id] = new Date().toISOString(); await updateInterview(iv.id, { reminders }); continue; }
        if (rem.notifyInterviewer && cfg.interviewer?.phone && sendInternal) {
          const ivPhone    = cfg.interviewer.phone.replace(/^\+/, '');
          const ivFallback = `⚠️ No-show: *${iv.leadName || 'candidato'}* no confirmó asistencia para la entrevista de las ${hora}.\n📞 ${iv.leadPhone || ''}\n🔗 ${iv.zoomLink}`;
          await sendInternal(ivPhone, ivFallback).catch(() => {});
        }
        if (rem.notifyManager && sendManager) {
          await sendManager(fillTemplate(rem.message, iv, slotTime)).catch(() => {});
        }
      } else {
        // Candidate-facing messages disabled — manual communication only
      }

      reminders[rem.id] = new Date().toISOString();
      await updateInterview(iv.id, { reminders });
    }

    if (!reminders['zoom_sent']) {
      const diffMin = (now - slotTime) / (1000 * 60);
      if (diffMin >= 0 && diffMin < 5) {
        // Zoom link auto-send to candidate disabled — send manually
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
    .replace(/\{nombre\}/g,        iv.leadName    || 'Candidato')
    .replace(/\{hora\}/g,          hora)
    .replace(/\{fecha\}/g,         fecha)
    .replace(/\{entrevistador\}/g, iv.interviewer || '')
    .replace(/\{zoom\}/g,          iv.zoomLink    || '');
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
  getCandidateTZ,
  formatSlotLabel,
  TEAM_TZ,
};
