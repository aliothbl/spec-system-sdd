---
name: spec-system-init
description: Initialize the SPEC-driven documentation system v3 (features-based) in a workspace. Creates docs/ (RULES.md, INDEX.md, features/, active/, future/, archive/, discard/) and scripts/ (generate-index.sh, lint-docs.sh, audit-docs.sh). Creates or updates CLAUDE.md at project root to orient AI. Use when the user says "inicializar sistema de documentação", "setup specs", "init doc system", "bootstrap docs", or is starting a new project that needs disciplined spec-based documentation.
version: v3
---

# spec-system-init v3

Inicializa o sistema de documentação SPEC-driven **v3 (features-based)** no workspace atual.

Principais diferenças do sistema antigo (v1 — descontinuado):
- IDs de SPEC são **timestamp** (`SPEC-YYYYMMDD-HHMM-slug`), não sequenciais
- Cada SPEC vive em uma **pasta** com 3 arquivos (`main.md` + `state.md` + `memory.md`)
- **`docs/features/`** substitui `memory.md` raiz como índice vivo por área
- **`docs/INDEX.md`** gerado por CI a partir dos cabeçalhos das features
- **Zero `memory.md`/`history.md` raiz** — conteúdo migra para features/ e SPECs
- Scripts de apoio criados em `scripts/` (`generate-index.sh`, `lint-docs.sh`, `audit-docs.sh`)
- **Invariante:** `docs/active/` em `main` é sempre vazio (SPECs ativas vivem em branches)
- Regras imperativas (DEVE/PROIBIDO/OBRIGATÓRIO) com mitigações de riscos R1-R4

Novidades em v3 (revisão 2026-06-02, derivada de uso em produção):
- **R.6.1** — Progresso de aceite no `main.md` durante execução (checkboxes marcados em tempo real, não esperar fechamento)
- **R.6.2** — Escopo da SPEC é contrato; **só o usuário** pode aceitar incompleto. IA NUNCA decide sozinha que critério é "gap aceitável" / "fica pra SPEC futura"
- **R.14** — Ordem e dependência entre SPECs de programa: 3 campos obrigatórios no `main.md` (`Depende de:` / `Bloqueia:` / `Ordem no programa:`) com auditoria bidirecional
- Novos anti-patterns refletindo R.6.2 e R.14
- **Posicionamento obrigatório**: `## AVISO IMPERATIVO PRA IA — LER PRIMEIRO` e `### Primeira ação obrigatória em QUALQUER sessão` SEMPRE no início do `CLAUDE.md`, antes de qualquer outra seção (incluindo descrição do projeto). Step 7 desta skill garante isso em merge mode.

## Quando disparar

Sinais de intenção do usuário:
- "inicialize/inicializar o sistema de documentação"
- "setup/bootstrap specs"
- "init doc system"
- "criar a estrutura de documentação"
- "começar novo projeto com specs"

## O que esta skill cria

```
<workspace-root>/
├── CLAUDE.md                          ← criado ou mesclado
├── scripts/
│   ├── generate-index.sh
│   ├── lint-docs.sh
│   └── audit-docs.sh
└── docs/
    ├── RULES.md                       ← processo completo (imperativo)
    ├── INDEX.md                       ← template inicial (será preenchido pelo CI)
    ├── features/                      ← vazia (populada quando SPECs criarem features)
    ├── active/                        ← vazia (SPECs ativas vivem em branches)
    ├── future/                        ← vazia
    ├── archive/                       ← vazia
    └── discard/                       ← vazia
```

## Execução

### Step 1 — Inspecionar estado atual

Usar Bash `ls` e Read com try-catch para detectar:
- `docs/` já existe? → **PARAR**. Perguntar: "Já existe `docs/`. Abortar (A) ou continuar mesclando (M)?" Default: abortar.
- `CLAUDE.md` no root existe? → marcar para MERGE (append-section), não sobrescrever.
- `scripts/` já existe? → se sim, não sobrescrever scripts homônimos; apenas adicionar os que faltam e avisar.
- Diretório de trabalho atual = target workspace root.

### Step 2 — Auto-analisar projeto (NÃO perguntar o que já está documentado)

**ANTES de fazer qualquer pergunta**, ler o que já existe no workspace para inferir valores dos placeholders. O usuário não deve redigitar o que já está documentado.

**Fontes de inferência (tentar nesta ordem, parar ao achar):**

