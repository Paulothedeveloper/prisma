import { invoke } from "@tauri-apps/api/core";

export interface Asset {
  id: number;
  path: string;
  dir: string | null;
  filename: string;
  name: string | null;
  ext: string;
  type: string;
  size: number;
  modified_at: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  rating: number;
  notes: string | null;
  dominant_color: string | null;
  color_bucket: string | null;
  thumbnail_path: string | null;
  proxy_path: string | null;
  health_level: string | null; // red | yellow | green
  health_flags: string | null; // CSV: vfr,banding,proxy...
  seq_frames: number | null; // nº de frames se for uma image sequence
  live_motion: string | null; // caminho do .mov do par Live Photo (toca no hover)
  favorite: boolean; // marcado como favorito (estrela rápida → aba "Favoritos")
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  count: number;
}

export interface Counts {
  total: number;
  dups: number;
  untagged: number;
  uncollected: number;
  trash: number;
  by_type: [string, number][];
  by_color: [string, number][];
  by_ext: [string, number][];
  by_unknown_ext: [string, number][];
}

export interface FolderRow {
  dir: string;
  count: number;
  alias: string | null;
  hidden: boolean;
  cover: string | null;
  color: string | null;
}

export interface SubCard {
  dir: string;
  name: string;
  count: number;
  cover: string | null;
  color: string | null;
}

export interface Filter {
  query: string;
  kind: string | null;
  min_rating: number | null;
  tag_id: number | null;
  color_bucket: string | null;
  folder: string | null;
  ext: string | null;
  res: string | null;
  min_duration: number | null;
  max_duration: number | null;
  dups_only: boolean;
  trashed: boolean;
  untagged: boolean;
  uncollected: boolean;
  favorites: boolean;
  random: boolean;
  collection: number | null;
  bright: string | null;
  warm: string | null;
  sat: string | null;
  orient: string | null;
  health_flag: string | null;
  sort: string | null;
  limit: number;
  offset: number;
}

export interface Collection {
  id: number;
  name: string;
  count: number;
}

export interface DupPair {
  existing: Asset;
  incoming: Asset;
}

// ----- MediaInfo / CST -----
export interface VideoInfo {
  codec: string | null;
  profile: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  r_fps: number | null;
  vfr: boolean;
  bit_depth: number | null;
  chroma: string | null;
  rotation: number | null;
  bitrate: number | null;
  color_primaries: string | null;
  transfer: string | null;
  matrix: string | null;
  range: string | null;
}
export interface AudioInfo {
  codec: string | null;
  channels: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
}
export interface CameraInfo {
  make: string | null;
  model: string | null;
  iso: string | null;
  shutter: string | null;
  fnumber: string | null;
  white_balance: string | null;
  lens: string | null;
  focus: string | null;
  date: string | null;
}
export interface CstRec {
  needs_cst: boolean;
  determinate: boolean;
  input_color_space: string | null;
  input_gamma: string | null;
  output: string;
  tone_mapping: boolean;
  summary: string;
  copy_text: string;
}
export interface MediaInfo {
  ok: boolean;
  container: string | null;
  duration: number | null;
  size: number;
  overall_bitrate: number | null;
  video: VideoInfo | null;
  audio: AudioInfo | null;
  camera: CameraInfo | null;
  cst: CstRec;
  warnings: string[];
  has_gyro: boolean;
  health: HealthFinding[];
  playbook: Playbook | null;
}

export interface HealthFinding {
  level: "red" | "yellow" | "green";
  label: string;
  detail: string;
  fix: string | null; // "cfr" | "banding" | "proxy" | null
  key: string; // token estável p/ traduzir (health.<key>.label/detail)
  arg: string | null; // valor dinâmico ({x})
}

export interface Playbook {
  kind: string;
  steps: string[];
}

export interface JobOpts {
  fps?: number | null;
  crf?: number | null;
  codec?: string | null;
  smoothness?: number | null;
  // Gyroflow Fase 2 (controle completo):
  fov?: number | null;
  horizon_lock?: number | null;
  lens_correction?: number | null;
  gyro_codec?: string | null;
  sync_search?: number | null;
}

