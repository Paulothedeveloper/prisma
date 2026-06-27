import { memo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Icon, type IconName } from "./Icons";
import type { Asset } from "./api";
import { hoverAutoplayOn, previewVolume, playerActive } from "./prefs";
import { t } from "./i18n";

let FALLBACK = "";
import { dragIcon } from "./api";
dragIcon().then((p) => (FALLBACK = p)).catch(() => {});

function fmtDur(d: number | null) {
  if (!d || d <= 0) return "";
  const m = Math.floor(d / 60);
  const s = Math.floor(d % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtSize(b: number) {
  if (b >= 1 << 30) return `${(b / (1 << 30)).toFixed(1)} GB`;
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

// Linha da visão LISTA (compara specs rápido — colunas).
function AssetRowImpl({
  asset,
  selected,
  onClick,
  onPreview,
  onContext,
  onToggleFav,
  animDelayMs,
}: {
  asset: Asset;
  selected: boolean;
  onClick: (a: Asset, e: React.MouseEvent) => void;
  onPreview: (a: Asset) => void;
  onContext?: (a: Asset, e: React.MouseEvent) => void;
  onToggleFav?: (a: Asset) => void;
  animDelayMs?: number;
}) {
  const thumb = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;
  const name = asset.name || asset.filename;
  const [hover, setHover] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const onDragStart = (e: React.DragEvent) => {
    e.preventDefault();
    startDrag({ item: [asset.path], icon: asset.thumbnail_path || FALLBACK || asset.path, mode: "copy" }).catch(() => {});
  };
  // Reproduz ao passar o mouse TAMBÉM na visão de lista (antes só a grade tocava).
  const origUrl = convertFileSrc(asset.path);
  const hoverSrc = asset.proxy_path ? convertFileSrc(asset.proxy_path) : origUrl;
  const liveSrc = asset.live_motion ? convertFileSrc(asset.live_motion) : null;
  const playHover = hover && hoverAutoplayOn();
  // Áudio do hover só toca se o player de rodapé NÃO estiver tocando (evita bagunça de som).
  const playHoverAudio = playHover && !playerActive();
  const isVideo = asset.type === "video";
  const isGif = asset.type === "gif";
  const isAudio = asset.type === "audio";
  const isLive = !!asset.live_motion && asset.type === "image";
  return (
    <div
      className={`lrow ${selected ? "selected" : ""}`}
      style={animDelayMs ? { animationDelay: `${animDelayMs}ms` } : undefined}
      draggable
      onDragStart={onDragStart}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => onClick(asset, e)}
      onDoubleClick={() => onPreview(asset)}
      onContextMenu={(e) => {
        if (onContext) {
          e.preventDefault();
          onContext(asset, e);
        }
      }}
      title={name}
    >
      <div className="lrow-thumb">
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name={(asset.type as IconName) ?? "unknown"} size={18} />}
        {(isVideo || isLive) && playHover && (
          <video
            src={isLive && liveSrc ? liveSrc : hoverSrc}
            muted
            autoPlay
            loop
            playsInline
            className="lrow-hovervid"
            onLoadedData={(e) => e.currentTarget.play().catch(() => {})}
          />
        )}
        {isGif && hover && <img src={origUrl} className="lrow-hovervid" alt="" />}
        {isAudio && playHoverAudio && (
          <audio
            ref={audioRef}
            src={origUrl}
            autoPlay
            onLoadedData={() => {
              if (audioRef.current) {
                audioRef.current.volume = previewVolume();
                audioRef.current.play().catch(() => {});
              }
            }}
          />
        )}
        {isAudio && playHover && <span className="lrow-audioind"><Icon name="audio" size={14} /></span>}
      </div>
      {onToggleFav && (
        <button
          className={`lrow-fav ${asset.favorite ? "on" : ""}`}
          title={asset.favorite ? t("card.unfavorite") : t("card.favorite")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav(asset);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Icon name={asset.favorite ? "starFill" : "star"} size={14} />
        </button>
      )}
      <div className="lrow-name">{name}</div>
      <div className="lrow-col lrow-type">{asset.type}</div>
      <div className="lrow-col lrow-res">{asset.width && asset.height ? `${asset.width}×${asset.height}` : "—"}</div>
      <div className="lrow-col lrow-dur">{fmtDur(asset.duration) || "—"}</div>
      <div className="lrow-col lrow-size">{fmtSize(asset.size)}</div>
      <div className="lrow-col lrow-rating">
        {asset.rating > 0 ? Array.from({ length: asset.rating }).map((_, i) => <Icon key={i} name="starFill" size={10} />) : ""}
      </div>
    </div>
  );
}

export const AssetRow = memo(AssetRowImpl);
