import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AudioStats } from "../content/normalization";

interface ExtensionState {
  enabled: boolean;
  antiClipping: boolean;
  preAmpEnabled: boolean;
  preAmpGainDb: number;
}

const PREAMP_MIN = -12;
const PREAMP_MAX = 12;
const PREAMP_SCROLL_STEP = 0.05;

function clampPreamp(v: number) {
  return Math.round(Math.max(PREAMP_MIN, Math.min(PREAMP_MAX, v)) * 100) / 100;
}

export function Popup() {
  const [state, setState] = useState<ExtensionState>({
    enabled: true,
    antiClipping: true,
    preAmpEnabled: false,
    preAmpGainDb: 0,
  });
  const [stats, setStats] = useState<AudioStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [editingPreamp, setEditingPreamp] = useState(false);
  const [preampDraft, setPreampDraft] = useState("");
  const preampInputRef = useRef<HTMLInputElement>(null);
  const preampBoxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const editingRef = useRef(editingPreamp);
  editingRef.current = editingPreamp;

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

  const sendState = useCallback((newState: ExtensionState) => {
    chrome.runtime.sendMessage({ type: "NN_SET_STATE", state: newState });
  }, []);

  const updateState = useCallback(
    (partial: Partial<ExtensionState>, immediate = true) => {
      setState((prev) => {
        const newState = { ...prev, ...partial };
        newState.preAmpEnabled = newState.preAmpGainDb !== 0;
        if (immediate) {
          sendState(newState);
        } else {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => sendState(newState), 80);
        }
        return newState;
      });
    },
    [sendState]
  );

  useEffect(() => {
    const el = preampBoxRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (editingRef.current) return;
      const prev = stateRef.current;
      if (!prev.enabled) return;
      const delta = e.deltaY < 0 ? PREAMP_SCROLL_STEP : -PREAMP_SCROLL_STEP;
      const newVal = clampPreamp(prev.preAmpGainDb + delta);
      const newState: ExtensionState = {
        ...prev,
        preAmpGainDb: newVal,
        preAmpEnabled: newVal !== 0,
      };
      stateRef.current = newState;
      setState(newState);
      sendState(newState);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [sendState]);

  const commitPreamp = () => {
    editingRef.current = false;
    setEditingPreamp(false);
    const parsed = parseFloat(preampDraft.trim().replace(/,/g, "."));
    if (Number.isFinite(parsed)) {
      updateState({ preAmpGainDb: clampPreamp(parsed) });
    }
  };

  const cancelEditing = () => {
    editingRef.current = false;
    setEditingPreamp(false);
  };

  const startEditing = () => {
    if (!state.enabled) return;
    editingRef.current = true;
    setPreampDraft(state.preAmpGainDb.toFixed(2));
    setEditingPreamp(true);
    requestAnimationFrame(() => preampInputRef.current?.select());
  };

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

      {/* Pre-Amp Section */}
      <div className="section">
        <div className="control-row">
          <span className="label">PRE-AMP</span>
          <div
            ref={preampBoxRef}
            className={`preamp-box ${!state.enabled ? "disabled" : ""} ${state.preAmpGainDb !== 0 ? "highlight" : ""} ${editingPreamp ? "editing" : ""}`}
            onClick={!editingPreamp ? startEditing : undefined}
            title={editingPreamp ? "Enter to apply, Esc to cancel" : "Click to edit, scroll to adjust (±0.05 dB)"}
          >
            {editingPreamp ? (
              <input
                ref={preampInputRef}
                className="preamp-input"
                type="text"
                value={preampDraft}
                onChange={(e) => setPreampDraft(e.target.value)}
                onBlur={commitPreamp}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitPreamp();
                  if (e.key === "Escape") cancelEditing();
                }}
              />
            ) : (
              <span className="preamp-display">
                {state.preAmpGainDb > 0 ? "+" : ""}{state.preAmpGainDb.toFixed(2)}
              </span>
            )}
            <span className="preamp-unit">dB</span>
          </div>
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
          {state.enabled && state.preAmpGainDb !== 0 && (
            <StatRow
              label="Pre-amp"
              value={`${state.preAmpGainDb > 0 ? "+" : ""}${state.preAmpGainDb.toFixed(2)} dB`}
              highlight
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
