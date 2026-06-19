import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icons";
import { PopupButton } from "./Menu";
import { createSmart, updateSmart, smartPreview, type SmartFolder, type SmartRule } from "./api";
import { useDismiss } from "./useDismiss";

// Construtor de pasta inteligente (regra → preview ao vivo da contagem).
type FieldDef = {
  value: string;
  label: string;
  ops: [string, string][];
  options?: [string, string][];
  input?: "text" | "number";
};

const FIELDS: FieldDef[] = [
  { value: "tag", label: "Tag", ops: [["has", "tem"]], input: "text" },
  {
    value: "type",
    label: "Tipo",
    ops: [["equals", "é"]],
    options: [["image", "Imagem"], ["video", "Vídeo"], ["gif", "GIF"], ["audio", "Áudio"], ["lut", "LUT"], ["font", "Fonte"], ["document", "Documento"], ["unknown", "Outros"]],
  },
  { value: "ext", label: "Extensão", ops: [["equals", "é"]], input: "text" },
  { value: "name", label: "Nome", ops: [["contains", "contém"], ["equals", "é"]], input: "text" },
  { value: "rating", label: "Estrelas", ops: [["gte", "≥"], ["eq", "="], ["lte", "≤"]], options: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]] },
  { value: "res", label: "Resolução", ops: [["equals", "é"]], options: [["uhd", "4K+"], ["fhd", "Full HD"], ["hd", "HD"], ["sd", "SD"]] },
  { value: "duration", label: "Duração (s)", ops: [["gt", "maior que"], ["lt", "menor que"]], input: "number" },
  { value: "color", label: "Cor", ops: [["equals", "é"]], options: [["vermelho", "Vermelho"], ["laranja", "Laranja"], ["amarelo", "Amarelo"], ["verde", "Verde"], ["ciano", "Ciano"], ["azul", "Azul"], ["roxo", "Roxo"], ["rosa", "Rosa"], ["branco", "Branco"], ["cinza", "Cinza"], ["preto", "Preto"]] },
  { value: "bright", label: "Tom", ops: [["equals", "é"]], options: [["claro", "Claro"], ["medio", "Médio"], ["escuro", "Escuro"]] },
  { value: "warm", label: "Temperatura", ops: [["equals", "é"]], options: [["quente", "Quente"], ["neutro", "Neutra"], ["frio", "Fria"]] },
  { value: "sat", label: "Saturação", ops: [["equals", "é"]], options: [["vivido", "Vívida"], ["suave", "Suave"], ["pb", "P&B"]] },
  { value: "dir", label: "Pasta contém", ops: [["contains", "contém"]], input: "text" },
];

const fieldDef = (f: string) => FIELDS.find((x) => x.value === f) ?? FIELDS[0];

export function SmartBuilder({
  editing,
  onClose,
  onSaved,
}: {
  editing?: SmartFolder | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { closing, dismiss } = useDismiss(onClose);
  const [name, setName] = useState(editing?.name ?? "Nova pasta inteligente");
  const [matchMode, setMatchMode] = useState(editing?.match_mode ?? "all");
  const [rules, setRules] = useState<SmartRule[]>(() => {
    try {
      const r = editing ? JSON.parse(editing.rules) : [];
      return r.length ? r : [{ field: "type", op: "equals", value: "video" }];
    } catch {
      return [{ field: "type", op: "equals", value: "video" }];
    }
  });
  const [count, setCount] = useState<number | null>(null);

  const rulesJson = useMemo(() => JSON.stringify(rules), [rules]);

  useEffect(() => {
    const t = setTimeout(() => {
      smartPreview(matchMode, rulesJson).then(setCount).catch(() => setCount(null));
    }, 200);
    return () => clearTimeout(t);
  }, [matchMode, rulesJson]);

  const setRule = (i: number, patch: Partial<SmartRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRule = () => setRules((rs) => [...rs, { field: "tag", op: "has", value: "" }]);
  const delRule = (i: number) => setRules((rs) => rs.filter((_, idx) => idx !== i));

  const save = async () => {
    if (editing) await updateSmart(editing.id, name.trim() || "Sem nome", matchMode, rulesJson);
    else await createSmart(name.trim() || "Sem nome", matchMode, rulesJson);
    onSaved();
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`sb-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="stack" size={16} /> {editing ? "Editar" : "Nova"} pasta inteligente
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sb-body">
          <input className="field sb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" />

          <div className="sb-match">
            Mostrar itens que batem em
            <PopupButton value={matchMode} options={[["all", "TODAS as regras (E)"], ["any", "QUALQUER regra (OU)"]]} onChange={setMatchMode} />
          </div>

          <div className="sb-rules">
            {rules.map((r, i) => {
              const fd = fieldDef(r.field);
              return (
                <div className="sb-rule" key={i}>
                  <PopupButton
                    value={r.field}
                    options={FIELDS.map((f) => [f.value, f.label] as [string, string])}
                    onChange={(field) => {
                      const nfd = fieldDef(field);
                      setRule(i, { field, op: nfd.ops[0][0], value: nfd.options ? nfd.options[0][0] : "" });
                    }}
                  />
                  <PopupButton value={r.op} options={fd.ops} onChange={(op) => setRule(i, { op })} />
                  {fd.options ? (
                    <PopupButton value={r.value} options={fd.options} onChange={(value) => setRule(i, { value })} />
                  ) : (
                    <input
                      className="field sb-value"
                      type={fd.input === "number" ? "number" : "text"}
                      value={r.value}
                      placeholder="valor"
                      onChange={(e) => setRule(i, { value: e.target.value })}
                    />
                  )}
                  <button className="sb-del" onClick={() => delRule(i)} title="Remover regra">
                    <Icon name="close" size={12} />
                  </button>
                </div>
              );
            })}
            <button className="sb-add" onClick={addRule}>
              <Icon name="plus" size={13} /> Adicionar regra
            </button>
          </div>

          <div className="sb-preview">
            {count === null ? "…" : <><b>{count.toLocaleString("pt-BR")}</b> itens batem nessa regra agora</>}
          </div>
        </div>

        <div className="dup-foot">
          <button className="dup-cancel" onClick={dismiss}>Cancelar</button>
          <button className="dup-apply" onClick={save}>{editing ? "Salvar" : "Criar"}</button>
        </div>
      </div>
    </div>
  );
}
