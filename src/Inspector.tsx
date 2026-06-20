import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icons";
import { Oficina } from "./Oficina";
import { AudioPlayer } from "./AudioPlayer";
import { CstCard } from "./CstCard";
import { HealthCard } from "./HealthCard";
import { FixConfirm } from "./FixConfirm";
import { ColorPlanCard } from "./ColorPlanCard";
import { useDismiss } from "./useDismiss";
import { fireTip } from "./tips";
import { t } from "./i18n";
import { getProxy, renameAsset, duplicateAsset, refreshThumb, setCustomThumb } from "./api";

// Codecs que o WebView decodifica. ProRes/DNxHR ficam de fora → prévia no player externo.
const WEB_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1", "avc1"]);
import {
  setRating,
  setNotes,
  tagsForAsset,
  addTag,
  removeTag,
  revealInExplorer,
  probeMedia,
  collectionsForAsset,
  addToCollection,
  removeFromCollection,
  removeAsset,
  trashAsset,
  aiAnalyze,
  openExternal,
  type Asset,
  type Tag,
  type Collection,
  type MediaInfo,
} from "./api";

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  let n = b;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(1)} ${u[i]}`;
}
function fmtDur(d: number | null): string | null {
  if (!d || d <= 0) return null;
  const m = Math.floor(d / 60);
  const s = Math.floor(d % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtBitrate(b: number | null): string | null {
  if (!b) return null;
  return `${(b / 1_000_000).toFixed(1)} Mb/s`;
}

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`star ${(hover || value) >= n ? "on" : ""}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          <Icon name={(hover || value) >= n ? "starFill" : "star"} size={18} />
        </span>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div className="meta-row">
      <span className="meta-k">{k}</span>
      <span className="meta-v mono">{v}</span>
    </div>
  );
}

interface Props {
  asset: Asset;
  collections: Collection[];
  inCollection: number | null;
  inTrash: boolean;
  onRemoveFromCollection: (collectionId: number, assetId: number) => void;
  onFindSimilar: (a: Asset) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  onPreview: (a: Asset) => void;
  onMutate: () => void;
}

