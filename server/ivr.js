const twilio = require('twilio');
const db = require('./db');

const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

const DEFAULT_IVR_CONFIG = {
  enabled: true,
  timezone: 'America/Chicago',
  afterHoursMessage: 'Nuestras oficinas están cerradas. Nuestro horario de atención es de lunes a viernes de nueve de la mañana a seis de la tarde. Por favor, deja un mensaje después del tono y te contactaremos a la brevedad.',
  mainMenuMessage: 'Gracias por llamar a Grupo Élite. Para Recursos Humanos, presiona uno. Para Ventas, presiona dos. Para Servicio Técnico, presiona tres. Para Quejas y Reclamos, presiona cuatro. Si tienes un ticket de soporte, presiona cinco.',
  businessHours: {
    monday:    { enabled: true,  open: '09:00', close: '18:00' },
    tuesday:   { enabled: true,  open: '09:00', close: '18:00' },
    wednesday: { enabled: true,  open: '09:00', close: '18:00' },
    thursday:  { enabled: true,  open: '09:00', close: '18:00' },
    friday:    { enabled: true,  open: '09:00', close: '18:00' },
    saturday:  { enabled: false, open: '09:00', close: '14:00' },
    sunday:    { enabled: false, open: '09:00', close: '14:00' },
  },
  options: {
    '1': {
      label: 'Recursos Humanos',
      type: 'submenu',
      submenu: {
        message: 'Para Administración, presiona uno. Para Contrataciones y vacantes, presiona dos.',
        options: {
          '1': { label: 'Administración',  type: 'agent', aiEnabled: true  },
          '2': { label: 'Contrataciones',  type: 'agent', aiEnabled: true  },
        },
      },
    },
    '2': { label: 'Ventas',            type: 'agent',    aiEnabled: true  },
    '3': {
      label: 'Servicio Técnico',
      type: 'submenu',
      submenu: {
        message: 'Para soporte a agentes, presiona uno. Para soporte a clientes, presiona dos.',
        options: {
          '1': { label: 'Soporte agentes',  type: 'agent', aiEnabled: false },
          '2': { label: 'Soporte clientes', type: 'agent', aiEnabled: false },
        },
      },
    },
    '4': { label: 'Quejas y Reclamos', type: 'voicemail' },
    '5': { label: 'Ticket de soporte', type: 'ticket'    },
  },
};

async function loadIvrConfig() {
  try {
    const cfg = await db.sbGetConfig('ivr_config');
    return cfg || { ...DEFAULT_IVR_CONFIG };
  } catch {
    return { ...DEFAULT_IVR_CONFIG };
  }
}

async function saveIvrConfig(config) {
  try {
    await db.sbSetConfig('ivr_config', config);
    return true;
  } catch {
    return false;
  }
}

function isBusinessHours(cfg) {
  const tz  = cfg.timezone || 'America/Chicago';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour:    'numeric',
    minute:  'numeric',
    weekday: 'long',
    hour12:  false,
  }).formatToParts(now);

  const dayName = parts.find(p => p.type === 'weekday')?.value?.toLowerCase();
  const hour    = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute  = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const current = hour * 60 + minute;

  const dayKey  = DAYS.find(d => dayName?.startsWith(d.slice(0, 3)));
  const dayConf = dayKey ? cfg.businessHours?.[dayKey] : null;

  if (!dayConf?.enabled) return false;

  const [oh, om] = (dayConf.open  || '09:00').split(':').map(Number);
  const [ch, cm] = (dayConf.close || '18:00').split(':').map(Number);

  return current >= oh * 60 + om && current < ch * 60 + cm;
}

// ── Say helper (Spanish voice) ────────────────────────────────────────────────
function say(twiml, text) {
  twiml.say({ language: 'es-MX', voice: 'Polly.Mia' }, text);
}

