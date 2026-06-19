//! OFICINA — ferramentas de conserto/preparo (Briefing 2, Seção 10).
//! Motor = ffmpeg sidecar (o mesmo ffprobe/ffmpeg do leitor). NUNCA sobrescreve o
//! original: saída sempre em subpasta. Reindexa a saída na biblioteca.

use crate::{classify, db, mediainfo, thumbs};
use rusqlite::Connection;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(serde::Deserialize, Default, Clone)]
pub struct JobOpts {
    pub fps: Option<f64>,
    pub crf: Option<i64>,
    pub codec: Option<String>,    // "h265" | "prores"
    pub smoothness: Option<f64>,  // Gyroflow: 0.0–1.0 (suavidade)
    // Gyroflow Fase 2 (controle completo, via CLI do engine embutido):
    pub fov: Option<f64>,           // zoom/FOV (1.0 = padrão; >1 mostra mais, +bordas)
    pub horizon_lock: Option<f64>,  // travar horizonte 0–100 (%)
    pub lens_correction: Option<f64>, // correção de distorção 0–100 (%)
    pub gyro_codec: Option<String>, // codec de saída do render Gyroflow
    pub sync_search: Option<i64>,   // sincronização: search_size
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    job: u64,
    pct: f64,
    label: String,
}

#[derive(Serialize, Clone)]
struct DonePayload {
    job: u64,
    output: String,
    label: String,
}

#[derive(Serialize, Clone)]
struct ErrPayload {
    job: u64,
    message: String,
    label: String,
}

