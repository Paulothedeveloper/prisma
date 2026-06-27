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
    // Import é trabalho de FUNDO: prioriza manter o PC fluido (UI + DaVinci) em vez de velocidade
    // máxima. Teto baixo (4) + as threads em modo background (sys::begin_background) = sem travar.
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

/// Pastas de SISTEMA que nunca entram na biblioteca (lixeira do Windows, índice de volume).
/// Aparecem quando um drive inteiro é varrido por engano — entram como "S-1-5-21-…" (SID).
/// Recebe o caminho já em minúsculas.
fn is_system_path(path_lower: &str) -> bool {
    path_lower.contains("\\$recycle.bin")
        || path_lower.contains("\\system volume information")
        || path_lower.contains("\\found.000")
}

/// Varre rápido (sem tocar no banco) os caminhos escolhidos e devolve
/// `(compatíveis, incompatíveis)`: quantos são mídia que entra na biblioteca e quantos arquivos
/// "de verdade" (não-lixo de SO) seriam recusados por não serem mídia. A UI usa pra avisar antes.
pub fn scan_importable(paths: &[String]) -> (usize, usize) {
    let mut ok = 0usize;
    let mut skip = 0usize;
    let mut tally = |p: &Path, name: &str| {
        if is_junk(name) {
            return; // lixo de SO não conta como "recusado" — é silencioso
        }
        let ext = p
            .extension()
            .map(|s| s.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if classify::is_media(&ext) {
            ok += 1;
        } else {
            skip += 1;
        }
    };
    for p in paths {
        // Mesma blindagem do índice: drive cru "F:" → "F:\" (senão a contagem prévia anda
        // num caminho drive-relativo e diverge do que será catalogado).
        let p = normalize_root(p);
        let path = Path::new(&p);
        if path.is_file() {
            let name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            tally(path, &name);
        } else if path.is_dir() {
            for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    let pl = entry.path().to_string_lossy().to_lowercase();
                    if is_system_path(&pl) {
                        continue; // não conta lixeira/índice de volume
                    }
                    tally(entry.path(), &entry.file_name().to_string_lossy());
                }
            }
        }
    }
    (ok, skip)
}

