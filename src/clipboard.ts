// Copiar texto de forma CONFIÁVEL no WebView do Tauri. O `navigator.clipboard.writeText`
// às vezes falha em silêncio (foco/permissão/contexto) — quando falha, caímos no truque
// clássico do <textarea> + execCommand("copy"), que funciona em qualquer WebView sem permissão.
export async function copyText(s: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    /* tenta o fallback abaixo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
