import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveDup, type DupPair } from "./api";
import { Icon } from "./Icons";

type Action = "exclude" | "replace" | "ignore";

const ACTION_LABEL: Record<Action, string> = {
  ignore: "Manter os dois",
  exclude: "Remover o novo",
  replace: "Substituir o antigo",
};

function thumb(path: string | null) {
  return path ? convertFileSrc(path) : null;
}

function fmtSize(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// Modal de duplicados na importação: pra cada par (já existia × recém-chegado),
// o usuário decide. "Remover o novo" e "Substituir" só tiram da biblioteca — nunca apagam do disco.
export function DupModal({ pairs, onDone }: { pairs: DupPair[]; onDone: () => void }) {
  const [decisions, setDecisions] = useState<Record<number, Action>>({});
  const [busy, setBusy] = useState(false);

  const setAll = (a: Action) => {
    const next: Record<number, Action> = {};
    for (const p of pairs) next[p.incoming.id] = a;
    setDecisions(next);
  };
  const setOne = (id: number, a: Action) =>
    setDecisions((d) => ({ ...d, [id]: a }));

  const apply = async () => {
    setBusy(true);
    try {
      for (const p of pairs) {
        const a = decisions[p.incoming.id] ?? "ignore";
        await resolveDup(p.existing.id, p.incoming.id, a);
      }
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <div className="dup-overlay" onClick={onDone}>
      <div className="dup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="dup" size={17} />
            {pairs.length} {pairs.length === 1 ? "duplicado encontrado" : "duplicados encontrados"}
          </div>
          <button className="dup-x" onClick={onDone} title="Decidir depois">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dup-sub">
          Arquivos com conteúdo idêntico ao que já está na biblioteca. Nada é apagado do disco —
          as opções só mudam o que aparece no PRISMA.
        </div>

        <div className="dup-bulk">
          <span>Aplicar a todos:</span>
          <button onClick={() => setAll("ignore")}>Manter os dois</button>
          <button onClick={() => setAll("exclude")}>Remover os novos</button>
          <button onClick={() => setAll("replace")}>Substituir os antigos</button>
        </div>

        <div className="dup-list">
          {pairs.map((p) => {
            const sel = decisions[p.incoming.id] ?? "ignore";
            return (
              <div className="dup-row" key={p.incoming.id}>
                <div className="dup-pair">
                  <DupSide label="Já na biblioteca" a={p.existing} />
                  <span className="dup-eq">=</span>
                  <DupSide label="Recém-importado" a={p.incoming} highlight />
                </div>
                <div className="dup-actions">
                  {(["ignore", "exclude", "replace"] as Action[]).map((a) => (
                    <button
                      key={a}
                      className={`dup-opt ${sel === a ? "on" : ""}`}
                      onClick={() => setOne(p.incoming.id, a)}
                    >
                      {ACTION_LABEL[a]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="dup-foot">
          <button className="dup-cancel" onClick={onDone} disabled={busy}>
            Decidir depois
          </button>
          <button className="dup-apply" onClick={apply} disabled={busy}>
            {busy ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DupSide({ label, a, highlight }: { label: string; a: DupPair["existing"]; highlight?: boolean }) {
  const t = thumb(a.thumbnail_path);
  return (
    <div className={`dup-side ${highlight ? "new" : ""}`} title={a.path}>
      <div className="dup-thumb">
        {t ? <img src={t} alt="" /> : <Icon name="unknown" size={22} />}
      </div>
      <div className="dup-meta">
        <div className="dup-side-label">{label}</div>
        <div className="dup-name">{a.filename}</div>
        <div className="dup-where">{a.path.replace(/\\[^\\]+$/, "")}</div>
        <div className="dup-size">{fmtSize(a.size)}</div>
      </div>
    </div>
  );
}
