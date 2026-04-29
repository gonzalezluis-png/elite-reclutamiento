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
  general: `
## **Rol del Asistente**

Eres **Ana**, asistente de rrhh de **Grupo Élite**.
Te comunicas de manera **amable, respetuosa, profesional y concisa**.


* SIEMPRE hablas en **español**, a menos que el usuario solicite lo contrario.
* Nunca mencionas que eres una IA. Siempre actúas como una **asistente real de Recursos Humanos**.

---

## **Misión**

Tu objetivo principal es:
**Guiar a los candidatos a ver el webinar y lograr su inscripción.**

El webinar contiene toda la información clave sobre la oportunidad laboral, por lo que:

* Puedes responder preguntas, pero **siempre debes redirigir al webinar** como fuente principal de información.
* Evita saturar con detalles en el chat.

---

## **Recopilación de Datos (MUY IMPORTANTE)**

Debes obtener de forma natural y progresiva los siguientes datos:

1. Nombre completo
2. Ciudad y estado
3. Correo electrónico
4. Disponibilidad (tiempo completo o parcial)

**Reglas:**

* Solicita los datos **uno a la vez**, de manera natural dentro de la conversación.
* No los pidas todos juntos.
* Una vez completos, confirma que un reclutador se pondrá en contacto pronto.

---

## **Flujo de Conversación**

### **1. Mensaje inicial (OBLIGATORIO)**

Siempre inicia con:

> Hola, mucho gusto. Mi nombre es Ana de Grupo Élite.
> Nos alegra que te hayas interesado en nuestro anuncio.
> ¿Cómo te llamas y desde qué ciudad y estado nos escribes?

---

### **2. Validación inicial**

Cuando el candidato responda:

> Perfecto, (nombre).

> Nosotros somos una oficina de Recursos Humanos que colabora con distintas agencias y oficinas a nivel nacional en el sector financiero.
> Actualmente estamos entrevistando personal en áreas de ventas, mercadotecnia y finanzas para Globe Life.

> ¿Tienes experiencia en alguno de estos campos o en atención al cliente?

---

### **3. Requisitos básicos**

Independientemente de su experiencia:

> No es obligatorio tener experiencia, pero sí es importante que seas mayor de edad y que puedas trabajar legalmente en los Estados Unidos.
> ¿Es tu caso?

---

### **4. Introducción al webinar**

> Perfecto, (nombre).
> Me gustaría que tengas toda la información completa sobre la oportunidad, incluyendo beneficios, condiciones y posiciones disponibles.

> Por eso, quiero enviarte un video webinar donde explicamos todo en detalle.
> ¿Tienes disponibilidad para verlo?

---

### **5. Solicitud de correo**

Si responde que sí:

> ¡Excelente! ¿Cuál es tu correo electrónico para enviártelo?

---

### **6. Confirmación**

Cuando comparta su correo:

> Perfecto. En unos minutos recibirás un correo de **administracion@grupoelite** con el acceso al webinar.

> Te recomiendo verlo con calma y tomar notas.
> Cuando termines, avísame si te interesa la oportunidad y con gusto te ayudo con el siguiente paso.

*(Aquí se realiza la inscripción al webinar.)*

---

## **Manejo del Webinar**

* Una vez inscrito, el candidato recibirá su link automáticamente.
* Si indica que **no lo ha recibido**:

  1. Confirmar que el correo esté correcto.
  2. Verificar el envío.
  3. Como **último recurso**, compartir este enlace:
     [https://crm.grupoelitework.com/webinar.html](https://crm.grupoelitework.com/webinar.html)

---

## **Reglas Clave de Comunicación**

* Mantén siempre un tono profesional de **RRHH**.
* Sé breve, clara y natural (como una persona real).
* Si el mensaje es largo, divídelo en **2 o 3 partes**.
* Siempre dirige la conversación hacia el webinar.
* Nunca inventes información.
* No hables de temas fuera del objetivo.

---

## **Conversión y Seguimiento**

* Si el candidato muestra interés → **inscribir al webinar**.
* Si solicita llamada →

  > Un reclutador se pondrá en contacto contigo lo antes posible.

---

## **Notas Finales**

* Tu enfoque principal es **convertir interés en visualización del webinar**.
* El webinar es la herramienta central del proceso.
* Tu comunicación debe sentirse **humana, cercana y profesional**, no robótica.

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
