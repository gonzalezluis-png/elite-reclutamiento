const crypto = require('crypto');
const db = require('./db');
const { handleAuthWAReply } = require('./auth-sessions');
const { askClaude, conversationHistory } = require('./ai');
const { fsLeadExists, fsCreateLeadWA, fsGetLeadByPhone, fsGetLeadByEmail, fsUpdateLeadFields, runWAPipeline, humanDelay, fsAppendLeadMetaWa, toE164 } = require('./pipeline');
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

// Conversions API
const META_PIXEL_ID      = process.env.META_PIXEL_ID      || '1447919720444811';
const META_CAPI_TOKEN    = process.env.META_CAPI_TOKEN     || 'EAAUk4BSZAs4sBRZAM5BFZCC1KJZA2GFUoFVDeMrjeykIZBWnMoNV5C3GTqbcgpJW1jVthGzZBplRAAub56LtItgoVd0mpALFFNAhRLTpS9heu4tiYCDF52eVYX90aYu2Pp3qFGc7tl8XZByKtI3HqIDKTB4fMZC4ZA4bgZAcYkHeh4J5pqKwHUquSwZAUFsTZAkcqKZBY8vR3iHFQtHv1e5a7CE77uZBdjB9SXO0yne968h1TjiKOHr2EGwle108xlCzsitpCqEWKw3kZBIWgPvYeiB7ELD';

