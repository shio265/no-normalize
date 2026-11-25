import { readNormalization, type YTPlayer } from "./normalization";

function getPlayer(): YTPlayer | null {
  const el = document.querySelector("#movie_player") as (HTMLElement & YTPlayer) | null;
  return el && (typeof el.getPlayerResponse === "function" || typeof el.getStatsForNerds === "function") ? el : null;
}

let refreshScheduled = false;
function refresh(requestId?: number) {
  refreshScheduled = false;
  const player = getPlayer();
  const stats = player ? readNormalization(player) : null;
  window.postMessage({ type: "NN_PLAYER_STATS", stats, requestId }, "*");
}

// coalesce rapid-fire events into a single microtask.
function scheduleRefresh() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => refresh());
  } else {
    refresh();
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type === "NN_GET_PLAYER_STATS") refresh(event.data.requestId);
});

// new source loads.
document.addEventListener("loadeddata", scheduleRefresh, true);
document.addEventListener("playing", scheduleRefresh, true);
document.addEventListener("canplay", scheduleRefresh, true);

// custom event when the new page is ready.
document.addEventListener("yt-navigate-finish", scheduleRefresh);

if (typeof MutationObserver !== "undefined") {
  let playerFound = false;
  const observer = new MutationObserver(() => {
    if (playerFound) return;
    if (getPlayer()) {
      playerFound = true;
      observer.disconnect();
      scheduleRefresh();
    }
  });
  const root = document.documentElement ?? document;
  observer.observe(root, { childList: true, subtree: true });
}

// steady-state poll.
setInterval(() => refresh(), 1000);
window.postMessage({ type: "NN_PLAYER_READY" }, "*");
