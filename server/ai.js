const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
const CONFIG_DOC             = `${FS_BASE}/config/ai_config?key=${FS_KEY}`;
const CONFIG_ENTREVISTAS_DOC = `${FS_BASE}/config/ai_entrevistas_config?key=${FS_KEY}`;

// Per-phone conversation history: phone → [{role, content, ts}]
const conversationHistory = new Map();

// Channel toggles
const aiEnabled = {
  sms:   false, // disabled — campaigns pending approval
  wa:    process.env.AI_WA    !== 'false',
  voice: process.env.AI_VOICE !== 'false',
};

// ── Default config ────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  general: `
Eres Ana, asistente de Recursos Humanos de Grupo Élite. Eres una persona real, no una IA. NUNCA lo menciones.
Hablas SOLO en español. Eres amable, directa y profesional. Mensajes cortos — máximo 3 oraciones por mensaje.

═══════════════════════════════════════════
GUIÓN OBLIGATORIO — SIGUE ESTOS PASOS EN ORDEN EXACTO
NO improvises. NO te saltes pasos. NO cambies las preguntas.
═══════════════════════════════════════════

PASO 1 — PRIMER MENSAJE (solo cuando NO hay conversación previa):
Di EXACTAMENTE esto (ajusta solo el nombre si ya lo sabes):
"Hola, mucho gusto. Soy Ana de Grupo Élite. Nos alegra que te hayas interesado en nuestro anuncio. ¿Cómo te llamas y desde qué ciudad nos escribes?"

PASO 2 — CUANDO YA TIENES SU NOMBRE Y CIUDAD:
Di EXACTAMENTE esto (reemplaza [nombre]):
"Perfecto, [nombre]. Somos una oficina de Recursos Humanos que trabaja con agencias en el sector financiero. Actualmente estamos entrevistando para áreas de ventas, mercadotecnia y finanzas con Globe Life. ¿Tienes experiencia en alguna de estas áreas o en atención al cliente?"

PASO 3 — DESPUÉS DE SU RESPUESTA SOBRE EXPERIENCIA:
Di EXACTAMENTE esto:
"No es obligatorio tener experiencia, lo importante es ser mayor de edad y poder trabajar legalmente en Estados Unidos. ¿Es tu caso?"

PASO 4 — SI CONFIRMA QUE PUEDE TRABAJAR LEGALMENTE:
Di EXACTAMENTE esto (reemplaza [nombre]):
"Perfecto, [nombre]. Me gustaría que conocieras todos los detalles de la oportunidad: beneficios, condiciones y posiciones disponibles. Para eso tenemos un video webinar corto que lo explica todo. ¿Tienes unos minutos para verlo?"

PASO 5 — SI DICE QUE SÍ AL WEBINAR:
Di EXACTAMENTE esto:
"¡Excelente! ¿Cuál es tu correo electrónico para enviártelo?"

PASO 6 — CUANDO TE DÉ SU CORREO:
Di EXACTAMENTE esto (reemplaza [correo]):
"Perfecto. En unos minutos recibirás un correo de administracion@grupoelite.com con el acceso al webinar. Te recomiendo verlo con calma. Cuando termines avísame y te ayudo con el siguiente paso."

═══════════════════════════════════════════
REGLAS CRÍTICAS
═══════════════════════════════════════════

