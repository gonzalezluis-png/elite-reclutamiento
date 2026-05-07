// ── Escalation chain system ───────────────────────────────────────────────────
const { sendTemplateOrFallback, TEMPLATES } = require('./templates');
const db = require('./db');

const DEFAULT_MANAGERS = [
  { level: 1, phone: '+584125378673', name: 'Saudimar'    },
  { level: 2, phone: '+584143605411', name: 'Duglimar'    },
  { level: 3, phone: '+17863060642',  name: 'Luis (Admin)' },
];

const REASON_LABELS = {
  'link-no-llega':    '🔗 Link no llegó después de varios intentos',
  'pide-llamada':     '📞 Candidato solicita llamada telefónica',
  'groseria':         '🚨 Lenguaje ofensivo / agresivo',
  'fuera-de-alcance': '❓ Pregunta fuera del alcance de Ana',
  'tiene-licencia':   '📋 Candidato ya tiene licencia de seguros',
  'sin-documentos':   '⚠️ Sin documentos legales para trabajar en EE.UU.',
  'quiere-entrevista':'🤝 Candidato listo para entrevista — requiere agendamiento',
};

const TIMEOUTS = {
  1: { 1:  5*60*1000, 2: 20*60*1000, 3:  60*60*1000 },
  2: { 1: 10*60*1000, 2: 30*60*1000, 3:  90*60*1000 },
  3: { 1: 15*60*1000, 2: 40*60*1000, 3: 120*60*1000 },
};
const MAX_ROUNDS = 3;

// ── Team messages ─────────────────────────────────────────────────────────────
async function logTeamMessage(phone, name, direction, text) {
  try {
    await db.sbLogTeamMessage({ phone, name, direction, text, ts: new Date().toISOString() });
  } catch (e) { console.error('[TeamLog]', e.message); }
}

async function getTeamMessages() {
  try {
    const rows = await db.sbGetTeamMessages(500);
    return rows.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  } catch { return []; }
}

// ── Manager config ────────────────────────────────────────────────────────────
let _managersCache = null;

async function loadManagers() {
  try {
    const cfg = await db.sbGetConfig('escalation_config');
    if (cfg?.managers?.length === 3) { _managersCache = cfg.managers; return cfg.managers; }
  } catch {}
  _managersCache = DEFAULT_MANAGERS;
  return DEFAULT_MANAGERS;
}

async function saveManagers(managers) {
  _managersCache = managers;
  await db.sbSetConfig('escalation_config', { managers });
}

async function getManagers() {
  if (_managersCache) return _managersCache;
  return loadManagers();
}

function normalizePhone(p) { return String(p || '').replace(/[^0-9]/g, ''); }

async function isManagerPhone(phone) {
  const clean    = normalizePhone(phone);
  const managers = await getManagers();
  return managers.some(m => normalizePhone(m.phone) === clean);
}

