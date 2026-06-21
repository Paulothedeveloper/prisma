// SFX próprio do PRISMA — sons SINTETIZADOS (Web Audio), estilo Apple: curtos, macios,
// discretos e raros. Sem arquivos de áudio (procedural = leve, sem licença, coeso).
// Respeita a preferência (Configurações › Reprodução) e a política de autoplay do
// navegador: o AudioContext só "acorda" após o primeiro gesto do usuário.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.1; // volume mestre discreto (Apple-like)
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function setSfxEnabled(on: boolean) {
  enabled = on;
}
export function sfxEnabled() {
  return enabled;
}

// Uma "voz": oscilador com envelope exponencial (ataque rápido, decaimento macio).
// opts.sweepTo faz um glide suave de frequência (whoosh).
function tone(
  freq: number,
  dur: number,
  opts?: { type?: OscillatorType; gain?: number; delay?: number; sweepTo?: number }
) {
  const c = ensure();
  if (!c || !master || !enabled) return;
  const t0 = c.currentTime + (opts?.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts?.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts?.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + dur);
  const peak = opts?.gain ?? 0.8;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006); // ataque ~6ms
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // decaimento macio
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// Paleta coesa. Tons em intervalos agradáveis (quintas/oitavas), tudo curto e baixo.
export const sfx = {
  // clique/seleção — blip bem curtinho
  select: () => tone(660, 0.055, { type: "triangle", gain: 0.45 }),
  // adicionar/confirmar — "pop" de duas notas subindo (quinta)
  pop: () => {
    tone(523.25, 0.07, { gain: 0.5 }); // C5
    tone(783.99, 0.1, { gain: 0.42, delay: 0.045 }); // G5
  },
  // abrir painel/modal — whoosh suave subindo
  open: () => tone(420, 0.13, { gain: 0.35, sweepTo: 680 }),
  // fechar — whoosh descendo
  close: () => tone(620, 0.12, { gain: 0.32, sweepTo: 360 }),
  // toggle — clique discreto
  toggle: () => tone(900, 0.04, { type: "square", gain: 0.18 }),
  // conclusão (indexar/exportar/oficina) — chime de 2 notas (E5 → B5, quinta justa)
  success: () => {
    tone(659.25, 0.13, { gain: 0.5 });
    tone(987.77, 0.2, { gain: 0.45, delay: 0.11 });
  },
  // mandar pra lixeira — "thunk" macio descendo
  trash: () => tone(240, 0.15, { type: "triangle", gain: 0.5, sweepTo: 130 }),
  // erro — duas notas graves curtas
  error: () => {
    tone(320, 0.1, { type: "triangle", gain: 0.5 });
    tone(250, 0.14, { type: "triangle", gain: 0.5, delay: 0.09 });
  },
};
