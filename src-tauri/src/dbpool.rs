//! Pool de conexões de LEITURA (Bloco 2 — prioridade máxima).
//!
//! O banco está em WAL (db::open). Em WAL, vários leitores podem ler ao MESMO tempo em
//! que o WRITER (o `Arc<Mutex<Connection>>` do AppState) grava — sem se bloquearem. Mas
//! enquanto TODAS as leituras passavam pelo mesmo Mutex do writer, a UI travava quando
//! um lote em segundo plano (indexação, scan de saúde, IA) segurava o lock.
//!
//! Este pool dá conexões de leitura SEPARADAS pra UI. Resultado: buscar/contar/listar
//! não disputa mais o lock com a escrita em background — fim de ~80% dos travamentos de
//! "UI + trabalho de fundo ao mesmo tempo". Escritas continuam no writer único (correto:
//! SQLite só permite um escritor por vez).

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Quantas conexões de leitura ociosas guardamos. As leituras da UI são curtas, então
/// um punhado basta; se faltar, abrimos uma sob demanda (e descartamos ao devolver).
const POOL_CAP: usize = 8;

pub struct ReadPool {
    path: PathBuf,
    idle: Mutex<Vec<Connection>>,
}

impl ReadPool {
    /// Pré-abre `size` conexões de leitura. Falhas individuais são ignoradas (abrimos
    /// sob demanda depois).
    pub fn new(path: PathBuf, size: usize) -> Self {
        let mut idle = Vec::with_capacity(size);
        for _ in 0..size.min(POOL_CAP) {
            if let Ok(c) = open_reader(&path) {
                idle.push(c);
            }
        }
        ReadPool {
            path,
            idle: Mutex::new(idle),
        }
    }

    /// Pega uma conexão de leitura, roda `f`, devolve a conexão ao pool. Se o pool estiver
    /// vazio, abre uma na hora. O fechamento de conexões extras é automático (Drop).
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> T) -> T {
        let pooled = self.idle.lock().ok().and_then(|mut v| v.pop());
        let conn = match pooled {
            Some(c) => c,
            // Antes um `.expect` aqui derrubava o app inteiro se o banco estivesse travado/ausente
            // num instante (ex.: durante restore). Agora: tenta de novo e, em último caso, usa uma
            // conexão em memória — a consulta retorna Err (que a UI trata) em vez de PANIC.
            None => open_reader(&self.path)
                .or_else(|_| {
                    std::thread::sleep(std::time::Duration::from_millis(60));
                    open_reader(&self.path)
                })
                .or_else(|_| Connection::open_in_memory())
                .unwrap_or_else(|_| {
                    Connection::open_in_memory().expect("conexão em memória sempre abre")
                }),
        };
        let out = f(&conn);
        if let Ok(mut v) = self.idle.lock() {
            if v.len() < POOL_CAP {
                v.push(conn); // devolve ao pool; senão deixa o Drop fechar
            }
        }
        out
    }
}

/// Abre uma conexão SÓ-LEITURA em modo multi-thread (cada conexão é usada por uma thread
/// por vez, garantido pelo Mutex do pool). `busy_timeout` evita erro em concorrência rara.
fn open_reader(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
    )?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}
