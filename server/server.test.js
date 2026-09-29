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
