import { Icon } from "./Icons";
import { useDismiss } from "./useDismiss";
import { Logo } from "./Logo";
import { t } from "./i18n";

// Modal de boas-vindas (1ª vez que abre o app). Apresenta o PRISMA e libera as dicas
// contextuais. Usa o overlay/animação padrão.
export function WelcomeModal({ onClose }: { onClose: () => void }) {
  const { closing, dismiss } = useDismiss(onClose);
  return (
    <div className={`dup-overlay${closing ? " closing" : ""}`} onClick={dismiss}>
      <div className={`welcome-modal${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="welcome-logo">
          <Logo size={64} />
        </div>
        <div className="welcome-title">{t("welcome.title")}</div>
        <div className="welcome-sub">{t("welcome.sub")}</div>

        <div className="welcome-points">
          <div className="welcome-point">
            <Icon name="folder" size={15} />
            <span>{t("welcome.p1")}</span>
          </div>
          <div className="welcome-point">
            <Icon name="play" size={15} />
            <span>{t("welcome.p2")}</span>
          </div>
          <div className="welcome-point">
            <Icon name="sliders" size={15} />
            <span>{t("welcome.p3")}</span>
          </div>
        </div>

        <div className="welcome-foot">
          <span className="welcome-hint">{t("welcome.hint")}</span>
          <button className="welcome-go" onClick={dismiss}>
            {t("welcome.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