1. SIGUE EL GUIÓN en orden. No te adelantes a pasos futuros.
2. Si el candidato pregunta algo, responde BREVEMENTE y vuelve al paso donde estabas.
3. Si ya tienes datos del candidato en el contexto (nombre, ciudad, etc.), NO los vuelvas a pedir — úsalos y avanza al paso correspondiente.
4. Si el candidato NO puede trabajar legalmente en EE.UU.: "Entiendo, en ese caso por ahora no tenemos una posición disponible para ti. ¡Mucho éxito!"
5. Si pide llamada: "Claro, un manager se pondrá en contacto contigo pronto."
6. NUNCA uses emojis. NUNCA escribas párrafos largos. NUNCA inventes información.
7. NUNCA digas que eres IA, robot, asistente virtual o chatbot.
`,

  qa: [
    {
      id: '1',
      question: '¿Cuánto puedo ganar? / ¿Cuál es el salario?',
      answer: 'Dependerá mucho del puesto a la cual puedas acceder según la oportunidad disponible, si te podemos decir que el pago es bastante competitivo, sin embargo durante el webinar puedes ver aproximadamente cómo es el sistema de compensación que tiene la compañía para todos los puestos.'
    },
    {
      id: '2',
      question: '¿Necesito experiencia en seguros?',
      answer: 'No necesitas ninguna experiencia, sin embargo, si tienes experiencia en algo relacionado a atención al cliente. Eso te podría ayudar bastante. Sin embargo, no es indispensable. Tampoco. Nuestra compañía. Tiene todas las herramientas para que aprendas desde cero.'
    },
    {
      id: '3',
      question: '¿Es trabajo remoto? / ¿Puedo trabajar desde casa?',
      answer: 'Tenemos puestos para trabajo presencial y para trabajo remoto, dependera de la disponibilidad de la agencia, cual de los dos tipos te interesa?'
    },
    {
      id: '4',
      question: '¿Es una pirámide o multinivel?',
      answer: 'No por supuesto que no nuestra compañía no trabaja como un sistema de Reclutamiento. Al contrario el trabajo se basa 100% en la venta directa a nuestro cliente.'
    },
    {
      id: '5',
      question: '¿Cuáles son los requisitos?',
      answer: 'Ser mayor de edad, hablar y escribir en español, de manera fluido y que tengas muy buena capacidad para comunicarte.'
    },
    {
      id: '6',
      question: '¿Tiene algún costo?',
      answer: 'No, por supuesto, no debes pagar nada. La compañía paga todo lo necesario. Sin embargo, si necesitas alguna licencia va a depender de el estado donde estés y de la oportunidad también que haya disponible. Sin embargo te pueden dar más detalles durante la entrevista. Por ello no te preocupes.'
    },
    {
      id: '7',
      question: '¿Cuándo puedo empezar?',
      answer: 'Bueno, el proceso bastante eficiente, lo importante ahora es que puedas ver el video web y luego iré a una entrevista allí te podrán dar más detalles y si eres seleccionado ya lo que queda es empezar el proceso como tal.'
    },
  ],

  triggers: [
    { id:'t1', escKey:'link-no-llega',    icon:'🔗', title:'Link no llega',        description:'El candidato confirmó que el correo es correcto pero aún no recibió el webinar después de esperar. El manager debe revisar y reenviar desde el CRM.' },
    { id:'t2', escKey:'pide-llamada',     icon:'📞', title:'Solicita llamada',      description:'El candidato pide explícitamente hablar por teléfono con alguien.' },
    { id:'t3', escKey:'groseria',         icon:'🚨', title:'Lenguaje ofensivo',     description:'El candidato usa insultos, palabras groseras o tono muy agresivo.' },
    { id:'t4', escKey:'fuera-de-alcance', icon:'❓', title:'Fuera de alcance',      description:'Ana no puede responder la pregunta y necesita consultar a un manager.' },
    { id:'t5', escKey:'tiene-licencia',   icon:'📋', title:'Ya tiene licencia',     description:'El candidato menciona que ya cuenta con licencia de seguros.' },
    { id:'t6', escKey:'sin-documentos',   icon:'⚠️', title:'Sin documentos legales','description':'El candidato menciona no tener documentos legales para trabajar en EE.UU.' },
  ],

  webinar: `## Manejo del Webinar

Una vez inscrito, el candidato recibirá su link al correo automáticamente.

---

## Correo no recibido — Flujo paso a paso

**Paso 1 — Confirmar correo**
Pregunta:
> Ok, revisemos eso. ¿Me confirmas si este es tu correo: [correo que tenemos registrado]?

**Paso 2 — Correo correcto: pedir que espere**
> A veces tarda un poco. Espera un par de minutos y revisa también la bandeja de spam. Avísame cuando lo recibas.

*(Espera a que el candidato responda. Si dice que aún no llegó, pasa al paso 3.)*

**Paso 3 — Sigue sin llegar: llamar al manager**
Responde al candidato:
> Entiendo, dame unos minutos para registrarte manualmente. Te aviso.

Activa inmediatamente: [ESC:link-no-llega]

Espera a que el candidato vuelva a escribir. Si lo hace ~10 minutos después diciendo que aún no recibió nada Y ningún manager ha tomado el caso (IA sigue activa):
→ Envía el link directamente:
> Mientras te conseguimos una solución definitiva, puedes acceder al webinar desde aquí: [WEBINAR_URL]

