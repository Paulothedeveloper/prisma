import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { VirtuosoGrid, Virtuoso } from "react-virtuoso";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  searchAssets,
  getCounts,
  getFolders,
  indexPath,
  listTags,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  removeFromCollection,
  reorderCollection,
  setFolderAlias,
  setFolderHidden,
  setFolderCover,
  setFolderColor,
  autotagFolder,
  removeFolderLib,
  pasteImage,
  addFromUrl,
  exportNle,
  duplicateAsset,
  emptyTrash,
  dedupeKeepOne,
  similarAssets,
  rescanFolder,
  trashAsset,
  addToCollection,
  oficinaRun,
  concatRun,
  oficinaCancel,
  revealInExplorer,
  listSmart,
  healthCounts,
  smartSearch,
  deleteSmart,
  aiAnalyzeMany,
  subfolders,
  type Asset,
  type SubCard,
  type Counts,
  type Tag,
  type Collection,
  type DupPair,
  type FolderRow,
  type SmartFolder,
  type Filter,
} from "./api";
import { AssetCard } from "./AssetCard";
import { Moodboard } from "./Moodboard";
import { AssetRow } from "./AssetRow";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { DupModal } from "./DupModal";
import { Settings } from "./Settings";
import { SmartBuilder } from "./SmartBuilder";
import { BatchRename } from "./BatchRename";
import { Markup } from "./Markup";
import { ContextMenu, type CtxItem } from "./ContextMenu";
import { FolderTree } from "./FolderTree";
import { Logo } from "./Logo";
import { Icon, type IconName } from "./Icons";
import { extSuggestion } from "./extInfo";
import { Coachmark } from "./Coachmark";
import { WelcomeModal } from "./WelcomeModal";
import { UpdateBanner } from "./UpdateBanner";
import { onTip, fireTip, isFirstLaunch, markWelcomed } from "./tips";
import { t } from "./i18n";
import { sfx } from "./sfx";
import { PopupButton } from "./Menu";
import { TrafficLights } from "./TrafficLights";
import "./App.css";

const PAGE = 200;

const CATEGORY_LABELS: Record<string, string> = {
  image: t("cat.image"),
  video: t("cat.video"),
  gif: t("cat.gif"),
  audio: t("cat.audio"),
  lut: t("cat.lut"),
  font: t("cat.font"),
  document: t("cat.document"),
  unknown: t("cat.unknown"),
};
const CATEGORY_ORDER = ["image", "video", "gif", "audio", "lut", "font", "document", "unknown"];

const COLOR_HEX: Record<string, string> = {
  vermelho: "#FF453A",
  laranja: "#FF9F0A",
  amarelo: "#FFD60A",
  verde: "#30D158",
  ciano: "#40C8E0",
  azul: "#0A84FF",
  roxo: "#BF5AF2",
  rosa: "#FF6482",
  branco: "#F2F2F7",
  cinza: "#8E8E93",
  preto: "#3A3A3C",
};

const RES_OPTS: [string, string][] = [
  ["", t("filter.res")],
  ["uhd", t("filter.res.uhd")],
  ["fhd", t("filter.res.fhd")],
  ["hd", t("filter.res.hd")],
  ["sd", t("filter.res.sd")],
];
const DUR_OPTS: [string, string][] = [
  ["", t("filter.dur")],
  ["short", t("filter.dur.short")],
  ["mid", t("filter.dur.mid")],
  ["long", t("filter.dur.long")],
];
// Características visuais (busca por como o asset SE PARECE, não pelo nome).
const BRIGHT_OPTS: [string, string][] = [
  ["", t("filter.bright")],
  ["claro", t("filter.bright.claro")],
  ["medio", t("filter.bright.medio")],
  ["escuro", t("filter.bright.escuro")],
];
const WARM_OPTS: [string, string][] = [
  ["", t("filter.warm")],
  ["quente", t("filter.warm.quente")],
  ["neutro", t("filter.warm.neutro")],
  ["frio", t("filter.warm.frio")],
];
const SAT_OPTS: [string, string][] = [
  ["", t("filter.sat")],
  ["vivido", t("filter.sat.vivido")],
  ["suave", t("filter.sat.suave")],
  ["pb", t("filter.sat.pb")],
];
const SORT_OPTS: [string, string][] = [
  ["name", t("filter.sort.nameAsc")],
  ["name_desc", t("filter.sort.nameDesc")],
  ["recent", t("filter.sort.recent")],
  ["oldest", t("filter.sort.oldest")],
  ["size_desc", t("filter.sort.sizeDesc")],
  ["size_asc", t("filter.sort.sizeAsc")],
  ["rating_desc", t("filter.sort.ratingDesc")],
  ["duration_desc", t("filter.sort.durationDesc")],
];

// Coleções inteligentes: presets que combinam características já extraídas (local, instantâneo).
type SmartPreset = {
  id: string;
  label: string;
  icon: IconName;
  f: { kind?: string; res?: string; bright?: string; warm?: string; sat?: string; orient?: string };
};
const SMART_PRESETS: SmartPreset[] = [
  { id: "reels", label: t("smart.reels"), icon: "video", f: { kind: "video", orient: "portrait" } },
  { id: "uhd", label: t("smart.uhd"), icon: "sparkles", f: { res: "uhd" } },
  { id: "pb", label: t("smart.pb"), icon: "contrast", f: { sat: "pb" } },
  { id: "moody", label: t("smart.moody"), icon: "moon", f: { bright: "escuro" } },
  { id: "clean", label: t("smart.clean"), icon: "sun", f: { bright: "claro" } },
  { id: "quente", label: t("smart.quente"), icon: "flame", f: { warm: "quente" } },
  { id: "frio", label: t("smart.frio"), icon: "snowflake", f: { warm: "frio" } },
];

type View =
  | { t: "all" }
  | { t: "kind"; v: string }
  | { t: "dups" }
  | { t: "untagged" }
  | { t: "uncollected" }
  | { t: "random" }
  | { t: "trash" }
  | { t: "color"; v: string }
  | { t: "tag"; v: number; label: string }
  | { t: "folder"; v: string; label: string }
  | { t: "ext"; v: string; label: string }
  | { t: "collection"; v: number; label: string }
  | { t: "similar"; v: number; label: string }
  | { t: "health"; v: string; label: string }
  | { t: "smart"; v: number; label: string };

