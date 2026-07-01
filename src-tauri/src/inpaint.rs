//! Remover marca d'água / AI Eraser (nativo do PRISMA) — inpainting por DIFUSÃO em Rust puro.
//!
//! O usuário PINTA a região da marca d'água (pincel na UI) → vem como máscara PNG (claro = remover).
//! Preenchemos os pixels marcados difundindo as cores da vizinhança (inpainting harmônico,
//! Gauss-Seidel). Sem modelo pesado, sem DLL, sem rede. Não-destrutivo: escreve um PNG novo.
//! Ótimo pra marcas finas/texto/logo sobre áreas razoavelmente uniformes. (Upgrade futuro: LaMa.)

use image::GenericImageView;
use std::path::{Path, PathBuf};

/// Preenche a área marcada. `mask_png`: PNG onde pixel CLARO (>40) = remover.
pub fn inpaint(dest_dir: &Path, input: &Path, mask_png: &[u8]) -> Result<PathBuf, String> {
    let img = image::open(input).map_err(|e| format!("abrir imagem: {e}"))?;
    let (w, h) = img.dimensions();
    let wi = w as usize;
    let hi = h as usize;
    let mut rgb = img.to_rgb8();

    // máscara (redimensionada pro tamanho da imagem)
    let m = image::load_from_memory(mask_png).map_err(|e| format!("máscara: {e}"))?;
    let m = image::imageops::resize(&m.to_luma8(), w, h, image::imageops::FilterType::Triangle);
    let mut masked = vec![false; wi * hi];
    let (mut x0, mut y0, mut x1, mut y1) = (wi, hi, 0usize, 0usize);
    let mut any = false;
    for y in 0..hi {
        for x in 0..wi {
            if m.get_pixel(x as u32, y as u32).0[0] > 40 {
                masked[y * wi + x] = true;
                any = true;
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if !any {
        return Err("nenhuma área marcada pra remover".into());
    }
    // bounding-box + margem (só itera onde importa → rápido mesmo em imagem grande)
    let margin = 24usize;
    let bx0 = x0.saturating_sub(margin);
    let by0 = y0.saturating_sub(margin);
    let bx1 = (x1 + margin).min(wi - 1);
    let by1 = (y1 + margin).min(hi - 1);

    // canais em f32
    let mut ch = [
        vec![0f32; wi * hi],
        vec![0f32; wi * hi],
        vec![0f32; wi * hi],
    ];
    let mut mean = [0f64; 3];
    let mut cnt = 0f64;
    for y in 0..hi {
        for x in 0..wi {
            let i = y * wi + x;
            let p = rgb.get_pixel(x as u32, y as u32).0;
            for c in 0..3 {
                ch[c][i] = p[c] as f32;
            }
            if !masked[i] {
                for c in 0..3 {
                    mean[c] += p[c] as f64;
                }
                cnt += 1.0;
            }
        }
    }
    // seed dos pixels marcados = média da imagem (acelera a convergência)
    if cnt > 0.0 {
        let seed = [
            (mean[0] / cnt) as f32,
            (mean[1] / cnt) as f32,
            (mean[2] / cnt) as f32,
        ];
        for i in 0..wi * hi {
            if masked[i] {
                for c in 0..3 {
                    ch[c][i] = seed[c];
                }
            }
        }
    }

    // Gauss-Seidel: cada pixel marcado vira a média dos 4 vizinhos. Só dentro do bbox.
    let iters = 600usize;
    for _ in 0..iters {
        for y in by0..=by1 {
            for x in bx0..=bx1 {
                let i = y * wi + x;
                if !masked[i] {
                    continue;
                }
                for c in 0..3 {
                    let mut sum = 0f32;
                    let mut n = 0f32;
                    if x > 0 {
                        sum += ch[c][i - 1];
                        n += 1.0;
                    }
                    if x + 1 < wi {
                        sum += ch[c][i + 1];
                        n += 1.0;
                    }
                    if y > 0 {
                        sum += ch[c][i - wi];
                        n += 1.0;
                    }
                    if y + 1 < hi {
                        sum += ch[c][i + wi];
                        n += 1.0;
                    }
                    if n > 0.0 {
                        ch[c][i] = sum / n;
                    }
                }
            }
        }
    }

    for y in by0..=by1 {
        for x in bx0..=bx1 {
            let i = y * wi + x;
            if masked[i] {
                rgb.put_pixel(
                    x as u32,
                    y as u32,
                    image::Rgb([
                        ch[0][i].round().clamp(0.0, 255.0) as u8,
                        ch[1][i].round().clamp(0.0, 255.0) as u8,
                        ch[2][i].round().clamp(0.0, 255.0) as u8,
                    ]),
                );
            }
        }
    }

    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "imagem".into());
    let mut out = dest_dir.join(format!("{stem}_semmarca.png"));
    let mut n = 1;
    while out.exists() {
        out = dest_dir.join(format!("{stem}_semmarca_{n}.png"));
        n += 1;
    }
    rgb.save(&out).map_err(|e| format!("salvar: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Prova REAL: imagem de fundo cinza uniforme com uma "marca d'água" (quadrado branco).
    // Marca a região do quadrado e confere que, depois, ela voltou a ~cinza do fundo.
    #[test]
    fn remove_marca_preenche_com_o_fundo() {
        let (w, h) = (100u32, 100u32);
        let bg = [128u8, 130, 132];
        let mut img = image::RgbImage::new(w, h);
        for (_, _, p) in img.enumerate_pixels_mut() {
            *p = image::Rgb(bg);
        }
        // marca d'água: quadrado branco 30..70
        for y in 30..70 {
            for x in 30..70 {
                img.put_pixel(x, y, image::Rgb([255, 255, 255]));
            }
        }
        let tmp = std::env::temp_dir().join("prisma_inpaint_test");
        std::fs::create_dir_all(&tmp).unwrap();
        let src = tmp.join("marca.png");
        img.save(&src).unwrap();
        // máscara: branco no quadrado, preto no resto
        let mut mask = image::GrayImage::new(w, h);
        for y in 30..70 {
            for x in 30..70 {
                mask.put_pixel(x, y, image::Luma([255]));
            }
        }
        let mut mbuf: Vec<u8> = Vec::new();
        image::DynamicImage::ImageLuma8(mask)
            .write_to(&mut std::io::Cursor::new(&mut mbuf), image::ImageFormat::Png)
            .unwrap();

        let out = inpaint(&tmp, &src, &mbuf).unwrap();
        let res = image::open(&out).unwrap().to_rgb8();
        // centro do quadrado deve ter voltado a ~cinza do fundo (não mais branco)
        let c = res.get_pixel(50, 50).0;
        assert!(
            (c[0] as i32 - bg[0] as i32).abs() < 20
                && (c[1] as i32 - bg[1] as i32).abs() < 20
                && (c[2] as i32 - bg[2] as i32).abs() < 20,
            "centro ainda não é fundo: {:?} (esperado ~{:?})",
            c,
            bg
        );
    }
}
