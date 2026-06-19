import { useEffect, useState } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { aiStatus, setAiKey, aiAnalyzeUntagged, exportCatalog, importCatalog, setAutotagImport } from "./api";
import { Icon } from "./Icons";

// Configurações: chave da API da IA (metade "API" do híbrido). A chave fica só no seu PC.
export function Settings({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [autotag, setAutotag] = useState(false);

  const doExport = async () => {
    const p = await saveDialog({ defaultPath: "prisma-catalogo.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof p === "string") {
      const n = await exportCatalog(p);
      setSyncMsg(`Exportados ${n} itens com metadados.`);
    }
  };
  const doImport = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof p === "string") {
      const n = await importCatalog(p);
      setSyncMsg(`Aplicado em ${n} itens desta biblioteca (casados por conteúdo).`);
    }
  };

  useEffect(() => {
    aiStatus().then((s) => {
      setHasKey(s.has_key);
      setModel(s.model);
      setAutotag(s.autotag_on_import);
    });
  }, []);

  const save = async () => {
    await setAiKey(key);
    const s = await aiStatus();
    setHasKey(s.has_key);
    setKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="dup-overlay" onClick={onClose}>
      <div className="set-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="sliders" size={16} /> Configurações
          </div>
          <button className="dup-x" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="set-block">
          <div className="set-label">Busca por conteúdo com IA</div>
          <div className="set-help">
            Cole sua chave da API Anthropic pra ligar a análise de conteúdo (achar por "praia",
            "pessoa", "céu"). A chave fica só neste PC, em settings.json. Só a miniatura (512px) é
            enviada, e somente quando você clica em analisar — nunca automático.
          </div>
          <div className="set-row">
            <input
              className="field"
              type="password"
              placeholder={hasKey ? "•••• chave salva — cole pra trocar" : "sk-ant-..."}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="set-save" onClick={save} disabled={!key.trim()}>
              {saved ? "Salvo" : "Salvar"}
            </button>
          </div>
          <div className="set-status">
            <span className={`set-dot ${hasKey ? "on" : ""}`} />
            {hasKey ? `Chave configurada · modelo ${model}` : "Sem chave — busca por conteúdo desligada"}
          </div>

          {hasKey && (
            <div className="set-bulk">
              <div className="set-bulk-label">Analisar a biblioteca em lote (gera tags + descrição pra busca por conteúdo)</div>
              <div className="set-bulk-row">
                {[100, 300, 1000].map((n) => (
                  <button
                    key={n}
                    className="set-bulk-btn"
                    onClick={() => {
                      aiAnalyzeUntagged(n);
                      onClose();
                    }}
                  >
                    Analisar {n} sem descrição
                  </button>
                ))}
              </div>
              <div className="set-help">
                Roda em segundo plano (mostra o progresso no canto). Cada imagem consome sua API — comece com 100 pra ver o custo.
              </div>
            </div>
          )}

          <div className="set-bulk">
            <div className="set-label">Importação</div>
            <button
              className={`set-toggle ${autotag ? "on" : ""}`}
              onClick={() => {
                const v = !autotag;
                setAutotag(v);
                setAutotagImport(v);
              }}
            >
              <span className="set-toggle-knob" />
              Auto-tag ao importar — cada item herda o nome da pasta como tag
            </button>
          </div>

          <div className="set-bulk">
            <div className="set-label">Sincronizar notebook ↔ desktop</div>
            <div className="set-help">
              Exporta seus <b>metadados</b> (tags, estrelas, notas, descrição, coleções) e aplica na outra
              máquina <b>casando por conteúdo (hash)</b> — funciona mesmo se a letra do drive mudar (E:/F:/G:).
              Os arquivos não são copiados.
            </div>
            <div className="set-bulk-row">
              <button className="set-bulk-btn" onClick={doExport}>Exportar catálogo…</button>
              <button className="set-bulk-btn" onClick={doImport}>Importar catálogo…</button>
            </div>
            {syncMsg && <div className="set-status"><span className="set-dot on" /> {syncMsg}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
