import { CHANNELS, channel, rgba, rgb, type RGB, type ThemeId, type VizMode } from "@/lib/visualizer/theme";

export type DrawState = {
  levels: Float32Array;
  peaks: Float32Array;
  wave: Float32Array;
  scratch: Float32Array;
  spec: Float32Array;
  freq: Uint8Array;
  td: Uint8Array;
  count: number;
  rotation: number;
  bass: number;
  luma: HTMLCanvasElement;
  tint: HTMLCanvasElement;
  holo: HTMLCanvasElement;
};

type PaintOpts = {
  mode: VizMode;
  theme: ThemeId;
  sensitivity: number;
  active: boolean;
  time: number;
  dt: number;
  reduced: boolean;
};

const TAU = Math.PI * 2;

export function createDrawState(): DrawState {
  return {
    levels: new Float32Array(0),
    peaks: new Float32Array(0),
    wave: new Float32Array(160),
    scratch: new Float32Array(0),
    spec: new Float32Array(0),
    freq: new Uint8Array(0),
    td: new Uint8Array(0),
    count: 0,
    rotation: 0,
    bass: 0,
    luma: document.createElement("canvas"),
    tint: document.createElement("canvas"),
    holo: document.createElement("canvas"),
  };
}

export function syncCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): { w: number; h: number; dpr: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = rect.width;
  const h = rect.height;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { w, h, dpr };
}

export function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  analyser: AnalyserNode | null,
  image: HTMLImageElement | null,
  state: DrawState,
  opts: PaintOpts,
): void {
  const live = Boolean(opts.active && analyser);
  const count = opts.mode === "bars" ? clamp(Math.round(w / 28), 18, 46) : clamp(Math.round(Math.min(w, h) / 8), 48, 96);
  updateLevels(state, analyser, opts, count, live);
  updateWave(state, analyser, opts, live);
  if (!opts.reduced) state.rotation += opts.dt * (0.1 + state.bass * 0.5);

  const lead = channel(opts.theme);
  const cx = w / 2;
  const cy = h * 0.44;

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#07060f";
  ctx.fillRect(0, 0, w, h);

  const fog = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55);
  fog.addColorStop(0, rgba(lead.rgb, 0.07 + state.bass * 0.1));
  fog.addColorStop(0.45, rgba(CHANNELS[1]?.rgb ?? lead.rgb, 0.04));
  fog.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, w, h);

  const ready = Boolean(image && image.complete && image.naturalWidth > 0);
  const scale = 1.04 + state.bass * 0.035;
  if (ready && image) renderHolo(state, image, w, h, dpr, opts.theme, scale);

  if (opts.mode === "bars") drawBars(ctx, state, w, h, ready, opts);
  else if (opts.mode === "disc") drawDisc(ctx, state, w, h, ready, opts, false);
  else drawDisc(ctx, state, w, h, ready, opts, true);

  glitch(ctx, w, h, dpr, opts, state.bass);
  scanlines(ctx, w, h, opts);
  beam(ctx, w, h, lead.rgb, opts);
  vignette(ctx, w, h, cx, cy);
}

