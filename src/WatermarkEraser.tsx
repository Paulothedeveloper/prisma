import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { inpaintWatermark, type Asset } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

// Remover marca d'água / AI Eraser (nativo): pinte por cima da marca e o app preenche com a
// vizinhança (inpainting por difusão, em Rust). Gera uma cópia limpa catalogada.
export function WatermarkEraser({
  asset,
  onClose,
  onSaved,
}: {
  asset: Asset;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, dismiss } = useDismiss(onClose);
  const dispRef = useRef<HTMLCanvasElement>(null); // imagem + marca vermelha (o que o usuário vê)
  const maskRef = useRef<HTMLCanvasElement>(null); // máscara branca sobre preto (o que vai pro backend)
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const [width, setWidth] = useState(22);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [painted, setPainted] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const url = convertFileSrc(asset.path);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const d = dispRef.current;
      const m = maskRef.current;
      if (!d || !m) return;
      const scale = Math.min(1, 1600 / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      d.width = w;
      d.height = h;
      m.width = w;
      m.height = h;
      d.getContext("2d")?.drawImage(img, 0, 0, w, h);
      const mc = m.getContext("2d")!;
      mc.fillStyle = "#000";
      mc.fillRect(0, 0, w, h); // máscara começa toda preta (nada a remover)
    };
    img.onerror = () => setLoadErr(true);
    img.src = url;
  }, [url]);

  const pos = (e: React.PointerEvent) => {
    const c = dispRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };
  const stroke = (p: { x: number; y: number }, moveTo: boolean) => {
    const dc = dispRef.current!.getContext("2d")!;
    const mc = maskRef.current!.getContext("2d")!;
    for (const ctx of [dc, mc]) {
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    dc.strokeStyle = "rgba(255,60,60,0.55)"; // o usuário vê a marca em vermelho translúcido
    mc.strokeStyle = "#fff"; // a máscara é branca (= remover)
    if (moveTo) {
      dc.beginPath();
      dc.moveTo(p.x, p.y);
      mc.beginPath();
      mc.moveTo(p.x, p.y);
    } else {
      dc.lineTo(p.x, p.y);
      dc.stroke();
      mc.lineTo(p.x, p.y);
      mc.stroke();
    }
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    stroke(pos(e), true);
    setPainted(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    stroke(pos(e), false);
  };
  const up = () => (drawing.current = false);

  const reset = () => {
    const img = imgRef.current;
    const d = dispRef.current;
    const m = maskRef.current;
    if (!img || !d || !m) return;
    d.getContext("2d")?.drawImage(img, 0, 0, d.width, d.height);
    const mc = m.getContext("2d")!;
    mc.fillStyle = "#000";
    mc.fillRect(0, 0, m.width, m.height);
    setPainted(false);
    setMsg(null);
  };

  const apply = async () => {
    if (loadErr || !maskRef.current || !painted) return;
    setBusy(true);
    setMsg(t("wm.working"));
    try {
      const blob = await new Promise<Blob | null>((res) =>
        maskRef.current!.toBlob((b) => res(b), "image/png"),
      );
      if (!blob) throw new Error("toBlob falhou");
      const buf = new Uint8Array(await blob.arrayBuffer());
      await inpaintWatermark(asset.id, Array.from(buf));
      onSaved();
      onClose();
    } catch (e) {
      setMsg(`${t("common.error")}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`mk-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="sparkles" size={16} /> {t("wm.title")} {asset.name || asset.filename}
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="mk-tools">
          <span className="wm-hint">{t("wm.hint")}</span>
          <span className="mk-sep" />
          <input
            className="mk-width"
            type="range"
            min={6}
            max={60}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span className="enc-adv-hint">{t("mk.thickness").replace("{width}", String(width))}</span>
          <button className="wm-reset" onClick={reset} disabled={!painted || busy}>
            <Icon name="refresh" size={13} /> {t("wm.reset")}
          </button>
        </div>
        <div className="mk-stage">
          <canvas
            ref={dispRef}
            className="mk-canvas"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
          <canvas ref={maskRef} style={{ display: "none" }} />
        </div>
        {msg && <div className="wm-msg">{msg}</div>}
        <div className="dup-foot">
          <button className="dup-cancel" onClick={dismiss} disabled={busy}>
            {t("wm.cancel")}
          </button>
          <button className="dup-apply" onClick={apply} disabled={busy || !painted}>
            {busy ? t("wm.working") : t("wm.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
