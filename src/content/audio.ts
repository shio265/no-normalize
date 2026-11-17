interface AudioGraph {
  gain: GainNode;
  limiter: AudioWorkletNode | null;
  loading: boolean;
  correction: number;
  enabled: boolean;
  antiClipping: boolean;
  reductionDb: number;
  peakDb: number | null;
}

// Keep each MediaElementSource alive: Web Audio only allows one per element,
// even after its old AudioContext is closed (e.g. after YouTube navigation).
export class AudioEngine {
  private context: AudioContext | null = null;
  private graphs = new WeakMap<HTMLVideoElement, AudioGraph>();
  private allGraphs = new Set<AudioGraph>();
  private disposed = false;
  private activeGraph: AudioGraph | null = null;
  private moduleUrl: string | null = null;
  private moduleLoad: Promise<void> | null = null;
  private error: string | null = null;

  configure(moduleUrl: string) {
    this.moduleUrl ??= moduleUrl;
  }

  get status() {
    const limiterActive = !!this.activeGraph?.limiter && !!this.activeGraph.enabled && !!this.activeGraph.antiClipping;
    return {
      appliedGain: this.activeGraph?.gain.gain.value ?? 1,
      limiterActive,
      limiterReductionDb: limiterActive ? this.activeGraph!.reductionDb : 0,
      outputPeakDb: limiterActive ? this.activeGraph!.peakDb : null,
      audioError: this.error,
    };
  }

  resume() {
    if (this.disposed) return;
    if (this.context?.state === "suspended") {
      void this.context.resume().catch(() => { /* Retry on the next user gesture. */ });
    }
  }

  apply(video: HTMLVideoElement, correction: number, antiClipping: boolean) {
    if (this.disposed) return;
    if (!Number.isFinite(correction) || correction < 1) correction = 1;
    let graph = this.graphs.get(video);
    if (this.activeGraph && this.activeGraph !== graph) this.reset();
    if (!graph) {
      if (correction === 1 && !antiClipping) return;
      try {
        this.context ??= new AudioContext();
        const gain = this.context.createGain();
        const source = this.context.createMediaElementSource(video);
        source.connect(gain);
        gain.connect(this.context.destination);
        graph = { gain, limiter: null, loading: false, correction: 1, enabled: true, antiClipping, reductionDb: 0, peakDb: null };
        this.graphs.set(video, graph);
        this.allGraphs.add(graph);
      } catch {
        this.error = "Audio processing unavailable";
        return;
      }
    }
    this.activeGraph = graph;
    graph.correction = correction;
    graph.enabled = true;
    graph.antiClipping = antiClipping;
    this.update(graph);
    // Warm the bypassed limiter too, so toggling anti-clip ON doesn't need to
    // drop correction to unity just to start loading its module.
    if (!graph.limiter && !graph.loading && this.moduleUrl && !this.error) {
      void this.loadLimiter(graph);
    }
    this.resume();
  }

  reset() {
    if (this.activeGraph) {
      this.activeGraph.enabled = false;
      this.update(this.activeGraph);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const graph of this.allGraphs) {
      graph.enabled = false;
      this.update(graph);
      if (graph.limiter) {
        graph.limiter.port.onmessage = null;
        graph.limiter.port.close();
      }
    }
    this.allGraphs.clear();
    // Don't close/disconnect the context: the video is permanently bound to
    // its MediaElementSource, so that would silence it until the tab reloads.
  }

  private update(graph: AudioGraph) {
    if (!this.context) return;
    const limiting = graph.enabled && graph.antiClipping;
    // Fail closed: don't boost while protection is loading or unavailable.
    const gain = graph.enabled && (!limiting || graph.limiter) ? graph.correction : 1;
    graph.limiter?.parameters.get("enabled")?.setValueAtTime(limiting ? 1 : 0, this.context.currentTime);
    graph.gain.gain.setValueAtTime(gain, this.context.currentTime);
  }

  private async loadLimiter(graph: AudioGraph) {
    if (!this.context || !this.moduleUrl) return;
    graph.loading = true;
    try {
      this.moduleLoad ??= this.context.audioWorklet.addModule(this.moduleUrl);
      await this.moduleLoad;
      if (this.disposed) return;
      const limiter = new AudioWorkletNode(this.context, "nn-peak-limiter", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCountMode: "max",
      });
      limiter.port.onmessage = (event) => {
        const { reductionDb, peakDb } = event.data ?? {};
        if (Number.isFinite(reductionDb) && reductionDb >= 0) graph.reductionDb = reductionDb;
        if (peakDb === null || (Number.isFinite(peakDb) && peakDb <= 0)) graph.peakDb = peakDb;
      };
      limiter.parameters.get("enabled")?.setValueAtTime(graph.enabled && graph.antiClipping ? 1 : 0, this.context.currentTime);
      limiter.connect(this.context.destination);
      graph.gain.disconnect();
      graph.gain.connect(limiter);
      graph.limiter = limiter;
      // Re-read current state; the user may have toggled OFF during loading.
      this.update(graph);
    } catch (error) {
      if (this.disposed) return;
      const detail = error instanceof Error ? error.message : String(error);
      this.error = `Anti-clipping unavailable: ${detail}`;
      this.update(graph);
      console.warn("No Normalize: peak limiter unavailable; protected boost is disabled.", error);
    } finally {
      graph.loading = false;
    }
  }
}
