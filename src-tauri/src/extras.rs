//! Features nativas portadas de plugins do Eagle:
//!  - Video Downloader (motor yt-dlp, baixado sob demanda — nada a instalar à mão)
//!  - Letras sincronizadas (LRC) pro Music Player, via lrclib.net (grátis, sem chave)
//!
//! Tudo offline-first: o yt-dlp é um único .exe standalone que baixamos uma vez pro
//! diretório de dados do app. O merge de áudio+vídeo reusa o MESMO ffmpeg que já
//! acompanha o PRISMA (sidecar), então não dependemos de nada do sistema.

use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct DownloadInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
}

#[derive(Serialize)]
pub struct LyricLine {
    pub t: f64,
    pub text: String,
}

fn no_window(c: &mut Command) {
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
}

/// Caminho do yt-dlp; baixa o standalone uma única vez se ainda não existir.
pub fn ytdlp_path(data_dir: &Path) -> Result<PathBuf, String> {
    let bin = data_dir.join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    let exe = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    let path = bin.join(exe);
    if path.exists() {
        return Ok(path);
    }
    let url = if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };
    tracing::info!("baixando yt-dlp standalone…");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("não consegui baixar o yt-dlp (HTTP {})", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Metadados rápidos do link (título/autor/duração/thumb) via `yt-dlp -J`.
pub fn info(data_dir: &Path, url: &str) -> Result<DownloadInfo, String> {
    let yt = ytdlp_path(data_dir)?;
    let mut c = Command::new(&yt);
    no_window(&mut c);
    c.args(["-J", "--no-warnings", "--no-playlist", url]);
    let out = c.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "yt-dlp falhou: {}",
            String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("erro")
        ));
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    Ok(DownloadInfo {
        title: v.get("title").and_then(|x| x.as_str()).unwrap_or("vídeo").to_string(),
        uploader: v.get("uploader").and_then(|x| x.as_str()).map(|s| s.to_string()),
        duration: v.get("duration").and_then(|x| x.as_f64()),
        thumbnail: v.get("thumbnail").and_then(|x| x.as_str()).map(|s| s.to_string()),
    })
}

/// Baixa o vídeo (ou só o áudio, em m4a) pro `dest_dir`. Usa o ffmpeg do PRISMA pro merge.
/// Retorna o caminho do arquivo final.
/// Video → GIF (plugin "Video to GIF Converter" do Eagle — nativo). Usa o ffmpeg do PRISMA com
/// paleta (palettegen/paletteuse) numa passada só = GIF nítido, sem serrilhado. Escreve GIF novo.
pub fn video_to_gif(ffmpeg: &Path, dest_dir: &Path, input: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "video".into());
    let mut out = dest_dir.join(format!("{stem}.gif"));
    let mut n = 1;
    while out.exists() {
        out = dest_dir.join(format!("{stem}_{n}.gif"));
        n += 1;
    }
    // fps 15 + largura 640 (mantém proporção) + Lanczos + paleta = bom equilíbrio nitidez/tamanho.
    let vf = "fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5";
    let mut c = Command::new(ffmpeg);
    no_window(&mut c);
    c.args(["-y", "-i"]);
    c.arg(input);
    c.args(["-vf", vf, "-loop", "0"]);
    c.arg(&out);
    c.stdout(Stdio::null());
    c.stderr(Stdio::piped());
    let res = c.output().map_err(|e| e.to_string())?;
    if !res.status.success() || !out.exists() {
        let err = String::from_utf8_lossy(&res.stderr);
        let last = err.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("erro");
        return Err(format!("conversão pra GIF falhou: {last}"));
    }
    Ok(out)
}

/// Converte um caminho do Windows para o formato que o filtro do ffmpeg entende
/// (barras normais + dois-pontos escapado). Sem isso, `C:\...` quebra o parser de filtros.
fn ff_filter_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").replace(':', "\\:")
}

