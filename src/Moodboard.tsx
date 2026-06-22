import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { boardLayout, setBoardItem, type Asset } from "./api";
import { t } from "./i18n";

interface Pos {
  x: number;
  y: number;
  w: number;
  z: number;
}

// Quadro livre (moodboard) de uma coleção: arraste pra mover, canto pra redimensionar.
// Não-destrutivo — só salva posição/tamanho (metadado) por item.
export function Moodboard({ collectionId, assets }: { collectionId: number; assets: Asset[] }) {
  const [pos, setPos] = useState<Record<number, Pos>>({});
  const maxZ = useRef(1);

  useEffect(() => {
    let alive = true;
    boardLayout(collectionId).then((items) => {
      if (!alive) return;
      const map: Record<number, Pos> = {};
      let z = 1;
      for (const it of items) {
        map[it.asset_id] = { x: it.x, y: it.y, w: it.w, z: it.z };
        z = Math.max(z, it.z);
      }
      // auto-posiciona em grade os itens ainda sem lugar salvo
      const COLS = 4,
        CW = 220,
        GAP = 16;
      let i = 0;
      for (const a of assets) {
        if (!map[a.id]) {
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          map[a.id] = { x: 24 + col * (CW + GAP), y: 24 + row * (CW + GAP), w: CW, z: 1 };
          i++;
        }
      }
      maxZ.current = z + 1;
      setPos(map);
    });
    return () => {
      alive = false;
    };
  }, [collectionId, assets]);

  const persist = (id: number, p: Pos) =>
    setBoardItem(collectionId, id, p.x, p.y, p.w, p.z).catch(() => {});

  const startDrag = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    const p0 = pos[id];
    if (!p0) return;
    const sx = e.clientX,
      sy = e.clientY;
    const z = maxZ.current++;
    const move = (ev: MouseEvent) => {
      setPos((m) => ({ ...m, [id]: { ...m[id], x: p0.x + (ev.clientX - sx), y: p0.y + (ev.clientY - sy), z } }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setPos((m) => {
        persist(id, m[id]);
        return m;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startResize = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    const p0 = pos[id];
    if (!p0) return;
    const sx = e.clientX;
    const move = (ev: MouseEvent) => {
      const w = Math.max(80, Math.min(900, p0.w + (ev.clientX - sx)));
      setPos((m) => ({ ...m, [id]: { ...m[id], w } }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setPos((m) => {
        persist(id, m[id]);
        return m;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="moodboard">
      {assets.map((a) => {
        const p = pos[a.id];
        if (!p) return null;
        const thumb = a.thumbnail_path ? convertFileSrc(a.thumbnail_path) : null;
        return (
          <div
            key={a.id}
            className="mb-item"
            style={{ left: p.x, top: p.y, width: p.w, zIndex: p.z }}
            onMouseDown={(e) => startDrag(e, a.id)}
            title={a.name || a.filename}
          >
            {thumb ? (
              <img src={thumb} alt="" draggable={false} />
            ) : (
              <div className="mb-noimg">{a.ext.toUpperCase()}</div>
            )}
            <span className="mb-resize" onMouseDown={(e) => startResize(e, a.id)} />
          </div>
        );
      })}
      {assets.length === 0 && <div className="mb-empty">{t("board.empty")}</div>}
    </div>
  );
}
