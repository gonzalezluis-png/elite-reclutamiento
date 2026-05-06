const crypto = require('crypto');
const { handleAuthWAReply } = require('./auth-sessions');
const { askClaude, conversationHistory } = require('./ai');
const { fsLeadExists, fsCreateLeadWA, fsGetLeadByPhone, fsUpdateLeadFields, runWAPipeline, humanDelay, fsAppendLeadMetaWa, toE164 } = require('./pipeline');
const { triggerEscalation, cancelEscalation, handleManagerReply, checkTimeouts, isManagerPhone, logTeamMessage, loadManagers } = require('./escalation');
const { pixelLead } = require('./pixel');
const { loadInterviewConfig, getAvailableSlots, bookInterview, listInterviews, updateInterview, getCandidateTZ, formatSlotLabel, TEAM_TZ } = require('./interviews');
// ── WhatsApp business hours config ───────────────────────────────────────────
const WA_DEFAULT_HOURS = {
  timezone: 'America/Chicago',
  monday:    { enabled: true,  open: '09:00', close: '19:00' },
  tuesday:   { enabled: true,  open: '09:00', close: '19:00' },
  wednesday: { enabled: true,  open: '09:00', close: '19:00' },
  thursday:  { enabled: true,  open: '09:00', close: '19:00' },
  friday:    { enabled: true,  open: '09:00', close: '19:00' },
  saturday:  { enabled: true,  open: '09:00', close: '18:00' },
  sunday:    { enabled: false, open: '09:00', close: '18:00' },
};

async function loadWAHours() {
  try {
    const r = await fetch(`${FS_BASE}/config/wa_hours?key=${FS_KEY}`);
    if (!r.ok) return WA_DEFAULT_HOURS;
    const d = await r.json();
    return d.fields?.data?.stringValue ? JSON.parse(d.fields.data.stringValue) : WA_DEFAULT_HOURS;
  } catch { return WA_DEFAULT_HOURS; }
}

async function saveWAHours(cfg) {
  await fetch(`${FS_BASE}/config/wa_hours?key=${FS_KEY}&updateMask.fieldPaths=data`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify(cfg) } } }),
  });
}

async function isWABusinessHours() {
  try {
    const cfg  = await loadWAHours();
    const tz   = cfg.timezone || 'America/Chicago';
    const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const now  = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'long', hour12: false,
    }).formatToParts(now);
    const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase();
    const hour    = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute  = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const current = hour * 60 + minute;
    const dayKey  = DAYS.find(d => dayName?.startsWith(d.slice(0, 3)));
    const dayConf = dayKey ? cfg[dayKey] : null;
    if (!dayConf?.enabled) return false;
    const [oh, om] = (dayConf.open  || '09:00').split(':').map(Number);
    const [ch, cm] = (dayConf.close || '19:00').split(':').map(Number);
    return current >= oh * 60 + om && current < ch * 60 + cm;
  } catch { return true; }
}

const SERVER_URL   = process.env.SERVER_URL  || 'https://elite-reclutamiento-production.up.railway.app';
const WEBINAR_URL  = process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// ── Env vars (set in Railway) ─────────────────────────────────────────────────
const META_VERIFY_TOKEN      = process.env.META_VERIFY_TOKEN      || 'grupoelite2026';

// App 1 — GrupoElite Bot (Instagram + Messenger)
const META_APP_SECRET_IG     = process.env.META_APP_SECRET_IG     || '6f59669c43e93f238457c5b8e5680bd0';
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || ''; // Messenger page token
const META_IG_ACCESS_TOKEN   = process.env.META_IG_ACCESS_TOKEN   || ''; // Instagram token

// App 2 — WhatsApp
const META_APP_SECRET_WA = process.env.META_APP_SECRET_WA || '80dc2555ece1fd87afb133222ff2b5eb';
const META_APP_ID        = process.env.META_APP_ID        || '1447919720444811';
const META_WA_PHONE_ID   = process.env.META_WA_PHONE_ID   || '';

const GRAPH_URL  = 'https://graph.facebook.com/v21.0';
const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

// ── Token management — auto-refresh before expiry ────────────────────────────
let _waToken = process.env.META_WA_TOKEN || '';

async function _loadTokenFromFS() {
  try {
    const res  = await fetch(`${FS_BASE}/config/wa_token?key=${FS_KEY}`);
    const doc  = await res.json();
    if (!doc.fields) return;
    const token   = doc.fields.token?.stringValue;
    const expires = doc.fields.expires_at?.integerValue || doc.fields.expires_at?.doubleValue;
    if (token && expires && Date.now() < Number(expires) * 1000) {
      _waToken = token;
      console.log('[Meta WA] Token cargado desde Firestore — expira:', new Date(Number(expires) * 1000).toLocaleDateString());
    }
  } catch (e) { console.warn('[Meta WA] No se pudo cargar token desde FS:', e.message); }
}

async function _saveTokenToFS(token, expiresIn) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  await fetch(`${FS_BASE}/config/wa_token?key=${FS_KEY}&updateMask.fieldPaths=token&updateMask.fieldPaths=expires_at`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields: { token: { stringValue: token }, expires_at: { integerValue: String(expiresAt) } } }),
  });
}

async function _refreshToken() {
  if (!META_APP_ID || !META_APP_SECRET_WA || !_waToken) return;
  try {
    const res  = await fetch(`${GRAPH_URL.replace('v21.0','v21.0')}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET_WA}&fb_exchange_token=${_waToken}`);
    const data = await res.json();
    if (data.access_token) {
      _waToken = data.access_token;
      await _saveTokenToFS(data.access_token, data.expires_in || 5184000);
      console.log('[Meta WA] Token renovado automáticamente ✓');
    } else {
      console.error('[Meta WA] Error renovando token:', JSON.stringify(data));
    }
  } catch (e) { console.error('[Meta WA] Error en refresh token:', e.message); }
}

async function _checkTokenExpiry() {
  try {
    const res  = await fetch(`${FS_BASE}/config/wa_token?key=${FS_KEY}`);
    const doc  = await res.json();
    const expires = Number(doc.fields?.expires_at?.integerValue || 0);
    const sevenDays = 7 * 24 * 60 * 60;
    if (expires && (expires - Math.floor(Date.now() / 1000)) < sevenDays) {
      console.log('[Meta WA] Token expira pronto — renovando…');
      await _refreshToken();
    }
  } catch (e) { console.warn('[Meta WA] Error verificando expiración:', e.message); }
}

