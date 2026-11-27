// server.js
// REST + SSE service for the meeting-timer app. Everything lives in memory
// (see meetingStore.js) - simple on purpose, no database.

const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const store = require('./meetingStore');

const app = express();
// The request bodies are small ({ title, duration }); this keeps a client from
// filling the memory with large ones.
app.use(express.json({ limit: '1kb' }));

// How often an open SSE stream gets a heartbeat. While the timer runs, the
// heartbeat is the full state, so clients re-anchor their countdown and any
// error can't build up; while paused it is an SSE comment, which keeps
// proxies from closing the idle connection.
app.set('heartbeatMs', 10000);

// meetingId -> Set of { res, role, close }, used to push SSE updates to open
// clients. A Set keeps insertion order, so its first entry is the oldest.
const subscribers = new Map();

// A meeting is shown on a handful of screens. When one more connects, the
// oldest stream is closed rather than the new one refused: the oldest is the
// likeliest to be a dead connection from a device that went to sleep, and a
// live one reconnects on its own (EventSource does that when a stream ends).
const MAX_VIEWS_PER_MEETING = 10;

const isInUse = (meetingId) => subscribers.has(meetingId);

function sendState(res, meeting, role) {
  res.write(`event: state\ndata: ${JSON.stringify(store.toPublicState(meeting, role))}\n\n`);
}

function broadcastMeeting(meetingId, meeting) {
  const subs = subscribers.get(meetingId);
  if (!subs) return;
  for (const sub of subs) {
    sendState(sub.res, meeting, sub.role);
  }
}

function findMeeting(req, res) {
  const resolved = store.resolveToken(req.params.token);
  if (!resolved) {
    res.status(404).json({ error: 'unknown-token' });
    return null;
  }
  store.touch(resolved.meeting);
  return resolved;
}

function requireAdmin(req, res, resolved) {
  if (resolved.role !== 'admin') {
    res.status(403).json({ error: 'admin-token-required' });
    return false;
  }
  return true;
}

// POST /api/meetings { title?, duration } -> { id, adminToken, viewerToken }
app.post('/api/meetings', (req, res) => {
  const body = req.body || {};
  const { duration } = body;
  if (!store.isValidDuration(duration)) {
    return res.status(400).json({ error: 'invalid-duration' });
  }
  const title = store.normalizeTitle(body.title);
  if (title === null) {
    return res.status(400).json({ error: 'invalid-title' });
  }
  const meeting = store.createMeeting({ title, duration }, isInUse);
  if (!meeting) {
    return res.status(503).json({ error: 'too-many-meetings' });
  }
  res.status(201).json({
    id: meeting.id,
    adminToken: meeting.adminToken,
    viewerToken: meeting.viewerToken,
  });
});

// GET /api/meetings/:token -> current state, works with admin or viewer token
app.get('/api/meetings/:token', (req, res) => {
  const resolved = findMeeting(req, res);
  if (!resolved) return;
  res.json(store.toPublicState(resolved.meeting, resolved.role));
});

// GET /api/meetings/:token/events -> Server-Sent Events stream of state changes
app.get('/api/meetings/:token/events', (req, res) => {
  const resolved = findMeeting(req, res);
  if (!resolved) return;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const meetingId = resolved.meeting.id;
  if (!subscribers.has(meetingId)) subscribers.set(meetingId, new Set());
  const subs = subscribers.get(meetingId);
  if (subs.size >= MAX_VIEWS_PER_MEETING) {
    const oldest = subs.values().next().value;
    subs.delete(oldest);
    oldest.close();
  }
  const sub = { res, role: resolved.role, close: () => { clearInterval(heartbeat); res.end(); } };
  subs.add(sub);

  sendState(res, resolved.meeting, resolved.role); // initial snapshot

  const heartbeat = setInterval(() => {
    // An exception here would not reach Express and would stop the whole
    // process, so a fault in one meeting must not take the others with it.
    try {
      if (resolved.meeting.running) sendState(res, resolved.meeting, resolved.role);
      else res.write(': ping\n\n');
    } catch (err) {
      console.error('SSE heartbeat failed:', err);
    }
  }, req.app.get('heartbeatMs'));

  req.on('close', () => {
    clearInterval(heartbeat);
    const subs = subscribers.get(meetingId);
    subs?.delete(sub);
    if (subs?.size === 0) subscribers.delete(meetingId);
    // The meeting's idle time counts from when its last client left.
    store.touch(resolved.meeting);
  });
});

function handleAction(actionFn) {
  return (req, res) => {
    const resolved = findMeeting(req, res);
    if (!resolved) return;
    if (!requireAdmin(req, res, resolved)) return;

    const result = actionFn(resolved.meeting, req.body || {});
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    broadcastMeeting(resolved.meeting.id, resolved.meeting);
    res.json(store.toPublicState(resolved.meeting, resolved.role));
  };
}

app.post('/api/meetings/:token/start', handleAction((meeting) => store.start(meeting)));
app.post('/api/meetings/:token/pause', handleAction((meeting) => store.pause(meeting)));
app.post('/api/meetings/:token/reset', handleAction((meeting) => store.reset(meeting)));
app.post('/api/meetings/:token/restart', handleAction((meeting) => store.restart(meeting)));
app.post('/api/meetings/:token/adjust', handleAction((meeting, body) => store.adjust(meeting, body.duration)));

// Deletes the meetings that have been idle for store.MEETING_TTL_MS. A meeting
// with an open SSE connection is in use, so there is never a stream to close.
function expireIdleMeetings(now) {
  return store.expireIdleMeetings(now, isInUse);
}

// unref(): the cleanup alone shouldn't keep the process (or the tests) running.
setInterval(() => expireIdleMeetings(), 60 * 60 * 1000).unref();

// GET /api/qr?text=<url> -> SVG QR code for arbitrary text (used to render the
// admin/viewer links as scannable codes without any client-side QR library).
app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (typeof text !== 'string' || text.length === 0) {
    return res.status(400).json({ error: 'missing-text' });
  }
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1 });
    res.set('Content-Type', 'image/svg+xml').send(svg);
  } catch (err) {
    res.status(500).json({ error: 'qr-generation-failed' });
  }
});

// Serve the static vanilla-JS client from ../client, so the whole app is one process/port.
app.use(express.static(path.join(__dirname, '..', 'client')));

const PORT = process.env.PORT || 3000;
// The version, set by release.sh through the docker image.
const VERSION = process.env.MEETING_TIMER_VERSION || 'dev';
if (require.main === module) {
  app.listen(PORT, () => console.log(`meeting-timer ${VERSION} listening on http://localhost:${PORT}`));
}

module.exports = app;
module.exports.expireIdleMeetings = expireIdleMeetings;
module.exports.MAX_VIEWS_PER_MEETING = MAX_VIEWS_PER_MEETING;