/// true se `path_low` (minúsculo) está dentro de — ou é — alguma pasta excluída.
pub fn under_excluded(path_low: &str, excluded: &[String]) -> bool {
    excluded.iter().any(|e| {
        path_low == e.as_str() || path_low.starts_with(&format!("{e}\\"))
    })
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

/// Resumo do "Atualizar pasta" (re-scan inteligente) — vira um toast na UI:
/// quantos arquivos novos, renomeados/movidos (metadados preservados) e removidos.
/// `offline` = a pasta/HD sumiu por inteiro → NÃO mexemos no catálogo (proteção).
#[derive(Serialize, Clone)]
struct RescanSummary {
    folder: String,
    added: usize,
    renamed: usize,
    removed: usize,
    offline: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Normaliza a RAIZ da varredura. Um drive "cru" como `F:` (sem a barra) faz o WalkDir gerar
/// caminhos RELATIVOS ao drive — `F:AFFINITY\...` em vez de `F:\AFFINITY\...` — embaralhando as
/// pastas no catálogo (cada subpasta aparecia com o nome colado no drive). Garante a barra logo
/// após o `X:`. Idempotente: caminhos já corretos passam intactos.
pub fn normalize_root(p: &str) -> String {
    let b = p.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        if b.len() == 2 {
            return format!("{p}\\"); // "F:" -> "F:\"
        }
        if b[2] != b'\\' && b[2] != b'/' {
            return format!("{}:\\{}", &p[..1], &p[2..]); // "F:AFFINITY" -> "F:\AFFINITY"
        }
    }
    p.to_string()
}

/// Roda numa thread propria. Emite: index:start, index:thumb (por arquivo), index:done.
pub fn index_folder(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: std::path::PathBuf,
    folder: String,
    autotag: bool,
) {
    // Blinda contra o drive cru ("F:" → "F:\"): senão o WalkDir gera caminhos drive-relativos
    // ("F:AFFINITY") e embaralha as pastas.
    let folder = normalize_root(&folder);
    let root = Path::new(&folder);
    if !root.exists() {
        let _ = app.emit("index:error", format!("Pasta nao encontrada: {folder}"));
        return;
    }

    // Feedback IMEDIATO: a varredura de uma pasta enorme (27k+) leva alguns segundos antes de
    // saber o total; sem isso a barra ficava parada em 0. total=0 = "catalogando…" (indeterminado).
    let _ = app.emit("index:start", StartPayload { folder: folder.clone(), total: 0 });

    // --- Passo 1: catalogar (rapido, uma transacao) ---
    // Adicionar esta pasta CANCELA qualquer exclusão dela (o usuário quer ela de volta). Depois
    // carrega as OUTRAS pastas excluídas pra pular arquivos que estejam sob elas.
    let excluded: Vec<String> = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::remove_excluded(&conn, &folder);
        db::excluded_list(&conn)
    };
    let folder_id = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::upsert_folder(&conn, &folder, now()).unwrap_or(0)
    };

    // --- Passo 1a: varrer o disco SEM segurar o lock do DB (a parte LENTA: ler metadados de
    // milhares de arquivos). Antes a transação ficava aberta durante a varredura inteira e
    // congelava a UI/watcher por segundos. Aqui só coletamos. ---
    let mut scanned: Vec<db::NewAsset> = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        // Cancelou no meio da varredura → para de catalogar o resto.
        if crate::sys::is_cancelled() {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        // Pula arquivos sob qualquer pasta EXCLUÍDA (removida de propósito) ou de SISTEMA
        // (lixeira/índice de volume) — não re-indexa.
        let p_low = p.to_string_lossy().to_lowercase();
        if under_excluded(&p_low, &excluded) || is_system_path(&p_low) {
            continue;
        }
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
        // Só mídia (vídeo/áudio/imagem/GIF). Documentos, LUTs, fontes e extensões
        // desconhecidas NÃO entram na biblioteca (a UI já avisou o usuário antes).
        if !classify::is_media(&ext) {
            continue;
        }
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
        scanned.push(db::NewAsset {
            path: p.to_string_lossy().to_string(),
            dir,
            filename,
            ext,
            kind,
            size,
            modified_at: modified,
            folder_id,
        });
    }

    // --- Passo 1b: gravar em LOTES de 2000, soltando o lock ENTRE os lotes (a UI/watcher
    // respiram). Sem `.unwrap()` na transação: se o DB estiver ocupado num instante, pula o
    // lote (um rescan recupera) em vez de derrubar a thread de import. ---
    let mut pending: Vec<(i64, String, String, String)> = Vec::new(); // (id, path, ext, kind)
    for chunk in scanned.chunks(2000) {
        if crate::sys::is_cancelled() {
            break;
        }
        let mut conn = db.lock().unwrap_or_else(|p| p.into_inner());
        let tx = match conn.transaction() {
            Ok(t) => t,
            Err(_) => continue,
        };
        for na in chunk {
            // Regra de cache: só (re)gera miniatura pra assets novos ou cujo conteúdo mudou.
            if let Ok((id, needs_thumb)) = db::upsert_asset_cached(&tx, na) {
                if needs_thumb {
                    pending.push((id, na.path.clone(), na.ext.clone(), na.kind.clone()));
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
            let conn = db.lock().unwrap_or_else(|p| p.into_inner());
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

    // Cancelado pelo usuário: para por aqui (não detecta duplicados, não gera proxies). O que já
    // foi catalogado fica — é leve; o usuário pode remover a pasta se quiser. Avisa a UI.
    if crate::sys::is_cancelled() {
        let _ = app.emit("index:cancelled", folder.clone());
        return;
    }

    // Duplicados na importação: avisa o usuário pra ele decidir (excluir/substituir/ignorar).
    let dups = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::find_import_dups(&conn, &import_ids).unwrap_or_default()
    };
    if !dups.is_empty() {
        let _ = app.emit("index:dups", &dups);
    }

    // Image sequences: agrupa frames numerados num só asset representante (escondendo o resto).
    // Live Photos: liga imagem + .mov irmão (esconde o vídeo do par).
    {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        let _ = db::detect_sequences(&conn, &folder);
        let _ = db::detect_live_photos(&conn, &folder);
    }

    let _ = app.emit("index:done", DonePayload { folder, total });
}

/// "Atualizar pasta" — re-scan INTELIGENTE de uma pasta já indexada. Em vez de reimportar tudo,
/// aplica só o DIFF do disco, preservando metadados:
///   • arquivos NOVOS  → catalogados (geram thumb).
///   • RENOMEADOS/MOVIDOS (mesmo tamanho+mtime+extensão) → re-apontados pelo `id`, mantendo
///     rating/tags/favorito/notas/coleções/hash/miniatura (NÃO regera thumb).
///   • REMOVIDOS de verdade → tirados do catálogo.
/// Proteção: se a pasta/HD sumiu por inteiro (offline), NÃO mexe em nada (não apaga o catálogo).
pub fn rescan_folder(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: std::path::PathBuf,
    folder: String,
) {
    use std::collections::HashMap;

    // Blinda contra o drive cru ("F:" → "F:\") — mesma proteção do index_folder.
    let folder = normalize_root(&folder);
    let root = Path::new(&folder);

    // Proteção contra HD desconectado: a raiz não existe → não dá pra saber o que "sumiu".
    // Reimportar/prune aqui apagaria o catálogo inteiro. Aborta e avisa a UI.
    if !root.exists() {
        let _ = app.emit(
            "index:rescan-summary",
            RescanSummary { folder: folder.clone(), added: 0, renamed: 0, removed: 0, offline: true },
        );
        let _ = app.emit("index:done", DonePayload { folder, total: 0 });
        return;
    }

    let excluded: Vec<String> = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::remove_excluded(&conn, &folder);
        db::excluded_list(&conn)
    };
    let folder_id = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::upsert_folder(&conn, &folder, now()).unwrap_or(0)
    };

    let _ = app.emit("index:start", StartPayload { folder: format!("Atualizando: {folder}"), total: 0 });

    // --- 1) varre o disco AGORA (parte lenta, sem segurar o lock) ---
    let mut scanned: Vec<db::NewAsset> = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let p_low = p.to_string_lossy().to_lowercase();
        if under_excluded(&p_low, &excluded) || is_system_path(&p_low) {
            continue;
        }
        let filename = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if is_junk(&filename) {
            continue;
        }
        let ext = p.extension().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if !classify::is_media(&ext) {
            continue;
        }
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
        scanned.push(db::NewAsset {
            path: p.to_string_lossy().to_string(),
            dir,
            filename,
            ext,
            kind,
            size,
            modified_at: modified,
            folder_id,
        });
    }

    // --- 2) carrega o estado ATUAL do catálogo sob a pasta (id, path, size, mtime, ext) ---
    let existing = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::assets_under_meta(&conn, &folder).unwrap_or_default()
    };
    // Comparação de caminhos case-insensitive (Windows não diferencia maiúsc./minúsc.).
    let db_paths: std::collections::HashSet<String> =
        existing.iter().map(|(_, p, ..)| p.to_lowercase()).collect();
    let disk_paths: std::collections::HashSet<String> =
        scanned.iter().map(|na| na.path.to_lowercase()).collect();

    // "sumiu do disco" = está no catálogo mas não na varredura E o arquivo realmente não existe.
    // Indexa por (tamanho, mtime, ext) pra casar com um arquivo novo de mesmo conteúdo (rename/move).
    let mut gone_by_sig: HashMap<(i64, i64, String), Vec<(i64, String)>> = HashMap::new();
    let mut gone_ids: Vec<i64> = Vec::new();
    for (id, path, size, mtime, ext) in &existing {
        if !disk_paths.contains(&path.to_lowercase()) && !Path::new(path).exists() {
            gone_by_sig
                .entry((*size, *mtime, ext.to_lowercase()))
                .or_default()
                .push((*id, path.clone()));
            gone_ids.push(*id);
        }
    }

    // --- 3) decide, pra cada arquivo do disco que é NOVO no catálogo: é rename ou genuinamente novo? ---
    let mut to_insert: Vec<db::NewAsset> = Vec::new();
    let mut relinks: Vec<(i64, db::NewAsset)> = Vec::new(); // (id antigo, novo caminho)
    let mut consumed_gone: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for na in scanned.into_iter() {
        if db_paths.contains(&na.path.to_lowercase()) {
            // já existe com esse caminho exato → o upsert normal cuida (size/mtime/folder_id).
            to_insert.push(na);
            continue;
        }
        // caminho novo: tenta casar com um arquivo que sumiu (mesmo conteúdo) → é rename/move.
        // Só casa quando é INEQUÍVOCO: a assinatura (tamanho+mtime+ext) aponta pra EXATAMENTE um
        // arquivo sumido. Se houver ambiguidade (vários iguais), NÃO arrisca trocar metadados —
        // trata como novo e deixa o prune cuidar dos sumidos. ("não quebre nada".)
        let sig = (na.size, na.modified_at, na.ext.to_lowercase());
        let matched = match gone_by_sig.get_mut(&sig) {
            Some(v) if v.len() == 1 && !consumed_gone.contains(&v[0].0) => Some(v[0].0),
            _ => None,
        };
        match matched {
            Some(id) => {
                consumed_gone.insert(id);
                relinks.push((id, na));
            }
            None => to_insert.push(na),
        }
    }

    // --- 4) aplica os RENAMES (re-aponta id antigo → novo caminho; metadados intactos) ---
    let renamed = relinks.len();
    {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        for (id, na) in &relinks {
            let _ = db::relink_asset(&conn, *id, &na.path, &na.dir, &na.filename, na.folder_id);
        }
    }

    // --- 5) UPSERT do que existe agora (novos + os de caminho igual). Conta quantos são NOVOS. ---
    let mut added = 0usize;
    for chunk in to_insert.chunks(2000) {
        let mut conn = db.lock().unwrap_or_else(|p| p.into_inner());
        let tx = match conn.transaction() {
            Ok(t) => t,
            Err(_) => continue,
        };
        for na in chunk {
            if !db_paths.contains(&na.path.to_lowercase()) {
                added += 1;
            }
            let _ = db::upsert_asset(&tx, na);
        }
        let _ = tx.commit();
    }

    // --- 6) PRUNE: só os que sumiram de verdade E não viraram rename ---
    let mut removed = 0usize;
    {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        for id in &gone_ids {
            if consumed_gone.contains(id) {
                continue; // foi renomeado/movido, não apaga
            }
            let _ = db::delete_asset(&conn, *id);
            removed += 1;
        }
    }

    // --- 7) thumbs só pros NOVOS (os renomeados mantêm a miniatura, então não entram aqui) ---
    let pending = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::pending_thumbs_under(&conn, &folder).unwrap_or_default()
    };
    let total = pending.len();
    let _ = app.emit(
        "index:start",
        StartPayload { folder: format!("Atualizando: {folder}"), total },
    );
    if total > 0 {
        run_thumb_queue(&app, &db, &thumbs_dir, pending);
    }
    // Re-detecta sequences e Live Photos (pares novos depois da atualização).
    {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        let _ = db::detect_sequences(&conn, &folder);
        let _ = db::detect_live_photos(&conn, &folder);
    }
    let _ = app.emit(
        "index:rescan-summary",
        RescanSummary { folder: folder.clone(), added, renamed, removed, offline: false },
    );
    let _ = app.emit("index:done", DonePayload { folder, total });
}

