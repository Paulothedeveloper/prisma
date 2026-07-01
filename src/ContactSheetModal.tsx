import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { saveContactSheet, type Asset } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

// Contact Sheet (plugin do Eagle) — nativo, renderizado via canvas no front (sem deps de fonte
// no Rust). Monta uma folha de contatos: grade de miniaturas + nomes, título opcional. Exporta
// PNG de alta resolução e cataloga. Não-destrutivo. Ótimo pra prova/aprovação de cliente.

const CELL_W = 460; // resolução de exportação por célula
const IMG_H = 320;
const LABEL_H = 34;
const GAP = 16;
const MARGIN = 26;

type Bg = "dark" | "light";

function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = url;
  });
}

export function ContactSheetModal({
  assets,
  onClose,
  onSaved,
}: {
  assets: Asset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, dismiss } = useDismiss(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgsRef = useRef<(HTMLImageElement | null)[]>([]);
  const [cols, setCols] = useState(3);
  const [bg, setBg] = useState<Bg>("dark");
  const [showNames, setShowNames] = useState(true);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  // carrega as miniaturas uma vez (usa thumbnail quando existe = rápido)
  useEffect(() => {
    let alive = true;
    Promise.all(
      assets.map((a) => loadImg(convertFileSrc(a.thumbnail_path || a.path))),
    ).then((imgs) => {
      if (!alive) return;
      imgsRef.current = imgs;
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const compose = () => {
    const c = canvasRef.current;
    if (!c) return;
    const n = assets.length;
    const rows = Math.ceil(n / cols);
    const cellH = IMG_H + (showNames ? LABEL_H : 0);
    const headerH = title.trim() ? 72 : 0;
    const w = MARGIN * 2 + cols * CELL_W + (cols - 1) * GAP;
    const h = MARGIN * 2 + headerH + rows * cellH + (rows - 1) * GAP;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    const dark = bg === "dark";
    ctx.fillStyle = dark ? "#0e0f13" : "#f4f5f7";
    ctx.fillRect(0, 0, w, h);

    const ink = dark ? "#e8e9ee" : "#1a1b20";
    const sub = dark ? "rgba(232,233,238,0.55)" : "rgba(26,27,32,0.55)";
    const cellBg = dark ? "#191a20" : "#ffffff";

    if (title.trim()) {
      ctx.fillStyle = ink;
      ctx.font = "700 34px Inter, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(title.trim(), MARGIN, MARGIN + 30);
      ctx.fillStyle = sub;
      ctx.font = "500 18px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${n} itens`, w - MARGIN, MARGIN + 30);
    }

    for (let k = 0; k < n; k++) {
      const col = k % cols;
      const row = Math.floor(k / cols);
      const x = MARGIN + col * (CELL_W + GAP);
      const y = MARGIN + headerH + row * (cellH + GAP);

      // fundo da célula da imagem
      ctx.fillStyle = cellBg;
      roundRect(ctx, x, y, CELL_W, IMG_H, 10);
      ctx.fill();

      const img = imgsRef.current[k];
      if (img && img.width > 0) {
        // contain
        const pad = 8;
        const bw = CELL_W - pad * 2;
        const bh = IMG_H - pad * 2;
        const scale = Math.min(bw / img.width, bh / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = x + (CELL_W - dw) / 2;
        const dy = y + (IMG_H - dh) / 2;
        ctx.save();
        roundRect(ctx, x, y, CELL_W, IMG_H, 10);
        ctx.clip();
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
      } else {
        ctx.fillStyle = sub;
        ctx.font = "600 16px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(assets[k].ext.toUpperCase(), x + CELL_W / 2, y + IMG_H / 2);
      }

      if (showNames) {
        ctx.fillStyle = sub;
        ctx.font = "500 17px Inter, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const name = assets[k].name || assets[k].filename;
        ctx.fillText(ellipsize(ctx, name, CELL_W), x + 2, y + IMG_H + LABEL_H / 2 + 2);
      }
    }
  };

  useEffect(() => {
    if (ready) compose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cols, bg, showNames, title]);

  const apply = async () => {
    setBusy(true);
    try {
      const c = canvasRef.current!;
      const blob = await new Promise<Blob | null>((r) => c.toBlob((b) => r(b), "image/png"));
      if (blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        await saveContactSheet(assets[0].path, Array.from(buf));
      }
      onSaved();
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`cs-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="layoutGrid" size={16} /> {t("cs.title")} ({assets.length})
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="cs-controls">
          <input
            className="cs-titleinput"
            placeholder={t("cs.titlePh")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="cs-cols">
            <span className="cs-lbl">{t("cs.cols")}</span>
            {[2, 3, 4, 5].map((n) => (
              <button key={n} className={`cs-col ${cols === n ? "on" : ""}`} onClick={() => setCols(n)}>
                {n}
              </button>
            ))}
          </div>
          <button className={`cs-toggle ${showNames ? "on" : ""}`} onClick={() => setShowNames((s) => !s)}>
            {t("cs.names")}
          </button>
          <div className="cs-bg">
            <button className={`cs-bgbtn dark ${bg === "dark" ? "on" : ""}`} onClick={() => setBg("dark")} title={t("cs.dark")} />
            <button className={`cs-bgbtn light ${bg === "light" ? "on" : ""}`} onClick={() => setBg("light")} title={t("cs.light")} />
          </div>
        </div>

        <div className="cs-stage">
          {!ready && <div className="cs-loading">{t("cs.loading")}</div>}
          <canvas ref={canvasRef} className="cs-canvas" style={{ opacity: ready ? 1 : 0 }} />
        </div>

        <div className="dup-foot">
          <button className="dup-cancel" onClick={dismiss} disabled={busy}>
            {t("wma.cancel")}
          </button>
          <button className="dup-apply" onClick={apply} disabled={busy || !ready}>
            {busy ? t("wma.working") : t("cs.export")}
          </button>
        </div>
      </div>
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsize(ctx: CanvasRenderingContext2D, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + "…";
}
