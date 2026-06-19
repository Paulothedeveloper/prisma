import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PreviewWindow } from "./PreviewWindow";

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
