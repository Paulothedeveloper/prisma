//! Features nativas portadas de plugins do Eagle:
//!  - Video Downloader (motor yt-dlp, baixado sob demanda — nada a instalar à mão)
//!  - Letras sincronizadas (LRC) pro Music Player, via lrclib.net (grátis, sem chave)
//!
//! Tudo offline-first: o yt-dlp é um único .exe standalone que baixamos uma vez pro
//! diretório de dados do app. O merge de áudio+vídeo reusa o MESMO ffmpeg que já
//! acompanha o PRISMA (sidecar), então não dependemos de nada do sistema.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
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
pub fn download(
    data_dir: &Path,
    ffmpeg: &Path,
    dest_dir: &Path,
    url: &str,
    audio_only: bool,
) -> Result<PathBuf, String> {
    let yt = ytdlp_path(data_dir)?;
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let template = dest_dir.join("%(title).80s [%(id)s].%(ext)s");
    let template = template.to_string_lossy().to_string();
    // ffmpeg-location aponta pra PASTA do nosso ffmpeg.
    let ff_dir = ffmpeg.parent().unwrap_or(Path::new(".")).to_string_lossy().to_string();

    let mut c = Command::new(&yt);
    no_window(&mut c);
    c.args(["--no-warnings", "--no-playlist", "--no-part", "--ffmpeg-location", &ff_dir]);
    if audio_only {
        c.args(["-x", "--audio-format", "m4a", "-f", "bestaudio/best"]);
    } else {
        c.args(["-f", "bv*+ba/b", "--merge-output-format", "mp4"]);
    }
    // imprime o caminho final do arquivo na última linha
    c.args(["--print", "after_move:filepath", "-o", &template, url]);

    let out = c.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "download falhou: {}",
            String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("erro")
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let final_path = stdout
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| PathBuf::from(l.trim()))
        .filter(|p| p.exists());
    match final_path {
        Some(p) => Ok(p),
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
