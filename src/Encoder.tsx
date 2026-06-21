import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icons";
import { PopupButton } from "./Menu";
import { encodeRun, listPresets, savePreset, deletePreset, type Asset, type EncodeOpts, type EncoderPreset } from "./api";
import { useDismiss } from "./useDismiss";
import { t } from "./i18n";

const DEFAULTS: EncodeOpts = {
  container: "", vcodec: "h264", scale: "", fps: null, crf: 20, preset: "medium",
  acodec: "aac", abitrate: 320, deinterlace: false, denoise: false, grayscale: false, flip_h: false, rotate: 0,
};

// Presets prontos (Briefing 3 §3.9).
const BUILTIN: { name: string; opts: EncodeOpts }[] = [
  { name: t("enc.builtin.vfrCfr"), opts: { ...DEFAULTS, vcodec: "h265", fps: 60, crf: 18, preset: "fast", abitrate: 256, container: "mp4" } },
  { name: t("enc.builtin.editProres"), opts: { ...DEFAULTS, vcodec: "prores_hq", acodec: "pcm", container: "mov" } },
  { name: t("enc.builtin.editDnxhr"), opts: { ...DEFAULTS, vcodec: "dnxhr", acodec: "pcm", container: "mov" } },
  { name: t("enc.builtin.deliverH265"), opts: { ...DEFAULTS, vcodec: "h265", crf: 20, preset: "medium", container: "mp4" } },
  { name: t("enc.builtin.deliverH264"), opts: { ...DEFAULTS, vcodec: "h264", scale: "1080", crf: 18, preset: "medium", container: "mp4" } },
  { name: t("enc.builtin.rewrap"), opts: { ...DEFAULTS, op: "rewrap", container: "mkv" } },
  { name: t("enc.builtin.extractAudio"), opts: { ...DEFAULTS, op: "extract_audio" } },
];

