const crypto = require('crypto');
const db = require('./db');
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
    const cfg = await db.sbGetConfig('wa_hours');
    return cfg || WA_DEFAULT_HOURS;
  } catch { return WA_DEFAULT_HOURS; }
}

async function saveWAHours(cfg) {
  await db.sbSetConfig('wa_hours', cfg);
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

// App 1 — GrupoElite Bot (Instagram + Messenger + Lead Ads)
const META_APP_SECRET_IG     = process.env.META_APP_SECRET_IG     || '6f59669c43e93f238457c5b8e5680bd0';
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || '';
const META_IG_ACCESS_TOKEN   = process.env.META_IG_ACCESS_TOKEN   || '';
const META_PAGE_ID           = process.env.META_PAGE_ID           || '';

// App 2 — WhatsApp
const META_APP_SECRET_WA = process.env.META_APP_SECRET_WA || '80dc2555ece1fd87afb133222ff2b5eb';
const META_APP_ID        = process.env.META_APP_ID        || '1447919720444811';
const META_WA_PHONE_ID   = process.env.META_WA_PHONE_ID   || '';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';

// ── Token management ─────────────────────────────────────────────────────────
let _waToken = process.env.META_WA_TOKEN || '';

async function _loadTokenFromSB() {
  try {
    const cfg = await db.sbGetConfig('wa_token');
    if (!cfg) return;
    const { token, expires_at } = cfg;
    if (token && expires_at && Date.now() < Number(expires_at) * 1000) {
      _waToken = token;
      console.log('[Meta WA] Token cargado desde Supabase — expira:', new Date(Number(expires_at) * 1000).toLocaleDateString());
    }
  } catch (e) { console.warn('[Meta WA] No se pudo cargar token desde SB:', e.message); }
}

async function _saveTokenToSB(token, expiresIn) {
  const expires_at = Math.floor(Date.now() / 1000) + expiresIn;
  await db.sbSetConfig('wa_token', { token, expires_at });
}

async function _refreshToken() {
  if (!META_APP_ID || !META_APP_SECRET_WA || !_waToken) return;
  try {
    const res  = await fetch(`${GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET_WA}&fb_exchange_token=${_waToken}`);
    const data = await res.json();
    if (data.access_token) {
      _waToken = data.access_token;
      await _saveTokenToSB(data.access_token, data.expires_in || 5184000);
      console.log('[Meta WA] Token renovado automáticamente ✓');
    } else {
      console.error('[Meta WA] Error renovando token:', JSON.stringify(data));
    }
  } catch (e) { console.error('[Meta WA] Error en refresh token:', e.message); }
}

async function _checkTokenExpiry() {
  try {
    const cfg       = await db.sbGetConfig('wa_token');
    const expires_at = Number(cfg?.expires_at || 0);
    const sevenDays = 7 * 24 * 60 * 60;
    if (expires_at && (expires_at - Math.floor(Date.now() / 1000)) < sevenDays) {
      console.log('[Meta WA] Token expira pronto — renovando…');
      await _refreshToken();
    }
  } catch (e) { console.warn('[Meta WA] Error verificando expiración:', e.message); }
}

// Load token on startup; env var takes priority
if (!_waToken) _loadTokenFromSB().then(() => _checkTokenExpiry());
else _checkTokenExpiry();
setInterval(_checkTokenExpiry, 24 * 60 * 60 * 1000);

// ── Signature verification ────────────────────────────────────────────────────
function verifySignature(req, appSecret) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !appSecret) return true;
  const payload = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

// In-memory index: wamid → {phone, logId}
const _wamidIndex = new Map();

// ── Log WA message to Supabase ───────────────────────────────────────────────
async function _logWAMessage(phone, direction, text, extra = {}) {
  try {
    const clean = phone.replace(/^wa_meta:/, '').replace(/^\+/, '');
    const logId = await db.sbLogWAMessage(clean, direction, text, extra);
    // Mirror into lead's metaWa for UI
    const ts  = Date.now();
    const sid = logId || `meta_${ts}`;  // Use real wa_messages ID so sync deduplicates correctly
    const metaMsg = {
      sid,
      body:      text || '',
      direction: direction === 'out' ? 'outbound' : 'inbound',
      dateSent:  new Date(ts).toISOString(),
      ch:        'wa',
    };
    if (extra.status) metaMsg.status = extra.status;
    fsAppendLeadMetaWa(clean, metaMsg).catch(() => {});
    return logId;
  } catch { return null; }
}

