//! Leitor de mídia (ffprobe) + recomendador de CST do DaVinci.
//! Implementa a tabela de decisão do Briefing 2 (SONDA) dentro do PRISMA.
//! Saída do CST é SEMPRE Rec.709 / Gamma 2.4 (entrega redes sociais do Paulo).

use crate::thumbs;
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// ffprobe do scan de saúde roda em lote (vários workers) — prioridade abaixo do normal
/// pra não congelar o PC.
#[cfg(windows)]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

#[derive(Serialize, Default)]
pub struct MediaInfo {
    pub ok: bool,
    pub container: Option<String>,
    pub duration: Option<f64>,
    pub size: i64,
    pub overall_bitrate: Option<i64>,
    pub video: Option<VideoInfo>,
    pub audio: Option<AudioInfo>,
    pub camera: Option<CameraInfo>,
    pub cst: CstRec,
    pub warnings: Vec<String>,
    pub has_gyro: bool,
    pub health: Vec<HealthFinding>,
    pub playbook: Option<Playbook>,
}

/// Playbook por tipo de arquivo (Briefing 6 §5) — reconhece o "tipo" e resume o caminho.
#[derive(Serialize, Default, Clone)]
pub struct Playbook {
    pub kind: String,       // tipo reconhecido (ex.: "Samsung Log HLG 10-bit")
    pub steps: Vec<String>, // caminho resumido: conserto · CST · método
}

/// Selo de saúde do arquivo (diagnóstico automático — Briefing 6 §2). Determinístico.
#[derive(Serialize, Default, Clone)]
pub struct HealthFinding {
    pub level: String,        // "red" | "yellow" | "green"
    pub label: String,        // curto, PT (fallback / uso no prompt da IA)
    pub detail: String,       // explicação, PT (fallback / prompt)
    pub fix: Option<String>,  // op de auto-conserto: "cfr" | "banding" | "proxy" | null
    pub key: String,          // token estável p/ traduzir no front (health.<key>.label/detail)
    pub arg: Option<String>,  // valor dinâmico (graus de rotação, sample rate) → {x}
}

#[derive(Serialize, Default)]
pub struct VideoInfo {
    pub codec: Option<String>,
    pub profile: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub r_fps: Option<f64>,
    pub vfr: bool,
    pub bit_depth: Option<i64>,
    pub chroma: Option<String>,
    pub rotation: Option<i64>,
    pub bitrate: Option<i64>,
    pub color_primaries: Option<String>,
    pub transfer: Option<String>,
    pub matrix: Option<String>,
    pub range: Option<String>,
}

#[derive(Serialize, Default)]
pub struct AudioInfo {
    pub codec: Option<String>,
    pub channels: Option<i64>,
    pub sample_rate: Option<i64>,
    pub bit_depth: Option<i64>,
}

#[derive(Serialize, Default)]
pub struct CameraInfo {
    pub make: Option<String>,
    pub model: Option<String>,
    pub iso: Option<String>,
    pub shutter: Option<String>,
    pub fnumber: Option<String>,
    pub white_balance: Option<String>,
    pub lens: Option<String>,
    pub focus: Option<String>,
    pub date: Option<String>,
}

#[derive(Serialize, Default)]
pub struct CstRec {
    pub needs_cst: bool,
    pub determinate: bool,
    pub input_color_space: Option<String>,
    pub input_gamma: Option<String>,
    pub output: String,
    pub tone_mapping: bool,
    pub summary: String,
    pub copy_text: String,
}

fn cmd(path: std::path::PathBuf) -> Command {
    let mut c = Command::new(path);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    c
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|x| x.to_string())
}

/// Procura nas tags a primeira chave que CONTÉM algum dos termos (case-insensitive).
fn tag_find(tags: &Value, needles: &[&str]) -> Option<String> {
    let obj = tags.as_object()?;
    for (k, v) in obj {
        let kl = k.to_ascii_lowercase();
        if needles.iter().any(|n| kl.contains(n)) {
            if let Some(vs) = v.as_str() {
                if !vs.is_empty() {
                    return Some(vs.to_string());
                }
            }
        }
    }
    None
}
fn i(v: &Value, key: &str) -> Option<i64> {
    v.get(key)
        .and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}

