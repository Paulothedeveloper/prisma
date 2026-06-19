# ◈ PRISMA

Biblioteca de assets de mídia (DAM) tipo Eagle — mas do Paulo, sem mensalidade,
que aceita **qualquer extensão** e trata **áudio como cidadão de 1ª classe**.
Indexa pastas **no lugar** (nunca move nem copia os arquivos originais).

> Crate, lib, executável, banco (`prisma.db`) e produto: **PRISMA**.
> (A pasta do projeto em disco ainda se chama `acervo` por histórico — só o diretório.)

Stack: **Tauri 2** (Rust) + **React + TypeScript** (Vite) + **SQLite** (rusqlite, bundled) +
**ffmpeg/ffprobe** locais (thumbs de vídeo e forma de onda de áudio).

## Como rodar (dev)

```powershell
cd "D:\Projetos do Claude\acervo"
npm install
npm run tauri dev
```

Hook de teste opcional — indexa uma pasta automaticamente no boot:

```powershell
$env:PRISMA_AUTOINDEX="C:\caminho\da\pasta"; npm run tauri dev
```

## Como gerar o instalável (Windows)

```powershell
npm run tauri build
```

Gera o `.msi`/`.exe` em `src-tauri\target\release\bundle\`.
O ffmpeg/ffprobe vão embutidos como recurso (`src-tauri\binaries\`).

## Onde ficam os dados

- Banco e miniaturas: `%APPDATA%\com.paulo.prisma\` (`prisma.db` + `thumbs\`).
- Os assets originais **não são tocados** — só lidos.

## Status — MVP (Fase 1) ✅

- [x] Adicionar pasta → indexação em background (fila com concorrência limitada, não crasha em lote grande)
- [x] Catálogo SQLite de TUDO (caminho, tipo, tamanho, dimensões, duração)
- [x] Grade virtualizada de miniaturas (react-virtuoso) com tamanho ajustável
- [x] Thumbs de imagem (crate `image`) e de vídeo (frame via ffmpeg)
- [x] Áudio com forma de onda + duração
- [x] Qualquer extensão entra (ícone genérico + metadados; nunca recusa)
- [x] Busca instantânea por nome + filtro por categoria
- [x] Hover preview: vídeo faz **scrub**, gif anima, áudio toca — sem abrir o arquivo
- [x] Duplo-clique → abre no Explorer
- [x] Identidade visual PRISMA (escuro + liquid glass)

## v0.4 ✅ — HIG pass (cara macOS de verdade)

- [x] **Janela sem barra do Windows** (decorations:false) + **semáforos do macOS** (fechar/minimizar/zoom) na toolbar arrastável
- [x] **Ícones SF-style** (SVG monoline) em todo lugar — fim dos glifos unicode
- [x] **Pop-up buttons** (menus translúcidos arredondados, com check) no lugar dos `<select>` nativos do Windows
- [x] **Sidebar source-list** estilo macOS (seleção azul arredondada, ícones, headers de seção, árvore de pastas com disclosure)
- [x] **Search field** macOS (lupa + botão limpar), materiais com vibrancy mais forte, scrollbars overlay finas, raios/spacing refinados

## v0.3 ✅ — Redesign Apple + MediaInfo/CST + navegação

- [x] **Redesign completo estilo Apple (Final Cut/Logic escuro pro)**: SF Pro, fundo grafite, acento azul macOS, vidro fosco (vibrancy), toolbar + barra de filtros + sidebar + inspetor. Logo nova (prisma refratando luz).
- [x] **Navegação de pastas** (árvore que espelha o disco, na lateral)
- [x] **Preview grande com player**: espaço ou duplo-clique abre; vídeo com controles, imagem com fundo xadrez, áudio com waveform; ‹ › navega, Esc fecha
- [x] **Drag-and-drop do arquivo original** direto pro DaVinci/Premiere/Explorer (arrastando o card)
- [x] **MediaInfo + painel "CST RECOMENDADO"** (lógica do Briefing 2 / SONDA dentro do PRISMA): lê primaries/transfer/matrix/range/bit-depth/chroma/fps/codec + diz o CST de entrada (saída sempre Rec.709 / Gamma 2.4), prioriza fabricante, avisa 8-bit/HDR/rotação, botão "copiar config do CST"
- [x] **Filtros variados**: ordenação, resolução (SD/HD/FHD/4K+), duração, extensão, avaliação — combinam com tipo/cor/tag/pasta
- [x] **Corrompidos nunca catalogados**: mídia que não abre em nenhum decodificador fica fora da biblioteca

## Fase 2 ✅ (parte entregue)

- [x] Painel inspetor lateral (metadados completos: tipo, dimensões, duração, tamanho, caminho)
- [x] Estrelas (0–5) por asset + filtro por avaliação mínima
- [x] Notas por asset
- [x] Tags: criar/atribuir/remover no inspetor + filtrar por tag na lateral
- [x] Cor dominante computada + paleta de cores na lateral (filtra por cor)
- [x] Detecção de duplicados por hash rápido (tamanho + 64KB início/fim) + visão "Duplicados"
- [x] Filtro de lixo de SO no índice (`._*`, `.DS_Store`, `Thumbs.db`)
- [x] Fallback ffmpeg pra imagens que o decodificador Rust recusa

## Fase 2b / Fase 3 (pendente)

- **Fase 2b:** coleções/álbuns virtuais, pastas inteligentes (regras), re-scan/watch de pastas.
- **Fase 3:** preview grande (barra de espaço) com player, drag-and-drop do original pro
  DaVinci/Premiere, preview de LUT aplicada, sync notebook↔PC, extensão de navegador.
