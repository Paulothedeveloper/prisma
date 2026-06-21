// Preferências de aparência/comportamento que vivem só no front (localStorage).
// São aplicadas ao vivo via variáveis CSS / classes no <html> — nada de botão morto:
// tudo aqui muda o app na hora. Settings de backend (chave IA, auto-tag) ficam no settings.json.
import { setSfxEnabled } from "./sfx";

export interface Prefs {
  accent: string; // cor de destaque (hex)
  reduceGlass: boolean; // menos desfoque/transparência (melhor desempenho)
  hoverAutoplay: boolean; // vídeo/áudio tocam ao passar o mouse no card
  sfx: boolean; // efeitos sonoros discretos da interface (estilo Apple)
}

export const ACCENTS = ["#0a84ff", "#30d158", "#ff375f", "#ff9f0a", "#bf5af2", "#64d2ff", "#ffd60a"];

const DEFAULTS: Prefs = {
  accent: "#0a84ff",
  reduceGlass: false,
  hoverAutoplay: true,
  sfx: true,
};

const KEY = "prisma.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* localStorage indisponível — usa padrão */
  }
  return { ...DEFAULTS };
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignora */
  }
  applyPrefs(p);
}

// hex (#rrggbb) → rgba(r,g,b,alpha) — pra derivar o --accent-soft a partir da cor escolhida.
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Aplica as preferências no documento. Idempotente — chame no boot e a cada mudança.
export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  root.style.setProperty("--accent", p.accent);
  root.style.setProperty("--accent-soft", hexToRgba(p.accent, 0.18));
  root.classList.toggle("reduce-glass", p.reduceGlass);
  root.dataset.hoverAutoplay = p.hoverAutoplay ? "1" : "0";
  setSfxEnabled(p.sfx);
}

// Leitura rápida usada por componentes fora do React state (ex.: AssetCard no hover).
export function hoverAutoplayOn(): boolean {
  return document.documentElement.dataset.hoverAutoplay !== "0";
}
