import { useEffect, useRef, useState } from "react";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
  vaultStatus,
  setVaultPath,
  reindexVault,
  scanHealth,
} from "./api";
import { Icon, type IconName } from "./Icons";
import { loadPrefs, savePrefs, ACCENTS, type Prefs } from "./prefs";
import { fireTip, resetTips } from "./tips";
import { t, LOCALES, getLocale, setLocale } from "./i18n";

// Configurações em TÓPICOS (estilo Eagle, em português, design próprio do PRISMA).
// Regra: nada de botão morto — cada controle aqui muda algo de verdade.
type Tab = "geral" | "reproducao" | "importacao" | "ia" | "sync" | "sobre";

const TABS: { id: Tab; key: string; icon: IconName }[] = [
  { id: "geral", key: "tab.general", icon: "sliders" },
  { id: "reproducao", key: "tab.playback", icon: "play" },
  { id: "importacao", key: "tab.import", icon: "inbox" },
  { id: "ia", key: "tab.ai", icon: "search" },
  { id: "sync", key: "tab.sync", icon: "refresh" },
  { id: "sobre", key: "tab.about", icon: "stack" },
];

const APP_VERSION = "0.5.1";

export function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("geral");
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => fireTip("settings", modalRef.current), 350);
    return () => clearTimeout(t);
  }, []);
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
  const [vault, setVault] = useState<{ path: string | null; count: number }>({ path: null, count: 0 });
  const [vaultMsg, setVaultMsg] = useState("");

  // importação / sync
  const [autotag, setAutotag] = useState(false);
  const [autoProxy, setAutoProxy] = useState(true);
  const [syncMsg, setSyncMsg] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [proxyMsg, setProxyMsg] = useState("");
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthMsg, setHealthMsg] = useState("");
  // atualização do software (botão manual; o popup automático no boot é o UpdateBanner)
  const [updBusy, setUpdBusy] = useState(false);
  const [updMsg, setUpdMsg] = useState("");

  // Procura atualização no GitHub sob demanda. Se houver, baixa + instala + reinicia;
  // senão, avisa que já está na última versão. (Mesmo motor do popup automático.)
  const checkUpdates = async () => {
    setUpdBusy(true);
    setUpdMsg(t("set.checking"));
    try {
      const u = await checkUpdate();
      if (!u) {
        setUpdMsg(t("set.upToDate"));
        setUpdBusy(false);
        return;
      }
      setUpdMsg(t("set.updateFound").replace("{v}", u.version));
      await u.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setUpdMsg(`${t("update.failed")}: ${String(e)}`);
      setUpdBusy(false);
    }
  };

  useEffect(() => {
    aiStatus().then((s) => {
      setHasKey(s.has_key);
      setModel(s.model);
      setAutotag(s.autotag_on_import);
      setAutoProxy(s.auto_proxy_on_import);
      if (s.has_key) aiPendingCount().then(setPending).catch(() => {});
    });
    vaultStatus().then(setVault).catch(() => {});
  }, []);

  const pickVault = async () => {
    const p = await openDialog({ directory: true });
    if (typeof p === "string") {
      setVaultMsg(t("set.indexing"));
      try {
        const n = await setVaultPath(p);
        setVault({ path: p, count: n });
        setVaultMsg(t("set.chunksIndexed").replace("{n}", n.toLocaleString("pt-BR")));
      } catch (e) {
        setVaultMsg(`${t("common.error")}: ${String(e)}`);
      }
    }
  };
  const doReindexVault = async () => {
    setVaultMsg(t("set.reindexing"));
    try {
      const n = await reindexVault();
      setVault((v) => ({ ...v, count: n }));
      setVaultMsg(t("set.chunksReindexed").replace("{n}", n.toLocaleString("pt-BR")));
    } catch (e) {
      setVaultMsg(`${t("common.error")}: ${String(e)}`);
    }
  };

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
      setAiMsg(c > 0 ? `${t("set.aiStarted")} (${c})` : t("set.aiNone"));
    } catch (e) {
      setAiMsg(`${t("common.error")}: ${String(e)}`);
    } finally {
      setAiBusy(false);
    }
  };

  const doExport = async () => {
    try {
      const p = await saveDialog({ defaultPath: "prisma-catalogo.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof p === "string") setSyncMsg(t("set.exported").replace("{n}", String(await exportCatalog(p))));
    } catch (e) {
      setSyncMsg(t("set.exportError").replace("{e}", String(e)));
    }
  };
  const doImport = async () => {
    try {
      const p = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof p === "string") setSyncMsg(t("set.applied").replace("{n}", String(await importCatalog(p))));
    } catch (e) {
      setSyncMsg(t("set.importError").replace("{e}", String(e)));
    }
  };

  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={close}>
      <div ref={modalRef} className={`pref-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="dup-head">
          <div className="dup-title">
            <Icon name="sliders" size={16} /> {t("settings.title")}
          </div>
          <button className="dup-x" onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="pref-body">
          <nav className="pref-nav">
            {TABS.map((tb) => (
              <button key={tb.id} className={`pref-nav-item ${tab === tb.id ? "on" : ""}`} onClick={() => setTab(tb.id)}>
                <Icon name={tb.icon} size={15} /> {t(tb.key)}
              </button>
            ))}
          </nav>

          <div className="pref-content" key={tab}>
            {/* ---------- GERAL ---------- */}
            {tab === "geral" && (
              <>
                <div className="pref-group">
                  <div className="pref-label">{t("settings.language")}</div>
                  <div className="pref-help">{t("settings.languageHelp")}</div>
                  <div className="set-bulk-row">
                    {LOCALES.map((l) => (
                      <button
                        key={l.id}
                        className={`set-bulk-btn ${getLocale() === l.id ? "set-bulk-all" : ""}`}
                        onClick={() => l.id !== getLocale() && setLocale(l.id)}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pref-group">
                  <div className="pref-label">{t("set.accent")}</div>
                  <div className="pref-help">{t("set.accentHelp")}</div>
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
                  title={t("set.reduceGlass")}
                  help={t("set.reduceGlassHelp")}
                />

                <div className="pref-group">
                  <div className="pref-label">{t("set.reloadApp")}</div>
                  <div className="pref-help">{t("set.reloadAppHelp")}</div>
                  <button className="set-bulk-btn" onClick={() => window.location.reload()}>
                    <Icon name="refresh" size={13} /> {t("set.reloadNow")}
                  </button>
                </div>

                <div className="pref-group pref-danger">
                  <div className="pref-label">{t("set.reset")}</div>
                  <div className="pref-help">{t("set.resetHelp")}</div>
                  {!confirmReset ? (
                    <button className="pref-danger-btn" onClick={() => setConfirmReset(true)}>
                      <Icon name="trash" size={13} /> {t("set.resetBtn")}
                    </button>
                  ) : (
                    <div className="pref-danger-confirm">
                      <span>{t("set.resetConfirm")}</span>
                      <div className="set-bulk-row">
                        <button className="set-bulk-btn" disabled={resetting} onClick={() => setConfirmReset(false)}>
                          {t("common.cancel")}
                        </button>
                        <button
                          className="pref-danger-btn"
                          disabled={resetting}
                          onClick={() => {
                            setResetting(true);
                            resetApp().catch(() => setResetting(false));
                          }}
                        >
                          {resetting ? t("set.resetting") : t("set.resetYes")}
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
                  title={t("set.hoverAutoplay")}
                  help={t("set.hoverAutoplayHelp")}
                />
                <Toggle
                  on={autoProxy}
                  onClick={() => {
                    const v = !autoProxy;
                    setAutoProxy(v);
                    setAutoProxyImport(v);
                  }}
                  title={t("set.autoProxy")}
                  help={t("set.autoProxyHelp")}
                />
                <div className="pref-group">
                  <div className="pref-label">{t("set.reloadProxy")}</div>
                  <div className="pref-help">{t("set.reloadProxyHelp")}</div>
                  <button
                    className="set-bulk-btn"
                    onClick={async () => {
                      setProxyMsg("");
                      try {
                        const n = await regenProxies();
                        setProxyMsg(n > 0 ? `${n.toLocaleString()} ${t("set.statusProxy")}` : t("set.statusOk"));
                      } catch (e) {
                        setProxyMsg(`${t("common.error")}: ${String(e)}`);
                      }
                    }}
                  >
                    <Icon name="refresh" size={13} /> {t("set.reloadProxyBtn")}
                  </button>
                  {proxyMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {proxyMsg}
                    </div>
                  )}
                </div>
                <div className="pref-help" style={{ marginTop: 14 }}>
                  {t("set.playerTip")}
                </div>
              </>
            )}

            {/* ---------- IMPORTAÇÃO ---------- */}
            {tab === "importacao" && (
              <>
                <Toggle
                  on={autotag}
                  onClick={() => {
                    const v = !autotag;
                    setAutotag(v);
                    setAutotagImport(v);
                  }}
                  title={t("set.autotag")}
                  help={t("set.autotagHelp")}
                />
                <div className="pref-group">
                  <div className="pref-label">{t("set.scanHealth")}</div>
                  <div className="pref-help">{t("set.scanHealthHelp")}</div>
                  <button
                    className="set-bulk-btn"
                    disabled={healthBusy}
                    onClick={async () => {
                      setHealthBusy(true);
                      setHealthMsg("");
                      try {
                        const n = await scanHealth(0);
                        setHealthMsg(n > 0 ? `${n.toLocaleString()} →` : t("set.statusOk"));
                      } catch (e) {
                        setHealthMsg(`${t("common.error")}: ${String(e)}`);
                      } finally {
                        setHealthBusy(false);
                      }
                    }}
                  >
                    <Icon name="refresh" size={13} /> {t("set.scanHealthBtn")}
                  </button>
                  {healthMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {healthMsg}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- IA E BUSCA ---------- */}
            {tab === "ia" && (
              <>
                <div className="pref-group">
                  <div className="pref-label">{t("set.aiSearch")}</div>
                  <div className="pref-help">{t("set.aiSearchHelp")}</div>
                  <div className="set-row">
                    <input
                      className="field"
                      type="password"
                      placeholder={hasKey ? t("set.keySaved") : "sk-ant-..."}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                    <button className="set-save" onClick={saveKey} disabled={!key.trim()}>
                      {saved ? t("common.saved") : t("common.save")}
                    </button>
                  </div>
                  <div className="set-status">
                    <span className={`set-dot ${hasKey ? "on" : ""}`} />
                    {hasKey ? `${t("set.keyOk")} ${model}` : t("set.noKey")}
                  </div>
                </div>

                {hasKey && (
                  <div className="pref-group">
                    <div className="pref-label">{t("set.aiBatch")}</div>
                    <div className="pref-help">
                      {t("set.aiBatchHelp")}{" "}
                      {pending !== null && (
                        <b>{pending.toLocaleString()} {t("set.pending")}</b>
                      )}
                    </div>
                    <div className="set-bulk-row">
                      {[100, 500, 2000].map((n) => (
                        <button key={n} className="set-bulk-btn" disabled={aiBusy} onClick={() => runBulk(n)}>
                          {t("set.analyze")} {n}
                        </button>
                      ))}
                      <button
                        className="set-bulk-btn set-bulk-all"
                        disabled={aiBusy || pending === 0}
                        onClick={() => runBulk(0)}
                        title={t("set.analyzeAllTitle")}
                      >
                        {t("set.analyzeAll")}{pending ? ` (${pending.toLocaleString()})` : ""}
                      </button>
                    </div>
                    {aiMsg && (
                      <div className="set-status">
                        <span className="set-dot on" /> {aiMsg}
                      </div>
                    )}
                  </div>
                )}

                <div className="pref-group">
                  <div className="pref-label">{t("set.vault")}</div>
                  <div className="pref-help">{t("set.vaultHelp")}</div>
                  <div className="set-status">
                    <span className={`set-dot ${vault.path ? "on" : ""}`} />
                    {vault.path
                      ? `${vault.count.toLocaleString()} ${t("set.vaultChunks")} · ${vault.path}`
                      : t("set.vaultNone")}
                  </div>
                  <div className="set-bulk-row">
                    <button className="set-bulk-btn" onClick={pickVault}>
                      <Icon name="folder" size={13} /> {t("set.vaultPick")}
                    </button>
                    {vault.path && (
                      <button className="set-bulk-btn" onClick={doReindexVault}>
                        <Icon name="refresh" size={13} /> {t("set.vaultReindex")}
                      </button>
                    )}
                  </div>
                  {vaultMsg && (
                    <div className="set-status">
                      <span className="set-dot on" /> {vaultMsg}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ---------- SINCRONIZAÇÃO ---------- */}
            {tab === "sync" && (
              <div className="pref-group">
                <div className="pref-label">{t("set.sync")}</div>
                <div className="pref-help">{t("set.syncHelp")}</div>
                <div className="set-bulk-row">
                  <button className="set-bulk-btn" onClick={doExport}>{t("set.export")}</button>
                  <button className="set-bulk-btn" onClick={doImport}>{t("set.import")}</button>
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
                <div className="pref-about-ver">{t("set.version")} {APP_VERSION}</div>
                <div className="pref-help" style={{ marginTop: 12 }}>{t("set.aboutDesc")}</div>
                <button
                  className="set-bulk-btn"
                  style={{ marginTop: 16 }}
                  disabled={updBusy}
                  onClick={checkUpdates}
                >
                  <Icon name="refresh" size={13} /> {t("set.checkUpdates")}
                </button>
                {updMsg && (
                  <div className="set-status" style={{ marginTop: 8 }}>
                    <span className="set-dot on" /> {updMsg}
                  </div>
                )}
                <button
                  className="set-bulk-btn"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    resetTips();
                    window.location.reload();
                  }}
                >
                  <Icon name="play" size={13} /> {t("set.replayTutorial")}
                </button>
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
