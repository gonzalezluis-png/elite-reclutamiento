// Shared WA pipeline: lead management, webinar detection, Playwright registration

const Anthropic  = require('@anthropic-ai/sdk');
const { pixelWebinar } = require('./pixel');
const db = require('./db');

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

async function fsGetLeadByEmail(email) {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  const rows  = await db.sbGet('leads', 'limit=500&order=created_at.desc');
  return rows.find(l => (l.correo || '').trim().toLowerCase() === clean) || null;
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
    const folio = '#' + id.replace(/\D/g,'').slice(-6);
    console.log(`[WA-AI] Lead auto-creado: ${id} folio:${folio} para ${phone}`);
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
async function extractAndUpdateLead(from, history, sendFn, opts) {
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
- genero: "M" si el nombre es claramente masculino, "F" si es claramente femenino, null si no se puede determinar por el nombre.
- webinar_intent: true si mostró interés en ver el webinar o dio correo para el link. false si lo rechazó. null si no aplica.
- vio_webinar: true si confirmó que ya vio el webinar. false si dijo que no. null si no se sabe.
- quiere_entrevista: true ÚNICAMENTE si el candidato pidió explícitamente una entrevista, quiere agendar una cita, o dijo claramente que quiere continuar al proceso de entrevista DESPUÉS de haber visto el webinar (vio_webinar debe ser true). NO poner true solo porque quiere ver el webinar o porque está interesado en el trabajo. false si rechazó. null en cualquier otro caso.
- ya_entrevistado: true si el candidato menciona que ya tuvo una entrevista, ya fue entrevistado, o ya conoce / ya habló con Globe Life, American Income Life, AIL, Quintero and Partners, Quintero & Partners, o Grupo Elite. false si dijo que no. null si no se sabe.
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
      try {
        extracted = JSON.parse(raw);
      } catch {
        // Repair common JSON issues: trailing commas, unclosed strings/braces
        const repaired = raw
          .replace(/,\s*([}\]])/g, '$1')     // trailing commas
          .replace(/([^"\\])"([^"]*?)$/s, '$1"$2"') // unclosed string at end
          .replace(/\{([^}]*)$/, '{$1}');    // unclosed object
        const match2 = repaired.match(/\{[\s\S]*\}/);
        if (match2) extracted = JSON.parse(match2[0]);
      }
      console.log(`[AI-Extract] Extraído para ${from}:`, extracted);
    } catch (e) {
      console.error(`[AI-Extract] JSON parse error (sin recuperación):`, extraction.content[0]?.text?.slice(0, 200));
      return;
    }

    if (!Object.values(extracted).some(v => v !== null)) return;

    const phone = rawPhone(from);
    const lead  = await fsGetLeadByPhone(phone);
    if (!lead) { console.error(`[AI-Extract] Lead no encontrado para ${phone}`); return; }

    // Block any processing for contratado leads
    const _etapaUp = (lead.etapa || '').toUpperCase();
    const _resultLo = (lead.resultado_entrevista || '').toLowerCase();
    if (_etapaUp.includes('CONTRATADO') || _resultLo === 'contratado') {
      console.log(`[AI-Extract] Lead contratado ${phone} — sin acción.`);
      return;
    }

    const updates = {};
    const isAutoName = !lead.nombre || lead.nombre.startsWith('WA ') || lead.nombre.startsWith('+') || lead.nombre.startsWith('Lead Meta');
    if (extracted.nombre         && isAutoName)          updates.nombre          = extracted.nombre;
    if (extracted.correo         && !lead.correo)        updates.correo          = extracted.correo;
    if (extracted.ubicacion      && !lead.ubicacion)     updates.ubicacion       = extracted.ubicacion;
    if (extracted.disponibilidad && !lead.disponibilidad) updates.disponibilidad = extracted.disponibilidad;
    if (extracted.genero && !lead.genero)                  updates.genero         = extracted.genero;
    if (extracted.tiene_experiencia !== null && extracted.tiene_experiencia !== undefined && lead.tiene_experiencia !== true)
                                                         updates.tiene_experiencia = extracted.tiene_experiencia;
    if (extracted.tiene_papeles !== null && extracted.tiene_papeles !== undefined && lead.tiene_papeles !== true)
                                                         updates.tiene_papeles   = extracted.tiene_papeles;
    if (extracted.mayor_edad !== null && extracted.mayor_edad !== undefined && lead.mayor_edad !== true)
                                                         updates.mayor_edad      = extracted.mayor_edad;
    if (extracted.vio_webinar === true && lead.vio_webinar !== true) {
                                                         updates.vio_webinar = true;
      // Advance etapa once candidate confirms they watched the webinar
      if (lead.pipeline_id === 'en-webinar') updates.etapa = 'AS - Asistente';
    }
    if (extracted.quiere_entrevista === true && !lead.solicita_entrevista) {
                                                         updates.solicita_entrevista = true;
                                                         updates.ia_paused           = true;
    }
    if (extracted.ya_entrevistado === true && !lead.ya_entrevistado) {
                                                         updates.ya_entrevistado     = true;
                                                         updates.ia_paused           = true;
    }
    // Disqualify leads who can't work legally or aren't of age
    const _disqualified = extracted.tiene_papeles === false || extracted.mayor_edad === false;
    if (_disqualified && lead.pipeline_id !== 'no-interesados' && lead.pipeline_id !== 'entrevistas-generales') {
      updates.etapa       = 'No Califica';
      updates.pipeline_id = 'no-interesados';
    }

    if (Object.keys(updates).length) {
      await fsUpdateLeadFields(lead.id, updates);
      console.log(`[AI-Extract] Lead ${lead.id} actualizado:`, updates);
    }

    // Webinar intent catch-up: correo arrived after [WEBINAR] token fired
    if (updates.correo && lead.webinar_intent && lead.pipeline_id !== 'en-webinar') {
      const _correo = updates.correo;
      const _nombre = updates.nombre || lead.nombre || '';
      const _validN = _nombre && !_nombre.startsWith('WA ') && !_nombre.startsWith('+') ? _nombre : 'Candidato';
      const _wUrl   = (opts && opts.WEBINAR_URL) || process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';
      try {
        await moveLeadToWebinar(lead.id, _validN, _correo, _wUrl);
        console.log(`[WEBINAR intent] Correo llegó después — webinar enviado a ${lead.id}`);
      } catch (e) { console.error('[WEBINAR intent] Error:', e.message); }
    }

    // Interview intent: send "dame unos minutos" + alert managers
    if (updates.solicita_entrevista) {
      const nombreFinalIv  = updates.nombre || lead.nombre || '';
      const nombreValidoIv = nombreFinalIv && !nombreFinalIv.startsWith('WA ') && !nombreFinalIv.startsWith('+');
      const firstNameIv    = nombreValidoIv ? nombreFinalIv.split(' ')[0] : '';
      const ivMsg = `¡${firstNameIv ? firstNameIv + '! ' : ''}Dame un momento para revisar los horarios disponibles para tu entrevista. 😊 En breve te confirmamos.`;
      if (sendFn) {
        await humanDelay(ivMsg);
        await sendFn(rawPhone(from), ivMsg).catch(() => {});
      }
      try {
        const { triggerEscalation } = require('./escalation');
        await triggerEscalation(rawPhone(from), nombreFinalIv || rawPhone(from), 'quiere-entrevista', '', sendFn || (() => {}));
      } catch(e) { console.error('[AI-Extract] escalation error:', e.message); }
      console.log(`[AI-Extract] Entrevista solicitada — Ana pausada: ${lead.id}`);
    }

    // Already interviewed: escalate to manager
    if (updates.ya_entrevistado) {
      const nombreFinalYa  = updates.nombre || lead.nombre || '';
      const firstNameYa    = nombreFinalYa && !nombreFinalYa.startsWith('WA ') && !nombreFinalYa.startsWith('+') ? nombreFinalYa.split(' ')[0] : '';
      const yaMsg = `Hola${firstNameYa ? ' ' + firstNameYa : ''}, entiendo que ya tuviste contacto con nosotros antes. 😊 Déjame un momento para conectarte con uno de nuestros managers para darte la mejor atención.`;
      if (sendFn) {
        await humanDelay(yaMsg);
        await sendFn(rawPhone(from), yaMsg).catch(() => {});
      }
      try {
        const { triggerEscalation } = require('./escalation');
        await triggerEscalation(rawPhone(from), nombreFinalYa || rawPhone(from), 'ya-entrevistado', '', sendFn || (() => {}));
      } catch(e) { console.error('[AI-Extract] ya-entrevistado escalation error:', e.message); }
      console.log(`[AI-Extract] Ya entrevistado — manager buscado: ${lead.id}`);
    }

    // Webinar move is handled exclusively by the [WEBINAR] token in meta.js.
    // extractAndUpdateLead only updates fields — it never moves leads.
    return null;
  } catch (e) {
    console.error('[AI-Extract] Error:', e.message);
  }
  return null;
}

// detectWebinarIntent removed — webinar trigger is now handled exclusively
// by the [WEBINAR] token that Ana includes in her Paso 6 reply.

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
        subject: `${nombre ? nombre + ', t' : 'T'}u acceso al Webinar — Grupo Elite Work`,
        html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

      <!-- HEADER -->
      <tr><td style="background:linear-gradient(135deg,#0a0e1a,#162040);border-radius:14px 14px 0 0;padding:36px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4f7fff;">Grupo Elite Work LLC</p>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">Tu Oportunidad<br>con Globe Life</h1>
        <p style="margin:10px 0 0;font-size:13px;color:#7a8aaa;">American Income Life Division · Quintero &amp; Partners</p>
      </td></tr>

      <!-- GREETING -->
      <tr><td style="background:#ffffff;padding:32px 32px 8px;">
        <p style="margin:0;font-size:16px;color:#1e293b;font-weight:600;">Hola${nombre ? ', <strong>' + nombre + '</strong>' : ''} 👋</p>
        <p style="margin:12px 0 0;font-size:14px;color:#475569;line-height:1.7;">Gracias por tu interés en la oportunidad. Preparamos este webinar especialmente para ti — en él encontrarás todo lo que necesitas saber antes de tu entrevista.</p>
      </td></tr>

      <!-- WHAT YOU'LL FIND -->
      <tr><td style="background:#ffffff;padding:20px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8faff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
          <tr><td>
            <p style="margin:0 0 14px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#4f7fff;">En el webinar verás</p>
            <table width="100%" cellpadding="0" cellspacing="6">
              <tr>
                <td width="24" valign="top" style="font-size:15px;padding-top:1px;">✅</td>
                <td style="font-size:13.5px;color:#334155;padding-bottom:6px;">Cómo funciona el modelo de trabajo con Globe Life</td>
              </tr>
              <tr>
                <td width="24" valign="top" style="font-size:15px;padding-top:1px;">✅</td>
                <td style="font-size:13.5px;color:#334155;padding-bottom:6px;">Plan de compensación y potencial de ingresos</td>
              </tr>
              <tr>
                <td width="24" valign="top" style="font-size:15px;padding-top:1px;">✅</td>
                <td style="font-size:13.5px;color:#334155;padding-bottom:6px;">Posiciones disponibles: ventas, marketing y finanzas</td>
              </tr>
              <tr>
                <td width="24" valign="top" style="font-size:15px;padding-top:1px;">✅</td>
                <td style="font-size:13.5px;color:#334155;">Próximos pasos para continuar el proceso</td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- CTA -->
      <tr><td style="background:#ffffff;padding:8px 32px 28px;text-align:center;">
        <p style="margin:0 0 20px;font-size:13px;color:#64748b;">⏱ Duración aproximada: <strong>15–20 minutos</strong>. Ve el video completo para aprovechar al máximo tu entrevista.</p>
        <a href="${webinarUrl}" style="display:inline-block;background:linear-gradient(135deg,#0073ea,#0059b3);color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:9px;font-size:16px;font-weight:700;letter-spacing:.3px;">
          🎥 &nbsp;Ver mi Webinar ahora
        </a>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">Este link es personal — fue generado exclusivamente para ti.</p>
      </td></tr>

      <!-- NEXT STEP -->
      <tr><td style="background:#f0f7ff;border-top:1px solid #dbeafe;border-bottom:1px solid #dbeafe;padding:20px 32px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1d4ed8;">¿Qué sigue después?</p>
        <p style="margin:0;font-size:13.5px;color:#334155;line-height:1.6;">Cuando termines de ver el video, escríbenos por WhatsApp y uno de nuestros coordinadores te ayudará a agendar tu entrevista personal.</p>
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="background:#0a0e1a;border-radius:0 0 14px 14px;padding:24px 32px;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;color:#7a8aaa;">Grupo Elite Work LLC · administracion@grupoelite.com</p>
        <p style="margin:0;font-size:11px;color:#3d4a60;">© 2026 · Globe Life Insurance · American Income Life Division</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`,
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
    // Guard: never send twice (survives server restarts — checked against DB)
    const _existing = await db.sbGetLead(leadId);
    if (_existing?.fecha_inscripcion_webinar) {
      console.log(`[Webinar] Lead ${leadId} ya inscrito — omitiendo doble envío`);
      return _existing.link_webinar || baseWebinarUrl;
    }

    const now         = new Date().toISOString();
    const personalUrl = `${baseWebinarUrl}?id=${leadId}&nombre=${encodeURIComponent(nombre)}&correo=${encodeURIComponent(correo)}`;

    await fsUpdateLeadFields(leadId, {
      pipeline_id:              'en-webinar',
      etapa:                    'En Webinar sin actividad',
      link_webinar:             personalUrl,
      fecha_inscripcion_webinar: now,
    });

    const lead = await db.sbGetLead(leadId);
    const hist = Array.isArray(lead?.historial) ? [...lead.historial] : [];
    hist.push({ icono: '🎥', accion: 'En Webinar sin actividad — link personalizado generado y enviado por correo', fecha: now, usuario: 'Ana (IA)' });
    await fsUpdateLeadFields(leadId, { historial: hist });

    const { isEnabled: _autoEnabled } = require('./automations');
    const emailOk = await _autoEnabled('webinar_email') ? await sendWebinarEmail(correo, nombre, personalUrl) : false;
    if (emailOk) await fsUpdateLeadFields(leadId, { webinar_email_enviado: now });

    const telefono = lead?.telefono || '';
    pixelWebinar({ id: leadId, telefono, correo }).catch(e => console.error('[Pixel] pixelWebinar:', e.message));

    console.log(`[Webinar] Lead ${leadId} → en-webinar | link: ${personalUrl}`);
    return personalUrl;
  } catch (e) {
    console.error('[Webinar] Error:', e.message);
    return baseWebinarUrl;
  }
}

// ── Background extraction pipeline ───────────────────────────────────────────
// Sole responsibility: extract fields from conversation and update the lead.
// Webinar move is handled by [WEBINAR] token in meta.js.
// Interview scheduling is handled by [AGENDAR] token in meta.js.
async function runWAPipeline(from, historyMap, sendFn, opts) {
  const history = historyMap.get(from) || [];
  try {
    await extractAndUpdateLead(from, history, sendFn, opts);
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
  fsGetLeadByEmail,
  fsLeadExists,
  fsCreateLeadWA,
  fsAppendLeadMetaWa,
  extractAndUpdateLead,
  sendWebinarEmail,
  moveLeadToWebinar,
  runWAPipeline,
};
