<div align="center">

# PRISMA

### Biblioteca inteligente de mídia, feita por um editor de vídeo — para editores de vídeo.

**Organize, leia e prepare seus arquivos de vídeo, áudio e imagem em um só lugar.**
Gratuito · Funciona offline · Nunca toca nos seus arquivos originais.

<sub>Windows · Tauri 2 (Rust) + React/TypeScript + SQLite + ffmpeg</sub>

[**⬇ Baixar a última versão**](https://github.com/EllaeMyApp/prisma/releases/latest) · [Releases](https://github.com/EllaeMyApp/prisma/releases) · [Reportar um problema](https://github.com/EllaeMyApp/prisma/issues)

</div>

---

## O que é o PRISMA

O PRISMA é um **gerenciador de acervo de mídia (DAM — Digital Asset Manager)** pensado do zero para o fluxo de quem **edita e finaliza vídeo**. Ele indexa as suas pastas **no lugar onde elas já estão** — não move, não copia, não renomeia e **não altera** nenhum arquivo original — e te dá uma central rápida para encontrar, pré-visualizar, etiquetar e **preparar** seus assets.

Além de catalogar (como o Eagle e outros), o PRISMA entende a parte **técnica** do vídeo: ele lê os metadados de cor de cada clipe e te diz **como configurar a conversão de espaço de cor (CST) no DaVinci Resolve**, gera **proxies** automaticamente para tocar codecs profissionais, e tem uma oficina de **codificação e estabilização** embutida.

## Para quem é

- **Editores e finalizadores de vídeo** que têm milhares de arquivos espalhados em HDs e precisam achar tudo rápido.
- **Coloristas** que querem a recomendação de CST certa por clipe (Rec.709, S-Log3, HLG, Apple Log…).
- **Criadores de conteúdo / social media** (Reels, YouTube) que trabalham com material de câmera, celular e banco de assets.
- Qualquer pessoa que queira uma biblioteca de mídia **local, privada e sem mensalidade**.

## Principais recursos

| | |
|---|---|
| 🗂️ **Catálogo de qualquer mídia** | Vídeo, áudio, imagem, GIF e qualquer extensão. Miniaturas, forma de onda de áudio, cor dominante, duração, estrelas, notas e tags. |
| ⚡ **Pré-visualização fluida** | Toca ao passar o mouse, player próprio com scrub quadro-a-quadro, e **proxies automáticos** para tocar ProRes/DNxHR/.mov/.m4v que o navegador não decodifica. |
| 🎨 **Leitor CST** | Lê os metadados de cor (MediaInfo/ffprobe) e **recomenda a transformação de espaço de cor** para o DaVinci — incluindo o aviso quando o arquivo perdeu a etiqueta de transfer. |
| 🛠️ **Oficina** | Codificação avançada (codec, resolução, FPS, qualidade, áudio, filtros), VFR→CFR, reencapsular, extrair áudio, proxies e entrega — tudo **não destrutivo** (saída em subpasta). |
| 🎚️ **MotionSilk** | Estabilização de vídeo embutida. |
| 🤖 **Busca por conteúdo com IA** | Ache por "praia", "pessoa", "céu". Opcional, com **sua própria chave** (veja abaixo). |
| 📁 **Pastas inteligentes & Watch Folder** | Coleções por regra e indexação automática quando você adiciona arquivos. |
| 🔎 **Busca por imagem** | Ache visualmente parecidos (hash perceptual, local). |
| 🧹 **Duplicados & Lixeira** | Detecção de duplicados e lixeira reversível — **sem apagar nada do disco**. |

## Privacidade e segurança — pode usar sem medo

A gente leva isso a sério. O PRISMA foi feito para ser **seguro e transparente**:

- 🔒 **Roda 100% no seu computador.** Não há servidor, login nem nuvem. Sua biblioteca é sua.
- 🛡️ **Nunca toca nos seus originais.** Toda operação (conversão, proxy, estabilização) gera **arquivos novos em subpastas**. O arquivo original fica exatamente como estava.
- 👀 **Código aberto.** Este repositório é **público** — qualquer pessoa pode inspecionar exatamente o que o programa faz.
- 🤖 **A IA é opcional e usa a SUA chave.** A busca por conteúdo só funciona se **você** colar a sua própria chave da API da Anthropic. A chave fica **somente neste PC** (em um arquivo de configurações local), **nunca é enviada para nós** nem para terceiros. Só a **miniatura** (512px) é enviada para análise, e **apenas quando você clica em "Analisar"** — nunca de forma automática.
- ♻️ **Reversível.** Excluir vai para a Lixeira; "Remover da biblioteca" tira do catálogo do PRISMA **sem apagar o arquivo do disco**.

> **Sobre a chave de IA:** você usa a sua própria chave para ter **controle total do custo** e da privacidade. Crie a sua em [console.anthropic.com](https://console.anthropic.com) e cole nas Configurações › IA e busca. Se você não quiser usar IA, todo o resto do PRISMA funciona normalmente, **offline**.

## Como instalar

1. Vá em **[Releases](https://github.com/EllaeMyApp/prisma/releases/latest)**.
2. Baixe o instalador do Windows: **`PRISMA_x.y.z_x64-setup.exe`** (em português).
3. Rode o instalador e abra o PRISMA. Adicione uma pasta e pronto.

> O instalador é **autocontido** — já vem com o ffmpeg e o motor de estabilização embutidos. Não precisa instalar mais nada.

## Quem fez

<!-- Foto do criador entra aqui quando disponível: docs/creator.jpg -->

O PRISMA é criado por **Paulo Adriel**, produtor e editor de vídeo. Ele nasceu de uma necessidade real do dia a dia de edição: ter uma biblioteca de mídia que entendesse de **vídeo de verdade** — cor, codec, proxy, finalização — e não só de miniaturas bonitas. Cada recurso saiu de um problema concreto de produção.

O desenvolvimento é feito de forma **aberta e contínua**, pareando a experiência prática do Paulo em edição e color com IA de programação. **Todo dia a gente tenta melhorar o PRISMA** — corrigindo, refinando e adicionando o que falta para o fluxo de pós-produção.

## Stack técnica

- **Desktop:** [Tauri 2](https://tauri.app) (backend em **Rust**)
- **Interface:** **React 19 + TypeScript** (Vite)
- **Banco:** **SQLite** (rusqlite, embutido)
- **Mídia:** **ffmpeg / ffprobe** locais (miniaturas, forma de onda, proxies, codificação)
- **IA (opcional):** API da Anthropic (Claude) — chave do próprio usuário

## Contribuindo e feedback

O PRISMA está em evolução constante. Achou um bug, tem uma ideia ou quer um recurso? **Abra uma [issue](https://github.com/EllaeMyApp/prisma/issues).** Todo retorno ajuda a melhorar o programa para a comunidade.

## Licença

Distribuído **gratuitamente**. Uso livre.

---

<div align="center">
<sub>Feito com cuidado, por quem edita — para quem edita.</sub>
</div>
