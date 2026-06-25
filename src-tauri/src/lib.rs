mod ai;
mod bgremove;
mod classify;
mod clip;
mod db;
mod ecosystem;
mod extras;
mod dbpool;
mod features;
mod indexer;
mod jobs;
mod mediainfo;
mod nle;
mod oficina;
mod thumbs;
mod vault;
mod watcher;

use features::FeatureFlags;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub struct AppState {
    /// Conexão de ESCRITA única (SQLite só permite um escritor por vez).
    db: Arc<Mutex<Connection>>,
    /// Pool de conexões de LEITURA (WAL) — a UI lê sem disputar o lock da escrita.
    reads: Arc<dbpool::ReadPool>,
    thumbs_dir: PathBuf,
    data_dir: PathBuf,
    drag_icon: PathBuf,
    /// Sistema de jobs unificado (registro/cancelamento + lotes IA/saúde).
    jobs: Arc<jobs::Jobs>,
    watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
    vault_watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
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

/// Flags de edição/licença (núcleo sempre livre; avançados gateáveis no futuro).
/// O frontend lê isto uma vez no boot pra decidir o que mostrar.
#[tauri::command]
fn feature_flags(app: tauri::AppHandle) -> Result<FeatureFlags, String> {
    let state = app.state::<AppState>();
    Ok(FeatureFlags::resolve(&state.data_dir))
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
    let settings = ai::load_settings(&state.data_dir);
    let autotag = settings.autotag_on_import.unwrap_or(false);
    let auto_proxy = settings.auto_proxy_on_import.unwrap_or(true); // padrão LIGADO
    let proxy_dir = state.data_dir.join("proxies");
    let app2 = app.clone();
    let path2 = path.clone();
    std::thread::spawn(move || {
        indexer::index_folder(app2.clone(), db.clone(), thumbs_dir, path, autotag);
        // Após indexar, gera proxies dos vídeos de codec não-web (ProRes/.mov etc.)
        // pra eles tocarem no hover/preview. Em segundo plano, sem tocar os originais.
        if auto_proxy {
            let vids = db
                .lock()
                .ok()
                .and_then(|c| db::videos_without_proxy_under(&c, &path2).ok())
                .unwrap_or_default();
            if !vids.is_empty() {
                let ffmpeg = thumbs::bin_path("ffmpeg");
                oficina::run_proxy_batch(app2, db, ffmpeg, proxy_dir, vids);
            }
        }
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
    // Leitura no pool: não bloqueia mesmo com indexação/scan gravando em background.
    state.reads.with(|conn| db::search(conn, &filter)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_counts(app: tauri::AppHandle) -> Result<Counts, String> {
    let state = app.state::<AppState>();
    state.reads.with(|conn| {
        let (untagged, uncollected, trash) = db::topic_counts(conn).map_err(|e| e.to_string())?;
        Ok(Counts {
            total: db::total(conn).map_err(|e| e.to_string())?,
            dups: db::dups_total(conn).map_err(|e| e.to_string())?,
            untagged,
            uncollected,
            trash,
            by_type: db::counts(conn).map_err(|e| e.to_string())?,
            by_color: db::color_buckets(conn).map_err(|e| e.to_string())?,
            by_ext: db::ext_counts(conn).map_err(|e| e.to_string())?,
            by_unknown_ext: db::unknown_exts(conn).map_err(|e| e.to_string())?,
        })
    })
}

#[tauri::command]
fn get_folders(app: tauri::AppHandle) -> Result<Vec<db::FolderRow>, String> {
    let state = app.state::<AppState>();
    state.reads.with(|conn| db::folder_dirs(conn)).map_err(|e| e.to_string())
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
    state.reads.with(|conn| db::subfolders(conn, &parent)).map_err(|e| e.to_string())
}

/// Busca pastas pelo nome (qualquer profundidade), opcionalmente dentro de um escopo.
#[tauri::command]
fn search_folders(
    app: tauri::AppHandle,
    query: String,
    scope: Option<String>,
) -> Result<Vec<db::SubCard>, String> {
    let state = app.state::<AppState>();
    state
        .reads
        .with(|conn| db::search_folders(conn, &query, scope.as_deref(), 40))
        .map_err(|e| e.to_string())
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

/// Coletor da web (designer): baixa um arquivo de uma URL pra pasta Inbox e cataloga.
/// Não toca em nada existente — escreve um arquivo NOVO no Inbox do app.
#[tauri::command]
fn add_from_url(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let state = app.state::<AppState>();
    let resp = reqwest::blocking::get(url.trim()).map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let ext_from_ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|ct| match ct.split(';').next().unwrap_or("").trim() {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/svg+xml" => "svg",
            "image/avif" => "avif",
            "video/mp4" => "mp4",
            _ => "bin",
        })
        .unwrap_or("bin")
        .to_string();
    let bytes = resp.bytes().map_err(|e| e.to_string())?;

    let inbox = state.data_dir.join("Inbox");
    std::fs::create_dir_all(&inbox).map_err(|e| e.to_string())?;
    // nome: da própria URL (se tiver extensão) senão deriva do content-type
    let from_url = url
        .split('?')
        .next()
        .unwrap_or(&url)
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut name: String = if from_url.contains('.') && from_url.len() > 1 {
        from_url
    } else {
        format!("web_{ts}.{ext_from_ct}")
    };
    name = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    if name.is_empty() {
        name = format!("web_{ts}.{ext_from_ct}");
    }
    let mut out = inbox.join(&name);
    let mut n = 1;
    while out.exists() {
        let stem = std::path::Path::new(&name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = std::path::Path::new(&name).extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| ext_from_ct.clone());
        out = inbox.join(format!("{stem}_{n}.{ext}"));
        n += 1;
    }
    std::fs::write(&out, &bytes).map_err(|e| e.to_string())?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &out).ok_or("falha ao catalogar")?;
    tracing::info!(url = %url, dest = %out.display(), "add_from_url: coletado da web");
    Ok(out.to_string_lossy().to_string())
}

// ---------- Video Downloader (yt-dlp nativo) ----------

#[tauri::command]
fn video_download_info(app: tauri::AppHandle, url: String) -> Result<extras::DownloadInfo, String> {
    let state = app.state::<AppState>();
    extras::info(&state.data_dir, url.trim())
}

/// Baixa o vídeo/áudio pro Inbox e JÁ cataloga no PRISMA. Retorna o caminho final.
#[tauri::command]
fn video_download(app: tauri::AppHandle, url: String, audio_only: bool) -> Result<String, String> {
    let state = app.state::<AppState>();
    let inbox = state.data_dir.join("Inbox");
    let ffmpeg = thumbs::bin_path("ffmpeg");
    let out = extras::download(&state.data_dir, &ffmpeg, &inbox, url.trim(), audio_only)?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &out).ok_or("baixado mas falhou ao catalogar")?;
    tracing::info!(url = %url, dest = %out.display(), "video_download: baixado e catalogado");
    Ok(out.to_string_lossy().to_string())
}

/// Letras sincronizadas (LRC) pro Music Player.
#[tauri::command]
fn fetch_lyrics(artist: String, title: String) -> Result<Vec<extras::LyricLine>, String> {
    extras::lyrics(artist.trim(), title.trim())
}

/// AI Image Enlarger (plugin do Eagle): amplia a imagem 4x via Real-ESRGAN (baixado sob
/// demanda) e cataloga o resultado no Inbox. Não-destrutivo. Retorna o caminho do PNG novo.
#[tauri::command]
fn ai_upscale(app: tauri::AppHandle, id: i64) -> Result<String, String> {
    let state = app.state::<AppState>();
    let path: String = state
        .reads
        .with(|conn| {
            conn.query_row(
                "SELECT path FROM assets WHERE id=?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
        })
        .map_err(|e| e.to_string())?;
    let inbox = state.data_dir.join("Inbox");
    let out = extras::upscale(&state.data_dir, &inbox, std::path::Path::new(&path))?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &out).ok_or("ampliado mas falhou ao catalogar")?;
    tracing::info!(src = %path, dest = %out.display(), "ai_upscale: imagem ampliada 4x");
    Ok(out.to_string_lossy().to_string())
}

/// AI Background Remover (plugin do Eagle): remove o fundo da imagem (u2netp, Rust puro,
/// modelo baixado sob demanda) e cataloga o PNG transparente no Inbox. Não-destrutivo.
#[tauri::command]
fn ai_remove_bg(app: tauri::AppHandle, id: i64) -> Result<String, String> {
    let state = app.state::<AppState>();
    let path: String = state
        .reads
        .with(|conn| {
            conn.query_row(
                "SELECT path FROM assets WHERE id=?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
        })
        .map_err(|e| e.to_string())?;
    let inbox = state.data_dir.join("Inbox");
    let out = bgremove::remove_bg(&state.data_dir, &inbox, std::path::Path::new(&path))?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &out).ok_or("fundo removido mas falhou ao catalogar")?;
    tracing::info!(src = %path, dest = %out.display(), "ai_remove_bg: fundo removido");
    Ok(out.to_string_lossy().to_string())
}

// ---------- CLIP: busca semântica local (plugin "AI Search" do Eagle) ----------

#[derive(serde::Serialize)]
struct ClipStatus {
    done: i64,
    total: i64,
}

#[tauri::command]
fn clip_status(app: tauri::AppHandle) -> Result<ClipStatus, String> {
    let state = app.state::<AppState>();
    let (done, total) = state.reads.with(|c| db::clip_counts(c)).map_err(|e| e.to_string())?;
    Ok(ClipStatus { done, total })
}

/// Indexa (gera embeddings CLIP) as imagens que ainda não têm, em segundo plano.
/// Emite `clip:progress` (nº feito) e `clip:done`. `limit<=0` = todas.
#[tauri::command]
fn clip_index(app: tauri::AppHandle, limit: i64) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let pending = state
        .reads
        .with(|c| db::assets_needing_clip(c, limit))
        .map_err(|e| e.to_string())?;
    let n = pending.len();
    if n == 0 {
        let _ = app.emit("clip:done", 0u64);
        return Ok(0);
    }
    let data_dir = state.data_dir.clone();
    let db = state.db.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut vis = match clip::vision_session(&data_dir) {
            Ok(s) => s,
            Err(e) => {
                let _ = app2.emit("clip:error", e);
                return;
            }
        };
        let mut done = 0u64;
        for (id, path) in pending {
            if let Ok(emb) = clip::embed_image(&mut vis, std::path::Path::new(&path)) {
                let blob = clip::embed_to_blob(&emb);
                if let Ok(conn) = db.lock() {
                    let _ = db::set_clip_embed(&conn, id, &blob);
                }
            }
            done += 1;
            if done % 5 == 0 {
                let _ = app2.emit("clip:progress", done);
            }
        }
        let _ = app2.emit("clip:done", done);
    });
    Ok(n)
}