/// Marca d'água de TEXTO queimada num vídeo (drawtext do ffmpeg). Não-destrutivo: gera cópia.
/// pos: tl|tr|bl|br|center (tiled cai em center). opacity 0..1, size 20..100 (relativo à altura).
pub fn video_watermark(
    ffmpeg: &Path,
    dest_dir: &Path,
    input: &Path,
    text: &str,
    pos: &str,
    opacity: f32,
    size: u32,
    color: &str,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "video".into());
    let ext = input
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "mp4".into());
    let mut out = dest_dir.join(format!("{stem}_marcadagua.{ext}"));
    let mut n = 1;
    while out.exists() {
        out = dest_dir.join(format!("{stem}_marcadagua_{n}.{ext}"));
        n += 1;
    }

    // Texto vai por arquivo (textfile) pra não precisar escapar : \ ' % no filtro.
    let txt_file = dest_dir.join(".prisma_wm.txt");
    std::fs::write(&txt_file, text).map_err(|e| e.to_string())?;

    // fonte do sistema (negrito quando existir)
    let font = ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf"]
        .iter()
        .map(Path::new)
        .find(|p| p.exists())
        .map(|p| p.to_path_buf());

    let op = opacity.clamp(0.05, 1.0);
    let f = (size.clamp(20, 100) as f32 / 100.0) * 0.08; // fração da altura
    let hexcolor = if color.starts_with('#') {
        format!("0x{}", &color[1..])
    } else {
        color.to_string()
    };
    let pad = "(h*0.03)";
    let (x, y) = match pos {
        "tl" => (format!("{pad}"), format!("{pad}")),
        "tr" => (format!("w-tw-{pad}"), format!("{pad}")),
        "bl" => (format!("{pad}"), format!("h-th-{pad}")),
        "br" => (format!("w-tw-{pad}"), format!("h-th-{pad}")),
        _ => ("(w-tw)/2".to_string(), "(h-th)/2".to_string()), // center / tiled
    };

    let mut drawtext = format!(
        "drawtext=textfile='{}':fontcolor={}@{:.2}:fontsize=h*{:.4}:x={}:y={}:shadowcolor=black@0.5:shadowx=2:shadowy=2",
        ff_filter_path(&txt_file),
        hexcolor,
        op,
        f,
        x,
        y
    );
    if let Some(ft) = &font {
        drawtext.push_str(&format!(":fontfile='{}'", ff_filter_path(ft)));
    }

    let mut c = Command::new(ffmpeg);
    no_window(&mut c);
    c.args(["-y", "-i"]);
    c.arg(input);
    c.args(["-vf", &drawtext]);
    // reencoda vídeo, copia áudio; qualidade alta (crf 18) e compatível.
    c.args(["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy"]);
    c.arg(&out);
    c.stdout(Stdio::null());
    c.stderr(Stdio::piped());
    let res = c.output().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&txt_file);
    if !res.status.success() || !out.exists() {
        let err = String::from_utf8_lossy(&res.stderr);
        let last = err.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("erro");
        return Err(format!("marca d'água no vídeo falhou: {last}"));
    }
    Ok(out)
}

/// Otimiza uma imagem para web: limita o lado maior a `max_side` (Lanczos3) e recomprime
/// como JPEG de qualidade `quality` (achata alpha sobre branco). Não-destrutivo: gera cópia
/// em `REDUZIDO/`. Retorna (caminho, bytes_antes, bytes_depois). Plugin "Compress" do Eagle.
pub fn optimize_image(
    dest_dir: &Path,
    input: &Path,
    max_side: u32,
    quality: u8,
) -> Result<(PathBuf, u64, u64), String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let before = std::fs::metadata(input).map(|m| m.len()).unwrap_or(0);
    let img = image::ImageReader::open(input)
        .map_err(|e| format!("abrir: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("formato: {e}"))?
        .decode()
        .map_err(|e| format!("decodificar: {e}"))?;

    let (w, h) = (img.width(), img.height());
    let scaled = if max_side > 0 && w.max(h) > max_side {
        img.resize(max_side, max_side, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    // achata alpha sobre branco → RGB (JPEG não tem alpha)
    let rgba = scaled.to_rgba8();
    let (sw, sh) = rgba.dimensions();
    let mut rgb = image::RgbImage::new(sw, sh);
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as f32 / 255.0;
        let blend = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round() as u8;
        rgb.put_pixel(x, y, image::Rgb([blend(p[0]), blend(p[1]), blend(p[2])]));
    }

    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "imagem".into());
    let mut out = dest_dir.join(format!("{stem}_web.jpg"));
    let mut n = 1;
    while out.exists() {
        out = dest_dir.join(format!("{stem}_web_{n}.jpg"));
        n += 1;
    }

    let mut buf = std::fs::File::create(&out).map_err(|e| e.to_string())?;
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality.clamp(40, 95));
    enc.encode_image(&rgb).map_err(|e| format!("codificar JPEG: {e}"))?;
    drop(buf);

    let after = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    Ok((out, before, after))
}

