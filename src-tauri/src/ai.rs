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
    pub vault_path: Option<String>, // pasta do vault de conhecimento (RAG, Briefing 6) — pode ser o vault do Quartzo
    pub quartzo_vault: Option<String>, // pasta do vault do Quartzo (PKM nosso) — integração ler/escrever notas
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
    let path = settings_path(data_dir);
    let Some(txt) = std::fs::read_to_string(&path).ok() else {
        return Settings::default(); // arquivo não existe ainda → default limpo
    };
    if let Ok(s) = serde_json::from_str::<Settings>(&txt) {
        return s;
    }
    // O arquivo EXISTE mas não parseou (corrompido / formato inesperado). Antes caía no default
    // e o próximo `save` apagava a CHAVE DA API em silêncio. Agora: faz backup do arquivo ruim e
    // tenta resgatar os campos conhecidos via parse genérico (preserva a chave sempre que possível).
    let _ = std::fs::copy(&path, path.with_extension("json.bad"));
    let mut out = Settings::default();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
        out.anthropic_key = s("anthropic_key");
        out.model = s("model");
        out.vault_path = s("vault_path");
        out.quartzo_vault = s("quartzo_vault");
        out.autotag_on_import = v.get("autotag_on_import").and_then(|x| x.as_bool());
        out.auto_proxy_on_import = v.get("auto_proxy_on_import").and_then(|x| x.as_bool());
    }
    out
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

/// AI Action (plugin do Eagle): pergunta LIVRE sobre a imagem (descreva, que texto tem,
/// sugira nome, etc.). Manda a thumb + a pergunta do usuário e devolve a resposta crua.
/// Bloqueante (rode numa thread).
pub fn ask_image(key: &str, model: &str, thumb_path: &Path, question: &str) -> Result<String, String> {
    let bytes = std::fs::read(thumb_path).map_err(|e| format!("thumb: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 700,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "image", "source": { "type": "base64", "media_type": media_type(thumb_path), "data": b64 } },
                { "type": "text", "text": question }
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
    Ok(json
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|b| b.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string())
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

// ---------- Reorganizar SFX (classificação de elemento de edição por espectrograma + features) ----------

#[derive(Default, Clone)]
pub struct SfxClass {
    pub categoria: String,
    pub subtipo: String,
    pub descricao: String,
    pub nome_sugerido: String,
    pub tags: Vec<String>,
    pub confianca: f64,
}

const SFX_PROMPT: &str = "Você é especialista em sound design e SFX para edição de vídeo. \
A imagem é o ESPECTROGRAMA de um arquivo de áudio de elemento de edição (eixo Y = frequência, \
X = tempo, cor = intensidade). Um whoosh aparece como varredura ascendente/descendente; um riser \
como rampa subindo; um impact/hit como pico transiente curto; um drone/ambience como faixa contínua. \
Use TAMBÉM o nome do arquivo e as features de áudio abaixo, e seu conhecimento das convenções de \
bibliotecas famosas (Artlist, Epidemic Sound, Boom Library, Soundly).\n\
Responda APENAS um JSON válido (sem texto antes ou depois, sem markdown), exatamente neste formato:\n\
{\"categoria\":\"SFX|Musica|Voz|Ambiente\",\"subtipo\":\"Whoosh|Riser|Impact|Sweep|Hit|Foley|Ambience|Drone|Glitch|Sub|Transicao|Outro\",\"descricao\":\"frase curta em pt-BR\",\"nome_sugerido\":\"TIPO_Subtipo_Caracteristica_Numero\",\"tags\":[\"5 a 8 tags curtas em pt-BR\"],\"confianca\":0.0}\n\
No nome_sugerido NÃO inclua a extensão; use só letras/números/underscore.";

/// Classifica um elemento de edição (SFX) a partir do espectrograma + features. Bloqueante.
pub fn classify_sfx(
    key: &str,
    model: &str,
    spectro_png: &Path,
    filename: &str,
    features: &str,
) -> Result<SfxClass, String> {
    let bytes = std::fs::read(spectro_png).map_err(|e| format!("espectrograma: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let user_text = format!(
        "{SFX_PROMPT}\n\nNome do arquivo: {filename}\nFeatures (ffmpeg): {features}"
    );
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 500,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": b64 } },
                { "type": "text", "text": user_text }
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
        .unwrap_or("");
    parse_sfx(text).ok_or_else(|| "resposta da IA não veio em JSON válido".to_string())
}

/// Extrai o JSON da resposta (tolerante a texto/markdown em volta) e monta o SfxClass.
fn parse_sfx(text: &str) -> Option<SfxClass> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&text[start..=end]).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let tags = v
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|x| x.trim().to_lowercase())
                .filter(|x| !x.is_empty() && x.len() <= 30)
                .take(8)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let confianca = v.get("confianca").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let out = SfxClass {
        categoria: s("categoria"),
        subtipo: s("subtipo"),
        descricao: s("descricao"),
        nome_sugerido: s("nome_sugerido"),
        tags,
        confianca,
    };
    if out.categoria.is_empty() && out.subtipo.is_empty() && out.tags.is_empty() {
        return None;
    }
    Some(out)
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
        description = text.trim().chars().take(500).collect();
    }
    AiResult { tags, description }
}
