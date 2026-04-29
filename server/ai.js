const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
const CONFIG_DOC = `${FS_BASE}/config/ai_config?key=${FS_KEY}`;

// Per-phone conversation history: phone → [{role, content, ts}]
const conversationHistory = new Map();

// Channel toggles
const aiEnabled = {
  sms:   process.env.AI_SMS   !== 'false',
  wa:    process.env.AI_WA    !== 'false',
  voice: process.env.AI_VOICE !== 'false',
};

// ── Default config ────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  general: `Eres Ana, asistente virtual de Grupo Elite Work LLC. Eres amable, entusiasta y profesional. SIEMPRE hablas en español.

MISIÓN: Ayudar a candidatos interesados en trabajar como agente de seguros de vida con Globe Life. Tu objetivo es responder sus dudas, calificarlos y guiarlos hacia el webinar de información.

RECOPILACIÓN DE DATOS (MUY IMPORTANTE):
Durante la conversación debes obtener de forma natural estos datos del candidato:
1. Nombre completo
2. Ciudad y estado donde vive
3. Correo electrónico
4. Disponibilidad (tiempo completo o parcial)
Pídelos uno a la vez de forma natural, no todos juntos. Cuando los tengas todos, confirma que un reclutador los contactará pronto.

INSTRUCCIONES:
- Mantén siempre un tono motivador, cálido y positivo
- Si el candidato muestra interés, comienza a pedir sus datos gradualmente
- Si quieren hablar con una persona real, diles que alguien los llamará muy pronto
- Nunca inventes información que no esté en las respuestas configuradas`,

  qa: [
    {
      id: '1',
      question: '¿Cuánto puedo ganar? / ¿Cuál es el salario?',
      answer: 'Es trabajo por comisiones, sin techo de ingresos. La mayoría de agentes gana entre $2,000 y $8,000+ al mes según su esfuerzo y dedicación.'
    },
    {
      id: '2',
      question: '¿Necesito experiencia en seguros?',
      answer: 'No necesitas ninguna experiencia previa. Nosotros capacitamos desde cero. Lo más importante es la actitud y las ganas de aprender.'
    },
    {
      id: '3',
      question: '¿Es trabajo remoto? / ¿Puedo trabajar desde casa?',
      answer: 'Sí, es 100% remoto desde casa. Solo necesitas internet y un dispositivo (computadora, tablet o celular).'
    },
    {
      id: '4',
      question: '¿Es una pirámide o multinivel?',
      answer: 'No. Globe Life Insurance es una empresa cotizada en bolsa (NYSE: GL) con más de 70 años en el mercado. Los ingresos vienen 100% de comisiones por ventas de seguros, no por reclutar personas.'
    },
    {
      id: '5',
      question: '¿Cuáles son los requisitos?',
      answer: 'Ser mayor de 18 años, tener Número de Seguro Social (SSN), acceso a internet y disposición para tomar la capacitación. No se necesita experiencia previa.'
    },
    {
      id: '6',
      question: '¿Tiene algún costo?',
      answer: 'Solo el costo de la licencia estatal de seguros, que varía entre $50 y $150 según el estado. No hay cuotas ni pagos a la empresa.'
    },
    {
      id: '7',
      question: '¿Cuándo puedo empezar?',
      answer: 'El proceso es rápido. Primero el webinar de información → entrevista con un manager → tramitar la licencia estatal → iniciar. En 2-4 semanas puedes estar activo.'
    },
  ],

  forbidden: `- No hablar de política ni religión
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
      // qa is array of maps — parse each item
      if (data.fields.qa?.arrayValue?.values) {
        cfg.qa = data.fields.qa.arrayValue.values.map(v => fsConfigParse(v.mapValue?.fields || {}));
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
      forbidden: fsConfigVal(config.forbidden || ''),
      qa: {
        arrayValue: {
          values: (config.qa || []).map(item => ({
            mapValue: {
              fields: {
                id:       fsConfigVal(item.id       || ''),
                question: fsConfigVal(item.question || ''),
                answer:   fsConfigVal(item.answer   || ''),
              }
            }
          }))
        }
      }
    };
    const res = await fetch(CONFIG_DOC, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ fields }),
    });
    return res.ok;
  } catch { return false; }
}

// ── Build system prompt from config ──────────────────────────────────────────
async function buildSystemPrompt(channel = 'text') {
  const cfg = await loadConfigFromFirestore().catch(() => loadConfig());

  const channelNote = channel === 'voice'
    ? 'Estás en una LLAMADA DE VOZ. Responde en máximo 2 oraciones cortas y directas.'
    : channel === 'sms'
    ? 'Estás respondiendo un SMS. Sé muy breve. Sin emojis.'
    : 'Estás en WhatsApp. Puedes usar emojis con moderación.';

  const qaBlock = (cfg.qa || []).map(p =>
    `• Si preguntan sobre "${p.question}":\n  → ${p.answer}`
  ).join('\n\n');

  return `${cfg.general}

CANAL ACTUAL: ${channelNote}

━━━ RESPUESTAS PARA PREGUNTAS FRECUENTES ━━━
${qaBlock || '(Sin preguntas configuradas)'}

━━━ TEMAS PROHIBIDOS — NUNCA hablar de esto ━━━
${cfg.forbidden || '(Sin restricciones configuradas)'}`;
}

// ── Claude ────────────────────────────────────────────────────────────────────
async function askClaude(phone, userMessage, channel = 'text') {
  const key = phone || 'unknown';
  if (!conversationHistory.has(key)) conversationHistory.set(key, []);
  const history = conversationHistory.get(key);

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  while (history.length && history[0].ts < cutoff) history.shift();

  history.push({ role: 'user', content: userMessage, ts: Date.now() });
  const messages = history.slice(-20).map(({ role, content }) => ({ role, content }));

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: channel === 'voice' ? 150 : 512,
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

module.exports = { askClaude, textToSpeech, loadConfig, loadConfigFromFirestore, saveConfig, DEFAULT_CONFIG, conversationHistory, aiEnabled };
