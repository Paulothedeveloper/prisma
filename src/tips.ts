// Sistema de dicas de primeira-vez (onboarding). Cada dica aparece UMA vez, ancorada
// na feature em questão, e fica marcada no localStorage. Layout-safe: o popover é
// portalizado e preso na viewport (mesmo padrão do menu de contexto).

import { t } from "./i18n";

export interface TipDef {
  title: string;
  text: string;
}

// Registro central das dicas (id → conteúdo). Os textos vêm do dicionário i18n
// (tip.<id>.title / .text), traduzidos PT/EN/ES. t() resolve no idioma atual.
export const TIPS: Record<string, TipDef> = {
  search: { title: t("tip.search.title"), text: t("tip.search.text") },
  sidebar: { title: t("tip.sidebar.title"), text: t("tip.sidebar.text") },
  folders: { title: t("tip.folders.title"), text: t("tip.folders.text") },
  inspector: { title: t("tip.inspector.title"), text: t("tip.inspector.text") },
  oficina: { title: t("tip.oficina.title"), text: t("tip.oficina.text") },
  settings: { title: t("tip.settings.title"), text: t("tip.settings.text") },
  preview: { title: t("tip.preview.title"), text: t("tip.preview.text") },
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
