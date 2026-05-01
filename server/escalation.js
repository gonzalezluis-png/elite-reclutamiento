// ── Escalation chain system ───────────────────────────────────────────────────
// Detects trigger situations from Ana's responses and routes alerts through
// a 3-level manager chain via WhatsApp, with timeout-based auto-escalation.

const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

const DEFAULT_MANAGERS = [
  { level: 1, phone: '+584143605411', name: 'Encargado 1' },
  { level: 2, phone: '+14695285231',  name: 'Encargado 2' },
  { level: 3, phone: '+17863060642',  name: 'Luis (Admin)'  },
];

const REASON_LABELS = {
  'link-no-llega':   '🔗 Link no llegó después de varios intentos',
  'pide-llamada':    '📞 Candidato solicita llamada telefónica',
  'groseria':        '🚨 Lenguaje ofensivo / agresivo',
  'fuera-de-alcance':'❓ Pregunta fuera del alcance de Ana',
  'tiene-licencia':  '📋 Candidato ya tiene licencia de seguros',
  'sin-documentos':  '⚠️ Sin documentos legales para trabajar en EE.UU.',
};

// Timeouts por nivel (ms)
const TIMEOUTS = { 1: 5 * 60 * 1000, 2: 10 * 60 * 1000 };

// ── Firestore helpers ─────────────────────────────────────────────────────────
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } };
  return { stringValue: String(v) };
}

function fsRead(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if      (v.stringValue  !== undefined) out[k] = v.stringValue;
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.doubleValue  !== undefined) out[k] = v.doubleValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.nullValue    !== undefined) out[k] = null;
    else if (v.arrayValue)  out[k] = (v.arrayValue.values || []).map(i => fsRead(i.mapValue?.fields || {}));
    else if (v.mapValue)    out[k] = fsRead(v.mapValue.fields || {});
  }
  return out;
}

async function fsPatch(path, data) {
  const mask = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  await fetch(`${FS_BASE}/${path}?key=${FS_KEY}&${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsVal(v)])) }),
  });
}

async function fsCreate(path, data) {
  await fetch(`${FS_BASE}/${path}?key=${FS_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsVal(v)])) }),
  });
}

// ── Manager config ────────────────────────────────────────────────────────────
let _managersCache = null;

async function loadManagers() {
  try {
    const res  = await fetch(`${FS_BASE}/config/escalation_config?key=${FS_KEY}`);
    const data = await res.json();
    if (data.fields?.managers?.arrayValue?.values) {
      const list = data.fields.managers.arrayValue.values.map(v => fsRead(v.mapValue?.fields || {}));
      if (list.length === 3) { _managersCache = list; return list; }
    }
  } catch {}
  _managersCache = DEFAULT_MANAGERS;
  return DEFAULT_MANAGERS;
}

