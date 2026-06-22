import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { VideoPlayer } from "./VideoPlayer";
import { AudioPlayer } from "./AudioPlayer";
import { probeMedia, revealInExplorer, openExternal, type Asset } from "./api";
import { t } from "./i18n";
import { sfx } from "./sfx";

const WEB_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1", "avc1"]);

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
          ) : (
            <div className="preview-unsupported">
              {thumbUrl && <img src={thumbUrl} className="preview-media" alt="" />}
              {playable === false && (
                <button
                  className="preview-openext"
                  onClick={() => openExternal(asset.path).catch(() => revealInExplorer(asset.path))}
                >
                  <Icon name="play" size={16} /> {t("prev.openExternal")}
                </button>
              )}
            </div>
          )
        ) : isAudio ? (
          <div className="preview-audio">
            <AudioPlayer src={url} waveform={thumbUrl} title={asset.name || asset.filename} />
          </div>
        ) : isImageLike ? (
          <div className="preview-img-wrap">
            <img src={url} className="preview-media" alt="" />
          </div>
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
