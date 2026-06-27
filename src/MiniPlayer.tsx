import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import type { Asset } from "./api";
import { t } from "./i18n";

// Player de rodapé estilo playlist: toca o áudio/vídeo atual e permite avançar/voltar pela
// lista (ótimo pra bibliotecas grandes de música/SFX — ouvir um atrás do outro sem abrir cada um).
function fmt(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function MiniPlayer({
  asset,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onDetails,
}: {
  asset: Asset;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDetails: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(true);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  // toca o proxy se houver (vídeo de codec pro); senão o original.
  const src = asset.proxy_path ? convertFileSrc(asset.proxy_path) : convertFileSrc(asset.path);
  const thumb = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;

  // Ao trocar de faixa, recomeça do zero e toca.
  useEffect(() => {
    setCur(0);
    const el = ref.current;
    if (el) el.play().then(() => setPlaying(true)).catch(() => {});
  }, [asset.id]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      el.pause();
      setPlaying(false);
    }
  };
  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = ref.current;
    if (!el || !dur) return;
    el.currentTime = (Number(e.target.value) / 1000) * dur;
  };
  // aplica volume/mute ao elemento sempre que mudam (e ao trocar de faixa).
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.volume = vol;
      el.muted = muted;
    }
  }, [vol, muted, asset.id]);
  const onVol = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value) / 100;
    setVol(v);
    setMuted(v === 0);
    // aplica NA HORA no elemento (não só via effect) — mais confiável.
    const el = ref.current;
    if (el) {
      el.volume = v;
      el.muted = v === 0;
    }
  };

  return (
    <div className="miniplayer">
      <audio
        ref={ref}
        src={src}
        autoPlay
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDur(e.currentTarget.duration || 0);
          // reaplica o volume/mute na faixa nova (o elemento reseta pra 1 ao trocar de src).
          e.currentTarget.volume = vol;
          e.currentTarget.muted = muted;
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      {thumb ? (
        <img className="mp-thumb" src={thumb} alt="" />
      ) : (
        <span className="mp-thumb mp-noimg"><Icon name="audio" size={16} /></span>
      )}
      <div className="mp-info">
        <div className="mp-name">{asset.name || asset.filename}</div>
        <div className="mp-type">{asset.type}</div>
      </div>
      <div className="mp-controls">
        <button className="mp-btn" disabled={!hasPrev} onClick={onPrev} title={t("mp.prev")}>
          <Icon name="frameBack" size={16} />
        </button>
        <button className="mp-btn mp-play" onClick={toggle} title={playing ? t("mp.pause") : t("mp.play")}>
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <button className="mp-btn" disabled={!hasNext} onClick={onNext} title={t("mp.next")}>
          <Icon name="frameFwd" size={16} />
        </button>
      </div>
      <span className="mp-time">{fmt(cur)}</span>
      <input
        className="mp-seek"
        type="range"
        min={0}
        max={1000}
        value={dur ? Math.round((cur / dur) * 1000) : 0}
        onChange={onSeek}
      />
      <span className="mp-time">{fmt(dur)}</span>
      <div className="mp-vol">
        <button
          className="mp-btn"
          onClick={() => setMuted((m) => !m)}
          title={muted || vol === 0 ? t("mp.unmute") : t("mp.mute")}
        >
          <Icon name={muted || vol === 0 ? "volumeOff" : "volume"} size={16} />
        </button>
        <input
          className="mp-volslider"
          type="range"
          min={0}
          max={100}
          value={muted ? 0 : Math.round(vol * 100)}
          onChange={onVol}
          title={t("mp.volume")}
        />
      </div>
      <button className="mp-btn" onClick={onDetails} title={t("mp.details")}>
        <Icon name="fullscreen" size={16} />
      </button>
      <button className="mp-btn" onClick={onClose} title={t("common.close")}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