// Codificador avançado do PRISMA — estilo HandBrake / Shutter Encoder.
const VCODECS: [string, string][] = [
  ["h264", t("enc.vcodec.h264")],
  ["h265", t("enc.vcodec.h265")],
  ["av1", t("enc.vcodec.av1")],
  ["vp9", t("enc.vcodec.vp9")],
  ["prores", t("enc.vcodec.prores")],
  ["prores_hq", t("enc.vcodec.proresHq")],
  ["prores_4444", t("enc.vcodec.prores4444")],
  ["dnxhr", t("enc.vcodec.dnxhr")],
  ["copy", t("enc.vcodec.copy")],
  ["none", t("enc.vcodec.none")],
];
const CONTAINERS: [string, string][] = [
  ["", t("enc.auto")],
  ["mp4", "MP4"],
  ["mov", "MOV"],
  ["mkv", "MKV"],
  ["webm", "WebM"],
];
const SCALES: [string, string][] = [
  ["", t("enc.original")],
  ["uhd", "4K (2160p)"],
  ["1440", "1440p"],
  ["1080", "1080p"],
  ["720", "720p"],
  ["480", "480p"],
];
const FPSES: [string, string][] = [
  ["", t("enc.original")],
  ["23.976", "23.976"],
  ["24", "24"],
  ["25", "25"],
  ["30", "30"],
  ["50", "50"],
  ["60", "60"],
];
const PRESETS: [string, string][] = [
  ["veryfast", t("enc.preset.veryfast")],
  ["medium", t("enc.preset.medium")],
  ["slow", t("enc.preset.slow")],
  ["veryslow", t("enc.preset.veryslow")],
];
const ACODECS: [string, string][] = [
  ["aac", t("enc.acodec.aac")],
  ["copy", t("enc.acodec.copy")],
  ["opus", t("enc.acodec.opus")],
  ["mp3", t("enc.acodec.mp3")],
  ["flac", t("enc.acodec.flac")],
  ["pcm", t("enc.acodec.pcm")],
  ["none", t("enc.acodec.none")],
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
    const name = window.prompt(t("enc.presetNamePrompt"));
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
            <Icon name="sliders" size={16} /> {t("enc.title")} {asset.filename}
          </div>
          <button className="dup-x" onClick={dismiss}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="enc-body">
          <div className="enc-presets">
            <span className="enc-field-label">{t("enc.preset")}</span>
            <PopupButton
              value={presetSel}
              options={[
                ["", t("enc.choose")],
                ...BUILTIN.map((b, i) => [`b:${i}`, b.name] as [string, string]),
                ...presets.map((p) => [`u:${p.id}`, `★ ${p.name}`] as [string, string]),
              ]}
              onChange={applyPreset}
              placeholder={t("enc.preset")}
            />
            <button className="enc-preset-btn" onClick={doSavePreset}>{t("enc.saveCurrent")}</button>
            {presetSel.startsWith("u:") && (
              <button className="enc-preset-btn" onClick={doDeletePreset}>{t("enc.delete")}</button>
            )}
          </div>

          {/* Operações rápidas */}
          <div className="enc-quick">
            <button className="enc-quick-btn" onClick={() => start("rewrap")} title={t("enc.rewrapTitle")}>
              <Icon name="refresh" size={13} /> {t("enc.rewrap")}
            </button>
            <button className="enc-quick-btn" onClick={() => start("extract_audio")}>
              <Icon name="audio" size={13} /> {t("enc.extractAudio")}
            </button>
            <button
              className="enc-quick-btn"
              onClick={() => {
                encodeRun(asset.path, { ...o, op: "loudnorm", lufs: -14 });
                dismiss();
              }}
            >
              <Icon name="audio" size={13} /> {t("enc.normalizeAudio")}
            </button>
            <button className="enc-quick-btn" onClick={pickWatermark}>
              <Icon name="image" size={13} /> {t("enc.watermark")}
            </button>
          </div>

          <div className="enc-grid">
            <Field label={t("enc.container")}>
              <PopupButton value={o.container || ""} options={CONTAINERS} onChange={(v) => set({ container: v })} />
            </Field>
            <Field label={t("enc.vcodec")}>
              <PopupButton value={vcodec} options={VCODECS} onChange={(v) => set({ vcodec: v })} />
            </Field>
            <Field label={t("enc.resolution")}>
              <PopupButton value={o.scale || ""} options={SCALES} onChange={(v) => set({ scale: v })} />
            </Field>
            <Field label={t("enc.framerate")}>
              <PopupButton
                value={o.fps ? String(o.fps) : ""}
                options={FPSES}
                onChange={(v) => set({ fps: v ? Number(v) : null })}
              />
            </Field>
            {usesCrf(vcodec) && (
              <>
                <Field label={t("enc.preset")}>
                  <PopupButton value={o.preset || "medium"} options={PRESETS} onChange={(v) => set({ preset: v })} />
                </Field>
                <Field label={t("enc.quality").replace("{crf}", String(o.crf))}>
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
            <Field label={t("enc.audio")}>
              <PopupButton value={o.acodec || "aac"} options={ACODECS} onChange={(v) => set({ acodec: v })} />
            </Field>
            <Field label={t("enc.rotation")}>
              <PopupButton
                value={String(o.rotate ?? 0)}
                options={[["0", "0°"], ["90", "90°"], ["180", "180°"], ["270", "270°"]]}
                onChange={(v) => set({ rotate: Number(v) })}
              />
            </Field>
          </div>

          <div className="enc-filters">
            <span className="enc-filters-label">{t("enc.filters")}</span>
            <Check label={t("enc.deinterlace")} on={!!o.deinterlace} onClick={() => set({ deinterlace: !o.deinterlace })} />
            <Check label={t("enc.denoise")} on={!!o.denoise} onClick={() => set({ denoise: !o.denoise })} />
            <Check label={t("enc.grayscale")} on={!!o.grayscale} onClick={() => set({ grayscale: !o.grayscale })} />
            <Check label={t("enc.flip")} on={!!o.flip_h} onClick={() => set({ flip_h: !o.flip_h })} />
          </div>

          <div className="enc-advanced">
            <div className="enc-adv-row">
              <span className="enc-field-label">{t("enc.trim")}</span>
              <input className="field enc-num" type="number" placeholder={t("enc.trimIn")} value={o.trim_in ?? ""} onChange={(e) => set({ trim_in: e.target.value ? Number(e.target.value) : null })} />
              <input className="field enc-num" type="number" placeholder={t("enc.trimOut")} value={o.trim_out ?? ""} onChange={(e) => set({ trim_out: e.target.value ? Number(e.target.value) : null })} />
              <button className="enc-preset-btn" onClick={() => start("trim")} disabled={o.trim_in == null && o.trim_out == null}>{t("enc.cut")}</button>
            </div>
            <div className="enc-adv-row">
              <span className="enc-field-label">{t("enc.speed")}</span>
              <input className="field enc-num" type="number" step="0.25" placeholder="1.0" value={o.speed ?? ""} onChange={(e) => set({ speed: e.target.value ? Number(e.target.value) : null })} />
              <span className="enc-adv-hint">{t("enc.speedHint")}</span>
            </div>
            <div className="enc-adv-row">
              <span className="enc-field-label">{t("enc.lut")}</span>
              <button className="enc-preset-btn" onClick={pickLut}>{lutName ? `✓ ${lutName}` : t("enc.chooseLut")}</button>
              {o.lut_path && <button className="enc-preset-btn" onClick={() => set({ lut_path: null })}>{t("enc.remove")}</button>}
              <span className="enc-adv-hint">{t("enc.lutHint")}</span>
            </div>
          </div>
        </div>

        <div className="dup-foot">
          <button className="dup-cancel" onClick={dismiss}>{t("enc.cancel")}</button>
          <button className="dup-apply" onClick={() => start()}>{t("enc.encode")}</button>
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
