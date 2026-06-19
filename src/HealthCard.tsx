import { useState } from "react";
import type { MediaInfo } from "./api";

// Selos de saúde (diagnóstico determinístico — Briefing 6 §2). Clique no selo abre o
// detalhe; quando há conserto e onFix é passado, mostra o botão "Consertar".
export function HealthCard({ info, onFix }: { info: MediaInfo; onFix?: (fix: string) => void }) {
  const h = info.health;
  const [open, setOpen] = useState<number | null>(null);
  if (!h || h.length === 0) return null;
  return (
    <div className="health">
      <div className="health-head">SAÚDE DO ARQUIVO</div>
      <div className="health-chips">
        {h.map((x, i) => (
          <button
            key={i}
            className={`health-chip h-${x.level} ${open === i ? "on" : ""}`}
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span className="health-dot" /> {x.label}
          </button>
        ))}
      </div>
      {open !== null && h[open] && (
        <div className="health-detail">
          <span>{h[open].detail}</span>
          {h[open].fix && onFix && (
            <button className="health-fix" onClick={() => onFix(h[open].fix as string)}>
              Consertar agora
            </button>
          )}
        </div>
      )}
    </div>
  );
}
