import { useRef, useState, useCallback, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Icon, type IconName } from "./Icons";
import { dragIcon, type Asset } from "./api";

// Caminho do ícone de fallback de arrasto, carregado uma vez.
let FALLBACK_ICON = "";
dragIcon().then((p) => (FALLBACK_ICON = p)).catch(() => {});

function fmtDuration(d: number | null): string | null {
  if (!d || d <= 0) return null;
  const m = Math.floor(d / 60);
  const s = Math.floor(d % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  asset: Asset;
  selected: boolean;
  onClick: (a: Asset, e: React.MouseEvent) => void;
  onPreview: (a: Asset) => void;
  onContext?: (a: Asset, e: React.MouseEvent) => void;
  // Reordenação manual dentro de uma coleção ("organização livre").
  reorder?: { index: number; onReorder: (from: number, to: number) => void };
  // Proporção real (waterfall/masonry) — sobrescreve o quadrado padrão.
  aspect?: string;
}

// Índice de origem do arrasto de reordenação (módulo: só um arrasto por vez).
let dragFrom: number | null = null;

export function AssetCard({ asset, selected, onClick, onPreview, onContext, reorder, aspect }: Props) {
  const [hover, setHover] = useState(false);
  const [vidReady, setVidReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!hover) setVidReady(false);
  }, [hover]);

  const displayName = asset.name || asset.filename;
  const thumbUrl = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;
  const origUrl = convertFileSrc(asset.path);
  // hover toca o original; se houver proxy (ProRes), toca o proxy
  const hoverSrc = asset.proxy_path ? convertFileSrc(asset.proxy_path) : origUrl;
  const dur = fmtDuration(asset.duration);

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const v = videoRef.current;
      if (!v || !vidReady || !asset.duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      v.currentTime = Math.max(0, Math.min(1, pct)) * asset.duration;
    },
    [asset.duration, vidReady]
  );

  const onDragStart = (e: React.DragEvent) => {
    // Se o arrasto começou no grip de reordenar, deixa o HTML5 DnD cuidar (não exporta pro SO).
    if ((e.target as HTMLElement)?.dataset?.grip) return;
    e.preventDefault();
    // mode "copy": referencia o original — o DaVinci/Premiere copia o caminho, nunca move o arquivo.
    const icon = asset.thumbnail_path || FALLBACK_ICON || asset.path;
    startDrag({ item: [asset.path], icon, mode: "copy" }).catch(() => {});
  };

  const onGripDragStart = (e: React.DragEvent) => {
    e.stopPropagation();
    if (reorder) dragFrom = reorder.index;
    e.dataTransfer.effectAllowed = "move";
  };
  const onCardDrop = (e: React.DragEvent) => {
    if (!reorder || dragFrom === null) return;
    e.preventDefault();
    if (dragFrom !== reorder.index) reorder.onReorder(dragFrom, reorder.index);
    dragFrom = null;
  };

  const isVideo = asset.type === "video";
  const isGif = asset.type === "gif";
  const isAudio = asset.type === "audio";

  return (
    <div
      className={`card ${selected ? "selected" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={reorder ? (e) => e.preventDefault() : undefined}
      onDrop={reorder ? onCardDrop : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={isVideo ? onMove : undefined}
      onClick={(e) => onClick(asset, e)}
      onDoubleClick={() => onPreview(asset)}
      onContextMenu={(e) => {
        if (onContext) {
          e.preventDefault();
          onContext(asset, e);
        }
      }}
      title={displayName}
    >
      <div className={`thumb thumb-${asset.type}`} style={aspect ? { aspectRatio: aspect } : undefined}>
        {reorder && (
          <span
            className="card-grip"
            data-grip="1"
            draggable
            onDragStart={onGripDragStart}
            title="Arraste para reordenar"
          >
            <Icon name="grip" size={14} />
          </span>
        )}
        {/* base: miniatura ou ícone (sempre presente — sem flash cinza) */}
        {thumbUrl ? (
          <img src={thumbUrl} className="media" alt="" loading="lazy" />
        ) : (
          <div className="icon-fallback">
            <Icon name={(asset.type as IconName) ?? "unknown"} size={34} />
            <span className="icon-ext">{asset.ext || "?"}</span>
          </div>
        )}

        {/* hover: vídeo (qualquer codec — só aparece quando REALMENTE carrega) */}
        {isVideo && hover && (
          <video
            ref={videoRef}
            src={hoverSrc}
            muted
            preload="metadata"
            playsInline
            className={`media media-over ${vidReady ? "show" : ""}`}
            onLoadedData={() => setVidReady(true)}
            onError={() => setVidReady(false)}
          />
        )}
        {isGif && hover && <img src={origUrl} className="media media-over show" alt="" />}
        {isAudio && hover && <audio src={origUrl} autoPlay className="hidden-audio" />}

        {dur && <span className="badge badge-dur">{dur}</span>}
        {asset.rating > 0 && (
          <span className="badge badge-rating">
            {Array.from({ length: asset.rating }).map((_, i) => (
              <Icon key={i} name="starFill" size={9} />
            ))}
          </span>
        )}
      </div>
      <div className="card-name">{displayName}</div>
    </div>
  );
}