function registerIvrRoutes(app, deps) {
  const { SERVER_URL, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, loadManagers, triggerEscalation, askClaude, _genTTS } = deps;

  // ── Main IVR menu ───────────────────────────────────────────────────────────
  app.post('/twilio/voice/ivr/menu', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml   = new VoiceResponse();
    const cfg     = await loadIvrConfig();
    const callSid = req.body.CallSid;

    // Start dual-channel recording
    if (callSid && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      const tc = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      tc.calls(callSid).recordings.create({ recordingChannels: 'dual' })
        .catch(() => {});
    }

    if (!isBusinessHours(cfg)) {
      // After hours → voicemail
      say(twiml, cfg.afterHoursMessage);
      twiml.redirect('/twilio/voice/ivr/voicemail');
      return res.type('text/xml').send(twiml.toString());
    }

    const gather = twiml.gather({
      numDigits: 1,
      action:    '/twilio/voice/ivr/select',
      timeout:   8,
    });
    say(gather, cfg.mainMenuMessage);

    // Repeat menu once on no input
    twiml.redirect('/twilio/voice/ivr/menu-repeat');
    res.type('text/xml').send(twiml.toString());
  });

  // Repeat menu once, then hang up
  app.post('/twilio/voice/ivr/menu-repeat', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml = new VoiceResponse();
    const cfg   = await loadIvrConfig();

    const gather = twiml.gather({
      numDigits: 1,
      action:    '/twilio/voice/ivr/select',
      timeout:   8,
    });
    say(gather, 'No hemos recibido ninguna selección. ' + cfg.mainMenuMessage);

    say(twiml, 'No hemos recibido respuesta. Por favor llámanos de nuevo. ¡Hasta luego!');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  });

  // ── Handle main menu digit selection ───────────────────────────────────────
  app.post('/twilio/voice/ivr/select', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml  = new VoiceResponse();
    const digit  = req.body.Digits;
    const cfg    = await loadIvrConfig();
    const option = cfg.options?.[digit];

    if (!option) {
      say(twiml, 'Opción no válida.');
      twiml.redirect('/twilio/voice/ivr/menu');
      return res.type('text/xml').send(twiml.toString());
    }

    console.log(`[IVR] Opción ${digit} → ${option.label} (${option.type})`);

    if (option.type === 'submenu') {
      twiml.redirect(`/twilio/voice/ivr/submenu?parent=${encodeURIComponent(digit)}`);
    } else if (option.type === 'voicemail') {
      twiml.redirect(`/twilio/voice/ivr/voicemail?label=${encodeURIComponent(option.label)}`);
    } else if (option.type === 'ticket') {
      twiml.redirect('/twilio/voice/ivr/ticket');
    } else if (option.type === 'agent') {
      if (option.aiEnabled) {
        twiml.redirect(`/twilio/voice/ivr/ai-agent?dept=${encodeURIComponent(option.label)}`);
      } else {
        twiml.redirect(`/twilio/voice/ivr/human-agent?dept=${encodeURIComponent(option.label)}`);
      }
    }

    res.type('text/xml').send(twiml.toString());
  });

  // ── Sub-menu ────────────────────────────────────────────────────────────────
  app.post('/twilio/voice/ivr/submenu', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml   = new VoiceResponse();
    const parent  = req.query.parent || req.body.parent;
    const cfg     = await loadIvrConfig();
    const submenu = cfg.options?.[parent]?.submenu;

    if (!submenu) {
      say(twiml, 'Opción no disponible.');
      twiml.redirect('/twilio/voice/ivr/menu');
      return res.type('text/xml').send(twiml.toString());
    }

    const gather = twiml.gather({
      numDigits: 1,
      action:    `/twilio/voice/ivr/submenu-select?parent=${encodeURIComponent(parent)}`,
      timeout:   8,
    });
    say(gather, submenu.message);

    say(twiml, 'No recibimos tu selección. Regresando al menú principal.');
    twiml.redirect('/twilio/voice/ivr/menu');
    res.type('text/xml').send(twiml.toString());
  });

  // ── Handle sub-menu digit selection ────────────────────────────────────────
  app.post('/twilio/voice/ivr/submenu-select', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml  = new VoiceResponse();
    const parent = req.query.parent || req.body.parent;
    const digit  = req.body.Digits;
    const cfg    = await loadIvrConfig();
    const option = cfg.options?.[parent]?.submenu?.options?.[digit];

    if (!option) {
      say(twiml, 'Opción no válida.');
      twiml.redirect(`/twilio/voice/ivr/submenu?parent=${encodeURIComponent(parent)}`);
      return res.type('text/xml').send(twiml.toString());
    }

    console.log(`[IVR] Sub-opción ${parent}-${digit} → ${option.label} (${option.type})`);

    if (option.aiEnabled) {
      twiml.redirect(`/twilio/voice/ivr/ai-agent?dept=${encodeURIComponent(option.label)}`);
    } else {
      twiml.redirect(`/twilio/voice/ivr/human-agent?dept=${encodeURIComponent(option.label)}`);
    }

    res.type('text/xml').send(twiml.toString());
  });

  // ── AI Agent (Ana) ──────────────────────────────────────────────────────────
  app.post('/twilio/voice/ivr/ai-agent', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml = new VoiceResponse();
    const dept  = req.query.dept || req.body.dept || 'Grupo Élite';

    const greeting = `Te comunico con el área de ${dept}. Hola, te has comunicado con el Departamento de Recursos Humanos de Grupo Élite. ¿En qué te puedo ayudar?`;
    try {
      const id  = await _genTTS(greeting);
      const gather = twiml.gather({
        input:       'speech',
        action:      `/twilio/voice/ivr/ai-respond?dept=${encodeURIComponent(dept)}`,
        speechTimeout: 'auto',
        language:    'es-MX',
        speechModel: 'phone_call',
      });
      gather.play(`${SERVER_URL}/ai/tts/${id}`);
    } catch {
      const gather = twiml.gather({
        input:       'speech',
        action:      `/twilio/voice/ivr/ai-respond?dept=${encodeURIComponent(dept)}`,
        speechTimeout: 'auto',
        language:    'es-MX',
      });
      say(gather, greeting);
    }
    twiml.redirect('/twilio/voice/no-input');
    res.type('text/xml').send(twiml.toString());
  });

  // AI voice turns (reuse existing logic)
  app.post('/twilio/voice/ivr/ai-respond', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml = new VoiceResponse();
    const { SpeechResult, From } = req.body;
    const dept = req.query.dept || 'Grupo Élite';

    if (!SpeechResult?.trim()) {
      twiml.redirect('/twilio/voice/no-input');
      return res.type('text/xml').send(twiml.toString());
    }

    console.log(`[IVR-AI] ${From} (${dept}): "${SpeechResult}"`);
    try {
      const reply = await askClaude(From, SpeechResult, 'voice');
      console.log(`[IVR-AI] Ana → ${From}: "${reply}"`);
      const id = await _genTTS(reply);
      const gather = twiml.gather({
        input:       'speech',
        action:      `/twilio/voice/ivr/ai-respond?dept=${encodeURIComponent(dept)}`,
        speechTimeout: 'auto',
        language:    'es-MX',
        speechModel: 'phone_call',
      });
      gather.play(`${SERVER_URL}/ai/tts/${id}`);
      twiml.redirect('/twilio/voice/no-input');
    } catch (e) {
      console.error('[IVR-AI] Error:', e.message);
      say(twiml, 'Disculpa, tuve un problema técnico. Un reclutador te llamará en breve. ¡Hasta luego!');
      twiml.hangup();
    }
    res.type('text/xml').send(twiml.toString());
  });

  // ── Human Agent ─────────────────────────────────────────────────────────────
  app.post('/twilio/voice/ivr/human-agent', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml = new VoiceResponse();
    const dept  = req.query.dept || req.body.dept || '';
    const from  = req.body.From || '';

    say(twiml, `Gracias por comunicarte${dept ? ' con ' + dept : ''}. Un momento, por favor. Te estamos conectando con un agente.`);

    // Try to ring managers
    let managers = [];
    try { managers = await loadManagers(); } catch {}

    const phones = managers.map(m => m.phone).filter(Boolean).filter(p => p.length >= 7);

    if (phones.length) {
      const dial = twiml.dial({
        timeout:  30,
        action:   `/twilio/voice/ivr/agent-no-answer?dept=${encodeURIComponent(dept)}&from=${encodeURIComponent(from)}`,
        callerId: req.body.To || undefined,
      });
      phones.forEach(p => dial.number(p));
    } else {
      // No agents configured → voicemail
      say(twiml, 'En este momento no hay agentes disponibles. Por favor, deja un mensaje y te llamaremos a la brevedad.');
      twiml.redirect(`/twilio/voice/ivr/voicemail?label=${encodeURIComponent(dept || 'Agente')}`);
    }

    res.type('text/xml').send(twiml.toString());
  });

  // Called when no agent answered
  app.post('/twilio/voice/ivr/agent-no-answer', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml     = new VoiceResponse();
    const dept      = req.query.dept || '';
    const dialStatus = req.body.DialCallStatus || '';

    if (dialStatus === 'completed') {
      // Call was answered and completed normally
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    say(twiml, 'Lo sentimos, no hay agentes disponibles en este momento. Por favor, deja un mensaje y te contactaremos a la brevedad.');
    twiml.redirect(`/twilio/voice/ivr/voicemail?label=${encodeURIComponent(dept)}`);
    res.type('text/xml').send(twiml.toString());
  });

  // ── Voicemail ───────────────────────────────────────────────────────────────
  app.post('/twilio/voice/ivr/voicemail', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml = new VoiceResponse();
    const label = req.query.label || '';

    say(twiml, `Por favor, deja tu nombre, teléfono${label ? ' y el motivo de tu llamada para ' + label : ''}. Graba tu mensaje después del tono.`);
    twiml.record({
      action:         '/twilio/voice/ivr/voicemail-done',
      maxLength:      120,
      playBeep:       true,
      timeout:        5,
      transcribeCallback: '/twilio/voice/ivr/voicemail-transcribe',
    });
    say(twiml, 'No recibimos tu mensaje. ¡Hasta luego!');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  });

  app.post('/twilio/voice/ivr/voicemail-done', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml         = new VoiceResponse();
    const recUrl        = req.body.RecordingUrl;
    const recDuration   = req.body.RecordingDuration;
    const from          = req.body.From || req.body.Caller || '';
    const to            = req.body.To   || req.body.Called || '';
    const callSid       = req.body.CallSid || `vm_${Date.now()}`;
    const label         = req.query.label || '';

    console.log(`[IVR] Voicemail recibido de ${from} — duración: ${recDuration}s — ${recUrl}`);

    // Save to Firestore call_log
    try {
      const { fsLogCall } = require('./call-log');
      await fsLogCall({
        callSid,
        from, to,
        status:       'voicemail',
        direction:    'inbound',
        type:         'voicemail',
        duration:     parseInt(recDuration) || 0,
        recordingUrl: recUrl ? `${recUrl}.mp3` : '',
        label,
        startTime:    new Date().toISOString(),
        ts:           Date.now(),
      });
    } catch (e) {
      console.error('[IVR] fsLogCall voicemail:', e.message);
    }

    // Notify managers via WhatsApp
    if (recUrl && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      try {
        const managers = await loadManagers();
        const { sendWhatsApp } = require('./meta');
        const msg = `📞 *Mensaje de voz recibido*\nDe: ${from}\nDuración: ${recDuration}s\nEscuchar: ${recUrl}.mp3`;
        await Promise.all(
          managers.filter(m => m.phone).map(m =>
            sendWhatsApp(m.phone.replace(/^\+/, ''), msg).catch(() => {})
          )
        );
      } catch (e) {
        console.error('[IVR] Error notificando managers:', e.message);
      }
    }

    say(twiml, 'Tu mensaje ha sido grabado. Un agente te contactará a la brevedad. ¡Hasta luego!');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  });

  // Transcription callback — update Firestore doc with transcription text
  app.post('/twilio/voice/ivr/voicemail-transcribe', async (req, res) => {
    res.sendStatus(200);
    const { TranscriptionText, CallSid } = req.body;
    if (!TranscriptionText || !CallSid) return;
    console.log(`[IVR] Transcripción voicemail (${CallSid}): "${TranscriptionText}"`);
    try {
      const { fsLogCall } = require('./call-log');
      await fsLogCall({ callSid: CallSid, transcription: TranscriptionText, ts: Date.now() });
    } catch {}
  });

  // ── Ticket ──────────────────────────────────────────────────────────────────
  app.post('/twilio/voice/ivr/ticket', (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml = new VoiceResponse();

    const gather = twiml.gather({
      input:       'speech dtmf',
      action:      '/twilio/voice/ivr/ticket-connect',
      speechTimeout: 5,
      timeout:     10,
      language:    'es-MX',
    });
    say(gather, 'Por favor, dí o marca el número de tu ticket de soporte.');

    say(twiml, 'No recibimos el número de ticket. Regresando al menú principal.');
    twiml.redirect('/twilio/voice/ivr/menu');
    res.type('text/xml').send(twiml.toString());
  });

  app.post('/twilio/voice/ivr/ticket-connect', async (req, res) => {
    const { VoiceResponse } = twilio.twiml;
    const twiml   = new VoiceResponse();
    const ticket  = req.body.SpeechResult || req.body.Digits || 'desconocido';
    const from    = req.body.From || '';

    console.log(`[IVR] Ticket de soporte: "${ticket}" de ${from}`);

    say(twiml, `Gracias. Tu número de ticket es ${ticket}. Te conectamos con un agente para atender tu caso.`);

    // Try managers
    let managers = [];
    try { managers = await loadManagers(); } catch {}
    const phones = managers.map(m => m.phone).filter(Boolean);

    if (phones.length) {
      // Notify managers about the ticket
      try {
        const { sendWhatsApp } = require('./meta');
        const msg = `🎫 *Llamada por ticket de soporte*\nTicket: ${ticket}\nDe: ${from}`;
        await Promise.all(managers.filter(m => m.phone).map(m =>
          sendWhatsApp(m.phone.replace(/^\+/, ''), msg).catch(() => {})
        ));
      } catch {}

      const dial = twiml.dial({
        timeout:  30,
        action:   '/twilio/voice/ivr/agent-no-answer?dept=Ticket+de+Soporte',
        callerId: req.body.To || undefined,
      });
      phones.forEach(p => dial.number(p));
    } else {
      say(twiml, 'No hay agentes disponibles en este momento. Un agente te contactará próximamente. ¡Hasta luego!');
      twiml.hangup();
    }

    res.type('text/xml').send(twiml.toString());
  });

  // ── IVR Config API ──────────────────────────────────────────────────────────
  app.get('/ivr/config', async (req, res) => {
    const config = await loadIvrConfig();
    res.json({ ok: true, config, default: DEFAULT_IVR_CONFIG });
  });

  app.post('/ivr/config', async (req, res) => {
    const { config } = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ ok: false, error: 'config inválida' });
    }
    const current = await loadIvrConfig();
    const merged  = { ...current, ...config };
    // Deep merge businessHours if provided
    if (config.businessHours) {
      merged.businessHours = { ...current.businessHours, ...config.businessHours };
    }
    // Deep merge options if provided
    if (config.options) {
      merged.options = { ...current.options, ...config.options };
    }
    const ok = await saveIvrConfig(merged);
    res.json({ ok });
  });
}

module.exports = { registerIvrRoutes, loadIvrConfig, saveIvrConfig, DEFAULT_IVR_CONFIG };
