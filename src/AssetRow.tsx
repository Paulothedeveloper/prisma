import { convertFileSrc } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Icon, type IconName } from "./Icons";
import type { Asset } from "./api";

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
export function AssetRow({
  asset,
  selected,
  onClick,
  onPreview,
  onContext,
  animDelayMs,
}: {
  asset: Asset;
  selected: boolean;
  onClick: (a: Asset, e: React.MouseEvent) => void;
  onPreview: (a: Asset) => void;
  onContext?: (a: Asset, e: React.MouseEvent) => void;
  animDelayMs?: number;
}) {
  const thumb = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;
  const name = asset.name || asset.filename;
  const onDragStart = (e: React.DragEvent) => {
    e.preventDefault();
    startDrag({ item: [asset.path], icon: asset.thumbnail_path || FALLBACK || asset.path, mode: "copy" }).catch(() => {});
  };
  return (
    <div
      className={`lrow ${selected ? "selected" : ""}`}
      style={animDelayMs ? { animationDelay: `${animDelayMs}ms` } : undefined}
      draggable
      onDragStart={onDragStart}
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
      </div>
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
