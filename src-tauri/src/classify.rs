//! Classificacao de arquivos por extensao.
//! Regra de ouro do briefing: NUNCA recusar um arquivo. Extensao desconhecida
//! ainda entra na biblioteca como "unknown".

/// Categorias de asset. Strings batem com o que o frontend espera.
pub fn categorize(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        // Imagens (com e sem alpha tratadas igual na grade; alpha vira flag visual depois)
        "jpg" | "jpeg" | "png" | "tiff" | "tif" | "webp" | "heic" | "heif" | "bmp" | "tga"
        | "jfif" | "avif" | "exr" | "dpx" => "image",
        // GIF / animacao
        "gif" | "apng" => "gif",
        // Video
        "mp4" | "mov" | "mxf" | "avi" | "mkv" | "braw" | "r3d" | "webm" | "m4v" | "wmv"
        | "flv" | "mts" | "m2ts" | "prores" | "ts" | "3gp" => "video",
        // Audio
        "wav" | "mp3" | "aac" | "flac" | "m4a" | "ogg" | "wma" | "aiff" | "aif" | "opus" => {
            "audio"
        }
        // LUT
        "cube" | "3dl" | "dat" | "look" | "csp" | "vlt" => "lut",
        // Fonte
        "ttf" | "otf" | "woff" | "woff2" | "fnt" | "ttc" => "font",
        // Documento / projeto / 3D / pacote
        "pdf" | "psd" | "psb" | "ai" | "aep" | "prproj" | "drp" | "obj" | "fbx" | "gltf"
        | "glb" | "blend" | "c4d" | "zip" | "rar" | "7z" | "txt" | "doc" | "docx" => "document",
        // Qualquer outra coisa: ainda entra
        _ => "unknown",
    }
}

/// Tipos que o ffmpeg consegue extrair frame/metadados.
pub fn is_video(ext: &str) -> bool {
    matches!(categorize(ext), "video")
}

pub fn is_gif(ext: &str) -> bool {
    matches!(categorize(ext), "gif")
}

pub fn is_image(ext: &str) -> bool {
    matches!(categorize(ext), "image")
}

pub fn is_audio(ext: &str) -> bool {
    matches!(categorize(ext), "audio")
}
