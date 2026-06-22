import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { revealInExplorer, type FolderRow } from "./api";
import { t } from "./i18n";

interface Node {
  name: string;
  path: string;
  own: number;
  total: number;
  children: Map<string, Node>;
}

interface Meta {
  alias: string | null;
  hidden: boolean;
  color: string | null;
}

const FOLDER_COLORS = ["#FF453A", "#FF9F0A", "#FFD60A", "#30D158", "#40C8E0", "#0A84FF", "#BF5AF2", "#FF6482"];

function buildTree(dirs: FolderRow[]): Node[] {
  const root = new Map<string, Node>();
  for (const { dir, count } of dirs) {
    const parts = dir.split("\\").filter(Boolean);
    let level = root;
    let acc = "";
    parts.forEach((part, idx) => {
      acc = acc ? `${acc}\\${part}` : part;
      let node = level.get(part);
      if (!node) {
        node = { name: part, path: acc, own: 0, total: 0, children: new Map() };
        level.set(part, node);
      }
      if (idx === parts.length - 1) node.own += count;
      level = node.children;
    });
  }
  const sum = (n: Node): number => {
    let t = n.own;
    n.children.forEach((c) => (t += sum(c)));
    n.total = t;
    return t;
  };
  const roots = [...root.values()];
  roots.forEach(sum);
  return roots;
}

// Colapsa cadeias de pasta única (E: > EDITOR PREMIUM > BACKGROUNDS) num só nó visual.
function collapse(node: Node): Node {
  let n = node;
  while (n.children.size === 1 && n.own === 0) {
    const child = [...n.children.values()][0];
    n = { ...child, name: `${n.name}\\${child.name}` };
  }
  const children = new Map<string, Node>();
  n.children.forEach((c, k) => children.set(k, collapse(c)));
  return { ...n, children };
}

