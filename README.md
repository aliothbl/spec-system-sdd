# Spec System SDD v3

A v3 instala um protocolo de desenvolvimento guiado por SPECs no Claude Code. Cada mudança tem um contrato com critérios de aceite, registro de progresso e memória de execução. As regras mantêm SPECs ativas nas branches de trabalho e registram o que foi entregue por área em `docs/features/`.

## Instalar no Claude Code

Tenha Git, Claude Code e Bash disponíveis. No Windows, use Git Bash ou um ambiente WSL com o Claude Code instalado. O clone exige credenciais com acesso ao repositório. [Instalação do Claude Code](https://code.claude.com/docs/en/quickstart)

No Bash, clone esta branch fora do projeto de destino e copie a skill completa para o projeto.

```bash
cd /caminho/para/a/pasta-de-trabalho
git clone --branch v3 --single-branch https://github.com/danilo-pimentel/spec-system-sdd.git kit-sdd-v3
kit_dir="$PWD/kit-sdd-v3"
cd /caminho/para/o/projeto
mkdir -p .claude/skills
cp -R "$kit_dir/spec-system-init" .claude/skills/
claude
```

Use um diretório `.claude/skills/spec-system-init` livre ao instalar. Se já houver outra versão com esse nome no destino, revise qual cópia deseja manter antes de substituir a pasta. No Claude Code, invoque `/spec-system-init` e solicite a inicialização nesta raiz. O agente inspeciona o projeto, apresenta os valores detectados e pede confirmação antes de instalar. A skill também orienta como mesclar um `CLAUDE.md` existente e verificar colisões em `docs/` e `scripts/`.

## Usar o kit

Após inicializar, confira `CLAUDE.md`, `docs/RULES.md` e `docs/INDEX.md`, que orientam a sessão. Para a primeira mudança, peça ao Claude Code uma SPEC com contrato e aceite, em uma branch de trabalho. Cada SPEC usa `main.md`, `state.md` e `memory.md`. Atualize os critérios de aceite durante o trabalho. Ao encerrar, registre o resultado em `docs/features/` e mova a SPEC para o destino apropriado conforme as regras.

Na raiz do projeto inicializado, rode os scripts auxiliares conforme o fluxo.

```bash
bash scripts/generate-index.sh
bash scripts/lint-docs.sh
bash scripts/audit-docs.sh
```

O [inicializador da v3](spec-system-init/SKILL.md) descreve a estrutura completa. O [guia da versão atual](https://github.com/danilo-pimentel/spec-system-sdd/tree/main) apresenta o fluxo da v4.1.
