const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('./server');

function withServer(fn) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const { port } = server.address();
      try {
        await fn(`http://127.0.0.1:${port}`);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('create meeting, control via admin token, read via viewer token', async () => {
  await withServer(async (base) => {
    const created = await postJson(`${base}/api/meetings`, { title: 'Punkt 1', duration: 90 });
    assert.equal(created.status, 201);
    const { adminToken, viewerToken } = created.body;
    assert.ok(adminToken && viewerToken && adminToken !== viewerToken);

    const initial = await fetch(`${base}/api/meetings/${viewerToken}`).then((r) => r.json());
    assert.equal(initial.running, false);
    assert.equal(initial.remaining, 90);
    assert.equal(initial.role, 'viewer');
    assert.equal(initial.viewerToken, undefined, 'viewer token holder should not see itself echoed back');

    const adminView = await fetch(`${base}/api/meetings/${adminToken}`).then((r) => r.json());
    assert.equal(adminView.viewerToken, viewerToken, 'admin token holder can re-derive the viewer link');

    const startedByViewer = await postJson(`${base}/api/meetings/${viewerToken}/start`);
    assert.equal(startedByViewer.status, 403);

    const started = await postJson(`${base}/api/meetings/${adminToken}/start`);
    assert.equal(started.status, 200);
    assert.equal(started.body.running, true);

    const paused = await postJson(`${base}/api/meetings/${adminToken}/pause`);
    assert.equal(paused.status, 200);
    assert.equal(paused.body.running, false);
    assert.ok(paused.body.remaining <= 90);

    const adjusted = await postJson(`${base}/api/meetings/${adminToken}/adjust`, { duration: 120 });
    assert.equal(adjusted.status, 200);
    assert.equal(adjusted.body.duration, 120);
    assert.equal(adjusted.body.remaining, 120);

    const restarted = await postJson(`${base}/api/meetings/${adminToken}/restart`);
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.running, true);
    assert.equal(restarted.body.remaining, 120, 'restart resets to the full (adjusted) duration, then starts it');
  });
});

test('unknown token is rejected', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/meetings/does-not-exist`);
    assert.equal(res.status, 404);
  });
});

test('invalid duration is rejected on create', async () => {
  await withServer(async (base) => {
    const res = await postJson(`${base}/api/meetings`, { duration: -5 });
    assert.equal(res.status, 400);
  });
});

test('countdown ignores jumps in the server wall clock', async () => {
  const store = require('./meetingStore');
  const meeting = store.createMeeting({ duration: 120 });
  store.start(meeting);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 60 * 60 * 1000; // wall clock jumps an hour ahead
    assert.ok(store.computeRemaining(meeting) >= 119);
  } finally {
    Date.now = realNow;
  }
});

test('pause and start keep millisecond precision', async () => {
  const store = require('./meetingStore');
  const meeting = store.createMeeting({ duration: 120 });
  for (let i = 0; i < 20; i++) {
    store.start(meeting);
    store.pause(meeting);
  }
  // Rounding to whole seconds at each pause could have drifted up to 10s here.
  assert.ok(meeting.remainingMs > 119000 && meeting.remainingMs <= 120000);
  assert.equal(store.toPublicState(meeting, 'viewer').remainingMs, Math.round(meeting.remainingMs));
});

test('SSE stream sends the state as a heartbeat while running', async () => {
  app.set('heartbeatMs', 50);
  try {
    await withServer(async (base) => {
      const created = await postJson(`${base}/api/meetings`, { duration: 60 });
      const { adminToken, viewerToken } = created.body;
      await postJson(`${base}/api/meetings/${adminToken}/start`);

      const controller = new AbortController();
      const res = await fetch(`${base}/api/meetings/${viewerToken}/events`, { signal: controller.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while ((text.match(/event: state/g) || []).length < 3) {
        const { value } = await reader.read();
        text += decoder.decode(value, { stream: true });
      }
      controller.abort();

      const states = text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)));
      assert.ok(states.every((s) => s.running && s.remainingMs > 0 && s.remainingMs <= 60000));
    });
  } finally {
    app.set('heartbeatMs', 10000);
  }
});
