# CLAUDE.md — {{PROJECT_NAME}}

> **Posicionamento obrigatório (regra dura do sistema SPEC-driven v3):** as seções `## AVISO IMPERATIVO PRA IA — LER PRIMEIRO` e `### Primeira ação obrigatória em QUALQUER sessão` SEMPRE ficam no INÍCIO deste arquivo, antes de qualquer outra seção. Skill `spec-system-init` (Step 7) garante isso em merge mode.

---

## AVISO IMPERATIVO PRA IA — LER PRIMEIRO

Este é um projeto **SPEC-driven v3**. A documentação em `docs/` **não é para humanos** — é para VOCÊ (IA) ter contexto rico quando retomar, continuar ou mexer em qualquer parte do projeto.

- **PROIBIDO** ler arquivos Nível 1+ (features, SPECs) sem **confirmação explícita do usuário**.
- **OBRIGATÓRIO** seguir o protocolo de escalação do [docs/RULES.md](docs/RULES.md) §4.
- **PROIBIDO ABSOLUTO** decidir sozinho que um critério de aceite da SPEC é "OK pra deixar pra depois", "gap aceitável", "fica pra SPEC futura" ou qualquer racionalização equivalente. **Só o usuário pode aceitar entrega incompleta.** Ver [docs/RULES.md R.6.2](docs/RULES.md). Se IA precisar deferir algo, **PERGUNTA** o que fazer (implementar agora / mover pra SPEC nova / aceitar gap) — uma escolha por critério, todas com aprovação explícita.

### Primeira ação obrigatória em QUALQUER sessão

Antes de qualquer código, qualquer resposta substantiva:

1. Ler este `CLAUDE.md`
2. Ler [docs/RULES.md](docs/RULES.md) — processo completo (fonte da verdade)
3. Ler [docs/INDEX.md](docs/INDEX.md) — mapa de features
4. Listar `docs/active/` (SPECs ativas na branch local — pode estar vazio em main)
5. Confirmar por texto que leu:
   > *"Li CLAUDE.md, docs/RULES.md v3, docs/INDEX.md (X features). Active local: [lista]. Como posso ajudar?"*
6. Aguardar o prompt do usuário e seguir o protocolo de escalação do RULES §4.

**Se houver SPEC ativa e o prompt conectar ao escopo dela:** pode ler `docs/active/SPEC-X/main.md` (contrato) após confirmar classificação. **NÃO** leia `state.md` ou `memory.md` da SPEC sem ANTES informar o usuário e pedir confirmação.

---

## Descrição do projeto

{{PROJECT_DESC}}

---

## Stack

**{{STACK}}**

## Comandos

{{DEV_COMMANDS}}

---

## Processo SPEC-driven v3 — resumo

Fonte da verdade: [docs/RULES.md](docs/RULES.md). Resumo operacional:

1. **Documentação é para a IA**, não para humanos. Única exceção: `main.md` de cada SPEC (contrato humano-validado).
2. **Estrutura:**
   - `docs/features/<area>.md` — estado VIVO de cada área do código
   - `docs/active/SPEC-<id>/` — 3 arquivos: main (contrato), state (log), memory (cérebro vivo)
   - `docs/future/`, `docs/archive/`, `docs/discard/` — ciclo de vida
   - `docs/INDEX.md` — mapa de features (gerado pelo CI)
3. **IDs de SPEC = timestamp** (`SPEC-YYYYMMDD-HHMM-slug`). Nunca sequencial. Nunca reutilizar.
4. **Invariante:** `docs/active/` em `main` é sempre VAZIO. SPECs ativas vivem APENAS em branches.
5. **Toda SPEC se vincula a 1+ feature.** Feature nova nasce com a SPEC que a introduz — **com confirmação explícita do usuário** (R.13).
6. **Timestamps obrigatórios em TUDO:** checkbox, célula de status, decisão, atualização. Commit hash quando houver código.
7. **Progresso de aceite em tempo real:** critério validado durante execução é marcado em `main.md` IMEDIATAMENTE (R.6.1) — não esperar fechamento.
8. **Critério de aceite é binário** (R.6.2). IA NUNCA decide sozinha que um critério incompleto é "gap aceitável" — só o usuário pode aceitar, e SPEC com critério `[ ]` NÃO arquiva sem aprovação explícita item-a-item.
9. **Ao concluir SPEC**, todas as features tocadas DEVEM ser atualizadas no mesmo PR (R.7). `audit-docs.sh` bloqueia PR sem isso. Snapshot do `state.md` é sobrescrito refletindo conclusão (zero `pendente`/`em progresso`/`bloqueado`).
10. **Programas de SPECs** (sequências ordenadas) declaram `Depende de:` / `Bloqueia:` / `Ordem no programa:` no `main.md` (R.14). Relação Depende/Bloqueia é bidirecional consistente — auditada.
11. **Classificação obrigatória de prompt:** continuidade / nova SPEC / livre. Em ambiguidade, PERGUNTAR — nunca assumir.
12. **Protocolo de escalação de leitura:**
    - Nível 0 (CLAUDE + RULES + INDEX): sempre, automático
    - Nível 1 (features + main da SPEC): sob CONFIRMAÇÃO do dev
    - Nível 2 (state + memory da SPEC): sob PERGUNTA EXPLÍCITA
    - Nível 3 (archive de outras SPECs): só se raciocínio histórico for necessário
13. **Append-only no `state.md`** (exceto snapshots de Status / Próximos passos / Bloqueios — esses são sobrescritos); sobrescrever no `memory.md`; atualizar `features/<X>.md` ao arquivar SPEC.

---

## Convenções de código

_(adicionar convenções específicas do projeto aqui conforme forem sendo estabelecidas: tamanho máximo de arquivo, estilo, imports, nomenclatura, comentários, testes, etc.)_

---

## Arquitetura

_(resumo rápido da arquitetura. Se crescer, mover para `docs/features/` quebrado por área.)_

---

## Visão de produto

_(resumo da visão. Se crescer, mover para arquivo dedicado.)_
