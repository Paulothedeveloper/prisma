// DEV-ONLY: faz o app renderizar no NAVEGADOR (sem runtime Tauri) pra inspecionar layout.
// Só ativa quando import.meta.env.DEV E não há __TAURI_INTERNALS__ real → em `tauri dev`
// e no build de produção isto NÃO instala nada (e o corpo é tree-shaken fora do bundle).
// Os nomes são propositalmente LONGOS pra estressar overflow/ellipsis/borda.

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  // pula onboarding (boas-vindas + popovers de dica) pra inspecionar a UI limpa
  try {
    localStorage.setItem("prisma.welcomed", "1");
    localStorage.setItem("prisma.tips.disabled", "1");
  } catch { /* ignora */ }

  const ph = (w: number, h: number, label: string) =>
    `data:image/svg+xml;utf8,` +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='#3a3a3c'/><text x='50%' y='50%' fill='#98989d' font-size='14' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`
    );

  const mkAsset = (id: number, filename: string, type: string, ext: string) => ({
    id,
    path: `F:\\EDIÇÃO VIDEO\\PROJETOS\\${filename}`,
    dir: "F:\\EDIÇÃO VIDEO\\PROJETOS",
    filename,
    name: null,
    ext,
    type,
    size: 1024 * 1024 * (3 + id),
    modified_at: 1719500000 + id * 1000,
    width: 1920,
    height: 1080,
    duration: type === "video" ? 12.5 : null,
    rating: id % 6,
    notes: null,
    dominant_color: "#7a5cff",
    color_bucket: "purple",
    thumbnail_path: `thumb${id}`,
    proxy_path: null,
    health_level: id % 3 === 0 ? "yellow" : "green",
    health_flags: id % 3 === 0 ? "vfr,banding" : null,
    seq_frames: null,
    live_motion: null,
    favorite: id % 4 === 0,
  });

  const assets = [
    mkAsset(1, "TRANSIÇÃO_GLITCH_RGB_4K_PRORES_FINAL_revisado_v3.mov", "video", "mov"),
    mkAsset(2, "background_loop_partículas_douradas_4096x2160.mp4", "video", "mp4"),
    mkAsset(3, "Logo_Cliente_AcmeCorporation_VetorEditável.png", "image", "png"),
    mkAsset(4, "trilha_sonora_épica_cinematográfica_master.wav", "audio", "wav"),
    mkAsset(5, "IMG_20260627_ensaio_externo_golden_hour_0042.jpg", "image", "jpg"),
    mkAsset(6, "lower_third_animado_nome_e_cargo_template.aep", "design", "aep"),
    mkAsset(7, "captura_de_tela_referência_2026-06-27.png", "image", "png"),
    mkAsset(8, "B-ROLL_drone_litoral_amanhecer_LOG_HLG.mov", "video", "mov"),
  ];

  const folders = [
    { dir: "F:\\EDIÇÃO VIDEO\\TRANSIÇÕES E EFEITOS VISUAIS", count: 248, alias: null, hidden: false, cover: null, color: "#0a84ff" },
    { dir: "D:\\EDIÇÃO VIDEO\\BACKGROUNDS", count: 0, alias: null, hidden: false, cover: null, color: null },
    { dir: "F:\\ASSETS\\AFFINITY DESIGNER PROJETOS BRANDING", count: 73, alias: "Branding", hidden: false, cover: null, color: "#ff9f0a" },
    { dir: "D:\\TRILHAS E EFEITOS SONOROS SEM COPYRIGHT", count: 512, alias: null, hidden: false, cover: null, color: "#30d158" },
  ];

  const counts = {
    total: 833,
    dups: 12,
    untagged: 47,
    uncollected: 90,
    trash: 3,
    by_type: [["video", 410], ["image", 290], ["audio", 90], ["design", 43]] as [string, number][],
    by_color: [["purple", 120], ["blue", 98], ["green", 60]] as [string, number][],
    by_ext: [["mov", 210], ["mp4", 200], ["png", 180], ["jpg", 110], ["wav", 70]] as [string, number][],
    by_unknown_ext: [] as [string, number][],
  };

  const tags = [
    { id: 1, name: "cinematográfico", color: "#0a84ff", count: 42 },
    { id: 2, name: "transição", color: "#ff9f0a", count: 31 },
    { id: 3, name: "referência de branding", color: "#30d158", count: 18 },
    { id: 4, name: "som ambiente", color: null, count: 9 },
  ];

  // DEV: ?folders na URL → simula uma pasta que só tem subpastas (view .only-subs),
  // com nomes de tamanhos variados (inclusive longos) pra testar resize/esmagamento.
  const mockFoldersOnly = location.search.includes("folders");
  const subNames = [
    "CINEMATICO E TRAILER", "CLASSICAS E FAMOSAS", "DIVERSOS", "ESPORTE E TREINO",
    "FESTAS E DATAS", "FUNK POP E UPBEAT", "HIP HOP E TRAP", "LOFI E CHILL",
    "SAMBA E BRASIL", "SAMPLES E LOOPS", "SEM COPYRIGHT E INSTRUMENTAL", "ROCK CLASSICO NACIONAL E INTERNACIONAL",
  ];
  const subFolders = subNames.map((name, i) => ({
    dir: "F:\\MUSICAS\\" + name,
    name,
    count: [436, 1918, 496, 153, 4, 467, 377, 428, 2, 972, 2384, 88][i],
    cover: null,
    color: null,
  }));

  const handlers: Record<string, (a: any) => any> = {
    feature_flags: () => ({ tier: "core", ai_analysis: true, color_plan: true, oficina_encode: true, motionsilk: true, sync_catalog: true }),
    get_folders: () => folders,
    get_counts: () => counts,
    search_assets: () => (mockFoldersOnly ? [] : assets),
    subfolders: () => subFolders,
    search_folders: () => [],
    list_tags: () => tags,
    tags_for_asset: () => tags.slice(0, 2),
    list_collections: () => [{ id: 1, name: "Moodboard — Campanha Verão 2026", count: 24 }],
    list_smart: () => [{ id: 1, name: "Vídeos 4K sem proxy ainda", match_mode: "all", rules: "[]", count: 16 }],
    list_presets: () => [],
    offline_roots_detail: () => [{ root: "F:\\", count: 248 }, { root: "D:\\EDIÇÃO VIDEO\\BACKGROUNDS", count: 0 }],
    offline_dirs: () => ["D:\\EDIÇÃO VIDEO\\BACKGROUNDS"],
    favorites_count: () => 14,
    cloud_folders: () => [{ name: "OneDrive", path: "C:\\Users\\Voce\\OneDrive" }, { name: "Google Drive", path: "G:\\Meu Drive" }],
    vault_status: () => ({ path: "D:\\VAULTS\\WINDOWS - DAVINCI RESOLVE", count: 320 }),
    quartzo_get_vault: () => "D:\\VAULTS\\WINDOWS - DAVINCI RESOLVE",
    quartzo_notes: () => [],
    ai_status: () => ({ has_key: true, model: "claude-opus-4-8", autotag_on_import: true, auto_proxy_on_import: false }),
    ai_pending_count: () => 5,
    clip_status: () => ({ done: 600, total: 833 }),
    health_counts: () => ({ red: 4, yellow: 23, green: 806 }),
    get_proxy: () => null,
    get_asset: (a) => assets.find((x) => x.id === a?.id) ?? null,
    collections_for_asset: () => [1],
  };

  const internals = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    convertFileSrc: (p: string) => {
      if (p && p.startsWith("thumb")) return ph(400, 300, p);
      return p;
    },
    transformCallback: (cb?: (v: unknown) => void) => {
      const id = Math.floor(Math.random() * 1e9);
      (window as any)[`_${id}`] = cb ?? (() => {});
      return id;
    },
    invoke: async (cmd: string, args: any) => {
      if (cmd.startsWith("plugin:")) {
        // eventos/janela/dialog: devolve algo inócuo
        if (cmd.includes("event|listen")) return Math.floor(Math.random() * 1e9);
        return null;
      }
      const h = handlers[cmd];
      if (h) return h(args);
      // default seguro: número→0, lista esperada→[]; devolvemos null e o app degrada
      return null;
    },
  };
  (window as any).__TAURI_INTERNALS__ = internals;
  // eslint-disable-next-line no-console
  console.log("[devmock] Tauri mock ativo (apenas navegador/dev).");
}

export {};
