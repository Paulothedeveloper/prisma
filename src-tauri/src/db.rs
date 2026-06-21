//! Camada SQLite. Indice de todos os assets — e o que da a busca instantanea.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Clone, Debug)]
pub struct Asset {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub name: Option<String>,
    pub ext: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub size: i64,
    pub modified_at: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration: Option<f64>,
    pub rating: i64,
    pub notes: Option<String>,
    pub dominant_color: Option<String>,
    pub color_bucket: Option<String>,
    pub thumbnail_path: Option<String>,
    pub proxy_path: Option<String>,
    pub health_level: Option<String>,
    pub health_flags: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub count: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

/// Par de duplicados achado na importação: o que já estava (`existing`)
/// e o recém-catalogado com mesmo conteúdo (`incoming`).
#[derive(Serialize, Clone, Debug)]
pub struct DupPair {
    pub existing: Asset,
    pub incoming: Asset,
}

/// Filtros combinaveis vindos do frontend.
#[derive(Deserialize, Default)]
pub struct Filter {
    #[serde(default)]
    pub query: String,
    pub kind: Option<String>,
    pub min_rating: Option<i64>,
    pub tag_id: Option<i64>,
    pub color_bucket: Option<String>,
    pub folder: Option<String>,
    pub ext: Option<String>,
    pub res: Option<String>,
    pub min_duration: Option<f64>,
    pub max_duration: Option<f64>,
    #[serde(default)]
    pub dups_only: bool,
    #[serde(default)]
    pub trashed: bool, // mostra a Lixeira (senão, esconde os da lixeira)
    #[serde(default)]
    pub untagged: bool, // sem tags
    #[serde(default)]
    pub uncollected: bool, // fora de qualquer coleção
    #[serde(default)]
    pub random: bool, // ordem aleatória (descoberta)
    pub collection: Option<i64>,
    pub bright: Option<String>,
    pub warm: Option<String>,
    pub sat: Option<String>,
    pub orient: Option<String>, // portrait | landscape | square
    pub health_flag: Option<String>, // filtra por flag de saúde: vfr|banding|proxy|8bitlog|mono...
    pub sort: Option<String>,
    #[serde(default)]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    init(&conn)?;
    Ok(conn)
}

fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS folders (
            id        INTEGER PRIMARY KEY,
            path      TEXT NOT NULL UNIQUE,
            parent_id INTEGER,
            watched   INTEGER NOT NULL DEFAULT 0,
            added_at  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS assets (
            id              INTEGER PRIMARY KEY,
            path            TEXT NOT NULL UNIQUE,
            dir             TEXT,
            filename        TEXT NOT NULL,
            ext             TEXT NOT NULL,
            type            TEXT NOT NULL,
            size            INTEGER NOT NULL DEFAULT 0,
            created_at      INTEGER NOT NULL DEFAULT 0,
            modified_at     INTEGER NOT NULL DEFAULT 0,
            width           INTEGER,
            height          INTEGER,
            duration        REAL,
            fps             REAL,
            codec           TEXT,
            color_primaries TEXT,
            dominant_color  TEXT,
            color_bucket    TEXT,
            hash            TEXT,
            thumbnail_path  TEXT,
            proxy_path      TEXT,
            rating          INTEGER NOT NULL DEFAULT 0,
            notes           TEXT,
            folder_id       INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_assets_type     ON assets(type);
        CREATE INDEX IF NOT EXISTS idx_assets_ext      ON assets(ext);
        CREATE INDEX IF NOT EXISTS idx_assets_filename ON assets(filename);
        CREATE INDEX IF NOT EXISTS idx_assets_folder   ON assets(folder_id);
        CREATE INDEX IF NOT EXISTS idx_assets_dir      ON assets(dir);
        CREATE INDEX IF NOT EXISTS idx_assets_rating   ON assets(rating);
        CREATE INDEX IF NOT EXISTS idx_assets_bucket   ON assets(color_bucket);
        CREATE INDEX IF NOT EXISTS idx_assets_hash     ON assets(hash);

        CREATE TABLE IF NOT EXISTS tags (
            id    INTEGER PRIMARY KEY,
            name  TEXT NOT NULL UNIQUE,
            color TEXT
        );
        CREATE TABLE IF NOT EXISTS asset_tags (
            asset_id INTEGER NOT NULL,
            tag_id   INTEGER NOT NULL,
            PRIMARY KEY (asset_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS collections (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS collection_items (
            collection_id INTEGER NOT NULL,
            asset_id      INTEGER NOT NULL,
            PRIMARY KEY (collection_id, asset_id)
        );

        CREATE TABLE IF NOT EXISTS smart_folders (
            id    INTEGER PRIMARY KEY,
            name  TEXT NOT NULL,
            match_mode TEXT NOT NULL DEFAULT 'all',
            rules TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS encoder_presets (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            opts TEXT NOT NULL
        );
        "#,
    )?;
    // Migrações leves: adiciona colunas novas em bancos já existentes (ignora se já existe).
    for col in [
        "dir TEXT",
        "color_bucket TEXT",
        "proxy_path TEXT",
        "bright TEXT", // tom: escuro/medio/claro
        "warm TEXT",   // temperatura: quente/neutro/frio
        "sat TEXT",    // saturação: pb/suave/vivido
        "ai_desc TEXT", // descrição de conteúdo gerada por IA (busca semântica)
        "trashed INTEGER NOT NULL DEFAULT 0", // Lixeira (soft-delete, estilo Eagle)
        "name TEXT", // nome de exibição (renomear sem tocar no arquivo, estilo Eagle)
        "phash INTEGER", // perceptual hash (dHash) pra "buscar por imagem" (similaridade)
        "health_level TEXT", // diagnóstico em cache: red/yellow/green (Briefing 6, saúde da biblioteca)
        "health_flags TEXT", // flags do diagnóstico: vfr,banding,proxy,8bitlog,mono... (CSV)
    ] {
        let _ = conn.execute(&format!("ALTER TABLE assets ADD COLUMN {col}"), []);
    }
    // Metadados de pasta: apelido (nome amigável) e ocultar da barra lateral.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS folder_meta (
            dir    TEXT PRIMARY KEY,
            alias  TEXT,
            hidden INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )?;
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_trashed ON assets(trashed)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_bright ON assets(bright)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_warm ON assets(warm)", []);
    // capa + cor/ícone da pasta (estilo Eagle)
    for col in ["cover TEXT", "color TEXT"] {
        let _ = conn.execute(&format!("ALTER TABLE folder_meta ADD COLUMN {col}"), []);
    }
    // Ordem manual dos itens dentro de uma coleção ("organização livre").
    let _ = conn.execute(
        "ALTER TABLE collection_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // Base de conhecimento (RAG): chunks do vault Obsidian por heading (Briefing 6 §1).
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vault_chunks (
            id      INTEGER PRIMARY KEY,
            note    TEXT NOT NULL,
            heading TEXT,
            text    TEXT NOT NULL
        )",
        [],
    )?;

    // Busca INSTANTÂNEA (FTS5): índice de texto espelhando filename/name/ai_desc, com a
    // tabela `assets` como conteúdo. Triggers mantêm sincronizado em insert/update/delete.
    // unicode61 + remove_diacritics: "praia" acha "praiá"/"Praia". Bem mais rápido e
    // esperto que o LIKE full-scan em bibliotecas grandes.
    let _ = conn.execute_batch(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
            filename, name, ai_desc,
            content='assets', content_rowid='id',
            tokenize='unicode61 remove_diacritics 2'
        );
        CREATE TRIGGER IF NOT EXISTS assets_fts_ai AFTER INSERT ON assets BEGIN
            INSERT INTO assets_fts(rowid, filename, name, ai_desc)
            VALUES (new.id, new.filename, new.name, new.ai_desc);
        END;
        CREATE TRIGGER IF NOT EXISTS assets_fts_ad AFTER DELETE ON assets BEGIN
            INSERT INTO assets_fts(assets_fts, rowid, filename, name, ai_desc)
            VALUES('delete', old.id, old.filename, old.name, old.ai_desc);
        END;
        CREATE TRIGGER IF NOT EXISTS assets_fts_au AFTER UPDATE ON assets BEGIN
            INSERT INTO assets_fts(assets_fts, rowid, filename, name, ai_desc)
            VALUES('delete', old.id, old.filename, old.name, old.ai_desc);
            INSERT INTO assets_fts(rowid, filename, name, ai_desc)
            VALUES (new.id, new.filename, new.name, new.ai_desc);
        END;
        "#,
    );
    // popula/repara o índice se estiver fora de sincronia (1ª criação ou trigger perdido)
    let assets_n: i64 = conn.query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0)).unwrap_or(0);
    let fts_n: i64 = conn.query_row("SELECT COUNT(*) FROM assets_fts", [], |r| r.get(0)).unwrap_or(-1);
    if assets_n != fts_n {
        let _ = conn.execute("INSERT INTO assets_fts(assets_fts) VALUES('rebuild')", []);
    }
    Ok(())
}

/// Apaga todos os chunks do vault (antes de reindexar).
pub fn clear_vault(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM vault_chunks", [])?;
    Ok(())
}

/// Insere um chunk do vault.
pub fn insert_vault_chunk(conn: &Connection, note: &str, heading: &str, text: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO vault_chunks (note, heading, text) VALUES (?1, ?2, ?3)",
        params![note, heading, text],
    )?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct VaultChunk {
    pub note: String,
    pub heading: String,
    pub text: String,
}

/// Busca por palavra-chave nos chunks do vault (RAG simples). Pontua por nº de termos
/// que aparecem em nota/heading/texto e devolve os melhores.
pub fn search_vault(conn: &Connection, query: &str, limit: i64) -> rusqlite::Result<Vec<VaultChunk>> {
    let terms: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .map(|t| t.to_string())
        .collect();
    let mut stmt = conn.prepare("SELECT note, heading, text FROM vault_chunks")?;
    let rows = stmt.query_map([], |r| {
        Ok(VaultChunk {
            note: r.get(0)?,
            heading: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            text: r.get(2)?,
        })
    })?;
    let mut scored: Vec<(i32, VaultChunk)> = Vec::new();
    for c in rows.flatten() {
        let hay = format!("{} {} {}", c.note, c.heading, c.text).to_lowercase();
        let score = terms.iter().filter(|t| hay.contains(t.as_str())).count() as i32;
        if score > 0 {
            scored.push((score, c));
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(scored.into_iter().take(limit.max(1) as usize).map(|(_, c)| c).collect())
}

/// Quantos chunks de vault estão indexados.
pub fn vault_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM vault_chunks", [], |r| r.get(0))
}

/// Grava o diagnóstico em cache de um asset (saúde da biblioteca).
pub fn set_health(conn: &Connection, path: &str, level: &str, flags: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assets SET health_level=?2, health_flags=?3 WHERE path=?1",
        params![path, level, flags],
    )?;
    Ok(())
}

/// Vídeos ainda sem diagnóstico em cache (pro "Escanear saúde" em lote).
pub fn assets_needing_health(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<String>> {
    let base = "SELECT path FROM assets WHERE type='video' AND health_level IS NULL AND trashed=0";
    if limit <= 0 {
        let mut stmt = conn.prepare(base)?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    } else {
        let mut stmt = conn.prepare(&format!("{base} LIMIT ?1"))?;
        let rows = stmt.query_map(params![limit], |r| r.get(0))?;
        rows.collect()
    }
}

/// Contagem por flag de saúde (pros atalhos inteligentes mostrarem o número).
pub fn health_counts(conn: &Connection) -> rusqlite::Result<std::collections::HashMap<String, i64>> {
    let mut stmt = conn.prepare(
        "SELECT health_flags FROM assets WHERE health_flags IS NOT NULL AND health_flags<>'' AND trashed=0",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut map = std::collections::HashMap::new();
    for flags in rows.flatten() {
        for f in flags.split(',').filter(|s| !s.is_empty()) {
            *map.entry(f.to_string()).or_insert(0) += 1;
        }
    }
    Ok(map)
}

pub fn upsert_folder(conn: &Connection, path: &str, added_at: i64) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO folders (path, watched, added_at) VALUES (?1, 1, ?2)
         ON CONFLICT(path) DO NOTHING",
        params![path, added_at],
    )?;
    conn.query_row(
        "SELECT id FROM folders WHERE path = ?1",
        params![path],
        |r| r.get(0),
    )
}

pub struct NewAsset {
    pub path: String,
    pub dir: String,
    pub filename: String,
    pub ext: String,
    pub kind: String,
    pub size: i64,
    pub modified_at: i64,
    pub folder_id: i64,
}

pub fn upsert_asset(conn: &Connection, a: &NewAsset) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO assets (path, dir, filename, ext, type, size, created_at, modified_at, folder_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
         ON CONFLICT(path) DO UPDATE SET
            dir=excluded.dir, filename=excluded.filename, ext=excluded.ext, type=excluded.type,
            size=excluded.size, modified_at=excluded.modified_at, folder_id=excluded.folder_id",
        params![a.path, a.dir, a.filename, a.ext, a.kind, a.size, a.modified_at, a.folder_id],
    )?;
    conn.query_row(
        "SELECT id FROM assets WHERE path = ?1",
        params![a.path],
        |r| r.get(0),
    )
}