/// Busca semântica: embeda o texto da query e ranqueia as imagens por cosseno.
#[tauri::command]
fn clip_search(app: tauri::AppHandle, query: String, limit: i64) -> Result<Vec<db::Asset>, String> {
    let state = app.state::<AppState>();
    let mut enc = clip::text_encoder(&state.data_dir)?;
    let q = clip::embed_text(&mut enc, query.trim())?;
    let embeds = state.reads.with(|c| db::all_clip_embeds(c)).map_err(|e| e.to_string())?;
    let mut scored: Vec<(i64, f32)> = embeds
        .iter()
        .map(|(id, blob)| (*id, clip::cosine(&q, &clip::blob_to_embed(blob))))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let n = if limit > 0 { limit as usize } else { 60 };
    let ids: Vec<i64> = scored.into_iter().take(n).map(|(id, _)| id).collect();
    state.reads.with(|c| db::assets_by_ids(c, &ids)).map_err(|e| e.to_string())
}

/// Auto-tag ZERO-SHOT com CLIP (sem gastar API): compara cada imagem com um vocabulário de
/// conceitos e grava as etiquetas que casam. `ids` vazio = todas as imagens. Roda em background.
#[tauri::command]
fn clip_autotag(app: tauri::AppHandle, ids: Vec<i64>) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let targets: Vec<(i64, String)> = if ids.is_empty() {
        state
            .reads
            .with(|c| {
                let mut s = c.prepare(
                    "SELECT id, path FROM assets WHERE trashed=0 AND seq_member=0 AND live_member=0 AND type IN ('image','gif')",
                )?;
                let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })
            .map_err(|e| e.to_string())?
    } else {
        state
            .reads
            .with(|c| {
                let mut out = Vec::new();
                for id in &ids {
                    if let Ok(p) = c.query_row("SELECT path FROM assets WHERE id=?1", rusqlite::params![id], |r| r.get::<_, String>(0)) {
                        out.push((*id, p));
                    }
                }
                Ok::<_, rusqlite::Error>(out)
            })
            .map_err(|e| e.to_string())?
    };
    let n = targets.len();
    if n == 0 {
        let _ = app.emit("clip:tagdone", 0u64);
        return Ok(0);
    }
    let data_dir = state.data_dir.clone();
    let db = state.db.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut enc = match clip::text_encoder(&data_dir) {
            Ok(e) => e,
            Err(e) => { let _ = app2.emit("clip:error", e); return; }
        };
        let vocab = clip::vocab_embeddings(&mut enc);
        let mut vis = match clip::vision_session(&data_dir) {
            Ok(s) => s,
            Err(e) => { let _ = app2.emit("clip:error", e); return; }
        };
        let mut done = 0u64;
        for (id, path) in targets {
            if let Ok(emb) = clip::embed_image(&mut vis, std::path::Path::new(&path)) {
                let tags = clip::autotag_for(&emb, &vocab, 0.215, 6);
                if let Ok(conn) = db.lock() {
                    // aproveita e guarda o embedding (serve pra busca semântica também)
                    let _ = db::set_clip_embed(&conn, id, &clip::embed_to_blob(&emb));
                    for tag in &tags {
                        if let Ok(tid) = db::create_tag(&conn, tag, None) {
                            let _ = db::assign_tag(&conn, id, tid);
                        }
                    }
                }
            }
            done += 1;
            if done % 5 == 0 {
                let _ = app2.emit("clip:tagprogress", done);
            }
        }
        let _ = app2.emit("clip:tagdone", done);
    });
    Ok(n)
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