// ----- Mutações consolidadas (Bloco 2) -----
// Uma só ida ao backend pra editar vários campos. Preferir estes aos setters avulsos
// (set_rating/set_notes/etc. seguem existindo como aliases por compatibilidade).
export interface AssetPatch {
  rating?: number;
  notes?: string;
  name?: string; // "" limpa (volta ao nome do arquivo)
  trashed?: boolean;
  add_tags?: string[];
  remove_tag_ids?: number[];
}
export const mutateAsset = (id: number, patch: AssetPatch) =>
  invoke<void>("mutate_asset", { id, patch });

export interface FolderPatch {
  alias?: string; // "" limpa
  hidden?: boolean;
  color?: string; // "" limpa
  cover?: string; // "" limpa
}
export const folderMeta = (dir: string, patch: FolderPatch) =>
  invoke<void>("folder_meta", { dir, patch });

export const indexPath = (path: string) => invoke<void>("index_path", { path });
// Um asset pelo id (usado pelo deep-link prisma://asset/<id>).
export const getAsset = (id: number) => invoke<Asset | null>("get_asset", { id });
// Varre os caminhos antes de catalogar: quantos são mídia compatível e quantos seriam recusados.
export interface ImportScan {
  compatible: number;
  skipped: number;
}
export const countImportable = (paths: string[]) =>
  invoke<ImportScan>("count_importable", { paths });
// Pausa/retoma o trabalho pesado de fundo (a UI pausa ao abrir caixas de diálogo).
export const setImportPaused = (paused: boolean) =>
  invoke<void>("set_import_paused", { paused });
// Cancela a importação/processamento em andamento (o que já foi catalogado permanece).
export const cancelImport = () => invoke<void>("cancel_import");
export const searchAssets = (filter: Filter) =>
  invoke<Asset[]>("search_assets", { filter });
export const getCounts = () => invoke<Counts>("get_counts");
export const getFolders = () => invoke<FolderRow[]>("get_folders");
export const rescanFolder = (dir: string) => invoke<void>("rescan_folder", { dir });
export const setFolderAlias = (dir: string, alias: string | null) =>
  invoke<void>("set_folder_alias", { dir, alias });
export const setFolderHidden = (dir: string, hidden: boolean) =>
  invoke<void>("set_folder_hidden", { dir, hidden });
export const setFolderCover = (dir: string, cover: string | null) =>
  invoke<void>("set_folder_cover", { dir, cover });
export const setFolderColor = (dir: string, color: string | null) =>
  invoke<void>("set_folder_color", { dir, color });
export const subfolders = (parent: string) => invoke<SubCard[]>("subfolders", { parent });
export const searchFolders = (query: string, scope: string | null) =>
  invoke<SubCard[]>("search_folders", { query, scope });

// ----- Video Downloader (yt-dlp nativo) -----
export interface DownloadInfo {
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
}
export const videoDownloadInfo = (url: string) =>
  invoke<DownloadInfo>("video_download_info", { url });
export const videoDownload = (url: string, audioOnly: boolean, quality = "best") =>
  invoke<string>("video_download", { url, audioOnly, quality });

// ----- Letras sincronizadas (LRC) -----
export interface LyricLine {
  t: number;
  text: string;
}
export const fetchLyrics = (artist: string, title: string) =>
  invoke<LyricLine[]>("fetch_lyrics", { artist, title });

export const autotagFolder = (dir: string) => invoke<number>("autotag_folder", { dir });
export const pasteImage = (data: number[]) => invoke<string>("paste_image", { data });
export const addFromUrl = (url: string) => invoke<string>("add_from_url", { url });

// ----- Moodboard (quadro livre de uma coleção) -----
export interface BoardItem {
  asset_id: number;
  x: number;
  y: number;
  w: number;
  z: number;
}
export const boardLayout = (collectionId: number) =>
  invoke<BoardItem[]>("board_layout", { collectionId });
export const setBoardItem = (
  collectionId: number,
  assetId: number,
  x: number,
  y: number,
  w: number,
  z: number
) => invoke<void>("set_board_item", { collectionId, assetId, x, y, w, z });

// ----- Export pro NLE (FCPXML) -----
export const exportNle = (assetIds: number[], dest: string) =>
  invoke<number>("export_nle", { assetIds, dest });

