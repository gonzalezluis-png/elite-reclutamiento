// Shared WA pipeline: lead management, webinar detection, Playwright registration

const Anthropic  = require('@anthropic-ai/sdk');
const { pixelWebinar } = require('./pixel');
const db = require('./db');

// Phones that already received a webinar invite this session
const webinarInviteSent = new Set();

// ── Human-like typing delay ───────────────────────────────────────────────────
function humanDelay(text) {
  const len    = (text || '').length;
  const base   = 2000 + len * 50;
  const ms     = Math.min(base, 40000);
  const jitter = ms * (0.75 + Math.random() * 0.5);
  return new Promise(resolve => setTimeout(resolve, Math.round(jitter)));
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function toE164(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return digits ? `+${digits}` : raw;
}

function rawPhone(from) {
  return from.replace(/^wa_meta:/, '').replace(/^whatsapp:/, '');
}

// ── Phone → leadId in-memory cache ───────────────────────────────────────────
const _phoneLeadCache = new Map();

function _cachePhone(phone, leadId) {
  _phoneLeadCache.set(toE164(rawPhone(phone)), leadId);
}

// ── Lead operations (Supabase) ────────────────────────────────────────────────
async function fsUpdateLeadFields(leadId, fields) {
  await db.sbUpdateLead(leadId, fields);
}

async function fsGetLeadByPhone(phone) {
  const normalized = toE164(rawPhone(phone));
  const cachedId   = _phoneLeadCache.get(normalized);
  if (cachedId) {
    const lead = await db.sbGetLead(cachedId);
    if (lead) return lead;
  }
  const lead = await db.sbGetLeadByPhone(phone);
  if (lead) _cachePhone(phone, lead.id);
  return lead;
}

async function fsLeadExists(phone) {
  return !!(await fsGetLeadByPhone(phone));
}

async function fsCreateLeadWA(from) {
  const phone = rawPhone(from);
  const id    = 'lead-wa-' + Date.now();
  _cachePhone(phone, id);
  const now   = new Date().toISOString();
  const lead  = {
    id,
    nombre:      `WA ${phone}`,
    telefono:    toE164(phone),
    fuente:      'WhatsApp',
    etapa:       'New Lead',
    pipeline_id: 'postulados-whatsapp-meta',
    estado:      'abierto',
    valor:       0,
    propietario: 'Ana (IA)',
    created_at:  now,
    notas:       [],
    tareas:      [],
    pagos:       [],
    etiquetas:   [],
    historial:   [{ icono: '📱', accion: 'Lead creado automáticamente por WhatsApp entrante', fecha: now, usuario: 'Ana (IA)' }],
    metaWa:      [],
  };
  try {
    await db.sbSaveLead(lead);
    console.log(`[WA-AI] Lead auto-creado: ${id} para ${phone}`);
  } catch (e) {
    console.error('[WA-AI] Error creando lead:', e.message);
  }
}

async function fsAppendLeadMetaWa(phone, message) {
  try {
    const normalized = toE164(rawPhone(phone));
    let leadId = _phoneLeadCache.get(normalized);
    if (!leadId) {
      const lead = await fsGetLeadByPhone(phone);
      if (!lead) return;
      leadId = lead.id;
    }
    const lead     = await db.sbGetLead(leadId);
    const existing = Array.isArray(lead?.metaWa) ? [...lead.metaWa] : [];
    const idx      = existing.findIndex(m => m.sid === message.sid);
    if (idx >= 0) {
      if (message.status)     existing[idx].status     = message.status;
      if (message.error_code) existing[idx].error_code = message.error_code;
    } else {
      existing.push(message);
    }
    await db.sbUpdateLead(leadId, { metaWa: existing });
  } catch(e) {
    console.warn('[metaWa sync]', e.message);
  }
}

// ── AI: extract lead data from conversation ───────────────────────────────────
async function extractAndUpdateLead(from, history) {
  try {
    const messages = history
      .filter(m => !m.content?.startsWith('[SISTEMA'))
      .slice(-14)
      .map(({ role, content }) => ({ role, content }));
    if (messages.length < 2) return;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const extraction = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Eres un extractor de datos. Analiza la conversación y extrae información del candidato.
Responde ÚNICAMENTE con el objeto JSON, sin texto antes ni después, sin markdown, sin explicaciones.
Campos a extraer:
- nombre: nombre completo del candidato o null
- correo: email o null
- ubicacion: ciudad y estado/país o null
- disponibilidad: "tiempo completo" / "parcial" / descripción o null
- tiene_experiencia: true si mencionó experiencia laboral. false si dijo que no. null si no se sabe.
- tiene_papeles: true si confirmó documentos legales (SSN, permiso, ciudadanía). false si dijo que no. null si no se sabe.
- mayor_edad: true si es mayor de 18. false si es menor. null si no se sabe.
- webinar_intent: true si mostró interés en ver el webinar o dio correo para el link. false si lo rechazó. null si no aplica.
- vio_webinar: true si confirmó que ya vio el webinar. false si dijo que no. null si no se sabe.
Si no hay información clara para un campo, pon null. SOLO JSON, nada más.`,
      messages: [...messages, { role: 'assistant', content: '{' }],
    });

    let extracted;
    try {
      if (!extraction.content?.[0]?.text) return;
      let raw = ('{' + extraction.content[0].text).trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) raw = match[0];
      extracted = JSON.parse(raw);
      console.log(`[AI-Extract] Extraído para ${from}:`, extracted);
    } catch (e) {
      console.error(`[AI-Extract] JSON parse error:`, extraction.content[0]?.text?.slice(0, 200));
      return;
    }

    if (!Object.values(extracted).some(v => v !== null)) return;

    const phone = rawPhone(from);
    const lead  = await fsGetLeadByPhone(phone);
    if (!lead) { console.error(`[AI-Extract] Lead no encontrado para ${phone}`); return; }

    const updates = {};
    const isAutoName = !lead.nombre || lead.nombre.startsWith('WA ') || lead.nombre.startsWith('+');
    if (extracted.nombre         && isAutoName)          updates.nombre          = extracted.nombre;
    if (extracted.correo         && !lead.correo)        updates.correo          = extracted.correo;
    if (extracted.ubicacion      && !lead.ubicacion)     updates.ubicacion       = extracted.ubicacion;
    if (extracted.disponibilidad && !lead.disponibilidad) updates.disponibilidad = extracted.disponibilidad;
    if (extracted.tiene_experiencia !== null && extracted.tiene_experiencia !== undefined && lead.tiene_experiencia !== true)
                                                         updates.tiene_experiencia = extracted.tiene_experiencia;
    if (extracted.tiene_papeles !== null && extracted.tiene_papeles !== undefined && lead.tiene_papeles !== true)
                                                         updates.tiene_papeles   = extracted.tiene_papeles;
    if (extracted.mayor_edad !== null && extracted.mayor_edad !== undefined && lead.mayor_edad !== true)
                                                         updates.mayor_edad      = extracted.mayor_edad;
    if (extracted.vio_webinar === true && lead.vio_webinar !== true) {
                                                         updates.vio_webinar     = true;
                                                         updates.ia_paused       = true;
    }

    if (!Object.keys(updates).length) return null;
    await fsUpdateLeadFields(lead.id, updates);
    console.log(`[AI-Extract] Lead ${lead.id} actualizado:`, updates);

    const correoFinal     = updates.correo || lead.correo || '';
    const nombreFinal     = updates.nombre || lead.nombre || '';
    const pipelineId      = lead.pipeline_id || '';
    const intentExistente = lead.webinar_intent || false;
    const intentNuevo     = extracted.webinar_intent === true;
    const hayIntent       = intentExistente || intentNuevo;
    const nombreValido    = nombreFinal && !nombreFinal.startsWith('WA ') && !nombreFinal.startsWith('+');
    const displayName     = nombreValido ? nombreFinal : 'Candidato';

    if (hayIntent && correoFinal && pipelineId !== 'en-webinar') {
      console.log(`[AI-Extract] Intención + correo — registrando en webinar: ${lead.id}`);
      await fsUpdateLeadFields(lead.id, { webinar_intent: false });
      const WEBINAR_URL = process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';
      await moveLeadToWebinar(lead.id, displayName, correoFinal, WEBINAR_URL);
    } else if (intentNuevo && !correoFinal && !intentExistente) {
      await fsUpdateLeadFields(lead.id, { webinar_intent: true });
      console.log(`[AI-Extract] Intención webinar guardada para ${lead.id} — esperando correo`);
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
  if (!RESEND_API_KEY) { console.error('[Email] RESEND_API_KEY no configurado'); return false; }
  if (!correo)         { console.warn('[Email] No se proporcionó correo'); return false; }
  const FROM_EMAIL = process.env.EMAIL_FROM || 'webinar@grupoelitework.com';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
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
          <p style="color:#475569;line-height:1.6;">Te compartimos tu acceso personal al <strong>webinar informativo virtual</strong>.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${webinarUrl}" style="background:linear-gradient(135deg,#0073ea,#0059b3);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;display:inline-block;">
              🎥 Ver Webinar Ahora
            </a>
          </div>
          <p style="color:#94a3b8;font-size:11px;text-align:center;">Grupo Elite Work LLC — Globe Life Insurance</p>
        </div>`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('[Email] Resend error:', JSON.stringify(data)); return false; }
    console.log(`[Email] Enviado a ${correo} (id: ${data.id})`);
    return true;
  } catch (e) {
    console.error('[Email] Error:', e.message);
    return false;
  }
}

