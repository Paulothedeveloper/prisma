import { useEffect, useRef, useState } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  aiStatus,
  setAiKey,
  setGeminiKey,
  setAiProvider,
  aiAnalyzeUntagged,
  aiPendingCount,
  reorganizeSfxAll,
  sfxPendingCount,
  exportCatalog,
  importCatalog,
  backupCatalog,
  restoreCatalog,
  cloudFolders,
  type CloudFolder,
  setAutotagImport,
  setAutoProxyImport,
  resetApp,
  regenProxies,
  vaultStatus,
  setVaultPath,
  reindexVault,
  scanHealth,
  exportVelvetCatalog,
  quartzoGetVault,
  quartzoSetVault,
} from "./api";
import { Icon, type IconName } from "./Icons";
import { loadPrefs, savePrefs, ACCENTS, type Prefs } from "./prefs";
import { fireTip, resetTips } from "./tips";
import { t, LOCALES, getLocale, setLocale } from "./i18n";

// Configurações em TÓPICOS (estilo Eagle, em português, design próprio do PRISMA).
// Regra: nada de botão morto — cada controle aqui muda algo de verdade.
type Tab = "geral" | "reproducao" | "importacao" | "ia" | "ecossistema" | "sync" | "sobre";

const TABS: { id: Tab; key: string; icon: IconName }[] = [
  { id: "geral", key: "tab.general", icon: "sliders" },
  { id: "reproducao", key: "tab.playback", icon: "play" },
  { id: "importacao", key: "tab.import", icon: "inbox" },
  { id: "ia", key: "tab.ai", icon: "search" },
  { id: "ecossistema", key: "tab.ecosystem", icon: "sparkles" },
  { id: "sync", key: "tab.sync", icon: "refresh" },
  { id: "sobre", key: "tab.about", icon: "stack" },
];

const APP_VERSION = "0.9.63";

