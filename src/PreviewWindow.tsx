import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { VideoPlayer } from "./VideoPlayer";
import { probeMedia, openExternal, revealInExplorer } from "./api";
import { Icon } from "./Icons";
import { t } from "./i18n";
import "./App.css";

// Janela própria (multi-window) pra ver/comparar um asset lado a lado.
export function PreviewWindow() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") || "";
  const type = params.get("type") || "";
  const name = params.get("name") || "";
  const url = convertFileSrc(path);
  const [fps, setFps] = useState(30);
  // tenta tocar o original direto; só cai pra mensagem se o <video> falhar DE VERDADE.
  const [err, setErr] = useState(false);

  useEffect(() => {
    document.title = name || "PRISMA";
    setErr(false);
    if (type !== "video") return;
    // só pra saber o fps (a decisão de tocar é pelo onError real, não pelo codec).
    probeMedia(path)
      .then((info) => {
        if (info.video?.fps) setFps(info.video.fps);
      })
      .catch(() => {});
  }, [path, type, name]);

  return (
    <div className="pwin">
      {type === "video" ? (
        !err ? (
          <VideoPlayer src={url} fps={fps} onError={() => setErr(true)} />
        ) : (
          <div className="pwin-msg">
            {t("prev.codecUnsupported")}
            <button
              className="preview-openext"
              style={{ marginTop: 12 }}
              onClick={() => openExternal(path).catch(() => revealInExplorer(path))}
            >
              <Icon name="play" size={15} /> {t("prev.openExternal")}
            </button>
          </div>
        )
      ) : type === "audio" ? (
        <audio src={url} controls autoPlay />
      ) : (
        <img src={url} className="pwin-img" alt="" />
      )}
    </div>
  );
}