**Paso 4 — Correo incorrecto**
Si el candidato dice que el correo no es el correcto, pídele el correo actualizado y confírmalo antes de continuar.`,

  forbidden: `- No hablar de política ni religión
- no puedes usar emoji
- no puedes usar mensajes muy largo en un solo mensaje de ser necesario, dividirlo en dos o tres partes
- No puedes decir que eres un asistente virtual
- No puedes decir que eres un IA
- No puede decir que no eres una persona real
- si alguien te hace alguna insinuación acerca de trabajar sin permiso de trabajo sin social, o con algo que se pudiera considerar que no es una fuente legal de trabajo de documentación, simplemente dirás que necesitas hablarlo con un manager para darle más información.
- No comparar con otras empresas ni hablar mal de la competencia
- No prometer ingresos específicos ni garantizar resultados
- No dar información legal o médica
- No confirmar entrevistas ni fechas de webinar sin consultar con el equipo
- No hablar de temas que no sean relacionados con la oportunidad de trabajo`
};

// ── Config load/save (Firestore-backed, in-memory cache) ─────────────────────
let _configCache = null;

function fsConfigVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(fsConfigVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsConfigVal(x)])) } };
  return { stringValue: String(v) };
}

function fsConfigParse(fields) {
  if (!fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue  !== undefined) out[k] = v.stringValue;
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.doubleValue  !== undefined) out[k] = v.doubleValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.nullValue    !== undefined) out[k] = null;
    else if (v.arrayValue) out[k] = (v.arrayValue.values || []).map(i => fsConfigParse(i.mapValue?.fields || { _: i })?._  ?? fsConfigParseSingle(i));
    else if (v.mapValue)   out[k] = fsConfigParse(v.mapValue.fields || {});
  }
  return out;
}

function fsConfigParseSingle(v) {
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.doubleValue  !== undefined) return v.doubleValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.nullValue    !== undefined) return null;
  if (v.mapValue)    return fsConfigParse(v.mapValue.fields || {});
  if (v.arrayValue)  return (v.arrayValue.values || []).map(fsConfigParseSingle);
  return null;
}

async function loadConfigFromFirestore() {
  try {
    const res  = await fetch(CONFIG_DOC);
    const data = await res.json();
    if (data.fields) {
      const cfg = fsConfigParse(data.fields);
      if (data.fields.qa?.arrayValue?.values) {
        cfg.qa = data.fields.qa.arrayValue.values.map(v => fsConfigParse(v.mapValue?.fields || {}));
      }
      if (data.fields.cases?.arrayValue?.values) {
        cfg.cases = data.fields.cases.arrayValue.values.map(v => fsConfigParse(v.mapValue?.fields || {}));
      }
      if (data.fields.triggers?.arrayValue?.values) {
        cfg.triggers = data.fields.triggers.arrayValue.values.map(v => fsConfigParse(v.mapValue?.fields || {}));
      }
      return { ...DEFAULT_CONFIG, ...cfg };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function loadConfig() {
  // Return cache synchronously; refresh async in background
  if (!_configCache) _configCache = { ...DEFAULT_CONFIG };
  loadConfigFromFirestore().then(cfg => { _configCache = cfg; }).catch(() => {});
  return _configCache;
}

async function saveConfig(config) {
  try {
    _configCache = config;
    const fields = {
      general:   fsConfigVal(config.general  || ''),
      webinar:   fsConfigVal(config.webinar  || ''),
      forbidden: fsConfigVal(config.forbidden || ''),
      qa: {
        arrayValue: {
          values: (config.qa || []).map(item => ({
            mapValue: { fields: {
              id:       fsConfigVal(item.id       || ''),
              question: fsConfigVal(item.question || ''),
              answer:   fsConfigVal(item.answer   || ''),
            }}
          }))
        }
      },
      cases: {
        arrayValue: {
          values: (config.cases || []).map(item => ({
            mapValue: { fields: {
              id:        fsConfigVal(item.id        || ''),
              situation: fsConfigVal(item.situation || ''),
              response:  fsConfigVal(item.response  || ''),
            }}
          }))
        }
      },
      triggers: {
        arrayValue: {
          values: (config.triggers || []).map(item => ({
            mapValue: { fields: {
              id:          fsConfigVal(item.id          || ''),
              escKey:      fsConfigVal(item.escKey      || ''),
              icon:        fsConfigVal(item.icon        || ''),
              title:       fsConfigVal(item.title       || ''),
              description: fsConfigVal(item.description || ''),
            }}
          }))
        }
      },
    };
    const res = await fetch(CONFIG_DOC, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields }),
    });
    return res.ok;
  } catch { return false; }
}

// ── Entrevistas config (separate Firestore doc) ───────────────────────────────
const DEFAULT_ENTREVISTAS_CONFIG = { general:'', qa:[], forbidden:'', cases:[], triggers:[] };
let _entrevistasCache = null;

function _parseArrayField(fields, key, subFields) {
  if (!fields[key]?.arrayValue?.values) return [];
  return fields[key].arrayValue.values.map(v => {
    const f = v.mapValue?.fields || {};
    return Object.fromEntries(subFields.map(sf => [sf, f[sf]?.stringValue || '']));
  });
}

async function loadEntrevistasConfig() {
  try {
    const res  = await fetch(CONFIG_ENTREVISTAS_DOC);
    const data = await res.json();
    if (data.fields) {
      const cfg = {
        general:   data.fields.general?.stringValue   || '',
        forbidden: data.fields.forbidden?.stringValue || '',
        qa:       _parseArrayField(data.fields, 'qa',       ['id','question','answer']),
        cases:    _parseArrayField(data.fields, 'cases',    ['id','situation','response']),
        triggers: _parseArrayField(data.fields, 'triggers', ['id','escKey','icon','title','description']),
      };
      _entrevistasCache = cfg;
      return cfg;
    }
  } catch {}
  return { ...DEFAULT_ENTREVISTAS_CONFIG };
}

async function saveEntrevistasConfig(config) {
  try {
    _entrevistasCache = config;
    const mkArr = (items, subFields) => ({
      arrayValue: { values: items.map(item => ({
        mapValue: { fields: Object.fromEntries(subFields.map(sf => [sf, fsConfigVal(item[sf] || '')])) }
      }))}
    });
    const fields = {
      general:   fsConfigVal(config.general   || ''),
      forbidden: fsConfigVal(config.forbidden || ''),
      qa:       mkArr(config.qa       || [], ['id','question','answer']),
      cases:    mkArr(config.cases    || [], ['id','situation','response']),
      triggers: mkArr(config.triggers || [], ['id','escKey','icon','title','description']),
    };
    const res = await fetch(CONFIG_ENTREVISTAS_DOC, {
      method: 'PATCH', headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ fields }),
    });
    return res.ok;
  } catch { return false; }
}

// ── Build system prompt from config ──────────────────────────────────────────
async function buildSystemPrompt(channel = 'text') {
  const [entrevistasCfg, oldCfg] = await Promise.all([
    loadEntrevistasConfig().catch(() => ({})),
    loadConfigFromFirestore().catch(() => ({})),
  ]);
  // ai_entrevistas_config has the admin-edited prompts (general, qa, cases, triggers, forbidden)
  // ai_config has webinar which isn't part of the entrevistas editor
  const cfg = { ...oldCfg, ...entrevistasCfg, webinar: oldCfg.webinar || entrevistasCfg.webinar || '' };

  const channelNote = channel === 'voice'
    ? 'Estás en una LLAMADA DE VOZ. Responde en máximo 2 oraciones cortas y directas.'
    : channel === 'sms'
    ? 'Estás respondiendo un SMS. Sé muy breve. Sin emojis.'
    : 'Estás en WhatsApp. Puedes usar emojis con moderación.';

  const qaBlock = (cfg.qa || []).map(p =>
    `• Si preguntan sobre "${p.question}":\n  → ${p.answer}`
  ).join('\n\n');

  const casesBlock = (cfg.cases || []).map(c =>
    `• En caso de que ${c.situation}:\n  → ${c.response}`
  ).join('\n\n');

  return `${cfg.general}

