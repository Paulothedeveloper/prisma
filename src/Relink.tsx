import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icons";
import { relinkRoot, relinkSearch, type OfflineRoot, type RelinkResult } from "./api";
import { t } from "./i18n";

// Painel de RELINK (estilo DaVinci Resolve): lista as raízes offline e, pra cada uma, deixa o
// usuário (1) apontar PRA ONDE a pasta foi (remapeia mantendo a subestrutura) ou (2) pedir uma
// BUSCA AUTOMÁTICA numa pasta (casa por nome + tamanho). Os dois são opcionais, por raiz.
export function Relink({
  roots,
  onClose,
  onDone,
}: {
  roots: OfflineRoot[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, RelinkResult>>({});

  const folderName = (p: string) => {
    const cleaned = p.replace(/[\\/]+$/, "");
    const seg = cleaned.split(/[\\/]/).pop();
    return seg && seg.length ? seg : cleaned;
  };

  const doManual = async (root: string) => {
    const sel = await openDialog({ directory: true, multiple: false, title: t("relink.pickNew") });
    if (typeof sel !== "string") return;
    setBusy(root);
    try {
      const r = await relinkRoot(root, sel);
      setResult((m) => ({ ...m, [root]: r }));
      onDone();
    } catch (e) {
      window.alert(`${t("common.error")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doAuto = async (root: string) => {
    const sel = await openDialog({ directory: true, multiple: false, title: t("relink.pickSearch") });
    if (typeof sel !== "string") return;
    setBusy(root);
    try {
      const r = await relinkSearch(root, sel);
      setResult((m) => ({ ...m, [root]: r }));
      onDone();
    } catch (e) {
      window.alert(`${t("common.error")}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dup-overlay" onClick={onClose}>
      <div className="pref-modal relink-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="reveal" size={16} /> {t("relink.title")}
          </div>
          <button className="dup-x" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>
        <p className="relink-help">{t("relink.help")}</p>
        <div className="relink-list">
          {roots.length === 0 ? (
            <div className="relink-empty">{t("relink.none")}</div>
          ) : (
            roots.map((r) => {
              const res = result[r.root];
              const done = res && res.missing === 0;
              return (
                <div key={r.root} className={`relink-item${done ? " done" : ""}`}>
                  <div className="relink-info">
                    <span className="relink-badge"><Icon name="eyeOff" size={12} /> OFFLINE</span>
                    <span className="relink-name" title={r.root}>{folderName(r.root)}</span>
                    <span className="relink-path" title={r.root}>{r.root}</span>
                    <span className="relink-count">{r.count} {t("relink.items")}</span>
                  </div>
                  <div className="relink-actions">
                    {res && (
                      <span className={`relink-result${done ? " ok" : ""}`}>
                        {t("relink.result")
                          .replace("{r}", String(res.relinked))
                          .replace("{m}", String(res.missing))}
                      </span>
                    )}
                    <button className="set-bulk-btn" disabled={busy === r.root} onClick={() => doManual(r.root)}>
                      <Icon name="folder" size={13} /> {t("relink.locate")}
                    </button>
                    <button className="set-bulk-btn" disabled={busy === r.root} onClick={() => doAuto(r.root)}>
                      {busy === r.root ? <span className="sync-spin" /> : <Icon name="search" size={13} />} {t("relink.auto")}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
