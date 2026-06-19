import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

// Player de vídeo do PRISMA — feito do ZERO (sem os controles nativos).
// Pensado pra editor: scrub, tempo, frame-step, velocidade, volume, loop, tela cheia, atalhos.
function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export function VideoPlayer({ src, fps = 30, aspect }: { src: string; fps?: number; aspect?: string }) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showSpeed, setShowSpeed] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const v = () => vidRef.current;

  const toggle = useCallback(() => {
    const el = v();
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const el = v();
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, t));
  }, []);

  const step = useCallback((frames: number) => {
    const el = v();
    if (!el) return;
    el.pause();
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + frames / fps));
  }, [fps]);

  const setSpeedFn = useCallback((s: number) => {
    const el = v();
    if (el) el.playbackRate = s;
    setSpeed(s);
    setShowSpeed(false);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const w = wrapRef.current;
    if (!w) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else w.requestFullscreen?.();
  }, []);

  // sincroniza estado com o elemento
  useEffect(() => {
    const el = v();
    if (!el) return;
    const onTime = () => setCur(el.currentTime);
    const onDur = () => setDur(el.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onProg = () => {
      try {
        if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
      } catch {
        /* noop */
      }
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("progress", onProg);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("progress", onProg);
    };
  }, [src]);

  // atalhos de editor (space, J/K/L, frame-step, F, M, L)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const el = v();
      if (!el) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          toggle();
          break;
        case "j":
          setSpeedFn(Math.max(0.25, speed > 1 ? 1 : speed / 2));
          el.play();
          break;
        case "l":
          if (e.shiftKey) setLoop((x) => !x);
          else {
            setSpeedFn(speed < 1 ? 1 : Math.min(2, speed * 1.5));
            el.play();
          }
          break;
        case ".":
          e.preventDefault();
          step(1);
          break;
        case ",":
          e.preventDefault();
          step(-1);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          setMuted((x) => !x);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step, toggleFullscreen, setSpeedFn, speed]);

  // aplica volume/mute/loop/velocidade no elemento
  useEffect(() => {
    const el = v();
    if (!el) return;
    el.volume = vol;
    el.muted = muted;
    el.loop = loop;
    el.playbackRate = speed;
  }, [vol, muted, loop, speed]);

  const wakeUi = useCallback(() => {
    setUiVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!vidRef.current?.paused) setUiVisible(false);
    }, 2200);
  }, []);

  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const bufPct = dur > 0 ? (buffered / dur) * 100 : 0;

  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = (e.clientX - rect.left) / rect.width;
    seek(p * dur);
  };

  return (
    <div
      ref={wrapRef}
      className={`vp ${uiVisible || !playing ? "vp-ui" : ""}`}
      style={aspect ? { aspectRatio: aspect } : undefined}
      onMouseMove={wakeUi}
      onMouseLeave={() => playing && setUiVisible(false)}
    >
      <video
        ref={vidRef}
        src={src}
        className="vp-video"
        autoPlay
        playsInline
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
      />

      {!playing && (
        <button className="vp-bigplay" onClick={toggle} aria-label="Reproduzir">
          <Icon name="play" size={34} />
        </button>
      )}

      <div className="vp-controls" onClick={(e) => e.stopPropagation()}>
        <div className="vp-bar" onClick={onScrub}>
          <div className="vp-buf" style={{ width: `${bufPct}%` }} />
          <div className="vp-prog" style={{ width: `${pct}%` }}>
            <span className="vp-knob" />
          </div>
        </div>
        <div className="vp-row">
          <button className="vp-btn" onClick={toggle} title="Reproduzir/Pausar (espaço)">
            <Icon name={playing ? "pause" : "play"} size={16} />
          </button>
          <button className="vp-btn" onClick={() => step(-1)} title="Frame anterior (,)">
            <Icon name="frameBack" size={16} />
          </button>
          <button className="vp-btn" onClick={() => step(1)} title="Próximo frame (.)">
            <Icon name="frameFwd" size={16} />
          </button>
          <span className="vp-time">
            {fmt(cur)} <span className="vp-time-sep">/</span> {fmt(dur)}
          </span>

          <div className="vp-spacer" />

          <button
            className={`vp-btn ${loop ? "on" : ""}`}
            onClick={() => setLoop((x) => !x)}
            title="Loop (Shift+L)"
          >
            <Icon name="loop" size={16} />
          </button>

          <div className="vp-speed">
            <button className="vp-btn vp-speed-btn" onClick={() => setShowSpeed((s) => !s)} title="Velocidade">
              {speed}×
            </button>
            {showSpeed && (
              <div className="vp-speed-menu">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`vp-speed-item ${s === speed ? "on" : ""}`}
                    onClick={() => setSpeedFn(s)}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="vp-btn" onClick={() => setMuted((x) => !x)} title="Mudo (M)">
            <Icon name={muted || vol === 0 ? "volumeOff" : "volume"} size={16} />
          </button>
          <input
            className="vp-vol"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : vol}
            onChange={(e) => {
              setVol(Number(e.target.value));
              setMuted(false);
            }}
          />
          <button className="vp-btn" onClick={toggleFullscreen} title="Tela cheia (F)">
            <Icon name="fullscreen" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