// ── Move lead to webinar ──────────────────────────────────────────────────────
async function moveLeadToWebinar(leadId, nombre, correo, baseWebinarUrl) {
  try {
    const now         = new Date().toISOString();
    const personalUrl = `${baseWebinarUrl}?id=${leadId}&nombre=${encodeURIComponent(nombre)}&correo=${encodeURIComponent(correo)}`;

    await fsUpdateLeadFields(leadId, {
      pipeline_id:  'en-webinar',
      etapa:        'Inscrito en Webinar',
      link_webinar: personalUrl,
    });

    const lead = await db.sbGetLead(leadId);
    const hist = Array.isArray(lead?.historial) ? [...lead.historial] : [];
    hist.push({ icono: '🎥', accion: 'Inscrito en Webinar — link personalizado generado y enviado por correo', fecha: now, usuario: 'Ana (IA)' });
    await fsUpdateLeadFields(leadId, { historial: hist });

    await sendWebinarEmail(correo, nombre, personalUrl);

    const telefono = lead?.telefono || '';
    pixelWebinar({ id: leadId, telefono, correo }).catch(e => console.error('[Pixel] pixelWebinar:', e.message));

    console.log(`[Webinar] Lead ${leadId} → en-webinar | link: ${personalUrl}`);
    return personalUrl;
  } catch (e) {
    console.error('[Webinar] Error:', e.message);
    return baseWebinarUrl;
  }
}

