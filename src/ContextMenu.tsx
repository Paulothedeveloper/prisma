import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icons";

export interface CtxItem {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
}

// Menu de contexto (botão-direito) estilo Eagle — renderizado via portal, na posição do cursor.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: CtxItem[]; onClose: () => void }) {
  const W = 226;
  const H = items.length * 34 + 12;
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, window.innerHeight - H - 8);
  return createPortal(
    <>
      <div
        className="ctx-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="ctx-menu" style={{ left, top, width: W }}>
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="ctx-sep" />
          ) : (
            <button
              key={i}
              className={`ctx-item ${it.danger ? "danger" : ""}`}
              onClick={() => {
                onClose();
                it.onClick?.();
              }}
            >
              {it.icon && <Icon name={it.icon} size={14} />}
              <span>{it.label}</span>
            </button>
          )
        )}
      </div>
    </>,
    document.body
  );
}