function renderHolo(
  state: DrawState,
  image: HTMLImageElement,
  cssW: number,
  cssH: number,
  dpr: number,
  theme: ThemeId,
  scale: number,
): void {
  const pd = Math.min(dpr, 1.35);
  const bw = Math.max(1, Math.round(cssW * pd));
  const bh = Math.max(1, Math.round(cssH * pd));
  fit(state.luma, bw, bh);
  fit(state.tint, bw, bh);
  fit(state.holo, bw, bh);

  const luma = state.luma.getContext("2d");
  const tint = state.tint.getContext("2d");
  const holo = state.holo.getContext("2d");
  if (!luma || !tint || !holo) return;

  luma.setTransform(1, 0, 0, 1, 0, 0);
  luma.clearRect(0, 0, bw, bh);
  luma.filter = "grayscale(1) contrast(1.7) brightness(0.96)";
  drawCover(luma, image, bw, bh, scale);
  luma.filter = "none";
  luma.globalCompositeOperation = "destination-in";
  const mask = luma.createRadialGradient(bw / 2, bh * 0.46, Math.min(bw, bh) * 0.08, bw / 2, bh * 0.46, Math.max(bw, bh) * 0.62);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.7, "rgba(0,0,0,0.9)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  luma.fillStyle = mask;
  luma.fillRect(0, 0, bw, bh);
  luma.globalCompositeOperation = "source-over";

  holo.setTransform(1, 0, 0, 1, 0, 0);
  holo.clearRect(0, 0, bw, bh);
  const order = [...CHANNELS.filter((item) => item.id !== theme), channel(theme)];
  for (const ch of order) {
    const lead = ch.id === theme;
    tint.setTransform(1, 0, 0, 1, 0, 0);
    tint.clearRect(0, 0, bw, bh);
    tint.globalCompositeOperation = "source-over";
    tint.drawImage(state.luma, 0, 0);
    tint.globalCompositeOperation = "multiply";
    tint.fillStyle = rgb(ch.rgb);
    tint.fillRect(0, 0, bw, bh);
    tint.globalCompositeOperation = "destination-in";
    tint.drawImage(state.luma, 0, 0);
    tint.globalCompositeOperation = "source-over";

    holo.save();
    holo.globalCompositeOperation = lead ? "source-over" : "lighter";
    holo.globalAlpha = lead ? 0.94 : 0.4;
    holo.drawImage(state.tint, ch.dx * pd, ch.dy * pd);
    holo.restore();
  }
}

function drawBars(
  ctx: CanvasRenderingContext2D,
  state: DrawState,
  w: number,
  h: number,
  ready: boolean,
  opts: PaintOpts,
): void {
  const count = state.count;
  const cy = h * 0.46;
  const maxH = h * 0.5;
  const pad = w * 0.05;
  const slot = (w - pad * 2) / Math.max(1, count);
  const gap = Math.max(1.5, slot * 0.08);
  const bw = Math.max(1, slot - gap);
  const lead = channel(opts.theme);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(w / 2, cy + 10, Math.min(w * 0.38, 480), 9, 0, 0, TAU);
  ctx.strokeStyle = rgba(lead.rgb, 0.45);
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();

  if (ready) {
    const flicker = flickerAlpha(opts);
    ctx.save();
    ctx.globalAlpha = 0.42 * flicker;
    ctx.drawImage(state.holo, 0, 0, w, h);
    ctx.restore();
  }

  for (let i = 0; i < count; i++) {
    const level = Math.min(1, state.levels[i] ?? 0);
    const bh = Math.max(2, level * maxH);
    const x = pad + i * slot;
    const color = CHANNELS[i % CHANNELS.length]?.rgb ?? lead.rgb;
    if (ready) {
      const sx = (i / count) * state.holo.width;
      const sw = Math.max(1, state.holo.width / count);
      ctx.drawImage(state.holo, sx, 0, sw, state.holo.height, x, cy - bh / 2, bw, bh);
    } else {
      ctx.fillStyle = rgba(color, 0.18 + level * 0.75);
      ctx.fillRect(x, cy - bh / 2, bw, bh);
    }
    ctx.fillStyle = rgba(color, 0.95);
    ctx.fillRect(x, cy - bh / 2, bw, 2);
    ctx.fillRect(x, cy + bh / 2 - 2, bw, 2);
    if (opts.active) {
      const py = cy - (state.peaks[i] ?? 0) * maxH * 0.5;
      ctx.fillStyle = rgba(CHANNELS[(i + 2) % CHANNELS.length]?.rgb ?? color, 0.9);
      ctx.fillRect(x, py, bw, 2);
    }
  }
}