/// Manda vários assets pra Lixeira pelo CAMINHO (robusto a id obsoleto — ver set_trashed_by_path).
/// Retorna quantos foram realmente marcados (0 = nenhum casou, sinaliza problema pro front).
#[tauri::command]
fn trash_paths(app: tauri::AppHandle, paths: Vec<String>, trashed: bool) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for p in &paths {
        n += db::set_trashed_by_path(&conn, p, trashed).map_err(|e| e.to_string())?;
    }
    tracing::info!(pedidos = paths.len(), marcados = n, "trash_paths");
    Ok(n)
}

#[tauri::command]
fn empty_trash(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let (n, files) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let files = db::trashed_cache_files(&conn).unwrap_or_default();
        let n = db::empty_trash(&conn).map_err(|e| e.to_string())?;
        (n, files)
    };
    // Apaga proxy+miniatura do disco em BACKGROUND: numa pasta pesada são milhares de remove_file,
    // que travavam a resposta do comando ("apagar demora pra caramba"). A remoção do catálogo
    // (que é o que importa pra UI) já foi feita; o cache some atrás sem segurar o app.
    std::thread::spawn(move || delete_cache_files(&files));
    Ok(n)
}

/// Apaga arquivos de cache (proxy/miniatura) do disco. Só dentro do diretório de dados —
/// `db` só devolve caminhos de cache, nunca os originais.
fn delete_cache_files(paths: &[String]) {
    for p in paths {
        if p.is_empty() {
            continue;
        }
        if let Err(e) = std::fs::remove_file(p) {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(file = %p, error = %e, "não consegui apagar arquivo de cache");
            }
        }
    }
}

/// "Manter só 1 de cada": manda os duplicados (menos o mais antigo) pra Lixeira. Retorna quantos.
#[tauri::command]
fn dedupe_keep_one(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::dedupe_keep_one(&conn).map_err(|e| e.to_string())
}

/// Lê metadados completos do arquivo (ffprobe) e recomenda o CST do DaVinci.
/// Guarda o diagnóstico em cache (saúde da biblioteca) ao abrir o arquivo.
#[tauri::command]
fn probe_media(app: tauri::AppHandle, path: String) -> Result<mediainfo::MediaInfo, String> {
    let state = app.state::<AppState>();
    let info = mediainfo::probe(std::path::Path::new(&path));
    if info.video.is_some() {
        let (level, flags) = mediainfo::health_summary(&info);
        if let Ok(conn) = state.db.lock() {
            let _ = db::set_health(&conn, &path, &level, &flags);
        }
    }
    Ok(info)
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
    let (job, cancel) = state.jobs.register();
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
    let (job, cancel) = state.jobs.register();
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
    let (job, _cancel) = state.jobs.register();
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
    state.jobs.cancel(job);
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
    state.reads.with(|conn| db::list_tags(conn)).map_err(|e| e.to_string())
}

#[tauri::command]
fn tags_for_asset(app: tauri::AppHandle, id: i64) -> Result<Vec<db::Tag>, String> {
    let state = app.state::<AppState>();
    state.reads.with(|conn| db::tags_for_asset(conn, id)).map_err(|e| e.to_string())
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

// ---------- Mutações consolidadas (Bloco 2) ----------

/// Campos editáveis de um asset numa só chamada. `None` = não mexe; `name`/tags vazios
/// têm semântica própria (ver `mutate_asset`).
#[derive(serde::Deserialize, Default)]
pub struct AssetPatch {
    pub rating: Option<i64>,
    pub notes: Option<String>,
    pub name: Option<String>, // "" limpa (volta ao nome do arquivo)
    pub trashed: Option<bool>,
    pub add_tags: Option<Vec<String>>,
    pub remove_tag_ids: Option<Vec<i64>>,
}

/// Mutação consolidada de um asset: aplica vários campos numa só ida ao backend.
/// Substitui set_rating/set_notes/rename_asset/trash_asset/add_tag/remove_tag (mantidos
/// como aliases por compatibilidade). Uma só aquisição do writer = menos contenção.
#[tauri::command]
fn mutate_asset(app: tauri::AppHandle, id: i64, patch: AssetPatch) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(r) = patch.rating {
        db::set_rating(&conn, id, r).map_err(|e| e.to_string())?;
    }
    if let Some(n) = patch.notes {
        db::set_notes(&conn, id, &n).map_err(|e| e.to_string())?;
    }
    if let Some(nm) = patch.name {
        let t = nm.trim();
        db::set_name(&conn, id, if t.is_empty() { None } else { Some(t) }).map_err(|e| e.to_string())?;
    }
    if let Some(tr) = patch.trashed {
        db::set_trashed(&conn, id, tr).map_err(|e| e.to_string())?;
    }
    if let Some(tags) = patch.add_tags {
        for t in tags {
            let t = t.trim();
            if t.is_empty() {
                continue;
            }
            if let Ok(tid) = db::create_tag(&conn, t, None) {
                let _ = db::assign_tag(&conn, id, tid);
            }
        }
    }
    if let Some(ids) = patch.remove_tag_ids {
        for tid in ids {
            let _ = db::unassign_tag(&conn, id, tid);
        }
    }
    Ok(())
}

/// Metadados editáveis de uma pasta numa só chamada. `None` = não mexe; string vazia limpa.
#[derive(serde::Deserialize, Default)]
pub struct FolderPatch {
    pub alias: Option<String>,
    pub hidden: Option<bool>,
    pub color: Option<String>,
    pub cover: Option<String>,
}

