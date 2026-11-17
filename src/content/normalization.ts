export interface AudioConfig {
  // Relative to YouTube's target, unlike perceptualLoudnessDb (absolute LUFS).
  loudnessDb?: number;
  perceptualLoudnessDb?: number;
}

export interface YTPlayer {
  getPlayerResponse?: () => {
    playerConfig?: { audioConfig?: AudioConfig };
    audioConfig?: AudioConfig;
  };
  getStatsForNerds?: () => { volume?: string };
  getVolume?: () => number;
}

export interface AudioStats {
  normalizedPercent: number | null;
  contentLoudness: number | null;
  targetLoudness: number;
  // Separate from the displayed percentage, which includes the user's volume.
  correctionGain: number;
  appliedGain?: number;
  limiterActive?: boolean;
  limiterReductionDb?: number;
  outputPeakDb?: number | null;
  audioError?: string | null;
}

const TARGET_LUFS = -14;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safelyRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    // The player API can be temporarily unavailable during navigation.
    return undefined;
  }
}

export function readNormalization(player: YTPlayer): AudioStats | null {
  const response = safelyRead(() => player.getPlayerResponse?.());
  const config = response?.playerConfig?.audioConfig ?? response?.audioConfig;
  const rawVolume = safelyRead(() => player.getStatsForNerds?.()?.volume);
  const text = typeof rawVolume === "string"
    ? rawVolume.replace(/\u2212/g, "-").replace(/,/g, ".")
    : "";
  const percentages = text.match(/(\d+(?:\.\d+)?)\s*%\s*\/\s*(\d+(?:\.\d+)?)\s*%/);
  // Current Stats for nerds: "100%/60% (cont.-9.6dB tgt.-14.0dB)".
  const contentMatch = text.match(/\bcont\.\s*([+-]?\d+(?:\.\d+)?)\s*dB/i);
  const targetMatch = text.match(/\btgt\.\s*([+-]?\d+(?:\.\d+)?)\s*dB/i);
  // Older players report content loudness as an offset from the target.
  const offsetMatch = text.match(/content\s+loudness\s*([+-]?\d+(?:\.\d+)?)\s*dB/i);
  const targetLoudness = targetMatch ? Number(targetMatch[1]) : TARGET_LUFS;
  const offset = offsetMatch ? Number(offsetMatch[1]) : config?.loudnessDb;
  const contentLoudness = contentMatch
    ? Number(contentMatch[1])
    : isFiniteNumber(config?.perceptualLoudnessDb)
      ? config.perceptualLoudnessDb
      : isFiniteNumber(offset) ? targetLoudness + offset : null;

  if (percentages) {
    const volume = Number(percentages[1]);
    const normalized = Number(percentages[2]);
    if (volume <= 100 && normalized <= 100) {
      return {
        normalizedPercent: normalized,
        contentLoudness,
        targetLoudness,
        // At 50%/30%, correction is 50/30, NOT 100/30. Never divide by zero.
        correctionGain: volume > 0 && normalized > 0
          ? Math.max(1, volume / normalized)
          : 1,
      };
    }
  }

  if (contentLoudness === null) return null;

  // YouTube only attenuates loud content; it does not boost quiet content.
  const loudnessOffset = isFiniteNumber(offset) ? offset : contentLoudness - targetLoudness;
  const factor = Math.pow(10, -Math.max(0, loudnessOffset) / 20);
  const volume = safelyRead(() => player.getVolume?.());
  return {
    normalizedPercent: isFiniteNumber(volume) && volume >= 0 && volume <= 100
      ? volume * factor
      : null,
    contentLoudness,
    targetLoudness,
    correctionGain: 1 / factor,
  };
}
