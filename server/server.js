// PLAYWRIGHT_BROWSERS_PATH se setea vía env var en render.yaml
const SERVER_START_TIME = process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_REPLICA_ID || Date.now().toString();

const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const { chromium } = require('playwright');
const twilio     = require('twilio');
// nodemailer removed — usando Resend API
const { askClaude, askClaudeResume, textToSpeech, loadConfig, loadConfigFromFirestore, saveConfig, reloadConfig, DEFAULT_CONFIG, conversationHistory, aiEnabled, loadEntrevistasConfig, saveEntrevistasConfig } = require('./ai');
const db = require('./db');
const { registerMetaRoutes } = require('./meta');
const { fsLeadExists, fsCreateLeadWA, fsGetLeadByPhone, fsUpdateLeadFields, runWAPipeline, humanDelay } = require('./pipeline');
const { triggerEscalation, handleManagerReply, isManagerPhone, loadManagers, saveManagers, DEFAULT_MANAGERS, getTeamMessages } = require('./escalation');
const { loadInterviewConfig, saveInterviewConfig, getAvailableSlots, bookInterview, listInterviews, updateInterview, checkInterviewReminders, DEFAULT_INTERVIEW_CONFIG } = require('./interviews');
const { registerIvrRoutes } = require('./ivr');

const WEBINAR_URL  = process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false }));

// ── Twilio config (set these env vars in Render) ──────────────────────────────
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_API_KEY       = process.env.TWILIO_API_KEY;       // Twilio Console → API Keys
const TWILIO_API_SECRET    = process.env.TWILIO_API_SECRET;
const TWILIO_PHONE_NUMBER  = process.env.TWILIO_PHONE_NUMBER;  // e.g. +12015551234
const TWILIO_APP_SID       = process.env.TWILIO_APP_SID;       // TwiML App SID
const client = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;
// TWILIO_WA_FROM removido — WhatsApp usa Meta Cloud API

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
  const to     = req.body.To;

  // Inbound call → IVR menu (To is one of our numbers or empty)
  if (!to || OUR_NUMBERS.has(to)) {
    twiml.redirect('/twilio/voice/ivr/menu');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // Outbound call (TwiML App) → dial the lead
  if (to) {
    const callerId = pickCallerId(to);
    console.log(`[Twilio] Llamando a ${to} → caller ID: ${callerId}`);
    const dial = twiml.dial({ callerId, timeout: 30, record: 'record-from-answer', recordingChannels: 'dual' });
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
  return res.status(403).json({ ok: false, error: 'SMS desactivado temporalmente — campañas pendientes de aprobación' });
  const { to, body, leadId } = req.body;
  if (!to || !body) return res.status(400).json({ ok: false, error: 'to y body son requeridos' });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.status(500).json({ ok: false, error: 'Twilio no configurado' });
  try {
    // using global client
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
    // using global client
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

// /twilio/whatsapp y /twilio/whatsapp-inbox removidos — usar /meta/wa-send y /meta/wa-inbox

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const { AUTH_PHONE_PENDING, normalizePhone, handleAuthWAReply, fsGetSession, fsSetSession } = require('./auth-sessions');

function hashPass(pass) {
  return crypto.createHash('sha256').update(String(pass)).digest('hex');
}

async function dbGetUsers() {
  return db.sbGetUsers();
}
async function dbFindUserByEmail(email) {
  const all = await db.sbGetUsers();
  return all.find(u => (u.correo || '').toLowerCase() === email.toLowerCase() && u.active !== false) || null;
}
async function dbCreateUser(u) {
  const id = crypto.randomBytes(12).toString('hex');
  await db.sbSaveUser(id, {
    nombre:        u.nombre,
    correo:        (u.correo || '').toLowerCase(),
    telefono:      u.telefono || '',
    password_hash: hashPass(u.password),
    role:          u.role || 'agente',
    active:        true,
    created_at:    new Date().toISOString(),
  });
  return id;
}
async function dbUpdateUser(id, fields) {
  const updates = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'password') updates.password_hash = hashPass(String(v));
    else updates[k] = v;
  }
  if (!Object.keys(updates).length) return;
  await db.sbUpdateUser(id, updates);
}
async function dbDeleteUser(id) {
  await db.sbDeleteUser(id);
}

// ── Seed developer on startup ─────────────────────────────────────────────────
(async () => {
  try {
    const users = await dbGetUsers();
    if (!users.find(u => u.correo === 'gonzalezluis@grupoelitework.com')) {
      await dbCreateUser({
        nombre: 'Luis González', correo: 'gonzalezluis@grupoelitework.com',
        telefono: '+17863060642', password: 'elite2026', role: 'developer',
      });
      console.log('[Auth] Cuenta desarrollador creada ✓');
    }
  } catch (e) { console.error('[Auth] Seed error:', e.message); }
})();

function requireSession(role) {
  return async (req, res, next) => {
    const token = req.headers['x-session-token'];
    if (!token) return res.status(401).json({ ok: false, error: 'No autorizado' });
    try {
      const s = await fsGetSession(token);
      if (!s || !s.verified || s.expires < Date.now()) return res.status(401).json({ ok: false, error: 'Sesión inválida' });
      if (role && s.role !== role) return res.status(403).json({ ok: false, error: 'Sin permiso' });
      req.authSession = s;
      next();
    } catch(e) { res.status(500).json({ ok: false, error: 'Error de sesión' }); }
  };
}

// ── Master user (developer bypass — never stored in Firestore) ───────────────
const MASTER_EMAIL = (process.env.MASTER_EMAIL || 'gonzalezluis@grupoelitework.com').toLowerCase();
const MASTER_PASS  = process.env.MASTER_PASS  || 'EliteAdmin2026!';

// ── POST /auth/login ──────────────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Campos requeridos' });
  try {
    // Master developer bypass
    let user = null;
    if (email.toLowerCase() === MASTER_EMAIL && password === MASTER_PASS) {
      user = { id: 'master', nombre: 'Luis González', correo: MASTER_EMAIL, role: 'developer', telefono: '', active: true };
    } else {
      user = await dbFindUserByEmail(email);
      if (!user || user.password_hash !== hashPass(password)) {
        return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });
      }
    }
    const sessionId = crypto.randomBytes(32).toString('hex');
    const session   = { userId: user.id, name: user.nombre, role: user.role,
                        phone: normalizePhone(user.telefono), verified: false,
                        expires: Date.now() + 30 * 60 * 1000 }; // 30 min to verify
    // Auto-verify all users — WA is informational only
    session.verified = true;
    session.expires  = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await fsSetSession(sessionId, session);

    // Send WA notification (non-blocking, informational)
    if (user.telefono) {
      try {
        const { sendWhatsApp: _authWA } = require('./meta');
        const phone = user.telefono.replace(/[^\d]/g, ''); // strip +, spaces, dashes
        _authWA(phone, `🔐 *Grupo Elite Work*\n\nHola ${user.nombre.split(' ')[0]}, iniciaste sesión con tu cuenta (${user.correo}).`, { noLog: true })
          .catch(e => console.error('[Auth] WA error:', e.message));
      } catch(e) {}
    }
    res.json({ ok: true, sessionId, name: user.nombre, role: user.role, correo: user.correo, userId: user.id, verified: true });
  } catch (e) {
    console.error('[Auth] Login error:', e.message);
    res.status(500).json({ ok: false, error: 'Error del servidor' });
  }
});

