import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icons";
import { PopupButton } from "./Menu";
import { createSmart, updateSmart, smartPreview, type SmartFolder, type SmartRule } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

// Construtor de pasta inteligente (regra → preview ao vivo da contagem).
type FieldDef = {
  value: string;
  label: string;
  ops: [string, string][];
  options?: [string, string][];
  input?: "text" | "number";
};

const FIELDS: FieldDef[] = [
  { value: "tag", label: t("sb.field.tag"), ops: [["has", t("sb.op.has")]], input: "text" },
  {
    value: "type",
    label: t("sb.field.type"),
    ops: [["equals", t("sb.op.equals")]],
    options: [["image", t("sb.type.image")], ["video", t("sb.type.video")], ["gif", t("sb.type.gif")], ["audio", t("sb.type.audio")], ["lut", t("sb.type.lut")], ["font", t("sb.type.font")], ["document", t("sb.type.document")], ["unknown", t("sb.type.unknown")]],
  },
  { value: "ext", label: t("sb.field.ext"), ops: [["equals", t("sb.op.equals")]], input: "text" },
  { value: "name", label: t("sb.field.name"), ops: [["contains", t("sb.op.contains")], ["equals", t("sb.op.equals")]], input: "text" },
  { value: "rating", label: t("sb.field.rating"), ops: [["gte", "≥"], ["eq", "="], ["lte", "≤"]], options: [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]] },
  { value: "res", label: t("sb.field.res"), ops: [["equals", t("sb.op.equals")]], options: [["uhd", t("sb.res.uhd")], ["fhd", t("sb.res.fhd")], ["hd", t("sb.res.hd")], ["sd", t("sb.res.sd")]] },
  { value: "duration", label: t("sb.field.duration"), ops: [["gt", t("sb.op.gt")], ["lt", t("sb.op.lt")]], input: "number" },
  { value: "color", label: t("sb.field.color"), ops: [["equals", t("sb.op.equals")]], options: [["vermelho", t("sb.color.vermelho")], ["laranja", t("sb.color.laranja")], ["amarelo", t("sb.color.amarelo")], ["verde", t("sb.color.verde")], ["ciano", t("sb.color.ciano")], ["azul", t("sb.color.azul")], ["roxo", t("sb.color.roxo")], ["rosa", t("sb.color.rosa")], ["branco", t("sb.color.branco")], ["cinza", t("sb.color.cinza")], ["preto", t("sb.color.preto")]] },
  { value: "bright", label: t("sb.field.bright"), ops: [["equals", t("sb.op.equals")]], options: [["claro", t("sb.bright.claro")], ["medio", t("sb.bright.medio")], ["escuro", t("sb.bright.escuro")]] },
  { value: "warm", label: t("sb.field.warm"), ops: [["equals", t("sb.op.equals")]], options: [["quente", t("sb.warm.quente")], ["neutro", t("sb.warm.neutro")], ["frio", t("sb.warm.frio")]] },
  { value: "sat", label: t("sb.field.sat"), ops: [["equals", t("sb.op.equals")]], options: [["vivido", t("sb.sat.vivido")], ["suave", t("sb.sat.suave")], ["pb", t("sb.sat.pb")]] },
  { value: "dir", label: t("sb.field.dir"), ops: [["contains", t("sb.op.contains")]], input: "text" },
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
  const [name, setName] = useState(editing?.name ?? t("sb.defaultName"));
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
    if (editing) await updateSmart(editing.id, name.trim() || t("sb.noName"), matchMode, rulesJson);
    else await createSmart(name.trim() || t("sb.noName"), matchMode, rulesJson);
    onSaved();
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`sb-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="stack" size={16} /> {editing ? t("sb.edit") : t("sb.new")} {t("sb.smartFolder")}
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sb-body">
          <input className="field sb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sb.namePlaceholder")} />

          <div className="sb-match">
            {t("sb.matchPrefix")}
            <PopupButton value={matchMode} options={[["all", t("sb.matchAll")], ["any", t("sb.matchAny")]]} onChange={setMatchMode} />
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
                      placeholder={t("sb.valuePlaceholder")}
                      onChange={(e) => setRule(i, { value: e.target.value })}
                    />
                  )}
                  <button className="sb-del" onClick={() => delRule(i)} title={t("sb.removeRule")}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              );
            })}
            <button className="sb-add" onClick={addRule}>
              <Icon name="plus" size={13} /> {t("sb.addRule")}
            </button>
          </div>

          <div className="sb-preview">
            {count === null ? "…" : <><b>{count.toLocaleString("pt-BR")}</b> {t("sb.matchCount")}</>}
          </div>
        </div>

        <div className="dup-foot">
          <button className="dup-cancel" onClick={dismiss}>{t("sb.cancel")}</button>
          <button className="dup-apply" onClick={save}>{editing ? t("sb.save") : t("sb.create")}</button>
        </div>
      </div>
    </div>
  );
}
