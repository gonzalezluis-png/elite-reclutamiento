const crypto = require('crypto');

const PIXEL_ID   = process.env.META_PIXEL_ID  || '';
const CAPI_TOKEN = process.env.META_CAPI_TOKEN || '';
const GRAPH_URL  = 'https://graph.facebook.com/v21.0';

function sha256(value) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

async function sendCAPIEvent(eventName, lead, customData = {}) {
  if (!PIXEL_ID || !CAPI_TOKEN) {
    console.warn(`[Pixel] META_PIXEL_ID o META_CAPI_TOKEN no configurados — ${eventName} omitido`);
    return;
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const eventId   = `${eventName}_${(lead.id || lead.telefono || '').replace(/\D/g, '')}_${eventTime}`;

  const userData = {};
  const phone = normalizePhone(lead.telefono);
  const email = (lead.correo || '').trim().toLowerCase();
  if (phone) userData.ph = sha256(phone);
  if (email) userData.em = sha256(email);

  const payload = {
    data: [{
      event_name:    eventName,
      event_time:    eventTime,
      event_id:      eventId,
      action_source: 'system_generated',
      user_data:     userData,
      custom_data:   customData,
    }],
  };

  try {
    const res  = await fetch(`${GRAPH_URL}/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    console.log(`[Pixel] ✓ ${eventName} → ${lead.telefono || lead.id} (recibidos: ${json.events_received})`);
  } catch (e) {
    console.error(`[Pixel] Error ${eventName}:`, e.message);
  }
}

// Lead inscrito en webinar — audiencia calificada
function pixelWebinar(lead) {
  return sendCAPIEvent('CompleteRegistration', lead, {
    content_name: 'Webinar Grupo Élite',
    status:       'inscrito',
    currency:     'MXN',
    value:        1,
  });
}

// Lead agendó entrevista — audiencia objetivo real
function pixelEntrevista(lead) {
  return sendCAPIEvent('Schedule', lead, {
    content_name: 'Entrevista Grupo Élite',
    status:       'agendada',
    currency:     'MXN',
    value:        10,
  });
}

module.exports = { pixelWebinar, pixelEntrevista };
