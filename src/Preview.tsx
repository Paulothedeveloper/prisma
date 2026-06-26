import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { VideoPlayer } from "./VideoPlayer";
import { AudioPlayer } from "./AudioPlayer";
import { probeMedia, revealInExplorer, openExternal, makeProxy, type Asset } from "./api";
import { t } from "./i18n";
import { sfx } from "./sfx";

const WEB_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1", "avc1"]);
// Formatos de imagem que o WebView (Chromium) renderiza nativamente. Os demais
// (RAW, HEIC, TIFF, EXR, DPX, JXL…) mostram a miniatura em cache + abrir externo.
const WEB_IMAGE_EXTS = new Set([
  "jpg", "jpeg", "jfif", "png", "gif", "webp", "bmp", "svg", "avif", "apng",
]);

interface Props {
  asset: Asset;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
}

export function Preview({ asset, onClose, onNav }: Props) {
  const url = convertFileSrc(asset.path);
  const thumbUrl = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;
  // null = ainda checando; evita tela cinza antes de saber o codec
  const [playable, setPlayable] = useState<boolean | null>(null);
  const [fps, setFps] = useState(30);
  const [rot, setRot] = useState(0);
  // proxy gerado SOB DEMANDA (botão "Tocar aqui") quando o original não é web e não tem proxy.
  const [madeProxy, setMadeProxy] = useState<string | null>(null);
  const [genning, setGenning] = useState(false);

  useEffect(() => {
    setMadeProxy(null);
    setGenning(false);
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
    setPlayable(null);
    setRot(0);
    probeMedia(asset.path)
      .then((info) => {
        const c = info.video?.codec?.toLowerCase();
        setPlayable(!!c && WEB_VIDEO_CODECS.has(c));
        if (info.video?.fps) setFps(info.video.fps);
        setRot(info.video?.rotation ?? 0);
      })
      .catch(() => setPlayable(false));
  }, [asset.path, asset.type]);

  // proporção real (considera rotação) → o box do preview assume o formato do vídeo
  const rotated = rot === 90 || rot === 270;
  const ew = asset.width ?? 16;
  const eh = asset.height ?? 9;
  const aspect =
    asset.width && asset.height
      ? `${rotated ? eh : ew} / ${rotated ? ew : eh}`
      : undefined;

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Setas navegam entre assets; o player cuida de espaço/J/K/L/frame.
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") onNav(1);
      else if (e.key === "ArrowLeft") onNav(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNav]);

  const isVideo = asset.type === "video";
  const isAudio = asset.type === "audio";
  const isImageLike = asset.type === "image" || asset.type === "gif";

  return (
    <div className={`preview-overlay ${closing ? "closing" : ""}`} onClick={close}>
      <button className="prev-nav prev-left" onClick={(e) => { e.stopPropagation(); onNav(-1); }}>
        <Icon name="chevronLeft" size={26} />
      </button>
      <div className="preview-stage" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          playable === true ? (
            <VideoPlayer src={url} fps={fps} aspect={aspect} />
          ) : playable === false && proxyUrl ? (
            // Original não-web (ex.: ProRes) MAS tem proxy → toca o proxy aqui dentro.
            <VideoPlayer src={proxyUrl} fps={fps} aspect={aspect} />
          ) : (
            <div className="preview-unsupported">
              {thumbUrl && <img src={thumbUrl} className="preview-media" alt="" />}
              {playable === false && (
                <div className="preview-vidactions">
                  {/* Tocar AQUI dentro: gera o proxy H.264 na hora (codec pro não toca no WebView).
                      O player externo vira OPCIONAL. */}
                  <button className="preview-openext primary" onClick={doMakeProxy} disabled={genning}>
                    {genning ? (
                      <>
                        <span className="spin" /> {t("prev.making")}
                      </>
                    ) : (
                      <>
                        <Icon name="play" size={16} /> {t("prev.playHere")}
                      </>
                    )}
                  </button>
                  <button
                    className="preview-openext"
                    onClick={() => openExternal(asset.path).catch(() => revealInExplorer(asset.path))}
                  >
                    {t("prev.openExternal")}
                  </button>
                </div>
              )}
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
      <button className="preview-close" onClick={close}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