// ----- Catálogo de drives offline -----
export const offlineDirs = () => invoke<string[]>("offline_dirs");
export const saveAnnotated = (nearPath: string, data: number[]) =>
  invoke<string>("save_annotated", { nearPath, data });

// ----- Sync notebook↔desktop (metadados por hash) -----
export const exportCatalog = (path: string) => invoke<number>("export_catalog", { path });
export const importCatalog = (path: string) => invoke<number>("import_catalog", { path });
export interface OfflineRoot {
  root: string;
  count: number;
}
export interface RelinkResult {
  relinked: number;
  missing: number;
}
export const offlineRootsDetail = () => invoke<OfflineRoot[]>("offline_roots_detail");
export const relinkRoot = (oldRoot: string, newRoot: string) =>
  invoke<RelinkResult>("relink_root", { oldRoot, newRoot });
export const relinkSearch = (oldRoot: string, searchDir: string) =>
  invoke<RelinkResult>("relink_search", { oldRoot, searchDir });
export interface CloudFolder {
  name: string;
  path: string;
}
export const cloudFolders = () => invoke<CloudFolder[]>("cloud_folders");
export const backupCatalog = (dest: string) => invoke<void>("backup_catalog", { dest });
export const restoreCatalog = (src: string) => invoke<void>("restore_catalog", { src });
export const trashAsset = (id: number, trashed: boolean) =>
  invoke<void>("trash_asset", { id, trashed });
// Lixeira por CAMINHO (robusto a id obsoleto — arquivos grandes "tocados" pelo AV mudam de id)
export const trashPaths = (paths: string[], trashed: boolean) =>
  invoke<number>("trash_paths", { paths, trashed });
export const emptyTrash = () => invoke<number>("empty_trash");
export const dedupeKeepOne = () => invoke<number>("dedupe_keep_one");

// ----- Ações de item (estilo Eagle) -----
export const renameAsset = (id: number, name: string) =>
  invoke<void>("rename_asset", { id, name });
export const duplicateAsset = (id: number) => invoke<void>("duplicate_asset", { id });
export const refreshThumb = (id: number) => invoke<void>("refresh_thumb", { id });
export const setCustomThumb = (id: number, source: string) =>
  invoke<void>("set_custom_thumb", { id, source });
export const similarAssets = (id: number, limit = 60, maxDist = 22) =>
  invoke<Asset[]>("similar_assets", { id, limit, maxDist });

// ----- Batch Rename (renomeia o arquivo no disco) -----
export interface RenameResult {
  id: number;
  old_path: string;
  new_path: string;
  ok: boolean;
  error: string | null;
}
export const renameFiles = (items: { id: number; new_name: string }[]) =>
  invoke<RenameResult[]>("rename_files", { items });
export const probeMedia = (path: string) =>
  invoke<MediaInfo>("probe_media", { path });
export const revealInExplorer = (path: string) =>
  invoke<void>("reveal_in_explorer", { path });
// Abre a mídia no player/app padrão do sistema (não a pasta).
export const openExternal = (path: string) =>
  invoke<void>("open_external", { path });
// Redefine o app do zero (zera catálogo + caches; mantém a chave da API) e reinicia.
export const resetApp = () => invoke<void>("reset_app");
// Recarrega/gera os proxies que faltam (caso algum tenha falhado). Retorna quantos entraram na fila.
export const regenProxies = () => invoke<number>("regen_proxies");
// Remove a pasta da BIBLIOTECA (catálogo) — não apaga do disco. Retorna quantos assets saíram.
export const removeFolderLib = (dir: string) => invoke<void>("remove_folder_lib", { dir });
export const setRating = (id: number, rating: number) =>
  invoke<void>("set_rating", { id, rating });
export const setNotes = (id: number, notes: string) =>
  invoke<void>("set_notes", { id, notes });
export const setFavorite = (id: number, fav: boolean) =>
  invoke<void>("set_favorite", { id, fav });
export const setFavoriteMany = (ids: number[], fav: boolean) =>
  invoke<void>("set_favorite_many", { ids, fav });
export const tagMany = (ids: number[], name: string, color: string | null) =>
  invoke<number>("tag_many", { ids, name, color });
export const favoritesCount = () => invoke<number>("favorites_count");
export const listTags = () => invoke<Tag[]>("list_tags");
export const tagsForAsset = (id: number) =>
  invoke<Tag[]>("tags_for_asset", { id });
