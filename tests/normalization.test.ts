import { describe, expect, test } from "bun:test";
import { readNormalization, type YTPlayer } from "../src/content/normalization";

describe("YouTube normalization stats", () => {
  test("matches the supplied Stats for nerds screenshot instead of reporting 20%", () => {
    const stats = readNormalization({
      getStatsForNerds: () => ({ volume: "100%/60% (cont.-9.6dB tgt.-14.0dB)" }),
      getPlayerResponse: () => ({ playerConfig: { audioConfig: { loudnessDb: 4.4 } } }),
    });
    expect(stats).toEqual({
      normalizedPercent: 60,
      contentLoudness: -9.6,
      targetLoudness: -14,
      correctionGain: 100 / 60,
    });
  });

  test("uses the actual player's stats over possibly stale metadata", () => {
    const stats = readNormalization({
      getStatsForNerds: () => ({ volume: "100% / 80% (cont.-12dB tgt.-14dB)" }),
      getPlayerResponse: () => ({ playerConfig: { audioConfig: { loudnessDb: 10 } } }),
    });
    expect(stats?.normalizedPercent).toBe(80);
    expect(stats?.contentLoudness).toBe(-12);
    expect(stats?.correctionGain).toBe(1.25);
  });

  test("does not undo the user's volume slider setting", () => {
    const stats = readNormalization({
      getStatsForNerds: () => ({ volume: "50% / 30% (content loudness 4.4 dB)" }),
    });
    expect(stats?.normalizedPercent).toBe(30);
    expect(stats?.correctionGain).toBeCloseTo(100 / 60);
    expect(stats?.contentLoudness).toBeCloseTo(-9.6);
  });

  test("50%/50% means no normalization, not a 2x boost", () => {
    const stats = readNormalization({ getStatsForNerds: () => ({ volume: "50% / 50%" }) });
    expect(stats?.normalizedPercent).toBe(50);
    expect(stats?.correctionGain).toBe(1);
    expect(stats?.contentLoudness).toBeNull();
  });

  test.each(["0% / 0%", "100% / 0%"])("handles silence safely: %s", (volume) => {
    const stats = readNormalization({ getStatsForNerds: () => ({ volume }) });
    expect(stats?.normalizedPercent).toBe(0);
    expect(stats?.correctionGain).toBe(1);
  });

  test("accepts decimal commas and Unicode minus in stats text", () => {
    const stats = readNormalization({
      getStatsForNerds: () => ({ volume: "100% / 60,5% (cont.−9,6dB tgt.−14,0dB)" }),
    });
    expect(stats?.normalizedPercent).toBe(60.5);
    expect(stats?.contentLoudness).toBe(-9.6);
  });

  test("reads playerConfig.audioConfig and treats loudnessDb as a relative offset", () => {
    const stats = readNormalization({
      getPlayerResponse: () => ({ playerConfig: { audioConfig: { loudnessDb: 4.4 } } }),
      getVolume: () => 100,
    });
    expect(stats?.normalizedPercent).toBeCloseTo(60.25596);
    expect(stats?.contentLoudness).toBeCloseTo(-9.6);
    expect(stats?.correctionGain).toBeCloseTo(10 ** (4.4 / 20));
  });

  test("supports older top-level audioConfig responses", () => {
    const stats = readNormalization({
      getPlayerResponse: () => ({ audioConfig: { loudnessDb: 6 } }),
      getVolume: () => 50,
    });
    expect(stats?.normalizedPercent).toBeCloseTo(25.05936);
    expect(stats?.correctionGain).toBeCloseTo(10 ** (6 / 20));
  });

  test("can derive the offset from perceptual (absolute) loudness", () => {
    const stats = readNormalization({
      getPlayerResponse: () => ({ playerConfig: { audioConfig: { perceptualLoudnessDb: -9.6 } } }),
      getVolume: () => 100,
    });
    expect(stats?.normalizedPercent).toBeCloseTo(60.25596);
    expect(stats?.contentLoudness).toBe(-9.6);
  });

  test.each([-4, 0])("does not boost content at/below target (offset %s dB)", (loudnessDb) => {
    const stats = readNormalization({
      getPlayerResponse: () => ({ playerConfig: { audioConfig: { loudnessDb } } }),
      getVolume: () => 100,
    });
    expect(stats?.normalizedPercent).toBe(100);
    expect(stats?.correctionGain).toBe(1);
  });

  test("missing data is unknown, not fabricated 0 dB / 20%", () => {
    expect(readNormalization({ getPlayerResponse: () => ({}) })).toBeNull();
  });

  test("missing volume stays unknown while valid loudness remains available", () => {
    const stats = readNormalization({ getPlayerResponse: () => ({ audioConfig: { loudnessDb: 4.4 } }) });
    expect(stats?.normalizedPercent).toBeNull();
    expect(stats?.contentLoudness).toBeCloseTo(-9.6);
  });

  test("a throwing response API does not hide valid live stats", () => {
    const stats = readNormalization({
      getPlayerResponse: () => { throw new Error("player loading"); },
      getStatsForNerds: () => ({ volume: "100% / 60%" }),
    });
    expect(stats?.normalizedPercent).toBe(60);
  });

  test("a throwing stats API falls back to metadata", () => {
    const stats = readNormalization({
      getStatsForNerds: () => { throw new Error("not ready"); },
      getPlayerResponse: () => ({ audioConfig: { loudnessDb: 0 } }),
      getVolume: () => 100,
    });
    expect(stats?.normalizedPercent).toBe(100);
  });

  test.each([NaN, Infinity, "4.4", null])("ignores invalid loudness metadata: %s", (loudnessDb) => {
    expect(readNormalization({
      getPlayerResponse: () => ({ audioConfig: { loudnessDb } }),
    } as YTPlayer)).toBeNull();
  });

  test("rejects invalid percentages and falls back to metadata", () => {
    const stats = readNormalization({
      getStatsForNerds: () => ({ volume: "200% / 120%" }),
      getPlayerResponse: () => ({ audioConfig: { loudnessDb: 0 } }),
      getVolume: () => 100,
    });
    expect(stats?.normalizedPercent).toBe(100);
  });

  test("correction gain is independent of the peak-limiter toggle", () => {
    const stats = readNormalization({ getStatsForNerds: () => ({ volume: "100% / 60%" }) })!;
    expect(stats.correctionGain).toBeCloseTo(1.66667);
  });
});
