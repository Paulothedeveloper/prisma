import { useMemo, useState } from "react";
import { Icon } from "./Icons";
import type { FolderRow } from "./api";

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
}) {
  const [open, setOpen] = useState(depth < 1);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
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
          setMenu(true);
        }}
      >
        <span
          className={`tree-caret ${hasKids ? "" : "leaf"} ${open ? "open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {hasKids ? "▸" : ""}
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
        <span className="count">{node.total}</span>
        <button
          className="tree-more"
          title="Opções da pasta"
          onClick={(e) => {
            e.stopPropagation();
            setMenu((o) => !o);
          }}
        >
          <Icon name="more" size={14} />
        </button>
        {menu && (
          <>
            <div className="tree-menu-backdrop" onClick={(e) => { e.stopPropagation(); setMenu(false); }} />
            <div className="tree-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setEditing(true); setMenu(false); }}>
                <Icon name="pencil" size={13} /> Renomear (apelido)
              </button>
              <button onClick={() => { onHide(node.path, !hidden); setMenu(false); }}>
                <Icon name={hidden ? "eye" : "eyeOff"} size={13} /> {hidden ? "Mostrar pasta" : "Ocultar pasta"}
              </button>
              <button onClick={() => { onRescan(node.path); setMenu(false); }}>
                <Icon name="refresh" size={13} /> Re-scan (novos / apagados)
              </button>
              <button onClick={() => { onAutotag(node.path); setMenu(false); }}>
                <Icon name="tag" size={13} /> Auto-tag (nome da pasta)
              </button>
              <div className="tree-colors">
                <button
                  className="tree-color tree-color-none"
                  title="Sem cor"
                  onClick={() => { onColor(node.path, null); setMenu(false); }}
                />
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    className="tree-color"
                    style={{ background: c }}
                    onClick={() => { onColor(node.path, c); setMenu(false); }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
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
        />
      ))}
    </div>
  );
}