**Nome do projeto (`{{PROJECT_NAME}}`):**
1. `CLAUDE.md` → primeiro heading `# CLAUDE.md — <NAME>` ou `# <NAME>`
2. `README.md` / `readme.md` → primeiro `# heading`
3. `package.json` → `"name"` (se monorepo, usar nome root ou pedir confirmação)
4. `pyproject.toml` → `[project] name` ou `[tool.poetry] name`
5. `Cargo.toml` → `[package] name`
6. `go.mod` → `module <name>` (última parte após `/`)
7. `composer.json` → `"name"`
8. `Gemfile` / `*.gemspec` → padrão específico
9. Fallback: nome da pasta-raiz (basename do cwd)

**Descrição (`{{PROJECT_DESC}}`):**
1. `CLAUDE.md` → primeiro parágrafo após o heading
2. `README.md` → primeiro parágrafo após o heading (pulando badges)
3. `package.json` → `"description"`
4. `pyproject.toml` → `description`
5. `Cargo.toml` → `description`
6. Fallback: `"_(adicionar descrição)_"`

**Stack (`{{STACK}}`):**
Combinar múltiplas fontes:
1. `package.json` → detectar `"type": "module"`, deps principais (react, vue, svelte, next, nuxt, astro, express, fastify, nest, hono, elysia), devDeps (typescript, vite, webpack). Formar string tipo "Node.js + TypeScript + React + Vite".
2. `pyproject.toml` / `requirements.txt` → Python + frameworks (fastapi, flask, django, pydantic)
3. `Cargo.toml` → Rust + frameworks (axum, actix, rocket, tokio)
4. `go.mod` → Go + libs (gin, echo, fiber)
5. `*.csproj` / `*.sln` → .NET
6. `pom.xml` / `build.gradle` → Java/Kotlin + Spring/etc.
7. `Gemfile` → Ruby + Rails/etc.
8. `Dockerfile` / `docker-compose.yml` → adicionar "Docker"
9. Bancos detectáveis em `.env.example`, `docker-compose.yml`, deps (`mysql2`, `pg`, `mongodb`, `mssql`, `@prisma/client`, `typeorm`)
10. Fallback: analisar extensões de arquivo mais frequentes

**Comandos (`{{DEV_COMMANDS}}`):**
1. `package.json` → `"scripts"`. Selecionar relevantes: `install`/`ci`, `dev`/`start`, `build`, `test`, `lint`.
2. `Makefile` → targets comuns (`install`, `dev`, `test`, `build`, `run`)
3. `pyproject.toml` → `[tool.poetry.scripts]` ou comandos comuns
4. `README.md` → seção "Installation" / "Getting started" — extrair blocos ` ```bash/sh/shell `
5. `CLAUDE.md` → se tiver seção "Comandos" / "Commands", copiar
6. Fallback: bloco placeholder ` ```bash\n# (adicionar comandos)\n``` `

### Step 3 — Apresentar valores detectados e pedir confirmação

Mostrar ao usuário **em UMA mensagem** os valores pré-preenchidos com as fontes, e pedir para confirmar ou editar:

```
Detectei os seguintes valores no workspace:

📦 Nome: <valor>                    (fonte: <arquivo>)
📝 Descrição: <valor>               (fonte: <arquivo>)
🛠️  Stack: <valor>                   (fonte: <arquivo(s)>)
⚡ Comandos:
<bloco>
                                    (fonte: <arquivo>)

