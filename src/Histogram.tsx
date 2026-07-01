import { useEffect, useRef } from "react";

// Histograma RGB (equivalente ao plugin "Histogram" do Eagle) — recurso nativo do PRISMA.
// Lê os pixels da miniatura (mesmo caminho do extractPalette) e desenha as 3 curvas de canal.
export function computeHistogram(
  url: string,
): Promise<{ r: number[]; g: number[]; b: number[] } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const W = 256;
        const H = Math.max(1, Math.min(256, Math.round((img.height / img.width) * 256)));
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);
        const r = new Array(256).fill(0);
        const g = new Array(256).fill(0);
        const b = new Array(256).fill(0);
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 8) continue; // ignora transparente
          r[data[i]]++;
          g[data[i + 1]]++;
          b[data[i + 2]]++;
        }
        resolve({ r, g, b });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function Histogram({ url }: { url: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    computeHistogram(url).then((h) => {
      if (!alive || !h || !ref.current) return;
      const cv = ref.current;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const W = cv.width;
      const Hh = cv.height;
      ctx.clearRect(0, 0, W, Hh);
      const max = Math.max(1, ...h.r, ...h.g, ...h.b);
      const draw = (arr: number[], color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, Hh);
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * W;
          const y = Hh - (arr[i] / max) * Hh;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, Hh);
        ctx.closePath();
        ctx.fill();
      };
      // mistura aditiva: sobreposição dos 3 canais vira branco (leitura fotográfica clássica)
      ctx.globalCompositeOperation = "lighter";
      draw(h.r, "rgba(255,50,50,0.75)");
      draw(h.g, "rgba(45,220,80,0.75)");
      draw(h.b, "rgba(60,120,255,0.75)");
      ctx.globalCompositeOperation = "source-over";
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return <canvas ref={ref} width={256} height={88} className="insp-histogram" />;
}