/// Monta (subpasta, extensao, label, args ffmpeg) para cada operacao.
/// Recebe as tags de cor da FONTE pra preservar a ciencia de cor.
fn build(
    op: &str,
    opts: &JobOpts,
    src_color: (Option<String>, Option<String>, Option<String>),
) -> Option<(&'static str, &'static str, String, Vec<String>)> {
    let fps = opts.fps.map(|f| f.round() as i64).unwrap_or(60).max(1);
    let crf = opts.crf.unwrap_or(18).clamp(10, 30);
    let (prim, trc, mtx) = src_color;
    // passagem de cor: usa a fonte; se ausente, assume Samsung Log HLG (caso VFR mais comum).
    let cp = prim.unwrap_or_else(|| "bt2020".into());
    let ct = trc.unwrap_or_else(|| "arib-std-b67".into());
    let cs = mtx.unwrap_or_else(|| "bt2020nc".into());

    let color = |v: &mut Vec<String>| {
        v.extend(
            [
                "-color_primaries",
                &cp,
                "-color_trc",
                &ct,
                "-colorspace",
                &cs,
            ]
            .map(String::from),
        );
    };

    match op {
        // 10.1 — VFR -> CFR. Codec configuravel (H.265 10-bit padrao, ou ProRes).
        "vfr_cfr" => {
            if opts.codec.as_deref() == Some("prores") {
                let mut a = sv(&["-map", "0:v:0", "-map", "0:a?", "-c:v", "prores_ks",
                    "-profile:v", "3", "-pix_fmt", "yuv422p10le"]);
                a.extend(sv(&["-r", &fps.to_string(), "-fps_mode", "cfr"]));
                color(&mut a);
                a.extend(sv(&["-c:a", "pcm_s16le"]));
                Some(("PRONTOS CFR", "mov", "VFR→CFR (ProRes)".into(), a))
            } else {
                let mut a = sv(&["-map", "0:v:0", "-map", "0:a?", "-c:v", "libx265",
                    "-profile:v", "main10", "-pix_fmt", "yuv420p10le",
                    "-crf", &crf.to_string(), "-preset", "fast",
                    "-r", &fps.to_string(), "-fps_mode", "cfr"]);
                color(&mut a);
                a.extend(sv(&["-tag:v", "hvc1", "-c:a", "aac", "-b:a", "256k",
                    "-movflags", "+faststart"]));
                Some(("PRONTOS CFR", "mp4", "VFR→CFR (H.265 10-bit)".into(), a))
            }
        }
        // 10.2 (A) — mezzanine pra grade (ja sai CFR)
        "prores" => {
            let mut a = sv(&["-map", "0:v:0", "-map", "0:a?", "-c:v", "prores_ks",
                "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-r", &fps.to_string(),
                "-fps_mode", "cfr"]);
            color(&mut a);
            a.extend(sv(&["-c:a", "pcm_s16le"]));
            Some(("EDIT", "mov", "ProRes 422 HQ".into(), a))
        }
        "dnxhr" => {
            let mut a = sv(&["-map", "0:v:0", "-map", "0:a?", "-c:v", "dnxhd",
                "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p10le", "-r", &fps.to_string(),
                "-fps_mode", "cfr"]);
            color(&mut a);
            a.extend(sv(&["-c:a", "pcm_s16le"]));
            Some(("EDIT", "mov", "DNxHR HQ".into(), a))
        }
        // 10.2 (B) — entrega
        "h265" => Some((
            "ENTREGA",
            "mp4",
            "H.265 10-bit".into(),
            sv(&["-c:v", "libx265", "-crf", "20", "-preset", "medium",
                "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-c:a", "aac",
                "-b:a", "320k", "-movflags", "+faststart"]),
        )),
        "reels" => Some((
            "ENTREGA",
            "mp4",
            "Reels 1080×1920".into(),
            sv(&["-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-vf", "scale=-2:1920", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-b:a", "320k", "-movflags", "+faststart"]),
        )),
        // proxy leve (tambem serve de preview web-compativel pra ProRes)
        "proxy" => Some((
            "PROXY",
            "mp4",
            "Proxy 1080 (H.264)".into(),
            sv(&["-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-crf", "23",
                "-preset", "veryfast", "-vf", "scale=-2:1080", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart"]),
        )),
        _ => None,
    }
}

fn sv(s: &[&str]) -> Vec<String> {
    s.iter().map(|x| x.to_string()).collect()
}

// Codecs que o WebView (Chromium) decodifica direto — não precisam de proxy.
const WEB_CODECS: &[&str] = &["h264", "avc1", "vp8", "vp9", "av01", "av1"];

// Nome estável (determinístico) pro arquivo de proxy a partir do caminho original.
fn proxy_stem(path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Gera proxies H.264 leves (720p) pros vídeos de codec NÃO-web (ProRes, DNxHR, etc.)
/// que ainda não têm proxy. Roda em segundo plano, um por vez (não trava o app).
/// Os proxies ficam no cache do app — os ORIGINAIS nunca são tocados.
pub fn run_proxy_batch(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    ffmpeg: PathBuf,
    proxy_dir: PathBuf,
    paths: Vec<String>,
) {
    std::thread::spawn(move || {
        let _ = std::fs::create_dir_all(&proxy_dir);
        let total = paths.len();
        let mut made = 0usize;
        for (i, input) in paths.into_iter().enumerate() {
            let in_path = Path::new(&input);
            if !in_path.exists() {
                continue;
            }
            // já tem proxy ligado? pula
            if let Ok(conn) = db.lock() {
                if db::get_proxy(&conn, &input).ok().flatten().is_some() {
                    continue;
                }
            }
            // codec web-compatível não precisa de proxy
            let info = mediainfo::probe(in_path);
            let codec = info
                .video
                .as_ref()
                .and_then(|v| v.codec.clone())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if codec.is_empty() || WEB_CODECS.iter().any(|c| codec.contains(c)) {
                continue;
            }
            let out = proxy_dir.join(format!("{}.mp4", proxy_stem(&input)));
            // proxy já existe em cache (de um import anterior) → só religa
            if out.exists() {
                if let Ok(conn) = db.lock() {
                    let _ = db::set_proxy(&conn, &input, &out.to_string_lossy());
                }
                let _ = app.emit("proxy:made", &input);
                made += 1;
                continue;
            }
            let mut cmd = Command::new(&ffmpeg);
            cmd.args(["-y", "-i", &input]);
            cmd.args([
                "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-crf", "24",
                "-preset", "veryfast", "-vf", "scale=-2:720", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart",
            ]);
            cmd.arg(out.to_string_lossy().to_string());
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);
            let ok = cmd
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok && out.exists() {
                if let Ok(conn) = db.lock() {
                    let _ = db::set_proxy(&conn, &input, &out.to_string_lossy());
                }
                made += 1;
                let _ = app.emit("proxy:made", &input);
            }
            let _ = app.emit(
                "proxy:progress",
                serde_json::json!({ "done": i + 1, "total": total, "made": made }),
            );
        }
        let _ = app.emit("proxy:done", made);
    });
}

// ---------- Codificador avançado (estilo HandBrake / Shutter Encoder) ----------

#[derive(serde::Deserialize, Default, Clone)]
pub struct EncodeOpts {
    pub container: Option<String>, // mp4 | mov | mkv | webm
    pub vcodec: Option<String>,    // h264|h265|prores|prores_hq|prores_4444|dnxhr|vp9|av1|gif|copy|none
    pub scale: Option<String>,     // uhd|1440|1080|720|480 | "" (original)
    pub fps: Option<f64>,
    pub crf: Option<i64>,
    pub preset: Option<String>, // ultrafast..veryslow
    pub acodec: Option<String>, // copy|aac|flac|pcm|opus|mp3|none
    pub abitrate: Option<i64>,
    #[serde(default)]
    pub deinterlace: bool,
    #[serde(default)]
    pub denoise: bool,
    #[serde(default)]
    pub grayscale: bool,
    #[serde(default)]
    pub flip_h: bool,
    pub rotate: Option<i64>, // 0|90|180|270
    pub op: Option<String>,  // rewrap | extract_audio | loudnorm | trim | watermark | null = encode normal
    // Parte 3 avançado:
    pub lufs: Option<i64>,           // normalizar áudio: alvo LUFS (-14/-16/-23)
    pub trim_in: Option<f64>,        // trim: ponto de entrada (s)
    pub trim_out: Option<f64>,       // trim: ponto de saída (s)
    pub lut_path: Option<String>,    // aplicar LUT .cube (queima o look)
    pub speed: Option<f64>,          // mudar velocidade (0.5 = metade, 2.0 = dobro)
    pub watermark_path: Option<String>, // overlay PNG (marca d'água)
}

fn scale_filter(s: &Option<String>) -> Option<String> {
    let h = match s.as_deref() {
        Some("uhd") => 2160,
        Some("1440") => 1440,
        Some("1080") => 1080,
        Some("720") => 720,
        Some("480") => 480,
        _ => return None,
    };
    Some(format!("scale=-2:{h}"))
}

/// Monta (subpasta, ext, label, args ffmpeg) pro codificador avançado.
fn build_encode(
    o: &EncodeOpts,
    src_color: (Option<String>, Option<String>, Option<String>),
    input_ext: &str,
) -> (String, String, String, Vec<String>) {
    let keep_ext = if input_ext.is_empty() { "mp4".to_string() } else { input_ext.to_string() };
    // Operações sem recodificar / utilidades (Shutter Encoder)
    match o.op.as_deref() {
        Some("rewrap") => {
            let ext = o.container.clone().unwrap_or(keep_ext);
            return ("REWRAP".into(), ext, "Reencapsular (sem recodificar)".into(), sv(&["-map", "0", "-c", "copy"]));
        }
        Some("extract_audio") => {
            return ("AUDIO".into(), "wav".into(), "Extrair áudio (WAV)".into(), sv(&["-vn", "-c:a", "pcm_s16le"]));
        }
        Some("trim") => {
            let mut a = Vec::new();
            if let Some(i) = o.trim_in {
                a.extend(sv(&["-ss", &format!("{i}")]));
            }
            if let Some(t) = o.trim_out {
                a.extend(sv(&["-to", &format!("{t}")]));
            }
            a.extend(sv(&["-map", "0", "-c", "copy"]));
            let ext = o.container.clone().unwrap_or(keep_ext);
            return ("CORTES".into(), ext, "Cortar (trim, sem recodificar)".into(), a);
        }
        Some("loudnorm") => {
            let lufs = o.lufs.unwrap_or(-14);
            let a = sv(&[
                "-c:v", "copy", "-c:a", "aac", "-b:a", "320k",
                "-af", &format!("loudnorm=I={lufs}:TP=-1.5:LRA=11"),
            ]);
            let ext = o.container.clone().unwrap_or(keep_ext);
            return ("AUDIO NORM".into(), ext, format!("Normalizar áudio {lufs} LUFS"), a);
        }
        Some("watermark") => {
            if let Some(wm) = &o.watermark_path {
                let a = sv(&[
                    "-i", wm,
                    "-filter_complex", "overlay=W-w-24:H-h-24:format=auto",
                    "-c:a", "copy",
                    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
                ]);
                let ext = o.container.clone().unwrap_or(keep_ext);
                return ("MARCA".into(), ext, "Marca d'água (overlay)".into(), a);
            }
        }
        _ => {}
    }

    let crf = o.crf.unwrap_or(20).clamp(0, 51);
    let preset = o.preset.clone().unwrap_or_else(|| "medium".into());
    let (cp, ct, cs) = src_color;
    let mut args: Vec<String> = sv(&["-map", "0:v:0", "-map", "0:a?"]);

    // filtros de vídeo
    let mut vf: Vec<String> = Vec::new();
    if o.deinterlace {
        vf.push("yadif".into());
    }
    if o.denoise {
        vf.push("hqdn3d".into());
    }
    if o.grayscale {
        vf.push("hue=s=0".into());
    }
    if let Some(sf) = scale_filter(&o.scale) {
        vf.push(sf);
    }
    if o.flip_h {
        vf.push("hflip".into());
    }
    match o.rotate.unwrap_or(0) {
        90 => vf.push("transpose=1".into()),
        180 => {
            vf.push("transpose=1".into());
            vf.push("transpose=1".into());
        }
        270 => vf.push("transpose=2".into()),
        _ => {}
    }
    // LUT .cube (queima o look) — escapa o caminho Windows pro filtro
    if let Some(lut) = &o.lut_path {
        let p = lut.replace('\\', "/").replace(':', "\\:");
        vf.push(format!("lut3d='{p}'"));
    }
    // velocidade (setpts no vídeo; atempo no áudio é adicionado no fim)
    if let Some(sp) = o.speed {
        if sp > 0.0 && (sp - 1.0).abs() > 0.001 {
            vf.push(format!("setpts={:.4}*PTS", 1.0 / sp));
        }
    }

    // codec de vídeo
    let vcodec = o.vcodec.clone().unwrap_or_else(|| "h264".into());
    let (vargs, default_ext, color_pass): (Vec<String>, &str, bool) = match vcodec.as_str() {
        "h265" => (
            sv(&["-c:v", "libx265", "-crf", &crf.to_string(), "-preset", &preset,
                "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1"]),
            "mp4", true,
        ),
        "prores" => (sv(&["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le"]), "mov", true),
        "prores_hq" => (sv(&["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"]), "mov", true),
        "prores_4444" => (sv(&["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"]), "mov", true),
        "dnxhr" => (sv(&["-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p10le"]), "mov", true),
        "vp9" => (sv(&["-c:v", "libvpx-vp9", "-crf", &crf.to_string(), "-b:v", "0", "-pix_fmt", "yuv420p"]), "webm", false),
        "av1" => (sv(&["-c:v", "libsvtav1", "-crf", &crf.to_string(), "-preset", "6", "-pix_fmt", "yuv420p"]), "mp4", false),
        "copy" => (sv(&["-c:v", "copy"]), "mp4", false),
        "none" => (sv(&["-vn"]), "m4a", false),
        // h264 default
        _ => (
            sv(&["-c:v", "libx264", "-crf", &crf.to_string(), "-preset", &preset, "-pix_fmt", "yuv420p"]),
            "mp4", false,
        ),
    };

    if !vf.is_empty() && vcodec != "copy" && vcodec != "none" {
        args.push("-vf".into());
        args.push(vf.join(","));
    }
    if let Some(fps) = o.fps {
        if fps > 0.0 && vcodec != "copy" {
            args.extend(sv(&["-r", &format!("{fps}")]));
        }
    }
    args.extend(vargs);
    // passagem de ciência de cor (só quando recodifica e a fonte tem)
    if color_pass {
        if let (Some(p), Some(t), Some(m)) = (&cp, &ct, &cs) {
            args.extend([
                "-color_primaries", p, "-color_trc", t, "-colorspace", m,
            ].map(String::from));
        }
    }

    // áudio
    let acodec = o.acodec.clone().unwrap_or_else(|| "aac".into());
    match acodec.as_str() {
        "copy" => args.extend(sv(&["-c:a", "copy"])),
        "flac" => args.extend(sv(&["-c:a", "flac"])),
        "pcm" => args.extend(sv(&["-c:a", "pcm_s16le"])),
        "opus" => args.extend(sv(&["-c:a", "libopus", "-b:a", &format!("{}k", o.abitrate.unwrap_or(192))])),
        "mp3" => args.extend(sv(&["-c:a", "libmp3lame", "-b:a", &format!("{}k", o.abitrate.unwrap_or(320))])),
        "none" => args.push("-an".into()),
        _ => args.extend(sv(&["-c:a", "aac", "-b:a", &format!("{}k", o.abitrate.unwrap_or(320))])),
    }
    // velocidade no áudio (atempo, 0.5–2.0) — casa com o setpts do vídeo
    if let Some(sp) = o.speed {
        if sp > 0.0 && (sp - 1.0).abs() > 0.001 && acodec != "copy" && acodec != "none" {
            args.extend(sv(&["-filter:a", &format!("atempo={:.4}", sp.clamp(0.5, 2.0))]));
        }
    }

    let ext = o.container.clone().unwrap_or_else(|| default_ext.to_string());
    if ext == "mp4" {
        args.extend(sv(&["-movflags", "+faststart"]));
    }
    let label = format!("Codificar → {} / {}", vcodec.to_uppercase(), ext.to_uppercase());
    ("CODIFICADO".into(), ext, label, args)
}

/// Roda o codificador avançado (mesma engine ffmpeg do resto).
#[allow(clippy::too_many_arguments)]
pub fn run_encode(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
    ffmpeg: PathBuf,
    job: u64,
    cancel: Arc<AtomicBool>,
    input: String,
    opts: EncodeOpts,
) {
    let in_path = Path::new(&input);
    let info = mediainfo::probe(in_path);
    let duration = info.duration.unwrap_or(0.0);
    let src_color = (
        info.video.as_ref().and_then(|v| v.color_primaries.clone()),
        info.video.as_ref().and_then(|v| v.transfer.clone()),
        info.video.as_ref().and_then(|v| v.matrix.clone()),
    );
    let input_ext = in_path.extension().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let (subfolder, ext, label, args) = build_encode(&opts, src_color, &input_ext);
    run_ffmpeg_job(app, db, thumbs_dir, ffmpeg, job, cancel, &input, &subfolder, &ext, &label, &args, duration, "encode");
}

/// Concatena vários clipes num só (Briefing 3 §3.9). `-f concat -c copy` (mesmos params).
pub fn run_concat(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
    ffmpeg: PathBuf,
    job: u64,
    inputs: Vec<String>,
) {
    let label = format!("Juntar {} clipes", inputs.len());
    let Some(first) = inputs.first() else {
        let _ = app.emit("oficina:error", ErrPayload { job, message: "nada pra juntar".into(), label });
        return;
    };
    let parent = Path::new(first).parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    let out_dir = parent.join("CONCAT");
    std::fs::create_dir_all(&out_dir).ok();
    let ext = Path::new(first).extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "mp4".into());
    let output = out_dir.join(format!("juntado.{ext}"));
    let list = out_dir.join("_concat_list.txt");
    // lista de concat (escapa aspas simples)
    let content: String = inputs
        .iter()
        .map(|p| format!("file '{}'", p.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    if std::fs::write(&list, content).is_err() {
        let _ = app.emit("oficina:error", ErrPayload { job, message: "falha na lista".into(), label });
        return;
    }
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i"])
        .arg(&list)
        .args(["-c", "copy"])
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let ok = cmd.status().map(|s| s.success()).unwrap_or(false) && output.exists();
    let _ = std::fs::remove_file(&list);
    if !ok {
        let _ = app.emit("oficina:error", ErrPayload { job, message: "concat falhou (clipes precisam do mesmo codec)".into(), label });
        return;
    }
    reindex_output(&app, &db, &thumbs_dir, &output, "concat", first);
    let _ = app.emit("oficina:done", DonePayload { job, output: output.to_string_lossy().to_string(), label });
}

/// Núcleo: roda ffmpeg com -progress, cancelamento e reindex da saída. Reaproveitado.
#[allow(clippy::too_many_arguments)]
fn run_ffmpeg_job(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
    ffmpeg: PathBuf,
    job: u64,
    cancel: Arc<AtomicBool>,
    input: &str,
    subfolder: &str,
    ext: &str,
    label: &str,
    args: &[String],
    duration: f64,
    op: &str,
) {
    let in_path = Path::new(input);
    let label = label.to_string();
    let stem = in_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let out_dir = in_path.parent().map(|p| p.join(subfolder)).unwrap_or_else(|| PathBuf::from(subfolder));
    std::fs::create_dir_all(&out_dir).ok();
    let output = out_dir.join(format!("{stem}.{ext}"));
    if output.exists() {
        let _ = app.emit("oficina:done", DonePayload { job, output: output.to_string_lossy().to_string(), label });
        return;
    }

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", "-i"]).arg(input);
    for a in args {
        cmd.arg(a);
    }
    cmd.arg(&output);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("oficina:error", ErrPayload { job, message: e.to_string(), label });
            return;
        }
    };
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = std::fs::remove_file(&output);
                let _ = app.emit("oficina:error", ErrPayload { job, message: "cancelado".into(), label: label.clone() });
                return;
            }
            if let Some(v) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = v.trim().parse::<f64>() {
                    let pct = if duration > 0.0 { (us / 1_000_000.0 / duration * 100.0).clamp(0.0, 99.0) } else { 0.0 };
                    let _ = app.emit("oficina:progress", ProgressPayload { job, pct, label: label.clone() });
                }
            }
        }
    }
    let ok = child.wait().map(|s| s.success()).unwrap_or(false) && output.exists();
    if !ok {
        let _ = std::fs::remove_file(&output);
        let _ = app.emit("oficina:error", ErrPayload { job, message: "ffmpeg falhou".into(), label });
        return;
    }
    let out_str = output.to_string_lossy().to_string();
    reindex_output(&app, &db, &thumbs_dir, &output, op, input);
    let _ = app.emit("oficina:progress", ProgressPayload { job, pct: 100.0, label: label.clone() });
    let _ = app.emit("oficina:done", DonePayload { job, output: out_str, label });
}

