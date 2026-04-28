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

// ── Twilio: TwiML — called by Twilio when agent dials ─────────────────────────
app.post('/twilio/voice', (req, res) => {
  const { VoiceResponse } = twilio.twiml;
  const twiml = new VoiceResponse();
  const to = req.body.To;
  if (to) {
    const dial = twiml.dial({ callerId: TWILIO_PHONE_NUMBER, timeout: 30, record: 'do-not-record' });
    dial.number(to);
  } else {
    twiml.say({ language: 'es-MX' }, 'No se especificó un número de destino.');
  }
  res.type('text/xml');
  res.send(twiml.toString());
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
