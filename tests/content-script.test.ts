import { beforeAll, expect, test } from "bun:test";
import { build } from "bun";
import { runInNewContext } from "node:vm";

let script: string;
let bridge: string;
beforeAll(async () => {
  for (const entry of ["scripts", "bridge"]) {
    const result = await build({ entrypoints: [`src/content/${entry}.ts`], target: "browser", format: "iife" });
    if (!result.success) throw new Error(String(result.logs));
    const text = await result.outputs[0].text();
    if (entry === "scripts") script = text;
    else bridge = text;
  }
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(storedState = { enabled: true, antiClipping: true }, bridgeFirst = false, deferStorage = false) {
  const listeners = new Set<(event: any) => void>();
  const documentListeners = new Set<unknown>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const updates: any[] = [];
  const gains: number[] = [];
  const limiterStates: number[] = [];
  const moduleUrls: string[] = [];
  let runtimeId: string | undefined = "test";
  let idThrows = false;
  let sendFailure: "sync" | "async" | null = null;
  let sends = 0;
  let removedRuntimeListeners = 0;
  let resolveStorage: (value: unknown) => void;
  const storage = new Promise((resolve) => { resolveStorage = resolve; });
  let command: (message: any, sender: any, respond: (response: any) => void) => boolean;
  let poll: () => void;
  let player: object | null = {
    getStatsForNerds: () => ({ volume: "50%/30% (cont.-9.6dB tgt.-14.0dB)" }),
  };
  const video = {};
  const window = {
    addEventListener: (_: string, callback: (event: any) => void) => listeners.add(callback),
    removeEventListener: (_: string, callback: (event: any) => void) => listeners.delete(callback),
    postMessage: (data: any) => {
      const cloned = structuredClone(data);
      queueMicrotask(() => listeners.forEach((callback) => callback({ source: window, data: cloned })));
    },
  };
  const document = {
    querySelector: (selector: string) => selector === "#movie_player" ? player : video,
    addEventListener: (type: string) => documentListeners.add(type),
    removeEventListener: (type: string) => documentListeners.delete(type),
  };
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: async (url: string) => { moduleUrls.push(url); } };
    createMediaElementSource() { return { connect() {} }; }
    createGain() {
      const gain = { value: 1, setValueAtTime(value: number) { gain.value = value; gains.push(value); } };
      return { connect() {}, disconnect() {}, gain };
    }
  }
  class FakeWorklet {
    parameters = new Map([["enabled", { setValueAtTime: (value: number) => limiterStates.push(value) }]]);
    port = { onmessage: null, close() {} };
    connect() {}
  }
  const startMain = () => runInNewContext(script, {
    window, document,
    setInterval: (callback: () => void) => { poll = callback; return 1; },
    AudioContext: class { constructor() { throw new Error("Page CSP blocks audio modules"); } },
  });
  const startBridge = () => runInNewContext(bridge, {
    window, document,
    setTimeout: (callback: () => void, delay: number) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); clearTimeout(timer); },
    AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorklet,
    chrome: {
      storage: { local: { get: () => deferStorage ? storage : Promise.resolve({ state: storedState }) } },
      runtime: {
        get id() {
          if (idThrows) throw new Error("Extension context invalidated.");
          return runtimeId;
        },
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: (message: any) => {
          sends++;
          if (sendFailure === "sync") throw new Error("Extension context invalidated.");
          if (sendFailure === "async") return Promise.reject(new Error("Extension context invalidated."));
          updates.push(message);
          return Promise.resolve();
        },
        onMessage: {
          addListener: (handler: typeof command) => { command = handler; },
          removeListener: () => { removedRuntimeListeners++; },
        },
      },
    },
  });
  if (bridgeFirst) { startBridge(); startMain(); }
  else { startMain(); startBridge(); }

  return {
    window, updates, gains, limiterStates, moduleUrls,
    poll: () => poll!(),
    navigateAway: () => { player = null; },
    setState: (state: object) => command!({ type: "NN_SET_STATE", state }, {}, () => {}),
    stats: () => new Promise<any>((resolve) => command!({ type: "NN_GET_STATS" }, {}, resolve)),
    invalidate: (throwOnId = false) => { runtimeId = undefined; idThrows = throwOnId; },
    failSend: (kind: "sync" | "async") => { sendFailure = kind; },
    resolveStorage: () => resolveStorage!({ state: storedState }),
    get lifecycle() {
      return { sends, windowListeners: listeners.size, documentListeners: documentListeners.size, timers: timers.size, removedRuntimeListeners };
    },
  };
}

