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

## 0.9.1 — Endurecimento (TODA a auditoria)
**Pendências reais**
- [ ] Índices faltantes: `name`, `modified_at`, compostos `(trashed,type)` e `(dir,type)`
- [ ] `.lock().unwrap()` (~25×) → helper que não derruba o app (recupera de poison + log)
- [ ] Licença: trocar o stub por checagem **ed25519 real** (mantém tudo livre por padrão)
**Qualidade**
- [ ] N+1 query no `ecosystem.rs` → 1 JOIN
- [ ] `let _ =` sensíveis (set_health/assign_tag/commit/emit) → `tracing::warn` no erro
- [ ] Migração de schema: `PRAGMA table_info` + transação (parar de depender de erro silenciado)
- [ ] Front: `.catch(() => setX([]))` → avisar (toast/console) em vez de sumir
**Meia-boca**
- [ ] Limites configuráveis/maiores: `LIMIT 1000` (paginar/raise), vault `take(10)`, desc IA 240, RAW 4 JPEGs
- [ ] Concorrência: subir o teto `clamp(1,4)` conforme núcleos
- [ ] UI pra **desparear** Live Photo / image-sequence (corrigir falso-positivo)

## 0.9.2 — VELVET: "Aplicar CST no DaVinci" (1 botão)
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