/// "[download]  45.2% of ..." → 45.2
fn parse_percent(line: &str) -> Option<f32> {
    if !line.contains("[download]") {
        return None;
    }
    let idx = line.find('%')?;
    let start = line[..idx].rfind(' ')? + 1;
    line[start..idx].trim().parse::<f32>().ok()
}

/// Atualiza o yt-dlp in-place (`yt-dlp -U`). Best-effort — o YouTube muda a assinatura e
/// quebra versões antigas; atualizar conserta a maioria dos erros de "formato/extração".
pub fn update_ytdlp(data_dir: &Path) -> Result<(), String> {
    let yt = ytdlp_path(data_dir)?;
    let mut c = Command::new(&yt);
    no_window(&mut c);
    c.args(["-U", "--no-warnings"]);
    c.output().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn download(
    data_dir: &Path,
    ffmpeg: &Path,
    dest_dir: &Path,
    url: &str,
    audio_only: bool,
    quality: &str,
    on_progress: &(dyn Fn(f32) + Sync),
) -> Result<PathBuf, String> {
    match download_once(data_dir, ffmpeg, dest_dir, url, audio_only, quality, on_progress) {
        Ok(p) => Ok(p),
        Err(e) => {
            // Erro típico de yt-dlp desatualizado (YouTube): atualiza e refaz UMA vez.
            let stale = ["format", "extract", "Unable", "nsig", "player", "403", "signature"]
                .iter()
                .any(|k| e.contains(k));
            if stale {
                tracing::info!("download falhou ({e}); atualizando yt-dlp e tentando de novo");
                let _ = update_ytdlp(data_dir);
                download_once(data_dir, ffmpeg, dest_dir, url, audio_only, quality, on_progress)
            } else {
                Err(e)
            }
        }
    }
}

fn download_once(
    data_dir: &Path,
    ffmpeg: &Path,
    dest_dir: &Path,
    url: &str,
    audio_only: bool,
    quality: &str,
    on_progress: &(dyn Fn(f32) + Sync),
) -> Result<PathBuf, String> {
    let yt = ytdlp_path(data_dir)?;
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let template = dest_dir.join("%(title).80s [%(id)s].%(ext)s");
    let template = template.to_string_lossy().to_string();
    let ff_dir = ffmpeg.parent().unwrap_or(Path::new(".")).to_string_lossy().to_string();

    let mut c = Command::new(&yt);
    no_window(&mut c);
    // --newline: progresso em linhas separadas (dá pra fazer a barra); --progress: força mostrar.
    c.args([
        "--no-warnings", "--no-playlist", "--no-part", "--newline", "--progress",
        "--ffmpeg-location", &ff_dir,
    ]);
    if audio_only {
        c.args(["-x", "--audio-format", "m4a", "-f", "bestaudio/best"]);
    } else {
        let fmt = match quality {
            "1080" => "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
            "720" => "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
            "480" => "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b",
            _ => "bv*+ba/b", // best
        };
        c.args(["-f", fmt, "--merge-output-format", "mp4"]);
    }
    c.args(["--print", "after_move:filepath", "-o", &template, url]);
    c.stdout(Stdio::piped());
    c.stderr(Stdio::piped());

    // horário de início: usado pra achar o arquivo final pela DATA (robusto, não depende do print)
    let start = std::time::SystemTime::now();
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("sem stdout")?;
    let stderr = child.stderr.take().ok_or("sem stderr")?;
    // drena stderr numa thread (evita deadlock se o buffer encher)
    let err_handle = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut s);
        s
    });

    let mut final_path: Option<PathBuf> = None;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(pct) = parse_percent(&line) {
            on_progress(pct);
        } else {
            let t = line.trim();
            if !t.is_empty() {
                let p = PathBuf::from(t);
                if p.exists() {
                    final_path = Some(p);
                }
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let errtxt = err_handle.join().unwrap_or_default();
    if !status.success() {
        let last = errtxt
            .lines()
            .filter(|l| !l.trim().is_empty())
            .last()
            .unwrap_or("erro");
        return Err(format!("download falhou: {last}"));
    }
    // 1ª escolha: o caminho impresso pelo yt-dlp (se pegamos). 2ª (robusta): o arquivo mais
    // NOVO da pasta de destino criado durante este download — ignora temporários (.part/.ytdl/.fNNN).
    let out = final_path.or_else(|| {
        let is_temp = |p: &Path| {
            let n = p
                .file_name()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            n.ends_with(".part") || n.ends_with(".ytdl") || n.contains(".part-") || n.contains(".temp")
        };
        std::fs::read_dir(dest_dir)
            .ok()?
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                if !p.is_file() || is_temp(&p) {
                    return None;
                }
                let mt = e.metadata().ok()?.modified().ok()?;
                // >= start (com folga de 2s pra diferenças de relógio do sistema de arquivos)
                if mt + std::time::Duration::from_secs(2) >= start {
                    Some((mt, p))
                } else {
                    None
                }
            })
            .max_by_key(|(mt, _)| *mt)
            .map(|(_, p)| p)
    });
    match out {
        Some(p) => {
            on_progress(100.0);
            Ok(p)
        }
        None => Err("download concluído mas não localizei o arquivo final".into()),
    }
}