/// Relink "busca automática" (estilo DaVinci "relink by filename"): varre `search_dir` e
/// re-aponta os assets offline sob `old_root` que tiverem um arquivo de MESMO NOME — preferindo
/// o de MESMO TAMANHO; se não houver match por tamanho, só aceita quando o nome é único na busca
/// (evita re-apontar pro arquivo errado). Retorna (religados, ainda_faltando).
pub fn relink_search(db: &Arc<Mutex<Connection>>, old_root: &str, search_dir: &str) -> (usize, usize) {
    use std::collections::HashMap;
    // 1) varre o disco SEM lock: nome (minúsculo) -> [(caminho, tamanho)]
    let mut by_name: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for entry in WalkDir::new(search_dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let name = p.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let size = entry.metadata().ok().map(|m| m.len() as i64).unwrap_or(-1);
        by_name.entry(name).or_default().push((p.to_string_lossy().to_string(), size));
    }
    // 2) assets sob old_root (filtra offline + prefixo no Rust)
    let old = old_root.trim_end_matches(|c| c == '\\' || c == '/').to_string();
    let mut candidates: Vec<(i64, String, String, i64, i64)> = Vec::new();
    {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        let like = format!("{old}%");
        let mut stmt = match conn.prepare(
            "SELECT id, path, filename, size, folder_id FROM assets WHERE path LIKE ?1",
        ) {
            Ok(s) => s,
            Err(_) => return (0, 0),
        };
        let mut q = match stmt.query(rusqlite::params![like]) {
            Ok(q) => q,
            Err(_) => return (0, 0),
        };
        while let Ok(Some(r)) = q.next() {
            if let (Ok(id), Ok(p), Ok(f), Ok(s), Ok(fid)) = (
                r.get::<_, i64>(0),
                r.get::<_, String>(1),
                r.get::<_, String>(2),
                r.get::<_, i64>(3),
                r.get::<_, i64>(4),
            ) {
                candidates.push((id, p, f, s, fid));
            }
        }
    }
    // 3) casa por nome (+tamanho) e re-aponta numa transação
    let conn = db.lock().unwrap_or_else(|p| p.into_inner());
    let tx = match conn.unchecked_transaction() {
        Ok(t) => t,
        Err(_) => return (0, 0),
    };
    let mut relinked = 0usize;
    let mut missing = 0usize;
    for (id, path, filename, size, fid) in candidates {
        let under = path == old
            || path.starts_with(&format!("{old}\\"))
            || path.starts_with(&format!("{old}/"));
        if !under {
            continue;
        }
        if Path::new(&path).exists() {
            continue; // não está offline
        }
        let hits = match by_name.get(&filename.to_lowercase()) {
            Some(h) => h,
            None => {
                missing += 1;
                continue;
            }
        };
        let chosen = hits
            .iter()
            .find(|(_, s)| *s == size)
            .map(|(p, _)| p.clone())
            .or_else(|| if hits.len() == 1 { Some(hits[0].0.clone()) } else { None });
        match chosen {
            Some(np) => {
                let cp = Path::new(&np);
                let dir = cp.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
                let fname = cp.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                let _ = db::relink_asset(&tx, id, &np, &dir, &fname, fid);
                relinked += 1;
            }
            None => missing += 1,
        }
    }
    let _ = tx.commit();
    (relinked, missing)
}

