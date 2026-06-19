import { useState } from "react";
import { PopupButton } from "./Menu";
import { Icon } from "./Icons";
import type { MediaInfo } from "./api";

// Destinos de entrega — definem a SAÍDA do nó OUT (Briefing 5 §2).
const TARGETS: { id: string; label: string; space: string; gamma: string; sdr: boolean }[] = [
  { id: "rec709", label: "Rec.709 (Web / Reels / SDR)", space: "Rec.709", gamma: "Gamma 2.4", sdr: true },
  { id: "hlg", label: "HDR HLG (YouTube/broadcast)", space: "Rec.2100 HLG", gamma: "Rec.2100 HLG", sdr: false },
  { id: "pq", label: "HDR PQ (streaming/cinema)", space: "Rec.2100 ST2084 (PQ)", gamma: "ST.2084 (PQ)", sdr: false },
  { id: "dcip3", label: "Cinema DCP (DCI-P3)", space: "DCI-P3", gamma: "Gamma 2.6", sdr: false },
];

interface Node {
  ee: string; // Espaço de Entrada
  ge: string; // Gama de Entrada
  es: string; // Espaço de Saída
  gs: string; // Gama de Saída
  tone: string; // Mapeamento de Tom
  gamut: string; // Mapeamento de Gamut
}

function nodeCopy(title: string, n: Node): string {
  return (
    `${title} (DaVinci → nó "Transformação do Espaço de Cor")\n` +
    `Espaço de Entrada: ${n.ee}\n` +
    `Gama de Entrada: ${n.ge}\n` +
    `Espaço de Saída: ${n.es}\n` +
    `Gama de Saída: ${n.gs}\n` +
    `Mapeamento de Tom: ${n.tone}\n` +
    `Mapeamento de Gamut: ${n.gamut}\n` +
    `Avançado: Usar Conversões HDR Padrão = marcado`
  );
}

function NodeBlock({ title, color, n }: { title: string; color: "in" | "out"; n: Node }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(nodeCopy(title, n));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const row = (k: string, v: string, strong?: boolean) => (
    <div className="cstn-row">
      <span className="cstn-k">{k}</span>
      <span className={`cstn-v mono${strong ? " cstn-strong" : ""}`}>{v}</span>
    </div>
  );
  return (
    <div className={`cstn cstn-${color}`}>
      <div className="cstn-title">
        <span className="cstn-dot" /> {title}
      </div>
      {row("Espaço de Entrada", n.ee, color === "out")}
      {row("Gama de Entrada", n.ge, color === "out")}
      {row("Espaço de Saída", n.es, color === "in")}
      {row("Gama de Saída", n.gs, color === "in")}
      {row("Mapeamento de Tom", n.tone, n.tone !== "Nenhum")}
      {row("Mapeamento de Gamut", n.gamut, n.gamut !== "Nenhum")}
      <button className="cstn-copy" onClick={copy}>
        <Icon name="copy" size={12} /> {copied ? "Copiado!" : "Copiar config do nó"}
      </button>
    </div>
  );
}

export function CstCard({ info }: { info: MediaInfo }) {
  const c = info.cst;
  const [mode, setMode] = useState<"2" | "1">("2");
  const [target, setTarget] = useState("rec709");

  // Sem CST (já é 709) ou indeterminado: card simples.
  if (!c.needs_cst) {
    return (
      <div className={`cst ${c.determinate ? "cst-ok" : "cst-warn"}`}>
        <div className="cst-head">CST RECOMENDADO</div>
        <div className="cst-noneed mono">{c.determinate ? "Sem CST — já é Rec.709" : "Indeterminado"}</div>
        <div className="cst-summary">{c.summary}</div>
      </div>
    );
  }

  const tg = TARGETS.find((t) => t.id === target) ?? TARGETS[0];
  const wide = c.needs_cst; // origem wide/log/HDR → liga tone/gamut quando vai pra SDR
  const tone = wide && tg.sdr;
  const ee = c.input_color_space ?? "(confirmar)";
  const ge = c.input_gamma ?? "(confirmar)";

  const nodeIn: Node = {
    ee, ge, es: "DaVinci Wide Gamut", gs: "DaVinci Intermediate", tone: "Nenhum", gamut: "Nenhum",
  };
  const nodeOut: Node = {
    ee: "DaVinci Wide Gamut", ge: "DaVinci Intermediate", es: tg.space, gs: tg.gamma,
    tone: tone ? "DaVinci" : "Nenhum", gamut: tone ? "Compressão de Saturação" : "Nenhum",
  };
  const oneNode: Node = {
    ee, ge, es: tg.space, gs: tg.gamma,
    tone: tone ? "DaVinci" : "Nenhum", gamut: tone ? "Compressão de Saturação" : "Nenhum",
  };

  return (
    <div className="cst cst-info">
      <div className="cst-head">
        CST RECOMENDADO
        {!c.determinate && <span className="cst-badge-warn">deduzido</span>}
      </div>

      <div className="cst-modes">
        <button className={`cst-mode ${mode === "2" ? "on" : ""}`} onClick={() => setMode("2")}>
          2 nós (graduar)
        </button>
        <button className={`cst-mode ${mode === "1" ? "on" : ""}`} onClick={() => setMode("1")}>
          1 nó (direto)
        </button>
      </div>

      {mode === "2" ? (
        <>
          <NodeBlock title="NÓ 1 — CST de ENTRADA" color="in" n={nodeIn} />
          <div className="cst-deliver">
            <span className="cst-deliver-k">Destino de entrega</span>
            <PopupButton
              value={target}
              options={TARGETS.map((t) => [t.id, t.label] as [string, string])}
              onChange={setTarget}
              placeholder="Destino"
            />
          </div>
          <NodeBlock title="NÓ FINAL — CST de SAÍDA" color="out" n={nodeOut} />
          <div className="cst-bridge">
            🌉 A <b>Saída do nó 1</b> = a <b>Entrada do nó final</b> (DaVinci Wide Gamut / Intermediate). Têm que casar.
          </div>
        </>
      ) : (
        <>
          <div className="cst-deliver">
            <span className="cst-deliver-k">Destino de entrega</span>
            <PopupButton
              value={target}
              options={TARGETS.map((t) => [t.id, t.label] as [string, string])}
              onChange={setTarget}
              placeholder="Destino"
            />
          </div>
          <NodeBlock title="NÓ ÚNICO — origem → entrega" color="out" n={oneNode} />
        </>
      )}

      <div className="cst-summary">{c.summary}</div>
    </div>
  );
}
