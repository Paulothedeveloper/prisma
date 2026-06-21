//! Indexacao de pastas: anda no disco, cataloga TUDO no SQLite (sem mover nada),
//! depois gera thumbs numa fila com concorrencia limitada (nunca crasha em lotes grandes).

use crate::{classify, db, thumbs};
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

/// Quantos arquivos processar em paralelo na geracao de thumb.
/// Limitado de proposito: o Eagle do Paulo crashou importando 3871 de uma vez.
/// Agora é ADAPTATIVO: deixa pelo menos 2 núcleos livres pro SO/UI (cada thumb de vídeo
/// chama ffmpeg, que sozinho já usa vários núcleos) — junto com a prioridade reduzida do
/// ffmpeg, evita congelar o PC em bibliotecas grandes. Teto 4 (igual antes).
fn concurrency() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().saturating_sub(2).clamp(1, 4))
        .unwrap_or(2)
}

/// Lixo de sistema operacional — nao sao assets, nao entram na biblioteca.
/// (`._*` = AppleDouble do macOS; .DS_Store; Thumbs.db/desktop.ini do Windows.)
fn is_junk(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with("._") // AppleDouble (._arquivo)
        // .DS_Store E suas cópias renomeadas: "(2).DS_Store", "DS_Store(1)", "(4).DS_Store(2)"…
        || lower.contains("ds_store")
        || lower == "thumbs.db"
        || lower == "desktop.ini"
        || lower == ".localized"
        || lower == "icon\r" // ícone custom do macOS
}

#[derive(Serialize, Clone)]
struct StartPayload {
    folder: String,
    total: usize,
}

#[derive(Serialize, Clone)]
struct ThumbPayload {
    id: i64,
    thumbnail_path: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    duration: Option<f64>,
    done: usize,
    total: usize,
}

#[derive(Serialize, Clone)]
struct DonePayload {
    folder: String,
    total: usize,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Roda numa thread propria. Emite: index:start, index:thumb (por arquivo), index:done.
pub fn index_folder(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: std::path::PathBuf,
    folder: String,
    autotag: bool,
) {
    let root = Path::new(&folder);
    if !root.exists() {
        let _ = app.emit("index:error", format!("Pasta nao encontrada: {folder}"));
        return;
    }

    // --- Passo 1: catalogar (rapido, uma transacao) ---
    let folder_id = {
        let conn = db.lock().unwrap();
        db::upsert_folder(&conn, &folder, now()).unwrap_or(0)
    };

    let mut pending: Vec<(i64, String, String, String)> = Vec::new(); // (id, path, ext, kind)
    {
        let mut conn = db.lock().unwrap();
        let tx = conn.transaction().unwrap();
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            let filename = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if is_junk(&filename) {
                continue;
            }
            let ext = p
                .extension()
                .map(|s| s.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let kind = classify::categorize(&ext).to_string();
            let dir = p
                .parent()
                .map(|d| d.to_string_lossy().to_string())
                .unwrap_or_default();
            let md = entry.metadata().ok();
            let size = md.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let modified = md
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            let na = db::NewAsset {
                path: p.to_string_lossy().to_string(),
                dir,
                filename,
                ext: ext.clone(),
                kind: kind.clone(),
                size,
                modified_at: modified,
                folder_id,
            };
            // Regra de cache: só (re)gera miniatura pra assets novos ou cujo conteúdo
            // mudou. Re-adicionar uma pasta já catalogada não regenera tudo de novo.
            if let Ok((id, needs_thumb)) = db::upsert_asset_cached(&tx, &na) {
                if needs_thumb {
                    pending.push((id, na.path, ext, kind));
                }
            }
        }
        let _ = tx.commit();
    }

    // Workflow: auto-tag ao importar (cada item herda o nome da pasta como tag).
    if autotag {
        let name = Path::new(&folder)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !name.is_empty() {
            let conn = db.lock().unwrap();
            let _ = db::autotag_under(&conn, &folder, &name);
        }
    }

    let total = pending.len();
    let import_ids: Vec<i64> = pending.iter().map(|p| p.0).collect();
    let _ = app.emit(
        "index:start",
        StartPayload {
            folder: folder.clone(),
            total,
        },
    );

    run_thumb_queue(&app, &db, &thumbs_dir, pending);

    // Duplicados na importação: avisa o usuário pra ele decidir (excluir/substituir/ignorar).
    let dups = {
        let conn = db.lock().unwrap();
        db::find_import_dups(&conn, &import_ids).unwrap_or_default()
    };
    if !dups.is_empty() {
        let _ = app.emit("index:dups", &dups);
    }

    let _ = app.emit("index:done", DonePayload { folder, total });
}

/// Re-scan de uma pasta já indexada: cataloga arquivos NOVOS, remove do catálogo os
/// que sumiram do disco, e gera thumb só pros novos. (Briefing 1 §5 — must-have.)
pub fn rescan_folder(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: std::path::PathBuf,
    folder: String,
) {
    let root = Path::new(&folder);
    let folder_id = {
        let conn = db.lock().unwrap();
        db::upsert_folder(&conn, &folder, now()).unwrap_or(0)
    };

    // 1) cataloga (upsert) tudo que existe agora no disco
    if root.exists() {
        let mut conn = db.lock().unwrap();
        let tx = conn.transaction().unwrap();
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            let filename = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if is_junk(&filename) {
                continue;
            }
            let ext = p.extension().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            let kind = classify::categorize(&ext).to_string();
            let dir = p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
            let md = entry.metadata().ok();
            let size = md.as_ref().map(|m| m.len() as i64).unwrap_or(0);
            let modified = md
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let na = db::NewAsset {
                path: p.to_string_lossy().to_string(),
                dir,
                filename,
                ext,
                kind,
                size,
                modified_at: modified,
                folder_id,
            };
            let _ = db::upsert_asset(&tx, &na);
        }
        let _ = tx.commit();
    }

