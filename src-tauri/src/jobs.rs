//! Sistema de jobs unificado (Bloco 2).
//!
//! Antes havia 3 pools de workers copiados (run_ai_batch, run_health_scan,
//! run_proxy_batch) com o mesmo esqueleto: fila por AtomicUsize + N threads + emit
//! "<x>:progress"/"<x>:done" + cancelamento por AtomicBool. Aqui isso vira UM lugar.
//!
//! Dois usos:
//!   - `register()` / `cancel()` — jobs ÚNICOS de longa duração (Oficina: encode,
//!     stabilize, concat) que emitem o próprio progresso e podem ser cancelados pela UI.
//!   - `run_batch()` — LOTES (IA, saúde) com N workers, progresso e cancelamento.
//!
//! O progresso continua sendo entregue por EVENTOS (canal certo pra fire-and-forget),
//! nunca por payload de retorno — a UI fica fina.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct Jobs {
    counter: AtomicU64,
    live: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

impl Jobs {
    pub fn new() -> Self {
        Jobs {
            counter: AtomicU64::new(0),
            live: Mutex::new(HashMap::new()),
        }
    }

    /// Registra um job único cancelável. Devolve (id, flag de cancelamento).
    /// O id vai pra UI; a flag vai pro worker (ex.: ffmpeg checa entre etapas).
    pub fn register(&self) -> (u64, Arc<AtomicBool>) {
        let id = self.counter.fetch_add(1, Ordering::SeqCst) + 1;
        let cancel = Arc::new(AtomicBool::new(false));
        if let Ok(mut live) = self.live.lock() {
            live.insert(id, cancel.clone());
        }
        (id, cancel)
    }

    /// Sinaliza cancelamento de um job pelo id (vindo da UI).
    pub fn cancel(&self, id: u64) {
        if let Ok(live) = self.live.lock() {
            if let Some(c) = live.get(&id) {
                c.store(true, Ordering::SeqCst);
            }
        }
    }

    /// Tira o job do mapa (chamado ao terminar).
    pub fn finish(&self, id: u64) {
        if let Ok(mut live) = self.live.lock() {
            live.remove(&id);
        }
    }

    /// Roda `work` sobre `items` com `workers` threads. Emite `"{kind}:progress"`
    /// (`{done,total}`) por item e `"{kind}:done"` no fim. Cancelável pela UI via o
    /// id retornado. Substitui os pools manuais de IA/saúde/proxy.
    ///
    /// `work` recebe cada item e roda o trabalho pesado (rede/ffmpeg/db). As gravações
    /// no banco devem serializar pelo writer Mutex DENTRO de `work` (igual antes).
    pub fn run_batch<T, F>(
        self: &Arc<Self>,
        app: AppHandle,
        kind: &'static str,
        items: Vec<T>,
        workers: usize,
        work: F,
    ) -> u64
    where
        T: Send + Sync + 'static,
        F: Fn(&T) + Send + Sync + 'static,
    {
        let (id, cancel) = self.register();
        let total = items.len();
        let items = Arc::new(items);
        let next = Arc::new(AtomicUsize::new(0));
        let done = Arc::new(AtomicUsize::new(0));
        let work = Arc::new(work);
        let n = workers.max(1).min(total.max(1));
        let jobs = self.clone();

        std::thread::spawn(move || {
            let mut handles = Vec::with_capacity(n);
            for _ in 0..n {
                let app = app.clone();
                let items = items.clone();
                let next = next.clone();
                let done = done.clone();
                let work = work.clone();
                let cancel = cancel.clone();
                handles.push(std::thread::spawn(move || {
                    // Lotes (IA / saúde) também em modo background: não roubam CPU/IO do PC.
                    crate::sys::begin_background();
                    loop {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    crate::sys::wait_if_paused();
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    if i >= items.len() {
                        break;
                    }
                    work(&items[i]);
                    let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                    let _ = app.emit(
                        &format!("{kind}:progress"),
                        serde_json::json!({ "done": d, "total": total }),
                    );
                    }
                }));
            }
            for h in handles {
                let _ = h.join();
            }
            let _ = app.emit(&format!("{kind}:done"), ());
            jobs.finish(id);
        });

        id
    }
}
