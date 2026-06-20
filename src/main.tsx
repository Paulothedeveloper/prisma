import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PreviewWindow } from "./PreviewWindow";
import { applyPrefs, loadPrefs } from "./prefs";
import { loadFeatureFlags } from "./features";

// Aplica as preferências de aparência (cor de destaque, transparência) antes do render,
// pra não haver "flash" da cor padrão.
applyPrefs(loadPrefs());

// Lê as flags de edição/licença uma vez (não bloqueia o render; degrada pro default
// permissivo se falhar). Os botões avançados consultam features() depois.
void loadFeatureFlags();

// Janela de preview própria (multi-window) quando aberta com ?win=preview
const isPreview = new URLSearchParams(window.location.search).get("win") === "preview";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isPreview ? (
    <PreviewWindow />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ),
);