/// Roda `ffprobe -print_format json` e monta o MediaInfo + recomendação de CST.
pub fn probe(path: &Path) -> MediaInfo {
    let mut info = MediaInfo {
        size: std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0),
        ..Default::default()
    };

    let out = cmd(thumbs::bin_path("ffprobe"))
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path.to_string_lossy(),
        ])
        .output();

    let Ok(out) = out else {
        info.cst = indeterminado("ffprobe não disponível");
        return info;
    };
    let Ok(json): Result<Value, _> = serde_json::from_slice(&out.stdout) else {
        info.cst = indeterminado("não foi possível ler o arquivo");
        return info;
    };

    let format = json.get("format").cloned().unwrap_or(Value::Null);
    info.container = s(&format, "format_long_name").or_else(|| s(&format, "format_name"));
    info.duration = format
        .get("duration")
        .and_then(|x| x.as_str())
        .and_then(|x| x.parse().ok());
    info.overall_bitrate = i(&format, "bit_rate");

    // tags de fabricante + dados de câmera (Blackmagic põe tudo nas tags;
    // Sony XAVC põe pouco — o resto vive no stream rtmd).
    let tags = format.get("tags").cloned().unwrap_or(Value::Null);
    let mut make = s(&tags, "com.apple.quicktime.make")
        .or_else(|| s(&tags, "make"))
        .or_else(|| s(&tags, "com.android.manufacturer"))
        .or_else(|| tag_find(&tags, &["camera.make", "manufacturer"]));
    let model = s(&tags, "com.apple.quicktime.model")
        .or_else(|| s(&tags, "model"))
        .or_else(|| s(&tags, "com.android.model"))
        .or_else(|| tag_find(&tags, &["camera.model"]));
    // Sony: detecta pelo container XAVC quando não há tag de fabricante
    let major = s(&format, "format_name").unwrap_or_default();
    if make.is_none() && (major.contains("mov") || major.contains("mp4")) {
        if s(&format, "major_brand").map(|b| b.contains("XAVC")).unwrap_or(false)
            || format.to_string().to_ascii_uppercase().contains("XAVC")
        {
            make = Some("Sony".into());
        }
    }
    let cam = CameraInfo {
        make: make.clone(),
        model,
        iso: tag_find(&tags, &[".iso", "iso="]),
        shutter: tag_find(&tags, &["shutterspeed", "shutter.speed", "exposuretime"]),
        fnumber: tag_find(&tags, &["fnumber", "aperture", "iris"]),
        white_balance: tag_find(&tags, &["whitebalance", "white.balance", "wbmode"]),
        lens: tag_find(&tags, &["lens"]),
        focus: tag_find(&tags, &["focusmode", "focus.mode"]),
        date: s(&tags, "creation_time").or_else(|| tag_find(&tags, &["creationdate", "date"])),
    };
    if cam.make.is_some() || cam.model.is_some() || cam.date.is_some() {
        info.camera = Some(cam);
    }

    // streams
    let empty = vec![];
    let streams = json
        .get("streams")
        .and_then(|x| x.as_array())
        .unwrap_or(&empty);

    let mut v = VideoInfo::default();
    let mut have_video = false;
    let mut a = AudioInfo::default();
    let mut have_audio = false;

    for st in streams {
        match s(st, "codec_type").as_deref() {
            Some("video") => {
                if have_video {
                    continue;
                }
                have_video = true;
                v.codec = s(st, "codec_name");
                v.profile = s(st, "profile");
                v.width = i(st, "width");
                v.height = i(st, "height");
                let avg = rate(st, "avg_frame_rate");
                let rf = rate(st, "r_frame_rate");
                v.fps = avg.or(rf);
                v.r_fps = rf;
                // VFR: a media real (avg) difere do nominal (r) -> celular grava assim.
                v.vfr = match (avg, rf) {
                    (Some(a), Some(r)) if r > 0.0 => (a - r).abs() / r > 0.002 && a < r * 1.001,
                    _ => false,
                };
                v.bitrate = i(st, "bit_rate");
                v.bit_depth = i(st, "bits_per_raw_sample").or_else(|| pix_depth(st));
                v.chroma = pix_chroma(st);
                v.color_primaries = norm(s(st, "color_primaries"));
                v.transfer = norm(s(st, "color_transfer"));
                v.matrix = norm(s(st, "color_space"));
                v.range = norm(s(st, "color_range"));
                v.rotation = rotation(st);
            }
            Some("audio") => {
                if have_audio {
                    continue;
                }
                have_audio = true;
                a.codec = s(st, "codec_name");
                a.channels = i(st, "channels");
                a.sample_rate = i(st, "sample_rate");
                a.bit_depth = i(st, "bits_per_raw_sample").or_else(|| i(st, "bits_per_sample"));
            }
            _ => {}
        }
    }

    if have_video {
        info.cst = decide_cst(&v, make.as_deref());
        // avisos de editor
        if v.vfr {
            info.warnings
                .push("VFR — frame rate variável vai dessincronizar o áudio no DaVinci.".into());
        }
        if v.bit_depth == Some(8) {
            info.warnings
                .push("8-bit → grade leve, cuidado com banding.".into());
        }
        if let Some(r) = v.rotation {
            if r != 0 {
                info.warnings.push(format!("Vídeo girado {r}° — confira a orientação."));
            }
        }
        // Arquivo transcodificado (metadados de fabricante perdidos) → avisar pra ler o original.
        let encoder = tag_find(&tags, &["encoder", "writing_application", "writing_library", "comment"])
            .unwrap_or_default()
            .to_ascii_lowercase();
        let transcoded = ["lavf", "x264", "x265", "handbrake", "shutter", "ffmpeg", "vlc"]
            .iter()
            .any(|m| encoder.contains(m));
        if transcoded && v.transfer.is_none() {
            info.warnings.push(
                "⚠️ Arquivo parece TRANSCODIFICADO — metadados de fabricante perdidos. Pra CST 100% confiável, leia o ARQUIVO ORIGINAL da câmera.".into(),
            );
        }
        // Diagnóstico de saúde (selos) — determinístico, a partir do MediaInfo.
        let is_709 = info.cst.determinate && !info.cst.needs_cst;
        info.health = diagnose(
            &v,
            if have_audio { Some(&a) } else { None },
            info.overall_bitrate,
            info.duration,
            info.cst.needs_cst,
            is_709,
        );
        info.playbook = playbook(&v, make.as_deref(), &info.cst, is_709);
        info.video = Some(v);
    } else {
        info.cst = indeterminado("sem trilha de vídeo");
    }
    if have_audio {
        info.audio = Some(a);
    }

    // Giroscópio: o app Blackmagic Cam grava gyro/IMU embutido (o Gyroflow extrai).
    // Detecção confiável: tags com.blackmagic-design.* ou software "Blackmagic Cam".
    let tags_blob = {
        let mut s = String::new();
        if let Some(obj) = tags.as_object() {
            for (k, v) in obj {
                s.push_str(&k.to_ascii_lowercase());
                if let Some(vs) = v.as_str() {
                    s.push(' ');
                    s.push_str(&vs.to_ascii_lowercase());
                }
                s.push('\n');
            }
        }
        s
    };
    let blackmagic_cam = tags_blob.contains("blackmagic-design.camera")
        || tags_blob.contains("blackmagic cam");
    // Fallback: stream de dados com handler/codec sugestivo (camm/gyro/mett/gcmp).
    let gyro_stream = streams.iter().any(|st| {
        let is_data = s(st, "codec_type").as_deref() == Some("data");
        let tag = s(st, "codec_tag_string").unwrap_or_default().to_ascii_lowercase();
        let handler = st
            .get("tags")
            .and_then(|t| s(t, "handler_name"))
            .unwrap_or_default()
            .to_ascii_lowercase();
        let hay = format!("{tag} {handler}");
        is_data
            && (hay.contains("camm")    // Google/Android Motion Metadata
                || hay.contains("gyro")
                || hay.contains("gcmp")
                || hay.contains("mett")
                || hay.contains("imu")
                || hay.contains("rtmd")) // Sony Real-Time MetaData (ZV-E10 etc.) — TEM gyro
    });
    info.has_gyro = blackmagic_cam || gyro_stream;

    info.ok = have_video || have_audio;
    info
}