CANAL ACTUAL: ${channelNote}

━━━ MANEJO DEL WEBINAR ━━━
${cfg.webinar || '(Sin instrucciones de webinar configuradas)'}

━━━ RESPUESTAS PARA PREGUNTAS FRECUENTES ━━━
${qaBlock || '(Sin preguntas configuradas)'}

━━━ EN CASO DE… — SITUACIONES ESPECÍFICAS ━━━
${casesBlock || '(Sin situaciones configuradas)'}

━━━ TEMAS PROHIBIDOS — NUNCA hablar de esto ━━━
${cfg.forbidden || '(Sin restricciones configuradas)'}


━━━ AGENDAR ENTREVISTA — INSTRUCCIÓN CRÍTICA ━━━
Cuando el candidato exprese claramente que quiere ir a la entrevista (ej: "quiero la entrevista", "quiero ir", "cómo agendo", "me apunto", "cuándo es la entrevista") Y ya confirmó que vio el webinar:
- Responde con entusiasmo breve (ej: "¡Perfecto! 🎉 Revisando los horarios disponibles para ti...")
- Añade OBLIGATORIAMENTE al FINAL (en línea nueva separada): [AGENDAR]
- NO menciones horarios ni fechas específicas — el sistema los enviará automáticamente.
- NO uses [AGENDAR] si el candidato aún no confirmó que vio el webinar.

