import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { VideoPlayer } from "./VideoPlayer";
import { probeMedia } from "./api";
import { t } from "./i18n";
import "./App.css";

const WEB_VIDEO = new Set(["h264", "vp8", "vp9", "av1", "avc1"]);

// Janela própria (multi-window) pra ver/comparar um asset lado a lado.
export function PreviewWindow() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") || "";
  const type = params.get("type") || "";
  const name = params.get("name") || "";
  const url = convertFileSrc(path);
  const [fps, setFps] = useState(30);
  const [playable, setPlayable] = useState<boolean | null>(type === "video" ? null : true);

  useEffect(() => {
    document.title = name || "PRISMA";
    if (type !== "video") return;
    probeMedia(path)
      .then((info) => {
        const c = info.video?.codec?.toLowerCase();
        setPlayable(!!c && WEB_VIDEO.has(c));
        if (info.video?.fps) setFps(info.video.fps);
      })
      .catch(() => setPlayable(false));
  }, [path, type, name]);

  return (
    <div className="pwin">
      {type === "video" ? (
        playable === false ? (
          <div className="pwin-msg">{t("prev.codecUnsupported")}</div>
        ) : playable ? (
          <VideoPlayer src={url} fps={fps} />
        ) : (
          <div className="pwin-msg">{t("prev.loading")}</div>
        )
      ) : type === "audio" ? (
        <audio src={url} controls autoPlay />
      ) : (
        <img src={url} className="pwin-img" alt="" />
      )}
    </div>
  );
}
