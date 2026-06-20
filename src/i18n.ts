// i18n simples e robusto. O locale fica no localStorage; trocar idioma recarrega o app
// (todas as telas re-renderizam no novo idioma — sem estado/contexto frágil).
// Fase 1: traduz a INTERFACE principal (config, barra lateral, busca, boas-vindas).
// Fase 2 (pendente): textos técnicos dos cards (CST/diagnóstico/plano).

export type Locale = "pt" | "en" | "es";
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "pt", label: "Português" },
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

const KEY = "prisma.locale";

export function getLocale(): Locale {
  const l = (localStorage.getItem(KEY) || "").toLowerCase();
  return l === "en" || l === "es" ? (l as Locale) : "pt";
}
export function setLocale(l: Locale) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignora */
  }
  window.location.reload();
}

type Dict = Record<string, string>;

const PT: Dict = {
  "settings.title": "Configurações",
  "tab.general": "Geral",
  "tab.playback": "Reprodução",
  "tab.import": "Importação",
  "tab.ai": "IA e busca",
  "tab.sync": "Sincronização",
  "tab.about": "Sobre",
  "settings.language": "Idioma",
  "settings.languageHelp": "Troca o idioma da interface. O app recarrega ao trocar.",
  "side.smartShortcuts": "Atalhos inteligentes",
  "side.health": "Saúde da biblioteca",
  "side.smartFolders": "Pastas inteligentes",
  "side.collections": "Coleções",
  "side.folders": "Pastas",
  "side.tags": "Tags",
  "side.colors": "Cores",
  "side.kinds": "Tipos",
  "toolbar.search": "Buscar",
  "welcome.title": "Bem-vindo ao PRISMA",
  "welcome.sub": "Sua biblioteca de mídia, feita pra quem edita vídeo.",
  "welcome.p1": "Adicione uma pasta — o PRISMA indexa no lugar, sem mover nem alterar seus arquivos.",
  "welcome.p2": "Passe o mouse pra pré-visualizar. Duplo-clique abre em tela cheia.",
  "welcome.p3": "Leitor CST, Oficina e IA te ajudam a preparar o material — tudo opcional e não destrutivo.",
  "welcome.hint": "Dicas vão aparecer conforme você usa cada recurso.",
  "welcome.start": "Começar",
  "common.cancel": "Cancelar",
};

const EN: Dict = {
  "settings.title": "Settings",
  "tab.general": "General",
  "tab.playback": "Playback",
  "tab.import": "Import",
  "tab.ai": "AI & search",
  "tab.sync": "Sync",
  "tab.about": "About",
  "settings.language": "Language",
  "settings.languageHelp": "Changes the interface language. The app reloads when you switch.",
  "side.smartShortcuts": "Smart shortcuts",
  "side.health": "Library health",
  "side.smartFolders": "Smart folders",
  "side.collections": "Collections",
  "side.folders": "Folders",
  "side.tags": "Tags",
  "side.colors": "Colors",
  "side.kinds": "Types",
  "toolbar.search": "Search",
  "welcome.title": "Welcome to PRISMA",
  "welcome.sub": "Your media library, built for video editors.",
  "welcome.p1": "Add a folder — PRISMA indexes it in place, never moving or altering your files.",
  "welcome.p2": "Hover to preview. Double-click opens fullscreen.",
  "welcome.p3": "CST reader, Workshop and AI help you prep footage — all optional and non-destructive.",
  "welcome.hint": "Tips will pop up as you use each feature.",
  "welcome.start": "Get started",
  "common.cancel": "Cancel",
};

const ES: Dict = {
  "settings.title": "Configuración",
  "tab.general": "General",
  "tab.playback": "Reproducción",
  "tab.import": "Importación",
  "tab.ai": "IA y búsqueda",
  "tab.sync": "Sincronización",
  "tab.about": "Acerca de",
  "settings.language": "Idioma",
  "settings.languageHelp": "Cambia el idioma de la interfaz. La app se recarga al cambiar.",
  "side.smartShortcuts": "Atajos inteligentes",
  "side.health": "Salud de la biblioteca",
  "side.smartFolders": "Carpetas inteligentes",
  "side.collections": "Colecciones",
  "side.folders": "Carpetas",
  "side.tags": "Etiquetas",
  "side.colors": "Colores",
  "side.kinds": "Tipos",
  "toolbar.search": "Buscar",
  "welcome.title": "Bienvenido a PRISMA",
  "welcome.sub": "Tu biblioteca de medios, hecha para editores de vídeo.",
  "welcome.p1": "Agrega una carpeta — PRISMA la indexa en su lugar, sin mover ni alterar tus archivos.",
  "welcome.p2": "Pasa el ratón para previsualizar. Doble clic abre en pantalla completa.",
  "welcome.p3": "Lector CST, Taller e IA te ayudan a preparar el material — todo opcional y no destructivo.",
  "welcome.hint": "Los consejos aparecerán a medida que uses cada función.",
  "welcome.start": "Empezar",
  "common.cancel": "Cancelar",
};

const DICTS: Record<Locale, Dict> = { pt: PT, en: EN, es: ES };
const CURRENT = getLocale();

/// Traduz a chave no idioma atual (cai pra PT e depois pra própria chave).
export function t(key: string): string {
  return DICTS[CURRENT][key] ?? PT[key] ?? key;
}
