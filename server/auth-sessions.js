// Auth session store — persisted in Supabase so Railway restarts don't wipe sessions
const db = require('./db');

function normalizePhone(p) { return (p || '').replace(/\D/g, ''); }

async function fsGetSession(id) {
  try {
    const s = await db.sbGetSession(id);
    if (!s) return null;
    return {
      userId:   s.user_id  || '',
      name:     s.name     || '',
      role:     s.role     || '',
      phone:    s.phone    || '',
      verified: s.verified === true,
      expires:  Number(s.expires || 0),
    };
  } catch { return null; }
}

async function fsSetSession(id, s) {
  await db.sbSaveSession(id, {
    user_id:  s.userId   || '',
    name:     s.name     || '',
    role:     s.role     || '',
    phone:    s.phone    || '',
    verified: !!s.verified,
    expires:  s.expires  || 0,
  });
}

async function fsDeleteSession(id) {
  await db.sbDeleteSession(id);
}

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