/// Retomada: gera thumbs para assets ja catalogados que ficaram sem (ex.: app fechado
/// no meio da indexacao). Roda no boot, sem barra de progresso intrusiva.
pub fn resume_missing(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: std::path::PathBuf,
) {
    let pending = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
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
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::upsert_asset(&conn, &na).ok()?
    };
    let (thumb, meta) = thumbs::generate(path, &ext, thumbs_dir, id);
    let swatch = thumb.as_deref().and_then(|t| thumbs::analyze_thumb(Path::new(t)));
    let (dom, buck) = match &swatch {
        Some(s) => (Some(s.hex.clone()), Some(s.bucket.clone())),
        None => (None, None),
    };
    let hash = thumbs::quick_hash(path, size as u64);
    let conn = db.lock().unwrap_or_else(|p| p.into_inner());
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
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::pending_traits(&conn).unwrap_or_default()
    };
    if pending.is_empty() {
        return;
    }
    for (id, thumb) in pending {
        if let Some(s) = thumbs::analyze_thumb(Path::new(&thumb)) {
            let conn = db.lock().unwrap_or_else(|p| p.into_inner());
            let _ = db::set_traits(&conn, id, &s.bright, &s.warm, &s.sat);
        }
    }
    // backfill do perceptual hash (busca por imagem) pros que ainda não têm
    let pend_ph = {
        let conn = db.lock().unwrap_or_else(|p| p.into_inner());
        db::pending_phash(&conn).unwrap_or_default()
    };
    for (id, thumb) in pend_ph {
        if let Some(ph) = thumbs::phash(Path::new(&thumb)) {
            let conn = db.lock().unwrap_or_else(|p| p.into_inner());
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
    // Throttle do progresso: emitir 1 evento por arquivo numa pasta de 27k = 27k re-renders no
    // front → barra/número "bugam" (jank). Emite no MÁXIMO ~200 vezes (a cada `step` arquivos),
    // mais o último. Suave e barato em qualquer tamanho de pasta.
    let step = (total / 200).max(1);
    let done = Arc::new(AtomicUsize::new(0));
    let queue = Arc::new(Mutex::new(pending.into_iter()));
    let mut handles = Vec::new();

    for _ in 0..concurrency() {
        let app = app.clone();
        let db = db.clone();
        let thumbs_dir = thumbs_dir.to_path_buf();
        let queue = queue.clone();
        let done = done.clone();
        handles.push(std::thread::spawn(move || {
            // Modo background: baixa prioridade de CPU e de I/O desta thread (não trava o PC).
            crate::sys::begin_background();
            loop {
            // Pausa enquanto a UI tiver uma caixa de diálogo aberta (ex.: modal de duplicados).
            crate::sys::wait_if_paused();
            // Cancelou → este worker para imediatamente.
            if crate::sys::is_cancelled() {
                break;
            }
            let item = {
                let mut q = queue.lock().unwrap_or_else(|p| p.into_inner());
                q.next()
            };
            let Some((id, path, ext, kind)) = item else { break };

            let p = Path::new(&path);
            let (thumb, meta) = thumbs::generate(p, &ext, &thumbs_dir, id);

            // Corrompidos: mídia que não abre em NENHUM decodificador sai da biblioteca. MAS antes
            // de apagar, confirma com o ffprobe que o arquivo é mesmo ilegível — um vídeo válido
            // só com trilha de áudio não gera miniatura e cairia aqui por engano.
            let is_media = matches!(kind.as_str(), "image" | "gif" | "video" | "audio");
            if is_media
                && thumb.is_none()
                && meta.width.is_none()
                && meta.duration.is_none()
                && !thumbs::probe_readable(p)
            {
                let conn = db.lock().unwrap_or_else(|p| p.into_inner());
                let _ = db::delete_asset(&conn, id);
                drop(conn);
                let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = app.emit("index:corrupt", id);
                if d % step == 0 || d == total {
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
                }
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
                let conn = db.lock().unwrap_or_else(|p| p.into_inner());
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
            // Saúde JÁ no import (antes só o scan manual marcava — por isso mídia dentro de pasta
            // não vinha marcada). Vídeo sem áudio / VFR / etc. saem marcados no card na hora.
            if kind == "video" {
                let info = crate::mediainfo::probe(p);
                let (level, flags) = crate::mediainfo::health_summary(&info);
                let conn = db.lock().unwrap_or_else(|p| p.into_inner());
                let _ = db::set_health(&conn, &path, &level, &flags);
            }
            let d = done.fetch_add(1, Ordering::SeqCst) + 1;
            if d % step == 0 || d == total {
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
            }
            }
        }));
    }
    for h in handles {
        let _ = h.join();
    }
}
