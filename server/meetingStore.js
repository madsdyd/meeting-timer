// meetingStore.js
// In-memory store for meetings (speaking-time timers). No database, no persistence:
// restarting the server clears all meetings, which is an accepted trade-off for simplicity.

const crypto = require('crypto');

const meetings = new Map(); // id -> meeting
const tokenIndex = new Map(); // token -> { meetingId, role: 'admin' | 'viewer' }

function makeToken() {
  return crypto.randomBytes(9).toString('base64url'); // 12 url-safe chars
}

function createMeeting({ title, duration }) {
  const id = crypto.randomUUID();
  const adminToken = makeToken();
  const viewerToken = makeToken();

  const meeting = {
    id,
    title: title || 'Møde',
    duration, // configured length in seconds, used by reset/adjust
    remaining: duration, // seconds left while paused
    endsAt: null, // ISO timestamp the countdown reaches 0, set while running
    running: false,
    adminToken,
    viewerToken,
    createdAt: new Date().toISOString(),
  };

  meetings.set(id, meeting);
  tokenIndex.set(adminToken, { meetingId: id, role: 'admin' });
  tokenIndex.set(viewerToken, { meetingId: id, role: 'viewer' });

  return meeting;
}

// Resolves a token to { meeting, role }, or null if the token is unknown.
function resolveToken(token) {
  const entry = tokenIndex.get(token);
  if (!entry) return null;
  const meeting = meetings.get(entry.meetingId);
  if (!meeting) return null;
  return { meeting, role: entry.role };
}

// Seconds left, positive while there's time, negative once the speaker is in overtime.
// Unlike a plain countdown, this never clamps at 0 while running, so overtime is visible.
function computeRemaining(meeting) {
  if (!meeting.running || !meeting.endsAt) return meeting.remaining;
  const msLeft = new Date(meeting.endsAt).getTime() - Date.now();
  return Math.round(msLeft / 1000);
}

function start(meeting) {
  if (meeting.running) return { ok: false, error: 'already-running' };
  const remaining = computeRemaining(meeting);
  meeting.endsAt = new Date(Date.now() + remaining * 1000).toISOString();
  meeting.running = true;
  return { ok: true };
}

function pause(meeting) {
  if (!meeting.running) return { ok: false, error: 'not-running' };
  meeting.remaining = computeRemaining(meeting);
  meeting.running = false;
  meeting.endsAt = null;
  return { ok: true };
}

function reset(meeting) {
  meeting.remaining = meeting.duration;
  meeting.running = false;
  meeting.endsAt = null;
  return { ok: true };
}

// Reset back to the full duration and start it in the same step, so a
// moderator can hand off to the next speaker with one click and clients
// only see the final "running at full duration" state, not a flash of paused.
function restart(meeting) {
  meeting.remaining = meeting.duration;
  meeting.endsAt = new Date(Date.now() + meeting.duration * 1000).toISOString();
  meeting.running = true;
  return { ok: true };
}

function adjust(meeting, duration) {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, error: 'invalid-duration' };
  }
  meeting.duration = duration;
  // Adjusting always lands the speaker back at the fresh, paused duration -
  // there's no sane meaning for "add 30s" while mid-countdown here.
  meeting.remaining = duration;
  meeting.running = false;
  meeting.endsAt = null;
  return { ok: true };
}

// Shape sent to clients over the REST/SSE APIs. `role` tells the client whether
// it is looking at this meeting through the admin or the viewer token.
function toPublicState(meeting, role) {
  const state = {
    id: meeting.id,
    title: meeting.title,
    role,
    duration: meeting.duration,
    remaining: computeRemaining(meeting),
    running: meeting.running,
    endsAt: meeting.endsAt,
    now: Date.now(), // lets the client measure its own clock offset from the server's
  };
  // Only the admin holder gets to see the viewer token, so the admin page can
  // always re-derive and display the "share this" link/QR, even after a reload.
  if (role === 'admin') state.viewerToken = meeting.viewerToken;
  return state;
}

module.exports = {
  createMeeting,
  resolveToken,
  computeRemaining,
  start,
  pause,
  reset,
  restart,
  adjust,
  toPublicState,
};
