import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { Encoder } from "./Encoder";
import { PopupButton } from "./Menu";
import { oficinaRun, type Asset, type MediaInfo, type JobOpts } from "./api";
import { fireTip } from "./tips";

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
        <Icon name="sliders" size={13} /> Oficina
      </div>

      {isVideo && (
        <button className="of-btn of-wide of-encoder" disabled={!!busy} onClick={() => setEncoder(true)}>
          <Icon name="sliders" size={13} /> Codificar avançado (codec, resolução, FPS, áudio, filtros…)
        </button>
      )}
      {encoder && <Encoder asset={asset} onClose={() => setEncoder(false)} />}

      {v?.vfr && (
        <div className="oficina-alert">
          <div className="oficina-alert-msg">
            <b>VFR</b> — frame rate variável vai dessincronizar o áudio no DaVinci.
          </div>
          <div className="oficina-row">
            <button className="of-btn of-fix" disabled={!!busy} onClick={() => run("vfr_cfr")}>
              Consertar pra CFR (H.265 10-bit)
            </button>
            <button className="of-btn" disabled={!!busy} onClick={() => run("vfr_cfr", { codec: "prores" })} title="Qualidade máxima pra grade">
              ProRes
            </button>
          </div>
        </div>
      )}

      {isVideo && (
        <div className="oficina-group">
          <div className="oficina-label">Transcodificar — pra editar/gradar</div>
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
          <div className="oficina-label">Pra entregar</div>
          <div className="oficina-row">
            <button className="of-btn" disabled={!!busy} onClick={() => run("h265")}>
              H.265 10-bit
            </button>
            <button className="of-btn" disabled={!!busy} onClick={() => run("reels")}>
              Reels 1080×1920
            </button>
          </div>
        </div>
      )}

      {isVideo && !asset.proxy_path && (
        <button className="of-btn of-wide" disabled={!!busy} onClick={() => run("proxy")}>
          <Icon name="play" size={13} /> Gerar proxy (preview leve / scrub liso)
        </button>
      )}

      {isImage && (
        <div className="oficina-group">
          <div className="oficina-label">Converter imagem — salva em CONVERTIDO/</div>
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
            <Icon name="motionsilk" size={15} /> Giroscópio detectado — estabilização <b>MotionSilk</b> (embutida).
          </div>
          <label className="of-slider">
            <span>Suavidade</span>
            <input type="range" min={0} max={100} value={smooth} onChange={(e) => setSmooth(Number(e.target.value))} />
            <span className="of-slider-val">{smooth}%</span>
          </label>

          <button className="of-gyro-adv" onClick={() => setGyroAdv((a) => !a)}>
            {gyroAdv ? "▾" : "▸"} Avançado (FOV, horizonte, lente, codec)
          </button>
          {gyroAdv && (
            <div className="of-gyro-panel">
              <label className="of-slider">
                <span>Zoom/FOV</span>
                <input type="range" min={50} max={150} value={fov} onChange={(e) => setFov(Number(e.target.value))} />
                <span className="of-slider-val">{(fov / 100).toFixed(2)}×</span>
              </label>
              <label className="of-slider">
                <span>Travar horizonte</span>
                <input type="range" min={0} max={100} value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} />
                <span className="of-slider-val">{horizon}%</span>
              </label>
              <label className="of-slider">
                <span>Correção da lente</span>
                <input type="range" min={0} max={100} value={lens} onChange={(e) => setLens(Number(e.target.value))} />
                <span className="of-slider-val">{lens}%</span>
              </label>
              <div className="of-gyro-codec">
                <span>Codec do render</span>
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
            <Icon name="motionsilk" size={14} /> Estabilizar (MotionSilk)
          </button>
        </div>
      )}
    </div>
  );
}