function TreeNode({
  node,
  depth,
  selected,
  meta,
  showHidden,
  onSelect,
  onAlias,
  onHide,
  onRescan,
  onColor,
  onAutotag,
  onRemoveFolder,
}: {
  node: Node;
  depth: number;
  selected: string | null;
  meta: Map<string, Meta>;
  showHidden: boolean;
  onSelect: (path: string) => void;
  onAlias: (dir: string, alias: string | null) => void;
  onHide: (dir: string, hidden: boolean) => void;
  onRescan: (dir: string) => void;
  onColor: (dir: string, color: string | null) => void;
  onAutotag: (dir: string) => void;
  onRemoveFolder: (dir: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Posição final do menu: MEDE a altura real e encaixa na viewport (antes era um chute de
  // 360px que cortava o "Remover" quando o menu era mais alto / abria perto da borda).
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!menu) {
      setMenuPos(null);
      return;
    }
    const el = menuRef.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 360;
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(menu.y, window.innerHeight - h - 8));
    setMenuPos({ left, top });
  }, [menu]);
  const m = meta.get(node.path);
  const hidden = m?.hidden ?? false;
  if (hidden && !showHidden) return null;

  const kids = [...node.children.values()];
  const hasKids = kids.length > 0;
  const active = selected === node.path;
  const display = m?.alias || node.name.split("\\").pop();

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${active ? "active" : ""} ${hidden ? "tree-hidden" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span
          className={`tree-caret ${hasKids ? "" : "leaf"} ${open ? "open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {hasKids ? <Icon name="chevronRight" size={13} /> : null}
        </span>
        <span className="tree-folder-ico" style={m?.color ? { color: m.color } : undefined}>
          <Icon name="folder" size={16} />
        </span>
        {editing ? (
          <input
            className="tree-edit"
            autoFocus
            defaultValue={m?.alias || node.name.split("\\").pop()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const v = e.target.value.trim();
              onAlias(node.path, v || null);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span className="tree-name">{display}</span>
        )}
        {hidden && (
          <span className="tree-hidden-badge" title={t("tree.hiddenBadge")}>
            <Icon name="eyeOff" size={12} />
          </span>
        )}
        <span className="count">{node.total}</span>
        <button
          className="tree-more"
          title={t("tree.options")}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setMenu(menu ? null : { x: r.left - 180, y: r.bottom + 4 });
          }}
        >
          <Icon name="more" size={16} />
        </button>
      </div>
      {menu &&
        createPortal(
          <>
            <div
              className="ctx-backdrop"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(null);
              }}
            />
            <div
              ref={menuRef}
              className="ctx-menu tree-ctx"
              style={{
                left: menuPos ? menuPos.left : Math.max(8, Math.min(menu.x, window.innerWidth - 248)),
                top: menuPos ? menuPos.top : menu.y,
                width: 240,
                visibility: menuPos ? "visible" : "hidden",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="ctx-folder-head">
                <Icon name="folder" size={13} /> {display}
              </div>
              <button className="ctx-item" onClick={() => { setMenu(null); onSelect(node.path); }}>
                <Icon name="folder" size={14} /> <span>{t("fld.open")}</span>
              </button>
              {hasKids && (
                <button className="ctx-item" onClick={() => { setOpen((o) => !o); setMenu(null); }}>
                  <Icon name="chevronUpDown" size={14} /> <span>{open ? t("fld.collapse") : t("fld.expand")}</span>
                </button>
              )}
              <div className="ctx-sep" />
              <button className="ctx-item" onClick={() => { setMenu(null); setEditing(true); }}>
                <Icon name="pencil" size={14} /> <span>{t("fld.rename")}</span>
              </button>
              <button className="ctx-item" onClick={() => { setMenu(null); onAutotag(node.path); }}>
                <Icon name="tag" size={14} /> <span>{t("fld.autotag")}</span>
              </button>
              <button className="ctx-item" onClick={() => { setMenu(null); onRescan(node.path); }}>
                <Icon name="refresh" size={14} /> <span>{t("fld.rescan")}</span>
              </button>
              <div className="ctx-sep" />
              <button className="ctx-item" onClick={() => { setMenu(null); navigator.clipboard.writeText(node.path); }}>
                <Icon name="copy" size={14} /> <span>{t("fld.copyPath")}</span>
              </button>
              <button className="ctx-item" onClick={() => { setMenu(null); revealInExplorer(node.path); }}>
                <Icon name="reveal" size={14} /> <span>{t("fld.explorer")}</span>
              </button>
              <button className="ctx-item" onClick={() => { setMenu(null); onHide(node.path, !hidden); }}>
                <Icon name={hidden ? "eye" : "eyeOff"} size={14} /> <span>{hidden ? t("fld.show") : t("fld.hide")}</span>
              </button>
              <div className="ctx-sep" />
              <div className="ctx-colors-label">{t("fld.color")}</div>
              <div className="tree-colors">
                <button
                  className="tree-color tree-color-none"
                  title={t("tree.noColor")}
                  onClick={() => { onColor(node.path, null); setMenu(null); }}
                />
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    className="tree-color"
                    style={{ background: c }}
                    onClick={() => { onColor(node.path, c); setMenu(null); }}
                  />
                ))}
              </div>
              <div className="ctx-sep" />
              <button
                className="ctx-item danger"
                onClick={() => { setMenu(null); onRemoveFolder(node.path); }}
              >
                <Icon name="trash" size={14} /> <span>{t("fld.remove")}</span>
              </button>
            </div>
          </>,
          document.body
        )}
      {open &&
        kids.map((c) => (
          <TreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            selected={selected}
            meta={meta}
            showHidden={showHidden}
            onSelect={onSelect}
            onAlias={onAlias}
            onHide={onHide}
            onRescan={onRescan}
            onColor={onColor}
            onAutotag={onAutotag}
            onRemoveFolder={onRemoveFolder}
          />
        ))}
    </div>
  );
}

export function FolderTree({
  dirs,
  selected,
  showHidden,
  onSelect,
  onAlias,
  onHide,
  onRescan,
  onColor,
  onAutotag,
  onRemoveFolder,
}: {
  dirs: FolderRow[];
  selected: string | null;
  showHidden: boolean;
  onSelect: (path: string) => void;
  onAlias: (dir: string, alias: string | null) => void;
  onHide: (dir: string, hidden: boolean) => void;
  onRescan: (dir: string) => void;
  onColor: (dir: string, color: string | null) => void;
  onAutotag: (dir: string) => void;
  onRemoveFolder: (dir: string) => void;
}) {
  const roots = useMemo(() => buildTree(dirs).map(collapse), [dirs]);
  const meta = useMemo(() => {
    const m = new Map<string, Meta>();
    for (const f of dirs) m.set(f.dir, { alias: f.alias, hidden: f.hidden, color: f.color });
    return m;
  }, [dirs]);
  if (roots.length === 0) return null;
  return (
    <div className="tree">
      {roots.map((r) => (
        <TreeNode
          key={r.path}
          node={r}
          depth={0}
          selected={selected}
          meta={meta}
          showHidden={showHidden}
          onSelect={onSelect}
          onAlias={onAlias}
          onHide={onHide}
          onRescan={onRescan}
          onColor={onColor}
          onAutotag={onAutotag}
          onRemoveFolder={onRemoveFolder}
        />
      ))}
    </div>
  );
}