/// Roda um job de conserto numa thread. Emite oficina:progress/done/error.
#[allow(clippy::too_many_arguments)]
pub fn run_with_opts(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
    ffmpeg: PathBuf,
    job: u64,
    cancel: Arc<AtomicBool>,
    op: String,
    input: String,
    opts: JobOpts,
) {
    let in_path = Path::new(&input);
    let info = mediainfo::probe(in_path);
    let duration = info.duration.unwrap_or(0.0);
    let src_color = (
        info.video.as_ref().and_then(|v| v.color_primaries.clone()),
        info.video.as_ref().and_then(|v| v.transfer.clone()),
        info.video.as_ref().and_then(|v| v.matrix.clone()),
    );
    // fps alvo automatico = max do arquivo (r_fps) se nao informado
    let mut opts = opts;
    if opts.fps.is_none() {
        opts.fps = info.video.as_ref().and_then(|v| v.r_fps.or(v.fps));
    }

    let Some((subfolder, ext, label, args)) = build(&op, &opts, src_color) else {
        let _ = app.emit("oficina:error", ErrPayload { job, message: "operação desconhecida".into(), label: op });
        return;
    };

    // saida em subpasta, mesmo nome do arquivo
    let stem = in_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let out_dir = in_path.parent().map(|p| p.join(subfolder)).unwrap_or_else(|| PathBuf::from(subfolder));
    std::fs::create_dir_all(&out_dir).ok();
    let output = out_dir.join(format!("{stem}.{ext}"));

    // ja existe? pular (modo lote pula feitos)
    if output.exists() {
        let _ = app.emit("oficina:done", DonePayload { job, output: output.to_string_lossy().to_string(), label });
        return;
    }

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", "-i"])
        .arg(&input);
    for a in &args {
        cmd.arg(a);
    }
    cmd.arg(&output);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("oficina:error", ErrPayload { job, message: e.to_string(), label });
            return;
        }
    };

    if let Some(out) = child.stdout.take() {
        let reader = BufReader::new(out);
        for line in reader.lines().map_while(Result::ok) {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = std::fs::remove_file(&output);
                let _ = app.emit("oficina:error", ErrPayload { job, message: "cancelado".into(), label: label.clone() });
                return;
            }
            if let Some(v) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = v.trim().parse::<f64>() {
                    let pct = if duration > 0.0 { (us / 1_000_000.0 / duration * 100.0).clamp(0.0, 99.0) } else { 0.0 };
                    let _ = app.emit("oficina:progress", ProgressPayload { job, pct, label: label.clone() });
                }
            }
        }
    }

    let status = child.wait();
    let ok = status.map(|s| s.success()).unwrap_or(false) && output.exists();
    if !ok {
        let _ = std::fs::remove_file(&output);
        let _ = app.emit("oficina:error", ErrPayload { job, message: "ffmpeg falhou".into(), label });
        return;
    }

    // reindexa a saida na biblioteca (+ proxy: liga ao original)
    let out_str = output.to_string_lossy().to_string();
    reindex_output(&app, &db, &thumbs_dir, &output, &op, &input);
    let _ = app.emit("oficina:progress", ProgressPayload { job, pct: 100.0, label: label.clone() });
    let _ = app.emit("oficina:done", DonePayload { job, output: out_str, label });
}

