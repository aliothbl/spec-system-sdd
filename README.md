# Spec System SDD v4

Esta branch preserva o kit v4. O manifesto usa o schema `sdd-4.0` e o CLI desta versão informa `4.1.0`. O SDD organiza o trabalho da IA em SPECs com critérios de aceite, journal, verificação e fechamento. O `specctl` concentra as operações e os hooks do Claude Code carregam o contexto e aplicam as regras do projeto.

## Instalar no Claude Code

Tenha Git, Claude Code e Node.js 18 ou superior no `PATH`. O clone exige credenciais com acesso ao repositório. [Instalação do Claude Code](https://code.claude.com/docs/en/quickstart)

No Bash, clone a branch fora do projeto de destino e instale a pasta completa da skill na raiz do projeto.

```bash
cd /caminho/para/a/pasta-de-trabalho
git clone --branch v4 --single-branch https://github.com/danilo-pimentel/spec-system-sdd.git kit-sdd-v4
kit_dir="$PWD/kit-sdd-v4"
cd /caminho/para/o/projeto
mkdir -p .claude/skills
cp -R "$kit_dir/spec-system-init" .claude/skills/
claude
```

Use um diretório `.claude/skills/spec-system-init` livre ao instalar. Se já houver outra versão com esse nome no destino, revise qual cópia deseja manter antes de substituir a pasta. Invoque `/spec-system-init` e peça para inicializar o SDD. A skill inspeciona os arquivos existentes e apresenta as opções de instalação, mescla, migração da v3 ou documentação de projeto existente. Confira os comandos de validação e as configurações que ela propõe antes de confirmar.

Depois da instalação, revise `CLAUDE.md`, `AGENTS.md`, `docs/.spec-system.json` e `.claude/settings.json`. Reabra o Claude Code na raiz para iniciar uma sessão com a configuração do projeto. Use estes comandos para conferir o resultado.

```bash
node scripts/specctl.mjs --version
node scripts/specctl.mjs index
node scripts/specctl.mjs lint
node scripts/specctl.mjs brief
node scripts/specctl.mjs self-test
```

## Usar o kit

Peça uma SPEC para a mudança e confirme o porte e o contrato. Use `/spec` para consultar o fluxo no Claude Code. O `main.md` guarda escopo e critérios, e o `journal.md` registra estado e eventos de execução. Durante o trabalho, rode as verificações do projeto e registre evidências de acordo com o porte. Confira pendências com `node scripts/specctl.mjs close <id> --dry` antes de fechar a SPEC.

O kit inclui templates, hooks e integração opcional com um pipeline PRD disponível no ambiente. As skills desse pipeline vêm embutidas a partir da branch `v4.1`. Veja o [inicializador da v4](spec-system-init/SKILL.md) e o [guia da versão atual](https://github.com/danilo-pimentel/spec-system-sdd/tree/main).
