// ── WhatsApp Business API templates ──────────────────────────────────────────
// Enviar para aprobación en Meta Business Manager → Herramientas de cuenta
// → Plantillas de mensajes. Categoría: UTILITY. Idioma: es (Español)
// Una vez aprobadas, el sistema las usará automáticamente.
// Si la plantilla no está aprobada aún, el sistema envía texto plano de respaldo.

const TEMPLATES = {

  // ── Para encargados (managers) ────────────────────────────────────────────

  alerta_escalada: {
    name: 'ge_alerta_escalada',
    language: 'es',
    category: 'UTILITY',
    recipient: 'manager',
    description: 'Alerta al encargado cuando Ana necesita intervención humana.',
    body:
      '⚠️ ALERTA — Grupo Élite CRM\n\n' +
      'Lead: {{1}}\n' +
      'Teléfono: {{2}}\n' +
      'Motivo: {{3}}\n\n' +
      '{{4}}, responde:\n' +
      '✅ SI u OK — tomar el caso (Ana se pausa)\n' +
      '➡️ SIGUIENTE — pasar al próximo encargado',
    variables: [
      { n: 1, label: 'Nombre del lead',      ejemplo: 'Carlos Mendoza' },
      { n: 2, label: 'Teléfono del lead',    ejemplo: '+52 55 1234 5678' },
      { n: 3, label: 'Motivo de escalada',   ejemplo: '📞 Candidato solicita llamada telefónica' },
      { n: 4, label: 'Nombre del encargado', ejemplo: 'María' },
    ],
  },

  // ── Para el entrevistador ─────────────────────────────────────────────────

  entrevista_agendada_int: {
    name: 'ge_entrevista_agendada_int',
    language: 'es',
    category: 'UTILITY',
    recipient: 'interviewer',
    description: 'Notificación al entrevistador cuando se agenda una nueva entrevista.',
    body:
      '📅 Nueva entrevista agendada — Grupo Élite\n\n' +
      'Candidato: {{1}}\n' +
      'Teléfono: {{2}}\n' +
      'Fecha y hora: {{3}}\n' +
      'Enlace Zoom: {{4}}\n\n' +
      'Responde CONFIRMAR para confirmar o REAGENDAR si no puedes.',
    variables: [
      { n: 1, label: 'Nombre del candidato',   ejemplo: 'Ana García' },
      { n: 2, label: 'Teléfono del candidato', ejemplo: '+52 55 9876 5432' },
      { n: 3, label: 'Fecha y hora',           ejemplo: 'Lunes 5 mayo · 10:00 AM' },
      { n: 4, label: 'Enlace Zoom',            ejemplo: 'https://zoom.us/j/123456' },
    ],
  },

  // ── Para candidatos (postulados) ──────────────────────────────────────────

  confirmacion_entrevista: {
    name: 'ge_confirmacion_entrevista',
    language: 'es',
    category: 'UTILITY',
    recipient: 'candidate',
    description: 'Confirmación enviada al candidato en cuanto se agenda la entrevista.',
    body:
      '¡Hola {{1}}! 🎉\n\n' +
      'Tu entrevista con *Grupo Élite Work* ha sido confirmada.\n\n' +
      '📅 Fecha: {{2}}\n' +
      '🕐 Hora: {{3}}\n' +
      '🔗 Enlace Zoom: {{4}}\n\n' +
      'Te recomendamos unirte 5 minutos antes. ¡Mucho éxito!',
    variables: [
      { n: 1, label: 'Primer nombre del candidato', ejemplo: 'Ana' },
      { n: 2, label: 'Fecha',                       ejemplo: 'Lunes 5 de mayo' },
      { n: 3, label: 'Hora',                        ejemplo: '10:00 AM' },
      { n: 4, label: 'Enlace Zoom',                 ejemplo: 'https://zoom.us/j/123456' },
    ],
  },

  recordatorio_dia_antes: {
    name: 'ge_recordatorio_dia_antes',
    language: 'es',
    category: 'UTILITY',
    recipient: 'candidate',
    description: 'Recordatorio enviado al candidato la mañana del día anterior a su entrevista.',
    body:
      '¡Hola {{1}}! 👋\n\n' +
      'Te recordamos que mañana tienes una entrevista con *Grupo Élite Work*.\n\n' +
      '📅 Fecha: {{2}}\n' +
      '🕐 Hora: {{3}}\n' +
      '🔗 Enlace Zoom: {{4}}\n\n' +
      '¿Confirmas tu asistencia? Responde *SÍ* para confirmar o *NO* para cancelar.',
    variables: [
      { n: 1, label: 'Primer nombre del candidato', ejemplo: 'Ana' },
      { n: 2, label: 'Fecha',                       ejemplo: 'Lunes 5 de mayo' },
      { n: 3, label: 'Hora',                        ejemplo: '10:00 AM' },
      { n: 4, label: 'Enlace Zoom',                 ejemplo: 'https://zoom.us/j/123456' },
    ],
  },

  recordatorio_horas_antes: {
    name: 'ge_recordatorio_horas',
    language: 'es',
    category: 'UTILITY',
    recipient: 'candidate',
    description: 'Recordatorio enviado al candidato horas antes de la entrevista.',
    body:
      '¡Hola {{1}}! ⏰\n\n' +
      'Tu entrevista con *Grupo Élite Work* comienza en *{{2}} hora(s)*.\n\n' +
      '🔗 Enlace Zoom: {{3}}\n\n' +
      '¡Te esperamos puntual!',
    variables: [
      { n: 1, label: 'Primer nombre del candidato', ejemplo: 'Ana' },
      { n: 2, label: 'Horas restantes',             ejemplo: '2' },
      { n: 3, label: 'Enlace Zoom',                 ejemplo: 'https://zoom.us/j/123456' },
    ],
  },

  enlace_zoom_inicio: {
    name: 'ge_enlace_zoom',
    language: 'es',
    category: 'UTILITY',
    recipient: 'candidate',
    description: 'Envío del enlace Zoom justo cuando comienza la entrevista.',
    body:
      '¡Hola {{1}}! 🎥\n\n' +
      'Tu entrevista comienza *ahora*. Aquí está tu enlace:\n\n' +
      '🔗 {{2}}\n\n' +
      '¡Mucho éxito!',
    variables: [
      { n: 1, label: 'Primer nombre del candidato', ejemplo: 'Ana' },
      { n: 2, label: 'Enlace Zoom',                 ejemplo: 'https://zoom.us/j/123456' },
    ],
  },
};