/// Como `upsert_asset`, mas também diz se a MINIATURA precisa ser (re)gerada.
/// `needs_thumb` = true quando: o asset é novo, OU o conteúdo mudou (tamanho/mtime
/// diferentes), OU ainda não há thumbnail em disco. Evita regenerar milhares de
/// miniaturas ao re-adicionar uma pasta já catalogada (regra de cache do Bloco 2).
pub fn upsert_asset_cached(conn: &Connection, a: &NewAsset) -> rusqlite::Result<(i64, bool)> {
    // lê o estado ANTERIOR antes do upsert sobrescrever size/modified_at
    let prev: Option<(i64, i64, Option<String>)> = conn
        .query_row(
            "SELECT size, modified_at, thumbnail_path FROM assets WHERE path = ?1",
            params![a.path],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let id = upsert_asset(conn, a)?;
    let needs_thumb = match prev {
        None => true, // asset novo
        Some((size, modified, thumb)) => {
            size != a.size
                || modified != a.modified_at
                || thumb.as_deref().map(|p| !Path::new(p).exists()).unwrap_or(true)
        }
    };
    Ok((id, needs_thumb))
}

/// Assets thumbnailaveis ainda sem miniatura (pra retomar indexacao interrompida).
pub fn pending_thumbs(
    conn: &Connection,
) -> rusqlite::Result<Vec<(i64, String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, ext, type FROM assets
         WHERE thumbnail_path IS NULL AND type IN ('image','gif','video','audio')",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    })?;
    rows.collect()
}

/// Lista (id, path) dos assets sob um diretório (pra re-scan/prune).
pub fn assets_under(conn: &Connection, dir: &str) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare("SELECT id, path FROM assets WHERE dir = ?1 OR dir LIKE ?2")?;
    let like = format!("{dir}\\%");
    let rows = stmt.query_map(params![dir, like], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// Assets thumbnailaveis sob um diretório ainda sem miniatura (re-scan só processa os novos).
pub fn pending_thumbs_under(
    conn: &Connection,
    dir: &str,
) -> rusqlite::Result<Vec<(i64, String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, ext, type FROM assets
         WHERE thumbnail_path IS NULL AND type IN ('image','gif','video','audio')
           AND (dir = ?1 OR dir LIKE ?2)",
    )?;
    let like = format!("{dir}\\%");
    let rows = stmt.query_map(params![dir, like], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    })?;
    rows.collect()
}

