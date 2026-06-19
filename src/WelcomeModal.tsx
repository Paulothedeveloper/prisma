import { Icon } from "./Icons";
import { useDismiss } from "./useDismiss";
import { Logo } from "./Logo";

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
        <div className="welcome-title">Bem-vindo ao PRISMA</div>
        <div className="welcome-sub">Sua biblioteca de mídia, feita pra quem edita vídeo.</div>

        <div className="welcome-points">
          <div className="welcome-point">
            <Icon name="folder" size={15} />
            <span><b>Adicione uma pasta</b> — o PRISMA indexa no lugar, sem mover nem alterar seus arquivos.</span>
          </div>
          <div className="welcome-point">
            <Icon name="play" size={15} />
            <span><b>Passe o mouse</b> pra pré-visualizar. Duplo-clique abre em tela cheia.</span>
          </div>
          <div className="welcome-point">
            <Icon name="sliders" size={15} />
            <span><b>Leitor CST, Oficina e IA</b> te ajudam a preparar o material — tudo opcional e não destrutivo.</span>
          </div>
        </div>

        <div className="welcome-foot">
          <span className="welcome-hint">Dicas vão aparecer conforme você usa cada recurso.</span>
          <button className="welcome-go" onClick={dismiss}>
            Começar
          </button>
        </div>
      </div>
    </div>
  );
}
