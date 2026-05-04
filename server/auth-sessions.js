// Shared auth session store — imported by both server.js and meta.js
const AUTH_SESSIONS      = new Map(); // sessionId → session
const AUTH_PHONE_PENDING = new Map(); // normalizedPhone → sessionId

function normalizePhone(p) { return (p || '').replace(/\D/g, ''); }

// Clean up expired sessions every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of AUTH_SESSIONS) {
    if (s.expires < now) { AUTH_PHONE_PENDING.delete(s.phone); AUTH_SESSIONS.delete(id); }
  }
}, 60_000);

function handleAuthWAReply(rawPhone, body) {
  const norm      = normalizePhone(rawPhone);
  const sessionId = AUTH_PHONE_PENDING.get(norm);
  if (!sessionId) return false;
  const s = AUTH_SESSIONS.get(sessionId);
  if (!s || s.verified) return false;
  const reply = (body || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (reply === 'si' || reply === 'yes' || reply === '1') {
    s.verified = true;
    s.expires  = Date.now() + 24 * 60 * 60 * 1000;
    AUTH_PHONE_PENDING.delete(norm);
    console.log(`[Auth] ✓ WA verificado — ${rawPhone}`);
    return true;
  }
  return false;
}

module.exports = { AUTH_SESSIONS, AUTH_PHONE_PENDING, normalizePhone, handleAuthWAReply };