// Load token on startup and check expiry every 24 hours
_loadTokenFromFS().then(() => _checkTokenExpiry());
setInterval(_checkTokenExpiry, 24 * 60 * 60 * 1000);

// ── Signature verification ────────────────────────────────────────────────────
function verifySignature(req, appSecret) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !appSecret) return true; // skip in dev if secret not set
  const payload = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

// In-memory index: wamid → {phone, logId} for status updates (lost on restart, acceptable since statuses arrive within minutes)
const _wamidIndex = new Map();

// ── Meta WA message log (Firestore) ──────────────────────────────────────────
// Each message stored as a separate document to avoid read-write race conditions
async function fsLogWAMessage(phone, direction, text, extra = {}) {
  try {
    const clean = phone.replace(/^wa_meta:/, '').replace(/^\+/, '');
    const ts    = Date.now();
    const msgId = `${ts}_${Math.random().toString(36).slice(2, 7)}`;
    const sid   = `meta_${ts}`;
    const docUrl = `${FS_BASE}/wa_messages/${clean}/msgs/${msgId}?key=${FS_KEY}`;
    const fields = {
      direction: { stringValue: direction },
      text:      { stringValue: text || '' },
      ts:        { integerValue: String(ts) },
    };
    if (extra.status) fields.status = { stringValue: extra.status };
    if (extra.msgId)  fields.wamid  = { stringValue: extra.msgId };
    await fetch(docUrl, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields }),
    });
    // Mirror message into the lead document so fsLoadLeads returns it pre-populated
    const metaMsg = {
      sid,
      body:      text || '',
      direction: direction === 'out' ? 'outbound' : 'inbound',
      dateSent:  new Date(ts).toISOString(),
      ch:        'wa',
    };
    if (extra.status) metaMsg.status = extra.status;
    fsAppendLeadMetaWa(clean, metaMsg).catch(() => {});
    return msgId;
  } catch { return null; }
}

// Outbound dedup: prevent sending the same text to the same number within 30 s
// ── Whisper transcription ─────────────────────────────────────────────────────
async function _transcribeAudio(mediaId) {
  if (!OPENAI_API_KEY || !_waToken) return null;
  try {
    // 1. Get download URL from Meta
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${_waToken}` },
    });
    const metaJson = await metaRes.json();
    if (!metaJson.url) return null;

    // 2. Download the audio file
    const audioRes = await fetch(metaJson.url, {
      headers: { Authorization: `Bearer ${_waToken}` },
    });
    if (!audioRes.ok) return null;
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // 3. Send to Whisper
    const { FormData, Blob } = await import('node:buffer').catch(() => require('buffer'));
    const form = new (require('form-data'))();
    form.append('file', audioBuffer, { filename: 'audio.ogg', contentType: metaJson.mime_type || 'audio/ogg' });
    form.append('model', 'whisper-1');
    form.append('language', 'es');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...form.getHeaders() },
      body: form,
    });
    const whisperJson = await whisperRes.json();
    return whisperJson.text || null;
  } catch(e) {
    console.error('[Whisper] Error transcribiendo audio:', e.message);
    return null;
  }
}

const _sentDedup = new Map(); // `${to}:${text}` → timestamp
function _isDupSend(to, text) {
  const key = `${to}:${text}`;
  const last = _sentDedup.get(key) || 0;
  if (Date.now() - last < 30_000) return true;
  _sentDedup.set(key, Date.now());
  setTimeout(() => _sentDedup.delete(key), 60_000);
  return false;
}

// ── Send WhatsApp message via Meta Cloud API ──────────────────────────────────
async function sendWhatsApp(to, text) {
  // Strip any prefix (wa_meta:, whatsapp:, +)
  const cleanTo = to.replace(/^wa_meta:/, '').replace(/^whatsapp:/, '').replace(/^\+/, '');
  if (!_waToken || !META_WA_PHONE_ID) {
    console.warn('[Meta WA] Token o Phone ID no configurados');
    return false;
  }
  if (_isDupSend(cleanTo, text)) {
    console.warn(`[Meta WA] Envío duplicado ignorado → ${cleanTo}`);
    return false;
  }
  const logId = await fsLogWAMessage(cleanTo, 'out', text);
  const parts = splitMessage(text);
  let allOk = true;
  for (const part of parts) {
    const r = await fetch(`${GRAPH_URL}/${META_WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_waToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'text',
        text: { body: part },
      }),
    });
    const json = await r.json();
    if (json.error) {
      allOk = false;
      console.error(`[Meta WA] Error enviando a ${cleanTo}:`, JSON.stringify(json.error));
      if (json.error.code === 190) {
        console.log('[Meta WA] Token expirado — renovando…');
        await _refreshToken();
      } else if (json.error.code === 131047) {
        console.warn(`[Meta WA] Ventana 24h cerrada para ${cleanTo} — se necesita plantilla para recontactar`);
      }
      if (logId) {
        const clean = cleanTo.replace(/^\+/, '');
        fetch(`${FS_BASE}/wa_messages/${clean}/msgs/${logId}?key=${FS_KEY}&updateMask.fieldPaths=status&updateMask.fieldPaths=error_code`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: {
            status:     { stringValue: 'failed' },
            error_code: { integerValue: String(json.error.code || 0) },
          }}),
        }).catch(() => {});
      }
    } else if (json.messages?.[0]?.id && logId) {
      // Save wamid → logId mapping for status updates (delivered/read)
      const wamid = json.messages[0].id;
      _wamidIndex.set(wamid, { phone: cleanTo, logId });
      fetch(`${FS_BASE}/wa_messages/${cleanTo}/msgs/${logId}?key=${FS_KEY}&updateMask.fieldPaths=wamid&updateMask.fieldPaths=status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { wamid: { stringValue: wamid }, status: { stringValue: 'sent' } } }),
      }).catch(() => {});
    }
  }
  return allOk;
}

// ── Send Instagram DM ─────────────────────────────────────────────────────────
async function sendInstagram(recipientId, text) {
  if (!META_IG_ACCESS_TOKEN) return;
  const parts = splitMessage(text);
  for (const part of parts) {
    await fetch(`${GRAPH_URL}/me/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_IG_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: part },
      }),
    });
  }
}

