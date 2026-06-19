import { useMemo, useState } from "react";
import { Icon } from "./Icons";
import { renameFiles, type Asset } from "./api";
import { useDismiss } from "./useDismiss";

// Batch Rename (Briefing 4 #4): renomeia os ARQUIVOS no disco por padrão + tokens.
// ⚠️ mexe no arquivo real — avisa e guarda os nomes antigos pra desfazer.
function baseName(f: string) {
  return f.replace(/\.[^.]+$/, "");
}
function fmtDate(ts: number) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function applyPattern(pattern: string, a: Asset, index: number, find: string, replace: string): string {
  const ext = a.ext || baseName(a.filename).split(".").pop() || "";
  let name = pattern
    .replace(/\{n(ome)?\}/gi, baseName(a.filename))
    .replace(/\{ext\}/gi, ext)
    .replace(/\{res\}/gi, a.width && a.height ? `${a.width}x${a.height}` : "")
    .replace(/\{date\}/gi, fmtDate(a.modified_at));
  const cm = pattern.match(/\{(#+)\}/);
  if (cm) name = name.replace(/\{#+\}/, String(index + 1).padStart(cm[1].length, "0"));
  if (find) name = name.split(find).join(replace);
  if (ext && !name.toLowerCase().endsWith("." + ext.toLowerCase())) name = `${name}.${ext}`;
  return name;
}

export function BatchRename({ assets, onClose, onDone }: { assets: Asset[]; onClose: () => void; onDone: () => void }) {
  const { closing, dismiss } = useDismiss(onClose);
  const [pattern, setPattern] = useState("{nome}");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ id: number; new_name: string }[] | null>(null);

  const preview = useMemo(
    () => assets.map((a, i) => ({ a, neu: applyPattern(pattern, a, i, find, replace) })),
    [assets, pattern, find, replace]
  );

  const apply = async () => {
    setBusy(true);
    const olds = assets.map((a) => ({ id: a.id, new_name: a.filename }));
    try {
      await renameFiles(preview.map((p) => ({ id: p.a.id, new_name: p.neu })));
      setUndo(olds);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const doUndo = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      await renameFiles(undo);
      setUndo(null);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`br-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="pencil" size={16} /> Renomear em lote — {assets.length} arquivos
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="br-body">
          <div className="br-warn">
            ⚠️ Isso renomeia o <b>arquivo real no disco</b> (não é só rótulo). Dá pra <b>desfazer</b> logo após.
          </div>

          <label className="enc-field">
            <span className="enc-field-label">Padrão</span>
            <input className="field" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="{nome}_{###}" />
          </label>
          <div className="br-tokens">
            Tokens: <code>{"{nome}"}</code> <code>{"{###}"}</code> (contador) <code>{"{ext}"}</code> <code>{"{res}"}</code> <code>{"{date}"}</code>
          </div>
          <div className="br-find">
            <label className="enc-field">
              <span className="enc-field-label">Localizar</span>
              <input className="field" value={find} onChange={(e) => setFind(e.target.value)} />
            </label>
            <label className="enc-field">
              <span className="enc-field-label">Substituir por</span>
              <input className="field" value={replace} onChange={(e) => setReplace(e.target.value)} />
            </label>
          </div>

          <div className="br-preview">
            {preview.slice(0, 200).map((p) => (
              <div className="br-row" key={p.a.id}>
                <span className="br-old">{p.a.filename}</span>
                <Icon name="chevronRight" size={12} />
                <span className="br-new">{p.neu}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dup-foot">
          {undo ? (
            <button className="dup-cancel" onClick={doUndo} disabled={busy}>Desfazer</button>
          ) : (
            <button className="dup-cancel" onClick={dismiss} disabled={busy}>Cancelar</button>
          )}
          <button className="dup-apply" onClick={apply} disabled={busy}>
            {busy ? "Renomeando…" : undo ? "Renomear de novo" : "Renomear"}
          </button>
        </div>
      </div>
    </div>
  );
}
