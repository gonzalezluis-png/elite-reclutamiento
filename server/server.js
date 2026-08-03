'use strict';
const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());
let lastAppointmentWebhook = null;
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Supabase config (m2base-sistemas / hiring.m2base.com) ─────────────────────
// M2BASE_* para evitar conflicto con SUPABASE_URL del proyecto GEW en Railway
const SB_URL  = process.env.M2BASE_SUPABASE_URL || 'https://esfjwnzigmapacbotzgh.supabase.co';
const SB_KEY  = process.env.M2BASE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzZmp3bnppZ21hcGFjYm90emdoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTY1NjMyNSwiZXhwIjoyMDk3MjMyMzI1fQ.ftYrR6o19lsAdXfctrHIJPPOZlC71tUm12NMm_8d8o8';
const HOSTINGER_M2BASE_URL = process.env.M2BASE_HOSTINGER_URL || 'https://hiring.m2base.com/m2base.php';
const HOSTINGER_GHL_SECRET = process.env.M2BASE_HOSTINGER_GHL_SECRET || crypto.createHash('sha256').update(`${SB_KEY}:m2base-hostinger-ingest-v1`).digest('hex');

async function sbInsert(table, record) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(record),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function sbUpsert(table, record, onConflict = 'id') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Prefer': 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(record),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

function stableAppointmentKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 16);
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

async function findExistingGhlRecord({ contactId, phone, email, appointment }) {
  const filters = [`workspace_id=eq.sistemas`, `appointment=eq.${encodeURIComponent(appointment)}`];
  if (contactId) filters.push(`ghl_contact_id=eq.${encodeURIComponent(contactId)}`);
  else if (phone) filters.push(`phone=eq.${encodeURIComponent(phone)}`);
  else if (email) filters.push(`email=eq.${encodeURIComponent(email)}`);
  else return null;

  const query = `${SB_URL}/rest/v1/m2base_records?${filters.join('&')}&select=id,status,assignee,comments,lead_group&limit=1`;
  const r = await fetch(query, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data[0] || null;
}

async function hostingerIngest(record) {
  const r = await fetch(`${HOSTINGER_M2BASE_URL}?action=ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-M2Base-GHL-Secret': HOSTINGER_GHL_SECRET },
    body: JSON.stringify(record),
  });
  if (!r.ok) throw new Error(`Hostinger ingest HTTP ${r.status}`);
  return r.json();
}

async function hostingerPatch(id, patch) {
  const r = await fetch(`${HOSTINGER_M2BASE_URL}?action=patch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-M2Base-GHL-Secret': HOSTINGER_GHL_SECRET },
    body: JSON.stringify({ id, ...patch }),
  });
  if (!r.ok) throw new Error(`Hostinger patch HTTP ${r.status}`);
  return r.json();
}

async function hostingerIngestHealth() {
  const r = await fetch(`${HOSTINGER_M2BASE_URL}?action=ingest-health`, {
    headers: { 'X-M2Base-GHL-Secret': HOSTINGER_GHL_SECRET },
  });
  const body = await r.json();
  return { ok: r.ok, status: r.status, service: body.service || null };
}

// ── Firestore config ──────────────────────────────────────────────────────────
const FS_PROJECT  = process.env.FS_PROJECT  || 'elite-reclutamiento-crm';
const FS_KEY      = process.env.FS_KEY      || 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE     = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
const COLLECTION  = 'webinar_leads';
const WEBINAR_URL = process.env.WEBINAR_URL || 'https://crm.grupoelitework.com/webinar.html';
const RESEND_KEY  = process.env.RESEND_API_KEY;
const EMAIL_FROM  = process.env.EMAIL_FROM  || 'webinar@grupoelitework.com';

// ── Firestore helpers ─────────────────────────────────────────────────────────
function toFsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(toFsVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toFsVal(val)])) } };
  return { stringValue: String(v) };
}