// ── Send via Meta template API, returns true if sent OK ───────────────────────
async function sendWhatsAppTemplate(to, templateName, params) {
  const token   = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;
  if (!token || !phoneId) return false;

  const toClean    = String(to).replace(/^\+/, '');
  const components = params?.length ? [{
    type: 'body',
    parameters: params.map(p => ({ type: 'text', text: String(p) })),
  }] : [];

  try {
    const res  = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toClean,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'es' },
          ...(components.length ? { components } : {}),
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn(`[WA Template] "${templateName}" falló: ${data.error?.message || JSON.stringify(data)}`);
      return false;
    }
    console.log(`[WA Template] "${templateName}" → ${toClean} ✓`);
    return true;
  } catch (e) {
    console.error('[WA Template] Error:', e.message);
    return false;
  }
}

// ── Try template first, fall back to plain text ───────────────────────────────
async function sendTemplateOrFallback(to, templateKey, params, fallbackText, sendPlainFn) {
  const tpl  = TEMPLATES[templateKey];
  const sent = tpl ? await sendWhatsAppTemplate(to, tpl.name, params) : false;
  if (!sent && sendPlainFn) await sendPlainFn(to, fallbackText);
  return sent;
}

module.exports = { TEMPLATES, sendWhatsAppTemplate, sendTemplateOrFallback };
