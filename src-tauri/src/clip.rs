//! Busca semântica LOCAL com CLIP (plugin "AI Search" do Eagle) — recurso nativo.
//!
//! Modelo: Xenova/clip-vit-base-patch32 (ONNX quantizado, ~155MB baixado sob demanda),
//! rodando dentro do app via onnxruntime (crate `ort`, linkado estaticamente). Gera um
//! embedding de 512 dim por imagem e por texto; a busca é cosseno entre o texto da query
//! e os embeddings das imagens. Tudo offline depois do download. Sem GPU obrigatória.

use ort::session::Session;
use ort::value::Tensor;
use std::path::{Path, PathBuf};
use tokenizers::Tokenizer;

const BASE: &str = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main";
const VISION: &str = "onnx/vision_model_quantized.onnx";
const TEXT: &str = "onnx/text_model_quantized.onnx";
const TOK: &str = "tokenizer.json";
const DIM: usize = 512;
const IMG: usize = 224;
// Normalização do CLIP (OpenAI).
const MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
const STD: [f32; 3] = [0.268_629_54, 0.261_302_58, 0.275_777_11];

fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("bin").join("clip")
}

/// Baixa os 3 arquivos do CLIP sob demanda (idempotente). Retorna a pasta.
pub fn ensure_models(data_dir: &Path) -> Result<PathBuf, String> {
    let d = dir(data_dir);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    for (rel, min) in [(VISION, 10_000_000u64), (TEXT, 10_000_000), (TOK, 100_000)] {
        let name = Path::new(rel).file_name().unwrap().to_string_lossy().to_string();
        let out = d.join(&name);
        if out.exists() && std::fs::metadata(&out).map(|m| m.len() >= min).unwrap_or(false) {
            continue;
        }
        tracing::info!("baixando CLIP: {name}…");
        let resp = client.get(format!("{BASE}/{rel}")).send().map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("baixar {name}: HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().map_err(|e| e.to_string())?;
        std::fs::write(&out, &bytes).map_err(|e| e.to_string())?;
    }
    Ok(d)
}

fn open_session(p: &Path) -> Result<Session, String> {
    Session::builder()
        .map_err(|e| e.to_string())?
        .commit_from_file(p)
        .map_err(|e| e.to_string())
}

pub fn vision_session(data_dir: &Path) -> Result<Session, String> {
    let d = ensure_models(data_dir)?;
    open_session(&d.join("vision_model_quantized.onnx"))
}

pub struct TextEncoder {
    session: Session,
    tokenizer: Tokenizer,
}

pub fn text_encoder(data_dir: &Path) -> Result<TextEncoder, String> {
    let d = ensure_models(data_dir)?;
    let session = open_session(&d.join("text_model_quantized.onnx"))?;
    let tokenizer = Tokenizer::from_file(d.join("tokenizer.json")).map_err(|e| e.to_string())?;
    Ok(TextEncoder { session, tokenizer })
}

fn l2_normalize(v: &mut [f32]) {
    let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-8);
    for x in v.iter_mut() {
        *x /= n;
    }
}

/// Acha a saída de 512 dim (image_embeds/text_embeds) e devolve normalizada.
fn pick_embed(outputs: &ort::session::SessionOutputs) -> Result<Vec<f32>, String> {
    for i in 0..outputs.len() {
        if let Ok((_shape, data)) = outputs[i].try_extract_tensor::<f32>() {
            if data.len() == DIM {
                let mut v = data.to_vec();
                l2_normalize(&mut v);
                return Ok(v);
            }
        }
    }
    Err("modelo CLIP não devolveu um embedding de 512".into())
}

