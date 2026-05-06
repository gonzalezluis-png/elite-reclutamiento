// ── Supabase DB module — replaces all Firestore calls ────────────────────────
const SB_URL     = process.env.SUPABASE_URL || 'https://tffwtmrvlnblzyjwesze.supabase.co';
const SB_KEY     = process.env.SUPABASE_KEY || '';
const SB_HEADERS = {
  'apikey':        SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Content-Type':  'application/json',
};

function rest(path) { return `${SB_URL}/rest/v1${path}`; }

async function sbGet(table, query = '') {
  const r = await fetch(rest(`/${table}?${query}`), { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`DB GET ${table}: ${r.status}`);
  return r.json();
}

async function sbUpsert(table, row) {
  const r = await fetch(rest(`/${table}`), {
    method:  'POST',
    headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify(row),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`DB UPSERT ${table}: ${r.status} ${e}`); }
}

async function sbPatch(table, query, fields) {
  const r = await fetch(rest(`/${table}?${query}`), {
    method:  'PATCH',
    headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
    body:    JSON.stringify(fields),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`DB PATCH ${table}: ${r.status} ${e}`); }
}

async function sbDelete(table, query) {
  const r = await fetch(rest(`/${table}?${query}`), { method: 'DELETE', headers: SB_HEADERS });
  if (!r.ok) { const e = await r.text(); throw new Error(`DB DELETE ${table}: ${r.status} ${e}`); }
}

// ── Lead field mapping: metaWa ↔ meta_wa ─────────────────────────────────────
function normalizeLead(row) {
  if (!row) return row;
  if ('meta_wa' in row) { row.metaWa = row.meta_wa || []; delete row.meta_wa; }
  return row;
}
function denormalizeLead(lead) {
  if (!lead) return lead;
  const { metaWa, id, ...rest } = lead;
  return { id, ...rest, meta_wa: metaWa || [] };
}

// ── LEADS ─────────────────────────────────────────────────────────────────────
async function sbGetLead(id) {
  const rows = await sbGet('leads', `id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] ? normalizeLead(rows[0]) : null;
}

async function sbGetLeads() {
  const rows = await sbGet('leads', 'limit=1000&order=created_at.desc');
  return rows.map(normalizeLead);
}

async function sbGetLeadByPhone(phone) {
  const clean = phone.replace(/\D/g, '');
  const rows  = await sbGet('leads', `limit=500`);
  return rows.map(normalizeLead).find(l => {
    const ld = (l.telefono || '').replace(/\D/g, '');
    return ld && (ld === clean || ld.slice(-10) === clean.slice(-10));
  }) || null;
}

async function sbSaveLead(lead) {
  const row = denormalizeLead(lead);
  row.updated_at = new Date().toISOString();
  if (!row.created_at) row.created_at = row.updated_at;
  await sbUpsert('leads', row);
}

async function sbUpdateLead(id, fields) {
  const row = { ...fields, updated_at: new Date().toISOString() };
  if ('metaWa' in row) { row.meta_wa = row.metaWa; delete row.metaWa; }
  await sbPatch('leads', `id=eq.${encodeURIComponent(id)}`, row);
}

async function sbDeleteLead(id) {
  await sbDelete('leads', `id=eq.${encodeURIComponent(id)}`);
}

async function sbAppendMetaWa(leadId, message) {
  const lead = await sbGetLead(leadId);
  const arr  = Array.isArray(lead?.metaWa) ? lead.metaWa : [];
  arr.push(message);
  await sbUpdateLead(leadId, { meta_wa: arr });
}

// ── WA MESSAGES ───────────────────────────────────────────────────────────────
async function sbLogWAMessage(phone, direction, text, extra = {}) {
  const ts  = Date.now();
  const id  = `${ts}_${Math.random().toString(36).slice(2, 7)}`;
  const row = { id, phone, direction, text: text || '', ts, ...extra };
  await sbUpsert('wa_messages', row);
  return id;
}

async function sbGetWAMessages(phone, limit = 200) {
  const clean = phone.replace(/\D/g, '');
  return sbGet('wa_messages', `phone=eq.${clean}&order=ts.asc&limit=${limit}`);
}

async function sbGetAllWAContacts() {
  const rows = await sbGet('wa_messages', 'order=phone.asc&limit=5000');
  const byPhone = {};
  for (const m of rows) {
    if (!byPhone[m.phone]) byPhone[m.phone] = [];
    byPhone[m.phone].push({
      body:      m.text,
      direction: m.direction === 'out' ? 'outbound' : m.direction === 'in' ? 'inbound' : m.direction,
      dateSent:  new Date(m.ts).toISOString(),
      status:    m.status,
      sid:       m.id,
      ch:        'wa',
    });
  }
  return Object.entries(byPhone).map(([phone, messages]) => ({ phone, messages }));
}

async function sbUpdateWAMessage(id, fields) {
  await sbPatch('wa_messages', `id=eq.${encodeURIComponent(id)}`, fields);
}

async function sbDeleteWAMessages(phone) {
  const clean = phone.replace(/\D/g, '');
  await sbDelete('wa_messages', `phone=eq.${clean}`);
}

// ── SESSIONS ──────────────────────────────────────────────────────────────────
async function sbGetSession(id) {
  const rows = await sbGet('sessions', `id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function sbSaveSession(id, data) {
  await sbUpsert('sessions', { id, ...data });
}

async function sbDeleteSession(id) {
  await sbDelete('sessions', `id=eq.${encodeURIComponent(id)}`);
}

// ── USERS ─────────────────────────────────────────────────────────────────────
async function sbGetUsers() {
  return sbGet('users', 'order=created_at.asc&limit=500');
}

async function sbSaveUser(id, data) {
  await sbUpsert('users', { id, ...data });
}

async function sbUpdateUser(id, fields) {
  await sbPatch('users', `id=eq.${encodeURIComponent(id)}`, fields);
}

async function sbDeleteUser(id) {
  await sbDelete('users', `id=eq.${encodeURIComponent(id)}`);
}

// ── CONFIG ────────────────────────────────────────────────────────────────────
async function sbGetConfig(key) {
  const rows = await sbGet('config', `key=eq.${encodeURIComponent(key)}&limit=1`);
  return rows[0]?.value || null;
}

async function sbSetConfig(key, value) {
  await sbUpsert('config', { key, value, updated_at: new Date().toISOString() });
}

// ── WEBHOOK LOG ───────────────────────────────────────────────────────────────
async function sbLogWebhook(data) {
  const id = `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await sbUpsert('webhook_log', { id, ...data });
}

async function sbGetWebhookLog(limit = 100) {
  return sbGet('webhook_log', `order=ts.desc&limit=${limit}`);
}

// ── ESCALATIONS ───────────────────────────────────────────────────────────────
async function sbGetEscalations() {
  return sbGet('escalations', 'limit=500');
}

async function sbGetEscalationByPhone(phone) {
  const clean = phone.replace(/\D/g, '');
  const rows  = await sbGet('escalations', `lead_phone=eq.${clean}&limit=1`);
  return rows[0] || null;
}

async function sbSaveEscalation(id, data) {
  await sbUpsert('escalations', { id, ...data });
}

async function sbDeleteEscalation(id) {
  await sbDelete('escalations', `id=eq.${encodeURIComponent(id)}`);
}

async function sbDeleteEscalationByPhone(phone) {
  const clean = phone.replace(/\D/g, '');
  await sbDelete('escalations', `lead_phone=eq.${clean}`);
}

// ── TEAM MESSAGES ─────────────────────────────────────────────────────────────
async function sbLogTeamMessage(data) {
  const id = `tm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await sbUpsert('team_messages', { id, ...data });
}

async function sbGetTeamMessages(limit = 200) {
  return sbGet('team_messages', `order=ts.desc&limit=${limit}`);
}

// ── CALL LOG ──────────────────────────────────────────────────────────────────
async function sbLogCall(data) {
  const id = data.id || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await sbUpsert('call_log', { id, ...data });
}

async function sbGetCallLog(limit = 200) {
  return sbGet('call_log', `order=ts.desc&limit=${limit}`);
}

async function sbUpdateCall(id, fields) {
  await sbPatch('call_log', `id=eq.${encodeURIComponent(id)}`, fields);
}

// ── INTERVIEWS ────────────────────────────────────────────────────────────────
async function sbGetInterviews() {
  return sbGet('interviews', 'order=slot_iso.asc&limit=500');
}

async function sbGetInterviewsByConvKey(convKey) {
  return sbGet('interviews', `conv_key=eq.${encodeURIComponent(convKey)}&limit=10`);
}

async function sbGetInterviewsByPhone(phone) {
  const clean = phone.replace(/\D/g, '');
  return sbGet('interviews', `lead_phone=eq.${clean}&order=slot_iso.asc&limit=10`);
}

async function sbSaveInterview(id, data) {
  await sbUpsert('interviews', { id, ...data });
}

async function sbDeleteInterview(id) {
  await sbDelete('interviews', `id=eq.${encodeURIComponent(id)}`);
}

module.exports = {
  // Leads
  sbGetLead, sbGetLeads, sbGetLeadByPhone, sbSaveLead, sbUpdateLead, sbDeleteLead, sbAppendMetaWa,
  // WA Messages
  sbLogWAMessage, sbGetWAMessages, sbUpdateWAMessage, sbGetAllWAContacts, sbDeleteWAMessages,
  // Sessions
  sbGetSession, sbSaveSession, sbDeleteSession,
  // Users
  sbGetUsers, sbSaveUser, sbUpdateUser, sbDeleteUser,
  // Config
  sbGetConfig, sbSetConfig,
  // Webhook log
  sbLogWebhook, sbGetWebhookLog,
  // Escalations
  sbGetEscalations, sbGetEscalationByPhone, sbSaveEscalation, sbDeleteEscalation, sbDeleteEscalationByPhone,
  // Team messages
  sbLogTeamMessage, sbGetTeamMessages,
  // Call log
  sbLogCall, sbGetCallLog, sbUpdateCall,
  // Interviews
  sbGetInterviews, sbGetInterviewsByConvKey, sbGetInterviewsByPhone, sbSaveInterview, sbDeleteInterview,
};
