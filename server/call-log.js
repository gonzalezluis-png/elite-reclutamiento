const db = require('./db');

async function fsLogCall(data) {
  try {
    const sid = data.callSid || data.CallSid || `call_${Date.now()}`;
    await db.sbLogCall({
      id:            sid,
      call_sid:      sid,
      from_number:   data.from    || data.From    || '',
      to_number:     data.to      || data.To      || '',
      status:        data.status  || data.CallStatus || '',
      direction:     data.direction || data.Direction || '',
      duration:      parseInt(data.duration ?? data.Duration ?? 0) || 0,
      recording_url: data.recordingUrl  || '',
      transcription: data.transcription || '',
      type:          data.type  || '',
      label:         data.label || '',
      ts:            data.ts || Date.now(),
      start_time:    data.startTime || new Date().toISOString(),
    });
  } catch (e) {
    console.error('[fsLogCall]', e.message);
  }
}

async function fsGetCallLog(limit = 200) {
  try {
    const rows = await db.sbGetCallLog(limit);
    return rows.map(r => ({
      callSid:       r.call_sid      || '',
      from:          r.from_number   || '',
      to:            r.to_number     || '',
      status:        r.status        || '',
      direction:     r.direction     || '',
      duration:      r.duration      || 0,
      type:          r.type          || '',
      label:         r.label         || '',
      recordingUrl:  r.recording_url || '',
      transcription: r.transcription || '',
      startTime:     r.start_time    || '',
      ts:            r.ts            || 0,
    }));
  } catch { return []; }
}

module.exports = { fsLogCall, fsGetCallLog };
