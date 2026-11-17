import React, { useCallback, useEffect, useState } from "react";
import type { AudioStats } from "../content/normalization";

interface ExtensionState {
  enabled: boolean;
  antiClipping: boolean;
}

export function Popup() {
  const [state, setState] = useState<ExtensionState>({
    enabled: true,
    antiClipping: true,
  });
  const [stats, setStats] = useState<AudioStats | null>(null);
  const [connected, setConnected] = useState(false);

  // Load state from storage
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "NN_GET_STATE" }).then((response) => {
      if (response?.state) {
        setState(response.state);
      }
    });
  }, []);

  // Poll stats
  useEffect(() => {
    const fetchStats = () => {
      chrome.runtime.sendMessage({ type: "NN_GET_STATS" }).then((response) => {
        if (response?.stats) {
          setStats(response.stats);
          setConnected(true);
        } else {
          setStats(null);
          setConnected(false);
        }
      }).catch(() => {
        setConnected(false);
      });
    };

    fetchStats();
    const interval = setInterval(fetchStats, 1500);
    return () => clearInterval(interval);
  }, []);

  const updateState = useCallback(
    (partial: Partial<ExtensionState>) => {
      const newState = { ...state, ...partial };
      setState(newState);
      chrome.runtime.sendMessage({ type: "NN_SET_STATE", state: newState });
    },
    [state]
  );

  const isActive = state.enabled;
  const gain = state.enabled && stats ? (stats.appliedGain ?? 1) : 1;

  return (
    <div className={`popup ${isActive ? "active" : "inactive"}`}>
      {/* Header */}
      <div className="header">
        <div className="header-left">
          <span className="title">NO NORMALIZE</span>
        </div>
        <span className="version">v1.0</span>
      </div>

      {/* Controls */}
      <div className="section">
        <div className="control-row">
          <span className="label">EXTENSION</span>
          <button
            className={`toggle ${state.enabled ? "on" : "off"}`}
            onClick={() => updateState({ enabled: !state.enabled })}
          >
            {state.enabled ? "ON" : "OFF"}
          </button>
        </div>

        <div className="control-row">
          <span className="label">ANTI-CLIP</span>
          <button
            title="Limit output sample peaks to 0 dBFS after normalization correction"
            className={`toggle ${state.antiClipping ? "on" : "off"} ${!state.enabled ? "disabled" : ""}`}
            onClick={() => state.enabled && updateState({ antiClipping: !state.antiClipping })}
            disabled={!state.enabled}
          >
            {state.antiClipping ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="divider" />

      {/* Stats */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">AUDIO STATS</span>
        </div>

        <div className="stats-grid">
          <StatRow
            label="Normalized"
            value={stats?.normalizedPercent != null ? `${Math.round(stats.normalizedPercent)}%` : "—"}
            highlight={stats ? stats.correctionGain > 1 : false}
          />
          <StatRow
            label="Content LUFS"
            value={stats?.contentLoudness != null ? `${Number(stats.contentLoudness.toFixed(2))} LUFS` : "—"}
          />
          <StatRow
            label="Target LUFS"
            value={stats ? `${stats.targetLoudness} LUFS` : "—"}
          />
          <StatRow
            label="Peak limiter"
            value={!state.enabled || !state.antiClipping ? "OFF" : !stats ? "—" : stats.limiterActive ? "0 dBFS" : stats.audioError ? "UNAVAILABLE" : "STARTING"}
          />
          {state.enabled && state.antiClipping && stats?.limiterActive && (
            <StatRow
              label="Limit reduction"
              value={`${(stats.limiterReductionDb ?? 0) > 0 ? "−" : ""}${(stats.limiterReductionDb ?? 0).toFixed(1)} dB`}
            />
          )}
          {stats?.audioError && <StatRow label="Audio error" value="SEE DETAILS" title={stats.audioError} />}
        </div>

        {stats && stats.correctionGain > 1 && (
          <div className="meter-section">
            <div className="meter-label">
              <span title="Correction gain before the peak limiter">CORRECTION GAIN</span>
              <span className="meter-value">
                {`${gain.toFixed(2)}x`}
              </span>
            </div>
            <div className="meter">
              <div
                className={`meter-fill ${state.enabled ? "active" : ""}`}
                style={{
                  width: `${Math.min(gain * 100, 200) / 2}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  highlight = false,
  title,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${highlight ? "highlight" : ""}`} title={title}>
        {value}
      </span>
    </div>
  );
}
