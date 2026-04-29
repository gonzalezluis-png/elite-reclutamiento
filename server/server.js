// PLAYWRIGHT_BROWSERS_PATH se setea vía env var en render.yaml

const express    = require('express');
const cors       = require('cors');
const { chromium } = require('playwright');
const twilio     = require('twilio');
const nodemailer = require('nodemailer');
const { askClaude, textToSpeech, loadConfig, saveConfig, DEFAULT_CONFIG, conversationHistory, aiEnabled } = require('./ai');

const WEBINAR_URL  = process.env.WEBINAR_URL || 'https://quintero-partners.webinargeek.com/oportunidad-laboral-webinar-on-demand-q-p';
const SMTP_USER    = process.env.SMTP_USER;
const SMTP_PASS    = process.env.SMTP_PASS;
const SMTP_HOST    = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '465');

// Track phones that already received webinar invite (resets on restart)
const webinarInviteSent = new Set();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Twilio config (set these env vars in Render) ──────────────────────────────
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_API_KEY       = process.env.TWILIO_API_KEY;       // Twilio Console → API Keys
const TWILIO_API_SECRET    = process.env.TWILIO_API_SECRET;
const TWILIO_PHONE_NUMBER  = process.env.TWILIO_PHONE_NUMBER;  // e.g. +12015551234
const TWILIO_APP_SID       = process.env.TWILIO_APP_SID;       // TwiML App SID
const TWILIO_WA_FROM       = process.env.TWILIO_WA_FROM || 'whatsapp:+14155238886'; // Sandbox default → swap for approved number