/// Mutação consolidada dos metadados de pasta. Substitui set_folder_alias/hidden/color/cover
/// (mantidos como aliases por compatibilidade).
#[tauri::command]
fn folder_meta(app: tauri::AppHandle, dir: String, patch: FolderPatch) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(a) = patch.alias {
        let a = a.trim();
        db::set_folder_alias(&conn, &dir, if a.is_empty() { None } else { Some(a) }).map_err(|e| e.to_string())?;
    }
    if let Some(h) = patch.hidden {
        db::set_folder_hidden(&conn, &dir, h).map_err(|e| e.to_string())?;
    }
    if let Some(c) = patch.color {
        let c = c.trim();
        db::set_folder_color(&conn, &dir, if c.is_empty() { None } else { Some(c) }).map_err(|e| e.to_string())?;
    }
    if let Some(cv) = patch.cover {
        let cv = cv.trim();
        db::set_folder_cover(&conn, &dir, if cv.is_empty() { None } else { Some(cv) }).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    state.reads.with(|conn| db::list_smart(conn)).map_err(|e| e.to_string())
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
    state.reads.with(|conn| db::smart_search(conn, id, sort.as_deref())).map_err(|e| e.to_string())
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
    state.reads.with(|conn| db::list_collections(conn)).map_err(|e| e.to_string())
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
    state.reads.with(|conn| db::collections_for_asset(conn, id)).map_err(|e| e.to_string())
}

/// Exporta os clipes selecionados como FCPXML (DaVinci Resolve / FCP). Não-destrutivo:
/// só escreve o .fcpxml apontando pros arquivos originais; o NLE relinka por caminho.
#[tauri::command]
fn export_nle(app: tauri::AppHandle, asset_ids: Vec<i64>, dest: String) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let clips: Vec<nle::NleClip> = state.reads.with(|c| {
        asset_ids
            .iter()
            .filter_map(|&id| db::clip_for_nle(c, id))
            .map(|(path, name, duration, fps, w, h, kind)| nle::NleClip {
                path,
                name,
                duration,
                fps,
                w,
                h,
                kind,
            })
            .collect()
    });
    if clips.is_empty() {
        return Err("Nenhum clipe pra exportar.".into());
    }
    let n = clips.len();
    std::fs::write(&dest, nle::build_fcpxml(&clips)).map_err(|e| e.to_string())?;
    tracing::info!(dest = %dest, n, "export_nle: FCPXML gerado");
    Ok(n)
}

/// Raízes indexadas que estão OFFLINE agora (HD/drive desconectado). Barato: checa só as
/// pastas-raiz, não cada arquivo. O frontend marca como offline os assets sob essas raízes
/// — eles seguem navegáveis pelas miniaturas em cache (catálogo de drives, estilo NeoFinder).
#[tauri::command]
fn offline_dirs(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let roots = state.reads.with(|c| db::folder_roots(c)).map_err(|e| e.to_string())?;
    Ok(roots
        .into_iter()
        .filter(|p| !std::path::Path::new(p).exists())
        .collect())
}

// ---------- Moodboard (quadro livre de uma coleção) ----------