fn norm(x: Option<String>) -> Option<String> {
    match x.as_deref() {
        None | Some("unknown") | Some("unspecified") | Some("reserved") | Some("N/A") => None,
        _ => x,
    }
}

/// Le um campo "n/d" (avg_frame_rate / r_frame_rate) como float.
fn rate(st: &Value, key: &str) -> Option<f64> {
    let r = s(st, key)?;
    let (n, d) = r.split_once('/')?;
    let n: f64 = n.parse().ok()?;
    let d: f64 = d.parse().ok()?;
    if d > 0.0 && n > 0.0 {
        Some((n / d * 100.0).round() / 100.0)
    } else {
        None
    }
}

fn pix_depth(st: &Value) -> Option<i64> {
    let pf = s(st, "pix_fmt")?;
    if pf.contains("p10") || pf.contains("10le") || pf.contains("10be") {
        Some(10)
    } else if pf.contains("p12") || pf.contains("12le") {
        Some(12)
    } else if pf.contains("yuv") || pf.contains("rgb") || pf.contains("gray") {
        Some(8)
    } else {
        None
    }
}

fn pix_chroma(st: &Value) -> Option<String> {
    let pf = s(st, "pix_fmt")?;
    if pf.contains("444") {
        Some("4:4:4".into())
    } else if pf.contains("422") {
        Some("4:2:2".into())
    } else if pf.contains("420") {
        Some("4:2:0".into())
    } else {
        None
    }
}