    // 2) prune: remove do catálogo o que não existe mais no disco
    let mut removed = 0;
    {
        let under = {
            let conn = db.lock().unwrap();
            db::assets_under(&conn, &folder).unwrap_or_default()
        };
        let conn = db.lock().unwrap();
        for (id, path) in under {
            if !Path::new(&path).exists() {
                let _ = db::delete_asset(&conn, id);
                removed += 1;
            }
        }
    }

    // 3) gera thumb só pros novos (sem miniatura)
    let pending = {
        let conn = db.lock().unwrap();
        db::pending_thumbs_under(&conn, &folder).unwrap_or_default()
    };
    let total = pending.len();
    let _ = app.emit(
        "index:start",
        StartPayload { folder: format!("Re-scan: {folder}"), total },
    );
    if total > 0 {
        run_thumb_queue(&app, &db, &thumbs_dir, pending);
    }
    let _ = app.emit("index:rescan", removed);
    let _ = app.emit("index:done", DonePayload { folder, total });
}

/// Retomada: gera thumbs para assets ja catalogados que ficaram sem (ex.: app fechado
/// no meio da indexacao). Roda no boot, sem barra de progresso intrusiva.
pub fn resume_missing(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: std::path::PathBuf,
) {
    let pending = {
        let conn = db.lock().unwrap();
        db::pending_thumbs(&conn).unwrap_or_default()
    };
    if pending.is_empty() {
        return;
    }
    let total = pending.len();
    let _ = app.emit(
        "index:start",
        StartPayload {
            folder: "Atualizando miniaturas".into(),
            total,
        },
    );
    run_thumb_queue(&app, &db, &thumbs_dir, pending);
    let _ = app.emit(
        "index:done",
        DonePayload {
            folder: "Atualizando miniaturas".into(),
            total,
        },
    );
}

/// Indexa UM arquivo já existente no disco (usado por "duplicar"). Cataloga + thumb + cor + hash.
pub fn index_one(db: &Arc<Mutex<Connection>>, thumbs_dir: &Path, path: &Path) -> Option<i64> {
    let filename = path.file_name()?.to_string_lossy().to_string();
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let kind = classify::categorize(&ext).to_string();
    let dir = path.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
    let md = std::fs::metadata(path).ok();
    let size = md.as_ref().map(|m| m.len() as i64).unwrap_or(0);
    let modified = md
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let na = db::NewAsset {
        path: path.to_string_lossy().to_string(),
        dir,
        filename,
        ext: ext.clone(),
        kind,
        size,
        modified_at: modified,
        folder_id: 0,
    };
    let id = {
        let conn = db.lock().unwrap();
        db::upsert_asset(&conn, &na).ok()?
    };
    let (thumb, meta) = thumbs::generate(path, &ext, thumbs_dir, id);
    let swatch = thumb.as_deref().and_then(|t| thumbs::analyze_thumb(Path::new(t)));
    let (dom, buck) = match &swatch {
        Some(s) => (Some(s.hex.clone()), Some(s.bucket.clone())),
        None => (None, None),
    };
    let hash = thumbs::quick_hash(path, size as u64);
    let conn = db.lock().unwrap();
    let _ = db::set_processed(&conn, id, thumb.as_deref(), meta.width, meta.height,
        meta.duration, dom.as_deref(), buck.as_deref(), hash.as_deref());
    if let Some(s) = &swatch {
        let _ = db::set_traits(&conn, id, &s.bright, &s.warm, &s.sat);
    }
    if let Some(ph) = thumb.as_deref().and_then(|t| thumbs::phash(Path::new(t))) {
        let _ = db::set_phash(&conn, id, ph as i64);
    }
    Some(id)
}

