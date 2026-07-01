import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { VideoPlayer } from "./VideoPlayer";
import { AudioPlayer } from "./AudioPlayer";
import { probeMedia, revealInExplorer, openExternal, makeProxy, type Asset } from "./api";
import { t } from "./i18n";
import { sfx } from "./sfx";

// Formatos de imagem que o WebView (Chromium) renderiza nativamente. Os demais
// (RAW, HEIC, TIFF, EXR, DPX, JXL…) mostram a miniatura em cache + abrir externo.
const WEB_IMAGE_EXTS = new Set([
  "jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "svg", "avif", "apng",
]);

interface Props {
  asset: Asset;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
  onToggleFav?: (a: Asset) => void;
}

export function Preview({ asset, onClose, onNav, onToggleFav }: Props) {
  const url = convertFileSrc(asset.path);
  const thumbUrl = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;
  const [fps, setFps] = useState(30);
  // proxy gerado SOB DEMANDA (botão "Tocar aqui") quando o original não é web e não tem proxy.
  const [madeProxy, setMadeProxy] = useState<string | null>(null);
  const [genning, setGenning] = useState(false);

  // erro REAL de decodificação do original (só então caímos pro proxy/externo)
  const [origError, setOrigError] = useState(false);

  useEffect(() => {
    setMadeProxy(null);
    setGenning(false);
    setOrigError(false);
  }, [asset.id]);

  // proxy H.264 (gerado pelo app pros codecs pro como ProRes): toca INLINE quando o original
  // não é web-compatível, em vez de obrigar o player externo. Usa o proxy já existente OU o
  // que acabamos de gerar sob demanda.
  const proxyUrl = asset.proxy_path
    ? convertFileSrc(asset.proxy_path)
    : madeProxy
      ? convertFileSrc(madeProxy)
      : null;
  const doMakeProxy = () => {
    setGenning(true);
    makeProxy(asset.id)
      .then((p) => {
        if (p) setMadeProxy(p);
      })
      .finally(() => setGenning(false));
  };

  useEffect(() => {
    if (asset.type !== "video") return;
    // Só pra saber o fps (frame-step do player). A decisão de tocar/fallback é pelo onError real.
    probeMedia(asset.path)
      .then((info) => {
        if (info.video?.fps) setFps(info.video.fps);
      })
      .catch(() => {});
  }, [asset.path, asset.type]);

  // som de abertura do preview (entra em tela cheia) — montagem
  useEffect(() => {
    sfx.open();
  }, []);

  // animação de saída: fecha com fade antes de desmontar
  const [closing, setClosing] = useState(false);
  const close = () => {
    sfx.close();
    setClosing(true);
    setTimeout(onClose, 200);
  };

  // ---- Slideshow / apresentação: avança sozinho em ciclo (ótimo pra revisar selects) ----
  const [playing, setPlaying] = useState(false);
  const [secs, setSecs] = useState(4); // intervalo por slide

  useEffect(() => {
    if (!playing) return;
    // onNav muda de identidade a cada avanço → o intervalo reinicia cheio a cada slide.
    const id = window.setInterval(() => onNav(1), secs * 1000);
    return () => window.clearInterval(id);
  }, [playing, secs, onNav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Setas navegam entre assets; o player cuida de espaço/J/K/L/frame.
      if (e.key === "Escape") {
        if (playing) setPlaying(false);
        else close();
      } else if (e.key === "ArrowRight") onNav(1);
      else if (e.key === "ArrowLeft") onNav(-1);
      else if (e.key.toLowerCase() === "p") setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNav, playing]);

  const isVideo = asset.type === "video";
  const isAudio = asset.type === "audio";
  const isImageLike = asset.type === "image" || asset.type === "gif";

  return (
    <div className={`preview-overlay ${closing ? "closing" : ""} ${playing ? "presenting" : ""}`} onClick={close}>
      <button className="prev-nav prev-left" onClick={(e) => { e.stopPropagation(); onNav(-1); }}>
        <Icon name="chevronLeft" size={26} />
      </button>
      <div key={asset.id} className="preview-stage" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          !origError ? (
            // Tenta tocar o ORIGINAL direto (autoplay). A maioria (H.264/VP9/AV1 + AAC) toca na
            // hora. Só se o <video> falhar DE VERDADE é que caímos pro proxy/externo — sem depender
            // de adivinhar codec. Toca automático, sem botão no meio.
            <VideoPlayer
              src={url}
              fps={fps}
              onError={() => {
                setOrigError(true);
                if (!proxyUrl) doMakeProxy();
              }}
            />
          ) : proxyUrl ? (
            // Original não-web (ex.: ProRes/Opus) → toca o proxy H.264 aqui dentro, automático.
            <VideoPlayer src={proxyUrl} fps={fps} />
          ) : (
            <div className="preview-unsupported">
              {thumbUrl && <img src={thumbUrl} className="preview-media" alt="" />}
              <div className="preview-vidactions">
                {genning ? (
                  <div className="preview-openext primary">
                    <span className="spin" /> {t("prev.making")}
                  </div>
                ) : (
                  <button className="preview-openext primary" onClick={doMakeProxy}>
                    <Icon name="play" size={16} /> {t("prev.playHere")}
                  </button>
                )}
              </div>
            </div>
          )
        ) : isAudio ? (
          <div className="preview-audio">
            <AudioPlayer src={url} waveform={thumbUrl} title={asset.name || asset.filename} />
          </div>
        ) : isImageLike ? (
          asset.live_motion ? (
            // Live Photo: toca o vídeo do par em tela cheia (loop, mudo), com a foto de poster.
            <div className="preview-img-wrap">
              <video
                src={convertFileSrc(asset.live_motion)}
                poster={thumbUrl ?? undefined}
                className="preview-media"
                autoPlay
                loop
                muted
                playsInline
              />
              <span className="preview-live-badge">LIVE</span>
            </div>
          ) : WEB_IMAGE_EXTS.has(asset.ext.toLowerCase()) ? (
            <div className="preview-img-wrap">
              <img src={url} className="preview-media" alt="" />
            </div>
          ) : (
            // RAW/HEIC/TIFF/EXR… → miniatura de alta qualidade do cache + abrir no app externo
            <div className="preview-unsupported">
              {thumbUrl && <img src={thumbUrl} className="preview-media" alt="" />}
              <button
                className="preview-openext"
                onClick={() => openExternal(asset.path).catch(() => revealInExplorer(asset.path))}
              >
                <Icon name="play" size={16} /> {t("prev.openExternal")}
              </button>
            </div>
          )
        ) : (
          <div className="preview-noprev">
            <div className="preview-ext">{asset.ext.toUpperCase()}</div>
            <div>{t("prev.noPreview")}</div>
          </div>
        )}
        <div className="preview-name">{asset.filename}</div>
      </div>
      <button className="prev-nav prev-right" onClick={(e) => { e.stopPropagation(); onNav(1); }}>
        <Icon name="chevronRight" size={26} />
      </button>
      {onToggleFav && (
        <button
          className={`preview-fav ${asset.favorite ? "on" : ""}`}
          title={asset.favorite ? t("card.unfavorite") : t("card.favorite")}
          onClick={(e) => { e.stopPropagation(); onToggleFav(asset); }}
        >
          <Icon name={asset.favorite ? "starFill" : "star"} size={18} />
        </button>
      )}
      {/* Barra de slideshow / apresentação */}
      <div className="slideshow-bar" onClick={(e) => e.stopPropagation()}>
        <button
          className={`ss-btn ${playing ? "on" : ""}`}
          title={playing ? t("ss.pause") : t("ss.play")}
          onClick={() => setPlaying((p) => !p)}
        >
          <Icon name={playing ? "pause" : "play"} size={16} />
          <span>{playing ? t("ss.presenting") : t("ss.slideshow")}</span>
        </button>
        <div className="ss-speeds">
          {[2, 4, 7].map((s) => (
            <button
              key={s}
              className={`ss-speed ${secs === s ? "on" : ""}`}
              onClick={() => setSecs(s)}
              title={`${s}s`}
            >
              {s}s
            </button>
          ))}
        </div>
        {/* barra de progresso do slide atual (reinicia a cada avanço via key) */}
        {playing && <div key={asset.id} className="ss-progress" style={{ animationDuration: `${secs}s` }} />}
      </div>
      {(isVideo || isAudio) && (
        <button
          className="preview-ext-corner"
          title={t("prev.openExternal")}
          onClick={(e) => {
            e.stopPropagation();
            openExternal(asset.path).catch(() => revealInExplorer(asset.path));
          }}
        >
          <Icon name="reveal" size={15} />
          <span>{t("prev.openExternal")}</span>
        </button>
      )}
      <button className="preview-close" onClick={close}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
