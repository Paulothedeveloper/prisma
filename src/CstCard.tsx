import { useState } from "react";
import { PopupButton } from "./Menu";
import { Icon } from "./Icons";
import { t } from "./i18n";
import type { MediaInfo } from "./api";

// Destinos de entrega — definem a SAÍDA do nó OUT (Briefing 5 §2).
const TARGETS: { id: string; label: string; space: string; gamma: string; sdr: boolean }[] = [
  { id: "rec709", label: "Rec.709 (Web / Reels / SDR)", space: "Rec.709", gamma: "Gamma 2.4", sdr: true },
  { id: "hlg", label: "HDR HLG", space: "Rec.2100 HLG", gamma: "Rec.2100 HLG", sdr: false },
  { id: "pq", label: "HDR PQ", space: "Rec.2100 ST2084 (PQ)", gamma: "ST.2084 (PQ)", sdr: false },
  { id: "dcip3", label: "Cinema DCP (DCI-P3)", space: "DCI-P3", gamma: "Gamma 2.6", sdr: false },
];

const NONE = () => t("cst.tone.none");

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
    `${title} (DaVinci → "${t("cst.header")}")\n` +
    `${t("cst.f.inSpace")}: ${n.ee}\n` +
    `${t("cst.f.inGamma")}: ${n.ge}\n` +
    `${t("cst.f.outSpace")}: ${n.es}\n` +
    `${t("cst.f.outGamma")}: ${n.gs}\n` +
    `${t("cst.f.tone")}: ${n.tone}\n` +
    `${t("cst.f.gamut")}: ${n.gamut}\n` +
    `${t("cst.f.advanced")}: ${t("cst.f.advancedVal")}`
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
  const none = NONE();
  return (
    <div className={`cstn cstn-${color}`}>
      <div className="cstn-title">
        <span className="cstn-dot" /> {title}
      </div>
      {row(t("cst.f.inSpace"), n.ee, color === "out")}
      {row(t("cst.f.inGamma"), n.ge, color === "out")}
      {row(t("cst.f.outSpace"), n.es, color === "in")}
      {row(t("cst.f.outGamma"), n.gs, color === "in")}
      {row(t("cst.f.tone"), n.tone, n.tone !== none)}
      {row(t("cst.f.gamut"), n.gamut, n.gamut !== none)}
      {row(t("cst.f.advanced"), t("cst.f.advancedVal"))}
      {n.tone === "DaVinci" && <div className="cstn-opt">{t("cst.nitsHint")}</div>}
      <button className="cstn-copy" onClick={copy}>
        <Icon name="copy" size={12} /> {copied ? t("common.copied") : t("cst.copyNode")}
      </button>
    </div>
  );
}

export function CstCard({ info }: { info: MediaInfo }) {
  const c = info.cst;
  const [mode, setMode] = useState<"2" | "1">("2");
  const [target, setTarget] = useState("rec709");

  if (!c.needs_cst) {
    return (
      <div className={`cst ${c.determinate ? "cst-ok" : "cst-warn"}`}>
        <div className="cst-head">{t("cst.header")}</div>
        <div className="cst-noneed mono">{c.determinate ? t("cst.none") : t("cst.indeterminate")}</div>
        <div className="cst-summary">{c.summary}</div>
      </div>
    );
  }

  const tg = TARGETS.find((x) => x.id === target) ?? TARGETS[0];
  const tone = c.needs_cst && tg.sdr;
  const ee = c.input_color_space ?? "(?)";
  const ge = c.input_gamma ?? "(?)";
  const none = NONE();
  const compress = t("cst.gamut.compress");

  const nodeIn: Node = { ee, ge, es: "DaVinci Wide Gamut", gs: "DaVinci Intermediate", tone: none, gamut: none };
  const nodeOut: Node = {
    ee: "DaVinci Wide Gamut", ge: "DaVinci Intermediate", es: tg.space, gs: tg.gamma,
    tone: tone ? "DaVinci" : none, gamut: tone ? compress : none,
  };
  const oneNode: Node = {
    ee, ge, es: tg.space, gs: tg.gamma, tone: tone ? "DaVinci" : none, gamut: tone ? compress : none,
  };

  const delivery = (
    <div className="cst-deliver">
      <span className="cst-deliver-k">{t("cst.delivery")}</span>
      <PopupButton
        value={target}
        options={TARGETS.map((x) => [x.id, x.label] as [string, string])}
        onChange={setTarget}
        placeholder={t("cst.delivery")}
      />
    </div>
  );

  return (
    <div className="cst cst-info">
      <div className="cst-head">
        {t("cst.header")}
        {!c.determinate && <span className="cst-badge-warn">{t("cst.deduced")}</span>}
      </div>

      <div className="cst-modes">
        <button className={`cst-mode ${mode === "2" ? "on" : ""}`} onClick={() => setMode("2")}>
          {t("cst.mode2")}
        </button>
        <button className={`cst-mode ${mode === "1" ? "on" : ""}`} onClick={() => setMode("1")}>
          {t("cst.mode1")}
        </button>
      </div>

      {mode === "2" ? (
        <>
          <NodeBlock title={t("cst.nodeIn")} color="in" n={nodeIn} />
          {delivery}
          <NodeBlock title={t("cst.nodeOut")} color="out" n={nodeOut} />
          <button
            className="cst-copy-both"
            onClick={() =>
              navigator.clipboard.writeText(
                `${nodeCopy(t("cst.nodeIn"), nodeIn)}\n\n${nodeCopy(t("cst.nodeOut"), nodeOut)}`,
              )
            }
          >
            <Icon name="copy" size={12} /> {t("cst.copyBoth")}
          </button>
          <div className="cst-bridge">🌉 {t("cst.bridge")}</div>
        </>
      ) : (
        <>
          {delivery}
          <NodeBlock title={t("cst.nodeOne")} color="out" n={oneNode} />
        </>
      )}

      <div className="cst-summary">{c.summary}</div>
    </div>
  );
}
