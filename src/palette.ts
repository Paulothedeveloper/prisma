// Extração de paleta de cores de uma imagem (designer). Roda no FRONTEND via canvas,
// lendo a MINIATURA já carregada — não-destrutivo, não toca no arquivo original e não
// precisa de backend. Quantiza por blocos e devolve as N cores mais frequentes,
// ordenadas por luminância (claro → escuro) pra virar uma paleta utilizável.

export interface Swatch {
  hex: string;
  rgb: [number, number, number];
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Extrai até `count` cores dominantes de uma imagem (por URL convertida do Tauri).
 * Ignora pixels quase transparentes. Resolve com [] se a imagem não carregar.
 */
export function extractPalette(url: string, count = 6): Promise<Swatch[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const S = 64; // amostra pequena = rápido e suficiente
        const canvas = document.createElement("canvas");
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);

        // quantiza cada canal em passos de 24 → agrupa cores parecidas
        const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 125) continue; // ignora transparente
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
          const key = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(b / 24)}`;
          const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
          cur.n++;
          cur.r += r;
          cur.g += g;
          cur.b += b;
          buckets.set(key, cur);
        }
        const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count);
        const swatches: Swatch[] = sorted.map((c) => {
          const rgb: [number, number, number] = [
            Math.round(c.r / c.n),
            Math.round(c.g / c.n),
            Math.round(c.b / c.n),
          ];
          return { hex: toHex(rgb[0], rgb[1], rgb[2]), rgb };
        });
        swatches.sort((a, b) => luminance(b.rgb) - luminance(a.rgb));
        resolve(swatches);
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = url;
  });
}
