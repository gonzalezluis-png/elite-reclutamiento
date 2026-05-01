// Shared WA pipeline: lead management, webinar detection, Playwright registration

const nodemailer = require('nodemailer');
const Anthropic  = require('@anthropic-ai/sdk');

const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

// Phones that already received a webinar invite this session
const webinarInviteSent = new Set();

// ── Utils ─────────────────────────────────────────────────────────────────────
function toE164(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return digits ? `+${digits}` : raw;
}

// Extract the raw phone number from any key format
function rawPhone(from) {
  return from.replace(/^wa_meta:/, '').replace(/^whatsapp:/, '');
}

// ── Firestore helpers ─────────────────────────────────────────────────────────
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsVal(x)])) } };
  return { stringValue: String(v) };
}

async function fsUpdateLeadFields(leadId, fields) {
  const mask = Object.keys(fields).join('&updateMask.fieldPaths=');
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fsVal(v)])) };
  await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}&updateMask.fieldPaths=${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function fsGetLeadByPhone(phone) {
  try {
    const data = await fetch(`${FS_BASE}/leads?key=${FS_KEY}&pageSize=500`).then(r => r.json());
    const normalized = toE164(phone);
    return (data.documents || []).find(doc => {
      const tel = doc.fields?.telefono?.stringValue || '';
      return toE164(tel) === normalized;
    }) || null;
  } catch { return null; }
}

async function fsLeadExists(phone) {
  return !!(await fsGetLeadByPhone(phone));
}

async function fsCreateLeadWA(from) {
  const phone = rawPhone(from);
  const id    = 'lead-wa-' + Date.now();
  const now   = new Date().toISOString();
  const doc   = {
    fields: {
      nombre:      fsVal(`WA ${phone}`),
      telefono:    fsVal(toE164(phone)),
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

// ── AI: extract lead data from conversation ───────────────────────────────────
async function extractAndUpdateLead(from, history) {
  try {
    const messages = history.slice(-14).map(({ role, content }) => ({ role, content }));
    if (messages.length < 2) return;

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
    try {
      let raw = extraction.content[0].text.trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) raw = match[0];
      extracted = JSON.parse(raw);
      console.log(`[AI-Extract] Extraído para ${from}:`, extracted);
    } catch (e) {
      console.error(`[AI-Extract] JSON parse error:`, extraction.content[0].text.slice(0, 200));
      return;
    }

    if (!Object.values(extracted).some(v => v !== null)) return;

    const phone = rawPhone(from);
    const doc   = await fsGetLeadByPhone(phone);
    if (!doc) { console.error(`[AI-Extract] Lead no encontrado para ${phone}`); return; }

    const leadId   = doc.name.split('/').pop();
    const existing = doc.fields || {};
    const updates  = {};

    const existingNombre = existing.nombre?.stringValue || '';
    const isAutoName = !existingNombre || existingNombre.startsWith('WA ') || existingNombre.startsWith('+');
    if (extracted.nombre        && isAutoName)                              updates.nombre         = extracted.nombre;
    if (extracted.correo        && !existing.correo?.stringValue)           updates.correo         = extracted.correo;
    if (extracted.ubicacion     && !existing.ubicacion?.stringValue)        updates.ubicacion      = extracted.ubicacion;
    if (extracted.disponibilidad && !existing.disponibilidad?.stringValue)  updates.disponibilidad = extracted.disponibilidad;

    if (!Object.keys(updates).length) return;
    await fsUpdateLeadFields(leadId, updates);
    console.log(`[AI-Extract] Lead ${leadId} actualizado:`, updates);

    // If email was just captured, check if this lead needs webinar registration
    if (updates.correo) {
      const allFields = { ...existing };
      for (const [k, v] of Object.entries(updates)) allFields[k] = { stringValue: v };
      return { leadId, fields: allFields };
    }
  } catch (e) {
    console.error('[AI-Extract] Error:', e.message);
  }
  return null;
}

// ── AI: detect webinar intent ─────────────────────────────────────────────────
async function detectWebinarIntent(history) {
  try {
    const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

// ── Email: send webinar invitation ────────────────────────────────────────────
async function sendWebinarEmail(correo, nombre, WEBINAR_URL) {
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
  if (!SMTP_USER || !SMTP_PASS || !correo) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"Grupo Elite Work LLC" <${SMTP_USER}>`,
      to:   correo,
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

// ── Move lead to webinar pipeline + Playwright registration ───────────────────
// sendFn: async (to, text) — channel-specific send function
async function moveLeadToWebinar(leadId, nombre, correo, { phone, sendFn, SERVER_URL, WEBINAR_URL }) {
  try {
    const now = new Date().toISOString();
    await fsUpdateLeadFields(leadId, { pipeline_id: 'en-webinar', etapa: 'Inscrito en Webinar' });

    const doc  = await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}`).then(r => r.json());
    const hist = (doc.fields?.historial?.arrayValue?.values || []).map(v => ({
      icono:   v.mapValue?.fields?.icono?.stringValue   || '📋',
      accion:  v.mapValue?.fields?.accion?.stringValue  || '',
      fecha:   v.mapValue?.fields?.fecha?.stringValue   || now,
      usuario: v.mapValue?.fields?.usuario?.stringValue || '',
    }));
    hist.push({ icono: '🎥', accion: 'Inscrito en Webinar automáticamente por Ana (IA)', fecha: now, usuario: 'Ana (IA)' });
    await fsUpdateLeadFields(leadId, { historial: hist });
    console.log(`[Webinar] Lead ${leadId} movido a Inscrito en Webinar`);

    // Auto-register via Playwright if name and email are known
    if (nombre && correo && !nombre.startsWith('WA ') && !nombre.startsWith('+')) {
      const phoneRaw = rawPhone(phone);
      try {
        const r = await fetch(`${SERVER_URL}/registrar-webinar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, correo, telefono: phoneRaw, webinarUrl: WEBINAR_URL }),
        });
        const d = await r.json();
        if (d.ok) {
          console.log(`[Webinar] Auto-registrado: ${nombre} <${correo}> → ${d.finalUrl}`);
          const personalUrl = d.finalUrl && d.finalUrl !== WEBINAR_URL ? d.finalUrl : null;
          // Save personalized link to Firestore
          await fsUpdateLeadFields(leadId, { link_webinar: personalUrl || WEBINAR_URL });
          // Send personalized link if different from the static one already sent
          if (personalUrl && sendFn) {
            await sendFn(phone, `✅ Quedaste inscrito/a exitosamente. Aquí está tu enlace personal al webinar:\n${personalUrl}`);
          }
        } else {
          console.warn('[Webinar] Auto-registro falló:', d.error);
          await fsUpdateLeadFields(leadId, { link_webinar: WEBINAR_URL });
        }
      } catch (e) {
        console.error('[Webinar] Error en auto-registro:', e.message);
        await fsUpdateLeadFields(leadId, { link_webinar: WEBINAR_URL });
      }
    }
  } catch (e) {
    console.error('[Webinar] Error moviendo lead:', e.message);
  }
}

// ── Full background WA pipeline ───────────────────────────────────────────────
// Call this after replying to a WhatsApp message.
// from:    conversationHistory key (e.g. "wa_meta:521..." or "whatsapp:+1...")
// history: the Map from conversationHistory
// sendFn:  async (to, text) → sends WA message back to the user
// opts:    { SERVER_URL, WEBINAR_URL }
async function runWAPipeline(from, historyMap, sendFn, opts) {
  const { SERVER_URL, WEBINAR_URL } = opts;
  const history = historyMap.get(from) || [];

  try {
    const extractResult = await extractAndUpdateLead(from, history);

    if (!webinarInviteSent.has(from)) {
      const wantsWebinar = await detectWebinarIntent(history);
      if (wantsWebinar) {
        webinarInviteSent.add(from);

        const phone = rawPhone(from);
        const doc   = await fsGetLeadByPhone(phone);
        if (doc) {
          const leadId = doc.name.split('/').pop();
          const f      = doc.fields || {};
          const nombre = f.nombre?.stringValue || '';
          const correo = f.correo?.stringValue || '';

          // Send static link immediately so user isn't waiting on Playwright
          await sendFn(from, `🎥 Aquí está el link de tu webinar informativo:\n${WEBINAR_URL}\n\nEs gratuito y dura aproximadamente 60 minutos. ¡Cualquier duda estoy aquí!`);

          // Send email invitation if we have the address
          if (correo) await sendWebinarEmail(correo, nombre, WEBINAR_URL);

          // Move lead pipeline + run Playwright (sends personalized link when done)
          await moveLeadToWebinar(leadId, nombre, correo, { phone: from, sendFn, SERVER_URL, WEBINAR_URL });
        }
      }
    }
  } catch (e) {
    console.error('[Pipeline] Error:', e.message);
  }
}

module.exports = {
  toE164,
  rawPhone,
  fsVal,
  fsUpdateLeadFields,
  fsGetLeadByPhone,
  fsLeadExists,
  fsCreateLeadWA,
  webinarInviteSent,
  extractAndUpdateLead,
  detectWebinarIntent,
  sendWebinarEmail,
  moveLeadToWebinar,
  runWAPipeline,
};