// Novidades da versão atual — mostradas na aba "Sobre" (documentação in-app de cada release).
const WHATS_NEW: string[] = [
  "TROCA DE TELA agora é FLUIDA: mudar de aba/atalho na barra lateral OU trocar um filtro (resolução, duração, tom, ordenação, etc.) faz os cards entrarem em CASCATA animada — antes a grade só 'aparecia' de repente. Feito sem remontar a grade (nada de piscada), pela mesma cascata suave do resto. O texto digitado na busca fica de fora de propósito (não re-anima a cada tecla). E o menu 'Adicionar' teve os '...' removidos dos itens (Pastas, Da web, Arquivos, Baixar vídeo/áudio) — nada mais parecendo texto cortado.",
  "TEMAS corrigidos de vez: ao escolher uma cor de acento (verde, amber, roxo, etc.), a cor agora se aplica em TUDO — antes muitos brilhos, anéis de seleção, bordas e realces ficavam AZUIS fixos no meio do seu tema. Reajustei 41 pontos pra seguirem o acento via uma variável única (--accent-rgb). Provado trocando pra verde: item ativo, botão, anel de seleção do card, toggles — tudo verde, zero azul perdido. O espectro do prisma (ícone/gradientes multicoloridos) e as cores próprias das pastas continuam como são (de propósito).",
  "FLUIDEZ TOTAL (redesign passo 6 — abrir/fechar de TUDO + layout Eagle): (1) o layout agora é MASONRY por padrão — parede de miniaturas com alturas variadas, igual ao Eagle (era grade quadrada uniforme); (2) PASTA na barra lateral agora EXPANDE/COLAPSA animada (desdobra com slide+fade, o chevron gira suave) em vez de aparecer seca; (3) trocar de ABA nas Configurações faz um fade-up; (4) o menu 'Adicionar' abre animado; (5) TROCAR A COR de acento agora faz um CROSSFADE suave da interface inteira (View Transitions) em vez de piscar a cor nova. Tudo na mesma linguagem de movimento, mantendo a identidade liquid-glass.",
  "VISUAL PREMIUM (redesign passo 5 — agora dá pra VER): a base inteira mudou pra ficar à altura do Eagle. Fundo passou de cinza-quente (#1a1a1c) pra QUASE-PRETO levemente frio — os painéis de vidro flutuam e as miniaturas saltam (o grid vira o herói). Grid mais DENSO (miniatura menor + menos espaço = parede de imagens, não cards soltos). E as PASTAS na barra lateral agora têm ÍCONES COLORIDOS por padrão (assinatura do Eagle — cada pasta ganha uma cor estável, e você pode trocar). Não é mais o 'padrão' cinza: é escuro, denso e premium.",
  "TELA PRETA — causa-raiz encontrada e MORTA (testada de verdade). Não era a GPU (zero resets de driver nos logs) nem o código: era o WebView2 sendo MORTO por fora. Um 'taskkill /IM msedgewebview2' (de outra ferramenta/app no PC) mata TODOS os WebView2 do sistema de uma vez — não só os de um app. Agora o PRISMA tem um WATCHDOG que pinga a si mesmo a cada 2s e se auto-recupera em segundos nos DOIS casos: (a) render morto/janela preta → recria a tela na hora (sem reiniciar); (b) WebView2 morto por completo (ambiente envenenado, janela some) → reinicia o app sozinho, com ambiente novo e limpo. Provado matando os 6 processos de WebView2 do app e vendo ele voltar sozinho. Você não perde a biblioteca (é re-lida do banco).",
  "Caça ao texto cortado (redesign passo 4): no painel de Detalhes, o botão aparecia como \"Buscar semel…\" — uma abreviação com reticências que PARECIA corte. Agora é \"Buscar semelhantes\" por extenso (quebra em 2 linhas se precisar, nunca '...'). Auditei TODOS os textos do app: os '...' que sobraram são todos legítimos (abrem diálogo como \"Pastas…\", estados de progresso como \"Indexando…\", ou \"etc.\" em listas) — zero corte de texto real em qualquer idioma.",
  "Polimento PREMIUM (passo 3 do redesign): aberturas mais cinematográficas e consistentes. O visualizador (lightbox) agora SOBE e assenta ao abrir (curva enfática, sensação Eagle) em vez de só aparecer; o menu de contexto e as superfícies de vidro usam todas a mesma linguagem de movimento. Verificado no navegador: o zoom da miniatura no hover está exatamente em 1.06, lightbox e menu abrem fluidos, e zero texto cortado (nomes longos quebram em linhas, nunca '...').",
  "TELA BRANCA — agora estruturalmente IMPOSSÍVEL pela causa-raiz. O branco vinha do cache de shaders (GPUCache) do WebView2 corrompendo (force-kill, crash de driver de vídeo, desligamento sujo). Agora o app (1) manda o WebView2 NÃO gravar esse cache em disco — sem arquivo, não há o que corromper; e (2) ao abrir, apaga por garantia qualquer resíduo de cache de shader/código ANTES da tela subir. Seus dados (biblioteca, favoritos, configurações) não são tocados. Não depende mais de você minimizar/restaurar.",
  "Polimento PREMIUM (passo 2 do redesign — gesto-assinatura do Eagle): ao passar o mouse num card, a miniatura agora CRESCE suave por dentro (recortada pelas bordas arredondadas), com um leve escurecido no rodapé que dá leitura aos selos (duração, nota). Movimento de 60fps (só transform/opacity), com a mesma curva suave do resto. Respeita 'menos movimento' do sistema.",
  "Polimento PREMIUM (passo 1 do redesign): sistema de movimento unificado — antes havia 31 curvas de animação soltas; agora tudo usa as mesmas curvas suaves (estilo Linear/Vercel, sem 'bounce'). Resultado: toque mais fluido em tudo — botões e itens 'afundam' de leve ao clicar (feedback tátil), a sidebar desliza no hover, os cards 'sobem' com sombra, e o item selecionado ganhou profundidade de vidro (não é mais um azul chapado). Acessibilidade: respeita 'menos movimento' do sistema. Mais passos do redesign vêm a seguir, referência Eagle.",
  "TELA BRANCA ao restaurar de minimizado — agora com defesa robusta. Além do flag de oclusão (verificado no processo), o app agora VIGIA o minimizar→restaurar e, ao voltar: dá um micro-empurrão na janela pra forçar o WebView2 a repintar; e se ficou MUITO tempo minimizado (40s+), recarrega a tela automaticamente — isso SEMPRE limpa o branco (o catálogo é re-lido na hora; você não perde nada). Direcionado exatamente ao caso de ficar muito tempo minimizado.",
  "IA com Gemini ficou MUITO mais rápida: o modelo padrão passou de gemini-3.5-flash (um modelo \"pensador\", que levava 30-130s e estourava o tempo limite) para gemini-flash-lite-latest — classifica em ~2s e obedece o formato. Testado de verdade com a chave real (um riser sintético foi classificado certo como \"Riser\" em 1.9s).",
  "Correção importante: a indexação podia TRAVAR o app quando o ffmpeg empacava num arquivo problemático (corrompido/codec raro) ou num soluço do drive (USB/rede). Agora toda geração de miniatura tem TIMEOUT: se passar do limite, mata o processo e segue pro próximo — um arquivo ruim nunca mais congela a biblioteca inteira.",
  "Reorganizar SFX agora em LOTE: além de itens selecionados, dá pra reorganizar uma PASTA inteira (botão direito na pasta › \"Reorganizar SFX\") ou TODOS os áudios da biblioteca de uma vez (Configurações › IA e busca › \"Reorganizar todos\"). Não-destrutivo, com cache (pula os já feitos).",
  "Nova identidade visual: ícone e logo do PRISMA refeitos em VETOR — um prisma de vidro refratando a luz no espectro da marca, estética liquid-glass. Original (substitui a arte antiga), nítido de 16px a 1024px, com variante simplificada e de alto contraste para tamanhos pequenos (taskbar/tray do Windows). Atualizado em tudo: app, instalador, tiles, iOS/Android, favicon e README.",
  "Novo: escolha o provedor de IA — Claude (Anthropic) OU Gemini (Google). Em Configurações › IA e busca há um seletor Claude/Gemini; cole a chave do que preferir. A do Gemini é gratuita em aistudio.google.com/apikey e mais barata. Vale pra TUDO: busca por conteúdo, descrições, Plano de Color e Reorganizar SFX.",
  "Por que dois provedores: o Gemini Flash é mais barato e tem visão; o Claude Haiku é ótimo e estável. O fluxo é idêntico nos dois — a imagem (thumb/espectrograma) vai como visão. A chave fica só neste PC; nada é enviado sem você clicar.",
  "Reorganizar (SFX): selecione seus áudios de edição (whoosh, riser, impact, foley…) e a IA classifica cada um e organiza na biblioteca — tags + categoria + subtipo + nome padronizado sugerido + coleção \"Elementos de Edição organizados\". 100% não-destrutivo (não toca nos arquivos). Agora roda com Claude ou Gemini.",
  "Atalho: na paleta de comandos (Ctrl+K) há \"IA e busca (provedor, chave)\" — abre direto na aba pra trocar Claude/Gemini e colar a chave, sem garimpar menu.",
];

