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
    pub label: String,        // curto (vira o selo)
    pub detail: String,       // explicação
    pub fix: Option<String>,  // op de auto-conserto: "cfr" | "banding" | "proxy" | null
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
    c.creation_flags(CREATE_NO_WINDOW);
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

    let mut steps: Vec<String> = Vec::new();
    if v.vfr {
        steps.push("Converter pra CFR primeiro (botão Consertar)".into());
    }

    let kind = if make_l.contains("samsung") || (bt2020 && hlg && make_l.is_empty()) {
        steps.push("CST 2 nós: Rec.2020 / Rec.2100 HLG → Rec.709 (Tone DaVinci + Compressão de Saturação no nó OUT)".into());
        steps.push("Método de 2 nós + tempero La Creme (dose ~60-70%); alvos cinza ~53% / branco ~71%".into());
        format!("Samsung/HLG Log {}-bit{}", depth, if vertical { " vertical (Reels)" } else { "" })
    } else if make_l.contains("sony") {
        steps.push("CST 2 nós: S-Gamut3.Cine / S-Log3 → Rec.709".into());
        if depth <= 8 {
            steps.push("8-bit: mão leve, ETTR na captação; cuidado com banding".into());
        }
        "Sony S-Log3".into()
    } else if make_l.contains("apple") {
        steps.push("CST 2 nós: Rec.2020 / Apple Log → Rec.709".into());
        "Apple Log (iPhone)".into()
    } else if make_l.contains("dji") {
        steps.push("CST 2 nós: Rec.2020 / DJI D-Log → Rec.709".into());
        "DJI D-Log".into()
    } else if make_l.contains("panasonic") || make_l.contains("lumix") {
        steps.push("CST 2 nós: V-Gamut / V-Log → Rec.709".into());
        "Panasonic V-Log".into()
    } else if make_l.contains("canon") {
        steps.push("CST 2 nós: Cinema Gamut / Canon Log 3 → Rec.709".into());
        "Canon C-Log3".into()
    } else if pq {
        steps.push("CST 2 nós: Rec.2020 / ST2084 (PQ) → Rec.709 (mapear nits)".into());
        "HDR PQ".into()
    } else if hlg {
        steps.push("CST 2 nós: Rec.2020 / Rec.2100 HLG → Rec.709".into());
        "HDR HLG".into()
    } else if is_709 {
        steps.push("Sem CST — material já em Rec.709, grade direto no look".into());
        "Rec.709 / GoPro / pronto".into()
    } else if cst.needs_cst {
        steps.push("CST 2 nós conforme a origem (confirme no arquivo ORIGINAL)".into());
        "Log/Wide (a confirmar)".into()
    } else {
        return None;
    };
    if vertical && !steps.iter().any(|s| s.contains("vertical")) {
        steps.push("Timeline/entrega vertical 1080×1920 (Reels)".into());
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
    let f = |level: &str, label: &str, detail: &str, fix: Option<&str>| HealthFinding {
        level: level.into(),
        label: label.into(),
        detail: detail.into(),
        fix: fix.map(|s| s.into()),
    };

    if v.vfr {
        out.push(f(
            "red",
            "VFR",
            "Frame rate variável — desincroniza o áudio e trava o scrub no DaVinci. Converta pra CFR.",
            Some("cfr"),
        ));
    }
    if v.bit_depth == Some(8) && needs_cst {
        out.push(f(
            "yellow",
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
            "BT.2020 sem transfer",
            "Provável HLG (o transcode perdeu a etiqueta). Confirme no ARQUIVO ORIGINAL da câmera.",
            None,
        ));
    }
    if let Some(r) = v.rotation {
        if r != 0 {
            out.push(f(
                "yellow",
                &format!("Girado {r}°"),
                "A resolução pode aparecer trocada — o PRISMA já mostra orientada.",
                None,
            ));
        }
    }
    let codec = v.codec.as_deref().unwrap_or("").to_ascii_lowercase();
    let heavy = (codec.contains("hevc") || codec.contains("265") || codec.contains("prores") || codec.contains("dnx"))
        && v.bit_depth.unwrap_or(8) >= 10;
    if heavy && duration.unwrap_or(0.0) > 60.0 {
        out.push(f(
            "yellow",
            "Codec pesado",
            "Codec 10-bit longo pode travar o scrub em máquina fraca. Gere um proxy pra editar liso.",
            Some("proxy"),
        ));
    }
    match audio {
        None => out.push(f("yellow", "Sem áudio", "O arquivo não tem trilha de áudio.", None)),
        Some(a) => {
            if a.channels == Some(1) {
                out.push(f("yellow", "Áudio mono", "Áudio em 1 canal (mono) — confira antes de editar.", None));
            }
        }
    }
    if is_709 && !v.vfr {
        out.push(f("green", "Rec.709", "Material já normalizado — sem CST, grade direto.", None));
    }
    if out.is_empty() {
        out.push(f("green", "OK", "Nenhum problema técnico detectado.", None));
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
