//! Watch Folder (Briefing 4 #2): monitora as pastas indexadas e cataloga/remove sozinho.
//! crate `notify` → eventos create/modify/remove com debounce; espera o arquivo parar de copiar.

use crate::{db, indexer};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

fn is_junk(name: &str) -> bool {
    name.starts_with("._")
        || name.eq_ignore_ascii_case(".ds_store")
        || name.eq_ignore_ascii_case("thumbs.db")
        || name.eq_ignore_ascii_case("desktop.ini")
}

/// Inicia o watcher e devolve o handle (mantê-lo vivo no AppState pra adicionar pastas novas).
pub fn start(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
) -> Option<RecommendedWatcher> {
    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .ok()?;

    let roots = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::watched_roots(&conn).unwrap_or_default()
    };
    for root in &roots {
        let _ = watcher.watch(Path::new(root), RecursiveMode::Recursive);
    }

    std::thread::spawn(move || {
        let mut pending: HashMap<PathBuf, Instant> = HashMap::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(400)) {
                Ok(Ok(event)) => {
                    if matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    ) {
                        for p in event.paths {
                            pending.insert(p, Instant::now());
                        }
                    }
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }

            // processa o que estabilizou (>1.2s sem novo evento)
            let now = Instant::now();
            let ready: Vec<PathBuf> = pending
                .iter()
                .filter(|(_, t)| now.duration_since(**t) > Duration::from_millis(1200))
                .map(|(p, _)| p.clone())
                .collect();
            if ready.is_empty() {
                continue;
            }
            let mut changed = false;
            for p in ready {
                pending.remove(&p);
                let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                if is_junk(&name) {
                    continue;
                }
                let pstr = p.to_string_lossy().to_string();
                if p.is_file() {
                    let already = {
                        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
                        db::path_exists(&conn, &pstr)
                    };
                    if !already {
                        if size_stable(&p) {
                            if indexer::index_one(&db, &thumbs_dir, &p).is_some() {
                                changed = true;
                            }
                        } else {
                            // ainda copiando → re-agenda
                            pending.insert(p, Instant::now());
                        }
                    }
                } else if !p.exists() {
                    // sumiu do disco → tira do catálogo (arquivo ou pasta inteira)
                    let conn = db.lock().unwrap_or_else(|p| p.into_inner());
                    let removed = db::delete_by_path(&conn, &pstr).unwrap_or(false);
                    let under = db::assets_under(&conn, &pstr).unwrap_or_default();
                    for (id, _) in &under {
                        let _ = db::delete_asset(&conn, *id);
                    }
                    if removed || !under.is_empty() {
                        changed = true;
                    }
                }
            }
            if changed {
                let _ = app.emit("watch:changed", ());
            }
        }
    });

    Some(watcher)
}

/// Adiciona uma raiz nova ao watcher (quando o usuário indexa uma pasta nova).
pub fn watch_root(watcher: &mut RecommendedWatcher, path: &str) {
    let _ = watcher.watch(Path::new(path), RecursiveMode::Recursive);
}

/// Para de monitorar uma pasta (ao removê-la da biblioteca) — senão o watcher re-indexaria os
/// arquivos que o DELETE acabou de tirar (eles "voltavam"). Erro = não era raiz monitorada (ok).
pub fn unwatch_root(watcher: &mut RecommendedWatcher, path: &str) {
    let _ = watcher.unwatch(Path::new(path));
}

/// Espera o tamanho do arquivo estabilizar (evita catalogar arquivo ainda copiando).
fn size_stable(p: &Path) -> bool {
    let s1 = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    std::thread::sleep(Duration::from_millis(250));
    let s2 = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    s1 == s2 && s1 > 0
}
