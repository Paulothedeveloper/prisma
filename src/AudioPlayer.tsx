import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";
import { t } from "./i18n";
import { fetchLyrics, type LyricLine } from "./api";

// Player de áudio do PRISMA — feito do ZERO (sem o <audio controls> nativo).
function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Deriva (artista, título) do nome do arquivo: "Artista - Título.mp3" → ["Artista","Título"].
function parseArtistTitle(name: string): [string, string] {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/\s*\[[^\]]*\]\s*$/i, "");
  const m = base.split(/\s+-\s+/);
  if (m.length >= 2) return [m[0].trim(), m.slice(1).join(" - ").trim()];
  return ["", base.trim()];
}

export function AudioPlayer({
  src,
  waveform,
  autoPlay = true,
  title,
}: {
  src: string;
  waveform?: string | null;
  autoPlay?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [lyricState, setLyricState] = useState<"" | "loading" | "none">("");

  const [artist, songTitle] = useMemo(
    () => parseArtistTitle(title || ""),
    [title]
  );

  // Busca a letra sincronizada na 1ª vez que o painel é aberto (por faixa).
  useEffect(() => {
    setLyrics(null);
    setLyricState("");
  }, [src]);
  useEffect(() => {
    if (!showLyrics || lyrics || lyricState === "loading" || !title) return;
    setLyricState("loading");
    fetchLyrics(artist, songTitle)
      .then((ls) => {
        setLyrics(ls);
        setLyricState(ls.length ? "" : "none");
      })
      .catch(() => setLyricState("none"));
  }, [showLyrics, lyrics, lyricState, artist, songTitle, title]);

  // Linha ativa = última cuja marca de tempo já passou.
  const activeLine = useMemo(() => {
    if (!lyrics) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].t >= 0 && lyrics[i].t <= cur + 0.15) idx = i;
    }
    return idx;
  }, [lyrics, cur]);

  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLine]);

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
    <div className="ap" data-sfx-skip>
      <audio ref={ref} src={src} autoPlay={autoPlay} />
      {showLyrics ? (
        <div className="ap-lyrics">
          {lyricState === "loading" && <div className="ap-ly-msg">{t("player.loadingLyrics")}</div>}
          {lyricState === "none" && <div className="ap-ly-msg">{t("player.noLyrics")}</div>}
          {lyrics &&
            lyrics.map((l, i) => (
              <div
                key={i}
                ref={i === activeLine ? activeRef : undefined}
                className={`ap-ly-line${i === activeLine ? " on" : ""}${l.t < 0 ? " static" : ""}`}
                onClick={() => {
                  if (l.t >= 0 && ref.current) ref.current.currentTime = l.t;
                }}
              >
                {l.text || "♪"}
              </div>
            ))}
        </div>
      ) : (
        waveform && <img className="ap-wave" src={waveform} alt="" />
      )}
      <div className="ap-controls">
        <button className="ap-btn ap-play" onClick={toggle} title={t("player.playPause")}>
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <span className="ap-time">{fmt(cur)}</span>
        <div className="ap-bar" onClick={seek}>
          <div className="ap-prog" style={{ width: `${pct}%` }}>
            <span className="ap-knob" />
          </div>
        </div>
        <span className="ap-time">{fmt(dur)}</span>
        <button className="ap-btn" onClick={() => setMuted((m) => !m)} title={t("player.mute")}>
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
        {title && (
          <button
            className={`ap-btn ap-ly-toggle${showLyrics ? " on" : ""}`}
            onClick={() => setShowLyrics((s) => !s)}
            title={t("player.lyrics")}
          >
            <Icon name="document" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
