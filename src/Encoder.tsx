import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icons";
import { PopupButton } from "./Menu";
import { encodeRun, listPresets, savePreset, deletePreset, type Asset, type EncodeOpts, type EncoderPreset } from "./api";
import { useDismiss } from "./useDismiss";

const DEFAULTS: EncodeOpts = {
  container: "", vcodec: "h264", scale: "", fps: null, crf: 20, preset: "medium",
  acodec: "aac", abitrate: 320, deinterlace: false, denoise: false, grayscale: false, flip_h: false, rotate: 0,
};

// Presets prontos (Briefing 3 §3.9).
const BUILTIN: { name: string; opts: EncodeOpts }[] = [
  { name: "VFR→CFR (Samsung Log) · H.265 10-bit 60", opts: { ...DEFAULTS, vcodec: "h265", fps: 60, crf: 18, preset: "fast", abitrate: 256, container: "mp4" } },
  { name: "Editar · ProRes 422 HQ", opts: { ...DEFAULTS, vcodec: "prores_hq", acodec: "pcm", container: "mov" } },
  { name: "Editar · DNxHR HQ", opts: { ...DEFAULTS, vcodec: "dnxhr", acodec: "pcm", container: "mov" } },
  { name: "Entrega · H.265 10-bit", opts: { ...DEFAULTS, vcodec: "h265", crf: 20, preset: "medium", container: "mp4" } },
  { name: "Entrega · H.264 1080p", opts: { ...DEFAULTS, vcodec: "h264", scale: "1080", crf: 18, preset: "medium", container: "mp4" } },
  { name: "Reencapsular (sem recodificar)", opts: { ...DEFAULTS, op: "rewrap", container: "mkv" } },
  { name: "Extrair áudio (WAV)", opts: { ...DEFAULTS, op: "extract_audio" } },
];

// Codificador avançado do PRISMA — estilo HandBrake / Shutter Encoder.
const VCODECS: [string, string][] = [
  ["h264", "H.264 (x264) — universal"],
  ["h265", "H.265 (HEVC) 10-bit"],
  ["av1", "AV1 (SVT) — entrega moderna"],
  ["vp9", "VP9 (WebM)"],
  ["prores", "ProRes 422"],
  ["prores_hq", "ProRes 422 HQ"],
  ["prores_4444", "ProRes 4444 (alpha)"],
  ["dnxhr", "DNxHR HQ"],
  ["copy", "Copiar (sem recodificar vídeo)"],
  ["none", "Sem vídeo (só áudio)"],
];
const CONTAINERS: [string, string][] = [
  ["", "Automático"],
  ["mp4", "MP4"],
  ["mov", "MOV"],
  ["mkv", "MKV"],
  ["webm", "WebM"],
];
const SCALES: [string, string][] = [
  ["", "Original"],
  ["uhd", "4K (2160p)"],
  ["1440", "1440p"],
  ["1080", "1080p"],
  ["720", "720p"],
  ["480", "480p"],
];
const FPSES: [string, string][] = [
  ["", "Original"],
  ["23.976", "23.976"],
  ["24", "24"],
  ["25", "25"],
  ["30", "30"],
  ["50", "50"],
  ["60", "60"],
];
const PRESETS: [string, string][] = [
  ["veryfast", "Rápido"],
  ["medium", "Médio (recomendado)"],
  ["slow", "Lento (mais qualidade)"],
  ["veryslow", "Muito lento (máxima)"],
];
const ACODECS: [string, string][] = [
  ["aac", "AAC"],
  ["copy", "Copiar original"],
  ["opus", "Opus"],
  ["mp3", "MP3"],
  ["flac", "FLAC (sem perdas)"],
  ["pcm", "PCM/WAV (sem perdas)"],
  ["none", "Sem áudio"],
];

const usesCrf = (v: string) => ["h264", "h265", "av1", "vp9"].includes(v);

