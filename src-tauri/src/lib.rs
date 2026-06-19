mod ai;
mod classify;
mod db;
mod indexer;
mod mediainfo;
mod oficina;
mod thumbs;
mod watcher;

use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

pub struct AppState {
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
    data_dir: PathBuf,
    drag_icon: PathBuf,
    jobs: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
    job_counter: Arc<AtomicU64>,
    watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
}

/// Ícone genérico de arrasto (usado quando o asset não tem miniatura).
/// Sem um PNG válido o plugin de drag falha silenciosamente no Windows.
fn ensure_drag_icon(data_dir: &std::path::Path) -> PathBuf {
    let path = data_dir.join("drag-fallback.png");
    if !path.exists() {
        let mut img = image::RgbaImage::from_pixel(96, 96, image::Rgba([44, 44, 46, 255]));
        // moldura sutil
        for x in 0..96 {
            for y in 0..96 {
                let edge = x < 2 || y < 2 || x > 93 || y > 93;
                if edge {
                    img.put_pixel(x, y, image::Rgba([90, 90, 96, 255]));
                }
            }
        }
        let _ = img.save(&path);
    }
    path
}

/// Caminho do ícone de fallback de arrasto (pro frontend usar quando não há thumb).
#[tauri::command]
fn drag_icon(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    Ok(state.drag_icon.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct Counts {
    total: i64,
    dups: i64,
    untagged: i64,
    uncollected: i64,
    trash: i64,
    by_type: Vec<(String, i64)>,
    by_color: Vec<(String, i64)>,
    by_ext: Vec<(String, i64)>,
    by_unknown_ext: Vec<(String, i64)>,
}

/// Dispara a indexacao de uma pasta numa thread em background. Retorna na hora.
#[tauri::command]
fn index_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    // passa a monitorar essa pasta (Watch Folder) se for um diretório
    if std::path::Path::new(&path).is_dir() {
        if let Ok(mut w) = state.watcher.lock() {
            if let Some(watcher) = w.as_mut() {
                watcher::watch_root(watcher, &path);
            }
        }
    }
    let autotag = ai::load_settings(&state.data_dir).autotag_on_import.unwrap_or(false);
    let app2 = app.clone();
    std::thread::spawn(move || {
        indexer::index_folder(app2, db, thumbs_dir, path, autotag);
    });
    Ok(())
}

/// Re-scan de uma pasta: pega arquivos novos + remove os apagados (Briefing 1 §5).
#[tauri::command]
fn rescan_folder(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    std::thread::spawn(move || {
        indexer::rescan_folder(app, db, thumbs_dir, dir);
    });
    Ok(())
}

#[tauri::command]
fn search_assets(app: tauri::AppHandle, filter: db::Filter) -> Result<Vec<db::Asset>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::search(&conn, &filter).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_counts(app: tauri::AppHandle) -> Result<Counts, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let (untagged, uncollected, trash) = db::topic_counts(&conn).map_err(|e| e.to_string())?;
    Ok(Counts {
        total: db::total(&conn).map_err(|e| e.to_string())?,
        dups: db::dups_total(&conn).map_err(|e| e.to_string())?,
        untagged,
        uncollected,
        trash,
        by_type: db::counts(&conn).map_err(|e| e.to_string())?,
        by_color: db::color_buckets(&conn).map_err(|e| e.to_string())?,
        by_ext: db::ext_counts(&conn).map_err(|e| e.to_string())?,
        by_unknown_ext: db::unknown_exts(&conn).map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
fn get_folders(app: tauri::AppHandle) -> Result<Vec<db::FolderRow>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::folder_dirs(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_folder_alias(app: tauri::AppHandle, dir: String, alias: Option<String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let a = alias.as_deref().filter(|s| !s.trim().is_empty());
    db::set_folder_alias(&conn, &dir, a).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_folder_hidden(app: tauri::AppHandle, dir: String, hidden: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_folder_hidden(&conn, &dir, hidden).map_err(|e| e.to_string())
}

/// Define a capa da pasta a partir da thumbnail de um asset ("Definir como capa da pasta").
#[tauri::command]
fn set_folder_cover(app: tauri::AppHandle, dir: String, cover: Option<String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_folder_cover(&conn, &dir, cover.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_folder_color(app: tauri::AppHandle, dir: String, color: Option<String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_folder_color(&conn, &dir, color.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn subfolders(app: tauri::AppHandle, parent: String) -> Result<Vec<db::SubCard>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::subfolders(&conn, &parent).map_err(|e| e.to_string())
}

/// Salva uma imagem ANOTADA (markup) ao lado da original e cataloga (Briefing 4 #9).
#[tauri::command]
fn save_annotated(app: tauri::AppHandle, near_path: String, data: Vec<u8>) -> Result<String, String> {
    let state = app.state::<AppState>();
    let p = std::path::PathBuf::from(&near_path);
    let parent = p.parent().map(|d| d.to_path_buf()).unwrap_or_default();
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut n = 1;
    let out = loop {
        let suffix = if n == 1 { String::new() } else { format!(" {n}") };
        let cand = parent.join(format!("{stem}_anotado{suffix}.png"));
        if !cand.exists() {
            break cand;
        }
        n += 1;
    };
    std::fs::write(&out, &data).map_err(|e| e.to_string())?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &out).ok_or("falha ao catalogar")?;
    Ok(out.to_string_lossy().to_string())
}

/// Cola uma imagem do clipboard: salva numa pasta "Inbox" e cataloga (Briefing 4 #10).
#[tauri::command]
fn paste_image(app: tauri::AppHandle, data: Vec<u8>) -> Result<String, String> {
    let state = app.state::<AppState>();
    let inbox = state.data_dir.join("Inbox");
    std::fs::create_dir_all(&inbox).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let out = inbox.join(format!("colado_{ts}.png"));
    std::fs::write(&out, &data).map_err(|e| e.to_string())?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &out).ok_or("falha ao catalogar")?;
    Ok(out.to_string_lossy().to_string())
}

/// Auto-tag: marca todos os assets da pasta com o nome dela (Briefing 4 #7).
#[tauri::command]
fn autotag_folder(app: tauri::AppHandle, dir: String) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let name = dir.rsplit(['\\', '/']).next().unwrap_or(&dir).to_string();
    db::autotag_under(&conn, &dir, &name).map_err(|e| e.to_string())
}

// ---------- Lixeira (soft-delete estilo Eagle) ----------

#[tauri::command]
fn trash_asset(app: tauri::AppHandle, id: i64, trashed: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_trashed(&conn, id, trashed).map_err(|e| e.to_string())
}

#[tauri::command]
fn empty_trash(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::empty_trash(&conn).map_err(|e| e.to_string())
}

/// "Manter só 1 de cada": manda os duplicados (menos o mais antigo) pra Lixeira. Retorna quantos.
#[tauri::command]
fn dedupe_keep_one(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::dedupe_keep_one(&conn).map_err(|e| e.to_string())
}

/// Lê metadados completos do arquivo (ffprobe) e recomenda o CST do DaVinci.
#[tauri::command]
fn probe_media(path: String) -> Result<mediainfo::MediaInfo, String> {
    Ok(mediainfo::probe(std::path::Path::new(&path)))
}

/// OFICINA: dispara um job de conserto (VFR→CFR, transcode, proxy). Retorna o id do job.
#[tauri::command]
fn oficina_run(
    app: tauri::AppHandle,
    op: String,
    input: String,
    opts: oficina::JobOpts,
) -> Result<u64, String> {
    let state = app.state::<AppState>();
    let job = state.job_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .insert(job, cancel.clone());
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        if op == "stabilize" {
            oficina::run_gyroflow(app2, db, thumbs_dir, job, cancel, input, opts);
        } else if let Some(fmt) = op.strip_prefix("convert:") {
            oficina::run_convert(app2, db, thumbs_dir, job, input, fmt.to_string());
        } else {
            let ffmpeg = thumbs::bin_path("ffmpeg");
            oficina::run_with_opts(app2, db, thumbs_dir, ffmpeg, job, cancel, op, input, opts);
        }
    });
    Ok(job)
}

/// Codificador avançado (estilo HandBrake/Shutter Encoder). Retorna o id do job.
#[tauri::command]
fn encode_run(
    app: tauri::AppHandle,
    input: String,
    opts: oficina::EncodeOpts,
) -> Result<u64, String> {
    let state = app.state::<AppState>();
    let job = state.job_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    state.jobs.lock().map_err(|e| e.to_string())?.insert(job, cancel.clone());
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let ffmpeg = thumbs::bin_path("ffmpeg");
        oficina::run_encode(app2, db, thumbs_dir, ffmpeg, job, cancel, input, opts);
    });
    Ok(job)
}

// ---------- Presets do codificador (OFICINA) ----------

#[tauri::command]
fn list_presets(app: tauri::AppHandle) -> Result<Vec<db::EncoderPreset>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_presets(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_preset(app: tauri::AppHandle, name: String, opts: String) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::save_preset(&conn, name.trim(), &opts).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_preset(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_preset(&conn, id).map_err(|e| e.to_string())
}

/// Concatena vários clipes num só (OFICINA).
#[tauri::command]
fn concat_run(app: tauri::AppHandle, inputs: Vec<String>) -> Result<u64, String> {
    let state = app.state::<AppState>();
    let job = state.job_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let ffmpeg = thumbs::bin_path("ffmpeg");
        oficina::run_concat(app2, db, thumbs_dir, ffmpeg, job, inputs);
    });
    Ok(job)
}