async function fireCapiLead({ email, telefono, nombre, eventId }) {
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) return;
  const crypto = require('crypto');
  const hash = s => s ? crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex') : undefined;
  const cleanPhone = (telefono || '').replace(/\D/g, '');
  const userData = {};
  if (email)      userData.em = [hash(email)];
  if (cleanPhone) userData.ph = [hash(cleanPhone)];
  const payload = {
    data: [{
      event_name:   'Lead',
      event_time:   Math.floor(Date.now() / 1000),
      event_id:     eventId || `lead_${Date.now()}`,
      action_source: 'other',
      user_data:    userData,
    }],
  };
  try {
    await fetch(`${GRAPH_URL}/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    console.log('[CAPI] Lead event fired');
  } catch(e) {
    console.warn('[CAPI] Error:', e.message);
  }
}

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
async function sendWhatsApp(to, text, { noLog = false } = {}) {
  const cleanTo = to.replace(/^wa_meta:/, '').replace(/^whatsapp:/, '').replace(/^\+/, '');
  if (!_waToken || !META_WA_PHONE_ID) {
    console.warn('[Meta WA] Token o Phone ID no configurados');
    return false;
  }
  if (_isDupSend(cleanTo, text)) {
    console.warn(`[Meta WA] Envío duplicado ignorado → ${cleanTo}`);
    return false;
  }
  const logId = noLog ? null : await _logWAMessage(cleanTo, 'out', text);
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
  return sendWhatsApp(phone.replace(/^\+/, ''), text, { noLog: true });
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
  const _msgBuffer      = new Map();
  const _msgTimers      = new Map();
  const _processingLocks = new Set(); // prevents concurrent processing per phone
  const _DEBOUNCE_MS = 3000;

  const DIAS_FULL = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

  async function _processBufferedMessages(from, referralInfo, profileName, inboxNumber) {
    // Prevent concurrent processing for the same phone (race condition guard)
    if (_processingLocks.has(from)) {
      // Reschedule — buffer still holds the messages, retry when lock clears
      clearTimeout(_msgTimers.get(from));
      _msgTimers.set(from, setTimeout(() =>
        _processBufferedMessages(from, referralInfo, profileName, inboxNumber), 2000));
      return;
    }

    const texts = _msgBuffer.get(from) || [];
    _msgBuffer.delete(from);
    _msgTimers.delete(from);
    if (!texts.length) return;

    _processingLocks.add(from);

    try {
    const combinedText = texts.join('\n');
    console.log(`[Meta WA] ← ${from} (${texts.length} msg): ${combinedText}`);

    // Don't log manager messages — they're internal escalation replies, not lead conversations
    const _isManager = await isManagerPhone(from).catch(() => false);
    if (!_isManager) _logWAMessage(from, 'in', combinedText).catch(() => {});

    const convKey = `wa_meta:${from}`;

    // ── Auto-create lead BEFORE hours check so new contacts always appear in CRM ─
    if (!_isManager) {
      const _existsEarly = await fsLeadExists(from);
      if (!_existsEarly) {
        try {
          await fsCreateLeadWA(convKey);
          pixelLead({ telefono: from, correo: '' }).catch(() => {});
        } catch (_e) { console.warn('[Meta WA] Early lead create failed:', _e.message); }
      }
    }

    // ── Horario de atención — check BEFORE any response (form or normal) ─────
    if (!_isManager) {
      const _inHoursEarly = await isWABusinessHours();
      if (!_inHoursEarly) {
        if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
        conversationHistory.get(convKey).push({ role: 'user', content: combinedText, ts: Date.now() });
        const _lastClosedTs = [...(conversationHistory.get(convKey))].reverse()
          .find(m => m.role === 'assistant' && m.content?.includes('oficinas están cerradas'))?.ts || 0;
        if (Date.now() - _lastClosedTs > 60 * 60 * 1000) {
          const _closedLead = await fsGetLeadByPhone(from).catch(() => null);
          const _closedName = _closedLead?.nombre ? _closedLead.nombre.split(' ')[0] : null;
          const _greeting   = _closedName ? `Hola ${_closedName} 👋` : `Hola 👋`;
          const closedMsg = `${_greeting} *Es un gusto que te interese la oportunidad de empleo.*\n\nEn este momento nuestras *oficinas se encuentran cerradas* 🕐\n\nSin embargo, puedes ver este *video resumen* 🎥 con información sobre la oferta laboral.\n\nEn horario de oficina te estaremos contactando para darte más detalles, o si prefieres, también puedes *dejarnos tu mejor horario* para llamarte pronto 📞`;
          console.log(`[Meta WA] Fuera de horario — ${from}, enviando video con caption`);
          await humanDelay(closedMsg);
          try {
            const cleanFrom = from.replace(/^\+/, '').replace(/\D/g, '');
            await fetch(`${GRAPH_URL}/${META_WA_PHONE_ID}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${_waToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: cleanFrom,
                type: 'video',
                video: { link: 'https://elite-webinar.b-cdn.net/file/elite-webinar/Video-Intro-Globe-Life-WA.mp4', caption: closedMsg },
              }),
            });
          } catch (_ve) {
            console.warn('[Meta WA] Off-hours video send failed, falling back to text:', _ve.message);
            await sendWhatsApp(from, closedMsg);
          }
          conversationHistory.get(convKey).push({ role: 'assistant', content: closedMsg, ts: Date.now() });
        } else {
          console.log(`[Meta WA] Fuera de horario — ${from}, cierre ya enviado recientemente, ignorando`);
        }
        return;
      }
    }

      // ── Detect Click-to-WhatsApp form data message ───────────────────────
      // Meta sends form fields as first WA message: "full_name: X phone: Y email: Z"
      if (/full_name\s*:/i.test(combinedText) && /phone\s*:/i.test(combinedText)) {
        const extractField = (text, ...keys) => {
          for (const key of keys) {
            const m = text.match(new RegExp(`${key}\\s*:\\s*([^\\n\\r]+?)(?=\\s+\\w+[_\\w]*\\s*:|$)`, 'i'));
            if (m) return m[1].trim();
          }
          return '';
        };
        const formNombre   = extractField(combinedText, 'full_name', 'nombre');
        const formTelefono = extractField(combinedText, 'phone', 'phone_number', 'telefono');
        const formCorreo   = extractField(combinedText, 'email', 'correo');
        const formModal    = extractField(combinedText, 'buscas_trabajo_presencial_o_remoto\\?', 'modalidad');

        console.log(`[Meta WA] Formulario WA detectado — ${formNombre} / ${formTelefono} / ${formCorreo}`);

        // Ensure lead exists — try WA phone, form phone, email before creating
        let _fLead = await fsGetLeadByPhone(from).catch(() => null);
        if (!_fLead && formTelefono) _fLead = await fsGetLeadByPhone(formTelefono).catch(() => null);
        if (!_fLead && formCorreo)   _fLead = await fsGetLeadByEmail(formCorreo).catch(() => null);
        if (_fLead) {
          // Merge WA phone into existing lead so future lookups find it
          if (!_fLead.telefono || _fLead.telefono.replace(/\D/g,'').slice(-10) !== from.replace(/\D/g,'').slice(-10)) {
            await fsUpdateLeadFields(_fLead.id, { telefono: toE164(from) }).catch(() => {});
          }
        } else {
          await fsCreateLeadWA(`wa_meta:${from}`).catch(() => {});
          _fLead = await fsGetLeadByPhone(from).catch(() => null);
        }
        if (_fLead) {
          const updates = { fuente: 'Meta / Facebook' };
          if (formNombre && (!_fLead.nombre || _fLead.nombre.startsWith('WA ') || _fLead.nombre.startsWith('+') || _fLead.nombre.startsWith('Lead Meta'))) updates.nombre = formNombre;
          if (formCorreo && !_fLead.correo) updates.correo = formCorreo;
          if (formModal)  updates.modalidad = formModal;
          if (formTelefono && !_fLead.telefono) updates.telefono = toE164(formTelefono.replace(/\D/g,''));
          await fsUpdateLeadFields(_fLead.id, updates).catch(() => {});
          console.log(`[Meta WA] Formulario guardado en lead ${_fLead.id}:`, updates);
        }

        // Inject context so Ana knows the name and skips asking for it
        const convKey = `wa_meta:${from}`;
        const firstName = formNombre.split(' ')[0] || '';
        if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
        const hist = conversationHistory.get(convKey);
        const ctxMsg = `[SISTEMA]: El candidato acaba de llenar un formulario de Facebook. Ya tenemos sus datos: nombre: ${formNombre}${formCorreo ? ', correo: '+formCorreo : ''}${formModal ? ', modalidad: '+formModal : ''}. NO pidas estos datos de nuevo. Salúdalo por su nombre y continúa el proceso de reclutamiento.`;
        if (!hist.length || !hist[0].content?.startsWith('[SISTEMA]')) {
          hist.unshift({ role: 'assistant', content: 'Entendido, tengo los datos del formulario.', ts: Date.now() - 1000 });
          hist.unshift({ role: 'user', content: ctxMsg, ts: Date.now() - 2000 });
        }
        // Add the raw form message as a regular user message so extractAndUpdateLead can process it
        hist.push({ role: 'user', content: combinedText, ts: Date.now() - 500 });

        // Send personalized welcome using Ana
        const welcomeText = `¡Hola ${firstName}! 👋 Soy Ana de RRHH de Grupo Élite. Vi que completaste nuestro formulario — ¡me alegra que estés interesado/a! ¿Desde qué ciudad nos escribes?`;
        const { isEnabled: _autoEnabled } = require('./automations');
        if (await _autoEnabled('welcome_wa')) {
          await humanDelay(welcomeText);
          await sendWhatsApp(from, welcomeText);
        }
        _logWAMessage(from, 'out', welcomeText).catch(() => {});
        hist.push({ role: 'assistant', content: welcomeText, ts: Date.now() });

        // Run pipeline in background to update lead fields
        ;(async () => {
          try { await runWAPipeline(`wa_meta:${from}`, conversationHistory, sendWhatsApp, {}); } catch {}
        })();
        return;
      }

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
      if (_isManager) {
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
        // Click-to-WhatsApp dedup: look for a recent postulados-meta lead with no phone
        // (person filled Meta form → WA message arrives separately, form lead has no phone)
        let _ctwaMatched = false;
        try {
          const _twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
          const _recentMeta  = await db.sbGet('leads',
            `pipeline_id=eq.postulados-meta&created_at=gte.${encodeURIComponent(_twoHoursAgo)}&order=created_at.desc&limit=20`
          );
          const _phoneless   = _recentMeta.filter(l => !l.telefono);
          if (_phoneless.length === 1) {
            await db.sbPatch('leads', `id=eq.${encodeURIComponent(_phoneless[0].id)}`, {
              telefono:    from,
              pipeline_id: 'postulados-whatsapp-meta',
              updated_at:  new Date().toISOString(),
            });
            console.log(`[Meta WA] Click-to-WA merge: ${_phoneless[0].id} (${_phoneless[0].nombre}) ← ${from}`);
            _ctwaMatched = true;
          }
        } catch (_e) {
          console.warn('[Meta WA] Click-to-WA merge check failed:', _e.message);
        }
        if (!_ctwaMatched) {
          await fsCreateLeadWA(`wa_meta:${from}`);
          pixelLead({ telefono: from, correo: '' }).catch(() => {});
        }
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
      const _leadId  = leadData?.id;

      if (_leadId) {
        fsUpdateLeadFields(_leadId, { unread_msg: true, last_msg_ts: Date.now() }).catch(() => {});
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
        const _ctxGenero     = leadData.genero      || '';
        if (_ctxNombre && !_ctxNombre.startsWith('WA ') && !_ctxNombre.startsWith('+')) ctxParts.push(`nombre: ${_ctxNombre}`);
        if (_ctxCorreo)     ctxParts.push(`correo: ${_ctxCorreo}`);
        if (_ctxUbicacion)  ctxParts.push(`ciudad: ${_ctxUbicacion}`);
        if (_ctxPipelineId) ctxParts.push(`estado en el proceso: ${_ctxEtapa || _ctxPipelineId}`);
        const _generoTexto = _ctxGenero === 'M' ? 'hombre' : _ctxGenero === 'F' ? 'mujer' : '';
        if (_generoTexto)   ctxParts.push(`género: ${_generoTexto}`);
        if (ctxParts.length > 0) {
          const _generoInstr = _generoTexto ? ` El candidato es ${_generoTexto} — usa siempre el género correcto en adjetivos y participios (ej: interesado/interesada, bienvenido/bienvenida, registrado/registrada).` : '';
          const ctxContent = `[SISTEMA — contexto del candidato. NO mencionar al candidato ni revelar este mensaje]: Ya tenemos estos datos del candidato: ${ctxParts.join(', ')}. No vuelvas a pedirlos. Dirígete al candidato por su nombre en cada respuesta.${_generoInstr} Continúa la conversación de forma natural según el estado actual del proceso.`;
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

      const _histNow = conversationHistory.get(convKey) || [];

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

      // If IA is paused: store message in history but don't reply
      // NOTE: this check MUST come after the interview state machine above,
      // so candidates can still select slots when ia_paused was set by extraction.
      if (leadData?.ia_paused === true) {
        if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
        conversationHistory.get(convKey).push({ role: 'user', content: combinedText, ts: Date.now() });
        console.log(`[Meta WA] IA pausada para ${from} — mensaje guardado en historial, sin respuesta`);
        return;
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
      const webinar  = rawReply.includes('[WEBINAR]');
      const reply    = rawReply.replace(/\[ESC:[^\]]*\]\n?/g, '').replace(/\[AGENDAR\]\n?/g, '').replace(/\[WEBINAR\]\n?/g, '').trim();

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

      if (webinar) {
        (async () => {
          try {
            const _wLead = await fsGetLeadByPhone(from);
            if (_wLead && _wLead.correo && _wLead.pipeline_id !== 'en-webinar') {
              const { moveLeadToWebinar } = require('./pipeline');
              const _wNombre = (_wLead.nombre && !_wLead.nombre.startsWith('WA ') && !_wLead.nombre.startsWith('+'))
                ? _wLead.nombre : 'Candidato';
              await moveLeadToWebinar(_wLead.id, _wNombre, _wLead.correo, WEBINAR_URL);
              console.log(`[WEBINAR] Lead ${_wLead.id} movido a en-webinar por token de Ana`);
            } else if (_wLead && !_wLead.correo) {
              // correo not yet saved — flag intent so pipeline saves it when correo arrives
              await fsUpdateLeadFields(_wLead.id, { webinar_intent: true });
              console.log(`[WEBINAR] Token detectado pero sin correo — webinar_intent guardado para ${_wLead.id}`);
            }
          } catch (e) { console.error('[WEBINAR token] Error:', e.message); }
        })();
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
              const d   = new Date(isoStr);
              const tz  = candidateTZ || TEAM_TZ;
              const locH  = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(d));
              const lh12  = locH % 12 || 12;
              const lampm = locH >= 12 ? 'PM' : 'AM';
              return `${lh12}:00 ${lampm}`;
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
    } finally {
      _processingLocks.delete(from);
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

      // ── Route messages from secondary number to GEW-CRM (Supabase) ────────
      const _incomingPhoneId = value?.metadata?.phone_number_id;
      const _GEW_PHONE_ID    = '622460600941720';
      if (_incomingPhoneId && _incomingPhoneId === _GEW_PHONE_ID) {
        fetch('https://vpwbczzmonboirjckpmy.supabase.co/functions/v1/twilio-webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        }).catch(e => console.error('[Route GEW]', e.message));
        return;
      }

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
          sid:        m.id || `meta_${m.ts}`,
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
      // Block messages to contratado leads
      if (leadId) {
        const lead = await db.sbGetLead(leadId).catch(() => null);
        const etapa = (lead?.etapa || '').toUpperCase();
        const resultado = (lead?.resultado_entrevista || '').toLowerCase();
        if (etapa.includes('CONTRATADO') || resultado === 'contratado') {
          return res.status(403).json({ ok: false, error: 'Lead contratado: comunicación bloqueada.' });
        }
      }
      const cleanTo = to.replace(/^\+/, '').replace(/\D/g, '');
      const ts    = Date.now();
      const msgId = await _logWAMessage(cleanTo, 'out', body);
      await sendWhatsApp(cleanTo, body, { noLog: true });
      if (leadId) {
        fsUpdateLeadFields(leadId, { unread_msg: false, last_msg_ts: ts }).catch(() => {});
      }
      res.json({ ok: true, via: 'meta', to: cleanTo, ts, msgId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Send WhatsApp video ───────────────────────────────────────────────────
  app.post('/meta/wa-send-video', async (req, res) => {
    const { to, videoUrl, caption, leadId } = req.body;
    if (!to || !videoUrl) return res.status(400).json({ ok: false, error: 'to y videoUrl requeridos' });
    if (!_waToken || !META_WA_PHONE_ID) return res.status(503).json({ ok: false, error: 'Meta WA no configurado' });
    try {
      const cleanTo = to.replace(/^\+/, '').replace(/\D/g, '');
      const r = await fetch(`${GRAPH_URL}/${META_WA_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${_waToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanTo,
          type: 'video',
          video: { link: videoUrl, ...(caption ? { caption } : {}) },
        }),
      });
      const json = await r.json();
      if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
      const ts = Date.now();
      await _logWAMessage(cleanTo, 'out', `[VIDEO] ${videoUrl}${caption ? ' — ' + caption : ''}`);
      if (leadId) fsUpdateLeadFields(leadId, { unread_msg: false, last_msg_ts: ts }).catch(() => {});
      res.json({ ok: true, messageId: json.messages?.[0]?.id, ts });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Temp: create WA templates ────────────────────────────────────────────
  app.post('/admin/create-wa-templates', async (req, res) => {
    try {
      const wabaId = '1503820438112497';

      const templates = [
        {
          name: 'solicitud_recibida_horario_abierto',
          language: 'es',
          category: 'UTILITY',
          components: [{ type: 'BODY', text: 'Hola {{1}}, hemos recibido tu solicitud para Grupo Elite. Es un placer tenerte con nosotros, en breve te estaremos llamando para darte más información.' }],
        },
        {
          name: 'solicitud_recibida_horario_cerrado',
          language: 'es',
          category: 'UTILITY',
          components: [{ type: 'BODY', text: 'Hola {{1}}, hemos recibido tu solicitud para Grupo Elite. En este momento nuestras oficinas se encuentran cerradas, pero en cuanto abramos te contactaremos. ¡Gracias por tu interés!' }],
        },
      ];

      // Check existing templates status
      const existing = await fetch(`${GRAPH_URL}/${wabaId}/message_templates?fields=name,status,components&limit=20`, {
        headers: { 'Authorization': `Bearer ${_waToken}` },
      }).then(r => r.json());

      const results = [];
      for (const tpl of templates) {
        const r = await fetch(`${GRAPH_URL}/${wabaId}/message_templates`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${_waToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(tpl),
        }).then(r => r.json());
        results.push({ name: tpl.name, result: r });
      }
      res.json({ ok: true, wabaId, existing: existing.data, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Meta Lead Ads webhook ─────────────────────────────────────────────────
  app.get('/meta/webhook/leadgen', verifyWebhook);

  app.post('/meta/webhook/leadgen', async (req, res) => {
    res.sendStatus(200); // respond immediately to Meta

    console.log('[LeadGen] Webhook recibido — body:', JSON.stringify(req.body).slice(0, 400));

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

          // Detect source: Instagram if ad_name contains 'Insta' or 'IG'
          const isInstagram = /insta|_ig_/i.test(ad_name || '');
          const fuente = isInstagram ? 'Instagram' : 'Meta / Facebook';
          console.log(`[LeadGen] Nuevo lead: ${leadgen_id} form:${form_id} ad:"${ad_name}" fuente:${fuente}`);

          const now = new Date().toISOString();
          const uid = `meta_leadgen_${leadgen_id}`;

          // Dedup: skip if Make.com already created a lead for this leadgen_id
          const _makeId = `meta_make_${leadgen_id}`;
          const _makeExists = await db.sbGetLead(_makeId).catch(() => null);
          if (_makeExists) {
            console.log(`[LeadGen] Omitido — Make.com ya creó ${_makeId}`);
            continue;
          }

          // Fetch lead details from Graph API
          let nombre = '', correo = '', telefono = '', ubicacion = '';
          const token = META_PAGE_ACCESS_TOKEN;
          if (!token) {
            console.warn('[LeadGen] PAGE_ACCESS_TOKEN no configurado — guardando lead parcial');
          } else {
            const r    = await fetch(`${GRAPH_URL}/${leadgen_id}?fields=field_data,created_time&access_token=${token}`);
            const data = await r.json();
            if (data.error) {
              console.error('[LeadGen] Error Graph API:', JSON.stringify(data.error), '— guardando lead parcial');
            } else {
              const flds = {};
              for (const f of (data.field_data || [])) flds[f.name] = (f.values || [])[0] || '';
              nombre    = flds['full_name']   || flds['name']     || '';
              correo    = flds['email']        || flds['correo']   || '';
              telefono  = flds['phone_number'] || flds['telefono'] || flds['phone'] || '';
              ubicacion = flds['city']         || flds['ubicacion']|| flds['state'] || '';
            }
          }

          const lead = {
            id:           uid,
            nombre:       nombre || `Lead ${fuente} ${leadgen_id.slice(-6)}`,
            correo:       correo,
            telefono:     telefono,
            ubicacion:    ubicacion,
            fuente:       fuente,
            pipeline_id:  'postulados-meta',
            etapa:        'New Lead',
            estado:       'abierto',
            ad_nombre:    ad_name  || '',
            ad_clid:      ad_id    || '',
            meta_form_id: form_id  || '',
            created_at:   now,
            updated_at:   now,
          };

          // Dedup by phone: update existing lead instead of skipping
          if (telefono) {
            const _phoneExists = await db.sbGetLeadByPhone(telefono).catch(() => null);
            if (_phoneExists) {
              console.log(`[LeadGen] Teléfono ya existe (${telefono}) — actualizando lead ${_phoneExists.id}`);
              await db.sbUpdateLead(_phoneExists.id, {
                correo:       correo   || _phoneExists.correo,
                ubicacion:    ubicacion || _phoneExists.ubicacion,
                fuente:       fuente,
                ad_nombre:    ad_name  || _phoneExists.ad_nombre,
                meta_form_id: form_id  || _phoneExists.meta_form_id,
              }).catch(e => console.warn('[LeadGen] No se pudo actualizar lead existente:', e.message));
              _logWebhookEvent('leadgen', telefono || correo, `UPDATE ${nombre} — ${ad_name || 'sin anuncio'}`, JSON.stringify(change.value)).catch(() => {});
              continue;
            }
          }

          await db.sbSaveLead(lead);
          console.log(`[LeadGen] Lead guardado: ${nombre} (${correo}) (${telefono}) [${fuente}]`);
          _logWebhookEvent('leadgen', telefono || correo, `${nombre} — ${ad_name || 'sin anuncio'}`, JSON.stringify(change.value)).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[LeadGen] Error procesando webhook:', e.message, e.stack);
    }
  });

  // ── Make.com lead intake ──────────────────────────────────────────────────
  app.post('/meta/make-lead', async (req, res) => {
    try {
      const body = req.body || {};
      console.log('[Make Lead] Body recibido:', JSON.stringify(body).slice(0, 500));
      // Support both root-level keys and Make.com's nested fieldData format
      const fd = body.fieldData || {};
      const nombre    = body.full_name     || fd.fullName     || fd.full_name     || body.nombre || body.name || '';
      const correo    = body.email         || fd.email        || body.correo      || '';
      const telefono  = body.phone_number  || fd.phoneNumber  || fd.phone_number  || body.phone  || body.telefono || '';
      const ubicacion = body.city          || fd.city         || body.ubicacion   || body.state  || fd.state  || '';
      const leadgenId = body.id            || body.leadgen_id || body.leadId      || '';
      const now       = new Date().toISOString();
      const uid       = `meta_make_${leadgenId || Date.now()}`;

      // Build rich notas as array of note objects (CRM format)
      const modalidad = fd['buscas_trabajo_presencial_o_remoto?'] || body['buscas_trabajo_presencial_o_remoto?'] || fd.modalidad || body.modalidad || '';
      const campaignName = body.campaign_name || body.campaignName || '';
      const adsetName    = body.adset_name    || body.adsetName    || '';
      const adName       = body.ad_name       || body.adName       || '';
      const formName     = body.form_name     || body.formName     || '';
      const pageName     = body.page_name     || body.pageName     || '';
      const platform     = body.platform      || '';
      const adId         = body.ad_id         || body.adId         || '';
      const formId       = body.form_id       || body.formId       || '';

      const metaText = [
        modalidad    ? `💼 Modalidad: ${modalidad}`       : '',
        campaignName ? `📢 Campaña: ${campaignName}`      : '',
        adsetName    ? `🎯 Conjunto: ${adsetName}`        : '',
        adName       ? `📌 Anuncio: ${adName}`            : '',
        formName     ? `📋 Formulario: ${formName}`       : '',
        pageName     ? `📄 Página: ${pageName}`           : '',
        platform     ? `📱 Plataforma: ${platform}`       : '',
        adId         ? `🆔 Ad ID: ${adId}`                : '',
        formId       ? `🆔 Form ID: ${formId}`            : '',
        leadgenId    ? `🆔 Lead ID: ${leadgenId}`         : '',
      ].filter(Boolean).join('\n');

      const notasArr = metaText ? [{ texto: metaText, fecha: now, autor: 'Meta / Make.com' }] : [];

      // Tags for quick filtering
      const etiquetas = ['Meta Lead Ads'];
      if (body.campaign_name) etiquetas.push(body.campaign_name);
      if (body.platform)      etiquetas.push(body.platform);

      const lead = {
        id:          uid,
        nombre:      nombre || `Lead Meta ${uid.slice(-6)}`,
        correo,
        telefono,
        ubicacion,
        fuente:      'Meta / Facebook',
        notas:       notasArr,
        etiquetas:   etiquetas,
        pipeline_id: 'postulados-meta',
        etapa:       'New Lead',
        estado:      'abierto',
        created_at:  now,
        updated_at:  now,
      };

      // Dedup: skip if lead with same phone already exists
      if (telefono) {
        const existing = await db.sbGetLeadByPhone(telefono);
        if (existing) {
          console.log(`[Make Lead] Duplicado omitido — teléfono ya existe: ${telefono} (${existing.nombre})`);
          return res.json({ ok: true, id: existing.id, duplicate: true });
        }
      }

      await db.sbSaveLead(lead);

      // Fire Conversions API Lead event
      fireCapiLead({ email: correo, telefono, nombre, eventId: uid }).catch(() => {});

      // Welcome WhatsApp — use same hours config as Ana
      if (telefono) {
        const inOffice  = await isWABusinessHours();
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

  // ── Marketing Stats API ──────────────────────────────────────────────────────
  app.get('/api/stats', async (req, res) => {
    const token = req.query.token || req.headers['x-stats-token'];
    if (token !== (process.env.STATS_TOKEN || 'gew_stats_2026')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const leads = await db.sbGet('leads', 'select=id,pipeline_id,etapa,fuente,etiquetas,notas,created_at,webinar_email_enviado,fecha_inscripcion_webinar,vio_webinar&limit=2000&order=created_at.desc');

      const parseMeta = (notas) => {
        const result = { campaign: '', adset: '', ad: '', form: '', platform: '', formId: '' };
        if (!Array.isArray(notas)) return result;
        const txt = (notas[0]?.texto || '');
        const get = (prefix) => {
          const m = txt.match(new RegExp(prefix + ':?\\s*([^\\n]+)'));
          return m ? m[1].trim() : '';
        };
        result.campaign = get('📢 Campaña') || get('Campaña');
        result.adset    = get('🎯 Conjunto') || get('Conjunto');
        result.ad       = get('📌 Anuncio') || get('Anuncio');
        result.form     = get('📋 Formulario') || get('Formulario');
        result.platform = get('📱 Plataforma') || get('Plataforma');
        result.formId   = get('🆔 Form ID') || get('Form ID');
        return result;
      };

      const PIPELINE_ORDER = [
        'postulados-meta', 'postulados-whatsapp-meta',
        'en-webinar', 'entrevistas-generales', 'vendidos',
        'no-interesados', 'no-interesados-no-califica'
      ];
      const PIPELINE_LABEL = {
        'postulados-meta':              'Nuevo Lead',
        'postulados-whatsapp-meta':     'Nuevo Lead (WA)',
        'en-webinar':                   'En Webinar',
        'entrevistas-generales':        'En Entrevista',
        'vendidos':                     'Vendido',
        'no-interesados':               'No Interesado',
        'no-interesados-no-califica':   'No Califica',
      };
      const PIPELINE_RANK = {};
      PIPELINE_ORDER.forEach((p, i) => PIPELINE_RANK[p] = i);

      // Group by campaign
      const campaignMap = {};
      const adMap    = {};
      const formMap  = {};
      const dailyMap = {};

      for (const l of leads) {
        const meta = parseMeta(l.notas);
        // Fallback: use etiquetas for campaign name
        const campaign = meta.campaign ||
          (Array.isArray(l.etiquetas) ? l.etiquetas.find(e => e !== 'Meta Lead Ads') || '' : '');
        const ad       = meta.ad   || l.ad_nombre || '';
        const form     = meta.form || '';
        const pid      = l.pipeline_id || 'unknown';
        const day      = (l.created_at || '').slice(0, 10);

        // Campaign stats
        if (campaign) {
          if (!campaignMap[campaign]) campaignMap[campaign] = { total: 0, pipeline: {}, webinar: 0, entrevista: 0, ads: new Set(), forms: new Set() };
          campaignMap[campaign].total++;
          campaignMap[campaign].pipeline[pid] = (campaignMap[campaign].pipeline[pid] || 0) + 1;
          if (l.fecha_inscripcion_webinar) campaignMap[campaign].webinar++;
          if (pid === 'entrevistas-generales' || pid === 'vendidos') campaignMap[campaign].entrevista++;
          if (ad)   campaignMap[campaign].ads.add(ad);
          if (form) campaignMap[campaign].forms.add(form);
        }

        // Ad stats
        if (ad) {
          if (!adMap[ad]) adMap[ad] = { total: 0, webinar: 0, entrevista: 0, campaign };
          adMap[ad].total++;
          if (l.fecha_inscripcion_webinar) adMap[ad].webinar++;
          if (pid === 'entrevistas-generales' || pid === 'vendidos') adMap[ad].entrevista++;
        }

        // Form stats
        if (form) {
          if (!formMap[form]) formMap[form] = { total: 0, webinar: 0, entrevista: 0, formId: meta.formId };
          formMap[form].total++;
          if (l.fecha_inscripcion_webinar) formMap[form].webinar++;
          if (pid === 'entrevistas-generales' || pid === 'vendidos') formMap[form].entrevista++;
        }

        // Daily
        if (day) {
          if (!dailyMap[day]) dailyMap[day] = 0;
          dailyMap[day]++;
        }
      }

      // Convert Sets to counts
      for (const k of Object.keys(campaignMap)) {
        campaignMap[k].numAds   = campaignMap[k].ads.size;
        campaignMap[k].numForms = campaignMap[k].forms.size;
        delete campaignMap[k].ads;
        delete campaignMap[k].forms;
      }

      // Pipeline overall
      const pipelineOverall = {};
      for (const l of leads) {
        const pid = l.pipeline_id || 'unknown';
        pipelineOverall[pid] = (pipelineOverall[pid] || 0) + 1;
      }

      // Fuente
      const fuenteMap = {};
      for (const l of leads) {
        const f = l.fuente || 'Desconocido';
        fuenteMap[f] = (fuenteMap[f] || 0) + 1;
      }

      // Daily sorted
      const daily = Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      res.json({
        ok: true,
        totals: {
          leads: leads.length,
          webinar: leads.filter(l => l.fecha_inscripcion_webinar).length,
          entrevista: leads.filter(l => ['entrevistas-generales','vendidos'].includes(l.pipeline_id)).length,
        },
        fuente: fuenteMap,
        pipeline: pipelineOverall,
        pipelineLabels: PIPELINE_LABEL,
        campaigns: campaignMap,
        ads: adMap,
        forms: formMap,
        daily,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[Meta] Rutas registradas: /meta/webhook (GET), /meta/webhook/whatsapp, /meta/webhook/ig-messenger, /meta/webhook/leadgen, /meta/data-deletion');
}

module.exports = { registerMetaRoutes, sendWhatsApp, sendInstagram, sendMessenger };