export function Encoder({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { closing, dismiss } = useDismiss(onClose);
  const [o, setO] = useState<EncodeOpts>({
    container: "",
    vcodec: "h264",
    scale: "",
    fps: null,
    crf: 20,
    preset: "medium",
    acodec: "aac",
    abitrate: 320,
    deinterlace: false,
    denoise: false,
    grayscale: false,
    flip_h: false,
    rotate: 0,
  });
  const set = (patch: Partial<EncodeOpts>) => setO((p) => ({ ...p, ...patch }));
  const vcodec = o.vcodec || "h264";

  const [presets, setPresets] = useState<EncoderPreset[]>([]);
  const [presetSel, setPresetSel] = useState("");
  useEffect(() => {
    listPresets().then(setPresets).catch(() => {});
  }, []);

  const applyPreset = (key: string) => {
    setPresetSel(key);
    if (key.startsWith("b:")) {
      const b = BUILTIN[Number(key.slice(2))];
      if (b) setO({ ...b.opts });
    } else if (key.startsWith("u:")) {
      const u = presets.find((p) => p.id === Number(key.slice(2)));
      if (u) {
        try {
          setO({ ...DEFAULTS, ...JSON.parse(u.opts) });
        } catch {
          /* noop */
        }
      }
    }
  };
  const doSavePreset = async () => {
    const name = window.prompt("Nome do preset:");
    if (!name?.trim()) return;
    await savePreset(name.trim(), JSON.stringify(o));
    setPresets(await listPresets());
  };
  const doDeletePreset = async () => {
    if (!presetSel.startsWith("u:")) return;
    await deletePreset(Number(presetSel.slice(2)));
    setPresets(await listPresets());
    setPresetSel("");
  };

  const start = (op?: string) => {
    encodeRun(asset.path, { ...o, op: op ?? o.op ?? null });
    dismiss();
  };
  const pickLut = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: "LUT", extensions: ["cube", "3dl"] }] });
    if (typeof f === "string") set({ lut_path: f });
  };
  const pickWatermark = async () => {
    const f = await openDialog({ multiple: false, filters: [{ name: "Imagem", extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof f === "string") {
      encodeRun(asset.path, { ...o, op: "watermark", watermark_path: f });
      dismiss();
    }
  };
  const lutName = o.lut_path ? o.lut_path.split(/[\\/]/).pop() : null;

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`enc-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="sliders" size={16} /> Codificar — {asset.filename}
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="enc-body">
          <div className="enc-presets">
            <span className="enc-field-label">Preset</span>
            <PopupButton
              value={presetSel}
              options={[
                ["", "— escolher —"],
                ...BUILTIN.map((b, i) => [`b:${i}`, b.name] as [string, string]),
                ...presets.map((p) => [`u:${p.id}`, `★ ${p.name}`] as [string, string]),
              ]}
              onChange={applyPreset}
              placeholder="Preset"
            />
            <button className="enc-preset-btn" onClick={doSavePreset}>Salvar atual</button>
            {presetSel.startsWith("u:") && (
              <button className="enc-preset-btn" onClick={doDeletePreset}>Excluir</button>
            )}
          </div>

          {/* Operações rápidas */}
          <div className="enc-quick">
            <button className="enc-quick-btn" onClick={() => start("rewrap")} title="Troca o container sem recodificar (instantâneo, sem perda)">
              <Icon name="refresh" size={13} /> Reencapsular (sem perda)
            </button>
            <button className="enc-quick-btn" onClick={() => start("extract_audio")}>
              <Icon name="audio" size={13} /> Extrair áudio (WAV)
            </button>
            <button
              className="enc-quick-btn"
              onClick={() => {
                encodeRun(asset.path, { ...o, op: "loudnorm", lufs: -14 });
                dismiss();
              }}
            >
              <Icon name="audio" size={13} /> Normalizar áudio (-14 LUFS)
            </button>
            <button className="enc-quick-btn" onClick={pickWatermark}>
              <Icon name="image" size={13} /> Marca d'água (PNG)…
            </button>
          </div>

          <div className="enc-grid">
            <Field label="Container">
              <PopupButton value={o.container || ""} options={CONTAINERS} onChange={(v) => set({ container: v })} />
            </Field>
            <Field label="Codec de vídeo">
              <PopupButton value={vcodec} options={VCODECS} onChange={(v) => set({ vcodec: v })} />
            </Field>
            <Field label="Resolução">
              <PopupButton value={o.scale || ""} options={SCALES} onChange={(v) => set({ scale: v })} />
            </Field>
            <Field label="Frame rate">
              <PopupButton
                value={o.fps ? String(o.fps) : ""}
                options={FPSES}
                onChange={(v) => set({ fps: v ? Number(v) : null })}
              />
            </Field>
            {usesCrf(vcodec) && (
              <>
                <Field label="Preset">
                  <PopupButton value={o.preset || "medium"} options={PRESETS} onChange={(v) => set({ preset: v })} />
                </Field>
                <Field label={`Qualidade (CRF ${o.crf}) — menor = melhor`}>
                  <input
                    className="enc-range"
                    type="range"
                    min={0}
                    max={40}
                    value={o.crf ?? 20}
                    onChange={(e) => set({ crf: Number(e.target.value) })}
                  />
                </Field>
              </>
            )}
            <Field label="Áudio">
              <PopupButton value={o.acodec || "aac"} options={ACODECS} onChange={(v) => set({ acodec: v })} />
            </Field>
            <Field label="Rotação">
              <PopupButton
                value={String(o.rotate ?? 0)}
                options={[["0", "0°"], ["90", "90°"], ["180", "180°"], ["270", "270°"]]}
                onChange={(v) => set({ rotate: Number(v) })}
              />
            </Field>
          </div>

          <div className="enc-filters">
            <span className="enc-filters-label">Filtros</span>
            <Check label="Desentrelaçar" on={!!o.deinterlace} onClick={() => set({ deinterlace: !o.deinterlace })} />
            <Check label="Reduzir ruído" on={!!o.denoise} onClick={() => set({ denoise: !o.denoise })} />
            <Check label="Preto & Branco" on={!!o.grayscale} onClick={() => set({ grayscale: !o.grayscale })} />
            <Check label="Espelhar (flip H)" on={!!o.flip_h} onClick={() => set({ flip_h: !o.flip_h })} />
          </div>

          <div className="enc-advanced">
            <div className="enc-adv-row">
              <span className="enc-field-label">Trim (corte sem recodificar)</span>
              <input className="field enc-num" type="number" placeholder="entra (s)" value={o.trim_in ?? ""} onChange={(e) => set({ trim_in: e.target.value ? Number(e.target.value) : null })} />
              <input className="field enc-num" type="number" placeholder="sai (s)" value={o.trim_out ?? ""} onChange={(e) => set({ trim_out: e.target.value ? Number(e.target.value) : null })} />
              <button className="enc-preset-btn" onClick={() => start("trim")} disabled={o.trim_in == null && o.trim_out == null}>Cortar</button>
            </div>
            <div className="enc-adv-row">
              <span className="enc-field-label">Velocidade</span>
              <input className="field enc-num" type="number" step="0.25" placeholder="1.0" value={o.speed ?? ""} onChange={(e) => set({ speed: e.target.value ? Number(e.target.value) : null })} />
              <span className="enc-adv-hint">0.5 = metade · 2 = dobro (aplica ao codificar)</span>
            </div>
            <div className="enc-adv-row">
              <span className="enc-field-label">LUT (.cube)</span>
              <button className="enc-preset-btn" onClick={pickLut}>{lutName ? `✓ ${lutName}` : "Escolher LUT…"}</button>
              {o.lut_path && <button className="enc-preset-btn" onClick={() => set({ lut_path: null })}>Remover</button>}
              <span className="enc-adv-hint">queima o look ao codificar</span>
            </div>
          </div>
        </div>

        <div className="dup-foot">
          <button className="dup-cancel" onClick={dismiss}>Cancelar</button>
          <button className="dup-apply" onClick={() => start()}>Codificar</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="enc-field">
      <span className="enc-field-label">{label}</span>
      {children}
    </label>
  );
}

function Check({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={`enc-check ${on ? "on" : ""}`} onClick={onClick}>
      <span className="enc-box">{on && <Icon name="check" size={11} />}</span>
      {label}
    </button>
  );
}