pub fn delete_asset(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM asset_tags WHERE asset_id=?1", params![id])?;
    conn.execute("DELETE FROM assets WHERE id=?1", params![id])?;
    Ok(())
}

/// Remove um asset pelo caminho (usado pelo watcher quando o arquivo some do disco).
pub fn delete_by_path(conn: &Connection, path: &str) -> rusqlite::Result<bool> {
    let id: Option<i64> = conn
        .query_row("SELECT id FROM assets WHERE path=?1", params![path], |r| r.get(0))
        .ok();
    if let Some(id) = id {
        delete_asset(conn, id)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// True se o caminho já está catalogado (pro watcher evitar reindex desnecessário).
pub fn path_exists(conn: &Connection, path: &str) -> bool {
    conn.query_row("SELECT 1 FROM assets WHERE path=?1", params![path], |_| Ok(()))
        .is_ok()
}

/// Raízes de pasta monitoradas (folders.watched=1).
pub fn watched_roots(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM folders WHERE watched=1")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// Grava o resultado do processamento pesado: thumb, dimensoes, cor, hash.
#[allow(clippy::too_many_arguments)]
pub fn set_processed(
    conn: &Connection,
    id: i64,
    thumb: Option<&str>,
    width: Option<i64>,
    height: Option<i64>,
    duration: Option<f64>,
    dominant_color: Option<&str>,
    color_bucket: Option<&str>,
    hash: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assets SET thumbnail_path=?2, width=?3, height=?4, duration=?5,
            dominant_color=?6, color_bucket=?7, hash=?8 WHERE id=?1",
        params![id, thumb, width, height, duration, dominant_color, color_bucket, hash],
    )?;
    Ok(())
}

/// Grava as características visuais (tom/temperatura/saturação) de um asset.
pub fn set_traits(
    conn: &Connection,
    id: i64,
    bright: &str,
    warm: &str,
    sat: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assets SET bright=?2, warm=?3, sat=?4 WHERE id=?1",
        params![id, bright, warm, sat],
    )?;
    Ok(())
}

/// Assets com thumb mas sem características ainda (pro backfill das visuais).
pub fn pending_traits(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, thumbnail_path FROM assets
         WHERE thumbnail_path IS NOT NULL AND bright IS NULL",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn set_rating(conn: &Connection, id: i64, rating: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assets SET rating=?2 WHERE id=?1",
        params![id, rating.clamp(0, 5)],
    )?;
    Ok(())
}

pub fn set_notes(conn: &Connection, id: i64, notes: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE assets SET notes=?2 WHERE id=?1", params![id, notes])?;
    Ok(())
}

/// Renomeia (nome de exibição) sem tocar no arquivo no disco. Vazio = volta ao nome do arquivo.
pub fn set_name(conn: &Connection, id: i64, name: Option<&str>) -> rusqlite::Result<()> {
    conn.execute("UPDATE assets SET name=?2 WHERE id=?1", params![id, name])?;
    Ok(())
}

/// Define o caminho da miniatura (refresh ou capa customizada).
pub fn set_thumbnail(conn: &Connection, id: i64, thumb: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE assets SET thumbnail_path=?2 WHERE id=?1", params![id, thumb])?;
    Ok(())
}

/// Grava o perceptual hash (dHash) pra busca por similaridade.
pub fn set_phash(conn: &Connection, id: i64, phash: i64) -> rusqlite::Result<()> {
    conn.execute("UPDATE assets SET phash=?2 WHERE id=?1", params![id, phash])?;
    Ok(())
}