async function saveManagers(managers) {
  _managersCache = managers;
  await fetch(`${FS_BASE}/config/escalation_config?key=${FS_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        managers: {
          arrayValue: {
            values: managers.map(m => ({ mapValue: { fields: {
              level: fsVal(m.level),
              phone: fsVal(m.phone),
              name:  fsVal(m.name),
            }}})),
          },
        },
      },
    }),
  });
}

async function getManagers() {
  if (_managersCache) return _managersCache;
  return loadManagers();
}

function normalizePhone(p) {
  return String(p || '').replace(/[^0-9]/g, '');
}

async function isManagerPhone(phone) {
  const clean = normalizePhone(phone);
  const managers = await getManagers();
  return managers.some(m => normalizePhone(m.phone) === clean);
}

// ── Escalation Firestore CRUD ─────────────────────────────────────────────────
function escId() {
  return 'esc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

async function createEscalation(data) {
  const id = escId();
  await fsCreate(`escalations/${id}`, data);
  return id;
}

async function getPendingEscalations() {
  try {
    const res  = await fetch(`${FS_BASE}/escalations?key=${FS_KEY}&pageSize=100`);
    const data = await res.json();
    return (data.documents || [])
      .map(doc => ({ _id: doc.name.split('/').pop(), ...fsRead(doc.fields) }))
      .filter(e => e.status === 'pending');
  } catch { return []; }
}

async function updateEscalation(id, updates) {
  await fsPatch(`escalations/${id}`, updates);
}

// ── Pause Ana for a lead ──────────────────────────────────────────────────────
async function pauseLeadByPhone(phone) {
  try {
    const clean = normalizePhone(phone);
    const res   = await fetch(`${FS_BASE}/leads?key=${FS_KEY}&pageSize=500`);
    const data  = await res.json();
    const doc   = (data.documents || []).find(d => {
      const f = d.fields;
      const t = f?.telefono?.stringValue || '';
      return normalizePhone(t) === clean || t.includes(clean);
    });
    if (!doc) return;
    const leadId = doc.name.split('/').pop();
    await fsPatch(`leads/${leadId}`, { ia_paused: true });
    console.log(`[ESC] Ana pausada para lead ${leadId} (${phone})`);
  } catch (e) {
    console.error('[ESC] pauseLeadByPhone error:', e.message);
  }
}

// ── Build alert message ───────────────────────────────────────────────────────
function buildAlertMsg(esc, managerName, isLast) {
  const label = REASON_LABELS[esc.reason] || esc.reason;
  return [
    `⚠️ *ALERTA — Grupo Élite CRM*`,
    ``,
    `*Lead:* ${esc.leadName || 'Desconocido'}`,
    `*Teléfono:* ${esc.leadPhone}`,
    `*Motivo:* ${label}`,
    esc.summary ? `\n*Último mensaje:*\n_"${esc.summary}"_` : '',
    ``,
    `*${managerName}*, responde:`,
    `✅ *SI* o *OK* — tomar el caso (Ana se pausa)`,
    isLast ? `` : `➡️ *SIGUIENTE* — pasar al siguiente encargado`,
  ].filter(l => l !== undefined).join('\n');
}

// ── Trigger escalation ────────────────────────────────────────────────────────
async function triggerEscalation(leadPhone, leadName, reason, lastUserMsg, sendWAFn) {
  try {
    // Evita duplicados: mismo lead + motivo en últimos 30 min
    const pending = await getPendingEscalations();
    const dup = pending.find(e => e.leadPhone === leadPhone && e.reason === reason);
    if (dup) { console.log(`[ESC] Escalación duplicada ignorada: ${leadPhone} ${reason}`); return; }

    const now = new Date().toISOString();
    const id  = await createEscalation({
      leadPhone,
      leadName:    leadName || '',
      reason,
      summary:     (lastUserMsg || '').slice(0, 300),
      status:      'pending',
      currentLevel: 1,
      createdAt:   now,
      level1SentAt: now,
      level2SentAt: '',
      level3SentAt: '',
      acceptedBy:  '',
      acceptedAt:  '',
    });

    const managers = await getManagers();
    const m1 = managers.find(m => m.level === 1) || managers[0];
    const isLast = managers.length === 1;
    const msg = buildAlertMsg({ leadPhone, leadName, reason, summary: lastUserMsg }, m1.name, isLast);
    await sendWAFn(m1.phone, msg);
    console.log(`[ESC] Alerta ${id} enviada a ${m1.name} (${m1.phone})`);
  } catch (e) {
    console.error('[ESC] triggerEscalation error:', e.message);
  }
}

// ── Handle manager reply ──────────────────────────────────────────────────────
async function handleManagerReply(managerPhone, text, sendWAFn) {
  const clean = normalizePhone(managerPhone);
  const managers = await getManagers();
  const manager  = managers.find(m => normalizePhone(m.phone) === clean);
  if (!manager) return false;

  const normalized = text.trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÜÑ\s]/g, '').trim();
  const accepted   = ['SI', 'SÍ', 'OK', 'ACEPTO', 'TOMO'].includes(normalized);
  const goNext     = ['SIGUIENTE', 'NEXT', 'PASAR', 'ENVIAR AL SIGUIENTE', 'ENVIAR SIGUIENTE'].includes(normalized);
  if (!accepted && !goNext) return false;

  const pending = await getPendingEscalations();
  // Match any pending escalation that was sent to this manager (even if already escalated further)
  const esc = pending.find(e => e[`level${manager.level}SentAt`]);
  if (!esc) {
    await sendWAFn(manager.phone, '✅ No tienes alertas pendientes asignadas en este momento.');
    return true;
  }

  const lateResponse = esc.currentLevel > manager.level;

  if (accepted) {
    await updateEscalation(esc._id, {
      status:     'accepted',
      acceptedBy:  manager.phone,
      acceptedAt:  new Date().toISOString(),
    });
    await pauseLeadByPhone(esc.leadPhone);
    const lateNote = lateResponse
      ? '\n\n_(Respuesta tardía — el caso ya había escalado, pero fue aceptado igualmente.)_'
      : '';
    await sendWAFn(manager.phone,
      `✅ Caso tomado. Ana ha sido *pausada* para ${esc.leadName || esc.leadPhone}.\n\nResponde directamente al número: ${esc.leadPhone}${lateNote}`
    );
    // Notify managers who were already alerted that someone else took it
    if (lateResponse) {
      for (const m of managers) {
        if (normalizePhone(m.phone) === clean) continue;
        if (!esc[`level${m.level}SentAt`]) continue;
        await sendWAFn(m.phone,
          `ℹ️ El caso de *${esc.leadName || esc.leadPhone}* fue tomado por ${manager.name}. No necesitas hacer nada.`
        ).catch(() => {});
      }
    }
    console.log(`[ESC] Alerta ${esc._id} aceptada por ${manager.name}${lateResponse ? ' (tardía)' : ''}`);
    return true;
  }

  if (goNext) {
    const nextLevel   = manager.level + 1;
    const nextManager = managers.find(m => m.level === nextLevel);
    if (!nextManager) {
      await sendWAFn(manager.phone, '⚠️ Eres el último encargado. Por favor atiende el caso directamente.');
      return true;
    }
    const sentKey  = `level${nextLevel}SentAt`;
    await updateEscalation(esc._id, { currentLevel: nextLevel, [sentKey]: new Date().toISOString() });
    const isLast = nextLevel === managers[managers.length - 1].level;
    const msg    = buildAlertMsg(esc, nextManager.name, isLast);
    await sendWAFn(nextManager.phone, msg);
    await sendWAFn(manager.phone, `➡️ Alerta pasada a ${nextManager.name}.`);
    console.log(`[ESC] Alerta ${esc._id} escalada de nivel ${manager.level} → ${nextLevel}`);
    return true;
  }

  return false;
}

// ── Timeout checker (call every 60s) ─────────────────────────────────────────
async function checkTimeouts(sendWAFn) {
  try {
    const pending  = await getPendingEscalations();
    const managers = await getManagers();
    const now      = Date.now();

    for (const esc of pending) {
      const level  = esc.currentLevel || 1;
      const timeout = TIMEOUTS[level];
      if (!timeout) continue;

      const sentKey = `level${level}SentAt`;
      const sentAt  = esc[sentKey] ? new Date(esc[sentKey]).getTime() : new Date(esc.createdAt).getTime();
      if (now - sentAt < timeout) continue;

      const nextLevel   = level + 1;
      const nextManager = managers.find(m => m.level === nextLevel);
      if (!nextManager) continue;

      const sentNextKey = `level${nextLevel}SentAt`;
      await updateEscalation(esc._id, { currentLevel: nextLevel, [sentNextKey]: new Date().toISOString() });
      const isLast = nextLevel === managers[managers.length - 1].level;
      const msg    = buildAlertMsg(esc, nextManager.name, isLast);
      await sendWAFn(nextManager.phone, msg);
      console.log(`[ESC] Timeout: alerta ${esc._id} escalada automáticamente → nivel ${nextLevel}`);
    }
  } catch (e) {
    console.error('[ESC] checkTimeouts error:', e.message);
  }
}

module.exports = {
  triggerEscalation,
  handleManagerReply,
  checkTimeouts,
  isManagerPhone,
  loadManagers,
  saveManagers,
  DEFAULT_MANAGERS,
};