/// Pré-processa a imagem pro CLIP: redimensiona o lado menor pra 224, corta o centro 224²,
/// reescala e normaliza. Devolve o tensor NCHW [1,3,224,224].
fn preprocess_image(img: &image::DynamicImage) -> Vec<f32> {
    use image::GenericImageView;
    let (w, h) = img.dimensions();
    let scale = IMG as f32 / w.min(h) as f32;
    let nw = ((w as f32 * scale).round() as u32).max(IMG as u32);
    let nh = ((h as f32 * scale).round() as u32).max(IMG as u32);
    let resized = img.resize_exact(nw, nh, image::imageops::FilterType::CatmullRom).to_rgb8();
    let x0 = (nw - IMG as u32) / 2;
    let y0 = (nh - IMG as u32) / 2;
    let mut data = vec![0f32; 3 * IMG * IMG];
    for y in 0..IMG {
        for x in 0..IMG {
            let px = resized.get_pixel(x0 + x as u32, y0 + y as u32);
            for c in 0..3 {
                let v = (px.0[c] as f32 / 255.0 - MEAN[c]) / STD[c];
                data[c * IMG * IMG + y * IMG + x] = v;
            }
        }
    }
    data
}

/// Embedding de uma imagem (512 f32 normalizado). Reusa a sessão de visão entre chamadas.
pub fn embed_image(session: &mut Session, path: &Path) -> Result<Vec<f32>, String> {
    let img = image::open(path).map_err(|e| format!("abrir imagem: {e}"))?;
    let data = preprocess_image(&img);
    let input = Tensor::from_array(([1usize, 3, IMG, IMG], data)).map_err(|e| e.to_string())?;
    let iname = session.inputs[0].name.clone();
    let outputs = session.run(ort::inputs![iname.as_str() => input]).map_err(|e| e.to_string())?;
    pick_embed(&outputs)
}

/// Embedding de um texto de busca (512 f32 normalizado).
pub fn embed_text(enc: &mut TextEncoder, text: &str) -> Result<Vec<f32>, String> {
    let encoding = enc.tokenizer.encode(text, true).map_err(|e| e.to_string())?;
    let ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
    let len = ids.len().max(1);
    let mask: Vec<i64> = vec![1i64; len];
    let id_tensor = Tensor::from_array(([1usize, len], ids)).map_err(|e| e.to_string())?;
    let mask_tensor = Tensor::from_array(([1usize, len], mask)).map_err(|e| e.to_string())?;

    // monta os inputs por nome (input_ids + attention_mask, em qualquer ordem).
    let mut inputs: Vec<(std::borrow::Cow<str>, ort::value::Value)> = Vec::new();
    for inp in enc.session.inputs.iter() {
        let n = inp.name.clone();
        if n.contains("mask") {
            inputs.push((n.into(), mask_tensor.clone().into()));
        } else {
            inputs.push((n.into(), id_tensor.clone().into()));
        }
    }
    let outputs = enc.session.run(inputs).map_err(|e| e.to_string())?;
    pick_embed(&outputs)
}

/// Serializa/deserializa o embedding como BLOB (512 f32 little-endian).
pub fn embed_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}
pub fn blob_to_embed(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verificação real: baixa os modelos, embeda uma imagem (círculo laranja) e dois textos,
    // e confere que o texto "certo" tem cosseno MAIOR que o "errado". Ignorado (rede + ~155MB).
    #[test]
    #[ignore]
    fn clip_casa_imagem_com_texto() {
        let tmp = std::env::temp_dir().join("prisma_clip_test");
        std::fs::create_dir_all(&tmp).unwrap();
        // imagem: um grande círculo laranja em fundo branco
        let mut im = image::RgbImage::from_pixel(256, 256, image::Rgb([255, 255, 255]));
        for (x, y, p) in im.enumerate_pixels_mut() {
            let dx = x as f32 - 128.0;
            let dy = y as f32 - 128.0;
            if (dx * dx + dy * dy).sqrt() < 90.0 {
                *p = image::Rgb([240, 140, 20]);
            }
        }
        let src = tmp.join("orange.png");
        im.save(&src).unwrap();

        let mut vis = vision_session(&tmp).expect("vision");
        let img_emb = embed_image(&mut vis, &src).expect("img emb");
        assert_eq!(img_emb.len(), DIM);

        let mut enc = text_encoder(&tmp).expect("text enc");
        let good = embed_text(&mut enc, "an orange circle").expect("good");
        let bad = embed_text(&mut enc, "a snowy mountain at night").expect("bad");

        let cg = cosine(&img_emb, &good);
        let cb = cosine(&img_emb, &bad);
        println!("cos(good)={cg:.3} cos(bad)={cb:.3}");
        assert!(cg > cb, "o texto certo deveria casar melhor: good={cg} bad={cb}");
    }
}