// ── Webhook event log ─────────────────────────────────────────────────────────
async function _logWebhookEvent(type, phone, preview, raw) {
  try {
    await db.sbLogWebhook({
      ts:      new Date().toISOString(),
      type,
      phone:   phone || '',
      preview: (preview || '').slice(0, 200),
      raw:     (raw   || '').slice(0, 800),
    });
  } catch {}
}

// ── Whisper transcription ─────────────────────────────────────────────────────
async function _transcribeAudio(mediaId) {
  if (!OPENAI_API_KEY || !_waToken) return null;
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${_waToken}` },
    });
    const metaJson = await metaRes.json();
    if (!metaJson.url) return null;

    const audioRes = await fetch(metaJson.url, {
      headers: { Authorization: `Bearer ${_waToken}` },
    });
    if (!audioRes.ok) return null;
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

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

const _sentDedup = new Map();
function _isDupSend(to, text) {
  const key  = `${to}:${text}`;
  const last = _sentDedup.get(key) || 0;
  if (Date.now() - last < 30_000) return true;
  _sentDedup.set(key, Date.now());
  setTimeout(() => _sentDedup.delete(key), 60_000);
  return false;
}

// ── Send WhatsApp message via Meta Cloud API ──────────────────────────────────
async function sendWhatsApp(to, text) {
  const cleanTo = to.replace(/^wa_meta:/, '').replace(/^whatsapp:/, '').replace(/^\+/, '');
  if (!_waToken || !META_WA_PHONE_ID) {
    console.warn('[Meta WA] Token o Phone ID no configurados');
    return false;
  }
  if (_isDupSend(cleanTo, text)) {
    console.warn(`[Meta WA] Envío duplicado ignorado → ${cleanTo}`);
    return false;
  }
  const logId = await _logWAMessage(cleanTo, 'out', text);
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
        console.warn(`[Meta WA] Ventana 24h cerrada para ${cleanTo}`);
      }
      if (logId) {
        db.sbUpdateWAMessage(logId, { status: 'failed', error_code: json.error.code || 0 }).catch(() => {});
      }
    } else if (json.messages?.[0]?.id && logId) {
      const wamid = json.messages[0].id;
      _wamidIndex.set(wamid, { phone: cleanTo, logId });
      db.sbUpdateWAMessage(logId, { wamid, status: 'sent' }).catch(() => {});
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
      headers: { 'Authorization': `Bearer ${META_IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: part } }),
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
      headers: { 'Authorization': `Bearer ${META_PAGE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: part } }),
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

function sendWAToManager(phone, text) {
  return sendWhatsApp(phone.replace(/^\+/, ''), text);
}

setInterval(() => checkTimeouts(sendWAToManager).catch(e => console.error('[ESC-Timer]', e.message)), 60_000);

// ── Register routes ───────────────────────────────────────────────────────────
function registerMetaRoutes(app) {

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
  app.get('/meta/webhook',              verifyWebhook);
  app.get('/meta/webhook/whatsapp',     verifyWebhook);
  app.get('/meta/webhook/ig-messenger', verifyWebhook);

  const _processedMsgIds = new Set();
  const _msgBuffer   = new Map();
  const _msgTimers   = new Map();
  const _DEBOUNCE_MS = 3000;

  const DIAS_FULL = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

  async function _processBufferedMessages(from, referralInfo, profileName, inboxNumber) {
    const texts = _msgBuffer.get(from) || [];
    _msgBuffer.delete(from);
    _msgTimers.delete(from);
    if (!texts.length) return;

    const combinedText = texts.join('\n');
    console.log(`[Meta WA] ← ${from} (${texts.length} msg): ${combinedText}`);
    _logWAMessage(from, 'in', combinedText).catch(() => {});

    try {
      // ── Interviewer CONFIRMAR/REAGENDAR reply ────────────────────────────
      const _ivCfg = await loadInterviewConfig().catch(() => null);
      if (_ivCfg?.interviewer?.phone) {
        const _ivPhone = _ivCfg.interviewer.phone.replace(/[^0-9]/g, '');
        if (from.replace(/[^0-9]/g, '') === _ivPhone) {
          const _msg = combinedText.trim().toUpperCase();
          if (_msg.includes('CONFIRMAR') || _msg.includes('REAGENDAR')) {
            const all     = await listInterviews().catch(() => []);
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
          const _pNombre = _pLead.nombre || '';
          const updates  = {};
          if (profileName && (!_pNombre || _pNombre.startsWith('WA ') || _pNombre.startsWith('+'))) {
            updates.nombre = profileName;
          }
          if (inboxNumber) updates.wa_inbox_number = inboxNumber;
          if (Object.keys(updates).length) fsUpdateLeadFields(_pLead.id, updates).catch(() => {});
        }
      }

      // Tag lead source from Meta ad
      if (referralInfo?.source_type === 'ad') {
        const adLead = await fsGetLeadByPhone(from);
        if (adLead) {
          await fsUpdateLeadFields(adLead.id, {
            fuente:    'Meta / Facebook',
            ad_nombre: referralInfo.headline  || '',
            ad_clid:   referralInfo.ctwa_clid || '',
          }).catch(() => {});
          console.log(`[Meta WA] Lead ${adLead.id} etiquetado como Meta Ads`);
        }
      }

      const leadData = await fsGetLeadByPhone(from);
      const convKey  = `wa_meta:${from}`;
      const _leadId  = leadData?.id;

      if (_leadId) {
        fsUpdateLeadFields(_leadId, { unread_msg: true, last_msg_ts: Date.now() }).catch(() => {});
      }

      // If IA is paused: store message in history but don't reply
      if (leadData?.ia_paused === true) {
        if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
        conversationHistory.get(convKey).push({ role: 'user', content: combinedText, ts: Date.now() });
        console.log(`[Meta WA] IA pausada para ${from} — mensaje guardado en historial, sin respuesta`);
        return;
      }

      const _wasEmptyOnRestart = !conversationHistory.has(convKey) || conversationHistory.get(convKey).length === 0;

      // Inject / refresh context from Supabase
      if (leadData) {
        const ctxParts = [];
        const _ctxNombre     = leadData.nombre      || '';
        const _ctxCorreo     = leadData.correo      || '';
        const _ctxUbicacion  = leadData.ubicacion   || '';
        const _ctxEtapa      = leadData.etapa       || '';
        const _ctxPipelineId = leadData.pipeline_id || '';
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

      // Reconstruct history from Supabase on restart
      if (_wasEmptyOnRestart) {
        try {
          const _allStored   = await db.sbGetWAMessages(from, 200);
          const _prevStored  = _allStored.slice(0, -1).slice(-24);
          const _merged      = [];
          for (const m of _prevStored) {
            if (_merged.length && _merged[_merged.length - 1].direction === m.direction) {
              _merged[_merged.length - 1].text += '\n' + m.text;
            } else {
              _merged.push({ ...m });
            }
          }
          if (_merged.length) {
            if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
            const _hist = conversationHistory.get(convKey);
            for (const m of _merged) {
              const _role = m.direction === 'out' ? 'assistant' : 'user';
              if (_hist.length && _hist[_hist.length - 1].role === _role) {
                _hist[_hist.length - 1].content += '\n' + m.text;
              } else {
                _hist.push({ role: _role, content: m.text, ts: m.ts });
              }
            }
            console.log(`[Meta WA] Historial reconstruido desde Supabase para ${from}: ${_merged.length} msgs`);
          }
        } catch (_e) {
          console.warn(`[Meta WA] No se pudo reconstruir historial para ${from}:`, _e.message);
        }
      }

      // ── Horario de atención ─────────────────────────────────────────────────
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

      // ── Interview: slot selection state machine ─────────────────────────────
      const _ivState = leadData?.interview_state;
      if (_ivState === 'awaiting_slot' && combinedText?.trim()) {
        let ivData = {};
        try {
          const _raw = typeof leadData.pending_slots === 'string'
            ? JSON.parse(leadData.pending_slots || '{}')
            : (leadData.pending_slots || {});
          ivData = Array.isArray(_raw) ? { slots: _raw, offeringDay: 1 } : _raw;
        } catch {}
        const allSlots    = ivData.slots || [];
        const offeringDay = ivData.offeringDay || 1;
        const leadId      = leadData?.id;
        const nombre      = leadData?.nombre || '';
        const _validName  = !nombre || nombre.startsWith('WA ') || nombre.startsWith('+') ? '' : nombre;
        const firstName   = _validName.split(' ')[0] || '';
        const fmtH        = h => h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h-12}pm`;

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
            const chosen = daySlots[choiceIdx];
            console.log(`[Interview] ${from} eligió: ${chosen.iso}`);
            try {
              await bookInterview({ leadPhone: from, leadName: nombre, slotIso: chosen.iso, convKey });
              if (leadId) await fsUpdateLeadFields(leadId, { interview_state: 'booked', pending_slots: '', quiere_entrevista: false, webinar_accion: 'en-entrevista' });
              const hist = conversationHistory.get(convKey) || [];
              const d = new Date(chosen.iso);
              const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
              const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
              const fechaStr = `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;
              const horaStr  = (() => { const h = d.getHours(); return `${h%12||12}:00 ${h>=12?'PM':'AM'}`; })();
              hist.push({ role: 'assistant', content: `[SISTEMA] La entrevista quedó agendada para el ${fechaStr} a las ${horaStr}. Ya le envié la confirmación al candidato con el enlace Zoom. El proceso de agendamiento está completo.`, ts: Date.now() });
            } catch (e) { console.error('[Interview] Error booking:', e.message); }
            return;

          } else if (decision === 'NO') {
            if (offeringDay === 1 && dayDates.length > 1) {
              const day2Slots = allSlots.filter(s => new Date(s.iso).toISOString().slice(0,10) === dayDates[1]);
              const d2   = new Date(day2Slots[0].iso);
              const t2   = day2Slots.map(s => fmtH(new Date(s.iso).getHours()));
              const tList2 = t2.length === 1 ? `a las ${t2[0]}` : t2.length === 2 ? `a las ${t2[0]} o a las ${t2[1]}` : `a las ${t2[0]}, a las ${t2[1]} o a las ${t2[2]}`;
              const msg2   = `Sin problema, ¡${firstName}! 😊 El ${DIAS_FULL[d2.getDay()]} también tengo disponible ${tList2}. ¿Alguna te funciona?`;
              await humanDelay(msg2);
              await sendWhatsApp(from, msg2);
              if (leadId) await fsUpdateLeadFields(leadId, { pending_slots: JSON.stringify({ slots: allSlots, offeringDay: 2 }) });
            } else {
              const escMsg = `Entendido, ${firstName}. Voy a pedirle a un encargado que te contacte para encontrar un horario que te funcione. 🙏`;
              await humanDelay(escMsg);
              await sendWhatsApp(from, escMsg);
              if (leadId) await fsUpdateLeadFields(leadId, { interview_state: '', pending_slots: '', sin_manager: true });
              triggerEscalation(from, nombre, 'sin-horario', `Candidato no puede en ningún horario ofrecido (día 1 y día 2)`, sendWAToManager).catch(() => {});
            }
            return;
          }
        }
      }

      // First-ever contact: short delay before Ana responds
      if (_isFirstEverContact) {
        console.log(`[Meta WA] Primer contacto de ${from} — Ana esperará 30s antes de responder`);
        await new Promise(resolve => setTimeout(resolve, 30 * 1000));
        const _freshLead = await fsGetLeadByPhone(from).catch(() => null);
        if (_freshLead?.ia_paused === true) {
          console.log(`[Meta WA] IA pausada durante la espera de ${from} — sin respuesta`);
          return;
        }
        // Re-read messages sent manually during the wait
        try {
          const _waitMsgs    = await db.sbGetWAMessages(from, 200);
          const _waitHist    = conversationHistory.get(convKey) || [];
          const _lastKnownTs = _waitHist.length ? Math.max(..._waitHist.map(m => m.ts || 0)) : 0;
          for (const m of _waitMsgs) {
            if (m.ts > _lastKnownTs) {
              const _role = m.direction === 'out' ? 'assistant' : 'user';
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
        const leadName = leadData?.nombre || '';
        if (escMatch[1] === 'resolved') {
          cancelEscalation(from, leadName, sendWAToManager).catch(e => console.error('[ESC-cancel]', e.message));
        } else {
          triggerEscalation(from, leadName, escMatch[1], combinedText, sendWAToManager).catch(e => console.error('[ESC]', e.message));
        }
      }

      console.log(`[Meta WA] → ${from}: ${reply}`);
      await humanDelay(reply);
      await sendWhatsApp(from, reply);

      if (_leadId) {
        fsUpdateLeadFields(_leadId, { unread_msg: false, last_msg_ts: Date.now() }).catch(() => {});
      }

      if (agendar) {
        (async () => {
          try {
            const cfg       = await loadInterviewConfig();
            const slots     = await getAvailableSlots(cfg);
            const nombre    = leadData?.nombre || '';
            const _realName = !nombre || nombre.startsWith('WA ') || nombre.startsWith('+') ? '' : nombre;
            const first     = _realName.split(' ')[0] || '';
            const ubicacion = leadData?.ubicacion || '';
            const candidateTZ = getCandidateTZ(ubicacion);

            if (!slots.length) {
              const noSlotMsg = `${first ? '¡'+first+'! ' : ''}En este momento no hay horarios disponibles. Un encargado se pondrá en contacto contigo muy pronto para agendar. 🙏`;
              await humanDelay(noSlotMsg);
              await sendWhatsApp(from, noSlotMsg);
              return;
            }

            const dayDates = [...new Set(slots.map(s =>
              new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ }).format(new Date(s.iso))
            ))];
            const day1Slots = slots.filter(s =>
              new Intl.DateTimeFormat('en-CA', { timeZone: TEAM_TZ }).format(new Date(s.iso)) === dayDates[0]
            );
            const d1      = new Date(day1Slots[0].iso);
            const dayName = new Intl.DateTimeFormat('es-MX', { timeZone: TEAM_TZ, weekday: 'long' }).format(d1);

            const fmtSlotTime = (isoStr) => {
              const d    = new Date(isoStr);
              const etH  = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: TEAM_TZ, hour: 'numeric', hour12: false }).format(d));
              const h12  = etH % 12 || 12;
              const ampm = etH >= 12 ? 'PM' : 'AM';
              let label  = `${h12}:00 ${ampm} ET`;
              if (candidateTZ && candidateTZ !== TEAM_TZ) {
                const locH  = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: candidateTZ, hour: 'numeric', hour12: false }).format(d));
                const lh12  = locH % 12 || 12;
                const lampm = locH >= 12 ? 'PM' : 'AM';
                label += ` (${lh12}:00 ${lampm} tu hora)`;
              }
              return label;
            };

            const t1    = day1Slots.map(s => fmtSlotTime(s.iso));
            const tList = t1.length === 1 ? `a las ${t1[0]}` : t1.length === 2 ? `a las ${t1[0]} o a las ${t1[1]}` : `a las ${t1[0]}, ${t1[1]} o ${t1[2]}`;
            const slotsMsg = `${first ? '¡'+first+'! ' : ''}😊 Para tu entrevista, el ${dayName} tengo disponible ${tList}. ¿Alguna te funciona?`;

            await humanDelay(slotsMsg);
            await sendWhatsApp(from, slotsMsg);

            const doc = await fsGetLeadByPhone(from);
            if (doc) {
              await fsUpdateLeadFields(doc.id, {
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

  // ── WhatsApp webhook (POST) ───────────────────────────────────────────────
  const _webhookLog = [];
  app.post('/meta/webhook/whatsapp', async (req, res) => {
    res.sendStatus(200);

    const _sigOk   = verifySignature(req, META_APP_SECRET_WA);
    const _rawBody = JSON.stringify(req.body);

    _webhookLog.unshift({ ts: new Date().toISOString(), sigOk: _sigOk, body: _rawBody.slice(0, 500) });
    if (_webhookLog.length > 20) _webhookLog.pop();

    const _entry  = req.body.entry?.[0];
    const _value  = _entry?.changes?.[0]?.value;
    const _msg    = _value?.messages?.[0];
    const _status = _value?.statuses?.[0];
    if (_msg) {
      _logWebhookEvent('message', _msg.from, `[${_msg.type}] ${_msg.text?.body || ''}`, _rawBody).catch(() => {});
    } else if (_status) {
      _logWebhookEvent('status', _status.recipient_id, `status:${_status.status} err:${_status.errors?.[0]?.code || ''}`, _rawBody).catch(() => {});
    } else if (_value) {
      _logWebhookEvent('other', '', _rawBody.slice(0, 100), _rawBody).catch(() => {});
    }

    if (!_sigOk) {
      console.warn('[Meta WA] Firma inválida — evento rechazado');
      return;
    }

    try {
      const entry   = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;

      // ── Status updates ──────────────────────────────────────────────────
      if (value?.statuses?.length) {
        for (const st of value.statuses) {
          const { id: wamid, status, recipient_id } = st;
          if (!wamid || (status !== 'delivered' && status !== 'read')) continue;
          const entry = _wamidIndex.get(wamid);
          if (entry) {
            const { phone, logId } = entry;
            db.sbUpdateWAMessage(logId, { status }).catch(() => {});
            console.log(`[Meta WA] Status ${status} → ${phone} (${wamid})`);
          }
        }
        if (!value.messages?.length) return;
      }

      if (!value?.messages?.length) return;

      const msg  = value.messages[0];
      const from = msg.from;

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
          text = msg.interactive?.button_reply?.title
              || msg.interactive?.list_reply?.title
              || null;
          break;
        case 'button':
          text = msg.button?.text || null;
          break;
        case 'sticker':
        case 'reaction':
          return;
        default:
          console.log(`[Meta WA] Tipo de mensaje no soportado: ${msg.type} de ${from}`);
          return;
      }
      if (!text) return;

      if (msg.id && _processedMsgIds.has(msg.id)) {
        console.log(`[Meta WA] Mensaje duplicado ignorado: ${msg.id}`);
        return;
      }
      if (msg.id) {
        _processedMsgIds.add(msg.id);
        setTimeout(() => _processedMsgIds.delete(msg.id), 10 * 60 * 1000);
      }

      if (await handleAuthWAReply(from, text)) return;

      const _profileName  = value?.contacts?.[0]?.profile?.name || null;
      const _inboxDisplay = value?.metadata?.display_phone_number || null;

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

      if (req.body.object === 'page') {
        const messaging = entry.messaging?.[0];
        if (!messaging) return;
        const senderId = messaging.sender?.id;
        const text     = messaging.message?.text;
        if (!text || !senderId) return;
        if (messaging.message?.is_echo) return;

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

  // ── Meta WA inbox ─────────────────────────────────────────────────────────
  app.get('/meta/wa-inbox', async (req, res) => {
    const phone = (req.query.phone || '').replace(/^\+/, '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ ok: false });
    try {
      const rows = await db.sbGetWAMessages(phone, 200);
      const messages = rows
        .filter(m => m.text && m.direction)
        .map(m => ({
          sid:        `meta_${m.ts}`,
          body:       m.text,
          direction:  m.direction === 'out' ? 'outbound' : 'inbound',
          dateSent:   new Date(m.ts).toISOString(),
          status:     m.status     || undefined,
          error_code: m.error_code || undefined,
        }));
      console.log(`[wa-inbox] ${phone} → ${messages.length} msgs`);
      res.json({ ok: true, messages });
    } catch(e) {
      console.error(`[wa-inbox] Error para ${req.query.phone}:`, e.message);
      res.json({ ok: true, messages: [] });
    }
  });

  // ── All WA contacts ───────────────────────────────────────────────────────
  app.get('/meta/wa-contacts', async (req, res) => {
    try {
      const [contacts, managers] = await Promise.all([
        db.sbGetAllWAContacts(),
        loadManagers().catch(() => []),
      ]);
      const managerPhones = new Set(managers.map(m => m.phone.replace(/[^0-9]/g, '')));
      const filtered = contacts.filter(c => !managerPhones.has((c.phone || '').replace(/[^0-9]/g, '')));
      res.json({ ok: true, contacts: filtered });
    } catch(e) {
      res.json({ ok: true, contacts: [] });
    }
  });

  // ── Webhook diagnostic ────────────────────────────────────────────────────
  app.get('/meta/webhook/diagnostic', (req, res) => {
    res.json({
      ok:         true,
      serverTime: new Date().toISOString(),
      waToken:    _waToken ? `...${_waToken.slice(-6)}` : 'NO TOKEN',
      waPhoneId:  META_WA_PHONE_ID || 'NOT SET',
      lastEvents: _webhookLog,
    });
  });

  // ── Reload WA token (from Supabase or directly via ?token=) ──────────────
  app.get('/meta/reload-token', async (req, res) => {
    const before = _waToken ? _waToken.slice(-8) : 'none';
    if (req.query.token) {
      _waToken = req.query.token.trim();
    } else {
      await _loadTokenFromSB();
    }
    const after = _waToken ? _waToken.slice(-8) : 'none';
    res.json({ before, after, changed: before !== after, tokenPresent: !!_waToken });
  });

  // ── Test send ─────────────────────────────────────────────────────────────
  app.get('/meta/wa-test-send', async (req, res) => {
    const to   = (req.query.to || '').replace(/\D/g, '');
    const body = req.query.body || 'Test de Ana ✓';
    if (!to) return res.status(400).json({ error: 'Falta ?to=número' });
    if (!_waToken || !META_WA_PHONE_ID) return res.json({ error: 'Token o PhoneID no configurado', waToken: !!_waToken, phoneId: META_WA_PHONE_ID });
    try {
      const r    = await fetch(`${GRAPH_URL}/${META_WA_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_waToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      });
      const json = await r.json();
      res.json({ status: r.status, metaResponse: json });
    } catch(e) {
      res.json({ error: e.message });
    }
  });

  // ── Webhook event log ─────────────────────────────────────────────────────
  app.get('/meta/webhook/log', async (req, res) => {
    try {
      const limit  = Math.min(Number(req.query.limit) || 100, 500);
      const events = await db.sbGetWebhookLog(limit);
      const mapped = events
        .map(e => ({ ts: e.ts, type: e.type, phone: e.phone, preview: e.preview }))
        .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      const messages = mapped.filter(e => e.type === 'message');
      const statuses = mapped.filter(e => e.type === 'status');
      res.json({ ok: true, total: mapped.length, totalMessages: messages.length, totalStatuses: statuses.length, events: mapped });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Data deletion callback (required by Meta) ─────────────────────────────
  app.post('/meta/data-deletion', (req, res) => {
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

  // ── WhatsApp hours API ────────────────────────────────────────────────────
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

  // ── Manual send (for CRM manual replies on Meta WA leads) ────────────────
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

  // ── Meta Lead Ads webhook ─────────────────────────────────────────────────
  app.get('/meta/webhook/leadgen', verifyWebhook);

  app.post('/meta/webhook/leadgen', async (req, res) => {
    res.sendStatus(200); // respond immediately to Meta

    if (!verifySignature(req, META_APP_SECRET_IG)) {
      console.warn('[LeadGen] Firma inválida — evento rechazado');
      return;
    }

    try {
      const entries = req.body.entry || [];
      for (const entry of entries) {
        for (const change of (entry.changes || [])) {
          if (change.field !== 'leadgen') continue;
          const { leadgen_id, form_id, ad_id, ad_name, page_id } = change.value || {};
          if (!leadgen_id) continue;

          console.log(`[LeadGen] Nuevo lead: ${leadgen_id} form:${form_id} ad:"${ad_name}"`);

          // Fetch lead details from Graph API
          const token = META_PAGE_ACCESS_TOKEN;
          if (!token) { console.warn('[LeadGen] PAGE_ACCESS_TOKEN no configurado'); continue; }

          const r    = await fetch(`${GRAPH_URL}/${leadgen_id}?fields=field_data,created_time&access_token=${token}`);
          const data = await r.json();
          if (data.error) { console.error('[LeadGen] Error API:', JSON.stringify(data.error)); continue; }

          // Map field_data array to key→value
          const fields = {};
          for (const f of (data.field_data || [])) {
            fields[f.name] = (f.values || [])[0] || '';
          }

          // Normalize to our lead schema
          const nombre   = fields['full_name']    || fields['name']         || '';
          const correo   = fields['email']         || fields['correo']       || '';
          const telefono = fields['phone_number']  || fields['telefono']     || fields['phone'] || '';
          const ubicacion= fields['city']          || fields['ubicacion']    || fields['state'] || '';

          const now = new Date().toISOString();
          const uid = `meta_leadgen_${leadgen_id}`;

          const lead = {
            id:          uid,
            nombre:      nombre   || `Lead Meta ${leadgen_id.slice(-6)}`,
            correo:      correo,
            telefono:    telefono,
            ubicacion:   ubicacion,
            fuente:      'Meta / Facebook',
            pipeline_id: 'postulados-meta',
            etapa:       'New Lead',
            estado:      'abierto',
            ad_nombre:   ad_name  || '',
            ad_clid:     ad_id    || '',
            meta_form_id: form_id || '',
            created_at:  now,
            updated_at:  now,
          };

          await db.sbSaveLead(lead);
          console.log(`[LeadGen] Lead guardado: ${nombre} (${correo}) (${telefono})`);
          _logWebhookEvent('leadgen', telefono || correo, `${nombre} — ${ad_name || 'sin anuncio'}`, JSON.stringify(change.value)).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[LeadGen] Error procesando webhook:', e.message);
    }
  });

  // ── Make.com lead intake ──────────────────────────────────────────────────
  app.post('/meta/make-lead', async (req, res) => {
    try {
      const body     = req.body || {};
      const nombre   = body.full_name   || body.nombre   || body.name         || '';
      const correo   = body.email       || body.correo   || '';
      const telefono = body.phone_number|| body.phone    || body.telefono     || '';
      const ubicacion= body.city        || body.ubicacion|| body.state        || '';
      const leadgenId= body.id          || body.leadgen_id || '';
      const now      = new Date().toISOString();
      const uid      = `meta_make_${leadgenId || Date.now()}`;

      const lead = {
        id:          uid,
        nombre:      nombre || `Lead Meta ${uid.slice(-6)}`,
        correo,
        telefono,
        ubicacion,
        fuente:      'Meta / Facebook',
        pipeline_id: 'postulados-meta',
        etapa:       'New Lead',
        estado:      'abierto',
        created_at:  now,
        updated_at:  now,
      };

      await db.sbSaveLead(lead);

      // Welcome WhatsApp if office hours
      if (telefono) {
        const ct      = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const day     = ct.getDay();
        const timeVal = ct.getHours() * 60 + ct.getMinutes();
        const inOffice = (day >= 1 && day <= 5 && timeVal >= 540 && timeVal < 1080)
                      || (day === 6 && timeVal >= 540 && timeVal < 720);
        const firstName = nombre.split(' ')[0] || nombre;
        const msg = inOffice
          ? `Hola ${firstName}, hemos recibido tu solicitud para Grupo Elite. Es un placer tenerte con nosotros, en breve te estaremos llamando para darte más información.`
          : `Hola ${firstName}, hemos recibido tu solicitud para Grupo Elite. En este momento nuestras oficinas están cerradas, pero en cuanto abramos te contactaremos. ¡Gracias por tu interés!`;
        sendWhatsApp(telefono.replace(/\D/g, ''), msg).catch(() => {});
      }

      console.log(`[Make Lead] Guardado: ${nombre} (${telefono})`);
      res.json({ ok: true, id: uid });
    } catch (e) {
      console.error('[Make Lead] Error:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── LeadGen diagnostic ────────────────────────────────────────────────────
  app.get('/meta/leadgen/test', async (req, res) => {
    const { leadgen_id } = req.query;
    if (!leadgen_id) return res.json({ ok: false, error: 'Falta ?leadgen_id=' });
    if (!META_PAGE_ACCESS_TOKEN) return res.json({ ok: false, error: 'PAGE_ACCESS_TOKEN no configurado' });
    try {
      const r    = await fetch(`${GRAPH_URL}/${leadgen_id}?fields=field_data,created_time&access_token=${META_PAGE_ACCESS_TOKEN}`);
      const data = await r.json();
      res.json({ ok: !data.error, data });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  console.log('[Meta] Rutas registradas: /meta/webhook (GET), /meta/webhook/whatsapp, /meta/webhook/ig-messenger, /meta/webhook/leadgen, /meta/data-deletion');
}

module.exports = { registerMetaRoutes, sendWhatsApp, sendInstagram, sendMessenger };
