import { Icon } from "./Icons";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";
import { oficinaRun, type MediaInfo, type JobOpts } from "./api";

// Auto-conserto com confirmação (Briefing 6 §3). NÃO destrutivo: sempre gera arquivo
// novo numa subpasta; o original fica intacto. Mostra o quê / por quê / onde antes de agir.
interface FixDef {
  title: string;
  why: string;
  out: string;
  op: string;
  opts: (fps: number) => JobOpts;
}

const FIXES: Record<string, FixDef> = {
  cfr: { title: "fix.cfr.title", why: "fix.cfr.why", out: "PRONTOS CFR/", op: "vfr_cfr", opts: (fps) => ({ fps, crf: 18, codec: "h265" }) },
  banding: { title: "fix.banding.title", why: "fix.banding.why", out: "PRONTOS CFR/", op: "vfr_cfr", opts: (fps) => ({ fps, crf: 16, codec: "h265" }) },
  proxy: { title: "fix.proxy.title", why: "fix.proxy.why", out: "PROXY", op: "proxy", opts: () => ({}) },
};

export function FixConfirm({
  fix,
  path,
  info,
  onClose,
}: {
  fix: string;
  path: string;
  info: MediaInfo;
  onClose: () => void;
}) {
  const { closing, dismiss } = useDismiss(onClose);
  const def = FIXES[fix];
  if (!def) return null;
  const v = info.video;
  const fps = Math.round(v?.r_fps ?? v?.fps ?? 60);

  const run = () => {
    oficinaRun(def.op, path, def.opts(fps)).catch(() => {});
    dismiss();
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`fix-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="fix-title">
          <Icon name="sliders" size={16} /> {t(def.title)}
        </div>
        <div className="fix-why">{t(def.why)}</div>
        <div className="fix-meta">
          <div>
            <span className="fix-meta-k">{t("fix.out")}</span>
            <span className="fix-meta-v">{def.out}</span>
          </div>
          <div>
            <span className="fix-meta-k">{t("fix.original")}</span>
            <span className="fix-meta-v">{t("fix.originalVal")}</span>
          </div>
          {def.op === "vfr_cfr" && (
            <div>
              <span className="fix-meta-k">{t("fix.fps")}</span>
              <span className="fix-meta-v">{fps}</span>
            </div>
          )}
        </div>
        <div className="fix-actions">
          <button className="fix-cancel" onClick={dismiss}>
            {t("common.cancel")}
          </button>
          <button className="fix-go" onClick={run}>
            {t("fix.confirm")}
          </button>
        </div>
        <div className="fix-foot">{t("fix.foot")}</div>
      </div>
    </div>
  );
}