// ---------------- AI Image Enlarger (Real-ESRGAN ncnn-vulkan) ----------------

const REALESRGAN_URL: &str =
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip";

/// Garante o Real-ESRGAN (exe + modelos) no diretório de dados; baixa+extrai uma vez.
/// Retorna o caminho do .exe. Pesa ~30MB e roda na GPU (Vulkan).
pub fn realesrgan_exe(data_dir: &Path) -> Result<PathBuf, String> {
    let dir = data_dir.join("bin").join("realesrgan");
    let exe = dir.join("realesrgan-ncnn-vulkan.exe");
    if exe.exists() {
        return Ok(exe);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tracing::info!("baixando Real-ESRGAN (ampliador de imagem)…");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(REALESRGAN_URL).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("não consegui baixar o Real-ESRGAN (HTTP {})", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    // extrai o zip preservando a estrutura (exe + models/)
    let reader = std::io::Cursor::new(bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("zip: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let out = dir.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut f).map_err(|e| e.to_string())?;
        }
    }
    if !exe.exists() {
        return Err("baixei o pacote mas não achei o executável do Real-ESRGAN".into());
    }
    Ok(exe)
}

/// Amplia uma imagem 4x via Real-ESRGAN. Escreve um PNG novo em `dest_dir` (não-destrutivo).
pub fn upscale(data_dir: &Path, dest_dir: &Path, input: &Path) -> Result<PathBuf, String> {
    let exe = realesrgan_exe(data_dir)?;
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let stem = input.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "imagem".into());
    let mut out = dest_dir.join(format!("{stem}_4x.png"));
    let mut n = 1;
    while out.exists() {
        out = dest_dir.join(format!("{stem}_4x_{n}.png"));
        n += 1;
    }
    let mut c = Command::new(&exe);
    no_window(&mut c);
    // -n realesrgan-x4plus (foto), -s 4, -f png. O cwd = pasta do exe (acha models/).
    c.current_dir(exe.parent().unwrap_or(data_dir));
    c.args([
        "-i", &input.to_string_lossy(),
        "-o", &out.to_string_lossy(),
        "-s", "4",
        "-n", "realesrgan-x4plus",
        "-f", "png",
    ]);
    let res = c.output().map_err(|e| e.to_string())?;
    if !res.status.success() || !out.exists() {
        let err = String::from_utf8_lossy(&res.stderr);
        let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("falhou");
        return Err(format!("ampliação falhou: {last}"));
    }
    Ok(out)
}

/// Letras SINCRONIZADAS (timestamps) via lrclib.net — API pública, sem chave.
/// Faz o parse do LRC ("[mm:ss.xx] texto") em linhas com tempo em segundos.
pub fn lyrics(artist: &str, title: &str) -> Result<Vec<LyricLine>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("PRISMA-DAM (https://github.com/Paulothedeveloper/prisma)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://lrclib.net/api/get")
        .query(&[("artist_name", artist), ("track_name", title)])
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err("letra não encontrada".into());
    }
    let v: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    let synced = v.get("syncedLyrics").and_then(|x| x.as_str()).unwrap_or("");
    if synced.is_empty() {
        // sem sincronização: devolve a letra simples sem tempos
        let plain = v.get("plainLyrics").and_then(|x| x.as_str()).unwrap_or("");
        if plain.is_empty() {
            return Err("essa faixa não tem letra".into());
        }
        return Ok(plain
            .lines()
            .map(|l| LyricLine { t: -1.0, text: l.to_string() })
            .collect());
    }
    let mut out = Vec::new();
    for line in synced.lines() {
        // formato: [mm:ss.xx] texto  (pode ter vários timestamps na mesma linha)
        let mut rest = line;
        let mut stamps: Vec<f64> = Vec::new();
        while rest.starts_with('[') {
            if let Some(end) = rest.find(']') {
                let inside = &rest[1..end];
                if let Some(sec) = parse_stamp(inside) {
                    stamps.push(sec);
                }
                rest = &rest[end + 1..];
            } else {
                break;
            }
        }
        let text = rest.trim().to_string();
        for s in stamps {
            out.push(LyricLine { t: s, text: text.clone() });
        }
    }
    out.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
    if out.is_empty() {
        return Err("letra sem sincronização".into());
    }
    Ok(out)
}

