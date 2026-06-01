'use strict';
const express = require('express');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
function listUrl()  { return `${FS_BASE}/${COLLECTION}?key=${FS_KEY}&pageSize=500`; }

async function fsGet(id) {
  const r = await fetch(docUrl(id));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fsGet ${id}: ${r.status}`);
  return fromFsDoc(await r.json());
}

async function fsList() {
  const r = await fetch(listUrl());
  if (!r.ok) throw new Error(`fsList: ${r.status}`);
  const data = await r.json();
  return (data.documents || []).map(fromFsDoc);
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
  const token = process.env.GHL_API_KEY;
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

async function ghlFindContactByPhone(phone) {
  const token = process.env.GHL_API_KEY;
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
    const { nombre, phone, email, ghl_contact_id } = req.body;
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

// Health check
app.get('/', (req, res) => res.json({ ok: true, service: 'webinar', ts: Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webinar server → port ${PORT}`));
