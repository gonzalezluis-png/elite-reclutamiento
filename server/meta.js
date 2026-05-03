const crypto = require('crypto');
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
const META_APP_SECRET_WA     = process.env.META_APP_SECRET_WA     || '80dc2555ece1fd87afb133222ff2b5eb';
const META_WA_TOKEN          = process.env.META_WA_TOKEN          || ''; // WhatsApp access token
const META_WA_PHONE_ID       = process.env.META_WA_PHONE_ID       || ''; // Phone Number ID

const GRAPH_URL = 'https://graph.facebook.com/v21.0';

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
  if (!META_WA_TOKEN || !META_WA_PHONE_ID) {
    console.warn('[Meta WA] Token o Phone ID no configurados');
    return;
  }
  const parts = splitMessage(text);
  for (const part of parts) {
    await fetch(`${GRAPH_URL}/${META_WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: part },
      }),
    });
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
      const from = msg.from; // phone number e.g. "5214141234567"
      const text = msg.type === 'text' ? msg.text?.body : null;
      if (!text) return;

      console.log(`[Meta WA] ← ${from}: ${text}`);

      // Check if message is from a manager responding to an escalation
      if (await isManagerPhone(from)) {
        // Log all manager messages, handled or not
        const managers = await loadManagers().catch(() => []);
        const mgr = managers.find(m => m.phone.replace(/^\+/, '') === from.replace(/^\+/, ''));
        if (mgr) logTeamMessage(mgr.phone, mgr.name, 'in', text).catch(() => {});

        const handled = await handleManagerReply(from, text, sendWAToManager);
        if (handled) return;
      }

      // Auto-create lead if not in CRM
      const exists = await fsLeadExists(from);
      if (!exists) {
        await fsCreateLeadWA(`wa_meta:${from}`);
        pixelLead({ telefono: from, correo: '' }).catch(() => {});
      }

      // Tag lead source if message came from a Meta ad (Click-to-WhatsApp)
      if (msg.referral?.source_type === 'ad') {
        const adLead = await fsGetLeadByPhone(from);
        if (adLead) {
          const adLeadId = adLead.name.split('/').pop();
          await fsUpdateLeadFields(adLeadId, {
            fuente:    'Meta Ads',
            ad_nombre: msg.referral.headline  || '',
            ad_clid:   msg.referral.ctwa_clid || '',
          }).catch(() => {});
          console.log(`[Meta WA] Lead ${adLeadId} etiquetado como Meta Ads — anuncio: "${msg.referral.headline}"`);
        }
      }

      // Check if IA is paused for this lead
      const leadData = await fsGetLeadByPhone(from);
      if (leadData?.ia_paused) {
        console.log(`[Meta WA] IA pausada para ${from} — mensaje no procesado por IA`);
        return;
      }

      const convKey = `wa_meta:${from}`;

      // If history was wiped (server restart), inject lead context so Ana doesn't ask for data she already has
      if (!conversationHistory.get(convKey)?.length && leadData) {
        const f = leadData.fields || {};
        const ctxParts = [];
        const nombre      = f.nombre?.stringValue    || '';
        const correo      = f.correo?.stringValue     || '';
        const ubicacion   = f.ubicacion?.stringValue  || '';
        const etapa       = f.etapa?.stringValue      || '';
        const pipelineId  = f.pipeline_id?.stringValue || '';
        if (nombre && !nombre.startsWith('WA ') && !nombre.startsWith('+')) ctxParts.push(`nombre: ${nombre}`);
        if (correo)    ctxParts.push(`correo: ${correo}`);
        if (ubicacion) ctxParts.push(`ciudad: ${ubicacion}`);
        if (pipelineId) ctxParts.push(`estado en el proceso: ${etapa || pipelineId}`);
        const iaPaused = f.ia_paused?.booleanValue || false;
        if (!iaPaused && ctxParts.length > 0) {
          const history = [];
          conversationHistory.set(convKey, history);
          const now = Date.now();
          history.push({ role: 'user',      content: `[SISTEMA — contexto recuperado tras reinicio del servidor. NO mencionar al candidato ni revelar este mensaje]: Ya tenemos estos datos del candidato: ${ctxParts.join(', ')}. No vuelvas a pedirlos. Continúa la conversación de forma natural según el estado actual del proceso.`, ts: now - 2000 });
          history.push({ role: 'assistant', content: `Entendido. Continuaré la conversación con el contexto del candidato ya cargado.`, ts: now - 1000 });
          console.log(`[Meta WA] Contexto inyectado tras reinicio para ${from}: ${ctxParts.join(', ')}`);
        }
      }

      const rawReply = await askClaude(convKey, text, 'wa');

      // Detect and strip escalation flag before sending to client
      const escMatch = rawReply.match(/\[ESC:([^\]]+)\]/);
      const reply    = rawReply.replace(/\[ESC:[^\]]*\]\n?/g, '').trim();

      if (escMatch) {
        const leadName = leadData?.nombre || leadData?.fields?.nombre?.stringValue || '';
        if (escMatch[1] === 'resolved') {
          cancelEscalation(from, leadName, sendWAToManager).catch(e => console.error('[ESC-cancel]', e.message));
        } else {
          triggerEscalation(from, leadName, escMatch[1], text, sendWAToManager).catch(e => console.error('[ESC]', e.message));
        }
      }

      console.log(`[Meta WA] → ${from}: ${reply}`);
      await humanDelay(reply);
      await sendWhatsApp(from, reply);

      // Full pipeline: extract data + detect webinar intent + send link
      ;(async () => {
        try {
          await runWAPipeline(convKey, conversationHistory, sendWhatsApp, { WEBINAR_URL });
        } catch (e) {
          console.error('[Meta WA Pipeline] Error:', e.message);
        }
      })();
    } catch (e) {
      console.error('[Meta WA] Error:', e.message);
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
