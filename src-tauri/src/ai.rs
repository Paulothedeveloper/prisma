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
    pub gemini_key: Option<String>,   // chave do Google AI Studio (Gemini) — alternativa à Anthropic
    pub gemini_model: Option<String>, // modelo Gemini (padrão gemini-flash-lite-latest: rápido + obedece formato)
    pub provider: Option<String>,     // "anthropic" | "gemini" | None(auto: usa a chave que existir)
    pub autotag_on_import: Option<bool>, // workflow: ao importar, marca itens com o nome da pasta
    pub auto_proxy_on_import: Option<bool>, // ao importar, gera proxy H.264 dos vídeos de codec não-web
    pub vault_path: Option<String>, // pasta do vault de conhecimento (RAG, Briefing 6) — pode ser o vault do Quartzo
    pub quartzo_vault: Option<String>, // pasta do vault do Quartzo (PKM nosso) — integração ler/escrever notas
}

/// Provedor de IA ativo. O app fala com Claude (Anthropic) OU Gemini (Google) com o MESMO
/// fluxo (visão por imagem + texto); a chave é sempre DO USUÁRIO.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Anthropic,
    Gemini,
}

fn set(o: &Option<String>) -> bool {
    o.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
}

impl Settings {
    /// Provedor ativo: respeita a escolha explícita; em "auto" (None) usa o Gemini se só a chave
    /// dele estiver preenchida, senão Anthropic.
    pub fn provider(&self) -> Provider {
        match self.provider.as_deref() {
            Some("gemini") => Provider::Gemini,
            Some("anthropic") => Provider::Anthropic,
            _ => {
                if set(&self.gemini_key) && !set(&self.anthropic_key) {
                    Provider::Gemini
                } else {
                    Provider::Anthropic
                }
            }
        }
    }

    /// Chave do provedor ativo (vazia → None). Usada pra validar antes de chamar a API.
    pub fn active_key(&self) -> Option<String> {
        let k = match self.provider() {
            Provider::Gemini => &self.gemini_key,
            Provider::Anthropic => &self.anthropic_key,
        };
        k.clone().filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_string())
    }

    /// Modelo do provedor ativo (com padrão barato e com visão pra cada um).
    pub fn model(&self) -> String {
        match self.provider() {
            Provider::Gemini => self
                .gemini_model
                .clone()
                .filter(|s| !s.trim().is_empty())
                // flash-lite: ~2s e OBEDECE o formato terso. O gemini-3.5-flash (modelo "pensador")
                // levava 30-130s (estourava o timeout) e ignorava o formato (testado com a chave real).
                // Alias "-latest" = resiliente a desligamento de versão (lição do 2.0-flash desligado).
                .unwrap_or_else(|| "gemini-flash-lite-latest".to_string()),
            Provider::Anthropic => self
                .model
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| "claude-haiku-4-5-20251001".to_string()),
        }
    }

    pub fn provider_name(&self) -> &'static str {
        match self.provider() {
            Provider::Gemini => "gemini",
            Provider::Anthropic => "anthropic",
        }
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
        out.gemini_key = s("gemini_key");
        out.gemini_model = s("gemini_model");
        out.provider = s("provider");
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

// ---------- Camada de provedor (Anthropic OU Gemini, mesmo fluxo) ----------

fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// Chamada à Anthropic Messages API. `image` = (media_type, base64) opcional; quando ausente é só texto.
fn anthropic_call(
    key: &str,
    model: &str,
    system: Option<&str>,
    image: Option<(&str, &str)>,
    text: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let mut content = Vec::new();
    if let Some((mime, b64)) = image {
        content.push(serde_json::json!({
            "type": "image",
            "source": { "type": "base64", "media_type": mime, "data": b64 }
        }));
    }
    content.push(serde_json::json!({ "type": "text", "text": text }));
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{ "role": "user", "content": content }]
    });
    if let Some(sys) = system {
        body["system"] = serde_json::Value::String(sys.to_string());
    }
    let resp = http()?
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

/// Chamada à Google Gemini API (generateContent). Visão por `inline_data` (base64) — mesmo
/// papel da imagem na Anthropic. A chave vai no header `x-goog-api-key`.
fn gemini_call(
    key: &str,
    model: &str,
    system: Option<&str>,
    image: Option<(&str, &str)>,
    text: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let mut parts = Vec::new();
    if let Some((mime, b64)) = image {
        parts.push(serde_json::json!({
            "inline_data": { "mime_type": mime, "data": b64 }
        }));
    }
    parts.push(serde_json::json!({ "text": text }));
    let mut body = serde_json::json!({
        "contents": [{ "role": "user", "parts": parts }],
        "generationConfig": { "maxOutputTokens": max_tokens }
    });
    if let Some(sys) = system {
        body["system_instruction"] = serde_json::json!({ "parts": [{ "text": sys }] });
    }
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    );
    let resp = http()?
        .post(&url)
        .header("x-goog-api-key", key)
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
        return Err(format!("Gemini {status}: {msg}"));
    }
    // junta todos os blocos de texto da primeira candidata
    let txt = json
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    Ok(txt)
}

/// Despacha pro provedor ativo. Centraliza a escolha Anthropic/Gemini num lugar só.
fn dispatch(
    s: &Settings,
    system: Option<&str>,
    image: Option<(&str, &str)>,
    text: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let key = s
        .active_key()
        .ok_or("Configure sua chave da API nas configurações.")?;
    let model = s.model();
    match s.provider() {
        Provider::Anthropic => anthropic_call(&key, &model, system, image, text, max_tokens),
        Provider::Gemini => gemini_call(&key, &model, system, image, text, max_tokens),
    }
}

fn read_b64(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("arquivo: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Envia a thumb pro provedor (Claude/Gemini vision) e devolve tags + descrição. Bloqueante.
pub fn analyze_image(s: &Settings, thumb_path: &Path) -> Result<AiResult, String> {
    let b64 = read_b64(thumb_path)?;
    let text = dispatch(s, None, Some((media_type(thumb_path), &b64)), PROMPT, 400)?;
    Ok(parse_result(&text))
}

/// AI Action (plugin do Eagle): pergunta LIVRE sobre a imagem (descreva, que texto tem,
/// sugira nome, etc.). Manda a thumb + a pergunta do usuário e devolve a resposta crua.
/// Bloqueante (rode numa thread).
pub fn ask_image(s: &Settings, thumb_path: &Path, question: &str) -> Result<String, String> {
    let b64 = read_b64(thumb_path)?;
    dispatch(s, None, Some((media_type(thumb_path), &b64)), question, 700)
}

/// Chamada de TEXTO ao Claude (sem imagem) — usada pelo Plano de Color (Briefing 6 §4).
/// Bloqueante (rode numa thread). Retorna o texto da resposta.
pub fn ask_text(s: &Settings, system: &str, user: &str) -> Result<String, String> {
    dispatch(s, Some(system), None, user, 1200)
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
/// Usa o provedor ativo (Claude OU Gemini) — o espectrograma vai como imagem (visão).
pub fn classify_sfx(
    s: &Settings,
    spectro_png: &Path,
    filename: &str,
    features: &str,
) -> Result<SfxClass, String> {
    let b64 = read_b64(spectro_png)?;
    let user_text =
        format!("{SFX_PROMPT}\n\nNome do arquivo: {filename}\nFeatures (ffmpeg): {features}");
    let text = dispatch(s, None, Some(("image/png", &b64)), &user_text, 500)?;
    parse_sfx(&text).ok_or_else(|| "resposta da IA não veio em JSON válido".to_string())
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
