import { Icon } from "./Icons";
import { useDismiss } from "./useDismiss";
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
  cfr: {
    title: "Converter pra CFR",
    why: "Frame rate constante (H.265 10-bit, preserva a cor) — resolve o desync de áudio e o scrub travado no DaVinci.",
    out: "PRONTOS CFR/",
    op: "vfr_cfr",
    opts: (fps) => ({ fps, crf: 18, codec: "h265" }),
  },
  banding: {
    title: "Reencode anti-banding (CRF 16)",
    why: "Reencoda com mais bitrate (CRF 16) pra reduzir o risco de banding ao graduar material Log/HDR.",
    out: "PRONTOS CFR/",
    op: "vfr_cfr",
    opts: (fps) => ({ fps, crf: 16, codec: "h265" }),
  },
  proxy: {
    title: "Gerar proxy pra editar",
    why: "Cria um proxy leve (H.264 1080p) pra timeline fluida em codec pesado. Liga ao original automaticamente.",
    out: "cache de proxies do app",
    op: "proxy",
    opts: () => ({}),
  },
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
          <Icon name="sliders" size={16} /> {def.title}
        </div>
        <div className="fix-why">{def.why}</div>
        <div className="fix-meta">
          <div>
            <span className="fix-meta-k">Saída</span>
            <span className="fix-meta-v">{def.out}</span>
          </div>
          <div>
            <span className="fix-meta-k">Original</span>
            <span className="fix-meta-v">intacto — não é tocado</span>
          </div>
          {def.op === "vfr_cfr" && (
            <div>
              <span className="fix-meta-k">FPS alvo</span>
              <span className="fix-meta-v">{fps}</span>
            </div>
          )}
        </div>
        <div className="fix-actions">
          <button className="fix-cancel" onClick={dismiss}>
            Cancelar
          </button>
          <button className="fix-go" onClick={run}>
            Confirmar e converter
          </button>
        </div>
        <div className="fix-foot">Roda em segundo plano — o progresso aparece no painel de tarefas.</div>
      </div>
    </div>
  );
}
