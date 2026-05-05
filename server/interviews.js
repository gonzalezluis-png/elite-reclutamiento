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
    const dateStr = toDateStr(date);
    for (let h = startH; h < endH; h++) {
      const slotTime = makeETDate(dateStr, h);
      if (slotTime < earliest) continue;
      const slotKey = dateStr + 'T' + String(h).padStart(2,'0') + ':00';
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
      const dateStr  = toDateStr(date);
      const slotTime = makeETDate(dateStr, h);
      return { date: dateStr, hour: h, iso: slotTime.toISOString(), label: formatSlotLabel(slotTime) };
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
        const etHour = parseInt(new Intl.DateTimeFormat('en-US', {
          timeZone: TEAM_TZ, hour: 'numeric', hour12: false,
        }).format(d));
        set.add(toDateStr(d) + 'T' + String(etHour).padStart(2,'0') + ':00');
      }
    }
    return set;
  } catch { return new Set(); }
}

const TEAM_TZ = 'America/New_York'; // equipo en Florida (Eastern Time)

// Convierte una hora en ET (hh:00) en un Date UTC correcto
function makeETDate(dateStr, hour) {
  // Crea un Date provisional en UTC y ajusta para que la hora local en ET sea la correcta
  const provisional = new Date(`${dateStr}T${String(hour).padStart(2,'0')}:00:00Z`);
  const etHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: TEAM_TZ, hour: 'numeric', hour12: false,
  }).format(provisional));
  const diff = hour - etHour;
  return new Date(provisional.getTime() - diff * 3_600_000);
}

// Fecha YYYY-MM-DD en ET
function toDateStr(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ }).format(d);
}

function formatSlotLabel(d, candidateTZ) {
  const fmtET = new Intl.DateTimeFormat('es-MX', {
    timeZone: TEAM_TZ,
    weekday: 'long', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  // Capitalizar primera letra
  const label = fmtET.charAt(0).toUpperCase() + fmtET.slice(1) + ' ET';
  if (candidateTZ && candidateTZ !== TEAM_TZ) {
    const localTime = new Intl.DateTimeFormat('es-MX', {
      timeZone: candidateTZ, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
    return `${label} (${localTime} tu hora)`;
  }
  return label;
}

// Mapeo estado → IANA timezone (principales estados de candidatos)
const STATE_TZ_MAP = {
  // Eastern
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
  // Central
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
  // Mountain
  'colorado': 'America/Denver', 'co': 'America/Denver',
  'utah': 'America/Denver', 'ut': 'America/Denver',
  'wyoming': 'America/Denver', 'wy': 'America/Denver',
  'montana': 'America/Denver', 'mt': 'America/Denver',
  'idaho': 'America/Denver', 'id': 'America/Denver',
  'nuevo mexico': 'America/Denver', 'new mexico': 'America/Denver', 'nm': 'America/Denver',
  // Pacific
  'california': 'America/Los_Angeles', 'ca': 'America/Los_Angeles',
  'oregon': 'America/Los_Angeles', 'or': 'America/Los_Angeles',
  'washington': 'America/Los_Angeles', 'wa': 'America/Los_Angeles',
  'nevada': 'America/Los_Angeles', 'nv': 'America/Los_Angeles',
  // Arizona (sin DST)
  'arizona': 'America/Phoenix', 'az': 'America/Phoenix',
};

function getCandidateTZ(location) {
  if (!location) return null;
  const loc = location.toLowerCase().trim();
  // El Paso es Mountain aunque Texas es Central
  if (loc.includes('el paso')) return 'America/Denver';
  for (const [key, tz] of Object.entries(STATE_TZ_MAP)) {
    if (loc.includes(key)) return tz;
  }
  return null;
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
  const _cleanName = (!leadName || leadName.startsWith('WA ') || leadName.startsWith('+')) ? '' : leadName;
  const firstName = _cleanName.split(' ')[0] || 'Candidato';
  const phoneClean = (leadPhone || '').replace(/^\+/, '');

  // Confirmation to candidate via Meta 214
  const confFallback = `¡Hola ${firstName}! 🎉\n\nTu entrevista con Grupo Élite Work ha sido confirmada.\n\n📅 Fecha: ${fecha}\n🕐 Hora: ${hora}\n🔗 Enlace Zoom: ${cfg.zoomLink}\n\n¡Te esperamos!`;
  const { sendWhatsApp: _metaConfirmWA } = require('./meta');
  sendTemplateOrFallback(phoneClean, 'confirmacion_entrevista', [firstName, fecha, hora, cfg.zoomLink], confFallback, _metaConfirmWA).catch(() => {});

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
  const hour = get('hour'); const dayperiod = get('dayPeriod')?.toUpperCase() || '';
  const h   = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TZ, hour: 'numeric', hour12: false }).format(d));
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    fecha: `${cap(weekday)} ${day} de ${month}`,
    hora:  `${h12}:00 ${ampm} ET`,
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
// sendWA      = Meta 214 — messages to candidates
// sendInternal = Twilio 817 — messages to managers/interviewers (internal)
async function checkInterviewReminders(sendWA, sendInternal, sendManager) {
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
        // Notify interviewer about no-show
        if (rem.notifyInterviewer && cfg.interviewer?.phone && sendInternal) {
          const ivPhone    = cfg.interviewer.phone.replace(/^\+/, '');
          const ivFallback = `⚠️ No-show: *${iv.leadName || 'candidato'}* no confirmó asistencia para la entrevista de las ${hora}.\n📞 ${iv.leadPhone || ''}\n🔗 ${iv.zoomLink}`;
          await sendInternal(ivPhone, ivFallback).catch(() => {});
        }
        // Notify manager about no-show
        if (rem.notifyManager && sendManager) {
          const mgrMsg = fillTemplate(rem.message, iv, slotTime);
          await sendManager(mgrMsg).catch(() => {});
        }
      } else {
        // Notify candidate via Meta 214
        const phone = (iv.leadPhone || '').replace(/^\+/, '');
        if (phone) {
          let tplKey    = 'recordatorio_dia_antes';
          let tplParams = [firstName, fecha, hora, iv.zoomLink || ''];

          if (rem.trigger === 'hours_before') {
            tplKey    = 'recordatorio_horas_antes';
            tplParams = [firstName, String(rem.value), iv.zoomLink || ''];
          }

          await sendTemplateOrFallback(phone, tplKey, tplParams, msg, sendWA).catch(() => {});
        }
      }

      // Mark reminder as sent
      reminders[rem.id] = new Date().toISOString();
      await updateInterview(iv.id, { reminders });
    }

    // Send Zoom link at exact slot time → candidate via Meta 214
    if (!reminders['zoom_sent']) {
      const diffMin = (now - slotTime) / (1000 * 60);
      if (diffMin >= 0 && diffMin < 5) {
        const phone = (iv.leadPhone || '').replace(/^\+/, '');
        if (phone) {
          const firstName    = (iv.leadName || 'Candidato').split(' ')[0];
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
  getCandidateTZ,
  formatSlotLabel,
  TEAM_TZ,
};
