import { memo, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icons";
import { quartzoOn } from "./prefs";
import { Oficina } from "./Oficina";
import { AudioPlayer } from "./AudioPlayer";
import { CstCard } from "./CstCard";
import { HealthCard } from "./HealthCard";
import { FixConfirm } from "./FixConfirm";
import { ColorPlanCard } from "./ColorPlanCard";
import { useDismiss } from "./useDismiss";
import { fireTip } from "./tips";
import { extractPalette, type Swatch } from "./palette";
import { t } from "./i18n";
import { getProxy, renameAsset, duplicateAsset, refreshThumb, setCustomThumb } from "./api";

// Codecs que o WebView decodifica. ProRes/DNxHR ficam de fora → prévia no player externo.
const WEB_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1", "avc1"]);
// O WebView (Chromium) só toca codec web E container web. .mov/.avi/.mkv etc. NÃO tocam
// nem com h264 → precisam de proxy (.mp4). Sem isto, o preview virava caixa preta vazia.
const WEB_CONTAINERS = new Set(["mp4", "webm", "m4v", "ogv", "ogg"]);
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
  aiAskImage,
  aiUpscale,
  aiRemoveBg,
  openExternal,
  quartzoNotes,
  quartzoAttach,
  quartzoNotesForAsset,
  quartzoOpenNote,
  velvetApplyCst,
  type QuartzoNote,
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

function InspectorImpl({
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
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [assetColls, setAssetColls] = useState<number[]>([]);
  const [addingColl, setAddingColl] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  // AI Action (plugin do Eagle): pergunta livre sobre a imagem.
  const [askOpen, setAskOpen] = useState(false);
  const [askQ, setAskQ] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askErr, setAskErr] = useState<string | null>(null);
  // AI Image Enlarger (Real-ESRGAN)
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState<string | null>(null);
  // AI Background Remover (u2netp)
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState<string | null>(null);
  // VELVET: aplicar CST no DaVinci (gera o request da arvore de nos).
  const [velvetMsg, setVelvetMsg] = useState<string | null>(null);
  const [velvetBusy, setVelvetBusy] = useState(false);
  // Quartzo (PKM nosso): notas ligadas ao asset + anexar a uma nota.
  // A seção só aparece se a integração estiver LIGADA em Configurações (opcional).
  const [showQz, setShowQz] = useState(quartzoOn());
  useEffect(() => {
    const sync = () => setShowQz(quartzoOn());
    window.addEventListener("prefs-changed", sync);
    return () => window.removeEventListener("prefs-changed", sync);
  }, []);
  const [qzOpen, setQzOpen] = useState(false);
  const [qzNotes, setQzNotes] = useState<QuartzoNote[]>([]);
  const [qzLinked, setQzLinked] = useState<QuartzoNote[]>([]);
  const [qzTarget, setQzTarget] = useState("");
  const [qzMsg, setQzMsg] = useState<string | null>(null);

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
  const collName = (id: number) => collections.find((c) => c.id === id)?.name ?? t("insp.collFallback");
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
  const doAsk = async (preset?: string) => {
    const q = (preset ?? askQ).trim();
    if (!q) return;
    setAskBusy(true);
    setAskErr(null);
    setAskAnswer(null);
    try {
      const ans = await aiAskImage(asset.id, q);
      setAskAnswer(ans);
    } catch (e) {
      const msg = String(e);
      setAskErr(msg);
      if (msg.toLowerCase().includes("chave")) onOpenSettings();
    } finally {
      setAskBusy(false);
    }
  };
  const openQuartzo = async () => {
    const next = !qzOpen;
    setQzOpen(next);
    if (next) {
      setQzMsg(null);
      try {
        const [all, linked] = await Promise.all([
          quartzoNotes(),
          quartzoNotesForAsset(asset.id),
        ]);
        setQzNotes(all);
        setQzLinked(linked);
      } catch (e) {
        setQzMsg(String(e));
      }
    }
  };
  const doAttach = async () => {
    const target = qzTarget.trim();
    if (!target) return;
    setQzMsg(null);
    try {
      await quartzoAttach(asset.id, target);
      setQzMsg(t("insp.qzAttached").replace("{note}", target));
      setQzLinked(await quartzoNotesForAsset(asset.id));
      setQzTarget("");
    } catch (e) {
      setQzMsg(String(e));
    }
  };
  const doUpscale = async () => {
    setUpBusy(true);
    setUpMsg(t("insp.upscaleBusy"));
    try {
      await aiUpscale(asset.id);
      setUpMsg(t("insp.upscaleDone"));
      onMutate();
    } catch (e) {
      setUpMsg(`${t("common.error")}: ${String(e)}`);
    } finally {
      setUpBusy(false);
    }
  };
  const doRemoveBg = async () => {
    setBgBusy(true);
    setBgMsg(t("insp.bgBusy"));
    try {
      await aiRemoveBg(asset.id);
      setBgMsg(t("insp.bgDone"));
      onMutate();
    } catch (e) {
      setBgMsg(`${t("common.error")}: ${String(e)}`);
    } finally {
      setBgBusy(false);
    }
  };
  const doVelvetApply = async () => {
    setVelvetBusy(true);
    setVelvetMsg(null);
    try {
      const r = await velvetApplyCst(asset.id);
      setVelvetMsg(t("velvet.applyDone").replace("{n}", String(r.nodes)));
    } catch (e) {
      setVelvetMsg(`${t("common.error")}: ${String(e)}`);
    } finally {
      setVelvetBusy(false);
    }
  };
  const aiAble = ["image", "gif", "video"].includes(asset.type);
  const upscalable = asset.type === "image";
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
  const videoPlayable =
    !!v?.codec &&
    WEB_VIDEO_CODECS.has(v.codec.toLowerCase()) &&
    WEB_CONTAINERS.has(asset.ext.toLowerCase());
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

  // Quando um job da Oficina OU um proxy automático termina, busca o proxy deste asset
  // e passa a tocar (vídeos de codec/container que o WebView não decodifica — ex.: .mov).
  useEffect(() => {
    const uns: Array<() => void> = [];
    const refresh = () => {
      getProxy(asset.path).then((p) => {
        if (p) setLocalProxy(convertFileSrc(p));
      });
    };
    // já tenta na montagem (o proxy pode já existir do import)
    refresh();
    listen("oficina:done", refresh).then((u) => uns.push(u));
    listen("proxy:made", refresh).then((u) => uns.push(u));
    listen("proxy:done", refresh).then((u) => uns.push(u));
    return () => uns.forEach((u) => u());
  }, [asset.path]);

  // Paleta de cores automática (designer) — extraída da MINIATURA no front, não-destrutivo.
  useEffect(() => {
    if (!previewUrl) {
      setPalette([]);
      return;
    }
    extractPalette(previewUrl, 6).then(setPalette);
  }, [previewUrl]);
  const copyHex = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    window.setTimeout(() => setCopiedHex((c) => (c === hex ? null : c)), 1100);
  };

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
          <>
            {/* miniatura SEMPRE como base — nunca fica caixa preta */}
            {previewUrl ? (
              <img src={previewUrl} className="insp-base" alt="" />
            ) : (
              <div className="insp-noprev">{t("insp.videoFallback")}</div>
            )}
            {/* vídeo por cima quando há fonte tocável (original web, ou proxy .mp4) */}
            {playSrc && (
              <video
                key={playSrc}
                className="insp-video-over"
                src={playSrc}
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            )}
            {/* sem fonte tocável (ex.: .mov/HEVC sem proxy ainda) → ações sobre a miniatura */}
            {!playSrc && !loadingInfo && info && (
              <div className="insp-unsupported-over">
                <button
                  className="insp-openext"
                  onClick={() => openExternal(asset.path).catch(() => revealInExplorer(asset.path))}
                >
                  <Icon name="play" size={14} /> {t("insp.openPlayer")}
                </button>
                <span className="insp-codec">
                  {t("insp.needProxy").replace("{codec}", info?.video?.codec?.toUpperCase() ?? t("insp.videoGeneric"))}
                </span>
              </div>
            )}
          </>
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
          title={t("insp.fullscreen")}
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
        <div className="insp-name" title={t("insp.renameHint")} onClick={() => setRenaming(true)}>
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

      {/* Paleta de cores (designer) — clique numa cor pra copiar o HEX */}
      {palette.length > 0 && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.palette")}</div>
          <div className="insp-palette">
            {palette.map((s) => (
              <button
                key={s.hex}
                className="insp-swatch"
                style={{ background: s.hex }}
                title={s.hex}
                onClick={() => copyHex(s.hex)}
              >
                <span className="insp-swatch-hex">{copiedHex === s.hex ? t("common.copied") : s.hex}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
      {/* VELVET: aplicar a árvore de nós (CST + Exposição/Balanço/Saturação/Curva + VELVET) no DaVinci */}
      {info?.ok && v && (
        <div className="velvet-apply">
          <button className="ai-btn velvet-btn" onClick={doVelvetApply} disabled={velvetBusy}>
            <Icon name="sparkles" size={12} />
            {velvetBusy ? t("velvet.applyBusy") : t("velvet.apply")}
          </button>
          {velvetMsg && <div className="qz-msg">{velvetMsg}</div>}
          <div className="velvet-hint">{t("velvet.applyHint")}</div>
        </div>
      )}
      {/* Plano de Color sob medida (IA + vault) — sob demanda */}
      {info?.ok && v && <ColorPlanCard path={asset.path} />}
      {loadingInfo && <div className="insp-loading">{t("insp.readingMeta")}</div>}

      {/* OFICINA: botões de conserto contextuais */}
      {info?.ok && <Oficina asset={asset} info={info} />}

      {/* Vídeo */}
      {v && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.video")}</div>
          <Row k={t("insp.k.codec")} v={[v.codec?.toUpperCase(), v.profile].filter(Boolean).join(" · ")} />
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
          <Row k={t("insp.k.fps")} v={v.fps ? `${v.fps}` : null} />
          <Row k={t("insp.k.bitDepth")} v={v.bit_depth ? `${v.bit_depth}-bit` : null} />
          <Row k={t("insp.k.chroma")} v={v.chroma} />
          <Row k={t("insp.k.bitrate")} v={fmtBitrate(v.bitrate)} />
          {v.rotation ? <Row k={t("insp.k.rotation")} v={`${v.rotation}°`} /> : null}
        </div>
      )}

      {/* Cor */}
      {v && (v.color_primaries || v.transfer || v.matrix || v.range) && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.color")}</div>
          <Row k={t("insp.k.primaries")} v={v.color_primaries} />
          <Row k={t("insp.k.transfer")} v={v.transfer} />
          <Row k={t("insp.k.matrix")} v={v.matrix} />
          <Row k={t("insp.k.range")} v={v.range} />
        </div>
      )}

      {/* Áudio */}
      {a && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.audio")}</div>
          <Row k={t("insp.k.codec")} v={a.codec?.toUpperCase()} />
          <Row k={t("insp.k.channels")} v={a.channels ? `${a.channels}` : null} />
          <Row k={t("insp.k.sampleRate")} v={a.sample_rate ? `${(a.sample_rate / 1000).toFixed(1)} kHz` : null} />
          <Row k={t("insp.k.bitDepth")} v={a.bit_depth ? `${a.bit_depth}-bit` : null} />
        </div>
      )}

      {v && (
        <div className="insp-block">
          <div className="insp-section-title">{t("insp.camera")}</div>
          <Row
            k={t("insp.k.camera")}
            v={[info?.camera?.make, info?.camera?.model].filter(Boolean).join(" ") || null}
          />
          <Row k={t("insp.k.lens")} v={info?.camera?.lens} />
          <Row k={t("insp.k.iso")} v={info?.camera?.iso} />
          <Row k={t("insp.k.aperture")} v={info?.camera?.fnumber} />
          <Row k={t("insp.k.shutter")} v={info?.camera?.shutter} />
          <Row k={t("insp.k.wb")} v={info?.camera?.white_balance} />
          <Row k={t("insp.k.focus")} v={info?.camera?.focus} />
          <Row k={t("insp.k.gyro")} v={info?.has_gyro ? t("insp.yes") : t("insp.no")} />
          <Row k={t("insp.k.date")} v={info?.camera?.date} />
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
            <span className="meta-k">{t("insp.colorLabel")}</span>
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

        {/* AI Action: perguntar livremente sobre a imagem */}
        {aiAble && (
          <div className="ai-ask">
            <button className="ai-btn ai-ask-toggle" onClick={() => setAskOpen((o) => !o)}>
              <Icon name="sparkles" size={12} /> {t("insp.aiAsk")}
            </button>
            {askOpen && (
              <div className="ai-ask-panel">
                <div className="ai-ask-presets">
                  <button onClick={() => doAsk(t("insp.aiAskDescribe"))} disabled={askBusy}>
                    {t("insp.aiAskDescribeBtn")}
                  </button>
                  <button onClick={() => doAsk(t("insp.aiAskText"))} disabled={askBusy}>
                    {t("insp.aiAskTextBtn")}
                  </button>
                  <button onClick={() => doAsk(t("insp.aiAskName"))} disabled={askBusy}>
                    {t("insp.aiAskNameBtn")}
                  </button>
                </div>
                <input
                  className="field"
                  placeholder={t("insp.aiAskPlaceholder")}
                  value={askQ}
                  onChange={(e) => setAskQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doAsk()}
                />
                {askBusy && <div className="insp-loading">{t("plan.busy")}</div>}
                {askErr && <div className="ai-err">{askErr}</div>}
                {askAnswer && <div className="ai-ask-answer">{askAnswer}</div>}
              </div>
            )}
          </div>
        )}

        {/* AI Image Enlarger (Real-ESRGAN): amplia a imagem 4x */}
        {upscalable && (
          <>
            <button className="ai-btn" onClick={doUpscale} disabled={upBusy}>
              <Icon name="sparkles" size={12} /> {upBusy ? t("insp.upscaleBusy") : t("insp.upscale")}
            </button>
            {upMsg && <div className="qz-msg">{upMsg}</div>}
            <button className="ai-btn" onClick={doRemoveBg} disabled={bgBusy}>
              <Icon name="sparkles" size={12} /> {bgBusy ? t("insp.bgBusy") : t("insp.bg")}
            </button>
            {bgMsg && <div className="qz-msg">{bgMsg}</div>}
          </>
        )}
      </div>

      {/* Quartzo (PKM nosso): ligar este asset às suas notas. Opcional — ligado em Configurações. */}
      {showQz && (
      <div className="insp-block">
        <button className="insp-section-title qz-head" onClick={openQuartzo}>
          <Icon name="stack" size={13} /> {t("insp.quartzo")}
          <Icon name={qzOpen ? "chevronUpDown" : "chevronRight"} size={12} />
        </button>
        {qzOpen && (
          <div className="qz-panel">
            <div className="qz-hint">{t("insp.quartzoHint")}</div>
            {qzLinked.length > 0 && (
              <div className="qz-linked">
                <div className="qz-sub">{t("insp.quartzoLinked")}</div>
                {qzLinked.map((n) => (
                  <button key={n.rel} className="qz-note" onClick={() => quartzoOpenNote(n.rel)} title={n.rel}>
                    <Icon name="document" size={12} /> {n.name}
                  </button>
                ))}
              </div>
            )}
            <input
              className="field"
              placeholder={t("insp.quartzoAttachPh")}
              value={qzTarget}
              list="qz-notes-list"
              onChange={(e) => setQzTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doAttach()}
            />
            <datalist id="qz-notes-list">
              {qzNotes.map((n) => (
                <option key={n.rel} value={n.rel}>
                  {n.name}
                </option>
              ))}
            </datalist>
            <button className="ai-btn" onClick={doAttach} disabled={!qzTarget.trim()}>
              <Icon name="plus" size={12} /> {t("insp.quartzoAttach")}
            </button>
            {qzMsg && <div className="qz-msg">{qzMsg}</div>}
          </div>
        )}
      </div>
      )}

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
          {assetColls.length === 0 && <span className="tag-empty">{t("insp.noCollection")}</span>}
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
            <div className="tag-empty">{t("insp.createCollHint")}</div>
          )
        ) : (
          <button className="coll-add-btn" onClick={() => setAddingColl(true)}>
            <Icon name="plus" size={12} /> {t("insp.addToCollection")}
          </button>
        )}
      </div>

      {/* Notas */}
      <div className="insp-block">
        <div className="insp-section-title">{t("insp.notes")}</div>
        <textarea
          className="field notes"
          placeholder={t("insp.notesPlaceholder")}
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
            <Icon name="inbox" size={13} /> {t("insp.restore")}
          </button>
        ) : confirmRemove ? (
          <>
            <span className="insp-remove-q">{t("insp.trashConfirm")}</span>
            <div className="insp-remove-row">
              <button className="insp-remove-cancel" onClick={() => setConfirmRemove(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="insp-remove-go"
                onClick={async () => {
                  await removeAsset(asset.id);
                  onMutate();
                  dismiss();
                }}
              >
                {t("insp.toTrash")}
              </button>
            </div>
          </>
        ) : (
          <button className="insp-remove-btn" onClick={() => setConfirmRemove(true)}>
            <Icon name="trash" size={13} /> {t("insp.toTrash")}
          </button>
        )}
      </div>
    </aside>
  );
}

// Memoizado: não re-renderiza o painel enquanto o usuário rola/filtra o grid (mesmo asset).
export const Inspector = memo(InspectorImpl);