Confirme com "ok" ou "tudo certo" para usar esses valores, OU
edite os que quiser ajustar (ex.: "stack: Bun + React + Elysia").
```

Se responder "ok" → prossegue. Se editar um campo → aplica e reusa o resto. Se nenhum achou nada → fazer as 4 perguntas clássicas uma a uma, sinalizando.

### Step 4 — Criar estrutura de pastas

Rodar via Bash:

```bash
mkdir -p docs/features docs/active docs/future docs/archive docs/discard scripts
```

### Step 5 — Escrever arquivos a partir dos templates

Ler cada template de `templates/` dentro da skill e escrever no workspace, substituindo placeholders:

| Template | Destino |
|----------|---------|
| `templates/RULES.md` | `docs/RULES.md` |
| `templates/INDEX.md` | `docs/INDEX.md` |
| `templates/CLAUDE.md` | `CLAUDE.md` (apenas se não existe) |
| `templates/scripts/generate-index.sh` | `scripts/generate-index.sh` |
| `templates/scripts/lint-docs.sh` | `scripts/lint-docs.sh` |
| `templates/scripts/audit-docs.sh` | `scripts/audit-docs.sh` |

**Placeholders a substituir:**

- `{{PROJECT_NAME}}` → detectado
- `{{PROJECT_DESC}}` → detectado
- `{{STACK}}` → detectado
- `{{DEV_COMMANDS}}` → detectado, envolvido em ```` ```bash ... ``` ````
- `{{TODAY}}` → data atual `YYYY-MM-DD`
- `{{NOW}}` → timestamp atual `YYYY-MM-DD HH:MM`

Usar data/hora real do sistema — NUNCA placeholders fictícios (`2024-01-01`, etc.). Se necessário, rodar `date +"%Y-%m-%d %H:%M"` via Bash.

### Step 6 — Tornar scripts executáveis

```bash
chmod +x scripts/generate-index.sh scripts/lint-docs.sh scripts/audit-docs.sh 2>/dev/null || true
```

(Inofensivo em Windows puro; útil em WSL/git bash/Linux/macOS.)

### Step 6.5 — Garantir `.gitignore` (R.12)

Verificar se o `.gitignore` do workspace inclui `docs/active/**/tmp/`. Se não:
- Se `.gitignore` não existe: criar com a linha
- Se existe mas não tem a regra: appendar bloco no final:

```
# SPEC-driven docs v3 — temporários por SPEC ativa (R.12)
docs/active/**/tmp/
```

Justificar pro usuário no report final: pasta `tmp/` por SPEC ativa para outputs de Playwright, screenshots, dumps, etc., conforme R.12 do RULES.md.

### Step 7 — Tratar `CLAUDE.md` existente (merge mode)

**REGRA DURA:** as seções `## AVISO IMPERATIVO PRA IA — LER PRIMEIRO` e `### Primeira ação obrigatória em QUALQUER sessão` **SEMPRE ficam no INÍCIO do `CLAUDE.md`**, logo após o `# <título>` opcional. Antes de qualquer outra seção — descrição do produto, stack, arquitetura, convenções, comandos, etc. Isso garante que a IA, ao ler o arquivo do topo, encontre as instruções imperativas antes de qualquer contexto técnico.

Se `CLAUDE.md` já existe no root:

1. Read atual.
2. Procurar cabeçalho "AVISO IMPERATIVO PRA IA" ou "Primeira ação obrigatória em QUALQUER sessão" ou "Documentação SPEC-driven" — se existir, avisar que há seção parecida e perguntar se usuário quer **sobrescrever pelo bloco canônico atualizado** ou manter.
3. Se NÃO existir: **inserir no INÍCIO do arquivo** (não no fim) o bloco canônico abaixo, logo após o `# <título>` se houver, antes de qualquer outra `##`:

   ```markdown
   ---

   ## AVISO IMPERATIVO PRA IA — LER PRIMEIRO

   Este é um projeto **SPEC-driven v3**. A documentação em `docs/` **não é para humanos** — é para você (IA) ter contexto rico ao retomar, continuar ou mexer em qualquer parte do projeto.

   - **PROIBIDO** ler arquivos Nível 1+ (features, SPECs) sem **confirmação explícita do usuário**.
   - **OBRIGATÓRIO** seguir o protocolo de escalação do [docs/RULES.md](docs/RULES.md) §4.
   - **PROIBIDO ABSOLUTO** decidir sozinho que um critério de aceite da SPEC é "OK pra deixar pra depois", "gap aceitável", "fica pra SPEC futura" ou qualquer racionalização equivalente. **Só o usuário pode aceitar entrega incompleta.** Ver [docs/RULES.md R.6.2](docs/RULES.md).

   ### Primeira ação obrigatória em QUALQUER sessão

   Antes de qualquer código, qualquer resposta substantiva:

   1. Ler este `CLAUDE.md`
   2. Ler [docs/RULES.md](docs/RULES.md) — processo completo (fonte da verdade)
   3. Ler [docs/INDEX.md](docs/INDEX.md) — mapa de features
   4. Listar `docs/active/` (SPECs ativas na branch local — pode estar vazio em `main`)
   5. Confirmar por texto que leu:
      > *"Li CLAUDE.md, docs/RULES.md v3, docs/INDEX.md (X features). Active local: [lista]. Como posso ajudar?"*
   6. Aguardar o prompt do usuário e seguir o protocolo de escalação do RULES §4.

   **Se houver SPEC ativa e o prompt conectar ao escopo dela:** pode ler `docs/active/SPEC-X/main.md` (contrato) após confirmar classificação. **NÃO** leia `state.md` ou `memory.md` da SPEC sem ANTES informar o usuário e pedir confirmação.

   ### Resumo do processo (fonte da verdade: [docs/RULES.md](docs/RULES.md))

   1. **Documentação é para IA**, não humanos. Exceção: `main.md` (contrato humano-validado).
   2. **SPEC** = pasta `SPEC-<YYYYMMDD-HHMM>-<slug>/` com `main.md` + `state.md` + `memory.md`.
   3. **Toda SPEC se vincula a 1+ feature** (criando se não existir — com confirmação explícita do usuário por R.13).
   4. **Invariante:** `docs/active/` em `main` é sempre VAZIO. SPECs ativas vivem em branches.
   5. **Timestamps `YYYY-MM-DD HH:MM` em TODA atualização** (checkbox, status, decisão).
   6. **Ao concluir SPEC**: checklist obrigatório R.5.3 + R.7 (features tocadas atualizadas, snapshot do state.md refletindo conclusão, memory.md TL;DR final, critérios marcados).
   7. **Programas de SPECs** declaram dependência bidirecional `Depende de` / `Bloqueia` + `Ordem no programa` (R.14).
   8. **Protocolo de escalação**: Nível 0 (auto) → Nível 1 (sob confirmação) → Nível 2 (sob pergunta) → Nível 3 (casos especiais).

   Qualquer dúvida operacional → [docs/RULES.md](docs/RULES.md).

   ---
   ```

   **Como inserir no início:** use Edit tool com:
   - `old_string` = primeira linha real do `CLAUDE.md` original que NÃO é o título `# ...` (ex.: a linha de descrição abaixo do título, ou a primeira `##` existente)
   - `new_string` = bloco canônico acima + `\n` + a linha original

   Se o arquivo começa direto com `# <título>`, inserir o bloco logo após o título + linha em branco. Se o arquivo não tem título nenhum (raro), inserir o bloco como primeira coisa do arquivo.

   **NUNCA appendar no final** — viola a regra dura de posicionamento.

