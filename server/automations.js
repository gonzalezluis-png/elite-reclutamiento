const db = require('./db');

const AUTOMATION_DEFAULTS = {
  welcome_wa:           true,
  interview_confirmation: true,
  interview_reminder_morning: true,
  interview_zoom_link:  true,
  interview_noshow_alert: true,
  webinar_email:        true,
  escalation_resolved:  true,
};

let _cache = null;

async function getAutomationConfig() {
  if (_cache) return _cache;
  try {
    const saved = await db.sbGetConfig('automation_config');
    _cache = { ...AUTOMATION_DEFAULTS, ...(saved || {}) };
  } catch { _cache = { ...AUTOMATION_DEFAULTS }; }
  return _cache;
}

async function setAutomationConfig(updates) {
  const current = await getAutomationConfig();
  _cache = { ...current, ...updates };
  await db.sbSetConfig('automation_config', _cache);
  return _cache;
}

async function isEnabled(id) {
  const cfg = await getAutomationConfig();
  return cfg[id] !== false;
}

module.exports = { getAutomationConfig, setAutomationConfig, isEnabled, AUTOMATION_DEFAULTS };
