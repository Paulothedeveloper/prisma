# Design

Sistema visual do PRISMA. Fonte da verdade: `src/App.css` (`:root`). Tema **dark-only**, estética "liquid glass" inspirada em macOS/iOS.

## Color

### Superfícies
| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#1a1a1c` | Fundo principal |
| `--bg-2` | `#161618` | Fundo mais escuro (barras de progresso) |
| `--elev` | `#2c2c2e` | Elevação 1 (botões, cards) |
| `--elev-2` | `#3a3a3c` | Elevação 2 (hover) |

### Texto
| Token | Valor | Uso |
|---|---|---|
| `--text` | `#f5f5f7` | Primário |
| `--text-2` | `#98989d` | Secundário (labels, hints) |
| `--text-3` | `#6e6e73` | Terciário (atenção: contraste no limite) |

### Acento e status
| Token | Valor | Uso |
|---|---|---|
| `--accent` | `#0a84ff` | Ação primária (azul iOS, trocável) |
| `--accent-soft` | `rgba(10,132,255,0.18)` | Fundo do acento |
| `--ok` | `#30d158` | Sucesso (verde Apple) |
| `--warn` | `#ff9f0a` | Aviso / rating (laranja Apple) |

Opções de acento (Ajustes › Geral): `#0a84ff` `#30d158` `#ff375f` `#ff9f0a` `#bf5af2` `#64d2ff` `#ffd60a` — todas cores de sistema Apple.

### Espectro da marca (ícone/prisma)
`#FF453A` `#FF9F0A` `#FFD60A` `#30D158` `#40C8E0` `#0A84FF` `#BF5AF2` — usar como acento intencional e em momentos de destaque (progresso, onboarding), não como ruído.

### Vidro / bordas
- `--hair: rgba(255,255,255,0.09)` · `--hair-strong: rgba(255,255,255,0.16)`
- `--glass-border: rgba(255,255,255,0.16)`
- `--glass: linear-gradient(180deg, rgba(255,255,255,0.11), rgba(255,255,255,0.035)), rgba(58,60,68,0.3)`
- Blur: `--blur: saturate(200%) blur(42px)` · `--blur-strong: saturate(220%) blur(50px)`

## Typography

- **Sans:** `-apple-system, "SF Pro Text", "SF Pro Display", "Inter", "Helvetica Neue", system-ui, sans-serif`
- **Mono:** `"SF Mono", "JetBrains Mono", ui-monospace, "Cascadia Code", monospace` (metadados)
- Base 13px, `letter-spacing: -0.01em` (aperto à la Apple)
- Pesos de ênfase: 550 / 600 / 700
- Escala observada: 10.5px (labels) → 13px (corpo) → 15px (marca na toolbar)

## Spacing & Radius

- `--radius: 12px` · `--radius-lg: 18px`
- `--thumb: 190px` (card de asset, animável p/ zoom suave)
- `--sb: 250px` (sidebar) · `--insp: 340px` (inspector)

## Motion

- Easing Apple-like: `cubic-bezier(0.22, 0.61, 0.36, 1)`
- Keyframes: `menuIn`, `itemIn`, `cardIn`, `gridOut`, `prismPulse`, `spectrumShift`, `shimmerSweep`, `slideInRight`, `popIn`, `fadeIn`
- Durações 100ms–2.4s; `transition: --thumb 0.28s` para zoom de thumbnail
- Respeita `prefers-reduced-motion`

## Layout & Components

Janela Tauri com 3 painéis: **Toolbar (52px)** → **Filterbar (opcional)** → corpo **Sidebar (250px) · Grid virtualizado (react-virtuoso) · Inspector (340px)**. Componentes-chave: `AssetCard`/`AssetRow`, `Inspector` (preview, CST de 2 nós, health, Oficina, plano de cor IA), `FolderTree`, `Settings` (modal tabbed), `ContextMenu` (popup iOS-like), `Preview`/`PreviewWindow`, `CstCard`/`HealthCard`/`ColorPlanCard`, `WelcomeModal`, `TrafficLights`, `Coachmark`.

## Brand Assets

- Logo: `src/assets/logo.png` (prisma "Dark Side of the Moon")
- Ícone fonte: `icon-source.svg` (1024², refração prismática)
- Ícones: set monoline inspirado em SF Symbols (traço 1.6px, viewBox 24×24)

## A corrigir (oportunidades)

Telas vazias com ilustração/ícone (hoje só `.empty` em texto), fluxos de erro/recuperação, agrupamento visual das seções densas do Inspector, onboarding mais rico, feedback de drop no Moodboard.
