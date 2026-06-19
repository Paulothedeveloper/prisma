import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

// Player de áudio do PRISMA — feito do ZERO (sem o <audio controls> nativo).
function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ src, waveform, autoPlay = true }: { src: string; waveform?: string | null; autoPlay?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setCur(el.currentTime);
    const onDur = () => setDur(el.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.volume = vol;
      el.muted = muted;
    }
  }, [vol, muted]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    el.paused ? el.play() : el.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - r.left) / r.width) * dur;
  };
  const pct = dur > 0 ? (cur / dur) * 100 : 0;

  return (
    <div className="ap">
      <audio ref={ref} src={src} autoPlay={autoPlay} />
      {waveform && <img className="ap-wave" src={waveform} alt="" />}
      <div className="ap-controls">
        <button className="ap-btn ap-play" onClick={toggle} title="Reproduzir/Pausar">
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <span className="ap-time">{fmt(cur)}</span>
        <div className="ap-bar" onClick={seek}>
          <div className="ap-prog" style={{ width: `${pct}%` }}>
            <span className="ap-knob" />
          </div>
        </div>
        <span className="ap-time">{fmt(dur)}</span>
        <button className="ap-btn" onClick={() => setMuted((m) => !m)} title="Mudo">
          <Icon name={muted || vol === 0 ? "volumeOff" : "volume"} size={15} />
        </button>
        <input
          className="ap-vol"
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
      </div>
    </div>
  );
}