export default function App() {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ t: "all" });
  const [minRating, setMinRating] = useState(0);
  const [fExt, setFExt] = useState("");
  const [fRes, setFRes] = useState("");
  const [fDur, setFDur] = useState("");
  const [fBright, setFBright] = useState("");
  const [fWarm, setFWarm] = useState("");
  const [fSat, setFSat] = useState("");
  const [fOrient, setFOrient] = useState("");
  const [smart, setSmart] = useState("");
  const [sort, setSort] = useState("name");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [counts, setCounts] = useState<Counts>({
    total: 0,
    dups: 0,
    untagged: 0,
    uncollected: 0,
    trash: 0,
    by_type: [],
    by_color: [],
    by_ext: [],
    by_unknown_ext: [],
  });
  const [othersOpen, setOthersOpen] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [smartFolders, setSmartFolders] = useState<SmartFolder[]>([]);
  const [smartBuilder, setSmartBuilder] = useState<{ editing: SmartFolder | null } | null>(null);
  const [editingColl, setEditingColl] = useState<number | null>(null);
  const [dupPairs, setDupPairs] = useState<DupPair[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [proxyProgress, setProxyProgress] = useState<{ done: number; total: number; made: number } | null>(null);
  const [hCounts, setHCounts] = useState<Record<string, number>>({});
  const [healthProgress, setHealthProgress] = useState<{ done: number; total: number } | null>(null);
  const [tip, setTip] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [welcome, setWelcome] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [batchRename, setBatchRename] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; asset: Asset } | null>(null);
  const [markup, setMarkup] = useState<Asset | null>(null);
  const [clearing, setClearing] = useState(false); // animação de SAÍDA (esvaziar lixeira / apagar dups)
  const [switching, setSwitching] = useState(true); // janela em que os cards entram em cascata
  const cascadeOnNextLoad = useRef(true); // pede cascata na PRÓXIMA carga (nav/layout); animação sem remount
  const cascadeTimer = useRef<number | null>(null);
  const [subCards, setSubCards] = useState<SubCard[]>([]);
  const [booted, setBooted] = useState(false);
  const [thumbSize, setThumbSize] = useState(190);
  const [layout, setLayout] = useState<"grid" | "list" | "waterfall">("grid");
  const [boardMode, setBoardMode] = useState(false); // moodboard (só em coleção)
  const [simThreshold, setSimThreshold] = useState(22); // tolerância da busca por similaridade
  const [selected, setSelected] = useState<Asset | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const anchorRef = useRef<number | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [progress, setProgress] = useState({ active: false, done: 0, total: 0 });
  const [jobs, setJobs] = useState<
    Record<
      number,
      { label: string; pct: number; status: "run" | "done" | "error"; message?: string; output?: string }
    >
  >({});

  const offsetRef = useRef(0);
  const refetchTimer = useRef<number | null>(null);
  const gridRef = useRef<any>(null);

  const durRange = (d: string): [number | null, number | null] => {
    if (d === "short") return [null, 10];
    if (d === "mid") return [10, 60];
    if (d === "long") return [60, null];
    return [null, null];
  };

  const buildFilter = useCallback(
    (offset: number): Filter => {
      const [mn, mx] = durRange(fDur);
      return {
        query,
        kind: view.t === "kind" ? view.v : null,
        color_bucket: view.t === "color" ? view.v : null,
        tag_id: view.t === "tag" ? view.v : null,
        folder: view.t === "folder" ? view.v : null,
        collection: view.t === "collection" ? view.v : null,
        dups_only: view.t === "dups",
        trashed: view.t === "trash",
        untagged: view.t === "untagged",
        uncollected: view.t === "uncollected",
        random: view.t === "random",
        min_rating: minRating || null,
        ext: view.t === "ext" ? view.v : fExt || null,
        res: fRes || null,
        min_duration: mn,
        max_duration: mx,
        bright: fBright || null,
        warm: fWarm || null,
        sat: fSat || null,
        orient: fOrient || null,
        health_flag: view.t === "health" ? view.v : null,
        sort,
        limit: PAGE,
        offset,
      };
    },
    [query, view, minRating, fExt, fRes, fDur, fBright, fWarm, fSat, fOrient, sort]
  );

  const runSearch = useCallback(
    async (reset = true) => {
      // Abre a janela de cascata NO MESMO lote em que os dados novos entram, SÓ quando a
      // navegação pediu (cascadeOnNextLoad). Assim os cards novos animam ao montar, sem
      // remontar a grade inteira (que causava a "piscada") e sem re-animar os antigos.
      const fireCascade = () => {
        if (reset && cascadeOnNextLoad.current) {
          cascadeOnNextLoad.current = false;
          setSwitching(true);
          if (cascadeTimer.current) clearTimeout(cascadeTimer.current);
          cascadeTimer.current = window.setTimeout(() => setSwitching(false), 850);
        }
      };
      if (view.t === "similar") {
        const rows = await similarAssets(view.v, 60, simThreshold);
        offsetRef.current = rows.length;
        setAssets(rows);
        fireCascade();
        return;
      }
      if (view.t === "smart") {
        const rows = await smartSearch(view.v, sort);
        offsetRef.current = rows.length;
        setAssets(rows);
        fireCascade();
        return;
      }
      const offset = reset ? 0 : offsetRef.current;
      const rows = await searchAssets(buildFilter(offset));
      offsetRef.current = offset + rows.length;
      setAssets((prev) => (reset ? rows : [...prev, ...rows]));
      fireCascade();
    },
    [buildFilter, view, simThreshold]
  );

  const refreshMeta = useCallback(async () => {
    setCounts(await getCounts());
    setTags(await listTags());
    setFolders(await getFolders());
    setCollections(await listCollections());
    setSmartFolders(await listSmart());
    healthCounts().then(setHCounts).catch(() => {});
  }, []);

  // Filtro/busca/ordenação: recarrega EM LUGAR (sem cascata — pra não reanimar enquanto digita).
  // A troca de VIEW é tratada no efeito abaixo (que cascateia). `view` fora dos deps de propósito.
  useEffect(() => {
    const t = window.setTimeout(() => runSearch(true), 110);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, minRating, fExt, fRes, fDur, fBright, fWarm, fSat, fOrient, sort]);

  useEffect(() => {
    // splash premium até a primeira carga de metadados (com tempo mínimo pro efeito)
    Promise.all([refreshMeta(), new Promise((r) => setTimeout(r, 900))]).then(() => setBooted(true));
  }, [refreshMeta]);

  // Onboarding: escuta o barramento de dicas e mostra boas-vindas na 1ª vez.
  useEffect(() => {
    onTip((id, rect) => setTip({ id, rect }));
    if (isFirstLaunch()) setWelcome(true);
    return () => onTip(null);
  }, []);

  // Depois do boot (e sem o modal de boas-vindas aberto), dispara a 1ª dica (barra lateral).
  useEffect(() => {
    if (booted && !welcome) {
      const t = setTimeout(() => fireTip("sidebar", sidebarRef.current), 500);
      return () => clearTimeout(t);
    }
  }, [booted, welcome]);

  // Troca de view (aba/pasta/atalho): troca INSTANTÂNEA dos dados, SEM animação na grade.
  // Animar a troca (mesmo só com transform) era percebido como "piscada"; o conteúdo
  // novo entra direto, sem fade nem cascata. Também limpa seleção e volta o scroll ao topo.
  useEffect(() => {
    setSelectedIds(new Set());
    anchorRef.current = null;
    setBoardMode(false); // sai do modo quadro ao trocar de view
    gridRef.current?.scrollToIndex?.(0);
    // subpastas como cards-capa (só na visão de pasta)
    if (view.t === "folder") subfolders(view.v).then(setSubCards).catch(() => setSubCards([]));
    else setSubCards([]);
    runSearch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Trocar de layout (grade/lista/waterfall): também instantâneo, sem animar a grade.
  useEffect(() => {
    runSearch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Ajustar a tolerância da busca por similaridade → re-busca (só na visão "similar").
  useEffect(() => {
    if (view.t === "similar") runSearch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simThreshold]);

  // SFX "de software": um tap discreto em QUALQUER botão/controle (listener global, em
  // captura). Ignora a seleção de mídia (.card) e os controles do player ([data-sfx-skip])
  // pra não atrapalhar a reprodução. Notificações (concluir job/atualização) tocam à parte.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.closest("button, .tree-row")) return;
      if (el.closest(".card, [data-sfx-skip]")) return;
      sfx.tap();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Largura da sidebar salva (reclamação do Eagle: sidebar não-redimensionável).
  useEffect(() => {
    try {
      const w = localStorage.getItem("prisma.sb");
      if (w) document.documentElement.style.setProperty("--sb", w);
    } catch {
      /* ignora */
    }
  }, []);

  // Navegar pra uma pasta/categoria LIMPA os filtros do topo (resolução/tom/etc),
  // senão um preset tipo "4K e acima" fica grudado e some com vídeos LOG/720p e Documentos.
  // (Presets inteligentes sinalizam via smartNav pra NÃO limpar.)
  useEffect(() => {
    if (smartNav.current) {
      smartNav.current = false;
      return;
    }
    setMinRating(0);
    setFExt("");
    setFRes("");
    setFDur("");
    setFBright("");
    setFWarm("");
    setFSat("");
    setFOrient("");
    setSmart("");
  }, [view]);

  // Tira o destaque do preset inteligente quando o usuário muda filtros/visão à mão.
  useEffect(() => {
    if (!smart) return;
    const p = SMART_PRESETS.find((x) => x.id === smart);
    if (!p) return;
    const viewOk = p.f.kind ? view.t === "kind" && view.v === p.f.kind : view.t === "all";
    const ok =
      viewOk &&
      (p.f.res ?? "") === fRes &&
      (p.f.bright ?? "") === fBright &&
      (p.f.warm ?? "") === fWarm &&
      (p.f.sat ?? "") === fSat &&
      (p.f.orient ?? "") === fOrient;
    if (!ok) setSmart("");
  }, [smart, view, fRes, fBright, fWarm, fSat, fOrient]);

  useEffect(() => {
    const unl: Array<() => void> = [];
    listen<{ total: number }>("index:start", (e) =>
      setProgress({ active: true, done: 0, total: e.payload.total })
    ).then((u) => unl.push(u));
    listen<{ done: number; total: number }>("index:thumb", (e) => {
      setProgress({ active: true, done: e.payload.done, total: e.payload.total });
      // refresh throttleado (2s) pra não piscar a grade a cada thumb durante a indexação
      if (refetchTimer.current === null) {
        refetchTimer.current = window.setTimeout(() => {
          refetchTimer.current = null;
          runSearch(true);
          refreshMeta();
        }, 2000);
      }
    }).then((u) => unl.push(u));
    listen("index:done", () => {
      setProgress((p) => ({ ...p, active: false }));
      runSearch(true);
      refreshMeta();
      sfx.notify(); // notificação ao terminar de catalogar
    }).then((u) => unl.push(u));
    // Duplicados achados na importação → abre o modal de decisão.
    listen<DupPair[]>("index:dups", (e) => {
      if (e.payload?.length) setDupPairs(e.payload);
    }).then((u) => unl.push(u));
    // Backfill das características visuais terminou → atualiza a busca atual.
    listen("index:traits-done", () => runSearch(true)).then((u) => unl.push(u));
    // Watch Folder: arquivos novos/removidos detectados → atualiza grade + contagens.
    listen("watch:changed", () => {
      runSearch(true);
      refreshMeta();
    }).then((u) => unl.push(u));
    // Análise de IA em lote: progresso + fim.
    listen<{ done: number; total: number }>("ai:progress", (e) => setAiProgress(e.payload)).then((u) => unl.push(u));
    listen("ai:done", () => {
      setAiProgress(null);
      runSearch(true);
      refreshMeta();
    }).then((u) => unl.push(u));
    // Proxies automáticos (ao importar): progresso + fim → atualiza a grade pra já tocar.
    listen<{ done: number; total: number; made: number }>("proxy:progress", (e) =>
      setProxyProgress(e.payload),
    ).then((u) => unl.push(u));
    listen("proxy:done", () => {
      setProxyProgress(null);
      runSearch(true);
    }).then((u) => unl.push(u));
    // Escaneamento de saúde da biblioteca: progresso + fim → atualiza os atalhos "Saúde".
    listen<{ done: number; total: number }>("health:progress", (e) => setHealthProgress(e.payload)).then((u) =>
      unl.push(u),
    );
    listen("health:done", () => {
      setHealthProgress(null);
      refreshMeta();
      runSearch(true);
    }).then((u) => unl.push(u));

    // OFICINA: progresso/fim/erro dos jobs de conserto
    const drop = (job: number, delay: number) =>
      setTimeout(() => setJobs((j) => {
        const n = { ...j };
        delete n[job];
        return n;
      }), delay);
    listen<{ job: number; pct: number; label: string }>("oficina:progress", (e) => {
      const { job, pct, label } = e.payload;
      setJobs((j) => ({ ...j, [job]: { label, pct, status: "run" } }));
    }).then((u) => unl.push(u));
    listen<{ job: number; label: string; output: string }>("oficina:done", (e) => {
      const { job, label, output } = e.payload;
      setJobs((j) => ({ ...j, [job]: { label, pct: 100, status: "done", output } }));
      runSearch(true);
      refreshMeta();
      drop(job, 12000);
      sfx.notify(); // notificação ao concluir um job da Oficina
    }).then((u) => unl.push(u));
    listen<{ job: number; label: string; message: string }>("oficina:error", (e) => {
      const { job, label, message } = e.payload;
      setJobs((j) => ({ ...j, [job]: { label, pct: 0, status: "error", message } }));
      drop(job, 6000);
      sfx.error(); // som discreto de falha
    }).then((u) => unl.push(u));
    listen("oficina:reindexed", () => {
      runSearch(true);
      refreshMeta();
    }).then((u) => unl.push(u));

    return () => unl.forEach((u) => u());
  }, [runSearch, refreshMeta]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " " && selected && !previewAsset) {
        e.preventDefault();
        setPreviewAsset(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, previewAsset]);

  // Colar imagem do clipboard (Ctrl+V) → salva numa Inbox e cataloga.
  useEffect(() => {
    const onPaste = async (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "v") return;
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await it.getType(type);
            const buf = new Uint8Array(await blob.arrayBuffer());
            await pasteImage(Array.from(buf));
            runSearch(true);
            refreshMeta();
            break;
          }
        }
      } catch {
        /* clipboard sem imagem ou sem permissão */
      }
    };
    window.addEventListener("keydown", onPaste);
    return () => window.removeEventListener("keydown", onPaste);
  }, [runSearch, refreshMeta]);

  const [addMenu, setAddMenu] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [addPos, setAddPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (addMenu && addBtnRef.current) {
      const r = addBtnRef.current.getBoundingClientRect();
      const W = 210;
      const estH = 92;
      let top = r.bottom + 7; // ABAIXO do botão
      if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 7);
      const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
      setAddPos({ left, top });
    } else {
      setAddPos(null);
    }
  }, [addMenu]);
  const addFolders = async () => {
    setAddMenu(false);
    const sel = await open({ directory: true, multiple: true });
    const dirs = Array.isArray(sel) ? sel : sel ? [sel] : [];
    for (const d of dirs) await indexPath(d);
  };
  const addFiles = async () => {
    setAddMenu(false);
    const sel = await open({ directory: false, multiple: true });
    const files = Array.isArray(sel) ? sel : sel ? [sel] : [];
    for (const f of files) await indexPath(f);
  };
  // Coletor da web (designer): cola uma URL, baixa pro Inbox e cataloga.
  const addFromWeb = async () => {
    setAddMenu(false);
    const url = window.prompt(t("app.addUrlPrompt"));
    if (!url || !url.trim()) return;
    try {
      await addFromUrl(url.trim());
      onMutate();
    } catch (e) {
      window.alert(`${t("common.error")}: ${String(e)}`);
    }
  };

  const countMap = useMemo(() => {
    const m = new Map<string, number>();
    counts.by_type.forEach(([k, n]) => m.set(k, n));
    return m;
  }, [counts]);

  const extOpts = useMemo<[string, string][]>(
    () => [
      ["", t("filter.ext")],
      ...counts.by_ext.map(([e, n]) => [e, `.${e} · ${n}`] as [string, string]),
    ],
    [counts.by_ext]
  );

  const onMutate = useCallback(() => {
    runSearch(true);
    refreshMeta();
  }, [runSearch, refreshMeta]);

  // Remoção em massa COM animação (regra do app: tudo anima). A grade faz uma animação
  // de SAÍDA (some), aí a remoção é aplicada, recarrega e os itens restantes entram em cascata.
  const removeWithAnim = useCallback(
    (doRemoval: () => Promise<unknown> | void) => {
      setClearing(true);
      sfx.trash(); // "thunk" macio acompanhando a animação de saída
      window.setTimeout(async () => {
        await Promise.resolve(doRemoval());
        cascadeOnNextLoad.current = true; // os que sobraram entram em cascata
        setClearing(false);
        await runSearch(true); // dispara a cascata no mesmo lote dos dados recarregados
        refreshMeta();
      }, 260);
    },
    [runSearch, refreshMeta]
  );

  const navPreview = useCallback(
    (dir: -1 | 1) => {
      if (!previewAsset) return;
      const idx = assets.findIndex((a) => a.id === previewAsset.id);
      const next = assets[idx + dir];
      if (next) {
        setPreviewAsset(next);
        setSelected(next);
      }
    },
    [previewAsset, assets]
  );

  // Clique no card: simples = seleção única; Ctrl = alterna; Shift = intervalo (multi-seleção).
  const handleCardClick = useCallback(
    (asset: Asset, e: React.MouseEvent, index: number) => {
      if (e.shiftKey && anchorRef.current !== null) {
        const a = Math.min(anchorRef.current, index);
        const b = Math.max(anchorRef.current, index);
        setSelectedIds(new Set(assets.slice(a, b + 1).map((x) => x.id)));
        setSelected(asset);
      } else if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const n = new Set(prev);
          if (n.has(asset.id)) n.delete(asset.id);
          else n.add(asset.id);
          return n;
        });
        setSelected(asset);
        anchorRef.current = index;
      } else {
        setSelectedIds(new Set([asset.id]));
        setSelected(asset);
        anchorRef.current = index;
      }
    },
    [assets]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelected(null);
    anchorRef.current = null;
  }, []);

  const openCtx = useCallback(
    (asset: Asset, e: React.MouseEvent) => {
      if (!selectedIds.has(asset.id)) setSelected(asset);
      setCtxMenu({ x: e.clientX, y: e.clientY, asset });
    },
    [selectedIds]
  );

  const openInWindow = (a: Asset) => {
    const label = `prev-${a.id}-${Date.now()}`;
    const q = `index.html?win=preview&type=${a.type}&path=${encodeURIComponent(a.path)}&name=${encodeURIComponent(a.name || a.filename)}`;
    new WebviewWindow(label, { url: q, title: a.name || a.filename, width: 920, height: 620 });
  };

  // Menu de contexto da mídia (estilo Eagle — print 2).
  const ctxItems = (a: Asset): CtxItem[] => {
    const folder = a.path.replace(/\\[^\\]+$/, "");
    const ids = selectedIds.size > 1 && selectedIds.has(a.id) ? [...selectedIds] : [a.id];
    const many = ids.length > 1;
    const n = many ? ` (${ids.length})` : "";
    return [
      { label: `${t("insp.view")}${n}`, icon: "play", onClick: () => setPreviewAsset(a) },
      { label: t("ctx.newWindow"), icon: "fullscreen", onClick: () => openInWindow(a) },
      { label: t("ctx.details"), icon: "pencil", onClick: () => setSelected(a) },
      { label: t("insp.explorer"), icon: "reveal", onClick: () => revealInExplorer(a.path) },
      { sep: true, label: "" },
      { label: t("insp.copyPath"), icon: "copy", onClick: () => navigator.clipboard.writeText(a.path) },
      { label: t("insp.copyFolder"), icon: "folder", onClick: () => navigator.clipboard.writeText(folder) },
      { label: many ? `${t("ctx.renameMany")}${n}` : t("ctx.duplicate"), icon: many ? "pencil" : "copy", onClick: () => (many ? setBatchRename(true) : duplicateAsset(a.id).then(onMutate)) },
      {
        label: t("ctx.setCover"),
        icon: "image",
        onClick: () => a.thumbnail_path && setFolderCover(folder, a.thumbnail_path).then(refreshMeta),
      },
      { sep: true, label: "" },
      ...(a.type === "image" || a.type === "gif" ? [{ label: t("ctx.markup"), icon: "pencil" as const, onClick: () => setMarkup(a) }] : []),
      { label: t("ctx.findSimilar"), icon: "search", onClick: () => setView({ t: "similar", v: a.id, label: a.name || a.filename }) },
      { label: `${t("batch.ai")}${n}`, icon: "sliders", onClick: () => aiAnalyzeMany(ids) },
      { sep: true, label: "" },
      {
        label: `${t("ctx.trash")}${n}`,
        icon: "trash",
        danger: true,
        onClick: () => removeWithAnim(() => Promise.all(ids.map((id) => trashAsset(id, true))).then(clearSelection)),
      },
    ];
  };

  // Ações em lote sobre os selecionados
  const batchTrash = useCallback(() => {
    const ids = [...selectedIds];
    removeWithAnim(async () => {
      for (const id of ids) await trashAsset(id, true);
      clearSelection();
    });
  }, [selectedIds, clearSelection, removeWithAnim]);

  // Conserto VFR→CFR em lote (saúde da biblioteca). FPS é auto-detectado por arquivo no
  // backend; já-feitos são pulados. Pesado → confirma antes pela quantidade.
  const batchFixCfr = useCallback(() => {
    const vids = assets.filter((a) => selectedIds.has(a.id) && a.type === "video");
    if (vids.length === 0) return;
    if (!window.confirm(t("ctx.cfrConfirm").replace("{x}", String(vids.length)))) return;
    vids.forEach((a) => oficinaRun("vfr_cfr", a.path, { codec: "h265", crf: 18 }));
    clearSelection();
  }, [assets, selectedIds, clearSelection]);

  const batchAddCollection = useCallback(
    async (cid: number) => {
      await addToCollection(cid, [...selectedIds]);
      clearSelection();
      onMutate();
    },
    [selectedIds, clearSelection, onMutate]
  );

  const batchExport = useCallback(
    async (fmt: string) => {
      const sel = assets.filter((a) => selectedIds.has(a.id) && (a.type === "image" || a.type === "gif"));
      for (const a of sel) await oficinaRun(`convert:${fmt}`, a.path);
    },
    [assets, selectedIds]
  );

  const onReorder = useCallback(
    (from: number, to: number) => {
      if (view.t !== "collection") return;
      const cid = view.v;
      setAssets((prev) => {
        const next = [...prev];
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        reorderCollection(cid, next.map((a) => a.id)).catch(() => {});
        return next;
      });
    },
    [view]
  );

  const smartNav = useRef(false);
  const applySmart = useCallback((p: SmartPreset) => {
    smartNav.current = true; // sinaliza que essa troca de view É um preset (não limpar filtros)
    setMinRating(0);
    setFExt("");
    setFDur("");
    setFRes(p.f.res ?? "");
    setFBright(p.f.bright ?? "");
    setFWarm(p.f.warm ?? "");
    setFSat(p.f.sat ?? "");
    setFOrient(p.f.orient ?? "");
    setView(p.f.kind ? { t: "kind", v: p.f.kind } : { t: "all" });
    setSmart(p.id);
  }, []);

  const addCollection = useCallback(async () => {
    const id = await createCollection(t("app.newCollection"));
    await refreshMeta();
    setEditingColl(id);
  }, [refreshMeta]);

  const inCollection = view.t === "collection" ? view.v : null;

  const isView = (v: View) => JSON.stringify(v) === JSON.stringify(view);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const folderSel = view.t === "folder" ? view.v : null;
  const anyFilter = minRating || fExt || fRes || fDur || fBright || fWarm || fSat || fOrient;
  const clearFilters = () => {
    setMinRating(0);
    setFExt("");
    setFRes("");
    setFDur("");
    setFBright("");
    setFWarm("");
    setFSat("");
    setFOrient("");
    setSmart("");
  };

  return (
    <div className="app" style={{ ["--thumb" as any]: `${thumbSize}px` }}>
      <div className={`splash ${booted ? "gone" : ""}`}>
        <div className="splash-prism">
          <span className="splash-rays" />
          <Logo size={108} />
        </div>
        <div className="splash-name">PRISMA</div>
        <div className="splash-bar">
          <div className="splash-bar-fill" />
        </div>
        <div className="splash-tag">{t("app.splashTag")}</div>
      </div>
      <header className="toolbar" data-tauri-drag-region>
        <div className="tb-left" data-tauri-drag-region>
          <TrafficLights />
          <div className="brand" data-tauri-drag-region>
            <Logo size={19} />
            <span className="brand-name">PRISMA</span>
          </div>
        </div>
        <div className="search-wrap" data-tauri-drag-region>
          <span className="search-icon" data-tauri-drag-region>
            <Icon name="search" size={15} />
          </span>
          <input
            ref={searchRef}
            className="search"
            placeholder={t("toolbar.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => fireTip("search", searchRef.current)}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery("")}>
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        <div className="tb-right" data-tauri-drag-region>
          <button className="icon-btn tb-gear" onClick={() => setShowSettings(true)} title={t("app.settings")}>
            <Icon name="sliders" size={16} />
          </button>
          <div className="add-wrap">
            <button ref={addBtnRef} className="btn-primary btn-add" onClick={() => setAddMenu((o) => !o)}>
              <Icon name="plus" size={15} />
              {t("app.add")}
              <Icon name="chevronUpDown" size={13} />
            </button>
            {addMenu &&
              addPos &&
              createPortal(
                <>
                  <div className="add-backdrop" onClick={() => setAddMenu(false)} />
                  <div className="add-menu" style={{ left: addPos.left, top: addPos.top }}>
                    <button onClick={addFolders}>
                      <Icon name="folder" size={15} /> {t("app.addFolders")} <span className="add-hint">{t("app.addFoldersHint")}</span>
                    </button>
                    <button onClick={addFromWeb}>
                      <Icon name="search" size={15} /> {t("app.addUrl")} <span className="add-hint">{t("app.addUrlHint")}</span>
                    </button>
                    <button onClick={addFiles}>
                      <Icon name="image" size={15} /> {t("app.addFiles")} <span className="add-hint">{t("app.addFilesHint")}</span>
                    </button>
                  </div>
                </>,
                document.body
              )}
          </div>
        </div>
      </header>

      <div className="filterbar">
        <span className="filter-ico">
          <Icon name="sliders" size={15} />
        </span>
        <PopupButton value={sort} options={SORT_OPTS} onChange={setSort} />
        <PopupButton value={fRes} options={RES_OPTS} onChange={setFRes} placeholder={t("filter.res")} />
        <PopupButton value={fDur} options={DUR_OPTS} onChange={setFDur} placeholder={t("filter.dur")} />
        <PopupButton value={fBright} options={BRIGHT_OPTS} onChange={setFBright} placeholder={t("filter.bright")} />
        <PopupButton value={fWarm} options={WARM_OPTS} onChange={setFWarm} placeholder={t("filter.warm")} />
        <PopupButton value={fSat} options={SAT_OPTS} onChange={setFSat} placeholder={t("filter.sat")} />
        <PopupButton value={fExt} options={extOpts} onChange={setFExt} placeholder={t("filter.ext")} />
        <div className="rating-filter" title={t("app.minRating")}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`rf-star ${minRating >= n ? "on" : ""}`}
              onClick={() => setMinRating(minRating === n ? 0 : n)}
            >
              <Icon name={minRating >= n ? "starFill" : "star"} size={14} />
            </span>
          ))}
        </div>
        {anyFilter ? (
          <button className="clear-filters" onClick={clearFilters}>
            {t("app.clearFilters")}
          </button>
        ) : null}
        <div className="result-count">{assets.length} {t("app.items")}</div>
        <div className="layout-toggle">
          {(["grid", "list", "waterfall"] as const).map((l) => (
            <button
              key={l}
              className={`layout-btn ${layout === l ? "on" : ""}`}
              title={l === "grid" ? t("app.layoutGrid") : l === "list" ? t("app.layoutList") : t("app.layoutWaterfall")}
              onClick={() => setLayout(l)}
            >
              <Icon name={l === "grid" ? "layoutGrid" : l === "list" ? "layoutList" : "layoutWaterfall"} size={15} />
            </button>
          ))}
          {view.t === "collection" && (
            <button
              className={`layout-btn ${boardMode ? "on" : ""}`}
              title={t("board.view")}
              onClick={() => setBoardMode((b) => !b)}
            >
              <Icon name="grip" size={15} />
            </button>
          )}
        </div>
        <div className="size-control" title={t("app.thumbSize")}>
          <button className="size-ico" onClick={() => setThumbSize(130)}>
            <Icon name="image" size={13} />
          </button>
          <input
            className="size-range"
            type="range"
            min={120}
            max={340}
            value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
          />
          <button className="size-ico" onClick={() => setThumbSize(320)}>
            <Icon name="image" size={18} />
          </button>
        </div>
      </div>

      {progress.active && (
        <div className="progress">
          <span className="progress-prism">
            <Logo size={16} />
          </span>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
            <div className="progress-shimmer" />
          </div>
          <span className="progress-label">
            {t("app.cataloging")} {progress.done.toLocaleString("pt-BR")}/{progress.total.toLocaleString("pt-BR")} · {pct}%
          </span>
        </div>
      )}

      <div className="body">
        <aside className="sidebar" ref={sidebarRef}>
          <div className="side-group">
            <SideItem
              icon="all"
              label={t("app.all")}
              count={counts.total}
              active={isView({ t: "all" })}
              onClick={() => setView({ t: "all" })}
            />
            <SideItem
              icon="tagSlash"
              label={t("app.untagged")}
              count={counts.untagged}
              active={isView({ t: "untagged" })}
              onClick={() => setView({ t: "untagged" })}
            />
            <SideItem
              icon="inbox"
              label={t("app.uncollected")}
              count={counts.uncollected}
              active={isView({ t: "uncollected" })}
              onClick={() => setView({ t: "uncollected" })}
            />
            <SideItem
              icon="shuffle"
              label={t("app.random")}
              count={counts.total}
              active={isView({ t: "random" })}
              onClick={() => setView({ t: "random" })}
            />
            {counts.dups > 0 && (
              <SideItem
                icon="dup"
                label={t("app.dups")}
                count={counts.dups}
                active={isView({ t: "dups" })}
                onClick={() => setView({ t: "dups" })}
              />
            )}
            <SideItem
              icon="trash"
              label={t("app.trash")}
              count={counts.trash}
              active={isView({ t: "trash" })}
              onClick={() => setView({ t: "trash" })}
            />
          </div>

          <div className="side-group">
            <div className="side-title">{t("side.smartShortcuts")}</div>
            {SMART_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`side-item ${smart === p.id ? "active" : ""}`}
                onClick={() => applySmart(p)}
              >
                <span className="side-ico">
                  <Icon name={p.icon} size={16} />
                </span>
                <span className="side-label">{p.label}</span>
              </button>
            ))}
          </div>

          {(hCounts.vfr || hCounts.banding || hCounts.proxy) ? (
            <div className="side-group">
              <div className="side-title">{t("side.health")}</div>
              {[
                { flag: "vfr", label: t("app.healthVfr"), icon: "refresh" as const },
                { flag: "banding", label: t("app.healthBanding"), icon: "image" as const },
                { flag: "proxy", label: t("app.healthProxy"), icon: "video" as const },
              ]
                .filter((s) => hCounts[s.flag])
                .map((s) => (
                  <button
                    key={s.flag}
                    className={`side-item ${isView({ t: "health", v: s.flag, label: s.label }) ? "active" : ""}`}
                    onClick={() =>
                      setView(
                        isView({ t: "health", v: s.flag, label: s.label })
                          ? { t: "all" }
                          : { t: "health", v: s.flag, label: s.label }
                      )
                    }
                  >
                    <span className="side-ico">
                      <Icon name={s.icon} size={16} />
                    </span>
                    <span className="side-label">{s.label}</span>
                    <span className="count">{hCounts[s.flag]}</span>
                  </button>
                ))}
            </div>
          ) : null}

          <div className="side-group">
            <div className="side-title side-title-row">
              {t("side.smartFolders")}
              <button className="side-add" title={t("app.newSmart")} onClick={() => setSmartBuilder({ editing: null })}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            {smartFolders.length === 0 && (
              <div className="side-hint">{t("app.smartHint")}</div>
            )}
            {smartFolders.map((sf) => (
              <div
                key={sf.id}
                className={`side-item coll-item ${isView({ t: "smart", v: sf.id, label: sf.name }) ? "active" : ""}`}
                onClick={() => setView({ t: "smart", v: sf.id, label: sf.name })}
              >
                <span className="side-ico">
                  <Icon name="sliders" size={16} />
                </span>
                <span className="side-label" onDoubleClick={(e) => { e.stopPropagation(); setSmartBuilder({ editing: sf }); }}>
                  {sf.name}
                </span>
                <span className="count">{sf.count}</span>
                <button
                  className="coll-del"
                  title={t("app.delete")}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSmart(sf.id).then(() => {
                      if (isView({ t: "smart", v: sf.id, label: sf.name })) setView({ t: "all" });
                      refreshMeta();
                    });
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
          </div>

          {folders.length > 0 && (
            <div className="side-group">
              <div className="side-title side-title-row">
                {t("app.folders")}
                <button
                  className="side-add"
                  title={showHidden ? t("app.hideHidden") : t("app.showHidden")}
                  onClick={() => setShowHidden((h) => !h)}
                >
                  <Icon name={showHidden ? "eye" : "eyeOff"} size={13} />
                </button>
              </div>
              <FolderTree
                dirs={folders}
                selected={folderSel}
                showHidden={showHidden}
                onSelect={(p) =>
                  setView(folderSel === p ? { t: "all" } : { t: "folder", v: p, label: p })
                }
                onAlias={(dir, alias) => setFolderAlias(dir, alias).then(refreshMeta)}
                onHide={(dir, hidden) => setFolderHidden(dir, hidden).then(refreshMeta)}
                onRescan={(dir) => rescanFolder(dir)}
                onColor={(dir, color) => setFolderColor(dir, color).then(refreshMeta)}
                onAutotag={(dir) => autotagFolder(dir).then(() => { runSearch(true); refreshMeta(); })}
                onRemoveFolder={(dir) => {
                  if (!window.confirm(t("app.removeFolderConfirm").replace("{x}", dir)))
                    return;
                  removeFolderLib(dir).then(() => {
                    if (folderSel === dir || (view.t === "folder" && view.v === dir)) setView({ t: "all" });
                    runSearch(true);
                    refreshMeta();
                  });
                }}
              />
            </div>
          )}

          <div className="side-group">
            <div className="side-title side-title-row">
              {t("app.collections")}
              <button className="side-add" onClick={addCollection} title={t("app.newCollection")}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            {collections.length === 0 && (
              <div className="side-hint">{t("app.collectionsHint")}</div>
            )}
            {collections.map((c) => (
              <div
                key={c.id}
                className={`side-item coll-item ${isView({ t: "collection", v: c.id, label: c.name }) ? "active" : ""}`}
                onClick={() => setView({ t: "collection", v: c.id, label: c.name })}
              >
                <span className="side-ico">
                  <Icon name="stack" size={16} />
                </span>
                {editingColl === c.id ? (
                  <input
                    className="coll-edit"
                    autoFocus
                    defaultValue={c.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== c.name) renameCollection(c.id, v).then(refreshMeta);
                      setEditingColl(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingColl(null);
                    }}
                  />
                ) : (
                  <span
                    className="side-label"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingColl(c.id);
                    }}
                  >
                    {c.name}
                  </span>
                )}
                <span className="count">{c.count}</span>
                <button
                  className="coll-del"
                  title={t("app.deleteCollection")}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCollection(c.id).then(() => {
                      if (inCollection === c.id) setView({ t: "all" });
                      refreshMeta();
                    });
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="side-group">
            <div className="side-title">{t("side.kinds")}</div>
            {CATEGORY_ORDER.map((c) => {
              const n = countMap.get(c) ?? 0;
              if (!n) return null;
              // "Outros" (desconhecidos): expansível, agrupado por extensão + sugestão.
              if (c === "unknown") {
                const exts = counts.by_unknown_ext;
                return (
                  <div key={c}>
                    <button
                      className={`side-item ${isView({ t: "kind", v: c }) ? "active" : ""}`}
                      onClick={() => {
                        setView({ t: "kind", v: c });
                        if (exts.length) setOthersOpen((o) => !o);
                      }}
                    >
                      <span className={`tree-caret ${exts.length ? "" : "leaf"} ${othersOpen ? "open" : ""}`}>
                        {exts.length ? "▸" : ""}
                      </span>
                      <span className="side-ico">
                        <Icon name="unknown" size={16} />
                      </span>
                      <span className="side-label">{CATEGORY_LABELS[c]}</span>
                      <span className="count">{n}</span>
                    </button>
                    {othersOpen &&
                      exts.map(([ext, cnt]) => (
                        <button
                          key={ext}
                          className={`side-item side-sub ${isView({ t: "ext", v: ext, label: ext }) ? "active" : ""}`}
                          title={extSuggestion(ext)}
                          onClick={() => setView({ t: "ext", v: ext, label: ext })}
                        >
                          <span className="side-sub-ext">.{ext}</span>
                          <span className="side-sub-sug">{extSuggestion(ext)}</span>
                          <span className="count">{cnt}</span>
                        </button>
                      ))}
                  </div>
                );
              }
              return (
                <SideItem
                  key={c}
                  icon={c as IconName}
                  label={CATEGORY_LABELS[c]}
                  count={n}
                  active={isView({ t: "kind", v: c })}
                  onClick={() => setView({ t: "kind", v: c })}
                />
              );
            })}
          </div>

          {counts.by_color.length > 0 && (
            <div className="side-group">
              <div className="side-title">{t("side.colors")}</div>
              <div className="palette">
                {counts.by_color.map(([b, n]) => (
                  <button
                    key={b}
                    className={`swatch ${isView({ t: "color", v: b }) ? "active" : ""}`}
                    title={`${b} · ${n}`}
                    style={{ background: COLOR_HEX[b] ?? "#888" }}
                    onClick={() =>
                      setView(isView({ t: "color", v: b }) ? { t: "all" } : { t: "color", v: b })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {tags.length > 0 && (
            <div className="side-group">
              <div className="side-title">{t("side.tags")}</div>
              {tags.map((t) => (
                <SideItem
                  key={t.id}
                  icon="tag"
                  label={t.name}
                  count={t.count}
                  active={isView({ t: "tag", v: t.id, label: t.name })}
                  onClick={() => setView({ t: "tag", v: t.id, label: t.name })}
                />
              ))}
            </div>
          )}
        </aside>

        <div
          className="sb-resize"
          title={t("app.resizeSidebar")}
          onMouseDown={(e) => {
            e.preventDefault();
            const move = (ev: MouseEvent) => {
              const w = Math.max(180, Math.min(460, ev.clientX));
              document.documentElement.style.setProperty("--sb", `${w}px`);
            };
            const up = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
              const cur = getComputedStyle(document.documentElement).getPropertyValue("--sb").trim();
              try {
                localStorage.setItem("prisma.sb", cur);
              } catch {
                /* ignora */
              }
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
        />

        <main className="grid-area">
          {view.t === "similar" && (
            <div className="trash-banner similar-banner">
              <span>{t("ban.similar")} <b>{view.label}</b></span>
              <label className="sim-thresh" title={t("ban.simThreshold")}>
                <span>{t("ban.simStrict")}</span>
                <input
                  type="range"
                  min={6}
                  max={40}
                  value={simThreshold}
                  onChange={(e) => setSimThreshold(Number(e.target.value))}
                />
                <span>{t("ban.simLoose")}</span>
              </label>
              <button className="trash-empty similar-back" onClick={() => setView({ t: "all" })}>
                <Icon name="chevronLeft" size={13} /> {t("ban.back")}
              </button>
            </div>
          )}
          {view.t === "dups" && assets.length > 0 && (
            <div className="trash-banner dups-banner">
              <span>{t("ban.dups")}</span>
              <button
                className="trash-empty dups-keep"
                onClick={() => removeWithAnim(() => dedupeKeepOne().then(clearSelection))}
              >
                <Icon name="dup" size={13} /> {t("ban.keepOne")}
              </button>
            </div>
          )}
          {view.t === "trash" && assets.length > 0 && (
            <div className="trash-banner">
              <span>{t("ban.trash")}</span>
              <button
                className="trash-empty"
                onClick={() => removeWithAnim(() => emptyTrash().then(() => setSelected(null)))}
              >
                <Icon name="trash" size={13} /> {t("ban.empty")}
              </button>
            </div>
          )}
          {view.t === "folder" && subCards.length > 0 && (
            <div className="subfolders">
              <div className="subfolders-title">{t("app.subfolders")} ({subCards.length})</div>
              <div className="subfolders-row">
                {subCards.map((s) => {
                  const cover = s.cover ? convertFileSrc(s.cover) : null;
                  return (
                    <button
                      key={s.dir}
                      className="subcard"
                      style={s.color ? { borderColor: s.color } : undefined}
                      onClick={() => setView({ t: "folder", v: s.dir, label: s.name })}
                      title={s.name}
                    >
                      <div className="subcard-cover">
                        {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name="folder" size={26} />}
                        <span className="subcard-count">{s.count}</span>
                      </div>
                      <div className="subcard-name">{s.name}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className={`view-fade${switching ? " anim-in" : ""}${clearing ? " clearing" : ""}`}>
            {progress.active && assets.length === 0 ? (
              <div className="indexing-loader">
                <div className="il-prism">
                  <span className="il-rays" />
                  <Logo size={68} />
                </div>
                <div className="il-title">{t("app.catalogingAssets")}</div>
                <div className="il-count">
                  {progress.done.toLocaleString("pt-BR")} / {progress.total.toLocaleString("pt-BR")} · {pct}%
                </div>
                <div className="il-bar">
                  <div className="il-fill" style={{ width: `${pct}%` }} />
                  <div className="il-shimmer" />
                </div>
                <div className="il-sub">{t("app.catalogingNote")}</div>
              </div>
            ) : assets.length === 0 ? (
              <div className="empty">
                <Logo size={54} />
                <h2>{t("empty.title")}</h2>
                <p>{t("empty.sub")}</p>
                <button className="btn-primary" onClick={addFolders}>
                  {t("empty.add")}
                </button>
              </div>
            ) : boardMode && view.t === "collection" ? (
              <Moodboard collectionId={view.v} assets={assets} />
            ) : layout === "list" ? (
              <Virtuoso
                ref={gridRef}
                style={{ height: "100%" }}
                totalCount={assets.length}
                overscan={600}
                endReached={() => runSearch(false)}
                computeItemKey={(i) => assets[i]?.id ?? i}
                itemContent={(i) => (
                  <AssetRow
                    asset={assets[i]}
                    selected={selectedIds.has(assets[i].id) || selected?.id === assets[i].id}
                    onClick={(a, e) => handleCardClick(a, e, i)}
                    onPreview={setPreviewAsset}
                    onContext={openCtx}
                    animDelayMs={Math.min(i, 18) * 18}
                  />
                )}
              />
            ) : layout === "waterfall" ? (
              <div
                className="waterfall"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  if (el.scrollTop + el.clientHeight > el.scrollHeight - 700) runSearch(false);
                }}
              >
                {assets.map((a, i) => (
                  <div className="wf-item" key={a.id}>
                    <AssetCard
                      asset={a}
                      selected={selectedIds.has(a.id) || selected?.id === a.id}
                      onClick={(x, e) => handleCardClick(x, e, i)}
                      onPreview={setPreviewAsset}
                      onContext={openCtx}
                      aspect={a.width && a.height ? `${a.width} / ${a.height}` : "1 / 1"}
                      animDelayMs={Math.min(i, 14) * 25}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <VirtuosoGrid
                ref={gridRef}
                style={{ height: "100%" }}
                totalCount={assets.length}
                overscan={500}
                endReached={() => runSearch(false)}
                computeItemKey={(i) => assets[i]?.id ?? i}
                listClassName="grid"
                itemContent={(i) => (
                  <AssetCard
                    asset={assets[i]}
                    selected={selectedIds.has(assets[i].id) || selected?.id === assets[i].id}
                    onClick={(a, e) => handleCardClick(a, e, i)}
                    onPreview={setPreviewAsset}
                    onContext={openCtx}
                    reorder={inCollection !== null ? { index: i, onReorder } : undefined}
                    animDelayMs={Math.min(i, 14) * 25}
                  />
                )}
              />
            )}
          </div>

          {previewAsset && (
            <Preview asset={previewAsset} onClose={() => setPreviewAsset(null)} onNav={navPreview} />
          )}
        </main>

        {selected && selectedIds.size <= 1 && (
          <Inspector
            key={selected.id}
            asset={selected}
            collections={collections}
            inCollection={inCollection}
            inTrash={view.t === "trash"}
            onRemoveFromCollection={(cid, aid) =>
              removeFromCollection(cid, aid).then(onMutate)
            }
            onFindSimilar={(a) =>
              setView({ t: "similar", v: a.id, label: a.name || a.filename })
            }
            onOpenSettings={() => setShowSettings(true)}
            onClose={() => setSelected(null)}
            onPreview={setPreviewAsset}
            onMutate={onMutate}
          />
        )}
      </div>

      {dupPairs && (
        <DupModal
          pairs={dupPairs}
          onDone={() => {
            setDupPairs(null);
            onMutate();
          }}
        />
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {welcome && (
        <WelcomeModal
          onClose={() => {
            markWelcomed();
            setWelcome(false);
          }}
        />
      )}
      {tip && <Coachmark id={tip.id} rect={tip.rect} onClose={() => setTip(null)} />}
      <UpdateBanner />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems(ctxMenu.asset)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {aiProgress && (
        <div className="ai-progress-pill">
          <span className="ai-pill-dot" />
          {t("app.aiAnalyzing")} {aiProgress.done}/{aiProgress.total}
        </div>
      )}

      {proxyProgress && (
        <div className="ai-progress-pill proxy-pill">
          <span className="ai-pill-dot" />
          {t("app.proxyGenerating")} {proxyProgress.done}/{proxyProgress.total}
        </div>
      )}

      {healthProgress && (
        <div className="ai-progress-pill health-pill">
          <span className="ai-pill-dot" />
          {t("app.healthScanning")} {healthProgress.done}/{healthProgress.total}
        </div>
      )}

      {smartBuilder && (
        <SmartBuilder
          editing={smartBuilder.editing}
          onClose={() => setSmartBuilder(null)}
          onSaved={() => {
            setSmartBuilder(null);
            refreshMeta();
          }}
        />
      )}

      {markup && <Markup asset={markup} onClose={() => setMarkup(null)} onSaved={onMutate} />}

      {batchRename && (
        <BatchRename
          assets={assets.filter((a) => selectedIds.has(a.id))}
          onClose={() => setBatchRename(false)}
          onDone={() => {
            onMutate();
          }}
        />
      )}

      {selectedIds.size > 1 && (
        <div className="batch-bar">
          <span className="batch-count">{selectedIds.size} {t("batch.selected")}</span>
          <div className="batch-sep" />
          {collections.length > 0 && (
            <PopupButton
              value=""
              options={[["", t("batch.addCollection")], ...collections.map((c) => [String(c.id), c.name] as [string, string])]}
              onChange={(v) => v && batchAddCollection(Number(v))}
              placeholder={t("batch.addCollection")}
            />
          )}
          <PopupButton
            value=""
            options={[["", t("batch.exportAs")], ["png", "PNG"], ["jpg", "JPG"], ["webp", "WebP"], ["tiff", "TIFF"]]}
            onChange={(fmt) => fmt && batchExport(fmt)}
            placeholder={t("batch.exportAs")}
          />
          <button className="batch-clear" onClick={() => setBatchRename(true)}>
            <Icon name="pencil" size={13} /> {t("batch.rename")}
          </button>
          <button
            className="batch-clear"
            title={t("batch.nleHint")}
            onClick={async () => {
              const p = await saveDialog({
                defaultPath: "prisma.fcpxml",
                filters: [{ name: "FCPXML", extensions: ["fcpxml"] }],
              });
              if (typeof p === "string") {
                try {
                  await exportNle([...selectedIds], p);
                } catch (e) {
                  window.alert(`${t("common.error")}: ${String(e)}`);
                }
              }
            }}
          >
            <Icon name="reveal" size={13} /> {t("batch.nle")}
          </button>
          <button
            className="batch-clear"
            title={t("app.join")}
            onClick={() => {
              const paths = assets.filter((a) => selectedIds.has(a.id) && a.type === "video").map((a) => a.path);
              if (paths.length > 1) concatRun(paths);
              clearSelection();
            }}
          >
            <Icon name="layoutList" size={13} /> {t("batch.join")}
          </button>
          <button
            className="batch-ai"
            onClick={() => {
              aiAnalyzeMany([...selectedIds]);
              clearSelection();
            }}
            title={t("app.aiHint")}
          >
            <Icon name="sliders" size={13} /> {t("batch.ai")}
          </button>
          <button className="batch-item" onClick={batchFixCfr} title={t("app.vfrCfr")}>
            <Icon name="refresh" size={13} /> {t("batch.fixCfr")}
          </button>
          <button className="batch-trash" onClick={batchTrash}>
            <Icon name="trash" size={13} /> {t("batch.trash")}
          </button>
          <button className="batch-clear" onClick={clearSelection}>
            {t("batch.clear")}
          </button>
        </div>
      )}

      {Object.keys(jobs).length > 0 && (
        <div className="jobs-panel">
          <div className="jobs-title">{t("app.jobs")}</div>
          {Object.entries(jobs).map(([id, j]) => (
            <div key={id} className={`job job-${j.status}`}>
              <div className="job-head">
                <span className="job-label">{j.label}</span>
                {j.status === "run" && (
                  <button className="job-cancel" onClick={() => oficinaCancel(Number(id))}>
                    <Icon name="close" size={11} />
                  </button>
                )}
              </div>
              <div className="job-bar">
                <div className="job-fill" style={{ width: `${j.pct}%` }} />
              </div>
              <div className="job-status">
                {j.status === "done"
                  ? t("app.jobDone")
                  : j.status === "error"
                  ? j.message || t("app.jobError")
                  : `${Math.round(j.pct)}%`}
              </div>
              {j.status === "done" && j.output && (
                <button className="job-open" onClick={() => revealInExplorer(j.output!)}>
                  <Icon name="reveal" size={12} /> {t("app.openFolder")} {j.output.split("\\").pop()}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SideItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`side-item ${active ? "active" : ""}`} onClick={onClick}>
      <span className="side-ico">
        <Icon name={icon} size={16} />
      </span>
      <span className="side-label">{label}</span>
      <span className="count">{count}</span>
    </button>
  );
}
