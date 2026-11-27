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
        server.closeAllConnections(); // also idle keep-alive ones, which would delay the exit
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

test('a duration over the maximum is rejected on create and adjust', async () => {
  const store = require('./meetingStore');
  await withServer(async (base) => {
    const tooLong = store.MAX_DURATION_SECONDS + 1;
    const created = await postJson(`${base}/api/meetings`, { duration: 10000000000000 });
    assert.equal(created.status, 400);
    assert.equal(created.body.error, 'invalid-duration');
    assert.equal((await postJson(`${base}/api/meetings`, { duration: tooLong })).status, 400);

    const atMax = await postJson(`${base}/api/meetings`, { duration: store.MAX_DURATION_SECONDS });
    assert.equal(atMax.status, 201);
    const { adminToken } = atMax.body;
    const adjusted = await postJson(`${base}/api/meetings/${adminToken}/adjust`, { duration: tooLong });
    assert.equal(adjusted.status, 400);
    assert.equal(adjusted.body.error, 'invalid-duration');

    const started = await postJson(`${base}/api/meetings/${adminToken}/start`);
    assert.equal(started.status, 200);
  });
});

test('title must be a string of at most MAX_TITLE_LENGTH characters', async () => {
  const store = require('./meetingStore');
  await withServer(async (base) => {
    const titleOf = async (body) => {
      const created = await postJson(`${base}/api/meetings`, body);
      assert.equal(created.status, 201);
      return (await fetch(`${base}/api/meetings/${created.body.viewerToken}`).then((r) => r.json())).title;
    };
    assert.equal(await titleOf({ title: '  Punkt 2  ', duration: 60 }), 'Punkt 2');
    assert.equal(await titleOf({ title: '', duration: 60 }), 'Møde');
    assert.equal(await titleOf({ duration: 60 }), 'Møde');
    const longest = 'x'.repeat(store.MAX_TITLE_LENGTH);
    assert.equal(await titleOf({ title: longest, duration: 60 }), longest);

    for (const title of [longest + 'x', { a: 1 }, ['a'], 42]) {
      const res = await postJson(`${base}/api/meetings`, { title, duration: 60 });
      assert.equal(res.status, 400, JSON.stringify(title));
      assert.equal(res.body.error, 'invalid-title');
    }
  });
});

test('request bodies over 1 kB are rejected', async () => {
  await withServer(async (base) => {
    const res = await postJson(`${base}/api/meetings`, { title: 'x'.repeat(2000), duration: 60 });
    assert.equal(res.status, 413);
  });
});

test('idle meetings expire, but not while a client is connected', async () => {
  const store = require('./meetingStore');
  const later = () => require('node:perf_hooks').performance.now() + store.MEETING_TTL_MS + 1000;
  await withServer(async (base) => {
    const idle = (await postJson(`${base}/api/meetings`, { duration: 60 })).body;
    const watched = (await postJson(`${base}/api/meetings`, { duration: 60 })).body;

    // Nothing expires within the TTL.
    app.expireIdleMeetings(later() - 2 * 1000);
    assert.equal((await fetch(`${base}/api/meetings/${idle.viewerToken}`)).status, 200);

    const controller = new AbortController();
    const res = await fetch(`${base}/api/meetings/${watched.viewerToken}/events`, { signal: controller.signal });
    await res.body.getReader().read(); // the initial snapshot: the connection is registered

    app.expireIdleMeetings(later());
    assert.equal((await fetch(`${base}/api/meetings/${idle.adminToken}`)).status, 404);
    assert.equal((await fetch(`${base}/api/meetings/${idle.viewerToken}`)).status, 404);
    assert.equal((await fetch(`${base}/api/meetings/${watched.viewerToken}`)).status, 200);

    // Once the last connection closes, the meeting expires like any other.
    controller.abort();
    for (let i = 0; i < 100 && store.resolveToken(watched.viewerToken); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      app.expireIdleMeetings(later());
    }
    assert.equal(store.resolveToken(watched.viewerToken), null);
  });
});

test('when the store is full, a new meeting replaces the longest idle one without views', async () => {
  const store = require('./meetingStore');
  store.expireIdleMeetings(Infinity); // start from an empty store
  const created = [];
  for (let i = 0; i < store.MAX_MEETINGS; i++) created.push(store.createMeeting({ duration: 60 }));
  const [oldest, inUse] = created;
  inUse.lastActivityMono = oldest.lastActivityMono - 1; // idle the longest, but has a view open
  for (const meeting of created.slice(2)) store.touch(meeting);

  const isInUse = (meetingId) => meetingId === inUse.id;
  const newest = store.createMeeting({ duration: 60 }, isInUse);
  assert.ok(newest);
  assert.equal(store.resolveToken(oldest.adminToken), null, 'the longest idle meeting without views is replaced');
  assert.ok(store.resolveToken(inUse.adminToken), 'a meeting with a view open is kept');
  assert.ok(store.resolveToken(newest.adminToken));

  assert.equal(store.createMeeting({ duration: 60 }, () => true), null, 'all meetings in use: nothing is created');
  store.expireIdleMeetings(Infinity);
});

test('a meeting has at most MAX_VIEWS_PER_MEETING streams; a new one closes the oldest', async () => {
  await withServer(async (base) => {
    const { viewerToken } = (await postJson(`${base}/api/meetings`, { duration: 60 })).body;
    const controller = new AbortController();
    const open = async () => {
      const res = await fetch(`${base}/api/meetings/${viewerToken}/events`, { signal: controller.signal });
      const reader = res.body.getReader();
      await reader.read(); // the initial snapshot
      return reader;
    };
    const readers = [];
    for (let i = 0; i < app.MAX_VIEWS_PER_MEETING; i++) readers.push(await open());
    readers.push(await open());

    assert.equal((await readers[0].read()).done, true, 'the oldest stream is closed');
    const stillOpen = await Promise.race([
      readers[1].read().then(() => false),
      new Promise((resolve) => setTimeout(() => resolve(true), 100)),
    ]);
    assert.ok(stillOpen, 'the other streams stay open');
    controller.abort();
  });
});

test('creating a meeting fails with 503 when every meeting is in use', async () => {
  const store = require('./meetingStore');
  store.expireIdleMeetings(Infinity);
  await withServer(async (base) => {
    const controller = new AbortController();
    for (let i = 0; i < store.MAX_MEETINGS; i++) {
      const { viewerToken } = (await postJson(`${base}/api/meetings`, { duration: 60 })).body;
      const res = await fetch(`${base}/api/meetings/${viewerToken}/events`, { signal: controller.signal });
      await res.body.getReader().read();
    }
    const refused = await postJson(`${base}/api/meetings`, { duration: 60 });
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error, 'too-many-meetings');
    controller.abort();
  });
  // The streams close asynchronously; once they have, the meetings can go.
  for (let i = 0; i < 100 && store.expireIdleMeetings(Infinity).length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});
