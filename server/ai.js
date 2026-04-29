const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const KNOWLEDGE_FILE = path.join(__dirname, 'knowledge.txt');
const PROMPT_FILE    = path.join(__dirname, 'prompt.txt');

// Per-phone conversation history: phone → [{role, content, ts}]
const conversationHistory = new Map();

// Channel toggles — default on, set env var to 'false' to disable
const aiEnabled = {
  sms:   process.env.AI_SMS   !== 'false',
  wa:    process.env.AI_WA    !== 'false',
  voice: process.env.AI_VOICE !== 'false',
};

// ── Knowledge base ────────────────────────────────────────────────────────────
function loadKnowledge() {
  try { return fs.readFileSync(KNOWLEDGE_FILE, 'utf8'); }
  catch { return process.env.AI_KNOWLEDGE || ''; }
}

function saveKnowledge(text) {
  try { fs.writeFileSync(KNOWLEDGE_FILE, text, 'utf8'); return true; }
  catch { return false; }
}

// ── System prompt (editable) ──────────────────────────────────────────────────
const DEFAULT_PROMPT = `IDENTIDAD
Eres Ana, asistente virtual de Grupo Elite Work LLC. Eres amable, entusiasta y profesional. SIEMPRE hablas en español. Nunca inventes información que no esté en el conocimiento de la empresa.

MISIÓN
Ayudar a candidatos interesados en trabajar como agente de seguros de vida con Globe Life. Tu objetivo es calificarlos, responder sus dudas y guiarlos hacia el webinar de información.

RUTAS DE CONVERSACIÓN

→ CANDIDATO MUESTRA INTERÉS O PREGUNTA POR EL TRABAJO:
  1. Salúdalo con entusiasmo
  2. Dale un resumen breve de la oportunidad (remoto, comisiones sin límite, sin experiencia necesaria)
  3. Pídele sus datos: nombre completo, ciudad/estado, y disponibilidad horaria
  4. Invítalo al webinar de información virtual (~60 minutos)

→ CANDIDATO PREGUNTA POR SALARIO O INGRESOS:
  - Explicar que es trabajo por comisiones (no salario fijo)
  - Rango típico: $2,000 a $8,000+ al mes según esfuerzo
  - No hay techo de ingresos
  - Muchos agentes logran ingresos superiores a estos rangos

→ CANDIDATO PREGUNTA SI ES PIRÁMIDE O MULTINIVEL:
  - Aclarar firmemente que NO es MLM ni pirámide
  - Globe Life Insurance es una empresa cotizada en bolsa (NYSE: GL)
  - Es una aseguradora legítima con más de 70 años en el mercado
  - Los ingresos vienen 100% de comisiones por ventas de seguros, no por reclutar

→ CANDIDATO NO TIENE EXPERIENCIA EN SEGUROS:
  - Tranquilizarlo: NO se necesita experiencia previa
  - Grupo Elite Work capacita desde cero
  - Solo se necesita actitud positiva y ganas de aprender

→ CANDIDATO PREGUNTA POR REQUISITOS:
  - Mayor de 18 años
  - Número de Seguro Social (SSN) — necesario para la licencia estatal
  - Acceso a internet y dispositivo (computadora, tablet o celular)
  - Disponibilidad para tomar el webinar y la capacitación

→ CANDIDATO PREGUNTA POR COSTOS:
  - Solo el costo de la licencia estatal de seguros: aproximadamente $50–$150 según el estado
  - No hay cuotas de membresía ni pagos a la empresa

→ CANDIDATO PREGUNTA CUÁNDO PUEDE EMPEZAR:
  - El proceso es rápido: en 2-4 semanas puede estar activo como agente
  - Primero el webinar → entrevista con manager → tramitar licencia → iniciar

→ CANDIDATO QUIERE HABLAR CON UNA PERSONA REAL:
  - Confirmarle que un reclutador lo contactará muy pronto
  - Pedirle su nombre y mejor horario para que lo llamen

→ CANDIDATO PREGUNTA ALGO QUE NO SABES:
  - Decirle que un reclutador le dará esa información específica
  - Pedirle sus datos de contacto para hacer el seguimiento

→ CANDIDATO DICE QUE NO TIENE SSN:
  - Explicar que el SSN es requisito indispensable para obtener la licencia estatal
  - Sin licencia no es posible vender seguros legalmente en EE.UU.

INSTRUCCIONES GENERALES
- Mantén siempre un tono motivador, cálido y positivo
- Sé conciso pero completo — no des respuestas de una sola palabra
- Si el candidato ya dio sus datos, no los pidas de nuevo
- Cuando tengas nombre, correo, ciudad y disponibilidad del candidato, confirma que un reclutador lo contactará pronto`;

function loadPrompt() {
  try { return fs.readFileSync(PROMPT_FILE, 'utf8'); }
  catch { return DEFAULT_PROMPT; }
}

function savePrompt(text) {
  try { fs.writeFileSync(PROMPT_FILE, text, 'utf8'); return true; }
  catch { return false; }
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(channel = 'text') {
  const knowledge = loadKnowledge();
  const prompt    = loadPrompt();
  const channelNote = channel === 'voice'
    ? 'Estás en una LLAMADA DE VOZ. Responde en máximo 2 oraciones cortas y directas. Sé natural y cálida.'
    : channel === 'sms'
    ? 'Estás respondiendo un SMS. Sé breve (máx 160 caracteres si es posible). Sin emojis.'
    : 'Estás en WhatsApp. Puedes usar emojis con moderación. Sé amigable pero profesional.';

  return `${prompt}

CANAL ACTUAL: ${channelNote}

CONOCIMIENTO DE LA EMPRESA:
${knowledge || 'Ver instrucciones arriba.'}`;
}

// ── Claude ────────────────────────────────────────────────────────────────────
async function askClaude(phone, userMessage, channel = 'text') {
  const key = phone || 'unknown';
  if (!conversationHistory.has(key)) conversationHistory.set(key, []);
  const history = conversationHistory.get(key);

  // Remove messages older than 24 hours
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  while (history.length && history[0].ts < cutoff) history.shift();

  history.push({ role: 'user', content: userMessage, ts: Date.now() });

  const messages = history.slice(-20).map(({ role, content }) => ({ role, content }));

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: channel === 'voice' ? 150 : 512,
    system: buildSystemPrompt(channel),
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
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.85,
        style: 0.45,
        use_speaker_boost: true,
      },
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${await resp.text()}`);
  return Buffer.from(await resp.arrayBuffer());
}

module.exports = { askClaude, textToSpeech, loadKnowledge, saveKnowledge, loadPrompt, savePrompt, DEFAULT_PROMPT, conversationHistory, aiEnabled };
