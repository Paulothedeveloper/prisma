//! Geracao de miniaturas e extracao de metadados.
//! Imagens: crate `image` (puro Rust). Video: ffmpeg/ffprobe (binarios locais).

use crate::classify;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Prioridade abaixo do normal: thumbs/ffprobe de fundo não congelam o PC durante a
/// indexação de bibliotecas grandes (a UI e o SO continuam responsivos).
#[cfg(windows)]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

const THUMB_MAX: u32 = 512;

pub struct Meta {
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration: Option<f64>,
}

/// Resolve o caminho de um binario (ffmpeg/ffprobe).
/// Dev: src-tauri/binaries. Release: pasta de recursos do app.
pub fn bin_path(name: &str) -> PathBuf {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    #[cfg(debug_assertions)]
    {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(exe)
    }
    #[cfg(not(debug_assertions))]
    {
        // Ao lado do executavel: bundle copia os recursos pra resources/binaries.
        if let Ok(cur) = std::env::current_exe() {
            if let Some(dir) = cur.parent() {
                let cand = dir.join("binaries").join(&exe);
                if cand.exists() {
                    return cand;
                }
                let cand2 = dir.join(&exe);
                if cand2.exists() {
                    return cand2;
                }
            }
        }
        PathBuf::from(exe)
    }
}

fn ffmpeg() -> PathBuf {
    bin_path("ffmpeg")
}
fn ffprobe() -> PathBuf {
    bin_path("ffprobe")
}

fn cmd(path: PathBuf) -> Command {
    let mut c = Command::new(path);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    c
}

/// Gera a thumb e extrai metadados. Retorna (Some(thumb_path) ou None, Meta).
/// Nunca entra em panico: erro -> sem thumb, asset ainda fica na biblioteca.
pub fn generate(src: &Path, ext: &str, out_dir: &Path, id: i64) -> (Option<String>, Meta) {
    let mut meta = Meta {
        width: None,
        height: None,
        duration: None,
    };
    // imagens/gif salvam como PNG (preserva ALPHA — overlays não viram preto);
    // vídeo/áudio como JPG (menor, sem alpha).
    let is_img = classify::is_image(ext) || classify::is_gif(ext);
    let out = out_dir.join(format!("{id}.{}", if is_img { "png" } else { "jpg" }));

    if is_img {
        // 1) crate `image` com deteccao por CONTEUDO (pega .png que e jpeg, etc.)
        if let Ok((w, h)) = image_thumb(src, &out) {
            meta.width = Some(w as i64);
            meta.height = Some(h as i64);
            return (Some(out.to_string_lossy().to_string()), meta);
        }
        // 2) fallback ffmpeg (CMYK jpeg e outros formatos exoticos que o crate recusa)
        if image_thumb_ffmpeg(src, &out).is_ok() {
            let m = ffprobe_meta(src);
            meta.width = m.width;
            meta.height = m.height;
            return (Some(out.to_string_lossy().to_string()), meta);
        }
        // Arquivo invalido/corrompido: sem thumb, mas continua na biblioteca (icone).
        return (None, meta);
    }

    if classify::is_video(ext) {
        let m = ffprobe_meta(src);
        meta.width = m.width;
        meta.height = m.height;
        meta.duration = m.duration;
        if video_thumb(src, &out, m.duration).is_ok() {
            return (Some(out.to_string_lossy().to_string()), meta);
        }
        return (None, meta);
    }

    if classify::is_audio(ext) {
        let m = ffprobe_meta(src);
        meta.duration = m.duration;
        if waveform(src, &out).is_ok() {
            return (Some(out.to_string_lossy().to_string()), meta);
        }
        return (None, meta);
    }

    // Demais tipos: sem thumb (frontend mostra icone por categoria).
    (None, meta)
}

fn image_thumb(src: &Path, out: &Path) -> Result<(u32, u32), String> {
    // Detecta o formato pelo conteudo, nao pela extensao (arquivos com ext errada).
    let img = image::ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let (w, h) = (img.width(), img.height());
    // Salva como PNG preservando o canal alpha (out termina em .png) — overlays
    // transparentes não viram retângulo preto.
    let thumb = img.thumbnail(THUMB_MAX, THUMB_MAX);
    thumb.save(out).map_err(|e| e.to_string())?;
    Ok((w, h))
}

