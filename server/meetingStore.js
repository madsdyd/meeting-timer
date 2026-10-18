// meetingStore.js
// In-memory store for meetings (speaking-time timers). No database, no persistence:
// restarting the server clears all meetings, which is an accepted trade-off for simplicity.

const crypto = require('crypto');
const { performance } = require('perf_hooks');

// The countdown is kept on the monotonic clock (performance.now()), so a jump
// in the server's wall clock (NTP, suspend, a manual change) can't move it.
// `endsAt` is still sent as a wall clock timestamp, for information only.

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
    remainingMs: duration * 1000, // milliseconds left while paused
    endsAtMono: null, // performance.now() value at which the countdown reaches 0, set while running
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

// Milliseconds left, positive while there's time, negative once the speaker is in overtime.
// Unlike a plain countdown, this never clamps at 0 while running, so overtime is visible.
function computeRemainingMs(meeting) {
  if (!meeting.running) return meeting.remainingMs;
  return meeting.endsAtMono - performance.now();
}

// Seconds left, rounded, for display and the `remaining` field of the API.
function computeRemaining(meeting) {
  return Math.round(computeRemainingMs(meeting) / 1000);
}

function start(meeting) {
  if (meeting.running) return { ok: false, error: 'already-running' };
  meeting.endsAtMono = performance.now() + meeting.remainingMs;
  meeting.running = true;
  return { ok: true };
}

function pause(meeting) {
  if (!meeting.running) return { ok: false, error: 'not-running' };
  meeting.remainingMs = computeRemainingMs(meeting);
  meeting.running = false;
  meeting.endsAtMono = null;
  return { ok: true };
}

function reset(meeting) {
  meeting.remainingMs = meeting.duration * 1000;
  meeting.running = false;
  meeting.endsAtMono = null;
  return { ok: true };
}

// Reset back to the full duration and start it in the same step, so a
// moderator can hand off to the next speaker with one click and clients
// only see the final "running at full duration" state, not a flash of paused.
function restart(meeting) {
  meeting.remainingMs = meeting.duration * 1000;
  meeting.endsAtMono = performance.now() + meeting.remainingMs;
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
  meeting.remainingMs = duration * 1000;
  meeting.running = false;
  meeting.endsAtMono = null;
  return { ok: true };
}

// Shape sent to clients over the REST/SSE APIs. `role` tells the client whether
// it is looking at this meeting through the admin or the viewer token.
// Clients count down from `remainingMs`, measured from when they receive it,
// so neither the client's nor the server's wall clock is involved.
function toPublicState(meeting, role) {
  const remainingMs = Math.round(computeRemainingMs(meeting));
  const state = {
    id: meeting.id,
    title: meeting.title,
    role,
    duration: meeting.duration,
    remaining: Math.round(remainingMs / 1000),
    remainingMs,
    running: meeting.running,
    endsAt: meeting.running ? new Date(Date.now() + remainingMs).toISOString() : null,
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
  computeRemainingMs,
  start,
  pause,
  reset,
  restart,
  adjust,
  toPublicState,
};
