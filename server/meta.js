const crypto = require('crypto');
const { askClaude, conversationHistory } = require('./ai');

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
      const reply = await askClaude(`wa_meta:${from}`, text, 'wa');
      console.log(`[Meta WA] → ${from}: ${reply}`);
      await sendWhatsApp(from, reply);
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
