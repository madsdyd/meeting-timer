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

// Stamps a state with the local monotonic time it arrived. The countdown is
// `remainingMs` minus the time elapsed since then, measured with
// performance.now(), so it never depends on the device's wall clock, which may
// be wrong or get adjusted while the page is open.
function stampReceived(state) {
  state.receivedAt = performance.now();
  return state;
}

async function getMeetingState(token) {
  const res = await fetch(`/api/meetings/${token}`);
  if (!res.ok) throw new Error(`request-failed-${res.status}`);
  return stampReceived(await res.json());
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
// change (including an initial snapshot right after connecting) and on the
// server's periodic heartbeat while the timer runs. EventSource reconnects
// natively on a drop; when the page becomes visible again (e.g. after the
// device slept, which may also pause performance.now()) the connection is
// reopened at once, so the countdown is re-anchored without waiting.
function subscribeToMeeting(token, onState) {
  let source = null;

  function connect() {
    if (source) source.close();
    source = new EventSource(`/api/meetings/${token}/events`);
    source.addEventListener('state', (event) => {
      onState(stampReceived(JSON.parse(event.data)));
    });
  }

  connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') connect();
  });
}
