import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { TIPS, markTipSeen, disableTips } from "./tips";

// Dica de primeira-vez ancorada num elemento. Portalizada e presa na viewport — não
// empurra nem quebra o layout (mesmo padrão do menu de contexto).
export function Coachmark({ id, rect, onClose }: { id: string; rect: DOMRect; onClose: () => void }) {
  const def = TIPS[id];
  if (!def) return null;
  const W = 290;
  let left = Math.max(10, Math.min(rect.left, window.innerWidth - W - 10));
  let top = rect.bottom + 10;
  // se não couber embaixo, joga pra cima do elemento
  if (top > window.innerHeight - 160) top = Math.max(10, rect.top - 160);
  // garante que não saia pela esquerda quando o alvo está colado na borda
  if (left < 10) left = 10;

  const close = (disable = false) => {
    markTipSeen(id);
    if (disable) disableTips();
    onClose();
  };

  return createPortal(
    <>
      <div className="tip-backdrop" onClick={() => close()} />
      <div className="coachmark" style={{ left, top, width: W }}>
        <div className="coach-title">
          <Icon name="sliders" size={13} /> {def.title}
        </div>
        <div className="coach-text">{def.text}</div>
        <div className="coach-actions">
          <button className="coach-skip" onClick={() => close(true)}>
            Não mostrar dicas
          </button>
          <button className="coach-ok" onClick={() => close()}>
            Entendi
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
