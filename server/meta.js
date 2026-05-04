const crypto = require('crypto');
const { handleAuthWAReply } = require('./auth-sessions');
const { askClaude, conversationHistory } = require('./ai');
const { fsLeadExists, fsCreateLeadWA, fsGetLeadByPhone, fsUpdateLeadFields, runWAPipeline, humanDelay } = require('./pipeline');
const { triggerEscalation, cancelEscalation, handleManagerReply, checkTimeouts, isManagerPhone, logTeamMessage, loadManagers } = require('./escalation');
const { pixelLead } = require('./pixel');

const SERVER_URL  = process.env.SERVER_URL  || 'https://elite-reclutamiento-production.up.railway.app';
const WEBINAR_URL = process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';

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
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ── Send WhatsApp message via Meta Cloud API ──────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!_waToken || !META_WA_PHONE_ID) {
    console.warn('[Meta WA] Token o Phone ID no configurados');
    return;
  }
  const parts = splitMessage(text);
  for (const part of parts) {
    const r = await fetch(`${GRAPH_URL}/${META_WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_waToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: part },
      }),
    });
    const json = await r.json();
    if (json.error) {
      console.error(`[Meta WA] Error enviando a ${to}:`, JSON.stringify(json.error));
      if (json.error.code === 190) {
        console.log('[Meta WA] Token expirado — renovando…');
        await _refreshToken();
      }
    }
  }
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

  async function _processBufferedMessages(from, referralInfo) {
    const texts = _msgBuffer.get(from) || [];
    _msgBuffer.delete(from);
    _msgTimers.delete(from);
    if (!texts.length) return;

    const combinedText = texts.join('\n');
    console.log(`[Meta WA] ← ${from} (${texts.length} msg): ${combinedText}`);

    try {
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
      if (!exists) {
        await fsCreateLeadWA(`wa_meta:${from}`);
        pixelLead({ telefono: from, correo: '' }).catch(() => {});
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

      // If IA is paused: store message in history (for context on resume) but don't reply
      if (leadData?.fields?.ia_paused?.booleanValue === true) {
        if (!conversationHistory.has(convKey)) conversationHistory.set(convKey, []);
        conversationHistory.get(convKey).push({ role: 'user', content: combinedText, ts: Date.now() });
        console.log(`[Meta WA] IA pausada para ${from} — mensaje guardado en historial, sin respuesta`);
        return;
      }

      // Inject context after server restart (only if history is empty)
      if (!conversationHistory.get(convKey)?.length && leadData) {
        const f = leadData.fields || {};
        const ctxParts = [];
        const nombre     = f.nombre?.stringValue    || '';
        const correo     = f.correo?.stringValue     || '';
        const ubicacion  = f.ubicacion?.stringValue  || '';
        const etapa      = f.etapa?.stringValue      || '';
        const pipelineId = f.pipeline_id?.stringValue || '';
        if (nombre && !nombre.startsWith('WA ') && !nombre.startsWith('+')) ctxParts.push(`nombre: ${nombre}`);
        if (correo)    ctxParts.push(`correo: ${correo}`);
        if (ubicacion) ctxParts.push(`ciudad: ${ubicacion}`);
        if (pipelineId) ctxParts.push(`estado en el proceso: ${etapa || pipelineId}`);
        if (ctxParts.length > 0) {
          const history = [];
          conversationHistory.set(convKey, history);
          const now = Date.now();
          history.push({ role: 'user',      content: `[SISTEMA — contexto recuperado tras reinicio del servidor. NO mencionar al candidato ni revelar este mensaje]: Ya tenemos estos datos del candidato: ${ctxParts.join(', ')}. No vuelvas a pedirlos. Continúa la conversación de forma natural según el estado actual del proceso.`, ts: now - 2000 });
          history.push({ role: 'assistant', content: `Entendido. Continuaré la conversación con el contexto del candidato ya cargado.`, ts: now - 1000 });
          console.log(`[Meta WA] Contexto inyectado tras reinicio para ${from}`);
        }
      }

      const rawReply = await askClaude(convKey, combinedText, 'wa');
      const escMatch = rawReply.match(/\[ESC:([^\]]+)\]/);
      const reply    = rawReply.replace(/\[ESC:[^\]]*\]\n?/g, '').trim();

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
  app.post('/meta/webhook/whatsapp', async (req, res) => {
    res.sendStatus(200); // respond immediately to Meta

    if (!verifySignature(req, META_APP_SECRET_WA)) {
      console.warn('[Meta WA] Firma inválida');
      return;
    }

    try {
      const entry   = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;
      if (!value?.messages?.length) return;

      const msg  = value.messages[0];
      const from = msg.from;
      const text = msg.type === 'text' ? msg.text?.body : null;
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
      if (handleAuthWAReply(from, text)) return;

      // Buffer message and (re)start debounce timer
      if (!_msgBuffer.has(from)) _msgBuffer.set(from, []);
      _msgBuffer.get(from).push(text);

      if (_msgTimers.has(from)) clearTimeout(_msgTimers.get(from));
      const referralInfo = msg.referral || null;
      _msgTimers.set(from, setTimeout(() => _processBufferedMessages(from, referralInfo), _DEBOUNCE_MS));

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

  console.log('[Meta] Rutas registradas: /meta/webhook (GET), /meta/webhook/whatsapp, /meta/webhook/ig-messenger, /meta/data-deletion');
}

module.exports = { registerMetaRoutes, sendWhatsApp, sendInstagram, sendMessenger };