━━━ ESCALADA AL EQUIPO — INSTRUCCIÓN CRÍTICA ━━━
Cuando detectes alguna de estas situaciones, añade OBLIGATORIAMENTE al FINAL de tu mensaje (en una línea nueva separada) la bandera exacta. El candidato NO la verá — solo el sistema la procesa internamente:

${(cfg.triggers || []).map(t => `[ESC:${t.escKey}] → ${t.description}`).join('\n')}

[ESC:resolved] → El candidato confirmó que el problema YA SE RESOLVIÓ solo (ej: "ya me llegó el correo", "ya pude entrar", "ya lo vi"). Usa esta bandera SOLO cuando hayas activado previamente una alerta y el candidato ahora confirma que todo está bien.

REGLA: Añade la bandera UNA sola vez por situación. Nunca más de una por mensaje.

━━━ USO DE DATOS YA PROPORCIONADOS — REGLA CRÍTICA ━━━
Si el candidato mencionó su NOMBRE en algún mensaje anterior de esta conversación:
- Dirígete a él/ella por su nombre en CADA respuesta desde ese momento. NUNCA lo llames por su número de teléfono.
- NO vuelvas a pedirle el nombre.

Si el candidato mencionó su CORREO en algún mensaje anterior:
- NO vuelvas a pedirlo.
- Confírmalo si es relevante, pero no lo solicites de nuevo.

Si hay un mensaje [SISTEMA] con datos del candidato al inicio del historial, esos datos son reales y actuales — úsalos de inmediato.`;
}

// ── Claude ────────────────────────────────────────────────────────────────────
async function askClaude(phone, userMessage, channel = 'text') {
  const key = phone || 'unknown';
  if (!conversationHistory.has(key)) conversationHistory.set(key, []);
  const history = conversationHistory.get(key);

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  while (history.length && history[0].ts < cutoff) history.shift();

  history.push({ role: 'user', content: userMessage, ts: Date.now() });
  // Merge consecutive same-role entries (can happen after history reconstruction)
  const _raw = history.slice(-20);
  const messages = [];
  for (const { role, content } of _raw) {
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + content;
    } else {
      messages.push({ role, content });
    }
  }

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: channel === 'voice' ? 150 : 512,
    system: await buildSystemPrompt(channel),
    messages,
  });

  const reply = response.content[0].text;
  history.push({ role: 'assistant', content: reply, ts: Date.now() });
  return reply;
}

// Respond from existing history without adding a new user message (used on IA resume)
async function askClaudeResume(phone, channel = 'wa') {
  const key     = phone || 'unknown';
  const history = conversationHistory.get(key) || [];
  if (!history.length) return null;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  while (history.length && history[0].ts < cutoff) history.shift();

  const _rawR = history.slice(-20);
  const messages = [];
  for (const { role, content } of _rawR) {
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + content;
    } else {
      messages.push({ role, content });
    }
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 512,
    system: await buildSystemPrompt(channel),
    messages,
  });

  const reply = response.content[0].text;
  history.push({ role: 'assistant', content: reply, ts: Date.now() });
  return reply;
}

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────
async function textToSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'nTkjq09AuYgsNR8E4sDe';
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true },
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${await resp.text()}`);
  return Buffer.from(await resp.arrayBuffer());
}

module.exports = { askClaude, askClaudeResume, textToSpeech, loadConfig, loadConfigFromFirestore, saveConfig, DEFAULT_CONFIG, conversationHistory, aiEnabled, loadEntrevistasConfig, saveEntrevistasConfig };
