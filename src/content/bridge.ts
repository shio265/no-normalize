// ISOLATED world: owns toggle state, Web Audio and the extension message relay.
import { AudioEngine } from "./audio";
import type { AudioStats } from "./normalization";

interface ExtensionState {
  enabled: boolean;
  antiClipping: boolean;
  preAmpEnabled: boolean;
  preAmpGainDb: number;
}

const audio = new AudioEngine();
const state: ExtensionState = { enabled: true, antiClipping: true, preAmpEnabled: false, preAmpGainDb: 0 };
let initialized = false;
let stopped = false;
let stateChanged = false;
let playerStats: AudioStats | null = null;
let requestId = 0;
const pending = new Map<number, { respond: (response: unknown) => void; timer: ReturnType<typeof setTimeout> }>();

function runtimeAvailable() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function cleanup() {
  if (stopped) return;
  stopped = true;
  initialized = false;
  window.removeEventListener("message", onPageMessage);
  document.removeEventListener("play", resumeAudio, true);
  document.removeEventListener("pointerdown", resumeAudio, true);
  document.removeEventListener("keydown", resumeAudio, true);
  for (const request of pending.values()) clearTimeout(request.timer);
  pending.clear();
  try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch { /* Context is already gone. */ }
  audio.dispose();
}

function ensureRuntime() {
  if (stopped) return false;
  if (runtimeAvailable()) return true;
  cleanup();
  return false;
}

function handleRuntimeError(error: unknown) {
  if (!runtimeAvailable() || /extension context invalidated/i.test(String(error))) cleanup();
}

function respond(callback: (value: unknown) => void, value: unknown) {
  if (!ensureRuntime()) return;
  try { callback(value); } catch (error) { handleRuntimeError(error); }
}

function updateState(value: Partial<ExtensionState> | undefined) {
  if (typeof value?.enabled === "boolean") state.enabled = value.enabled;
  if (typeof value?.antiClipping === "boolean") state.antiClipping = value.antiClipping;
  if (typeof value?.preAmpEnabled === "boolean") state.preAmpEnabled = value.preAmpEnabled;
  if (typeof value?.preAmpGainDb === "number" && Number.isFinite(value.preAmpGainDb)) {
    state.preAmpGainDb = value.preAmpGainDb;
  }
}

function validateStats(value: unknown): AudioStats | null {
  if (!value || typeof value !== "object") return null;
  const stats = value as AudioStats;
  if (!(stats.normalizedPercent === null || (Number.isFinite(stats.normalizedPercent) && stats.normalizedPercent! >= 0 && stats.normalizedPercent! <= 100)) ||
      !(stats.contentLoudness === null || Number.isFinite(stats.contentLoudness)) ||
      !Number.isFinite(stats.targetLoudness) || !Number.isFinite(stats.correctionGain) || stats.correctionGain < 1) return null;
  // Never accept state, worklet URLs or processing status from the page.
  return {
    normalizedPercent: stats.normalizedPercent,
    contentLoudness: stats.contentLoudness,
    targetLoudness: stats.targetLoudness,
    correctionGain: stats.correctionGain,
  };
}

function refreshAudio() {
  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video") ?? document.querySelector("video");
  if (initialized && state.enabled && playerStats && video) {
    audio.apply(video, playerStats.correctionGain, state.antiClipping, state.preAmpEnabled, state.preAmpGainDb);
  } else {
    audio.reset();
  }
}

function response() {
  return { stats: playerStats ? { ...playerStats, ...audio.status } : null, state: { ...state } };
}

async function broadcast() {
  if (!ensureRuntime()) return;
  try {
    // Invalidation can THROW before sendMessage returns a promise, so a
    // trailing .catch() alone cannot catch the error shown by Chrome.
    await chrome.runtime.sendMessage({ type: "NN_STATS_UPDATE", ...response() });
  } catch (error) {
    handleRuntimeError(error);
  }
}

function onPageMessage(event: MessageEvent) {
  if (event.source !== window || !ensureRuntime()) return;
  if (event.data?.type === "NN_PLAYER_READY") {
    window.postMessage({ type: "NN_GET_PLAYER_STATS" }, "*");
  }
  if (event.data?.type === "NN_PLAYER_STATS") {
    playerStats = validateStats(event.data.stats);
    refreshAudio();
    void broadcast();
    const request = pending.get(event.data.requestId);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(event.data.requestId);
      respond(request.respond, response());
    }
  }
}
window.addEventListener("message", onPageMessage);

function onRuntimeMessage(message: { type: string; state?: Partial<ExtensionState> }, _sender: chrome.runtime.MessageSender, sendResponse: (value: unknown) => void) {
  if (!ensureRuntime()) return false;
  if (message.type === "NN_SET_STATE") {
    stateChanged = true;
    updateState(message.state);
    refreshAudio();
    void broadcast();
    respond(sendResponse, { ok: true });
  }
  if (message.type === "NN_GET_STATS") {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      respond(sendResponse, { stats: null, state: { ...state } });
    }, 2000);
    pending.set(id, { respond: sendResponse, timer });
    window.postMessage({ type: "NN_GET_PLAYER_STATS", requestId: id }, "*");
    return true;
  }
  return false;
}
try { chrome.runtime.onMessage.addListener(onRuntimeMessage); } catch (error) { handleRuntimeError(error); }

function resumeAudio() {
  if (ensureRuntime()) audio.resume();
}
if (!stopped) {
  document.addEventListener("play", resumeAudio, true);
  document.addEventListener("pointerdown", resumeAudio, true);
  document.addEventListener("keydown", resumeAudio, true);
}

async function initialize() {
  try {
    if (!ensureRuntime()) return;
    audio.configure(chrome.runtime.getURL("content/limiter-worklet.js"));
    const data = await chrome.storage.local.get("state");
    if (!ensureRuntime()) return;
    if (!stateChanged) updateState(data.state);
    initialized = true;
    refreshAudio();
    window.postMessage({ type: "NN_GET_PLAYER_STATS" }, "*");
  } catch (error) { handleRuntimeError(error); }
}
void initialize();