// Estimativa grosseira de custo da análise por IA (modelo Haiku, miniatura 512px + prompt
// curto ≈ US$ 0,001/imagem). É só pra dar noção antes de rodar — não é cobrança exata.
function aiCost(n: number): string {
  const usd = n * 0.001;
  if (usd < 0.01) return "< US$ 0,01";
  return "~ US$ " + usd.toFixed(2).replace(".", ",");
}

export function Settings({ onClose, initialTab }: { onClose: () => void; initialTab?: string }) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? "geral");
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => fireTip("settings", modalRef.current), 350);
    return () => clearTimeout(t);
  }, []);
  const [closing, setClosing] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  // Fecha com animação de saída (regra do app: tudo que abre/fecha anima).
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };

  // chave/IA
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("anthropic"); // provedor ativo: "anthropic" | "gemini"
  const [hasAnthropic, setHasAnthropic] = useState(false);
  const [hasGemini, setHasGemini] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [sfxPending, setSfxPending] = useState<number | null>(null); // áudios faltando reorganizar
  const [sfxMsg, setSfxMsg] = useState("");
  const [sfxBusy, setSfxBusy] = useState(false);
  const [confirmN, setConfirmN] = useState<number | null>(null); // lote aguardando confirmação de custo
  const [vault, setVault] = useState<{ path: string | null; count: number }>({ path: null, count: 0 });
  const [vaultMsg, setVaultMsg] = useState("");
  // ecossistema (VELVET + Quartzo)
  const [quartzoVault, setQuartzoVault] = useState<string | null>(null);
  const [ecoMsg, setEcoMsg] = useState("");
  const ecoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tab === "ecossistema") fireTip("ecosystem", ecoRef.current);
  }, [tab]);

  // importação / sync
  const [autotag, setAutotag] = useState(false);
  const [autoProxy, setAutoProxy] = useState(true);
  const [syncMsg, setSyncMsg] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const [clouds, setClouds] = useState<CloudFolder[]>([]);
  useEffect(() => {
    cloudFolders().then(setClouds).catch(() => {});
  }, []);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [proxyMsg, setProxyMsg] = useState("");
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState("");
  // atualização do software (botão manual; o popup automático no boot é o UpdateBanner)
  const [updBusy, setUpdBusy] = useState(false);
  const [updMsg, setUpdMsg] = useState("");

  // Procura atualização no GitHub sob demanda. Se houver, baixa + instala + reinicia;
  // senão, avisa que já está na última versão. (Mesmo motor do popup automático.)
  const checkUpdates = async () => {
    setUpdBusy(true);
    setUpdMsg(t("set.checking"));
    try {
      const u = await checkUpdate();
      if (!u) {
        setUpdMsg(t("set.upToDate"));
        setUpdBusy(false);
        return;
      }
      setUpdMsg(t("set.updateFound").replace("{v}", u.version));
      await u.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setUpdMsg(`${t("update.failed")}: ${String(e)}`);
      setUpdBusy(false);
    }
  };

  useEffect(() => {
    aiStatus()
      .then((s) => {
        setHasKey(s.has_key);
        setModel(s.model);
        setProvider(s.provider);
        setHasAnthropic(s.has_anthropic);
        setHasGemini(s.has_gemini);
        setAutotag(s.autotag_on_import);
        setAutoProxy(s.auto_proxy_on_import);
        if (s.has_key) {
          aiPendingCount().then(setPending).catch(() => {});
          sfxPendingCount().then(setSfxPending).catch(() => {});
        }
      })
      .catch(() => {}); // falha de backend não deixa a aba IA em estado default sem feedback

    vaultStatus().then(setVault).catch(() => {});
    quartzoGetVault().then(setQuartzoVault).catch(() => {});
  }, []);

  const pickQuartzo = async () => {
    const p = await openDialog({ directory: true });
    if (typeof p === "string") {
      try {
        await quartzoSetVault(p);
        setQuartzoVault(p);
        setEcoMsg(t("eco.quartzoSaved"));
      } catch (e) {
        setEcoMsg(`${t("common.error")}: ${String(e)}`);
      }
    }
  };
  const doExportVelvet = async () => {
    setEcoMsg(t("eco.exporting"));
    try {
      const path = await exportVelvetCatalog();
      setEcoMsg(t("eco.velvetDone").replace("{path}", path));
    } catch (e) {
      setEcoMsg(`${t("common.error")}: ${String(e)}`);
    }
  };

  const pickVault = async () => {
    const p = await openDialog({ directory: true });
    if (typeof p === "string") {
      setVaultMsg(t("set.indexing"));
      try {
        const n = await setVaultPath(p);
        setVault({ path: p, count: n });
        setVaultMsg(t("set.chunksIndexed").replace("{n}", n.toLocaleString("pt-BR")));
      } catch (e) {
        setVaultMsg(`${t("common.error")}: ${String(e)}`);
      }
    }
  };
  const doReindexVault = async () => {
    setVaultMsg(t("set.reindexing"));
    try {
      const n = await reindexVault();
      setVault((v) => ({ ...v, count: n }));
      setVaultMsg(t("set.chunksReindexed").replace("{n}", n.toLocaleString("pt-BR")));
    } catch (e) {
      setVaultMsg(`${t("common.error")}: ${String(e)}`);
    }
  };

  // Altera uma preferência local e aplica na hora (cor, vidro, zoom, autoplay).
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    // Troca de COR/vidro = crossfade suave da UI inteira (View Transitions API, premium,
    // suportada no WebView2/Chromium). Demais prefs aplicam direto. Fallback sem a API.
    const apply = () => savePrefs(next);
    const startVT = (document as unknown as {
      startViewTransition?: (cb: () => void) => void;
    }).startViewTransition;
    if ((k === "accent" || k === "reduceGlass") && typeof startVT === "function") {
      startVT.call(document, apply);
    } else {
      apply();
    }
  };

  const refreshAi = async () => {
    const s = await aiStatus();
    setHasKey(s.has_key);
    setModel(s.model);
    setProvider(s.provider);
    setHasAnthropic(s.has_anthropic);
    setHasGemini(s.has_gemini);
    if (s.has_key) {
      aiPendingCount().then(setPending).catch(() => {});
      sfxPendingCount().then(setSfxPending).catch(() => {});
    }
  };

  const runSfxAll = async () => {
    setSfxBusy(true);
    setSfxMsg("");
    try {
      const c = await reorganizeSfxAll(false);
      setSfxMsg(c > 0 ? `${t("set.sfxStarted")} (${c})` : t("set.sfxNone"));
    } catch (e) {
      setSfxMsg(`${t("common.error")}: ${String(e)}`);
    } finally {
      setSfxBusy(false);
    }
  };

  const saveKey = async () => {
    if (provider === "gemini") await setGeminiKey(key);
    else await setAiKey(key);
    await refreshAi();
    setKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const changeProvider = async (p: string) => {
    setProvider(p);
    setKey("");
    await setAiProvider(p);
    await refreshAi();
  };

  const runBulk = async (n: number) => {
    setAiBusy(true);
    setAiMsg("");
    try {
      const c = await aiAnalyzeUntagged(n);
      setAiMsg(c > 0 ? `${t("set.aiStarted")} (${c})` : t("set.aiNone"));
    } catch (e) {
      setAiMsg(`${t("common.error")}: ${String(e)}`);
    } finally {
      setAiBusy(false);
    }
  };

  const doExport = async () => {
    try {
      const p = await saveDialog({ defaultPath: "prisma-catalogo.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof p === "string") setSyncMsg(t("set.exported").replace("{n}", String(await exportCatalog(p))));
    } catch (e) {
      setSyncMsg(t("set.exportError").replace("{e}", String(e)));
    }
  };
  const doImport = async () => {
    try {
      const p = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof p === "string") setSyncMsg(t("set.applied").replace("{n}", String(await importCatalog(p))));
    } catch (e) {
      setSyncMsg(t("set.importError").replace("{e}", String(e)));
    }
  };

  const doBackup = async () => {
    try {
      const p = await saveDialog({ defaultPath: "prisma-backup.db", filters: [{ name: "PRISMA backup", extensions: ["db"] }] });
      if (typeof p === "string") {
        await backupCatalog(p);
        setBackupMsg(t("set.backupOk"));
      }
    } catch (e) {
      setBackupMsg(`${t("common.error")}: ${String(e)}`);
    }
  };
  const doRestore = async () => {
    try {
      const p = await openDialog({ multiple: false, filters: [{ name: "PRISMA backup", extensions: ["db"] }] });
      if (typeof p === "string") {
        if (!window.confirm(t("set.restoreConfirm"))) return;
        setBackupMsg(t("set.restoring"));
        await restoreCatalog(p); // reinicia o app aplicando o backup
      }
    } catch (e) {
      setBackupMsg(`${t("common.error")}: ${String(e)}`);
    }
  };
  // Backup do catálogo numa pasta de NUVEM (sincronizada). É só uma cópia local de arquivo — a
  // nuvem sobe sozinha. 100% confiável, sem login/API. Nome com data pra não sobrescrever.
  const backupToFolder = async (folder: string) => {
    try {
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
      const dest = `${folder.replace(/[\\/]+$/, "")}\\PRISMA-catalogo-${stamp}.db`;
      await backupCatalog(dest);
      setBackupMsg(t("set.cloudOk").replace("{p}", dest));
    } catch (e) {
      setBackupMsg(`${t("common.error")}: ${String(e)}`);
    }
  };
  const doCloudPick = async () => {
    const p = await openDialog({ directory: true, multiple: false, title: t("set.cloudPick") });
    if (typeof p === "string") await backupToFolder(p);
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={close}>
      <div ref={modalRef} className={`pref-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="sliders" size={16} /> {t("settings.title")}
          </div>
          <button className="dup-x" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="pref-body">
          <nav className="pref-nav">
            {TABS.map((tb) => (
              <button key={tb.id} className={`pref-nav-item ${tab === tb.id ? "on" : ""}`} onClick={() => setTab(tb.id)}>
                <Icon name={tb.icon} size={15} /> {t(tb.key)}
              </button>
            ))}
          </nav>

          <div className="pref-content" key={tab}>
            {/* ---------- GERAL ---------- */}
            {tab === "geral" && (
              <>
                <div className="pref-group">
                  <div className="pref-label">{t("settings.language")}</div>
                  <div className="pref-help">{t("settings.languageHelp")}</div>
                  <div className="set-bulk-row">
                    {LOCALES.map((l) => (
                      <button
                        key={l.id}
                        className={`set-bulk-btn ${getLocale() === l.id ? "set-bulk-all" : ""}`}
                        onClick={() => l.id !== getLocale() && setLocale(l.id)}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pref-group">
                  <div className="pref-label">{t("set.accent")}</div>
                  <div className="pref-help">{t("set.accentHelp")}</div>
                  <div className="pref-swatches">
                    {ACCENTS.map((c) => (
                      <button
                        key={c}
                        className={`pref-swatch ${prefs.accent === c ? "on" : ""}`}
                        style={{ background: c }}
                        onClick={() => setPref("accent", c)}
                        title={c}
                      />
                    ))}
                  </div>
                </div>

                <Toggle
                  on={prefs.reduceGlass}
                  onClick={() => setPref("reduceGlass", !prefs.reduceGlass)}
                  title={t("set.reduceGlass")}
                  help={t("set.reduceGlassHelp")}
                />

                <div className="pref-group">
                  <div className="pref-label">{t("set.reloadApp")}</div>
                  <div className="pref-help">{t("set.reloadAppHelp")}</div>
                  <button className="set-bulk-btn" onClick={() => window.location.reload()}>
                    <Icon name="refresh" size={13} /> {t("set.reloadNow")}
                  </button>
                </div>

                <div className="pref-group pref-danger">
                  <div className="pref-label">{t("set.reset")}</div>
                  <div className="pref-help">{t("set.resetHelp")}</div>
                  {!confirmReset ? (
                    <button className="pref-danger-btn" onClick={() => setConfirmReset(true)}>
                      <Icon name="trash" size={13} /> {t("set.resetBtn")}
                    </button>
                  ) : (
                    <div className="pref-danger-confirm">
                      <span>{t("set.resetConfirm")}</span>
                      <div className="set-bulk-row">
                        <button className="set-bulk-btn" disabled={resetting} onClick={() => setConfirmReset(false)}>
                          {t("common.cancel")}
                        </button>
                        <button
                          className="pref-danger-btn"
                          disabled={resetting}
                          onClick={() => {
                            setResetting(true);
                            resetApp().catch(() => setResetting(false));
                          }}
                        >
                          {resetting ? t("set.resetting") : t("set.resetYes")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- REPRODUÇÃO ---------- */}
            {tab === "reproducao" && (
              <>
                <Toggle
                  on={prefs.hoverAutoplay}
                  onClick={() => setPref("hoverAutoplay", !prefs.hoverAutoplay)}
                  title={t("set.hoverAutoplay")}
                  help={t("set.hoverAutoplayHelp")}
                />
                <Toggle
                  on={prefs.sfx}
                  onClick={() => setPref("sfx", !prefs.sfx)}
                  title={t("set.sfx")}
                  help={t("set.sfxHelp")}
                />
                <Toggle
                  on={prefs.quartzo}
                  onClick={() => setPref("quartzo", !prefs.quartzo)}
                  title={t("set.quartzo")}
                  help={t("set.quartzoHelp")}
                />
                <Toggle
                  on={autoProxy}
                  onClick={() => {
                    const v = !autoProxy;
                    setAutoProxy(v);
                    setAutoProxyImport(v);
                  }}
                  title={t("set.autoProxy")}
                  help={t("set.autoProxyHelp")}
                />
                <div className="pref-group">
                  <div className="pref-label">{t("set.reloadProxy")}</div>
                  <div className="pref-help">{t("set.reloadProxyHelp")}</div>
                  <button
                    className="set-bulk-btn"
                    onClick={async () => {
                      setProxyMsg("");
                      try {
                        const n = await regenProxies();
                        setProxyMsg(n > 0 ? `${n.toLocaleString()} ${t("set.statusProxy")}` : t("set.statusOk"));
                      } catch (e) {
                        setProxyMsg(`${t("common.error")}: ${String(e)}`);
                      }
                    }}
                  >
                    <Icon name="refresh" size={13} /> {t("set.reloadProxyBtn")}
                  </button>
                  {proxyMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {proxyMsg}
                    </div>
                  )}
                </div>
                <div className="pref-help" style={{ marginTop: 14 }}>
                  {t("set.playerTip")}
                </div>
              </>
            )}

            {/* ---------- IMPORTAÇÃO ---------- */}
            {tab === "importacao" && (
              <>
                <Toggle
                  on={autotag}
                  onClick={() => {
                    const v = !autotag;
                    setAutotag(v);
                    setAutotagImport(v);
                  }}
                  title={t("set.autotag")}
                  help={t("set.autotagHelp")}
                />
                <div className="pref-group">
                  <div className="pref-label">{t("set.scanHealth")}</div>
                  <div className="pref-help">{t("set.scanHealthHelp")}</div>
                  <button
                    className="set-bulk-btn"
                    disabled={healthBusy}
                    onClick={async () => {
                      setHealthBusy(true);
                      setHealthMsg("");
                      try {
                        const n = await scanHealth(0);
                        setHealthMsg(n > 0 ? `${n.toLocaleString()} →` : t("set.statusOk"));
                      } catch (e) {
                        setHealthMsg(`${t("common.error")}: ${String(e)}`);
                      } finally {
                        setHealthBusy(false);
                      }
                    }}
                  >
                    <Icon name="refresh" size={13} /> {t("set.scanHealthBtn")}
                  </button>
                  {healthMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {healthMsg}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- IA E BUSCA ---------- */}
            {tab === "ia" && (
              <>
                <div className="pref-group">
                  <div className="pref-label">{t("set.aiSearch")}</div>
                  <div className="pref-help">{t("set.aiSearchHelp")}</div>
                  {/* Provedor de IA: Claude (Anthropic) ou Gemini (Google). Mesmo fluxo. */}
                  <div className="set-seg" role="tablist">
                    {([
                      ["anthropic", "Claude", hasAnthropic],
                      ["gemini", "Gemini", hasGemini],
                    ] as const).map(([p, label, set]) => (
                      <button
                        key={p}
                        className={`set-seg-btn ${provider === p ? "on" : ""}`}
                        onClick={() => changeProvider(p)}
                      >
                        {label}
                        {set && <span className="set-seg-dot" title={t("set.keyOk")} />}
                      </button>
                    ))}
                  </div>
                  <div className="pref-help">
                    {provider === "gemini" ? t("set.geminiHelp") : t("set.claudeHelp")}
                  </div>
                  <div className="set-row">
                    <input
                      className="field"
                      type="password"
                      placeholder={
                        (provider === "gemini" ? hasGemini : hasAnthropic)
                          ? t("set.keySaved")
                          : provider === "gemini"
                            ? "AIza..."
                            : "sk-ant-..."
                      }
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                    <button className="set-save" onClick={saveKey} disabled={!key.trim()}>
                      {saved ? t("common.saved") : t("common.save")}
                    </button>
                  </div>
                  <div className="set-status">
                    <span className={`set-dot ${hasKey ? "on" : ""}`} />
                    {hasKey ? `${t("set.keyOk")} ${model}` : t("set.noKey")}
                  </div>
                </div>

                {hasKey && (
                  <div className="pref-group">
                    <div className="pref-label">{t("set.aiBatch")}</div>
                    <div className="pref-help">
                      {t("set.aiBatchHelp")}{" "}
                      {pending !== null && (
                        <b>{pending.toLocaleString()} {t("set.pending")}</b>
                      )}
                    </div>
                    <div className="set-bulk-row">
                      {[100, 500, 2000].map((n) => (
                        <button key={n} className="set-bulk-btn" disabled={aiBusy} onClick={() => setConfirmN(n)}>
                          {t("set.analyze")} {n}
                        </button>
                      ))}
                      <button
                        className="set-bulk-btn set-bulk-all"
                        disabled={aiBusy || pending === 0}
                        onClick={() => setConfirmN(0)}
                        title={t("set.analyzeAllTitle")}
                      >
                        {t("set.analyzeAll")}{pending ? ` (${pending.toLocaleString()})` : ""}
                      </button>
                    </div>
                    {confirmN !== null &&
                      (() => {
                        const count =
                          confirmN <= 0 ? pending ?? 0 : Math.min(confirmN, pending ?? confirmN);
                        return (
                          <div className="set-confirm">
                            <div className="set-confirm-txt">
                              {t("set.aiConfirm")
                                .replace("{n}", count.toLocaleString())
                                .replace("{c}", aiCost(count))}
                            </div>
                            <div className="set-bulk-row">
                              <button className="set-bulk-btn" onClick={() => setConfirmN(null)}>
                                {t("common.cancel")}
                              </button>
                              <button
                                className="set-bulk-btn set-bulk-all"
                                disabled={count === 0}
                                onClick={() => {
                                  const n = confirmN;
                                  setConfirmN(null);
                                  runBulk(n);
                                }}
                              >
                                {t("set.analyze")}
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    {aiMsg && (
                      <div className="set-status">
                        <span className="set-dot on" /> {aiMsg}
                      </div>
                    )}
                  </div>
                )}

                {hasKey && (
                  <div className="pref-group">
                    <div className="pref-label">{t("set.sfxBatch")}</div>
                    <div className="pref-help">
                      {t("set.sfxBatchHelp")}{" "}
                      {sfxPending !== null && (
                        <b>{sfxPending.toLocaleString()} {t("set.sfxPending")}</b>
                      )}
                    </div>
                    <div className="set-bulk-row">
                      <button
                        className="set-bulk-btn set-bulk-all"
                        disabled={sfxBusy || sfxPending === 0}
                        onClick={runSfxAll}
                        title={t("set.sfxAllTitle")}
                      >
                        <Icon name="sliders" size={13} /> {t("set.sfxAll")}
                        {sfxPending ? ` (${sfxPending.toLocaleString()})` : ""}
                      </button>
                    </div>
                    {sfxMsg && (
                      <div className="set-status">
                        <span className="set-dot on" /> {sfxMsg}
                      </div>
                    )}
                  </div>
                )}

                <div className="pref-group">
                  <div className="pref-label">{t("set.vault")}</div>
                  <div className="pref-help">{t("set.vaultHelp")}</div>
                  <div className="set-status">
                    <span className={`set-dot ${vault.path ? "on" : ""}`} />
                    {vault.path
                      ? `${vault.count.toLocaleString()} ${t("set.vaultChunks")} · ${vault.path}`
                      : t("set.vaultNone")}
                  </div>
                  <div className="set-bulk-row">
                    <button className="set-bulk-btn" onClick={pickVault}>
                      <Icon name="folder" size={13} /> {t("set.vaultPick")}
                    </button>
                    {vault.path && (
                      <button className="set-bulk-btn" onClick={doReindexVault}>
                        <Icon name="refresh" size={13} /> {t("set.vaultReindex")}
                      </button>
                    )}
                  </div>
                  {vaultMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {vaultMsg}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- ECOSSISTEMA (VELVET + QUARTZO) ---------- */}
            {tab === "ecossistema" && (
              <>
                <div className="pref-group" ref={ecoRef}>
                  <div className="pref-label">{t("eco.title")}</div>
                  <div className="pref-help">{t("eco.intro")}</div>
                </div>

                <div className="pref-group">
                  <div className="pref-label">{t("eco.quartzo")}</div>
                  <div className="pref-help">{t("eco.quartzoHelp")}</div>
                  <div className="set-status">
                    <span className={`set-dot ${quartzoVault ? "on" : ""}`} />
                    {quartzoVault ? quartzoVault : t("eco.quartzoNone")}
                  </div>
                  <div className="set-bulk-row">
                    <button className="set-bulk-btn" onClick={pickQuartzo}>
                      <Icon name="folder" size={13} /> {t("eco.quartzoPick")}
                    </button>
                  </div>
                </div>

                <div className="pref-group">
                  <div className="pref-label">{t("eco.velvet")}</div>
                  <div className="pref-help">{t("eco.velvetHelp")}</div>
                  <div className="set-bulk-row">
                    <button className="set-bulk-btn" onClick={doExportVelvet}>
                      <Icon name="sparkles" size={13} /> {t("eco.velvetExport")}
                    </button>
                  </div>
                </div>

                {ecoMsg && (
                  <div className="set-status">
                    <span className="set-dot on" /> {ecoMsg}
                  </div>
                )}
              </>
            )}

            {/* ---------- SINCRONIZAÇÃO ---------- */}
            {tab === "sync" && (
              <>
                <div className="pref-group">
                  <div className="pref-label">{t("set.sync")}</div>
                  <div className="pref-help">{t("set.syncHelp")}</div>
                  <div className="set-bulk-row">
                    <button className="set-bulk-btn" onClick={doExport}>{t("set.export")}</button>
                    <button className="set-bulk-btn" onClick={doImport}>{t("set.import")}</button>
                  </div>
                  {syncMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {syncMsg}
                    </div>
                  )}
                </div>

                <div className="pref-group">
                  <div className="pref-label">{t("set.backup")}</div>
                  <div className="pref-help">{t("set.backupHelp")}</div>
                  <div className="set-bulk-row">
                    <button className="set-bulk-btn" onClick={doBackup}>{t("set.backupBtn")}</button>
                    <button className="set-bulk-btn" onClick={doRestore}>{t("set.restoreBtn")}</button>
                  </div>
                  {/* Backup na NUVEM: salva o catálogo na pasta sincronizada do OneDrive/Drive/
                      Dropbox que você já tem no PC — a nuvem sobe sozinha. Sem login, sem API. */}
                  <div className="pref-help" style={{ marginTop: 12 }}>{t("set.cloudHelp")}</div>
                  <div className="set-bulk-row">
                    {clouds.map((c) => (
                      <button key={c.path} className="set-bulk-btn cloud" onClick={() => backupToFolder(c.path)} title={c.path}>
                        <Icon name="check" size={13} /> {c.name}
                      </button>
                    ))}
                    <button className="set-bulk-btn" onClick={doCloudPick}>
                      <Icon name="folder" size={13} /> {t("set.cloudPickBtn")}
                    </button>
                  </div>
                  {backupMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {backupMsg}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- SOBRE ---------- */}
            {tab === "sobre" && (
              <div className="pref-about">
                <div className="pref-about-name">PRISMA</div>
                <div className="pref-about-ver">{t("set.version")} {APP_VERSION}</div>
                <div className="pref-help" style={{ marginTop: 12 }}>{t("set.aboutDesc")}</div>
                <div className="pref-whatsnew">
                  <div className="pref-whatsnew-title">{t("set.whatsNew")}</div>
                  <ul>
                    {WHATS_NEW.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
                <button
                  className="set-bulk-btn"
                  style={{ marginTop: 16 }}
                  disabled={updBusy}
                  onClick={checkUpdates}
                >
                  <Icon name="refresh" size={13} /> {t("set.checkUpdates")}
                </button>
                {updMsg && (
                  <div className="set-status" style={{ marginTop: 8 }}>
                    <span className="set-dot on" /> {updMsg}
                  </div>
                )}
                <button
                  className="set-bulk-btn"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    resetTips();
                    window.location.reload();
                  }}
                >
                  <Icon name="play" size={13} /> {t("set.replayTutorial")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Botão de alternância reaproveitável (knob deslizante). O som de clique vem do listener
// global de SFX (App.tsx) — aqui não precisa tocar nada.
function Toggle({ on, onClick, title, help }: { on: boolean; onClick: () => void; title: string; help: string }) {
  return (
    <div className="pref-group">
      <button className={`set-toggle ${on ? "on" : ""}`} onClick={onClick}>
        <span className="set-toggle-knob" />
        <span className="pref-toggle-text">
          <span className="pref-toggle-title">{title}</span>
          <span className="pref-help">{help}</span>
        </span>
      </button>
    </div>
  );
}