fn rotation(st: &Value) -> Option<i64> {
    // rotação de exibição (mesma convenção do Gyroflow/players)
    if let Some(r) = st.get("tags").and_then(|t| i(t, "rotate")) {
        return Some(((r % 360) + 360) % 360);
    }
    if let Some(list) = st.get("side_data_list").and_then(|x| x.as_array()) {
        for sd in list {
            if let Some(r) = sd.get("rotation").and_then(|x| x.as_i64()) {
                return Some(((r % 360) + 360) % 360);
            }
        }
    }
    None
}

fn indeterminado(motivo: &str) -> CstRec {
    CstRec {
        needs_cst: false,
        determinate: false,
        input_color_space: None,
        input_gamma: None,
        output: "Rec.709 / Gamma 2.4".into(),
        tone_mapping: false,
        summary: format!("Indeterminado ({motivo}). Cheque no MediaInfo completo — não chute o CST."),
        copy_text: String::new(),
    }
}

/// Resume o diagnóstico num (nível, flags CSV) pra guardar em cache e filtrar a biblioteca.
/// nível = pior achado (red > yellow > green). flags = tokens estáveis (vfr,banding,proxy,...).
pub fn health_summary(info: &MediaInfo) -> (String, String) {
    let mut level = "green";
    let mut flags: Vec<String> = Vec::new();
    for h in &info.health {
        if h.level == "red" {
            level = "red";
        } else if h.level == "yellow" && level != "red" {
            level = "yellow";
        }
        if let Some(fix) = &h.fix {
            flags.push(fix.clone());
        } else {
            let l = h.label.to_lowercase();
            let tok = if l.contains("8-bit") {
                "8bitlog"
            } else if l.contains("bt.2020") {
                "bt2020notrc"
            } else if l.contains("girado") {
                "rotated"
            } else if l.contains("mono") {
                "mono"
            } else if l.contains("sem áudio") {
                "noaudio"
            } else if l.contains("sample") {
                "samplerate"
            } else {
                ""
            };
            if !tok.is_empty() {
                flags.push(tok.to_string());
            }
        }
    }
    flags.sort();
    flags.dedup();
    (level.to_string(), flags.join(","))
}

