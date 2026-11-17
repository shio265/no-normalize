import { afterEach, beforeEach, expect, test } from "bun:test";
import { AudioEngine } from "../src/content/audio";

const originalContext = globalThis.AudioContext;
const originalWorklet = globalThis.AudioWorkletNode;
let sources: number;
let moduleCalls: number;
let resolveModule: () => void;
let rejectModule: (error: Error) => void;
let limiterEnabled: number;
let closedPorts: number;

beforeEach(() => {
  sources = 0;
  moduleCalls = 0;
  limiterEnabled = -1;
  closedPorts = 0;
  const loaded = new Promise<void>((resolve, reject) => { resolveModule = resolve; rejectModule = reject; });
  class FakeContext {
    currentTime = 0;
    state = "running";
    destination = {};
    audioWorklet = { addModule: () => { moduleCalls++; return loaded; } };
    createMediaElementSource() { sources++; return { connect() {} }; }
    createGain() {
      const gain = { value: 1, setValueAtTime(value: number) { gain.value = value; } };
      return { gain, connect() {}, disconnect() {} };
    }
  }
  class FakeWorklet {
    parameters = new Map([["enabled", { setValueAtTime: (value: number) => { limiterEnabled = value; } }]]);
    port = { onmessage: null, close() { closedPorts++; } };
    connect() {}
  }
  globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;
  globalThis.AudioWorkletNode = FakeWorklet as unknown as typeof AudioWorkletNode;
});

afterEach(() => {
  globalThis.AudioContext = originalContext;
  globalThis.AudioWorkletNode = originalWorklet;
});

function createEngine() {
  const engine = new AudioEngine();
  engine.configure("chrome-extension://test/content/limiter-worklet.js");
  return engine;
}

test("protection permits correction above 1x once the limiter is ready", async () => {
  const engine = createEngine();
  engine.apply({} as HTMLVideoElement, 1.67, true);
  expect(engine.status.appliedGain).toBe(1);
  expect(engine.status.limiterActive).toBe(false);
  resolveModule();
  await Promise.resolve();
  expect(engine.status.appliedGain).toBe(1.67);
  expect(engine.status.limiterActive).toBe(true);
  expect(limiterEnabled).toBe(1);
});

test("turning anti-clip OFF bypasses limiting but keeps the correction", async () => {
  const engine = createEngine();
  const video = {} as HTMLVideoElement;
  engine.apply(video, 1.67, true);
  resolveModule();
  await Promise.resolve();
  engine.apply(video, 1.67, false);
  expect(engine.status.appliedGain).toBe(1.67);
  expect(engine.status.limiterActive).toBe(false);
  expect(limiterEnabled).toBe(0);
});

test("warms the bypassed limiter so turning protection ON keeps correction unchanged", async () => {
  const engine = createEngine();
  const video = {} as HTMLVideoElement;
  engine.apply(video, 1.67, false);
  expect(moduleCalls).toBe(1);
  expect(engine.status.appliedGain).toBe(1.67);
  resolveModule();
  await Promise.resolve();
  expect(limiterEnabled).toBe(0);
  engine.apply(video, 1.67, true);
  expect(engine.status.appliedGain).toBe(1.67);
  expect(limiterEnabled).toBe(1);
});

test("protection also runs when normalization correction is exactly 1x", async () => {
  const engine = createEngine();
  engine.apply({} as HTMLVideoElement, 1, true);
  resolveModule();
  await Promise.resolve();
  expect(engine.status.appliedGain).toBe(1);
  expect(engine.status.limiterActive).toBe(true);
});

test("turning the extension OFF during asynchronous worklet loading stays bypassed", async () => {
  const engine = createEngine();
  engine.apply({} as HTMLVideoElement, 1.67, true);
  engine.reset();
  resolveModule();
  await Promise.resolve();
  expect(engine.status.appliedGain).toBe(1);
  expect(engine.status.limiterActive).toBe(false);
  expect(limiterEnabled).toBe(0);
});

test("failed limiter loading never leaves protected boost active", async () => {
  const engine = createEngine();
  const video = {} as HTMLVideoElement;
  engine.apply(video, 1.67, false);
  expect(engine.status.appliedGain).toBe(1.67);
  engine.apply(video, 1.67, true);
  expect(engine.status.appliedGain).toBe(1);
  rejectModule(new Error("module blocked"));
  await Promise.resolve();
  expect(engine.status.appliedGain).toBe(1);
  expect(engine.status.limiterActive).toBe(false);
  expect(engine.status.audioError).toBe("Anti-clipping unavailable: module blocked");
});

test("reuses media sources across navigation and loads the worklet only once", async () => {
  const engine = createEngine();
  const first = {} as HTMLVideoElement;
  const second = {} as HTMLVideoElement;
  engine.apply(first, 1.67, true);
  resolveModule();
  await Promise.resolve();
  engine.apply(second, 2, true);
  await Promise.resolve();
  engine.apply(first, 1.5, true);
  expect(sources).toBe(2);
  expect(moduleCalls).toBe(1);
  expect(engine.status.appliedGain).toBe(1.5);
  expect(engine.status.limiterActive).toBe(true);
});

test("dispose bypasses every retained graph and closes telemetry without closing the audio route", async () => {
  const engine = createEngine();
  engine.apply({} as HTMLVideoElement, 1.67, true);
  resolveModule();
  await Promise.resolve();
  engine.apply({} as HTMLVideoElement, 2, true);
  await Promise.resolve();
  engine.dispose();
  engine.dispose();
  expect(closedPorts).toBe(2);
  expect(engine.status.appliedGain).toBe(1);
  expect(engine.status.limiterActive).toBe(false);
  engine.apply({} as HTMLVideoElement, 3, true);
  expect(sources).toBe(2);
  expect(engine.status.appliedGain).toBe(1);
});

test("worklet loading after dispose cannot recreate processing or boost", async () => {
  const engine = createEngine();
  engine.apply({} as HTMLVideoElement, 1.67, true);
  engine.dispose();
  resolveModule();
  await Promise.resolve();
  expect(engine.status.appliedGain).toBe(1);
  expect(engine.status.limiterActive).toBe(false);
  expect(limiterEnabled).toBe(-1);
});