/// Assets com thumb mas sem phash ainda (backfill da busca por imagem).
pub fn pending_phash(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, thumbnail_path FROM assets WHERE thumbnail_path IS NOT NULL AND phash IS NULL",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// "Buscar por imagem": assets mais parecidos com `id` (menor distância de Hamming do phash).
pub fn similar(conn: &Connection, id: i64, limit: i64) -> rusqlite::Result<Vec<Asset>> {
    let target: Option<i64> =
        conn.query_row("SELECT phash FROM assets WHERE id=?1", params![id], |r| r.get(0)).ok().flatten();
    let Some(target) = target else { return Ok(Vec::new()) };

    // carrega (id, phash) de todos os candidatos (com thumb, fora da lixeira)
    let mut stmt = conn.prepare(
        "SELECT id, phash FROM assets WHERE phash IS NOT NULL AND trashed=0 AND id<>?1",
    )?;
    let mut scored: Vec<(i64, u32)> = stmt
        .query_map(params![id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
        .filter_map(|x| x.ok())
        .map(|(aid, ph)| (aid, (ph ^ target).count_ones()))
        .collect();
    scored.sort_by_key(|(_, d)| *d);
    let take = limit.max(1) as usize;
    // só os razoavelmente parecidos (distância <= 22 de 64 bits)
    let ids: Vec<i64> = scored.into_iter().filter(|(_, d)| *d <= 22).take(take).map(|(a, _)| a).collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // busca os assets preservando a ordem de similaridade
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT {SELECT_COLS} FROM assets a WHERE id IN ({placeholders})");
    let args: Vec<&dyn rusqlite::types::ToSql> =
        ids.iter().map(|i| i as &dyn rusqlite::types::ToSql).collect();
    let mut stmt = conn.prepare(&sql)?;
    let mut found: Vec<Asset> = stmt
        .query_map(args.as_slice(), row_to_asset)?
        .filter_map(|x| x.ok())
        .collect();
    found.sort_by_key(|a| ids.iter().position(|i| *i == a.id).unwrap_or(usize::MAX));
    Ok(found)
}

/// Atualiza caminho/nome/ext após renomear o ARQUIVO no disco (batch rename).
pub fn set_path(conn: &Connection, id: i64, path: &str, filename: &str, ext: &str, dir: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assets SET path=?2, filename=?3, ext=?4, dir=?5 WHERE id=?1",
        params![id, path, filename, ext, dir],
    )?;
    Ok(())
}

/// Caminho original do arquivo (pra duplicar/atualizar thumb).
pub fn path_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<(String, String)>> {
    conn.query_row("SELECT path, ext FROM assets WHERE id=?1", params![id], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })
    .map(Some)
    .or(Ok(None))
}

/// Grava a descrição de conteúdo gerada pela IA (pra busca semântica).
pub fn set_ai_desc(conn: &Connection, id: i64, desc: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE assets SET ai_desc=?2 WHERE id=?1", params![id, desc])?;
    Ok(())
}

/// Ids de assets ainda sem descrição de IA (com thumb), pra análise em lote.
pub fn assets_needing_ai(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<i64>> {
    // limit <= 0 → TODAS as pendentes (sem teto).
    let base = "SELECT id FROM assets WHERE ai_desc IS NULL AND thumbnail_path IS NOT NULL AND trashed=0
         AND type IN ('image','gif','video')";
    if limit <= 0 {
        let mut stmt = conn.prepare(base)?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect()
    } else {
        let mut stmt = conn.prepare(&format!("{base} LIMIT ?1"))?;
        let rows = stmt.query_map(params![limit], |r| r.get(0))?;
        rows.collect()
    }
}

/// Quantos assets ainda NÃO têm descrição de IA (pra mostrar no botão "Analisar todas").
pub fn count_needing_ai(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM assets WHERE ai_desc IS NULL AND thumbnail_path IS NOT NULL AND trashed=0
         AND type IN ('image','gif','video')",
        [],
        |r| r.get(0),
    )
}

/// Caminho da thumb de um asset (pra IA analisar a imagem já gerada).
pub fn thumb_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT thumbnail_path FROM assets WHERE id=?1", params![id], |r| r.get(0))
        .or(Ok(None))
}

/// Liga um proxy (preview H.264) ao asset original pelo caminho.
pub fn set_proxy(conn: &Connection, original_path: &str, proxy: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assets SET proxy_path=?2 WHERE path=?1",
        params![original_path, proxy],
    )?;
    Ok(())
}

/// Vídeos SEM proxy sob uma pasta (recursivo): candidatos a gerar proxy ao importar.
/// Filtra por dir exato ou subpastas (dir começando com `<root>\`).
pub fn videos_without_proxy_under(conn: &Connection, root: &str) -> rusqlite::Result<Vec<String>> {
    let like = format!("{}\\%", root.trim_end_matches('\\'));
    let mut stmt = conn.prepare(
        "SELECT path FROM assets
         WHERE type='video' AND proxy_path IS NULL AND trashed=0
           AND (dir = ?1 OR dir LIKE ?2)",
    )?;
    let rows = stmt.query_map(params![root, like], |r| r.get(0))?;
    rows.collect()
}

/// Remove da BIBLIOTECA (catálogo) todos os assets sob uma pasta (recursivo) + os metadados
/// da pasta. NÃO apaga arquivos do disco. Retorna quantos assets saíram.
pub fn remove_folder(conn: &Connection, root: &str) -> rusqlite::Result<usize> {
    let r = root.trim_end_matches('\\');
    let like = format!("{r}\\%");
    let n = conn.execute(
        "DELETE FROM assets WHERE dir = ?1 OR dir LIKE ?2",
        params![r, like],
    )?;
    let _ = conn.execute(
        "DELETE FROM folder_meta WHERE dir = ?1 OR dir LIKE ?2",
        params![r, like],
    );
    Ok(n)
}

/// TODOS os vídeos sem proxy da biblioteca (pro botão "Recarregar proxies").
pub fn videos_without_proxy_all(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT path FROM assets WHERE type='video' AND proxy_path IS NULL AND trashed=0",
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// Retorna o proxy_path de um asset pelo caminho original (pro preview inline).
pub fn get_proxy(conn: &Connection, original_path: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT proxy_path FROM assets WHERE path=?1",
        params![original_path],
        |r| r.get(0),
    )
    .or(Ok(None))
}

fn row_to_asset(r: &rusqlite::Row) -> rusqlite::Result<Asset> {
    Ok(Asset {
        id: r.get("id")?,
        path: r.get("path")?,
        filename: r.get("filename")?,
        name: r.get("name")?,
        ext: r.get("ext")?,
        kind: r.get("type")?,
        size: r.get("size")?,
        modified_at: r.get("modified_at")?,
        width: r.get("width")?,
        height: r.get("height")?,
        duration: r.get("duration")?,
        rating: r.get("rating")?,
        notes: r.get("notes")?,
        dominant_color: r.get("dominant_color")?,
        color_bucket: r.get("color_bucket")?,
        thumbnail_path: r.get("thumbnail_path")?,
        proxy_path: r.get("proxy_path")?,
        health_level: r.get("health_level")?,
        health_flags: r.get("health_flags")?,
    })
}

const SELECT_COLS: &str = "id, path, filename, name, ext, type, size, modified_at, width, height,
    duration, rating, notes, dominant_color, color_bucket, thumbnail_path, proxy_path,
    health_level, health_flags";