/// Limiar (dB) abaixo do qual a trilha de áudio é considerada MUDA/silenciosa.
/// PCM digitalmente silencioso reporta ~-91 dB; ambiente real bem baixo raramente passa de -50.
const SILENT_AUDIO_DB: f64 = -60.0;

/// Mede o volume de PICO real do áudio com ffmpeg `volumedetect` (só a trilha de áudio via `-vn`,
/// então é rápido — não decodifica vídeo). Devolve o `max_volume` em dB (negativo), ou None se falhar.
/// Diferente do ffprobe (metadados): aqui DECODIFICAMOS pra saber se há som de verdade.
pub fn audio_max_volume_db(path: &Path) -> Option<f64> {
    let ff = thumbs::bin_path("ffmpeg");
    let out = cmd(ff)
        .args(["-hide_banner", "-nostats", "-vn", "-i"])
        .arg(path)
        .args(["-af", "volumedetect", "-f", "null", "-"])
        .output()
        .ok()?;
    // O volumedetect imprime as estatísticas no STDERR: "[Parsed_volumedetect_0 @ ..] max_volume: -91.0 dB"
    let log = String::from_utf8_lossy(&out.stderr);
    for line in log.lines() {
        if let Some(idx) = line.find("max_volume:") {
            let num = line[idx + "max_volume:".len()..]
                .trim()
                .trim_end_matches("dB")
                .trim();
            if let Ok(v) = num.parse::<f64>() {
                return Some(v);
            }
        }
    }
    None
}

/// True se o arquivo TEM trilha de áudio mas ela está MUDA/silenciosa (pico ≤ -60 dB).
/// (Diferente de "sem áudio", que é não ter trilha nenhuma.)
pub fn audio_is_silent(info: &MediaInfo, path: &Path) -> bool {
    if info.audio.is_none() {
        return false;
    }
    matches!(audio_max_volume_db(path), Some(db) if db <= SILENT_AUDIO_DB)
}

/// Achado de saúde "Áudio mudo" (pro inspetor). O front traduz por `health.silentaudio.*`.
pub fn silent_audio_finding() -> HealthFinding {
    HealthFinding {
        level: "yellow".into(),
        label: "Áudio mudo".into(),
        detail: "O arquivo TEM trilha de áudio, mas ela está SILENCIOSA (pico ≤ -60 dB) — provavelmente exportado sem som ou a câmera não captou áudio.".into(),
        fix: None,
        key: "silentaudio".into(),
        arg: None,
    }
}

/// Gera o ESPECTROGRAMA (PNG) do áudio com ffmpeg (`showspectrumpic`) — eixo Y frequência, X tempo,
/// cor intensidade. Usado pela Reorganização de SFX pra a IA "ver" o som. Bloqueante.
pub fn spectrogram(audio: &Path, out: &Path) -> Result<(), String> {
    let ff = thumbs::bin_path("ffmpeg");
    let ok = cmd(ff)
        .args(["-y", "-hide_banner", "-nostats", "-i"])
        .arg(audio)
        .args([
            "-lavfi",
            "showspectrumpic=s=900x420:legend=1:gain=3:color=intensity",
            "-frames:v",
            "1",
        ])
        .arg(out)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if ok.success() && out.exists() {
        Ok(())
    } else {
        Err("falha ao gerar espectrograma".into())
    }
}

/// `health_summary` + detecção de "áudio mudo". Decodifica o áudio (ffmpeg), então NÃO fica no
/// `probe()` puro — só é chamado nos pontos que toleram o custo (import/varredura/abrir arquivo).
pub fn health_with_audio(info: &MediaInfo, path: &Path) -> (String, String) {
    let (mut level, mut flags) = health_summary(info);
    if audio_is_silent(info, path) {
        if flags.is_empty() {
            flags = "silentaudio".to_string();
        } else if !flags.split(',').any(|f| f == "silentaudio") {
            flags.push_str(",silentaudio");
        }
        if level == "green" {
            level = "yellow".to_string();
        }
    }
    (level, flags)
}

