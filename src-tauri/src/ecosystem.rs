//! Integrações do ecossistema do Paulo: VELVET (cor no DaVinci) e QUARTZO (PKM nosso).
//!
//! - **VELVET ↔ PRISMA**: o VELVET (plugin DCTL + app de cor) escolhe a LUT do catálogo
//!   do PRISMA POR HUMOR. Em vez de acoplar o VELVET ao schema do SQLite, o PRISMA
//!   publica um CONTRATO ESTÁVEL: um `velvet_luts.json` com {path,name,warm,bright,sat,
//!   ai_desc,tags} de cada LUT catalogada. O VELVET lê esse JSON (ou o prisma.db direto,
//!   read-only). Assim eu posso mudar o banco sem quebrar a integração.
//! - **QUARTZO ↔ PRISMA**: o Quartzo é o PKM nosso (clone do Obsidian). O PRISMA lê/escreve
//!   notas .md no vault do Quartzo — anexar um asset numa nota e listar as notas que citam
//!   um asset — e abre a nota no Quartzo. É a "ligação" das notas com os assets.

use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

// ---------------- VELVET: export do catálogo de LUTs ----------------

#[derive(Serialize)]
struct LutEntry {
    id: i64,
    path: String,
    name: String,
    ext: String,
    warm: Option<String>,
    bright: Option<String>,
    sat: Option<String>,
    ai_desc: Option<String>,
    tags: Vec<String>,
}

#[derive(Serialize)]
struct VelvetCatalog {
    schema: &'static str,
    count: usize,
    luts: Vec<LutEntry>,
}

/// Monta o JSON-contrato com todas as LUTs catalogadas (por humor) e escreve em `out`.
/// Retorna quantas LUTs foram exportadas.
pub fn export_velvet_catalog(conn: &Connection, out: &Path) -> rusqlite::Result<usize> {
    let mut stmt = conn.prepare(
        "SELECT id, path, COALESCE(name, filename), ext, warm, bright, sat, ai_desc \
         FROM assets WHERE type='lut' AND trashed=0 ORDER BY COALESCE(name, filename) COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
        ))
    })?;

    let mut luts = Vec::new();
    for row in rows {
        let (id, path, name, ext, warm, bright, sat, ai_desc) = row?;
        let mut tstmt = conn.prepare(
            "SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=?1",
        )?;
        let tags: Vec<String> = tstmt
            .query_map([id], |r| r.get::<_, String>(0))?
            .filter_map(|x| x.ok())
            .collect();
        luts.push(LutEntry { id, path, name, ext, warm, bright, sat, ai_desc, tags });
    }

    let cat = VelvetCatalog { schema: "prisma.velvet.luts/1", count: luts.len(), luts };
    let txt = serde_json::to_string_pretty(&cat).unwrap_or_else(|_| "{}".into());
    std::fs::write(out, txt).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    Ok(cat.count)
}

// ---------------- QUARTZO: ler/escrever notas do vault ----------------

#[derive(Serialize)]
pub struct QuartzoNote {
    pub rel: String,  // caminho relativo dentro do vault (com / como separador)
    pub name: String, // nome da nota sem .md
}

/// Lista as notas .md do vault do Quartzo (recursivo, ignora pastas ocultas).
pub fn list_notes(vault: &Path) -> Vec<QuartzoNote> {
    let mut out = Vec::new();
    walk_md(vault, vault, &mut out);
    out.sort_by(|a, b| a.rel.to_lowercase().cmp(&b.rel.to_lowercase()));
    out
}

fn walk_md(root: &Path, dir: &Path, out: &mut Vec<QuartzoNote>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let fname = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if fname.starts_with('.') {
            continue; // .obsidian/.quartzo/.git etc.
        }
        if p.is_dir() {
            walk_md(root, &p, out);
        } else if p.extension().map(|x| x.eq_ignore_ascii_case("md")).unwrap_or(false) {
            let rel = p
                .strip_prefix(root)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            out.push(QuartzoNote { rel, name });
        }
    }
}

/// Anexa um asset do PRISMA numa nota do Quartzo (cria a nota se não existir).
/// Escreve um bloco markdown com link de arquivo + deep-link prisma://asset/<id>.
pub fn attach_asset(
    vault: &Path,
    note_rel: &str,
    asset_id: i64,
    asset_name: &str,
    asset_path: &str,
) -> Result<(), String> {
    let safe_rel = note_rel.trim_start_matches(['/', '\\']);
    let mut full = vault.join(safe_rel);
    if full.extension().is_none() {
        full.set_extension("md");
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file_url = path_to_file_url(asset_path);
    let block = format!(
        "\n\n## {asset_name}\n[{asset_name}]({file_url})\n- PRISMA: `prisma://asset/{asset_id}`\n- Arquivo: `{asset_path}`\n"
    );
    let mut content = std::fs::read_to_string(&full).unwrap_or_default();
    content.push_str(&block);
    std::fs::write(&full, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Notas do Quartzo que CITAM este asset (pelo nome do arquivo ou pelo deep-link).
pub fn notes_for_asset(vault: &Path, asset_id: i64, asset_path: &str) -> Vec<QuartzoNote> {
    let needle_file = Path::new(asset_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let needle_link = format!("prisma://asset/{asset_id}");
    let mut out = Vec::new();
    for note in list_notes(vault) {
        let full = vault.join(&note.rel);
        if let Ok(txt) = std::fs::read_to_string(&full) {
            let low = txt.to_lowercase();
            if (!needle_file.is_empty() && low.contains(&needle_file)) || txt.contains(&needle_link) {
                out.push(note);
            }
        }
    }
    out
}

/// Caminho absoluto de uma nota (pra abrir no Quartzo/editor).
pub fn note_abs_path(vault: &Path, note_rel: &str) -> PathBuf {
    let safe = note_rel.trim_start_matches(['/', '\\']);
    let mut p = vault.join(safe);
    if p.extension().is_none() {
        p.set_extension("md");
    }
    p
}

fn path_to_file_url(p: &str) -> String {
    // file:///C:/... — barras pra frente, espaços escapados de leve.
    let fwd = p.replace('\\', "/").replace(' ', "%20");
    if fwd.starts_with('/') {
        format!("file://{fwd}")
    } else {
        format!("file:///{fwd}")
    }
}
