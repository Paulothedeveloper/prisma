// Preferências de aparência/comportamento que vivem só no front (localStorage).
// São aplicadas ao vivo via variáveis CSS / classes no <html> — nada de botão morto:
// tudo aqui muda o app na hora. Settings de backend (chave IA, auto-tag) ficam no settings.json.
import { setSfxEnabled } from "./sfx";

export interface Prefs {
  accent: string; // cor de destaque (hex)
  reduceGlass: boolean; // menos desfoque/transparência (melhor desempenho)
  hoverAutoplay: boolean; // vídeo/áudio tocam ao passar o mouse no card
  sfx: boolean; // efeitos sonoros discretos da interface (estilo Apple)
  quartzo: boolean; // mostra a seção "Quartzo (notas)" no inspetor (integração com o app de notas)
  previewVolume: number; // volume GLOBAL (0..1) — player de rodapé E preview no hover compartilham
}

export const ACCENTS = ["#0a84ff", "#30d158", "#ff375f", "#ff9f0a", "#bf5af2", "#64d2ff", "#ffd60a"];

const DEFAULTS: Prefs = {
  accent: "#0a84ff",
  reduceGlass: false,
  hoverAutoplay: true,
  sfx: true,
  quartzo: false, // desligado por padrão — só quem usa o app de notas Quartzo liga
  previewVolume: 1, // volume cheio por padrão
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
  // avisa quem lê preferência fora do React (ex.: o inspetor) pra atualizar na hora.
  window.dispatchEvent(new Event("prefs-changed"));
}

// hex (#rrggbb) → rgba(r,g,b,alpha) — pra derivar o --accent-soft a partir da cor escolhida.
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// hex → "r, g, b" (triplet) pra usar em rgba(var(--accent-rgb), α) no CSS.
function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

// Aplica as preferências no documento. Idempotente — chame no boot e a cada mudança.
export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  root.style.setProperty("--accent", p.accent);
  root.style.setProperty("--accent-soft", hexToRgba(p.accent, 0.18));
  // triplet do acento → brilhos/seleção/bordas seguem o tema (antes eram azul fixo)
  root.style.setProperty("--accent-rgb", hexToRgbTriplet(p.accent));
  root.classList.toggle("reduce-glass", p.reduceGlass);
  root.dataset.hoverAutoplay = p.hoverAutoplay ? "1" : "0";
  root.dataset.quartzo = p.quartzo ? "1" : "0";
  root.dataset.previewVolume = String(p.previewVolume);
  setSfxEnabled(p.sfx);
}

// Leitura rápida usada por componentes fora do React state (ex.: AssetCard no hover).
export function hoverAutoplayOn(): boolean {
  return document.documentElement.dataset.hoverAutoplay !== "0";
}
// Integração Quartzo ligada? (desligada por padrão)
export function quartzoOn(): boolean {
  return document.documentElement.dataset.quartzo === "1";
}

// Volume global (0..1) — lido pelo preview no hover e pelo player de rodapé.
export function previewVolume(): number {
  const v = parseFloat(document.documentElement.dataset.previewVolume ?? "1");
  return isNaN(v) ? 1 : Math.min(1, Math.max(0, v));
}
// Grava o volume global (persiste + dispara 'prefs-changed' pra todos sincronizarem na hora).
export function setPreviewVolume(v: number) {
  const clamped = Math.min(1, Math.max(0, v));
  document.documentElement.dataset.previewVolume = String(clamped);
  const p = loadPrefs();
  p.previewVolume = clamped;
  savePrefs(p);
}

// "Player de rodapé tocando agora?" — flag transitória (não persiste). Enquanto ligada, o
// preview do hover NÃO toca som, pra não virar bagunça de áudio (player + faixa do mouse juntos).
let PLAYER_ACTIVE = false;
export function setPlayerActive(on: boolean) {
  PLAYER_ACTIVE = on;
  document.documentElement.dataset.playerActive = on ? "1" : "0";
}
export function playerActive(): boolean {
  return PLAYER_ACTIVE;
}
