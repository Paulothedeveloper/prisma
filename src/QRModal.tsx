import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { generateQr, revealInExplorer } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

// Gerador de QR Code (plugin do Eagle) — nativo. Digita um link/texto, gera o PNG (catalogado
// no Inbox) e mostra na hora. Módulo grande = QR mais nítido. Não-destrutivo.
export function QRModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { closing, dismiss } = useDismiss(onClose);
  const [text, setText] = useState("");
  const [scale, setScale] = useState(10);
  const [busy, setBusy] = useState(false);
  const [outPath, setOutPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const gen = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await generateQr(text.trim(), scale);
      setOutPath(p);
      onSaved();
    } catch (e) {
      setErr(String(e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`qr-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="layoutGrid" size={16} /> {t("qr.title")}
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="qr-body">
          <input
            className="qr-input"
            placeholder={t("qr.placeholder")}
            value={text}
            autoFocus
            onChange={(e) => {
              setText(e.target.value);
              setOutPath(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void gen();
            }}
          />
          <div className="qr-size">
            <span className="qr-lbl">{t("qr.size")}</span>
            <input
              type="range"
              min={6}
              max={24}
              value={scale}
              onChange={(e) => {
                setScale(Number(e.target.value));
                setOutPath(null);
              }}
            />
          </div>

          <div className="qr-preview">
            {outPath ? (
              <img src={convertFileSrc(outPath)} className="qr-img" alt="QR" />
            ) : (
              <div className="qr-empty">
                <Icon name="layoutGrid" size={40} />
                <span>{t("qr.hint")}</span>
              </div>
            )}
          </div>
          {err && <div className="qr-err">{err}</div>}
        </div>

        <div className="dup-foot">
          {outPath && (
            <button className="dup-cancel" onClick={() => revealInExplorer(outPath).catch(() => {})}>
              <Icon name="reveal" size={14} /> {t("insp.explorer")}
            </button>
          )}
          <button className="dup-cancel" onClick={dismiss} disabled={busy}>
            {t("wma.cancel")}
          </button>
          <button className="dup-apply" onClick={gen} disabled={busy || !text.trim()}>
            {busy ? t("wma.working") : t("qr.generate")}
          </button>
        </div>
      </div>
    </div>
  );
}
