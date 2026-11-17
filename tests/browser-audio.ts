// Production-artifact smoke test. Only localhost fixtures are opened; YouTube
// itself is never inspected. No test permissions are added to the shipped build.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const binary = process.env.CHROMIUM_BINARY;
if (!binary) throw new Error("Set CHROMIUM_BINARY to a Chromium executable, then run bun run test:browser.");
const tempRoot = join(process.env.LOCALAPPDATA!, "Temp", "opencode");
await mkdir(tempRoot, { recursive: true });
const temp = await mkdtemp(join(tempRoot, "no-normalize-audio-"));
const artifact = join(temp, "extension");
await cp(resolve("dist/chromium"), artifact, { recursive: true });
const manifest = JSON.parse(await readFile(join(artifact, "manifest.json"), "utf8"));
manifest.host_permissions = ["http://127.0.0.1/*"];
for (const entry of manifest.content_scripts) entry.matches = ["http://127.0.0.1/*"];
for (const entry of manifest.web_accessible_resources) entry.matches = ["http://127.0.0.1/*"];
await writeFile(join(artifact, "manifest.json"), JSON.stringify(manifest));

function wav(amplitude: number) {
  const rate = 48000;
  const frames = rate;
  const data = new Uint8Array(44 + frames * 2);
  const view = new DataView(data.buffer);
  const text = (at: number, value: string) => [...value].forEach((char, i) => data[at + i] = char.charCodeAt(0));
  text(0, "RIFF"); view.setUint32(4, data.length - 8, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 1000 * i / rate) * amplitude * 32767), true);
  return data;
}

const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/tone.wav") return new Response(wav(url.searchParams.has("loud") ? 0.9 : 0.5), { headers: { "Content-Type": "audio/wav" } });
    if (url.pathname === "/player.js") return new Response(`
      const player = document.querySelector('#movie_player');
      player.getStatsForNerds = () => ({ volume: '100%/60% (cont.-9.6dB tgt.-14.0dB)' });
      const video = document.querySelector('video');
      video.volume = 0.6;
      video.play();
      window.__nnStatTicks = 0;
      window.addEventListener('message', event => {
        if (event.source === window && event.data?.type === 'NN_PLAYER_STATS') window.__nnStatTicks++;
      });
    `, { headers: { "Content-Type": "application/javascript" } });
    return new Response(`<!doctype html><div id="movie_player"><video class="html5-main-video" autoplay loop src="/tone.wav"></video></div><script src="/player.js"></script>`, {
      headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'; script-src 'self'; media-src 'self'" },
    });
  },
});

