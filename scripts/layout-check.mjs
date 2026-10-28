import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const URL = process.argv[2] || 'http://127.0.0.1:3000';
const WIDTH = Number(process.argv[3] || 390);
const HEIGHT = Number(process.argv[4] || 844);

const profile = mkdtempSync(path.join(tmpdir(), 'chrome-layout-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForVersion() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not expose a DevTools endpoint');
}

try {
  await waitForVersion();
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, {
    method: 'PUT',
  }).then((r) => r.json());

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const callId = ++id;
      pending.set(callId, { resolve, reject });
      ws.send(JSON.stringify({ id: callId, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  // Optional sixth/seventh arguments: force the saved provider and/or stop,
  // then reload. This exercises cache-only TAPI and non-default stops.
  const provider = process.argv[6];
  const stop = process.argv[7];
  if (provider || stop) {
    const writes = [];
    if (provider) {
      writes.push(`localStorage.setItem('hsb.provider', ${JSON.stringify(provider)})`);
    }
    if (stop) {
      writes.push(`localStorage.setItem('hsb.stop', ${JSON.stringify(stop)})`);
    }
    await send('Runtime.evaluate', {
      expression: `${writes.join('; ')}; location.reload();`,
    });
    await sleep(3500);
  }

  const expression = `(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      return {
        x: +b.x.toFixed(1), y: +b.y.toFixed(1),
        w: +b.width.toFixed(1), h: +b.height.toFixed(1),
        display: c.display, grid: c.gridTemplateColumns,
        overflow: c.overflow, fontSize: c.fontSize, position: c.position
      };
    };
    return {
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      rows: document.querySelectorAll('.row').length,
      shell: r('.shell'), top: r('.top'), stop: r('.stop'), clock: r('.clock'),
      switcher: r('.switcher'), board: r('.board'), head: r('.board__head'),
      row: r('.row'), route: r('.route'), dest: r('.dest'), destName: r('.dest__name'),
      due: r('.due'), sched: r('.sched'),
      dueText: document.querySelector('.due')?.textContent,
      rowGrid: getComputedStyle(document.querySelector('.row')).gridTemplateColumns
    };
  })()`;

  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  console.log(JSON.stringify(result.result.value, null, 2));

  const shotPath = process.argv[5];
  if (shotPath) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log(`screenshot: ${shotPath}`);
  }

  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