/// Estabilização via Gyroflow EMBUTIDO (sidecar). Render real com gyro, progresso
/// parseado de --stdout-progress, saída em ESTABILIZADO/, reindexa.
pub fn run_gyroflow(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
    job: u64,
    cancel: Arc<AtomicBool>,
    input: String,
    opts: JobOpts,
) {
    let label = "Estabilizar (MotionSilk)".to_string();
    let in_path = Path::new(&input);
    let stem = in_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = in_path.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "mp4".into());
    let parent = in_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    let final_dir = parent.join("ESTABILIZADO");
    let final_out = final_dir.join(format!("{stem}.{ext}"));
    if final_out.exists() {
        let _ = app.emit("oficina:done", DonePayload { job, output: final_out.to_string_lossy().to_string(), label });
        return;
    }
    std::fs::create_dir_all(&final_dir).ok();

    let gf = crate::thumbs::bin_path("gyroflow/Gyroflow");
    if !gf.exists() {
        let _ = app.emit("oficina:error", ErrPayload { job, message: "MotionSilk não encontrado no app".into(), label });
        return;
    }

    let mut cmd = Command::new(&gf);
    cmd.arg(&input).args(["--stdout-progress", "-f"]);

    // Gyroflow Fase 2: preset COMPLETO de estabilização via CLI do engine embutido.
    let mut stab: Vec<String> = Vec::new();
    if let Some(sm) = opts.smoothness {
        stab.push(format!("'smoothness':{}", sm.clamp(0.0, 1.0)));
    }
    if let Some(f) = opts.fov {
        stab.push(format!("'fov':{}", f.clamp(0.5, 2.0)));
    }
    if let Some(h) = opts.horizon_lock {
        if h > 0.0 {
            stab.push(format!("'horizon_lock_amount':{}", h.clamp(0.0, 100.0)));
        }
    }
    let mut preset: Vec<String> = Vec::new();
    if !stab.is_empty() {
        preset.push(format!("'stabilization':{{{}}}", stab.join(",")));
    }
    if let Some(lc) = opts.lens_correction {
        preset.push(format!("'lens_correction_amount':{}", (lc.clamp(0.0, 100.0) / 100.0)));
    }
    if !preset.is_empty() {
        cmd.arg("--preset").arg(format!("{{'version':2,{}}}", preset.join(",")));
    }
    // codec do render (out-params)
    if let Some(c) = &opts.gyro_codec {
        let codec = match c.as_str() {
            "h265" => "H.265/HEVC",
            "prores" => "ProRes",
            _ => "H.264/AVC",
        };
        cmd.arg("-p").arg(format!("{{'codec':'{codec}','use_gpu':true,'audio':true}}"));
    }
    // sincronização (sync-params)
    if let Some(ss) = opts.sync_search {
        cmd.arg("-s").arg(format!("{{'search_size':{ss}}}"));
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("oficina:error", ErrPayload { job, message: e.to_string(), label });
            return;
        }
    };

    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if cancel.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = app.emit("oficina:error", ErrPayload { job, message: "cancelado".into(), label: label.clone() });
                return;
            }
            // "[id] Rendering progress: 441/450 frames (98.0%) ETA ..."
            if let Some(i) = line.find("Rendering progress:") {
                let rest = &line[i + "Rendering progress:".len()..];
                if let Some((cur, total)) = rest.trim().split_once('/') {
                    let cur: f64 = cur.trim().parse().unwrap_or(0.0);
                    let total: f64 = total.split_whitespace().next().unwrap_or("0").parse().unwrap_or(0.0);
                    let pct = if total > 0.0 { (cur / total * 100.0).clamp(0.0, 99.0) } else { 0.0 };
                    let _ = app.emit("oficina:progress", ProgressPayload { job, pct, label: label.clone() });
                }
            }
        }
    }
    let ok = child.wait().map(|s| s.success()).unwrap_or(false);

    // Gyroflow grava <stem>_stabilized.<algo> ao lado do original. Acha e move.
    let produced = std::fs::read_dir(&parent).ok().and_then(|rd| {
        rd.filter_map(|e| e.ok())
            .map(|e| e.path())
            .find(|p| {
                p.file_stem()
                    .map(|s| s.to_string_lossy().starts_with(&format!("{stem}_stabilized")))
                    .unwrap_or(false)
            })
    });

    match (ok, produced) {
        (true, Some(src)) => {
            let dst = final_dir.join(src.file_name().unwrap());
            let dst = if dst.exists() { final_out.clone() } else { dst };
            if std::fs::rename(&src, &dst).is_err() {
                let _ = std::fs::copy(&src, &dst);
                let _ = std::fs::remove_file(&src);
            }
            reindex_output(&app, &db, &thumbs_dir, &dst, "stabilize", &input);
            let _ = app.emit("oficina:progress", ProgressPayload { job, pct: 100.0, label: label.clone() });
            let _ = app.emit("oficina:done", DonePayload { job, output: dst.to_string_lossy().to_string(), label });
        }
        _ => {
            let _ = app.emit("oficina:error", ErrPayload { job, message: "MotionSilk falhou (sem gyro no clipe?)".into(), label });
        }
    }
}

