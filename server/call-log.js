const FS_PROJECT = 'elite-reclutamiento-crm';
const FS_KEY     = 'AIzaSyCW2t1oHb7xc2Vi6vJROGRM7E7nu-CbU3s';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/(default)/documents`;

async function fsLogCall(data) {
  try {
    const sid = data.callSid || data.CallSid || `call_${Date.now()}`;
    const fields = {};
    const str = v => ({ stringValue: String(v ?? '') });
    const num = v => ({ integerValue: String(parseInt(v) || 0) });
    if (data.callSid || data.CallSid) fields.callSid = str(sid);
    if (data.from    || data.From)    fields.from     = str(data.from || data.From);
    if (data.to      || data.To)      fields.to       = str(data.to   || data.To);
    if (data.status  || data.CallStatus) fields.status = str(data.status || data.CallStatus);
    if (data.direction || data.Direction) fields.direction = str(data.direction || data.Direction);
    if (data.duration !== undefined || data.Duration !== undefined)
      fields.duration = num(data.duration ?? data.Duration);
    if (data.recordingUrl)  fields.recordingUrl  = str(data.recordingUrl);
    if (data.transcription) fields.transcription = str(data.transcription);
    if (data.type)  fields.type  = str(data.type);
    if (data.label) fields.label = str(data.label);
    fields.ts        = num(data.ts || Date.now());
    fields.startTime = str(data.startTime || new Date().toISOString());

    await fetch(`${FS_BASE}/call_log/${encodeURIComponent(sid)}?key=${FS_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
  } catch (e) {
    console.error('[fsLogCall]', e.message);
  }
}

async function fsGetCallLog(limit = 200) {
  const r = await fetch(
    `${FS_BASE}/call_log?key=${FS_KEY}&pageSize=${limit}&orderBy=ts+desc`,
    { headers: { 'Content-Type': 'application/json' } }
  );
  const data = await r.json();
  return (data.documents || []).map(doc => {
    const f  = doc.fields || {};
    const sv = k => f[k]?.stringValue || '';
    const nv = k => parseInt(f[k]?.integerValue || f[k]?.doubleValue || 0);
    return {
      callSid:      sv('callSid'),
      from:         sv('from'),
      to:           sv('to'),
      status:       sv('status'),
      direction:    sv('direction'),
      duration:     nv('duration'),
      type:         sv('type'),
      label:        sv('label'),
      recordingUrl: sv('recordingUrl'),
      transcription:sv('transcription'),
      startTime:    sv('startTime'),
      ts:           nv('ts'),
    };
  }).sort((a, b) => b.ts - a.ts);
}

module.exports = { fsLogCall, fsGetCallLog };
