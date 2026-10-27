import { useEffect, useRef, useState } from "react";
import { AudioLines, Disc, Maximize2, Mic, Minimize2, Orbit, Pause, Play, Upload, Waves } from "lucide-react";
import { AudioEngine, type EngineSnapshot } from "@/lib/visualizer/audio-engine";
import { createDrawState, paint, syncCanvas } from "@/lib/visualizer/draw";
import {
  CHANNELS,
  MODES,
  PLATES,
  type PlateId,
  type ThemeId,
  type VizMode,
} from "@/lib/visualizer/theme";

const IDLE: EngineSnapshot = { source: "none", fileName: "", playing: false, current: 0, duration: 0 };

const THEME_KEY = "bass-snatcher-theme";
const MODE_KEY = "bass-snatcher-mode";
const PLATE_KEY = "bass-snatcher-plate";
const SENS_KEY = "bass-snatcher-sensitivity";

const MODE_ICON = { bars: AudioLines, disc: Disc, orbit: Orbit } as const;

export function BassSnatcher() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const live = useRef({ mode: "bars" as VizMode, theme: "pink" as ThemeId, sensitivity: 1.4, plate: "woods" as PlateId });

  const [snap, setSnap] = useState<EngineSnapshot>(IDLE);
  const [mode, setMode] = useState<VizMode>("bars");
  const [theme, setTheme] = useState<ThemeId>("pink");
  const [plate, setPlate] = useState<PlateId>("woods");
  const [sensitivity, setSensitivity] = useState(1.4);
  const [error, setError] = useState("");
  const [full, setFull] = useState(false);
  const [hot, setHot] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  live.current = { mode, theme, sensitivity, plate };

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(MODE_KEY);
      const storedTheme = localStorage.getItem(THEME_KEY);
      const storedPlate = localStorage.getItem(PLATE_KEY);
      const storedSens = Number(localStorage.getItem(SENS_KEY));
      if (storedMode === "bars" || storedMode === "disc" || storedMode === "orbit") setMode(storedMode);
      if (storedTheme === "pink" || storedTheme === "purple" || storedTheme === "blue" || storedTheme === "green") {
        setTheme(storedTheme);
      }
      if (PLATES.some((item) => item.id === storedPlate)) setPlate(storedPlate as PlateId);
      if (Number.isFinite(storedSens)) setSensitivity(Math.min(2.5, Math.max(0.5, storedSens)));
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    let alive = true;
    const engine = new AudioEngine(audio, (next) => {
      if (alive) setSnap(next);
    });
    engineRef.current = engine;
    const drawState = createDrawState();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const images: Partial<Record<PlateId, HTMLImageElement>> = {};
    for (const item of PLATES) {
      const img = new Image();
      img.decoding = "async";
      img.src = item.src;
      images[item.id] = img;
    }
    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const fit = syncCanvas(canvas, ctx);
      if (fit) {
        const view = live.current;
        const img = images[view.plate];
        const ready = img && img.complete && img.naturalWidth > 0 ? img : null;
        paint(ctx, fit.w, fit.h, fit.dpr, engine.analyser, ready, drawState, {
          mode: view.mode,
          theme: view.theme,
          sensitivity: view.sensitivity,
          active: engine.playing,
          time: now / 1000,
          dt,
          reduced,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onChange = (): void => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!snap.playing) {
      setHot(true);
      return;
    }
    let shown = true;
    let timer = window.setTimeout(() => {
      shown = false;
      setHot(false);
    }, 2600);
    const poke = (): void => {
      if (!shown) {
        shown = true;
        setHot(true);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        shown = false;
        setHot(false);
      }, 2600);
    };
    window.addEventListener("pointermove", poke);
    window.addEventListener("pointerdown", poke);
    window.addEventListener("keydown", poke);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", poke);
      window.removeEventListener("pointerdown", poke);
      window.removeEventListener("keydown", poke);
    };
  }, [snap.playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "BUTTON" || tag === "TEXTAREA") return;
      if (event.key === " ") {
        event.preventDefault();
        void onPlay();
      } else if (event.key === "f" || event.key === "F") {
        void toggleFull();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const plateMeta = PLATES.find((item) => item.id === plate) ?? PLATES[0];
  const shown = hot || !snap.playing;

  async function onMic(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    setError("");
    if (snap.source === "mic") {
      engine.releaseMic();
      return;
    }
    try {
      await engine.useMic();
    } catch (err) {
      setError(micMessage(err));
    }
  }

  async function onFile(file: File): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    setError("");
    if (!isAudioFile(file)) {
      setError("Drop an audio file.");
      return;
    }
    try {
      await engine.useFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that track.");
    }
  }

  async function onDemo(): Promise<void> {
    const engine = engineRef.current;
    if (!engine) return;
    setError("");
    try {
      if (snap.source === "demo") await engine.togglePlayback();
      else await engine.useDemo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo couldn't start.");
    }
  }

  async function onPlay(): Promise<void> {
    const engine = engineRef.current;
    if (!engine || snap.source === "mic") return;
    setError("");
    try {
      await engine.togglePlayback();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Playback failed.");
    }
  }

  async function toggleFull(): Promise<void> {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      setError("Fullscreen isn't available here.");
    }
  }

  function chooseMode(next: VizMode): void {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function choosePlate(next: PlateId): void {
    setPlate(next);
    try {
      localStorage.setItem(PLATE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function chooseSens(next: number): void {
    setSensitivity(next);
    try {
      localStorage.setItem(SENS_KEY, String(next));
    } catch {
      /* ignore */
    }
  }

  const status = error || statusLine(snap, plateMeta.label);

  return (
    <div
      ref={stageRef}
      className="relative h-dvh w-full select-none overflow-hidden bg-bg text-fg"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void onFile(file);
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-hidden="true" />
      <audio ref={audioRef} loop playsInline preload="auto" className="pointer-events-none absolute size-0 opacity-0" />

      <header
        className={`vesper-fade pointer-events-none absolute inset-x-0 top-0 z-10 p-4 transition-opacity duration-300 sm:p-6 ${shown ? "opacity-100" : "opacity-0"}`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`size-2 rounded-full ${snap.playing ? "vesper-live bg-accent" : "bg-muted"}`}
            aria-hidden="true"
          />
          <h1 className="font-display text-2xl leading-none tracking-tight sm:text-3xl">Bass Snatcher</h1>
        </div>
        <p role="status" className={`mt-2 max-w-xs text-sm text-pretty ${error ? "text-accent" : "text-muted"}`}>
          {status}
        </p>
      </header>

      {dragOver ? (
        <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-bg/70">
          <p className="font-display text-2xl">Drop a track</p>
        </div>
      ) : null}

      <div
        className={`vesper-dock vesper-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pt-3 transition duration-300 sm:px-5 ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
      >
        <div className={`vesper-panel mx-auto w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-surface/80 p-3 backdrop-blur-md ${shown ? "pointer-events-auto" : "pointer-events-none"}`}>
          {snap.source === "file" && snap.duration > 0 ? (
            <div className="mb-2 flex items-center gap-3 px-1">
              <span className="w-10 text-xs tabular-nums text-muted">{formatTime(snap.current)}</span>
              <input
                className="vesper-range"
                type="range"
                aria-label="Track position"
                min={0}
                max={snap.duration}
                step={0.01}
                value={Math.min(snap.current, snap.duration)}
                onChange={(event) => engineRef.current?.seek(Number(event.target.value))}
              />
              <span className="w-10 text-right text-xs tabular-nums text-muted">{formatTime(snap.duration)}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-full bg-bg/70 p-1">
              <button type="button" className={chip(snap.source === "mic")} aria-pressed={snap.source === "mic"} onClick={() => void onMic()}>
                <Mic className="size-4" aria-hidden="true" />
                Mic
              </button>
              <button type="button" className={chip(snap.source === "file")} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" aria-hidden="true" />
                Track
              </button>
              <button type="button" className={chip(snap.source === "demo" && snap.playing)} aria-pressed={snap.source === "demo"} onClick={() => void onDemo()}>
                <Waves className="size-4" aria-hidden="true" />
                Demo
              </button>
            </div>
            <button
              type="button"
              className={chip(!snap.playing && snap.source !== "mic")}
              disabled={snap.source === "mic"}
              aria-label={snap.playing ? "Pause" : "Play"}
              title="Play or pause (Space)"
              onClick={() => void onPlay()}
            >
              {snap.playing && snap.source !== "mic" ? (
                <Pause className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              {snap.playing && snap.source !== "mic" ? "Pause" : "Play"}
            </button>
            <div className="flex flex-wrap gap-1 rounded-full bg-bg/70 p-1">
              {MODES.map((item) => {
                const Icon = MODE_ICON[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={chip(mode === item.id)}
                    aria-pressed={mode === item.id}
                    onClick={() => chooseMode(item.id)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={`${chip(false)} ml-auto`}
              aria-label={full ? "Exit fullscreen" : "Fullscreen"}
              title="Fullscreen (F)"
              onClick={() => void toggleFull()}
            >
              {full ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Plate</span>
              {PLATES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.alt}
                  aria-pressed={plate === item.id}
                  onClick={() => choosePlate(item.id)}
                  className={`h-11 w-14 overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${plate === item.id ? "outline outline-2 outline-offset-2 outline-fg" : "opacity-70"}`}
                >
                  <img src={item.src} alt="" className="size-full object-cover" />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 p-1">
              <span className="text-xs text-muted">Tint</span>
              {CHANNELS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`${item.label} tint`}
                  aria-pressed={theme === item.id}
                  onClick={() => setTheme(item.id)}
                  className={`size-11 rounded-full ${item.swatch} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg ${theme === item.id ? "outline outline-2 outline-offset-2 outline-fg" : ""}`}
                />
              ))}
            </div>
          </div>

          <label className="mt-1 flex items-center gap-3 px-1">
            <span className="text-xs text-muted">Sensitivity</span>
            <input
              className="vesper-range"
              type="range"
              aria-label="Sensitivity"
              min={0.5}
              max={2.5}
              step={0.01}
              value={sensitivity}
              onChange={(event) => chooseSens(Number(event.target.value))}
            />
            <span className="w-10 text-right text-xs tabular-nums text-muted">{sensitivity.toFixed(2)}</span>
          </label>

          {!snap.playing ? (
            <p className="px-1 pt-1 text-xs text-muted">Drop a song anywhere, or press play for a demo.</p>
          ) : null}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.webm,.opus"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
    </div>
  );
}

function chip(on: boolean): string {
  return [
    "inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium whitespace-nowrap",
    "transition-colors duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:pointer-events-none disabled:opacity-40",
    on ? "bg-accent text-bg" : "text-muted hover:bg-fg/10 hover:text-fg",
  ].join(" ");
}

function statusLine(snap: EngineSnapshot, plateLabel: string): string {
  if (snap.source === "mic") return `${plateLabel} · microphone`;
  if (snap.source === "demo") return snap.playing ? `${plateLabel} · demo` : `${plateLabel} · demo paused`;
  if (snap.source === "file") {
    return snap.playing ? `${plateLabel} · ${snap.fileName}` : `${plateLabel} · ${snap.fileName} paused`;
  }
  return `${plateLabel} · mic, a track, or the demo`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|ogg|flac|m4a|aac|webm|opus)$/i.test(file.name);
}

function micMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "SecurityError") {
      return "Microphone blocked. Play a track or the demo instead.";
    }
    if (err.name === "NotFoundError") return "No microphone found.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "Couldn't open the microphone.";
}