// ── Escalation CRUD (Supabase) ────────────────────────────────────────────────
function escId() {
  return 'esc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

async function createEscalation(data) {
  const id = escId();
  await db.sbSaveEscalation(id, { lead_phone: data.leadPhone, lead_id: data.leadId || '', data });
  return id;
}

async function getPendingEscalations() {
  try {
    const rows = await db.sbGetEscalations();
    return rows
      .map(r => ({ _id: r.id, ...r.data }))
      .filter(e => e.status === 'pending');
  } catch { return []; }
}

async function updateEscalation(id, updates) {
  try {
    const rows = await db.sbGetEscalations();
    const row  = rows.find(r => r.id === id);
    if (!row) return;
    const newData = { ...row.data, ...updates };
    await db.sbSaveEscalation(id, { lead_phone: newData.leadPhone, lead_id: newData.leadId || '', data: newData });
  } catch (e) { console.error('[ESC] updateEscalation:', e.message); }
}

// ── Cancel escalation ─────────────────────────────────────────────────────────
async function cancelEscalation(leadPhone, leadName, sendWAFn) {
  try {
    const pending  = await getPendingEscalations();
    const matching = pending.filter(e => normalizePhone(e.leadPhone) === normalizePhone(leadPhone));
    if (!matching.length) return;
    const managers = await getManagers();
    for (const esc of matching) {
      await updateEscalation(esc._id, { status: 'resolved', resolvedAt: new Date().toISOString() });
      const notifyLevels = [1, 2, 3].filter(l => esc[`level${l}SentAt`]);
      for (const level of notifyLevels) {
        const mgr = managers.find(m => m.level === level);
        if (!mgr) continue;
        const fallback = `✅ Caso resuelto — El candidato ${leadName || leadPhone} confirmó que el problema se resolvió solo. No necesitas hacer nada.`;
        await sendTemplateOrFallback(mgr.phone, 'caso_resuelto', [leadName || leadPhone], fallback, sendWAFn).catch(() => {});
        logTeamMessage(mgr.phone, mgr.name, 'out', fallback).catch(() => {});
      }
      console.log(`[ESC] Escalación ${esc._id} resuelta para ${leadPhone}`);
    }
  } catch (e) { console.error('[ESC] cancelEscalation error:', e.message); }
}

// ── Pause Ana for a lead ──────────────────────────────────────────────────────
async function pauseLeadByPhone(phone) {
  try {
    const lead = await db.sbGetLeadByPhone ? db.sbGetLeadByPhone(phone) : null;
    // Import dynamically to avoid circular dep
    const { sbGetLeadByPhone, sbUpdateLead } = require('./db');
    const l = await sbGetLeadByPhone(phone);
    if (!l) return;
    await sbUpdateLead(l.id, { ia_paused: true });
    console.log(`[ESC] Ana pausada para lead ${l.id} (${phone})`);
  } catch (e) { console.error('[ESC] pauseLeadByPhone error:', e.message); }
}

// ── Mark lead sin_manager ─────────────────────────────────────────────────────
async function markLeadSinManager(phone) {
  try {
    const { sbGetLeadByPhone, sbUpdateLead } = require('./db');
    const lead = await sbGetLeadByPhone(phone);
    if (!lead) return;
    await sbUpdateLead(lead.id, { sin_manager: true });
    console.log(`[ESC] Lead ${lead.id} marcado sin_manager`);
  } catch (e) { console.error('[ESC] markLeadSinManager error:', e.message); }
}

// ── Build alert message ───────────────────────────────────────────────────────
function buildAlertMsg(esc, managerName, isLast) {
  const label = REASON_LABELS[esc.reason] || esc.reason;
  return [
    `⚠️ *ALERTA — Grupo Élite CRM*`, ``,
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
    const pending = await getPendingEscalations();
    const dup = pending.find(e => e.leadPhone === leadPhone && e.reason === reason);
    if (dup) { console.log(`[ESC] Duplicada ignorada: ${leadPhone} ${reason}`); return; }

    const now = new Date().toISOString();
    const id  = await createEscalation({
      leadPhone, leadName: leadName || '', reason,
      summary:      (lastUserMsg || '').slice(0, 300),
      status:       'pending',
      currentLevel: 1, round: 1,
      createdAt:    now, level1SentAt: now,
      level2SentAt: '', level3SentAt: '',
      acceptedBy: '', acceptedAt: '',
    });

    const managers = await getManagers();
    const m1    = managers.find(m => m.level === 1) || managers[0];
    const isLast = managers.length === 1;
    const msg   = buildAlertMsg({ leadPhone, leadName, reason, summary: lastUserMsg }, m1.name, isLast);
    const tplP  = [leadName || 'Desconocido', leadPhone, REASON_LABELS[reason] || reason, m1.name];
    await sendTemplateOrFallback(m1.phone, 'alerta_escalada', tplP, msg, sendWAFn);
    logTeamMessage(m1.phone, m1.name, 'out', msg).catch(() => {});
    console.log(`[ESC] Alerta ${id} enviada a ${m1.name} (${m1.phone})`);
  } catch (e) { console.error('[ESC] triggerEscalation error:', e.message); }
}

// ── Handle manager reply ──────────────────────────────────────────────────────
async function handleManagerReply(managerPhone, text, sendWAFn) {
  const clean    = normalizePhone(managerPhone);
  const managers = await getManagers();
  const manager  = managers.find(m => normalizePhone(m.phone) === clean);
  if (!manager) return false;

  const normalized = text.trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÜÑ\s]/g, '').trim();
  const accepted   = ['SI', 'SÍ', 'OK', 'ACEPTO', 'TOMO'].includes(normalized);
  const goNext     = ['SIGUIENTE', 'NEXT', 'PASAR', 'ENVIAR AL SIGUIENTE', 'ENVIAR SIGUIENTE'].includes(normalized);
  if (!accepted && !goNext) return false;

  const pending = await getPendingEscalations();
  const esc = pending.find(e => e[`level${manager.level}SentAt`]);
  if (!esc) {
    await sendWAFn(manager.phone, '✅ No tienes alertas pendientes asignadas en este momento.');
    return true;
  }

  const lateResponse = esc.currentLevel > manager.level;
  logTeamMessage(manager.phone, manager.name, 'in', text).catch(() => {});

  if (accepted) {
    await updateEscalation(esc._id, { status: 'accepted', acceptedBy: manager.phone, acceptedAt: new Date().toISOString() });
    await pauseLeadByPhone(esc.leadPhone);
    const lateNote   = lateResponse ? '\n\n_(Respuesta tardía — el caso ya había escalado, pero fue aceptado igualmente.)_' : '';
    const acceptMsg  = `✅ Caso tomado. Ana ha sido *pausada* para ${esc.leadName || esc.leadPhone}.\n\nResponde directamente al número: ${esc.leadPhone}${lateNote}`;
    await sendWAFn(manager.phone, acceptMsg);
    logTeamMessage(manager.phone, manager.name, 'out', acceptMsg).catch(() => {});
    if (lateResponse) {
      for (const m of managers) {
        if (normalizePhone(m.phone) === clean || !esc[`level${m.level}SentAt`]) continue;
        await sendWAFn(m.phone, `ℹ️ El caso de *${esc.leadName || esc.leadPhone}* fue tomado por ${manager.name}. No necesitas hacer nada.`).catch(() => {});
      }
    }
    console.log(`[ESC] Alerta ${esc._id} aceptada por ${manager.name}`);
    return true;
  }

  if (goNext) {
    const nextLevel   = manager.level + 1;
    const nextManager = managers.find(m => m.level === nextLevel);
    if (!nextManager) {
      await sendWAFn(manager.phone, '⚠️ Eres el último encargado. Por favor atiende el caso directamente.');
      return true;
    }
    const sentKey = `level${nextLevel}SentAt`;
    await updateEscalation(esc._id, { currentLevel: nextLevel, [sentKey]: new Date().toISOString() });
    const isLast = nextLevel === managers[managers.length - 1].level;
    const msg    = buildAlertMsg(esc, nextManager.name, isLast);
    const tplP   = [esc.leadName || 'Desconocido', esc.leadPhone, REASON_LABELS[esc.reason] || esc.reason, nextManager.name];
    await sendTemplateOrFallback(nextManager.phone, 'alerta_escalada', tplP, msg, sendWAFn);
    logTeamMessage(nextManager.phone, nextManager.name, 'out', msg).catch(() => {});
    const pasadoMsg = `➡️ Alerta pasada a ${nextManager.name}.`;
    await sendWAFn(manager.phone, pasadoMsg);
    logTeamMessage(manager.phone, manager.name, 'out', pasadoMsg).catch(() => {});
    console.log(`[ESC] Alerta ${esc._id} escalada → nivel ${nextLevel}`);
    return true;
  }
  return false;
}

