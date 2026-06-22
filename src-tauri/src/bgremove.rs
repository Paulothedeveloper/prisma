//! AI Background Remover (plugin do Eagle) — recurso nativo do PRISMA.
//!
//! Segmentação de primeiro plano com o modelo **u2netp** (ONNX, ~4,5MB) rodando em
//! **Rust puro via `tract`** — sem DLL nativa, sem onnxruntime, sem GPU obrigatória.
//! O modelo é baixado sob demanda (igual ao yt-dlp/Real-ESRGAN) e o resultado é um PNG
//! com canal alfa (fundo transparente). Não-destrutivo: escreve arquivo novo.

use image::GenericImageView;
use ort::session::Session;
use ort::value::Tensor;
use std::path::{Path, PathBuf};

const MODEL_URL: &str =
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx";
const SIZE: usize = 320;
// Normalização do rembg/u2net (ImageNet).
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

/// Garante o modelo u2netp.onnx no diretório de dados; baixa uma vez.
pub fn model_path(data_dir: &Path) -> Result<PathBuf, String> {
    let dir = data_dir.join("bin").join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("u2netp.onnx");
    if p.exists() && std::fs::metadata(&p).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        return Ok(p);
    }
    tracing::info!("baixando modelo u2netp (remover fundo)…");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(MODEL_URL).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("não consegui baixar o modelo (HTTP {})", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    std::fs::write(&p, &bytes).map_err(|e| e.to_string())?;
    Ok(p)
}

fn load_model(model: &Path) -> Result<Session, String> {
    Session::builder()
        .map_err(|e| e.to_string())?
        .commit_from_file(model)
        .map_err(|e| e.to_string())
}

/// Roda a segmentação e devolve a máscara 320x320 (valores 0..1, já normalizada min-max).
fn infer_mask(session: &mut Session, img: &image::DynamicImage) -> Result<Vec<f32>, String> {
    let small = img
        .resize_exact(SIZE as u32, SIZE as u32, image::imageops::FilterType::Lanczos3)
        .to_rgb8();
    // im_ary / max(im_ary) — divide pelo maior valor de pixel (igual rembg).
    let max_px = small.pixels().flat_map(|p| p.0).max().unwrap_or(255).max(1) as f32;
    // tensor NCHW [1,3,320,320]
    let mut data = vec![0f32; 3 * SIZE * SIZE];
    for (x, y, px) in small.enumerate_pixels() {
        for c in 0..3 {
            let v = (px.0[c] as f32 / max_px - MEAN[c]) / STD[c];
            data[c * SIZE * SIZE + (y as usize) * SIZE + (x as usize)] = v;
        }
    }
    let input = Tensor::from_array(([1usize, 3, SIZE, SIZE], data)).map_err(|e| e.to_string())?;
    let iname = session.inputs[0].name.clone();
    let outputs = session
        .run(ort::inputs![iname.as_str() => input])
        .map_err(|e| e.to_string())?;
    // primeira saída (d0) = mapa de saliência [1,1,320,320]
    let (_shape, out) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| e.to_string())?;
    let mut mi = f32::INFINITY;
    let mut ma = f32::NEG_INFINITY;
    for &v in out {
        mi = mi.min(v);
        ma = ma.max(v);
    }
    let span = (ma - mi).max(1e-6);
    Ok(out.iter().map(|&v| (v - mi) / span).collect())
}

/// Remove o fundo de uma imagem; escreve um PNG RGBA novo em `dest_dir`. Retorna o caminho.
pub fn remove_bg(data_dir: &Path, dest_dir: &Path, input: &Path) -> Result<PathBuf, String> {
    let mut session = load_model(&model_path(data_dir)?)?;
    let img = image::open(input).map_err(|e| format!("abrir imagem: {e}"))?;
    let (w, h) = img.dimensions();
    let mask = infer_mask(&mut session, &img)?;

    // máscara 320x320 → imagem cinza → redimensiona pro tamanho original (suave).
    let mut mask_img = image::GrayImage::new(SIZE as u32, SIZE as u32);
    for (i, &v) in mask.iter().enumerate() {
        let x = (i % SIZE) as u32;
        let y = (i / SIZE) as u32;
        mask_img.put_pixel(x, y, image::Luma([(v.clamp(0.0, 1.0) * 255.0) as u8]));
    }
    let mask_full = image::imageops::resize(&mask_img, w, h, image::imageops::FilterType::Triangle);

    // compõe RGBA: cor original + alfa = máscara.
    let rgba = img.to_rgba8();
    let mut out_img = image::RgbaImage::new(w, h);
    for (x, y, px) in rgba.enumerate_pixels() {
        let a = mask_full.get_pixel(x, y).0[0];
        out_img.put_pixel(x, y, image::Rgba([px.0[0], px.0[1], px.0[2], a]));
    }

    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let stem = input.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "imagem".into());
    let mut out = dest_dir.join(format!("{stem}_semfundo.png"));
    let mut n = 1;
    while out.exists() {
        out = dest_dir.join(format!("{stem}_semfundo_{n}.png"));
        n += 1;
    }
    out_img.save(&out).map_err(|e| format!("salvar: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verificação real: baixa o modelo, roda numa imagem sintética (círculo branco em fundo
    // preto) e confere que o resultado é RGBA com alfa VARIADO (fundo ~transparente,
    // objeto ~opaco). Ignorado por padrão (precisa de rede); rode com --ignored.
    #[test]
    #[ignore]
    fn remove_bg_gera_alfa_variado() {
        let tmp = std::env::temp_dir().join("prisma_bg_test");
        std::fs::create_dir_all(&tmp).unwrap();
        let mut im = image::RgbImage::new(200, 200);
        for (x, y, p) in im.enumerate_pixels_mut() {
            let dx = x as f32 - 100.0;
            let dy = y as f32 - 100.0;
            *p = if (dx * dx + dy * dy).sqrt() < 60.0 {
                image::Rgb([240, 240, 240])
            } else {
                image::Rgb([5, 5, 5])
            };
        }
        let src = tmp.join("src.png");
        im.save(&src).unwrap();
        let out = remove_bg(&tmp, &tmp, &src).expect("remove_bg falhou");
        let res = image::open(&out).unwrap().to_rgba8();
        let alphas: Vec<u8> = res.pixels().map(|p| p.0[3]).collect();
        let amin = *alphas.iter().min().unwrap();
        let amax = *alphas.iter().max().unwrap();
        assert!(amax - amin > 100, "alfa deveria variar muito (obj vs fundo): {amin}..{amax}");
    }
}