/// Backfill das características visuais (tom/temperatura/saturação) pra assets que já
/// têm thumb mas foram indexados antes do recurso existir. Roda no boot, em background.
pub fn backfill_traits(app: AppHandle, db: Arc<Mutex<Connection>>) {
    let pending = {
        let conn = db.lock().unwrap();
        db::pending_traits(&conn).unwrap_or_default()
    };
    if pending.is_empty() {
        return;
    }
    for (id, thumb) in pending {
        if let Some(s) = thumbs::analyze_thumb(Path::new(&thumb)) {
            let conn = db.lock().unwrap();
            let _ = db::set_traits(&conn, id, &s.bright, &s.warm, &s.sat);
        }
    }
    // backfill do perceptual hash (busca por imagem) pros que ainda não têm
    let pend_ph = {
        let conn = db.lock().unwrap();
        db::pending_phash(&conn).unwrap_or_default()
    };
    for (id, thumb) in pend_ph {
        if let Some(ph) = thumbs::phash(Path::new(&thumb)) {
            let conn = db.lock().unwrap();
            let _ = db::set_phash(&conn, id, ph as i64);
        }
    }
    // avisa a UI pra atualizar contagens/filtros
    let _ = app.emit("index:traits-done", ());
}

/// Worker pool: processa thumbs + metadados + cor + hash com concorrencia limitada.
fn run_thumb_queue(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    thumbs_dir: &std::path::Path,
    pending: Vec<(i64, String, String, String)>,
) {
    let total = pending.len();
    let done = Arc::new(AtomicUsize::new(0));
    let queue = Arc::new(Mutex::new(pending.into_iter()));
    let mut handles = Vec::new();

    for _ in 0..concurrency() {
        let app = app.clone();
        let db = db.clone();
        let thumbs_dir = thumbs_dir.to_path_buf();
        let queue = queue.clone();
        let done = done.clone();
        handles.push(std::thread::spawn(move || loop {
            let item = {
                let mut q = queue.lock().unwrap();
                q.next()
            };
            let Some((id, path, ext, kind)) = item else { break };

            let p = Path::new(&path);
            let (thumb, meta) = thumbs::generate(p, &ext, &thumbs_dir, id);

            // Corrompidos: mídia que não abre em NENHUM decodificador sai da biblioteca.
            let is_media = matches!(kind.as_str(), "image" | "gif" | "video" | "audio");
            if is_media && thumb.is_none() && meta.width.is_none() && meta.duration.is_none() {
                let conn = db.lock().unwrap();
                let _ = db::delete_asset(&conn, id);
                drop(conn);
                let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = app.emit("index:corrupt", id);
                let _ = app.emit(
                    "index:thumb",
                    ThumbPayload {
                        id,
                        thumbnail_path: None,
                        width: None,
                        height: None,
                        duration: None,
                        done: d,
                        total,
                    },
                );
                continue;
            }

            // características visuais (cor + tom + temperatura + saturação) da thumb,
            // num passe só + hash rapido (do arquivo) pra duplicados
            let swatch = thumb.as_deref().and_then(|t| thumbs::analyze_thumb(Path::new(t)));
            let (dom, buck) = match &swatch {
                Some(s) => (Some(s.hex.clone()), Some(s.bucket.clone())),
                None => (None, None),
            };
            let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            let hash = thumbs::quick_hash(p, size);

            {
                let conn = db.lock().unwrap();
                let _ = db::set_processed(
                    &conn,
                    id,
                    thumb.as_deref(),
                    meta.width,
                    meta.height,
                    meta.duration,
                    dom.as_deref(),
                    buck.as_deref(),
                    hash.as_deref(),
                );
                if let Some(s) = &swatch {
                    let _ = db::set_traits(&conn, id, &s.bright, &s.warm, &s.sat);
                }
                if let Some(ph) = thumb.as_deref().and_then(|t| thumbs::phash(Path::new(t))) {
                    let _ = db::set_phash(&conn, id, ph as i64);
                }
            }
            let d = done.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = app.emit(
                "index:thumb",
                ThumbPayload {
                    id,
                    thumbnail_path: thumb,
                    width: meta.width,
                    height: meta.height,
                    duration: meta.duration,
                    done: d,
                    total,
                },
            );
        }));
    }
    for h in handles {
        let _ = h.join();
    }
}