test.each([false, true])("isolated audio preserves correction with anti-clip ON, regardless of injection order (%s)", async (bridgeFirst) => {
  const app = setup(undefined, bridgeFirst);
  await flush();
  const protectedStats = await app.stats();
  expect(protectedStats.stats.normalizedPercent).toBe(30);
  expect(protectedStats.stats.appliedGain).toBeCloseTo(50 / 30);
  expect(protectedStats.stats.limiterActive).toBe(true);
  expect(app.moduleUrls).toEqual(["chrome-extension://test/content/limiter-worklet.js"]);

  app.setState({ antiClipping: false });
  expect(app.gains.at(-1)).toBeCloseTo(50 / 30);
  expect(app.limiterStates.at(-1)).toBe(0);
  app.setState({ antiClipping: true });
  expect(app.gains.at(-1)).toBeCloseTo(50 / 30);
  expect(app.limiterStates.at(-1)).toBe(1);

  app.setState({ enabled: false });
  expect(app.gains.at(-1)).toBe(1);
  expect(app.limiterStates.at(-1)).toBe(0);
  app.navigateAway();
  app.poll();
  await flush();
  expect(app.updates.at(-1).stats).toBeNull();
  expect((await app.stats()).stats).toBeNull();
});

test("stored OFF state is restored without applying boost", async () => {
  const app = setup({ enabled: false, antiClipping: true });
  await flush();
  expect(app.gains).toHaveLength(0);
  expect((await app.stats()).state.enabled).toBe(false);
  app.setState({ enabled: true });
  await flush();
  expect((await app.stats()).stats.appliedGain).toBeCloseTo(50 / 30);
});

test("page messages cannot change extension toggles, worklet URL or processing status", async () => {
  const app = setup();
  await flush();
  app.window.postMessage({ type: "NN_SET_STATE", state: { enabled: false, antiClipping: false } });
  app.window.postMessage({ type: "NN_AUDIO_CONFIG", limiterUrl: "https://untrusted.example/code.js" });
  app.window.postMessage({ type: "NN_PLAYER_STATS", stats: { correctionGain: Infinity, limiterActive: true } });
  await flush();
  expect(app.updates.at(-1).stats).toBeNull();
  const response = await app.stats();
  expect(response.state).toEqual({ enabled: true, antiClipping: true, preAmpEnabled: false, preAmpGainDb: 0 });
  expect(response.stats.appliedGain).toBeCloseTo(50 / 30);
  expect(app.moduleUrls).toEqual(["chrome-extension://test/content/limiter-worklet.js"]);
});

test.each([false, true])("invalidated runtime stops listeners, pending replies and audio (throwing id: %s)", async (throwOnId) => {
  const app = setup();
  await flush();
  const sends = app.lifecycle.sends;
  let replied = false;
  void app.stats().then(() => { replied = true; });
  expect(app.lifecycle.timers).toBe(1);
  app.invalidate(throwOnId);
  app.poll();
  await flush();
  expect(app.gains.at(-1)).toBe(1);
  expect(app.limiterStates.at(-1)).toBe(0);
  // documentListeners: 1 because the MAIN world's yt-navigate-finish listener
  // has no cleanup path (it runs in page context, not extension context).
  expect(app.lifecycle).toEqual({ sends, windowListeners: 1, documentListeners: 1, timers: 0, removedRuntimeListeners: 1 });
  expect(replied).toBe(false);
  app.poll();
  await flush();
  expect(app.lifecycle.sends).toBe(sends);
});

test.each(["sync", "async"] as const)("catches %s invalidation from sendMessage, even before runtime.id clears", async (kind) => {
  const app = setup();
  await flush();
  const sends = app.lifecycle.sends;
  app.failSend(kind);
  app.poll();
  await flush();
  expect(app.lifecycle.sends).toBe(sends + 1);
  expect(app.lifecycle.documentListeners).toBe(1); // MAIN world yt-navigate-finish persists
  expect(app.lifecycle.windowListeners).toBe(1);
  expect(app.gains.at(-1)).toBe(1);
  app.poll();
  await flush();
  expect(app.lifecycle.sends).toBe(sends + 1);
});

test("storage resolving after invalidation cannot restart old audio or messaging", async () => {
  const app = setup(undefined, false, true);
  app.invalidate();
  app.resolveStorage();
  await flush();
  expect(app.gains).toHaveLength(0);
  expect(app.lifecycle.sends).toBe(0);
  expect(app.lifecycle.documentListeners).toBe(1); // MAIN world yt-navigate-finish persists
  expect(app.lifecycle.windowListeners).toBe(1);
});