/// Playbook por tipo de arquivo (Briefing 6 §5) — determinístico. Reconhece o tipo e
/// resume conserto · CST · método. Complementa o plano da IA (que explica em detalhe).
fn playbook(v: &VideoInfo, make: Option<&str>, cst: &CstRec, is_709: bool) -> Option<Playbook> {
    let make_l = make.unwrap_or("").to_ascii_lowercase();
    let trc = v.transfer.as_deref().unwrap_or("");
    let prim = v.color_primaries.as_deref().unwrap_or("");
    let depth = v.bit_depth.unwrap_or(8);
    let vertical = matches!((v.width, v.height), (Some(w), Some(h)) if h > w);
    let hlg = trc.contains("arib-std-b67") || trc.eq_ignore_ascii_case("hlg");
    let pq = trc.contains("smpte2084") || trc.contains("pq");
    let bt2020 = prim.contains("bt2020") || prim.contains("2020");

    // steps agora são CHAVES de i18n (traduzidas no front: pb.*)
    let mut steps: Vec<String> = Vec::new();
    if v.vfr {
        steps.push("pb.cfr".into());
    }

    let kind = if make_l.contains("samsung") || (bt2020 && hlg && make_l.is_empty()) {
        steps.push("pb.cst.samsung".into());
        steps.push("pb.method.samsung".into());
        format!("Samsung/HLG Log {}-bit{}", depth, if vertical { " (Reels)" } else { "" })
    } else if make_l.contains("sony") {
        steps.push("pb.cst.sony".into());
        if depth <= 8 {
            steps.push("pb.8bit".into());
        }
        "Sony S-Log3".into()
    } else if make_l.contains("apple") {
        steps.push("pb.cst.apple".into());
        "Apple Log (iPhone)".into()
    } else if make_l.contains("dji") {
        steps.push("pb.cst.dji".into());
        "DJI D-Log".into()
    } else if make_l.contains("panasonic") || make_l.contains("lumix") {
        steps.push("pb.cst.panasonic".into());
        "Panasonic V-Log".into()
    } else if make_l.contains("canon") {
        steps.push("pb.cst.canon".into());
        "Canon C-Log3".into()
    } else if pq {
        steps.push("pb.cst.pq".into());
        "HDR PQ".into()
    } else if hlg {
        steps.push("pb.cst.hlg".into());
        "HDR HLG".into()
    } else if is_709 {
        steps.push("pb.cst.none".into());
        "Rec.709 / GoPro".into()
    } else if cst.needs_cst {
        steps.push("pb.cst.confirm".into());
        "Log/Wide".into()
    } else {
        return None;
    };
    if vertical {
        steps.push("pb.vertical".into());
    }
    Some(Playbook { kind, steps })
}