/// Fallback: deixa o ffmpeg decodificar a imagem (CMYK jpeg, formatos raros).
fn image_thumb_ffmpeg(src: &Path, out: &Path) -> Result<(), String> {
    let status = cmd(ffmpeg())
        .args([
            "-y",
            "-i",
            &src.to_string_lossy(),
            "-frames:v",
            "1",
            "-update",
            "1",
            "-vf",
            &format!("scale={THUMB_MAX}:-1:force_original_aspect_ratio=decrease"),
            "-q:v",
            "4",
            &out.to_string_lossy(),
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() && out.exists() {
        Ok(())
    } else {
        Err("ffmpeg image fallback falhou".into())
    }
}

fn video_thumb(src: &Path, out: &Path, _duration: Option<f64>) -> Result<(), String> {
    // Filtro `thumbnail`: analisa 200 frames e escolhe o mais REPRESENTATIVO
    // (histograma mais distinto) — evita os frames pretos do início/fade-in.
    let status = cmd(ffmpeg())
        .args([
            "-y",
            "-i",
            &src.to_string_lossy(),
            "-vf",
            &format!(
                "thumbnail=n=120,scale={THUMB_MAX}:-1:force_original_aspect_ratio=decrease"
            ),
            "-frames:v",
            "1",
            "-update",
            "1",
            "-q:v",
            "3",
            &out.to_string_lossy(),
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() && out.exists() {
        Ok(())
    } else {
        Err("ffmpeg falhou".into())
    }
}

fn waveform(src: &Path, out: &Path) -> Result<(), String> {
    let status = cmd(ffmpeg())
        .args([
            "-y",
            "-i",
            &src.to_string_lossy(),
            "-filter_complex",
            &format!(
                "showwavespic=s={THUMB_MAX}x{}:colors=#E8B44A",
                THUMB_MAX / 3
            ),
            "-frames:v",
            "1",
            &out.to_string_lossy(),
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() && out.exists() {
        Ok(())
    } else {
        Err("ffmpeg waveform falhou".into())
    }
}

/// Perceptual hash (dHash 64-bit) da thumb: compara brilho de pixels adjacentes.
/// Imagens parecidas têm hashes com poucos bits diferentes (distância de Hamming baixa).
pub fn phash(thumb: &Path) -> Option<u64> {
    let img = image::open(thumb).ok()?;
    // 9x8 em escala de cinza → 8 comparações por linha = 64 bits
    let small = img.resize_exact(9, 8, image::imageops::FilterType::Triangle).to_luma8();
    let mut bits: u64 = 0;
    let mut i = 0;
    for y in 0..8u32 {
        for x in 0..8u32 {
            let left = small.get_pixel(x, y)[0];
            let right = small.get_pixel(x + 1, y)[0];
            if left > right {
                bits |= 1 << i;
            }
            i += 1;
        }
    }
    Some(bits)
}

/// Gera uma miniatura PNG a partir de uma imagem qualquer (pra capa customizada).
pub fn make_thumb_png(src: &Path, out: &Path) -> bool {
    match image::ImageReader::open(src)
        .ok()
        .and_then(|r| r.with_guessed_format().ok())
        .and_then(|r| r.decode().ok())
    {
        Some(img) => img.thumbnail(THUMB_MAX, THUMB_MAX).save(out).is_ok(),
        None => false,
    }
}

/// Características visuais extraídas da thumb (pra busca por cor/tom/temperatura).
pub struct Swatch {
    pub hex: String,
    pub bucket: String,
    pub bright: String, // escuro | medio | claro
    pub warm: String,   // quente | neutro | frio
    pub sat: String,    // pb | suave | vivido
}

/// Analisa a thumb e devolve cor + tom + temperatura + saturação, tudo local, num passe.
pub fn analyze_thumb(thumb: &Path) -> Option<Swatch> {
    let img = image::open(thumb).ok()?;
    let small = img.thumbnail(32, 32).to_rgb8();
    let (mut r, mut g, mut b, mut n) = (0u64, 0u64, 0u64, 0u64);
    let mut luma_sum = 0f64; // todos os pixels (pro tom geral)
    let mut luma_n = 0u64;
    let mut sat_sum = 0f64; // só pixels não-escuros (pro vívido/suave)
    let mut sat_n = 0u64;
    for px in small.pixels() {
        let (pr, pg, pb) = (px[0] as f64, px[1] as f64, px[2] as f64);
        luma_sum += 0.299 * pr + 0.587 * pg + 0.114 * pb;
        luma_n += 1;
        let sum = pr + pg + pb;
        if sum > 24.0 {
            r += px[0] as u64;
            g += px[1] as u64;
            b += px[2] as u64;
            n += 1;
            let max = pr.max(pg).max(pb);
            let min = pr.min(pg).min(pb);
            if max > 0.0 {
                sat_sum += (max - min) / max;
                sat_n += 1;
            }
        }
    }
    if n == 0 {
        return Some(Swatch {
            hex: "#000000".into(),
            bucket: "preto".into(),
            bright: "escuro".into(),
            warm: "neutro".into(),
            sat: "pb".into(),
        });
    }
    let (ar, ag, ab) = ((r / n) as u8, (g / n) as u8, (b / n) as u8);
    let hex = format!("#{ar:02X}{ag:02X}{ab:02X}");

    let mean_luma = luma_sum / luma_n.max(1) as f64;
    let bright = if mean_luma < 70.0 {
        "escuro"
    } else if mean_luma < 165.0 {
        "medio"
    } else {
        "claro"
    };

    // temperatura: vermelho dominante = quente, azul = frio.
    let warm = if (ar as i32) - (ab as i32) > 18 {
        "quente"
    } else if (ab as i32) - (ar as i32) > 18 {
        "frio"
    } else {
        "neutro"
    };

    let mean_sat = if sat_n > 0 { sat_sum / sat_n as f64 } else { 0.0 };
    let sat = if mean_sat < 0.10 {
        "pb"
    } else if mean_sat < 0.35 {
        "suave"
    } else {
        "vivido"
    };

    Some(Swatch {
        hex,
        bucket: bucket(ar, ag, ab),
        bright: bright.into(),
        warm: warm.into(),
        sat: sat.into(),
    })
}

/// Classifica RGB num balde de paleta (pros chips de cor da UI).
fn bucket(r: u8, g: u8, b: u8) -> String {
    let (rf, gf, bf) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let v = max;
    let s = if max <= 0.0 { 0.0 } else { (max - min) / max };
    if v < 0.18 {
        return "preto".into();
    }
    if s < 0.12 {
        return if v > 0.75 { "branco" } else { "cinza" }.into();
    }
    let d = max - min;
    let mut h = if max == rf {
        60.0 * (((gf - bf) / d) % 6.0)
    } else if max == gf {
        60.0 * (((bf - rf) / d) + 2.0)
    } else {
        60.0 * (((rf - gf) / d) + 4.0)
    };
    if h < 0.0 {
        h += 360.0;
    }
    match h as u32 {
        0..=15 | 346..=360 => "vermelho",
        16..=45 => "laranja",
        46..=70 => "amarelo",
        71..=160 => "verde",
        161..=200 => "ciano",
        201..=255 => "azul",
        256..=290 => "roxo",
        _ => "rosa",
    }
    .into()
}

/// Hash rapido pra detectar duplicados: tamanho + 64KB do inicio + 64KB do fim.
/// Evita ler 26GB inteiros; colisao em assets reais e praticamente impossivel.
pub fn quick_hash(path: &Path, size: u64) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    let chunk = 64 * 1024u64;
    let mut buf = vec![0u8; chunk as usize];
    let n = f.read(&mut buf).ok()?;
    hasher.update(&buf[..n]);
    if size > chunk * 2 {
        f.seek(SeekFrom::End(-(chunk as i64))).ok()?;
        let n = f.read(&mut buf).ok()?;
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

struct ProbeMeta {
    width: Option<i64>,
    height: Option<i64>,
    duration: Option<f64>,
}

fn ffprobe_meta(src: &Path) -> ProbeMeta {
    let mut m = ProbeMeta {
        width: None,
        height: None,
        duration: None,
    };
    let output = cmd(ffprobe())
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "default=noprint_wrappers=1",
            &src.to_string_lossy(),
        ])
        .output();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if let Some(v) = line.strip_prefix("width=") {
                m.width = v.trim().parse().ok();
            } else if let Some(v) = line.strip_prefix("height=") {
                m.height = v.trim().parse().ok();
            } else if let Some(v) = line.strip_prefix("duration=") {
                m.duration = v.trim().parse().ok();
            }
        }
    }
    m
}
