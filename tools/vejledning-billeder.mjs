// Drives headless Chrome over the DevTools protocol to take the guide's
// screenshots: the front page, "Forbind din telefon" and the control page on a
// phone. Run through tools/vejledning-billeder, which starts the server and
// Chrome.
//
//   node vejledning-billeder.mjs <app url> <chrome devtools url> <output dir>

import fs from 'node:fs';
import path from 'node:path';

const [appUrl, chromeUrl, outDir] = process.argv.slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TITLE = 'Hovedbestyrelsesmøde';
const DURATION = 120;

const tab = await (await fetch(`${chromeUrl}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve) => { ws.onopen = resolve; });

let nextId = 0;
const pending = new Map();
ws.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true });
  return res.result.result.value;
}
async function open(url, width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await send('Page.navigate', { url });
  await sleep(1500);
}
// Screenshots the area covered by the elements matching `selector`, plus a
// margin.
async function shoot(name, selector, margin = 16) {
  const clip = await evaluate(`(() => {
    const rects = [...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => el.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
    const x = Math.max(0, left - ${margin}), y = Math.max(0, top - ${margin});
    return { x, y, width: Math.min(innerWidth, right + ${margin}) - x, height: bottom + ${margin} - y, scale: 1 };
  })()`);
  const res = await send('Page.captureScreenshot', { clip, captureBeyondViewport: true });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log(file);
}

fs.mkdirSync(outDir, { recursive: true });

// 1. The front page, filled in.
await open(`${appUrl}/`, 800, 600);
await evaluate(`document.getElementById('title').value = ${JSON.stringify(TITLE)}`);
await evaluate(`document.querySelector('.duration-field').value = '2:00'`);
await shoot('vejledning-1-opret', 'main > div, #create-form');

// 2. "Forbind din telefon" for a new meeting.
const meeting = await (await fetch(`${appUrl}/api/meetings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: TITLE, duration: DURATION }),
})).json();
await open(`${appUrl}/admin.html?token=${meeting.adminToken}&setup=visning`, 800, 800);
await shoot('vejledning-2-forbind', '#setup .panel');

// 3. The control page on a phone, a few seconds into a speech, paused.
await open(`${appUrl}/admin.html?token=${meeting.adminToken}`, 390, 800, true);
await fetch(`${appUrl}/api/meetings/${meeting.adminToken}/start`, { method: 'POST' });
await sleep(4000);
await fetch(`${appUrl}/api/meetings/${meeting.adminToken}/pause`, { method: 'POST' });
await sleep(800);
await shoot('vejledning-3-styr', '#app > div, #app > section:nth-of-type(-n+2)');

ws.close();