function drawDisc(
  ctx: CanvasRenderingContext2D,
  state: DrawState,
  w: number,
  h: number,
  ready: boolean,
  opts: PaintOpts,
  orbit: boolean,
): void {
  const lead = channel(opts.theme);
  const cx = w / 2;
  const cy = h * 0.42;
  const radius = orbit ? Math.min(w * 0.16, h * 0.18) : Math.min(w * 0.24, h * 0.26);
  const bass = state.bass;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.beginPath();
  ctx.moveTo(cx - 78, h);
  ctx.lineTo(cx + 78, h);
  ctx.lineTo(cx + radius * 0.28, cy);
  ctx.lineTo(cx - radius * 0.28, cy);
  ctx.closePath();
  ctx.fillStyle = rgba(lead.rgb, 0.05 + bass * 0.1);
  ctx.fill();
  ctx.restore();

  const footY = cy + radius + 18;
  ctx.beginPath();
  ctx.ellipse(cx, footY, radius * 1.05, Math.max(8, radius * 0.16), 0, 0, TAU);
  ctx.strokeStyle = rgba(lead.rgb, 0.7);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, footY, radius * 0.62, Math.max(5, radius * 0.09), 0, 0, TAU);
  ctx.strokeStyle = rgba(CHANNELS[3]?.rgb ?? lead.rgb, 0.45);
  ctx.stroke();

  if (!orbit) {
    const inner = radius * 1.08;
    const outer = inner + Math.min(w, h) * 0.11;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.rotation);
    ctx.lineCap = "round";
    const thick = Math.max(2, (TAU * inner) / Math.max(1, state.count) * 0.42);
    ctx.lineWidth = thick;
    for (let i = 0; i < state.count; i++) {
      const level = Math.min(1, state.levels[i] ?? 0);
      const ang = -Math.PI / 2 + (i / state.count) * TAU;
      const len = inner + 3 + level * (outer - inner);
      const color = CHANNELS[i % CHANNELS.length]?.rgb ?? lead.rgb;
      ctx.strokeStyle = rgba(color, 0.35 + level * 0.65);
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
      ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    const n = state.wave.length;
    const rings: { base: number; amp: number; color: RGB; width: number }[] = [
      { base: radius * 1.15, amp: radius * 0.1, color: CHANNELS[0]?.rgb ?? lead.rgb, width: 2.25 },
      { base: radius * 1.38, amp: radius * 0.12, color: CHANNELS[1]?.rgb ?? lead.rgb, width: 2 },
      { base: radius * 1.62, amp: radius * 0.08, color: CHANNELS[2]?.rgb ?? lead.rgb, width: 1.75 },
    ];
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const ring of rings) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const sample = state.wave[i % n] ?? 0;
        const ang = state.rotation - Math.PI / 2 + (i / n) * TAU;
        const r = ring.base + sample * ring.amp * (opts.active ? 1 : 0.65);
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(ring.color, 0.85);
      ctx.lineWidth = ring.width;
      ctx.stroke();
    }
    ctx.restore();

    const tickCount = Math.min(state.count, 64);
    for (let i = 0; i < tickCount; i++) {
      const level = Math.min(1, state.levels[i] ?? 0);
      const ang = -Math.PI / 2 + (i / tickCount) * TAU + state.rotation;
      const inner = radius * 1.78;
      const len = 5 + level * 16;
      ctx.strokeStyle = rgba(CHANNELS[3]?.rgb ?? lead.rgb, 0.35 + level * 0.65);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
      ctx.lineTo(cx + Math.cos(ang) * (inner + len), cy + Math.sin(ang) * (inner + len));
      ctx.stroke();
    }
  }

  const discR = radius * (0.98 + bass * 0.03);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, discR, 0, TAU);
  ctx.clip();
  if (ready) {
    ctx.globalAlpha = 0.96 * flickerAlpha(opts);
    ctx.drawImage(state.holo, 0, 0, w, h);
  } else {
    const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, discR);
    fill.addColorStop(0, rgba(lead.rgb, 0.45));
    fill.addColorStop(1, rgba(lead.rgb, 0.05));
    ctx.fillStyle = fill;
    ctx.fillRect(cx - discR, cy - discR, discR * 2, discR * 2);
  }
  if (!opts.reduced) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(opts.time * 0.7);
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(lead.rgb, 0.75);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(discR, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, discR, 0, TAU);
  ctx.strokeStyle = rgba(lead.rgb, 0.95);
  ctx.lineWidth = 1.75;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, discR + 6, 0, TAU);
  ctx.strokeStyle = rgba(CHANNELS[(CHANNELS.findIndex((item) => item.id === opts.theme) + 2) % CHANNELS.length]?.rgb ?? lead.rgb, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function glitch(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  opts: PaintOpts,
  bass: number,
): void {
  if (opts.reduced || !opts.active || bass < 0.55) return;
  if (Math.sin(opts.time * 3.1) < 0.62) return;
  const bands = bass > 0.8 ? 2 : 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pw = Math.floor(w * dpr);
  for (let i = 0; i < bands; i++) {
    const y = Math.floor(((Math.sin(opts.time * 1.7 + i * 4.2) * 0.5 + 0.5) * (h - 24)) * dpr);
    const band = Math.max(2, Math.floor((5 + i * 6) * dpr));
    const shift = Math.floor(Math.sin(opts.time * 28 + i) * (8 + bass * 22) * dpr);
    ctx.drawImage(ctx.canvas, 0, y, pw, band, shift, y, pw, band);
  }
  ctx.restore();
}

function scanlines(ctx: CanvasRenderingContext2D, w: number, h: number, opts: PaintOpts): void {
  const offset = opts.reduced ? 0 : Math.floor(opts.time * 28) % 4;
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (let y = offset; y < h; y += 4) ctx.fillRect(0, y, w, 1);
}

function beam(ctx: CanvasRenderingContext2D, w: number, h: number, color: RGB, opts: PaintOpts): void {
  const y = opts.reduced ? h * 0.42 : (opts.time * 0.16) % 1 * h;
  const grad = ctx.createLinearGradient(0, y - 36, 0, y + 36);
  grad.addColorStop(0, rgba(color, 0));
  grad.addColorStop(0.5, rgba(color, 0.16));
  grad.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - 36, w, 72);
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number): void {
  const v = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, Math.max(w, h) * 0.72);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.2);
  top.addColorStop(0, "rgba(7,6,15,0.55)");
  top.addColorStop(1, "rgba(7,6,15,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.2);
  const bot = ctx.createLinearGradient(0, h * 0.62, 0, h);
  bot.addColorStop(0, "rgba(7,6,15,0)");
  bot.addColorStop(1, "rgba(7,6,15,0.8)");
  ctx.fillStyle = bot;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
}