// ── Full background WA pipeline ───────────────────────────────────────────────
async function runWAPipeline(from, historyMap, sendFn, opts) {
  const { WEBINAR_URL } = opts;
  const history = historyMap.get(from) || [];

  try {
    await extractAndUpdateLead(from, history);

    const phone = rawPhone(from);
    const lead  = await fsGetLeadByPhone(phone);
    if (!lead) return;

    if (lead.pipeline_id === 'en-webinar' || webinarInviteSent.has(from)) return;

    const webinarIntent = lead.webinar_intent || false;
    const wantsWebinar  = webinarIntent || await detectWebinarIntent(history);

    if (wantsWebinar) {
      const nombreValido = lead.nombre && !lead.nombre.startsWith('WA ') && !lead.nombre.startsWith('+');
      if (!lead.correo || !nombreValido) {
        if (!webinarIntent) {
          await fsUpdateLeadFields(lead.id, { webinar_intent: true });
          console.log(`[Pipeline] Intención webinar guardada para ${from} — esperando correo`);
        }
        return;
      }
      webinarInviteSent.add(from);
      await fsUpdateLeadFields(lead.id, { webinar_intent: false });
      await moveLeadToWebinar(lead.id, lead.nombre, lead.correo, WEBINAR_URL);
      const firstName = lead.nombre.split(' ')[0] || '';
      const waMsg = `📧 ${firstName ? '¡'+firstName+'! ' : ''}Te acabo de enviar el enlace del webinar a tu correo *${lead.correo}*. Revísalo (también la carpeta de spam). 😊`;
      await humanDelay(waMsg);
      await sendFn(rawPhone(from), waMsg).catch(() => {});
    }
  } catch (e) {
    console.error('[Pipeline] Error:', e.message);
  }
}

module.exports = {
  humanDelay,
  toE164,
  rawPhone,
  fsUpdateLeadFields,
  fsGetLeadByPhone,
  fsLeadExists,
  fsCreateLeadWA,
  fsAppendLeadMetaWa,
  webinarInviteSent,
  extractAndUpdateLead,
  detectWebinarIntent,
  sendWebinarEmail,
  moveLeadToWebinar,
  runWAPipeline,
};
