// Static, packaged AudioWorklet module. No page-supplied code is executed here.
class PeakLimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "enabled", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.gain = 1;
    this.reportFrames = 0;
    this.minGain = 1;
    this.outputPeak = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const frames = output[0]?.length || 0;
    const enabled = parameters.enabled[0] >= 0.5;
    let peak = 0;

    // Inspect the entire render quantum before writing it. Link all channels
    // to the same gain so that limiting doesn't move the stereo image.
    if (enabled) {
      for (const channel of input) {
        for (let i = 0; i < frames; i++) {
          const sample = channel[i];
          if (Number.isFinite(sample)) peak = Math.max(peak, Math.abs(sample));
        }
      }
      const requiredGain = peak > 1 ? 1 / peak : 1;
      const release = Math.exp(-frames / (sampleRate * 0.1));
      // Instantaneous attack, 100 ms release. Always meet this block's ceiling.
      this.gain = Math.min(requiredGain, 1 - (1 - this.gain) * release);
    } else {
      this.gain = 1;
    }

    for (let channel = 0; channel < output.length; channel++) {
      for (let i = 0; i < frames; i++) {
        const sample = input[channel]?.[i] ?? 0;
        const value = Number.isFinite(sample) ? sample * this.gain : 0;
        // Numerical safety only; peak-based gain above is the actual limiter.
        const limited = enabled ? Math.max(-1, Math.min(1, value)) : value;
        output[channel][i] = limited;
        this.outputPeak = Math.max(this.outputPeak, Math.abs(limited));
      }
    }
    this.minGain = Math.min(this.minGain, this.gain);
    this.reportFrames += frames;
    if (this.reportFrames >= sampleRate / 10) {
      this.port.postMessage({
        reductionDb: -20 * Math.log10(this.minGain),
        peakDb: this.outputPeak > 0 ? 20 * Math.log10(this.outputPeak) : null,
      });
      this.reportFrames = 0;
      this.minGain = 1;
      this.outputPeak = 0;
    }
    return true;
  }
}

registerProcessor("nn-peak-limiter", PeakLimiterProcessor);