// ── Twilio: Access Token (browser can make calls) ─────────────────────────────
app.get('/twilio/token', (req, res) => {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_APP_SID) {
    return res.status(500).json({ error: 'Twilio no configurado — faltan variables de entorno' });
  }
  try {
    const { AccessToken } = twilio.jwt;
    const { VoiceGrant } = AccessToken;
    const rawId = req.query.identity || 'agent';
    const identity = rawId.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 121) || 'agent';
    const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, {
      identity,
      ttl: 3600,
    });
    token.addGrant(new VoiceGrant({ outgoingApplicationSid: TWILIO_APP_SID, incomingAllow: false }));
    res.json({ token: token.toJwt() });
  } catch (e) {
    console.error('Token error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Caller ID routing ─────────────────────────────────────────────────────────
// 4 numbers available:
//   Dallas   +18176352794  → Texas, Midwest, Central US, Great Plains
//   Austin   +17377779159  → South Texas, Oklahoma, Arkansas, Louisiana
//   El Paso  +19152217062  → West Coast, Southwest, Mountain, Pacific
//   Miami    +17864605438  → Southeast, East Coast, Northeast, Caribbean
const DAL = '+18176352794';
const AUS = '+17377779159';
const ELP = '+19152217062';
const MIA = '+17864605438';

const CALLER_NUMBERS = {
  // ── TEXAS ──────────────────────────────────────────────────────────────────
  // Dallas / Fort Worth Metroplex
  '214':DAL,'469':DAL,'682':DAL,'817':DAL,'945':DAL,'972':DAL,
  // Houston
  '281':DAL,'346':DAL,'713':DAL,'832':DAL,
  // Austin
  '512':AUS,'737':AUS,
  // San Antonio
  '210':AUS,'726':AUS,
  // El Paso
  '915':ELP,
  // Rest of Texas
  '325':AUS,'361':AUS,'409':DAL,'430':DAL,'432':ELP,
  '806':DAL,'830':AUS,'903':DAL,'936':DAL,'940':DAL,'956':AUS,

  // ── OKLAHOMA ───────────────────────────────────────────────────────────────
  '405':AUS,'539':AUS,'580':AUS,'918':AUS,

  // ── ARKANSAS ───────────────────────────────────────────────────────────────
  '479':AUS,'501':AUS,'870':AUS,

  // ── LOUISIANA ──────────────────────────────────────────────────────────────
  '225':AUS,'318':AUS,'337':AUS,'504':AUS,'985':AUS,

  // ── MISSISSIPPI ────────────────────────────────────────────────────────────
  '228':MIA,'601':MIA,'662':MIA,'769':MIA,

  // ── ALABAMA ────────────────────────────────────────────────────────────────
  '205':MIA,'251':MIA,'256':MIA,'334':MIA,'659':MIA,'938':MIA,

  // ── TENNESSEE ──────────────────────────────────────────────────────────────
  '423':MIA,'615':MIA,'629':MIA,'731':MIA,'865':MIA,'901':MIA,'931':MIA,

  // ── KENTUCKY ───────────────────────────────────────────────────────────────
  '270':MIA,'364':MIA,'502':MIA,'606':MIA,'859':MIA,

  // ── GEORGIA ────────────────────────────────────────────────────────────────
  '229':MIA,'404':MIA,'470':MIA,'478':MIA,'678':MIA,'706':MIA,'762':MIA,'770':MIA,'912':MIA,

  // ── FLORIDA ────────────────────────────────────────────────────────────────
  '239':MIA,'305':MIA,'321':MIA,'352':MIA,'386':MIA,'407':MIA,'561':MIA,
  '727':MIA,'754':MIA,'772':MIA,'786':MIA,'813':MIA,'850':MIA,'863':MIA,
  '904':MIA,'941':MIA,'954':MIA,

  // ── SOUTH CAROLINA ─────────────────────────────────────────────────────────
  '803':MIA,'839':MIA,'843':MIA,'854':MIA,'864':MIA,

  // ── NORTH CAROLINA ─────────────────────────────────────────────────────────
  '252':MIA,'336':MIA,'704':MIA,'743':MIA,'828':MIA,'910':MIA,'919':MIA,'980':MIA,'984':MIA,

  // ── VIRGINIA ───────────────────────────────────────────────────────────────
  '276':MIA,'434':MIA,'540':MIA,'571':MIA,'703':MIA,'757':MIA,'804':MIA,

  // ── WEST VIRGINIA ──────────────────────────────────────────────────────────
  '304':MIA,'681':MIA,

  // ── MARYLAND / DC / DELAWARE ───────────────────────────────────────────────
  '202':MIA,'240':MIA,'301':MIA,'302':MIA,'410':MIA,'443':MIA,'667':MIA,

  // ── NEW YORK ───────────────────────────────────────────────────────────────
  '212':MIA,'315':MIA,'332':MIA,'347':MIA,'516':MIA,'518':MIA,'585':MIA,
  '607':MIA,'631':MIA,'646':MIA,'680':MIA,'716':MIA,'718':MIA,'838':MIA,
  '845':MIA,'914':MIA,'917':MIA,'929':MIA,'934':MIA,

  // ── NEW JERSEY ─────────────────────────────────────────────────────────────
  '201':MIA,'551':MIA,'609':MIA,'640':MIA,'732':MIA,'848':MIA,'856':MIA,'862':MIA,'908':MIA,'973':MIA,

  // ── PENNSYLVANIA ───────────────────────────────────────────────────────────
  '215':MIA,'223':MIA,'267':MIA,'272':MIA,'412':MIA,'445':MIA,'484':MIA,
  '570':MIA,'582':MIA,'610':MIA,'717':MIA,'724':MIA,'814':MIA,'835':MIA,'878':MIA,

  // ── CONNECTICUT ────────────────────────────────────────────────────────────
  '203':MIA,'475':MIA,'860':MIA,'959':MIA,

  // ── MASSACHUSETTS ──────────────────────────────────────────────────────────
  '339':MIA,'351':MIA,'413':MIA,'508':MIA,'617':MIA,'774':MIA,'781':MIA,'857':MIA,'978':MIA,

  // ── RHODE ISLAND ───────────────────────────────────────────────────────────
  '401':MIA,

  // ── NEW HAMPSHIRE / VERMONT / MAINE ────────────────────────────────────────
  '207':MIA,'603':MIA,'802':MIA,

  // ── OHIO ───────────────────────────────────────────────────────────────────
  '216':DAL,'220':DAL,'234':DAL,'330':DAL,'380':DAL,'419':DAL,'440':DAL,
  '513':DAL,'567':DAL,'614':DAL,'740':DAL,'937':DAL,

  // ── MICHIGAN ───────────────────────────────────────────────────────────────
  '231':DAL,'248':DAL,'269':DAL,'313':DAL,'517':DAL,'586':DAL,'616':DAL,
  '679':DAL,'734':DAL,'810':DAL,'906':DAL,'947':DAL,'989':DAL,

  // ── INDIANA ────────────────────────────────────────────────────────────────
  '219':DAL,'260':DAL,'317':DAL,'463':DAL,'574':DAL,'765':DAL,'812':DAL,'930':DAL,

  // ── ILLINOIS ───────────────────────────────────────────────────────────────
  '217':DAL,'224':DAL,'309':DAL,'312':DAL,'331':DAL,'447':DAL,'464':DAL,
  '618':DAL,'630':DAL,'708':DAL,'773':DAL,'779':DAL,'815':DAL,'847':DAL,'872':DAL,

  // ── WISCONSIN ──────────────────────────────────────────────────────────────
  '262':DAL,'414':DAL,'534':DAL,'608':DAL,'715':DAL,'920':DAL,

  // ── MINNESOTA ──────────────────────────────────────────────────────────────
  '218':DAL,'320':DAL,'507':DAL,'612':DAL,'651':DAL,'763':DAL,'952':DAL,

  // ── IOWA ───────────────────────────────────────────────────────────────────
  '319':DAL,'515':DAL,'563':DAL,'641':DAL,'712':DAL,

  // ── MISSOURI ───────────────────────────────────────────────────────────────
  '314':DAL,'417':DAL,'557':DAL,'573':DAL,'636':DAL,'660':DAL,'816':DAL,

  // ── KANSAS ─────────────────────────────────────────────────────────────────
  '316':DAL,'620':DAL,'785':DAL,'913':DAL,

  // ── NEBRASKA ───────────────────────────────────────────────────────────────
  '308':DAL,'402':DAL,'531':DAL,

  // ── SOUTH DAKOTA / NORTH DAKOTA ────────────────────────────────────────────
  '605':DAL,'701':DAL,

  // ── COLORADO ───────────────────────────────────────────────────────────────
  '303':ELP,'719':ELP,'720':ELP,'970':ELP,

  // ── NEW MEXICO ─────────────────────────────────────────────────────────────
  '505':ELP,'575':ELP,

  // ── ARIZONA ────────────────────────────────────────────────────────────────
  '480':ELP,'520':ELP,'602':ELP,'623':ELP,'928':ELP,

  // ── NEVADA ─────────────────────────────────────────────────────────────────
  '702':ELP,'725':ELP,'775':ELP,

  // ── UTAH ───────────────────────────────────────────────────────────────────
  '385':ELP,'435':ELP,'801':ELP,

  // ── IDAHO ──────────────────────────────────────────────────────────────────
  '208':ELP,'986':ELP,

  // ── MONTANA / WYOMING ──────────────────────────────────────────────────────
  '406':ELP,'307':ELP,

  // ── CALIFORNIA ─────────────────────────────────────────────────────────────
  '209':ELP,'213':ELP,'310':ELP,'323':ELP,'408':ELP,'415':ELP,'424':ELP,
  '442':ELP,'510':ELP,'530':ELP,'559':ELP,'562':ELP,'619':ELP,'626':ELP,
  '628':ELP,'650':ELP,'657':ELP,'661':ELP,'669':ELP,'707':ELP,'714':ELP,
  '747':ELP,'760':ELP,'764':ELP,'805':ELP,'818':ELP,'820':ELP,'831':ELP,
  '858':ELP,'909':ELP,'916':ELP,'925':ELP,'935':ELP,'949':ELP,'951':ELP,

  // ── OREGON ─────────────────────────────────────────────────────────────────
  '458':ELP,'503':ELP,'541':ELP,'971':ELP,

  // ── WASHINGTON STATE ───────────────────────────────────────────────────────
  '206':ELP,'253':ELP,'360':ELP,'425':ELP,'509':ELP,'564':ELP,

  // ── ALASKA / HAWAII ────────────────────────────────────────────────────────
  '907':ELP,'808':ELP,

  // ── PUERTO RICO / USVI ─────────────────────────────────────────────────────
  '787':MIA,'939':MIA,'340':MIA,
};
const DEFAULT_CALLER = DAL; // Dallas como default

function pickCallerId(toNumber) {
  const digits = (toNumber || '').replace(/\D/g, '');
  // E.164 US: +1AAANNNNNNN → area code starts at index 1 (after country code 1)
  const areaCode = digits.length === 11 && digits[0] === '1'
    ? digits.slice(1, 4)
    : digits.slice(0, 3);
  return CALLER_NUMBERS[areaCode] || DEFAULT_CALLER;
}

// Normalize any phone to E.164 (assumes US +1 for 10-digit numbers)
function toE164(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return digits ? `+${digits}` : raw;
}

// ── Twilio: TwiML — called by Twilio when agent dials ─────────────────────────
// TTS audio cache (id → Buffer, auto-expires in 3 min)
const _ttsCache = new Map();
async function _genTTS(text) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const buf = await textToSpeech(text);
  _ttsCache.set(id, buf);
  setTimeout(() => _ttsCache.delete(id), 180000);
  return id;
}
const SERVER_URL = process.env.SERVER_URL || 'https://elite-reclutamiento.onrender.com';
const OUR_NUMBERS = new Set(['+18176352794', '+17377779159', '+19152217062', '+17864605438']);

// Serve TTS audio for Twilio <Play>
app.get('/ai/tts/:id', (req, res) => {
  const buf = _ttsCache.get(req.params.id);
  if (!buf) return res.status(404).send('Audio not found');
  res.type('audio/mpeg').send(buf);
});

app.post('/twilio/voice', async (req, res) => {
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  const to = req.body.To;

  // Inbound call → AI assistant (To is one of our numbers or empty)
  if (aiEnabled.voice && (!to || OUR_NUMBERS.has(to))) {
    const greeting = 'Hola, gracias por llamar a Grupo Elite Work. Soy Ana, tu asistente virtual. ¿En qué puedo ayudarte hoy?';
    try {
      const id  = await _genTTS(greeting);
      const gather = twiml.gather({ input: 'speech', action: '/twilio/voice/respond', speechTimeout: 'auto', language: 'es-MX', speechModel: 'phone_call' });
      gather.play(`${SERVER_URL}/ai/tts/${id}`);
    } catch {
      const gather = twiml.gather({ input: 'speech', action: '/twilio/voice/respond', speechTimeout: 'auto', language: 'es-MX' });
      gather.say({ language: 'es-MX' }, greeting);
    }
    twiml.redirect('/twilio/voice/no-input');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Outbound call (TwiML App) → dial the lead
  if (to) {
    const callerId = pickCallerId(to);
    console.log(`[Twilio] Llamando a ${to} → caller ID: ${callerId}`);
    const dial = twiml.dial({ callerId, timeout: 30, record: 'do-not-record' });
    dial.number(to);
  } else {
    twiml.say({ language: 'es-MX' }, 'No se especificó un número de destino.');
  }
  res.type('text/xml').send(twiml.toString());
});

// AI voice response turn
app.post('/twilio/voice/respond', async (req, res) => {
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  const { SpeechResult, From } = req.body;

  if (!SpeechResult?.trim()) {
    twiml.redirect('/twilio/voice/no-input');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  console.log(`[Voice-AI] ${From}: "${SpeechResult}"`);
  try {
    const reply = await askClaude(From, SpeechResult, 'voice');
    console.log(`[Voice-AI] Ana: "${reply}"`);
    const id = await _genTTS(reply);
    const gather = twiml.gather({ input: 'speech', action: '/twilio/voice/respond', speechTimeout: 'auto', language: 'es-MX', speechModel: 'phone_call' });
    gather.play(`${SERVER_URL}/ai/tts/${id}`);
    twiml.redirect('/twilio/voice/no-input');
  } catch (e) {
    console.error('[Voice-AI] Error:', e.message);
    twiml.say({ language: 'es-MX' }, 'Disculpa, tuve un problema técnico. Un reclutador te llamará en breve. ¡Hasta luego!');
    twiml.hangup();
  }
  res.type('text/xml').send(twiml.toString());
});

// No input fallback
app.post('/twilio/voice/no-input', (req, res) => {
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  twiml.say({ language: 'es-MX' }, '¿Sigues ahí? Si necesitas ayuda, llámanos de nuevo. ¡Hasta luego!');
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ── SMS: Send outbound SMS ────────────────────────────────────────────────────
app.post('/twilio/sms', async (req, res) => {
  const { to, body, leadId } = req.body;
  if (!to || !body) return res.status(400).json({ ok: false, error: 'to y body son requeridos' });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.status(500).json({ ok: false, error: 'Twilio no configurado' });
  try {
    const client  = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const message = await client.messages.create({
      body,
      to,
      messagingServiceSid: 'MG4a6b48ece18b09631e7a1aa5ecf48446',
    });
    console.log(`[SMS] → ${to} | ${message.sid} | leadId:${leadId||'?'}`);
    res.json({ ok: true, sid: message.sid });
  } catch (e) {
    console.error('[SMS] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SMS: Fetch inbox (inbound messages for a phone number) ────────────────────
app.get('/twilio/sms-inbox', async (req, res) => {
  const raw = req.query.phone;
  if (!raw) return res.status(400).json({ ok: false, error: 'phone requerido' });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.status(500).json({ ok: false, error: 'Twilio no configurado' });
  const phone = toE164(raw);
  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const [inbound, outbound] = await Promise.all([
      client.messages.list({ to: TWILIO_PHONE_NUMBER, from: phone, limit: 50 }),
      client.messages.list({ from: TWILIO_PHONE_NUMBER, to: phone, limit: 50 }),
    ]);
    const fmt = (m, dir) => ({
      sid:       m.sid,
      body:      m.body,
      direction: dir,
      status:    m.status,
      dateSent:  m.dateSent?.toISOString() || m.dateCreated?.toISOString() || new Date().toISOString(),
    });
    const messages = [
      ...inbound.map(m => fmt(m, 'inbound')),
      ...outbound.map(m => fmt(m, 'outbound')),
    ].sort((a, b) => new Date(a.dateSent) - new Date(b.dateSent));
    res.json({ ok: true, messages });
  } catch (e) {
    console.error('[SMS-Inbox] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── WhatsApp: Send outbound message (free text or approved template) ──────────
app.post('/twilio/whatsapp', async (req, res) => {
  const { to, body, contentSid, contentVariables, leadId } = req.body;
  if (!to) return res.status(400).json({ ok: false, error: 'to requerido' });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.status(500).json({ ok: false, error: 'Twilio no configurado' });
  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const toWa   = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const params = { to: toWa, from: TWILIO_WA_FROM };
    if (contentSid) {
      params.contentSid = contentSid;
      if (contentVariables) params.contentVariables = JSON.stringify(contentVariables);
    } else {
      if (!body) return res.status(400).json({ ok: false, error: 'body o contentSid requerido' });
      params.body = body;
    }
    const message = await client.messages.create(params);
    console.log(`[WA] → ${to} | ${message.sid} | template:${contentSid||'none'} | leadId:${leadId||'?'}`);
    res.json({ ok: true, sid: message.sid });
  } catch (e) {
    console.error('[WA] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── WhatsApp: Fetch inbox (inbound messages from a contact) ───────────────────
app.get('/twilio/whatsapp-inbox', async (req, res) => {
  const raw = req.query.phone;
  if (!raw) return res.status(400).json({ ok: false, error: 'phone requerido' });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.status(500).json({ ok: false, error: 'Twilio no configurado' });
  const phone = toE164(raw);
  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const contactWa = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
    const [inbound, outbound] = await Promise.all([
      client.messages.list({ to: TWILIO_WA_FROM, from: contactWa, limit: 50 }),
      client.messages.list({ from: TWILIO_WA_FROM, to: contactWa, limit: 50 }),
    ]);
    const fmt = (m, dir) => ({
      sid:       m.sid,
      body:      m.body,
      direction: dir,
      status:    m.status,
      dateSent:  m.dateSent?.toISOString() || m.dateCreated?.toISOString() || new Date().toISOString(),
    });
    const messages = [
      ...inbound.map(m => fmt(m, 'inbound')),
      ...outbound.map(m => fmt(m, 'outbound')),
    ].sort((a, b) => new Date(a.dateSent) - new Date(b.dateSent));
    res.json({ ok: true, messages });
  } catch (e) {
    console.error('[WA-Inbox] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Firestore helpers (same REST API as frontend) ─────────────────────────────
const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k,x]) => [k, fsVal(x)])) } };
  return { stringValue: String(v) };
}

async function fsLeadExists(phone) {
  try {
    const url = `${FS_BASE}/leads?key=${FS_KEY}&pageSize=500`;
    const data = await fetch(url).then(r => r.json());
    const docs = data.documents || [];
    return docs.some(doc => {
      const tel = doc.fields?.telefono?.stringValue || '';
      return toE164(tel) === toE164(phone);
    });
  } catch { return false; }
}

async function fsGetLeadByPhone(phone) {
  try {
    const data = await fetch(`${FS_BASE}/leads?key=${FS_KEY}&pageSize=500`).then(r => r.json());
    return (data.documents || []).find(doc => {
      const tel = doc.fields?.telefono?.stringValue || '';
      return toE164(tel) === toE164(phone);
    }) || null;
  } catch { return null; }
}

async function fsUpdateLeadFields(leadId, fields) {
  const mask = Object.keys(fields).join('&updateMask.fieldPaths=');
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k,v]) => [k, fsVal(v)])) };
  await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}&updateMask.fieldPaths=${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function extractAndUpdateLead(phone, conversationHistory) {
  try {
    const messages = conversationHistory.slice(-14).map(({ role, content }) => ({ role, content }));
    if (messages.length < 2) return;

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extraction = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Eres un extractor de datos. Analiza la conversación y extrae información del candidato.
Responde SOLO con JSON válido, sin texto adicional:
{
  "nombre": "nombre completo o null",
  "correo": "email o null",
  "ubicacion": "ciudad, estado o null",
  "disponibilidad": "tiempo completo / parcial / descripción o null"
}
Solo incluye campos que el candidato haya mencionado explícitamente. Si no hay info, pon null.`,
      messages,
    });

    let extracted;
    try { extracted = JSON.parse(extraction.content[0].text.trim()); }
    catch { return; }

    const hasData = Object.values(extracted).some(v => v !== null);
    if (!hasData) return;

    const rawPhone = phone.replace('whatsapp:', '');
    const doc = await fsGetLeadByPhone(rawPhone);
    if (!doc) return;

    const leadId = doc.name.split('/').pop();
    const existing = doc.fields || {};
    const updates  = {};

    const existingNombre = existing.nombre?.stringValue || '';
    const isAutoName = !existingNombre || existingNombre.startsWith('WA ') || existingNombre.startsWith('+');
    if (extracted.nombre && isAutoName)
      updates.nombre = extracted.nombre;
    if (extracted.correo        && !existing.correo?.stringValue)         updates.correo         = extracted.correo;
    if (extracted.ubicacion     && !existing.ubicacion?.stringValue)      updates.ubicacion      = extracted.ubicacion;
    if (extracted.disponibilidad && !existing.disponibilidad?.stringValue) updates.disponibilidad = extracted.disponibilidad;

    if (Object.keys(updates).length === 0) return;

    await fsUpdateLeadFields(leadId, updates);
    console.log(`[AI-Extract] Lead ${leadId} actualizado:`, updates);
  } catch (e) {
    console.error('[AI-Extract] Error:', e.message);
  }
}

// ── Webinar intent detection ──────────────────────────────────────────────────
async function detectWebinarIntent(history) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages = history.slice(-10).map(({ role, content }) => ({ role, content }));
    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: 'Analiza la conversación. Responde SOLO "SI" si el candidato aceptó o mostró interés claro en asistir al webinar/información virtual. Responde SOLO "NO" en cualquier otro caso.',
      messages,
    });
    return r.content[0].text.trim().toUpperCase() === 'SI';
  } catch { return false; }
}

// ── Send webinar email ────────────────────────────────────────────────────────
async function sendWebinarEmail(correo, nombre) {
  if (!SMTP_USER || !SMTP_PASS || !correo) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"Grupo Elite Work LLC" <${SMTP_USER}>`,
      to: correo,
      subject: '🎥 Tu invitación al Webinar — Grupo Elite Work LLC',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px;">
          <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px;border-radius:10px;text-align:center;margin-bottom:24px;">
            <h1 style="color:#fff;margin:0;font-size:22px;">Grupo Elite Work LLC</h1>
            <p style="color:#94a3b8;margin:8px 0 0;">Oportunidad de Carrera — Globe Life Insurance</p>
          </div>
          <h2 style="color:#1e293b;">¡Hola${nombre ? ' ' + nombre : ''}! 👋</h2>
          <p style="color:#475569;line-height:1.6;">Nos da mucho gusto que estés interesado/a en nuestra oportunidad. Te invitamos a nuestro <strong>webinar informativo virtual</strong> donde aprenderás todo sobre cómo construir una carrera exitosa como agente de seguros de vida.</p>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin:20px 0;">
            <h3 style="color:#1e293b;margin:0 0 12px;">¿Qué verás en el webinar?</h3>
            <ul style="color:#475569;line-height:1.8;padding-left:20px;">
              <li>Cómo funciona el modelo de trabajo remoto</li>
              <li>Estructura de comisiones y potencial de ingresos</li>
              <li>Proceso para obtener tu licencia estatal</li>
              <li>Preguntas y respuestas en vivo</li>
            </ul>
          </div>
          <div style="text-align:center;margin:28px 0;">
            <a href="${WEBINAR_URL}" style="background:linear-gradient(135deg,#0073ea,#0059b3);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;display:inline-block;">
              🎥 Acceder al Webinar
            </a>
          </div>
          <p style="color:#64748b;font-size:13px;text-align:center;">Si tienes preguntas, responde a este correo o escríbenos por WhatsApp.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
          <p style="color:#94a3b8;font-size:11px;text-align:center;">Grupo Elite Work LLC — Globe Life Insurance</p>
        </div>`,
    });
    console.log(`[Email] Enviado a ${correo}`);
    return true;
  } catch (e) {
    console.error('[Email] Error:', e.message);
    return false;
  }
}

// ── Move lead to webinar pipeline ─────────────────────────────────────────────
async function moveLeadToWebinar(leadId, nombre, correo) {
  try {
    const now = new Date().toISOString();
    await fsUpdateLeadFields(leadId, {
      pipeline_id:  'en-webinar',
      etapa:        'Inscrito en Webinar',
    });
    // Add historial entry
    const doc = await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}`).then(r => r.json());
    const hist = (doc.fields?.historial?.arrayValue?.values || []).map(v => ({
      icono: v.mapValue?.fields?.icono?.stringValue || '📋',
      accion: v.mapValue?.fields?.accion?.stringValue || '',
      fecha: v.mapValue?.fields?.fecha?.stringValue || now,
      usuario: v.mapValue?.fields?.usuario?.stringValue || '',
    }));
    hist.push({ icono: '🎥', accion: 'Inscrito en Webinar automáticamente por Ana (IA)', fecha: now, usuario: 'Ana (IA)' });
    await fsUpdateLeadFields(leadId, { historial: hist });
    console.log(`[Webinar] Lead ${leadId} movido a Inscrito en Webinar`);

    // Auto-register in webinar if we have name and email
    if (nombre && correo && !nombre.startsWith('WA ')) {
      const phone = doc.fields?.telefono?.stringValue || '';
      fetch(`${SERVER_URL}/registrar-webinar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, correo, telefono: phone, webinarUrl: WEBINAR_URL }),
      }).then(r => r.json()).then(d => {
        if (d.ok) console.log(`[Webinar] Auto-registrado: ${nombre} <${correo}>`);
        else console.warn('[Webinar] Auto-registro falló:', d.error);
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[Webinar] Error moviendo lead:', e.message);
  }
}

async function fsCreateLead(phone) {
  const id  = 'lead-wa-' + Date.now();
  const now = new Date().toISOString();
  const doc = {
    fields: {
      nombre:      fsVal(`WA ${phone}`),
      telefono:    fsVal(toE164(phone.replace('whatsapp:', ''))),
      fuente:      fsVal('WhatsApp Inbound'),
      etapa:       fsVal('New Lead'),
      pipeline_id: fsVal('postulados-whatsapp-meta'),
      estado:      fsVal('abierto'),
      valor:       fsVal(0),
      propietario: fsVal('Ana (IA)'),
      created_at:  fsVal(now),
      notas:       fsVal([]),
      tareas:      fsVal([]),
      pagos:       fsVal([]),
      etiquetas:   fsVal([]),
      historial:   fsVal([{ icono: '📱', accion: 'Lead creado automáticamente por WhatsApp entrante', fecha: now, usuario: 'Ana (IA)' }]),
    }
  };
  try {
    await fetch(`${FS_BASE}/leads/${id}?key=${FS_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    console.log(`[WA-AI] Lead auto-creado: ${id} para ${phone}`);
  } catch (e) {
    console.error('[WA-AI] Error creando lead:', e.message);
  }
}

// ── WhatsApp: Incoming webhook ────────────────────────────────────────────────
app.post('/twilio/whatsapp-incoming', async (req, res) => {
  const { From, Body, MessageSid } = req.body;
  console.log(`[WA-IN] ${From}: ${Body} (${MessageSid})`);

  // Auto-create lead if number not in CRM
  const exists = await fsLeadExists(From.replace('whatsapp:', ''));
  if (!exists) await fsCreateLead(From);

  if (aiEnabled.wa && Body?.trim()) {
    try {
      const reply = await askClaude(From, Body, 'wa');
      console.log(`[WA-AI] Ana → ${From}: "${reply}"`);
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await client.messages.create({ from: TWILIO_WA_FROM, to: From, body: reply });

      // Extract lead info + detect webinar intent in background
      const history = conversationHistory.get(From) || [];
      ;(async () => {
        try {
          await extractAndUpdateLead(From, history);

          // Detect webinar interest only if invite not already sent
          if (!webinarInviteSent.has(From)) {
            const wantsWebinar = await detectWebinarIntent(history);
            if (wantsWebinar) {
              webinarInviteSent.add(From);

              // Get fresh lead data
              const rawPhone = From.replace('whatsapp:', '');
              const doc = await fsGetLeadByPhone(rawPhone);
              if (doc) {
                const leadId = doc.name.split('/').pop();
                const f      = doc.fields || {};
                const nombre = f.nombre?.stringValue || '';
                const correo = f.correo?.stringValue || '';

                // 1. Send webinar link via WhatsApp
                const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
                await twilioClient.messages.create({
                  from: TWILIO_WA_FROM,
                  to:   From,
                  body: `🎥 Aquí está el link de tu webinar informativo:\n${WEBINAR_URL}\n\nEs gratuito y dura aproximadamente 60 minutos. ¡Cualquier duda estoy aquí! 😊`,
                });

                // 2. Send email invitation
                if (correo) await sendWebinarEmail(correo, nombre);

                // 3. Move lead to "Inscrito en Webinar" + auto-register
                await moveLeadToWebinar(leadId, nombre, correo);
              }
            }
          }
        } catch (e) {
          console.error('[BG] Error:', e.message);
        }
      })();
    } catch (e) {
      console.error('[WA-AI] Error:', e.message);
    }
  }
  res.type('text/xml').send('<Response></Response>');
});

// ── SMS: Incoming webhook (also catches WA if misconfigured) ─────────────────
app.post('/twilio/sms-incoming', async (req, res) => {
  const { From, Body, MessageSid } = req.body;
  console.log(`[SMS-IN] ${From}: ${Body} (${MessageSid})`);

  // If the message comes from a WhatsApp number, run full WA pipeline
  if (From?.startsWith('whatsapp:')) {
    const exists = await fsLeadExists(From.replace('whatsapp:', ''));
    if (!exists) await fsCreateLead(From);

    if (aiEnabled.wa && Body?.trim()) {
      try {
        const reply = await askClaude(From, Body, 'wa');
        console.log(`[WA-AI via SMS hook] Ana → ${From}: "${reply}"`);
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        await client.messages.create({ from: TWILIO_WA_FROM, to: From, body: reply });

        const history = conversationHistory.get(From) || [];
        ;(async () => {
          try {
            await extractAndUpdateLead(From, history);

            if (!webinarInviteSent.has(From)) {
              const wantsWebinar = await detectWebinarIntent(history);
              if (wantsWebinar) {
                webinarInviteSent.add(From);
                const rawPhone = From.replace('whatsapp:', '');
                const doc = await fsGetLeadByPhone(rawPhone);
                if (doc) {
                  const leadId = doc.name.split('/').pop();
                  const f      = doc.fields || {};
                  const nombre = f.nombre?.stringValue || '';
                  const correo = f.correo?.stringValue || '';

                  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
                  await twilioClient.messages.create({
                    from: TWILIO_WA_FROM,
                    to:   From,
                    body: `🎥 Aquí está el link de tu webinar informativo:\n${WEBINAR_URL}\n\nEs gratuito y dura aproximadamente 60 minutos. ¡Cualquier duda estoy aquí! 😊`,
                  });

                  if (correo) await sendWebinarEmail(correo, nombre);
                  await moveLeadToWebinar(leadId, nombre, correo);
                }
              }
            }
          } catch (e) {
            console.error('[BG via SMS hook] Error:', e.message);
          }
        })();
      } catch (e) {
        console.error('[WA-AI] Error:', e.message);
      }
    }
    res.type('text/xml').send('<Response></Response>');
    return;
  }

  if (aiEnabled.sms && Body?.trim()) {
    try {
      const reply = await askClaude(From, Body, 'sms');
      console.log(`[SMS-AI] Ana → ${From}: "${reply}"`);
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await client.messages.create({ from: TWILIO_PHONE_NUMBER, to: From, body: reply });
    } catch (e) {
      console.error('[SMS-AI] Error:', e.message);
    }
  }
  res.type('text/xml').send('<Response></Response>');
});

// ── Twilio: Call status callback (optional logging) ───────────────────────────
app.post('/twilio/status', (req, res) => {
  const { CallSid, CallStatus, To, Duration } = req.body;
  console.log(`[Twilio] ${CallSid} → ${To} | ${CallStatus} | ${Duration || 0}s`);
  res.sendStatus(200);
});

// ── Call log ──────────────────────────────────────────────────────────────────
app.get('/twilio/calls', async (req, res) => {
  try {
    const { phone, limit = 50 } = req.query;
    const filters = { limit: parseInt(limit) };
    if (phone) {
      filters.to   = phone;
    }
    const [outbound, inbound] = await Promise.all([
      client.calls.list({ ...filters, from: phone ? undefined : undefined }),
      phone ? client.calls.list({ to: phone, limit: parseInt(limit) }) : Promise.resolve([]),
    ]);
    // If no phone filter, just fetch recent calls
    const calls = phone
      ? [...outbound, ...inbound].sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      : (await client.calls.list({ limit: parseInt(limit) }));
    res.json({ calls: (Array.isArray(calls) ? calls : []).map(c => ({
      sid:       c.sid,
      to:        c.to,
      from:      c.from,
      status:    c.status,
      direction: c.direction,
      duration:  c.duration,
      startTime: c.startTime,
      price:     c.price,
    }))});
  } catch (e) {
    console.error('calls list:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/twilio/calls/by-number', async (req, res) => {
  try {
    const { phone, limit = 30 } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const [out, inc] = await Promise.all([
      client.calls.list({ from: phone, limit: parseInt(limit) }),
      client.calls.list({ to:   phone, limit: parseInt(limit) }),
    ]);
    const calls = [...out, ...inc].sort((a, b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, parseInt(limit));
    res.json({ calls: calls.map(c => ({
      sid: c.sid, to: c.to, from: c.from, status: c.status,
      direction: c.direction, duration: c.duration, startTime: c.startTime,
    }))});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI: Config (general prompt + Q&A + forbidden) ────────────────────────────
app.get('/ai/config', (req, res) => {
  res.json({ ok: true, config: loadConfig(), default: DEFAULT_CONFIG });
});

app.post('/ai/config', (req, res) => {
  const { config } = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ ok: false, error: 'config inválida' });
  const current = loadConfig();
  const merged  = { ...current, ...config };
  const saved   = saveConfig(merged);
  res.json({ ok: saved });
});

// ── AI: Settings ──────────────────────────────────────────────────────────────
app.get('/ai/settings', (req, res) => {
  res.json({ ok: true, enabled: aiEnabled });
});

app.post('/ai/settings', (req, res) => {
  const { sms, wa, voice } = req.body;
  if (typeof sms   === 'boolean') aiEnabled.sms   = sms;
  if (typeof wa    === 'boolean') aiEnabled.wa     = wa;
  if (typeof voice === 'boolean') aiEnabled.voice  = voice;
  res.json({ ok: true, enabled: aiEnabled });
});

// ── AI: Conversation history ──────────────────────────────────────────────────
app.get('/ai/history', (req, res) => {
  const all = {};
  for (const [phone, msgs] of conversationHistory) {
    all[phone] = msgs.map(({ role, content, ts }) => ({ role, content, ts }));
  }
  res.json({ ok: true, history: all });
});

app.delete('/ai/history/:phone', (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  conversationHistory.delete(phone);
  res.json({ ok: true });
});

app.delete('/ai/history', (req, res) => {
  conversationHistory.clear();
  res.json({ ok: true });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/',       (req, res) => res.json({ status: 'ok', service: 'Elite Webinar Bot' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Registro automático ───────────────────────────────────────────────────────
app.post('/registrar-webinar', async (req, res) => {
  const { nombre = '', correo = '', telefono = '', ciudad = '', webinarUrl, extra = {} } = req.body;

  if (!webinarUrl) return res.status(400).json({ ok: false, error: 'webinarUrl es requerida' });
  if (!correo)     return res.status(400).json({ ok: false, error: 'correo es requerido' });

  console.log(`\n[${new Date().toISOString()}] Registrando: ${nombre} <${correo}>`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    });

    await page.goto(webinarUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('input:not([type="hidden"])', { timeout: 15000 });

    // Llena el primer selector visible que encuentre
    async function fill(selectors, value) {
      if (!value) return false;
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1500 })) {
            await el.fill(String(value));
            console.log(`  ✓ ${sel} = "${value}"`);
            return true;
          }
        } catch {}
      }
      console.warn(`  ✗ No encontrado para: "${value}"`);
      return false;
    }

    // Nombre completo
    await fill([
      'input[name="first_name"]',
      'input[name="name"]',
      'input[name="full_name"]',
      'input[name="fullname"]',
      'input[placeholder*="nombre" i]',
      'input[placeholder*="name" i]',
      'input[id*="name" i]:not([id*="last" i]):not([id*="sur" i])',
      'form input[type="text"]:first-of-type',
    ], nombre);

    // Correo
    await fill([
      'input[type="email"]',
      'input[name="email"]',
      'input[name="email_address"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="correo" i]',
    ], correo);

    // Teléfono
    await fill([
      'input[name="phone"]',
      'input[name="phone_number"]',
      'input[name="telephone"]',
      'input[type="tel"]',
      'input[placeholder*="phone" i]',
      'input[placeholder*="teléfono" i]',
      'input[placeholder*="telefono" i]',
      'input[placeholder*="celular" i]',
    ], telefono);

    // Ciudad
    await fill([
      'input[name="city"]',
      'input[name="ciudad"]',
      'input[name="location"]',
      'input[placeholder*="city" i]',
      'input[placeholder*="ciudad" i]',
    ], ciudad);

    // Campos fijos (Manager, Referido por, etc.)
    for (const [label, value] of Object.entries(extra)) {
      if (!value) continue;
      await fill([
        `input[name="${label}"]`,
        `input[placeholder*="${label}" i]`,
        `select[name="${label}"]`,
        `textarea[name="${label}"]`,
      ], value);
    }

    await page.waitForTimeout(500);

    // Captura ANTES de enviar (para verificación)
    const screenshotBefore = (await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false })).toString('base64');
    console.log('  → Captura tomada antes de enviar');

    // Listar todos los botones visibles para debug
    const allButtons = await page.evaluate(() =>
      [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
        .map(el => ({ tag: el.tagName, type: el.type||'', text: (el.innerText||el.value||el.textContent||'').trim().slice(0,60) }))
    );
    console.log('  → Botones en página:', JSON.stringify(allButtons));

    // Enviar formulario con Playwright locators
    const submitLocators = [
      page.locator('button[type="submit"]').first(),
      page.locator('input[type="submit"]').first(),
      page.locator('button, [role="button"]').filter({ hasText: /registr|inscri|enviar|submit|sign.?up|apunt|register|join|attend|continuar|siguiente|next/i }).first(),
      page.locator('form button').last(),
      page.locator('button').last(),
    ];

    let submitText = null;
    for (const loc of submitLocators) {
      try {
        const count = await loc.count();
        if (!count) continue;
        const text = (await loc.textContent() || '').trim();
        if (text.length <= 2 && !/submit/i.test(await loc.getAttribute('type') || '')) continue;
        await loc.click({ timeout: 5000 });
        submitText = text || 'button';
        break;
      } catch {}
    }

    if (!submitText) throw new Error('No se encontró el botón de envío en la página');
    console.log(`  → Enviado con: "${submitText}"`);

    // Esperar confirmación
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 12000 }),
      page.waitForSelector('[class*="success"],[class*="confirm"],[class*="thank"],[class*="gracias"]', { timeout: 12000 }),
    ]).catch(() => console.warn('  → Timeout confirmación (asumiendo éxito)'));

    // Captura DESPUÉS de enviar (confirmación)
    const screenshotAfter = (await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false })).toString('base64');
    console.log(`  → URL final: ${page.url()}`);

    res.json({
      ok: true,
      message: 'Registrado exitosamente',
      finalUrl: page.url(),
      screenshotBefore,
      screenshotAfter,
    });

  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`\nElite Webinar Bot corriendo en puerto ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health\n`);
});
