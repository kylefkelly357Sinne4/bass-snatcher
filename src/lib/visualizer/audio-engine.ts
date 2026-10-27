export type SourceKind = "none" | "mic" | "file" | "demo";

export type EngineSnapshot = {
  source: SourceKind;
  fileName: string;
  playing: boolean;
  current: number;
  duration: number;
};

const BASS = [55, 55, 82.41, 73.42, 65.41, 55, 98, 73.42];
const PLUCK = [220, 277.18, 329.63, 196];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private out: GainNode | null = null;
  private fileNode: MediaElementAudioSourceNode | null = null;
  private fileUrl: string | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private demoBus: GainNode | null = null;
  private demoTimer: ReturnType<typeof setTimeout> | null = null;
  private demoGen = 0;
  private demoRunning = false;
  private noiseBuffer: AudioBuffer | null = null;
  private disposed = false;
  private source: SourceKind = "none";
  private fileName = "";

  constructor(
    private readonly fileEl: HTMLAudioElement,
    private readonly onChange: (snap: EngineSnapshot) => void,
  ) {
    this.fileEl.loop = true;
    this.fileEl.preload = "auto";
    this.fileEl.addEventListener("play", this.onMedia);
    this.fileEl.addEventListener("pause", this.onMedia);
    this.fileEl.addEventListener("ended", this.onMedia);
    this.fileEl.addEventListener("timeupdate", this.onMedia);
    this.fileEl.addEventListener("durationchange", this.onMedia);
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  get playing(): boolean {
    if (this.source === "mic") return true;
    if (this.source === "file") return !this.fileEl.paused;
    if (this.source === "demo") return this.demoRunning;
    return false;
  }

  async useMic(): Promise<void> {
    await this.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.detachInputs();
    const ctx = this.ctx;
    if (!ctx || !this.analyserNode || !this.out) return;
    this.micStream = stream;
    this.micNode = ctx.createMediaStreamSource(stream);
    this.out.gain.value = 0;
    this.micNode.connect(this.analyserNode);
    this.source = "mic";
    this.emit();
  }

  releaseMic(): void {
    if (this.source !== "mic") return;
    this.safeDisconnect(this.micNode);
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.micNode = null;
    if (this.fileUrl && this.fileNode && this.analyserNode && this.out) {
      this.fileNode.connect(this.analyserNode);
      this.out.gain.value = 1;
      this.source = "file";
    } else {
      this.source = "none";
    }
    this.emit();
  }

  async useFile(file: File): Promise<void> {
    await this.resume();
    this.detachInputs();
    const ctx = this.ctx;
    if (!ctx || !this.analyserNode || !this.out) return;
    const prev = this.fileUrl;
    this.fileUrl = URL.createObjectURL(file);
    this.fileName = file.name.replace(/\.[^/.]+$/, "");
    this.fileEl.src = this.fileUrl;
    if (prev) URL.revokeObjectURL(prev);
    if (!this.fileNode) this.fileNode = ctx.createMediaElementSource(this.fileEl);
    this.fileNode.connect(this.analyserNode);
    this.out.gain.value = 1;
    this.source = "file";
    try {
      await this.fileEl.play();
    } catch (err) {
      this.emit();
      if (err instanceof DOMException && err.name === "NotSupportedError") {
        throw new Error("That file format won't play in this browser.");
      }
      throw new Error("Press play to start the track.");
    }
    this.emit();
  }

  async useDemo(): Promise<void> {
    await this.resume();
    this.detachInputs();
    const ctx = this.ctx;
    if (!ctx || !this.analyserNode || !this.out) return;
    const bus = ctx.createGain();
    bus.gain.value = 0.58;
    bus.connect(this.analyserNode);
    this.demoBus = bus;
    this.out.gain.value = 1;
    this.source = "demo";
    this.demoRunning = true;
    this.scheduleDemo(this.demoGen, bus);
    this.emit();
  }

  async togglePlayback(): Promise<void> {
    if (this.source === "mic") return;
    if (this.source === "none" || (this.source === "demo" && !this.demoRunning)) {
      await this.useDemo();
      return;
    }
    if (this.source === "demo") {
      this.pauseDemo();
      return;
    }
    await this.resume();
    if (this.fileEl.paused) {
      try {
        await this.fileEl.play();
      } catch {
        this.emit();
        throw new Error("Couldn't play that track.");
      }
    } else {
      this.fileEl.pause();
    }
    this.emit();
  }

  seek(time: number): void {
    if (this.source !== "file") return;
    const duration = this.fileEl.duration;
    if (!Number.isFinite(duration)) return;
    this.fileEl.currentTime = Math.min(Math.max(0, time), duration);
  }

  dispose(): void {
    this.disposed = true;
    this.fileEl.removeEventListener("play", this.onMedia);
    this.fileEl.removeEventListener("pause", this.onMedia);
    this.fileEl.removeEventListener("ended", this.onMedia);
    this.fileEl.removeEventListener("timeupdate", this.onMedia);
    this.fileEl.removeEventListener("durationchange", this.onMedia);
    this.detachInputs();
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = null;
    void this.ctx?.close();
  }

  private onMedia = (): void => {
    this.emit();
  };

  private emit(): void {
    if (this.disposed) return;
    const duration = this.fileEl.duration;
    this.onChange({
      source: this.source,
      fileName: this.fileName,
      playing: this.playing,
      current: this.fileEl.currentTime || 0,
      duration: Number.isFinite(duration) ? duration : 0,
    });
  }

  private async resume(): Promise<void> {
    this.ensure();
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
  }

  private ensure(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.52;
    analyser.minDecibels = -88;
    analyser.maxDecibels = -24;
    const out = ctx.createGain();
    out.gain.value = 1;
    analyser.connect(out);
    out.connect(ctx.destination);
    this.ctx = ctx;
    this.analyserNode = analyser;
    this.out = out;
  }

  private detachInputs(): void {
    this.demoGen += 1;
    this.demoRunning = false;
    if (this.demoTimer !== null) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
    }
    this.fileEl.pause();
    this.safeDisconnect(this.fileNode);
    this.safeDisconnect(this.micNode);
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.micNode = null;
    this.safeDisconnect(this.demoBus);
    this.demoBus = null;
  }

  private pauseDemo(): void {
    this.demoGen += 1;
    this.demoRunning = false;
    if (this.demoTimer !== null) {
      clearTimeout(this.demoTimer);
      this.demoTimer = null;
    }
    this.safeDisconnect(this.demoBus);
    this.demoBus = null;
    this.emit();
  }

  private scheduleDemo(gen: number, bus: GainNode): void {
    const step = 60 / 96 / 2;
    let next = (this.ctx?.currentTime ?? 0) + 0.05;
    let n = 0;
    const loop = (): void => {
      if (this.demoGen !== gen || !this.ctx) return;
      const now = this.ctx.currentTime;
      if (next < now) next = now + 0.02;
      while (next < now + 0.24) {
        this.hit(next, n, bus);
        n += 1;
        next += step;
      }
      this.demoTimer = setTimeout(loop, 60);
    };
    loop();
  }

  private hit(t: number, n: number, bus: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const step = 60 / 96 / 2;
    if (n % 2 === 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(148, t);
      osc.frequency.exponentialRampToValueAtTime(46, t + 0.14);
      gain.gain.setValueAtTime(0.78, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(t);
      osc.stop(t + 0.24);

      const bass = ctx.createOscillator();
      const bassGain = ctx.createGain();
      bass.type = "triangle";
      bass.frequency.setValueAtTime(BASS[(n / 2) % BASS.length] ?? 55, t);
      bassGain.gain.setValueAtTime(0.001, t);
      bassGain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      bassGain.gain.exponentialRampToValueAtTime(0.001, t + step * 1.8);
      bass.connect(bassGain);
      bassGain.connect(bus);
      bass.start(t);
      bass.stop(t + step * 1.9);
    } else {
      this.hat(t, bus, 0.13);
    }
    if (n % 4 === 3) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = PLUCK[(n >> 2) % PLUCK.length] ?? 220;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    if (n % 8 === 0) {
      for (const freq of [220, 261.63, 329.63]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(0.04, t + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, t + step * 7.5);
        osc.connect(gain);
        gain.connect(bus);
        osc.start(t);
        osc.stop(t + step * 7.6);
      }
    }
  }

  private hat(t: number, bus: GainNode, level: number): void {
    const ctx = this.ctx;
    const noise = this.noise();
    if (!ctx || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    const offset = Math.random() * Math.max(0, noise.duration - 0.06);
    src.start(t, offset, 0.05);
    src.stop(t + 0.06);
  }

  private noise(): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.4);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private safeDisconnect(node: AudioNode | null): void {
    try {
      node?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
