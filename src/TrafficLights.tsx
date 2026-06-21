import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "./i18n";

// Semáforos do macOS: fechar (vermelho), minimizar (amarelo), zoom (verde).
// Glifos aparecem só no hover do grupo, como no macOS.
export function TrafficLights() {
  const win = getCurrentWindow();
  return (
    <div className="traffic">
      <button
        className="tl tl-close"
        aria-label={t("win.close")}
        onClick={() => win.close()}
      >
        <svg viewBox="0 0 12 12" className="tl-glyph">
          <path d="M3.2 3.2l5.6 5.6M8.8 3.2L3.2 8.8" />
        </svg>
      </button>
      <button
        className="tl tl-min"
        aria-label={t("win.minimize")}
        onClick={() => win.minimize()}
      >
        <svg viewBox="0 0 12 12" className="tl-glyph">
          <path d="M2.8 6h6.4" />
        </svg>
      </button>
      <button
        className="tl tl-zoom"
        aria-label={t("win.zoom")}
        onClick={() => win.toggleMaximize()}
      >
        <svg viewBox="0 0 12 12" className="tl-glyph">
          <path d="M3 6h6M6 3v6" />
        </svg>
      </button>
    </div>
  );
}
