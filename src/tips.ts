// Sistema de dicas de primeira-vez (onboarding). Cada dica aparece UMA vez, ancorada
// na feature em questão, e fica marcada no localStorage. Layout-safe: o popover é
// portalizado e preso na viewport (mesmo padrão do menu de contexto).

export interface TipDef {
  title: string;
  text: string;
}

// Registro central das dicas (id → conteúdo). Em PT, curtinho e direto.
export const TIPS: Record<string, TipDef> = {
  search: {
    title: "Busca",
    text: "Procure por nome ou tag. Com a IA ligada, dá pra achar por conteúdo: 'praia', 'pessoa', 'céu'.",
  },
  sidebar: {
    title: "Atalhos e pastas",
    text: "Atalhos inteligentes (Reels, 4K, Preto & Branco…) e as pastas que você indexou. Clique pra filtrar.",
  },
  folders: {
    title: "Suas pastas",
    text: "Botão direito numa pasta abre as opções: renomear, cor, re-scan, abrir no Explorer e mais.",
  },
  inspector: {
    title: "Painel de Detalhes",
    text: "Specs, tags, cor e a recomendação de CST do clipe pro DaVinci. Tudo sobre o arquivo selecionado.",
  },
  oficina: {
    title: "Oficina",
    text: "Converte, gera proxy e estabiliza (MotionSilk). Sempre em arquivo NOVO — nunca toca no original.",
  },
  settings: {
    title: "Configurações",
    text: "Cor do app, IA, proxies, importação, e manutenção (recarregar proxies / app / redefinir).",
  },
  preview: {
    title: "Pré-visualização",
    text: "Passe o mouse pra tocar. Duplo-clique abre em tela cheia com player próprio (scrub, velocidade, loop).",
  },
};

const KEY = "prisma.tips.seen";
const DISABLED_KEY = "prisma.tips.disabled";

function seenSet(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function tipsDisabled(): boolean {
  return localStorage.getItem(DISABLED_KEY) === "1";
}
export function disableTips() {
  try {
    localStorage.setItem(DISABLED_KEY, "1");
  } catch {
    /* ignora */
  }
}
export function tipSeen(id: string): boolean {
  return tipsDisabled() || seenSet().has(id);
}
export function markTipSeen(id: string) {
  const s = seenSet();
  s.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* ignora */
  }
}
// "Ver tutorial de novo" — limpa o que foi visto e reabilita as dicas.
export function resetTips() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(DISABLED_KEY);
    localStorage.removeItem("prisma.welcomed");
  } catch {
    /* ignora */
  }
}
export function isFirstLaunch(): boolean {
  return localStorage.getItem("prisma.welcomed") !== "1";
}
export function markWelcomed() {
  try {
    localStorage.setItem("prisma.welcomed", "1");
  } catch {
    /* ignora */
  }
}

// Barramento simples: componentes chamam fireTip(id, elemento) na 1ª vez que a feature
// aparece; o App escuta e mostra o popover ancorado.
type TipListener = (id: string, rect: DOMRect) => void;
let listener: TipListener | null = null;
export function onTip(fn: TipListener | null) {
  listener = fn;
}
export function fireTip(id: string, el: HTMLElement | null) {
  if (!el || tipSeen(id) || !listener) return;
  listener(id, el.getBoundingClientRect());
}
