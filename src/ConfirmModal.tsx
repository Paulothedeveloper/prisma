import { useEffect } from "react";
import { Icon } from "./Icons";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";
import { sfx } from "./sfx";

// Confirmação PRÓPRIA do app (animada + SFX) — substitui o window.confirm, que é
// não-confiável no WebView do Tauri (às vezes não aparece e cancela em silêncio).
export interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmModal({ opts, onClose }: { opts: ConfirmOpts; onClose: () => void }) {
  const { closing, dismiss } = useDismiss(onClose);

  useEffect(() => {
    sfx.open();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      if (e.key === "Enter") {
        sfx.tap();
        opts.onConfirm();
        dismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div
        className={`dup-modal confirm-modal${closing ? " closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`confirm-icon ${opts.danger ? "danger" : ""}`}>
          <Icon name={opts.danger ? "trash" : "check"} size={22} />
        </div>
        <h3 className="confirm-title">{opts.title}</h3>
        <p className="confirm-msg">{opts.message}</p>
        <div className="confirm-actions">
          <button className="confirm-cancel" onClick={dismiss}>
            {t("common.cancel")}
          </button>
          <button
            className={`confirm-ok ${opts.danger ? "danger" : ""}`}
            onClick={() => {
              sfx.tap();
              opts.onConfirm();
              dismiss();
            }}
          >
            {opts.confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
