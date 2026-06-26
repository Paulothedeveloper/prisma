//! Utilitários de SO para manter o app **leve durante trabalho pesado** (importação, proxies,
//! análise). Dois mecanismos:
//!
//! 1. **Modo background da thread (Windows):** `THREAD_MODE_BACKGROUND_BEGIN` baixa a prioridade
//!    de **CPU e de I/O de disco** da thread atual. É o que faz a importação parar de "travar o
//!    PC" — as threads de trabalho cedem a vez pro primeiro plano (a própria UI, o DaVinci, etc.)
//!    em vez de competirem de igual pra igual. Threads de trabalho aqui morrem ao fim do lote,
//!    então não precisamos do `..._END` correspondente.
//!
//! 2. **Pausa global:** quando a UI abre uma caixa de diálogo bloqueante (ex.: o modal de
//!    duplicados), ela liga a pausa; os loops de trabalho dormem em vez de processar, pra caixa
//!    aparecer instantânea e o PC não engasgar. Ao fechar, a UI desliga a pausa e o trabalho segue.

use std::sync::atomic::{AtomicBool, Ordering};

/// Quando `true`, os loops de trabalho pesado pausam (checado entre itens).
static PAUSED: AtomicBool = AtomicBool::new(false);

/// Quando `true`, os loops de trabalho pesado (catalogar/thumbs/proxies) abortam o quanto antes.
/// A UI liga via `cancel_import`; cada novo import o zera (reset_cancel no index_path).
static CANCEL: AtomicBool = AtomicBool::new(false);

/// Pede o cancelamento do trabalho pesado em andamento (importação/thumbs/proxies).
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Zera o pedido de cancelamento (chamado quando um novo import começa).
pub fn reset_cancel() {
    CANCEL.store(false, Ordering::SeqCst);
}

pub fn is_cancelled() -> bool {
    CANCEL.load(Ordering::SeqCst)
}

/// Liga/desliga a pausa global do trabalho pesado (chamado pela UI ao abrir/fechar diálogos).
pub fn set_paused(p: bool) {
    PAUSED.store(p, Ordering::SeqCst);
}

pub fn is_paused() -> bool {
    PAUSED.load(Ordering::SeqCst)
}

/// Dorme enquanto a pausa estiver ligada. Chamar no começo de cada iteração de um loop pesado.
pub fn wait_if_paused() {
    while PAUSED.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
}

/// Coloca a **thread atual** em modo background (baixa prioridade de CPU e de I/O de disco).
/// No Windows usa `SetThreadPriority(THREAD_MODE_BACKGROUND_BEGIN)`. Em outros SOs, no-op.
#[cfg(windows)]
pub fn begin_background() {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThread() -> isize;
        fn SetThreadPriority(handle: isize, priority: i32) -> i32;
    }
    // 0x0001_0000 = THREAD_MODE_BACKGROUND_BEGIN (baixa CPU **e** I/O da thread).
    const THREAD_MODE_BACKGROUND_BEGIN: i32 = 0x0001_0000;
    unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN);
    }
}

#[cfg(not(windows))]
pub fn begin_background() {}
