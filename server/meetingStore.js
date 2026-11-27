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

// The longest speaking time that can be set. It also keeps every derived
// timestamp (`endsAt`) a valid Date, which an unbounded duration would not.
const MAX_DURATION_SECONDS = 24 * 60 * 60;

function isValidDuration(duration) {
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 && duration <= MAX_DURATION_SECONDS;
}

const MAX_TITLE_LENGTH = 200;
const DEFAULT_TITLE = 'Møde';

// Returns the title to store, trimmed and with the default for a missing or
// empty one, or null if the title isn't a string or is too long.
function normalizeTitle(title) {
  if (title === undefined || title === null) return DEFAULT_TITLE;
  if (typeof title !== 'string') return null;
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) return null;
  return trimmed || DEFAULT_TITLE;
}

// A meeting nobody has used or watched for this long is deleted, so meetings
// don't pile up in memory until the next restart.
const MEETING_TTL_MS = 24 * 60 * 60 * 1000;

// At most this many meetings exist at once; a new one replaces the longest
// idle meeting that isn't in use (see createMeeting()).
const MAX_MEETINGS = 100;

function makeToken() {
  return crypto.randomBytes(9).toString('base64url'); // 12 url-safe chars
}

function deleteMeeting(meeting) {
  meetings.delete(meeting.id);
  tokenIndex.delete(meeting.adminToken);
  tokenIndex.delete(meeting.viewerToken);
}

// Creates a meeting. When there are MAX_MEETINGS already, the longest idle one
// for which `isInUse(meetingId)` is false is deleted first; if every meeting
// is in use, nothing is created and null is returned.
function createMeeting({ title, duration }, isInUse = () => false) {
  if (meetings.size >= MAX_MEETINGS) {
    let idlest = null;
    for (const meeting of meetings.values()) {
      if (isInUse(meeting.id)) continue;
      if (!idlest || meeting.lastActivityMono < idlest.lastActivityMono) idlest = meeting;
    }
    if (!idlest) return null;
    deleteMeeting(idlest);
  }

  const id = crypto.randomUUID();
  const adminToken = makeToken();
  const viewerToken = makeToken();

  const meeting = {
    id,
    title: normalizeTitle(title) ?? DEFAULT_TITLE,
    duration, // configured length in seconds, used by reset/adjust
    remainingMs: duration * 1000, // milliseconds left while paused
    endsAtMono: null, // performance.now() value at which the countdown reaches 0, set while running
    running: false,
    adminToken,
    viewerToken,
    createdAt: new Date().toISOString(),
    lastActivityMono: performance.now(), // see touch() and expireIdleMeetings()
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

// Marks the meeting as in use, which postpones its expiry.
function touch(meeting) {
  meeting.lastActivityMono = performance.now();
}

// Deletes the meetings that haven't been touched for MEETING_TTL_MS at `now`
// (a performance.now() value), except those `isInUse(meetingId)` keeps.
// Returns the ids of the deleted meetings.
function expireIdleMeetings(now = performance.now(), isInUse = () => false) {
  const expired = [];
  for (const meeting of meetings.values()) {
    if (now - meeting.lastActivityMono <= MEETING_TTL_MS || isInUse(meeting.id)) continue;
    deleteMeeting(meeting);
    expired.push(meeting.id);
  }
  return expired;
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
  if (!isValidDuration(duration)) {
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
  MAX_DURATION_SECONDS,
  isValidDuration,
  MAX_TITLE_LENGTH,
  normalizeTitle,
  MEETING_TTL_MS,
  MAX_MEETINGS,
  touch,
  expireIdleMeetings,
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