/// Busca/filtra com filtros combinados. Tudo via SQLite -> instantaneo.
pub fn search(conn: &Connection, f: &Filter) -> rusqlite::Result<Vec<Asset>> {
    let mut sql = format!("SELECT {SELECT_COLS} FROM assets a WHERE 1=1");
    let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    // Lixeira: por padrão esconde os trashed; a view de lixeira mostra só eles.
    if f.trashed {
        sql.push_str(" AND trashed = 1");
    } else {
        sql.push_str(" AND trashed = 0");
    }
    if f.untagged {
        sql.push_str(" AND NOT EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id=a.id)");
    }
    if f.uncollected {
        sql.push_str(" AND NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.asset_id=a.id)");
    }

    if !f.query.trim().is_empty() {
        // FTS5 em filename/name/ai_desc (cada termo vira prefixo: "pra" acha "praia") +
        // tags por LIKE (são poucas). Sanitiza pra não quebrar a sintaxe do MATCH.
        let terms: Vec<String> = f
            .query
            .to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| !t.is_empty())
            .map(|t| format!("{t}*"))
            .collect();
        let like = format!("%{}%", f.query.trim());
        if terms.is_empty() {
            // consulta só com símbolos → cai no LIKE de nome/tag
            sql.push_str(
                " AND (filename LIKE ? OR name LIKE ? OR EXISTS(\
                   SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id \
                   WHERE at.asset_id=a.id AND t.name LIKE ?))",
            );
            args.push(Box::new(like.clone()));
            args.push(Box::new(like.clone()));
            args.push(Box::new(like));
        } else {
            sql.push_str(
                " AND (a.id IN (SELECT rowid FROM assets_fts WHERE assets_fts MATCH ?) \
                   OR EXISTS(SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id \
                   WHERE at.asset_id=a.id AND t.name LIKE ?))",
            );
            args.push(Box::new(terms.join(" ")));
            args.push(Box::new(like));
        }
    }
    if let Some(k) = &f.kind {
        if !k.is_empty() && k != "all" {
            sql.push_str(" AND type = ?");
            args.push(Box::new(k.clone()));
        }
    }
    if let Some(r) = f.min_rating {
        if r > 0 {
            sql.push_str(" AND rating >= ?");
            args.push(Box::new(r));
        }
    }
    if let Some(b) = &f.color_bucket {
        if !b.is_empty() {
            sql.push_str(" AND color_bucket = ?");
            args.push(Box::new(b.clone()));
        }
    }
    if let Some(t) = f.tag_id {
        sql.push_str(" AND EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id=a.id AND at.tag_id=?)");
        args.push(Box::new(t));
    }
    if let Some(hf) = &f.health_flag {
        if !hf.is_empty() {
            // flags são CSV; casa o termo exato entre vírgulas
            sql.push_str(" AND (',' || health_flags || ',') LIKE ?");
            args.push(Box::new(format!("%,{hf},%")));
        }
    }
    if let Some(folder) = &f.folder {
        if !folder.is_empty() {
            sql.push_str(" AND (dir = ? OR dir LIKE ?)");
            args.push(Box::new(folder.clone()));
            args.push(Box::new(format!("{folder}\\%")));
        }
    }
    if let Some(e) = &f.ext {
        if !e.is_empty() {
            sql.push_str(" AND ext = ?");
            args.push(Box::new(e.to_ascii_lowercase()));
        }
    }
    if let Some(r) = &f.res {
        // baldes por largura: sd <1280, hd 1280-1919, fhd 1920-3839, uhd >=3840
        let cond = match r.as_str() {
            "sd" => Some("width < 1280"),
            "hd" => Some("width >= 1280 AND width < 1920"),
            "fhd" => Some("width >= 1920 AND width < 3840"),
            "uhd" => Some("width >= 3840"),
            _ => None,
        };
        if let Some(c) = cond {
            sql.push_str(&format!(" AND {c}"));
        }
    }
    if let Some(d) = f.min_duration {
        sql.push_str(" AND duration >= ?");
        args.push(Box::new(d));
    }
    if let Some(d) = f.max_duration {
        sql.push_str(" AND duration <= ?");
        args.push(Box::new(d));
    }
    if f.dups_only {
        sql.push_str(
            " AND hash IS NOT NULL AND hash IN (SELECT hash FROM assets WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1)",
        );
    }
    if let Some(c) = f.collection {
        sql.push_str(" AND EXISTS (SELECT 1 FROM collection_items ci WHERE ci.asset_id=a.id AND ci.collection_id=?)");
        args.push(Box::new(c));
    }
    for (col, val) in [("bright", &f.bright), ("warm", &f.warm), ("sat", &f.sat)] {
        if let Some(v) = val {
            if !v.is_empty() {
                sql.push_str(&format!(" AND {col} = ?"));
                args.push(Box::new(v.clone()));
            }
        }
    }
    if let Some(o) = &f.orient {
        // orientação por dimensões (vídeo rotacionado é tratado na UI; aqui é direto)
        let cond = match o.as_str() {
            "portrait" => Some("width IS NOT NULL AND height IS NOT NULL AND height > width"),
            "landscape" => Some("width IS NOT NULL AND height IS NOT NULL AND width > height"),
            "square" => Some("width IS NOT NULL AND width = height"),
            _ => None,
        };
        if let Some(c) = cond {
            sql.push_str(&format!(" AND {c}"));
        }
    }

    let order = if f.random {
        " ORDER BY RANDOM()"
    } else if let Some(c) = f.collection {
        // Dentro de uma coleção respeita a ordem manual do usuário.
        sql.push_str(
            " ORDER BY (SELECT position FROM collection_items ci WHERE ci.asset_id=a.id AND ci.collection_id=?)",
        );
        args.push(Box::new(c));
        ""
    } else if f.dups_only {
        " ORDER BY hash, filename COLLATE NOCASE"
    } else {
        match f.sort.as_deref() {
            Some("name_desc") => " ORDER BY filename COLLATE NOCASE DESC",
            Some("recent") => " ORDER BY modified_at DESC",
            Some("oldest") => " ORDER BY modified_at ASC",
            Some("size_desc") => " ORDER BY size DESC",
            Some("size_asc") => " ORDER BY size ASC",
            Some("rating_desc") => " ORDER BY rating DESC, filename COLLATE NOCASE",
            Some("duration_desc") => " ORDER BY duration DESC",
            _ => " ORDER BY filename COLLATE NOCASE",
        }
    };
    sql.push_str(order);
    sql.push_str(" LIMIT ? OFFSET ?");
    let limit = if f.limit <= 0 { 200 } else { f.limit };
    args.push(Box::new(limit));
    args.push(Box::new(f.offset));

    let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params.as_slice(), row_to_asset)?;
    rows.collect()
}

pub fn counts(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt =
        conn.prepare("SELECT type, COUNT(*) FROM assets WHERE trashed=0 GROUP BY type ORDER BY 2 DESC")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn total(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM assets WHERE trashed=0", [], |r| r.get(0))
}

/// Contagens dos tópicos estilo Eagle (sem tags, fora de coleção, lixeira).
pub fn topic_counts(conn: &Connection) -> rusqlite::Result<(i64, i64, i64)> {
    let untagged: i64 = conn.query_row(
        "SELECT COUNT(*) FROM assets a WHERE trashed=0 AND NOT EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id=a.id)",
        [], |r| r.get(0))?;
    let uncollected: i64 = conn.query_row(
        "SELECT COUNT(*) FROM assets a WHERE trashed=0 AND NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.asset_id=a.id)",
        [], |r| r.get(0))?;
    let trash: i64 = conn.query_row("SELECT COUNT(*) FROM assets WHERE trashed=1", [], |r| r.get(0))?;
    Ok((untagged, uncollected, trash))
}

/// Quantos assets fazem parte de algum grupo de duplicados (ignora lixeira).
pub fn dups_total(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM assets WHERE trashed=0 AND hash IS NOT NULL AND hash IN
            (SELECT hash FROM assets WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1)",
        [],
        |r| r.get(0),
    )
}

/// "Manter só 1 de cada": move pra Lixeira todos os duplicados exceto o mais antigo
/// (menor id) de cada grupo de hash. Não apaga do disco — vai pra Lixeira (reversível).
pub fn dedupe_keep_one(conn: &Connection) -> rusqlite::Result<i64> {
    let n = conn.execute(
        "UPDATE assets SET trashed=1
         WHERE trashed=0 AND hash IS NOT NULL
           AND id NOT IN (SELECT MIN(id) FROM assets WHERE hash IS NOT NULL AND trashed=0 GROUP BY hash)
           AND hash IN (SELECT hash FROM assets WHERE hash IS NOT NULL AND trashed=0 GROUP BY hash HAVING COUNT(*) > 1)",
        [],
    )?;
    Ok(n as i64)
}

