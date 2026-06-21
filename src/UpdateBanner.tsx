import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Icon } from "./Icons";
import { Logo } from "./Logo";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";
import { sfx } from "./sfx";

// Atualizador in-app (igual ao Ludex): checa o GitHub no boot, mostra um popup, e
// baixa+instala+reinicia por botão — sem o usuário baixar nada manualmente.
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  const { closing, dismiss } = useDismiss(() => setUpdate(null));

  useEffect(() => {
    // pequena espera pra não competir com o boot/splash
    const id = window.setTimeout(() => {
      check()
        .then((u) => {
          if (u) {
            setUpdate(u);
            sfx.notify(); // notificação quando há atualização disponível
          }
        })
        .catch((e) => console.warn("update check", e));
    }, 2500);
    return () => window.clearTimeout(id);
  }, []);

  if (!update) return null;

  const install = async () => {
    setInstalling(true);
    setErr("");
    try {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength || 0;
        if (ev.event === "Progress") {
          done += ev.data.chunkLength || 0;
          setPct(total ? Math.round((done / total) * 100) : 0);
        }
      });
      await relaunch();
    } catch (e) {
      setErr(`${t("update.failed")}: ${String(e)}`);
      setInstalling(false);
    }
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={() => !installing && dismiss()}>
      <div className={`update-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="update-logo">
          <Logo size={52} />
        </div>
        <div className="update-title">
          {t("update.available")} <span className="update-ver">v{update.version}</span>
        </div>
        <div className="update-sub">{t("update.sub")}</div>

        {update.body && <div className="update-notes">{update.body}</div>}

        {installing ? (
          <div className="update-progress">
            <div className="update-bar">
              <div className="update-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="update-progress-txt">
              {t("update.installing")} {pct}% · {t("update.restart")}
            </div>
          </div>
        ) : (
          <>
            {err && <div className="update-err">{err}</div>}
            <div className="update-actions">
              <button className="update-later" onClick={dismiss}>
                {t("update.later")}
              </button>
              <button className="update-go" onClick={install}>
                <Icon name="refresh" size={14} /> {t("update.now")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