/// Conversão universal de IMAGEM (pro fluxo de designer): png/jpg/webp/tiff/bmp.
/// Crate `image` (puro Rust); fallback ffmpeg pra formatos exóticos (CMYK/HEIC).
/// Nunca toca o original — saída em CONVERTIDO/.
pub fn run_convert(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    thumbs_dir: PathBuf,
    job: u64,
    input: String,
    fmt: String,
) {
    let fmt = fmt.to_ascii_lowercase();
    let label = format!("Converter → {}", fmt.to_uppercase());
    let in_path = Path::new(&input);
    let stem = in_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let parent = in_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let out_dir = parent.join("CONVERTIDO");
    std::fs::create_dir_all(&out_dir).ok();
    let output = out_dir.join(format!("{stem}.{fmt}"));

    if output.exists() {
        let _ = app.emit("oficina:done", DonePayload { job, output: output.to_string_lossy().to_string(), label });
        return;
    }
    let _ = app.emit("oficina:progress", ProgressPayload { job, pct: 20.0, label: label.clone() });

    // formatos sem canal alpha: achata sobre branco (padrão de design).
    let drop_alpha = matches!(fmt.as_str(), "jpg" | "jpeg" | "bmp");

    let decoded = image::ImageReader::open(in_path)
        .ok()
        .and_then(|r| r.with_guessed_format().ok())
        .and_then(|r| r.decode().ok());

    let mut ok = false;
    if let Some(img) = decoded {
        let _ = app.emit("oficina:progress", ProgressPayload { job, pct: 60.0, label: label.clone() });
        if drop_alpha {
            // achata sobre branco preservando dimensões
            let rgba = img.to_rgba8();
            let (w, h) = rgba.dimensions();
            let mut rgb = image::RgbImage::new(w, h);
            for (x, y, p) in rgba.enumerate_pixels() {
                let a = p[3] as f32 / 255.0;
                let blend = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round() as u8;
                rgb.put_pixel(x, y, image::Rgb([blend(p[0]), blend(p[1]), blend(p[2])]));
            }
            ok = rgb.save(&output).is_ok();
        } else {
            ok = img.save(&output).is_ok();
        }
    }

    // Fallback ffmpeg (CMYK jpeg, HEIC, formatos que o crate recusa).
    if !ok {
        let ffmpeg = thumbs::bin_path("ffmpeg");
        let mut cmd = Command::new(&ffmpeg);
        cmd.args(["-hide_banner", "-y", "-i"]).arg(&input);
        if drop_alpha {
            cmd.args(["-pix_fmt", "yuvj420p"]);
        }
        cmd.arg(&output)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        ok = cmd.status().map(|s| s.success()).unwrap_or(false) && output.exists();
    }

    if !ok {
        let _ = std::fs::remove_file(&output);
        let _ = app.emit("oficina:error", ErrPayload { job, message: "conversão falhou".into(), label });
        return;
    }

    reindex_output(&app, &db, &thumbs_dir, &output, "convert", &input);
    let _ = app.emit("oficina:progress", ProgressPayload { job, pct: 100.0, label: label.clone() });
    let _ = app.emit("oficina:done", DonePayload { job, output: output.to_string_lossy().to_string(), label });
}