/// Move pra Lixeira / restaura (soft-delete, estilo Eagle).
pub fn set_trashed(conn: &Connection, id: i64, trashed: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE assets SET trashed=?2 WHERE id=?1",
        params![id, if trashed { 1 } else { 0 }],
    )?;
    Ok(())
}

/// Esvazia a Lixeira: remove do catálogo os que estão na lixeira (não apaga do disco).
pub fn empty_trash(conn: &Connection) -> rusqlite::Result<i64> {
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM assets WHERE trashed=1")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for id in &ids {
        let _ = delete_asset(conn, *id);
    }
    Ok(ids.len() as i64)
}

#[derive(Serialize, Clone, Debug)]
pub struct FolderRow {
    pub dir: String,
    pub count: i64,
    pub alias: Option<String>,
    pub hidden: bool,
    pub cover: Option<String>,
    pub color: Option<String>,
}

/// Diretórios distintos (com contagem + apelido + oculto + capa + cor) pra árvore de pastas.
pub fn folder_dirs(conn: &Connection) -> rusqlite::Result<Vec<FolderRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.dir, COUNT(*), m.alias, COALESCE(m.hidden,0), m.cover, m.color
         FROM assets a LEFT JOIN folder_meta m ON m.dir = a.dir
         WHERE a.dir IS NOT NULL AND a.trashed=0
         GROUP BY a.dir ORDER BY a.dir COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(FolderRow {
            dir: r.get(0)?,
            count: r.get(1)?,
            alias: r.get(2)?,
            hidden: r.get::<_, i64>(3)? != 0,
            cover: r.get(4)?,
            color: r.get(5)?,
        })
    })?;
    rows.collect()
}

/// Define a CAPA da pasta (thumbnail) e/ou a COR (estilo Eagle).
pub fn set_folder_cover(conn: &Connection, dir: &str, cover: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO folder_meta (dir, cover, hidden) VALUES (?1, ?2, 0)
         ON CONFLICT(dir) DO UPDATE SET cover=excluded.cover",
        params![dir, cover],
    )?;
    Ok(())
}

pub fn set_folder_color(conn: &Connection, dir: &str, color: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO folder_meta (dir, color, hidden) VALUES (?1, ?2, 0)
         ON CONFLICT(dir) DO UPDATE SET color=excluded.color",
        params![dir, color],
    )?;
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
pub struct SubCard {
    pub dir: String,
    pub name: String,
    pub count: i64,
    pub cover: Option<String>,
    pub color: Option<String>,
}

/// Subpastas DIRETAS de `parent`, como cards (capa + contagem) — "Show Subfolder Content" do Eagle.
pub fn subfolders(conn: &Connection, parent: &str) -> rusqlite::Result<Vec<SubCard>> {
    let prefix = format!("{parent}\\");
    let like = format!("{prefix}%");
    // agrupa por dir exato com capa representativa; depois dobra em subpasta imediata
    let mut stmt = conn.prepare(
        "SELECT dir, COUNT(*), MIN(thumbnail_path) FROM assets
         WHERE dir LIKE ?1 AND trashed=0 GROUP BY dir",
    )?;
    let rows: Vec<(String, i64, Option<String>)> = stmt
        .query_map(params![like], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut map: std::collections::HashMap<String, (i64, Option<String>)> = std::collections::HashMap::new();
    for (dir, cnt, thumb) in rows {
        let rest = dir.strip_prefix(&prefix).unwrap_or("");
        let seg = rest.split('\\').next().unwrap_or("");
        if seg.is_empty() {
            continue;
        }
        let child = format!("{prefix}{seg}");
        let e = map.entry(child).or_insert((0, None));
        e.0 += cnt;
        if e.1.is_none() {
            e.1 = thumb;
        }
    }
    // aplica capa/cor customizada da pasta, se houver
    let mut out: Vec<SubCard> = map
        .into_iter()
        .map(|(dir, (count, auto_cover))| {
            let (cover_meta, color): (Option<String>, Option<String>) = conn
                .query_row("SELECT cover, color FROM folder_meta WHERE dir=?1", params![dir], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap_or((None, None));
            let name = dir.rsplit('\\').next().unwrap_or(&dir).to_string();
            SubCard { dir, name, count, cover: cover_meta.or(auto_cover), color }
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Define/limpa o apelido de uma pasta (nome amigável na barra lateral).
pub fn set_folder_alias(conn: &Connection, dir: &str, alias: Option<&str>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO folder_meta (dir, alias, hidden) VALUES (?1, ?2, 0)
         ON CONFLICT(dir) DO UPDATE SET alias=excluded.alias",
        params![dir, alias],
    )?;
    Ok(())
}

/// Oculta/mostra uma pasta na barra lateral.
pub fn set_folder_hidden(conn: &Connection, dir: &str, hidden: bool) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO folder_meta (dir, hidden) VALUES (?1, ?2)
         ON CONFLICT(dir) DO UPDATE SET hidden=excluded.hidden",
        params![dir, if hidden { 1 } else { 0 }],
    )?;
    Ok(())
}

/// Extensões distintas (com contagem) pra o filtro de extensão.
pub fn ext_counts(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt = conn
        .prepare("SELECT ext, COUNT(*) FROM assets WHERE ext <> '' AND trashed=0 GROUP BY ext ORDER BY 2 DESC")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// Extensões do tipo "unknown" (pra agrupar a aba Outros por extensão).
pub fn unknown_exts(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT ext, COUNT(*) FROM assets WHERE type='unknown' AND ext <> '' AND trashed=0
         GROUP BY ext ORDER BY 2 DESC",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn color_buckets(conn: &Connection) -> rusqlite::Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT color_bucket, COUNT(*) FROM assets WHERE color_bucket IS NOT NULL AND trashed=0
         GROUP BY color_bucket ORDER BY 2 DESC",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

// ---------- Tags ----------

pub fn list_tags(conn: &Connection) -> rusqlite::Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, COUNT(at.asset_id)
         FROM tags t LEFT JOIN asset_tags at ON at.tag_id = t.id
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            count: r.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn create_tag(conn: &Connection, name: &str, color: Option<&str>) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO tags (name, color) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET color=excluded.color",
        params![name, color],
    )?;
    conn.query_row("SELECT id FROM tags WHERE name=?1", params![name], |r| r.get(0))
}

/// Auto-tag (Briefing 4 #7): atribui a tag `tag_name` a todos os assets sob `dir`.
pub fn autotag_under(conn: &Connection, dir: &str, tag_name: &str) -> rusqlite::Result<i64> {
    let tid = create_tag(conn, tag_name, None)?;
    let n = conn.execute(
        "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id)
         SELECT id, ?2 FROM assets WHERE (dir=?1 OR dir LIKE ?3) AND trashed=0",
        params![dir, tid, format!("{dir}\\%")],
    )?;
    Ok(n as i64)
}

pub fn assign_tag(conn: &Connection, asset_id: i64, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?1, ?2)",
        params![asset_id, tag_id],
    )?;
    Ok(())
}