async function until<T>(get: () => Promise<T | null | false>, label: string, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await get();
    if (value) return value;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

const browser = Bun.spawn([
  binary, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(temp, "profile")}`,
  `--load-extension=${artifact}`, `--disable-extensions-except=${artifact}`,
  "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--disable-background-networking",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdout: "ignore", stderr: "pipe" });
let socket: WebSocket | undefined;
let passed = false;
let command: (method: string, params?: object, sessionId?: string) => Promise<any>;
try {
  const [port, endpoint] = (await until(async () => {
    try { return await readFile(join(temp, "profile", "DevToolsActivePort"), "utf8"); } catch { return null; }
  }, "Chromium debug endpoint")).trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const uncaught: string[] = [];
  let nextId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      uncaught.push(detail.exception?.description ?? detail.text);
    }
    const request = waiting.get(message.id);
    if (!request) return;
    waiting.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener("open", () => resolve(), { once: true });
    socket!.addEventListener("error", () => reject(new Error("Chromium debug socket failed")), { once: true });
  });
  command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`Chromium command timed out: ${method}`));
    }, 5000);
    waiting.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    socket!.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const { targetId } = await command("Target.createTarget", { url: `${origin}/` });
  const { sessionId: page } = await command("Target.attachToTarget", { targetId, flatten: true });
  const worker = await until(async () => {
    const { targetInfos } = await command("Target.getTargets");
    return targetInfos.find((target: any) => target.type === "service_worker" && target.url.endsWith("/background/service_worker.js"));
  }, "extension service worker");
  const { sessionId } = await command("Target.attachToTarget", { targetId: worker.targetId, flatten: true });
  await command("Runtime.enable", {}, sessionId);
  await command("Runtime.enable", {}, page);
  async function evaluate(expression: string, target = sessionId) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, target);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  console.log("Browser fixture:", await evaluate("document.readyState", page));
  const extensionId = await until(async () => evaluate("typeof chrome !== 'undefined' && chrome.runtime?.id"), "worker extension APIs initialized");
  console.log("Extension worker:", extensionId);
  const send = (message: object) => evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({url: ${JSON.stringify(`${origin}/*`)}});
    if (!tab) return null;
    try { return await chrome.tabs.sendMessage(tab.id, ${JSON.stringify(message)}); } catch { return null; }
  })()`);
  const stats = async () => (await send({ type: "NN_GET_STATS" }))?.stats;
  const safe = await until(async () => {
    const value = await stats();
    if (value?.audioError) throw new Error(value.audioError);
    return value?.limiterActive && value.outputPeakDb != null ? value : null;
  }, "protected correction under strict page CSP");
  assert(Math.abs(safe.appliedGain - 100 / 60) < 0.001, "Anti-clip must not cancel normalization correction");
  assert(safe.limiterReductionDb < 0.01, "Safe peaks should not be attenuated");
  assert(Math.abs(safe.outputPeakDb - 20 * Math.log10(0.5)) < 0.3, `Expected corrected peak ≈ -6.02 dBFS, got ${safe.outputPeakDb}`);

  await send({ type: "NN_SET_STATE", state: { enabled: true, antiClipping: false } });
  const off = await stats();
  assert.equal(off.limiterActive, false);
  assert(Math.abs(off.appliedGain - safe.appliedGain) < 0.001);
  await send({ type: "NN_SET_STATE", state: { enabled: true, antiClipping: true } });
  assert(Math.abs((await stats()).appliedGain - safe.appliedGain) < 0.001);

  await evaluate(`(() => { const v = document.querySelector('video'); v.volume = 1; v.src = '/tone.wav?loud'; return v.play(); })()`, page);
  const limited = await until(async () => {
    const value = await stats();
    return value?.limiterReductionDb > 1 ? value : null;
  }, "peak reduction after correction");
  assert(limited.outputPeakDb <= 0);
  assert(Math.abs(limited.appliedGain - 100 / 60) < 0.001);
  await send({ type: "NN_SET_STATE", state: { enabled: false, antiClipping: true } });
  // AudioParam.value reflects the audio rendering thread, not an immediate JS
  // assignment; wait for the scheduled unity gain to reach the next quantum.
  const disabled = await until(async () => {
    const value = await stats();
    return value?.appliedGain === 1 ? value : null;
  }, "extension OFF reaches the audio render thread");
  assert.equal(disabled.limiterActive, false);

  // Reproduce the user's workflow: reload the extension while its content
  // scripts and media element remain alive in the existing tab.
  await evaluate("setTimeout(() => chrome.runtime.reload(), 0); true");
  await until(async () => {
    const { targetInfos } = await command("Target.getTargets");
    return !targetInfos.some((target: any) => target.targetId === worker.targetId);
  }, "old extension worker stops after reload");
  const ticks = await evaluate("window.__nnStatTicks", page);
  await until(async () => (await evaluate("window.__nnStatTicks", page)) >= ticks + 3, "old page continues sending stats after extension reload");
  assert.deepEqual(uncaught.filter((message) => message.includes("Extension context invalidated")), [], "Old content scripts must not throw after reload");

  // The scope here is stale-context cleanup. Whether Chrome re-enables an
  // unpacked extension afterwards depends on the profile's developer-mode
  // policy, so don't confuse that browser policy with a content-script failure.
  assert.deepEqual(uncaught, [], "No uncaught page/content-script errors during the fixture run");
  console.log(JSON.stringify({ passed: true, strictPageCsp: true, reloadWithoutContextErrors: true, safe, limited, disabled }, null, 2));
  passed = true;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command!("Browser.close"); } catch { /* Browser may have exited. */ }
    socket.close();
  }
  browser.kill();
  await browser.exited;
  server.stop(true);
  if (passed) {
    // Only remove the unique directory this test created, never a shared profile.
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  } else {
    console.error("Browser test artifacts retained at:", temp);
  }
}
