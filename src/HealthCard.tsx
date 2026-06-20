import { useState } from "react";
import { t } from "./i18n";
import type { MediaInfo, HealthFinding } from "./api";

// Traduz label/detail pela chave (com fallback pro texto PT do backend) + interpola {x}.
function label(h: HealthFinding): string {
  const tr = t(`health.${h.key}.label`);
  const s = tr === `health.${h.key}.label` ? h.label : tr;
  return h.arg ? s.replace("{x}", h.arg) : s;
}
function detail(h: HealthFinding): string {
  const tr = t(`health.${h.key}.detail`);
  const s = tr === `health.${h.key}.detail` ? h.detail : tr;
  return h.arg ? s.replace("{x}", h.arg) : s;
}

// Selos de saúde (diagnóstico determinístico — Briefing 6 §2). Clique no selo abre o
// detalhe; quando há conserto e onFix é passado, mostra o botão "Consertar".
export function HealthCard({ info, onFix }: { info: MediaInfo; onFix?: (fix: string) => void }) {
  const h = info.health;
  const [open, setOpen] = useState<number | null>(null);
  if (!h || h.length === 0) return null;
  return (
    <div className="health">
      <div className="health-head">{t("health.header")}</div>
      <div className="health-chips">
        {h.map((x, i) => (
          <button
            key={i}
            className={`health-chip h-${x.level} ${open === i ? "on" : ""}`}
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className="health-dot" /> {label(x)}
          </button>
        ))}
      </div>
      {open !== null && h[open] && (
        <div className="health-detail">
          <span>{detail(h[open])}</span>
          {h[open].fix && onFix && (
            <button className="health-fix" onClick={() => onFix(h[open].fix as string)}>
              {t("health.fix")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