// ── Timeout checker ───────────────────────────────────────────────────────────
async function checkTimeouts(sendWAFn) {
  try {
    const pending  = await getPendingEscalations();
    const managers = await getManagers();
    const now      = Date.now();

    for (const esc of pending) {
      const level         = esc.currentLevel || 1;
      const round         = esc.round || 1;
      const roundTimeouts = TIMEOUTS[level];
      if (!roundTimeouts) continue;
      const timeout = roundTimeouts[round];
      if (!timeout) continue;

      const sentKey = `level${level}SentAt`;
      const sentAt  = esc[sentKey] ? new Date(esc[sentKey]).getTime() : new Date(esc.createdAt).getTime();
      if (now - sentAt < timeout) continue;

      const nextLevel   = level + 1;
      const nextManager = managers.find(m => m.level === nextLevel);

      if (nextManager) {
        const sentNextKey = `level${nextLevel}SentAt`;
        await updateEscalation(esc._id, { currentLevel: nextLevel, [sentNextKey]: new Date().toISOString() });
        const isLast = nextLevel === managers[managers.length - 1].level;
        const msg  = buildAlertMsg(esc, nextManager.name, isLast);
        const tplP = [esc.leadName || 'Desconocido', esc.leadPhone, REASON_LABELS[esc.reason] || esc.reason, nextManager.name];
        await sendTemplateOrFallback(nextManager.phone, 'alerta_escalada', tplP, msg, sendWAFn);
        logTeamMessage(nextManager.phone, nextManager.name, 'out', msg).catch(() => {});
        console.log(`[ESC] Alerta ${esc._id} → nivel ${nextLevel} (ronda ${round})`);

      } else {
        const nextRound = round + 1;
        if (nextRound <= MAX_ROUNDS) {
          const m1 = managers.find(m => m.level === 1) || managers[0];
          await updateEscalation(esc._id, { currentLevel: 1, round: nextRound, level1SentAt: new Date().toISOString(), level2SentAt: '', level3SentAt: '' });
          const isLast = managers.length === 1;
          const msg  = buildAlertMsg(esc, m1.name, isLast);
          const tplP = [esc.leadName || 'Desconocido', esc.leadPhone, REASON_LABELS[esc.reason] || esc.reason, m1.name];
          await sendTemplateOrFallback(m1.phone, 'alerta_escalada', tplP, msg, sendWAFn);
          logTeamMessage(m1.phone, m1.name, 'out', msg).catch(() => {});
          console.log(`[ESC] Alerta ${esc._id} reinicia → ronda ${nextRound}`);
        } else {
          await updateEscalation(esc._id, { status: 'exhausted' });
          await markLeadSinManager(esc.leadPhone);
          await sendWAFn(esc.leadPhone, `Hola${esc.leadName ? ' ' + esc.leadName.split(' ')[0] : ''}, soy Ana de Grupo Élite. Aún no he podido contactar a uno de nuestros managers, pero en cuanto uno esté disponible te haremos saber. ¡Gracias por tu paciencia!`).catch(() => {});
          console.log(`[ESC] Alerta ${esc._id} agotada — 3 rondas sin respuesta`);
        }
      }
    }
  } catch (e) { console.error('[ESC] checkTimeouts error:', e.message); }
}

module.exports = {
  triggerEscalation, cancelEscalation, handleManagerReply, checkTimeouts,
  isManagerPhone, loadManagers, saveManagers, DEFAULT_MANAGERS,
  logTeamMessage, getTeamMessages,
};
