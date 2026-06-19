import { useState, useCallback } from "react";

// Hook de fechamento ANIMADO reutilizável (regra do app: tudo que abre/fecha anima).
// Mantém o componente montado por `ms` enquanto a animação de saída roda, e só então
// chama o onClose real (que normalmente desmonta o modal no pai).
export function useDismiss(onClose: () => void, ms = 180): { closing: boolean; dismiss: () => void } {
  const [closing, setClosing] = useState(false);
  const dismiss = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, ms);
  }, [onClose, ms]);
  return { closing, dismiss };
}
