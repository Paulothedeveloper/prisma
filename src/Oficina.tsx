import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { Encoder } from "./Encoder";
import { PopupButton } from "./Menu";
import { oficinaRun, type Asset, type MediaInfo, type JobOpts } from "./api";
import { fireTip } from "./tips";
import { t } from "./i18n";

// OFICINA: os botões de conserto aparecem SÓ quando fazem sentido pro que o leitor detectou.
const IMG_FORMATS: [string, string][] = [
  ["png", "PNG"],
  ["jpg", "JPG"],
  ["webp", "WebP"],
  ["tiff", "TIFF"],
];

export function Oficina({ asset, info }: { asset: Asset; info: MediaInfo }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [smooth, setSmooth] = useState(80);
  const [osmooth, setOsmooth] = useState(50); // suavidade da estabilização óptica (sem gyro)
  const [fov, setFov] = useState(100); // 100 = 1.0
  const [horizon, setHorizon] = useState(0);
  const [lens, setLens] = useState(0);
  const [gcodec, setGcodec] = useState("h265");
  const [gyroAdv, setGyroAdv] = useState(false);
  const [encoder, setEncoder] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => fireTip("oficina", rootRef.current), 400);
    return () => clearTimeout(t);
  }, []);
  const v = info.video;
  const isVideo = asset.type === "video";
  const isImage = asset.type === "image" || asset.type === "gif";
  if (!isVideo && !info.has_gyro && !isImage) return null;

  const run = async (op: string, opts: JobOpts = {}) => {
    setBusy(op);
    try {
      await oficinaRun(op, asset.path, opts);
    } finally {
      setTimeout(() => setBusy(null), 600);
    }
  };

  return (
    <div className="oficina" ref={rootRef}>
      <div className="insp-section-title oficina-title">
        <Icon name="sliders" size={13} /> {t("ofi.title")}
      </div>

      {isVideo && (
        <button className="of-btn of-wide of-encoder" disabled={!!busy} onClick={() => setEncoder(true)}>
          <Icon name="sliders" size={13} /> {t("ofi.encodeAdvanced")}
        </button>
      )}
      {encoder && <Encoder asset={asset} onClose={() => setEncoder(false)} />}

      {v?.vfr && (
        <div className="oficina-alert">
          <div className="oficina-alert-msg">
            <b>VFR</b> — {t("ofi.vfrMsg")}
          </div>
          <div className="oficina-row">
            <button className="of-btn of-fix" disabled={!!busy} onClick={() => run("vfr_cfr")}>
              {t("ofi.fixCfr")}
            </button>
            <button className="of-btn" disabled={!!busy} onClick={() => run("vfr_cfr", { codec: "prores" })} title={t("ofi.proresMaxQuality")}>
              ProRes
            </button>
          </div>
        </div>
      )}

      {isVideo && (
        <div className="oficina-group">
          <div className="oficina-label">{t("ofi.transcode")}</div>
          <div className="oficina-row">
            <button className="of-btn" disabled={!!busy} onClick={() => run("prores")}>
              ProRes 422 HQ
            </button>
            <button className="of-btn" disabled={!!busy} onClick={() => run("dnxhr")}>
              DNxHR HQ
            </button>
          </div>
        </div>
      )}

      {isVideo && (
        <div className="oficina-group">
          <div className="oficina-label">{t("ofi.deliver")}</div>
          <div className="oficina-row">
            <button className="of-btn" disabled={!!busy} onClick={() => run("h265")}>
              H.265 10-bit
            </button>
            <button className="of-btn" disabled={!!busy} onClick={() => run("reels")}>
              {t("ofi.reels")}
            </button>
          </div>
        </div>
      )}

      {isVideo && !asset.proxy_path && (
        <button className="of-btn of-wide" disabled={!!busy} onClick={() => run("proxy")}>
          <Icon name="play" size={13} /> {t("ofi.genProxy")}
        </button>
      )}

      {/* Estabilização ÓPTICA (sem giroscópio) — funciona em qualquer vídeo. */}
      {isVideo && (
        <div className="oficina-group">
          <div className="oficina-label">{t("ofi.stabOptical")}</div>
          <label className="of-slider">
            <span>{t("ofi.smoothness")}</span>
            <input type="range" min={0} max={100} value={osmooth} onChange={(e) => setOsmooth(Number(e.target.value))} />
            <span className="of-slider-val">{osmooth}%</span>
          </label>
          <button
            className="of-btn of-wide of-fix"
            disabled={!!busy}
            onClick={() => run("stabilize_optical", { smoothness: osmooth / 100 })}
          >
            <Icon name="motionsilk" size={14} /> {busy === "stabilize_optical" ? t("ofi.stabilizing") : t("ofi.stabOpticalBtn")}
          </button>
        </div>
      )}

      {isImage && (
        <div className="oficina-group">
          <div className="oficina-label">{t("ofi.convertImage")}</div>
          <div className="oficina-row">
            {IMG_FORMATS.map(([fmt, lbl]) =>
              asset.ext.toLowerCase() === fmt ? null : (
                <button
                  key={fmt}
                  className="of-btn"
                  disabled={!!busy}
                  onClick={() => run(`convert:${fmt}`)}
                >
                  {lbl}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {info.has_gyro && (
        <div className="oficina-group">
          <div className="oficina-alert-msg of-motionsilk">
            <Icon name="motionsilk" size={15} /> {t("ofi.gyroDetected")} <b>MotionSilk</b> {t("ofi.gyroEmbedded")}
          </div>
          <label className="of-slider">
            <span>{t("ofi.smoothness")}</span>
            <input type="range" min={0} max={100} value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} />
            <span className="of-slider-val">{smooth}%</span>
          </label>

          <button className="of-gyro-adv" onClick={() => setGyroAdv((a) => !a)}>
            {gyroAdv ? "▾" : "▸"} {t("ofi.advanced")}
          </button>
          {gyroAdv && (
            <div className="of-gyro-panel">
              <label className="of-slider">
                <span>{t("ofi.zoomFov")}</span>
                <input type="range" min={50} max={150} value={fov} onChange={(e) => setFov(Number(e.target.value))} />
                <span className="of-slider-val">{(fov / 100).toFixed(2)}×</span>
              </label>
              <label className="of-slider">
                <span>{t("ofi.lockHorizon")}</span>
                <input type="range" min={0} max={100} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} />
                <span className="of-slider-val">{horizon}%</span>
              </label>
              <label className="of-slider">
                <span>{t("ofi.lensCorrection")}</span>
                <input type="range" min={0} max={100} value={lens} onChange={(e) => setLens(Number(e.target.value))} />
                <span className="of-slider-val">{lens}%</span>
              </label>
              <div className="of-gyro-codec">
                <span>{t("ofi.renderCodec")}</span>
                <PopupButton
                  value={gcodec}
                  options={[["h265", "H.265 10-bit"], ["h264", "H.264"], ["prores", "ProRes"]]}
                  onChange={setGcodec}
                />
              </div>
            </div>
          )}

          <button
            className="of-btn of-wide of-fix"
            disabled={!!busy}
            onClick={() =>
              run("stabilize", {
                smoothness: smooth / 100,
                fov: fov / 100,
                horizon_lock: horizon,
                lens_correction: lens,
                gyro_codec: gcodec,
              })
            }
          >
            <Icon name="motionsilk" size={14} /> {t("ofi.stabilize")}
          </button>
        </div>
      )}
    </div>
  );
}