export const addTag = (id: number, name: string, color: string | null) =>
  invoke<number>("add_tag", { id, name, color });
export const removeTag = (id: number, tagId: number) =>
  invoke<void>("remove_tag", { id, tagId });

// ----- OFICINA -----
export const oficinaRun = (op: string, input: string, opts: JobOpts = {}) =>
  invoke<number>("oficina_run", { op, input, opts });

// Codificador avançado (estilo HandBrake / Shutter Encoder)
export interface EncodeOpts {
  container?: string | null;
  vcodec?: string | null;
  scale?: string | null;
  fps?: number | null;
  crf?: number | null;
  preset?: string | null;
  acodec?: string | null;
  abitrate?: number | null;
  deinterlace?: boolean;
  denoise?: boolean;
  grayscale?: boolean;
  flip_h?: boolean;
  rotate?: number | null;
  op?: string | null;
  lufs?: number | null;
  trim_in?: number | null;
  trim_out?: number | null;
  lut_path?: string | null;
  speed?: number | null;
  watermark_path?: string | null;
}
export const encodeRun = (input: string, opts: EncodeOpts) =>
  invoke<number>("encode_run", { input, opts });
export const concatRun = (inputs: string[]) => invoke<number>("concat_run", { inputs });

export interface EncoderPreset {
  id: number;
  name: string;
  opts: string; // JSON de EncodeOpts
}
export const listPresets = () => invoke<EncoderPreset[]>("list_presets");
export const savePreset = (name: string, opts: string) =>
  invoke<number>("save_preset", { name, opts });
export const deletePreset = (id: number) => invoke<void>("delete_preset", { id });

export const oficinaCancel = (job: number) =>
  invoke<void>("oficina_cancel", { job });

export const openGyroflow = (path: string) =>
  invoke<void>("open_gyroflow", { path });

export const getProxy = (path: string) =>
  invoke<string | null>("get_proxy", { path });
// Gera o proxy de UM vídeo sob demanda (pro preview tocar inline). Devolve o caminho do proxy.
export const makeProxy = (id: number) => invoke<string | null>("make_proxy", { id });

// ----- Coleções (organização livre) -----
export const listCollections = () => invoke<Collection[]>("list_collections");
export const createCollection = (name: string) =>
  invoke<number>("create_collection", { name });
export const renameCollection = (id: number, name: string) =>
  invoke<void>("rename_collection", { id, name });
export const deleteCollection = (id: number) =>
  invoke<void>("delete_collection", { id });
export const addToCollection = (collectionId: number, assetIds: number[]) =>
  invoke<void>("add_to_collection", { collectionId, assetIds });
export const removeFromCollection = (collectionId: number, assetId: number) =>
  invoke<void>("remove_from_collection", { collectionId, assetId });
export const reorderCollection = (collectionId: number, ordered: number[]) =>
  invoke<void>("reorder_collection", { collectionId, ordered });
export const collectionsForAsset = (id: number) =>
  invoke<number[]>("collections_for_asset", { id });

// Ícone genérico de arrasto (fallback quando o asset não tem miniatura).
export const dragIcon = () => invoke<string>("drag_icon");

// ----- Smart Folders (pastas inteligentes) -----
export interface SmartRule {
  field: string;
  op: string;
  value: string;
}
export interface SmartFolder {
  id: number;
  name: string;
  match_mode: string; // all | any
  rules: string; // JSON de SmartRule[]
  count: number;
}
export const listSmart = () => invoke<SmartFolder[]>("list_smart");
export const createSmart = (name: string, matchMode: string, rules: string) =>
  invoke<number>("create_smart", { name, matchMode, rules });
export const updateSmart = (id: number, name: string, matchMode: string, rules: string) =>
  invoke<void>("update_smart", { id, name, matchMode, rules });
export const deleteSmart = (id: number) => invoke<void>("delete_smart", { id });
export const smartSearch = (id: number, sort?: string) =>
  invoke<Asset[]>("smart_search", { id, sort: sort ?? null });
export const smartPreview = (matchMode: string, rules: string) =>
  invoke<number>("smart_preview", { matchMode, rules });

// Remove da biblioteca (não apaga do disco).
export const removeAsset = (id: number) => invoke<void>("remove_asset", { id });