pub fn unassign_tag(conn: &Connection, asset_id: i64, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM asset_tags WHERE asset_id=?1 AND tag_id=?2",
        params![asset_id, tag_id],
    )?;
    Ok(())
}

pub fn tags_for_asset(conn: &Connection, asset_id: i64) -> rusqlite::Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, 0 FROM tags t
         JOIN asset_tags at ON at.tag_id = t.id WHERE at.asset_id = ?1
         ORDER BY t.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![asset_id], |r| {
        Ok(Tag {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            count: r.get(3)?,
        })
    })?;
    rows.collect()
}

// ---------- Coleções (organização livre) ----------

pub fn list_collections(conn: &Connection) -> rusqlite::Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, COUNT(ci.asset_id)
         FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id
         GROUP BY c.id ORDER BY c.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Collection {
            id: r.get(0)?,
            name: r.get(1)?,
            count: r.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn create_collection(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO collections (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        params![name],
    )?;
    conn.query_row("SELECT id FROM collections WHERE name=?1", params![name], |r| r.get(0))
}

pub fn rename_collection(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE collections SET name=?2 WHERE id=?1", params![id, name])?;
    Ok(())
}

pub fn delete_collection(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM collection_items WHERE collection_id=?1", params![id])?;
    conn.execute("DELETE FROM collections WHERE id=?1", params![id])?;
    Ok(())
}

/// Adiciona um asset a uma coleção, no fim da ordem (idempotente).
pub fn add_to_collection(conn: &Connection, collection_id: i64, asset_id: i64) -> rusqlite::Result<()> {
    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM collection_items WHERE collection_id=?1",
            params![collection_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT OR IGNORE INTO collection_items (collection_id, asset_id, position) VALUES (?1, ?2, ?3)",
        params![collection_id, asset_id, next],
    )?;
    Ok(())
}

pub fn remove_from_collection(conn: &Connection, collection_id: i64, asset_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM collection_items WHERE collection_id=?1 AND asset_id=?2",
        params![collection_id, asset_id],
    )?;
    Ok(())
}

/// Regrava a ordem manual: a posição de cada asset = seu índice na lista recebida.
pub fn reorder_collection(conn: &mut Connection, collection_id: i64, ordered: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for (i, aid) in ordered.iter().enumerate() {
        tx.execute(
            "UPDATE collection_items SET position=?3 WHERE collection_id=?1 AND asset_id=?2",
            params![collection_id, aid, i as i64],
        )?;
    }
    tx.commit()
}

/// Coleções a que um asset pertence (pro inspetor).
pub fn collections_for_asset(conn: &Connection, asset_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT collection_id FROM collection_items WHERE asset_id=?1")?;
    let rows = stmt.query_map(params![asset_id], |r| r.get(0))?;
    rows.collect()
}

// ---------- Sync (export/import de metadados por hash) ----------

/// (id, hash, name, rating, notes, ai_desc) de todos os assets com hash — pra exportar metadados.
pub fn assets_with_hash(
    conn: &Connection,
) -> rusqlite::Result<Vec<(i64, String, Option<String>, i64, Option<String>, Option<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, hash, name, rating, notes, ai_desc FROM assets WHERE hash IS NOT NULL AND trashed=0",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
    })?;
    rows.collect()
}

/// Ids de assets com um dado hash (pra aplicar metadados sincronizados).
pub fn ids_by_hash(conn: &Connection, hash: &str) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT id FROM assets WHERE hash=?1 AND trashed=0")?;
    let rows = stmt.query_map(params![hash], |r| r.get(0))?;
    rows.collect()
}

/// Nomes das coleções de um asset (pra exportar).
pub fn collection_names_for(conn: &Connection, asset_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT c.name FROM collections c JOIN collection_items ci ON ci.collection_id=c.id WHERE ci.asset_id=?1",
    )?;
    let rows = stmt.query_map(params![asset_id], |r| r.get(0))?;
    rows.collect()
}

// ---------- Smart Folders (pastas inteligentes por regra) ----------

#[derive(Serialize, Clone, Debug)]
pub struct SmartFolder {
    pub id: i64,
    pub name: String,
    pub match_mode: String, // all | any
    pub rules: String,      // JSON: [{field, op, value}]
    pub count: i64,
}

#[derive(Deserialize)]
struct SmartRule {
    field: String,
    op: String,
    value: String,
}

/// Traduz uma regra em (condição SQL, parâmetro opcional).
fn rule_to_sql(r: &SmartRule) -> Option<(String, Option<Box<dyn rusqlite::types::ToSql>>)> {
    let v = r.value.trim().to_string();
    Some(match r.field.as_str() {
        "type" => ("a.type = ?".into(), Some(Box::new(v) as Box<dyn rusqlite::types::ToSql>)),
        "ext" => ("a.ext = ?".into(), Some(Box::new(v.to_lowercase()))),
        "name" => match r.op.as_str() {
            "equals" => ("a.filename = ?".into(), Some(Box::new(v))),
            _ => ("a.filename LIKE ?".into(), Some(Box::new(format!("%{v}%")))),
        },
        "dir" => ("a.dir LIKE ?".into(), Some(Box::new(format!("%{v}%")))),
        "color" => ("a.color_bucket = ?".into(), Some(Box::new(v))),
        "bright" => ("a.bright = ?".into(), Some(Box::new(v))),
        "warm" => ("a.warm = ?".into(), Some(Box::new(v))),
        "sat" => ("a.sat = ?".into(), Some(Box::new(v))),
        "rating" => {
            let n: i64 = v.parse().unwrap_or(0);
            let op = match r.op.as_str() {
                "lte" => "<=",
                "eq" => "=",
                _ => ">=",
            };
            (format!("a.rating {op} ?"), Some(Box::new(n)))
        }
        "duration" => {
            let n: f64 = v.parse().unwrap_or(0.0);
            let op = if r.op == "lt" { "<" } else { ">" };
            (format!("a.duration {op} ?"), Some(Box::new(n)))
        }
        "res" => {
            let cond = match v.as_str() {
                "sd" => "a.width < 1280",
                "hd" => "a.width >= 1280 AND a.width < 1920",
                "fhd" => "a.width >= 1920 AND a.width < 3840",
                "uhd" => "a.width >= 3840",
                _ => return None,
            };
            (cond.to_string(), None)
        }
        "tag" => (
            "EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id AND t.name = ?)".into(),
            Some(Box::new(v)),
        ),
        _ => return None,
    })
}

fn build_smart_where(
    rules_json: &str,
    match_mode: &str,
) -> (String, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let rules: Vec<SmartRule> = serde_json::from_str(rules_json).unwrap_or_default();
    let mut conds = Vec::new();
    let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    for r in &rules {
        if let Some((sql, arg)) = rule_to_sql(r) {
            conds.push(sql);
            if let Some(a) = arg {
                args.push(a);
            }
        }
    }
    let joiner = if match_mode == "any" { " OR " } else { " AND " };
    let where_clause = if conds.is_empty() { "1=1".to_string() } else { conds.join(joiner) };
    (where_clause, args)
}

