import { useState } from "react";
import { videoDownloadInfo, videoDownload, type DownloadInfo } from "./api";
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
  const [busy, setBusy] = useState<"" | "check" | "dl">("");
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "first"; msg: string } | null>(null);

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
    try {
      await videoDownload(url.trim(), audioOnly);
      sfx.notify?.();
      setStatus({ kind: "ok", msg: t("dl.done") });
      onDone();
      setTimeout(onClose, 900);
    } catch (e) {
      setStatus({ kind: "err", msg: `${t("dl.error")}: ${e}` });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="dup-overlay" onClick={onClose}>
      <div className="dup-modal dl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="video" size={17} />
            {t("dl.title")}
          </div>
          <button className="dup-x" onClick={onClose}>
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

        {status && <div className={`dl-status ${status.kind}`}>{status.msg}</div>}

        <div className="dl-actions">
          <button className="dl-cancel" onClick={onClose}>
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
