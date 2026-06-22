import { Component, type ReactNode } from "react";

// Rede de segurança contra "tela preta": se QUALQUER erro de render escapar, em vez de a tela
// ficar preta/em branco (React desmonta a árvore toda), mostramos uma tela de recuperação com
// o erro real (pra diagnosticar) + botões de recarregar/reset. Também guarda o último erro no
// localStorage pra investigar depois.
interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const stack = info?.componentStack ?? "";
    // eslint-disable-next-line no-console
    console.error("PRISMA crash:", error, stack);
    try {
      localStorage.setItem(
        "prisma.lastError",
        JSON.stringify({
          when: new Date().toISOString(),
          message: error?.message ?? String(error),
          stack: (error?.stack ?? "").slice(0, 2000),
          component: stack.slice(0, 1500),
        })
      );
    } catch {
      /* ignora */
    }
    this.setState({ info: stack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div className="crash-screen">
        <div className="crash-card">
          <h1>O PRISMA encontrou um erro</h1>
          <p>
            Em vez de uma tela preta, aqui está o que aconteceu. Mande este texto pro Paulo/Claude
            pra consertar de vez.
          </p>
          <pre className="crash-detail">
            {error.message}
            {"\n\n"}
            {(error.stack ?? "").slice(0, 1200)}
            {info ? "\n\nComponentes:\n" + info.slice(0, 1000) : ""}
          </pre>
          <div className="crash-actions">
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Recarregar o app
            </button>
            <button
              className="crash-copy"
              onClick={() => {
                navigator.clipboard
                  .writeText(`${error.message}\n\n${error.stack ?? ""}\n\n${info}`)
                  .catch(() => {});
              }}
            >
              Copiar o erro
            </button>
          </div>
        </div>
      </div>
    );
  }
}
