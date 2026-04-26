const express = require('express');
const cors    = require('cors');
const puppeteer = require('puppeteer');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Elite Webinar Bot' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Registro automático ───────────────────────────────────────────────────────
app.post('/registrar-webinar', async (req, res) => {
  const { nombre = '', correo = '', telefono = '', ciudad = '', webinarUrl, extra = {} } = req.body;

  if (!webinarUrl) return res.status(400).json({ ok: false, error: 'webinarUrl es requerida' });
  if (!correo)     return res.status(400).json({ ok: false, error: 'correo es requerido' });

  console.log(`\n[${new Date().toISOString()}] Registrando: ${nombre} <${correo}>`);
  console.log(`  URL: ${webinarUrl}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(webinarUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input', { timeout: 15000 });

    // Llena un campo probando una lista de selectores en orden
    async function fill(selectors, value) {
      if (!value) return false;
      for (const sel of selectors) {
        try {
          const el = await page.$(sel);
          if (!el) continue;
          const box = await el.boundingBox();
          if (!box) continue;
          await el.click({ clickCount: 3 });
          await delay(80);
          await el.type(String(value), { delay: 35 });
          console.log(`  ✓ ${sel} = "${value}"`);
          return true;
        } catch {}
      }
      console.warn(`  ✗ No encontrado para: "${value}"`);
      return false;
    }

    // Nombre
    await fill([
      'input[name="first_name"]',
      'input[name="name"]',
      'input[name="full_name"]',
      'input[name="fullname"]',
      'input[placeholder*="nombre" i]',
      'input[placeholder*="name" i]',
      'input[id*="name" i]:not([id*="last" i]):not([id*="sur" i])',
      'form input[type="text"]:nth-of-type(1)',
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

    // Campos fijos (manager, referido por, etc.)
    for (const [label, value] of Object.entries(extra)) {
      if (!value) continue;
      await fill([
        `input[name="${label}"]`,
        `input[placeholder*="${label}" i]`,
        `select[name="${label}"]`,
        `textarea[name="${label}"]`,
      ], value);
    }

    await delay(500);

    // Enviar formulario
    const submitted = await page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll('button[type="submit"]'),
        ...document.querySelectorAll('input[type="submit"]'),
        ...[...document.querySelectorAll('button, [role="button"]')].filter(el =>
          /registr|inscri|enviar|submit|sign.?up|apunt/i.test(el.innerText || el.value || '')
        ),
        ...document.querySelectorAll('form button'),
      ];
      if (!candidates.length) return null;
      const btn = candidates[0];
      btn.click();
      return btn.innerText || btn.value || 'button';
    });

    if (!submitted) {
      throw new Error('No se encontró el botón de envío en la página');
    }
    console.log(`  → Enviado con: "${submitted}"`);

    // Esperar confirmación (navegación o mensaje de éxito)
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 12000 }),
      page.waitForSelector(
        '[class*="success"], [class*="confirm"], [class*="thank"], [class*="gracias"]',
        { timeout: 12000 }
      ),
    ]).catch(() => console.warn('  → Timeout esperando confirmación (asumiendo éxito)'));

    const finalUrl = page.url();
    console.log(`  → URL final: ${finalUrl}`);

    res.json({ ok: true, message: 'Registrado exitosamente', finalUrl });

  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

app.listen(PORT, () => {
  console.log(`\nElite Webinar Bot corriendo en puerto ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health\n`);
});