function flickerAlpha(opts: PaintOpts): number {
  if (opts.reduced) return 1;
  const dip = Math.sin(opts.time * 2.3) > 0.94 ? 0.84 : 1;
  return dip * (0.94 + Math.sin(opts.time * 23) * 0.03);
}

function updateLevels(
  state: DrawState,
  analyser: AnalyserNode | null,
  opts: PaintOpts,
  count: number,
  live: boolean,
): void {
  if (state.count !== count) {
    const levels = new Float32Array(count);
    const peaks = new Float32Array(count);
    const copy = Math.min(count, state.levels.length);
    for (let i = 0; i < copy; i++) {
      levels[i] = state.levels[i] ?? 0;
      peaks[i] = state.peaks[i] ?? 0;
    }
    state.levels = levels;
    state.peaks = peaks;
    state.scratch = new Float32Array(count);
    state.count = count;
  }
  if (live && analyser) {
    if (state.freq.length !== analyser.frequencyBinCount) {
      state.freq = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(state.freq as Uint8Array<ArrayBuffer>);
    if (state.spec.length !== count) state.spec = new Float32Array(count);
    sampleLog(state.freq, state.spec, count, analyser.context.sampleRate);
    let bass = 0;
    const bassN = Math.min(4, count);
    for (let i = 0; i < count; i++) {
      const tilt = 1 + (i / count) * 0.7;
      const shaped = Math.min(1, shape(state.spec[i] ?? 0, opts.sensitivity) * tilt);
      state.spec[i] = shaped;
      if (i < bassN) bass += shaped;
    }
    for (let i = 0; i < count; i++) {
      const prev = state.spec[i === 0 ? 0 : i - 1] ?? 0;
      const next = state.spec[i === count - 1 ? count - 1 : i + 1] ?? 0;
      state.scratch[i] = (state.spec[i] ?? 0) * 0.62 + prev * 0.19 + next * 0.19;
    }
    state.bass = bass / bassN;
    for (let i = 0; i < count; i++) ease(state, i, state.scratch[i] ?? 0, opts.dt, true);
  } else {
    state.bass = opts.reduced ? 0.2 : 0.18 + Math.sin(opts.time * 0.8) * 0.08;
    for (let i = 0; i < count; i++) ease(state, i, idleLevel(i, count, opts.time, opts.reduced), opts.dt, false);
  }
}

function updateWave(state: DrawState, analyser: AnalyserNode | null, opts: PaintOpts, live: boolean): void {
  const n = state.wave.length;
  const k = 1 - Math.exp(-opts.dt * 10);
  if (live && analyser) {
    if (state.td.length !== analyser.fftSize) state.td = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(state.td as Uint8Array<ArrayBuffer>);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor((i / n) * state.td.length);
      const amp = ((state.td[idx] ?? 128) - 128) / 128;
      const target = Math.max(-1, Math.min(1, amp * opts.sensitivity));
      state.wave[i] = (state.wave[i] ?? 0) + (target - (state.wave[i] ?? 0)) * k;
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const target = opts.reduced ? 0.1 : Math.sin(opts.time * 1.25 + i * 0.08) * 0.2;
    state.wave[i] = (state.wave[i] ?? 0) + (target - (state.wave[i] ?? 0)) * k;
  }
}

function ease(state: DrawState, i: number, target: number, dt: number, holdPeaks: boolean): void {
  const cur = state.levels[i] ?? 0;
  const rate = target > cur ? 16 : 5.5;
  const next = cur + (target - cur) * (1 - Math.exp(-dt * rate));
  state.levels[i] = next;
  if (!holdPeaks) {
    state.peaks[i] = next;
    return;
  }
  const peak = state.peaks[i] ?? 0;
  state.peaks[i] = target >= peak ? target : Math.max(target, peak - dt * 0.4);
}

function sampleLog(freq: Uint8Array, out: Float32Array, count: number, sampleRate: number): void {
  const nyquist = sampleRate / 2;
  const bins = freq.length;
  const minHz = 36;
  const maxHz = Math.min(14000, nyquist * 0.92);
  for (let i = 0; i < count; i++) {
    const f0 = minHz * Math.pow(maxHz / minHz, i / count);
    const f1 = minHz * Math.pow(maxHz / minHz, (i + 1) / count);
    let a = Math.max(0, Math.floor((f0 / nyquist) * bins));
    let b = Math.min(bins, Math.max(a + 1, Math.ceil((f1 / nyquist) * bins)));
    let sum = 0;
    let max = 0;
    for (let j = a; j < b; j++) {
      const v = freq[j] ?? 0;
      sum += v;
      if (v > max) max = v;
    }
    out[i] = (sum / (b - a)) * 0.55 + max * 0.45;
  }
}

function shape(byte: number, sensitivity: number): number {
  let v = byte / 255;
  v = (v - 0.04) / 0.96;
  if (v < 0) v = 0;
  return Math.pow(v, 0.72) * sensitivity;
}

function idleLevel(i: number, count: number, time: number, reduced: boolean): number {
  const t = reduced ? 0.4 : time;
  const p = i / Math.max(1, count - 1);
  const a = 0.5 + 0.5 * Math.sin(t * 0.9 + p * 6.2);
  const arch = Math.sin(Math.PI * p);
  return 0.16 + 0.24 * a * (0.35 + 0.65 * arch);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  scale: number,
): void {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih) * scale;
  const dw = iw * s;
  const dh = ih * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function fit(canvas: HTMLCanvasElement, w: number, h: number): void {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
