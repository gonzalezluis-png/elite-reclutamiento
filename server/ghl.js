const https = require('https');

const GHL_TOKEN       = process.env.GHL_TOKEN       || 'pit-69006f34-c4ff-461e-bd6d-0f8446c3bcb4';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'rbnQBpmrGocbJydEYrl7';
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || '77v7OIyDB7gAXcbDu8y3';
const GHL_BASE        = 'services.leadconnectorhq.com';

function ghlRequest(method, path, body, version = '2021-07-28') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: GHL_BASE,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GHL_TOKEN}`,
        'Version':       version,
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Find contact by phone number; returns contact object or null
async function ghlFindContact(phone) {
  const normalized = phone.startsWith('+') ? phone : '+' + phone;
  const r = await ghlRequest('GET', `/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(normalized)}`);
  if (r.status === 200 && r.body.contacts?.length) return r.body.contacts[0];
  return null;
}

// Create contact in GHL; returns contact object
async function ghlCreateContact(phone, name, email) {
  const [firstName, ...rest] = (name || '').trim().split(' ');
  const lastName = rest.join(' ') || undefined;
  const body = {
    locationId: GHL_LOCATION_ID,
    phone:      phone.startsWith('+') ? phone : '+' + phone,
    firstName:  firstName || 'Candidato',
    ...(lastName ? { lastName } : {}),
    ...(email    ? { email }    : {}),
    source:     'Elite Reclutamiento CRM',
  };
  const r = await ghlRequest('POST', '/contacts/', body);
  if (r.status === 200 || r.status === 201) return r.body.contact || r.body;
  throw new Error(`GHL create contact failed: ${JSON.stringify(r.body)}`);
}

// Find or create contact; returns contactId
async function ghlFindOrCreateContact(phone, name, email) {
  let contact = await ghlFindContact(phone);
  if (!contact) contact = await ghlCreateContact(phone, name, email);
  return contact.id;
}

// Create appointment in GHL calendar; returns appointmentId or null
async function ghlBookAppointment({ contactId, slotIso, leadName, durationMins = 30 }) {
  const start   = new Date(slotIso);
  const end     = new Date(start.getTime() + durationMins * 60_000);
  const body = {
    calendarId: GHL_CALENDAR_ID,
    locationId: GHL_LOCATION_ID,
    contactId,
    startTime:  start.toISOString(),
    endTime:    end.toISOString(),
    title:      `Entrevista RR.HH. con ${leadName || 'Candidato'}`,
    appointmentStatus: 'confirmed',
  };
  const r = await ghlRequest('POST', '/calendars/events/appointments', body, '2021-04-15');
  if (r.status === 200 || r.status === 201) return r.body.id || null;
  console.error('[GHL] bookAppointment error:', r.body);
  return null;
}

// Update appointment status (e.g. cancelled)
async function ghlUpdateAppointment(appointmentId, updates) {
  if (!appointmentId) return false;
  const r = await ghlRequest('PUT', `/calendars/events/appointments/${appointmentId}`, updates, '2021-04-15');
  return r.status === 200 || r.status === 201;
}

module.exports = { ghlFindOrCreateContact, ghlBookAppointment, ghlUpdateAppointment };
