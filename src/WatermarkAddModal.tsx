import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { saveWatermarked, videoWatermark, type Asset } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

// Batch Watermark (plugin do Eagle) — nativo. Adiciona marca d'água de TEXTO (posição, opacidade,
// tamanho, cor) e aplica em TODAS as imagens selecionadas. Não-destrutivo (gera cópias).
type Pos = "tl" | "tr" | "bl" | "br" | "center" | "tiled";

function draw(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  s: { text: string; pos: Pos; opacity: number; size: number; color: string },
) {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  if (!s.text.trim()) return;
  const fs = Math.max(10, Math.round((s.size / 100) * Math.min(w, h) * 0.12));
  ctx.font = `700 ${fs}px Inter, sans-serif`;
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.opacity;
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = fs * 0.12;
  const pad = fs * 0.7;
  const tw = ctx.measureText(s.text).width;
  if (s.pos === "tiled") {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((-30 * Math.PI) / 180);
    ctx.textAlign = "center";
    const stepX = tw + fs * 3;
    const stepY = fs * 3.2;
    for (let y = -h; y < h; y += stepY) {
      for (let x = -w; x < w; x += stepX) {
        ctx.fillText(s.text, x, y);
      }
    }
    ctx.restore();
  } else {
    let x = pad;
    let y = pad + fs / 2;
    ctx.textAlign = "left";
    if (s.pos === "tr" || s.pos === "br") {
      ctx.textAlign = "right";
      x = w - pad;
    }
    if (s.pos === "center") {
      ctx.textAlign = "center";
      x = w / 2;
      y = h / 2;
    }
    if (s.pos === "bl" || s.pos === "br") y = h - pad - fs / 2;
    ctx.fillText(s.text, x, y);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

export function WatermarkAddModal({
  assets,
  onClose,
  onSaved,
}: {
  assets: Asset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, dismiss } = useDismiss(onClose);
  const first = assets[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [text, setText] = useState("© " + (first?.name || "PRISMA"));
  const [pos, setPos] = useState<Pos>("br");
  const [opacity, setOpacity] = useState(0.6);
  const [size, setSize] = useState(50);
  const [color, setColor] = useState("#ffffff");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);

  const isVideo = first?.type === "video";
  const settings = { text, pos, opacity, size, color };

  useEffect(() => {
    // Vídeo: previsualiza sobre o thumbnail (não temos frame full-res barato).
    const src = isVideo
      ? first.thumbnail_path
        ? convertFileSrc(first.thumbnail_path)
        : ""
      : convertFileSrc(first.path);
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      const scale = Math.min(1, 1200 / img.width);
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      draw(c.getContext("2d")!, img, c.width, c.height, settings);
    };
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first.path]);

  useEffect(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (c && img) draw(c.getContext("2d")!, img, c.width, c.height, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, pos, opacity, size, color]);

  const loadImg = (url: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });

  const apply = async () => {
    setBusy(true);
    setProg({ done: 0, total: assets.length });
    // Vídeo: queima o texto via ffmpeg no backend (drawtext). Não usa canvas.
    if (isVideo) {
      try {
        for (let k = 0; k < assets.length; k++) {
          await videoWatermark(assets[k].id, text, pos, opacity, size, color);
          setProg({ done: k + 1, total: assets.length });
        }
        onSaved();
        onClose();
      } catch {
        setBusy(false);
      }
      return;
    }
    try {
      for (let k = 0; k < assets.length; k++) {
        const a = assets[k];
        const img = k === 0 && imgRef.current ? imgRef.current : await loadImg(convertFileSrc(a.path));
        const out = document.createElement("canvas");
        out.width = img.naturalWidth || img.width;
        out.height = img.naturalHeight || img.height;
        draw(out.getContext("2d")!, img, out.width, out.height, settings);
        const blob = await new Promise<Blob | null>((r) => out.toBlob((b) => r(b), "image/png"));
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          await saveWatermarked(a.path, Array.from(buf));
        }
        setProg({ done: k + 1, total: assets.length });
      }
      onSaved();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const POSES: [Pos, string][] = [
    ["tl", "↖"],
    ["tr", "↗"],
    ["center", "▢"],
    ["bl", "↙"],
    ["br", "↘"],
    ["tiled", "▦"],
  ];

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`mk-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="sparkles" size={16} /> {t("wma.title")}
            {assets.length > 1 ? ` (${assets.length})` : ""}
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="wma-controls">
          <input
            className="wma-text"
            placeholder={t("wma.textPh")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="wma-poses">
            {POSES.map(([p, ic]) => (
              <button
                key={p}
                className={`wma-pos ${pos === p ? "on" : ""}`}
                title={p}
                onClick={() => setPos(p)}
              >
                {ic}
              </button>
            ))}
          </div>
          <button
            className="wma-color"
            style={{ background: color }}
            title={t("wma.color")}
            onClick={() => setColor(color === "#ffffff" ? "#000000" : "#ffffff")}
          />
        </div>
        <div className="wma-sliders">
          <label>
            {t("wma.opacity")}
            <input type="range" min={10} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
          </label>
          <label>
            {t("wma.size")}
            <input type="range" min={20} max={100} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>
        </div>

        <div className="mk-stage">
          <canvas ref={canvasRef} className="mk-canvas" style={{ cursor: "default" }} />
        </div>

        <div className="dup-foot">
          {prog && <span className="wma-prog">{prog.done}/{prog.total}</span>}
          <button className="dup-cancel" onClick={dismiss} disabled={busy}>
            {t("wma.cancel")}
          </button>
          <button className="dup-apply" onClick={apply} disabled={busy || !text.trim()}>
            {busy ? t("wma.working") : assets.length > 1 ? `${t("wma.apply")} (${assets.length})` : t("wma.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
