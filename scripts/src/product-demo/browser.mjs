import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function launchBrowser() {
  const profile = `/tmp/educore-demo-browser-${Date.now()}`;
  const process = spawn('chromium', ['--headless=new', '--no-sandbox',
    '--disable-dev-shm-usage', '--remote-debugging-port=9333',
    `--user-data-dir=${profile}`, '--window-size=1600,1000', 'about:blank'],
  { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch('http://127.0.0.1:9333/json/version')).json(); break; }
    catch { await sleep(250); }
  }
  if (!version) throw Error('Recording browser failed to start');
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map(), listeners = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p?.reject(Error(m.error.message)); else p?.resolve(m.result);
    } else for (const fn of listeners.get(m.method) ?? []) fn(m.params);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error('Browser operation failed (details withheld for privacy)');
    return r.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  return {
    send, evaluate, process,
    on(method, fn) { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); },
    async goto(url) { await send('Page.navigate', { url }); await sleep(3000); },
    async text() { return evaluate('document.body.innerText'); },
    async screenshot(path) {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
      await writeFile(path, Buffer.from(r.data, 'base64'));
    },
    async close() { ws.close(); process.kill(); },
  };
}

export async function makeRecorder(browser, directory) {
  await mkdir(directory, { recursive: true });
  let recording = false, frames = 0, started = 0;
  const times = [];
  const writes = [];
  browser.on('Page.screencastFrame', p => {
    void browser.send('Page.screencastFrameAck', { sessionId: p.sessionId });
    if (!recording) return;
    const name = `frame-${String(frames++).padStart(6, '0')}.jpg`;
    times.push({ name, time: p.metadata.timestamp });
    writes.push(writeFile(`${directory}/${name}`, Buffer.from(p.data, 'base64')));
  });
  return {
    async start() {
      started = Date.now();
      recording = true;
      await browser.send('Page.startScreencast', {
        format: 'jpeg', quality: 85, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1,
      });
    },
    async stop() {
      await browser.send('Page.stopScreencast'); recording = false;
      const duration = (Date.now() - started) / 1000;
      await Promise.all(writes);
      if (!times.length) throw Error('No actual browser frames captured');
      let text = '';
      for (let i = 0; i < times.length; i++) {
        text += `file '${times[i].name}'\nduration ${i + 1 < times.length
          ? Math.max(.025, times[i + 1].time - times[i].time).toFixed(4)
          : Math.max(.1, duration - (times[i].time - times[0].time)).toFixed(4)}\n`;
      }
      text += `file '${times.at(-1).name}'\n`;
      await writeFile(`${directory}/frames.ffconcat`, text);
      return { frames: times.length, duration };
    },
  };
}