// ----- IA (metade "API" do híbrido) -----
export interface AiStatus {
  has_key: boolean;
  model: string;
  provider: string; // "anthropic" | "gemini"
  has_anthropic: boolean;
  has_gemini: boolean;
  autotag_on_import: boolean;
  auto_proxy_on_import: boolean;
}
export const aiStatus = () => invoke<AiStatus>("ai_status");
export const setAutotagImport = (on: boolean) =>
  invoke<void>("set_autotag_import", { on });
export const setAutoProxyImport = (on: boolean) =>
  invoke<void>("set_auto_proxy_import", { on });
export const setAiKey = (key: string) => invoke<void>("set_ai_key", { key });
export const setGeminiKey = (key: string) =>
  invoke<void>("set_gemini_key", { key });
export const setAiProvider = (provider: string) =>
  invoke<void>("set_ai_provider", { provider });
export const aiAnalyze = (id: number) => invoke<string[]>("ai_analyze", { id });
export const aiAnalyzeMany = (ids: number[]) =>
  invoke<void>("ai_analyze_many", { ids });
// Reorganizar SFX (elementos de edição): classifica os ÁUDIOS por IA (espectrograma+features) e
// organiza na biblioteca (tags/categoria/nome sugerido + coleção). Não toca nos arquivos. Devolve
// quantos áudios entraram na fila. force=true reprocessa os já classificados.
export const reorganizeSfx = (ids: number[], force = false) =>
  invoke<number>("reorganize_sfx", { ids, force });
// Escopo "tudo": reorganiza TODOS os áudios da biblioteca.
export const reorganizeSfxAll = (force = false) =>
  invoke<number>("reorganize_sfx_all", { force });
// Escopo "por pasta": reorganiza todos os áudios dentro de uma pasta.
export const reorganizeSfxFolder = (root: string, force = false) =>
  invoke<number>("reorganize_sfx_folder", { root, force });
// Quantos áudios ainda faltam reorganizar (pro botão "Reorganizar todos (N)").
export const sfxPendingCount = () => invoke<number>("sfx_pending_count");
// AI Action: pergunta livre sobre uma imagem (descreva, que texto há, sugira nome…)
export const aiAskImage = (id: number, question: string) =>
  invoke<string>("ai_ask_image", { id, question });
// AI Image Enlarger: amplia a imagem 4x (Real-ESRGAN, baixado sob demanda)
export const aiUpscale = (id: number) => invoke<string>("ai_upscale", { id });
// AI Background Remover: remove o fundo (u2netp ONNX em Rust puro, baixado sob demanda)
export const aiRemoveBg = (id: number) => invoke<string>("ai_remove_bg", { id });
// OCR (Copy Image Text / OCR Text Extractor do Eagle): extrai o texto visível da imagem por visão.
export const aiOcr = (id: number) => invoke<string>("ai_ocr", { id });
// Remover marca d'água / AI Eraser (nativo): mask = PNG (claro = remover). Retorna o caminho limpo.
export const inpaintWatermark = (id: number, mask: number[]) =>
  invoke<string>("inpaint_watermark", { id, mask });
// O arquivo ainda existe no disco? (preview avisa "sumiu" em vez de player quebrado).
export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
// Video → GIF (nativo, ffmpeg com paleta). Retorna o caminho do GIF gerado.
export const videoGif = (id: number) => invoke<string>("video_gif", { id });
// Otimizar imagem p/ web (nativo): limita 1920px + JPEG q82. Retorna msg "2.4 MB → 310 KB (-87%)".
export const imageOptimize = (id: number) => invoke<string>("image_optimize", { id });
// Image Crop Master (nativo): salva o recorte (PNG) ao lado do original. Retorna o caminho.
export const saveCropped = (nearPath: string, data: number[]) =>
  invoke<string>("save_cropped", { nearPath, data });
// Contact Sheet (nativo): salva a folha de contatos (PNG) na pasta do 1º asset. Retorna o caminho.
export const saveContactSheet = (nearPath: string, data: number[]) =>
  invoke<string>("save_contact_sheet", { nearPath, data });
// Batch Watermark (nativo): salva a imagem com marca d'água (PNG) ao lado do original.
export const saveWatermarked = (nearPath: string, data: number[]) =>
  invoke<string>("save_watermarked", { nearPath, data });
