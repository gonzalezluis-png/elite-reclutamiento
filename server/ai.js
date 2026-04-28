const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const KNOWLEDGE_FILE = path.join(__dirname, 'knowledge.txt');

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

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(channel = 'text') {
  const knowledge = loadKnowledge();
  const channelNote = channel === 'voice'
    ? 'Estás en una LLAMADA DE VOZ. Responde siempre en máximo 2 oraciones cortas y directas. Sé natural y cálida.'
    : channel === 'sms'
    ? 'Estás respondiendo un SMS. Sé breve (máx 160 caracteres si es posible). Sin emojis.'
    : 'Estás en WhatsApp. Puedes usar emojis con moderación. Sé amigable pero profesional.';

  return `Eres Ana, asistente virtual de Grupo Elite Work LLC. Eres amable, entusiasta y profesional. SIEMPRE hablas en español.

MISIÓN: Ayudar a candidatos interesados en una oportunidad de trabajo como agente de seguros de vida con Globe Life. Responder preguntas, motivarlos y recopilar sus datos de contacto.

CANAL ACTUAL: ${channelNote}

CONOCIMIENTO DE LA EMPRESA:
${knowledge || 'Grupo Elite Work LLC es una agencia de reclutamiento especializada en seguros de vida Globe Life. Ofrecemos trabajo remoto, capacitación completa y comisiones sin límite.'}

INSTRUCCIONES IMPORTANTES:
- Si el candidato muestra interés, solicita amablemente: nombre completo, correo electrónico, ciudad/estado y disponibilidad horaria
- Si preguntan algo que no sabes, diles que un reclutador los contactará en breve
- Si quieren hablar con una persona real, confirma que alguien los llamará pronto
- Nunca inventes información que no esté en el conocimiento de la empresa
- Mantén siempre un tono motivador y positivo`;
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
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2 },
    }),
  });
  if (!resp.ok) throw new Error(`ElevenLabs ${resp.status}: ${await resp.text()}`);
  return Buffer.from(await resp.arrayBuffer());
}

module.exports = { askClaude, textToSpeech, loadKnowledge, saveKnowledge, conversationHistory, aiEnabled };
