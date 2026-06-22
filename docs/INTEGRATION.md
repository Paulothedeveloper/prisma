# PRISMA — Integração com o ecossistema (VELVET · QUARTZO · IA)

> Contrato estável de integração. O PRISMA é o **almoxarifado de assets**: sabe ONDE
> está cada LUT/footage e o HUMOR de cada um. O **VELVET** (cor no DaVinci Resolve) e o
> **QUARTZO** (PKM, nossas notas) conversam com ele por aqui. Este documento é a fonte da
> verdade do contrato — se mudar, a versão é versionada (campo `schema`).

## 1. VELVET ↔ PRISMA — catálogo de LUTs por humor

O VELVET escolhe a LUT do catálogo do PRISMA **por humor** (quente/frio, claro/escuro,
vívido). Há dois caminhos:

### a) Contrato estável (recomendado): `velvet_luts.json`
O PRISMA exporta, sob demanda (Configurações › Ecossistema › "Exportar catálogo de LUTs
pro VELVET") ou via comando `export_velvet_catalog`, o arquivo:

```
%APPDATA%\com.paulo.prisma\velvet_luts.json
```

Formato (`schema: "prisma.velvet.luts/1"`):
```json
{
  "schema": "prisma.velvet.luts/1",
  "count": 1234,
  "luts": [
    {
      "id": 42,
      "path": "E:\\EDITOR PREMIUM\\LUTS\\Quente\\golden.cube",
      "name": "Golden",
      "ext": "cube",
      "warm": "warm",      // warm | neutral | cold  (pode ser null)
      "bright": "medium",  // dark | medium | light   (pode ser null)
      "sat": "vivid",      // bw | subtle | vivid      (pode ser null)
      "ai_desc": "pôr do sol dourado, pele quente",
      "tags": ["cinema", "quente"]
    }
  ]
}
```

O VELVET lê esse JSON e filtra por humor. **Vantagem:** desacopla o VELVET do schema do
banco — eu posso mudar o SQLite sem quebrar a integração. Sempre que o catálogo mudar,
reexporte (ou o VELVET dispara o comando).

### b) Leitura direta do SQLite (read-only)
O banco fica em `%APPDATA%\com.paulo.prisma\prisma.db` (SQLite WAL — leitura externa é
segura mesmo com o PRISMA aberto). Exemplo:
```sql
SELECT path, name, warm, bright, sat, ai_desc
FROM assets
WHERE type='lut' AND trashed=0 AND warm='warm' AND bright='medium';
```
Use o JSON quando puder; o `.db` direto quando precisar de algo que o JSON não traz.

## 2. QUARTZO ↔ PRISMA — notas ligadas aos assets

O QUARTZO é o nosso PKM (vault markdown). A "ligação" entre nota e asset é **bidirecional**:

- **No PRISMA** (Configurações › Ecossistema): aponte a pasta do vault do Quartzo.
- **No painel Detalhes** de cada item: seção **Quartzo** →
  - **anexar** o asset a uma nota (`quartzo_attach`): acrescenta um bloco markdown na nota
    com link de arquivo + deep-link `prisma://asset/<id>` + caminho;
  - **ver** as notas que citam o asset (`quartzo_notes_for_asset`);
  - **abrir** a nota (`quartzo_open_note`).

### Deep-link (contrato)
- `prisma://asset/<id>` — abre o PRISMA naquele asset (a ser registrado como esquema de
  URI; hoje o link é escrito nas notas como referência estável).
- O PRISMA também usa a infra de RAG (`vault_chunks` / `reindex_vault` / `search_vault`)
  pra IA ler as receitas escritas no Quartzo — aponte o vault de cor do Quartzo no PRISMA.

## 3. Papéis (sem redundância)
- **VELVET** = a mão que pinta (aplica cor na GPU, dentro do Resolve).
- **PRISMA** = o almoxarifado (qual LUT/footage usar; lê a cor do clipe).
- **QUARTZO** = o livro de conhecimento (COMO o Paulo faz — receitas).
- **IA** = o colorista que junta os três + a intenção e decide.

> Comandos Tauri expostos: `export_velvet_catalog`, `quartzo_get_vault`,
> `quartzo_set_vault`, `quartzo_notes`, `quartzo_attach`, `quartzo_notes_for_asset`,
> `quartzo_open_note`.
