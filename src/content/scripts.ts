// MAIN world is only needed for YouTube's player API. Audio processing lives in
// the isolated bridge, where loading our worklet isn't subject to page CSP.
import { readNormalization, type YTPlayer } from "./normalization";

function getPlayer(): YTPlayer | null {
  const el = document.querySelector("#movie_player") as (HTMLElement & YTPlayer) | null;
  return el && (typeof el.getPlayerResponse === "function" || typeof el.getStatsForNerds === "function") ? el : null;
}

function refresh(requestId?: number) {
  const player = getPlayer();
  const stats = player ? readNormalization(player) : null;
  window.postMessage({ type: "NN_PLAYER_STATS", stats, requestId }, "*");
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type === "NN_GET_PLAYER_STATS") refresh(event.data.requestId);
});

setInterval(() => refresh(), 1000);
window.postMessage({ type: "NN_PLAYER_READY" }, "*");