// ── Send Messenger message ────────────────────────────────────────────────────
async function sendMessenger(recipientId, text) {
  if (!META_PAGE_ACCESS_TOKEN) return;
  const parts = splitMessage(text);
  for (const part of parts) {
    await fetch(`${GRAPH_URL}/me/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_PAGE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: part },
      }),
    });
  }
}

// ── Split long messages ───────────────────────────────────────────────────────
function splitMessage(text, maxLen = 1000) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < 0) cut = maxLen;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

// ── Wrapper: send WA to manager (phone stored with +, Meta needs digits only) ─
function sendWAToManager(phone, text) {
  return sendWhatsApp(phone.replace(/^\+/, ''), text);
}

// ── Escalation timeout checker (every 60s) ────────────────────────────────────
setInterval(() => checkTimeouts(sendWAToManager).catch(e => console.error('[ESC-Timer]', e.message)), 60_000);

// ── Register routes ───────────────────────────────────────────────────────────
function registerMetaRoutes(app) {

  // ── Webhook verification (GET) — all three paths ─────────────────────────
  function verifyWebhook(req, res) {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      console.log('[Meta] Webhook verificado ✓', req.path);
      return res.status(200).send(challenge);
    }
    console.warn('[Meta] Verify token incorrecto:', token);
    res.sendStatus(403);
  }
  app.get('/meta/webhook',             verifyWebhook);
  app.get('/meta/webhook/whatsapp',    verifyWebhook);
  app.get('/meta/webhook/ig-messenger',verifyWebhook);

  // Dedup: track processed message IDs to ignore Meta retries
  const _processedMsgIds = new Set();
  // Debounce: buffer rapid messages per phone before responding
  const _msgBuffer   = new Map(); // phone → [text, ...]
  const _msgTimers   = new Map(); // phone → timeoutId
  const _DEBOUNCE_MS = 3000;      // wait 3 s after last message before replying

  async function _processBufferedMessages(from, referralInfo, profileName, inboxNumber) {
    const texts = _msgBuffer.get(from) || [];
    _msgBuffer.delete(from);
    _msgTimers.delete(from);
    if (!texts.length) return;

    const combinedText = texts.join('\n');
    console.log(`[Meta WA] ← ${from} (${texts.length} msg): ${combinedText}`);
    fsLogWAMessage(from, 'in', combinedText).catch(() => {});

    try {
      // ── Interviewer CONFIRMAR/REAGENDAR reply ────────────────────────────────
      const _ivCfg = await loadInterviewConfig().catch(() => null);
      if (_ivCfg?.interviewer?.phone) {
        const _ivPhone = _ivCfg.interviewer.phone.replace(/[^0-9]/g, '');
        if (from.replace(/[^0-9]/g, '') === _ivPhone) {
          const _msg = combinedText.trim().toUpperCase();
          if (_msg.includes('CONFIRMAR') || _msg.includes('REAGENDAR')) {
            const all = await listInterviews().catch(() => []);
            const pending = all.filter(iv => iv.status === 'scheduled').sort((a, b) => new Date(a.slotIso) - new Date(b.slotIso));
            if (pending.length) {
              const iv = pending[0];
              if (_msg.includes('CONFIRMAR')) {
                await updateInterview(iv.id, { status: 'confirmed' }).catch(() => {});
                await sendWhatsApp(from, `✅ Confirmado. Entrevista con *${iv.leadName || iv.leadPhone}* registrada.\n📅 ${iv.slotIso}\n🔗 ${iv.zoomLink}`);
                console.log(`[Interview] Entrevistador confirmó entrevista ${iv.id}`);
              } else {
                await updateInterview(iv.id, { status: 'rescheduled' }).catch(() => {});
                const candPhone = (iv.leadPhone || '').replace(/[^0-9]/g, '');
                const reschedMsg = `Hola, el entrevistador necesita reagendar tu cita. Pronto te contactaremos con nuevos horarios disponibles. 🙏`;
                await humanDelay(reschedMsg);
                await sendWhatsApp(candPhone, reschedMsg);
                await sendWhatsApp(from, `🔄 Entrevista con *${iv.leadName || iv.leadPhone}* marcada para reagendar. El candidato fue notificado.`);
                console.log(`[Interview] Entrevistador reagendó entrevista ${iv.id}`);
              }
            } else {
              await sendWhatsApp(from, `No encontré entrevistas pendientes en el sistema.`);
            }
            return;
          }
        }
      }

      // Check if message is from a manager responding to an escalation
      if (await isManagerPhone(from)) {
        const managers = await loadManagers().catch(() => []);
        const mgr = managers.find(m => m.phone.replace(/^\+/, '') === from.replace(/^\+/, ''));
        if (mgr) logTeamMessage(mgr.phone, mgr.name, 'in', combinedText).catch(() => {});
        const handled = await handleManagerReply(from, combinedText, sendWAToManager);
        if (handled) return;
      }

      // Auto-create lead if not in CRM
      const exists = await fsLeadExists(from);
      const _isFirstEverContact = !exists;
      if (!exists) {
        await fsCreateLeadWA(`wa_meta:${from}`);
        pixelLead({ telefono: from, correo: '' }).catch(() => {});
      }
      // Save WhatsApp profile name and inbox number to lead
      if (profileName || inboxNumber) {
        const _pLead = await fsGetLeadByPhone(from).catch(() => null);
        if (_pLead) {
          const _pId     = _pLead.name.split('/').pop();
          const _pNombre = _pLead.fields?.nombre?.stringValue || '';
          const updates  = {};
          if (profileName && (!_pNombre || _pNombre.startsWith('WA ') || _pNombre.startsWith('+'))) {
            updates.nombre = profileName;
          }
          if (inboxNumber) updates.wa_inbox_number = inboxNumber;
          if (Object.keys(updates).length) fsUpdateLeadFields(_pId, updates).catch(() => {});
        }
      }

      // Tag lead source from Meta ad
      if (referralInfo?.source_type === 'ad') {
        const adLead = await fsGetLeadByPhone(from);
        if (adLead) {
          const adLeadId = adLead.name.split('/').pop();
          await fsUpdateLeadFields(adLeadId, {
            fuente:    'Meta / Facebook',
            ad_nombre: referralInfo.headline  || '',
            ad_clid:   referralInfo.ctwa_clid || '',
          }).catch(() => {});
          console.log(`[Meta WA] Lead ${adLeadId} etiquetado como Meta Ads`);
        }
      }

      const leadData = await fsGetLeadByPhone(from);
      const convKey  = `wa_meta:${from}`;

      // Mark lead as having an unread message (candidate waiting for reply)
      const _leadId = leadData?.name?.split('/').pop();
      if (_leadId) {
        fsUpdateLeadFields(_leadId, { unread_msg: true, last_msg_ts: Date.now() }).catch(() => {});
      }

      // If IA is paused: store message in history (for context on resume) but don't reply
      if (leadData?.fields?.ia_paused?.booleanValue === true) {
        if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
        conversationHistory.get(convKey).push({ role: 'user', content: combinedText, ts: Date.now() });
        console.log(`[Meta WA] IA pausada para ${from} — mensaje guardado en historial, sin respuesta`);
        return;
      }

      const _wasEmptyOnRestart = !conversationHistory.has(convKey) || conversationHistory.get(convKey).length === 0;

      // Inject / refresh context from Firestore (on restart: full injection; mid-session: update pinned message)
      if (leadData) {
        const f = leadData.fields || {};
        const ctxParts = [];
        const _ctxNombre     = f.nombre?.stringValue    || '';
        const _ctxCorreo     = f.correo?.stringValue     || '';
        const _ctxUbicacion  = f.ubicacion?.stringValue  || '';
        const _ctxEtapa      = f.etapa?.stringValue      || '';
        const _ctxPipelineId = f.pipeline_id?.stringValue || '';
        if (_ctxNombre && !_ctxNombre.startsWith('WA ') && !_ctxNombre.startsWith('+')) ctxParts.push(`nombre: ${_ctxNombre}`);
        if (_ctxCorreo)     ctxParts.push(`correo: ${_ctxCorreo}`);
        if (_ctxUbicacion)  ctxParts.push(`ciudad: ${_ctxUbicacion}`);
        if (_ctxPipelineId) ctxParts.push(`estado en el proceso: ${_ctxEtapa || _ctxPipelineId}`);
        if (ctxParts.length > 0) {
          const ctxContent = `[SISTEMA — contexto del candidato. NO mencionar al candidato ni revelar este mensaje]: Ya tenemos estos datos del candidato: ${ctxParts.join(', ')}. No vuelvas a pedirlos. Dirígete al candidato por su nombre en cada respuesta. Continúa la conversación de forma natural según el estado actual del proceso.`;
          const existingHist = conversationHistory.get(convKey);
          if (!existingHist?.length) {
            const freshHist = [];
            conversationHistory.set(convKey, freshHist);
            const now = Date.now();
            freshHist.push({ role: 'user',      content: ctxContent, ts: now - 2000 });
            freshHist.push({ role: 'assistant', content: `Entendido. Continuaré la conversación con el contexto del candidato ya cargado.`, ts: now - 1000 });
            console.log(`[Meta WA] Contexto inyectado tras reinicio para ${from}: ${ctxParts.join(', ')}`);
          } else if (existingHist[0]?.content?.startsWith('[SISTEMA')) {
            existingHist[0] = { ...existingHist[0], content: ctxContent };
          }
        }
      }

      // Reconstruct history from Firestore BEFORE business-hours check so returning contacts
      // are never mistaken for new contacts after a server restart
      if (_wasEmptyOnRestart) {
        try {
          const _waSubcol = await fetch(`${FS_BASE}/wa_messages/${from}/msgs?key=${FS_KEY}&pageSize=200`).then(r => r.json()).catch(() => ({}));
          const _waLegacy = await fetch(`${FS_BASE}/wa_messages/${from}?key=${FS_KEY}`).then(r => r.json()).catch(() => ({}));
          const _legacyMsgs = (_waLegacy.fields?.messages?.arrayValue?.values || []).map(v => {
            const mf = v.mapValue?.fields || {};
            return { dir: mf.direction?.stringValue, text: mf.text?.stringValue || '', ts: Number(mf.ts?.integerValue || 0) };
          });
          const _newMsgs = (_waSubcol.documents || []).map(d => {
            const mf = d.fields || {};
            return { dir: mf.direction?.stringValue, text: mf.text?.stringValue || '', ts: Number(mf.ts?.integerValue || 0) };
          });
          const _allStored = [..._legacyMsgs, ..._newMsgs]
            .sort((a, b) => a.ts - b.ts)
            .filter(m => m.text && (m.dir === 'in' || m.dir === 'out'));

          const _prevStored = _allStored.slice(0, -1).slice(-24);

          const _merged = [];
          for (const m of _prevStored) {
            if (_merged.length && _merged[_merged.length - 1].dir === m.dir) {
              _merged[_merged.length - 1].text += '\n' + m.text;
            } else {
              _merged.push({ ...m });
            }
          }

          if (_merged.length) {
            if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
            const _hist = conversationHistory.get(convKey);
            for (const m of _merged) {
              const _role = m.dir === 'out' ? 'assistant' : 'user';
              if (_hist.length && _hist[_hist.length - 1].role === _role) {
                _hist[_hist.length - 1].content += '\n' + m.text;
              } else {
                _hist.push({ role: _role, content: m.text, ts: m.ts });
              }
            }
            console.log(`[Meta WA] Historial reconstruido desde Firestore para ${from}: ${_merged.length} msgs`);
          }
        } catch (_e) {
          console.warn(`[Meta WA] No se pudo reconstruir historial para ${from}:`, _e.message);
        }
      }

      // ── Horario de atención ───────────────────────────────────────────────────
      // Solo aplica al PRIMER contacto real (lead recién creado, sin historial previo)
      const _histNow    = conversationHistory.get(convKey) || [];
      const _isFirstMsg = _isFirstEverContact && _histNow.filter(m => m.role === 'user').length === 0;
      const _inHours    = await isWABusinessHours();
      if (_isFirstMsg && !_inHours) {
        if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
        conversationHistory.get(convKey).push({ role: 'user', content: combinedText, ts: Date.now() });
        const closedMsg = `¡Hola! 👋 Gracias por escribirnos. En este momento nuestras oficinas están cerradas, pero en cuanto abramos te respondemos. ¡Hasta pronto!`;
        console.log(`[Meta WA] Fuera de horario — primer mensaje de ${from}, enviando mensaje de cierre`);
        await humanDelay(closedMsg);
        await sendWhatsApp(from, closedMsg);
        return;
      }

      // ── Interview: slot selection state machine ──────────────────────────
      const _ivState = leadData?.fields?.interview_state?.stringValue;
      if (_ivState === 'awaiting_slot' && combinedText?.trim()) {
        let ivData = {};
        try {
          const _raw = JSON.parse(leadData.fields?.pending_slots?.stringValue || '{}');
          ivData = Array.isArray(_raw) ? { slots: _raw, offeringDay: 1 } : _raw;
        } catch {}
        const allSlots    = ivData.slots || [];
        const offeringDay = ivData.offeringDay || 1;
        const leadId      = leadData?.name?.split('/').pop();
        const nombre      = leadData?.fields?.nombre?.stringValue || '';
        const _validName  = !nombre || nombre.startsWith('WA ') || nombre.startsWith('+') ? '' : nombre;
        const firstName   = _validName.split(' ')[0] || '';
        const fmtH        = h => h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h-12}pm`;
        const DIAS_FULL   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

        const dayDates   = [...new Set(allSlots.map(s => new Date(s.iso).toISOString().slice(0,10)))];
        const currentDay = dayDates[offeringDay - 1];
        const daySlots   = allSlots.filter(s => new Date(s.iso).toISOString().slice(0,10) === currentDay);

        if (daySlots.length) {
          const times = daySlots.map(s => fmtH(new Date(s.iso).getHours()));

          let decision = '?';
          try {
            const Anthropic = require('@anthropic-ai/sdk');
            const hk  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const hkr = await hk.messages.create({
              model: 'claude-haiku-4-5-20251001', max_tokens: 8,
              system: `El candidato debe elegir o rechazar estos horarios de entrevista: ${times.map((t,i)=>`opción ${i+1} (${t})`).join(', ')}. Responde SOLO con el número elegido (${times.map((_,i)=>i+1).join('/')}) si eligió uno, "NO" si no puede en ninguno, o "?" si no está claro.`,
              messages: [{ role: 'user', content: combinedText }],
            });
            decision = hkr.content[0].text.trim().toUpperCase();
          } catch {}

          const choiceIdx = parseInt(decision) - 1;

          if (!isNaN(choiceIdx) && choiceIdx >= 0 && choiceIdx < daySlots.length) {
            // Candidate chose a slot → book it
            const chosen = daySlots[choiceIdx];
            console.log(`[Interview] ${from} eligió: ${chosen.iso}`);
            try {
              await bookInterview({ leadPhone: from, leadName: nombre, slotIso: chosen.iso, convKey });
              if (leadId) await fsUpdateLeadFields(leadId, { interview_state: 'booked', pending_slots: '', quiere_entrevista: false, webinar_accion: 'en-entrevista' });
              // Inject booking context so Ana knows the interview is scheduled
              const hist = conversationHistory.get(convKey) || [];
              const d = new Date(chosen.iso);
              const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
              const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
              const fechaStr = `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;
              const horaStr = (() => { const h = d.getHours(); return `${h%12||12}:00 ${h>=12?'PM':'AM'}`; })();
              hist.push({ role: 'assistant', content: `[SISTEMA] La entrevista quedó agendada para el ${fechaStr} a las ${horaStr}. Ya le envié la confirmación al candidato con el enlace Zoom. El proceso de agendamiento está completo.`, ts: Date.now() });
            } catch (e) { console.error('[Interview] Error booking:', e.message); }
            return;

          } else if (decision === 'NO') {
            if (offeringDay === 1 && dayDates.length > 1) {
              // Offer day 2
              const day2Slots = allSlots.filter(s => new Date(s.iso).toISOString().slice(0,10) === dayDates[1]);
              const d2   = new Date(day2Slots[0].iso);
              const t2   = day2Slots.map(s => fmtH(new Date(s.iso).getHours()));
              const tList2 = t2.length === 1 ? `a las ${t2[0]}` : t2.length === 2 ? `a las ${t2[0]} o a las ${t2[1]}` : `a las ${t2[0]}, a las ${t2[1]} o a las ${t2[2]}`;
              const msg2   = `Sin problema, ¡${firstName}! 😊 El ${DIAS_FULL[d2.getDay()]} también tengo disponible ${tList2}. ¿Alguna te funciona?`;
              await humanDelay(msg2);
              await sendWhatsApp(from, msg2);
              if (leadId) await fsUpdateLeadFields(leadId, { pending_slots: JSON.stringify({ slots: allSlots, offeringDay: 2 }) });
            } else {
              // Both days rejected → escalate
              const escMsg = `Entendido, ${firstName}. Voy a pedirle a un encargado que te contacte para encontrar un horario que te funcione. 🙏`;
              await humanDelay(escMsg);
              await sendWhatsApp(from, escMsg);
              if (leadId) await fsUpdateLeadFields(leadId, { interview_state: '', pending_slots: '', sin_manager: true });
              triggerEscalation(from, nombre, 'sin-horario', `Candidato no puede en ningún horario ofrecido (día 1 y día 2)`, sendWAToManager).catch(() => {});
            }
            return;
          }
          // '?' → fall through so Ana asks for clarification
        }
      }

      // First-ever contact: short delay before Ana responds (looks human, survives server restarts)
      if (_isFirstEverContact) {
        console.log(`[Meta WA] Primer contacto de ${from} — Ana esperará 30s antes de responder`);
        await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        // Re-check ia_paused in case team took over during the wait
        const _freshLead = await fsGetLeadByPhone(from).catch(() => null);
        if (_freshLead?.fields?.ia_paused?.booleanValue === true) {
          console.log(`[Meta WA] IA pausada durante la espera de ${from} — sin respuesta`);
          return;
        }
        // Re-read Firestore messages so Ana sees anything sent manually during the wait
        try {
          const _waitSubcol = await fetch(`${FS_BASE}/wa_messages/${from}/msgs?key=${FS_KEY}&pageSize=200`).then(r => r.json()).catch(() => ({}));
          const _waitMsgs = (_waitSubcol.documents || []).map(d => {
            const mf = d.fields || {};
            return { dir: mf.direction?.stringValue, text: mf.text?.stringValue || '', ts: Number(mf.ts?.integerValue || 0) };
          }).filter(m => m.text && (m.dir === 'in' || m.dir === 'out')).sort((a, b) => a.ts - b.ts);
          const _waitHist = conversationHistory.get(convKey) || [];
          const _lastKnownTs = _waitHist.length ? Math.max(..._waitHist.map(m => m.ts || 0)) : 0;
          for (const m of _waitMsgs) {
            if (m.ts > _lastKnownTs) {
              const _role = m.dir === 'out' ? 'assistant' : 'user';
              if (_waitHist.length && _waitHist[_waitHist.length - 1].role === _role) {
                _waitHist[_waitHist.length - 1].content += '\n' + m.text;
              } else {
                _waitHist.push({ role: _role, content: m.text, ts: m.ts });
              }
            }
          }
          conversationHistory.set(convKey, _waitHist);
        } catch (_we) {}
      }

      const rawReply = await askClaude(convKey, combinedText, 'wa');
      const escMatch = rawReply.match(/\[ESC:([^\]]+)\]/);
      const agendar  = rawReply.includes('[AGENDAR]');
      const reply    = rawReply.replace(/\[ESC:[^\]]*\]\n?/g, '').replace(/\[AGENDAR\]\n?/g, '').trim();

      if (escMatch) {
        const leadName = leadData?.fields?.nombre?.stringValue || '';
        if (escMatch[1] === 'resolved') {
          cancelEscalation(from, leadName, sendWAToManager).catch(e => console.error('[ESC-cancel]', e.message));
        } else {
          triggerEscalation(from, leadName, escMatch[1], combinedText, sendWAToManager).catch(e => console.error('[ESC]', e.message));
        }
      }

      console.log(`[Meta WA] → ${from}: ${reply}`);
      await humanDelay(reply);
      await sendWhatsApp(from, reply);

      // Clear unread flag now that Ana has responded
      if (_leadId) {
        fsUpdateLeadFields(_leadId, { unread_msg: false, last_msg_ts: Date.now() }).catch(() => {});
      }

      if (agendar) {
        (async () => {
          try {
            const cfg   = await loadInterviewConfig();
            const slots = await getAvailableSlots(cfg);
            const nombre = leadData?.fields?.nombre?.stringValue || '';
            const _realName = !nombre || nombre.startsWith('WA ') || nombre.startsWith('+') ? '' : nombre;
            const first  = _realName.split(' ')[0] || '';
            const ubicacion = leadData?.fields?.ubicacion?.stringValue || '';
            const candidateTZ = getCandidateTZ(ubicacion);

            if (!slots.length) {
              const noSlotMsg = `${first ? '¡'+first+'! ' : ''}En este momento no hay horarios disponibles. Un encargado se pondrá en contacto contigo muy pronto para agendar. 🙏`;
              await humanDelay(noSlotMsg);
              await sendWhatsApp(from, noSlotMsg);
              return;
            }

            // Agrupar slots por día (en ET)
            const dayDates = [...new Set(slots.map(s =>
              new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ }).format(new Date(s.iso))
            ))];
            const day1Slots = slots.filter(s =>
              new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ }).format(new Date(s.iso)) === dayDates[0]
            );
            const d1 = new Date(day1Slots[0].iso);
            const dayName = new Intl.DateTimeFormat('es-MX', { timeZone: TEAM_TZ, weekday: 'long' }).format(d1);

            // Formato de horas en ET (+ hora local del candidato si es distinta)
            const fmtSlotTime = (isoStr) => {
              const d = new Date(isoStr);
              const etH = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TZ, hour: 'numeric', hour12: false }).format(d));
              const h12 = etH % 12 || 12;
              const ampm = etH >= 12 ? 'PM' : 'AM';
              let label = `${h12}:00 ${ampm} ET`;
              if (candidateTZ && candidateTZ !== TEAM_TZ) {
                const locH = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: candidateTZ, hour: 'numeric', hour12: false }).format(d));
                const lh12 = locH % 12 || 12;
                const lampm = locH >= 12 ? 'PM' : 'AM';
                label += ` (${lh12}:00 ${lampm} tu hora)`;
              }
              return label;
            };

            const t1 = day1Slots.map(s => fmtSlotTime(s.iso));
            const tList = t1.length === 1 ? `a las ${t1[0]}` : t1.length === 2 ? `a las ${t1[0]} o a las ${t1[1]}` : `a las ${t1[0]}, ${t1[1]} o ${t1[2]}`;
            const slotsMsg = `${first ? '¡'+first+'! ' : ''}😊 Para tu entrevista, el ${dayName} tengo disponible ${tList}. ¿Alguna te funciona?`;

            await humanDelay(slotsMsg);
            await sendWhatsApp(from, slotsMsg);

            const doc = await fsGetLeadByPhone(from);
            if (doc) {
              const lid = doc.name.split('/').pop();
              await fsUpdateLeadFields(lid, {
                quiere_entrevista: true,
                interview_state:   'awaiting_slot',
                pending_slots:     JSON.stringify({ slots, offeringDay: 1 }),
              });
            }
            console.log(`[Interview] Slots ofrecidos a ${from} — día 1: ${DIAS_FULL[d1.getDay()]}, horarios: ${t1.join(', ')}`);
          } catch (e) { console.error('[AGENDAR Meta] Error:', e.message); }
        })();
      }

      ;(async () => {
        try {
          await runWAPipeline(convKey, conversationHistory, sendWhatsApp, { WEBINAR_URL });
        } catch (e) {
          console.error('[Meta WA Pipeline] Error:', e.message);
        }
      })();
    } catch (e) {
      console.error('[Meta WA] Error procesando mensajes de', from, ':', e.message);
    }
  }

  // ── Persistent webhook event log ────────────────────────────────────────────
  async function _fsLogWebhookEvent(type, phone, preview, raw) {
    try {
      const id  = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await fetch(`${FS_BASE}/webhook_log/${id}?key=${FS_KEY}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fields: {
          ts:      { stringValue: new Date().toISOString() },
          type:    { stringValue: type },
          phone:   { stringValue: phone || '' },
          preview: { stringValue: (preview || '').slice(0, 200) },
          raw:     { stringValue: (raw || '').slice(0, 800) },
        }}),
      });
    } catch {}
  }

  // ── WhatsApp webhook (POST) ───────────────────────────────────────────────
  const _webhookLog = [];
  app.post('/meta/webhook/whatsapp', async (req, res) => {
    res.sendStatus(200); // respond immediately to Meta

    const _sigOk = verifySignature(req, META_APP_SECRET_WA);
    const _rawBody = JSON.stringify(req.body);

    // Log every incoming event for in-memory diagnostic
    _webhookLog.unshift({ ts: new Date().toISOString(), sigOk: _sigOk, body: _rawBody.slice(0, 500) });
    if (_webhookLog.length > 20) _webhookLog.pop();

    // Parse event type and phone for persistent log
    const _entry  = req.body.entry?.[0];
    const _value  = _entry?.changes?.[0]?.value;
    const _msg    = _value?.messages?.[0];
    const _status = _value?.statuses?.[0];
    if (_msg) {
      _fsLogWebhookEvent('message', _msg.from, `[${_msg.type}] ${_msg.text?.body || ''}`, _rawBody).catch(() => {});
    } else if (_status) {
      _fsLogWebhookEvent('status', _status.recipient_id, `status:${_status.status} err:${_status.errors?.[0]?.code || ''}`, _rawBody).catch(() => {});
    } else if (_value) {
      _fsLogWebhookEvent('other', '', _rawBody.slice(0, 100), _rawBody).catch(() => {});
    }

    if (!_sigOk) {
      console.warn('[Meta WA] Firma inválida — evento rechazado (ver /meta/webhook/diagnostic)');
      return;
    }

    try {
      const entry   = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;

      // ── Status updates (delivered / read) ────────────────────────────────
      if (value?.statuses?.length) {
        for (const st of value.statuses) {
          const { id: wamid, status, recipient_id } = st;
          if (!wamid || (status !== 'delivered' && status !== 'read')) continue;
          const entry = _wamidIndex.get(wamid);
          if (entry) {
            const { phone, logId } = entry;
            fetch(`${FS_BASE}/wa_messages/${phone}/msgs/${logId}?key=${FS_KEY}&updateMask.fieldPaths=status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { status: { stringValue: status } } }),
            }).catch(() => {});
            console.log(`[Meta WA] Status ${status} → ${phone} (${wamid})`);
          }
        }
        if (!value.messages?.length) return;
      }

      if (!value?.messages?.length) return;

      const msg  = value.messages[0];
      const from = msg.from;

      // Extract text from multiple message types
      let text = null;
      switch (msg.type) {
        case 'text':
          text = msg.text?.body || null;
          break;
        case 'image':
          text = msg.image?.caption || '[El candidato envió una imagen]';
          break;
        case 'video':
          text = msg.video?.caption || '[El candidato envió un video]';
          break;
        case 'document':
          text = msg.document?.caption || `[El candidato envió un documento: ${msg.document?.filename || 'archivo'}]`;
          break;
        case 'audio':
        case 'voice': {
          const mediaId = msg.audio?.id || msg.voice?.id;
          if (mediaId) {
            const transcript = await _transcribeAudio(mediaId);
            text = transcript ? `🎤 ${transcript}` : '[El candidato envió un mensaje de voz]';
            if (transcript) console.log(`[Whisper] Transcripción de ${msg.from}: "${transcript}"`);
          } else {
            text = '[El candidato envió un mensaje de voz]';
          }
          break;
        }
        case 'interactive':
          // Button reply or list reply
          text = msg.interactive?.button_reply?.title
              || msg.interactive?.list_reply?.title
              || null;
          break;
        case 'button':
          text = msg.button?.text || null;
          break;
        case 'sticker':
        case 'reaction':
          // Silently ignore stickers and emoji reactions
          return;
        default:
          console.log(`[Meta WA] Tipo de mensaje no soportado: ${msg.type} de ${from}`);
          return;
      }
      if (!text) return;

      // Skip duplicate deliveries (Meta retries on timeout)
      if (msg.id && _processedMsgIds.has(msg.id)) {
        console.log(`[Meta WA] Mensaje duplicado ignorado: ${msg.id}`);
        return;
      }
      if (msg.id) {
        _processedMsgIds.add(msg.id);
        setTimeout(() => _processedMsgIds.delete(msg.id), 10 * 60 * 1000);
      }

      // Auth 2FA intercept (fast path — no debounce needed)
      if (await handleAuthWAReply(from, text)) return;

      // Capture WhatsApp profile name and inbox number
      const _profileName  = value?.contacts?.[0]?.profile?.name || null;
      const _inboxDisplay = value?.metadata?.display_phone_number || null;

      // Buffer message and (re)start debounce timer
      if (!_msgBuffer.has(from)) _msgBuffer.set(from, []);
      _msgBuffer.get(from).push(text);

      if (_msgTimers.has(from)) clearTimeout(_msgTimers.get(from));
      const referralInfo = msg.referral || null;
      _msgTimers.set(from, setTimeout(() => _processBufferedMessages(from, referralInfo, _profileName, _inboxDisplay), _DEBOUNCE_MS));

    } catch (e) {
      console.error('[Meta WA webhook] Error:', e.message);
    }
  });

  // ── Instagram + Messenger webhook (POST) ─────────────────────────────────
  app.post('/meta/webhook/ig-messenger', async (req, res) => {
    res.sendStatus(200);

    if (!verifySignature(req, META_APP_SECRET_IG)) {
      console.warn('[Meta IG/MS] Firma inválida');
      return;
    }

    try {
      const entry = req.body.entry?.[0];
      if (!entry) return;

      // ── Instagram DM ──────────────────────────────────────────────────────
      if (req.body.object === 'instagram') {
        const messaging = entry.messaging?.[0];
        if (!messaging) return;
        const senderId = messaging.sender?.id;
        const text     = messaging.message?.text;
        if (!text || !senderId) return;

        console.log(`[Meta IG] ← ${senderId}: ${text}`);
        const reply = await askClaude(`ig_meta:${senderId}`, text, 'text');
        console.log(`[Meta IG] → ${senderId}: ${reply}`);
        await sendInstagram(senderId, reply);
        return;
      }

      // ── Messenger ─────────────────────────────────────────────────────────
      if (req.body.object === 'page') {
        const messaging = entry.messaging?.[0];
        if (!messaging) return;
        const senderId = messaging.sender?.id;
        const text     = messaging.message?.text;
        if (!text || !senderId) return;
        if (messaging.message?.is_echo) return; // ignore own messages

        console.log(`[Meta MS] ← ${senderId}: ${text}`);
        const reply = await askClaude(`ms_meta:${senderId}`, text, 'text');
        console.log(`[Meta MS] → ${senderId}: ${reply}`);
        await sendMessenger(senderId, reply);
        return;
      }
    } catch (e) {
      console.error('[Meta IG/MS] Error:', e.message);
    }
  });

  // ── Meta WA inbox (messages stored in Firestore) ─────────────────────────
  app.get('/meta/wa-inbox', async (req, res) => {
    const phone = (req.query.phone || '').replace(/^\+/, '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ ok: false });
    try {
      // Read subcollection (new format — one doc per message, sorted by ID which is timestamp-based)
      const newData = await fetch(`${FS_BASE}/wa_messages/${phone}/msgs?key=${FS_KEY}&pageSize=200`).then(r => r.json()).catch(() => ({}));
      const newMsgs = (newData.documents || []).map(d => {
        const f = d.fields || {};
        return {
          ts:         Number(f.ts?.integerValue || 0),
          body:       f.text?.stringValue || '',
          dir:        f.direction?.stringValue,
          status:     f.status?.stringValue || '',
          error_code: Number(f.error_code?.integerValue || 0),
        };
      });

      // Also read legacy array format (old messages before the migration)
      const oldData = await fetch(`${FS_BASE}/wa_messages/${phone}?key=${FS_KEY}`).then(r => r.json()).catch(() => ({}));
      const oldMsgs = (oldData.fields?.messages?.arrayValue?.values || []).map(v => {
        const f = v.mapValue?.fields || {};
        return { ts: Number(f.ts?.integerValue || 0), body: f.text?.stringValue || '', dir: f.direction?.stringValue, status: '', error_code: 0 };
      });

      const all = [...oldMsgs, ...newMsgs]
        .filter(m => m.body && m.dir)
        .sort((a, b) => a.ts - b.ts)
        .map(m => ({
          sid:        `meta_${m.ts}`,
          body:       m.body,
          direction:  m.dir === 'out' ? 'outbound' : 'inbound',
          dateSent:   new Date(m.ts).toISOString(),
          status:     m.status || undefined,
          error_code: m.error_code || undefined,
        }));

      console.log(`[wa-inbox] ${phone} → ${newMsgs.length} subcol + ${oldMsgs.length} legacy = ${all.length} msgs`);
      res.json({ ok: true, messages: all });
    } catch(e) {
      console.error(`[wa-inbox] Error para ${req.query.phone}:`, e.message);
      res.json({ ok: true, messages: [] });
    }
  });

  // ── All WA contacts with messages (for messaging sidebar sync) ───────────────
  app.get('/meta/wa-contacts', async (req, res) => {
    try {
      // List all phone docs in wa_messages collection
      const listData = await fetch(`${FS_BASE}/wa_messages?key=${FS_KEY}&pageSize=300`).then(r => r.json()).catch(() => ({}));
      const phones = (listData.documents || []).map(d => d.name.split('/').pop());

      const results = await Promise.all(phones.map(async phone => {
        try {
          const newData = await fetch(`${FS_BASE}/wa_messages/${phone}/msgs?key=${FS_KEY}&pageSize=200`).then(r => r.json()).catch(() => ({}));
          const newMsgs = (newData.documents || []).map(d => {
            const f = d.fields || {};
            return { ts: Number(f.ts?.integerValue || 0), body: f.text?.stringValue || '', dir: f.direction?.stringValue, status: f.status?.stringValue || '', error_code: Number(f.error_code?.integerValue || 0) };
          });
          const oldData = await fetch(`${FS_BASE}/wa_messages/${phone}?key=${FS_KEY}`).then(r => r.json()).catch(() => ({}));
          const oldMsgs = (oldData.fields?.messages?.arrayValue?.values || []).map(v => {
            const f = v.mapValue?.fields || {};
            return { ts: Number(f.ts?.integerValue || 0), body: f.text?.stringValue || '', dir: f.direction?.stringValue, status: '', error_code: 0 };
          });
          const msgs = [...oldMsgs, ...newMsgs]
            .filter(m => m.body && m.dir)
            .sort((a, b) => a.ts - b.ts)
            .map(m => ({
              sid:        `meta_${m.ts}`,
              body:       m.body,
              direction:  m.dir === 'out' ? 'outbound' : 'inbound',
              dateSent:   new Date(m.ts).toISOString(),
              status:     m.status || undefined,
              error_code: m.error_code || undefined,
              ch:         'wa',
            }));
          return { phone, messages: msgs };
        } catch { return { phone, messages: [] }; }
      }));

      res.json({ ok: true, contacts: results.filter(c => c.messages.length > 0) });
    } catch(e) {
      res.json({ ok: true, contacts: [] });
    }
  });

  // ── Webhook diagnostic (in-memory last 20) ──────────────────────────────────
  app.get('/meta/webhook/diagnostic', (req, res) => {
    res.json({
      ok:         true,
      serverTime: new Date().toISOString(),
      waToken:    _waToken ? `...${_waToken.slice(-6)}` : 'NO TOKEN',
      waPhoneId:  META_WA_PHONE_ID || 'NOT SET',
      lastEvents: _webhookLog,
    });
  });

  // ── Webhook event log (persistent, Firestore) ────────────────────────────────
  app.get('/meta/webhook/log', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const data  = await fetch(`${FS_BASE}/webhook_log?key=${FS_KEY}&pageSize=${limit}`).then(r => r.json());
      const events = (data.documents || []).map(d => {
        const f = d.fields || {};
        return {
          ts:      f.ts?.stringValue,
          type:    f.type?.stringValue,
          phone:   f.phone?.stringValue,
          preview: f.preview?.stringValue,
        };
      }).sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      const messages = events.filter(e => e.type === 'message');
      const statuses = events.filter(e => e.type === 'status');
      res.json({
        ok:             true,
        total:          events.length,
        totalMessages:  messages.length,
        totalStatuses:  statuses.length,
        events,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Data deletion callback (requerido por Meta) ───────────────────────────
  app.post('/meta/data-deletion', (req, res) => {
    const signedRequest = req.body.signed_request;
    const confirmationCode = `del_${Date.now()}`;
    console.log(`[Meta] Solicitud de eliminación de datos recibida: ${confirmationCode}`);
    res.json({
      url:               `https://elite-reclutamiento-production.up.railway.app/meta/data-deletion/status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  });

  app.get('/meta/data-deletion/status', (req, res) => {
    res.json({ status: 'deleted', code: req.query.code });
  });

  // ── WhatsApp hours API ──────────────────────────────────────────────────────
  app.get('/wa/hours', async (req, res) => {
    const cfg = await loadWAHours();
    res.json({ ok: true, hours: cfg });
  });

  app.post('/wa/hours', async (req, res) => {
    try {
      const current = await loadWAHours();
      const merged  = { ...current, ...req.body };
      await saveWAHours(merged);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Manual send via Meta Cloud API (for CRM manual replies on Meta WA leads) ──
  app.post('/meta/wa-send', async (req, res) => {
    const { to, body, leadId } = req.body;
    if (!to || !body) return res.status(400).json({ ok: false, error: 'to y body requeridos' });
    if (!_waToken || !META_WA_PHONE_ID) return res.status(503).json({ ok: false, error: 'Meta WA no configurado' });
    try {
      const cleanTo = to.replace(/^\+/, '').replace(/\D/g, '');
      const ts = Date.now();
      const ok = await sendWhatsApp(cleanTo, body);
      if (leadId) {
        fsUpdateLeadFields(leadId, { unread_msg: false, last_msg_ts: ts }).catch(() => {});
      }
      res.json({ ok: true, via: 'meta', to: cleanTo, ts });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  console.log('[Meta] Rutas registradas: /meta/webhook (GET), /meta/webhook/whatsapp, /meta/webhook/ig-messenger, /meta/data-deletion');
}

module.exports = { registerMetaRoutes, sendWhatsApp, sendInstagram, sendMessenger };