/// Diagnóstico de saúde do arquivo (Briefing 6 §2) — regras determinísticas do MediaInfo.
fn diagnose(
    v: &VideoInfo,
    audio: Option<&AudioInfo>,
    overall_bitrate: Option<i64>,
    duration: Option<f64>,
    needs_cst: bool,
    is_709: bool,
) -> Vec<HealthFinding> {
    let mut out = Vec::new();
    let f = |level: &str, key: &str, label: &str, detail: &str, fix: Option<&str>| HealthFinding {
        level: level.into(),
        label: label.into(),
        detail: detail.into(),
        fix: fix.map(|s| s.into()),
        key: key.into(),
        arg: None,
    };

    if v.vfr {
        out.push(f(
            "red",
            "vfr",
            "VFR",
            "Frame rate variável — desincroniza o áudio e trava o scrub no DaVinci. Converta pra CFR.",
            Some("cfr"),
        ));
    }
    if v.bit_depth == Some(8) && needs_cst {
        out.push(f(
            "yellow",
            "8bitlog",
            "8-bit Log",
            "Pouca margem de cor — mão leve no grade; cuidado com banding em céu/parede lisos.",
            None,
        ));
    }
    // bitrate baixo pra Log/HDR → risco de banding
    let bpp = {
        let br = v.bitrate.or(overall_bitrate);
        match (br, v.width, v.height, v.fps) {
            (Some(b), Some(w), Some(h), Some(fps)) if w > 0 && h > 0 && fps > 0.0 => {
                Some(b as f64 / (w as f64 * h as f64 * fps))
            }
            _ => None,
        }
    };
    if needs_cst {
        if let Some(bpp) = bpp {
            if bpp < 0.07 {
                out.push(f(
                    "yellow",
                    "banding",
                    "Bitrate baixo",
                    "Log/HDR com bitrate apertado → risco de banding ao graduar. Reencode com mais bitrate (CRF 16).",
                    Some("banding"),
                ));
            }
        }
    }
    let prim = v.color_primaries.as_deref().unwrap_or("");
    if (prim.contains("bt2020") || prim.contains("2020")) && v.transfer.is_none() {
        out.push(f(
            "yellow",
            "bt2020notrc",
            "BT.2020 sem transfer",
            "Provável HLG (o transcode perdeu a etiqueta). Confirme no ARQUIVO ORIGINAL da câmera.",
            None,
        ));
    }
    if let Some(r) = v.rotation {
        if r != 0 {
            let mut fd = f(
                "yellow",
                "rotated",
                &format!("Girado {r}°"),
                "A resolução pode aparecer trocada — o PRISMA já mostra orientada.",
                None,
            );
            fd.arg = Some(r.to_string());
            out.push(fd);
        }
    }
    let codec = v.codec.as_deref().unwrap_or("").to_ascii_lowercase();
    let heavy = (codec.contains("hevc") || codec.contains("265") || codec.contains("prores") || codec.contains("dnx"))
        && v.bit_depth.unwrap_or(8) >= 10;
    if heavy && duration.unwrap_or(0.0) > 60.0 {
        out.push(f(
            "yellow",
            "proxy",
            "Codec pesado",
            "Codec 10-bit longo pode travar o scrub em máquina fraca. Gere um proxy pra editar liso.",
            Some("proxy"),
        ));
    }
    match audio {
        None => out.push(f("yellow", "noaudio", "Sem áudio", "O arquivo não tem trilha de áudio.", None)),
        Some(a) => {
            if a.channels == Some(1) {
                out.push(f("yellow", "mono", "Áudio mono", "Áudio em 1 canal (mono) — confira antes de editar.", None));
            }
            if let Some(sr) = a.sample_rate {
                let common = [32000, 44100, 48000, 88200, 96000, 176400, 192000];
                if !common.contains(&sr) {
                    let mut fd = f(
                        "yellow",
                        "samplerate",
                        "Sample rate incomum",
                        &format!("Áudio a {sr} Hz — fora do comum (48k/44.1k); confira se sincroniza."),
                        None,
                    );
                    fd.arg = Some(sr.to_string());
                    out.push(fd);
                }
            }
        }
    }
    if is_709 && !v.vfr {
        out.push(f("green", "rec709", "Rec.709", "Material já normalizado — sem CST, grade direto.", None));
    }
    if out.is_empty() {
        out.push(f("green", "ok", "OK", "Nenhum problema técnico detectado.", None));
    }
    out
}