/// Cataloga o arquivo de saida + gera thumb. Se for proxy, liga ao asset original.
fn reindex_output(
    app: &AppHandle,
    db: &Arc<Mutex<Connection>>,
    thumbs_dir: &Path,
    output: &Path,
    op: &str,
    input: &str,
) {
    let filename = output.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = output.extension().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let dir = output.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
    let kind = classify::categorize(&ext).to_string();
    let md = std::fs::metadata(output).ok();
    let size = md.as_ref().map(|m| m.len() as i64).unwrap_or(0);
    let modified = md
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let na = db::NewAsset {
        path: output.to_string_lossy().to_string(),
        dir,
        filename,
        ext: ext.clone(),
        kind,
        size,
        modified_at: modified,
        folder_id: 0,
    };

    let id = {
        let conn = db.lock().unwrap();
        db::upsert_asset(&conn, &na).unwrap_or(0)
    };
    if id > 0 {
        let (thumb, meta) = thumbs::generate(output, &ext, thumbs_dir, id);
        let swatch = thumb.as_deref().and_then(|t| thumbs::analyze_thumb(Path::new(t)));
        let (dom, buck) = match &swatch {
            Some(s) => (Some(s.hex.clone()), Some(s.bucket.clone())),
            None => (None, None),
        };
        let hash = thumbs::quick_hash(output, size as u64);
        let conn = db.lock().unwrap();
        let _ = db::set_processed(&conn, id, thumb.as_deref(), meta.width, meta.height,
            meta.duration, dom.as_deref(), buck.as_deref(), hash.as_deref());
        if let Some(s) = &swatch {
            let _ = db::set_traits(&conn, id, &s.bright, &s.warm, &s.sat);
        }
        // proxy: registra no asset original pra o preview usar
        if op == "proxy" {
            let _ = db::set_proxy(&conn, input, &output.to_string_lossy());
        }
    }
    let _ = app.emit("oficina:reindexed", output.to_string_lossy().to_string());
}

/// Abre o arquivo no Gyroflow instalado (ou tenta o executavel no PATH).
pub fn open_in_gyroflow(app: &AppHandle, path: &str) -> Result<(), String> {
    // tenta achar gyroflow no PATH / locais comuns; senao, abre o site.
    let candidates = ["gyroflow", "Gyroflow"];
    for c in candidates {
        let mut cmd = Command::new(c);
        cmd.arg(path);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if cmd.spawn().is_ok() {
            return Ok(());
        }
    }
    // fallback: abre o site do Gyroflow pra instalar
    let _ = app.opener().open_url("https://gyroflow.xyz", None::<&str>);
    Err("MotionSilk (engine de estabilização) indisponível.".into())
}