#[tauri::command]
fn oficina_cancel(app: tauri::AppHandle, job: u64) -> Result<(), String> {
    let state = app.state::<AppState>();
    if let Some(c) = state.jobs.lock().map_err(|e| e.to_string())?.get(&job) {
        c.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn open_gyroflow(app: tauri::AppHandle, path: String) -> Result<(), String> {
    oficina::open_in_gyroflow(&app, &path)
}

/// Proxy (preview H.264) de um asset, se já existir.
#[tauri::command]
fn get_proxy(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_proxy(&conn, &path).map_err(|e| e.to_string())
}


#[tauri::command]
fn set_rating(app: tauri::AppHandle, id: i64, rating: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_rating(&conn, id, rating).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_notes(app: tauri::AppHandle, id: i64, notes: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_notes(&conn, id, &notes).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_tags(app: tauri::AppHandle) -> Result<Vec<db::Tag>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_tags(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn tags_for_asset(app: tauri::AppHandle, id: i64) -> Result<Vec<db::Tag>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::tags_for_asset(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_tag(
    app: tauri::AppHandle,
    id: i64,
    name: String,
    color: Option<String>,
) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let tag_id = db::create_tag(&conn, name.trim(), color.as_deref()).map_err(|e| e.to_string())?;
    db::assign_tag(&conn, id, tag_id).map_err(|e| e.to_string())?;
    Ok(tag_id)
}

#[tauri::command]
fn remove_tag(app: tauri::AppHandle, id: i64, tag_id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::unassign_tag(&conn, id, tag_id).map_err(|e| e.to_string())
}

// ---------- Sync notebook↔desktop (metadados por hash) ----------

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CatalogEntry {
    hash: String,
    name: Option<String>,
    rating: i64,
    notes: Option<String>,
    ai_desc: Option<String>,
    tags: Vec<String>,
    collections: Vec<String>,
}

/// Exporta o catálogo (tags/estrelas/notas/descrição/coleções por HASH) pra um arquivo .json.
/// Sincroniza entre máquinas sem depender da letra do drive (casa por conteúdo).
#[tauri::command]
fn export_catalog(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let rows = db::assets_with_hash(&conn).map_err(|e| e.to_string())?;
    let mut out: Vec<CatalogEntry> = Vec::new();
    for (id, hash, name, rating, notes, ai_desc) in rows {
        let tags: Vec<String> = db::tags_for_asset(&conn, id)
            .map(|v| v.into_iter().map(|t| t.name).collect())
            .unwrap_or_default();
        let collections = db::collection_names_for(&conn, id).unwrap_or_default();
        // só exporta o que tem metadado humano (evita arquivo gigante vazio)
        if rating > 0 || notes.is_some() || ai_desc.is_some() || !tags.is_empty() || !collections.is_empty() {
            out.push(CatalogEntry { hash, name, rating, notes, ai_desc, tags, collections });
        }
    }
    let json = serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(out.len())
}

/// Importa um catálogo exportado e aplica os metadados nos assets de MESMO HASH desta biblioteca.
#[tauri::command]
fn import_catalog(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let txt = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let entries: Vec<CatalogEntry> = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut applied = 0;
    for e in &entries {
        let ids = db::ids_by_hash(&conn, &e.hash).unwrap_or_default();
        if ids.is_empty() {
            continue;
        }
        for id in ids {
            if e.rating > 0 {
                let _ = db::set_rating(&conn, id, e.rating);
            }
            if let Some(n) = &e.notes {
                let _ = db::set_notes(&conn, id, n);
            }
            if let Some(d) = &e.ai_desc {
                let _ = db::set_ai_desc(&conn, id, d);
            }
            if let Some(nm) = &e.name {
                let _ = db::set_name(&conn, id, Some(nm));
            }
            for t in &e.tags {
                if let Ok(tid) = db::create_tag(&conn, t, None) {
                    let _ = db::assign_tag(&conn, id, tid);
                }
            }
            for c in &e.collections {
                if let Ok(cid) = db::create_collection(&conn, c) {
                    let _ = db::add_to_collection(&conn, cid, id);
                }
            }
        }
        applied += 1;
    }
    Ok(applied)
}

// ---------- Smart Folders (pastas inteligentes) ----------

#[tauri::command]
fn list_smart(app: tauri::AppHandle) -> Result<Vec<db::SmartFolder>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_smart(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_smart(app: tauri::AppHandle, name: String, match_mode: String, rules: String) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_smart(&conn, name.trim(), &match_mode, &rules).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_smart(app: tauri::AppHandle, id: i64, name: String, match_mode: String, rules: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_smart(&conn, id, name.trim(), &match_mode, &rules).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_smart(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_smart(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn smart_search(app: tauri::AppHandle, id: i64, sort: Option<String>) -> Result<Vec<db::Asset>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::smart_search(&conn, id, sort.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn smart_preview(app: tauri::AppHandle, match_mode: String, rules: String) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::smart_count(&conn, &match_mode, &rules).map_err(|e| e.to_string())
}

// ---------- Coleções (organização livre) ----------

#[tauri::command]
fn list_collections(app: tauri::AppHandle) -> Result<Vec<db::Collection>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_collections(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_collection(app: tauri::AppHandle, name: String) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::create_collection(&conn, name.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_collection(app: tauri::AppHandle, id: i64, name: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::rename_collection(&conn, id, name.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_collection(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_collection(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_to_collection(app: tauri::AppHandle, collection_id: i64, asset_ids: Vec<i64>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    for id in asset_ids {
        db::add_to_collection(&conn, collection_id, id).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn remove_from_collection(app: tauri::AppHandle, collection_id: i64, asset_id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::remove_from_collection(&conn, collection_id, asset_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn reorder_collection(app: tauri::AppHandle, collection_id: i64, ordered: Vec<i64>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::reorder_collection(&mut conn, collection_id, &ordered).map_err(|e| e.to_string())
}

#[tauri::command]
fn collections_for_asset(app: tauri::AppHandle, id: i64) -> Result<Vec<i64>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::collections_for_asset(&conn, id).map_err(|e| e.to_string())
}

/// Resolve um duplicado da importação. action: "exclude" (remove o novo da biblioteca),
/// "replace" (o novo assume tags/nota/coleções do antigo e o antigo sai), "ignore" (mantém os dois).
#[tauri::command]
fn resolve_dup(app: tauri::AppHandle, existing_id: i64, incoming_id: i64, action: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    match action.as_str() {
        "exclude" => db::delete_asset(&conn, incoming_id).map_err(|e| e.to_string()),
        "replace" => db::replace_asset(&conn, existing_id, incoming_id).map_err(|e| e.to_string()),
        _ => Ok(()), // "ignore" — não faz nada
    }
}

// ---------- IA (metade "API" do híbrido) ----------

#[derive(serde::Serialize)]
pub struct AiStatus {
    has_key: bool,
    model: String,
    autotag_on_import: bool,
}

#[tauri::command]
fn ai_status(app: tauri::AppHandle) -> Result<AiStatus, String> {
    let state = app.state::<AppState>();
    let s = ai::load_settings(&state.data_dir);
    Ok(AiStatus {
        has_key: s.anthropic_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false),
        model: s.model(),
        autotag_on_import: s.autotag_on_import.unwrap_or(false),
    })
}

/// Liga/desliga o workflow de auto-tag ao importar (Briefing 4 #6).
#[tauri::command]
fn set_autotag_import(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut s = ai::load_settings(&state.data_dir);
    s.autotag_on_import = Some(on);
    ai::save_settings(&state.data_dir, &s)
}

#[tauri::command]
fn set_ai_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut s = ai::load_settings(&state.data_dir);
    s.anthropic_key = if key.trim().is_empty() { None } else { Some(key.trim().to_string()) };
    ai::save_settings(&state.data_dir, &s)
}

/// Analisa UM asset com a IA: gera tags + descrição de conteúdo e grava. Devolve as tags.
#[tauri::command]
fn ai_analyze(app: tauri::AppHandle, id: i64) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let settings = ai::load_settings(&state.data_dir);
    let key = settings
        .anthropic_key
        .clone()
        .filter(|k| !k.is_empty())
        .ok_or("Configure sua chave da API nas configurações.")?;
    let thumb = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::thumb_of(&conn, id).map_err(|e| e.to_string())?
    };
    let thumb = thumb.ok_or("Este item não tem miniatura pra analisar.")?;
    let res = ai::analyze_image(&key, &settings.model(), std::path::Path::new(&thumb))?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    for t in &res.tags {
        if let Ok(tid) = db::create_tag(&conn, t, None) {
            let _ = db::assign_tag(&conn, id, tid);
        }
    }
    if !res.description.is_empty() {
        let _ = db::set_ai_desc(&conn, id, &res.description);
    }
    Ok(res.tags)
}

/// Roda a análise de IA num lote de ids, numa thread. Emite ai:progress e ai:done.
fn run_ai_batch(
    app: tauri::AppHandle,
    db: Arc<Mutex<Connection>>,
    key: String,
    model: String,
    ids: Vec<i64>,
) {
    std::thread::spawn(move || {
        let total = ids.len();
        for (i, id) in ids.into_iter().enumerate() {
            let thumb = {
                let conn = db.lock().unwrap();
                db::thumb_of(&conn, id).ok().flatten()
            };
            if let Some(thumb) = thumb {
                if let Ok(res) = ai::analyze_image(&key, &model, std::path::Path::new(&thumb)) {
                    let conn = db.lock().unwrap();
                    for t in &res.tags {
                        if let Ok(tid) = db::create_tag(&conn, t, None) {
                            let _ = db::assign_tag(&conn, id, tid);
                        }
                    }
                    if !res.description.is_empty() {
                        let _ = db::set_ai_desc(&conn, id, &res.description);
                    }
                }
            }
            let _ = app.emit("ai:progress", serde_json::json!({ "done": i + 1, "total": total }));
        }
        let _ = app.emit("ai:done", ());
    });
}

/// Analisa VÁRIOS assets selecionados em lote.
#[tauri::command]
fn ai_analyze_many(app: tauri::AppHandle, ids: Vec<i64>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let settings = ai::load_settings(&state.data_dir);
    let key = settings
        .anthropic_key
        .clone()
        .filter(|k| !k.is_empty())
        .ok_or("Configure sua chave da API nas configurações.")?;
    run_ai_batch(app.clone(), state.db.clone(), key, settings.model(), ids);
    Ok(())
}

/// Analisa em lote os assets ainda SEM descrição de IA (até `limit`, pra controlar custo).
#[tauri::command]
fn ai_analyze_untagged(app: tauri::AppHandle, limit: i64) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let settings = ai::load_settings(&state.data_dir);
    let key = settings
        .anthropic_key
        .clone()
        .filter(|k| !k.is_empty())
        .ok_or("Configure sua chave da API nas configurações.")?;
    let ids = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::assets_needing_ai(&conn, if limit <= 0 { 200 } else { limit }).map_err(|e| e.to_string())?
    };
    let n = ids.len();
    run_ai_batch(app.clone(), state.db.clone(), key, settings.model(), ids);
    Ok(n)
}

/// "Buscar por imagem": assets visualmente parecidos com `id` (perceptual hash local).
#[tauri::command]
fn similar_assets(app: tauri::AppHandle, id: i64, limit: i64) -> Result<Vec<db::Asset>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::similar(&conn, id, if limit <= 0 { 60 } else { limit }).map_err(|e| e.to_string())
}

// ---------- Ações de item (estilo Eagle) ----------

#[derive(serde::Deserialize)]
pub struct RenameItem {
    id: i64,
    new_name: String, // nome completo COM extensão
}
#[derive(serde::Serialize)]
pub struct RenameResult {
    id: i64,
    old_path: String,
    new_path: String,
    ok: bool,
    error: Option<String>,
}

/// Batch Rename: renomeia os ARQUIVOS no disco (Briefing 4 #4). Atualiza o caminho no catálogo.
/// Destrutivo (mexe no arquivo real) — o frontend avisa e guarda os nomes antigos pra desfazer.
#[tauri::command]
fn rename_files(app: tauri::AppHandle, items: Vec<RenameItem>) -> Result<Vec<RenameResult>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for it in items {
        let old = match db::path_of(&conn, it.id).ok().flatten() {
            Some((p, _)) => p,
            None => continue,
        };
        let oldp = std::path::PathBuf::from(&old);
        let parent = oldp.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        // sanitiza: tira separadores de caminho do nome novo
        let clean: String = it.new_name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).collect();
        let clean = clean.trim();
        if clean.is_empty() {
            out.push(RenameResult { id: it.id, old_path: old.clone(), new_path: old, ok: false, error: Some("nome vazio".into()) });
            continue;
        }
        let new_path = parent.join(clean);
        if new_path == oldp {
            out.push(RenameResult { id: it.id, old_path: old.clone(), new_path: old, ok: true, error: None });
            continue;
        }
        if new_path.exists() {
            out.push(RenameResult { id: it.id, old_path: old.clone(), new_path: new_path.to_string_lossy().to_string(), ok: false, error: Some("já existe".into()) });
            continue;
        }
        match std::fs::rename(&oldp, &new_path) {
            Ok(_) => {
                let ext = new_path.extension().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
                let dir = new_path.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
                let np = new_path.to_string_lossy().to_string();
                let _ = db::set_path(&conn, it.id, &np, clean, &ext, &dir);
                out.push(RenameResult { id: it.id, old_path: old, new_path: np, ok: true, error: None });
            }
            Err(e) => out.push(RenameResult { id: it.id, old_path: old.clone(), new_path: new_path.to_string_lossy().to_string(), ok: false, error: Some(e.to_string()) }),
        }
    }
    Ok(out)
}

/// Renomeia o NOME DE EXIBIÇÃO (não toca no arquivo no disco). Vazio = volta ao nome do arquivo.
#[tauri::command]
fn rename_asset(app: tauri::AppHandle, id: i64, name: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let n = name.trim();
    db::set_name(&conn, id, if n.is_empty() { None } else { Some(n) }).map_err(|e| e.to_string())
}

/// Duplica o arquivo no disco ("nome copia.ext") na mesma pasta e cataloga.
#[tauri::command]
fn duplicate_asset(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (path, ext) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::path_of(&conn, id).map_err(|e| e.to_string())?.ok_or("asset não encontrado")?
    };
    let p = std::path::PathBuf::from(&path);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let dir = p.parent().map(|d| d.to_path_buf()).unwrap_or_default();
    let mut n = 1;
    let dst = loop {
        let suffix = if n == 1 { " copia".to_string() } else { format!(" copia {n}") };
        let cand = dir.join(format!("{stem}{suffix}.{ext}"));
        if !cand.exists() {
            break cand;
        }
        n += 1;
    };
    std::fs::copy(&p, &dst).map_err(|e| e.to_string())?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &dst).ok_or("falha ao catalogar a cópia")?;
    Ok(())
}

/// Regenera a miniatura do asset (estilo "Refresh Thumbnail" do Eagle).
#[tauri::command]
fn refresh_thumb(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (path, ext) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::path_of(&conn, id).map_err(|e| e.to_string())?.ok_or("asset não encontrado")?
    };
    let (thumb, meta) = thumbs::generate(std::path::Path::new(&path), &ext, &state.thumbs_dir, id);
    if let Some(t) = thumb {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::set_thumbnail(&conn, id, &t).map_err(|e| e.to_string())?;
        if let Some(s) = thumbs::analyze_thumb(std::path::Path::new(&t)) {
            let _ = db::set_traits(&conn, id, &s.bright, &s.warm, &s.sat);
        }
        let _ = (meta.width, meta.height);
        Ok(())
    } else {
        Err("não consegui gerar a miniatura".into())
    }
}

/// Define uma CAPA customizada (imagem escolhida vira a miniatura do asset).
#[tauri::command]
fn set_custom_thumb(app: tauri::AppHandle, id: i64, source: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let out = state.thumbs_dir.join(format!("{id}_custom.png"));
    if thumbs::make_thumb_png(std::path::Path::new(&source), &out) {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::set_thumbnail(&conn, id, &out.to_string_lossy()).map_err(|e| e.to_string())
    } else {
        Err("não consegui ler a imagem escolhida".into())
    }
}

/// Manda um asset pra Lixeira (não apaga do disco; dá pra restaurar ou esvaziar depois).
#[tauri::command]
fn remove_asset(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_trashed(&conn, id, true).map_err(|e| e.to_string())
}

/// Abre o Explorer com o arquivo selecionado.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path))
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            // Diretorio de dados do app: banco + thumbs.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&data_dir).ok();
            let thumbs_dir = data_dir.join("thumbs");
            std::fs::create_dir_all(&thumbs_dir).ok();
            let drag_icon = ensure_drag_icon(&data_dir);

            // Banco: prisma.db. Migra a biblioteca antiga (acervo.db) preservando tudo.
            let db_path = data_dir.join("prisma.db");
            if !db_path.exists() {
                let old = data_dir.join("acervo.db");
                if old.exists() {
                    for (from, to) in [
                        ("acervo.db", "prisma.db"),
                        ("acervo.db-wal", "prisma.db-wal"),
                        ("acervo.db-shm", "prisma.db-shm"),
                    ] {
                        let f = data_dir.join(from);
                        if f.exists() {
                            let _ = std::fs::rename(&f, data_dir.join(to));
                        }
                    }
                }
            }
            let conn = db::open(&db_path).expect("falha ao abrir o banco");
            // Limpeza única: tira da biblioteca o clipe de teste do Gyroflow (pasta temp).
            let _ = conn.execute(
                "DELETE FROM assets WHERE dir LIKE '%prisma-gyro-test%' OR path LIKE '%prisma-gyro-test%'",
                [],
            );

            let db_arc = Arc::new(Mutex::new(conn));

            // Watch Folder: monitora as pastas indexadas e cataloga/remove sozinho.
            let watcher = watcher::start(app.handle().clone(), db_arc.clone(), thumbs_dir.clone());

            app.manage(AppState {
                db: db_arc.clone(),
                thumbs_dir: thumbs_dir.clone(),
                data_dir: data_dir.clone(),
                drag_icon,
                jobs: Arc::new(Mutex::new(HashMap::new())),
                job_counter: Arc::new(AtomicU64::new(0)),
                watcher: Arc::new(Mutex::new(watcher)),
            });

            // Retomada: gera no boot os thumbs que faltaram (ex.: app fechado no meio do indice).
            {
                let handle = app.handle().clone();
                let db_resume = db_arc.clone();
                std::thread::spawn(move || {
                    indexer::resume_missing(handle, db_resume, thumbs_dir);
                });
            }
            // Backfill das características visuais (tom/temperatura) pros assets antigos.
            {
                let handle = app.handle().clone();
                let db_traits = db_arc.clone();
                std::thread::spawn(move || {
                    indexer::backfill_traits(handle, db_traits);
                });
            }

            // Hook de teste/conveniencia: indexa uma pasta no boot se PRISMA_AUTOINDEX estiver setado.
            if let Ok(path) = std::env::var("PRISMA_AUTOINDEX") {
                if !path.trim().is_empty() {
                    let handle = app.handle().clone();
                    let _ = index_path(handle, path);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            index_path,
            search_assets,
            get_counts,
            get_folders,
            probe_media,
            oficina_run,
            oficina_cancel,
            open_gyroflow,
            get_proxy,
            reveal_in_explorer,
            set_rating,
            set_notes,
            list_tags,
            tags_for_asset,
            add_tag,
            remove_tag,
            list_collections,
            create_collection,
            rename_collection,
            delete_collection,
            add_to_collection,
            remove_from_collection,
            reorder_collection,
            collections_for_asset,
            resolve_dup,
            drag_icon,
            remove_asset,
            ai_status,
            set_ai_key,
            ai_analyze,
            ai_analyze_many,
            ai_analyze_untagged,
            set_folder_alias,
            set_folder_hidden,
            trash_asset,
            empty_trash,
            dedupe_keep_one,
            rename_asset,
            duplicate_asset,
            refresh_thumb,
            set_custom_thumb,
            similar_assets,
            rescan_folder,
            encode_run,
            list_smart,
            create_smart,
            update_smart,
            delete_smart,
            smart_search,
            smart_preview,
            rename_files,
            set_folder_cover,
            set_folder_color,
            subfolders,
            autotag_folder,
            paste_image,
            save_annotated,
            set_autotag_import,
            list_presets,
            save_preset,
            delete_preset,
            concat_run,
            export_catalog,
            import_catalog
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
