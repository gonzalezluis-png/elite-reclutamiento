// Auth session store — persisted in Firestore so Railway restarts don't wipe sessions
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/elite-reclutamiento-crm/databases/(default)/documents';
const FS_KEY  = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';

function normalizePhone(p) { return (p || '').replace(/\D/g, ''); }

async function fsGetSession(id) {
  try {
    const r = await fetch(`${FS_BASE}/er_sessions/${id}?key=${FS_KEY}`);
    if (!r.ok) return null;
    const doc = await r.json();
    if (!doc.fields) return null;
    const f = doc.fields;
    return {
      userId:   f.userId?.stringValue   || '',
      name:     f.name?.stringValue     || '',
      role:     f.role?.stringValue     || '',
      phone:    f.phone?.stringValue    || '',
      verified: f.verified?.booleanValue === true,
      expires:  Number(f.expires?.integerValue || 0),
    };
  } catch { return null; }
}

async function fsSetSession(id, s) {
  await fetch(`${FS_BASE}/er_sessions/${id}?key=${FS_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      userId:   { stringValue: s.userId   || '' },
      name:     { stringValue: s.name     || '' },
      role:     { stringValue: s.role     || '' },
      phone:    { stringValue: s.phone    || '' },
      verified: { booleanValue: !!s.verified },
      expires:  { integerValue: String(s.expires || 0) },
    }}),
  });
}

async function fsDeleteSession(id) {
  await fetch(`${FS_BASE}/er_sessions/${id}?key=${FS_KEY}`, { method: 'DELETE' });
}

// In-memory phone→sessionId index (rebuilt on lookup, fast path)
const AUTH_PHONE_PENDING = new Map();

async function handleAuthWAReply(rawPhone, body) {
  const norm      = normalizePhone(rawPhone);
  const sessionId = AUTH_PHONE_PENDING.get(norm);
  if (!sessionId) return false;

  const reply = (body || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (reply !== 'si' && reply !== 'yes' && reply !== '1') return false;

  try {
    const s = await fsGetSession(sessionId);
    if (!s || s.verified || s.expires < Date.now()) return false;
    s.verified = true;
    s.expires  = Date.now() + 24 * 60 * 60 * 1000;
    await fsSetSession(sessionId, s);
    AUTH_PHONE_PENDING.delete(norm);
    console.log(`[Auth] ✓ WA verificado — ${rawPhone}`);
    return true;
  } catch { return false; }
}

module.exports = { normalizePhone, handleAuthWAReply, fsGetSession, fsSetSession, fsDeleteSession, AUTH_PHONE_PENDING };