pub fn list_smart(conn: &Connection) -> rusqlite::Result<Vec<SmartFolder>> {
    let mut stmt = conn.prepare("SELECT id, name, match_mode, rules FROM smart_folders ORDER BY name COLLATE NOCASE")?;
    let rows: Vec<(i64, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut out = Vec::new();
    for (id, name, match_mode, rules) in rows {
        let (where_clause, args) = build_smart_where(&rules, &match_mode);
        let sql = format!("SELECT COUNT(*) FROM assets a WHERE a.trashed=0 AND ({where_clause})");
        let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let count: i64 = conn.query_row(&sql, params.as_slice(), |r| r.get(0)).unwrap_or(0);
        out.push(SmartFolder { id, name, match_mode, rules, count });
    }
    Ok(out)
}

/// Conta quantos assets bateriam numa regra (preview ao vivo no construtor).
pub fn smart_count(conn: &Connection, match_mode: &str, rules: &str) -> rusqlite::Result<i64> {
    let (where_clause, args) = build_smart_where(rules, match_mode);
    let sql = format!("SELECT COUNT(*) FROM assets a WHERE a.trashed=0 AND ({where_clause})");
    let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    conn.query_row(&sql, params.as_slice(), |r| r.get(0))
}

pub fn create_smart(conn: &Connection, name: &str, match_mode: &str, rules: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO smart_folders (name, match_mode, rules) VALUES (?1, ?2, ?3)",
        params![name, match_mode, rules],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_smart(conn: &Connection, id: i64, name: &str, match_mode: &str, rules: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE smart_folders SET name=?2, match_mode=?3, rules=?4 WHERE id=?1",
        params![id, name, match_mode, rules],
    )?;
    Ok(())
}

pub fn delete_smart(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM smart_folders WHERE id=?1", params![id])?;
    Ok(())
}

/// Resultado de uma pasta inteligente (roda a regra → assets).
pub fn smart_search(conn: &Connection, id: i64, sort: Option<&str>) -> rusqlite::Result<Vec<Asset>> {
    let (match_mode, rules): (String, String) = conn.query_row(
        "SELECT match_mode, rules FROM smart_folders WHERE id=?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (where_clause, args) = build_smart_where(&rules, &match_mode);
    let order = match sort {
        Some("recent") => "modified_at DESC",
        Some("rating_desc") => "rating DESC, filename COLLATE NOCASE",
        Some("size_desc") => "size DESC",
        _ => "filename COLLATE NOCASE",
    };
    let sql = format!(
        "SELECT {SELECT_COLS} FROM assets a WHERE a.trashed=0 AND ({where_clause}) ORDER BY {order} LIMIT 1000"
    );
    let params: Vec<&dyn rusqlite::types::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params.as_slice(), row_to_asset)?;
    rows.collect()
}

// ---------- Presets do codificador (OFICINA) ----------

#[derive(Serialize, Clone, Debug)]
pub struct EncoderPreset {
    pub id: i64,
    pub name: String,
    pub opts: String, // JSON de EncodeOpts
}

pub fn list_presets(conn: &Connection) -> rusqlite::Result<Vec<EncoderPreset>> {
    let mut stmt = conn.prepare("SELECT id, name, opts FROM encoder_presets ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| Ok(EncoderPreset { id: r.get(0)?, name: r.get(1)?, opts: r.get(2)? }))?;
    rows.collect()
}

pub fn save_preset(conn: &Connection, name: &str, opts: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO encoder_presets (name, opts) VALUES (?1, ?2)
         ON CONFLICT(name) DO UPDATE SET opts=excluded.opts",
        params![name, opts],
    )?;
    conn.query_row("SELECT id FROM encoder_presets WHERE name=?1", params![name], |r| r.get(0))
}

pub fn delete_preset(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM encoder_presets WHERE id=?1", params![id])?;
    Ok(())
}

// ---------- Duplicados na importação ----------

/// Para os ids recém-importados, acha pares (já-existente, recém-chegado) com o
/// mesmo conteúdo (hash). "Existente" = o asset mais antigo (menor id) fora do lote.
pub fn find_import_dups(conn: &Connection, ids: &[i64]) -> rusqlite::Result<Vec<DupPair>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let set: std::collections::HashSet<i64> = ids.iter().copied().collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    // Todos os assets que compartilham hash com algum item do lote (inclui os antigos).
    let sql = format!(
        "SELECT hash, {SELECT_COLS} FROM assets a
         WHERE hash IS NOT NULL AND hash IN (
            SELECT hash FROM assets WHERE id IN ({placeholders}) AND hash IS NOT NULL
         )
         ORDER BY hash, id"
    );
    let args: Vec<&dyn rusqlite::types::ToSql> =
        ids.iter().map(|i| i as &dyn rusqlite::types::ToSql).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(String, Asset)> = stmt
        .query_map(args.as_slice(), |r| Ok((r.get::<_, String>(0)?, row_to_asset(r)?)))?
        .collect::<rusqlite::Result<_>>()?;

    // Agrupa por hash; em cada grupo o menor-id que NÃO está no lote é o "existente".
    let mut by_hash: std::collections::HashMap<String, Vec<Asset>> = std::collections::HashMap::new();
    for (h, a) in rows {
        by_hash.entry(h).or_default().push(a);
    }
    let mut pairs = Vec::new();
    for (_h, mut group) in by_hash {
        if group.len() < 2 {
            continue;
        }
        group.sort_by_key(|a| a.id);
        let existing = group
            .iter()
            .find(|a| !set.contains(&a.id))
            .cloned()
            .unwrap_or_else(|| group[0].clone());
        for a in &group {
            if a.id != existing.id && set.contains(&a.id) {
                pairs.push(DupPair {
                    existing: existing.clone(),
                    incoming: a.clone(),
                });
            }
        }
    }
    pairs.sort_by_key(|p| p.incoming.id);
    Ok(pairs)
}

/// "Substituir": passa avaliação, notas, tags e coleções do antigo pro novo, depois apaga o antigo da biblioteca.
pub fn replace_asset(conn: &Connection, old_id: i64, new_id: i64) -> rusqlite::Result<()> {
    // rating/notes do antigo só se o novo não tiver
    conn.execute(
        "UPDATE assets SET
            rating = MAX(rating, (SELECT rating FROM assets WHERE id=?1)),
            notes  = COALESCE(notes, (SELECT notes FROM assets WHERE id=?1))
         WHERE id=?2",
        params![old_id, new_id],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id)
         SELECT ?2, tag_id FROM asset_tags WHERE asset_id=?1",
        params![old_id, new_id],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO collection_items (collection_id, asset_id, position)
         SELECT collection_id, ?2, position FROM collection_items WHERE asset_id=?1",
        params![old_id, new_id],
    )?;
    delete_asset(conn, old_id)?;
    Ok(())
}
