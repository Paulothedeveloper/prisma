//! Feature flags / licenciamento — fundação para o caminho premium (Bloco 1).
//!
//! REGRA ARQUITETURAL: o NÚCLEO do PRISMA (indexar, navegar, buscar, saúde básica,
//! arrastar pro NLE) é SEMPRE livre e nunca passa por gate. Só features AVANÇADAS são
//! gateáveis. Hoje (open-source) todos os avançados vêm LIGADOS — virar pago no futuro
//! é só mudar os defaults de `from_license` e plugar a validação, SEM tocar no core.
//!
//! O frontend lê isto UMA vez no boot (comando `feature_flags`) e some/desabilita os
//! botões avançados conforme. Cada comando avançado também checa no backend (defesa em
//! profundidade) via `FeatureFlags::require`.

use serde::Serialize;
use std::path::Path;

/// Nível da licença. "core" = open-source/grátis; "pro" = pago (futuro).
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Core,
    Pro,
}

/// Flags expostas ao frontend. Campos do NÚCLEO não entram aqui de propósito —
/// eles nunca são gateados. Aqui só moram os AVANÇADOS, que um dia podem virar pagos.
#[derive(Clone, Serialize)]
pub struct FeatureFlags {
    pub tier: Tier,
    /// Análise de conteúdo por IA (Claude vision) + busca semântica.
    pub ai_analysis: bool,
    /// Plano de Color explicado (IA texto + RAG do vault).
    pub color_plan: bool,
    /// Oficina: codificador avançado / conversões em lote.
    pub oficina_encode: bool,
    /// MotionSilk (estabilização).
    pub motionsilk: bool,
    /// Sincronização entre máquinas (export/import de catálogo).
    pub sync_catalog: bool,
}

impl FeatureFlags {
    /// Conjunto de hoje: open-source, TUDO ligado. (Quando virar pago, este vira o
    /// conjunto "grátis" com os avançados em `false` e a licença válida os religa.)
    pub fn open_source() -> Self {
        Self {
            tier: Tier::Core,
            ai_analysis: true,
            color_plan: true,
            oficina_encode: true,
            motionsilk: true,
            sync_catalog: true,
        }
    }

    /// Resolve as flags a partir do estado de licença em disco.
    ///
    /// Estratégia evolutiva (começa simples, sem reescrever depois):
    ///   FASE A (agora): sem arquivo de licença → `open_source()` (tudo ligado).
    ///   FASE B (pago local): `license.json` com `tier:"pro"` validado por assinatura
    ///                        offline (minisign, mesma chave do updater) → libera avançados;
    ///                        ausente/inválida → base grátis com avançados desligados.
    ///   FASE C (online): trocar `validate_license` por checagem com servidor + cache offline,
    ///                    sem mexer nos call-sites (a assinatura desta função não muda).
    pub fn resolve(data_dir: &Path) -> Self {
        match validate_license(data_dir) {
            Some(Tier::Pro) => {
                let mut f = Self::open_source();
                f.tier = Tier::Pro;
                f
            }
            // Sem licença: hoje = open-source (tudo ligado). Trocar para um conjunto
            // restrito aqui no dia da virada comercial é a ÚNICA mudança necessária.
            _ => Self::open_source(),
        }
    }

    /// Gate de backend para um comando avançado. Use no topo do comando:
    /// `flags.require(flags.ai_analysis, "ai_analysis")?;`
    /// (Ainda não chamado: os avançados estão todos livres hoje. Será usado no dia da
    /// virada comercial — mantido pronto de propósito.)
    #[allow(dead_code)]
    pub fn require(&self, enabled: bool, feature: &str) -> Result<(), String> {
        if enabled {
            Ok(())
        } else {
            Err(format!(
                "Recurso \"{feature}\" não disponível na sua edição do PRISMA."
            ))
        }
    }
}

/// Valida o estado de licença em disco. Hoje é um stub: procura `license.json` e, se a
/// estrutura disser `pro`, devolve `Pro` — SEM checagem criptográfica ainda (Fase A).
/// É aqui que a verificação por assinatura (Fase B) ou online (Fase C) entra, sem que
/// nenhum call-site precise mudar.
fn validate_license(data_dir: &Path) -> Option<Tier> {
    let path = data_dir.join("license.json");
    let txt = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    match v.get("tier").and_then(|t| t.as_str()) {
        Some("pro") => Some(Tier::Pro),
        _ => Some(Tier::Core),
    }
}