/// A regra central do CST (Briefing 2, seção 5). Prioriza fabricante > Transfer/Primaries.
fn decide_cst(v: &VideoInfo, make: Option<&str>) -> CstRec {
    let prim = v.color_primaries.as_deref().unwrap_or("");
    let trc = v.transfer.as_deref().unwrap_or("");
    let make_l = make.unwrap_or("").to_ascii_lowercase();
    let out = "Rec.709 / Gamma 2.4";

    let rec = |ics: &str, gamma: &str, tone: bool, summary: String| CstRec {
        needs_cst: true,
        determinate: true,
        input_color_space: Some(ics.into()),
        input_gamma: Some(gamma.into()),
        output: out.into(),
        tone_mapping: tone,
        summary,
        copy_text: format!(
            "CST Entrada: {ics} / {gamma}\nCST Saída: {out}{}",
            if tone { "\nTone Mapping: DaVinci (HDR)" } else { "" }
        ),
    };

    // HDR por transfer (confiável no ffprobe)
    if trc.contains("arib-std-b67") || trc.eq_ignore_ascii_case("hlg") {
        return rec(
            "Rec.2020",
            "Rec.2100 HLG",
            true,
            "HLG detectado (HDR). Ligue Tone Mapping: DaVinci no CST pra não estourar o branco.".into(),
        );
    }
    if trc.contains("smpte2084") || trc.contains("pq") {
        return rec(
            "Rec.2020",
            "ST2084 (PQ)",
            true,
            "PQ/ST2084 detectado (HDR). Ligue Tone Mapping: DaVinci no CST.".into(),
        );
    }

    // Rec.709 puro (não-log) → sem CST
    let is_709 = prim.contains("bt709")
        || prim.contains("709")
        || trc.contains("bt709")
        || trc.contains("smpte170m")
        || trc.contains("iec61966"); // sRGB
    if is_709 && !trc.contains("log") {
        let depth = v.bit_depth.unwrap_or(8);
        return CstRec {
            needs_cst: false,
            determinate: true,
            input_color_space: None,
            input_gamma: None,
            output: out.into(),
            tone_mapping: false,
            summary: format!(
                "Já é Rec.709 ({depth}-bit) — NÃO precisa de CST. Grade direto.{}",
                if depth <= 8 { " (8-bit → grade leve.)" } else { "" }
            ),
            copy_text: "Sem CST — já é Rec.709. Grade direto. Saída Rec.709 / Gamma 2.4".into(),
        };
    }

    // Pistas por fabricante (rotular como "confirme")
    if make_l.contains("sony") {
        let mut r = rec(
            "S-Gamut3.Cine",
            "S-Log3",
            false,
            "Sony detectado → provável S-Log3 (S-Gamut3.Cine). Confirme no MediaInfo se gravou em Log.".into(),
        );
        r.determinate = false;
        return r;
    }
    if make_l.contains("apple") {
        let mut r = rec(
            "Rec.2020",
            "Apple Log",
            false,
            "Apple detectado → se gravou em Apple Log (Blackmagic Cam), use Rec.2020 / Apple Log. Confirme no MediaInfo.".into(),
        );
        r.determinate = false;
        return r;
    }
    if make_l.contains("dji") {
        let mut r = rec(
            "Rec.2020",
            "DJI D-Log",
            false,
            "DJI detectado → se gravou em D-Log, use Rec.2020 / DJI D-Log. Confirme no MediaInfo.".into(),
        );
        r.determinate = false;
        return r;
    }
    if make_l.contains("panasonic") || make_l.contains("lumix") {
        let mut r = rec(
            "V-Gamut",
            "V-Log",
            false,
            "Panasonic detectado → se gravou em V-Log, use V-Gamut / V-Log. Confirme no MediaInfo.".into(),
        );
        r.determinate = false;
        return r;
    }
    if make_l.contains("canon") {
        let mut r = rec(
            "Cinema Gamut",
            "Canon Log 3",
            false,
            "Canon detectado → se gravou em C-Log3, use Cinema Gamut / Canon Log 3. Confirme no MediaInfo.".into(),
        );
        r.determinate = false;
        return r;
    }
    if make_l.contains("samsung") {
        return rec(
            "Rec.2020",
            "Rec.2100 HLG",
            true,
            "Samsung detectado → Log HDR (Rec.2100 HLG). Ligue Tone Mapping: DaVinci.".into(),
        );
    }

    // BT.2020 sem transfer → quase sempre HLG (HDR de consumidor: Samsung/celular). Sugestão forte.
    if (prim.contains("bt2020") || prim.contains("2020")) && (trc.is_empty() || trc.contains("unknown")) {
        let mut r = rec(
            "Rec.2020",
            "Rec.2100 HLG",
            true,
            "BT.2020 sem transfer → quase sempre HLG (Rec.2100 HLG), material HDR de celular. Sugestão: CST In Rec.2020 / Rec.2100 HLG + Tone Mapping. ⚠️ Confirme no ARQUIVO ORIGINAL da câmera.".into(),
        );
        r.determinate = false; // é pista forte, não certeza
        return r;
    }

    indeterminado("metadados de cor ausentes")
}
