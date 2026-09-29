// api.js
// Thin wrapper around the meeting-timer REST + SSE API. Same origin as the
// client (the Express server serves both), so no base URL configuration needed.

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `request-failed-${res.status}`);
  }
  return data;
}

async function createMeeting({ title, duration }) {
  return apiPost('/api/meetings', { title, duration });
}

// How far the client's own clock is from the server's (server minus client,
// in ms). The live countdown adds this to Date.now() instead of trusting the
// device's clock outright, since a client running a couple of seconds fast
// or slow would otherwise show the countdown jumping at start.
let clockOffsetMs = 0;

function correctedNow() {
  return Date.now() + clockOffsetMs;
}

async function getMeetingState(token) {
  const requestSentAt = Date.now();
  const res = await fetch(`/api/meetings/${token}`);
  if (!res.ok) throw new Error(`request-failed-${res.status}`);
  const state = await res.json();

  const receivedAt = Date.now();
  if (typeof state.now === 'number') {
    // Classic NTP-style estimate: assume the request/response latency was
    // roughly symmetric, so the server's clock reading landed around the
    // midpoint of the round trip.
    const roundTrip = receivedAt - requestSentAt;
    const estimatedServerNow = state.now + roundTrip / 2;
    clockOffsetMs = estimatedServerNow - receivedAt;
  }

  return state;
}

const startMeeting = (token) => apiPost(`/api/meetings/${token}/start`);
const pauseMeeting = (token) => apiPost(`/api/meetings/${token}/pause`);
const resetMeeting = (token) => apiPost(`/api/meetings/${token}/reset`);
const restartMeeting = (token) => apiPost(`/api/meetings/${token}/restart`);
const adjustMeeting = (token, duration) => apiPost(`/api/meetings/${token}/adjust`, { duration });

function qrCodeUrl(targetUrl) {
  return `/api/qr?text=${encodeURIComponent(targetUrl)}`;
}

// Subscribes to live state updates for a token. Calls onState(state) on every
// change (including an initial snapshot right after connecting), and
// automatically reconnects (EventSource does this natively on drop).
function subscribeToMeeting(token, onState) {
  const source = new EventSource(`/api/meetings/${token}/events`);
  source.addEventListener('state', (event) => {
    onState(JSON.parse(event.data));
  });
  return source;
}
