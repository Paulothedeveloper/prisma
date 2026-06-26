//! Indexação do vault Obsidian como base de conhecimento (RAG) — Briefing 6 §1.
//! Lê os `.md`, quebra por heading (## / ###) e guarda em vault_chunks pra recuperação.

use crate::db;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Coleta todos os `.md` da pasta (recursivo).
fn collect_md(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                collect_md(&p, out);
            } else if p
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
            {
                out.push(p);
            }
        }
    }
}

/// Quebra o markdown por heading nível 2/3. Cada chunk = heading + corpo até o próximo.
fn chunk_md(content: &str) -> Vec<(String, String)> {
    let mut chunks = Vec::new();
    let mut heading = String::from("(intro)");
    let mut buf = String::new();
    for line in content.lines() {
        let t = line.trim_start();
        if t.starts_with("## ") || t.starts_with("### ") {
            if !buf.trim().is_empty() {
                chunks.push((heading.clone(), buf.trim().to_string()));
            }
            heading = t.trim_start_matches('#').trim().to_string();
            buf.clear();
        } else {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    if !buf.trim().is_empty() {
        chunks.push((heading, buf.trim().to_string()));
    }
    chunks
}

/// Reindexa o vault inteiro. Retorna o número de chunks indexados.
pub fn index_vault(db: &Arc<Mutex<Connection>>, dir: &Path) -> usize {
    // Coleta + parse dos .md FORA do lock do writer (I/O lento). Antes o lock ficava retido
    // durante a varredura inteira do filesystem, congelando TODA escrita do app (importação,
    // watcher de mídia, IA) — e o watcher do vault dispara isto a cada edição de nota.
    let mut files = Vec::new();
    collect_md(dir, &mut files);
    let mut parsed: Vec<(String, String, String)> = Vec::new(); // (note, heading, text)
    for p in files {
        if let Ok(content) = std::fs::read_to_string(&p) {
            let note = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            for (heading, text) in chunk_md(&content) {
                if text.trim().len() >= 10 {
                    parsed.push((note.clone(), heading, text));
                }
            }
        }
    }
    // Agora sim: lock CURTO só pra gravar os chunks já prontos.
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    let _ = db::clear_vault(&conn);
    let mut total = 0usize;
    for (note, heading, text) in &parsed {
        if db::insert_vault_chunk(&conn, note, heading, text).is_ok() {
            total += 1;
        }
    }
    total
}

fn is_md(p: &Path) -> bool {
    p.extension()
        .and_then(|x| x.to_str())
        .map(|x| x.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

/// Watcher do vault: a cada edição de `.md`, reindexa (debounced 1.5s) e emite "vault:indexed".
/// Mantenha o handle vivo no AppState (substituir o handle = para o watcher antigo).
pub fn start_watch(app: AppHandle, db: Arc<Mutex<Connection>>, dir: PathBuf) -> Option<RecommendedWatcher> {
    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .ok()?;
    watcher.watch(&dir, RecursiveMode::Recursive).ok()?;
    std::thread::spawn(move || {
        let mut dirty: Option<Instant> = None;
        loop {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(event)) => {
                    if matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    ) && event.paths.iter().any(|p| is_md(p))
                    {
                        dirty = Some(Instant::now());
                    }
                }
                Ok(Err(_)) => {}
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if let Some(t) = dirty {
                if Instant::now().duration_since(t) > Duration::from_millis(1500) {
                    dirty = None;
                    let n = index_vault(&db, &dir);
                    let _ = app.emit("vault:indexed", n);
                }
            }
        }
    });
    Some(watcher)
}
