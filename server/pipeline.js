// Shared WA pipeline: lead management, webinar detection, Playwright registration

// nodemailer removed — using Resend API
const Anthropic  = require('@anthropic-ai/sdk');

const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

// Phones that already received a webinar invite this session
const webinarInviteSent = new Set();

// ── Human-like typing delay ───────────────────────────────────────────────────
// ~50 ms per character, min 2 s, max 40 s, with ±25 % random jitter
function humanDelay(text) {
  const len  = (text || '').length;
  const base = 2000 + len * 50;              // 2 s + 50 ms/char
  const ms   = Math.min(base, 40000);        // cap at 40 s
  const jitter = ms * (0.75 + Math.random() * 0.5); // ±25 %
  return new Promise(resolve => setTimeout(resolve, Math.round(jitter)));
}

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
  "disponibilidad": "tiempo completo / parcial / descripción o null",
  "tiene_experiencia": true/false/null,
  "tiene_papeles": true/false/null,
  "mayor_edad": true/false/null
}
- tiene_experiencia: true si el candidato mencionó experiencia laboral o trabajo previo. false si dijo que no tiene experiencia. null si no se mencionó.
- tiene_papeles: true si confirmó que tiene documentos legales para trabajar (SSN, permiso, ciudadanía, etc). false si dijo que no. null si no se mencionó.
- mayor_edad: true si es mayor de 18 años. false si es menor. null si no se sabe.
Solo incluye campos que el candidato haya mencionado explícitamente. Si no hay info clara, pon null.`,
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
    if (extracted.nombre         && isAutoName)                               updates.nombre          = extracted.nombre;
    if (extracted.correo         && !existing.correo?.stringValue)            updates.correo          = extracted.correo;
    if (extracted.ubicacion      && !existing.ubicacion?.stringValue)         updates.ubicacion       = extracted.ubicacion;
    if (extracted.disponibilidad && !existing.disponibilidad?.stringValue)    updates.disponibilidad  = extracted.disponibilidad;
    if (extracted.tiene_experiencia !== null && extracted.tiene_experiencia !== undefined && existing.tiene_experiencia?.booleanValue !== true)
                                                                              updates.tiene_experiencia = extracted.tiene_experiencia;
    if (extracted.tiene_papeles !== null && extracted.tiene_papeles !== undefined && existing.tiene_papeles?.booleanValue !== true)
                                                                              updates.tiene_papeles   = extracted.tiene_papeles;
    if (extracted.mayor_edad !== null && extracted.mayor_edad !== undefined && existing.mayor_edad?.booleanValue !== true)
                                                                              updates.mayor_edad      = extracted.mayor_edad;

    if (!Object.keys(updates).length) return null;
    await fsUpdateLeadFields(leadId, updates);
    console.log(`[AI-Extract] Lead ${leadId} actualizado:`, updates);

    // If correo was just captured and lead had pending webinar intent → register now
    if (updates.correo) {
      const nombre       = updates.nombre || existing.nombre?.stringValue || '';
      const correo       = updates.correo;
      const pipelineId   = existing.pipeline_id?.stringValue || '';
      const webinarIntent = existing.webinar_intent?.booleanValue || false;

      if (webinarIntent && pipelineId !== 'en-webinar' &&
          nombre && !nombre.startsWith('WA ') && !nombre.startsWith('+')) {
        console.log(`[AI-Extract] Correo recibido con webinar_intent pendiente — registrando ${leadId}`);
        await fsUpdateLeadFields(leadId, { webinar_intent: false });
        const WEBINAR_URL = process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';
        await moveLeadToWebinar(leadId, nombre, correo, WEBINAR_URL);
      }
    }
    return null;
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
async function sendWebinarEmail(correo, nombre, webinarUrl) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('[Email] RESEND_API_KEY no configurado');
    return false;
  }
  if (!correo) {
    console.warn('[Email] No se proporcionó correo destinatario');
    return false;
  }
  const FROM_EMAIL = process.env.EMAIL_FROM || 'webinar@grupoelitework.com';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Grupo Elite Work LLC <${FROM_EMAIL}>`,
        to:   [correo],
        subject: '🎥 Tu acceso al Webinar — Grupo Elite Work LLC',
        html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px;">
          <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px;border-radius:10px;text-align:center;margin-bottom:24px;">
            <h1 style="color:#fff;margin:0;font-size:22px;">Grupo Elite Work LLC</h1>
            <p style="color:#94a3b8;margin:8px 0 0;">Oportunidad de Carrera — Globe Life Insurance</p>
          </div>
          <h2 style="color:#1e293b;">¡Hola${nombre ? ', ' + nombre : ''}! 👋</h2>
          <p style="color:#475569;line-height:1.6;">Nos da mucho gusto que estés interesado/a en nuestra oportunidad. Te compartimos tu acceso personal al <strong>webinar informativo virtual</strong> donde aprenderás todo sobre cómo construir una carrera exitosa como agente de seguros de vida.</p>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin:20px 0;">
            <h3 style="color:#1e293b;margin:0 0 12px;">¿Qué verás en el webinar?</h3>
            <ul style="color:#475569;line-height:1.8;padding-left:20px;">
              <li>Cómo funciona el modelo de trabajo remoto</li>
              <li>Estructura de comisiones y potencial de ingresos</li>
              <li>Proceso para obtener tu licencia estatal</li>
              <li>Preguntas y respuestas frecuentes</li>
            </ul>
          </div>
          <div style="text-align:center;margin:28px 0;">
            <a href="${webinarUrl}" style="background:linear-gradient(135deg,#0073ea,#0059b3);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;display:inline-block;">
              🎥 Ver Webinar Ahora
            </a>
          </div>
          <p style="color:#64748b;font-size:13px;text-align:center;">Este link es personal y único para ti. Si tienes preguntas, responde a este correo o escríbenos por WhatsApp.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
          <p style="color:#94a3b8;font-size:11px;text-align:center;">Grupo Elite Work LLC — Globe Life Insurance</p>
        </div>`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[Email] Resend error:', JSON.stringify(data));
      return false;
    }
    console.log(`[Email] Enviado a ${correo} (id: ${data.id})`);
    return true;
  } catch (e) {
    console.error('[Email] Error:', e.message);
    return false;
  }
}

// ── Move lead to webinar: generate personalized link, save, send email ────────
// Returns the personalized webinar URL
async function moveLeadToWebinar(leadId, nombre, correo, baseWebinarUrl) {
  try {
    const now = new Date().toISOString();

    // Build personalized URL so webinar.html can track this specific viewer
    const personalUrl = `${baseWebinarUrl}?id=${leadId}&nombre=${encodeURIComponent(nombre)}&correo=${encodeURIComponent(correo)}`;

    await fsUpdateLeadFields(leadId, {
      pipeline_id:  'en-webinar',
      etapa:        'Inscrito en Webinar',
      link_webinar: personalUrl,
    });

    // Append historial entry
    const doc  = await fetch(`${FS_BASE}/leads/${leadId}?key=${FS_KEY}`).then(r => r.json());
    const hist = (doc.fields?.historial?.arrayValue?.values || []).map(v => ({
      icono:   v.mapValue?.fields?.icono?.stringValue   || '📋',
      accion:  v.mapValue?.fields?.accion?.stringValue  || '',
      fecha:   v.mapValue?.fields?.fecha?.stringValue   || now,
      usuario: v.mapValue?.fields?.usuario?.stringValue || '',
    }));
    hist.push({ icono: '🎥', accion: 'Inscrito en Webinar — link personalizado generado y enviado por correo', fecha: now, usuario: 'Ana (IA)' });
    await fsUpdateLeadFields(leadId, { historial: hist });

    // Send email with personalized link
    await sendWebinarEmail(correo, nombre, personalUrl);

    console.log(`[Webinar] Lead ${leadId} → en-webinar | link: ${personalUrl}`);
    return personalUrl;
  } catch (e) {
    console.error('[Webinar] Error:', e.message);
    return baseWebinarUrl;
  }
}

// ── Full background WA pipeline ───────────────────────────────────────────────
// from:   conversationHistory key ("wa_meta:521..." or "whatsapp:+1...")
// sendFn: async (to, text) — channel-specific send function (NOT used for link)
// opts:   { WEBINAR_URL }
async function runWAPipeline(from, historyMap, sendFn, opts) {
  const { WEBINAR_URL } = opts;
  const history = historyMap.get(from) || [];

  try {
    // Always try to extract/update lead data from the conversation
    await extractAndUpdateLead(from, history);

    // Get lead doc to check current state
    const phone = rawPhone(from);
    const doc   = await fsGetLeadByPhone(phone);
    if (!doc) return;

    const f           = doc.fields || {};
    const pipelineId  = f.pipeline_id?.stringValue || '';
    const nombre      = f.nombre?.stringValue || '';
    const correo      = f.correo?.stringValue || '';
    const leadId      = doc.name.split('/').pop();

    // Skip if already registered
    if (pipelineId === 'en-webinar' || webinarInviteSent.has(from)) return;

    const webinarIntent = f.webinar_intent?.booleanValue || false;
    const wantsWebinar  = webinarIntent || await detectWebinarIntent(history);

    if (wantsWebinar) {
      if (!correo || !nombre || nombre.startsWith('WA ') || nombre.startsWith('+')) {
        // Save intent flag to Firestore so it persists across restarts and
        // is picked up automatically when the correo arrives later
        if (!webinarIntent) {
          await fsUpdateLeadFields(leadId, { webinar_intent: true });
          console.log(`[Pipeline] Intención webinar guardada para ${from} — esperando correo`);
        }
        return;
      }

      webinarInviteSent.add(from);
      // Clear the flag now that we're processing it
      await fsUpdateLeadFields(leadId, { webinar_intent: false });
      await moveLeadToWebinar(leadId, nombre, correo, WEBINAR_URL);
    }
  } catch (e) {
    console.error('[Pipeline] Error:', e.message);
  }
}

module.exports = {
  humanDelay,
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