export function Inspector({
  asset,
  collections,
  inCollection,
  inTrash,
  onRemoveFromCollection,
  onFindSimilar,
  onOpenSettings,
  onClose,
  onPreview,
  onMutate,
}: Props) {
  const { closing, dismiss } = useDismiss(onClose);
  const asideRef = useRef<HTMLElement>(null);
  const [fixOp, setFixOp] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => fireTip("inspector", asideRef.current), 350);
    return () => clearTimeout(t);
  }, []);
  const [tags, setTags] = useState<Tag[]>([]);
  const [rating, setRatingState] = useState(asset.rating);
  const [notes, setNotesState] = useState(asset.notes ?? "");
  const [newTag, setNewTag] = useState("");
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [localProxy, setLocalProxy] = useState<string | null>(null);
  const [assetColls, setAssetColls] = useState<number[]>([]);
  const [addingColl, setAddingColl] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  useEffect(() => {
    setRatingState(asset.rating);
    setNotesState(asset.notes ?? "");
    tagsForAsset(asset.id).then(setTags);
    collectionsForAsset(asset.id).then(setAssetColls);
    setAddingColl(false);
    setConfirmRemove(false);
    setRenaming(false);
    setAiErr(null);
    setInfo(null);
    if (["video", "audio", "image", "gif"].includes(asset.type)) {
      setLoadingInfo(true);
      probeMedia(asset.path)
        .then(setInfo)
        .finally(() => setLoadingInfo(false));
    }
  }, [asset.id, asset.path, asset.type, asset.rating, asset.notes]);

  const previewUrl = asset.thumbnail_path ? convertFileSrc(asset.thumbnail_path) : null;
  const origUrl = convertFileSrc(asset.path);
  const proxyUrl = asset.proxy_path ? convertFileSrc(asset.proxy_path) : null;

  const changeRating = async (v: number) => {
    setRatingState(v);
    await setRating(asset.id, v);
    onMutate();
  };
  const saveNotes = () => setNotes(asset.id, notes);
  const commitTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    await addTag(asset.id, name, null);
    setNewTag("");
    setTags(await tagsForAsset(asset.id));
    onMutate();
  };
  const dropTag = async (tagId: number) => {
    await removeTag(asset.id, tagId);
    setTags(await tagsForAsset(asset.id));
    onMutate();
  };
  const addColl = async (cid: number) => {
    await addToCollection(cid, [asset.id]);
    setAssetColls(await collectionsForAsset(asset.id));
    setAddingColl(false);
    onMutate();
  };
  const removeColl = async (cid: number) => {
    if (cid === inCollection) {
      // remove e some da view atual (App cuida do refresh)
      onRemoveFromCollection(cid, asset.id);
      setAssetColls((c) => c.filter((x) => x !== cid));
      return;
    }
    await removeFromCollection(cid, asset.id);
    setAssetColls(await collectionsForAsset(asset.id));
    onMutate();
  };
  const collName = (id: number) => collections.find((c) => c.id === id)?.name ?? "coleção";
  const available = collections.filter((c) => !assetColls.includes(c.id));
  const analyzeAI = async () => {
    setAiBusy(true);
    setAiErr(null);
    try {
      await aiAnalyze(asset.id);
      setTags(await tagsForAsset(asset.id));
      onMutate();
    } catch (e) {
      const msg = String(e);
      setAiErr(msg);
      // sem chave configurada → abre as Configurações direto
      if (msg.toLowerCase().includes("chave")) onOpenSettings();
    } finally {
      setAiBusy(false);
    }
  };
  const aiAble = ["image", "gif", "video"].includes(asset.type);
  const displayName = asset.name || asset.filename;
  const folderPath = asset.path.replace(/\\[^\\]+$/, "");
  const doDuplicate = async () => {
    await duplicateAsset(asset.id);
    onMutate();
  };
  const doRefreshThumb = async () => {
    await refreshThumb(asset.id);
    onMutate();
  };
  const doCustomThumb = async () => {
    const sel = await openDialog({
      multiple: false,
      filters: [{ name: "Imagem", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }],
    });
    if (typeof sel === "string") {
      await setCustomThumb(asset.id, sel);
      onMutate();
    }
  };

  const v = info?.video;
  const a = info?.audio;
  // orientação de EXIBIÇÃO (considera rotação) — pra preview vertical funcionar
  const ew = asset.width ?? 16;
  const eh = asset.height ?? 9;
  const rotated = v?.rotation === 90 || v?.rotation === 270;
  const portrait = rotated ? ew >= eh : eh > ew;
  // dimensões de EXIBIÇÃO (considera rotação) → o box do preview assume a proporção real
  const dispW = rotated ? eh : ew;
  const dispH = rotated ? ew : eh;
  const hasDims = !!(asset.width && asset.height);
  const aspect = hasDims ? `${dispW} / ${dispH}` : undefined;
  const videoPlayable = !!v?.codec && WEB_VIDEO_CODECS.has(v.codec.toLowerCase());
  // toca o original se web-compatível, senão o proxy (existente ou recém-gerado)
  const proxiedSrc = proxyUrl ?? localProxy;
  const playSrc = videoPlayable ? origUrl : proxiedSrc;
  // assume a proporção real sempre que houver QUALQUER visual (vídeo tocável, ou a
  // miniatura do vídeo não-suportado, ou imagem/gif). Sem visual nenhum, mantém a caixa
  // padrão pra não colapsar numa tira.
  const showsMedia =
    asset.type === "image" ||
    asset.type === "gif" ||
    (asset.type === "video" && (!!playSrc || !!previewUrl));
  const useAspect = aspect && showsMedia;

  // Proxy é ESCOLHA do usuário (botão "Gerar proxy" na Oficina) — não automático.
  useEffect(() => {
    setLocalProxy(null);
  }, [asset.id, asset.path]);

  // Quando um job termina, busca o proxy deste asset e passa a tocar.
  useEffect(() => {
    let un: (() => void) | null = null;
    listen("oficina:done", () => {
      getProxy(asset.path).then((p) => {
        if (p) setLocalProxy(convertFileSrc(p));
      });
    }).then((u) => (un = u));
    return () => {
      if (un) un();
    };
  }, [asset.path]);

  return (
    <aside ref={asideRef} className={`inspector${closing ? " closing" : ""}`}>
      <div className="insp-head">
        <span className="insp-title">{t("insp.details")}</span>
        <button className="icon-btn" onClick={dismiss}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div
        className={`insp-preview thumb-${asset.type} ${portrait ? "portrait" : ""} ${useAspect ? "has-aspect" : ""}`}
        style={useAspect ? { aspectRatio: aspect } : undefined}
      >
        {asset.type === "video" ? (
          loadingInfo || !info ? (
            previewUrl ? (
              <img src={previewUrl} alt="" />
            ) : (
              <div className="insp-noprev">vídeo</div>
            )
          ) : playSrc ? (
            <video src={playSrc} controls autoPlay muted loop playsInline />
          ) : (
            <div className="insp-unsupported">
              {previewUrl && <img src={previewUrl} alt="" />}
              <button
                className="insp-openext"
                onClick={() => openExternal(asset.path).catch(() => revealInExplorer(asset.path))}
              >
                <Icon name="play" size={14} /> {t("insp.openPlayer")}
              </button>
              <span className="insp-codec">
                {info?.video?.codec?.toUpperCase() ?? "Vídeo"} — gere um proxy na Oficina pra tocar aqui
              </span>
            </div>
          )
        ) : asset.type === "audio" ? (
          <AudioPlayer src={origUrl} waveform={previewUrl} autoPlay={false} />
        ) : asset.type === "image" || asset.type === "gif" ? (
          <img src={origUrl} alt="" />
        ) : previewUrl ? (
          <img src={previewUrl} alt="" />
        ) : (
          <div className="insp-noprev">{asset.ext.toUpperCase() || "?"}</div>
        )}
        <button
          className="insp-expand"
          onClick={() => onPreview(asset)}
          title="Tela cheia (espaço)"
        >
          <Icon name="play" size={13} />
        </button>
      </div>

      {renaming ? (
        <input
          className="insp-name-edit"
          autoFocus
          defaultValue={displayName}
          onClick={(e) => e.stopPropagation()}
          onBlur={async (e) => {
            const v = e.target.value.trim();
            await renameAsset(asset.id, v);
            setRenaming(false);
            onMutate();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <div className="insp-name" title="Clique pra renomear" onClick={() => setRenaming(true)}>
          {displayName}
        </div>
      )}

      <Stars value={rating} onChange={changeRating} />

      <div className="insp-actions">
        <button onClick={() => onPreview(asset)}>{t("insp.view")}</button>
        <button onClick={() => revealInExplorer(asset.path)}>{t("insp.explorer")}</button>
        <button onClick={() => navigator.clipboard.writeText(asset.path)}>{t("insp.copyPath")}</button>
        <button onClick={() => navigator.clipboard.writeText(folderPath)}>{t("insp.copyFolder")}</button>
        <button onClick={() => setRenaming(true)}>{t("insp.rename")}</button>
        <button onClick={doDuplicate}>{t("insp.duplicate")}</button>
        <button onClick={doRefreshThumb}>{t("insp.updateThumb")}</button>
        <button onClick={doCustomThumb}>{t("insp.customThumb")}</button>
        {aiAble && <button onClick={() => onFindSimilar(asset)}>{t("insp.findSimilar")}</button>}
      </div>
      <div className="insp-hint">{t("insp.dragHint")}</div>

      {/* Playbook: tipo reconhecido + caminho resumido (determinístico) */}
      {info?.ok && v && info.playbook && (
        <div className="playbook">
          <div className="playbook-kind">
            <Icon name="stack" size={13} /> {info.playbook.kind}
          </div>
          <ul className="playbook-steps">
            {info.playbook.steps.map((s, i) => (
              <li key={i}>{t(s)}</li>
            ))}
          </ul>
        </div>
      )}
      {/* Diagnóstico (selos de saúde) — antes de graduar */}
      {info?.ok && v && <HealthCard info={info} onFix={setFixOp} />}
      {fixOp && info && (
        <FixConfirm fix={fixOp} path={asset.path} info={info} onClose={() => setFixOp(null)} />
      )}
      {/* CST: o coração pro Paulo — 2 nós (IN/OUT) + destino de entrega */}
      {info?.ok && v && <CstCard info={info} />}
      {/* Plano de Color sob medida (IA + vault) — sob demanda */}
      {info?.ok && v && <ColorPlanCard path={asset.path} />}
      {loadingInfo && <div className="insp-loading">Lendo metadados…</div>}

      {/* OFICINA: botões de conserto contextuais */}
      {info?.ok && <Oficina asset={asset} info={info} />}

      {/* Vídeo */}
      {v && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.video")}</div>
          <Row k="Codec" v={[v.codec?.toUpperCase(), v.profile].filter(Boolean).join(" · ")} />
          <Row
            k={t("insp.resolution")}
            v={
              v.width && v.height
                ? (() => {
                    const rot = v.rotation === 90 || v.rotation === 270;
                    const w = rot ? v.height : v.width;
                    const h = rot ? v.width : v.height;
                    return `${w} × ${h}${rot ? ` (${t("insp.oriented")})` : ""}`;
                  })()
                : null
            }
          />
          <Row k="FPS" v={v.fps ? `${v.fps}` : null} />
          <Row k="Bit depth" v={v.bit_depth ? `${v.bit_depth}-bit` : null} />
          <Row k="Chroma" v={v.chroma} />
          <Row k="Bitrate" v={fmtBitrate(v.bitrate)} />
          {v.rotation ? <Row k="Rotação" v={`${v.rotation}°`} /> : null}
        </div>
      )}

      {/* Cor */}
      {v && (v.color_primaries || v.transfer || v.matrix || v.range) && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.color")}</div>
          <Row k="Primaries" v={v.color_primaries} />
          <Row k="Transfer" v={v.transfer} />
          <Row k="Matrix" v={v.matrix} />
          <Row k="Range" v={v.range} />
        </div>
      )}

      {/* Áudio */}
      {a && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.audio")}</div>
          <Row k="Codec" v={a.codec?.toUpperCase()} />
          <Row k="Canais" v={a.channels ? `${a.channels}` : null} />
          <Row k="Sample rate" v={a.sample_rate ? `${(a.sample_rate / 1000).toFixed(1)} kHz` : null} />
          <Row k="Bit depth" v={a.bit_depth ? `${a.bit_depth}-bit` : null} />
        </div>
      )}

      {v && (
        <div className="insp-block">
          <div className="insp-section-title">Câmera</div>
          <Row
            k="Câmera"
            v={[info?.camera?.make, info?.camera?.model].filter(Boolean).join(" ") || null}
          />
          <Row k="Lente" v={info?.camera?.lens} />
          <Row k="ISO" v={info?.camera?.iso} />
          <Row k="Abertura" v={info?.camera?.fnumber} />
          <Row k="Obturador" v={info?.camera?.shutter} />
          <Row k="WB" v={info?.camera?.white_balance} />
          <Row k="Foco" v={info?.camera?.focus} />
          <Row k="Giroscópio" v={info?.has_gyro ? "Sim" : "Não"} />
          <Row k="Data" v={info?.camera?.date} />
        </div>
      )}

      {info?.warnings?.map((w, i) => (
        <div key={i} className="insp-warn">
          {w}
        </div>
      ))}

      {/* Metadados básicos (sempre) */}
      <div className="insp-block">
        <div className="insp-section-title">{t("insp.file")}</div>
        <Row k={t("insp.type")} v={asset.type} />
        <Row k={t("insp.ext")} v={`.${asset.ext}`} />
        <Row k={t("insp.size")} v={fmtSize(asset.size)} />
        {!v && <Row k={t("insp.duration")} v={fmtDur(asset.duration)} />}
        {asset.dominant_color && (
          <div className="meta-row">
            <span className="meta-k">Cor</span>
            <span className="meta-v color-v mono">
              <span className="color-dot" style={{ background: asset.dominant_color }} />
              {asset.dominant_color}
            </span>
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="insp-block">
        <div className="insp-section-title">{t("insp.tags")}</div>
        <div className="tag-list">
          {tags.map((t) => (
            <span key={t.id} className="tag-chip">
              {t.name}
              <button className="tag-x" onClick={() => dropTag(t.id)}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
          {tags.length === 0 && <span className="tag-empty">{t("insp.notags")}</span>}
        </div>
        <input
          className="field"
          placeholder={t("insp.addtag")}
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitTag()}
        />
        {aiAble && (
          <button className="ai-btn" onClick={analyzeAI} disabled={aiBusy}>
            <Icon name="sliders" size={12} />
            {aiBusy ? `${t("plan.busy")}` : t("insp.analyzeAI")}
          </button>
        )}
        {aiErr && <div className="ai-err">{aiErr}</div>}
      </div>

      {/* Coleções */}
      <div className="insp-block">
        <div className="insp-section-title">{t("insp.collections")}</div>
        <div className="tag-list">
          {assetColls.map((cid) => (
            <span key={cid} className="tag-chip coll-chip">
              <Icon name="stack" size={11} />
              {collName(cid)}
              <button className="tag-x" onClick={() => removeColl(cid)}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
          {assetColls.length === 0 && <span className="tag-empty">em nenhuma</span>}
        </div>
        {addingColl ? (
          available.length ? (
            <div className="coll-pick">
              {available.map((c) => (
                <button key={c.id} className="coll-pick-item" onClick={() => addColl(c.id)}>
                  <Icon name="stack" size={13} /> {c.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="tag-empty">crie uma coleção na barra lateral</div>
          )
        ) : (
          <button className="coll-add-btn" onClick={() => setAddingColl(true)}>
            <Icon name="plus" size={12} /> Adicionar a uma coleção
          </button>
        )}
      </div>

      {/* Notas */}
      <div className="insp-block">
        <div className="insp-section-title">{t("insp.notes")}</div>
        <textarea
          className="field notes"
          placeholder="Anotações…"
          value={notes}
          onChange={(e) => setNotesState(e.target.value)}
          onBlur={saveNotes}
        />
      </div>

      <div className="insp-path mono" title={asset.path}>
        {asset.path}
      </div>

      <div className="insp-remove">
        {inTrash ? (
          <button
            className="insp-restore-btn"
            onClick={async () => {
              await trashAsset(asset.id, false);
              onMutate();
              dismiss();
            }}
          >
            <Icon name="inbox" size={13} /> Restaurar da Lixeira
          </button>
        ) : confirmRemove ? (
          <>
            <span className="insp-remove-q">Mover pra Lixeira? (não apaga do disco — dá pra restaurar)</span>
            <div className="insp-remove-row">
              <button className="insp-remove-cancel" onClick={() => setConfirmRemove(false)}>
                Cancelar
              </button>
              <button
                className="insp-remove-go"
                onClick={async () => {
                  await removeAsset(asset.id);
                  onMutate();
                  dismiss();
                }}
              >
                Mover pra Lixeira
              </button>
            </div>
          </>
        ) : (
          <button className="insp-remove-btn" onClick={() => setConfirmRemove(true)}>
            <Icon name="trash" size={13} /> Mover pra Lixeira
          </button>
        )}
      </div>
    </aside>
  );
}