#[tauri::command]
fn board_layout(app: tauri::AppHandle, collection_id: i64) -> Result<Vec<db::BoardItem>, String> {
    let state = app.state::<AppState>();
    state.reads.with(|c| db::board_layout(c, collection_id)).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_board_item(
    app: tauri::AppHandle,
    collection_id: i64,
    asset_id: i64,
    x: f64,
    y: f64,
    w: f64,
    z: i64,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_board_item(&conn, collection_id, asset_id, x, y, w, z).map_err(|e| e.to_string())
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
    auto_proxy_on_import: bool,
}

#[tauri::command]
fn ai_status(app: tauri::AppHandle) -> Result<AiStatus, String> {
    let state = app.state::<AppState>();
    let s = ai::load_settings(&state.data_dir);
    Ok(AiStatus {
        has_key: s.anthropic_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false),
        model: s.model(),
        autotag_on_import: s.autotag_on_import.unwrap_or(false),
        auto_proxy_on_import: s.auto_proxy_on_import.unwrap_or(true),
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

/// Liga/desliga a geração automática de proxies (preview de codecs pro) ao importar.
#[tauri::command]
fn set_auto_proxy_import(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut s = ai::load_settings(&state.data_dir);
    s.auto_proxy_on_import = Some(on);
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

/// Roda a análise de IA num lote de ids, EM PARALELO (várias chamadas à API ao mesmo
/// tempo) — essencial pra bibliotecas grandes (dezenas de milhares). Emite ai:progress
/// e ai:done. As gravações no banco serializam pelo Mutex; só as chamadas de rede são
/// concorrentes.
fn run_ai_batch(
    app: tauri::AppHandle,
    db: Arc<Mutex<Connection>>,
    key: String,
    model: String,
    ids: Vec<i64>,
) {
    const WORKERS: usize = 6; // chamadas simultâneas à API (equilíbrio velocidade × limites)
    let jobs = app.state::<AppState>().jobs.clone();
    // Só a rede é concorrente; as gravações serializam no writer Mutex dentro do work.
    let _ = jobs.run_batch(app.clone(), "ai", ids, WORKERS, move |id: &i64| {
        let id = *id;
        let thumb = db.lock().ok().and_then(|conn| db::thumb_of(&conn, id).ok().flatten());
        if let Some(thumb) = thumb {
            if let Ok(res) = ai::analyze_image(&key, &model, std::path::Path::new(&thumb)) {
                if let Ok(conn) = db.lock() {
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
        }
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

/// AI Action (plugin do Eagle): pergunta livre sobre UMA imagem (descreva, que texto há,
/// sugira um nome, etc.). Usa a thumb em cache e a chave/modelo já configurados.
#[tauri::command]
fn ai_ask_image(app: tauri::AppHandle, id: i64, question: String) -> Result<String, String> {
    let state = app.state::<AppState>();
    let settings = ai::load_settings(&state.data_dir);
    let key = settings
        .anthropic_key
        .clone()
        .filter(|k| !k.is_empty())
        .ok_or("Configure sua chave da API nas configurações.")?;
    let thumb: Option<String> = state
        .reads
        .with(|conn| {
            conn.query_row(
                "SELECT thumbnail_path FROM assets WHERE id=?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
        })
        .map_err(|e| e.to_string())?;
    let thumb = thumb.filter(|t| !t.is_empty()).ok_or("Este item não tem miniatura para a IA olhar.")?;
    ai::ask_image(&key, &settings.model(), std::path::Path::new(&thumb), question.trim())
}

/// Quantos assets ainda não têm descrição de IA (pra mostrar no botão "Analisar todas").
#[tauri::command]
fn ai_pending_count(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.state::<AppState>();
    state.reads.with(|conn| db::count_needing_ai(conn)).map_err(|e| e.to_string())
}

/// Analisa em lote os assets ainda SEM descrição de IA. `limit <= 0` = TODAS as pendentes.
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
        db::assets_needing_ai(&conn, limit).map_err(|e| e.to_string())?
    };
    let n = ids.len();
    run_ai_batch(app.clone(), state.db.clone(), key, settings.model(), ids);
    Ok(n)
}

/// "Buscar por imagem": assets visualmente parecidos com `id` (perceptual hash local).
#[tauri::command]
fn similar_assets(
    app: tauri::AppHandle,
    id: i64,
    limit: i64,
    max_dist: i64,
) -> Result<Vec<db::Asset>, String> {
    let state = app.state::<AppState>();
    let lim = if limit <= 0 { 60 } else { limit };
    let md = if max_dist <= 0 { 22 } else { max_dist as u32 }; // padrão 22
    state.reads.with(|conn| db::similar(conn, id, lim, md)).map_err(|e| e.to_string())
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
                tracing::info!(id = it.id, from = %old, to = %np, "rename_files: arquivo renomeado");
                out.push(RenameResult { id: it.id, old_path: old, new_path: np, ok: true, error: None });
            }
            Err(e) => {
                tracing::warn!(id = it.id, from = %old, to = %new_path.display(), erro = %e, "rename_files: FALHA ao renomear");
                out.push(RenameResult { id: it.id, old_path: old.clone(), new_path: new_path.to_string_lossy().to_string(), ok: false, error: Some(e.to_string()) });
            }
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

/// Abre o arquivo no aplicativo PADRÃO do sistema (o player de vídeo do Windows, etc.).
/// Usamos um comando próprio porque o `openPath` do plugin é restrito por escopo e
/// estava caindo no fallback (abrindo a pasta em vez da mídia).
#[tauri::command]
fn open_external(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `cmd /C start "" "arquivo"` → ShellExecute com o app padrão da extensão.
        std::process::Command::new("cmd")
            .raw_arg(format!("/C start \"\" \"{}\"", path))
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

// ---------------- Ecossistema: VELVET + QUARTZO ----------------

/// Designer: exporta um CONTACT SHEET (folha de contato) das imagens selecionadas — compõe as
/// miniaturas numa grade PNG, salva no Inbox e cataloga. `ids` vazio = nada. Retorna o caminho.
#[tauri::command]
fn export_contact_sheet(app: tauri::AppHandle, ids: Vec<i64>) -> Result<String, String> {
    let state = app.state::<AppState>();
    if ids.is_empty() {
        return Err("Selecione ao menos uma imagem.".into());
    }
    let thumbs: Vec<std::path::PathBuf> = state
        .reads
        .with(|c| {
            let mut out = Vec::new();
            for id in &ids {
                if let Ok(Some(tp)) = c.query_row(
                    "SELECT thumbnail_path FROM assets WHERE id=?1",
                    rusqlite::params![id],
                    |r| r.get::<_, Option<String>>(0),
                ) {
                    if !tp.is_empty() {
                        out.push(std::path::PathBuf::from(tp));
                    }
                }
            }
            Ok::<_, rusqlite::Error>(out)
        })
        .map_err(|e| e.to_string())?;
    if thumbs.is_empty() {
        return Err("Os itens selecionados não têm miniatura.".into());
    }
    let cols = (thumbs.len() as f64).sqrt().ceil() as u32;
    let cols = cols.clamp(2, 10);
    let inbox = state.data_dir.join("Inbox");
    std::fs::create_dir_all(&inbox).map_err(|e| e.to_string())?;
    let mut out = inbox.join("contact_sheet.png");
    let mut k = 1;
    while out.exists() {
        out = inbox.join(format!("contact_sheet_{k}.png"));
        k += 1;
    }
    thumbs::make_contact_sheet(&thumbs, cols, 320, 12, &out).ok_or("falha ao montar a folha")?;
    let db = state.db.clone();
    let thumbs_dir = state.thumbs_dir.clone();
    indexer::index_one(&db, &thumbs_dir, &out).ok_or("montou mas falhou ao catalogar")?;
    tracing::info!(n = thumbs.len(), dest = %out.display(), "export_contact_sheet");
    Ok(out.to_string_lossy().to_string())
}

/// VELVET: exporta o catálogo de LUTs (por humor) pro contrato estável `velvet_luts.json`
/// no diretório de dados. O VELVET (no DaVinci) lê esse arquivo pra escolher a LUT.
#[tauri::command]
fn export_velvet_catalog(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let out = state.data_dir.join("velvet_luts.json");
    let n = state
        .reads
        .with(|conn| ecosystem::export_velvet_catalog(conn, &out))
        .map_err(|e| e.to_string())?;
    tracing::info!(luts = n, dest = %out.display(), "velvet: catálogo de LUTs exportado");
    Ok(out.to_string_lossy().to_string())
}

/// VELVET "Aplicar CST no DaVinci": o PRISMA decide a árvore de nós (CST IN/OUT + Exposição/
/// Balanço/Saturação/Curva + nó VELVET) a partir do CST que ele lê do clipe e grava o request
/// `velvet_apply.json`. O plugin VELVET (Resolve Python API) consome e monta tudo. Retorna um
/// resumo curto pra UI.
#[derive(serde::Serialize)]
struct VelvetApplyResult {
    summary: String,
    nodes: usize,
    request_path: String,
}

#[tauri::command]
fn velvet_apply_cst(app: tauri::AppHandle, id: i64) -> Result<VelvetApplyResult, String> {
    let state = app.state::<AppState>();
    let path: String = state
        .reads
        .with(|conn| {
            conn.query_row("SELECT path FROM assets WHERE id=?1", rusqlite::params![id], |r| r.get(0))
        })
        .map_err(|e| e.to_string())?;
    let media = mediainfo::probe(std::path::Path::new(&path));
    let req = ecosystem::build_apply_request(&media, &path);
    let n = req.get("nodes").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
    let out = ecosystem::write_apply_request(&state.data_dir, &req)?;
    tracing::info!(clip = %path, nodes = n, "velvet_apply_cst: request gravado");
    Ok(VelvetApplyResult {
        summary: media.cst.summary.clone(),
        nodes: n,
        request_path: out.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn quartzo_get_vault(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    Ok(ai::load_settings(&state.data_dir).quartzo_vault)
}

#[tauri::command]
fn quartzo_set_vault(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut s = ai::load_settings(&state.data_dir);
    s.quartzo_vault = if path.trim().is_empty() { None } else { Some(path) };
    ai::save_settings(&state.data_dir, &s)
}

fn quartzo_vault_path(state: &AppState) -> Result<std::path::PathBuf, String> {
    ai::load_settings(&state.data_dir)
        .quartzo_vault
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "Defina a pasta do vault do Quartzo nas Configurações › Ecossistema.".into())
}

#[tauri::command]
fn quartzo_notes(app: tauri::AppHandle) -> Result<Vec<ecosystem::QuartzoNote>, String> {
    let state = app.state::<AppState>();
    let vault = quartzo_vault_path(&state)?;
    Ok(ecosystem::list_notes(&vault))
}

#[tauri::command]
fn quartzo_attach(app: tauri::AppHandle, asset_id: i64, note_rel: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let vault = quartzo_vault_path(&state)?;
    let (name, path): (String, String) = state
        .reads
        .with(|conn| {
            conn.query_row(
                "SELECT COALESCE(name, filename), path FROM assets WHERE id=?1",
                rusqlite::params![asset_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
        })
        .map_err(|e| e.to_string())?;
    ecosystem::attach_asset(&vault, &note_rel, asset_id, &name, &path)
}

#[tauri::command]
fn quartzo_notes_for_asset(app: tauri::AppHandle, asset_id: i64) -> Result<Vec<ecosystem::QuartzoNote>, String> {
    let state = app.state::<AppState>();
    let vault = quartzo_vault_path(&state)?;
    let path: String = state
        .reads
        .with(|conn| {
            conn.query_row(
                "SELECT path FROM assets WHERE id=?1",
                rusqlite::params![asset_id],
                |r| r.get(0),
            )
        })
        .map_err(|e| e.to_string())?;
    Ok(ecosystem::notes_for_asset(&vault, asset_id, &path))
}

#[tauri::command]
fn quartzo_open_note(app: tauri::AppHandle, note_rel: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let vault = quartzo_vault_path(&state)?;
    let abs = ecosystem::note_abs_path(&vault, &note_rel);
    open_external(abs.to_string_lossy().to_string())
}

// Apaga o CONTEÚDO de uma pasta (arquivos e subpastas), sem remover a pasta em si.
fn clear_dir(dir: &std::path::Path) -> std::io::Result<()> {
    if dir.exists() {
        for entry in std::fs::read_dir(dir)? {
            let p = entry?.path();
            if p.is_dir() {
                let _ = std::fs::remove_dir_all(&p);
            } else {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    Ok(())
}

// ---------- Vault (base de conhecimento RAG — Briefing 6) ----------

#[derive(serde::Serialize)]
pub struct VaultStatus {
    path: Option<String>,
    count: i64,
}

#[tauri::command]
fn vault_status(app: tauri::AppHandle) -> Result<VaultStatus, String> {
    let state = app.state::<AppState>();
    let s = ai::load_settings(&state.data_dir);
    let count = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::vault_count(&conn).unwrap_or(0)
    };
    Ok(VaultStatus { path: s.vault_path, count })
}

/// Define a pasta do vault e reindexa na hora. Retorna o nº de chunks.
#[tauri::command]
fn set_vault_path(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let mut s = ai::load_settings(&state.data_dir);
    s.vault_path = if path.trim().is_empty() { None } else { Some(path.clone()) };
    ai::save_settings(&state.data_dir, &s)?;
    if let Some(p) = s.vault_path.as_ref() {
        let n = vault::index_vault(&state.db, std::path::Path::new(p));
        // (re)inicia o watcher na nova pasta (dropar o handle antigo para o watcher anterior)
        let w = vault::start_watch(app.clone(), state.db.clone(), std::path::PathBuf::from(p));
        if let Ok(mut slot) = state.vault_watcher.lock() {
            *slot = w;
        }
        Ok(n)
    } else {
        if let Ok(mut slot) = state.vault_watcher.lock() {
            *slot = None;
        }
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db::clear_vault(&conn);
        Ok(0)
    }
}

/// Reindexa o vault já configurado. Retorna o nº de chunks.
#[tauri::command]
fn reindex_vault(app: tauri::AppHandle) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let s = ai::load_settings(&state.data_dir);
    match s.vault_path {
        Some(p) => Ok(vault::index_vault(&state.db, std::path::Path::new(&p))),
        None => Err("Nenhuma pasta de vault configurada.".into()),
    }
}

/// Busca chunks do vault por palavra-chave (RAG simples). Usado pelo Plano de Color.
#[tauri::command]
fn search_vault(app: tauri::AppHandle, query: String, limit: i64) -> Result<Vec<db::VaultChunk>, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::search_vault(&conn, &query, if limit <= 0 { 6 } else { limit }).map_err(|e| e.to_string())
}

#[derive(serde::Serialize, Default)]
pub struct ColorPlanOut {
    ok: bool,             // a IA respondeu
    plan: String,         // texto do plano (Haiku)
    sources: Vec<String>, // notas do vault citadas
    note: String,         // mensagem quando offline/sem chave
}

/// Plano de Color sob medida (Briefing 6 §4): metadados + diagnóstico + CST + RAG do vault → Haiku.
/// O técnico (CST/diagnóstico) é determinístico e já vem nos cards; aqui a IA só MONTA/EXPLICA.
#[tauri::command]
fn color_plan(app: tauri::AppHandle, path: String, lang: Option<String>) -> Result<ColorPlanOut, String> {
    let state = app.state::<AppState>();
    let settings = ai::load_settings(&state.data_dir);
    let info = mediainfo::probe(std::path::Path::new(&path));
    let v = info.video.as_ref();
    let make = info.camera.as_ref().and_then(|c| c.make.clone()).unwrap_or_default();
    let trc = v.and_then(|x| x.transfer.clone()).unwrap_or_default();
    let prim = v.and_then(|x| x.color_primaries.clone()).unwrap_or_default();
    let codec = v.and_then(|x| x.codec.clone()).unwrap_or_default();
    let depth = v.and_then(|x| x.bit_depth);
    let (w, h) = (v.and_then(|x| x.width).unwrap_or(0), v.and_then(|x| x.height).unwrap_or(0));
    let vertical = h > w;

    // RAG: recupera chunks relevantes do vault.
    let query = format!(
        "{make} {trc} {prim} {codec} CST Log HLG exposição método nós LUT tempero {}",
        if vertical { "Reels vertical" } else { "" }
    );
    let chunks = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::search_vault(&conn, &query, 6).unwrap_or_default()
    };
    let mut sources: Vec<String> = Vec::new();
    for c in &chunks {
        if !sources.contains(&c.note) {
            sources.push(c.note.clone());
        }
    }

    let key = match settings.anthropic_key.clone().filter(|k| !k.is_empty()) {
        Some(k) => k,
        None => {
            return Ok(ColorPlanOut {
                ok: false,
                plan: String::new(),
                sources,
                note: "Configure a chave da IA (Configurações › IA e busca) pra montar o plano explicado. O CST e o diagnóstico acima já funcionam offline.".into(),
            })
        }
    };

    let cst = &info.cst;
    let diag = info
        .health
        .iter()
        .map(|x| format!("- {} ({}): {}", x.label, x.level, x.detail))
        .collect::<Vec<_>>()
        .join("\n");
    let cst_txt = if cst.needs_cst {
        format!(
            "Origem detectada: {} / {} (determinístico={}). Método de 2 nós: NÓ IN = origem → DaVinci Wide Gamut/Intermediate (Tone e Gamut = Nenhum); NÓ OUT = DaVinci Wide Gamut/Intermediate → entrega (Tone = DaVinci e Gamut = Compressão de Saturação quando HDR/wide → SDR).",
            cst.input_color_space.clone().unwrap_or_default(),
            cst.input_gamma.clone().unwrap_or_default(),
            cst.determinate
        )
    } else {
        format!("CST: {}", cst.summary)
    };
    let vault_text = if chunks.is_empty() {
        "(vault vazio ou nada relevante encontrado)".to_string()
    } else {
        chunks
            .iter()
            .map(|c| format!("[{} › {}]\n{}", c.note, c.heading, c.text.chars().take(900).collect::<String>()))
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    let meta = format!(
        "Codec: {codec}; bit depth: {}; primaries: {}; transfer: {}; resolução: {}x{} ({}); fps_mode: {}",
        depth.map(|d| d.to_string()).unwrap_or_else(|| "?".into()),
        if prim.is_empty() { "?".into() } else { prim.clone() },
        if trc.is_empty() { "ausente".into() } else { trc.clone() },
        w, h,
        if vertical { "vertical 9:16" } else { "horizontal" },
        if v.map(|x| x.vfr).unwrap_or(false) { "VFR" } else { "CFR" },
    );

    let resp_lang = match lang.as_deref() {
        Some("en") => "Responda em INGLÊS.",
        Some("es") => "Responda em ESPANHOL.",
        _ => "Responda em PORTUGUÊS.",
    };
    let system = format!("Você é o assistente de pós-produção do PRISMA, para um editor/colorista. {resp_lang} \
Monte um PLANO DE COLOR conciso e prático, baseado APENAS no contexto técnico e nas NOTAS DO VAULT fornecidas. \
REGRAS DE OURO: (1) NÃO invente nada — se não houver base nas notas pra alguma recomendação, escreva 'sem regra no vault — confira manualmente'. \
(2) O CST e o diagnóstico técnico são DETERMINÍSTICOS e já foram calculados; explique-os, não os contradiga. \
(3) Cite a nota-fonte entre colchetes [Nota › Heading] sempre que usar uma regra do vault. \
(4) Marque incerteza quando a origem/transfer for deduzida. Seja direto, em tópicos curtos.");
    let user = format!(
        "METADADOS:\n{meta}\n\nDIAGNÓSTICO (selos):\n{diag}\n\nCST (determinístico):\n{cst_txt}\n\nNOTAS DO VAULT:\n{vault_text}\n\nCONTEXTO FIXO DO EDITOR: institucional (SEPAT) + clientes (Mentors); entrega Reels/web Rec.709; usa método de 2 nós + tempero La Creme.\n\nMonte o plano cobrindo: tipo detectado; precisa CFR?; método de nós; alvos de exposição; LUT de tempero e dosagem; avisos. Cite as notas usadas."
    );

    match ai::ask_text(&key, &settings.model(), &system, &user) {
        Ok(plan) => Ok(ColorPlanOut { ok: true, plan, sources, note: String::new() }),
        Err(e) => Ok(ColorPlanOut {
            ok: false,
            plan: String::new(),
            sources,
            note: format!("Sem internet ou erro na IA ({e}). O CST e o diagnóstico acima funcionam offline."),
        }),
    }
}

// ---------- Saúde da biblioteca (diagnóstico em cache + lote) ----------

/// Roda o diagnóstico (probe) de vários vídeos EM PARALELO e grava em cache.
fn run_health_scan(app: tauri::AppHandle, db: Arc<Mutex<Connection>>, paths: Vec<String>) {
    const WORKERS: usize = 6;
    let jobs = app.state::<AppState>().jobs.clone();
    let _ = jobs.run_batch(app.clone(), "health", paths, WORKERS, move |path: &String| {
        let info = mediainfo::probe(std::path::Path::new(path));
        if info.video.is_some() {
            let (level, flags) = mediainfo::health_summary(&info);
            if let Ok(conn) = db.lock() {
                let _ = db::set_health(&conn, path, &level, &flags);
            }
        }
    });
}

/// Escaneia a saúde dos vídeos ainda sem diagnóstico em cache. `limit<=0` = todos.
#[tauri::command]
fn scan_health(app: tauri::AppHandle, limit: i64) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let paths = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::assets_needing_health(&conn, limit).map_err(|e| e.to_string())?
    };
    let n = paths.len();
    if n > 0 {
        run_health_scan(app.clone(), state.db.clone(), paths);
    }
    Ok(n)
}

/// Contagem por flag de saúde (pros atalhos inteligentes).
#[tauri::command]
fn health_counts(app: tauri::AppHandle) -> Result<std::collections::HashMap<String, i64>, String> {
    let state = app.state::<AppState>();
    state.reads.with(|conn| db::health_counts(conn)).map_err(|e| e.to_string())
}

/// Remove uma pasta da BIBLIOTECA (catálogo) — tira os assets dela e das subpastas do
/// catálogo + metadados. NÃO apaga nada do disco. Para de monitorar a pasta também.
#[tauri::command]
fn remove_folder_lib(app: tauri::AppHandle, dir: String) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let (n, files) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let files = db::folder_cache_files(&conn, &dir).unwrap_or_default();
        let n = db::remove_folder(&conn, &dir).map_err(|e| e.to_string())?;
        (n, files)
    };
    let cache_n = files.len();
    // cache (proxy+miniatura) some em background — não trava a UI numa pasta com milhares de arquivos
    std::thread::spawn(move || delete_cache_files(&files));
    tracing::info!(dir = %dir, removed = n, cache = cache_n, "remove_folder: pasta removida da biblioteca");
    Ok(n)
}

/// Recarrega/gera os proxies que faltam (caso algum tenha falhado). Roda em segundo plano.
/// Retorna quantos vídeos entraram na fila.
#[tauri::command]
fn regen_proxies(app: tauri::AppHandle) -> Result<usize, String> {
    let state = app.state::<AppState>();
    let vids = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::videos_without_proxy_all(&conn).map_err(|e| e.to_string())?
    };
    let n = vids.len();
    if n > 0 {
        let ffmpeg = thumbs::bin_path("ffmpeg");
        let proxy_dir = state.data_dir.join("proxies");
        oficina::run_proxy_batch(app.clone(), state.db.clone(), ffmpeg, proxy_dir, vids);
    }
    Ok(n)
}

/// Redefine o app DO ZERO: zera o catálogo (todas as tabelas, mantém o schema), apaga
/// miniaturas e proxies, e reseta as configurações — MANTENDO só a chave da API. Reinicia.
#[tauri::command]
fn reset_app(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    // 1) esvazia todas as tabelas do catálogo (preserva a estrutura)
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let tables: Vec<String> = {
            // exclui as tabelas internas do FTS5 (assets_fts*); limpar `assets` já zera o
            // índice pelos triggers, e ele se auto-repara no boot.
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%\\_fts%' ESCAPE '\\'")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        for t in tables {
            let _ = conn.execute(&format!("DELETE FROM \"{t}\""), []);
        }
        let _ = conn.execute("DELETE FROM sqlite_sequence", []);
        let _ = conn.execute("VACUUM", []);
    }
    // 2) limpa os caches em disco (miniaturas + proxies)
    let _ = clear_dir(&state.thumbs_dir);
    let _ = clear_dir(&state.data_dir.join("proxies"));
    // 3) reseta as configurações preservando a chave/modelo da API
    let s = ai::load_settings(&state.data_dir);
    let kept = ai::Settings {
        anthropic_key: s.anthropic_key,
        model: s.model,
        autotag_on_import: None,
        auto_proxy_on_import: None,
        vault_path: s.vault_path,
        quartzo_vault: s.quartzo_vault,
    };
    let _ = ai::save_settings(&state.data_dir, &kept);
    // 4) reinicia o app pra reinicializar tudo do zero (catálogo vazio)
    app.restart()
}

/// Backup do catálogo num arquivo .db único e consistente (VACUUM INTO inclui o WAL).
/// Não toca em nenhum arquivo de mídia — só copia o banco (tags/estrelas/notas/coleções).
#[tauri::command]
fn backup_catalog(app: tauri::AppHandle, dest: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let safe = dest.replace('\'', "''");
    conn.execute(&format!("VACUUM INTO '{safe}'"), [])
        .map_err(|e| e.to_string())?;
    tracing::info!(dest = %dest, "backup_catalog: catálogo exportado");
    Ok(())
}

/// Restaura o catálogo a partir de um backup .db. O banco está aberto/locked, então não dá
/// pra sobrescrever na hora: grava um MARCADOR e reinicia; no boot o arquivo é trocado
/// ANTES de abrir o banco. Não toca em mídia.
#[tauri::command]
fn restore_catalog(app: tauri::AppHandle, src: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let p = std::path::Path::new(&src);
    if !p.exists() {
        return Err("Arquivo de backup não encontrado.".into());
    }
    // validação leve: cabeçalho de arquivo SQLite
    let header = std::fs::read(p).map_err(|e| e.to_string())?;
    if header.len() < 16 || &header[0..15] != b"SQLite format 3" {
        return Err("Esse arquivo não parece um backup válido do PRISMA.".into());
    }
    std::fs::write(state.data_dir.join("pending_restore.txt"), &src).map_err(|e| e.to_string())?;
    tracing::info!(src = %src, "restore_catalog: restauração agendada; reiniciando");
    app.restart()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Logs estruturados. Controlável via env PRISMA_LOG (ex.: PRISMA_LOG=debug);
    // padrão "info". `try_init` para não dar pânico se já inicializado.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("PRISMA_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            // Restauração de backup pendente: troca o arquivo do banco ANTES de abrir.
            let pending = data_dir.join("pending_restore.txt");
            if pending.exists() {
                if let Ok(src) = std::fs::read_to_string(&pending) {
                    let src = src.trim();
                    if !src.is_empty() && std::path::Path::new(src).exists() {
                        let _ = std::fs::copy(src, &db_path);
                        let _ = std::fs::remove_file(data_dir.join("prisma.db-wal"));
                        let _ = std::fs::remove_file(data_dir.join("prisma.db-shm"));
                    }
                }
                let _ = std::fs::remove_file(&pending);
            }

            let conn = db::open(&db_path).expect("falha ao abrir o banco");
            // Limpeza única: tira da biblioteca o clipe de teste do Gyroflow (pasta temp).
            let _ = conn.execute(
                "DELETE FROM assets WHERE dir LIKE '%prisma-gyro-test%' OR path LIKE '%prisma-gyro-test%'",
                [],
            );

            let db_arc = Arc::new(Mutex::new(conn));
            // Pool de leitura (WAL): a UI lê sem disputar o lock do writer. 4 conexões
            // pré-abertas cobrem as leituras curtas (busca/contagens/listas).
            let reads = Arc::new(dbpool::ReadPool::new(db_path.clone(), 4));

            // Watch Folder: monitora as pastas indexadas e cataloga/remove sozinho.
            let watcher = watcher::start(app.handle().clone(), db_arc.clone(), thumbs_dir.clone());
            let vault_watcher_arc: Arc<Mutex<Option<notify::RecommendedWatcher>>> =
                Arc::new(Mutex::new(None));

            app.manage(AppState {
                db: db_arc.clone(),
                reads,
                thumbs_dir: thumbs_dir.clone(),
                data_dir: data_dir.clone(),
                drag_icon,
                jobs: Arc::new(jobs::Jobs::new()),
                watcher: Arc::new(Mutex::new(watcher)),
                vault_watcher: vault_watcher_arc.clone(),
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
            // Reindexa o vault Obsidian no boot + inicia o watcher (reindexa a cada edição de nota).
            {
                let settings = ai::load_settings(&data_dir);
                if let Some(vp) = settings.vault_path {
                    let handle = app.handle().clone();
                    let emit_handle = handle.clone();
                    let db_vault = db_arc.clone();
                    let vp2 = vp.clone();
                    std::thread::spawn(move || {
                        let n = vault::index_vault(&db_vault, std::path::Path::new(&vp2));
                        let _ = emit_handle.emit("vault:indexed", n);
                    });
                    // watcher ao vivo (mantém a base atual a cada edição de nota)
                    let w = vault::start_watch(handle.clone(), db_arc.clone(), std::path::PathBuf::from(&vp));
                    if let Ok(mut slot) = vault_watcher_arc.lock() {
                        *slot = w;
                    }
                }
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
            feature_flags,
            mutate_asset,
            folder_meta,
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
            open_external,
            reset_app,
            regen_proxies,
            remove_folder_lib,
            vault_status,
            set_vault_path,
            reindex_vault,
            search_vault,
            color_plan,
            scan_health,
            health_counts,
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
            board_layout,
            set_board_item,
            export_nle,
            offline_dirs,
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
            trash_paths,
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
            search_folders,
            video_download,
            video_download_info,
            fetch_lyrics,
            ai_ask_image,
            ai_upscale,
            ai_remove_bg,
            clip_status,
            clip_index,
            clip_search,
            clip_autotag,
            export_contact_sheet,
            export_velvet_catalog,
            velvet_apply_cst,
            quartzo_get_vault,
            quartzo_set_vault,
            quartzo_notes,
            quartzo_attach,
            quartzo_notes_for_asset,
            quartzo_open_note,
            autotag_folder,
            paste_image,
            add_from_url,
            save_annotated,
            set_autotag_import,
            set_auto_proxy_import,
            ai_pending_count,
            list_presets,
            save_preset,
            delete_preset,
            concat_run,
            export_catalog,
            import_catalog,
            backup_catalog,
            restore_catalog
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