function fromFsVal(fv) {
  if (!fv) return null;
  if ('nullValue'      in fv) return null;
  if ('booleanValue'   in fv) return fv.booleanValue;
  if ('integerValue'   in fv) return parseInt(fv.integerValue);
  if ('doubleValue'    in fv) return fv.doubleValue;
  if ('stringValue'    in fv) return fv.stringValue;
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('arrayValue'     in fv) return (fv.arrayValue.values || []).map(fromFsVal);
  if ('mapValue'       in fv) return Object.fromEntries(
    Object.entries(fv.mapValue.fields || {}).map(([k, v]) => [k, fromFsVal(v)])
  );
  return null;
}

function fromFsDoc(doc) {
  if (!doc || !doc.fields) return null;
  const obj = Object.fromEntries(Object.entries(doc.fields).map(([k, v]) => [k, fromFsVal(v)]));
  if (doc.name) obj.id = doc.name.split('/').pop();
  return obj;
}

function docUrl(id) { return `${FS_BASE}/${COLLECTION}/${id}?key=${FS_KEY}`; }
function listUrl(pageToken)  {
  let u = `${FS_BASE}/${COLLECTION}?key=${FS_KEY}&pageSize=300`;
  if (pageToken) u += `&pageToken=${encodeURIComponent(pageToken)}`;
  return u;
}

async function fsGet(id) {
  const r = await fetch(docUrl(id));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fsGet ${id}: ${r.status}`);
  return fromFsDoc(await r.json());
}

async function fsList() {
  const all = [];
  let pageToken = null;
  do {
    const r = await fetch(listUrl(pageToken));
    if (!r.ok) throw new Error(`fsList: ${r.status}`);
    const data = await r.json();
    (data.documents || []).forEach(d => { const o = fromFsDoc(d); if (o) all.push(o); });
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return all;
}

async function fsSet(id, obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFsVal(v);
  }
  const r = await fetch(docUrl(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`fsSet ${id}: ${r.status} ${await r.text()}`);
}

async function fsPatch(id, obj) {
  const fields = {};
  const mask   = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) { fields[k] = toFsVal(v); mask.push(k); }
  }
  if (!mask.length) return;
  const url = `${FS_BASE}/${COLLECTION}/${id}?key=${FS_KEY}&${mask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')}`;
  const r   = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`fsPatch ${id}: ${r.status} ${await r.text()}`);
}

// ── Email ─────────────────────────────────────────────────────────────────────
async function sendWebinarEmail(correo, nombre, webinarUrl) {
  if (!RESEND_KEY || !correo) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Grupo Elite Work LLC <${EMAIL_FROM}>`,
        to:   [correo],
        subject: `${nombre ? nombre + ', t' : 'T'}u acceso al Webinar — Grupo Elite Work`,
        html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
      <tr><td style="background:linear-gradient(135deg,#0a0e1a,#162040);border-radius:14px 14px 0 0;padding:36px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4f7fff;">Grupo Elite Work LLC</p>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">Tu Oportunidad<br>con Globe Life</h1>
        <p style="margin:10px 0 0;font-size:13px;color:#7a8aaa;">American Income Life Division · Quintero &amp; Partners</p>
      </td></tr>
      <tr><td style="background:#ffffff;padding:32px 32px 8px;">
        <p style="margin:0;font-size:16px;color:#1e293b;font-weight:600;">Hola${nombre ? ', <strong>' + nombre + '</strong>' : ''} 👋</p>
        <p style="margin:12px 0 0;font-size:14px;color:#475569;line-height:1.7;">Gracias por tu interés en la oportunidad. Preparamos este webinar especialmente para ti — en él encontrarás todo lo que necesitas saber antes de tu entrevista.</p>
      </td></tr>
      <tr><td style="background:#ffffff;padding:8px 32px 28px;text-align:center;">
        <a href="${webinarUrl}" style="display:inline-block;background:linear-gradient(135deg,#0073ea,#0059b3);color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:9px;font-size:16px;font-weight:700;">
          🎥 &nbsp;Ver mi Webinar ahora
        </a>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">Este link es personal — fue generado exclusivamente para ti.</p>
      </td></tr>
      <tr><td style="background:#0a0e1a;border-radius:0 0 14px 14px;padding:24px 32px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#7a8aaa;">Grupo Elite Work LLC · administracion@grupoelite.com</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { console.error('[Email] Resend error:', d); return false; }
    console.log(`[Email] Enviado a ${correo} id:${d.id}`);
    return true;
  } catch (e) {
    console.error('[Email] Error:', e.message);
    return false;
  }
}

// ── GHL sync ─────────────────────────────────────────────────────────────────
const GHL_API     = 'https://services.leadconnectorhq.com';
const GHL_LOC     = 'rbnQBpmrGocbJydEYrl7';
const GHL_CF      = {
  link:    'wSU9lnAerych9tfLZ2M5',
  pct:     'fZZpZnQS4uo3DIPYuNVH',
  minutos: 'UG3dPJ4dZOyM0jW1T0u0',
  estado:  'QwzxA3jpbAw3Jbehunwr',
  fecha:   'qFL6UzRoQLDcWaOJx2CA',
};

async function ghlUpdateContact(contactId, fields) {
  const token = process.env.GHL_TOKEN || 'pit-69006f34-c4ff-461e-bd6d-0f8446c3bcb4';
  if (!token || !contactId) return;
  const customFields = Object.entries(fields)
    .filter(([k]) => GHL_CF[k])
    .map(([k, v]) => ({ id: GHL_CF[k], field_value: String(v) }));
  if (!customFields.length) return;
  try {
    await fetch(`${GHL_API}/contacts/${contactId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
      body: JSON.stringify({ customFields }),
    });
    console.log(`[GHL] Contacto ${contactId} actualizado`);
  } catch (e) {
    console.warn('[GHL] Error:', e.message);
  }
}

