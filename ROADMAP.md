# PRISMA — Roadmap (cobertura total: pendências + melhorias + features novas)

> Regra: cada release é verificada por ferramenta (tsc + cargo + teste quando dá) e documentada
> em 4 lugares (app, vault, release GitHub, README). Nada fica de fora.

## ✅ Entregue (0.7.0 → 0.9.0)
- 0.7.0 subpastas-cards, busca de pastas + escopo, Video Downloader (yt-dlp), Music Player c/ letra
- 0.7.1 formatos RAW/JXL/HEIC (preview embutido)
- 0.7.2 Live Photo + Perguntar à IA
- 0.8.0 Ecossistema: VELVET (export LUTs por humor) + Quartzo (ligar assets às notas)
- 0.8.1 AI Image Enlarger (Real-ESRGAN 4x)
- 0.8.2 AI Background Remover (u2netp ONNX)
- 0.9.0 **Busca semântica local (CLIP)**

## 0.9.1 — Endurecimento (auditoria) + 2 bugs de print ✅ (publicado)
**Bugs reportados (prints)**
- [x] **Bug visual**: sobreposição de miniaturas (cards de pasta na grade) — pastas foram pro
      `components.Header` do Virtuoso, fim do offset de índice que reciclava DOM
- [x] **Setas voltar/avançar**: histórico de navegação (como navegador) no cabeçalho
**Pendências reais**
- [x] Índices faltantes: `name`, `modified_at`, `(trashed,type)`, `(dir,type)`, `sat`
- [x] `.lock().unwrap()` (26×) → `unwrap_or_else(|p| p.into_inner())` (recupera de poison, não paniqua)
- [ ] Licença: checagem **ed25519 real** → adiada (gate está dormente/tudo livre; faço na virada comercial)
**Qualidade**
- [x] N+1 query no `ecosystem.rs` → 1 JOIN com group_concat
- [x] Migração de schema: `PRAGMA table_info` + `tracing::warn` (parar de depender de erro silenciado)
- [x] Front: `.catch` de subfolders/searchFolders → `console.warn` em vez de sumir
- [ ] `let _ =` sensíveis restantes (emit de progresso) → log — parcial
**Meia-boca**
- [x] Limites maiores: smart folder `LIMIT 1000→10000`, desc IA 240→500, RAW 4→8 JPEGs
- [x] Concorrência: teto `clamp(1,4)→clamp(1,8)`
- [ ] UI pra **desparear** Live Photo / image-sequence → adiada (edge case)

## 0.9.2 — Exclusão & menu de contexto (bug reportado)
- [ ] **Confirmação in-app** (modal animado + SFX) no lugar de `window.confirm` — que é
      não-confiável no WebView (causa de "não aparece confirmação" e "pasta não exclui em silêncio")
- [ ] **Exclusão de pasta** com animação + SFX (hoje passa direto, sem feedback) — unificar com `removeWithAnim`
- [ ] **Limpar proxy + thumbnail em disco** ao excluir asset / esvaziar lixeira / remover pasta
      (hoje só apaga a linha do banco; arquivos ficam órfãos em `data_dir/proxies` e `thumbs`)
- [ ] **"Algumas pastas não excluem"** — robustez do `remove_folder` (case/trailing slash) + confirmar
- [ ] **Auditar todas as ações do botão direito** (mídia + pasta): garantir feedback, SFX e que cada uma faz o que diz

## 0.9.3 — VELVET: "Aplicar CST no DaVinci" (1 botão)
- [ ] Botão no Detalhes (vídeo) → PRISMA decide a árvore de nós (CST IN/OUT + Exposição/Balance/
      Saturação/Curva + nó VELVET) e grava um **request** (`velvet_apply.json`) que o plugin VELVET
      (Resolve Python API) consome pra montar e aplicar. Contrato em `docs/INTEGRATION.md`.

## 0.9.3 — Deep-link real
- [ ] Registrar `prisma://asset/<id>` no Windows (bidirecional de verdade com Quartzo/VELVET)

## 0.10.0 — IA da fila
- [ ] AI Eraser (apagar objeto, inpainting LaMa)
- [ ] MCP Server (expor a biblioteca via MCP)

## 0.10.1 — CLIP++
- [ ] Busca semântica em **vídeo** (embedding do frame do meio)
- [ ] Busca por **imagem-exemplo** ("ache parecidas com esta")
- [ ] **Auto-tag zero-shot** com CLIP (sem gastar API)

## 0.11.0 — Fluxo de editor
- [ ] Export **Premiere XML** (além do FCPXML)
- [ ] **Enviar pro Resolve** direto (não só arquivo)
- [ ] **Marcadores in/out** num clipe (mandar só um trecho)
- [ ] **Coleções ↔ bins** do Resolve (sincronizar)

## 0.11.1 — Designer
- [ ] **Contact sheet / export de moodboard** (PNG/PDF)
- [ ] **Paleta → .cube** (LUT/swatches pro Resolve/Photoshop)

## 0.12.0 — Painel "Color (VELVET)" dentro do PRISMA (Nível 3)
- [ ] Escopos + intenção → seta os sliders do VELVET_Core via Resolve API (depende do VELVET maduro)
