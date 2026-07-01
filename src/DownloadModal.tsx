import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { videoDownloadInfo, videoDownload, revealInExplorer, type DownloadInfo } from "./api";
import { Icon } from "./Icons";
import { t } from "./i18n";
import { sfx } from "./sfx";

// Video Downloader nativo (motor yt-dlp embutido/baixado sob demanda). Porta do plugin
// "Video Downloader" do Eagle: cola o link, escolhe vídeo ou só áudio, e cai catalogado.
export function DownloadModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<DownloadInfo | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [quality, setQuality] = useState("best"); // best | 1080 | 720 | 480
  const [busy, setBusy] = useState<"" | "check" | "dl">("");
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "first"; msg: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null); // % do download em tempo real
  const [savedPath, setSavedPath] = useState<string | null>(null);

  // barra de progresso: escuta o evento do backend (yt-dlp streaming)
  useEffect(() => {
    const un = listen<number>("download:progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Não fecha enquanto o download está rodando (evita interromper o yt-dlp no meio). Esc fecha
  // só quando não está baixando.
  const guardClose = () => {
    if (busy !== "dl") onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy !== "dl") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtDur = (s: number | null) => {
    if (!s) return "";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  const check = async () => {
    if (!url.trim()) return;
    setBusy("check");
    setStatus({ kind: "first", msg: t("dl.firstRun") });
    setInfo(null);
    try {
      const i = await videoDownloadInfo(url.trim());
      setInfo(i);
      setStatus(null);
    } catch (e) {
      setStatus({ kind: "err", msg: `${t("dl.error")}: ${e}` });
    } finally {
      setBusy("");
    }
  };

  const download = async () => {
    if (!url.trim()) return;
    sfx.tap();
    setBusy("dl");
    setStatus(null);
    setProgress(0);
    setSavedPath(null);
    try {
      const path = await videoDownload(url.trim(), audioOnly, quality);
      sfx.notify?.();
      setProgress(100);
      setSavedPath(path);
      setStatus({ kind: "ok", msg: t("dl.done") });
      onDone();
      // não fecha sozinho — o usuário vê onde salvou e pode abrir a pasta
    } catch (e) {
      setProgress(null);
      setStatus({ kind: "err", msg: `${t("dl.error")}: ${e}` });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="dup-overlay" onClick={guardClose}>
      <div className="dup-modal dl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="video" size={17} />
            {t("dl.title")}
          </div>
          <button className="dup-x" onClick={guardClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="dl-row">
          <input
            className="dl-input"
            placeholder={t("dl.placeholder")}
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
          />
          <button className="dl-check" disabled={!url.trim() || busy !== ""} onClick={check}>
            {busy === "check" ? <span className="spin" /> : t("dl.fetch")}
          </button>
        </div>

        {info && (
          <div className="dl-info">
            {info.thumbnail && <img src={info.thumbnail} alt="" />}
            <div className="dl-meta">
              <div className="dl-vtitle">{info.title}</div>
              <div className="dl-vsub">
                {info.uploader}
                {info.duration ? ` · ${fmtDur(info.duration)}` : ""}
              </div>
            </div>
          </div>
        )}

        <div className="dl-kind">
          <button className={`dl-kbtn ${!audioOnly ? "on" : ""}`} onClick={() => setAudioOnly(false)}>
            <Icon name="video" size={14} /> {t("dl.video")}
          </button>
          <button className={`dl-kbtn ${audioOnly ? "on" : ""}`} onClick={() => setAudioOnly(true)}>
            <Icon name="audio" size={14} /> {t("dl.audio")}
          </button>
        </div>

        {/* Qualidade — só pra vídeo. "Melhor" pega o máximo (4K/1080…); os demais limitam a altura. */}
        {!audioOnly && (
          <div className="dl-quality">
            <span className="dl-qlabel">{t("dl.quality")}</span>
            {[
              ["best", t("dl.qBest")],
              ["1080", "1080p"],
              ["720", "720p"],
              ["480", "480p"],
            ].map(([q, label]) => (
              <button
                key={q}
                className={`dl-qbtn ${quality === q ? "on" : ""}`}
                onClick={() => setQuality(q)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Barra de progresso do download (tempo real) */}
        {busy === "dl" && progress !== null && (
          <div className="dl-progress">
            <div className="dl-progbar">
              <div className="dl-progfill" style={{ width: `${Math.max(2, progress)}%` }} />
            </div>
            <span className="dl-progpct">{Math.round(progress)}%</span>
          </div>
        )}

        {status && <div className={`dl-status ${status.kind}`}>{status.msg}</div>}

        {/* Onde salvou + abrir a pasta */}
        {savedPath && (
          <div className="dl-saved">
            <div className="dl-savedpath" title={savedPath}>
              <Icon name="folder" size={12} /> {savedPath}
            </div>
            <button className="dl-reveal" onClick={() => revealInExplorer(savedPath)}>
              <Icon name="folder" size={12} /> {t("dl.openFolder")}
            </button>
          </div>
        )}

        <div className="dl-actions">
          <button className="dl-cancel" onClick={guardClose} disabled={busy === "dl"}>
            {t("dl.close")}
          </button>
          <button className="btn-primary" disabled={!url.trim() || busy !== ""} onClick={download}>
            {busy === "dl" ? (
              <>
                <span className="spin" /> {t("dl.downloading")}
              </>
            ) : (
              <>
                <Icon name="inbox" size={14} /> {t("dl.download")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
