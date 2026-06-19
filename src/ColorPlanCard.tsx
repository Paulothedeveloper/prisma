import { useState } from "react";
import { Icon } from "./Icons";
import { colorPlan, type ColorPlanOut } from "./api";

// Plano de Color sob medida (Briefing 6 §4). Sob DEMANDA (custa 1 chamada de IA).
// O técnico (CST + selos) já aparece offline acima; aqui a IA monta/explica o plano
// usando o vault e cita a nota-fonte.
export function ColorPlanCard({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ColorPlanOut | null>(null);

  const gen = async () => {
    setBusy(true);
    setRes(null);
    try {
      setRes(await colorPlan(path));
    } catch (e) {
      setRes({ ok: false, plan: "", sources: [], note: `Erro: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plan">
      <div className="plan-head">
        <span>PLANO DE COLOR (IA + vault)</span>
        <button className="plan-gen" onClick={gen} disabled={busy}>
          <Icon name="sliders" size={12} /> {busy ? "Montando…" : res ? "Refazer" : "Gerar plano"}
        </button>
      </div>
      {res && (
        <>
          {res.ok ? (
            <div className="plan-body">{res.plan}</div>
          ) : (
            <div className="plan-note">{res.note}</div>
          )}
          {res.sources.length > 0 && (
            <div className="plan-sources">
              <Icon name="document" size={11} /> Fonte: {res.sources.join(" · ")}
            </div>
          )}
        </>
      )}
      {!res && !busy && (
        <div className="plan-hint">
          Monta o caminho de color pra este clipe (CST, método de nós, exposição, LUT) com base no seu vault.
        </div>
      )}
    </div>
  );
}
