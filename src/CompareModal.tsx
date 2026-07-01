import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "./Icons";
import { type Asset } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

// Image Comparator (plugin do Eagle) — nativo. Compara 2 imagens com um divisor arrastável
// (antes/depois): a da esquerda aparece de um lado, a da direita do outro. Só visual, não salva.
export function CompareModal({
  a,
  b,
  onClose,
}: {
  a: Asset;
  b: Asset;
  onClose: () => void;
}) {
  const { closing, dismiss } = useDismiss(onClose);
  const [pos, setPos] = useState(50); // % do divisor
  const [side, setSide] = useState(false); // false = slider, true = lado a lado
  const stageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const urlA = convertFileSrc(a.path);
  const urlB = convertFileSrc(b.path);

  const moveTo = (clientX: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`mk-modal cmp-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="dup" size={16} /> {t("cmp.title")}
          </div>
          <div className="cmp-modes">
            <button className={`dl-qbtn ${!side ? "on" : ""}`} onClick={() => setSide(false)}>
              {t("cmp.slider")}
            </button>
            <button className={`dl-qbtn ${side ? "on" : ""}`} onClick={() => setSide(true)}>
              {t("cmp.side")}
            </button>
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        {side ? (
          <div className="cmp-sidebyside">
            <div className="cmp-half">
              <img src={urlA} alt="" />
              <span className="cmp-cap">{a.name || a.filename}</span>
            </div>
            <div className="cmp-half">
              <img src={urlB} alt="" />
              <span className="cmp-cap">{b.name || b.filename}</span>
            </div>
          </div>
        ) : (
          <div
            className="cmp-stage"
            ref={stageRef}
            onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
            onPointerLeave={() => (dragging.current = false)}
          >
            <img className="cmp-img" src={urlA} alt="" draggable={false} />
            <div className="cmp-top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              <img className="cmp-img" src={urlB} alt="" draggable={false} />
            </div>
            <div
              className="cmp-divider"
              style={{ left: `${pos}%` }}
              onPointerDown={(e) => {
                dragging.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
            >
              <div className="cmp-handle">
                <Icon name="chevronLeft" size={12} />
                <Icon name="chevronRight" size={12} />
              </div>
            </div>
            <span className="cmp-tag cmp-tag-l">{b.name || b.filename}</span>
            <span className="cmp-tag cmp-tag-r">{a.name || a.filename}</span>
          </div>
        )}

        <div className="dup-foot">
          <button className="dup-apply" onClick={dismiss}>
            {t("cmp.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
