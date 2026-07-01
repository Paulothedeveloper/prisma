import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { saveCropped, type Asset } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

// Image Crop Master (plugin do Eagle) — nativo. Arraste o retângulo sobre a imagem e recorte;
// exporta em RESOLUÇÃO CHEIA (não a do preview) e cataloga a cópia. Não-destrutivo.
export function CropModal({
  asset,
  onClose,
  onSaved,
}: {
  asset: Asset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, dismiss } = useDismiss(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const url = convertFileSrc(asset.path);

  const redraw = (r: { x: number; y: number; w: number; h: number } | null) => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (r && Math.abs(r.w) > 2 && Math.abs(r.h) > 2) {
      const x = Math.min(r.x, r.x + r.w);
      const y = Math.min(r.y, r.y + r.h);
      const w = Math.abs(r.w);
      const h = Math.abs(r.h);
      // escurece fora do recorte
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, c.width, y);
      ctx.fillRect(0, y + h, c.width, c.height - (y + h));
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, c.width - (x + w), h);
      // borda do recorte
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
      ctx.setLineDash([]);
    }
  };

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      const scale = Math.min(1, 1400 / img.width);
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      redraw(null);
    };
    img.onerror = () => setLoadErr(true);
    img.src = url;
  }, [url]);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(c.width, ((e.clientX - r.left) * c.width) / r.width)),
      y: Math.max(0, Math.min(c.height, ((e.clientY - r.top) * c.height) / r.height)),
    };
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    startPt.current = pos(e);
    setRect({ ...startPt.current, w: 0, h: 0 });
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !startPt.current) return;
    const p = pos(e);
    const r = { x: startPt.current.x, y: startPt.current.y, w: p.x - startPt.current.x, h: p.y - startPt.current.y };
    setRect(r);
    redraw(r);
  };
  const up = () => (drawing.current = false);

  const crop = async () => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (loadErr || !c || !img || !rect || Math.abs(rect.w) < 3 || Math.abs(rect.h) < 3) return;
    setBusy(true);
    try {
      // mapeia o retângulo do preview → coordenadas da imagem ORIGINAL (resolução cheia)
      const sx = img.width / c.width;
      const sy = img.height / c.height;
      const x = Math.round(Math.min(rect.x, rect.x + rect.w) * sx);
      const y = Math.round(Math.min(rect.y, rect.y + rect.h) * sy);
      const w = Math.round(Math.abs(rect.w) * sx);
      const h = Math.round(Math.abs(rect.h) * sy);
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      out.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => out.toBlob((b) => res(b), "image/png"));
      if (!blob) throw new Error("toBlob falhou");
      const buf = new Uint8Array(await blob.arrayBuffer());
      await saveCropped(asset.path, Array.from(buf));
      onSaved();
      onClose();
    } catch {
      setLoadErr(true);
    } finally {
      setBusy(false);
    }
  };

  const dims = rect
    ? `${Math.round(Math.abs(rect.w) * ((imgRef.current?.width ?? 1) / (canvasRef.current?.width ?? 1)))} × ${Math.round(
        Math.abs(rect.h) * ((imgRef.current?.height ?? 1) / (canvasRef.current?.height ?? 1)),
      )}`
    : "";

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`mk-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="image" size={16} /> {t("crop.title")} {asset.name || asset.filename}
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="mk-tools">
          <span className="wm-hint">{t("crop.hint")}</span>
          {dims && <span className="crop-dims">{dims}px</span>}
        </div>
        <div className="mk-stage">
          <canvas
            ref={canvasRef}
            className="mk-canvas"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
        </div>
        <div className="dup-foot">
          <button className="dup-cancel" onClick={dismiss} disabled={busy}>
            {t("crop.cancel")}
          </button>
          <button
            className="dup-apply"
            onClick={crop}
            disabled={busy || !rect || Math.abs(rect.w) < 3}
          >
            {busy ? t("crop.working") : t("crop.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