### Step 8 — Report

Listar em uma única mensagem:
- Arquivos criados (com caminhos)
- Arquivos modificados (se CLAUDE.md foi mesclado)
- Scripts criados e tornados executáveis
- Próximos passos sugeridos:
  - "Revise `CLAUDE.md` e `docs/RULES.md` para detalhes específicos do seu projeto"
  - "Configure CI para rodar `scripts/generate-index.sh` em push/merge na `main` com mudanças em `docs/features/**`"
  - "Configure CI/pre-commit para rodar `scripts/lint-docs.sh` (falha bloqueia commit/PR)"
  - "Configure CI para rodar `scripts/audit-docs.sh --pr` em todos os PRs (bloqueia se R.7 violado)"
  - "Opcional: configurar git hook server-side ou CI check que rejeita merge com mudança em `docs/active/` (invariante R.2)"
  - "Quando tiver o primeiro trabalho, crie `docs/active/SPEC-<timestamp>-<slug>/` com os 3 arquivos (main, state, memory) seguindo formato em `docs/RULES.md §3`"

## Anti-patterns (desta skill)

- ❌ **Sobrescrever** `docs/` ou `CLAUDE.md` existentes sem confirmação
- ❌ Usar timestamps do treinamento em vez de `date` do sistema
- ❌ **Perguntar info que já está em arquivo existente** — sempre inferir de `package.json`, `README.md`, `CLAUDE.md`, etc. antes
- ❌ Apresentar perguntas em branco ou em várias mensagens — mostrar tudo pré-preenchido em uma mensagem
- ❌ Commitar arquivos criados (deixar para o usuário decidir)
- ❌ Criar SPECs ou features de exemplo — pastas ficam vazias; usuário cria conforme demanda
- ❌ Preservar `memory.md` e `history.md` raiz de v1 — v3 migra conteúdo para `features/` e `archive/SPEC-*/`
- ❌ **Posicionar `AVISO IMPERATIVO PRA IA` ou `Primeira ação obrigatória` em qualquer lugar que NÃO seja o INÍCIO do `CLAUDE.md`** — esses blocos vêm antes de qualquer outra seção do arquivo (Step 7)
- ❌ Em merge mode, **appendar** as seções imperativas no final do `CLAUDE.md` existente — DEVE ser prepend (Step 7)

## Templates location

Os templates ficam em `templates/` ao lado deste SKILL.md:
- [templates/RULES.md](templates/RULES.md)
- [templates/CLAUDE.md](templates/CLAUDE.md)
- [templates/INDEX.md](templates/INDEX.md)
- [templates/scripts/generate-index.sh](templates/scripts/generate-index.sh)
- [templates/scripts/lint-docs.sh](templates/scripts/lint-docs.sh)
- [templates/scripts/audit-docs.sh](templates/scripts/audit-docs.sh)
