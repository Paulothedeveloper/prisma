import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { saveAnnotated, type Asset } from "./api";

// Markup/anotação (Briefing 4 #9): rabisca/marca em cima da imagem e salva uma cópia anotada.
const COLORS = ["#FF3B30", "#FFD60A", "#30D158", "#0A84FF", "#FFFFFF", "#000000"];

export function Markup({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState("#FF3B30");
  const [width, setWidth] = useState(5);
  const [busy, setBusy] = useState(false);
  const url = convertFileSrc(asset.path);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      const scale = Math.min(1, 1600 / img.width);
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      ctx?.drawImage(img, 0, 0, c.width, c.height);
    };
    img.src = url;
  }, [url]);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => (drawing.current = false);

  const save = async () => {
    setBusy(true);
    try {
      const blob: Blob = await new Promise((res) => canvasRef.current!.toBlob((b) => res(b!), "image/png"));
      const buf = new Uint8Array(await blob.arrayBuffer());
      await saveAnnotated(asset.path, Array.from(buf));
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dup-overlay" onClick={onClose}>
      <div className="mk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="pencil" size={16} /> Anotar — {asset.name || asset.filename}
          </div>
          <button className="dup-x" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="mk-tools">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`mk-color ${color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
          <span className="mk-sep" />
          <input className="mk-width" type="range" min={2} max={24} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
          <span className="enc-adv-hint">espessura {width}px</span>
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
          <button className="dup-cancel" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="dup-apply" onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar anotação"}</button>
        </div>
      </div>
    </div>
  );
}
