import { memo, useRef, useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Icon, type IconName } from "./Icons";
import { dragIcon, type Asset } from "./api";
import { hoverAutoplayOn } from "./prefs";
import { isOffline } from "./offline";
import { t } from "./i18n";

// Caminho do ícone de fallback de arrasto, carregado uma vez.
let FALLBACK_ICON = "";
dragIcon().then((p) => (FALLBACK_ICON = p)).catch(() => {});

// Badges de saúde por flag → cor + chave i18n do rótulo (tooltip). Cada condição tem sua cor.
const HFLAG: Record<string, { c: string; k: string }> = {
  noaudio: { c: "#ff9f0a", k: "health.noaudio.label" },
  vfr: { c: "#ff453a", k: "health.vfr.label" },
  cfr: { c: "#ff453a", k: "health.vfr.label" },
  mono: { c: "#0a84ff", k: "health.mono.label" },
  "8bitlog": { c: "#bf5af2", k: "health.8bitlog.label" },
  banding: { c: "#ffd60a", k: "health.banding.label" },
  bt2020notrc: { c: "#ff453a", k: "health.bt2020notrc.label" },
  rotated: { c: "#64d2ff", k: "health.rotated.label" },
  samplerate: { c: "#5e5ce6", k: "health.samplerate.label" },
  proxy: { c: "#30d158", k: "health.proxy.label" },
};

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
  // Atraso (ms) da animação de entrada em cascata na troca de view.
  animDelayMs?: number;
}

// Índice de origem do arrasto de reordenação (módulo: só um arrasto por vez).
let dragFrom: number | null = null;

// memo: numa biblioteca de 27k, sem isto QUALQUER re-render do App (seleção, progresso de
// indexação, etc.) re-renderizava TODOS os cards visíveis. Com props estáveis (callbacks via
// useCallback no App), só o card que mudou re-renderiza. Grande ganho de fluidez.
function AssetCardImpl({ asset, selected, onClick, onPreview, onContext, reorder, aspect, animDelayMs }: Props) {
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
  // Live Photo (iPhone): imagem com .mov irmão — "vive" ao passar o mouse, como o Eagle.
  const isLive = !!asset.live_motion && asset.type === "image";
  const liveSrc = asset.live_motion ? convertFileSrc(asset.live_motion) : null;
  // Respeita a preferência "Tocar ao passar o mouse" (Configurações › Reprodução).
  const playHover = hover && hoverAutoplayOn();

  return (
    <div
      className={`card ${selected ? "selected" : ""}`}
      style={animDelayMs ? { animationDelay: `${animDelayMs}ms` } : undefined}
      draggable
      onDragStart={onDragStart}
      onDragOver={reorder ? (e) => e.preventDefault() : undefined}
      onDrop={reorder ? onCardDrop : undefined}
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
      title={displayName}
    >
      <div className={`thumb thumb-${asset.type}`} style={aspect ? { aspectRatio: aspect } : undefined}>
        {reorder && (
          <span
            className="card-grip"
            data-grip="1"
            draggable
            onDragStart={onGripDragStart}
            title={t("card.dragReorder")}
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

        {/* hover: vídeo toca fluido (auto-play em loop, como o Eagle); mover o mouse faz scrub */}
        {isVideo && playHover && (
          <video
            ref={videoRef}
            src={hoverSrc}
            muted
            autoPlay
            loop
            preload="auto"
            playsInline
            className={`media media-over ${vidReady ? "show" : ""}`}
            onLoadedData={() => {
              setVidReady(true);
              videoRef.current?.play().catch(() => {});
            }}
            onError={() => setVidReady(false)}
          />
        )}
        {isLive && playHover && liveSrc && (
          <video
            ref={videoRef}
            src={liveSrc}
            muted
            autoPlay
            loop
            preload="auto"
            playsInline
            className={`media media-over ${vidReady ? "show" : ""}`}
            onLoadedData={() => {
              setVidReady(true);
              videoRef.current?.play().catch(() => {});
            }}
            onError={() => setVidReady(false)}
          />
        )}
        {isGif && hover && <img src={origUrl} className="media media-over show" alt="" />}
        {isAudio && playHover && (
          <audio
            src={origUrl}
            autoPlay
            className="hidden-audio"
            ref={(el) => {
              if (el) el.play().catch(() => {});
            }}
          />
        )}
        {isAudio && playHover && <span className="audio-hover-ind"><Icon name="audio" size={20} /></span>}

        {/* Badges de canto (superior-esquerdo): um dot por condição (sem áudio, VFR, mono, 8-bit…).
            Cada cor identifica o caso; tooltip explica. Computado no import, então vale pra pasta. */}
        {asset.health_flags ? (
          <span className="hflags">
            {asset.health_flags
              .split(",")
              .filter((f) => HFLAG[f])
              .slice(0, 4)
              .map((f) => (
                <span key={f} className="hflag-dot" style={{ background: HFLAG[f].c }} title={t(HFLAG[f].k)} />
              ))}
          </span>
        ) : (
          (asset.health_level === "red" || asset.health_level === "yellow") && (
            <span className={`health-mark hm-${asset.health_level}`} title={t("card.needsAttention")} />
          )
        )}
        {asset.seq_frames ? (
          <span className="badge badge-seq" title={`${asset.seq_frames} frames`}>
            SEQ · {asset.seq_frames}
          </span>
        ) : null}
        {isLive && (
          <span className="badge badge-live" title={t("card.livePhoto")}>
            LIVE
          </span>
        )}
        {isOffline(asset.path) && (
          <span className="badge badge-offline" title={t("card.offline")}>
            OFFLINE
          </span>
        )}
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

export const AssetCard = memo(AssetCardImpl);
