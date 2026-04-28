// PLAYWRIGHT_BROWSERS_PATH se setea vía env var en render.yaml

const express  = require('express');
const cors     = require('cors');
const { chromium } = require('playwright');
const twilio   = require('twilio');

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
    const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, {
      identity: req.query.identity || 'agent',
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

// ── Twilio: TwiML — called by Twilio when agent dials ─────────────────────────
app.post('/twilio/voice', (req, res) => {
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  const to = req.body.To;
  if (to) {
    const callerId = pickCallerId(to);
    console.log(`[Twilio] Llamando a ${to} → caller ID: ${callerId}`);
    const dial = twiml.dial({ callerId, timeout: 30, record: 'do-not-record' });
    dial.number(to);
  } else {
    twiml.say({ language: 'es-MX' }, 'No se especificó un número de destino.');
  }
  res.type('text/xml');
  res.send(twiml.toString());
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
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ ok: false, error: 'phone requerido' });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.status(500).json({ ok: false, error: 'Twilio no configurado' });
  try {
    const client   = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const messages = await client.messages.list({ to: TWILIO_PHONE_NUMBER, from: phone, limit: 50 });
    res.json({
      ok: true,
      messages: messages.map(m => ({
        sid:       m.sid,
        body:      m.body,
        direction: 'inbound',
        date:      m.dateSent?.toISOString() || new Date().toISOString(),
      }))
    });
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
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ ok: false, error: 'phone requerido' });
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return res.status(500).json({ ok: false, error: 'Twilio no configurado' });
  try {
    const client   = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const fromWa   = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
    const messages = await client.messages.list({ to: TWILIO_WA_FROM, from: fromWa, limit: 50 });
    res.json({
      ok: true,
      messages: messages.map(m => ({
        sid:       m.sid,
        body:      m.body,
        direction: 'inbound',
        status:    m.status,
        date:      m.dateSent?.toISOString() || new Date().toISOString(),
      }))
    });
  } catch (e) {
    console.error('[WA-Inbox] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── WhatsApp: Incoming webhook ────────────────────────────────────────────────
app.post('/twilio/whatsapp-incoming', (req, res) => {
  const { From, Body, MessageSid } = req.body;
  console.log(`[WA-IN] ${From}: ${Body} (${MessageSid})`);
  res.type('text/xml').send('<Response></Response>');
});

// ── SMS: Incoming webhook (Twilio calls this when a message is received) ──────
app.post('/twilio/sms-incoming', (req, res) => {
  const { From, Body, MessageSid } = req.body;
  console.log(`[SMS-IN] ${From}: ${Body} (${MessageSid})`);
  res.type('text/xml').send('<Response></Response>');
});

// ── Twilio: Call status callback (optional logging) ───────────────────────────
app.post('/twilio/status', (req, res) => {
  const { CallSid, CallStatus, To, Duration } = req.body;
  console.log(`[Twilio] ${CallSid} → ${To} | ${CallStatus} | ${Duration || 0}s`);
  res.sendStatus(200);
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
