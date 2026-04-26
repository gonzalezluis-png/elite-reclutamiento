const express  = require('express');
const cors     = require('cors');
const { chromium } = require('playwright');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

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
    await page.waitForSelector('input', { timeout: 15000 });

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

    // Enviar formulario
    const submitResult = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll('button[type="submit"]'),
        ...document.querySelectorAll('input[type="submit"]'),
        ...[...document.querySelectorAll('button, [role="button"]')].filter(el =>
          /registr|inscri|enviar|submit|sign.?up|apunt/i.test(el.innerText || el.value || '')
        ),
        ...document.querySelectorAll('form button'),
      ];
      if (!candidates.length) return null;
      candidates[0].click();
      return candidates[0].innerText || candidates[0].value || 'button';
    });

    if (!submitResult) throw new Error('No se encontró el botón de envío en la página');
    console.log(`  → Enviado con: "${submitResult}"`);

    // Esperar confirmación
    await Promise.race([
      page.waitForLoadState('networkidle', { timeout: 12000 }),
      page.waitForSelector('[class*="success"],[class*="confirm"],[class*="thank"],[class*="gracias"]', { timeout: 12000 }),
    ]).catch(() => console.warn('  → Timeout confirmación (asumiendo éxito)'));

    console.log(`  → URL final: ${page.url()}`);
    res.json({ ok: true, message: 'Registrado exitosamente', finalUrl: page.url() });

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
