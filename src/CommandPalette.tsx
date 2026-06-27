import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";
import { t } from "./i18n";

// Uma ação da paleta de comandos (Ctrl/Cmd+K): rótulo + ação. `hint` aparece à direita
// (atalho ou seção); `keywords` ajuda a achar por sinônimos sem poluir o rótulo.
export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: IconName;
  keywords?: string;
  run: () => void;
}

// Paleta estilo Spotlight/cmd-k: filtra por digitação, navega com ↑/↓, executa com Enter, fecha
// com Esc. Tudo via teclado — sem tirar a mão do teclado pra navegar a biblioteca.
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(s) ||
        c.hint?.toLowerCase().includes(s) ||
        c.keywords?.toLowerCase().includes(s),
    );
  }, [q, commands]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  // mantém o item ativo sempre visível ao navegar com as setas.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder={t("cmdk.placeholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd className="cmdk-esc">esc</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmdk-empty">{t("cmdk.empty")}</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                data-i={i}
                className={`cmdk-item ${i === active ? "active" : ""}`}
                onMouseMove={() => setActive(i)}
                onClick={() => run(c)}
              >
                {c.icon && <Icon name={c.icon} size={15} />}
                <span className="cmdk-label">{c.label}</span>
                {c.hint && <span className="cmdk-hint">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