// Batch Watermark em VÍDEO (nativo, ffmpeg drawtext): queima o texto no vídeo. Retorna o caminho.
export const videoWatermark = (
  id: number,
  text: string,
  pos: string,
  opacity: number,
  size: number,
  color: string,
) => invoke<string>("video_watermark", { id, text, pos, opacity, size, color });

// ----- CLIP: busca semântica local (AI Search) -----
export interface ClipStatus {
  done: number;
  total: number;
}
export const clipStatus = () => invoke<ClipStatus>("clip_status");
export const clipIndex = (limit: number) => invoke<number>("clip_index", { limit });
export const clipSearch = (query: string, limit: number) =>
  invoke<Asset[]>("clip_search", { query, limit });
// CLIP++ — busca por exemplo: acha os assets visualmente/semanticamente parecidos com este.
export const clipSearchImage = (id: number, limit: number) =>
  invoke<Asset[]>("clip_search_image", { id, limit });
// Auto-tag zero-shot com CLIP (sem gastar API). ids vazio = todas as imagens.
export const clipAutotag = (ids: number[]) => invoke<number>("clip_autotag", { ids });

// ----- Ecossistema: VELVET (cor no DaVinci) + QUARTZO (PKM nosso) -----
export interface QuartzoNote {
  rel: string;
  name: string;
}
export const exportVelvetCatalog = () => invoke<string>("export_velvet_catalog");
// Designer: contact sheet (folha de contato) das imagens selecionadas → PNG no Inbox
export const exportContactSheet = (ids: number[]) =>
  invoke<string>("export_contact_sheet", { ids });
// VELVET: aplicar CST no DaVinci (PRISMA decide a arvore de nos + grava o request)
export interface VelvetApplyResult {
  summary: string;
  nodes: number;
  request_path: string;
}
export const velvetApplyCst = (id: number) =>
  invoke<VelvetApplyResult>("velvet_apply_cst", { id });
export const quartzoGetVault = () => invoke<string | null>("quartzo_get_vault");
export const quartzoSetVault = (path: string) => invoke<void>("quartzo_set_vault", { path });
export const quartzoNotes = () => invoke<QuartzoNote[]>("quartzo_notes");
export const quartzoAttach = (assetId: number, noteRel: string) =>
  invoke<void>("quartzo_attach", { assetId, noteRel });
export const quartzoNotesForAsset = (assetId: number) =>
  invoke<QuartzoNote[]>("quartzo_notes_for_asset", { assetId });
export const quartzoOpenNote = (noteRel: string) =>
  invoke<void>("quartzo_open_note", { noteRel });
// Analisa com IA todos os assets SEM descrição ainda (até um limite, pra controlar custo).
export const aiAnalyzeUntagged = (limit: number) =>
  invoke<number>("ai_analyze_untagged", { limit });
// Quantos itens ainda não têm descrição de IA (limit<=0 em aiAnalyzeUntagged = todas).
export const aiPendingCount = () => invoke<number>("ai_pending_count");

// ----- Vault (base de conhecimento RAG, Briefing 6) -----
export interface VaultChunk {
  note: string;
  heading: string;
  text: string;
}
export const vaultStatus = () => invoke<{ path: string | null; count: number }>("vault_status");
export const setVaultPath = (path: string) => invoke<number>("set_vault_path", { path });
export const reindexVault = () => invoke<number>("reindex_vault");
export const searchVault = (query: string, limit = 6) =>
  invoke<VaultChunk[]>("search_vault", { query, limit });
export interface ColorPlanOut {
  ok: boolean;
  plan: string;
  sources: string[];
  note: string;
}
export const colorPlan = (path: string, lang = "pt") =>
  invoke<ColorPlanOut>("color_plan", { path, lang });

// ----- Saúde da biblioteca -----
export const scanHealth = (limit: number) => invoke<number>("scan_health", { limit });
export const healthCounts = () => invoke<Record<string, number>>("health_counts");

// ----- Duplicados na importação -----
export const resolveDup = (
  existingId: number,
  incomingId: number,
  action: "exclude" | "replace" | "ignore"
) => invoke<void>("resolve_dup", { existingId, incomingId, action });