// ── GET /auth/status/:id ──────────────────────────────────────────────────────
app.get('/auth/status/:id', async (req, res) => {
  try {
    const s = await fsGetSession(req.params.id);
    if (!s || s.expires < Date.now()) return res.json({ ok: true, verified: false, expired: true });
    res.json({ ok: true, verified: s.verified, name: s.name, role: s.role });
  } catch(e) { res.json({ ok: true, verified: false, expired: false }); }
});

// ── GET /team — basic user list for @mentions (all authenticated users) ────────
app.get('/team', requireSession(), async (req, res) => {
  try {
    const users = await dbGetUsers();
    res.json({ ok: true, users: users.filter(u => u.active !== false).map(u => ({ id: u.id, nombre: u.nombre, role: u.role })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
app.get('/notifications', requireSession(), async (req, res) => {
  try {
    const notifs = await db.sbGetNotifications(req.authSession.userId);
    res.json({ ok: true, notifications: notifs });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/notifications', requireSession(), async (req, res) => {
  try {
    const { user_id, lead_id, lead_nombre, pipeline_id, note_text } = req.body;
    if (!user_id || !lead_id) return res.status(400).json({ ok: false, error: 'Campos requeridos' });
    const id = await db.sbCreateNotification({
      user_id, lead_id,
      lead_nombre: lead_nombre || '',
      pipeline_id: pipeline_id || '',
      note_text:   note_text   || '',
      from_user_name: req.authSession.name,
    });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.patch('/notifications/:id/read', requireSession(), async (req, res) => {
  try {
    await db.sbMarkNotificationRead(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/notifications/mark-all-read', requireSession(), async (req, res) => {
  try {
    await db.sbMarkAllNotificationsRead(req.authSession.userId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── GET /auth/users ───────────────────────────────────────────────────────────
app.get('/auth/users', requireSession('developer'), async (req, res) => {
  try {
    const users = (await dbGetUsers()).map(u => ({ ...u, password_hash: undefined }));
    res.json({ ok: true, users });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── POST /auth/users ──────────────────────────────────────────────────────────
app.post('/auth/users', requireSession('developer'), async (req, res) => {
  const { nombre, correo, telefono, password, role } = req.body;
  if (!nombre || !correo || !telefono || !password || !role) {
    return res.status(400).json({ ok: false, error: 'Todos los campos son requeridos' });
  }
  if (!['developer','agente','entrevistador'].includes(role)) {
    return res.status(400).json({ ok: false, error: 'Rol inválido' });
  }
  try {
    const exists = await dbFindUserByEmail(correo);
    if (exists) return res.status(409).json({ ok: false, error: 'Ya existe un usuario con ese correo' });
    const id = await dbCreateUser({ nombre, correo, telefono, password, role });
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── PUT /auth/users/:id ───────────────────────────────────────────────────────
app.put('/auth/users/:id', requireSession('developer'), async (req, res) => {
  const allowed = ['nombre','correo','telefono','password','role','active','timezone'];
  const fields  = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  try { await dbUpdateUser(req.params.id, fields); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── DELETE /auth/users/:id ────────────────────────────────────────────────────
app.delete('/auth/users/:id', requireSession('developer'), async (req, res) => {
  try { await dbDeleteUser(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── PUT /auth/me — change own email/password with current password verification ─
app.put('/auth/me', requireSession(), async (req, res) => {
  const { current_password, new_correo, new_password } = req.body;
  if (!current_password) return res.status(400).json({ ok: false, error: 'Contraseña actual requerida' });
  try {
    const session = req.authSession;
    let user;
    if (session.userId === 'master') {
      user = await dbFindUserByEmail(MASTER_EMAIL);
    } else {
      const all = await dbGetUsers();
      user = all.find(u => u.id === session.userId);
    }
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    if (user.password_hash !== hashPass(current_password))
      return res.status(401).json({ ok: false, error: 'Contraseña actual incorrecta' });
    const fields = {};
    if (new_correo && new_correo.toLowerCase() !== (user.correo || '').toLowerCase()) {
      const exists = await dbFindUserByEmail(new_correo);
      if (exists && exists.id !== user.id) return res.status(409).json({ ok: false, error: 'Ese correo ya está en uso' });
      fields.correo = new_correo.toLowerCase();
    }
    if (new_password) fields.password = new_password;
    if (!Object.keys(fields).length) return res.json({ ok: true });
    await dbUpdateUser(user.id, fields);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── POST /auth/impersonate/:userId — developer enters as another user ──────────
app.post('/auth/impersonate/:userId', requireSession('developer'), async (req, res) => {
  try {
    const all  = await dbGetUsers();
    const user = all.find(u => u.id === req.params.userId);
    if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    const sessionId = crypto.randomBytes(32).toString('hex');
    await fsSetSession(sessionId, {
      userId: user.id, name: user.nombre, role: user.role,
      phone: normalizePhone(user.telefono), verified: true,
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, sessionId, name: user.nombre, role: user.role, correo: user.correo, userId: user.id });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// /twilio/whatsapp-incoming removido — WhatsApp ahora entra solo por /meta/webhook/whatsapp


// ── SMS: Incoming webhook (also catches WA if misconfigured) ─────────────────
app.post('/twilio/sms-incoming', async (req, res) => {
  const { From, Body, MessageSid } = req.body;
  console.log(`[SMS-IN] ${From}: ${Body} (${MessageSid})`);

  // WhatsApp messages now handled exclusively by /meta/webhook/whatsapp
  if (From?.startsWith('whatsapp:')) {
    return res.type('text/xml').send('<Response></Response>');
  }

  if (aiEnabled.sms && Body?.trim()) {
    try {
      const reply = await askClaude(From, Body, 'sms');
      console.log(`[SMS-AI] Ana → ${From}: "${reply}"`);
      // using global client
      await client.messages.create({ from: TWILIO_PHONE_NUMBER, to: From, body: reply });
    } catch (e) {
      console.error('[SMS-AI] Error:', e.message);
    }
  }
  res.type('text/xml').send('<Response></Response>');
});

const { fsLogCall, fsGetCallLog } = require('./call-log');

// ── Twilio: Call status callback ──────────────────────────────────────────────
app.post('/twilio/status', async (req, res) => {
  res.sendStatus(200);
  const { CallSid, CallStatus, From, To, Direction, Duration, Timestamp } = req.body;
  console.log(`[Twilio] ${CallSid} → ${To} | ${CallStatus} | ${Duration || 0}s`);
  const terminal = ['completed','no-answer','busy','failed','canceled'];
  if (!terminal.includes(CallStatus)) return;
  const isInbound = Direction === 'inbound';
  const isMissed  = ['no-answer','busy','failed','canceled'].includes(CallStatus) && isInbound;
  await fsLogCall({
    callSid:   CallSid,
    from:      From,
    to:        To,
    status:    CallStatus,
    direction: Direction,
    duration:  Duration || 0,
    type:      isMissed ? 'missed' : isInbound ? 'inbound' : 'outbound',
    startTime: Timestamp || new Date().toISOString(),
    ts:        Date.now(),
  });
});

// ── GET: Firestore call log ───────────────────────────────────────────────────
app.get('/call-log', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    const calls = await fsGetCallLog(limit);
    res.json({ ok: true, calls });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Call log ──────────────────────────────────────────────────────────────────
app.get('/twilio/calls', async (req, res) => {
  try {
    if (!client) return res.json({ calls: [] });
    const { phone, limit = 50 } = req.query;
    const filters = { limit: parseInt(limit) };
    const calls = phone
      ? (await Promise.all([
          client.calls.list({ from: phone, limit: parseInt(limit) }),
          client.calls.list({ to:   phone, limit: parseInt(limit) }),
        ])).flat().sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
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

// ── AI: Escalation managers config ───────────────────────────────────────────
app.get('/ai/managers', async (req, res) => {
  const managers = await loadManagers().catch(() => DEFAULT_MANAGERS);
  const ivCfg    = await loadInterviewConfig().catch(() => ({}));
  const interviewer = ivCfg.interviewer?.phone ? {
    name:  ivCfg.interviewer.name  || 'Entrevistador',
    phone: ivCfg.interviewer.phone,
    role:  'interviewer',
  } : null;
  res.json({ ok: true, managers, interviewer });
});

app.get('/ai/team-messages', async (req, res) => {
  const messages = await getTeamMessages().catch(() => []);
  res.json({ ok: true, messages });
});

app.get('/ai/templates', (req, res) => {
  const { TEMPLATES } = require('./templates');
  res.json({ ok: true, templates: TEMPLATES });
});

app.post('/ai/managers', async (req, res) => {
  const { managers } = req.body;
  if (!Array.isArray(managers) || managers.length !== 3) {
    return res.status(400).json({ ok: false, error: 'Se requieren exactamente 3 encargados' });
  }
  await saveManagers(managers);
  res.json({ ok: true });
});

// ── AI: Config (general prompt + Q&A + forbidden) ────────────────────────────
app.get('/ai/config', async (req, res) => {
  const config = await loadConfigFromFirestore().catch(() => loadConfig());
  res.json({ ok: true, config, default: DEFAULT_CONFIG });
});

app.post('/ai/config', async (req, res) => {
  const { config } = req.body;
  if (!config || typeof config !== 'object') return res.status(400).json({ ok: false, error: 'config inválida' });
  const current = await loadConfigFromFirestore().catch(() => loadConfig());
  const merged  = { ...current, ...config };
  const saved   = await saveConfig(merged);
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

app.post('/ai/reload', requireSession(), async (req, res) => {
  try {
    await reloadConfig();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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

// ── Entrevistas AI config ─────────────────────────────────────────────────────
app.get('/ai/config/entrevistas', async (req, res) => {
  const config = await loadEntrevistasConfig();
  res.json({ ok: true, config });
});

app.post('/ai/config/entrevistas', async (req, res) => {
  const current = await loadEntrevistasConfig();
  const merged  = { ...current, ...req.body.config };
  const saved   = await saveEntrevistasConfig(merged);
  res.json({ ok: true, saved });
});

// ── IA pause/resume for a specific lead ──────────────────────────────────────
app.post('/ai/pause', async (req, res) => {
  const { phone, paused } = req.body;
  if (!phone) return res.status(400).json({ ok: false, error: 'phone requerido' });
  try {
    const doc = await fsGetLeadByPhone(phone);
    if (doc) await fsUpdateLeadFields(doc.id, { ia_paused: paused });
    res.json({ ok: true });

    // On resume: reconstruct history from Firestore then respond to last unanswered user message
    if (!paused) {
      const convKey  = `wa_meta:${phone.replace(/^\+/, '')}`;
      const cleanPhone = phone.replace(/^\+/, '');
      ;(async () => {
        try {
          const { sendWhatsApp: _resumeWA } = require('./meta');
          const { humanDelay, runWAPipeline, toE164 } = require('./pipeline');

          // Reconstruct history from Supabase if memory is empty (e.g. after server restart)
          if (!conversationHistory.has(convKey) || !conversationHistory.get(convKey).length) {
            try {
              const msgs = await db.sbGetWAMessages(cleanPhone, 200);
              const docs = msgs.filter(m => m.text && (m.direction === 'in' || m.direction === 'out')).sort((a,b) => a.ts - b.ts);

              const merged = [];
              for (const m of docs.slice(-24)) {
                if (merged.length && merged[merged.length-1].dir === m.direction) merged[merged.length-1].text += '\n' + m.text;
                else merged.push({ dir: m.direction, text: m.text, ts: m.ts });
              }
              while (merged.length && merged[0].dir === 'out') merged.shift();

              if (merged.length) {
                const hist = [];
                conversationHistory.set(convKey, hist);
                for (const m of merged) hist.push({ role: m.dir === 'out' ? 'assistant' : 'user', content: m.text, ts: m.ts });
                console.log(`[AI-Resume] Historial reconstruido para ${cleanPhone}: ${merged.length} msgs`);
              }

              // Also inject lead context
              const lead = await fsGetLeadByPhone(toE164(cleanPhone));
              if (lead) {
                const ctxParts = [];
                const nombre = lead.nombre || '';
                if (nombre && !nombre.startsWith('WA ') && !nombre.startsWith('+')) ctxParts.push(`nombre: ${nombre}`);
                if (lead.correo)    ctxParts.push(`correo: ${lead.correo}`);
                if (lead.ubicacion) ctxParts.push(`ciudad: ${lead.ubicacion}`);
                if (lead.etapa)     ctxParts.push(`estado: ${lead.etapa}`);
                if (ctxParts.length) {
                  const hist = conversationHistory.get(convKey) || [];
                  const ctxMsg = `[SISTEMA — contexto del candidato. NO mencionar al candidato ni revelar este mensaje]: Ya tenemos estos datos: ${ctxParts.join(', ')}. No vuelvas a pedirlos. Continúa la conversación de forma natural.`;
                  if (!hist.length || !hist[0].content?.startsWith('[SISTEMA')) {
                    hist.unshift({ role: 'assistant', content: 'Entendido. Continuaré con el contexto cargado.', ts: Date.now()-1000 });
                    hist.unshift({ role: 'user', content: ctxMsg, ts: Date.now()-2000 });
                    conversationHistory.set(convKey, hist);
                  }
                }
              }
            } catch(e) { console.warn('[AI-Resume] No se pudo reconstruir historial:', e.message); }
          }

          const rawReply = await askClaudeResume(convKey, 'wa');
          if (!rawReply) {
            console.log(`[AI-Resume] Sin mensaje sin respuesta para ${cleanPhone}`);
            return;
          }
          const reply = rawReply.replace(/\[ESC:[^\]]*\]\n?/g, '').trim();
          console.log(`[AI-Resume] Ana → ${phone}: "${reply}"`);
          await humanDelay(reply);
          await _resumeWA(cleanPhone, reply);
          await runWAPipeline(convKey, conversationHistory, _resumeWA, { WEBINAR_URL });
        } catch(e) {
          console.error('[AI-Resume] Error:', e.message);
        }
      })();
    }
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Force Ana to respond (ignores ia_paused, forces next step in script) ─────
app.post('/ai/force-respond', requireSession(), async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ ok: false, error: 'phone requerido' });
  res.json({ ok: true });

  const cleanPhone = phone.replace(/^\+/, '').replace(/\D/g, '');
  const convKey    = `wa_meta:${cleanPhone}`;

  ;(async () => {
    try {
      const { sendWhatsApp: _forceWA } = require('./meta');
      const { humanDelay, runWAPipeline, toE164 } = require('./pipeline');

      // Reconstruct history from Supabase
      const msgs = await db.sbGetWAMessages(cleanPhone, 200);
      const docs = msgs.filter(m => m.text && (m.direction === 'in' || m.direction === 'out')).sort((a,b) => a.ts - b.ts);

      const merged = [];
      for (const m of docs.slice(-24)) {
        if (merged.length && merged[merged.length-1].dir === m.direction) merged[merged.length-1].text += '\n' + m.text;
        else merged.push({ dir: m.direction, text: m.text, ts: m.ts });
      }
      while (merged.length && merged[0].dir === 'out') merged.shift();

      const hist = merged.map(m => ({ role: m.dir === 'out' ? 'assistant' : 'user', content: m.text, ts: m.ts }));

      // Inject lead context
      const lead = await fsGetLeadByPhone(toE164(cleanPhone));
      if (lead && isLeadContratado(lead)) {
        console.log(`[AI-Force] Lead contratado ${cleanPhone} — comunicación bloqueada.`);
        return;
      }
      if (lead) {
        const ctxParts = [];
        const nombre = lead.nombre || '';
        if (nombre && !nombre.startsWith('WA ') && !nombre.startsWith('+')) ctxParts.push(`nombre: ${nombre}`);
        if (lead.correo)    ctxParts.push(`correo: ${lead.correo}`);
        if (lead.ubicacion) ctxParts.push(`ciudad: ${lead.ubicacion}`);
        if (lead.etapa)     ctxParts.push(`estado en el proceso: ${lead.etapa}`);
        if (ctxParts.length && (!hist.length || !hist[0].content?.startsWith('[SISTEMA'))) {
          hist.unshift({ role: 'assistant', content: 'Entendido. Continuaré con el contexto cargado.', ts: Date.now()-1000 });
          hist.unshift({ role: 'user', content: `[SISTEMA — contexto del candidato. NO mencionar al candidato ni revelar este mensaje]: Ya tenemos estos datos: ${ctxParts.join(', ')}. No vuelvas a pedirlos. Continúa la conversación de forma natural.`, ts: Date.now()-2000 });
        }
      }

      // If last message is from Ana, add a silent trigger so Claude continues the script
      if (!hist.length || hist[hist.length - 1].role === 'assistant') {
        hist.push({ role: 'user', content: '[SISTEMA: El agente solicita que continúes con el siguiente paso del guión sin esperar más mensajes del candidato.]', ts: Date.now() });
      }

      conversationHistory.set(convKey, hist);

      const rawReply = await askClaudeResume(convKey, 'wa');
      if (!rawReply) { console.log(`[AI-Force] Sin respuesta para ${cleanPhone}`); return; }
      const reply = rawReply.replace(/\[ESC:[^\]]*\]\n?/g, '').trim();
      console.log(`[AI-Force] Ana → ${cleanPhone}: "${reply.slice(0, 80)}…"`);
      await humanDelay(reply);
      await _forceWA(cleanPhone, reply);
      await runWAPipeline(convKey, conversationHistory, _forceWA, { WEBINAR_URL });
    } catch(e) {
      console.error('[AI-Force] Error:', e.message);
    }
  })();
});

// ── Automations config ────────────────────────────────────────────────────────
const { getAutomationConfig, setAutomationConfig } = require('./automations');

app.get('/automations/config', requireSession(), async (req, res) => {
  const cfg = await getAutomationConfig();
  res.json({ ok: true, config: cfg });
});

app.post('/automations/config', requireSession('developer'), async (req, res) => {
  try {
    const cfg = await setAutomationConfig(req.body);
    res.json({ ok: true, config: cfg });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Interview config ──────────────────────────────────────────────────────────
app.get('/interviews/config', async (req, res) => {
  const cfg = await loadInterviewConfig();
  res.json({ ok: true, config: cfg });
});

app.post('/interviews/config', async (req, res) => {
  const current = await loadInterviewConfig();
  const merged  = { ...current, ...req.body.config };
  const ok = await saveInterviewConfig(merged);
  res.json({ ok });
});

app.get('/interviews/slots', async (req, res) => {
  const cfg   = await loadInterviewConfig();
  const from  = req.query.from ? new Date(req.query.from) : new Date();
  const slots = await getAvailableSlots(cfg, from);
  res.json({ ok: true, slots });
});

app.post('/interviews/book', async (req, res) => {
  // Accept both frontend field names (phone/slot/name) and internal names (leadPhone/slotIso/leadName)
  const leadPhone = req.body.leadPhone || req.body.phone;
  const leadName  = req.body.leadName  || req.body.name;
  const slotIso   = req.body.slotIso   || req.body.slot;
  const convKey   = req.body.convKey;
  if (!leadPhone || !slotIso) return res.status(400).json({ ok: false, error: 'phone y slot requeridos' });
  const { id, cfg, doc } = await bookInterview({ leadPhone, leadName, slotIso, convKey });

  // Pixel event — lead agendó entrevista (audiencia objetivo real para Meta Ads)
  ;(async () => {
    try {
      const { pixelEntrevista } = require('./pixel');
      const leadDoc = await fsGetLeadByPhone(leadPhone);
      const correo  = leadDoc?.correo || '';
      await pixelEntrevista({ telefono: leadPhone, correo });
    } catch (e) { console.error('[Pixel] pixelEntrevista:', e.message); }
  })();
  // Notify interviewer via template
  if (cfg.interviewer.phone) {
    const d     = new Date(slotIso);
    const days  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const months= ['enero','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    const h     = d.getHours(); const h12 = h % 12 || 12; const ampm = h >= 12 ? 'PM' : 'AM';
    const fecha = `${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]}`;
    const hora  = `${h12}:00 ${ampm}`;
    const fallback = `📅 Nueva entrevista agendada — Grupo Élite\n\nCandidato: ${leadName || 'Candidato'}\nTeléfono: ${leadPhone}\nFecha y hora: ${fecha} · ${hora}\nEnlace Zoom: ${cfg.zoomLink}\n\nResponde CONFIRMAR o REAGENDAR.`;
    const ivPhone = cfg.interviewer.phone.replace(/^\+/, '');
    const { sendWhatsApp: _ivNotifyWA } = require('./meta');
    _ivNotifyWA(ivPhone, fallback).catch(() => {});
  }
  res.json({ ok: true, id, doc, interview: { id, slot: slotIso, zoom_link: doc.zoomLink, status: doc.status } });
});

// ── Grabaciones de llamadas ───────────────────────────────────────────────────
app.get('/recordings', async (req, res) => {
  const phone = (req.query.phone || '').replace(/\D/g, '');
  if (!phone || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.json({ ok: true, recordings: [] });
  try {
    const tc = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const [callsTo, callsFrom] = await Promise.all([
      tc.calls.list({ to: `+${phone}`, limit: 50 }),
      tc.calls.list({ from: `+${phone}`, limit: 50 }),
    ]);
    const allCalls = [...callsTo, ...callsFrom];
    const recArrays = await Promise.all(
      allCalls.map(c => tc.recordings.list({ callSid: c.sid }).catch(() => []))
    );
    const recordings = recArrays.flat()
      .filter(r => r.duration > 0)
      .sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated))
      .slice(0, 20)
      .map(r => ({
        sid:      r.sid,
        duration: r.duration,
        date:     r.dateCreated,
        url:      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${r.sid}.mp3`,
      }));
    res.json({ ok: true, recordings });
  } catch (e) {
    console.error('[Recordings]', e.message);
    res.json({ ok: true, recordings: [] });
  }
});

app.get('/interviews', async (req, res) => {
  let list = await listInterviews();
  if (req.query.phone) {
    const phone = req.query.phone.replace(/^\+/, '');
    list = list.filter(i => (i.leadPhone || '').replace(/^\+/, '') === phone);
  }
  res.json({ ok: true, interviews: list });
});

app.patch('/interviews/:id', async (req, res) => {
  const ok = await updateInterview(req.params.id, req.body);
  res.json({ ok });
});

// Reminder cron — every minute (both candidates and interviewers via Meta)
const { sendWhatsApp: _ivSendWA } = require('./meta');
const _ivSendInternal = async (to, text) => {
  const { sendWhatsApp: _ivInternalWA } = require('./meta');
  await _ivInternalWA(to.replace(/^\+/, ''), text);
};
const _ivSendManager = async (text) => {
  const managers = await loadManagers();
  const mgr = managers[0];
  if (mgr?.phone) {
    const { sendWhatsApp: _ivMgrWA } = require('./meta');
    await _ivMgrWA(mgr.phone.replace(/^\+/, ''), text).catch(() => {});
  }
};
setInterval(() => checkInterviewReminders(_ivSendWA, _ivSendInternal, _ivSendManager).catch(e => console.error('[IV-Reminder]', e.message)), 60_000);

// ── Lead CRUD API ─────────────────────────────────────────────────────────────
app.get('/leads', requireSession(), async (req, res) => {
  try {
    const all   = await db.sbGetLeads();
    const isDev = req.authSession?.role === 'developer';
    const leads = isDev ? all : all.filter(l => !l.invisible);
    res.json({ ok: true, leads });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const LEAD_COLS = new Set([
  'nombre','correo','telefono','fuente','etapa','pipeline_id','estado','valor',
  'propietario','ubicacion','nombre_lead','etiquetas','notas','tareas','pagos',
  'historial','meta_wa','metaWa','telefonos_extra','cita','quiere_entrevista',
  'sin_manager','unread_msg','webinar_email_enviado','webinar_accion','inscrito_webinar',
  'webinar_intent','webinar_visto_pct','webinar_tiempo_visto','fecha_inscripcion_webinar',
  'inscrito_por','seguidores','ia_paused','interview_state','pending_slots',
  'tiene_experiencia','tiene_papeles','mayor_edad','vio_webinar','disponibilidad',
  'contacto','link_webinar','webinar_pausas','webinar_completado','webinar_ultima_sesion',
  'webinar_ultimo_evento','quiere_entrevista_fecha','created_at','updated_at','invisible',
  'genero','solicita_entrevista','last_msg_ts',
  'resultado_entrevista','manager_entrevista','interview_slot',
]);
const LEAD_TS_COLS = new Set([
  'webinar_email_enviado','fecha_inscripcion_webinar','quiere_entrevista_fecha',
  'webinar_ultima_sesion','created_at','updated_at',
]);

function sanitizeLeadFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    // Empty string in a timestamptz column → null
    out[k] = (LEAD_TS_COLS.has(k) && v === '') ? null : v;
  }
  return out;
}

function isLeadContratado(lead) {
  if (!lead) return false;
  const e = (lead.etapa || '').toUpperCase();
  const r = (lead.resultado_entrevista || '').toLowerCase();
  return e.includes('CONTRATADO') || r === 'contratado';
}

const CONTRATADO_ALLOWED_FIELDS = new Set(['notas', 'historial', 'tareas', 'resultado_entrevista', 'manager_entrevista']);

app.patch('/leads/:id', requireSession(), async (req, res) => {
  const { id } = req.params;
  try {
    const raw = req.body || {};
    delete raw.id;

    // Check if lead is contratado — only allow notes/history/tasks
    const current = await db.sbGetLead(id);
    if (isLeadContratado(current)) {
      const allowed = Object.fromEntries(
        Object.entries(raw).filter(([k]) => CONTRATADO_ALLOWED_FIELDS.has(k))
      );
      if (!Object.keys(allowed).length) {
        return res.status(403).json({ ok: false, error: 'Lead contratado: solo se pueden agregar notas.' });
      }
      await db.sbUpdateLead(id, sanitizeLeadFields(allowed));
      return res.json({ ok: true });
    }

    const fields = sanitizeLeadFields(
      Object.fromEntries(Object.entries(raw).filter(([k]) => LEAD_COLS.has(k)))
    );
    await db.sbUpdateLead(id, fields);
    res.json({ ok: true });
  } catch (e) {
    console.error('[PATCH /leads] ERROR:', e.message, '| id:', req.params.id);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/leads', requireSession(), async (req, res) => {
  try {
    const raw = req.body || {};
    if (!raw.id) raw.id = `lead_${Date.now()}`;
    const lead = sanitizeLeadFields(
      Object.fromEntries(Object.entries(raw).filter(([k]) => k === 'id' || LEAD_COLS.has(k)))
    );
    await db.sbSaveLead(lead);
    res.json({ ok: true, id: lead.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Legal data deletion — removes lead + all associated data ──────────────────
app.delete('/leads/:id', requireSession(), async (req, res) => {
  const leadId = req.params.id;
  try {
    // 1. Read lead to get phone before deleting
    const lead  = await db.sbGetLead(leadId);
    const phone = lead?.telefono || '';

    // 2. Delete lead
    await db.sbDeleteLead(leadId);

    // 3. Delete conversation history keys
    const deleted = { lead: leadId, history: [], escalations: [] };
    if (phone) {
      const bare = phone.replace(/^whatsapp:\+?/, '').replace(/^\+/, '');
      for (const k of [phone, `+${bare}`, bare, `whatsapp:+${bare}`, `whatsapp:${bare}`, `wa_meta:${bare}`, `wa_meta:+${bare}`]) {
        if (conversationHistory.has(k)) { conversationHistory.delete(k); deleted.history.push(k); }
      }
    }

    // 4. Delete escalation records
    const escs = await db.sbGetEscalations();
    await Promise.all(
      escs.filter(r => r.lead_phone?.replace(/^\+/,'') === phone.replace(/^\+/,'') || r.data?.leadId === leadId)
        .map(async r => { await db.sbDeleteEscalation(r.id); deleted.escalations.push(r.id); })
    );

    // 5. Delete wa_messages
    if (phone) await db.sbDeleteWAMessages(phone);

    const ip  = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'desconocida';
    const who = req.authSession?.name || req.authSession?.userId || 'desconocido';
    console.log(`[Data Deletion] Lead ${leadId} eliminado por ${who} (IP: ${ip})`);
    res.json({ ok: true, deleted });
  } catch (e) {
    console.error('[Data Deletion] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Force Ana to re-read conversation and update lead fields ─────────────────
app.post('/leads/:id/extract', requireSession(), async (req, res) => {
  const leadId = req.params.id;
  try {
    const lead = await db.sbGetLead(leadId);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead no encontrado' });

    const phone = (lead.telefono || '').replace(/^\+/, '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ ok: false, error: 'Lead sin teléfono' });

    // Rebuild conversation history from Supabase wa_messages
    const stored  = await db.sbGetWAMessages(phone, 100);
    const merged  = [];
    for (const m of stored) {
      const role = m.direction === 'out' ? 'assistant' : 'user';
      if (merged.length && merged[merged.length - 1].role === role) {
        merged[merged.length - 1].content += '\n' + m.text;
      } else {
        merged.push({ role, content: m.text, ts: m.ts });
      }
    }

    if (merged.length < 1) return res.json({ ok: false, error: 'Este lead no tiene mensajes de WhatsApp registrados' });

    const { extractAndUpdateLead } = require('./pipeline');
    const convKey = `wa_meta:${phone}`;

    // Inject into in-memory history so extractAndUpdateLead can use it
    const { conversationHistory } = require('./ai');
    conversationHistory.set(convKey, merged);

    await extractAndUpdateLead(convKey, merged, null);

    const updated = await db.sbGetLead(leadId);
    res.json({ ok: true, lead: updated });
  } catch (e) {
    console.error('[Extract] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Public webinar registration (no auth — public form) ──────────────────────
app.post('/webinar/register', async (req, res) => {
  const { leadId, nombre, telefono, correo, now } = req.body;
  if (!leadId || !nombre || !telefono || !correo) {
    return res.status(400).json({ ok: false, error: 'Campos requeridos: leadId, nombre, telefono, correo' });
  }
  const createdAt = now || new Date().toISOString();
  const WEBINAR_URL = process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';
  try {
    await db.sbSaveLead({
      id: leadId, nombre, telefono, correo,
      fuente:      'Registro Webinar',
      etapa:       'En Webinar sin actividad',
      pipeline_id: 'en-webinar',
      estado:      'abierto',
      valor:       0,
      propietario: 'Ana (IA)',
      link_webinar: WEBINAR_URL,
      created_at:  createdAt,
      notas: [], tareas: [], pagos: [], etiquetas: [],
      historial: [{ icono:'📝', accion:'Lead registrado vía formulario público del webinar', fecha: createdAt, usuario:'Formulario Web' }],
    });
    res.json({ ok: true, leadId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Public webinar tracking (no auth — candidates use this) ──────────────────
app.post('/webinar/track/:leadId', async (req, res) => {
  const { leadId } = req.params;
  const ALLOWED = ['webinar_visto_pct','webinar_tiempo_visto','webinar_pausas',
    'webinar_completado','webinar_ultima_sesion','webinar_ultimo_evento',
    'quiere_entrevista','quiere_entrevista_fecha','vio_webinar'];
  const fields = {};
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }
  if (!Object.keys(fields).length) return res.json({ ok: true });
  try {
    await db.sbUpdateLead(leadId, fields);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/',        (req, res) => res.json({ status: 'ok', service: 'Elite Webinar Bot' }));
app.get('/health',  (req, res) => res.json({ status: 'ok' }));
app.get('/version', (req, res) => res.json({ v: SERVER_START_TIME }));

// ── Send webinar email manually (from CRM button) ─────────────────────────────
app.post('/send-webinar-email', async (req, res) => {
  const { correo, nombre, personalUrl } = req.body;
  if (!correo) return res.status(400).json({ ok: false, error: 'correo requerido' });
  if (!RESEND_API_KEY) {
    console.error('[Email] RESEND_API_KEY no configurado en variables de entorno');
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY no configurado en Railway' });
  }
  const { sendWebinarEmail } = require('./pipeline');
  const url = personalUrl || WEBINAR_URL;
  const ok  = await sendWebinarEmail(correo, nombre || '', url);
  if (!ok) return res.status(500).json({ ok: false, error: 'Fallo al enviar — revisa logs del servidor' });
  res.json({ ok: true });
});

// ── Test email ────────────────────────────────────────────────────────────────
app.get('/test-email', async (req, res) => {
  if (!RESEND_API_KEY) {
    return res.json({ ok: false, error: 'RESEND_API_KEY no configurado', hint: 'Agrega RESEND_API_KEY en Railway variables de entorno' });
  }
  const destino = req.query.to || process.env.EMAIL_FROM || 'gonzalezluis@grupoelitework.com';
  const { sendWebinarEmail } = require('./pipeline');
  const ok = await sendWebinarEmail(destino, 'Prueba', 'https://crm.grupoelitework.com/webinar.html');
  res.json({ ok, enviado_a: destino, mensaje: ok ? '✅ Correo enviado exitosamente' : '❌ Falló — revisa logs de Railway' });
});

// ── Meta (WhatsApp Cloud API + Instagram + Messenger) ─────────────────────────
registerMetaRoutes(app);

// ── IVR phone menu ────────────────────────────────────────────────────────────
registerIvrRoutes(app, {
  SERVER_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  loadManagers,
  triggerEscalation,
  askClaude,
  _genTTS,
});

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

// ── Merge duplicate leads (same phone) ───────────────────────────────────────
// ── Backup / Restore ─────────────────────────────────────────────────────────
app.get('/admin/backup', requireSession('developer'), async (req, res) => {
  try {
    const leads    = await db.sbGetLeads();
    const messages = await db.sbGetAllWAMessages();
    const config   = await db.sbGetConfig('automation_config').catch(() => null);
    const backup = {
      version:   2,
      exportedAt: new Date().toISOString(),
      leads,
      wa_messages: messages,
      automation_config: config,
    };
    res.setHeader('Content-Disposition', `attachment; filename="elite-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/restore', requireSession('developer'), async (req, res) => {
  try {
    const { leads = [], wa_messages = [], automation_config } = req.body;
    let restoredLeads = 0, restoredMsgs = 0;
    for (const lead of leads) {
      await db.sbSaveLead(lead).catch(e => console.warn('[Restore] lead', lead.id, e.message));
      restoredLeads++;
    }
    for (const msg of wa_messages) {
      await db.sbLogWAMessage(msg).catch(e => console.warn('[Restore] msg', msg.id, e.message));
      restoredMsgs++;
    }
    if (automation_config) {
      await db.sbSetConfig('automation_config', automation_config).catch(() => {});
    }
    res.json({ ok: true, restoredLeads, restoredMsgs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/fix-contratado-etapa', requireSession('developer'), async (req, res) => {
  try {
    const all = await db.sbGetLeads();
    const broken = all.filter(l => l.etapa === 'CONTRATADO' && l.pipeline_id === 'entrevistas-generales');
    for (const l of broken) {
      await db.sbUpdateLead(l.id, { etapa: 'Contratados Personales' });
    }
    res.json({ ok: true, fixed: broken.length, ids: broken.map(l => l.id) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/merge-duplicates', requireSession('developer'), async (req, res) => {
  try {
    const allLeads = await db.sbGetLeads();
    const byPhone  = {};
    for (const l of allLeads) {
      if (!l.telefono) continue;
      const key = l.telefono.replace(/\D/g,'').slice(-10);
      if (!key || key.length < 7) continue;
      if (!byPhone[key]) byPhone[key] = [];
      byPhone[key].push(l);
    }
    const dupes = Object.values(byPhone).filter(g => g.length > 1);
    if (req.query.dryRun === '1') {
      return res.json({ ok: true, duplicateGroups: dupes.length, preview: dupes.map(g => g.map(l => ({ id: l.id, nombre: l.nombre, pipeline_id: l.pipeline_id, created_at: l.created_at }))) });
    }
    let merged = 0;
    for (const group of dupes) {
      // Keep the most complete lead (prefer meta_make > lead-wa, or the one with more fields)
      group.sort((a, b) => {
        const scoreA = (a.correo?1:0) + (a.ubicacion?1:0) + (a.ad_nombre?1:0) + (a.id.startsWith('meta_make')?2:0);
        const scoreB = (b.correo?1:0) + (b.ubicacion?1:0) + (b.ad_nombre?1:0) + (b.id.startsWith('meta_make')?2:0);
        return scoreB - scoreA;
      });
      const [keep, ...rest] = group;
      // Merge missing fields from duplicates into keep
      const updates = {};
      for (const dup of rest) {
        if (!keep.correo    && dup.correo)    updates.correo    = dup.correo;
        if (!keep.ubicacion && dup.ubicacion) updates.ubicacion = dup.ubicacion;
        if (!keep.ad_nombre && dup.ad_nombre) updates.ad_nombre = dup.ad_nombre;
        if (!keep.fuente    && dup.fuente)    updates.fuente    = dup.fuente;
        // Delete duplicates
        await db.sbDeleteLead(dup.id).catch(e => console.warn('[Merge] delete err:', e.message));
      }
      if (Object.keys(updates).length) await db.sbUpdateLead(keep.id, updates).catch(() => {});
      merged++;
    }
    res.json({ ok: true, mergedGroups: merged });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nElite Webinar Bot corriendo en puerto ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health\n`);
});
