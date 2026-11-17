import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/content/limiter-worklet.js", import.meta.url), "utf8");

function createLimiter(sampleRate = 48000, onReport: (report: any) => void = () => {}) {
  let Processor: any;
  runInNewContext(source, {
    AudioWorkletProcessor: class { port = { postMessage: onReport }; },
    sampleRate,
    registerProcessor: (name: string, constructor: any) => {
      expect(name).toBe("nn-peak-limiter");
      Processor = constructor;
    },
  });
  const processor = new Processor();
  return (channels: number[][], enabled = true) => {
    const input = channels.map((channel) => new Float32Array(channel));
    const output = input.map((channel) => new Float32Array(channel.length));
    expect(processor.process([input], [output], { enabled: Float32Array.of(enabled ? 1 : 0) })).toBe(true);
    return output;
  };
}

test("does not change below-ceiling audio even when correction gain is above 1x", () => {
  const process = createLimiter();
  const corrected = [0, 0.2, -0.3, 0.5, -0.5].map((sample) => sample * (100 / 60));
  const [output] = process([corrected]);
  for (let i = 0; i < output.length; i++) expect(output[i]).toBeCloseTo(corrected[i]);
});

test("normalization removal stays audible with limiting ON when corrected peaks are safe", () => {
  const process = createLimiter();
  const normalized = [0.12, -0.3, 0.48, -0.48];
  const correction = 100 / 60;
  const [output] = process([normalized.map((sample) => sample * correction)]);
  for (let i = 0; i < output.length; i++) {
    expect(Math.abs(output[i])).toBeGreaterThan(Math.abs(normalized[i]));
    expect(output[i] / normalized[i]).toBeCloseTo(correction);
  }
});

test("reports actual attenuation separately from normalization correction", () => {
  const reports: any[] = [];
  const process = createLimiter(48000, (report) => reports.push(report));
  for (let i = 0; i < 38; i++) process([Array(128).fill(2)]);
  expect(reports).toHaveLength(1);
  expect(reports[0].reductionDb).toBeCloseTo(20 * Math.log10(2));
  expect(reports[0].peakDb).toBe(0);
});

test("limits both polarities to 0 dBFS, including the very first transient", () => {
  const process = createLimiter();
  const [output] = process([[4, -4, 2, -2, 0]]);
  expect(Array.from(output)).toEqual([1, -1, 0.5, -0.5, 0]);
});

test("links channels without downmixing or flattening peaks", () => {
  const process = createLimiter();
  const output = process([[2, -1, 0.5], [0.5, -0.25, 0.125]]);
  expect(Array.from(output[0])).toEqual([1, -0.5, 0.25]);
  expect(Array.from(output[1])).toEqual([0.25, -0.125, 0.0625]);
});

test("bypass preserves peaks above 0 dBFS and re-enabling restores protection", () => {
  const process = createLimiter();
  expect(Array.from(process([[2, -2]], false)[0])).toEqual([2, -2]);
  expect(Array.from(process([[2, -2]], true)[0])).toEqual([1, -1]);
  expect(Array.from(process([[0.4, -0.4]], false)[0])).toEqual(Array.from(Float32Array.of(0.4, -0.4)));
});

test("smoothly releases attenuation rather than snapping back to unity", () => {
  const process = createLimiter();
  process([Array(128).fill(4)]);
  let previous = 0.25;
  for (let i = 0; i < 200; i++) {
    const [output] = process([Array(128).fill(1)]);
    expect(output[0]).toBeGreaterThanOrEqual(previous);
    expect(output[0]).toBeLessThanOrEqual(1);
    if (i === 0) expect(output[0]).toBeLessThan(0.3);
    previous = output[0];
  }
  expect(previous).toBeGreaterThan(0.99);
});

test.each([44100, 48000, 96000])("never exceeds the sample ceiling across changing blocks at %s Hz", (rate) => {
  const process = createLimiter(rate);
  for (let block = 0; block < 50; block++) {
    const channels = Array.from({ length: 6 }, (_, channel) =>
      Array.from({ length: 128 }, (_, frame) => Math.sin(frame * 0.27 + channel) * (block % 7 + 0.5)));
    const output = process(channels);
    expect(output).toHaveLength(6);
    for (const channel of output) {
      expect(channel.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
    }
  }
});

test("silence and non-finite input cannot poison the release state", () => {
  const process = createLimiter();
  expect(Array.from(process([[NaN, Infinity, -Infinity, 0]])[0])).toEqual([0, 0, 0, 0]);
  expect(Array.from(process([[2, -2]])[0])).toEqual([1, -1]);
});
