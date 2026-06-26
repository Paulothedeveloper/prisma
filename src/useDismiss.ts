import { useCallback, useEffect, useRef, useState } from "react";

// Hook de fechamento ANIMADO reutilizável (regra do app: tudo que abre/fecha anima).
// Mantém o componente montado por `ms` enquanto a animação de saída roda, e só então
// chama o onClose real (que normalmente desmonta o modal no pai).
//
// Blindagens: guarda o timer num ref e LIMPA no unmount (sem setState/onClose em árvore já
// desmontada); e ignora chamadas REPETIDAS de dismiss (Esc + clique disparavam onClose 2×).
export function useDismiss(onClose: () => void, ms = 180): { closing: boolean; dismiss: () => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  const done = useRef(false);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  const dismiss = useCallback(() => {
    if (done.current) return; // já está fechando → não dispara onClose de novo
    done.current = true;
    setClosing(true);
    timer.current = window.setTimeout(onClose, ms);
  }, [onClose, ms]);

  return { closing, dismiss };
}
