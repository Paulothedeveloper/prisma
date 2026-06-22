//! Export pro NLE: gera FCPXML (DaVinci Resolve / Final Cut Pro) referenciando os clipes
//! selecionados como um event/bin. NÃO-DESTRUTIVO — só escreve um .fcpxml novo, apontando
//! pros arquivos ORIGINAIS (o NLE relinka por caminho). Resolve é o alvo principal do Paulo.

pub struct NleClip {
    pub path: String,
    pub name: String,
    pub duration: f64, // segundos
    pub fps: f64,
    pub w: i64,
    pub h: i64,
    pub kind: String, // image|video|audio|...
}

/// frameDuration racional (num, den) a partir do fps — trata as taxas NDF comuns.
fn frame_dur(fps: f64) -> (i64, i64) {
    match (fps * 1000.0).round() as i64 {
        23976 => (1001, 24000),
        24000 => (100, 2400),
        25000 => (100, 2500),
        29970 => (1001, 30000),
        30000 => (100, 3000),
        48000 => (100, 4800),
        50000 => (100, 5000),
        59940 => (1001, 60000),
        60000 => (100, 6000),
        _ => {
            let f = (fps.round() as i64).max(1);
            (100, f * 100) // 1/f
        }
    }
}

/// Caminho do SO → URL file:// com barras normais e espaços escapados.
fn file_url(path: &str) -> String {
    let p = path.replace('\\', "/");
    let enc: String = p
        .chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '#' => "%23".to_string(),
            '%' => "%25".to_string(),
            '[' => "%5B".to_string(),
            ']' => "%5D".to_string(),
            other => other.to_string(),
        })
        .collect();
    if enc.starts_with('/') {
        format!("file://{enc}")
    } else {
        format!("file:///{enc}")
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn build_fcpxml(clips: &[NleClip]) -> String {
    let mut resources = String::new();
    let mut events = String::new();
    for (i, c) in clips.iter().enumerate() {
        let rid = format!("r{}", i + 1);
        let aid = format!("a{}", i + 1);
        let is_audio = c.kind == "audio";
        let is_video = c.kind == "video";
        let fps = if c.fps > 0.0 { c.fps } else { 25.0 };
        let (num, den) = frame_dur(fps);
        let dur_sec = if c.duration > 0.0 { c.duration } else { 5.0 };
        let frames = ((dur_sec * den as f64 / num as f64).round() as i64).max(1);
        let dur = format!("{}/{}s", frames * num, den);
        let name = xml_escape(&c.name);
        let url = file_url(&c.path);

        if is_audio {
            resources.push_str(&format!(
                "    <asset id=\"{aid}\" name=\"{name}\" start=\"0s\" duration=\"{dur}\" hasAudio=\"1\" audioSources=\"1\" audioChannels=\"2\" audioRate=\"48000\">\n      <media-rep kind=\"original-media\" src=\"{url}\"/>\n    </asset>\n"
            ));
        } else {
            let w = if c.w > 0 { c.w } else { 1920 };
            let h = if c.h > 0 { c.h } else { 1080 };
            let has_audio = if is_video { "1" } else { "0" };
            resources.push_str(&format!(
                "    <format id=\"{rid}\" frameDuration=\"{num}/{den}s\" width=\"{w}\" height=\"{h}\"/>\n"
            ));
            resources.push_str(&format!(
                "    <asset id=\"{aid}\" name=\"{name}\" start=\"0s\" duration=\"{dur}\" hasVideo=\"1\" videoSources=\"1\" hasAudio=\"{has_audio}\" format=\"{rid}\">\n      <media-rep kind=\"original-media\" src=\"{url}\"/>\n    </asset>\n"
            ));
        }
        events.push_str(&format!(
            "      <asset-clip ref=\"{aid}\" name=\"{name}\" offset=\"0s\" duration=\"{dur}\" start=\"0s\"/>\n"
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE fcpxml>\n<fcpxml version=\"1.9\">\n  <resources>\n{resources}  </resources>\n  <library>\n    <event name=\"PRISMA Export\">\n{events}    </event>\n  </library>\n</fcpxml>\n"
    )
}
