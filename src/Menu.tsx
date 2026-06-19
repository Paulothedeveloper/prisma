import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";

// Pop-up button estilo macOS. O menu é renderizado num PORTAL (fora das superfícies
// com backdrop-filter), pra o efeito liquid glass realmente funcionar — vidro
// translúcido com desfoque + animação suave de abertura.
export function PopupButton({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 6, width: r.width });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find(([v]) => v === value);
  const label = current ? current[1] : placeholder ?? "";
  const active = !!value;

  return (
    <>
      <button
        ref={btnRef}
        className={`popup-btn ${active ? "on" : ""} ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="popup-label">{label}</span>
        <span className="popup-chev">
          <Icon name="chevronUpDown" size={13} />
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="menu"
            style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.width, 180) }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map(([v, l], i) => (
              <button
                key={v}
                className={`menu-item ${v === value ? "checked" : ""}`}
                style={{ animationDelay: `${i * 14}ms` }}
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
              >
                <span className="menu-check">
                  {v === value ? <Icon name="check" size={12} /> : null}
                </span>
                <span>{l}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
