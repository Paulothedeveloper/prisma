import { useEffect, useState } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  aiStatus,
  setAiKey,
  aiAnalyzeUntagged,
  aiPendingCount,
  exportCatalog,
  importCatalog,
  setAutotagImport,
  setAutoProxyImport,
  resetApp,
  regenProxies,
} from "./api";
import { Icon, type IconName } from "./Icons";
import { loadPrefs, savePrefs, ACCENTS, type Prefs } from "./prefs";

// Configurações em TÓPICOS (estilo Eagle, em português, design próprio do PRISMA).
// Regra: nada de botão morto — cada controle aqui muda algo de verdade.
type Tab = "geral" | "reproducao" | "importacao" | "ia" | "sync" | "sobre";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "geral", label: "Geral", icon: "sliders" },
  { id: "reproducao", label: "Reprodução", icon: "play" },
  { id: "importacao", label: "Importação", icon: "inbox" },
  { id: "ia", label: "IA e busca", icon: "search" },
  { id: "sync", label: "Sincronização", icon: "refresh" },
  { id: "sobre", label: "Sobre", icon: "stack" },
];

const APP_VERSION = "0.4.0";

export function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("geral");
  const [closing, setClosing] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  // Fecha com animação de saída (regra do app: tudo que abre/fecha anima).
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };

  // chave/IA
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  // importação / sync
  const [autotag, setAutotag] = useState(false);
  const [autoProxy, setAutoProxy] = useState(true);
  const [syncMsg, setSyncMsg] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [proxyMsg, setProxyMsg] = useState("");

  useEffect(() => {
    aiStatus().then((s) => {
      setHasKey(s.has_key);
      setModel(s.model);
      setAutotag(s.autotag_on_import);
      setAutoProxy(s.auto_proxy_on_import);
      if (s.has_key) aiPendingCount().then(setPending).catch(() => {});
    });
  }, []);

  // Altera uma preferência local e aplica na hora (cor, vidro, zoom, autoplay).
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    savePrefs(next);
  };

  const saveKey = async () => {
    await setAiKey(key);
    const s = await aiStatus();
    setHasKey(s.has_key);
    setKey("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const runBulk = async (n: number) => {
    setAiBusy(true);
    setAiMsg("");
    try {
      const c = await aiAnalyzeUntagged(n);
      setAiMsg(
        c > 0
          ? `Iniciado — analisando ${c} ${c === 1 ? "imagem" : "imagens"} em segundo plano. O progresso aparece no canto inferior.`
          : "Nenhuma imagem sem descrição encontrada — tudo já foi analisado.",
      );
    } catch (e) {
      setAiMsg(`Erro ao iniciar: ${String(e)}`);
    } finally {
      setAiBusy(false);
    }
  };

  const doExport = async () => {
    try {
      const p = await saveDialog({ defaultPath: "prisma-catalogo.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof p === "string") setSyncMsg(`Exportados ${await exportCatalog(p)} itens com metadados.`);
    } catch (e) {
      setSyncMsg(`Erro ao exportar: ${String(e)}`);
    }
  };
  const doImport = async () => {
    try {
      const p = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof p === "string") setSyncMsg(`Aplicado em ${await importCatalog(p)} itens desta biblioteca (casados por conteúdo).`);
    } catch (e) {
      setSyncMsg(`Erro ao importar: ${String(e)}`);
    }
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={close}>
      <div className={`pref-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="sliders" size={16} /> Configurações
          </div>
          <button className="dup-x" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="pref-body">
          <nav className="pref-nav">
            {TABS.map((t) => (
              <button key={t.id} className={`pref-nav-item ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={15} /> {t.label}
              </button>
            ))}
          </nav>

          <div className="pref-content" key={tab}>
            {/* ---------- GERAL ---------- */}
            {tab === "geral" && (
              <>
                <div className="pref-group">
                  <div className="pref-label">Cor de destaque</div>
                  <div className="pref-help">Define a cor de seleção, botões e detalhes do app.</div>
                  <div className="pref-swatches">
                    {ACCENTS.map((c) => (
                      <button
                        key={c}
                        className={`pref-swatch ${prefs.accent === c ? "on" : ""}`}
                        style={{ background: c }}
                        onClick={() => setPref("accent", c)}
                        title={c}
                      />
                    ))}
                  </div>
                </div>

                <Toggle
                  on={prefs.reduceGlass}
                  onClick={() => setPref("reduceGlass", !prefs.reduceGlass)}
                  title="Reduzir transparência e desfoque"
                  help="Visual mais sólido e leve — ajuda em máquinas mais fracas."
                />

                <div className="pref-group">
                  <div className="pref-label">Recarregar o app</div>
                  <div className="pref-help">
                    Recarrega a interface (sem perder nada) — resolve travadinhas e bugs visuais sem precisar
                    fechar e abrir o programa.
                  </div>
                  <button className="set-bulk-btn" onClick={() => window.location.reload()}>
                    <Icon name="refresh" size={13} /> Recarregar agora
                  </button>
                </div>

                <div className="pref-group pref-danger">
                  <div className="pref-label">Redefinir aplicativo</div>
                  <div className="pref-help">
                    Zera o PRISMA do zero: limpa o catálogo inteiro (suas pastas, tags, estrelas, notas,
                    coleções), as miniaturas e os proxies. <b>Não apaga nenhum arquivo original do disco.</b>{" "}
                    A chave da API é mantida. O app reinicia em seguida.
                  </div>
                  {!confirmReset ? (
                    <button className="pref-danger-btn" onClick={() => setConfirmReset(true)}>
                      <Icon name="trash" size={13} /> Redefinir do zero…
                    </button>
                  ) : (
                    <div className="pref-danger-confirm">
                      <span>Tem certeza? Isso limpa toda a biblioteca (os arquivos no disco ficam intactos).</span>
                      <div className="set-bulk-row">
                        <button className="set-bulk-btn" disabled={resetting} onClick={() => setConfirmReset(false)}>
                          Cancelar
                        </button>
                        <button
                          className="pref-danger-btn"
                          disabled={resetting}
                          onClick={() => {
                            setResetting(true);
                            resetApp().catch(() => setResetting(false));
                          }}
                        >
                          {resetting ? "Redefinindo…" : "Sim, redefinir e reiniciar"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- REPRODUÇÃO ---------- */}
            {tab === "reproducao" && (
              <>
                <Toggle
                  on={prefs.hoverAutoplay}
                  onClick={() => setPref("hoverAutoplay", !prefs.hoverAutoplay)}
                  title="Tocar ao passar o mouse"
                  help="Vídeos e áudios reproduzem fluido quando você passa o mouse pela miniatura (como o Eagle)."
                />
                <Toggle
                  on={autoProxy}
                  onClick={() => {
                    const v = !autoProxy;
                    setAutoProxy(v);
                    setAutoProxyImport(v);
                  }}
                  title="Gerar proxies ao importar"
                  help="Ao anexar uma pasta, cria automaticamente um preview leve (H.264 720p) dos vídeos de codec profissional (ProRes, .mov, .m4v) pra eles tocarem no hover e no preview. Roda em segundo plano; os originais não são tocados."
                />
                <div className="pref-group">
                  <div className="pref-label">Recarregar proxies</div>
                  <div className="pref-help">
                    Gera de novo os proxies que faltam (caso algum tenha falhado). Roda em segundo plano e mostra
                    o progresso no canto.
                  </div>
                  <button
                    className="set-bulk-btn"
                    onClick={async () => {
                      setProxyMsg("");
                      try {
                        const n = await regenProxies();
                        setProxyMsg(
                          n > 0
                            ? `${n.toLocaleString("pt-BR")} ${n === 1 ? "vídeo entrou" : "vídeos entraram"} na fila de proxy.`
                            : "Nenhum vídeo pendente — todos já têm proxy.",
                        );
                      } catch (e) {
                        setProxyMsg(`Erro: ${String(e)}`);
                      }
                    }}
                  >
                    <Icon name="refresh" size={13} /> Recarregar proxies faltantes
                  </button>
                  {proxyMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {proxyMsg}
                    </div>
                  )}
                </div>
                <div className="pref-help" style={{ marginTop: 14 }}>
                  Dica: no preview em tela cheia o player do PRISMA tem scrub quadro-a-quadro, velocidade,
                  loop e atalhos (espaço, J/K/L, F, M).
                </div>
              </>
            )}

            {/* ---------- IMPORTAÇÃO ---------- */}
            {tab === "importacao" && (
              <Toggle
                on={autotag}
                onClick={() => {
                  const v = !autotag;
                  setAutotag(v);
                  setAutotagImport(v);
                }}
                title="Auto-tag ao importar"
                help="Cada item importado herda o nome da pasta de origem como tag."
              />
            )}

            {/* ---------- IA E BUSCA ---------- */}
            {tab === "ia" && (
              <>
                <div className="pref-group">
                  <div className="pref-label">Busca por conteúdo com IA</div>
                  <div className="pref-help">
                    Cole sua chave da API Anthropic pra achar por "praia", "pessoa", "céu". A chave fica só
                    neste PC (settings.json). Só a miniatura (512px) é enviada, e somente quando você clica em
                    analisar — nunca automático.
                  </div>
                  <div className="set-row">
                    <input
                      className="field"
                      type="password"
                      placeholder={hasKey ? "•••• chave salva — cole pra trocar" : "sk-ant-..."}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                    <button className="set-save" onClick={saveKey} disabled={!key.trim()}>
                      {saved ? "Salvo" : "Salvar"}
                    </button>
                  </div>
                  <div className="set-status">
                    <span className={`set-dot ${hasKey ? "on" : ""}`} />
                    {hasKey ? `Chave configurada · modelo ${model}` : "Sem chave — busca por conteúdo desligada"}
                  </div>
                </div>

                {hasKey && (
                  <div className="pref-group">
                    <div className="pref-label">Analisar a biblioteca em lote</div>
                    <div className="pref-help">
                      Gera tags + descrição pra busca por conteúdo (6 em paralelo). Comece com 100 pra ver o
                      custo. {pending !== null && (
                        <b>{pending.toLocaleString("pt-BR")} {pending === 1 ? "item ainda sem" : "itens ainda sem"} descrição.</b>
                      )}
                    </div>
                    <div className="set-bulk-row">
                      {[100, 500, 2000].map((n) => (
                        <button key={n} className="set-bulk-btn" disabled={aiBusy} onClick={() => runBulk(n)}>
                          Analisar {n}
                        </button>
                      ))}
                      <button
                        className="set-bulk-btn set-bulk-all"
                        disabled={aiBusy || pending === 0}
                        onClick={() => runBulk(0)}
                        title="Analisa TODAS as pendentes (limit 0 = sem teto)"
                      >
                        Analisar todas{pending ? ` (${pending.toLocaleString("pt-BR")})` : ""}
                      </button>
                    </div>
                    {aiMsg && (
                      <div className="set-status">
                        <span className="set-dot on" /> {aiMsg}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ---------- SINCRONIZAÇÃO ---------- */}
            {tab === "sync" && (
              <div className="pref-group">
                <div className="pref-label">Sincronizar notebook ↔ desktop</div>
                <div className="pref-help">
                  Exporta seus <b>metadados</b> (tags, estrelas, notas, descrição, coleções) e aplica na outra
                  máquina <b>casando por conteúdo (hash)</b> — funciona mesmo se a letra do drive mudar (E:/F:/G:).
                  Os arquivos não são copiados.
                </div>
                <div className="set-bulk-row">
                  <button className="set-bulk-btn" onClick={doExport}>Exportar catálogo…</button>
                  <button className="set-bulk-btn" onClick={doImport}>Importar catálogo…</button>
                </div>
                {syncMsg && (
                  <div className="set-status">
                    <span className="set-dot on" /> {syncMsg}
                  </div>
                )}
              </div>
            )}

            {/* ---------- SOBRE ---------- */}
            {tab === "sobre" && (
              <div className="pref-about">
                <div className="pref-about-name">PRISMA</div>
                <div className="pref-about-ver">Versão {APP_VERSION}</div>
                <div className="pref-help" style={{ marginTop: 12 }}>
                  Gerenciador de mídia feito pra editores de vídeo. Leitor CST, Oficina (codificação) e
                  MotionSilk (estabilização) embutidos. Seus arquivos originais nunca são movidos nem alterados.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Botão de alternância reaproveitável (knob deslizante).
function Toggle({ on, onClick, title, help }: { on: boolean; onClick: () => void; title: string; help: string }) {
  return (
    <div className="pref-group">
      <button className={`set-toggle ${on ? "on" : ""}`} onClick={onClick}>
        <span className="set-toggle-knob" />
        <span className="pref-toggle-text">
          <span className="pref-toggle-title">{title}</span>
          <span className="pref-help">{help}</span>
        </span>
      </button>
    </div>
  );
}
