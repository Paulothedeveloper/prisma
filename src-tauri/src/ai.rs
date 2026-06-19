//! IA opcional — metade "API" do híbrido. Descreve/etiqueta o conteúdo visual de um
//! asset via Claude vision, pra busca semântica ("praia", "pessoa", "céu").
//! A chave de API é DO USUÁRIO (fica em settings.json, nunca versionada).
//! A imagem enviada é a THUMB (512px), nunca o original pesado.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Settings {
    pub anthropic_key: Option<String>,
    pub model: Option<String>,
    pub autotag_on_import: Option<bool>, // workflow: ao importar, marca itens com o nome da pasta
    pub auto_proxy_on_import: Option<bool>, // ao importar, gera proxy H.264 dos vídeos de codec não-web
    pub vault_path: Option<String>, // pasta do vault Obsidian (base de conhecimento RAG, Briefing 6)
}

impl Settings {
    pub fn model(&self) -> String {
        self.model
            .clone()
            .unwrap_or_else(|| "claude-haiku-4-5-20251001".to_string())
    }
}

pub fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn load_settings(data_dir: &Path) -> Settings {
    std::fs::read_to_string(settings_path(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_settings(data_dir: &Path, s: &Settings) -> Result<(), String> {
    let txt = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(data_dir), txt).map_err(|e| e.to_string())
}

pub struct AiResult {
    pub tags: Vec<String>,
    pub description: String,
}

fn media_type(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg",
    }
}

const PROMPT: &str = "Você cataloga assets de vídeo/imagem para um editor profissional. \
Olhe a imagem e responda em português, exatamente neste formato e nada mais:\n\
TAGS: <5 a 10 etiquetas curtas, 1-2 palavras, separadas por vírgula — objetos, cena, pessoas, ambiente, clima/iluminação>\n\
DESC: <uma frase curta descrevendo o conteúdo>";

/// Envia a thumb pro Claude vision e devolve tags + descrição. Bloqueante (rode numa thread).
pub fn analyze_image(key: &str, model: &str, thumb_path: &Path) -> Result<AiResult, String> {
    let bytes = std::fs::read(thumb_path).map_err(|e| format!("thumb: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 400,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "image", "source": { "type": "base64", "media_type": media_type(thumb_path), "data": b64 } },
                { "type": "text", "text": PROMPT }
            ]
        }]
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("rede: {e}"))?;

    let status = resp.status();
    let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("falha na API");
        return Err(format!("Claude {status}: {msg}"));
    }

    let text = json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|b| b.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    Ok(parse_result(&text))
}

/// Chamada de TEXTO ao Claude (sem imagem) — usada pelo Plano de Color (Briefing 6 §4).
/// Bloqueante (rode numa thread). Retorna o texto da resposta.
pub fn ask_text(key: &str, model: &str, system: &str, user: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1200,
        "system": system,
        "messages": [{ "role": "user", "content": user }]
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("rede: {e}"))?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("falha na API");
        return Err(format!("Claude {status}: {msg}"));
    }
    Ok(json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|b| b.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string())
}

fn parse_result(text: &str) -> AiResult {
    let mut tags = Vec::new();
    let mut description = String::new();
    for line in text.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("TAGS:").or_else(|| l.strip_prefix("Tags:")) {
            tags = rest
                .split(',')
                .map(|t| t.trim().trim_matches('.').to_lowercase())
                .filter(|t| !t.is_empty() && t.len() <= 30)
                .take(10)
                .collect();
        } else if let Some(rest) = l.strip_prefix("DESC:").or_else(|| l.strip_prefix("Desc:")) {
            description = rest.trim().to_string();
        }
    }
    // fallback: se não veio no formato, usa o texto inteiro como descrição.
    if tags.is_empty() && description.is_empty() {
        description = text.trim().chars().take(240).collect();
    }
    AiResult { tags, description }
}