async function ghlNextAppointment(contactId) {
  const token = process.env.GHL_TOKEN || 'pit-69006f34-c4ff-461e-bd6d-0f8446c3bcb4';
  if (!token || !contactId) return null;
  try {
    const r = await fetch(`${GHL_API}/contacts/${contactId}/appointments`, {
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
    });
    const d = await r.json();
    console.log(`[GHL Appointments] contactId=${contactId} response:`, JSON.stringify(d).slice(0, 500));
    const list = d?.appointments || d?.events || (Array.isArray(d) ? d : []);
    const now = Date.now();
    const upcoming = list
      .map(a => ({ ...a, _ts: new Date(a.startTime || a.start_time || a.startAt || a.start || '').getTime() }))
      .filter(a => a._ts && a._ts >= now - 86400000 * 7) // hasta 7 días en el pasado
      .sort((a, b) => a._ts - b._ts);
    return upcoming[0]?.startTime || upcoming[0]?.start_time || upcoming[0]?.startAt || upcoming[0]?.start || null;
  } catch (e) {
    console.warn('[GHL Appointments] Error:', e.message);
    return null;
  }
}

async function ghlFindContactByPhone(phone) {
  const token = process.env.GHL_TOKEN || 'pit-69006f34-c4ff-461e-bd6d-0f8446c3bcb4';
  if (!token || !phone) return null;
  try {
    const r = await fetch(`${GHL_API}/contacts/?locationId=${GHL_LOC}&phone=${encodeURIComponent(phone)}&limit=1`, {
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
    });
    const d = await r.json();
    return d?.contacts?.[0]?.id || null;
  } catch { return null; }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Registrar nuevo lead desde formulario público
app.post('/webinar/register', async (req, res) => {
  try {
    const { leadId, nombre, telefono, correo } = req.body;
    if (!leadId) return res.status(400).json({ ok: false, error: 'leadId requerido' });

    const existing = await fsGet(leadId);
    if (existing?.fecha_inscripcion_webinar) {
      return res.json({ ok: true, leadId, link: existing.link_webinar });
    }

    const now         = new Date().toISOString();
    const personalUrl = `${WEBINAR_URL}?id=${leadId}&nombre=${encodeURIComponent(nombre || '')}&correo=${encodeURIComponent(correo || '')}`;

    await fsSet(leadId, {
      id:                        leadId,
      nombre:                    nombre   || '',
      telefono:                  telefono || '',
      correo:                    correo   || '',
      pipeline_id:               'en-webinar',
      etapa:                     'En Webinar sin actividad',
      link_webinar:              personalUrl,
      fecha_inscripcion_webinar: now,
      created_at:                now,
      updated_at:                now,
      webinar_visto_pct:         0,
      webinar_tiempo_visto:      0,
      vio_webinar:               false,
      webinar_completado:        false,
    });

    sendWebinarEmail(correo, nombre, personalUrl).catch(() => {});
    res.json({ ok: true, leadId, link: personalUrl });
  } catch (e) {
    console.error('[Register]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Tracking de progreso del video
app.post('/webinar/track/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    const ALLOWED = ['webinar_visto_pct', 'webinar_tiempo_visto', 'webinar_pausas',
      'webinar_completado', 'webinar_ultima_sesion', 'webinar_ultimo_evento',
      'quiere_entrevista', 'quiere_entrevista_fecha', 'vio_webinar'];

    const fields = {};
    for (const k of ALLOWED) {
      if (req.body[k] !== undefined) fields[k] = req.body[k];
    }

    const pct = Number(fields.webinar_visto_pct ?? 0);
    if (pct >= 80 || fields.webinar_completado === true) {
      fields.vio_webinar = true;
      fields.etapa       = 'AS - Asistente';
    }

    fields.updated_at = new Date().toISOString();
    await fsPatch(leadId, fields);
    res.json({ ok: true });

    // Sync a GHL en segundo plano (sin bloquear la respuesta)
    try {
      const lead = await fsGet(leadId);
      let ghlId  = lead?.ghl_contact_id;
      if (!ghlId && lead?.telefono) ghlId = await ghlFindContactByPhone(lead.telefono);
      if (ghlId) {
        const ghlFields = {};
        if (fields.webinar_visto_pct    !== undefined) ghlFields.pct     = fields.webinar_visto_pct;
        if (fields.webinar_tiempo_visto !== undefined) ghlFields.minutos = Math.round(Number(fields.webinar_tiempo_visto) / 60);
        if (fields.webinar_ultima_sesion)              ghlFields.fecha   = fields.webinar_ultima_sesion.slice(0, 10);
        if (fields.webinar_completado || (fields.webinar_visto_pct ?? 0) >= 80) ghlFields.estado = 'Visto';
        else if ((fields.webinar_visto_pct ?? 0) > 0) ghlFields.estado = 'En Progreso';
        await ghlUpdateContact(ghlId, ghlFields);
      }
    } catch (e) {
      console.warn('[Track→GHL]', e.message);
    }
  } catch (e) {
    console.error('[Track]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Datos para el dashboard de registracionmanagercrm
app.get('/webinar/dashboard-data', async (req, res) => {
  try {
    const leads  = await fsList();
    const result = leads.map(l => ({
      id:       l.id,
      nombre:   l.nombre   || '',
      correo:   l.correo   || '',
      telefono: l.telefono || '',
      pct:      Number(l.webinar_visto_pct) || 0,
      minutos:  l.webinar_tiempo_visto ? Math.round(Number(l.webinar_tiempo_visto) / 60) : 0,
      estado:   l.etapa    || 'En Webinar sin actividad',
      inscrito: l.fecha_inscripcion_webinar || l.created_at || '',
      visto:    l.webinar_ultima_sesion || '',
      link:     l.link_webinar || '',
    }));
    res.json({ ok: true, total: result.length, leads: result });
  } catch (e) {
    console.error('[Dashboard]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Reenviar correo del webinar
app.post('/send-webinar-email', async (req, res) => {
  try {
    const { correo, nombre, personalUrl } = req.body;
    if (!correo || !personalUrl) return res.status(400).json({ ok: false, error: 'correo y personalUrl requeridos' });
    const ok = await sendWebinarEmail(correo, nombre || '', personalUrl);
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Webhook de GHL: registrar lead en webinar y guardar ghl_contact_id
app.post('/ghl/webinar-register', async (req, res) => {
  try {
    console.log('[GHL Register] body:', JSON.stringify(req.body));
    const b = req.body;
    const nombre = b.nombre || b.full_name || b.name ||
      ((b.first_name || '') + (b.last_name ? ' ' + b.last_name : '')).trim() || '';
    const phone = b.phone || b.phone_number || b.telefono || '';
    const email = b.email || b.correo || '';
    const ghl_contact_id = b.ghl_contact_id || b.contact_id || b.id || '';
    const now      = new Date().toISOString();
    const leadId   = 'lead-ghl-' + Date.now();
    const webUrl   = process.env.WEBINAR_URL || WEBINAR_URL;
    const personalUrl = `${webUrl}?id=${leadId}&nombre=${encodeURIComponent(nombre || '')}&correo=${encodeURIComponent(email || '')}`;

    await fsSet(leadId, {
      id: leadId, nombre: nombre || '', telefono: phone || '', correo: email || '',
      ghl_contact_id: ghl_contact_id || '',
      pipeline_id: 'en-webinar', etapa: 'En Webinar sin actividad',
      link_webinar: personalUrl, fecha_inscripcion_webinar: now,
      created_at: now, updated_at: now,
      webinar_visto_pct: 0, webinar_tiempo_visto: 0,
      vio_webinar: false, webinar_completado: false,
    });

    if (ghl_contact_id) ghlUpdateContact(ghl_contact_id, { link: personalUrl, estado: 'Inscrito' }).catch(() => {});
    sendWebinarEmail(email, nombre, personalUrl).catch(() => {});

    res.json({ ok: true, leadId, webinarUrl: personalUrl });
  } catch (e) {
    console.error('[GHL Register]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Webhook GHL → Supabase (hiring.m2base.com) ───────────────────────────────
// GHL dispara este webhook cuando se agenda una entrevista/cita.
// Guarda el registro en Supabase para que hiring.m2base.com lo muestre.
//
// Campos que GHL puede enviar (todos opcionales excepto nombre o phone):
//   contact.firstName, contact.lastName, contact.email, contact.phone
//   contact.city, contact.state, contact.source
//   appointment.startTime  → fecha/hora de la cita (ISO string)
//   appointment.title      → descripción
//   appointment.status     → "confirmed", "pending", etc.
//   assignedTo.name        → nombre del agente asignado
//   customField.*          → campos personalizados de GHL
//
app.post('/ghl/cita', async (req, res) => {
  try {
    console.log('[GHL Cita] body:', JSON.stringify(req.body, null, 2));
    const b = req.body;

    // ── Extraer campos del contacto ──────────────────────────────────────────
    const contact     = b.contact || {};
    const calendar    = b.calendar || b.appointment || b.appoinment || {};
    const assigned    = b.assignedTo || b.assigned_to || b.user || {};
    const campaign    = b.campaign || contact.campaign || {};
    const custom      = b.customFields || b.custom_fields || b.customField || b.custom_field ||
                        contact.customFields || contact.custom_fields || contact.customField || contact.custom_field || {};
    const customValue = (...keys) => {
      for (const key of keys) {
        const direct = custom?.[key];
        if (direct && typeof direct === 'object' && 'value' in direct) return String(direct.value || '').trim();
        if (direct !== undefined && direct !== null && direct !== '') return String(direct).trim();
        const listItem = Array.isArray(custom) ? custom.find(item => [item?.key, item?.id, item?.name, item?.fieldKey].includes(key)) : null;
        if (listItem?.value !== undefined && listItem.value !== null && listItem.value !== '') return String(listItem.value).trim();
      }
      return '';
    };
    const contactId   = b.ghl_contact_id || b.contact_id || b.contactId || contact.id || '';

    const firstName = b.first_name || contact.firstName || contact.first_name || '';
    const lastName  = b.last_name  || contact.lastName  || contact.last_name  || '';
    const applicant = b.full_name || b.nombre || b.name ||
      `${firstName}${lastName ? ' ' + lastName : ''}`.trim() || 'Sin nombre';

    const phone  = b.phone || contact.phone || contact.phoneNumber || b.telefono || '';
    const email  = b.email || contact.email || b.correo || '';
    const city   = b.city  || contact.city  || b.ciudad || '';
    const state  = b.state || contact.state || b.estado || '';

    const rawSource = b.contact_source || b.source || contact.source || b.fuente || b.lead_source || '';
    let source = rawSource;
    const attrObj = contact.attributionSource || b.attributionSource || {};
    if (!source && attrObj && typeof attrObj === 'object') {
      const s = (attrObj.utmSource || attrObj.source || attrObj.medium || attrObj.sessionSource || '').toLowerCase();
      if (s.includes('facebook') || s.includes('paid social') || s.includes('instagram')) source = 'Facebook';
      else if (s.includes('indeed')) source = 'Indeed';
      else if (s.includes('google')) source = 'Google';
      else source = attrObj.utmSource || attrObj.source || '';
    }

    const campaignId = b.campaign_id || b.campaignId || campaign.id || campaign.campaign_id || attrObj.campaignId || customValue('campaign_id', 'Campaign ID');
    const campaignName = b.campaign_name || b.campaignName || campaign.name || campaign.campaign_name || attrObj.campaignName || attrObj.utmCampaign || customValue('campaign_name', 'Campaign Name');
    const gclid = b.gclid || contact.gclid || attrObj.gclid || customValue('gclid', 'GCLID', 'Google Click ID');
    const fbclid = b.fbclid || contact.fbclid || attrObj.fbclid || customValue('fbclid', 'FBCLID', 'Facebook Click ID');

    // ── Fecha/hora de la cita ─────────────────────────────────────────────────
    // GHL manda la cita en b.calendar.startTime
    let rawDate = calendar.startTime || calendar.start_time ||
                  b.startTime || b.start_time || b.fecha || '';
    if (!rawDate && contactId) rawDate = await ghlNextAppointment(contactId) || '';
    const defaultDate = !rawDate;
    if (!rawDate) rawDate = new Date().toISOString();
    const appointmentStr = new Date(rawDate).toLocaleString('es-MX', { timeZone: 'America/Chicago',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true });

    const appointmentId = calendar.id || calendar.appointmentId || calendar.appointment_id ||
      b.appointmentId || b.appointment_id || b.eventId || b.event_id || '';
    const existing = await findExistingGhlRecord({ contactId, phone, email, appointment: appointmentStr });

    // ── Asignado: siempre vacío, se asigna manualmente en el sistema ─────────
    const assigneeName = 'Sin asignacion';

    // ── Construir registro para Supabase ──────────────────────────────────────
    const identity = appointmentId || [contactId || phone || email || applicant, stableAppointmentKey(rawDate)].join('|');
    const id = existing?.id || `ghl-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
    const record = {
      id,
      workspace_id: 'sistemas',      // Lista de entrevistas
      applicant,
      phone,
      email,
      city,
      state,
      appointment:  appointmentStr,
      source,
      platform:     'Sin Necesidad',
      status:       'Sin clasificar',
      assignee:     assigneeName,
      comments:     defaultDate ? 'Fecha por defecto' : (calendar.title || b.notes || b.notas || ''),
      lead_group:   null,
      ghl_contact_id: contactId || null,
      campaign_id:   campaignId || null,
      campaign_name: campaignName || null,
      gclid:         gclid || null,
      fbclid:        fbclid || null,
    };

    // Un webhook repetido no debe reiniciar cambios manuales del equipo.
    if (existing) {
      record.status = existing.status || record.status;
      record.assignee = existing.assignee || record.assignee;
      record.comments = existing.comments || record.comments;
      record.lead_group = existing.lead_group || null;
    }

    await sbUpsert('m2base_records', record, 'id');
    let hostingerSynced = false;
    try {
      await hostingerIngest(record);
      hostingerSynced = true;
    } catch (syncError) {
      console.warn('[GHL Cita] Hostinger sync pendiente:', syncError.message);
    }
    console.log(`[GHL Cita] ${existing ? 'Actualizado' : 'Creado'} en Supabase: ${id} — ${applicant}`);

    res.json({ ok: true, id, applicant, deduplicated: Boolean(existing), hostingerSynced });
  } catch (e) {
    const detail = e.cause?.message || e.cause?.code || '';
    console.error('[GHL Cita] Error:', e.message, detail);
    res.status(500).json({ ok: false, error: e.message, detail });
  }
});

// ── Monday.com proxy (evita CORS desde el browser) ───────────────────────────
app.post('/monday/create-item', async (req, res) => {
  const MONDAY_TOKEN = process.env.MONDAY_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjUzODI3MzkxNywiYWFpIjoxMSwidWlkIjo3NDQyMTcxMiwiaWFkIjoiMjAyNS0wNy0xMlQwMzozNTo0NS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6Mjg5MTk5NTEsInJnbiI6InVzZTEifQ.d5JNziReZS3ZUqEEPofaqsQWUE2-Vz72FuaryyDC-KQ';
  try {
    const { boardId, lead } = req.body;
    if (!boardId || !lead) return res.status(400).json({ ok: false, error: 'boardId y lead requeridos' });

    const colVals = {};
    if (lead.telefono)    colVals['phone_mm011kem'] = { phone: lead.telefono.replace(/\D/g,'').replace(/^1/,''), countryShortName: 'US' };
    if (lead.email)       colVals['email_mm01kdgd'] = { email: lead.email, text: lead.email };
    if (lead.direccion)   colVals['text_mm01m2tm']  = lead.direccion;
    if (lead.solicitudes) colVals['text_mm01ryey']  = lead.solicitudes;
    if (lead.ubicacion)   colVals['color_mm01canv'] = { label: lead.ubicacion };

    const query = `mutation {
      create_item(
        board_id: ${Number(boardId)},
        item_name: ${JSON.stringify(lead.nombre || 'Sin nombre')},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}
      ) { id }
    }`;

    const r = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Authorization': MONDAY_TOKEN, 'Content-Type': 'application/json', 'API-Version': '2024-01' },
      body: JSON.stringify({ query }),
    });
    const d = await r.json();
    if (d.errors?.length) return res.status(400).json({ ok: false, error: d.errors[0].message });
    res.json({ ok: true, id: d.data?.create_item?.id });
  } catch (e) {
    console.error('[Monday]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Webhook GHL → Supabase: appointment creado/confirmado ────────────────────
// GHL dispara este webhook cuando se agenda o confirma una cita de entrevista.
// Busca el registro existente por teléfono o email y actualiza la fecha.
app.post('/ghl/appointment', async (req, res) => {
  try {
    lastAppointmentWebhook = { ts: new Date().toISOString(), body: req.body };
    console.log('[GHL Appointment] body:', JSON.stringify(req.body, null, 2));
    const b = req.body;
    const appt = b.appointment || b.appoinment || b;
    const contact = b.contact || b;

    const startTime = appt.startTime || appt.start_time || appt.startAt || b.startTime || '';
    if (!startTime) return res.json({ ok: true, skipped: 'no startTime' });

    const appointmentStr = new Date(startTime).toLocaleString('es-MX', {
      timeZone: 'America/Chicago', weekday: 'long', year: 'numeric',
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    });

    const phone = (contact.phone || contact.phoneNumber || b.phone || '').replace(/\D/g, '');
    const email = contact.email || b.email || '';
    const contactId = contact.id || b.contactId || b.contact_id || '';

    // Buscar registro en Supabase por phone, email o contactId
    let existing = null;
    for (const [field, value] of [['phone', phone], ['email', email]]) {
      if (!value) continue;
      const r = await fetch(`${SB_URL}/rest/v1/m2base_records?workspace_id=eq.sistemas&${field}=ilike.*${encodeURIComponent(value.slice(-10))}*&order=created_at.desc&limit=1`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      });
      const rows = await r.json();
      if (rows[0]) { existing = rows[0]; break; }
    }

    if (!existing) {
      console.log(`[GHL Appointment] No record found for phone=${phone} email=${email}`);
      return res.json({ ok: true, skipped: 'no matching record' });
    }

    await fetch(`${SB_URL}/rest/v1/m2base_records?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ appointment: appointmentStr, updated_at: new Date().toISOString() }),
    });

    let hostingerSynced = false;
    try {
      await hostingerPatch(existing.id, { appointment: appointmentStr, updated_at: new Date().toISOString() });
      hostingerSynced = true;
    } catch (syncError) {
      console.warn('[GHL Appointment] Hostinger sync pendiente:', syncError.message);
    }
    console.log(`[GHL Appointment] Actualizado ${existing.id} (${existing.applicant}) → ${appointmentStr}`);
    res.json({ ok: true, id: existing.id, appointment: appointmentStr, hostingerSynced });
  } catch (e) {
    console.error('[GHL Appointment] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Debug: ver último webhook de appointment recibido
app.get('/debug/last-appointment', (req, res) => res.json(lastAppointmentWebhook || { msg: 'Ningún webhook recibido aún' }));

// Batch: buscar fechas en GHL para leads sin fecha de esta semana
app.post('/admin/fix-missing-dates', async (req, res) => {
  const token = process.env.GHL_TOKEN || 'pit-69006f34-c4ff-461e-bd6d-0f8446c3bcb4';
  if (!token) return res.status(500).json({ ok: false, error: 'GHL_TOKEN no configurado' });

  try {
    // 1. Traer leads sin fecha de Supabase
    const r = await fetch(`${SB_URL}/rest/v1/m2base_records?workspace_id=eq.sistemas&appointment=eq.&select=id,applicant,phone,email`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const leads = await r.json();
    console.log(`[FixDates] ${leads.length} leads sin fecha`);

    const results = [];
    for (const lead of leads) {
      try {
        // 2. Buscar contacto en GHL por teléfono o email (usa query param)
        const phone = (lead.phone || '').replace(/\D/g, '');
        let contactId = null;

        if (phone) {
          const query = '+' + phone;
          const sr = await fetch(`${GHL_API}/contacts/?locationId=${GHL_LOC}&query=${encodeURIComponent(query)}&limit=5`, {
            headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
          });
          const sd = await sr.json();
          contactId = sd?.contacts?.[0]?.id || null;
        }

        if (!contactId && lead.email) {
          const sr = await fetch(`${GHL_API}/contacts/?locationId=${GHL_LOC}&query=${encodeURIComponent(lead.email)}&limit=5`, {
            headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
          });
          const sd = await sr.json();
          contactId = sd?.contacts?.[0]?.id || null;
        }

        if (!contactId && lead.applicant) {
          const sr = await fetch(`${GHL_API}/contacts/?locationId=${GHL_LOC}&query=${encodeURIComponent(lead.applicant)}&limit=5`, {
            headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28' },
          });
          const sd = await sr.json();
          contactId = sd?.contacts?.[0]?.id || null;
        }

        if (!contactId) { results.push({ id: lead.id, applicant: lead.applicant, status: 'no contact found' }); continue; }

        // 3. Buscar citas del contacto
        const apptDate = await ghlNextAppointment(contactId);
        if (!apptDate) { results.push({ id: lead.id, applicant: lead.applicant, status: 'no appointment found', contactId }); continue; }

        const appointmentStr = new Date(apptDate).toLocaleString('es-MX', {
          timeZone: 'America/Chicago', weekday: 'long', year: 'numeric',
          month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
        });

        // 4. Actualizar en Supabase
        await fetch(`${SB_URL}/rest/v1/m2base_records?id=eq.${lead.id}`, {
          method: 'PATCH',
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ appointment: appointmentStr, updated_at: new Date().toISOString() }),
        });

        results.push({ id: lead.id, applicant: lead.applicant, status: 'updated', appointment: appointmentStr });
        console.log(`[FixDates] ✓ ${lead.applicant} → ${appointmentStr}`);
        await new Promise(resolve => setTimeout(resolve, 300)); // rate limit
      } catch (e) {
        results.push({ id: lead.id, applicant: lead.applicant, status: 'error', error: e.message });
      }
    }
    res.json({ ok: true, total: leads.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({ ok: true, service: 'webinar', v: 'e696c53', ts: Date.now() }));

app.get('/health/m2base', async (req, res) => {
  try {
    const health = await hostingerIngestHealth();
    res.status(health.ok ? 200 : 502).json({ ok: health.ok, hostinger: health });
  } catch (e) {
    res.status(502).json({ ok: false, hostinger: { ok: false, error: e.message } });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webinar server → port ${PORT}`));