fn parse_stamp(s: &str) -> Option<f64> {
    // "mm:ss.xx" ou "mm:ss"
    let (m, rest) = s.split_once(':')?;
    let mins: f64 = m.trim().parse().ok()?;
    let secs: f64 = rest.trim().parse().ok()?;
    Some(mins * 60.0 + secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn optimize_encolhe_e_gera_jpeg_valido() {
        // imagem grande 3000x2000, fotográfica (ruído suave) salva como JPEG q100
        let mut big = image::RgbImage::new(3000, 2000);
        for (x, y, p) in big.enumerate_pixels_mut() {
            let n = ((x * 7 + y * 13) % 97) as u8;
            *p = image::Rgb([(x % 256) as u8 ^ n, (y % 256) as u8 ^ n, (128 + n) as u8]);
        }
        let dir = std::env::temp_dir().join("prisma_opt_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("grande.jpg");
        {
            let mut f = std::fs::File::create(&input).unwrap();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, 100)
                .encode_image(&big)
                .unwrap();
        }
        let before = std::fs::metadata(&input).unwrap().len();

        let (out, b, a) = optimize_image(&dir, &input, 1920, 82).unwrap();
        assert_eq!(b, before);
        assert!(a < b, "otimizado ({a}) deve ser menor que o original ({b})");
        // reabre e confere: lado maior <= 1920 e decodifica
        let re = image::open(&out).expect("JPEG de saída deve ser válido");
        assert!(re.width().max(re.height()) <= 1920, "lado maior deve caber em 1920");
        assert!(out.extension().unwrap() == "jpg");
    }
}
