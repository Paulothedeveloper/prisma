import { invoke } from "@tauri-apps/api/core";

export interface Asset {
  id: number;
  path: string;
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
  random: boolean;
  collection: number | null;
  bright: string | null;
  warm: string | null;
  sat: string | null;
  orient: string | null;
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

export const indexPath = (path: string) => invoke<void>("index_path", { path });
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
export const autotagFolder = (dir: string) => invoke<number>("autotag_folder", { dir });
export const pasteImage = (data: number[]) => invoke<string>("paste_image", { data });
export const saveAnnotated = (nearPath: string, data: number[]) =>
  invoke<string>("save_annotated", { nearPath, data });

// ----- Sync notebook↔desktop (metadados por hash) -----
export const exportCatalog = (path: string) => invoke<number>("export_catalog", { path });
export const importCatalog = (path: string) => invoke<number>("import_catalog", { path });
export const trashAsset = (id: number, trashed: boolean) =>
  invoke<void>("trash_asset", { id, trashed });
export const emptyTrash = () => invoke<number>("empty_trash");
export const dedupeKeepOne = () => invoke<number>("dedupe_keep_one");

// ----- Ações de item (estilo Eagle) -----
export const renameAsset = (id: number, name: string) =>
  invoke<void>("rename_asset", { id, name });
export const duplicateAsset = (id: number) => invoke<void>("duplicate_asset", { id });
export const refreshThumb = (id: number) => invoke<void>("refresh_thumb", { id });
export const setCustomThumb = (id: number, source: string) =>
  invoke<void>("set_custom_thumb", { id, source });
export const similarAssets = (id: number, limit = 60) =>
  invoke<Asset[]>("similar_assets", { id, limit });

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
export const removeFolderLib = (dir: string) => invoke<number>("remove_folder_lib", { dir });
export const setRating = (id: number, rating: number) =>
  invoke<void>("set_rating", { id, rating });
export const setNotes = (id: number, notes: string) =>
  invoke<void>("set_notes", { id, notes });
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
  autotag_on_import: boolean;
  auto_proxy_on_import: boolean;
}
export const aiStatus = () => invoke<AiStatus>("ai_status");
export const setAutotagImport = (on: boolean) =>
  invoke<void>("set_autotag_import", { on });
export const setAutoProxyImport = (on: boolean) =>
  invoke<void>("set_auto_proxy_import", { on });
export const setAiKey = (key: string) => invoke<void>("set_ai_key", { key });
export const aiAnalyze = (id: number) => invoke<string[]>("ai_analyze", { id });
export const aiAnalyzeMany = (ids: number[]) =>
  invoke<void>("ai_analyze_many", { ids });
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
export const colorPlan = (path: string) => invoke<ColorPlanOut>("color_plan", { path });

// ----- Duplicados na importação -----
export const resolveDup = (
  existingId: number,
  incomingId: number,
  action: "exclude" | "replace" | "ignore"
) => invoke<void>("resolve_dup", { existingId, incomingId, action });
