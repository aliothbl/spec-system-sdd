#!/usr/bin/env node
/**
 * specctl.mjs — CLI única do sistema SPEC (SDD v4)
 * Versão: 4.2.0 · schema: sdd-4.0 · Node >= 18 · zero dependências · Windows/macOS/Linux
 *
 * Mapa de comandos:
 *   init [--force]                      cria estrutura docs/, manifesto e .gitignore
 *   new <slug> [--future] [--porte P|M|G] [--owner @x] [--features a,b] [--program p] [--workspace w]
 *                                       (em main/master só --future — SPEC ativa exige branch de feature, R.2)
 *   activate <id> [--branch b]          future/ -> active/ (claim + [ativação])
 *   pause <id> --motivo "..."           active/ -> future/ (Status: paused)
 *   resume <id>                         future/ -> active/ (recria claim)
 *   reopen <id> --motivo "..."          archive/ -> active/ (correção R.6.2: fechamento indevido; discard não reabre)
 *   archive <id>                        valida fechamento e move p/ archive/
 *   discard <id> --motivo "..."         exige justificativa; digest gerado automático; move p/ discard/
 *   lint [--strict] [--target-main]     validações da §8 (erro -> exit 1)
 *   audit [--pr --base <sha>] [--deps] [--main-gate]
 *   index                               regenera INDEX.md + ARCHIVE-INDEX.md + PROGRAMS.md + DEFERRED.md (determinístico)
 *   next [--program <slug>]             próximo trabalho: programas (DAG) + roadmap + backlog não-priorizado
 *   brief [--compact] [--agent <id>]    contexto de SessionStart (stdout); --agent = bundle 1-call p/ subagente
 *   capsule                             cápsula <=800 bytes (UserPromptSubmit)
 *   stamp                               NOW · commit · branch
 *   verify <id> [--all]                 roda `verify:` dos critérios e grava evidência
 *   log <id> <tipo> "título" [--stdin|--body-file <f>]
 *                                       scribe: appenda entrada no ## LOG (rodapé git automático — B1+)
 *   check <id> <n> [--evidence "..."]   estampa critério n (1-based, SEM verify:) com NOW + commit
 *   digest <id> [--stdin|--file <f>] [--fix]
 *                                       gera/valida digest.md ≤2.000B (LF, comentários HTML descontados)
 *   rollup <area>                       MANUAL/opcional: enxuga o auto-load N1 movendo blocos antigos p/ <area>.history.md (alvo 8.000B; não é lintado nem bloqueia)
 *   escalate <id> <M|G>                 Porte one-way (P→M→G) + [nota] no LOG
 *   deescalate <id> <P|M> --cita "..."  rebaixa Porte SÓ com citação literal do usuário
 *   close <id> [--dry]                  fechamento transacional: stage→validate-ALL→apply
 *   guard-read                          HOOK PreToolUse(Read|Grep|Glob) — deny = exit 2 + stderr
 *   guard-write                         HOOK PreToolUse(Write|Edit) — secret-scan pré-write + deny = exit 2 + stderr
 *   stamp-check                         HOOK PostToolUse — {{NOW}}, timestamps ±24h, secret-scan (2ª linha)
 *   session-close                       HOOK Stop — código editado sem journal atualizado
 *   adopt-workspace <id>                snapshot do workspace externo -> pasta da SPEC
 *   entrypoints                         regenera CLAUDE.md/AGENTS.md (bloco projeto preservado)
 *   self-test                           fixtures em diretório temporário (PASS/FAIL por caso)
 *
 * Exit codes: 0 ok · 1 erro/bloqueio · 2 APENAS hooks (deny).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';

const VERSION = '4.2.0';
const SCHEMA = 'sdd-4.0';
const SPEC_RE = /^SPEC-\d{8}-\d{4}-[a-z0-9][a-z0-9-]*$/;
const SPEC_REF_RE = /\bSPEC-\d{8}-\d{4}(?:-[a-z0-9][a-z0-9-]*)?\b/g;
const PHASES = ['active', 'future', 'archive', 'discard'];
const STATUS_ENUM = ['draft', 'active', 'paused', 'done', 'discarded'];
const PHASE_STATUS = { active: ['active'], future: ['draft', 'paused'], archive: ['done'], discard: ['discarded'] };
const LOG_TYPES = ['ativação', 'descoberta', 'decisão', 'tentativa', 'blocker', 'unblock', 'refactor', 'nota', 'conclusão'];
// C2 — bloco JIT ESTÁVEL (sem NOW, ≤900B): impresso SÓ por new/activate (close --dry tem o checklist);
// PROIBIDO adicionar output a guard-*/stamp-check — silêncio em sucesso.
// (função: LANG só é conhecido depois de requireRoot)
const jitFacts = () => (LANG === 'en' ? [
  '— system facts —',
  `LOG types: ${LOG_TYPES.map((t) => LOG_TYPE_EN[t]).join(' | ')}`,
  'LOG entries: node scripts/specctl.mjs log <id> <type> "title" [--stdin|--body-file <f>] — never Edit the ## LOG directly',
  'criteria: node scripts/specctl.mjs check <id> <n> (size S) · node scripts/specctl.mjs verify <id> (M/L)',
  'close: node scripts/specctl.mjs close <id> --dry first',
  'digest/bytes: the tool measures — never count',
] : [
  '— fatos do sistema —',
  `tipos de LOG: ${LOG_TYPES.join(' | ')}`,
  'entradas de LOG: node scripts/specctl.mjs log <id> <tipo> "título" [--stdin|--body-file <f>] — nunca Edit direto no ## LOG',
  'critérios: node scripts/specctl.mjs check <id> <n> (porte P) · node scripts/specctl.mjs verify <id> (M/G)',
  'fechar: node scripts/specctl.mjs close <id> --dry primeiro',
  'digest/bytes: a ferramenta mede — nunca conte',
]).join('\n');
// C1 — nota auto-doc do stub de digest (strippada pelos injetores, DESCONTADA do budget via digestMeasure)
const DIGEST_STUB_NOTE = '<!-- ≤2000 bytes LF; a ferramenta mede -->';
const DIGEST_STUB_NOTE_EN = '<!-- ≤2000 bytes LF; the tool measures -->';
// Placeholders do template do SNAPSHOT — presença numa SPEC sendo fechada = SNAPSHOT não atualizado (bug do bench porte-P).
const SNAP_PLACEHOLDER = /início — nada feito ainda|<primeiro passo concreto>|<primeiro passo>|<fase>|<última decisão>|start — nothing done yet|<first concrete step>|<first step>|<phase>|<last decision>/;
const TS_RE = /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/;
const GERADO_MARK = '> GERADO — specctl index — NÃO EDITAR';
const GERADO_MARK_EN = '> GENERATED — specctl index — DO NOT EDIT';
const PROJ_INI = '<!-- projeto:início -->';
const PROJ_FIM = '<!-- projeto:fim -->';
const PROJ_INI_EN = '<!-- project:start -->';
const PROJ_FIM_EN = '<!-- project:end -->';

// ---------------------------------------------------------------- vocabulário bilíngue (v4.2)
// Canônico INTERNO = rótulo PT: o código compara sempre com ele. No disco, o parser aceita PT e EN;
// a escrita segue `lang` do manifesto (ausente = 'pt' → saída byte-idêntica à 4.1) e, ao EDITAR um
// documento existente, o idioma do próprio documento (nunca deixa um arquivo meio PT, meio EN).
let LANG = 'pt';
const tr = (lang, pt, en) => (lang === 'en' ? en : pt);
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const FIELD_EN = {
  'Porte': 'Size', 'Criada': 'Created', 'Ativada': 'Activated', 'Concluída': 'Completed',
  'Pausada em': 'Paused at', 'Reativada em': 'Resumed at', 'Reaberta em': 'Reopened at',
  'Commit final': 'Final commit', 'Programa': 'Program', 'Origem': 'Origin', 'Resumo': 'Summary',
  'Título': 'Title', 'Ativada em': 'Activated at',
  'Última atualização': 'Last updated', 'Onde tô': 'Where I am', 'Próximo passo': 'Next step',
  'Última decisão': 'Last decision', 'Bloqueio atual': 'Current blocker', 'Se retomar, ler': 'On resume, read',
  'Arquivos principais': 'Main files', 'DENTRO': 'IN', 'FORA': 'OUT',
};
const FIELD_PT = invert(FIELD_EN);
const SECTION_EN = {
  'Objetivo': 'Goal', 'Escopo': 'Scope', 'Invariantes': 'Invariants', 'Implementação': 'Implementation',
  'Modelo de dados': 'Data model', 'Riscos': 'Risks', 'Sinais de sucesso': 'Success signals',
  'Critério de aceite': 'Acceptance criteria', 'Justificativa de descarte': 'Discard rationale',
  'Specs desta feature': 'Specs for this feature', 'Concluídas': 'Completed', 'Estado atual': 'Current state',
  'Decisões arquiteturais ativas': 'Active architectural decisions', 'Em execução': 'In progress',
  'Alternativas consideradas e rejeitadas': 'Alternatives considered and rejected', 'Estado congelado (se houver)': 'Frozen state (if any)',
  'Planejadas (future/)': 'Planned (future/)',
};
const SECTION_PT = invert(SECTION_EN);
const LOG_TYPE_EN = {
  'ativação': 'activation', 'descoberta': 'discovery', 'decisão': 'decision', 'tentativa': 'attempt',
  'blocker': 'blocker', 'unblock': 'unblock', 'refactor': 'refactor', 'nota': 'note', 'conclusão': 'completion',
};
// aliases de entrada do `log <tipo>`: EN e PT sem acento (teclado sem dead keys)
const LOG_TYPE_IN = { ...invert(LOG_TYPE_EN), ativacao: 'ativação', decisao: 'decisão', conclusao: 'conclusão' };
const MARCO_ALT = 'MARCO|MILESTONE';
const PORTE_EN = { P: 'S', M: 'M', G: 'L' };
const PORTE_IN = { P: 'P', M: 'M', G: 'G', S: 'P', L: 'G' };
// Porte canônico (P|M|G); valor fora do vocabulário passa intacto (o lint acusa)
const canonPorte = (v) => { const s = String(v ?? '').trim(); return PORTE_IN[s.toUpperCase()] || s; };
const porteOut = (canon, lang = LANG) => (lang === 'en' ? PORTE_EN[canon] || canon : canon);
const fieldLabel = (canon, lang = LANG) => (lang === 'en' ? FIELD_EN[canon] || canon : canon);
const sectionLabel = (canon, lang = LANG) => (lang === 'en' ? SECTION_EN[canon] || canon : canon);
const logTypeLabel = (canon, lang = LANG) => (lang === 'en' ? LOG_TYPE_EN[canon] || canon : canon);
// tipo de LOG digitado/lido → canônico PT (null se não existe). NFC: acento decomposto (NFD) conta igual.
function canonLogType(t) {
  const s = String(t ?? '').normalize('NFC').trim().toLowerCase();
  if (s in LOG_TYPE_EN) return s;
  return LOG_TYPE_IN[s] || null;
}
// (escape local: escRe é declarado depois e altOf roda no carregamento do módulo)
const altOf = (...xs) => [...new Set(xs.filter(Boolean))].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const logTypeAlt = (canon) => altOf(canon, LOG_TYPE_EN[canon]);
const ALL_LOG_TYPES_ALT = altOf(...Object.keys(LOG_TYPE_EN), ...Object.values(LOG_TYPE_EN));
// heading de entrada de LOG de um tipo canônico (com prefixo MARCO/MILESTONE opcional); captura o título em $1
const logHeadRe = (canon, flags = 'gm') =>
  new RegExp(`^## \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} — (?:\\[(?:${MARCO_ALT})\\] )?\\[(?:${logTypeAlt(canon)})\\]\\s*(.*)$`, flags);
// idioma de um documento existente: rótulo exclusivo de UM idioma decide; nenhum/ambos → LANG do repo
const DOC_EN_RE = /^\*\*(?:Size|Created|Activated|Final commit|Summary|Last updated|Where I am|Title|Main files):\*\*|^## (?:Goal|Acceptance criteria|Specs for this feature)\b|^## LOG \(append-only — NEVER/m;
const DOC_PT_RE = /^\*\*(?:Porte|Criada|Ativada|Commit final|Resumo|Última atualização|Onde tô|Título|Arquivos principais):\*\*|^## (?:Objetivo|Crit[ée]rios? de aceite|Specs desta feature)\b|^## LOG \(append-only — NUNCA/m;
function docLang(txt) {
  const t = String(txt || '');
  const en = DOC_EN_RE.test(t), pt = DOC_PT_RE.test(t);
  if (en && !pt) return 'en';
  if (pt && !en) return 'pt';
  return LANG;
}
// marcador R.6.2: PT ou EN, aspas retas ou curvas
const ACEITO_TAG_ALT = 'aceito-incompleto|accepted-incomplete';
const aceitoTag = (lang = LANG) => tr(lang, 'aceito-incompleto', 'accepted-incomplete');
const genMark = (lang = LANG) => tr(lang, GERADO_MARK, GERADO_MARK_EN);
const hasGenMark = (txt) => txt.includes(GERADO_MARK) || txt.includes(GERADO_MARK_EN);
// "## <seção>" presente (PT ou EN)? — mesma semântica de SUBSTRING da 4.1 (txt.includes('## X')):
// "## Gotchas e ambiguidades" satisfaz "## Gotchas". Mudar para título exato quebraria repos instalados.
const hasSection = (txt, canon, level = 2) => [canon, SECTION_EN[canon]].filter(Boolean).some((t) => String(txt).includes(`${'#'.repeat(level)} ${t}`));

const SECRET_PATTERNS = [
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['connection-string', /\b[a-zA-Z][a-zA-Z0-9+.-]{1,24}:\/\/[^\s:@/]{1,64}:[^\s@/]{1,128}@[^\s]{1,256}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

// ---------------------------------------------------------------- utilitários

const P = (...s) => path.join(...s);
const exists = (p) => fs.existsSync(p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const read = (p) => fs.readFileSync(p, 'utf8');
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const bytesOf = (s) => Buffer.byteLength(s, 'utf8');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// CRLF→LF e NFC (acento decomposto/NFD vira composto: "conclusão" digitado em macOS casa com o vocabulário)
const norm = (s) => s.replace(/\r\n/g, '\n').normalize('NFC');
// medição canônica de budget (R.16): bytes LF-normalizados — strip BOM e CR ANTES de medir
const lfText = (s) => String(s).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const lfBytes = (s) => bytesOf(lfText(s));
// comparação semver simples (a >= b) — gates novos só ativam com template_revision ≥ 4.1.0
function revGte(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

function writeFile(p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
function relOf(root, p) { return path.relative(root, p).split(path.sep).join('/'); }
function pad(n) { return String(n).padStart(2, '0'); }
function now() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function nowIdParts() { const d = new Date(); return { date: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`, time: `${pad(d.getHours())}${pad(d.getMinutes())}` }; }
function parseTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
function die(msg) { process.stderr.write(`[specctl] ${tr(LANG, 'ERRO', 'ERROR')}: ${msg}\n`); process.exit(1); }
function out(msg) { process.stdout.write(msg + '\n'); }
function splitList(v) {
  if (!v || v.trim() === '—' || v.trim() === '-') return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
function truncate(s, n) { s = s.trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function scanSecrets(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<REDACTED')) continue;
    for (const [tipo, re] of SECRET_PATTERNS) {
      if (re.test(lines[i])) hits.push({ tipo, line: i + 1, lineText: lines[i] });
    }
  }
  return hits;
}

function stripFences(text) { return text.replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, ''); }

function walkFiles(dir, { skipDirs = ['.git', 'node_modules', 'tmp'], exts = null } = {}, acc = []) {
  if (!isDir(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = P(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.includes(e.name)) walkFiles(fp, { skipDirs, exts }, acc);
    } else if (!exts || exts.includes(path.extname(e.name).toLowerCase())) {
      acc.push(fp);
    }
  }
  return acc;
}

// ---------------------------------------------------------------- git

function gitRun(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || (r.error && r.error.message) || '').trim() };
}
// git obrigatório: falha explícita + exit 1 (§15 — nunca engolir erro de git)
function git(args, cwd) {
  const r = gitRun(args, cwd);
  if (!r.ok) die(tr(LANG, `git ${args.join(' ')} falhou: ${r.err || '(sem stderr)'} — corrija o estado do git antes de continuar`, `git ${args.join(' ')} failed: ${r.err || '(no stderr)'} — fix the git state before continuing`));
  return r.out;
}
// git opcional (hooks/brief): degrada com AVISO EXPLÍCITO no stderr, nunca silencioso
function gitTry(args, cwd) {
  const r = gitRun(args, cwd);
  if (!r.ok) { process.stderr.write(tr(LANG, `[specctl] AVISO: git ${args.join(' ')} falhou: ${r.err || '(sem stderr)'}\n`, `[specctl] WARNING: git ${args.join(' ')} failed: ${r.err || '(no stderr)'}\n`)); return null; }
  return r.out;
}
function currentBranch(root) {
  const a = gitRun(['symbolic-ref', '--short', 'HEAD'], root);
  if (a.ok) return a.out;
  const b = gitRun(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  if (b.ok) return b.out === 'HEAD' ? null : b.out; // detached HEAD: git devolve o literal "HEAD" — não é branch
  process.stderr.write(tr(LANG, `[specctl] AVISO: branch git indeterminável: ${a.err || b.err}\n`, `[specctl] WARNING: cannot determine git branch: ${a.err || b.err}\n`));
  return null;
}
const DEFAULT_PROTECTED = ['main', 'master', 'develop', 'homolog', 'hmg'];
// branches de integração onde SPEC ativa é PROIBIDA (trabalho sempre em branch própria). Configurável no manifesto.
function protectedBranches(root) {
  try { const m = manifest(root); if (Array.isArray(m.protected_branches) && m.protected_branches.length) return m.protected_branches; } catch { /* sem manifesto: default */ }
  return DEFAULT_PROTECTED;
}
function isProtectedBranch(b, root) { return !!b && protectedBranches(root).includes(b); }
// detecta a branch-base (de onde a feature saiu): a branch protegida ancestral do HEAD, na ordem do manifesto; senão o default do repo
function detectBaseBranch(root, cur) {
  const prot = protectedBranches(root);
  for (const p of prot) {
    if (p === cur) continue;
    if (gitRun(['merge-base', '--is-ancestor', p, 'HEAD'], root).ok) return p; // exit 0 = p é ancestral de HEAD
  }
  const head = gitRun(['rev-parse', '--abbrev-ref', 'origin/HEAD'], root); // ex.: origin/main → main
  if (head.ok && head.out) return head.out.replace(/^origin\//, '');
  return prot.find((p) => p !== cur) || prot[0] || 'main';
}

// ---------------------------------------------------------------- raiz e manifesto

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(P(dir, 'docs', '.spec-system.json')) || exists(P(dir, 'docs', 'RULES.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function requireRoot() {
  const r = findRoot(process.cwd());
  if (!r) die(tr(LANG, 'projeto não encontrado — nenhum docs/.spec-system.json (nem docs/RULES.md) subindo a partir de ', 'project not found — no docs/.spec-system.json (nor docs/RULES.md) walking up from ') + process.cwd());
  setLang(r);
  return r;
}
// idioma de ESCRITA do repo: manifesto `lang` ('en' | 'pt'); ausente/inválido = 'pt' (repos 4.1 ficam byte-idênticos)
function setLang(root) { LANG = root && manifest(root).lang === 'en' ? 'en' : 'pt'; return root; }
function manifest(root) {
  // team: 'solo' (default) | 'multi' — regime DECLARADO, nunca inferido. Em multi: activate imprime a
  // coreografia de publicação do claim, audit avisa claim não-publicado na main, capsule carrega team=multi.
  const def = { schema: SCHEMA, template_revision: VERSION, policy: 'standard', interop: 'none', team: 'solo', product: null, commands: {}, protected_branches: DEFAULT_PROTECTED };
  const p = P(root, 'docs', '.spec-system.json');
  if (!exists(p)) return { ...def, schema: 'sdd-3-compat' };
  try { return { ...def, ...JSON.parse(read(p)) }; }
  catch (e) { process.stderr.write(tr(LANG, `[specctl] AVISO: manifesto inválido (${e.message}) — usando defaults\n`, `[specctl] WARNING: invalid manifest (${e.message}) — using defaults\n`)); return def; }
}

// ---------------------------------------------------------------- SPECs

function listSpecs(root) {
  const specs = [];
  for (const phase of PHASES) {
    const base = P(root, 'docs', phase);
    if (!isDir(base)) continue;
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory()) specs.push({ id: e.name, phase, dir: P(base, e.name), v3: exists(P(base, e.name, 'state.md.v3.bak')) });
    }
  }
  return specs;
}
function activeSpecs(root) { return listSpecs(root).filter((s) => s.phase === 'active'); }
function idPrefix(id) { return id.slice(0, 18); } // SPEC-YYYYMMDD-HHMM
function findSpec(root, id) {
  if (!id) die(tr(LANG, 'informe o id da SPEC (SPEC-YYYYMMDD-HHMM-slug)', 'give the SPEC id (SPEC-YYYYMMDD-HHMM-slug)'));
  const all = listSpecs(root);
  const exact = all.find((s) => s.id === id);
  if (exact) return exact;
  const cand = all.filter((s) => s.id.startsWith(id));
  if (cand.length === 1) return cand[0];
  if (cand.length > 1) die(tr(LANG, `id ambíguo '${id}' — candidatas: ${cand.map((s) => s.id).join(', ')}`, `ambiguous id '${id}' — candidates: ${cand.map((s) => s.id).join(', ')}`));
  die(tr(LANG, `SPEC '${id}' não encontrada em docs/{active,future,archive,discard}/`, `SPEC '${id}' not found in docs/{active,future,archive,discard}/`));
}

// maskFences: cópia das linhas onde conteúdo DENTRO de ``` ```/~~~ e de comentários HTML multi-linha vira ''.
// PRESERVA índices (≠ stripFences, que remove texto): o parser decide sobre a máscara, mas check/verify
// reescrevem a linha ORIGINAL pelo índice. Sem isso, `# comentário` num exemplo bash dentro do main.md
// encerrava a seção de critérios e escondia critério aberto do close/archive/lint (bypass do R.6.2).
function maskFences(lines) {
  const out = [...lines];
  let inFence = false, inHtml = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (inFence) { out[i] = ''; if (/^\s*(```|~~~)/.test(l)) inFence = false; continue; }
    if (inHtml) { out[i] = ''; if (l.includes('-->')) inHtml = false; continue; }
    if (/^\s*(```|~~~)/.test(l)) { out[i] = ''; inFence = true; continue; }
    if (l.includes('<!--') && !l.includes('-->')) { out[i] = ''; inHtml = true; }
  }
  return out;
}
function parseMain(txt) {
  const lines = norm(txt).split('\n');
  const masked = maskFences(lines);
  const fields = {};
  for (const l of masked) {
    const m = /^\*\*([^*]+):\*\*\s*(.*)$/.exec(l);
    if (!m) continue;
    const k = FIELD_PT[m[1].trim()] || m[1].trim(); // rótulo EN → chave canônica PT
    if (!(k in fields)) fields[k] = m[2].trim();
  }
  if ('Porte' in fields) fields.Porte = canonPorte(fields.Porte); // S/L → P/G
  const sections = [];
  masked.forEach((l, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) sections.push({ level: m[1].length, title: canonSection(m[2].trim()), line: i });
  });
  return { fields, sections, lines, masked, raw: txt };
}
// título de seção EN → canônico PT (exato ou como prefixo: "Scope (IN/OUT)" → "Escopo (IN/OUT)")
function canonSection(t) {
  if (SECTION_PT[t]) return SECTION_PT[t];
  for (const [en, pt] of Object.entries(SECTION_PT)) if (t.startsWith(en + ' ')) return pt + t.slice(en.length);
  return t;
}
function sectionRange(pm, pred) {
  for (let i = 0; i < pm.sections.length; i++) {
    const s = pm.sections[i];
    if (s.level === 2 && pred(s.title)) {
      let end = pm.lines.length;
      for (let j = i + 1; j < pm.sections.length; j++) {
        if (pm.sections[j].level <= 2) { end = pm.sections[j].line; break; }
      }
      return [s.line, end];
    }
  }
  return null;
}
const isCritTitle = (t) => /^crit[ée]rios? de aceite|^acceptance criteri(?:a|on)/i.test(t);
function getCriteria(pm) {
  const r = sectionRange(pm, isCritTitle);
  if (!r) return null;
  const outArr = [];
  const scan = pm.masked || pm.lines; // máscara: checkbox de EXEMPLO dentro de fence não é critério
  for (let i = r[0] + 1; i < r[1]; i++) {
    const m = /^\s*-\s*\[( |x|X)\]\s*(.*)$/.exec(scan[i]);
    if (m) outArr.push({ line: i, checked: m[1].toLowerCase() === 'x', text: m[2], raw: pm.lines[i] });
  }
  return outArr;
}
const hasTs = (l) => TS_RE.test(l);
const hasCommitEv = (l) => /commit\s*`[^`]+`/.test(l);
const hasVerifyTag = (l) => /\bverify:/.test(l);
// Comando do `| verify: \`cmd\``. Placeholder = token de template tipo `<comando>`/`<cmd>` (abre com letra, fecha com >);
// redirecionamento/comparação de shell (`< arquivo`, `a<b`, `<(cmd)`) é comando REAL e roda.
const VERIFY_CMD_RE = /\|\s*verify:\s*`([^`]+)`/;
const VERIFY_PLACEHOLDER_RE = /<\p{L}[\p{L}\d _.-]*>/u;
function verifyCmdOf(raw) {
  const m = VERIFY_CMD_RE.exec(raw);
  if (!m) return null;
  return { cmd: m[1], runnable: !VERIFY_PLACEHOLDER_RE.test(m[1]) };
}
const hasEvidenceTag = (l) => /\bevidence:/.test(l);
// [conclusão] VIGENTE: existe e vem depois da última reabertura (reopen). Sem isto, uma SPEC reaberta
// fechava de novo na hora com a [conclusão] do fechamento anterior.
const CONCLUSAO_HEAD_RE = logHeadRe('conclusão');
const REOPEN_HEAD_RE = /^## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — \[(?:nota|note)\] (?:Reabertura|Reopened) \(reopen\)/gm;
function lastMatchIdx(re, txt) { let i = -1; for (const m of String(txt).matchAll(re)) i = m.index; return i; }
function hasCurrentConclusao(jtxt) {
  const c = lastMatchIdx(CONCLUSAO_HEAD_RE, norm(String(jtxt)));
  return c >= 0 && c > lastMatchIdx(REOPEN_HEAD_RE, norm(String(jtxt)));
}
// [aceito-incompleto: "citação" YYYY-MM-DD HH:MM] — também [accepted-incomplete: …] e aspas curvas “…”
const ACEITO_RE = new RegExp(`\\[(?:${ACEITO_TAG_ALT}):\\s*(?:"[^"]+"|“[^”]+”)\\s+\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}\\]`);
const hasAceitoTag = (l) => new RegExp(`\\[(?:${ACEITO_TAG_ALT})`).test(l);

// regex de UMA linha de campo **<rótulo>:** aceitando o rótulo PT e o EN; $1 = rótulo encontrado
const fieldLineRe = (name) => new RegExp(`^\\*\\*(${altOf(name, FIELD_EN[name])}):\\*\\*.*$`, 'm');
const hasField = (txt, name) => fieldLineRe(name).test(txt);
// valor de **name:** (PT ou EN) no texto; '' se ausente
const fieldValue = (txt, name) => { const m = new RegExp(`^\\*\\*(?:${altOf(name, FIELD_EN[name])}):\\*\\*\\s*(.*)$`, 'm').exec(norm(String(txt || ''))); return m ? m[1].trim() : ''; };
// grava **name:** value. Campo existente mantém o rótulo (e idioma) que já tem; campo novo entra logo
// após `anchor` (default Status) no idioma do documento. Porte é convertido para o vocabulário do rótulo.
function setField(txt, name, value, anchor = 'Status') {
  const re = fieldLineRe(name);
  const m = re.exec(txt);
  const lang = m ? (m[1] === name ? 'pt' : 'en') : docLang(txt);
  const v = name === 'Porte' ? porteOut(canonPorte(value), lang) : value;
  if (m) return txt.replace(re, () => `**${m[1]}:** ${v}`);
  const ar = fieldLineRe(anchor);
  if (!ar.test(txt)) return txt; // sem âncora: no-op (mesmo comportamento da 4.1)
  return txt.replace(ar, (line) => `${line}\n**${fieldLabel(name, lang)}:** ${v}`);
}

// ---------------------------------------------------------------- templates

function makeMain(o) {
  // D1 — critério scaffoldado por porte: P sem slot verify: (evidência via `check`); M/G mantêm verify:
  const porte = canonPorte(String(o.porte || 'M').toUpperCase());
  if ((o.lang || LANG) === 'en') return makeMainEn(o, porte);
  const critScaffold = porte === 'P'
    ? '<!-- P: feche com: node scripts/specctl.mjs check <id> <n> -->\n- [ ] <critério binário e verificável>'
    : '- [ ] <critério binário e verificável> | verify: `<comando>`';
  return `# SPEC-${o.idTs}: ${o.title}

**Status:** ${o.status}
**Porte:** ${o.porte}
**Owner:** ${o.owner}
**Criada:** ${o.criada}
**Ativada:** ${o.ativada}
**Concluída:** —
**Pausada em:** —
**Commit final:** —
**Keywords:** ${o.keywords}
**Features:** ${o.features}
**Branch:** ${o.branch}
**Programa:** ${o.programa}
**Workspace:** ${o.workspace}
**Origem:** ${o.origem}
**Resumo:** ${o.resumo}

## Objetivo

<2-3 frases: o quê e por quê.>

## Escopo

**DENTRO:**
- <item>

**FORA:**
- <item>

## Invariantes

<!-- propriedades que valem SEMPRE (antes/durante/depois) — linhas-vermelhas que QUALQUER mudança futura pode violar; distintas dos critérios (que checam o estado final). Estilo SEMPRE/NUNCA. P trivial: "—" -->
- SEMPRE/NUNCA <propriedade que não pode ser violada>

## Implementação

<abordagem em alto nível; porte G: o detalhe fino vai em techspec.md>

### Modelo de dados

<!-- entidades/campos novos ou tocados (schema, tabelas, tipos); "—" se não há mudança de dados -->
| Entidade | Campos / mudança |
|---|---|
| <Entidade> | <campos> |

<!-- Alternativas (M/G): abordagens consideradas e REJEITADAS + porquê — evita reabrir becos sem saída. Decisão irreversível (porta de mão-única): marque [irreversível] p/ sinalizar mais escrutínio. -->

## Riscos

<!-- riscos técnicos/de segurança + mitigação (contrato estável — NÃO é progresso; decisões/fases vão no journal); P trivial: "—" -->
- <risco> — mitigação: <como>

## Sinais de sucesso

<!-- como saberemos que a SPEC cumpriu o PROPÓSITO (não só a corretude dos critérios) — métrica/sinal observável; P: 1 linha -->
- <resultado observável que indica que valeu>

## Critério de aceite

${critScaffold}
`;
}
function makeJournal(idTs, nowStr, lang = LANG) {
  if (lang === 'en') return makeJournalEn(idTs, nowStr);
  return `# Journal — SPEC-${idTs}

## SNAPSHOT (sobrescrever — DEVE caber nas primeiras 60 linhas do arquivo)

**Última atualização:** ${nowStr}
**Onde tô:** início — nada feito ainda
**Próximo passo:** <primeiro passo concreto>
**Última decisão:** —
**Bloqueio atual:** nenhum
**Se retomar, ler:** main.md desta SPEC

### Fases
| # | Descrição | Status | Atualizado |
|---|---|---|---|
| 1 | <fase> | pendente | ${nowStr} |

### Fatos confirmados / Inferências prováveis / Dúvidas em aberto
<!-- anti-alucinação por estrutura: separe o que é SABIDO (verificado no código/teste) do que é CHUTE (inferido) do que está EM ABERTO. Nunca trate inferência como fato. -->
- fato:
- inferência:
- dúvida:

### Respostas-chave do usuário

### Tentativas que falharam

### Arquivos tocados

### Onde parei

### Sessões (máx 5 linhas + 1 agregada)

## LOG (append-only — NUNCA editar entradas antigas)
<!-- tipos: ${LOG_TYPES.join(' ')} | entrada nova: specctl log -->
`;
}
function makeClaim(o, lang = LANG) {
  if (lang === 'en') return makeClaimEn(o);
  return `# Claim — ${o.id}

**SPEC:** ${o.id}
**Título:** ${o.title}
**Owner:** ${o.owner}
**Branch:** ${o.branch}
**Base:** ${o.base || '—'}
**Features:** ${o.features}
**Ativada em:** ${o.ativada}
`;
}
// ---- versões EN dos templates (mesma estrutura e ordem de campos das PT — o parser normaliza os rótulos)
function makeMainEn(o, porte) {
  const critScaffold = porte === 'P'
    ? '<!-- S: close with: node scripts/specctl.mjs check <id> <n> -->\n- [ ] <binary, verifiable criterion>'
    : '- [ ] <binary, verifiable criterion> | verify: `<command>`';
  return `# SPEC-${o.idTs}: ${o.title}

**Status:** ${o.status}
**Size:** ${porteOut(porte, 'en')}
**Owner:** ${o.owner}
**Created:** ${o.criada}
**Activated:** ${o.ativada}
**Completed:** —
**Paused at:** —
**Final commit:** —
**Keywords:** ${o.keywords}
**Features:** ${o.features}
**Branch:** ${o.branch}
**Program:** ${o.programa}
**Workspace:** ${o.workspace}
**Origin:** ${o.origem}
**Summary:** ${o.resumo}

## Goal

<2-3 sentences: what and why.>

## Scope

**IN:**
- <item>

**OUT:**
- <item>

## Invariants

<!-- properties that hold ALWAYS (before/during/after) — red lines ANY future change could break; distinct from the criteria (which check the end state). ALWAYS/NEVER style. Trivial S: "—" -->
- ALWAYS/NEVER <property that must not be violated>

## Implementation

<high-level approach; size L: the fine detail goes in techspec.md>

### Data model

<!-- new or touched entities/fields (schema, tables, types); "—" if no data change -->
| Entity | Fields / change |
|---|---|
| <Entity> | <fields> |

<!-- Alternatives (M/L): approaches considered and REJECTED + why — avoids reopening dead ends. Irreversible decision (one-way door): mark [irreversible] to flag extra scrutiny. -->

## Risks

<!-- technical/security risks + mitigation (stable contract — NOT progress; decisions/phases go in the journal); trivial S: "—" -->
- <risk> — mitigation: <how>

## Success signals

<!-- how we will know the SPEC met its PURPOSE (not just criteria correctness) — observable metric/signal; S: 1 line -->
- <observable result showing it was worth it>

## Acceptance criteria

${critScaffold}
`;
}
function makeJournalEn(idTs, nowStr) {
  return `# Journal — SPEC-${idTs}

## SNAPSHOT (overwrite — MUST fit in the first 60 lines of the file)

**Last updated:** ${nowStr}
**Where I am:** start — nothing done yet
**Next step:** <first concrete step>
**Last decision:** —
**Current blocker:** none
**On resume, read:** this SPEC's main.md

### Phases
| # | Description | Status | Updated |
|---|---|---|---|
| 1 | <phase> | pending | ${nowStr} |

### Confirmed facts / Likely inferences / Open questions
<!-- anti-hallucination by structure: separate what is KNOWN (verified in code/tests) from what is a GUESS (inferred) from what is OPEN. Never treat an inference as a fact. -->
- fact:
- inference:
- question:

### Key user answers

### Failed attempts

### Files touched

### Where I stopped

### Sessions (max 5 lines + 1 aggregate)

## LOG (append-only — NEVER edit old entries)
<!-- types: ${Object.values(LOG_TYPE_EN).join(' ')} | new entry: specctl log -->
`;
}
function makeClaimEn(o) {
  return `# Claim — ${o.id}

**SPEC:** ${o.id}
**Title:** ${o.title}
**Owner:** ${o.owner}
**Branch:** ${o.branch}
**Base:** ${o.base || '—'}
**Features:** ${o.features}
**Activated at:** ${o.ativada}
`;
}
// entrada no ## LOG. `tipo` é canônico (PT); `titulo` pode ser string ou (lang) => string — escrito no
// idioma do journal existente (journal novo: LANG do repo). Rótulo do tipo segue o mesmo idioma.
function appendLog(specDir, tipo, titulo, body = '') {
  const jp = P(specDir, 'journal.md');
  const idTs = path.basename(specDir).slice(5, 18);
  let txt = exists(jp) ? read(jp) : makeJournal(idTs, now());
  const lang = docLang(txt);
  const lu = fieldLineRe('Última atualização');
  txt = txt.replace(lu, (line) => line.replace(/:\*\*.*$/, `:** ${now()}`));
  if (!txt.endsWith('\n')) txt += '\n';
  const t = typeof titulo === 'function' ? titulo(lang) : titulo;
  const heading = `## ${now()} — [${logTypeLabel(tipo, lang)}] ${t}`;
  txt += `\n${heading}\n`;
  if (body) txt += `\n${body}\n`;
  writeFile(jp, txt);
  return heading;
}
function claimPath(root, id) { return P(root, 'docs', 'claims', `${id}.md`); }
function removeClaim(root, id) { const p = claimPath(root, id); if (exists(p)) fs.unlinkSync(p); }
function moveSpec(spec, root, toPhase) {
  const dst = P(root, 'docs', toPhase, spec.id);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(spec.dir, dst); }
  catch { fs.cpSync(spec.dir, dst, { recursive: true }); fs.rmSync(spec.dir, { recursive: true, force: true }); }
  ensureGitkeeps(root); // a pasta de origem pode ter ficado vazia — mantém o .gitkeep p/ sobreviver a checkout fresco
  return dst;
}

const REQUIRED_DIRS = ['features', 'active', 'future', 'archive', 'discard', 'claims', 'programs'];
// git não versiona pasta vazia: uma pasta obrigatória vazia (ex.: docs/active/ na main) some num checkout fresco
// e o lint falha "pasta obrigatória ausente". ensureGitkeeps mantém um .gitkeep em toda obrigatória que ficou vazia.
// Idempotente; chamado no init, em toda movimentação de SPEC (moveSpec) e na regeneração de índices (cmdIndex).
function ensureGitkeeps(root) {
  for (const d of REQUIRED_DIRS) {
    const dp = P(root, 'docs', d);
    if (!isDir(dp)) fs.mkdirSync(dp, { recursive: true });
    const hasContent = fs.readdirSync(dp).some((e) => e !== '.gitkeep');
    if (!hasContent && !exists(P(dp, '.gitkeep'))) writeFile(P(dp, '.gitkeep'), '');
  }
}

// ---------------------------------------------------------------- comandos de ciclo de vida

function cmdInit(flags) {
  const root = findRoot(process.cwd()) || process.cwd();
  const manPath = P(root, 'docs', '.spec-system.json');
  if (exists(manPath) && !flags.force) die(tr(flags.lang || manifest(root).lang, `já instalado (${relOf(root, manPath)}) — use --force para regravar o manifesto`, `already installed (${relOf(root, manPath)}) — use --force to rewrite the manifest`));
  for (const d of REQUIRED_DIRS) fs.mkdirSync(P(root, 'docs', d), { recursive: true });
  ensureGitkeeps(root);
  fs.mkdirSync(P(root, '.scratch'), { recursive: true });
  let prev = {};
  if (exists(manPath)) { try { prev = JSON.parse(read(manPath)); } catch { prev = {}; } }
  if (flags.lang !== undefined && !['pt', 'en'].includes(flags.lang)) die(tr(prev.lang, `--lang inválido '${flags.lang}' — use pt | en`, `invalid --lang '${flags.lang}' — use pt | en`));
  const lang = flags.lang || prev.lang;
  LANG = lang === 'en' ? 'en' : 'pt'; // stubs e índices abaixo já nascem no idioma escolhido
  const man = {
    ...prev, // --force preserva chaves extras (protected_branches, context_window, …)
    schema: SCHEMA,
    template_revision: VERSION,
    installed_at: now(),
    policy: prev.policy || 'standard',
    interop: prev.interop || 'none',
    team: prev.team || 'solo',
    product: prev.product ?? null,
    commands: { test: '', typecheck: '', lint: '', dev: '', e2e: '', ...(prev.commands || {}) },
  };
  if (lang) man.lang = lang; else delete man.lang; // ausente = pt
  writeFile(manPath, JSON.stringify(man, null, 2) + '\n');
  const giPath = P(root, '.gitignore');
  const gi = readSafe(giPath);
  const giLines = gi.split(/\r?\n/);
  let giOut = gi;
  for (const line of ['docs/active/**/tmp/', '.scratch/']) {
    if (!giLines.includes(line)) giOut = (giOut && !giOut.endsWith('\n') ? giOut + '\n' : giOut) + line + '\n';
  }
  if (giOut !== gi) writeFile(giPath, giOut);
  // stubs mínimos (não sobrescreve conteúdo instalado pela skill/usuário)
  const taxPath = P(root, 'docs', 'TAXONOMY.md');
  if (!exists(taxPath)) writeFile(taxPath, LANG === 'en' ? `# TAXONOMY.md — canonical area vocabulary

> Target budget: ≤1,600 bytes. Every feature in \`docs/features/\` MUST match an area listed here (R.4).
> New area = explicit user confirmation (R.13). Namespaces use \`/\` (e.g. \`api/auth\`).
> Line format: \`- <area> — one-line definition (forbidden aliases: x→area)\`

## Areas

<!-- Examples — remove when filling in:
- api/auth — backend authentication and session (forbidden aliases: login→api/auth, sso→api/auth)
- web/checkout — frontend purchase flow (forbidden aliases: cart→web/checkout)
- infra/ci — build, test and deploy pipelines (forbidden aliases: actions→infra/ci, gha→infra/ci)
-->
` : `# TAXONOMY.md — vocabulário canônico de áreas

> Orçamento-alvo: ≤1.600 bytes. Toda feature de \`docs/features/\` DEVE corresponder a uma área daqui (R.4).
> Área nova = confirmação explícita do usuário (R.13). Namespaces com \`/\` (ex.: \`api/auth\`).
> Formato por linha: \`- <area> — definição 1 linha (aliases proibidos: x→area)\`

## Áreas

<!-- Exemplos — remova ao preencher:
- api/auth — autenticação e sessão do backend (aliases proibidos: login→api/auth, sso→api/auth)
- web/checkout — fluxo de compra no frontend (aliases proibidos: carrinho→web/checkout)
- infra/ci — pipelines de build, teste e deploy (aliases proibidos: actions→infra/ci, gha→infra/ci)
-->
`);
  const constPath = P(root, 'docs', 'CONSTITUTION.md');
  if (!exists(constPath)) writeFile(constPath, LANG === 'en' ? `# CONSTITUTION.md — project principles

> Target budget: ≤2,400 bytes. NON-NEGOTIABLE principles that apply to EVERY SPEC.
> New entry = explicit human decision. A gotcha cited by ≥3 SPECs can be promoted here at close (docs/rules/lifecycle.md).
> Format: \`- P-<n> — principle in 1-2 lines (origin, YYYY-MM-DD)\`

## Principles

<!-- Examples — remove when filling in:
- P-1 — Every database migration is reversible; a PR without rollback does not merge (bootstrap, 2026-07-02)
- P-2 — No secrets in code or docs; use env vars and \`<REDACTED:type>\` (R.15) (bootstrap, 2026-07-02)
- P-3 — Versioned public API: a breaking change requires /v<n+1> (SPEC-20260702-1010-api-v2, 2026-07-02)
-->
` : `# CONSTITUTION.md — princípios do projeto

> Orçamento-alvo: ≤2.400 bytes. Princípios INEGOCIÁVEIS que valem para TODA SPEC.
> Entrada nova = decisão humana explícita. Gotcha citado por ≥3 SPECs pode ser promovido para cá no fechamento (docs/rules/lifecycle.md).
> Formato: \`- P-<n> — princípio em 1-2 linhas (origem, YYYY-MM-DD)\`

## Princípios

<!-- Exemplos — remova ao preencher:
- P-1 — Toda migração de banco é reversível; PR sem rollback não mergeia (bootstrap, 2026-07-02)
- P-2 — Nenhum segredo em código ou docs; usar env vars e \`<REDACTED:tipo>\` (R.15) (bootstrap, 2026-07-02)
- P-3 — API pública versionada: breaking change exige /v<n+1> (SPEC-20260702-1010-api-v2, 2026-07-02)
-->
`);
  const roadmapPath = P(root, 'docs', 'ROADMAP.md');
  if (!exists(roadmapPath)) writeFile(roadmapPath, LANG === 'en' ? `# ROADMAP — execution order of the standalone backlog

> Human prioritization of future SPECs WITHOUT a program. Edited by a dedicated PR (single writer).
> Program SPECs do NOT go here — their order comes from the graph (docs/programs/).

<!-- Example — replace with the real order (one SPEC per line):
1. SPEC-20260702-1010-custom-hostnames
2. SPEC-20260703-0930-audit-log
-->
` : `# ROADMAP — ordem de execução do backlog avulso

> Priorização humana das SPECs future SEM programa. Editado por PR dedicado (single-writer).
> SPECs de programa NÃO entram aqui — a ordem delas vem do grafo (docs/programs/).

<!-- Exemplo — substitua pela ordem real (uma SPEC por linha):
1. SPEC-20260702-1010-custom-hostnames
2. SPEC-20260703-0930-audit-log
-->
`);
  // INDEX.md/ARCHIVE-INDEX.md/PROGRAMS.md nascem GERADOS — lint pós-init passa limpo (equivalente a `specctl index` quiet)
  cmdIndex({ quiet: true });
  out(tr(LANG, `init ok — estrutura docs/, manifesto (${SCHEMA}), índices gerados e .gitignore em ${root}`, `init ok — docs/ structure, manifest (${SCHEMA}), generated indexes and .gitignore in ${root}`));
}

function cmdNew(pos, flags) {
  const root = requireRoot();
  const slug = pos[0];
  if (!slug) die(tr(LANG, 'uso: specctl new <slug> [--future] [--porte P|M|G] [--owner @x] [--features a,b] [--program p] [--workspace w]', 'usage: specctl new <slug> [--future] [--size S|M|L] [--owner @x] [--features a,b] [--program p] [--workspace w]'));
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(slug)) die(tr(LANG, `slug inválido '${slug}' — use kebab-case [a-z0-9-]`, `invalid slug '${slug}' — use kebab-case [a-z0-9-]`));
  const porte = canonPorte(flags.porte || 'M'); // aceita P|M|G e S|M|L
  if (!['P', 'M', 'G'].includes(porte)) die(tr(LANG, `Porte inválido '${flags.porte}' — use P | M | G (ou S | M | L)`, `invalid size '${flags.porte}' — use S | M | L (or P | M | G)`));
  const future = !!flags.future;
  const branch = currentBranch(root);
  if (!future && isProtectedBranch(branch, root)) {
    die(tr(LANG, `R.2: SPEC ativa é proibida na branch protegida '${branch}' (${protectedBranches(root).join('/')}) — trabalho vive sempre em branch própria. Caminho correto: git checkout -b feature/${slug} e rode o comando lá — ou --future para rascunho em docs/future/.`, `R.2: an active SPEC is forbidden on the protected branch '${branch}' (${protectedBranches(root).join('/')}) — work always lives on its own branch. Correct path: git checkout -b feature/${slug} and run the command there — or --future for a draft in docs/future/.`));
  }
  const { date, time } = nowIdParts();
  const id = `SPEC-${date}-${time}-${slug}`;
  const idTs = `${date}-${time}`;
  const phase = future ? 'future' : 'active';
  const dir = P(root, 'docs', phase, id);
  if (exists(dir)) die(tr(LANG, `já existe: ${relOf(root, dir)}`, `already exists: ${relOf(root, dir)}`));
  let owner = flags.owner;
  if (!owner) {
    const un = gitTry(['config', 'user.name'], root);
    owner = un ? '@' + un.toLowerCase().replace(/\s+/g, '-') : '@owner';
  }
  const title = slug.replace(/-/g, ' ');
  const mainTxt = makeMain({
    idTs, title,
    status: future ? 'draft' : 'active',
    porte, owner,
    criada: now(),
    ativada: future ? '—' : now(),
    keywords: splitList(flags.features).join(', ') || slug.replace(/-/g, ', '),
    features: flags.features ? splitList(flags.features).join(', ') : '—',
    branch: future ? '—' : (branch || '—'),
    programa: flags.program || '—',
    workspace: flags.workspace || '—',
    origem: tr(LANG, `usuário em ${now()}`, `user at ${now()}`),
    resumo: tr(LANG, '<1 frase sobre o que entrega e por quê>', '<1 sentence on what it delivers and why>'),
  });
  writeFile(P(dir, 'main.md'), mainTxt);
  if (!future) {
    const base = flags.base || detectBaseBranch(root, branch);
    writeFile(P(dir, 'journal.md'), makeJournal(idTs, now()));
    appendLog(dir, 'ativação', (l) => tr(l, `SPEC criada e ativada (${owner}, branch ${branch || '—'}, base ${base})`, `SPEC created and activated (${owner}, branch ${branch || '—'}, base ${base})`));
    writeFile(claimPath(root, id), makeClaim({ id, title, owner, branch: branch || '—', base, features: flags.features ? splitList(flags.features).join(', ') : '—', ativada: now() }));
  }
  out(tr(LANG, `criada ${relOf(root, dir)} (${future ? 'rascunho em future/ — status draft' : 'ativa — claim registrado; NÃO rode activate (só serve para rascunhos de future/)'})`, `created ${relOf(root, dir)} (${future ? 'draft in future/ — status draft' : 'active — claim registered; do NOT run activate (it is only for drafts in future/)'})`));
  if (future) out(tr(LANG, `ative com: node scripts/specctl.mjs activate ${id}`, `activate with: node scripts/specctl.mjs activate ${id}`));
  else printClaimPublish(root, id, flags.base || detectBaseBranch(root, branch), branch);
  out(tr(LANG, 'preencha Objetivo/Escopo/Critério de aceite em main.md — formatos: docs/rules/formats.md', 'fill in Goal/Scope/Acceptance criteria in main.md — formats: docs/rules/formats.md'));
  out(jitFacts()); // C2 — bloco estável (≤900B, sem NOW): permitido SÓ em new/activate/close--dry
}

function cmdActivate(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  // `new` sem --future já ativa: activate repetido é no-op informativo, não erro (agentes seguiam docs antigas new+activate)
  if (spec.phase === 'active') { out(tr(LANG, `${spec.id} já está ativa (new sem --future já ativa e registra o claim) — nada a fazer`, `${spec.id} is already active (new without --future already activates and registers the claim) — nothing to do`)); return; }
  if (spec.phase !== 'future') die(tr(LANG, `activate: ${spec.id} está em ${spec.phase}/ — só rascunhos em future/ podem ser ativados (pausadas: use resume)`, `activate: ${spec.id} is in ${spec.phase}/ — only drafts in future/ can be activated (paused: use resume)`));
  const pm = parseMain(read(P(spec.dir, 'main.md')));
  if (pm.fields.Status === 'paused') die(tr(LANG, `${spec.id} está pausada — caminho correto: node scripts/specctl.mjs resume ${spec.id}`, `${spec.id} is paused — correct path: node scripts/specctl.mjs resume ${spec.id}`));
  const branch = flags.branch || currentBranch(root);
  if (isProtectedBranch(branch, root)) die(tr(LANG, `R.2: não ative SPEC na branch protegida '${branch}' (${protectedBranches(root).join('/')}). Caminho correto: git checkout -b feature/<slug> e rode activate lá.`, `R.2: do not activate a SPEC on the protected branch '${branch}' (${protectedBranches(root).join('/')}). Correct path: git checkout -b feature/<slug> and run activate there.`));
  const base = flags.base || detectBaseBranch(root, branch); // branch de onde a feature saiu — usada no fechamento (merge/checkout)
  let txt = read(P(spec.dir, 'main.md'));
  txt = setField(txt, 'Status', 'active');
  if ((pm.fields['Ativada'] || '—') === '—') txt = setField(txt, 'Ativada', now());
  txt = setField(txt, 'Branch', branch || '—');
  writeFile(P(spec.dir, 'main.md'), txt);
  const dst = moveSpec(spec, root, 'active');
  appendLog(dst, 'ativação', (l) => tr(l, `SPEC ativada (branch ${branch || '—'}, base ${base})`, `SPEC activated (branch ${branch || '—'}, base ${base})`));
  const pm2 = parseMain(read(P(dst, 'main.md')));
  writeFile(claimPath(root, spec.id), makeClaim({
    id: spec.id,
    title: (pm2.lines[0] || '').replace(/^#\s*[^:]*:\s*/, '') || spec.id,
    owner: pm2.fields.Owner || '@owner',
    branch: branch || '—',
    base,
    features: pm2.fields.Features || '—',
    ativada: now(),
  }));
  cmdIndex({ quiet: true }); // pasta mudou de future/ → active/: DEFERRED/INDEX citam o caminho
  out(tr(LANG, `ativada: docs/active/${spec.id} (claim: docs/claims/${spec.id}.md)`, `activated: docs/active/${spec.id} (claim: docs/claims/${spec.id}.md)`));
  printClaimPublish(root, spec.id, base, branch);
  out(jitFacts()); // C2 — bloco estável (≤900B, sem NOW): permitido SÓ em new/activate/close--dry
}

// team: multi — o claim precisa correr NA FRENTE do trabalho (visibilidade p/ os outros devs, R.11/team.md).
// Chamado por toda via que cria claim de SPEC recém-ativada (new ativo e activate).
function printClaimPublish(root, id, base, branch) {
  if (manifest(root).team !== 'multi') return;
  out(tr(LANG, `— team: multi — PUBLIQUE o claim na ${base} agora (PR trivial, diff só do claim):`, `— team: multi — PUBLISH the claim to ${base} now (trivial PR, diff is only the claim):`));
  out(`  git checkout -b claim/${id} ${base}`);
  out(`  git checkout ${branch || '<branch>'} -- docs/claims/${id}.md`);
  out(`  git commit -m "docs: claim ${id} (R.11)" && git push -u origin claim/${id}`);
  out(tr(LANG, `  abra o PR para ${base} (auto-merge se permitido) e volte: git checkout ${branch || '<branch>'}`, `  open the PR to ${base} (auto-merge if allowed) and go back: git checkout ${branch || '<branch>'}`));
}

function cmdPause(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase !== 'active') die(tr(LANG, `pause: ${spec.id} está em ${spec.phase}/ — só SPECs ativas podem ser pausadas`, `pause: ${spec.id} is in ${spec.phase}/ — only active SPECs can be paused`));
  const motivo = flags.motivo;
  if (!motivo) die(tr(LANG, 'pause exige --motivo "..." (R.5: pausa preserva contexto com motivo)', 'pause requires --reason "..." (R.5: a pause keeps context with a reason)'));
  let txt = read(P(spec.dir, 'main.md'));
  txt = setField(txt, 'Status', 'paused');
  txt = setField(txt, 'Pausada em', `${now()} — ${motivo}`);
  writeFile(P(spec.dir, 'main.md'), txt);
  appendLog(spec.dir, 'nota', (l) => tr(l, `Pausada: ${motivo}`, `Paused: ${motivo}`));
  const dst = moveSpec(spec, root, 'future');
  removeClaim(root, spec.id);
  cmdIndex({ quiet: true }); // pasta mudou de active/ → future/: DEFERRED/INDEX citam o caminho
  out(tr(LANG, `pausada: docs/future/${spec.id} (claim removido). Retome com: node scripts/specctl.mjs resume ${spec.id}`, `paused: docs/future/${spec.id} (claim removed). Resume with: node scripts/specctl.mjs resume ${spec.id}`));
  void dst;
}

function cmdResume(pos) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase !== 'future') die(tr(LANG, `resume: ${spec.id} está em ${spec.phase}/ — só pausadas em future/ podem ser retomadas`, `resume: ${spec.id} is in ${spec.phase}/ — only paused SPECs in future/ can be resumed`));
  const pm = parseMain(read(P(spec.dir, 'main.md')));
  if (pm.fields.Status !== 'paused') die(tr(LANG, `${spec.id} tem status '${pm.fields.Status}' — rascunhos usam: node scripts/specctl.mjs activate ${spec.id}`, `${spec.id} has status '${pm.fields.Status}' — drafts use: node scripts/specctl.mjs activate ${spec.id}`));
  const branch = currentBranch(root);
  if (isProtectedBranch(branch, root)) die(tr(LANG, `R.2: não retome SPEC na branch protegida '${branch}' (${protectedBranches(root).join('/')}). Caminho correto: git checkout -b feature/<slug> e rode resume lá.`, `R.2: do not resume a SPEC on the protected branch '${branch}' (${protectedBranches(root).join('/')}). Correct path: git checkout -b feature/<slug> and run resume there.`));
  let txt = read(P(spec.dir, 'main.md'));
  txt = setField(txt, 'Status', 'active');
  txt = setField(txt, 'Reativada em', now(), 'Pausada em'); // novo campo entra logo após "Pausada em" (PT ou EN)
  txt = setField(txt, 'Branch', branch || '—');
  writeFile(P(spec.dir, 'main.md'), txt);
  const dst = moveSpec(spec, root, 'active');
  appendLog(dst, 'unblock', (l) => tr(l, 'Retomada (resume)', 'Resumed (resume)'));
  const pm2 = parseMain(read(P(dst, 'main.md')));
  writeFile(claimPath(root, spec.id), makeClaim({
    id: spec.id,
    title: (pm2.lines[0] || '').replace(/^#\s*[^:]*:\s*/, '') || spec.id,
    owner: pm2.fields.Owner || '@owner',
    branch: branch || '—',
    base: detectBaseBranch(root, branch),
    features: pm2.fields.Features || '—',
    ativada: now(),
  }));
  cmdIndex({ quiet: true }); // pasta mudou de future/ → active/: DEFERRED/INDEX citam o caminho
  out(tr(LANG, `retomada: docs/active/${spec.id} (claim recriado)`, `resumed: docs/active/${spec.id} (claim recreated)`));
}

// reopen: rota mecânica da "Aplicação imediata" do R.6.2 (lifecycle §5.1) — SPEC arquivada com pendência
// real volta para active/ SEM mover pastas à mão. Exige --motivo (vai ao LOG; a reabertura fica auditável).
function cmdReopen(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase !== 'archive') die(tr(LANG, `reopen: ${spec.id} está em ${spec.phase}/ — só SPECs arquivadas reabrem (pausada: resume; descartada não reabre, crie SPEC nova citando-a)`, `reopen: ${spec.id} is in ${spec.phase}/ — only archived SPECs reopen (paused: resume; a discarded SPEC does not reopen, create a new SPEC citing it)`));
  const motivo = flags.motivo;
  if (!motivo) die(tr(LANG, 'reopen exige --motivo "..." (por que o fechamento foi indevido — ex.: critério aceito sem autorização R.6.2)', 'reopen requires --reason "..." (why the close was improper — e.g. a criterion accepted without R.6.2 authorization)'));
  const branch = currentBranch(root);
  if (isProtectedBranch(branch, root)) die(tr(LANG, `R.2: não reabra SPEC na branch protegida '${branch}' (${protectedBranches(root).join('/')}). Caminho correto: git checkout -b feature/<slug> e rode reopen lá.`, `R.2: do not reopen a SPEC on the protected branch '${branch}' (${protectedBranches(root).join('/')}). Correct path: git checkout -b feature/<slug> and run reopen there.`));
  let txt = read(P(spec.dir, 'main.md'));
  txt = setField(txt, 'Status', 'active');
  txt = setField(txt, 'Reaberta em', `${now()} — ${motivo}`, 'Criada'); // novo campo entra logo após "Criada" (PT ou EN)
  // fechamento anterior deixa de valer: Concluída/Commit final voltam a "—" e o digest (gerado) é descartado —
  // o próximo close re-estampa e re-gera. A [conclusão] antiga fica no LOG (append-only), mas só conta a posterior à reabertura.
  if (hasField(txt, 'Concluída')) txt = setField(txt, 'Concluída', '—');
  if (hasField(txt, 'Commit final')) txt = setField(txt, 'Commit final', '—');
  writeFile(P(spec.dir, 'main.md'), txt);
  const dst = moveSpec(spec, root, 'active');
  fs.rmSync(P(dst, 'digest.md'), { force: true });
  appendLog(dst, 'nota', (l) => tr(l, `Reabertura (reopen): ${motivo}`, `Reopened (reopen): ${motivo}`));
  const pm2 = parseMain(read(P(dst, 'main.md')));
  writeFile(claimPath(root, spec.id), makeClaim({
    id: spec.id,
    title: (pm2.lines[0] || '').replace(/^#\s*[^:]*:\s*/, '') || spec.id,
    owner: pm2.fields.Owner || '@owner',
    branch: branch || '—',
    base: detectBaseBranch(root, branch),
    features: pm2.fields.Features || '—',
    ativada: now(),
  }));
  cmdIndex({ quiet: true });
  out(tr(LANG, `reaberta: docs/active/${spec.id} (claim recriado, INDEX regenerado)`, `reopened: docs/active/${spec.id} (claim recreated, INDEX regenerated)`));
  out(tr(LANG, `complete o trabalho e feche de novo: node scripts/specctl.mjs close ${spec.id} --dry`, `finish the work and close again: node scripts/specctl.mjs close ${spec.id} --dry`));
}

function featureConcludedOk(root, feat, id) {
  const fp = P(root, 'docs', 'features', ...feat.split('/')) + '.md';
  if (!exists(fp)) return { ok: false, why: tr(LANG, `docs/features/${feat}.md inexistente (R.7)`, `docs/features/${feat}.md does not exist (R.7)`) };
  const txt = stripFences(read(fp)); // fences fora: SPEC-id de EXEMPLO num bloco de código não prova R.7
  const pref = idPrefix(id);
  const m = /###\s+(?:Conclu[íi]das|Completed)([\s\S]*?)(?=\n#{2,3}\s|$)/.exec(txt);
  const scope = m ? m[1] : txt;
  if (!scope.includes(pref)) return { ok: false, why: tr(LANG, `R.7: adicione ${pref} em '### Concluídas' de docs/features/${feat}.md (validação por CONTEÚDO)`, `R.7: add ${pref} under '### Completed' in docs/features/${feat}.md (validated by CONTENT)`) };
  return { ok: true };
}

function cmdArchive(pos) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase !== 'active') die(tr(LANG, `archive: ${spec.id} está em ${spec.phase}/ — só SPECs ativas são arquivadas (rascunho abandonado: discard)`, `archive: ${spec.id} is in ${spec.phase}/ — only active SPECs are archived (abandoned draft: discard)`));
  const mainPath = P(spec.dir, 'main.md');
  const pm = parseMain(read(mainPath));
  const pend = [];
  const crit = getCriteria(pm);
  if (!crit || !crit.length) pend.push(tr(LANG, 'seção "## Critério de aceite" sem checkboxes — contrato R.6.2 vazio', 'section "## Acceptance criteria" has no checkboxes — R.6.2 contract is empty'));
  else for (const c of crit) {
    if (!c.checked && !ACEITO_RE.test(c.raw)) {
      pend.push(tr(LANG, `critério aberto sem marcador [aceito-incompleto: "citação literal do usuário" YYYY-MM-DD HH:MM]: "${truncate(c.text, 70)}" (R.6.2 — só o USUÁRIO aceita incompleto)`, `open criterion without marker [accepted-incomplete: "user's literal quote" YYYY-MM-DD HH:MM]: "${truncate(c.text, 70)}" (R.6.2 — only the USER accepts incomplete)`));
    }
    if (c.checked && !hasTs(c.raw)) pend.push(tr(LANG, `checkbox [x] sem timestamp: "${truncate(c.text, 70)}" (R.6)`, `checkbox [x] without timestamp: "${truncate(c.text, 70)}" (R.6)`));
  }
  const dgp = P(spec.dir, 'digest.md');
  if (!exists(dgp)) pend.push(tr(LANG, 'digest.md ausente — obrigatório no fechamento (≤2.000 bytes; ver docs/rules/lifecycle.md)', 'digest.md missing — required at close (≤2,000 bytes; see docs/rules/lifecycle.md)'));
  else {
    const db = digestMeasure(read(dgp));
    if (db > 2000) pend.push(tr(LANG, `digest.md com ${db}B > 2000B (R.16) — re-gere dentro do cap: node scripts/specctl.mjs digest ${spec.id} --fix`, `digest.md is ${db}B > 2000B (R.16) — regenerate within the cap: node scripts/specctl.mjs digest ${spec.id} --fix`));
  }
  const jp = P(spec.dir, 'journal.md');
  if (!exists(jp)) pend.push(tr(LANG, 'journal.md ausente', 'journal.md missing'));
  else {
    const jtxt = read(jp);
    if (!hasCurrentConclusao(norm(jtxt))) pend.push(tr(LANG, 'entrada [conclusão] ausente no LOG do journal (após uma reabertura, é preciso uma [conclusão] nova)', 'no [completion] entry in the journal LOG (after a reopen, a new [completion] is required)'));
    // SNAPSHOT ainda com placeholders do template = não reflete a conclusão (e o digest gerado herdaria o lixo)
    const snapEnd = jtxt.search(/^## LOG\b/m);
    const snap = snapEnd >= 0 ? jtxt.slice(0, snapEnd) : jtxt;
    if (SNAP_PLACEHOLDER.test(snap)) pend.push(tr(LANG, 'SNAPSHOT ainda com placeholders do template ("Onde tô/Próximo passo/Fase" não preenchidos) — sobrescreva o SNAPSHOT do journal refletindo a conclusão antes de fechar', 'SNAPSHOT still has template placeholders ("Where I am/Next step/Phase" not filled in) — overwrite the journal SNAPSHOT to reflect completion before closing'));
  }
  if ((pm.fields['Commit final'] || '—').trim() === '—') pend.push(tr(LANG, '**Commit final:** não preenchido (R.6.1)', '**Final commit:** not filled in (R.6.1)'));
  const feats = splitList(pm.fields.Features || '');
  if (!feats.length) pend.push(tr(LANG, '**Features:** vazio — R.4/R.7 exigem vínculo a feature', '**Features:** empty — R.4/R.7 require a link to a feature'));
  for (const f of feats) {
    const r = featureConcludedOk(root, f, spec.id);
    if (!r.ok) pend.push(r.why);
  }
  if (pend.length) {
    process.stderr.write(tr(LANG, `archive BLOQUEADO — ${pend.length} pendência(s) em ${spec.id}:\n`, `archive BLOCKED — ${pend.length} pending item(s) in ${spec.id}:\n`));
    for (const p of pend) process.stderr.write(`  - ${p}\n`);
    process.exit(1);
  }
  archiveApply(root, spec);
  out(tr(LANG, `arquivada: docs/archive/${spec.id} (claim removido, INDEX regenerado)`, `archived: docs/archive/${spec.id} (claim removed, INDEX regenerated)`));
}

// cauda de fechamento (compartilhada por archive e close): estampa Status/Concluída,
// move p/ archive/ (ÚLTIMO ato mutador) e regenera índices (pós-move só index — idempotente)
function archiveApply(root, spec) {
  const mainPath = P(spec.dir, 'main.md');
  const pm = parseMain(read(mainPath));
  let txt = read(mainPath);
  txt = setField(txt, 'Status', 'done');
  if ((pm.fields['Concluída'] || '—') === '—') txt = setField(txt, 'Concluída', now());
  writeFile(mainPath, txt);
  const dst = moveSpec(spec, root, 'archive');
  removeClaim(root, spec.id);
  cmdIndex({ quiet: true });
  return dst;
}

function cmdDiscard(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase !== 'active' && spec.phase !== 'future') die(tr(LANG, `discard: ${spec.id} está em ${spec.phase}/ — nada a descartar`, `discard: ${spec.id} is in ${spec.phase}/ — nothing to discard`));
  const motivo = flags.motivo;
  if (!motivo) die(tr(LANG, 'discard exige --motivo "..." (R.5: descarte preserva aprendizado com justificativa)', 'discard requires --reason "..." (R.5: a discard keeps the learning with a rationale)'));
  const mainPath = P(spec.dir, 'main.md');
  let txt = read(mainPath);
  if (!hasSection(txt, 'Justificativa de descarte')) {
    if (!txt.endsWith('\n')) txt += '\n';
    txt += `\n## ${sectionLabel('Justificativa de descarte', docLang(txt))}\n\n${motivo} (${now()})\n`;
  }
  txt = setField(txt, 'Status', 'discarded');
  writeFile(mainPath, txt);
  appendLog(spec.dir, 'conclusão', (l) => tr(l, `Descartada: ${motivo}`, `Discarded: ${motivo}`));
  // digest gerado AUTOMÁTICO (paridade com o close — nunca conte bytes à mão); refine depois via digest <id> --stdin
  const dgPath = P(spec.dir, 'digest.md');
  let dgNote = tr(LANG, 'digest preservado', 'digest kept');
  if (!exists(dgPath) || digestMeasure(read(dgPath)) > 2000) {
    writeFile(dgPath, genDigest(root, spec, { concluida: now() }));
    dgNote = tr(LANG, `digest gerado (${digestMeasure(read(dgPath))}B)`, `digest generated (${digestMeasure(read(dgPath))}B)`);
  }
  moveSpec(spec, root, 'discard');
  removeClaim(root, spec.id);
  cmdIndex({ quiet: true });
  out(tr(LANG, `descartada: docs/discard/${spec.id} (justificativa + ${dgNote}, INDEX regenerado)`, `discarded: docs/discard/${spec.id} (rationale + ${dgNote}, INDEX regenerated)`));
  out(tr(LANG, `lições/gotchas: refine o digest se preciso — node scripts/specctl.mjs digest ${spec.id} --stdin`, `lessons/gotchas: refine the digest if needed — node scripts/specctl.mjs digest ${spec.id} --stdin`));
}

// ---------------------------------------------------------------- features / taxonomy / index

function featureFiles(root) {
  const base = P(root, 'docs', 'features');
  return walkFiles(base, { exts: ['.md'] })
    .filter((f) => !f.endsWith('.history.md'))
    .map((f) => ({ path: f, area: relOf(base, f).replace(/\.md$/, '') }));
}
function parseFeature(txt) {
  const t = norm(txt);
  const lines = t.split('\n');
  const kw = (/^\*\*Keywords:\*\*\s*(.*)$/m.exec(t) || [])[1] || '';
  const resumo = fieldValue(t, 'Resumo');
  const paths = [];
  const ai = lines.findIndex((l) => fieldLineRe('Arquivos principais').test(l));
  if (ai >= 0) {
    for (let i = ai + 1; i < lines.length; i++) {
      const m = /^\s+-\s+(.+)$/.exec(lines[i]) || /^-\s+(.+)$/.exec(lines[i]);
      if (m) paths.push(m[1].trim().replace(/^`|`$/g, ''));
      else break;
    }
  }
  return { kw, resumo, paths };
}
function parseTaxonomy(root) {
  const p = P(root, 'docs', 'TAXONOMY.md');
  if (!exists(p)) return null;
  const set = new Set();
  // comentários HTML (exemplos dos stubs) e fenced code NÃO entram no vocabulário
  for (const m of stripFences(norm(read(p))).matchAll(/^-\s+(\S+)\s+—/gm)) set.add(m[1]);
  return set;
}
const cleanCell = (s) => (s || '').replace(/\|/g, '/').trim() || '—';

function genIndex(root) {
  const feats = featureFiles(root)
    .map((f) => ({ area: f.area, ...parseFeature(readSafe(f.path)) }))
    .sort((a, b) => (a.area < b.area ? -1 : 1));
  let s = `# INDEX\n\n${genMark()}\n\n`;
  if (!feats.length) return s + tr(LANG, '_Sem features ainda._\n', '_No features yet._\n');
  const groups = new Map();
  for (const f of feats) {
    const ns = f.area.includes('/') ? f.area.split('/')[0] : tr(LANG, 'geral', 'general');
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(f);
  }
  for (const ns of [...groups.keys()].sort()) {
    s += `## ${ns}\n\n`;
    for (const f of groups.get(ns)) {
      // INDEX é mapa de roteamento (nome → keywords → feature); resumo/paths vivem na feature.
      const kw = (f.kw || '').split(',').slice(0, 6).join(',').trim() || tr(LANG, '(sem keywords)', '(no keywords)');
      s += `- **${f.area}** — ${truncate(kw, 90)}\n`;
    }
    s += '\n';
  }
  return s.replace(/\n+$/, '\n');
}
function genArchiveIndex(root) {
  const rows = [];
  for (const spec of listSpecs(root).filter((x) => x.phase === 'archive' || x.phase === 'discard').sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const pm = parseMain(readSafe(P(spec.dir, 'main.md')));
    const status = pm.fields.Status || (spec.phase === 'archive' ? 'done' : 'discarded');
    rows.push(`${spec.id} | ${cleanCell(status)} | ${cleanCell(pm.fields.Features)} | ${cleanCell(pm.fields.Keywords)} | ${cleanCell(pm.fields.Resumo)}`);
  }
  let s = `# ARCHIVE-INDEX\n\n${genMark()}\n\n`;
  s += rows.length ? rows.join('\n') + '\n' : tr(LANG, '_Vazio._\n', '_Empty._\n');
  return s;
}
// DEFERRED: índice vivo do que foi deixado para depois COM autorização (R.6.2) — os marcadores
// [aceito-incompleto] ficam espalhados nos mains (inclusive arquivados, que o guard N3 protege);
// este índice gerado os torna visíveis sem abrir archive. Deferral sem citação não existe (R.6.2).
function genDeferred(root) {
  const rows = [];
  const CITE_RE = new RegExp(`\\[(?:${ACEITO_TAG_ALT}):\\s*(?:"([^"]+)"|“([^”]+)”)\\s+(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2})\\]`);
  for (const spec of listSpecs(root).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const pm = parseMain(readSafe(P(spec.dir, 'main.md')));
    for (const c of getCriteria(pm) || []) {
      const m = CITE_RE.exec(c.raw);
      if (!m) continue;
      const critTxt = c.text.replace(CITE_RE, '').replace(/\s*\|\s*verify:.*$/, '').trim();
      rows.push(`- ${spec.id} (${spec.phase}) | ${cleanCell(truncate(critTxt, 90))} | "${truncate(m[1] || m[2], 70)}" ${m[3]}`);
    }
  }
  let s = `${tr(LANG, '# DEFERRED — deixado para depois com autorização (R.6.2)', '# DEFERRED — deferred with authorization (R.6.2)')}\n\n${genMark()}\n\n`;
  s += rows.length
    ? tr(LANG,
      `SPEC | critério deferido | citação do usuário:\n\n${rows.join('\n')}\n\nRetomar um item = SPEC nova citando a origem (ou reopen se o fechamento foi indevido).\n`,
      `SPEC | deferred criterion | user quote:\n\n${rows.join('\n')}\n\nTo resume an item = new SPEC citing the origin (or reopen if the close was wrong).\n`)
    : tr(LANG, '_Nenhum item deferido — nenhum marcador [aceito-incompleto] no repositório._\n', '_No deferred items — no [accepted-incomplete] marker in the repository._\n');
  return s;
}
function cmdIndex(opts = {}) {
  const root = requireRoot();
  ensureGitkeeps(root); // rede de segurança do CI: index roda no docs-gate e após close/archive — garante estrutura em checkout fresco
  writeFile(P(root, 'docs', 'INDEX.md'), genIndex(root));
  writeFile(P(root, 'docs', 'ARCHIVE-INDEX.md'), genArchiveIndex(root));
  writeFile(P(root, 'docs', 'PROGRAMS.md'), genProgramsIndex(root));
  writeFile(P(root, 'docs', 'DEFERRED.md'), genDeferred(root));
  if (!opts.quiet) out(tr(LANG, 'regenerados: docs/INDEX.md, docs/ARCHIVE-INDEX.md, docs/PROGRAMS.md e docs/DEFERRED.md (determinístico, sem timestamp)', 'regenerated: docs/INDEX.md, docs/ARCHIVE-INDEX.md, docs/PROGRAMS.md and docs/DEFERRED.md (deterministic, no timestamp)'));
}

// ---------------------------------------------------------------- descoberta de backlog (next/programs/roadmap)

// SPECs em future/ com Status draft (via main.md) — [{ id }]
function futureDraftSpecs(root) {
  const outArr = [];
  for (const s of listSpecs(root).filter((x) => x.phase === 'future')) {
    const st = parseMain(readSafe(P(s.dir, 'main.md'))).fields.Status || null;
    if (st === 'draft') outArr.push({ id: s.id, dir: s.dir });
  }
  return outArr.sort((a, b) => (a.id < b.id ? -1 : 1));
}
// lê docs/ROADMAP.md — array de SPEC-ids na ordem (ignora comentários/linhas sem SPEC-id)
function parseRoadmap(root) {
  const p = P(root, 'docs', 'ROADMAP.md');
  if (!exists(p)) return [];
  const ids = [];
  for (const line of stripFences(norm(read(p))).split('\n')) {
    // entradas "N. SPEC-..." ou "- SPEC-..." — extrai o SPEC-id por regex, linhas sem SPEC-id são ignoradas
    if (!/^\s*(?:\d+\.|-)\s+/.test(line)) continue;
    const m = /SPEC-\d{8}-\d{4}(?:-[a-z0-9][a-z0-9-]*)?/.exec(line);
    if (m) ids.push(m[0]);
  }
  return ids;
}
// estado derivado de um programa (status vem do main.md de cada nó, fonte única)
// retorna { ready:[], active:[], blocked:[{id,waits:[]}], done:[], total, open, owner }
function computeProgramState(prog, statusOf) {
  const ready = [], active = [], blocked = [], done = [], paused = [];
  const isDone = (st) => st === 'done' || st === 'discarded';
  for (const n of prog.nodes) {
    const st = statusOf(n.id);
    if (isDone(st)) { done.push(n.id); continue; }
    if (st === 'active') { active.push(n.id); continue; }
    if (st === 'paused') { paused.push(n.id); continue; } // visível, mas não pegável — retomar é decisão (resume)
    if (st === 'draft') {
      const waits = n.deps.filter((d) => !isDone(statusOf(d)));
      if (waits.length) blocked.push({ id: n.id, waits });
      else ready.push(n.id);
    }
    // null (nó sem SPEC): o audit --deps acusa como erro — aqui não listado
  }
  const total = prog.nodes.length;
  const open = done.length < total; // ≥1 nó ∉ {done, discarded}
  return { ready, active, blocked, done, paused, total, open, owner: prog.owner || '—' };
}
// conteúdo determinístico de docs/PROGRAMS.md (GERADO por specctl index) — formato §1 do contrato
function genProgramsIndex(root) {
  const statusOf = makeStatusOf(listSpecs(root));
  const progs = parsePrograms(root);
  let s = `# PROGRAMS\n\n${genMark()}\n\n`;
  if (!progs.length) return s + tr(LANG, '_Sem programas._\n', '_No programs._\n');
  const entries = progs.map((p) => ({ prog: p, state: computeProgramState(p, statusOf) }));
  // ordenar: abertos primeiro, depois concluídos; dentro, por slug
  entries.sort((a, b) => {
    if (a.state.open !== b.state.open) return a.state.open ? -1 : 1;
    return a.prog.slug < b.prog.slug ? -1 : 1;
  });
  const blocks = [];
  for (const { prog, state } of entries) {
    const L = (pt, en) => tr(LANG, pt, en);
    const situacao = state.open ? L('aberto', 'open') : L('concluído', 'done');
    let block = `## ${prog.slug} — ${situacao} · ${state.done.length}/${state.total} · owner ${state.owner}\n`;
    if (state.ready.length) block += `- ${L('prontos', 'ready')}: ${state.ready.join(', ')}\n`;
    if (state.active.length) block += `- ${L('em progresso', 'in progress')}: ${state.active.join(', ')}\n`;
    if (state.blocked.length) {
      const bl = state.blocked.map((b) => `${b.id} (${L('aguarda', 'waits on')} ${b.waits.join(', ')})`).join(', ');
      block += `- ${L('bloqueados', 'blocked')}: ${bl}\n`;
    }
    if (state.paused.length) block += `- ${L('pausados', 'paused')}: ${state.paused.join(', ')} (${L('retomar', 'resume')}: specctl resume)\n`;
    if (state.done.length) block += `- ${L('concluídos', 'done')}: ${state.done.join(', ')}\n`;
    blocks.push(block);
  }
  return s + blocks.join('\n');
}

// ---------------------------------------------------------------- lint (§8)

function extractRfs(txt) {
  const clean = stripFences(norm(txt)); // RF-n de EXEMPLO em bloco de código não é requisito real
  const s = new Set();
  for (const m of clean.matchAll(/^\s*(?:#{1,6}\s+|[-*]\s+|\d+\.\s+)?\*{0,2}(?:RF|FR)-(\d+)/gm)) s.add(+m[1]);
  if (!s.size) for (const m of clean.matchAll(/\b(?:RF|FR)-(\d+)\b/g)) s.add(+m[1]);
  return s;
}
function coveredRfs(text) {
  const s = new Set();
  for (const m of text.matchAll(/\((?:cobre|covers) ([^)]*)\)/g)) { // (cobre RF-n) | (covers FR-n)
    for (const r of m[1].matchAll(/(?:RF|FR)-(\d+)/g)) s.add(+r[1]);
  }
  return s;
}
function lintJournal(root, jp, err, warn2, v3) {
  const rep = (r, m) => { if (v3 && warn2) warn2(r, m, { stage1: true }); else err(r, m); };
  const txt = norm(read(jp));
  const lines = txt.split('\n');
  const relp = relOf(root, jp);
  const snapIdx = [];
  lines.forEach((l, i) => { if (/^## SNAPSHOT\b/.test(l)) snapIdx.push(i); });
  if (!snapIdx.length) err(relp, tr(LANG, 'journal sem heading "## SNAPSHOT" (formato §3)', 'journal without "## SNAPSHOT" heading (format §3)'));
  else {
    if (snapIdx[0] >= 60) err(relp, tr(LANG, `SNAPSHOT começa na linha ${snapIdx[0] + 1} — DEVE caber nas primeiras 60 linhas`, `SNAPSHOT starts at line ${snapIdx[0] + 1} — it MUST fit in the first 60 lines`));
    if (snapIdx.length > 1) err(relp, tr(LANG, 'heading "## SNAPSHOT" duplicado — SNAPSHOT é único e sobrescrito', 'duplicate "## SNAPSHOT" heading — the SNAPSHOT is unique and overwritten'));
  }
  const logIdx = lines.findIndex((l) => /^## LOG\b/.test(l));
  if (logIdx >= 0 && snapIdx.length && logIdx > 60) err(relp, tr(LANG, `SNAPSHOT termina na linha ${logIdx + 1} — DEVE caber nas primeiras 60 linhas (o brief trunca em 60)`, `SNAPSHOT ends at line ${logIdx + 1} — it MUST fit in the first 60 lines (brief truncates at 60)`));
  const snapStart = snapIdx.length ? snapIdx[0] : -1;
  const snapEnd = logIdx >= 0 ? logIdx : lines.length;
  lines.forEach((l, i) => {
    if ((/^#{1,6}\s.*TL;?DR/i.test(l) || /^\*\*TL;?DR/i.test(l)) && (i < snapStart || i >= snapEnd)) {
      err(relp, tr(LANG, `TL;DR fora do SNAPSHOT (linha ${i + 1}) — o único sumário sobrescrito é o SNAPSHOT`, `TL;DR outside the SNAPSHOT (line ${i + 1}) — the only overwritten summary is the SNAPSHOT`));
    }
  });
  if (logIdx >= 0) {
    const entryRe = new RegExp(`^## \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} — \\[(${MARCO_ALT}|${ALL_LOG_TYPES_ALT})\\]`);
    for (let i = logIdx + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i]) && !entryRe.test(lines[i])) {
        rep(relp, tr(LANG, `entrada de LOG inválida (linha ${i + 1}): "${truncate(lines[i], 60)}" — formato: ## YYYY-MM-DD HH:MM — [tipo] Título; tipos: ${LOG_TYPES.join(' ')}`, `invalid LOG entry (line ${i + 1}): "${truncate(lines[i], 60)}" — format: ## YYYY-MM-DD HH:MM — [type] Title; types: ${LOG_TYPES.map((t) => LOG_TYPE_EN[t]).join(' ')}`));
      }
    }
  }
}
const POINTER_KEYS = ['PRD', 'TechSpec', 'Tasks', 'QA', 'Review', 'Bugfix', 'Bugs', 'Evidence'];

function runLint(root, opts = {}) {
  const E = [], W = [];
  const err = (f, m) => E.push({ f, m });
  // stage1: avisos "warn no 1º release" (§8) — NUNCA promovidos a erro por --strict
  const warn = (f, m, o = {}) => W.push({ f, m, ...o });

  // manifesto
  const manPath = P(root, 'docs', '.spec-system.json');
  if (!exists(manPath)) warn('docs/.spec-system.json', tr(LANG, 'manifesto ausente — modo compatibilidade v3 (rode a skill spec-system-init, modo UPGRADE)', 'manifest missing — v3 compatibility mode (run the spec-system-init skill, UPGRADE mode)'));
  else { try { JSON.parse(read(manPath)); } catch (e) { err('docs/.spec-system.json', tr(LANG, `JSON inválido: ${e.message}`, `invalid JSON: ${e.message}`)); } }

  // estrutura de pastas
  for (const d of ['features', 'active', 'future', 'archive', 'discard', 'claims', 'programs']) {
    if (!isDir(P(root, 'docs', d))) err(`docs/${d}/`, tr(LANG, 'pasta obrigatória ausente (estrutura v4 — rode specctl init)', 'required folder missing (v4 structure — run specctl init)'));
  }

  // taxonomy + features
  const tax = parseTaxonomy(root);
  const feats = featureFiles(root);
  if (!tax && feats.length) warn('docs/TAXONOMY.md', tr(LANG, 'ausente — R.13 exige vocabulário canônico de áreas', 'missing — R.13 requires a canonical area vocabulary'));
  const decSeen = new Map();
  for (const f of feats) {
    const relp = relOf(root, f.path);
    const txt = norm(readSafe(f.path));
    if (!/^\*\*Keywords:\*\*/m.test(txt)) err(relp, tr(LANG, 'feature sem linha **Keywords:** (formato §5)', 'feature without a **Keywords:** line (format §5)'));
    if (!hasField(txt, 'Resumo')) err(relp, tr(LANG, 'feature sem linha **Resumo:** (formato §5)', 'feature without a **Summary:** line (format §5)'));
    for (const h of ['Specs desta feature', 'Estado atual', 'Decisões arquiteturais ativas', 'Gotchas']) {
      if (!hasSection(txt, h)) err(relp, tr(LANG, `seção obrigatória ausente: "## ${sectionLabel(h)}" (formato §5)`, `required section missing: "## ${sectionLabel(h)}" (format §5)`));
    }
    if (/###\s+(?:Em execução|In progress)/.test(txt)) warn(relp, tr(LANG, 'seção "Em execução" foi removida na v4 — o trabalho em voo vive em docs/claims/ (specctl activate)', 'section "In progress" was removed in v4 — in-flight work lives in docs/claims/ (specctl activate)'));
    for (const m of stripFences(txt).matchAll(/^\s*-\s*(?:\*\*)?(DEC-\d{8}-\d{4}(?:-[a-z0-9-]+)?)/gm)) { // DEC de EXEMPLO em fence não conta
      if (decSeen.has(m[1])) err(relp, tr(LANG, `DEC-id duplicado: ${m[1]} (também definido em ${decSeen.get(m[1])})`, `duplicate DEC-id: ${m[1]} (also defined in ${decSeen.get(m[1])})`));
      else decSeen.set(m[1], relp);
    }
    // features/<area>.md NÃO tem teto: é memória viva por área, auto-carregada no N1, e o nº de features do sistema é ilimitado. Rollup (specctl rollup <area>) é ferramenta MANUAL, opcional — o autor decide quando enxugar o auto-load; nada é lintado nem bloqueado por tamanho de feature.
    if (tax && !tax.has(f.area)) err(relp, tr(LANG, `feature '${f.area}' não coberta pela TAXONOMY.md — R.13: adicione a linha '- ${f.area} — <definição>'`, `feature '${f.area}' not covered by TAXONOMY.md — R.13: add the line '- ${f.area} — <definition>'`));
  }

  // SPECs
  for (const spec of listSpecs(root)) {
    const relDir = `docs/${spec.phase}/${spec.id}`;
    if (!SPEC_RE.test(spec.id)) { err(relDir, tr(LANG, 'nome de pasta fora do padrão SPEC-YYYYMMDD-HHMM-slug (R.1)', 'folder name does not match SPEC-YYYYMMDD-HHMM-slug (R.1)')); continue; }
    const mainPath = P(spec.dir, 'main.md');
    const mainRel = `${relDir}/main.md`;
    if (!exists(mainPath)) { err(relDir, tr(LANG, 'main.md ausente (arquivo canônico — R.3)', 'main.md missing (canonical file — R.3)')); continue; }
    const pm = parseMain(read(mainPath));
    for (const k of ['Status', 'Porte', 'Owner', 'Criada', 'Keywords', 'Features', 'Resumo']) {
      if (!(k in pm.fields) || pm.fields[k] === '') err(mainRel, tr(LANG, `campo obrigatório ausente/vazio: **${k}:** (formato §1)`, `required field missing/empty: **${fieldLabel(k)}:** (format §1)`));
    }
    const st = pm.fields.Status;
    if (st && !STATUS_ENUM.includes(st)) err(mainRel, tr(LANG, `Status inválido '${st}' — enum: ${STATUS_ENUM.join(' | ')}`, `invalid Status '${st}' — enum: ${STATUS_ENUM.join(' | ')}`));
    if (pm.fields.Porte && !['P', 'M', 'G'].includes(pm.fields.Porte)) err(mainRel, tr(LANG, `Porte inválido '${pm.fields.Porte}' — use P | M | G`, `invalid Size '${pm.fields.Porte}' — use S | M | L`));
    if (pm.fields.Owner === '—') err(mainRel, tr(LANG, 'Owner obrigatório (use @handle) — formato §1', 'Owner is required (use @handle) — format §1'));
    if (st && STATUS_ENUM.includes(st) && !PHASE_STATUS[spec.phase].includes(st)) {
      err(mainRel, tr(LANG, `coerência pasta↔status violada: ${spec.phase}/ exige status ${PHASE_STATUS[spec.phase].join(' ou ')}, encontrado '${st}'`, `folder↔status mismatch: ${spec.phase}/ requires status ${PHASE_STATUS[spec.phase].join(' or ')}, found '${st}'`));
    }
    const tm = /^# SPEC-(\d{8}-\d{4})\b/.exec(pm.lines[0] || '');
    if (!tm) warn(mainRel, tr(LANG, 'título fora do formato "# SPEC-YYYYMMDD-HHMM: <Título>"', 'title does not match "# SPEC-YYYYMMDD-HHMM: <Title>"'));
    else if (`SPEC-${tm[1]}` !== idPrefix(spec.id)) warn(mainRel, tr(LANG, `título (${tm[1]}) não bate com o id da pasta (${spec.id})`, `title (${tm[1]}) does not match the folder id (${spec.id})`));
    for (const t of ['Objetivo', 'Implementação']) {
      if (!sectionRange(pm, (x) => x === t || x.startsWith(t + ' '))) err(mainRel, tr(LANG, `seção obrigatória ausente: ## ${t}`, `required section missing: ## ${sectionLabel(t)}`));
    }
    const esc = sectionRange(pm, (x) => x === 'Escopo' || x.startsWith('Escopo'));
    if (!esc) err(mainRel, tr(LANG, 'seção obrigatória ausente: ## Escopo (DENTRO/FORA)', 'required section missing: ## Scope (IN/OUT)'));
    else {
      const body = pm.lines.slice(esc[0], esc[1]).join('\n');
      if (!(body.includes('DENTRO') || /\*\*IN:\*\*/.test(body)) || !(body.includes('FORA') || /\*\*OUT:\*\*/.test(body))) warn(mainRel, tr(LANG, 'seção Escopo sem blocos DENTRO/FORA explícitos', 'Scope section without explicit IN/OUT blocks'));
    }
    const specFeats = splitList(pm.fields.Features || '');
    if (tax) {
      for (const ft of specFeats) {
        if (!tax.has(ft)) err(mainRel, tr(LANG, `feature '${ft}' não existe na TAXONOMY.md (R.4/R.13)`, `feature '${ft}' does not exist in TAXONOMY.md (R.4/R.13)`));
      }
    } else if (specFeats.length) {
      warn(mainRel, tr(LANG, 'docs/TAXONOMY.md ausente — vínculo **Features:** não validável (R.4); crie a TAXONOMY', 'docs/TAXONOMY.md missing — **Features:** link cannot be validated (R.4); create the TAXONOMY'));
    }
    if (!specFeats.length && st && st !== 'draft') warn(mainRel, tr(LANG, '**Features:** vazio — R.4 exige vínculo a feature antes da ativação', '**Features:** empty — R.4 requires a feature link before activation'));
    // checkboxes do main.md (qualquer [x] sem timestamp = ERRO — R.6)
    pm.lines.forEach((l) => {
      const m = /^\s*-\s*\[(x|X)\]\s*(.*)$/.exec(l);
      if (m && !hasTs(l)) { const msg = tr(LANG, `checkbox [x] sem timestamp (R.6): "${truncate(m[2], 60)}"`, `checkbox [x] without timestamp (R.6): "${truncate(m[2], 60)}"`); if (spec.v3) warn(mainRel, msg, { stage1: true }); else err(mainRel, msg); }
    });
    const crit = getCriteria(pm);
    const porteLint = (pm.fields.Porte || 'M').toUpperCase();
    if (crit === null) err(mainRel, tr(LANG, 'seção obrigatória ausente: ## Critério de aceite', 'required section missing: ## Acceptance criteria'));
    else {
      if (!crit.length) warn(mainRel, tr(LANG, 'Critério de aceite sem checkboxes — o contrato R.6.2 está vazio', 'Acceptance criteria without checkboxes — the R.6.2 contract is empty'));
      // D1 — gramática por porte: P não usa verify: (evidência via check); M/G mantêm verify:
      // Só vale para SPECs em construção (active/future); archive/discard são históricas e imutáveis
      // (SPECs P v4.0 com verify: foram legais quando fechadas — não reprovar retroativamente). v3-compat idem.
      if (porteLint === 'P' && (spec.phase === 'active' || spec.phase === 'future') && !spec.v3) {
        for (const c of crit) {
          if (hasVerifyTag(c.raw)) err(mainRel, tr(LANG, `porte P não usa verify: — use specctl check (ou escalate para M): "${truncate(c.text, 60)}"`, `size S does not use verify: — use specctl check (or escalate to M): "${truncate(c.text, 60)}"`));
        }
      }
      for (const c of crit) {
        if (c.checked) {
          const evid = (hasTs(c.raw) && hasCommitEv(c.raw)) || hasVerifyTag(c.raw) || hasEvidenceTag(c.raw);
          if (!evid) {
            const msg = tr(LANG, `critério [x] sem evidência (timestamp+commit, verify: ou evidence:): "${truncate(c.text, 60)}" (R.6.2)`, `criterion [x] without evidence (timestamp+commit, verify: or evidence:): "${truncate(c.text, 60)}" (R.6.2)`);
            if (spec.phase === 'archive' && !spec.v3) err(mainRel, msg); else warn(mainRel, msg, { stage1: true });
          }
        } else if (spec.phase === 'archive') {
          const critErr = spec.v3 ? (mm) => warn(mainRel, mm, { stage1: true }) : (mm) => err(mainRel, mm);
          if (!hasAceitoTag(c.raw)) critErr(tr(LANG, `critério aberto em archive sem marcador [aceito-incompleto: "citação" YYYY-MM-DD HH:MM]: "${truncate(c.text, 60)}" (R.6.2 — só o USUÁRIO aceita incompleto)`, `open criterion in archive without marker [accepted-incomplete: "quote" YYYY-MM-DD HH:MM]: "${truncate(c.text, 60)}" (R.6.2 — only the USER accepts incomplete)`));
          else if (!ACEITO_RE.test(c.raw)) critErr(tr(LANG, `marcador [aceito-incompleto: ...] malformado — exige citação entre aspas + timestamp: "${truncate(c.text, 60)}"`, `malformed [accepted-incomplete: ...] marker — requires a quoted citation + timestamp: "${truncate(c.text, 60)}"`));
        }
      }
    }
    if (spec.phase === 'archive' && (pm.fields['Commit final'] || '—').trim() === '—') {
      err(mainRel, tr(LANG, '**Commit final:** — em SPEC arquivada (R.6.1: registre o hash final)', '**Final commit:** — in an archived SPEC (R.6.1: record the final hash)'));
    }
    if (spec.phase === 'archive' || spec.phase === 'discard') {
      const dg = P(spec.dir, 'digest.md');
      if (!exists(dg)) err(`${relDir}/digest.md`, tr(LANG, 'digest.md obrigatório no fechamento (archive E discard) — ≤2.000 bytes', 'digest.md is required at close (archive AND discard) — ≤2,000 bytes'));
      else {
        const b = digestMeasure(read(dg)); // 2c: LF + comentários HTML descontados
        if (b > 2000) err(`${relDir}/digest.md`, tr(LANG, `orçamento excedido: ${b} > 2000 bytes (R.16) — digest é o resumo denso, não o journal`, `budget exceeded: ${b} > 2000 bytes (R.16) — the digest is the dense summary, not the journal`));
      }
    }
    if (spec.phase === 'discard' && !hasSection(pm.raw, 'Justificativa de descarte')) {
      err(mainRel, tr(LANG, 'SPEC descartada sem seção "## Justificativa de descarte" (R.5)', 'discarded SPEC without a "## Discard rationale" section (R.5)'));
    }
    const jp = P(spec.dir, 'journal.md');
    const needJournal = spec.phase === 'active' || spec.phase === 'archive' || spec.phase === 'discard' || (spec.phase === 'future' && st === 'paused');
    if (needJournal && !exists(jp)) err(`${relDir}/journal.md`, tr(LANG, 'journal.md ausente (arquivo canônico — R.3; pausada mantém main+journal)', 'journal.md missing (canonical file — R.3; a paused SPEC keeps main+journal)'));
    if (exists(jp)) lintJournal(root, jp, err, warn, spec.v3);
    for (const key of POINTER_KEYS) {
      const v = pm.fields[key];
      if (!v || v === '—') continue;
      const target = v.split(/\s+\(/)[0].trim().replace(/^`|`$/g, '');
      if (!target) continue;
      if (!exists(P(spec.dir, target)) && !exists(P(root, target))) {
        warn(mainRel, tr(LANG, `ponteiro **${key}:** aponta para arquivo inexistente: ${target}`, `pointer **${key}:** points to a missing file: ${target}`), { stage1: true });
      }
    }
    const ws = pm.fields.Workspace;
    if (ws && ws !== '—' && ws !== 'inline' && !exists(P(root, ws)) && spec.phase === 'active') {
      warn(mainRel, tr(LANG, `**Workspace:** '${ws}' não existe no repositório`, `**Workspace:** '${ws}' does not exist in the repository`));
    }
    const prdPath = P(spec.dir, 'prd.md');
    if (exists(prdPath) && crit) {
      const rfs = extractRfs(read(prdPath));
      const covered = coveredRfs(crit.map((c) => c.raw).join('\n'));
      for (const n of [...rfs].sort((a, b) => a - b)) {
        if (!covered.has(n)) err(mainRel, tr(LANG, `RF-${n} do prd.md sem cobertura no Critério de aceite — use "(cobre RF-${n})" em ≥1 critério (rastreabilidade §3.2)`, `FR-${n} from prd.md not covered by the Acceptance criteria — use "(covers FR-${n})" in ≥1 criterion (traceability §3.2)`));
      }
    }
  }

  // orçamentos de camada (R.16)
  // AGENTS.md carrega, por necessidade, a seção "Sem hooks?" que o CLAUDE.md dispensa (hooks fazem esse trabalho) — orçamento diferenciado, não hack.
  // docs/INDEX.md NÃO entra: é enumeração GERADA (specctl index) cujo tamanho escala com features×SPECs — capar em bytes é erro de categoria (deadlock: gerado não se edita). Disciplina do INDEX é por-entrada (1 linha/SPEC), não por total.
  for (const [f, max] of [['CLAUDE.md', 6000], ['AGENTS.md', 6200], ['docs/RULES.md', 5000]]) {
    const fp = P(root, ...f.split('/'));
    if (exists(fp)) {
      const b = lfBytes(read(fp)); // 2c: bytes LF-normalizados (strip CR/BOM)
      if (b > max) E.push({ f, m: tr(LANG, `orçamento excedido: ${b} > ${max} bytes (R.16) — mova conteúdo para camada mais profunda (rollup, não corte)`, `budget exceeded: ${b} > ${max} bytes (R.16) — move content to a deeper layer (rollup, do not cut)`) });
    }
  }

  // ROADMAP: entrada morta some da descoberta em silêncio — id com typo/arquivado/descartado é invisível no `next`
  {
    const allSpecs = listSpecs(root);
    const phaseOf = new Map(allSpecs.map((s) => [s.id, s.phase]));
    const statusOf = makeStatusOf(allSpecs);
    for (const id of parseRoadmap(root)) {
      if (!phaseOf.has(id)) { warn('docs/ROADMAP.md', tr(LANG, `cita ${id} que NÃO EXISTE (typo?) — a entrada é ignorada pelo specctl next`, `cites ${id}, which does NOT EXIST (typo?) — specctl next ignores the entry`)); continue; }
      const ph = phaseOf.get(id), st = statusOf(id);
      if (ph === 'archive' || ph === 'discard') warn('docs/ROADMAP.md', tr(LANG, `cita ${id} já em ${ph}/ — remova a linha (entrada morta, ignorada pelo next)`, `cites ${id}, already in ${ph}/ — remove the line (dead entry, ignored by next)`));
      else if (ph === 'future' && st === 'paused') warn('docs/ROADMAP.md', tr(LANG, `cita ${id} PAUSADA — retome via specctl resume ou remova do roadmap (paused não aparece no next)`, `cites ${id}, which is PAUSED — resume via specctl resume or remove it from the roadmap (paused does not show in next)`));
    }
  }
  // INDEX/ARCHIVE-INDEX/DEFERRED gerados e idempotentes (DEFERRED só warn quando ausente — repos v4.0/4.1 antigos não têm)
  for (const [f, gen] of [['docs/INDEX.md', genIndex], ['docs/ARCHIVE-INDEX.md', genArchiveIndex], ['docs/DEFERRED.md', genDeferred]]) {
    const fp = P(root, ...f.split('/'));
    if (!exists(fp)) { W.push({ f, m: tr(LANG, 'ausente — rode: node scripts/specctl.mjs index', 'missing — run: node scripts/specctl.mjs index') }); continue; }
    const txt = read(fp);
    if (!hasGenMark(txt)) E.push({ f, m: tr(LANG, `marcador "${GERADO_MARK}" ausente — arquivo é GERADO, não edite à mão`, `marker "${GERADO_MARK_EN}" missing — the file is GENERATED, do not edit it by hand`) });
    else if (norm(gen(root)) !== norm(txt)) E.push({ f, m: tr(LANG, 'desatualizado (regeneração difere) — rode: node scripts/specctl.mjs index', 'out of date (regeneration differs) — run: node scripts/specctl.mjs index') });
  }

  // secret-scan em docs/ (R.15) — ERRO
  for (const fp of walkFiles(P(root, 'docs'), { exts: ['.md', '.txt', '.json', '.yml', '.yaml'] })) {
    for (const h of scanSecrets(readSafe(fp))) {
      E.push({ f: relOf(root, fp), m: tr(LANG, `segredo detectado (${h.tipo}) na linha ${h.line} — R.15: substitua por <REDACTED:${h.tipo}> e ROTACIONE a credencial`, `secret detected (${h.tipo}) at line ${h.line} — R.15: replace with <REDACTED:${h.tipo}> and ROTATE the credential`) });
    }
  }

  if (opts.targetMain) {
    const act = activeSpecs(root);
    if (act.length) E.push({ f: 'docs/active/', m: tr(LANG, `R.2: docs/active/ deve estar vazio em main — encontrado: ${act.map((s) => s.id).join(', ')}`, `R.2: docs/active/ must be empty on main — found: ${act.map((s) => s.id).join(', ')}`) });
  }
  return { E, W };
}
function reportLint(E, W) {
  // tom (2b): erros primeiro; avisos DEPOIS, sob header que deixa claro que não bloqueiam
  for (const e of E) process.stderr.write(tr(LANG, `ERRO  ${e.f}: ${e.m}\n`, `ERROR   ${e.f}: ${e.m}\n`));
  if (W.length) {
    process.stdout.write(tr(LANG, 'AVISOS (não bloqueiam archive/close/CI):\n', 'WARNINGS (do not block archive/close/CI):\n'));
    for (const w of W) process.stdout.write(tr(LANG, `AVISO ${w.f}: ${w.m}\n`, `WARNING ${w.f}: ${w.m}\n`));
  }
  process.stdout.write(tr(LANG, `\nlint: ${E.length} erro(s), ${W.length} aviso(s)\n`, `\nlint: ${E.length} error(s), ${W.length} warning(s)\n`));
}
function cmdLint(flags) {
  const root = requireRoot();
  const { E, W } = runLint(root, { targetMain: !!flags['target-main'] });
  reportLint(E, W);
  // --strict promove a erro APENAS avisos não-stage1 (§8: ponteiro ausente e [x] sem evidência em active/ ficam warn no 1º release; tamanho de feature não é mais lintado)
  const strictW = W.filter((w) => !w.stage1);
  const fail = E.length > 0 || (flags.strict && strictW.length > 0);
  if (flags.strict && !E.length && strictW.length) process.stdout.write(tr(LANG, '(--strict: avisos contam como falha — exceto avisos de 1º release do §8)\n', '(--strict: warnings count as failure — except §8 first-release warnings)\n'));
  process.exit(fail ? 1 : 0);
}

// ---------------------------------------------------------------- audit (§8)

function parsePrograms(root) {
  const progs = [];
  const base = P(root, 'docs', 'programs');
  if (!isDir(base)) return progs;
  for (const fp of walkFiles(base, { exts: ['.md'] })) {
    const txt = norm(readSafe(fp));
    const nodes = [];
    for (const m of txt.matchAll(/^-\s+(SPEC-\S+)\s*\|\s*(?:depende de|depends on):\s*(.*)$/gm)) {
      const deps = m[2].trim() === '—' ? [] : [...m[2].matchAll(/SPEC-[\w-]+/g)].map((x) => x[0]);
      nodes.push({ id: m[1], deps });
    }
    // Owner declarado no manifesto do programa (**Owner:** @handle)
    const owner = ((/^\*\*Owner:\*\*\s*(.*)$/m.exec(txt) || [])[1] || '').trim() || '—';
    progs.push({ slug: path.basename(fp, '.md'), rel: relOf(root, fp), txt, nodes, owner });
  }
  return progs;
}
// resolve o Status (main.md) de um SPEC-ref (id exato, prefixo ou prefixo de timestamp) — null se não existe
function makeStatusOf(specs) {
  return (ref) => {
    // igualdade exata em TODA a lista PRIMEIRO — fallback por prefixo só depois (duas SPECs no mesmo
    // minuto compartilham o idPrefix; o .find() com OR devolvia o status da vizinha e corrompia o DAG)
    let s = specs.find((x) => x.id === ref);
    if (!s) s = specs.find((x) => x.id.startsWith(ref) || ref.startsWith(idPrefix(x.id)));
    if (!s) return null;
    return parseMain(readSafe(P(s.dir, 'main.md'))).fields.Status || null;
  };
}
function auditDeps(root, E, W) {
  const specs = listSpecs(root);
  const statusOf = makeStatusOf(specs);
  for (const prog of parsePrograms(root)) {
    if (!prog.nodes.length) { W.push({ f: prog.rel, m: tr(LANG, 'programa sem nós (- SPEC-<id> | depende de: ...)', 'program without nodes (- SPEC-<id> | depends on: ...)') }); continue; }
    if (/^\s*(\*\*)?(?:Bloqueia|Blocks)/m.test(prog.txt)) W.push({ f: prog.rel, m: tr(LANG, '"Bloqueia"/ordem são DERIVADOS do DAG — não escreva no manifesto (R.14)', '"Blocks"/order are DERIVED from the DAG — do not write them in the manifest (R.14)') });
    const known = new Map(prog.nodes.map((n) => [n.id, n]));
    for (const n of prog.nodes) {
      if (statusOf(n.id) === null) E.push({ f: prog.rel, m: tr(LANG, `nó inexistente no repositório: ${n.id} (R.14: todo nó do programa é uma SPEC real)`, `node does not exist in the repository: ${n.id} (R.14: every program node is a real SPEC)`) });
      for (const d of n.deps) {
        if (statusOf(d) === null && !known.has(d)) E.push({ f: prog.rel, m: tr(LANG, `dependência inexistente: ${n.id} depende de ${d}`, `missing dependency: ${n.id} depends on ${d}`) });
      }
    }
    // ciclos (DFS)
    const color = new Map();
    const stack = [];
    let cycle = null;
    const visit = (id) => {
      if (cycle) return;
      color.set(id, 1); stack.push(id);
      for (const d of (known.get(id)?.deps || [])) {
        if (!known.has(d)) continue;
        if (color.get(d) === 1) { cycle = [...stack.slice(stack.indexOf(d)), d]; return; }
        if (!color.has(d)) visit(d);
      }
      color.set(id, 2); stack.pop();
    };
    for (const n of prog.nodes) { if (!color.has(n.id)) visit(n.id); if (cycle) break; }
    if (cycle) E.push({ f: prog.rel, m: tr(LANG, `ciclo de dependências detectado: ${cycle.join(' → ')} (R.14: DAG obrigatório)`, `dependency cycle detected: ${cycle.join(' → ')} (R.14: a DAG is required)`) });
    // coerência status × DAG
    for (const n of prog.nodes) {
      const st = statusOf(n.id);
      for (const d of n.deps) {
        const ds = statusOf(d);
        if (st === 'done' && ds && ds !== 'done') W.push({ f: prog.rel, m: tr(LANG, `incoerência status×DAG: ${n.id} (done) depende de ${d} (${ds})`, `status×DAG mismatch: ${n.id} (done) depends on ${d} (${ds})`) });
        if (st === 'active' && ds === 'discarded') W.push({ f: prog.rel, m: tr(LANG, `incoerência status×DAG: ${n.id} (active) depende de ${d} (discarded)`, `status×DAG mismatch: ${n.id} (active) depends on ${d} (discarded)`) });
      }
    }
  }
}
const PIPELINE_ART_RE = /^docs\/(active|future|archive|discard)\/(SPEC-[^/]+)\/((?:\d+_task(?:_review)?|tasks|prd|techspec|bugs|qa-report|review-report|bugfix-report)\.md)$/;

function auditPr(root, base, E, W) {
  if (!base) die(tr(LANG, 'audit --pr exige --base <sha> (base do PR) — sem base resolvível o gate falha FECHADO', 'audit --pr requires --base <sha> (PR base) — without a resolvable base the gate fails CLOSED'));
  git(['rev-parse', '--verify', `${base}^{commit}`], root);
  const diff = git(['diff', '--name-status', '-M', `${base}...HEAD`], root);
  const removedActive = new Set();
  const touched = new Set();
  const added = new Set();
  const specIdFrom = (p) => {
    const m = /^docs\/active\/(SPEC-[^/]+)\//.exec(p);
    return m ? m[1] : null;
  };
  for (const line of diff.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const st = parts[0];
    if (st.startsWith('R')) {
      const [, oldP, newP] = parts;
      touched.add(newP); added.add(newP);
      const sid = specIdFrom(oldP);
      if (sid && !newP.startsWith(`docs/active/${sid}/`)) removedActive.add(sid);
    } else {
      const p = parts[1];
      touched.add(p);
      if (st === 'A') added.add(p);
      if (st === 'D') { const sid = specIdFrom(p); if (sid) removedActive.add(sid); }
    }
  }
  const specs = listSpecs(root);
  for (const id of removedActive) {
    const loc = specs.find((s) => s.id === id);
    if (loc && loc.phase === 'active') continue; // reorganização interna, segue ativa
    if (!loc) { E.push({ f: `docs/active/${id}`, m: tr(LANG, 'SPEC saiu de docs/active/ e NÃO existe mais no repositório — R.5: nunca deletar; destinos válidos: archive/ (done), discard/ (com justificativa) ou future/ (pausada)', 'SPEC left docs/active/ and NO longer exists in the repository — R.5: never delete; valid destinations: archive/ (done), discard/ (with rationale) or future/ (paused)') }); continue; }
    const pm = parseMain(readSafe(P(loc.dir, 'main.md')));
    const relMain = `docs/${loc.phase}/${id}/main.md`;
    if (loc.phase === 'archive') {
      if (!exists(P(loc.dir, 'digest.md'))) E.push({ f: relMain, m: tr(LANG, 'archive sem digest.md — bloqueado (fechamento §3.4)', 'archive without digest.md — blocked (close §3.4)') });
      const crit = getCriteria(pm) || [];
      for (const c of crit) {
        if (!c.checked && !ACEITO_RE.test(c.raw)) E.push({ f: relMain, m: tr(LANG, `archive com critério aberto sem [aceito-incompleto: ...]: "${truncate(c.text, 60)}" (R.6.2)`, `archive with an open criterion without [accepted-incomplete: ...]: "${truncate(c.text, 60)}" (R.6.2)`) });
        if (c.checked && !((hasTs(c.raw) && hasCommitEv(c.raw)) || hasVerifyTag(c.raw) || hasEvidenceTag(c.raw))) E.push({ f: relMain, m: tr(LANG, `archive com critério [x] sem evidência: "${truncate(c.text, 60)}" (R.6.2)`, `archive with a criterion [x] without evidence: "${truncate(c.text, 60)}" (R.6.2)`) });
      }
      for (const ft of splitList(pm.fields.Features || '')) {
        const r = featureConcludedOk(root, ft, id);
        if (!r.ok) E.push({ f: relMain, m: r.why + tr(LANG, ' — R.7 valida por CONTEÚDO no diff do PR', ' — R.7 validates by CONTENT in the PR diff') });
      }
    } else if (loc.phase === 'discard') {
      if (!hasSection(pm.raw, 'Justificativa de descarte')) E.push({ f: relMain, m: tr(LANG, 'discard sem seção "## Justificativa de descarte" — bloqueado (R.5)', 'discard without a "## Discard rationale" section — blocked (R.5)') });
      if (!exists(P(loc.dir, 'digest.md'))) E.push({ f: relMain, m: tr(LANG, 'discard sem digest.md — bloqueado (lições preservadas, R.5)', 'discard without digest.md — blocked (lessons preserved, R.5)') });
    } else if (loc.phase === 'future') {
      if ((pm.fields['Pausada em'] || '—').trim() === '—') E.push({ f: relMain, m: tr(LANG, 'SPEC voltou a future/ sem **Pausada em:** preenchido — pausa legítima registra motivo (R.5)', 'SPEC went back to future/ without **Paused at:** filled in — a legitimate pause records a reason (R.5)') });
    }
  }
  for (const p of added) {
    const m = PIPELINE_ART_RE.exec(p);
    if (!m) continue;
    const sid = m[2];
    const journalTouched = [...touched].some((t) => t.endsWith('/journal.md') && t.includes(`/${sid}/`));
    if (!journalTouched) W.push({ f: p, m: tr(LANG, `artefato de pipeline sem contrapartida no journal da ${sid} (R.6.1) — registre [nota]/[decisão]/[descoberta] no LOG`, `pipeline artifact with no counterpart in the journal of ${sid} (R.6.1) — record a [note]/[decision]/[discovery] in the LOG`) });
  }
  // arquivo no commit base (ausência = condição esperada de PR, não erro): retorna null sem AVISO
  const showAtBase = (relPath) => { const r = gitRun(['show', `${base}:${relPath}`], root); return r.ok ? r.out : null; };
  // (4c-i) campo Porte mudou base..HEAD sem entrada de journal (escalate/deescalate/porte) = ERRO (D2)
  for (const s of specs.filter((x) => x.phase === 'active')) {
    const relMain = `docs/active/${s.id}/main.md`;
    const baseMain = showAtBase(relMain);
    if (baseMain == null) continue; // main.md não existia no base (SPEC nova/movida) — nada a diffar
    const basePorte = (parseMain(baseMain).fields.Porte || '').toUpperCase();
    const headPorte = (parseMain(readSafe(P(s.dir, 'main.md'))).fields.Porte || '').toUpperCase();
    if (basePorte && headPorte && basePorte !== headPorte) {
      const jTxt = norm(readSafe(P(s.dir, 'journal.md')));
      const logPart = jTxt.includes('## LOG') ? jTxt.slice(jTxt.indexOf('## LOG')) : jTxt;
      if (!/escalat|deescalat|porte|\bsize\b/i.test(logPart)) {
        E.push({ f: relMain, m: tr(LANG, `campo Porte mudou (${basePorte} → ${headPorte}) sem entrada de journal (escalate/deescalate) — use node scripts/specctl.mjs escalate|deescalate (D2), nunca edite **Porte:** à mão`, `Size field changed (${porteOut(canonPorte(basePorte))} → ${porteOut(canonPorte(headPorte))}) without a journal entry (escalate/deescalate) — use node scripts/specctl.mjs escalate|deescalate (D2), never edit **Size:** by hand`) });
      }
    }
  }
  // (features/<area>.md não têm ratchet de tamanho: crescer memória viva de uma área nunca bloqueia PR — rollup é manual/opcional.)
  // (4c-iii) R.17: commit do range que toca CÓDIGO sob SPEC ativa sem trailer `Spec: SPEC-<id>` = WARN
  // (warn, não erro: histórico não se reescreve barato — o aviso educa os próximos commits)
  if (specs.some((x) => x.phase === 'active')) {
    const lg = gitRun(['log', '--format=%h%x00%(trailers:key=Spec,valueonly,separator=%x2C)%x00%s', `${base}..HEAD`], root);
    if (lg.ok) {
      const missing = [];
      for (const row of lg.out.split('\n').filter(Boolean)) {
        const [h, trailers, subj] = row.split('\0');
        if (trailers && trailers.trim()) continue;
        const files = gitRun(['show', '--name-only', '--format=', h], root);
        if (!files.ok) continue;
        const touchesCode = files.out.split('\n').some((p) => p && !p.startsWith('docs/') && !p.startsWith('.scratch/') && !p.startsWith('.claude/') && !p.startsWith('.github/') && p !== 'scripts/specctl.mjs' && p !== 'CLAUDE.md' && p !== 'AGENTS.md');
        if (touchesCode) missing.push(`${h} "${truncate(subj || '', 50)}"`);
      }
      if (missing.length) W.push({ f: tr(LANG, '(commits do PR)', '(PR commits)'), m: tr(LANG, `R.17: ${missing.length} commit(s) tocando código sob SPEC ativa SEM trailer 'Spec: SPEC-<id>': ${missing.slice(0, 3).join(' · ')}${missing.length > 3 ? ` (+${missing.length - 3})` : ''} — inclua o trailer nos próximos commits`, `R.17: ${missing.length} commit(s) touching code under an active SPEC WITHOUT the 'Spec: SPEC-<id>' trailer: ${missing.slice(0, 3).join(' · ')}${missing.length > 3 ? ` (+${missing.length - 3})` : ''} — add the trailer to the next commits`) });
    }
  }
}
function auditBase(root, E, W) {
  const specs = listSpecs(root);
  const ids = new Set(specs.map((s) => s.id));
  const prefixes = new Set(specs.map((s) => idPrefix(s.id)));
  // SPEC fantasma (fora de code fences)
  const seenGhost = new Set();
  for (const fp of walkFiles(P(root, 'docs'), { exts: ['.md'] })) {
    const txt = stripFences(readSafe(fp));
    for (const m of txt.matchAll(SPEC_REF_RE)) {
      const ref = m[0];
      if (ids.has(ref) || prefixes.has(ref)) continue;
      if ([...ids].some((i) => i.startsWith(ref))) continue;
      const key = `${relOf(root, fp)}|${ref}`;
      if (seenGhost.has(key)) continue;
      seenGhost.add(key);
      W.push({ f: relOf(root, fp), m: tr(LANG, `referência a SPEC fantasma: ${ref} (não existe em nenhuma fase)`, `reference to a ghost SPEC: ${ref} (does not exist in any phase)`) });
    }
  }
  // staleness por CONTEÚDO (nunca mtime)
  const DAY = 24 * 3600 * 1000;
  for (const s of specs.filter((x) => x.phase === 'active')) {
    const jp = P(s.dir, 'journal.md');
    if (!exists(jp)) continue;
    const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(fieldValue(readSafe(jp), 'Última atualização'));
    if (!m) { W.push({ f: `docs/active/${s.id}/journal.md`, m: tr(LANG, 'SNAPSHOT sem **Última atualização:** — staleness indeterminável', 'SNAPSHOT without **Last updated:** — staleness cannot be determined') }); continue; }
    const t = parseTs(m[1]);
    if (t && Date.now() - t.getTime() > 30 * DAY) W.push({ f: `docs/active/${s.id}/journal.md`, m: tr(LANG, `SPEC ativa parada há >30 dias (Última atualização: ${m[1]}) — pause com motivo ou retome`, `active SPEC idle for >30 days (Last updated: ${m[1]}) — pause with a reason or resume`) });
  }
  // anti-fuga + integridade de evidência (D1/A4) — SEMPRE warn (stage1), nunca strict-fail
  for (const s of specs.filter((x) => x.phase === 'active')) {
    const pm = parseMain(readSafe(P(s.dir, 'main.md')));
    const crit = getCriteria(pm) || [];
    const porte = (pm.fields.Porte || 'M').toUpperCase();
    // (a) porte P com >3 critérios: sinais de porte M
    if (porte === 'P' && crit.length > 3) {
      W.push({ f: `docs/active/${s.id}/main.md`, m: tr(LANG, `porte P com ${crit.length} critérios — sinais de porte M; considere: node scripts/specctl.mjs escalate ${s.id} M`, `size S with ${crit.length} criteria — signs of size M; consider: node scripts/specctl.mjs escalate ${s.id} M`), stage1: true });
    }
    // (b) critério com "verify: exit 0" sem entrada de LOG contendo "verify:" no journal: evidência sem rastro
    if (crit.some((c) => /verify:\s*exit 0/.test(c.raw))) {
      const jTxt = norm(readSafe(P(s.dir, 'journal.md')));
      const logPart = jTxt.includes('## LOG') ? jTxt.slice(jTxt.indexOf('## LOG')) : jTxt;
      if (!/verify:/.test(logPart)) {
        W.push({ f: `docs/active/${s.id}/main.md`, m: tr(LANG, `critério com "verify: exit 0" sem entrada de LOG contendo "verify:" no journal — evidência sem rastro (R.6.1); re-verifique com node scripts/specctl.mjs verify ${s.id} --all`, `criterion with "verify: exit 0" but no journal LOG entry containing "verify:" — untraceable evidence (R.6.1); re-verify with node scripts/specctl.mjs verify ${s.id} --all`), stage1: true });
      }
    }
  }
  // claims ↔ active
  const activeIds = new Set(specs.filter((s) => s.phase === 'active').map((s) => s.id));
  const claimsDir = P(root, 'docs', 'claims');
  if (isDir(claimsDir)) {
    for (const fp of walkFiles(claimsDir, { exts: ['.md'] })) {
      const cid = path.basename(fp, '.md');
      if (activeIds.has(cid)) continue;
      const elsewhere = specs.find((s) => s.id === cid);
      if (elsewhere) W.push({ f: relOf(root, fp), m: tr(LANG, `claim órfão: ${cid} está em ${elsewhere.phase}/ — remova o claim (transições via specctl fazem isso)`, `orphan claim: ${cid} is in ${elsewhere.phase}/ — remove the claim (specctl transitions do this)`) });
      // sem SPEC local: pode estar ativa em outra branch — é o design, não avisa
    }
    for (const id of activeIds) {
      if (!exists(claimPath(root, id))) W.push({ f: `docs/active/${id}`, m: tr(LANG, 'ativação sem claim (R.11) — recrie: docs/claims/' + id + '.md (specctl activate faz isso)', 'activation without a claim (R.11) — recreate: docs/claims/' + id + '.md (specctl activate does this)') });
    }
    // team: multi — claim existe local mas NÃO na base = invisível aos outros devs (a publicação atrasou)
    if (manifest(root).team === 'multi') {
      for (const id of activeIds) {
        const cp = claimPath(root, id);
        if (!exists(cp)) continue;
        const cTxt = read(cp);
        const base = ((/^\*\*Base:\*\*\s*(.+)$/m.exec(cTxt) || [])[1] || '').trim() || detectBaseBranch(root, currentBranch(root));
        if (!base || base === '—') continue;
        const rel = relOf(root, cp);
        const inBase = gitRun(['cat-file', '-e', `${base}:${rel.split(path.sep).join('/')}`], root);
        const inRemoteBase = inBase.ok ? inBase : gitRun(['cat-file', '-e', `origin/${base}:${rel.split(path.sep).join('/')}`], root);
        if (!inBase.ok && !inRemoteBase.ok) {
          W.push({ f: rel, m: tr(LANG, `team=multi: claim de ${id} ainda NÃO publicado em '${base}' — os outros devs não veem o trabalho em voo (R.11). PR trivial: só docs/claims/ (specctl activate imprime os comandos)`, `team=multi: claim for ${id} NOT yet published to '${base}' — other devs cannot see the in-flight work (R.11). Trivial PR: only docs/claims/ (specctl activate prints the commands)`) });
        }
      }
    }
  }
  // decisões >180d ainda ativas
  for (const f of featureFiles(root)) {
    for (const line of norm(readSafe(f.path)).split('\n')) {
      const m = /(DEC-(\d{4})(\d{2})(\d{2})-\d{4}[\w-]*)/.exec(line);
      if (!m || /obsolet|substitu|supersed/i.test(line)) continue;
      const t = new Date(+m[2], +m[3] - 1, +m[4]);
      if (Date.now() - t.getTime() > 180 * DAY) W.push({ f: relOf(root, f.path), m: tr(LANG, `decisão ativa há >180 dias: ${m[1]} — revalide ou marque obsoleta`, `decision active for >180 days: ${m[1]} — revalidate or mark it obsolete`) });
    }
  }
}
function cmdAudit(flags) {
  const root = requireRoot();
  const E = [], W = [];
  auditBase(root, E, W);
  if (flags.deps) auditDeps(root, E, W);
  if (flags['main-gate']) {
    const act = activeSpecs(root);
    if (act.length) E.push({ f: 'docs/active/', m: tr(LANG, `R.2 (gate de main): docs/active/ deve estar vazio — encontrado: ${act.map((s) => s.id).join(', ')}`, `R.2 (main gate): docs/active/ must be empty — found: ${act.map((s) => s.id).join(', ')}`) });
  }
  if (flags.pr) auditPr(root, flags.base, E, W);
  for (const e of E) process.stderr.write(tr(LANG, `ERRO  ${e.f}: ${e.m}\n`, `ERROR   ${e.f}: ${e.m}\n`));
  if (W.length) {
    process.stdout.write(tr(LANG, 'AVISOS (não bloqueiam archive/close/CI):\n', 'WARNINGS (do not block archive/close/CI):\n'));
    for (const w of W) process.stdout.write(tr(LANG, `AVISO ${w.f}: ${w.m}\n`, `WARNING ${w.f}: ${w.m}\n`));
  }
  process.stdout.write(tr(LANG, `\naudit: ${E.length} erro(s), ${W.length} aviso(s)\n`, `\naudit: ${E.length} error(s), ${W.length} warning(s)\n`));
  process.exit(E.length ? 1 : 0);
}

// ---------------------------------------------------------------- brief / capsule / stamp

const HARD_BANS_EN = [
  '1. R.6.2 — binary contract: only the USER accepts an incomplete criterion (marker [accepted-incomplete: "literal quote" YYYY-MM-DD HH:MM]). NEVER reduce scope silently.',
  '2. The journal LOG is append-only — NEVER edit/rewrite old entries; add a new dated entry.',
  '3. docs/active/ empty on main — every active SPEC lives on a feature branch.',
  '4. Artifacts/temp files go in the SPEC folder — tmp/ (disposable) or evidence/ (persistent); with no active SPEC: .scratch/.',
  '5. FORBIDDEN to sweep scripts/specctl.mjs or re-read docs/rules/* just to "ensure compliance" — the gates say what is missing (close <id> --dry). Reading the rule FOR THE TASK at the moment of use (transition→lifecycle, artifact→formats) is the RIGHT path and does not violate this ban.',
];
const hardBans = () => (LANG === 'en' ? HARD_BANS_EN : HARD_BANS);
const HARD_BANS = [
  '1. R.6.2 — contrato binário: só o USUÁRIO aceita critério incompleto (marcador [aceito-incompleto: "citação literal" YYYY-MM-DD HH:MM]). NUNCA reduza escopo em silêncio.',
  '2. LOG do journal é append-only — NUNCA edite/reescreva entradas antigas; adicione nova entrada datada.',
  '3. docs/active/ vazio em main — toda SPEC ativa vive em branch de feature.',
  '4. Artefatos/temporários na pasta da SPEC — tmp/ (descartável) ou evidence/ (persistente); sem SPEC ativa: .scratch/.',
  '5. PROIBIDO varrer scripts/specctl.mjs ou re-ler docs/rules/* só para "garantir compliance" — os gates dizem o que falta (close <id> --dry). Ler a rule DA TAREFA no momento do uso (transição→lifecycle, artefato→formats) é o caminho CERTO, não viola este ban.',
];
function specSummary(root, s) {
  const pm = parseMain(readSafe(P(s.dir, 'main.md')));
  const crit = getCriteria(pm) || [];
  const done = crit.filter((c) => c.checked).length;
  return { pm, feats: splitList(pm.fields.Features || ''), done, total: crit.length };
}
// seção compacta "Próximo trabalho" do brief (§Integração no brief)
// activeNonEmpty=true → 1 linha-resumo (economia); senão as 3 linhas condicionais
function briefNextLines(root, disc, activeNonEmpty) {
  const openPrograms = disc.programs.filter((p) => p.state.open);
  const roadmapCount = (disc.roadmap.next ? 1 : 0) + disc.roadmap.later.length;
  if (activeNonEmpty) {
    return [tr(LANG, `Backlog: ${openPrograms.length} programa(s) aberto(s), ${roadmapCount} no roadmap — \`specctl next\``, `Backlog: ${openPrograms.length} open program(s), ${roadmapCount} in the roadmap — \`specctl next\``)];
  }
  const L = [tr(LANG, 'Próximo trabalho:', 'Next work:')];
  const hadContent = L.length;
  // Programas: 1 SPEC destacada por programa (▶ pronto, senão ⏳ ativo) + contagem de bloqueados
  if (openPrograms.length) {
    const parts = openPrograms.map(({ prog, state }) => {
      const highlight = state.ready[0] || state.active[0];
      const mark = state.ready[0] ? '▶' : (state.active[0] ? '⏳' : '');
      let seg = `${prog.slug} (${state.done.length}/${state.total})`;
      if (highlight) seg += ` ${mark} ${highlight}`;
      if (state.blocked.length) seg += ` · 🔒${state.blocked.length}`;
      if (state.paused.length) seg += ` · ⏸${state.paused.length}`;
      return seg;
    });
    L.push(`- ${tr(LANG, 'Programas', 'Programs')}: ${parts.join(' | ')}`);
  }
  // Roadmap: topo + "(+N)"
  if (disc.roadmap.next) {
    const extra = disc.roadmap.later.length ? ` (+${disc.roadmap.later.length})` : '';
    L.push(`- Roadmap ▶ ${disc.roadmap.next}${extra}`);
  }
  // Não-priorizadas: só a contagem
  if (disc.orphans.length) {
    L.push(tr(LANG, `- Não-priorizadas: ${disc.orphans.length} (rode \`specctl next\` ou priorize em docs/ROADMAP.md)`, `- Unprioritized: ${disc.orphans.length} (run \`specctl next\` or prioritize in docs/ROADMAP.md)`));
  }
  return L.length > hadContent ? L : [];
}
function cmdBrief(flags) {
  const root = setLang(findRoot(process.cwd()));
  if (!root) { out(tr(LANG, '[SDD v4] projeto sem docs/.spec-system.json — rode a skill spec-system-init.', '[SDD v4] project without docs/.spec-system.json — run the spec-system-init skill.')); process.exit(0); }
  const man = manifest(root);
  const branch = currentBranch(root);
  const act = activeSpecs(root);
  const snapOf = (s) => {
    const jp = P(s.dir, 'journal.md');
    if (!exists(jp)) return tr(LANG, '(journal.md ausente)', '(journal.md missing)');
    return norm(read(jp)).split('\n').slice(0, 60).join('\n');
  };
  // C4 — brief --agent <id>: bundle 1-call (compacto + main.md + SNAPSHOT + próximos passos, sem duplicar)
  if (flags.agent) {
    const spec = findSpec(root, String(flags.agent));
    const B = [];
    B.push(tr(LANG, `[bundle ${spec.id} — 1-call p/ subagente · branch ${branch || '(git indisponível)'} · NOW=${now()}]`, `[bundle ${spec.id} — 1-call for subagent · branch ${branch || '(git unavailable)'} · NOW=${now()}]`));
    B.push('');
    B.push('HARD BANS (TIER-0):');
    for (const b of hardBans()) B.push(b);
    B.push('');
    B.push('== main.md ==');
    B.push(norm(readSafe(P(spec.dir, 'main.md'))).replace(/\n+$/, ''));
    B.push('');
    B.push(`== SNAPSHOT (${spec.id}) ==`);
    B.push(snapOf(spec));
    B.push(tr(LANG, '== fim do SNAPSHOT ==', '== end of SNAPSHOT =='));
    B.push('');
    B.push(tr(LANG, 'Próximos passos:', 'Next steps:'));
    try { B.push(checklistText(spec, closeStage(root, spec), true)); }
    catch { B.push(tr(LANG, `fechar: node scripts/specctl.mjs close ${spec.id} --dry`, `close: node scripts/specctl.mjs close ${spec.id} --dry`)); }
    out(B.join('\n'));
    process.exit(0);
  }
  const L = [];
  if (flags.compact) {
    L.push('HARD BANS (TIER-0):');
    for (const b of hardBans()) L.push(b);
    L.push('');
    L.push(tr(LANG, `Branch: ${branch || '(git indisponível)'} · SPECs ativas: ${act.length ? act.map((s) => s.id).join(', ') : 'nenhuma'}`, `Branch: ${branch || '(git unavailable)'} · active SPECs: ${act.length ? act.map((s) => s.id).join(', ') : 'none'}`));
    if (act.length) { L.push(''); L.push(`== SNAPSHOT (${act[0].id}) ==`); L.push(snapOf(act[0])); }
    L.push('');
    L.push(tr(LANG, '(pré-compact: faça o flush — sobrescreva o SNAPSHOT e registre no LOG o que não pode se perder)', '(pre-compact: flush now — overwrite the SNAPSHOT and record in the LOG what must not be lost)'));
    L.push('');
    L.push(`[SDD v4 · ${man.schema || SCHEMA} · NOW=${now()}]`);
    out(L.join('\n'));
    process.exit(0);
  }
  // ---- blocos ESTÁVEIS primeiro (E3+E5/C2): bans → referências → INDEX filtrado
  const activeIds = new Set(act.map((s) => s.id));
  const myFeats = new Set(act.flatMap((s) => specSummary(root, s).feats));
  L.push('HARD BANS (TIER-0):');
  for (const b of hardBans()) L.push(b);
  L.push('');
  L.push(tr(LANG, 'Referências: criar/editar artefato → docs/rules/formats.md · transição de ciclo → docs/rules/lifecycle.md · programa/DAG → docs/rules/programs.md · interop/workspace → docs/rules/interop.md', 'References: create/edit artifact → docs/rules/formats.md · lifecycle transition → docs/rules/lifecycle.md · program/DAG → docs/rules/programs.md · interop/workspace → docs/rules/interop.md'));
  // INDEX filtrado pelas Features da SPEC ativa (+ "outras: ver docs/INDEX.md")
  const idxAll = norm(readSafe(P(root, 'docs', 'INDEX.md'))).split('\n').filter((l) => l.startsWith('- '));
  L.push('');
  if (!idxAll.length) {
    L.push(tr(LANG, 'INDEX (resumo):', 'INDEX (summary):'));
    L.push(tr(LANG, '(vazio — rode: node scripts/specctl.mjs index)', '(empty — run: node scripts/specctl.mjs index)'));
  } else if (myFeats.size) {
    const mine = idxAll.filter((l) => { const m = /^-\s+\*\*([^*]+)\*\*/.exec(l); return m && myFeats.has(m[1].trim()); });
    L.push(tr(LANG, 'INDEX (features desta SPEC):', 'INDEX (features of this SPEC):'));
    L.push(...(mine.length ? mine : [tr(LANG, '(nenhuma feature da SPEC no INDEX ainda)', '(no feature of the SPEC in the INDEX yet)')]));
    L.push(tr(LANG, 'outras: ver docs/INDEX.md', 'others: see docs/INDEX.md'));
  } else {
    L.push(tr(LANG, 'INDEX (resumo):', 'INDEX (summary):'));
    L.push(...idxAll.slice(0, 10));
    L.push(tr(LANG, 'outras: ver docs/INDEX.md', 'others: see docs/INDEX.md'));
  }
  // ---- blocos VOLÁTEIS no fim: branch, SPECs ativas, SNAPSHOT, claims, próximo trabalho
  L.push('');
  L.push(`Branch: ${branch || tr(LANG, '(git indisponível)', '(git unavailable)')}`);
  if (!act.length) L.push(tr(LANG, 'SPECs ativas: nenhuma (docs/active/ vazio)', 'Active SPECs: none (docs/active/ empty)'));
  else {
    for (const s of act) {
      const info = specSummary(root, s);
      L.push(tr(LANG, `SPEC ativa: ${s.id} (${info.feats.join(', ') || 'sem features'}) — critérios ${info.done}/${info.total} [x]`, `Active SPEC: ${s.id} (${info.feats.join(', ') || 'no features'}) — criteria ${info.done}/${info.total} [x]`));
    }
    if (act.length > 1) L.push(tr(LANG, 'ATENÇÃO: múltiplas SPECs em docs/active/ — indique QUAL no prompt (R.9 exige escolha).', 'WARNING: multiple SPECs in docs/active/ — say WHICH one in the prompt (R.9 requires a choice).'));
    L.push('');
    L.push(`== SNAPSHOT (${act[0].id}) ==`);
    L.push(snapOf(act[0]));
    L.push(tr(LANG, '== fim do SNAPSHOT ==', '== end of SNAPSHOT =='));
  }
  // claims em colisão
  const collisions = [];
  const claimsDir = P(root, 'docs', 'claims');
  if (isDir(claimsDir)) {
    for (const fp of walkFiles(claimsDir, { exts: ['.md'] })) {
      const cid = path.basename(fp, '.md');
      if (activeIds.has(cid)) continue;
      const txt = readSafe(fp);
      const cf = splitList((/^\*\*Features:\*\*\s*(.*)$/m.exec(txt) || [])[1] || '');
      const owner = (/^\*\*Owner:\*\*\s*(.*)$/m.exec(txt) || [])[1] || '?';
      if (cf.some((x) => myFeats.has(x))) collisions.push(`- ${cid} (${owner}) — features: ${cf.join(', ')}`);
    }
  }
  L.push('');
  L.push(collisions.length ? tr(LANG, 'Claims em COLISÃO (mesma feature em voo em outra branch):', 'COLLIDING claims (same feature in flight on another branch):') : tr(LANG, 'Claims em colisão: nenhuma', 'Colliding claims: none'));
  for (const c of collisions) L.push(c);
  // itens deferidos com autorização (R.6.2) — visibilidade sem abrir archive
  const defTxt = readSafe(P(root, 'docs', 'DEFERRED.md'));
  const defCount = defTxt ? (defTxt.match(/^- SPEC-/gm) || []).length : 0;
  if (defCount) L.push(tr(LANG, `Deferidos (R.6.2, com citação): ${defCount} item(ns) — ver docs/DEFERRED.md`, `Deferred (R.6.2, with quote): ${defCount} item(s) — see docs/DEFERRED.md`));
  // Próximo trabalho (formato compacto) — só quando há future/ ou programa aberto
  const disc = discoveryModel(root);
  if (disc.hasFuture || disc.anyOpenProgram) {
    const nextLines = briefNextLines(root, disc, act.length > 0);
    if (nextLines.length) { L.push(''); L.push(...nextLines); }
  }
  L.push(tr(LANG, 'R.9: classifique a 1ª linha da sua resposta: [continuidade: SPEC-x] | [nova] | [livre]', 'R.9: classify the 1st line of your answer: [continuation: SPEC-x] | [new] | [free]'));
  // NOW no FIM (bloco volátil por último)
  L.push('');
  L.push(`[SDD v4 · ${man.schema || SCHEMA} · NOW=${now()} · Branch: ${branch || '—'}]`);
  out(L.join('\n'));
  process.exit(0);
}
// modelo de descoberta compartilhado por `next` e `brief`
// { programs:[{prog,state}], roadmap:{next,later}, orphans:[SPEC-id], hasFuture, anyOpenProgram }
function discoveryModel(root) {
  const specs = listSpecs(root);
  const statusOf = makeStatusOf(specs);
  const progs = parsePrograms(root);
  const programs = progs
    .map((prog) => ({ prog, state: computeProgramState(prog, statusOf) }))
    .sort((a, b) => {
      if (a.state.open !== b.state.open) return a.state.open ? -1 : 1;
      return a.prog.slug < b.prog.slug ? -1 : 1;
    });
  const future = futureDraftSpecs(root); // [{ id, dir }] draft em future/
  const futureDraftIds = new Set(future.map((f) => f.id));
  // programa de cada SPEC vem do **Programa:** do main.md
  const programOf = new Map();
  for (const f of future) {
    const prog = (parseMain(readSafe(P(f.dir, 'main.md'))).fields.Programa || '—').trim();
    programOf.set(f.id, prog && prog !== '—' ? prog : null);
  }
  // ROADMAP: percorre a ordem; "próximo" = 1ª entrada em future draft; "depois" = as seguintes ainda-future draft
  const roadmapIds = parseRoadmap(root);
  const roadmapFuture = roadmapIds.filter((id) => futureDraftIds.has(id));
  const roadmap = { next: roadmapFuture[0] || null, later: roadmapFuture.slice(1) };
  const inRoadmap = new Set(roadmapIds);
  // órfã = future draft, SEM **Programa:**, E não citada no ROADMAP (nunca auto-ordenada — só listada)
  const orphans = future
    .filter((f) => !programOf.get(f.id) && !inRoadmap.has(f.id))
    .map((f) => f.id)
    .sort((a, b) => (a < b ? -1 : 1));
  const anyOpenProgram = programs.some((p) => p.state.open);
  return { programs, roadmap, orphans, hasFuture: future.length > 0, anyOpenProgram };
}

function cmdNext(root, flags) {
  root = root || requireRoot();
  const model = discoveryModel(root);
  let programs = model.programs;
  if (flags.program) {
    const slug = String(flags.program).trim();
    if (!programs.some((p) => p.prog.slug === slug)) {
      die(tr(LANG, `programa '${slug}' não existe em docs/programs/ — programas: ${programs.map((p) => p.prog.slug).join(', ') || '(nenhum)'}`, `program '${slug}' does not exist in docs/programs/ — programs: ${programs.map((p) => p.prog.slug).join(', ') || '(none)'}`));
    }
    programs = programs.filter((p) => p.prog.slug === slug);
  }
  const L = [];
  const T = (pt, en) => tr(LANG, pt, en);
  L.push(T('=== Próximo trabalho ===', '=== Next work ==='));
  // seção PROGRAMAS (ordem = dependências)
  const progLines = [];
  for (const { prog, state } of programs) {
    for (const id of state.ready) progLines.push(T(`  ▶ pronto:   ${id} (programa ${prog.slug})`, `  ▶ ready:    ${id} (program ${prog.slug})`));
    for (const id of state.active) {
      const owner = claimOwner(root, id);
      progLines.push(T(`  ⏳ ativo:    ${id} (programa ${prog.slug})`, `  ⏳ active:   ${id} (program ${prog.slug})`) + (owner ? ` [${owner}]` : ''));
    }
    for (const b of state.blocked) progLines.push(T(`  🔒 bloqueado: ${b.id} (programa ${prog.slug} — aguarda ${b.waits.join(', ')})`, `  🔒 blocked:  ${b.id} (program ${prog.slug} — waits on ${b.waits.join(', ')})`));
    for (const id of state.paused) progLines.push(T(`  ⏸ pausado:  ${id} (programa ${prog.slug} — retomar: specctl resume ${id})`, `  ⏸ paused:   ${id} (program ${prog.slug} — resume: specctl resume ${id})`));
  }
  if (progLines.length) {
    L.push('');
    L.push(T('PROGRAMAS (ordem = dependências):', 'PROGRAMS (order = dependencies):'));
    L.push(...progLines);
  }
  // seção ROADMAP (ordem = docs/ROADMAP.md) — só quando não filtrando por programa
  if (!flags.program && (model.roadmap.next || model.roadmap.later.length)) {
    L.push('');
    L.push(T('ROADMAP (ordem = docs/ROADMAP.md):', 'ROADMAP (order = docs/ROADMAP.md):'));
    if (model.roadmap.next) L.push(T(`  ▶ próximo:  ${model.roadmap.next}`, `  ▶ next:     ${model.roadmap.next}`));
    if (model.roadmap.later.length) L.push(T(`  · depois:   ${model.roadmap.later.join(', ')}`, `  · later:    ${model.roadmap.later.join(', ')}`));
  }
  // seção BACKLOG NÃO-PRIORIZADO (órfãs) — só quando não filtrando por programa
  if (!flags.program && model.orphans.length) {
    L.push('');
    L.push(T('BACKLOG NÃO-PRIORIZADO (future sem programa e fora do ROADMAP — defina ordem em docs/ROADMAP.md):', 'UNPRIORITIZED BACKLOG (future without a program and not in the ROADMAP — set the order in docs/ROADMAP.md):'));
    L.push(`  ${model.orphans.join(', ')}`);
  }
  // tudo vazio
  const hasContent = progLines.length || (!flags.program && (model.roadmap.next || model.roadmap.later.length || model.orphans.length));
  if (!hasContent) {
    if (flags.program) L.push(T('\nNada pendente neste programa: todos os nós estão concluídos ou pausados.', '\nNothing pending in this program: all nodes are done or paused.'));
    else L.push(T('\nNada pendente: docs/future/ vazio e nenhum programa aberto.', '\nNothing pending: docs/future/ is empty and no program is open.'));
  }
  out(L.join('\n'));
  process.exit(0);
}
// owner do claim de um SPEC ativo (docs/claims/<id>.md), se houver — senão null
function claimOwner(root, id) {
  const fp = claimPath(root, id);
  if (!exists(fp)) return null;
  const owner = (/^\*\*Owner:\*\*\s*(.*)$/m.exec(readSafe(fp)) || [])[1] || '';
  return owner.trim() || null;
}

function cmdCapsule() {
  const root = setLang(findRoot(process.cwd()));
  if (!root) process.exit(0);
  const man = manifest(root);
  const act = activeSpecs(root);
  let activePart = '—';
  if (act.length === 1) {
    const info = specSummary(root, act[0]);
    activePart = `${act[0].id}${info.feats.length ? ` (${info.feats.join(', ')})` : ''}`;
  } else if (act.length > 1) {
    activePart = tr(LANG, `${act.map((s) => s.id).join(', ')} — MÚLTIPLAS: escolha 1 no prompt`, `${act.map((s) => s.id).join(', ')} — MULTIPLE: pick 1 in the prompt`);
  }
  // interop inline: a cápsula É o mecanismo da substituição de caminho (rules/interop.md) — skills prd
  // escrevem na pasta da SPEC, não em tasks/prd-*/; só injeta com SPEC ativa única (senão ambíguo)
  const inlineNote = man.interop === 'inline' && act.length === 1
    ? tr(LANG, ` · WORKSPACE: docs/active/${act[0].id}/ — substitua ./tasks/prd-<slug>/ por este caminho em TODOS os passos (leitura E escrita)`, ` · WORKSPACE: docs/active/${act[0].id}/ — replace ./tasks/prd-<slug>/ with this path in ALL steps (read AND write)`)
    : '';
  const teamPart = man.team === 'multi' ? ' · team=multi' : '';
  const capTail = tr(LANG, ' · bans: R.6.2/append-only/main-limpa/tmp · classifique na 1ª linha: [continuidade|nova|livre]', ' · bans: R.6.2/append-only/clean-main/tmp · classify on the 1st line: [continuation|new|free]');
  let cap = `NOW=${now()} · ACTIVE=${activePart} · workspace=${man.interop || 'none'}${teamPart}${inlineNote}${capTail}`;
  if (bytesOf(cap) > 800) {
    activePart = act.length ? act[0].id : '—';
    cap = `NOW=${now()} · ACTIVE=${activePart} · workspace=${man.interop || 'none'}${teamPart}${inlineNote}${capTail}`;
  }
  out(cap);
  process.exit(0);
}
function cmdStamp() {
  const root = requireRoot();
  const commit = git(['rev-parse', '--short', 'HEAD'], root);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  out(`NOW=${now()} · commit=${commit} · branch=${branch}`);
}

// ---------------------------------------------------------------- verify

function cmdVerify(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  const mainPath = P(spec.dir, 'main.md');
  const pm = parseMain(read(mainPath));
  const crit = getCriteria(pm);
  if (!crit) die(tr(LANG, `${spec.id}: sem seção "## Critério de aceite"`, `${spec.id}: no "## Acceptance criteria" section`));
  const targets = crit.filter((c) => {
    const v = verifyCmdOf(c.raw);
    if (!v || !v.runnable) return false;
    if (ACEITO_RE.test(c.raw)) return false; // R.6.2: aceito-incompleto pelo usuário NÃO roda (nem com --all) — senão o close abortava num critério já decidido
    return flags.all ? true : !c.checked;
  });
  if (!targets.length) { out(tr(LANG, 'nada a verificar — nenhum critério pendente com `verify:` executável (use --all para reverificar)', 'nothing to verify — no pending criterion with a runnable `verify:` (use --all to re-verify)')); process.exit(0); }
  const short = git(['rev-parse', '--short', 'HEAD'], root); // exige git: evidência registra commit
  const lines = norm(read(mainPath)).split('\n');
  let fails = 0;
  const summary = [];
  for (const c of targets) {
    const cmd = verifyCmdOf(c.raw).cmd;
    process.stdout.write(`verify: ${truncate(c.text, 60)}\n  $ ${cmd}\n`);
    let ok = false, detail = '';
    try { execSync(cmd, { cwd: root, stdio: 'pipe', timeout: 300000 }); ok = true; }
    catch (e) { detail = truncate(String(e.stderr || e.stdout || e.message || ''), 300); }
    if (ok) {
      let line = lines[c.line];
      line = line.replace(/\s*\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}, commit `[^`]*`, verify: exit 0\)/, '');
      const vm = /^(\s*-\s*)\[(?: |x|X)\]\s*(.*?)(\s*\|\s*verify:.*)$/.exec(line);
      if (vm) lines[c.line] = `${vm[1]}[x] ${vm[2]} (${now()}, commit \`${short}\`, verify: exit 0)${vm[3]}`;
      process.stdout.write(tr(LANG, '  PASS — marcado [x] com evidência\n', '  PASS — marked [x] with evidence\n'));
      summary.push(`PASS: ${truncate(c.text, 60)}`);
    } else {
      fails++;
      process.stdout.write(`${tr(LANG, '  FAIL — critério permanece [ ]', '  FAIL — criterion stays [ ]')}\n${detail ? '  ' + detail + '\n' : ''}`);
      summary.push(`FAIL: ${truncate(c.text, 60)}`);
    }
  }
  writeFile(mainPath, lines.join('\n'));
  appendLog(spec.dir, 'nota', (l) => tr(l, `verify: ${targets.length - fails}/${targets.length} critérios passaram (commit \`${short}\`)`, `verify: ${targets.length - fails}/${targets.length} criteria passed (commit \`${short}\`)`), summary.map((s) => `- ${s}`).join('\n'));
  // n/n evidenciados → antecipa a descoberta do fechamento (A1)
  const afterCrit = getCriteria(parseMain(lines.join('\n'))) || [];
  if (!fails && afterCrit.length && afterCrit.every((c) => c.checked || ACEITO_RE.test(c.raw))) {
    out(tr(LANG, `próximo: node scripts/specctl.mjs close ${spec.id} --dry`, `next: node scripts/specctl.mjs close ${spec.id} --dry`));
  }
  process.exit(fails ? 1 : 0);
}

// ---------------------------------------------------------------- scribe e fechamento (v4.1 — Pilares A/B)

// B1+ — rodapé factual de máquina para entradas de LOG (2 chamadas git; falha ⇒ omite silenciosamente)
function gitFooter(root) {
  const head = gitRun(['rev-parse', '--short', 'HEAD'], root);
  if (!head.ok) return '';
  const diff = gitRun(['diff', '--shortstat', 'HEAD'], root);
  if (!diff.ok) return '';
  const stat = diff.out.trim();
  return stat ? `⎿ commit ${head.out}+dirty · ${stat}` : `⎿ commit ${head.out}`;
}
// entrada de texto do scribe: valida UTF-8, remove BOM e normaliza CRLF→LF
function sanitizeBody(buf, label) {
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { die(tr(LANG, `${label}: conteúdo não é UTF-8 válido — reenvie como UTF-8 (sem BOM)`, `${label}: content is not valid UTF-8 — resend as UTF-8 (no BOM)`)); }
  return s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

const LOG_HELP_PT = `uso: node scripts/specctl.mjs log <id> <tipo> "título" [--stdin|--body-file <f>]
tipos: ${LOG_TYPES.join(' | ')}
título: sempre 1 linha. Corpo (opcional, multilinha) por --stdin ou --body-file:
  bash:       node scripts/specctl.mjs log SPEC-x decisão "Título" --stdin <<'EOF'
              corpo da entrada…
              EOF
  PowerShell: @'
              corpo da entrada…
              '@ | node scripts/specctl.mjs log SPEC-x decisão "Título" --stdin
  arquivo:    node scripts/specctl.mjs log SPEC-x decisão "Título" --body-file nota.md`;
const LOG_HELP_EN = `usage: node scripts/specctl.mjs log <id> <type> "title" [--stdin|--body-file <f>]
types: ${LOG_TYPES.map((t) => LOG_TYPE_EN[t]).join(' | ')}
title: always 1 line. Body (optional, multiline) via --stdin or --body-file:
  bash:       node scripts/specctl.mjs log SPEC-x decision "Title" --stdin <<'EOF'
              entry body…
              EOF
  PowerShell: @'
              entry body…
              '@ | node scripts/specctl.mjs log SPEC-x decision "Title" --stdin
  file:       node scripts/specctl.mjs log SPEC-x decision "Title" --body-file note.md`;

function cmdLog(pos, flags) {
  const root = requireRoot();
  if (!pos[0] || !pos[1] || pos[2] === undefined) die(tr(LANG, `log exige <id> <tipo> "título".\n${LOG_HELP_PT}`, `log requires <id> <type> "title".\n${LOG_HELP_EN}`));
  const spec = findSpec(root, pos[0]);
  const tipo = canonLogType(pos[1]); // PT, EN ou PT sem acento → canônico; gravado no idioma do journal
  if (!tipo) die(tr(LANG, `tipo inválido '${pos[1]}' — gramática completa dos tipos: ${LOG_TYPES.join(' | ')}\n${LOG_HELP_PT}`, `invalid type '${pos[1]}' — full type grammar: ${LOG_TYPES.map((t) => LOG_TYPE_EN[t]).join(' | ')}\n${LOG_HELP_EN}`));
  const titulo = String(pos[2]);
  if (/[\r\n]/.test(titulo)) die(tr(LANG, `título é single-line na gramática do LOG — detalhe multilinha vai no corpo (--stdin/--body-file).\n${LOG_HELP_PT}`, `the title is single-line in the LOG grammar — multiline detail goes in the body (--stdin/--body-file).\n${LOG_HELP_EN}`));
  if (!titulo.trim()) die(tr(LANG, `título vazio.\n${LOG_HELP_PT}`, `empty title.\n${LOG_HELP_EN}`));
  if (flags.stdin && flags['body-file']) die(tr(LANG, 'use --stdin OU --body-file, não ambos', 'use --stdin OR --body-file, not both'));
  let body = '';
  if (flags.stdin) body = sanitizeBody(fs.readFileSync(0), 'stdin');
  else if (flags['body-file']) {
    const bf = path.resolve(String(flags['body-file']));
    if (!exists(bf)) die(tr(LANG, `--body-file: arquivo não existe: ${flags['body-file']}`, `--body-file: file does not exist: ${flags['body-file']}`));
    body = sanitizeBody(fs.readFileSync(bf), String(flags['body-file']));
  }
  const stored = [body, gitFooter(root)].filter(Boolean).join('\n');
  const heading = appendLog(spec.dir, tipo, titulo, stored);
  // eco da entrada gravada (≤2 linhas): heading + 1ª linha do corpo/rodapé
  out(heading);
  const first = stored.split('\n').find((l) => l.trim());
  if (first) out(first);
}

function cmdCheck(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase !== 'active') die(tr(LANG, `check: ${spec.id} está em ${spec.phase}/ — evidência de critério só em SPEC ativa`, `check: ${spec.id} is in ${spec.phase}/ — criterion evidence only in an active SPEC`));
  const n = parseInt(pos[1], 10);
  const mainPath = P(spec.dir, 'main.md');
  const pm = parseMain(read(mainPath));
  const crit = getCriteria(pm);
  if (!crit || !crit.length) die(tr(LANG, `${spec.id}: seção "## Critério de aceite" sem checkboxes — nada a estampar`, `${spec.id}: "## Acceptance criteria" section has no checkboxes — nothing to stamp`));
  if (!Number.isInteger(n) || n < 1 || n > crit.length) {
    die(tr(LANG, `uso: node scripts/specctl.mjs check <id> <n> [--evidence "..."] — n é 1-based; ${spec.id} tem ${crit.length} critério(s)`, `usage: node scripts/specctl.mjs check <id> <n> [--evidence "..."] — n is 1-based; ${spec.id} has ${crit.length} criterion/criteria`));
  }
  const c = crit[n - 1];
  if (hasVerifyTag(c.raw)) die(tr(LANG, `critério ${n} tem verify: — rota: node scripts/specctl.mjs verify ${spec.id}`, `criterion ${n} has verify: — route: node scripts/specctl.mjs verify ${spec.id}`));
  const ev = flags.evidence ? String(flags.evidence).trim() : '';
  if (/[\r\n]/.test(ev)) die(tr(LANG, '--evidence é single-line — detalhe longo vai no LOG (specctl log) ou em evidence/', '--evidence is single-line — long detail goes in the LOG (specctl log) or in evidence/'));
  if (/verify:/.test(ev)) die(tr(LANG, 'check NUNCA escreve o token "verify:" — evidência executável usa: node scripts/specctl.mjs verify', 'check NEVER writes the "verify:" token — runnable evidence uses: node scripts/specctl.mjs verify'));
  const lines = norm(read(mainPath)).split('\n');
  const allClosedMsg = () => {
    const after = getCriteria(parseMain(lines.join('\n'))) || [];
    if (after.length && after.every((x) => x.checked || ACEITO_RE.test(x.raw))) {
      out(tr(LANG, `todos evidenciados — próximo: node scripts/specctl.mjs close ${spec.id} --dry`, `all evidenced — next: node scripts/specctl.mjs close ${spec.id} --dry`));
    }
  };
  if (c.checked) {
    out(lines[c.line].trim());
    out(tr(LANG, `critério ${n} já está [x] — nada a fazer`, `criterion ${n} is already [x] — nothing to do`));
    allClosedMsg();
    process.exit(0);
  }
  const short = git(['rev-parse', '--short', 'HEAD'], root); // evidência registra commit (R.6)
  const m = /^(\s*-\s*)\[ \]\s*(.*?)\s*$/.exec(lines[c.line]);
  if (!m) die(tr(LANG, `critério ${n}: linha fora do formato "- [ ] ..." — corrija o main.md antes de estampar`, `criterion ${n}: line does not match "- [ ] ..." — fix main.md before stamping`));
  lines[c.line] = `${m[1]}[x] ${m[2]} (${now()}, commit \`${short}\`${ev ? `, evidence: ${ev}` : ''})`;
  writeFile(mainPath, lines.join('\n'));
  out(lines[c.line].trim());
  allClosedMsg();
}

// medição canônica do digest (A2/2c): bytes LF-normalizados (lfText: strip CR/BOM) + comentários HTML descontados
function digestMeasure(s) {
  return bytesOf(lfText(s).replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, ''));
}
// extração estrutural (formato §3.4) — a ferramenta trunca por prioridade até caber ≤2.000B
function genDigest(root, spec, o = {}) {
  const pm = parseMain(readSafe(P(spec.dir, 'main.md')));
  const f = pm.fields;
  const titulo = ((/^# SPEC-[\d-]+:\s*(.*)$/.exec(pm.lines[0] || '') || [])[1] || '').trim();
  const crit = getCriteria(pm) || [];
  const done = crit.filter((c) => c.checked).length;
  const j = norm(readSafe(P(spec.dir, 'journal.md')));
  let onde = '—';
  for (const m of j.matchAll(/\*\*(?:Onde tô|Where I am):\*\*\s*(.+)/g)) onde = m[1].trim(); // "Onde tô" final do SNAPSHOT
  // "Entregue" = a entrada [conclusão] do LOG (autoritativa, escrita no fechamento) tem prioridade sobre o "Onde tô"
  // do SNAPSHOT — que pode estar stale (placeholder do template) numa SPEC fechada só via scribe. Bug achado no bench porte-P.
  let conclusao = '';
  for (const m of j.matchAll(logHeadRe('conclusão'))) if (m[1].trim()) conclusao = m[1].trim();
  const dl = docLang(pm.raw); // digest sai no idioma do main.md
  const T = (pt, en) => tr(dl, pt, en);
  if (SNAP_PLACEHOLDER.test(onde) || onde === '—') onde = conclusao || (SNAP_PLACEHOLDER.test(onde) ? T('(ver critérios/decisões)', '(see criteria/decisions)') : onde);
  const dec = [];
  for (const m of j.matchAll(logHeadRe('decisão'))) if (m[1].trim()) dec.push(truncate(m[1].trim(), 100));
  const porte = (f.Porte || 'M').toUpperCase();
  const cfField = (f['Commit final'] || '—').trim();
  const commitFinal = cfField !== '—' ? cfField : (o.commitFinal || '—');
  const ccField = (f['Concluída'] || '—').trim();
  const concluida = ccField !== '—' ? ccField : (o.concluida || '—');
  let resumo = (f.Resumo || '—').trim();
  let entregue = onde;
  let decs = dec.slice(0, 8);
  const F = (canon) => fieldLabel(canon, dl);
  const note = T(DIGEST_STUB_NOTE, DIGEST_STUB_NOTE_EN);
  const build = () => {
    if (porte === 'P') { // porte P: 3-5 linhas, sem passo do modelo
      return `# Digest — ${spec.id}\n${note}\n**${F('Resumo')}:** ${resumo} · **Features:** ${f.Features || '—'} · **${F('Commit final')}:** ${commitFinal}\n**${T('Entregue', 'Delivered')}:** ${entregue} (${T('critérios', 'criteria')} ${done}/${crit.length}, ${T('concluída', 'completed')} ${concluida})\n`;
    }
    const L = [`# Digest — ${spec.id}${titulo ? `: ${truncate(titulo, 80)}` : ''}`, note, ''];
    L.push(`**${F('Resumo')}:** ${resumo}`);
    L.push(`**${F('Porte')}:** ${porteOut(porte, dl)} · **Features:** ${f.Features || '—'} · **${F('Criada')}:** ${f.Criada || '—'} · **${F('Concluída')}:** ${concluida}`);
    L.push(`**${T('Critérios', 'Criteria')}:** ${done}/${crit.length} ${T('fechados', 'closed')} · **${F('Commit final')}:** ${commitFinal}`);
    L.push(`**${T('Entregue', 'Delivered')}:** ${entregue}`);
    if (decs.length) { L.push(`**${T('Decisões', 'Decisions')}:**`); for (const d of decs) L.push(`- ${d}`); }
    L.push('');
    L.push(T('_Contexto completo: journal.md + main.md nesta pasta._', '_Full context: journal.md + main.md in this folder._'));
    return L.join('\n') + '\n';
  };
  let txt = build();
  while (digestMeasure(txt) > 2000) { // nunca devolve o corte pro modelo: decisões → entregue → resumo
    if (decs.length) decs.pop();
    else if (entregue.length > 60) entregue = truncate(entregue, Math.max(60, Math.floor(entregue.length / 2)));
    else if (resumo.length > 60) resumo = truncate(resumo, Math.max(60, Math.floor(resumo.length / 2)));
    else break;
    txt = build();
  }
  while (digestMeasure(txt) > 2000) txt = txt.slice(0, -16); // salvaguarda dura da garantia
  if (!txt.endsWith('\n')) txt += '\n';
  return txt;
}
function cmdDigest(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  const dgPath = P(spec.dir, 'digest.md');
  const rel = relOf(root, dgPath);
  if (flags.stdin || flags.file) { // refino do modelo: re-validado com resposta acionável
    if (flags.stdin && flags.file) die(tr(LANG, 'use --stdin OU --file, não ambos', 'use --stdin OR --file, not both'));
    let raw;
    if (flags.stdin) raw = fs.readFileSync(0);
    else {
      const fsrc = path.resolve(String(flags.file));
      if (!exists(fsrc)) die(tr(LANG, `--file: arquivo não existe: ${flags.file}`, `--file: file does not exist: ${flags.file}`));
      raw = fs.readFileSync(fsrc);
    }
    let txt = sanitizeBody(raw, flags.stdin ? 'stdin' : String(flags.file));
    if (!txt.endsWith('\n')) txt += '\n';
    const b = digestMeasure(txt);
    if (b > 2000) die(tr(LANG, `digest recusado: ${b}B > 2000B: corte ~${b - 2000}B e reenvie (medição LF, comentários HTML descontados)`, `digest rejected: ${b}B > 2000B: cut ~${b - 2000}B and resend (LF measurement, HTML comments excluded)`));
    writeFile(dgPath, txt);
    out(tr(LANG, `digest gravado: ${b}B (≤2000) — ${rel}`, `digest written: ${b}B (≤2000) — ${rel}`));
    return;
  }
  if (exists(dgPath) && !flags.fix) {
    const b = digestMeasure(read(dgPath));
    if (b > 2000) die(tr(LANG, `digest.md existe com ${b}B > 2000B — re-gere dentro do cap: node scripts/specctl.mjs digest ${spec.id} --fix`, `digest.md exists with ${b}B > 2000B — regenerate within the cap: node scripts/specctl.mjs digest ${spec.id} --fix`));
    die(tr(LANG, `digest.md já existe (${b}B, dentro do cap) — refine via --stdin/--file ou re-gere: node scripts/specctl.mjs digest ${spec.id} --fix`, `digest.md already exists (${b}B, within the cap) — refine via --stdin/--file or regenerate: node scripts/specctl.mjs digest ${spec.id} --fix`));
  }
  const txt = genDigest(root, spec);
  writeFile(dgPath, txt);
  out(txt.replace(/\n$/, ''));
  out(tr(LANG, `\ndigest: ${digestMeasure(txt)}B (≤2000) — gravado em ${rel}`, `\ndigest: ${digestMeasure(txt)}B (≤2000) — written to ${rel}`));
}

// ---- rollup: ferramenta MANUAL/opcional (não é enforcement) — move blocos INTEIROS antigos p/ .history.md até a feature caber no alvo, para enxugar o auto-load N1 quando o AUTOR quiser. Tamanho de feature não é lintado nem bloqueado.
const FEATURE_CAP = 8000; // alvo do rollup manual, não um teto lintado
const ROLLUP_ELIG_RE = /delta de estado|hist[óo]rico|state delta|history/i;
const ROLLUP_LIVE_RE = /decis[õo]es arquiteturais ativas|^\s*estado atual|active architectural decisions|^\s*current state/i;
function featurePathOf(root, area) { return P(root, 'docs', 'features', ...area.split('/')) + '.md'; }
// blocos line-oriented elegíveis: itens de lista COM SPEC-id em seções de delta/histórico ou gotchas;
// NUNCA em "Decisões arquiteturais ativas"/"Estado atual" (conteúdo vivo) — ordenados do mais antigo
function rollupBlocks(lines) {
  const blocks = [];
  let h2 = '', h3 = '';
  for (let i = 0; i < lines.length; i++) {
    const hm = /^(#{2,3})\s+(.*)$/.exec(lines[i]);
    if (hm) { if (hm[1].length === 2) { h2 = hm[2]; h3 = ''; } else h3 = hm[2]; continue; }
    if (!/^-\s/.test(lines[i])) continue;
    const eligible = ROLLUP_ELIG_RE.test(h3) || ROLLUP_ELIG_RE.test(h2) || /^gotchas/i.test(h2);
    const live = (ROLLUP_LIVE_RE.test(h2) || ROLLUP_LIVE_RE.test(h3)) && !ROLLUP_ELIG_RE.test(h3);
    if (!eligible || live) continue;
    let j = i + 1;
    while (j < lines.length && !/^-\s/.test(lines[j]) && !/^#{1,6}\s/.test(lines[j]) && /^\s+\S/.test(lines[j])) j++;
    const text = lines.slice(i, j).join('\n');
    const ids = [...text.matchAll(/\bSPEC-(\d{8}-\d{4})/g)].map((m) => m[1]);
    if (ids.length) blocks.push({ start: i, end: j, key: ids.sort()[0], text });
    i = j - 1;
  }
  return blocks.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.start - b.start));
}
function rollupArea(root, area) {
  const fp = featurePathOf(root, area);
  if (!exists(fp)) die(tr(LANG, `docs/features/${area}.md não existe — áreas em docs/INDEX.md`, `docs/features/${area}.md does not exist — areas in docs/INDEX.md`));
  const lines = norm(read(fp)).split('\n');
  const rebuild = (removed) => lines.filter((_, i) => !removed.has(i)).join('\n').replace(/\n{3,}/g, '\n\n');
  let content = rebuild(new Set());
  if (lfBytes(content) <= FEATURE_CAP) return { moved: 0, bytes: lfBytes(content), fit: true };
  const removed = new Set();
  const movedBlocks = [];
  for (const b of rollupBlocks(lines)) {
    if (lfBytes(content) <= FEATURE_CAP) break;
    for (let i = b.start; i < b.end; i++) removed.add(i);
    movedBlocks.push(b);
    content = rebuild(removed);
  }
  const bytes = lfBytes(content);
  if (movedBlocks.length) {
    const histPath = fp.replace(/\.md$/, '.history.md');
    let hist = exists(histPath) ? norm(read(histPath))
      : tr(docLang(lines.join('\n')),
        `# History — ${area}\n\n> Rollup de docs/features/${area}.md (R.16): blocos movidos pelo specctl, do mais antigo ao mais novo. Não reintegrar — o conteúdo vivo continua na feature.\n`,
        `# History — ${area}\n\n> Rollup of docs/features/${area}.md (R.16): blocks moved by specctl, oldest first. Do not reintegrate — live content stays in the feature.\n`);
    if (!hist.endsWith('\n')) hist += '\n';
    hist += `\n## Rollup ${now()} (${movedBlocks.length} ${tr(docLang(hist), 'bloco(s)', 'block(s)')})\n\n${movedBlocks.map((b) => b.text).join('\n')}\n`;
    writeFile(histPath, hist);
    writeFile(fp, content.endsWith('\n') ? content : content + '\n');
  }
  return { moved: movedBlocks.length, bytes, fit: bytes <= FEATURE_CAP };
}
function cmdRollup(pos) {
  const root = requireRoot();
  const area = pos[0];
  if (!area) die(tr(LANG, 'uso: node scripts/specctl.mjs rollup <area> — move blocos antigos p/ docs/features/<area>.history.md até ≤8.000B', 'usage: node scripts/specctl.mjs rollup <area> — moves old blocks to docs/features/<area>.history.md until ≤8,000B'));
  const r = rollupArea(root, area);
  out(tr(LANG, `rollup: ${r.moved} bloco(s) → docs/features/${area}.history.md${r.moved ? '' : ' (nada movido)'}`, `rollup: ${r.moved} block(s) → docs/features/${area}.history.md${r.moved ? '' : ' (nothing moved)'}`));
  out(r.fit
    ? `docs/features/${area}.md: ${r.bytes} bytes (≤${FEATURE_CAP})`
    : tr(LANG, `docs/features/${area}.md: ${r.bytes} bytes — mínimo atingível sem tocar seções vivas (> ${FEATURE_CAP}); reduza "Estado atual"/"Decisões arquiteturais ativas" manualmente`, `docs/features/${area}.md: ${r.bytes} bytes — minimum reachable without touching live sections (> ${FEATURE_CAP}); shrink "Current state"/"Active architectural decisions" by hand`));
}

// ---- Porte com dente (D2): escalate one-way; rebaixar exige citação literal do usuário
const PORTE_RANK = { P: 1, M: 2, G: 3 };
function cmdEscalate(pos) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase === 'archive' || spec.phase === 'discard') die(tr(LANG, `escalate: ${spec.id} está em ${spec.phase}/ — Porte só muda em SPEC aberta`, `escalate: ${spec.id} is in ${spec.phase}/ — Size only changes in an open SPEC`));
  const alvo = canonPorte(String(pos[1] || '').toUpperCase()); // aceita M|G e M|L
  if (!['M', 'G'].includes(alvo)) die(tr(LANG, 'uso: node scripts/specctl.mjs escalate <id> <M|G> (one-way: P→M→G)', 'usage: node scripts/specctl.mjs escalate <id> <M|L> (one-way: S→M→L)'));
  const mainPath = P(spec.dir, 'main.md');
  const cur = (parseMain(read(mainPath)).fields.Porte || 'M').toUpperCase();
  if (!PORTE_RANK[cur]) die(tr(LANG, `Porte atual inválido no main.md: '${cur}' — corrija para P | M | G`, `invalid current Size in main.md: '${cur}' — fix it to S | M | L`));
  if (PORTE_RANK[alvo] <= PORTE_RANK[cur]) {
    die(tr(LANG, `escalate é ONE-WAY (P→M→G): ${cur} → ${alvo} não é escalação. Rebaixar é decisão do USUÁRIO: node scripts/specctl.mjs deescalate ${spec.id} <P|M> --cita "citação literal do usuário"`, `escalate is ONE-WAY (S→M→L): ${porteOut(cur)} → ${porteOut(alvo)} is not an escalation. Deescalating is the USER's decision: node scripts/specctl.mjs deescalate ${spec.id} <S|M> --quote "user's literal quote"`));
  }
  writeFile(mainPath, setField(read(mainPath), 'Porte', alvo));
  appendLog(spec.dir, 'nota', (l) => tr(l, `Porte escalado ${cur} → ${alvo}`, `Size escalated ${porteOut(cur, 'en')} → ${porteOut(alvo, 'en')}`), gitFooter(root));
  out(tr(LANG, `Porte: ${cur} → ${alvo} (${spec.id}) — [nota] de escalação registrada no LOG`, `Size: ${porteOut(cur)} → ${porteOut(alvo)} (${spec.id}) — escalation [note] recorded in the LOG`));
}
function cmdDeescalate(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase === 'archive' || spec.phase === 'discard') die(tr(LANG, `deescalate: ${spec.id} está em ${spec.phase}/ — Porte só muda em SPEC aberta`, `deescalate: ${spec.id} is in ${spec.phase}/ — Size only changes in an open SPEC`));
  const alvo = canonPorte(String(pos[1] || '').toUpperCase()); // aceita P|M e S|M
  if (!['P', 'M'].includes(alvo)) die(tr(LANG, 'uso: node scripts/specctl.mjs deescalate <id> <P|M> --cita "citação literal do usuário"', 'usage: node scripts/specctl.mjs deescalate <id> <S|M> --quote "user\'s literal quote"'));
  const cita = flags.cita ? String(flags.cita).trim() : '';
  if (!cita) die(tr(LANG, 'deescalate exige --cita "citação literal do usuário" — rebaixar Porte é decisão do USUÁRIO (padrão aceito-incompleto), nunca do agente', 'deescalate requires --quote "user\'s literal quote" — deescalating Size is the USER\'s decision (accepted-incomplete pattern), never the agent\'s'));
  const mainPath = P(spec.dir, 'main.md');
  const cur = (parseMain(read(mainPath)).fields.Porte || 'M').toUpperCase();
  if (PORTE_RANK[alvo] >= PORTE_RANK[cur]) die(tr(LANG, `deescalate rebaixa o Porte: ${cur} → ${alvo} não é rebaixamento — para subir use: node scripts/specctl.mjs escalate ${spec.id} ${alvo}`, `deescalate lowers the Size: ${porteOut(cur)} → ${porteOut(alvo)} is not a deescalation — to raise it use: node scripts/specctl.mjs escalate ${spec.id} ${porteOut(alvo)}`));
  writeFile(mainPath, setField(read(mainPath), 'Porte', alvo));
  const jLang = docLang(readSafe(P(spec.dir, 'journal.md')));
  const body = [`[${aceitoTag(jLang)}: "${cita.replace(/"/g, "'")}" ${now()}]`, gitFooter(root)].filter(Boolean).join('\n');
  appendLog(spec.dir, 'nota', (l) => tr(l, `Porte rebaixado ${cur} → ${alvo} (autorizado pelo usuário)`, `Size deescalated ${porteOut(cur, 'en')} → ${porteOut(alvo, 'en')} (authorized by the user)`), body);
  out(tr(LANG, `Porte: ${cur} → ${alvo} (${spec.id}) — citação do usuário registrada no LOG`, `Size: ${porteOut(cur)} → ${porteOut(alvo)} (${spec.id}) — user quote recorded in the LOG`));
}

// ---- close (A1): stage → validate-ALL → apply (all-or-nothing, idempotente)
// STAGE: zero mutação — separa bloqueios (exigem humano/modelo) de passos automatizáveis
function closeStage(root, spec) {
  const pm = parseMain(read(P(spec.dir, 'main.md')));
  const crit = getCriteria(pm) || [];
  const blockers = [], autos = [];
  let verifyPending = 0;
  const T = (pt, en) => tr(LANG, pt, en);
  if (!crit.length) blockers.push(T('seção "## Critério de aceite" sem checkboxes — contrato R.6.2 vazio', 'section "## Acceptance criteria" has no checkboxes — R.6.2 contract is empty'));
  crit.forEach((c, i) => {
    const n = i + 1;
    if (hasVerifyTag(c.raw)) {
      const v = verifyCmdOf(c.raw);
      const runnable = !!(v && v.runnable);
      if (!c.checked && !ACEITO_RE.test(c.raw)) {
        if (runnable) { verifyPending++; autos.push(T(`critério ${n} com verify: pendente — será executado no close`, `criterion ${n} with pending verify: — will run at close`)); }
        else blockers.push(T(`critério ${n} com verify: placeholder — preencha o comando real (ou fluxo R.6.2): "${truncate(c.text, 50)}"`, `criterion ${n} with a placeholder verify: — fill in the real command (or the R.6.2 flow): "${truncate(c.text, 50)}"`));
      }
    } else if (!c.checked && !ACEITO_RE.test(c.raw)) {
      blockers.push(T(`critério ${n} aberto sem evidência: "${truncate(c.text, 50)}" — rota: node scripts/specctl.mjs check ${spec.id} ${n} ou fluxo R.6.2 (item a item, só o USUÁRIO aceita incompleto)`, `criterion ${n} open without evidence: "${truncate(c.text, 50)}" — route: node scripts/specctl.mjs check ${spec.id} ${n} or the R.6.2 flow (item by item, only the USER accepts incomplete)`));
    } else if (c.checked && !hasTs(c.raw)) {
      blockers.push(T(`critério ${n} [x] sem timestamp (R.6): "${truncate(c.text, 50)}" — evidencie via check/verify`, `criterion ${n} [x] without timestamp (R.6): "${truncate(c.text, 50)}" — add evidence via check/verify`));
    }
  });
  const jp = P(spec.dir, 'journal.md');
  const jtxt = exists(jp) ? norm(readSafe(jp)) : '';
  if (!jtxt || !hasCurrentConclusao(jtxt)) {
    blockers.push(T(`[conclusão] ausente no LOG (ou anterior à última reabertura) — rota: node scripts/specctl.mjs log ${spec.id} conclusão "o que foi entregue"`, `[completion] missing from the LOG (or older than the last reopen) — route: node scripts/specctl.mjs log ${spec.id} completion "what was delivered"`));
  }
  // SNAPSHOT ainda em placeholder do template = não reflete a conclusão; o digest gerado herdaria o lixo ("Entregue: nada feito ainda")
  const snapEnd = jtxt.search(/^## LOG\b/m);
  if (SNAP_PLACEHOLDER.test(snapEnd >= 0 ? jtxt.slice(0, snapEnd) : jtxt)) {
    blockers.push(T(`SNAPSHOT ainda com placeholder do template ("Onde tô/Próximo passo/Fase") — sobrescreva o SNAPSHOT refletindo a conclusão antes de fechar (o digest é gerado dele)`, `SNAPSHOT still has template placeholders ("Where I am/Next step/Phase") — overwrite the SNAPSHOT to reflect completion before closing (the digest is generated from it)`));
  }
  const feats = splitList(pm.fields.Features || '');
  if (!feats.length) blockers.push(T('**Features:** vazio — R.4/R.7 exigem vínculo a feature', '**Features:** empty — R.4/R.7 require a link to a feature'));
  for (const ft of feats) {
    const r = featureConcludedOk(root, ft, spec.id);
    if (!r.ok) blockers.push(r.why);
  }
  const dg = P(spec.dir, 'digest.md');
  if (!exists(dg)) autos.push(T('digest.md ausente — será gerado no close (≤2.000B)', 'digest.md missing — will be generated at close (≤2,000B)'));
  else {
    const b = digestMeasure(read(dg));
    if (b > 2000) autos.push(T(`digest.md com ${b}B > 2000B — será re-gerado no close`, `digest.md is ${b}B > 2000B — will be regenerated at close`));
  }
  // (sem auto-rollup de feature no close: tamanho de feature não é gerido pelo harness — rollup é manual/opcional)
  const closeTestCmd = ((manifest(root).commands || {}).test || '').trim();
  if (closeTestCmd) autos.push(T(`suíte do projeto roda 1× no close (${truncate(closeTestCmd, 40)}) — falha aborta sem mover nada`, `project suite runs once at close (${truncate(closeTestCmd, 40)}) — a failure aborts without moving anything`));
  return { blockers, autos, feats, verifyPending };
}
// checklist ordenado (≤1,2KB) — mesmo texto no --dry e no close bloqueado (A1: --dry opcional e inofensivo)
function checklistText(spec, st, dry) {
  const items = [...st.blockers.map((b) => `✗ ${b}`), ...st.autos.map((a) => `▸ ${a}`)];
  const T = (pt, en) => tr(LANG, pt, en);
  const head = T(`== close ${spec.id}${dry ? ' --dry' : ''} — ${items.length} pendência(s) ==`, `== close ${spec.id}${dry ? ' --dry' : ''} — ${items.length} pending item(s) ==`);
  const foot = st.blockers.length
    ? T(`pronto: NÃO — resolva ${st.blockers.length} bloqueio(s) (✗) e rode: node scripts/specctl.mjs close ${spec.id}`, `ready: NO — resolve ${st.blockers.length} blocker(s) (✗) and run: node scripts/specctl.mjs close ${spec.id}`)
    : T(`pronto: SIM — os passos ▸ são automáticos: node scripts/specctl.mjs close ${spec.id}`, `ready: YES — the ▸ steps are automatic: node scripts/specctl.mjs close ${spec.id}`);
  const L = [head, ...items, foot];
  let omitted = 0;
  while (bytesOf(L.join('\n')) > 1100 && L.length > 2) { L.splice(L.length - 2, 1); omitted++; }
  if (omitted) L.splice(L.length - 1, 0, T(`… +${omitted} pendência(s) omitida(s)`, `… +${omitted} pending item(s) omitted`));
  return L.join('\n');
}
function cmdClose(pos, flags) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  if (spec.phase === 'archive') { out(tr(LANG, `close: ${spec.id} já está em docs/archive/ — nada a fazer (idempotente)`, `close: ${spec.id} is already in docs/archive/ — nothing to do (idempotent)`)); process.exit(0); }
  if (spec.phase === 'discard') die(tr(LANG, `close: ${spec.id} está em discard/ — SPEC descartada não fecha`, `close: ${spec.id} is in discard/ — a discarded SPEC does not close`));
  if (spec.phase === 'future') {
    const st0 = parseMain(readSafe(P(spec.dir, 'main.md'))).fields.Status || 'draft';
    die(tr(LANG, `close exige SPEC em active/ — ${spec.id} está em future/ (status ${st0}). Rota: node scripts/specctl.mjs ${st0 === 'paused' ? 'resume' : 'activate'} ${spec.id}, termine o trabalho e rode o close.`, `close requires a SPEC in active/ — ${spec.id} is in future/ (status ${st0}). Route: node scripts/specctl.mjs ${st0 === 'paused' ? 'resume' : 'activate'} ${spec.id}, finish the work and run close.`));
  }
  const st = closeStage(root, spec);
  if (flags.dry) { out(checklistText(spec, st, true)); process.exit(st.blockers.length ? 1 : 0); }
  if (st.blockers.length) { out(checklistText(spec, st, false)); process.exit(1); }
  // ---- APPLY (só chega aqui com validações ok; move p/ archive é o ÚLTIMO ato mutador)
  const short = git(['rev-parse', '--short', 'HEAD'], root);
  // 1. verify: pendentes (estampa evidência na hora — R.6.1; falha aborta com relato)
  const vTotal = st.verifyPending;
  let vPass = 0;
  if (vTotal) {
    const r = runCli(root, ['verify', spec.id]);
    if (r.code !== 0) {
      process.stderr.write(r.out.endsWith('\n') ? r.out : r.out + '\n');
      die(tr(LANG, `close ABORTADO: verify falhou (relato acima). Critérios aprovados mantêm a evidência estampada — corrija e rode o close de novo.`, `close ABORTED: verify failed (report above). Passed criteria keep their stamped evidence — fix it and run close again.`));
    }
    vPass = vTotal;
  }
  // 1b. suíte do projeto 1× (label test do manifesto) — a garantia que dispensa rodar suíte por critério
  // (porte P nunca roda teste até aqui; é ESTE passo que impede arquivar sem nenhum teste ter rodado).
  // Label vazio = capacidade inexistente: N/A reportado no atestado, nunca PASS silencioso nem bloqueio.
  const testCmd = ((manifest(root).commands || {}).test || '').trim();
  let testNote = tr(LANG, 'N/A (sem label test)', 'N/A (no test label)');
  if (testCmd) {
    process.stdout.write(`suite: $ ${testCmd}\n`);
    try { execSync(testCmd, { cwd: root, stdio: 'pipe', timeout: 600000 }); testNote = 'PASS'; }
    catch (e) {
      const detail = truncate(String(e.stdout || '') + String(e.stderr || e.message || ''), 1500);
      process.stderr.write(detail.endsWith('\n') ? detail : detail + '\n');
      die(tr(LANG, `close ABORTADO: suíte do projeto falhou (${testCmd}). Corrija e rode o close de novo — nada foi movido.`, `close ABORTED: project suite failed (${testCmd}). Fix it and run close again — nothing was moved.`));
    }
  }
  // 2. digest gerado+MEDIDO (A2) — commit/data finais injetados na extração
  const dgPath = P(spec.dir, 'digest.md');
  if (!exists(dgPath) || digestMeasure(read(dgPath)) > 2000) {
    writeFile(dgPath, genDigest(root, spec, { commitFinal: `\`${short}\``, concluida: now() }));
  }
  const dgBytes = digestMeasure(read(dgPath));
  // 3. (sem rollup automático de feature: tamanho de feature não é gerido no close — rollup é manual via specctl rollup <area>)
  // 4. estampa Commit final (Status/Concluída na cauda compartilhada)
  writeFile(P(spec.dir, 'main.md'), setField(read(P(spec.dir, 'main.md')), 'Commit final', `\`${short}\``));
  // base/branch p/ o menu de finalização (lê o claim ANTES do archive, que o remove)
  const curBranch = currentBranch(root) || '—';
  let baseBranch = '—';
  const cp0 = claimPath(root, spec.id);
  if (exists(cp0)) { const mb = /^\*\*Base:\*\*\s*(.+)$/m.exec(read(cp0)); if (mb) baseBranch = mb[1].trim(); }
  if (baseBranch === '—') baseBranch = detectBaseBranch(root, curBranch);
  // 5-6. move active/→archive/ + índices (reusa a cauda do archive)
  archiveApply(root, spec);
  // 7. lint + audit UMA vez (mata o sweep ritual)
  const { E, W } = runLint(root);
  const AE = [], AW = [];
  auditBase(root, AE, AW);
  // atestado consolidado (≤30 linhas)
  const T = (pt, en) => tr(LANG, pt, en);
  out(T(`== close ${spec.id} — atestado ==`, `== close ${spec.id} — attestation ==`));
  out(`verify ${vPass}/${vTotal} · suite ${testNote} · digest ${dgBytes}B · lint ${E.length}/${W.length} · audit ${AE.length}/${AW.length}`);
  out(`docs/archive/${spec.id}`);
  if (E.length || AE.length) {
    for (const e of [...E, ...AE].slice(0, 10)) process.stderr.write(T(`ERRO  ${e.f}: ${e.m}\n`, `ERROR   ${e.f}: ${e.m}\n`));
    out(T('ATENÇÃO: lint/audit reportaram erro(s) acima — corrija antes do commit', 'WARNING: lint/audit reported error(s) above — fix them before committing'));
    process.exit(1);
  }
  out(T('nada mais a rodar · commit: git add -A && git commit', 'nothing else to run · commit: git add -A && git commit'));
  // menu de FINALIZAÇÃO git — o MODELO pergunta e executa; specctl NUNCA faz merge/push/delete sozinho
  out(T(`— finalização (o modelo PERGUNTA ao usuário e executa; nada automático) — branch ${curBranch} · base ${baseBranch}`, `— finalization (the model ASKS the user and runs it; nothing automatic) — branch ${curBranch} · base ${baseBranch}`));
  out(T(`  1. commitar; depois: (a) merge direto em ${baseBranch}  OU  (b) push + abrir PR para ${baseBranch}`, `  1. commit; then: (a) merge directly into ${baseBranch}  OR  (b) push + open a PR to ${baseBranch}`));
  out(T(`  2. voltar (checkout) para ${baseBranch} e git pull?`, `  2. go back (checkout) to ${baseBranch} and git pull?`));
  out(T(`  3. deletar a branch de trabalho ${curBranch}?`, `  3. delete the work branch ${curBranch}?`));
}

// ---------------------------------------------------------------- adopt-workspace / entrypoints

function cmdAdoptWorkspace(pos) {
  const root = requireRoot();
  const spec = findSpec(root, pos[0]);
  const pm = parseMain(read(P(spec.dir, 'main.md')));
  const ws = (pm.fields.Workspace || '—').trim();
  if (ws === 'inline') { out(tr(LANG, 'workspace inline — artefatos já vivem na pasta da SPEC, nada a adotar', 'inline workspace — artifacts already live in the SPEC folder, nothing to adopt')); process.exit(0); }
  if (!ws || ws === '—') die(tr(LANG, `${spec.id} sem **Workspace:** declarado no main.md — nada a adotar (modo external registra ex.: tasks/prd-<slug>/)`, `${spec.id} has no **Workspace:** declared in main.md — nothing to adopt (external mode records e.g. tasks/prd-<slug>/)`));
  const src = path.resolve(root, ws);
  if (!isDir(src)) die(tr(LANG, `workspace declarado não existe: ${ws}`, `declared workspace does not exist: ${ws}`));
  let count = 0;
  const skip = new Set(['tmp', 'node_modules', '.git']);
  fs.cpSync(src, spec.dir, {
    recursive: true, force: true,
    filter: (s) => {
      const b = path.basename(s);
      if (skip.has(b)) return false;
      try { if (fs.statSync(s).isFile()) count++; } catch { /* contagem best-effort */ }
      return true;
    },
  });
  appendLog(spec.dir, 'nota', (l) => tr(l, `adopt-workspace: snapshot de ${ws} copiado para a pasta da SPEC (${count} arquivo(s)) — workspace original preservado`, `adopt-workspace: snapshot of ${ws} copied into the SPEC folder (${count} file(s)) — original workspace preserved`));
  out(tr(LANG, `adotado: ${count} arquivo(s) de ${ws} → ${relOf(root, spec.dir)} (snapshot pré-archive; o workspace NÃO foi movido)`, `adopted: ${count} file(s) from ${ws} → ${relOf(root, spec.dir)} (pre-archive snapshot; the workspace was NOT moved)`));
}

function projectName(root) {
  try {
    const pkg = JSON.parse(readSafe(P(root, 'package.json')) || '{}');
    if (pkg.name) return pkg.name;
  } catch { /* sem package.json válido */ }
  return path.basename(root);
}
// FONTE ÚNICA dos entrypoints: `specctl entrypoints` gera CLAUDE.md/AGENTS.md daqui (não há mais
// templates/CLAUDE.md|AGENTS.md). Nome preservado do H1 existente, desc/stack preservados no bloco projeto,
// comandos re-renderizados do manifesto. Idioma = LANG do repo (manifesto `lang`).
// O núcleo docs/RULES.md chega ao agente por import nativo (`@docs/RULES.md`) no CLAUDE.md e por instrução
// explícita de leitura no AGENTS.md (CLIs sem import).
function entrypointContent(kind, root, man) {
  const existing = readSafe(P(root, kind));
  const nameM = /^# (?:CLAUDE|AGENTS)\.md — (.+)$/m.exec(existing);
  const name = (nameM && nameM[1].trim()) || projectName(root);
  const cmds = Object.entries(man.commands || {}).filter(([, v]) => v).map(([k, v]) => `- ${k}: \`${v}\``).join('\n')
    || tr(LANG, '- (defina os labels em docs/.spec-system.json → commands)', '- (define the labels in docs/.spec-system.json → commands)');
  // bloco do projeto: marcadores PT ou EN (preservados como estão); bloco novo nasce no idioma do repo
  const bm = new RegExp(`(?:${escRe(PROJ_INI)}|${escRe(PROJ_INI_EN)})[\\s\\S]*?(?:${escRe(PROJ_FIM)}|${escRe(PROJ_FIM_EN)})`).exec(existing);
  const projBlock = bm ? bm[0] : tr(LANG,
    `${PROJ_INI}\n## Projeto\n\n(descreva o projeto em 1-2 frases)\n\n**Stack:** —\n${PROJ_FIM}`,
    `${PROJ_INI_EN}\n## Project\n\n(describe the project in 1-2 sentences)\n\n**Stack:** —\n${PROJ_FIM_EN}`);
  const isAgents = kind === 'AGENTS.md';
  if (LANG === 'en') return entrypointContentEn(kind, name, cmds, projBlock, isAgents);
  const r9 = `**R.9 — 1ª linha de TODA resposta = classificação:** \`[continuidade: SPEC-x]\` (trabalho de SPEC existente) | \`[nova]\` (demanda que muda comportamento/código do produto → exige SPEC) | \`[livre]\` (pergunta, análise, leitura, config de ferramenta, bump de harness — nada que altere o produto; sem SPEC). Ambíguo? PERGUNTE.${isAgents ? '' : ' `/spec` abre os fluxos guiados.'}`;
  const rulesLine = isAgents
    ? '**Núcleo (R.1–R.17):** leia `docs/RULES.md` no início de CADA sessão — aqui ele não é carregado sozinho.'
    : '**Núcleo (R.1–R.17), sempre carregado:** @docs/RULES.md';
  const semHooks = isAgents ? `
## Sem hooks? (CLIs sem suporte)

- Início de CADA sessão: rode \`node scripts/specctl.mjs brief\` e cole o output.
- Gatilhos \`/spec\`: "inicie uma spec: <demanda>" · "feche a spec" · "status das specs" · "pause/retome a SPEC-x".
- Antes do PR: \`specctl lint\` e \`audit\`. O CI (docs-gate) é o piso universal.
` : '';
  const labelsNote = `Labels \`test/typecheck/lint/dev/e2e\` espelhados em \`docs/.spec-system.json\` — ${isAgents ? '' : 'hooks, '}CI e \`verify:\` consomem de lá; não hardcode.`;
  return `# ${kind} — ${name}

> Regra dura de posicionamento: este bloco imperativo fica SEMPRE no TOPO, antes de qualquer outra seção. \`specctl entrypoints\` garante isso em regeneração/merge.

## HARD BANS (TIER-0) — valem em TODA resposta

1. **R.6.2** — só o USUÁRIO aceita entrega incompleta, defere ou adia (qualquer "deixar pra depois", em QUALQUER momento) — NUNCA a IA por conta própria. PERGUNTE item a item (implementar agora / SPEC nova / aceitar gap), com citação do usuário.
2. **LOG append-only** — NUNCA editar entradas antigas do \`## LOG\` do journal.md; correção = nova entrada.
3. **\`docs/active/\` VAZIO em \`main\`** — SPEC ativa vive só em branch (CI bloqueia).
4. **Temporários na pasta da SPEC** — \`tmp/\` (descartável) ou \`evidence/\` (persistente); sem SPEC → \`.scratch/\`. Nunca na raiz.
5. **PROIBIDO varrer \`scripts/specctl.mjs\` ou re-ler \`docs/rules/*\` só para "garantir compliance"** — os gates dizem o que falta (\`close <id> --dry\`). Ler a rule DA TAREFA no momento do uso é o caminho certo, não viola este ban.

${rulesLine}

${r9}
${semHooks}
## Estrutura docs/

- \`docs/RULES.md\` — núcleo do processo (R.1–R.17); detalhe situacional em \`docs/rules/*\`
- \`docs/features/<area>.md\` — memória viva por área · \`docs/INDEX.md\` — mapa (GERADO)
- \`docs/active|future|archive|discard/SPEC-<ts>-<slug>/\` — main.md (contrato) + journal.md (SNAPSHOT + LOG)
- \`docs/claims/\` — trabalho em voo visível em main · \`docs/programs/\` — DAGs de SPECs · \`docs/PROGRAMS.md\` (GERADO) + \`docs/ROADMAP.md\` — o que pegar a seguir (\`specctl next\`) · \`docs/DEFERRED.md\` (GERADO) — deferidos R.6.2
- \`docs/TAXONOMY.md\` — áreas canônicas · \`docs/ARCHITECTURE.md\` — mapa região→feature
- \`docs/CONSTITUTION.md\` — princípios · manifesto: \`docs/.spec-system.json\`

## Comandos

${cmds}

${labelsNote}

## Skills e quando disparar

| Situação | Skill |
|---|---|
| Implementar contra lib/framework/API externa cuja API atual você não domina | **Context7 MCP** — confirme assinatura/versão antes de codar (se indisponível: vendor docs / WebSearch) |
| UI / frontend / estilização | frontend-design (se instalada) |
| Porte G — fase PRD (se pipeline instalado) | sdd-create-prd |
| Fases seguintes (se instalado) | sdd-create-techspec → sdd-create-tasks → sdd-run-task → sdd-run-qa / sdd-review-feature / sdd-fix-bugs |

## Mapa de referências — ler SÓ no momento do uso

\`docs/rules/\`: formats (criar/editar artefato) · lifecycle (transições de ciclo de vida) · programs (DAG de SPECs) · interop (workspace externo / pipeline prd) · context (compactação/orçamentos) · retrieval (archive N3) · verification (\`verify:\` e gates) · team (claims/multi-dev/onboarding) · ci (gates de CI).

${projBlock}

---
GERADO por \`specctl entrypoints\` — edite apenas o bloco projeto (entre marcadores).
`;
}
function entrypointContentEn(kind, name, cmds, projBlock, isAgents) {
  const r9 = `**R.9 — 1st line of EVERY answer = classification:** \`[continuation: SPEC-x]\` (work on an existing SPEC) | \`[new]\` (request that changes product behavior/code → requires a SPEC) | \`[free]\` (question, analysis, reading, tool config, harness bump — nothing that changes the product; no SPEC). Ambiguous? ASK.${isAgents ? '' : ' `/spec` opens the guided flows (`/spec close | status | pause | resume | import`).'}`;
  const rulesLine = isAgents
    ? '**Core (R.1–R.17):** read `docs/RULES.md` at the start of EVERY session — it is not loaded automatically here.'
    : '**Core (R.1–R.17), always loaded:** @docs/RULES.md';
  const noHooks = isAgents ? `
## No hooks? (CLIs without support)

- Start of EVERY session: run \`node scripts/specctl.mjs brief\` and paste the output.
- \`/spec\` triggers: "start a spec: <request>" · "close the spec" · "spec status" · "pause/resume SPEC-x".
- Before the PR: \`specctl lint\` and \`audit\`. CI (docs-gate) is the universal floor.
` : '';
  const labelsNote = `Labels \`test/typecheck/lint/dev/e2e\` are mirrored in \`docs/.spec-system.json\` — ${isAgents ? '' : 'hooks, '}CI and \`verify:\` read them from there; do not hardcode.`;
  return `# ${kind} — ${name}

> Hard placement rule: this imperative block ALWAYS stays at the TOP, before any other section. \`specctl entrypoints\` enforces this on regeneration/merge.

## HARD BANS (TIER-0) — apply to EVERY answer

1. **R.6.2** — only the USER accepts incomplete delivery, defers or postpones (any "leave it for later", at ANY moment) — NEVER the AI on its own. ASK item by item (implement now / new SPEC / accept the gap), with the user's quote.
2. **Append-only LOG** — NEVER edit old entries in the journal.md \`## LOG\`; a correction = a new entry.
3. **\`docs/active/\` EMPTY on \`main\`** — an active SPEC lives only on a branch (CI blocks).
4. **Temp files in the SPEC folder** — \`tmp/\` (disposable) or \`evidence/\` (persistent); no SPEC → \`.scratch/\`. Never at the root.
5. **FORBIDDEN to sweep \`scripts/specctl.mjs\` or re-read \`docs/rules/*\` just to "ensure compliance"** — the gates say what is missing (\`close <id> --dry\`). Reading the rule FOR THE TASK at the moment of use is the right path and does not violate this ban.

${rulesLine}

${r9}
${noHooks}
## docs/ structure

- \`docs/RULES.md\` — process core (R.1–R.17); situational detail in \`docs/rules/*\`
- \`docs/features/<area>.md\` — living memory per area · \`docs/INDEX.md\` — map (GENERATED)
- \`docs/active|future|archive|discard/SPEC-<ts>-<slug>/\` — main.md (contract) + journal.md (SNAPSHOT + LOG)
- \`docs/claims/\` — in-flight work visible on main · \`docs/programs/\` — SPEC DAGs · \`docs/PROGRAMS.md\` (GENERATED) + \`docs/ROADMAP.md\` — what to pick up next (\`specctl next\`) · \`docs/DEFERRED.md\` (GENERATED) — R.6.2 deferrals
- \`docs/TAXONOMY.md\` — canonical areas · \`docs/ARCHITECTURE.md\` — region→feature map
- \`docs/CONSTITUTION.md\` — principles · manifest: \`docs/.spec-system.json\`

## Commands

${cmds}

${labelsNote}

## Skills and when to trigger them

| Situation | Skill |
|---|---|
| Implementing against an external lib/framework/API whose current API you do not know well | **Context7 MCP** — confirm signature/version before coding (if unavailable: vendor docs / WebSearch) |
| UI / frontend / styling | frontend-design (if installed) |
| Size L — PRD phase (if the pipeline is installed) | sdd-create-prd |
| Next phases (if installed) | sdd-create-techspec → sdd-create-tasks → sdd-run-task → sdd-run-qa / sdd-review-feature / sdd-fix-bugs |

## Reference map — read ONLY at the moment of use

\`docs/rules/\`: formats (create/edit artifact) · lifecycle (lifecycle transitions) · programs (SPEC DAG) · interop (external workspace / prd pipeline) · context (compaction/budgets) · retrieval (L3 archive) · verification (\`verify:\` and gates) · team (claims/multi-dev/onboarding) · ci (CI gates).

${projBlock}

---
GENERATED by \`specctl entrypoints\` — edit only the project block (between markers).
`;
}
function cmdEntrypoints() {
  const root = requireRoot();
  const man = manifest(root);
  for (const kind of ['CLAUDE.md', 'AGENTS.md']) {
    const content = entrypointContent(kind, root, man);
    writeFile(P(root, kind), content);
    const b = bytesOf(content);
    const max = kind === 'AGENTS.md' ? 6200 : 6000;
    out(`${kind}: ${b} bytes${b > max ? tr(LANG, ` — AVISO: acima do orçamento de ${max} (R.16); reduza o bloco projeto`, ` — WARNING: over the ${max} budget (R.16); shrink the project block`) : ''}`);
  }
}

// ---------------------------------------------------------------- hooks (stdin JSON; deny = exit 2)

function readStdinJson() {
  let raw = '';
  try {
    if (process.stdin.isTTY) return null;
    raw = fs.readFileSync(0, 'utf8');
  } catch { return null; }
  if (!raw || !raw.trim()) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function hookRoot(fp) {
  return setLang(findRoot(process.cwd()) || (fp ? findRoot(path.dirname(fp)) : null));
}
function deny(msg) { process.stderr.write(msg + '\n'); process.exit(2); }

function allowlisted(root, actList, targetId) {
  if (!targetId) return false;
  for (const s of actList) {
    const al = readSafe(P(s.dir, '.allow-read'));
    for (const line of al.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      if (line === targetId || targetId.startsWith(line)) return true;
    }
  }
  return false;
}
function cmdGuardRead() {
  const input = readStdinJson();
  if (!input) process.exit(0);
  const tool = input.tool_name || 'Read';
  if (!['Read', 'Grep', 'Glob'].includes(tool)) process.exit(0);
  const ti = input.tool_input || {};
  // Grep/Glob: porta lateral do R.8 — varrer archive/ ou journal alheio via search dribla o isolamento.
  // Política: path apontando para dentro de archive/ (ou de SPEC não-ativa) = mesma negação do Read.
  // Sem path (busca no repo inteiro) segue livre — o resultado lista paths; a LEITURA deles cai no guard.
  if (tool === 'Grep' || tool === 'Glob') {
    const sp = ti.path;
    if (!sp) process.exit(0);
    const root = hookRoot(sp);
    if (!root) process.exit(0);
    const rel = relOf(root, path.resolve(String(sp)));
    if (rel.startsWith('..') || !rel.startsWith('docs/')) process.exit(0);
    const act = activeSpecs(root);
    const activeIds = new Set(act.map((s) => s.id));
    const tm = /^docs\/(active|future|archive|discard)\/(SPEC-[^/]+)/.exec(rel);
    const targetId = tm ? tm[2] : null;
    // (sem rota "via subagente": hooks PreToolUse também disparam nas tool calls de subagentes)
    const alHint = `docs/active/${act.length ? act[0].id : '<SPEC-ativa>'}/.allow-read`;
    if ((rel === 'docs/archive' || rel.startsWith('docs/archive/')) && !allowlisted(root, act, targetId)) {
      deny(tr(LANG, `[guard-read] BLOQUEADO (R.8 via ${tool}): busca dentro de docs/archive/ — N3 é acessado lendo main.md/digest.md direto (sempre livres) ou docs/ARCHIVE-INDEX.md; para mais, adicione o id da SPEC em ${alHint}.`, `[guard-read] BLOCKED (R.8 via ${tool}): search inside docs/archive/ — L3 is accessed by reading main.md/digest.md directly (always allowed) or docs/ARCHIVE-INDEX.md; for more, add the SPEC id to ${alHint}.`));
    }
    if (targetId && !activeIds.has(targetId) && tm[1] !== 'archive' && !allowlisted(root, act, targetId)) {
      deny(tr(LANG, `[guard-read] BLOQUEADO (R.8 via ${tool}): busca dentro de docs/${tm[1]}/${targetId} — SPEC fora do escopo ativo (main.md/digest.md podem ser LIDOS direto; o resto via allowlist: adicione '${targetId}' em ${alHint}).`, `[guard-read] BLOCKED (R.8 via ${tool}): search inside docs/${tm[1]}/${targetId} — SPEC outside the active scope (main.md/digest.md can be READ directly; the rest via allowlist: add '${targetId}' to ${alHint}).`));
    }
    process.exit(0);
  }
  const fp = ti.file_path;
  if (!fp) process.exit(0);
  const root = hookRoot(fp);
  if (!root) process.exit(0);
  const rel = relOf(root, path.resolve(fp));
  const man = manifest(root);
  // C3 (gated ≥4.1.0) — desarmar a leitura-seguro: não ler o próprio specctl.mjs "pra garantir compliance"
  if (/(^|\/)scripts\/specctl\.mjs$/.test(rel) && revGte(man.template_revision, '4.1.0')) {
    deny(tr(LANG, `[guard-read] BLOQUEADO (v4.1): não leia scripts/specctl.mjs para "garantir compliance" — os gates dizem o que falta.\nUse: node scripts/specctl.mjs --help  ·  node scripts/specctl.mjs close <id> --dry`, `[guard-read] BLOCKED (v4.1): do not read scripts/specctl.mjs to "ensure compliance" — the gates say what is missing.\nUse: node scripts/specctl.mjs --help  ·  node scripts/specctl.mjs close <id> --dry`));
  }
  if (rel.startsWith('..') || !rel.startsWith('docs/')) process.exit(0);
  const base = path.basename(rel);
  if (base === 'main.md' || base === 'digest.md') process.exit(0); // sempre livres
  const act = activeSpecs(root);
  const activeIds = new Set(act.map((s) => s.id));
  const tm = /^docs\/(active|future|archive|discard)\/(SPEC-[^/]+)\//.exec(rel);
  const targetId = tm ? tm[2] : null;
  const activeHint = act.length ? act[0].id : '<SPEC-ativa>';
  // (sem rota "via subagente": hooks PreToolUse também disparam nas tool calls de subagentes)
  const exitMsg = (motivo) => tr(LANG,
    `[guard-read] BLOQUEADO (R.8 — isolamento entre SPECs): ${rel}\n` +
    `Motivo: ${motivo}.\n` +
    `Saídas: (1) leia main.md/digest.md da SPEC direto (sempre livres) ou docs/ARCHIVE-INDEX.md; ` +
    `(2) allowlist: adicione a linha '${targetId || '<SPEC-id>'}' em docs/active/${activeHint}/.allow-read.`,
    `[guard-read] BLOCKED (R.8 — isolation between SPECs): ${rel}\n` +
    `Reason: ${motivo}.\n` +
    `Ways out: (1) read the SPEC's main.md/digest.md directly (always allowed) or docs/ARCHIVE-INDEX.md; ` +
    `(2) allowlist: add the line '${targetId || '<SPEC-id>'}' to docs/active/${activeHint}/.allow-read.`);
  if (rel.startsWith('docs/archive/')) {
    if (allowlisted(root, act, targetId)) process.exit(0);
    deny(exitMsg(tr(LANG, 'conteúdo de docs/archive/ — N3 é acessado via main.md/digest.md ou ARCHIVE-INDEX', 'content of docs/archive/ — L3 is accessed via main.md/digest.md or ARCHIVE-INDEX')));
  }
  if (['journal.md', 'state.md', 'memory.md'].includes(base) && targetId && !activeIds.has(targetId)) {
    if (allowlisted(root, act, targetId)) process.exit(0);
    deny(exitMsg(tr(LANG, `${base} pertence a SPEC fora do escopo ativo (ativa: ${act.map((s) => s.id).join(', ') || 'nenhuma'})`, `${base} belongs to a SPEC outside the active scope (active: ${act.map((s) => s.id).join(', ') || 'none'})`)));
  }
  if (man.policy === 'strict') {
    const freeRoots = ['docs/RULES.md', 'docs/rules/', 'docs/INDEX.md', 'docs/ARCHIVE-INDEX.md', 'docs/TAXONOMY.md', 'docs/ARCHITECTURE.md', 'docs/CONSTITUTION.md', 'docs/BOARD.md', 'docs/claims/', 'docs/programs/', 'docs/.spec-system.json'];
    const isFree = freeRoots.some((r) => rel === r || rel.startsWith(r));
    const isOwnSpec = targetId && activeIds.has(targetId);
    if (!isFree && !isOwnSpec) {
      out(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: tr(LANG, `policy=strict: leitura N1 de ${rel} exige confirmação do usuário (R.10 estrito). main.md/digest.md são sempre livres.`, `policy=strict: L1 read of ${rel} requires user confirmation (strict R.10). main.md/digest.md are always allowed.`) } }));
      process.exit(0);
    }
  }
  process.exit(0);
}

const TEMP_EXTS = ['.png', '.tmp', '.log'];
// `dump.sql`, `trace-1.json`, `dump_2.txt` — mas NÃO `tracer.ts`/`dumpSchema.ts` (prefixo exige separador/dígito/fim)
const TEMP_PREFIX = /^(dump|trace)(?:[._-]|\d|$)/i;
const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.c', '.h', '.cpp', '.vue', '.svelte'];
function isTempName(base) {
  const ext = path.extname(base).toLowerCase();
  if (CODE_EXTS.includes(ext)) return false;
  return TEMP_EXTS.includes(ext) || TEMP_PREFIX.test(base);
}
// R.12 mira o lixo solto: raiz do repo e docs/. Assets/logs dentro das pastas do projeto (public/logo.png, logs/app.log) são legítimos.
function inTempGuardScope(rel) { return !rel.includes('/') || rel.startsWith('docs/'); }
function inAllowedTempDir(rel) {
  return rel.includes('/tmp/') || rel.startsWith('tmp/') ||
    rel.includes('/evidence/') || rel.startsWith('evidence/') ||
    rel.includes('/.scratch/') || rel.startsWith('.scratch/') ||
    rel.includes('/intake/');
}
// entradas NOVAS no ## LOG (heading datado com [tipo]) presentes em newText e ausentes em oldText
function newLogHeadings(newText, oldText) {
  const re = /^## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — \[/gm;
  const nt = String(newText), ot = String(oldText), found = [];
  for (const m of nt.matchAll(re)) {
    let end = nt.indexOf('\n', m.index); if (end < 0) end = nt.length;
    const line = nt.slice(m.index, end);
    if (!ot.includes(line)) found.push(line);
  }
  return found;
}
// trecho imutável do LOG: de "## LOG" até o início da ÚLTIMA entrada (a última e o SNAPSHOT continuam editáveis).
// '' quando não há LOG ou só há uma entrada.
function frozenLogRegion(txt) {
  const logIdx = txt.search(/^## LOG\b/m);
  if (logIdx < 0) return '';
  const headRe = /^## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — .*$/gm;
  let lastIdx = -1, m;
  while ((m = headRe.exec(txt)) !== null) { if (m.index > logIdx) lastIdx = m.index; }
  if (lastIdx < 0) return '';
  const region = txt.slice(logIdx, lastIdx);
  return /^## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — /m.test(region) ? region : '';
}
// ---- sinal de contexto (doutrina "quando compactar" de rules/context.md virando sinal — v4.1.1) ----
// Lê o último `usage` do transcript (só o tail, barato) e, quando o contexto REAL cruza o limiar
// da janela, injeta additionalContext sugerindo /compact na PRÓXIMA fronteira de fase. Nunca
// bloqueia; estado por sessão em os.tmpdir re-lembra só a cada +60k de crescimento (buckets).
const CTX_WIN_STD = 200000, CTX_WIN_1M = 1000000;
const CTX_TH_STD = 160000, CTX_TH_1M = 250000, CTX_STEP = 60000;
function ctxLatestTokens(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;
  let fd;
  try { fd = fs.openSync(transcriptPath, 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 256 * 1024);
    const buf = Buffer.alloc(size - start);
    const n = fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8', 0, n).split('\n');
    for (let i = lines.length - 1; i >= (start > 0 ? 1 : 0); i--) { // linha 0 de tail truncado = JSON parcial
      const line = lines[i].trim(); if (!line) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      const u = rec && rec.message && rec.message.usage;
      if (!u || typeof u !== 'object') continue;
      const t = (Number.isFinite(u.input_tokens) ? u.input_tokens : 0)
        + (Number.isFinite(u.cache_read_input_tokens) ? u.cache_read_input_tokens : 0)
        + (Number.isFinite(u.cache_creation_input_tokens) ? u.cache_creation_input_tokens : 0);
      if (t > 0) return { tokens: t, model: rec.message && typeof rec.message.model === 'string' ? rec.message.model : '' };
    }
    return null;
  } catch { return null; } finally { try { fs.closeSync(fd); } catch { /* nunca falha o hook */ } }
}
function maybeSuggestCompact(input, root) {
  try {
    const usage = ctxLatestTokens(input.transcript_path);
    if (!usage) return null;
    // janela: env > manifesto (context_window) > detecção pelo transcript ([1m] no model id ou tokens>200k)
    const envWin = Number.parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '', 10);
    const manWin = root ? Number.parseInt(String(manifest(root).context_window || ''), 10) : NaN;
    const win = Number.isInteger(envWin) && envWin > 0 ? envWin
      : Number.isInteger(manWin) && manWin > 0 ? manWin
      : (usage.model.includes('[1m]') || usage.tokens > CTX_WIN_STD) ? CTX_WIN_1M : CTX_WIN_STD;
    const rawTh = process.env.COMPACT_CONTEXT_THRESHOLD;
    const parsedTh = Number.parseInt(rawTh || '', 10);
    if (parsedTh === 0) return null; // COMPACT_CONTEXT_THRESHOLD=0 desliga o sinal
    const th = Number.isInteger(parsedTh) && parsedTh > 0 ? parsedTh : (win >= CTX_WIN_1M ? CTX_TH_1M : CTX_TH_STD);
    if (usage.tokens < th) return null;
    const rawIv = Number.parseInt(process.env.COMPACT_CONTEXT_INTERVAL || '', 10);
    const step = Number.isInteger(rawIv) && rawIv > 0 ? rawIv : CTX_STEP;
    const bucket = Math.floor((usage.tokens - th) / step);
    const sid = String(input.session_id || 'default').replace(/[^a-zA-Z0-9_-]/g, '') || 'default';
    const stateFile = P(os.tmpdir(), `specctl-ctx-${sid}`);
    let last = -1;
    try { const p = parseInt(fs.readFileSync(stateFile, 'utf8').trim(), 10); if (Number.isInteger(p) && p >= 0) last = p; } catch { /* primeiro disparo */ }
    if (bucket <= last) return null;
    try { fs.writeFileSync(stateFile, String(bucket)); } catch { /* sem estado, sem re-lembrete — aceitável */ }
    try { // sweep de estado >14d de outras sessões — nunca falha o hook
      const cut = Date.now() - 14 * 864e5;
      for (const e of fs.readdirSync(os.tmpdir())) {
        if (!e.startsWith('specctl-ctx-') || e === `specctl-ctx-${sid}`) continue;
        const sf = P(os.tmpdir(), e);
        try { if (fs.statSync(sf).mtimeMs < cut) fs.rmSync(sf, { force: true }); } catch { /* ignora */ }
      }
    } catch { /* ignora */ }
    const pct = Math.round((usage.tokens / win) * 100);
    const winLabel = win >= CTX_WIN_1M ? '1M' : `${Math.round(win / 1000)}k`;
    return tr(LANG, `[contexto] ~${Math.round(usage.tokens / 1000)}k tokens (${pct}% da janela ${winLabel}) — na PRÓXIMA fronteira de fase: flush do SNAPSHOT/journal e /compact direcionado (tabela "Quando compactar" em docs/rules/context.md). NUNCA no meio de implementação.`, `[context] ~${Math.round(usage.tokens / 1000)}k tokens (${pct}% of the ${winLabel} window) — at the NEXT phase boundary: flush the SNAPSHOT/journal and run a targeted /compact ("When to compact" table in docs/rules/context.md). NEVER mid-implementation.`);
  } catch { return null; }
}

function cmdGuardWrite() {
  const input = readStdinJson();
  if (!input) process.exit(0);
  const tool = input.tool_name || '';
  if (tool && !['Write', 'Edit', 'MultiEdit'].includes(tool)) process.exit(0);
  const ti = input.tool_input || {};
  const fp = ti.file_path;
  if (!fp) process.exit(0);
  const root = hookRoot(fp);
  if (!root) process.exit(0);
  const rel = relOf(root, path.resolve(fp));
  if (rel.startsWith('..')) process.exit(0);
  const base = path.basename(rel);
  if (['docs/INDEX.md', 'docs/ARCHIVE-INDEX.md', 'docs/PROGRAMS.md', 'docs/DEFERRED.md'].includes(rel)) {
    deny(tr(LANG, `[guard-write] BLOQUEADO: ${rel} é GERADO. Caminho correto: edite a fonte (features/TAXONOMY/programs/critérios) e rode: node scripts/specctl.mjs index`, `[guard-write] BLOCKED: ${rel} is GENERATED. Correct path: edit the source (features/TAXONOMY/programs/criteria) and run: node scripts/specctl.mjs index`));
  }
  if (isTempName(base) && inTempGuardScope(rel) && !inAllowedTempDir(rel)) {
    const act = activeSpecs(root);
    const hint = act.length ? `docs/active/${act[0].id}` : 'docs/active/<SPEC>';
    deny(tr(LANG, `[guard-write] BLOQUEADO (R.12): '${base}' parece temporário/artefato fora de área permitida. Caminho correto: ${hint}/tmp/ (descartável) ou ${hint}/evidence/ (persistente); sem SPEC ativa: .scratch/.`, `[guard-write] BLOCKED (R.12): '${base}' looks like a temp file/artifact outside an allowed area. Correct path: ${hint}/tmp/ (disposable) or ${hint}/evidence/ (persistent); with no active SPEC: .scratch/.`));
  }
  if (rel.startsWith('docs/active/')) {
    const branch = currentBranch(root);
    if (isProtectedBranch(branch, root)) {
      deny(tr(LANG, `[guard-write] BLOQUEADO (R.2): escrita em ${rel} na branch protegida '${branch}'. Caminho correto: crie uma branch (git checkout -b feature/<slug>) e escreva lá; rascunho sem branch vai em docs/future/.`, `[guard-write] BLOCKED (R.2): write to ${rel} on the protected branch '${branch}'. Correct path: create a branch (git checkout -b feature/<slug>) and write there; a draft without a branch goes in docs/future/.`));
    }
  }
  // gates novos SÓ com template_revision ≥ 4.1.0 (repos v4.0 não quebram)
  const gated = revGte(manifest(root).template_revision, '4.1.0');
  const editTexts = () => {
    if (tool === 'Write') return { newText: ti.content || '', oldText: readSafe(path.resolve(fp)) };
    if (tool === 'MultiEdit' && Array.isArray(ti.edits)) return { newText: ti.edits.map((e) => e.new_string || '').join('\n'), oldText: ti.edits.map((e) => e.old_string || '').join('\n') };
    return { newText: ti.new_string || '', oldText: ti.old_string || '' };
  };
  // (3-pre) secret-scan ANTES do write em docs/ (R.15) — o Post (stamp-check) pega o que já está em disco;
  // aqui o segredo é barrado antes de EXISTIR em disco (sessão que morre pós-write não deixa credencial pra trás).
  if (gated && rel.startsWith('docs/')) {
    const { newText, oldText } = editTexts();
    for (const h of scanSecrets(String(newText))) {
      if (String(oldText).includes(h.lineText)) continue; // linha já estava no arquivo: remediação/edição do entorno não é re-negada
      deny(tr(LANG, `[guard-write] BLOQUEADO (R.15 — pré-write): SEGREDO (${h.tipo}) no conteúdo destinado a ${rel}. Docs NUNCA guardam segredos — escreva <REDACTED:${h.tipo}> no lugar; se a credencial já vazou em outra via, ROTACIONE.`, `[guard-write] BLOCKED (R.15 — pre-write): SECRET (${h.tipo}) in content meant for ${rel}. Docs NEVER hold secrets — write <REDACTED:${h.tipo}> instead; if the credential already leaked elsewhere, ROTATE it.`));
    }
  }
  // (3a) entrada NOVA de LOG via Write/Edit → só via specctl log (Escriba Único); SNAPSHOT/prosa livres
  if (gated && base === 'journal.md') {
    const { newText, oldText } = editTexts();
    const heads = newLogHeadings(newText, oldText);
    if (heads.length) {
      deny(tr(LANG, `[guard-write] BLOQUEADO (v4.1 — Escriba Único): entrada nova no ## LOG só via specctl log (a ferramenta carimba NOW+commit+diffstat). Trecho: '${truncate(heads[0], 60)}'.\n` +
        `Caminho correto:\n` +
        `  node scripts/specctl.mjs log <id> <tipo> "título"\n` +
        `  corpo multilinha: acrescente --stdin (heredoc/here-string) ou --body-file <arquivo>\n` +
        `SNAPSHOT e prosa do journal continuam editáveis direto (Edit normal).`,
        `[guard-write] BLOCKED (v4.1 — Single Scribe): a new ## LOG entry only via specctl log (the tool stamps NOW+commit+diffstat). Excerpt: '${truncate(heads[0], 60)}'.\n` +
        `Correct path:\n` +
        `  node scripts/specctl.mjs log <id> <type> "title"\n` +
        `  multiline body: add --stdin (heredoc/here-string) or --body-file <file>\n` +
        `The SNAPSHOT and journal prose stay directly editable (normal Edit).`));
    }
  }
  // (3b) "verify: exit 0" manual em linha de critério sob docs/active/ (anti-spoofing) → só specctl verify
  if (gated && base === 'main.md' && rel.startsWith('docs/active/')) {
    const { newText, oldText } = editTexts();
    const nt = String(newText), ot = String(oldText);
    const spoofRe = /^\s*-\s*\[[ xX]\][^\n]*verify:\s*exit 0/gm;
    for (const m of nt.matchAll(spoofRe)) {
      let end = nt.indexOf('\n', m.index); if (end < 0) end = nt.length;
      const line = nt.slice(m.index, end);
      if (ot.includes(line)) continue; // já existia: não é escrita nova de evidência
      const sid = (rel.match(/docs\/active\/(SPEC-[^/]+)/) || [])[1] || '<id>';
      deny(tr(LANG, `[guard-write] BLOQUEADO (v4.1 anti-spoofing): só specctl verify grava evidência "verify: exit 0" em critério — a ferramenta roda o comando e carimba na hora. Trecho: '${truncate(line, 60)}'.\n` +
        `Caminho correto: node scripts/specctl.mjs verify ${sid}  (critério manual, sem comando: node scripts/specctl.mjs check ${sid} <n> --evidence "...").`,
        `[guard-write] BLOCKED (v4.1 anti-spoofing): only specctl verify writes "verify: exit 0" evidence on a criterion — the tool runs the command and stamps it on the spot. Excerpt: '${truncate(line, 60)}'.\n` +
        `Correct path: node scripts/specctl.mjs verify ${sid}  (manual criterion, no command: node scripts/specctl.mjs check ${sid} <n> --evidence "...").`));
    }
  }
  // Write (arquivo inteiro) no journal: as entradas do LOG anteriores à última precisam sobreviver BYTE A BYTE.
  // Sem isto, Write reescrevia o corpo de entradas antigas que o Edit nega (furo no append-only TIER-0).
  if (base === 'journal.md' && tool === 'Write') {
    const txt = norm(readSafe(path.resolve(fp)));
    const frozen = frozenLogRegion(txt);
    if (frozen && !norm(String(ti.content || '')).includes(frozen)) {
      deny(tr(LANG, `[guard-write] BLOQUEADO (TIER-0): o LOG do journal é append-only — este Write altera ou remove entradas antigas do ## LOG. Caminho correto: edite o SNAPSHOT/última entrada com Edit e adicione entradas novas via node scripts/specctl.mjs log <id> <tipo> "título".`, `[guard-write] BLOCKED (TIER-0): the journal LOG is append-only — this Write changes or removes old ## LOG entries. Correct path: edit the SNAPSHOT/last entry with Edit and add new entries via node scripts/specctl.mjs log <id> <type> "title".`));
    }
  }
  if (base === 'journal.md' && tool !== 'Write') {
    const olds = tool === 'MultiEdit' && Array.isArray(ti.edits) ? ti.edits.map((e) => e.old_string || '') : [ti.old_string || ''];
    const txt = readSafe(path.resolve(fp));
    if (txt) {
      const logIdx = txt.indexOf('## LOG');
      if (logIdx >= 0) {
        // checagem POR POSIÇÃO: nega qualquer old_string que comece dentro da região do LOG
        // anterior à última entrada (cobre fragmentos de heading e corpos de entradas antigas).
        // A última entrada e o SNAPSHOT permanecem editáveis.
        const headRe = /^## \d{4}-\d{2}-\d{2} \d{2}:\d{2} — .*$/gm;
        let lastIdx = -1;
        let m;
        while ((m = headRe.exec(txt)) !== null) { if (m.index > logIdx) lastIdx = m.index; }
        if (lastIdx >= 0) {
          for (const oldS of olds) {
            if (!oldS) continue;
            const posOld = txt.indexOf(oldS);
            if (posOld < 0) continue; // old_string inexistente no arquivo: não nega — o Edit falha sozinho
            if (posOld > logIdx && posOld < lastIdx) {
              deny(tr(LANG, `[guard-write] BLOQUEADO (TIER-0): o LOG do journal é append-only — proibido editar entradas antigas (trecho '${truncate(oldS, 60)}' está antes da última entrada do LOG). Caminho correto: adicione uma NOVA entrada '## ${now()} — [tipo] ...' ao FINAL do arquivo (o SNAPSHOT e a última entrada podem ser editados).`, `[guard-write] BLOCKED (TIER-0): the journal LOG is append-only — editing old entries is forbidden (excerpt '${truncate(oldS, 60)}' is before the last LOG entry). Correct path: add a NEW entry via node scripts/specctl.mjs log <id> <type> "title" (the SNAPSHOT and the last entry can be edited).`));
            }
          }
        }
      }
    }
  }
  // sinal de contexto (não-bloqueante) — só depois de TODOS os gates permitirem a escrita
  if (gated) {
    const sug = maybeSuggestCompact(input, root);
    if (sug) out(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: sug } }));
  }
  process.exit(0);
}

function cmdStampCheck() {
  const input = readStdinJson();
  if (!input) process.exit(0);
  const ti = input.tool_input || {};
  const fp = ti.file_path;
  if (!fp || !exists(fp)) process.exit(0);
  const abs = path.resolve(fp);
  const root = hookRoot(fp);
  const rel = root ? relOf(root, abs) : path.basename(abs);
  let buf;
  try { buf = fs.readFileSync(abs); } catch { process.exit(0); }
  if (buf.length > 2 * 1024 * 1024 || buf.includes(0)) process.exit(0); // binário/grande: ignora
  let txt = buf.toString('utf8');
  // 1) resolve {{NOW}} — só em docs/ e entrypoints (não corromper templates de código do projeto)
  const eligible = root && (rel.startsWith('docs/') || ['CLAUDE.md', 'AGENTS.md'].includes(rel));
  if (eligible && txt.includes('{{NOW}}')) {
    txt = txt.split('{{NOW}}').join(now());
    writeFile(abs, txt);
    out(tr(LANG, `[stamp-check] {{NOW}} resolvido para ${now()} em ${rel}`, `[stamp-check] {{NOW}} resolved to ${now()} in ${rel}`));
  }
  // 2) timestamps novos ±24h (warn stdout)
  const underDocs = !!root && rel.startsWith('docs/');
  let newText = '';
  if (typeof ti.new_string === 'string') newText = ti.new_string;
  else if (Array.isArray(ti.edits)) newText = ti.edits.map((e) => e.new_string || '').join('\n');
  // Write sob docs/: valida o content COMPLETO (timestamps inventados no início também contam — R.6)
  else if (typeof ti.content === 'string') newText = underDocs ? ti.content : ti.content.split(/\r?\n/).slice(-40).join('\n');
  else if (underDocs) newText = txt; // Write sob docs/ sem content no payload: valida o arquivo inteiro
  const oldText = typeof ti.old_string === 'string' ? ti.old_string : (Array.isArray(ti.edits) ? ti.edits.map((e) => e.old_string || '').join('\n') : '');
  const drift = [];
  for (const m of newText.matchAll(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/g)) {
    if (oldText.includes(m[0]) || drift.includes(m[0])) continue;
    const t = parseTs(m[0]);
    if (t && Math.abs(t.getTime() - Date.now()) > 24 * 3600 * 1000) drift.push(m[0]);
  }
  if (drift.length) out(tr(LANG, `[stamp-check] AVISO (R.6): timestamp(s) fora de ±24h do relógio (NOW=${now()}): ${drift.slice(0, 3).join(', ')} — use {{NOW}} ou o NOW injetado, nunca invente data.`, `[stamp-check] WARNING (R.6): timestamp(s) outside ±24h of the clock (NOW=${now()}): ${drift.slice(0, 3).join(', ')} — use {{NOW}} or the injected NOW, never invent a date.`));
  // 3) secret-scan no arquivo tocado (deny-feedback = exit 2) — escopo R.15: docs/ e entrypoints.
  // Código do projeto fica de fora: URL local tipo postgres://postgres:postgres@localhost bloqueava TODA edição.
  const hits = eligible ? scanSecrets(txt) : [];
  if (hits.length) {
    const h = hits[0];
    deny(tr(LANG, `[stamp-check] SEGREDO detectado (${h.tipo}, linha ${h.line}) em ${rel}. R.15: docs NUNCA guardam segredos — substitua AGORA por <REDACTED:${h.tipo}> e ROTACIONE a credencial exposta (exceção auditada ao append-only cobre a remediação).`, `[stamp-check] SECRET detected (${h.tipo}, line ${h.line}) in ${rel}. R.15: docs NEVER hold secrets — replace it NOW with <REDACTED:${h.tipo}> and ROTATE the exposed credential (the audited append-only exception covers the remediation).`));
  }
  process.exit(0);
}

function cmdSessionClose() {
  const input = readStdinJson();
  if (input && input.stop_hook_active) process.exit(0); // avisa UMA vez
  const root = setLang(findRoot(process.cwd()));
  if (!root) process.exit(0);
  const act = activeSpecs(root);
  if (!act.length) process.exit(0);
  // spawnSync direto: o stdout NÃO pode ser trimado (o 1º caractere de status pode ser espaço)
  // -uall: pasta nova não-rastreada (SPEC recém-criada) aparece arquivo a arquivo — senão o journal.md dela some numa linha "?? dir/"
  const st = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8' });
  if (st.error || st.status !== 0) {
    process.stderr.write(tr(LANG, `[session-close] AVISO: git status falhou: ${(st.stderr || (st.error && st.error.message) || '').trim()} — verificação de journal pulada\n`, `[session-close] WARNING: git status failed: ${(st.stderr || (st.error && st.error.message) || '').trim()} — journal check skipped\n`));
    process.exit(0);
  }
  const changed = (st.stdout || '').split('\n').filter((l) => l.trim()).map((l) => {
    let p = l.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ')[1];
    return p.replace(/^"|"$/g, '');
  });
  const codeChanged = changed.some((p) => !p.startsWith('docs/') && !p.startsWith('.scratch/') && !p.startsWith('.claude/'));
  const journalChanged = act.some((s) => changed.includes(`docs/active/${s.id}/journal.md`));
  if (codeChanged && !journalChanged) {
    out(JSON.stringify({
      decision: 'block',
      reason: tr(LANG, `Código alterado nesta sessão sem atualização do journal da SPEC ativa (R.6.1). Antes de encerrar: sobrescreva o SNAPSHOT e adicione uma entrada datada ao LOG em docs/active/${act[0].id}/journal.md — ou registre por que não se aplica.`, `[session-close] Code changed in this session without updating the active SPEC's journal (R.6.1). Before ending: overwrite the SNAPSHOT and add a LOG entry (node scripts/specctl.mjs log ${act[0].id} <type> "title") in docs/active/${act[0].id}/journal.md — or record why it does not apply.`),
    }));
  }
  process.exit(0);
}

// ---------------------------------------------------------------- self-test

const SELF = path.resolve(process.argv[1]);
function runCli(cwd, args, input) {
  const r = spawnSync(process.execPath, [SELF, ...args], { cwd, encoding: 'utf8', input });
  return { code: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function stManifest() {
  return JSON.stringify({
    schema: SCHEMA, template_revision: VERSION, installed_at: '2026-01-01 10:00',
    policy: 'standard', interop: 'none', product: null,
    commands: { test: '', typecheck: '', lint: '', dev: '', e2e: '' },
  }, null, 2) + '\n';
}
function stBase(tmp, name) {
  const root = P(tmp, name);
  for (const d of ['features', 'active', 'future', 'archive', 'discard', 'claims', 'programs']) {
    fs.mkdirSync(P(root, 'docs', d), { recursive: true });
  }
  fs.mkdirSync(P(root, '.scratch'), { recursive: true });
  writeFile(P(root, 'docs', '.spec-system.json'), stManifest());
  writeFile(P(root, 'docs', 'TAXONOMY.md'), '# TAXONOMY\n\n- core — núcleo do sistema (aliases proibidos: nucleo→core)\n');
  writeFile(P(root, 'docs', 'RULES.md'), '# RULES (fixture)\n\nNúcleo mínimo para self-test.\n');
  const g = gitRun(['init', '-q'], root);
  if (!g.ok) process.stderr.write(`[self-test] AVISO: git init falhou (${g.err}) — fixtures seguem sem git\n`);
  return root;
}
function stFeatureCore(concludedPrefix, extraLine = '') {
  return `# Feature: core

**Keywords:** núcleo, base
**Arquivos principais:**
  - src/core.ts
**Resumo:** Núcleo do sistema de exemplo do self-test.
${extraLine}
## Specs desta feature

### Concluídas

${concludedPrefix ? `- ${concludedPrefix}-exemplo-arquivada | 2026-01-12 | \`abc1234\` | Exemplo` : ''}

### Planejadas (future/)

## Estado atual

Estado inicial de exemplo.

## Decisões arquiteturais ativas

- **DEC-20260110-1000-exemplo** (ativa) — decisão de exemplo.

## Alternativas consideradas e rejeitadas

## Gotchas

## Estado congelado (se houver)
`;
}
function stMain(idTs, o = {}) {
  const crits = o.criterios || ['- [ ] critério pendente | verify: `node -e "process.exit(0)"`'];
  return `# SPEC-${idTs}: exemplo

**Status:** ${o.status || 'active'}
**Porte:** ${o.porte || 'M'}
**Owner:** ${o.owner || '@tester'}
**Criada:** ${o.criada || '2026-01-10 10:00'}
**Ativada:** ${o.ativada || '2026-01-10 10:05'}
**Concluída:** ${o.concluida || '—'}
**Pausada em:** ${o.pausada || '—'}
**Commit final:** ${o.commitFinal || '—'}
**Keywords:** exemplo
**Features:** ${o.features || 'core'}
**Branch:** ${o.branch || '—'}
**Programa:** —
**Workspace:** —
**Origem:** self-test
**Resumo:** SPEC de exemplo do self-test.

## Objetivo

Exercitar o lint.

## Escopo

**DENTRO:**
- exemplo

**FORA:**
- resto

## Implementação

Trivial.

## Critério de aceite

${crits.join('\n')}
${o.extra || ''}`;
}
function stJournal(idTs, { conclusao = false, snapshotDone = false } = {}) {
  let j = makeJournal(idTs, '2026-01-10 10:05');
  // snapshotDone: simula um SNAPSHOT sobrescrito (SPEC pronta para fechar) — sem placeholders do template
  if (snapshotDone) j = j.replace('início — nada feito ainda', 'feature entregue').replace('<primeiro passo concreto>', '—').replace('<fase>', 'impl');
  j += '\n## 2026-01-10 10:05 — [ativação] SPEC ativada\n';
  if (conclusao) j += '\n## 2026-01-12 12:00 — [conclusão] Entregue\n';
  return j;
}
const ST_ARCH = '20260110-1000';
const ST_ACT = '20260601-0900';
function stArchiveSpec(root, { digest = 'ok', criterios, journal } = {}) {
  const id = `SPEC-${ST_ARCH}-exemplo-arquivada`;
  const dir = P(root, 'docs', 'archive', id);
  writeFile(P(dir, 'main.md'), stMain(ST_ARCH, {
    status: 'done', concluida: '2026-01-12 12:00', commitFinal: '`abc1234`',
    criterios: criterios || ['- [x] Funciona de ponta a ponta (2026-01-12 11:50, commit `abc1234`, verify: exit 0)'],
  }));
  writeFile(P(dir, 'journal.md'), journal || stJournal(ST_ARCH, { conclusao: true }));
  if (digest === 'ok') writeFile(P(dir, 'digest.md'), '# Digest\n\nObjetivo: exemplo. Entregue: núcleo. Decisões: nenhuma. Gotchas: nenhum.\nCommits: `abc1234`.\n');
  else if (digest === 'big') writeFile(P(dir, 'digest.md'), '# Digest\n\n' + 'x'.repeat(2100) + '\n');
  return id;
}
function stActiveSpec(root, { criterios, porte } = {}) {
  const id = `SPEC-${ST_ACT}-exemplo-ativa`;
  const dir = P(root, 'docs', 'active', id);
  writeFile(P(dir, 'main.md'), stMain(ST_ACT, { status: 'active', criterios, porte }));
  writeFile(P(dir, 'journal.md'), stJournal(ST_ACT));
  writeFile(P(root, 'docs', 'claims', `${id}.md`), makeClaim({ id, title: 'exemplo', owner: '@tester', branch: 'feature/x', features: 'core', ativada: '2026-01-10 10:05' }));
  return id;
}
// commit de fixture (identidade local, sem gpg/hooks) — retorna false se git indisponível
function stGitCommit(root) {
  if (!isDir(P(root, '.git'))) return false;
  gitRun(['config', 'user.email', 'selftest@example.com'], root);
  gitRun(['config', 'user.name', 'selftest'], root);
  if (!gitRun(['add', '-A'], root).ok) return false;
  return gitRun(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'fixture'], root).ok;
}
// branch de feature (não-main) p/ exercitar guards sob docs/active/ sem esbarrar em R.2
function stFeatureBranch(root) {
  if (!isDir(P(root, '.git'))) return false;
  return gitRun(['checkout', '-q', '-b', 'feature/x'], root).ok;
}
// ---- fixtures EN (v4.2 bilíngue)
function stLangEn(root) {
  const man = JSON.parse(read(P(root, 'docs', '.spec-system.json')));
  man.lang = 'en';
  writeFile(P(root, 'docs', '.spec-system.json'), JSON.stringify(man, null, 2) + '\n');
}
function stFeatureCoreEn(concludedPrefix) {
  return `# Feature: core

**Keywords:** core, base
**Main files:**
  - src/core.ts
**Summary:** Core of the self-test example system.

## Specs for this feature

### Completed

${concludedPrefix ? `- ${concludedPrefix}-example | 2026-01-12 | \`abc1234\` | Example` : ''}

### Planned (future/)

## Current state

Initial example state.

## Active architectural decisions

- **DEC-20260110-1000-example** (active) — example decision.

## Gotchas
`;
}
function stMainEn(idTs, o = {}) {
  const crits = o.criterios || ['- [ ] pending criterion | verify: `node -e "process.exit(0)"`'];
  return `# SPEC-${idTs}: example

**Status:** ${o.status || 'active'}
**Size:** ${o.porte || 'M'}
**Owner:** @tester
**Created:** 2026-01-10 10:00
**Activated:** 2026-01-10 10:05
**Completed:** —
**Paused at:** —
**Final commit:** —
**Keywords:** example
**Features:** core
**Branch:** feature/x
**Program:** —
**Workspace:** —
**Origin:** self-test
**Summary:** Self-test example SPEC.

## Goal

Exercise the lint.

## Scope

**IN:**
- example

**OUT:**
- the rest

## Implementation

Trivial.

## Acceptance criteria

${crits.join('\n')}
`;
}
// manifesto v4.0.0: os denies novos (LOG-append, verify-spoof, guard-read specctl) ficam DESATIVADOS
function stManifest40(root) {
  writeFile(P(root, 'docs', '.spec-system.json'), JSON.stringify({
    schema: SCHEMA, template_revision: '4.0.0', installed_at: '2026-01-01 10:00',
    policy: 'standard', interop: 'none', product: null,
    commands: { test: '', typecheck: '', lint: '', dev: '', e2e: '' },
  }, null, 2) + '\n');
}
// SPEC ativa com id arbitrário (várias na mesma fixture) — main+journal+claim
function stActiveSpecId(root, idTs, slug, o = {}) {
  const id = `SPEC-${idTs}-${slug}`;
  const dir = P(root, 'docs', 'active', id);
  writeFile(P(dir, 'main.md'), stMain(idTs, { status: 'active', ...o }));
  writeFile(P(dir, 'journal.md'), o.journal || stJournal(idTs));
  writeFile(P(root, 'docs', 'claims', `${id}.md`), makeClaim({ id, title: slug, owner: '@tester', branch: 'feature/x', features: o.features || 'core', ativada: '2026-01-10 10:05' }));
  return id;
}

function cmdSelfTest() {
  const tmp = P(os.tmpdir(), `specctl-selftest-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmp, { recursive: true });
  const results = [];
  const fixture = (name, fn) => {
    try { fn(); results.push([name, true, '']); }
    catch (e) { results.push([name, false, e.message]); }
  };
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
  const expectRun = (r, code, substr, label) => {
    expect(r.code === code, `${label}: exit ${r.code} (esperado ${code}) — saída: ${truncate(r.out, 400)}`);
    if (substr) expect(r.out.includes(substr), `${label}: saída sem "${substr}" — saída: ${truncate(r.out, 400)}`);
  };

  fixture('valido', () => {
    const root = stBase(tmp, 'valido');
    stArchiveSpec(root);
    stActiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    expectRun(runCli(root, ['index']), 0, null, 'index');
    expectRun(runCli(root, ['lint']), 0, null, 'lint');
  });
  fixture('checkbox-sem-timestamp', () => {
    const root = stBase(tmp, 'cb-sem-ts');
    stActiveSpec(root, { criterios: ['- [x] Feito sem carimbo'] });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    expectRun(runCli(root, ['lint']), 1, 'sem timestamp', 'lint');
  });
  fixture('future-malformada', () => {
    const root = stBase(tmp, 'future-mal');
    const id = 'SPEC-20260501-1200-rascunho';
    writeFile(P(root, 'docs', 'future', id, 'main.md'), stMain('20260501-1200', { status: 'active' }));
    expectRun(runCli(root, ['lint']), 1, 'coerência pasta↔status', 'lint');
  });
  fixture('archive-criterio-aberto', () => {
    const root = stBase(tmp, 'arch-aberto');
    stArchiveSpec(root, {
      criterios: [
        '- [x] Feito (2026-01-12 11:50, commit `abc1234`, verify: exit 0)',
        '- [ ] Ficou de fora sem aceite',
      ],
    });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    expectRun(runCli(root, ['lint']), 1, 'aceito-incompleto', 'lint');
  });
  fixture('archive-sem-digest', () => {
    const root = stBase(tmp, 'arch-sem-digest');
    stArchiveSpec(root, { digest: 'none' });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    expectRun(runCli(root, ['lint']), 1, 'digest.md', 'lint');
  });
  fixture('discard-legitimo', () => {
    const root = stBase(tmp, 'discard-ok');
    const id = 'SPEC-20260301-1500-abandonada';
    const dir = P(root, 'docs', 'discard', id);
    writeFile(P(dir, 'main.md'), stMain('20260301-1500', {
      status: 'discarded', criterios: ['- [ ] não implementado'],
      extra: '\n## Justificativa de descarte\n\nAbordagem substituída por lib pronta (2026-03-02 09:00).\n',
    }));
    writeFile(P(dir, 'journal.md'), stJournal('20260301-1500', { conclusao: true }));
    writeFile(P(dir, 'digest.md'), '# Digest\n\nDescartada: lib pronta cobre o caso. Lição: pesquisar antes.\n');
    expectRun(runCli(root, ['lint']), 0, null, 'lint');
  });
  fixture('segredo-plantado', () => {
    const root = stBase(tmp, 'segredo');
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore('', 'chave usada: AKIAIOSFODNN7EXAMPLE\n'));
    expectRun(runCli(root, ['lint']), 1, 'segredo detectado', 'lint');
  });
  fixture('deps-ciclicas', () => {
    const root = stBase(tmp, 'deps-ciclo');
    const a = 'SPEC-20260401-1000-no-a';
    const b = 'SPEC-20260401-1100-no-b';
    writeFile(P(root, 'docs', 'future', a, 'main.md'), stMain('20260401-1000', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'future', b, 'main.md'), stMain('20260401-1100', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'programs', 'alpha.md'), `# Programa: alpha\n\n**Owner:** @tester\n\n- ${a} | depende de: ${b}\n- ${b} | depende de: ${a}\n`);
    expectRun(runCli(root, ['audit', '--deps']), 1, 'ciclo', 'audit --deps');
  });
  fixture('budget-estourado', () => {
    const root = stBase(tmp, 'budget');
    stArchiveSpec(root, { digest: 'big' });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    expectRun(runCli(root, ['lint']), 1, 'orçamento excedido', 'lint');
  });
  fixture('guard-read-nega', () => {
    const root = stBase(tmp, 'guard-read');
    stActiveSpec(root);
    const bid = 'SPEC-20260201-0800-pausada';
    writeFile(P(root, 'docs', 'future', bid, 'main.md'), stMain('20260201-0800', { status: 'paused', pausada: '2026-02-02 10:00 — aguardando API' }));
    writeFile(P(root, 'docs', 'future', bid, 'journal.md'), stJournal('20260201-0800'));
    const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: P(root, 'docs', 'future', bid, 'journal.md') } });
    expectRun(runCli(root, ['guard-read'], payload), 2, 'R.8', 'guard-read deny');
  });
  fixture('guard-read-allowlist', () => {
    const root = stBase(tmp, 'guard-allow');
    const aid = stActiveSpec(root);
    const bid = 'SPEC-20260201-0800-pausada';
    writeFile(P(root, 'docs', 'future', bid, 'main.md'), stMain('20260201-0800', { status: 'paused', pausada: '2026-02-02 10:00 — aguardando API' }));
    writeFile(P(root, 'docs', 'future', bid, 'journal.md'), stJournal('20260201-0800'));
    writeFile(P(root, 'docs', 'active', aid, '.allow-read'), bid + '\n');
    const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: P(root, 'docs', 'future', bid, 'journal.md') } });
    expectRun(runCli(root, ['guard-read'], payload), 0, null, 'guard-read allowlist');
  });
  fixture('guard-write-index-gerado', () => {
    const root = stBase(tmp, 'guard-idx');
    const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: P(root, 'docs', 'INDEX.md'), content: 'x' } });
    expectRun(runCli(root, ['guard-write'], payload), 2, 'specctl.mjs index', 'guard-write INDEX');
  });
  fixture('guard-write-temporario', () => {
    const root = stBase(tmp, 'guard-tmp');
    const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: P(root, 'saida.log'), content: 'log' } });
    expectRun(runCli(root, ['guard-write'], payload), 2, 'tmp/', 'guard-write temp');
  });
  fixture('guard-write-suggest-compact', () => {
    const root = stBase(tmp, 'guard-ctx');
    const sid = `st-${crypto.randomBytes(4).toString('hex')}`;
    const tp = P(tmp, `transcript-${sid}.jsonl`);
    writeFile(tp, JSON.stringify({ message: { model: 'claude-opus-4-8', usage: { input_tokens: 150000, cache_read_input_tokens: 25000, cache_creation_input_tokens: 1000 } } }) + '\n');
    const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: P(root, 'docs', 'nota.md'), content: 'oi' }, transcript_path: tp, session_id: sid });
    const r = runCli(root, ['guard-write'], payload);
    expectRun(r, 0, 'additionalContext', 'guard-write sugere compact acima do limiar');
    expect(r.out.includes('[contexto]'), 'guard-write: mensagem [contexto] ausente');
    const r2 = runCli(root, ['guard-write'], payload);
    expectRun(r2, 0, null, 'guard-write mesmo bucket');
    expect(!r2.out.includes('additionalContext'), 'guard-write: re-sugeriu no MESMO bucket (estado por sessão falhou)');
    // manifesto com context_window=1M: 176k < 250k (limiar 1M) → silêncio, mesmo sem marcador [1m]
    const manFp = P(root, 'docs', '.spec-system.json');
    const man = JSON.parse(read(manFp));
    man.context_window = 1000000;
    writeFile(manFp, JSON.stringify(man, null, 2));
    const sid3 = `st-${crypto.randomBytes(4).toString('hex')}`;
    const payload3 = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: P(root, 'docs', 'nota.md'), content: 'oi' }, transcript_path: tp, session_id: sid3 });
    const r3 = runCli(root, ['guard-write'], payload3);
    expectRun(r3, 0, null, 'guard-write janela do manifesto');
    expect(!r3.out.includes('additionalContext'), 'guard-write: ignorou context_window do manifesto (sugeriu a 176k numa janela 1M)');
  });
  fixture('stamp-check-now', () => {
    const root = stBase(tmp, 'stamp');
    const fp = P(root, 'docs', 'nota.md');
    writeFile(fp, 'Atualizado: {{NOW}}\n');
    const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: fp, content: 'Atualizado: {{NOW}}\n' } });
    expectRun(runCli(root, ['stamp-check'], payload), 0, null, 'stamp-check');
    expect(!read(fp).includes('{{NOW}}'), 'stamp-check: {{NOW}} não foi substituído');
    expect(TS_RE.test(read(fp)), 'stamp-check: timestamp ausente após substituição');
  });
  fixture('next-programa', () => {
    const root = stBase(tmp, 'next-prog');
    // nó raiz done (arquivado), nó pronto (draft, dep done) e nó bloqueado (draft, dep no nó pronto)
    const raiz = 'SPEC-20260401-0900-no-raiz';
    const pronto = 'SPEC-20260401-1000-no-pronto';
    const blk = 'SPEC-20260401-1100-no-bloqueado';
    writeFile(P(root, 'docs', 'archive', raiz, 'main.md'), stMain('20260401-0900', { status: 'done', concluida: '2026-04-02 10:00', commitFinal: '`abc1234`' }));
    writeFile(P(root, 'docs', 'archive', raiz, 'journal.md'), stJournal('20260401-0900', { conclusao: true }));
    writeFile(P(root, 'docs', 'archive', raiz, 'digest.md'), '# Digest\n\nRaiz concluída.\n');
    writeFile(P(root, 'docs', 'future', pronto, 'main.md'), stMain('20260401-1000', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'future', blk, 'main.md'), stMain('20260401-1100', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'programs', 'demo.md'), `# Programa: demo\n\n**Owner:** @tester\n\n- ${pronto} | depende de: ${raiz}\n- ${blk} | depende de: ${pronto}\n`);
    const r = runCli(root, ['next']);
    expectRun(r, 0, '▶ pronto', 'next');
    expect(r.out.includes(pronto), `next: nó pronto ausente — saída: ${truncate(r.out, 400)}`);
    expect(r.out.includes('🔒') && r.out.includes(blk), `next: nó bloqueado ausente — saída: ${truncate(r.out, 400)}`);
    expect(r.out.includes(`aguarda ${pronto}`), `next: motivo do bloqueio ausente — saída: ${truncate(r.out, 400)}`);
  });
  fixture('next-roadmap', () => {
    const root = stBase(tmp, 'next-roadmap');
    const r1 = 'SPEC-20260501-1000-avulsa-um';
    const r2 = 'SPEC-20260502-1000-avulsa-dois';
    writeFile(P(root, 'docs', 'future', r1, 'main.md'), stMain('20260501-1000', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'future', r2, 'main.md'), stMain('20260502-1000', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'ROADMAP.md'), `# ROADMAP\n\n1. ${r1}\n2. ${r2}\n`);
    const r = runCli(root, ['next']);
    expectRun(r, 0, 'ROADMAP', 'next');
    expect(r.out.includes(`▶ próximo:  ${r1}`), `next: topo do roadmap ausente — saída: ${truncate(r.out, 400)}`);
    expect(r.out.includes('· depois:') && r.out.includes(r2), `next: "depois" do roadmap ausente — saída: ${truncate(r.out, 400)}`);
  });
  fixture('programs-index', () => {
    const root = stBase(tmp, 'prog-index');
    const raiz = 'SPEC-20260601-0900-idx-raiz';
    const filho = 'SPEC-20260601-1000-idx-filho';
    const feito = 'SPEC-20260601-0800-idx-feito';
    writeFile(P(root, 'docs', 'archive', feito, 'main.md'), stMain('20260601-0800', { status: 'done' }));
    writeFile(P(root, 'docs', 'future', raiz, 'main.md'), stMain('20260601-0900', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'future', filho, 'main.md'), stMain('20260601-1000', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'programs', 'demo.md'), `# Programa: demo\n\n**Owner:** @tester\n\n- ${feito} | depende de: —\n- ${raiz} | depende de: —\n- ${filho} | depende de: ${raiz}\n`);
    expectRun(runCli(root, ['index']), 0, 'PROGRAMS.md', 'index');
    const p = P(root, 'docs', 'PROGRAMS.md');
    expect(exists(p), 'programs-index: docs/PROGRAMS.md não foi gerado');
    const first = read(p);
    expect(first.includes(GERADO_MARK), 'programs-index: marcador GERADO ausente');
    expect(first.includes('## demo — aberto · 1/3 · owner @tester'), `programs-index: cabeçalho do bloco incorreto — saída: ${truncate(first, 400)}`);
    expect(first.includes(`- prontos: ${raiz}`), `programs-index: linha "prontos" ausente — saída: ${truncate(first, 400)}`);
    expect(first.includes(`- bloqueados: ${filho} (aguarda ${raiz})`), `programs-index: linha "bloqueados" ausente — saída: ${truncate(first, 400)}`);
    expect(first.includes(`- concluídos: ${feito}`), `programs-index: linha "concluídos" ausente — saída: ${truncate(first, 400)}`);
    runCli(root, ['index']); // regenera
    expect(read(p) === first, 'programs-index: regeneração NÃO é idempotente (diff no PROGRAMS.md)');
    // nó PAUSADO aparece na linha própria (visível, não pegável) — e no next com ⏸
    const pausado = 'SPEC-20260601-1100-idx-pausado';
    writeFile(P(root, 'docs', 'future', pausado, 'main.md'), stMain('20260601-1100', { status: 'paused', pausada: '2026-06-02 09:00 — aguardando API' }));
    writeFile(P(root, 'docs', 'future', pausado, 'journal.md'), stJournal('20260601-1100'));
    writeFile(P(root, 'docs', 'programs', 'demo.md'), `# Programa: demo\n\n**Owner:** @tester\n\n- ${feito} | depende de: —\n- ${raiz} | depende de: —\n- ${filho} | depende de: ${raiz}\n- ${pausado} | depende de: —\n`);
    expectRun(runCli(root, ['index']), 0, null, 'index com pausado');
    const second = read(p);
    expect(second.includes(`- pausados: ${pausado} (retomar: specctl resume)`), `programs-index: linha "pausados" ausente — saída: ${truncate(second, 400)}`);
    const rn = runCli(root, ['next']);
    expect(rn.out.includes('⏸ pausado') && rn.out.includes(pausado), `next: nó pausado ausente — saída: ${truncate(rn.out, 400)}`);
  });
  fixture('log-scribe', () => {
    const root = stBase(tmp, 'log-scribe');
    const id = stActiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    expect(stGitCommit(root), 'git commit indisponível na fixture');
    const bad = runCli(root, ['log', id, 'tipoerrado', 'x']);
    expectRun(bad, 1, 'tipo inválido', 'log tipo inválido');
    expect(bad.out.includes(LOG_TYPES.join(' | ')), `gramática completa ausente no erro — saída: ${truncate(bad.out, 300)}`);
    expect(bad.out.includes('PowerShell') && bad.out.includes('EOF'), 'erro sem exemplos heredoc/here-string');
    const multi = runCli(root, ['log', id, 'nota', 'linha1\nlinha2']);
    expectRun(multi, 1, 'single-line', 'log título multilinha');
    const r = runCli(root, ['log', id, 'decisão', 'Optamos por X', '--stdin'], 'porque Y\r\nlinha dois\n');
    expectRun(r, 0, '[decisão] Optamos por X', 'log grava');
    expect(r.out.includes('porque Y'), `eco do corpo ausente — saída: ${truncate(r.out, 300)}`);
    expect(r.out.trim().split('\n').length <= 2, `eco acima de 2 linhas — saída: ${truncate(r.out, 300)}`);
    const j = norm(read(P(root, 'docs', 'active', id, 'journal.md')));
    expect(/— \[decisão\] Optamos por X\n\nporque Y\nlinha dois\n⎿ commit [0-9a-f]+/.test(j), `entrada/rodapé fora do formato — fim do journal: ${truncate(j.slice(-260), 260)}`);
    expect(!j.includes('\r'), 'CRLF não normalizado no corpo');
  });
  fixture('check-estampa', () => {
    const root = stBase(tmp, 'check');
    const id = stActiveSpec(root, {
      criterios: [
        '- [ ] validado manualmente com o usuário',
        '- [ ] roda ponta a ponta | verify: `node -e "process.exit(0)"`',
      ],
    });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    expect(stGitCommit(root), 'git commit indisponível na fixture');
    const rec = runCli(root, ['check', id, '2']);
    expectRun(rec, 1, 'rota: node scripts/specctl.mjs verify', 'check recusa critério com verify:');
    const r = runCli(root, ['check', id, '1', '--evidence', 'aprovado pelo usuário']);
    expectRun(r, 0, '[x] validado manualmente', 'check estampa');
    const line = norm(read(P(root, 'docs', 'active', id, 'main.md'))).split('\n').find((l) => l.includes('validado manualmente'));
    expect(/^- \[x\] validado manualmente com o usuário \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}, commit `[0-9a-f]+`, evidence: aprovado pelo usuário\)$/.test(line), `estampa incorreta: ${line}`);
    expect(!line.includes('verify:'), 'check escreveu o token verify:');
  });
  fixture('digest-gera-e-cap', () => {
    const root = stBase(tmp, 'digest');
    const id = stActiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    const r = runCli(root, ['digest', id]);
    expectRun(r, 0, '# Digest — SPEC-', 'digest gera');
    const dg = P(root, 'docs', 'active', id, 'digest.md');
    expect(exists(dg), 'digest.md não gravado');
    expect(digestMeasure(read(dg)) <= 2000, `digest acima de 2000B (LF, HTML descontado): ${digestMeasure(read(dg))}`);
    expect(read(dg).includes(DIGEST_STUB_NOTE), 'stub auto-doc do cap ausente no digest gerado');
    const big = runCli(root, ['digest', id, '--stdin'], '# Digest\n\n' + 'x'.repeat(2100) + '\n');
    expectRun(big, 1, 'corte ~', 'digest --stdin acima do cap');
    expect(/\d+B > 2000B/.test(big.out), `mensagem acionável ausente — saída: ${truncate(big.out, 300)}`);
    const ok = runCli(root, ['digest', id, '--stdin'], '# Digest\n\nresumo curto refinado.\n');
    expectRun(ok, 0, 'digest gravado', 'digest --stdin dentro do cap');
    expect(read(dg).includes('refinado'), 'digest --stdin não sobrescreveu');
  });
  fixture('rollup-orcamento', () => {
    const root = stBase(tmp, 'rollup');
    const filler = 'linha de contexto acumulado que ocupa espaço no arquivo da feature. '.repeat(11);
    let deltas = '';
    for (let i = 1; i <= 12; i++) deltas += `- SPEC-202601${String(i).padStart(2, '0')}-1000 — delta ${i}: ${filler}\n`;
    writeFile(P(root, 'docs', 'features', 'core.md'), `# Feature: core

**Keywords:** núcleo, base
**Resumo:** Núcleo.

## Specs desta feature

### Concluídas

### Planejadas (future/)

## Estado atual

Estado vivo que NÃO pode sair.

### Delta de estado

${deltas}
## Decisões arquiteturais ativas

- **DEC-20260610-1000-viva** (ativa) — decisão viva que NÃO pode sair.

## Alternativas consideradas e rejeitadas

## Gotchas

- SPEC-20251201-0900 — gotcha antigo: ${filler}

## Estado congelado (se houver)
`);
    expect(bytesOf(read(P(root, 'docs', 'features', 'core.md'))) > 8000, 'fixture deve começar acima de 8000B');
    const r = runCli(root, ['rollup', 'core']);
    expectRun(r, 0, 'rollup:', 'rollup');
    const after = norm(read(P(root, 'docs', 'features', 'core.md')));
    expect(bytesOf(after) <= 8000, `feature ainda acima do cap: ${bytesOf(after)}B`);
    expect(after.includes('Estado vivo que NÃO pode sair'), 'rollup tocou "Estado atual"');
    expect(after.includes('decisão viva que NÃO pode sair'), 'rollup tocou "Decisões arquiteturais ativas"');
    expect(after.includes('SPEC-20260112-1000'), 'rollup moveu bloco novo antes dos antigos');
    const hist = P(root, 'docs', 'features', 'core.history.md');
    expect(exists(hist), 'core.history.md não criado');
    const h = norm(read(hist));
    expect(h.includes('SPEC-20251201-0900'), 'bloco mais antigo (gotcha) não foi movido primeiro');
    expect(h.includes('SPEC-20260101-1000'), 'delta mais antigo não movido');
  });
  fixture('escalate-one-way', () => {
    const root = stBase(tmp, 'escalate');
    const id = stActiveSpec(root, { porte: 'P' });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    const up = runCli(root, ['escalate', id, 'G']);
    expectRun(up, 0, 'P → G', 'escalate sobe');
    expect(norm(read(P(root, 'docs', 'active', id, 'main.md'))).includes('**Porte:** G'), 'Porte não atualizado no main.md');
    expect(norm(read(P(root, 'docs', 'active', id, 'journal.md'))).includes('[nota] Porte escalado P → G'), '[nota] de escalação ausente no LOG');
    const down = runCli(root, ['escalate', id, 'M']);
    expectRun(down, 1, 'ONE-WAY', 'escalate nega rebaixamento');
    const noCita = runCli(root, ['deescalate', id, 'M']);
    expectRun(noCita, 1, '--cita', 'deescalate sem --cita nega');
    const de = runCli(root, ['deescalate', id, 'M', '--cita', 'pode simplificar, M basta']);
    expectRun(de, 0, 'G → M', 'deescalate com citação');
    expect(norm(read(P(root, 'docs', 'active', id, 'main.md'))).includes('**Porte:** M'), 'Porte não rebaixado');
    const j = norm(read(P(root, 'docs', 'active', id, 'journal.md')));
    expect(/\[aceito-incompleto: "pode simplificar, M basta" \d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/.test(j), `citação no padrão aceito-incompleto ausente — fim do journal: ${truncate(j.slice(-260), 260)}`);
  });
  fixture('close-pendencias', () => {
    const root = stBase(tmp, 'close-pend');
    const id = stActiveSpec(root, { criterios: ['- [ ] critério manual pendente'] });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    const dry = runCli(root, ['close', id, '--dry']);
    expectRun(dry, 1, 'pendência', 'close --dry lista pendências');
    expect(dry.out.includes(`check ${id} 1`), `rota do check ausente — saída: ${truncate(dry.out, 400)}`);
    expect(dry.out.includes('[conclusão] ausente'), 'pendência de [conclusão] ausente');
    expect(dry.out.includes('R.7'), 'pendência R.7 ausente');
    expect(dry.out.includes('digest.md ausente'), 'pendência de digest ausente');
    expect(bytesOf(dry.out) <= 1300, `checklist --dry acima do orçamento: ${bytesOf(dry.out)}B`);
    const r = runCli(root, ['close', id]);
    expectRun(r, 1, 'pendência', 'close bloqueado imprime o MESMO checklist');
    expect(r.out.includes(`check ${id} 1`), 'checklist do close bloqueado sem rota');
    expect(isDir(P(root, 'docs', 'active', id)), 'close bloqueado NÃO pode mover a SPEC');
  });
  fixture('close-completo', () => {
    const root = stBase(tmp, 'close-ok');
    const id = stActiveSpec(root, { criterios: ['- [ ] roda ponta a ponta | verify: `node -e "process.exit(0)"`'] });
    writeFile(P(root, 'docs', 'active', id, 'journal.md'), stJournal(ST_ACT, { conclusao: true, snapshotDone: true }));
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ACT}`));
    expect(stGitCommit(root), 'git commit indisponível na fixture');
    const dry = runCli(root, ['close', id, '--dry']);
    expectRun(dry, 0, 'pronto: SIM', 'close --dry pronto (só passos automáticos)');
    const r = runCli(root, ['close', id]);
    expectRun(r, 0, 'atestado', 'close completo');
    expect(r.out.includes('verify 1/1'), `atestado sem "verify 1/1" — saída: ${truncate(r.out, 400)}`);
    expect(r.out.includes('nada mais a rodar'), `atestado sem rodapé — saída: ${truncate(r.out, 400)}`);
    expect(r.out.includes('finalização') && r.out.includes('deletar a branch'), `atestado sem menu de finalização git — saída: ${truncate(r.out, 500)}`);
    expect(r.out.trim().split('\n').length <= 30, 'atestado acima de 30 linhas');
    expect(isDir(P(root, 'docs', 'archive', id)), 'SPEC não movida para docs/archive/');
    expect(exists(P(root, 'docs', 'archive', id, 'digest.md')), 'digest não gerado no close');
    expect(exists(P(root, 'docs', 'active', '.gitkeep')), 'docs/active/ sem .gitkeep após close — sumiria em checkout fresco (CI)');
    const main = norm(read(P(root, 'docs', 'archive', id, 'main.md')));
    expect(main.includes('**Status:** done') && /\*\*Commit final:\*\* `[0-9a-f]+`/.test(main), 'Status/Commit final não estampados');
    const again = runCli(root, ['close', id]);
    expectRun(again, 0, 'já está', 'close idempotente');
  });
  fixture('close-snapshot-stale', () => {
    // bug do bench porte-P: SPEC fechada só via scribe deixava o SNAPSHOT no placeholder e o digest herdava "nada feito ainda"
    const root = stBase(tmp, 'close-snap');
    const id = stActiveSpec(root, { criterios: ['- [x] feito (2026-01-12 12:00, commit `abc1234`)'] });
    writeFile(P(root, 'docs', 'active', id, 'journal.md'), stJournal(ST_ACT, { conclusao: true })); // SNAPSHOT = placeholder do template
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ACT}`));
    const dry = runCli(root, ['close', id, '--dry']);
    expectRun(dry, 1, 'SNAPSHOT ainda com placeholder', 'close --dry bloqueia SNAPSHOT stale');
    // ao atualizar o SNAPSHOT, libera; e o digest gerado usa a [conclusão], não o placeholder
    const jp = P(root, 'docs', 'active', id, 'journal.md');
    writeFile(jp, read(jp).replace('início — nada feito ainda', 'entregue').replace('<primeiro passo concreto>', '—').replace('<fase>', 'impl'));
    expect(stGitCommit(root), 'git commit indisponível');
    const r = runCli(root, ['close', id]);
    expectRun(r, 0, 'atestado', 'close libera após SNAPSHOT atualizado');
    const dg = norm(read(P(root, 'docs', 'archive', id, 'digest.md')));
    expect(!/nada feito ainda/.test(dg), `digest herdou placeholder — saída: ${truncate(dg, 300)}`);
  });
  fixture('protected-branch', () => {
    // trabalho sempre em branch própria: new/activate proibidos em branch protegida (main/master/develop/homolog/hmg)
    const root = stBase(tmp, 'prot-branch'); // git init → branch default = main ou master (ambas protegidas)
    if (!stGitCommit(root)) return; // git indisponível: nada a exercitar (mesma postura das demais fixtures git)
    const r = runCli(root, ['new', 'demo', '--porte', 'P']);
    expectRun(r, 1, 'branch protegida', 'new em branch protegida deve morrer');
    expect(r.out.includes('feature/'), 'erro sem rota git checkout -b feature/');
    // em branch de feature: funciona e o claim registra a Base (a branch protegida ancestral)
    expect(stFeatureBranch(root), 'checkout feature/x falhou');
    const r2 = runCli(root, ['new', 'demo', '--porte', 'P']);
    expectRun(r2, 0, 'criada', 'new em feature/x deve funcionar');
    const id = (/(SPEC-\d{8}-\d{4}-demo)/.exec(r2.out) || [])[1];
    const claim = read(P(root, 'docs', 'claims', `${id}.md`));
    expect(/\*\*Base:\*\*\s*\S/.test(claim) && !/\*\*Base:\*\*\s*—/.test(claim), `claim sem Base detectada — ${truncate(claim, 200)}`);
  });
  // ---- Fase 2 (v4.1 comportamento) ----
  fixture('lint-porte-p-verify', () => {
    const root = stBase(tmp, 'lint-p-verify');
    stActiveSpec(root, { porte: 'P', criterios: ['- [ ] roda ponta a ponta | verify: `node -e "0"`'] });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    const r = runCli(root, ['lint']);
    expectRun(r, 1, 'porte P não usa verify', 'lint P com verify: erra');
    expect(r.out.includes('specctl check'), 'erro P-verify sem rota specctl check');
  });
  fixture('makeMain-porte-p-scaffold', () => {
    const root = stBase(tmp, 'mkmain-p');
    const rn = runCli(root, ['new', 'exemplo-p', '--future', '--porte', 'P']);
    expectRun(rn, 0, '— fatos do sistema —', 'new --future P');
    const m = /criada docs\/future\/(SPEC-\S+)/.exec(rn.out);
    expect(m, `id não achado — saída: ${truncate(rn.out, 300)}`);
    const main = norm(read(P(root, 'docs', 'future', m[1], 'main.md')));
    expect(!/\|\s*verify:/.test(main.slice(main.indexOf('## Critério'))), 'scaffold P não deve ter slot verify:');
    expect(main.includes('<!-- P: feche com: node scripts/specctl.mjs check'), 'comentário auto-doc P ausente');
    const rg = runCli(root, ['new', 'exemplo-g', '--future', '--porte', 'G']);
    const mg = /criada docs\/future\/(SPEC-\S+)/.exec(rg.out);
    const mainG = norm(read(P(root, 'docs', 'future', mg[1], 'main.md')));
    expect(/\|\s*verify:/.test(mainG), 'scaffold M/G deve manter slot verify:');
  });
  fixture('guard-read-specctl', () => {
    const root = stBase(tmp, 'gr-specctl');
    const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: P(root, 'scripts', 'specctl.mjs') } });
    const d = runCli(root, ['guard-read'], payload);
    expectRun(d, 2, 'close <id> --dry', 'guard-read nega specctl (4.1.0)');
    expect(d.out.includes('--help'), 'redirect --help ausente');
    stManifest40(root);
    expectRun(runCli(root, ['guard-read'], payload), 0, null, 'guard-read permite specctl em 4.0.0');
  });
  fixture('guard-write-log-append', () => {
    const root = stBase(tmp, 'gw-log');
    stFeatureBranch(root);
    const id = stActiveSpec(root);
    const jp = P(root, 'docs', 'active', id, 'journal.md');
    const anchor = '## LOG (append-only — NUNCA editar entradas antigas)';
    const newEntry = `${anchor}\n\n## ${now()} — [nota] entrada manual do modelo\n\ncorpo qualquer\n`;
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: jp, old_string: anchor, new_string: newEntry } });
    const d = runCli(root, ['guard-write'], payload);
    expectRun(d, 2, 'specctl log', 'guard-write nega LOG-append (4.1.0)');
    expect(d.out.includes('--stdin') && d.out.includes('--body-file'), 'deny sem copy-paste --stdin/--body-file');
    // SNAPSHOT/prosa continuam livres (Edit sem heading de LOG)
    const okSnap = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: jp, old_string: '**Onde tô:** início — nada feito ainda', new_string: '**Onde tô:** avancei bastante' } });
    expectRun(runCli(root, ['guard-write'], okSnap), 0, null, 'guard-write permite edição de SNAPSHOT');
    // com revision 4.0.0: permite o append (repo v4.0 não quebra)
    stManifest40(root);
    expectRun(runCli(root, ['guard-write'], payload), 0, null, 'guard-write permite LOG-append em 4.0.0');
  });
  fixture('guard-write-verify-spoof', () => {
    const root = stBase(tmp, 'gw-spoof');
    stFeatureBranch(root);
    const id = stActiveSpec(root);
    const mp = P(root, 'docs', 'active', id, 'main.md');
    const oldC = '- [ ] critério pendente | verify: `node -e "process.exit(0)"`';
    const spoof = '- [x] critério pendente (2026-01-12 10:00, commit `abc1234`, verify: exit 0) | verify: `node -e "process.exit(0)"`';
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: mp, old_string: oldC, new_string: spoof } });
    const d = runCli(root, ['guard-write'], payload);
    expectRun(d, 2, 'só specctl verify grava evidência', 'guard-write nega verify-spoof (4.1.0)');
    stManifest40(root);
    expectRun(runCli(root, ['guard-write'], payload), 0, null, 'guard-write permite verify-spoof em 4.0.0');
  });
  fixture('brief-agent', () => {
    const root = stBase(tmp, 'brief-agent');
    const id = stActiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    runCli(root, ['index']);
    const r = runCli(root, ['brief', '--agent', id]);
    expectRun(r, 0, `bundle ${id}`, 'brief --agent bundle');
    expect(r.out.includes('== main.md ==') && r.out.includes('== SNAPSHOT'), 'bundle sem main.md/SNAPSHOT');
    expect(r.out.includes('Próximos passos'), 'bundle sem próximos passos');
    expect(r.out.includes('PROIBIDO varrer scripts/specctl.mjs'), 'HARD BAN 5 ausente no bundle');
  });
  fixture('audit-anti-fuga', () => {
    const root = stBase(tmp, 'audit-fuga');
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    stActiveSpecId(root, '20260701-1000', 'porte-p-grande', { porte: 'P', criterios: ['- [ ] c1', '- [ ] c2', '- [ ] c3', '- [ ] c4'] });
    stActiveSpecId(root, '20260701-1100', 'evidencia-spoof', { porte: 'M', criterios: ['- [x] roda (2026-01-12 10:00, commit `abc1234`, verify: exit 0) | verify: `node -e "0"`'] });
    const r = runCli(root, ['audit']);
    expectRun(r, 0, 'sinais de porte M', 'audit anti-fuga: P com >3 critérios');
    expect(r.out.includes('evidência sem rastro'), `audit "evidência sem rastro" ausente — saída: ${truncate(r.out, 500)}`);
  });
  fixture('audit-pr-porte-diff', () => {
    const root = stBase(tmp, 'audit-pr');
    const id = 'SPEC-20260701-1200-pr-diff';
    writeFile(P(root, 'docs', 'active', id, 'main.md'), stMain('20260701-1200', { status: 'active', porte: 'M', criterios: ['- [ ] c1'] }));
    writeFile(P(root, 'docs', 'active', id, 'journal.md'), stJournal('20260701-1200'));
    writeFile(P(root, 'docs', 'claims', `${id}.md`), makeClaim({ id, title: 'pr', owner: '@tester', branch: 'feature/x', features: 'core', ativada: '2026-01-10 10:05' }));
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    expect(stGitCommit(root), 'git commit base indisponível');
    const base = gitRun(['rev-parse', 'HEAD'], root).out;
    // muda Porte SEM entrada de journal + cresce a feature (crescer feature NUNCA bloqueia — sem ratchet)
    writeFile(P(root, 'docs', 'active', id, 'main.md'), stMain('20260701-1200', { status: 'active', porte: 'G', criterios: ['- [ ] c1'] }));
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore('') + '\n' + 'x'.repeat(8500) + '\n');
    expect(stGitCommit(root), 'git commit HEAD indisponível');
    const r = runCli(root, ['audit', '--pr', '--base', base]);
    expectRun(r, 1, 'Porte mudou', 'audit --pr: porte-diff sem journal erra');
    expect(!r.out.includes('ratchet'), `audit --pr NÃO deve mais ratchetar tamanho de feature — saída: ${truncate(r.out, 500)}`);
  });
  fixture('budgets-output', () => {
    const root = stBase(tmp, 'budgets');
    const rn = runCli(root, ['new', 'exemplo-budget', '--future', '--porte', 'P']);
    expectRun(rn, 0, '— fatos do sistema —', 'new imprime bloco JIT');
    const jitN = rn.out.slice(rn.out.indexOf('— fatos do sistema —'));
    expect(bytesOf(jitN) <= 900, `bloco JIT do new acima de 900B: ${bytesOf(jitN)}`);
    const m = /criada docs\/future\/(SPEC-\S+)/.exec(rn.out);
    expect(m, `id do new não achado — saída: ${truncate(rn.out, 300)}`);
    const id = m[1];
    const ra = runCli(root, ['activate', id, '--branch', 'feature/x']);
    expectRun(ra, 0, '— fatos do sistema —', 'activate imprime bloco JIT');
    const jitA = ra.out.slice(ra.out.indexOf('— fatos do sistema —'));
    expect(bytesOf(jitA) <= 900, `bloco JIT do activate acima de 900B: ${bytesOf(jitA)}`);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    const dry = runCli(root, ['close', id, '--dry']);
    expect(bytesOf(dry.out) <= 1200, `close --dry acima de 1200B: ${bytesOf(dry.out)}`);
  });
  fixture('discard-gera-digest', () => {
    const root = stBase(tmp, 'discard-auto');
    stFeatureBranch(root);
    const id = stActiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    const r = runCli(root, ['discard', id, '--motivo', 'abordagem substituída por lib pronta']);
    expectRun(r, 0, 'digest gerado', 'discard gera digest automático (paridade com close)');
    const dg = P(root, 'docs', 'discard', id, 'digest.md');
    expect(exists(dg), 'digest.md não foi criado no discard');
    expect(digestMeasure(read(dg)) <= 2000, 'digest do discard acima de 2000B');
  });
  fixture('reopen-archive-para-active', () => {
    const root = stBase(tmp, 'reopen');
    stFeatureBranch(root);
    const id = stArchiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    const r = runCli(root, ['reopen', id, '--motivo', 'critério 2 aceito sem autorização R.6.2']);
    expectRun(r, 0, 'reaberta', 'reopen move archive->active');
    expect(isDir(P(root, 'docs', 'active', id)), 'SPEC não voltou para docs/active/');
    const main2 = read(P(root, 'docs', 'active', id, 'main.md'));
    expect(/^\*\*Status:\*\* active/m.test(main2), 'Status não voltou a active');
    expect(/^\*\*Reaberta em:\*\*/m.test(main2), 'campo **Reaberta em:** ausente');
    expect(exists(P(root, 'docs', 'claims', `${id}.md`)), 'claim não recriado no reopen');
    const rf = runCli(root, ['reopen', 'SPEC-19990101-0000-inexistente', '--motivo', 'x']);
    expect(rf.code === 1, 'reopen de SPEC inexistente deveria falhar');
  });
  fixture('roadmap-entrada-morta', () => {
    const root = stBase(tmp, 'roadmap-morto');
    stArchiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    writeFile(P(root, 'docs', 'ROADMAP.md'), `# ROADMAP\n\n1. SPEC-${ST_ARCH}-exemplo-arquivada\n2. SPEC-20990101-0000-typo-inexistente\n`);
    const r = runCli(root, ['lint']);
    expect(r.out.includes('NÃO EXISTE'), `lint sem warn de id inexistente no ROADMAP — saída: ${truncate(r.out, 400)}`);
    expect(r.out.includes('já em archive/'), `lint sem warn de entrada morta (arquivada) no ROADMAP — saída: ${truncate(r.out, 400)}`);
  });
  fixture('guard-write-segredo-pre', () => {
    const root = stBase(tmp, 'guard-secret');
    stActiveSpec(root);
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: P(root, 'docs', 'features', 'core.md'), old_string: 'x', new_string: 'chave: AKIAIOSFODNN7EXAMPLE' },
    });
    expectRun(runCli(root, ['guard-write'], payload), 2, 'R.15', 'guard-write nega segredo PRÉ-write');
  });
  fixture('guard-read-grep-archive', () => {
    const root = stBase(tmp, 'guard-grep');
    stActiveSpec(root);
    stArchiveSpec(root);
    const payload = JSON.stringify({ tool_name: 'Grep', tool_input: { pattern: 'x', path: P(root, 'docs', 'archive') } });
    expectRun(runCli(root, ['guard-read'], payload), 2, 'R.8', 'guard-read nega Grep em archive/');
    const free = JSON.stringify({ tool_name: 'Grep', tool_input: { pattern: 'x', path: P(root, 'src') } });
    expectRun(runCli(root, ['guard-read'], free), 0, null, 'Grep fora de docs/ segue livre');
  });
  fixture('team-multi-claim', () => {
    const root = stBase(tmp, 'team-multi');
    // manifesto team: multi
    const man = JSON.parse(read(P(root, 'docs', '.spec-system.json')));
    man.team = 'multi';
    writeFile(P(root, 'docs', '.spec-system.json'), JSON.stringify(man, null, 2) + '\n');
    stFeatureBranch(root);
    // new + activate → coreografia de publicação impressa
    const rn = runCli(root, ['new', 'claim-multi', '--future', '--porte', 'P', '--features', 'core']);
    const id = (/(SPEC-\d{8}-\d{4}-claim-multi)/.exec(rn.out) || [])[1];
    expect(id, `id não extraído — saída: ${truncate(rn.out, 300)}`);
    const ra = runCli(root, ['activate', id, '--branch', 'feature/x']);
    expectRun(ra, 0, 'team: multi', 'activate multi imprime coreografia');
    expect(ra.out.includes(`claim/${id}`) && ra.out.includes('PR trivial'), `coreografia ausente — saída: ${truncate(ra.out, 400)}`);
    // capsule carrega team=multi
    const rc = runCli(root, ['capsule']);
    expect(rc.out.includes('team=multi'), `capsule sem team=multi — saída: ${truncate(rc.out, 200)}`);
    // audit avisa claim não publicado na base (claim só existe na feature/x)
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    expect(stGitCommit(root), 'commit indisponível');
    const rau = runCli(root, ['audit']);
    expect(rau.out.includes('NÃO publicado'), `audit sem aviso de claim não-publicado — saída: ${truncate(rau.out, 400)}`);
    // em solo, mesmo cenário NÃO avisa
    man.team = 'solo';
    writeFile(P(root, 'docs', '.spec-system.json'), JSON.stringify(man, null, 2) + '\n');
    const rau2 = runCli(root, ['audit']);
    expect(!rau2.out.includes('NÃO publicado'), 'audit solo não deveria avisar publicação');
  });
  fixture('deferred-index', () => {
    const root = stBase(tmp, 'deferred');
    stArchiveSpec(root, {
      criterios: [
        '- [x] Feito (2026-01-12 11:50, commit `abc1234`, verify: exit 0)',
        '- [ ] Item deferido [aceito-incompleto: "pode deixar pra v2" 2026-01-12 11:55]',
      ],
    });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    expectRun(runCli(root, ['index']), 0, null, 'index');
    const def = read(P(root, 'docs', 'DEFERRED.md'));
    expect(def.includes('pode deixar pra v2'), 'DEFERRED.md sem a citação do item deferido');
    expect(def.includes(`SPEC-${ST_ARCH}-exemplo-arquivada`), 'DEFERRED.md sem o SPEC-id');
    expectRun(runCli(root, ['lint']), 0, null, 'lint com DEFERRED gerado');
  });

  fixture('fence-nao-esconde-criterio', () => {
    const root = stBase(tmp, 'fence-crit');
    const id = `SPEC-${ST_ARCH}-exemplo-arquivada`;
    const dir = P(root, 'docs', 'archive', id);
    // fence com "# comentário" ANTES de um critério aberto: parser antigo achava que a seção acabou ali
    writeFile(P(dir, 'main.md'), stMain(ST_ARCH, {
      status: 'done', concluida: '2026-01-12 12:00', commitFinal: '`abc1234`',
      criterios: [
        '- [x] Feito (2026-01-12 11:50, commit `abc1234`, verify: exit 0)',
        'Exemplo de uso:',
        '```bash',
        '# roda os testes',
        'npm test',
        '- [x] isto é EXEMPLO dentro do fence, não critério',
        '```',
        '- [ ] critério REAL aberto depois do fence',
      ],
    }));
    writeFile(P(dir, 'journal.md'), stJournal(ST_ARCH, { conclusao: true }));
    writeFile(P(dir, 'digest.md'), '# Digest\n\nok.\n');
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    const r = runCli(root, ['lint']);
    expectRun(r, 1, 'aceito-incompleto', 'lint DEVE ver o critério aberto escondido atrás do fence');
    expect(!r.out.includes('EXEMPLO dentro do fence') || !/aceito-incompleto[^\n]*EXEMPLO/.test(r.out), 'checkbox de exemplo dentro do fence não deveria ser tratado como critério');
  });
  fixture('status-mesmo-minuto', () => {
    const root = stBase(tmp, 'same-minute');
    const a = 'SPEC-20260101-1000-alpha';
    const b = 'SPEC-20260101-1000-beta';
    writeFile(P(root, 'docs', 'archive', a, 'main.md'), stMain('20260101-1000', { status: 'done', concluida: '2026-01-02 12:00', commitFinal: '`abc1234`', criterios: ['- [x] ok (2026-01-02 11:50, commit `abc1234`, verify: exit 0)'] }));
    writeFile(P(root, 'docs', 'archive', a, 'journal.md'), stJournal('20260101-1000', { conclusao: true }));
    writeFile(P(root, 'docs', 'archive', a, 'digest.md'), '# Digest\n\nok.\n');
    writeFile(P(root, 'docs', 'future', b, 'main.md'), stMain('20260101-1000', { status: 'draft', ativada: '—' }));
    writeFile(P(root, 'docs', 'programs', 'gamma.md'), `# Programa: gamma\n\n**Owner:** @tester\n\n- ${a} | depende de: —\n- ${b} | depende de: ${a}\n`);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-20260101-1000`));
    const r = runCli(root, ['next']);
    // com o bug, `a` (done) resolvia o status de `b` (draft) — e b nunca ficava pronto
    expect(r.out.includes(b) && /▶|pronto/i.test(r.out), `nó b deveria estar PRONTO (dep done) — saída: ${truncate(r.out, 300)}`);
  });
  fixture('fence-nao-prova-r7', () => {
    const root = stBase(tmp, 'fence-r7');
    stFeatureBranch(root);
    const id = stActiveSpec(root, { porte: 'P', criterios: ['- [x] Feito (2026-01-10 11:00, commit `abc1234`) — check'] });
    // SPEC-id só DENTRO de fence na seção Concluídas — não pode contar como R.7
    writeFile(P(root, 'docs', 'features', 'core.md'), `# Feature: core

**Keywords:** núcleo
**Arquivos principais:**
  - src/core.ts
**Resumo:** exemplo.

## Specs desta feature

### Concluídas

\`\`\`
- ${id} | formato de exemplo, não é entrada real
\`\`\`

## Estado atual

x

## Decisões arquiteturais ativas

## Gotchas
`);
    const r = runCli(root, ['close', id, '--dry']);
    expect(r.code === 1 && r.out.includes('R.7'), `close --dry DEVE bloquear R.7 com id só em fence — saída: ${truncate(r.out, 300)}`);
  });
  fixture('close-roda-suite', () => {
    const root = stBase(tmp, 'close-suite');
    stFeatureBranch(root);
    const id = stActiveSpec(root, { porte: 'P', criterios: ['- [x] Feito (2026-01-10 11:00, commit `abc1234`) — check'] });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(idPrefix(id)));
    writeFile(P(root, 'docs', 'active', id, 'journal.md'), stJournal(ST_ACT, { conclusao: true, snapshotDone: true }));
    expect(stGitCommit(root), 'git commit indisponível na fixture');
    // manifesto com label test que FALHA → close aborta sem mover
    const man = JSON.parse(read(P(root, 'docs', '.spec-system.json')));
    man.commands.test = `${JSON.stringify(process.execPath).slice(1, -1)} -e "process.exit(1)"`;
    writeFile(P(root, 'docs', '.spec-system.json'), JSON.stringify(man, null, 2) + '\n');
    const rf = runCli(root, ['close', id]);
    expect(rf.code === 1 && rf.out.includes('suíte do projeto falhou'), `close deveria abortar com suíte falhando — saída: ${truncate(rf.out, 300)}`);
    expect(isDir(P(root, 'docs', 'active', id)), 'SPEC não pode ter sido movida com suíte falhando');
    // suíte passa → close completa e atestado mostra suite PASS
    man.commands.test = `${JSON.stringify(process.execPath).slice(1, -1)} -e "process.exit(0)"`;
    writeFile(P(root, 'docs', '.spec-system.json'), JSON.stringify(man, null, 2) + '\n');
    const ok = runCli(root, ['close', id]);
    expectRun(ok, 0, 'suite PASS', 'close com suíte passando');
    expect(isDir(P(root, 'docs', 'archive', id)), 'SPEC deveria estar em archive/');
  });
  // ---- v4.1.2 — regressões ----
  fixture('new-ja-ativa', () => {
    // docs antigas mandavam new + activate; activate em SPEC já ativa era erro (exit 1)
    const root = stBase(tmp, 'new-ativa');
    if (!stGitCommit(root)) return;
    expect(stFeatureBranch(root), 'checkout feature/x falhou');
    const man = JSON.parse(read(P(root, 'docs', '.spec-system.json')));
    man.team = 'multi';
    writeFile(P(root, 'docs', '.spec-system.json'), JSON.stringify(man, null, 2) + '\n');
    const rn = runCli(root, ['new', 'demo', '--porte', 'P']);
    expectRun(rn, 0, 'NÃO rode activate', 'new ativo avisa que activate é desnecessário');
    expect(rn.out.includes('PUBLIQUE o claim'), `team multi: new ativo deve imprimir a publicação do claim — saída: ${truncate(rn.out, 400)}`);
    const id = (/(SPEC-\d{8}-\d{4}-demo)/.exec(rn.out) || [])[1];
    expectRun(runCli(root, ['activate', id]), 0, 'já está ativa', 'activate em SPEC ativa é no-op');
  });
  fixture('close-ignora-verify-aceito', () => {
    // critério aceito-incompleto pelo usuário NÃO roda verify: no close (antes: verify falhava e abortava o close)
    const root = stBase(tmp, 'close-aceito');
    const id = stActiveSpec(root, { criterios: [
      '- [ ] roda | verify: `node -e "process.exit(0)"`',
      '- [ ] parte adiada [aceito-incompleto: "pode ficar pra depois" 2026-06-01 10:00] | verify: `node -e "process.exit(1)"`',
    ] });
    writeFile(P(root, 'docs', 'active', id, 'journal.md'), stJournal(ST_ACT, { conclusao: true, snapshotDone: true }));
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ACT}`));
    expect(stGitCommit(root), 'git commit indisponível na fixture');
    const r = runCli(root, ['close', id]);
    expectRun(r, 0, 'atestado', 'close com critério aceito (verify falharia) deve fechar');
    expect(isDir(P(root, 'docs', 'archive', id)), 'SPEC deveria estar em archive/');
  });
  fixture('verify-comando-com-menor', () => {
    // `<` de shell não é placeholder; `<comando>` continua placeholder
    const root = stBase(tmp, 'verify-menor');
    const id = stActiveSpec(root, { criterios: [
      '- [ ] compara | verify: `node -e "process.exit(1<2?0:1)"`',
      '- [ ] falta comando | verify: `<comando>`',
    ] });
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(''));
    expect(stGitCommit(root), 'git commit indisponível na fixture');
    const v = runCli(root, ['verify', id]);
    expectRun(v, 0, 'PASS', 'verify roda comando com <');
    const dry = runCli(root, ['close', id, '--dry']);
    expect(dry.out.includes('verify: placeholder') && dry.out.includes('critério 2'), `<comando> deveria seguir placeholder — saída: ${truncate(dry.out, 400)}`);
    expect(!dry.out.includes('critério 1 com verify: placeholder'), 'comando real com < tratado como placeholder');
  });
  fixture('guard-write-log-via-write', () => {
    // Write do arquivo inteiro não pode reescrever entradas antigas do LOG (Edit já era negado)
    const root = stBase(tmp, 'gw-log-write');
    stFeatureBranch(root);
    const id = stActiveSpec(root);
    const jp = P(root, 'docs', 'active', id, 'journal.md');
    writeFile(jp, stJournal(ST_ACT, { conclusao: true }));
    const cur = read(jp);
    const tamper = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: jp, content: cur.replace('## 2026-01-10 10:05 — [ativação] SPEC ativada\n', '') } }); // apaga entrada antiga: sem heading novo, o gate do Escriba não pega
    expectRun(runCli(root, ['guard-write'], tamper), 2, 'append-only', 'Write que altera entrada antiga é negado');
    const lastEdit = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: jp, content: cur.replace('[conclusão] Entregue\n', '[conclusão] Entregue\n\ncorpo acrescentado na última entrada\n') } });
    expectRun(runCli(root, ['guard-write'], lastEdit), 0, null, 'Write que só mexe na última entrada passa');
    const snap = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: jp, content: cur.replace('início — nada feito ainda', 'avancei') } });
    expectRun(runCli(root, ['guard-write'], snap), 0, null, 'Write que só mexe no SNAPSHOT passa');
  });
  fixture('guard-write-temp-escopo', () => {
    const root = stBase(tmp, 'gw-temp');
    const gw = (rel) => runCli(root, ['guard-write'], JSON.stringify({ tool_name: 'Write', tool_input: { file_path: P(root, ...rel.split('/')), content: 'x' } }));
    expectRun(gw('src/tracer.ts'), 0, null, 'tracer.ts é código, não temporário');
    expectRun(gw('dumpSchema.ts'), 0, null, 'dumpSchema.ts na raiz é código');
    expectRun(gw('public/logo.png'), 0, null, 'asset dentro de pasta do projeto é legítimo');
    expectRun(gw('dump.sql'), 2, 'R.12', 'dump.sql solto na raiz é negado');
    expectRun(gw('shot.png'), 2, 'R.12', 'png solto na raiz é negado');
    expectRun(gw('docs/trace-1.json'), 2, 'R.12', 'trace em docs/ é negado');
  });
  fixture('stamp-check-segredo-escopo', () => {
    // R.15 vale para docs/ e entrypoints; código com credencial de dev local não bloqueia toda edição
    const root = stBase(tmp, 'sc-escopo');
    writeFile(P(root, 'src', 'db.ts'), 'export const url = "AKIAIOSFODNN7EXAMPLE";\n');
    const code = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: P(root, 'src', 'db.ts'), old_string: 'x', new_string: 'y' } });
    expectRun(runCli(root, ['stamp-check'], code), 0, null, 'stamp-check ignora código fora de docs/');
    writeFile(P(root, 'docs', 'notas.md'), 'chave AKIAIOSFODNN7EXAMPLE\n');
    const doc = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: P(root, 'docs', 'notas.md'), old_string: 'x', new_string: 'y' } });
    expectRun(runCli(root, ['stamp-check'], doc), 2, 'R.15', 'stamp-check nega segredo em docs/');
  });
  fixture('flag-desconhecida', () => {
    const root = stBase(tmp, 'flag-typo');
    const id = stActiveSpec(root);
    const r = runCli(root, ['close', id, '--dyr']);
    expectRun(r, 1, 'flag desconhecida --dyr', 'flag com typo é erro');
    expect(r.out.includes('--dry'), `sem sugestão --dry — saída: ${truncate(r.out, 200)}`);
    expect(isDir(P(root, 'docs', 'active', id)), 'close com flag errada não pode ter rodado');
    expectRun(runCli(root, ['--help']), 0, 'ciclo de vida', '--help sai com 0');
  });
  fixture('session-close-spec-nova', () => {
    // SPEC recém-criada (pasta não-rastreada) + código alterado: o journal novo conta como atualizado
    const root = stBase(tmp, 'sc-nova');
    if (!stGitCommit(root)) return;
    expect(stFeatureBranch(root), 'checkout feature/x falhou');
    expectRun(runCli(root, ['new', 'demo', '--porte', 'P']), 0, 'criada', 'new');
    writeFile(P(root, 'src', 'a.ts'), 'export {};\n');
    const r = runCli(root, ['session-close'], '{}');
    expect(r.code === 0 && !r.out.includes('"block"'), `session-close bloqueou com journal novo — saída: ${truncate(r.out, 300)}`);
  });
  fixture('reopen-exige-nova-conclusao', () => {
    const root = stBase(tmp, 'reopen-conc');
    stFeatureBranch(root);
    const id = stArchiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    expectRun(runCli(root, ['reopen', id, '--motivo', 'faltou o critério 2']), 0, 'reaberta', 'reopen');
    const dir = P(root, 'docs', 'active', id);
    const main = read(P(dir, 'main.md'));
    expect(/^\*\*Concluída:\*\* —$/m.test(main) && /^\*\*Commit final:\*\* —$/m.test(main), `Concluída/Commit final não zerados — ${truncate(main, 400)}`);
    expect(!exists(P(dir, 'digest.md')), 'digest antigo deveria ter sido descartado');
    const dry = runCli(root, ['close', id, '--dry']);
    expectRun(dry, 1, 'anterior à última reabertura', 'close exige [conclusão] nova após reopen');
  });
  // ---- v4.2 — vocabulário bilíngue ----
  fixture('en-ciclo-completo', () => {
    // repo lang=en: new → check → log completion → close, tudo gravado em EN e aceito pelos gates
    const root = stBase(tmp, 'en-ciclo');
    stLangEn(root);
    if (!stGitCommit(root)) return;
    expect(stFeatureBranch(root), 'checkout feature/x falhou');
    const rn = runCli(root, ['new', 'demo', '--size', 'S', '--features', 'core']);
    expectRun(rn, 0, 'created', 'new --size S');
    const id = (/(SPEC-\d{8}-\d{4}-demo)/.exec(rn.out) || [])[1];
    const dir = P(root, 'docs', 'active', id);
    let main = read(P(dir, 'main.md'));
    expect(/^\*\*Size:\*\* S$/m.test(main) && main.includes('## Acceptance criteria') && main.includes('**IN:**'), `main.md não saiu em EN — ${truncate(main, 300)}`);
    expect(!/\*\*(Porte|Criada|Resumo):\*\*/.test(main), 'main.md EN com rótulo PT');
    let j = read(P(dir, 'journal.md'));
    expect(j.includes('**Last updated:**') && j.includes('— [activation] SPEC created and activated'), `journal não saiu em EN — ${truncate(j, 400)}`);
    expect(read(P(root, 'docs', 'claims', `${id}.md`)).includes('**Activated at:**'), 'claim não saiu em EN');
    main = main.replace('<!-- S: close with: node scripts/specctl.mjs check <id> <n> -->\n- [ ] <binary, verifiable criterion>', '- [ ] it works');
    writeFile(P(dir, 'main.md'), main);
    expectRun(runCli(root, ['check', id, '1', '--evidence', 'manual run']), 0, null, 'check em main EN');
    expectRun(runCli(root, ['log', id, 'completion', 'Delivered the demo']), 0, null, 'log completion');
    j = read(P(dir, 'journal.md')).replace('start — nothing done yet', 'delivered').replace('<first concrete step>', '—').replace('<phase>', 'impl');
    writeFile(P(dir, 'journal.md'), j);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCoreEn(idPrefix(id)));
    expect(stGitCommit(root), 'commit falhou');
    const rc = runCli(root, ['close', id]);
    expectRun(rc, 0, '— attestation ==', 'close em repo EN');
    const ad = P(root, 'docs', 'archive', id);
    const dg = read(P(ad, 'digest.md'));
    expect(dg.includes('**Delivered:** delivered (criteria 1/1') &&dg.includes('**Final commit:**') && dg.includes('the tool measures'), `digest não saiu em EN — ${truncate(dg, 400)}`);
    expect(/^\*\*Completed:\*\* \d{4}/m.test(read(P(ad, 'main.md'))), 'Completed não estampado em main EN');
    expect(read(P(root, 'docs', 'ARCHIVE-INDEX.md')).includes(GERADO_MARK_EN), 'índice gerado sem marcador EN');
    const rl = runCli(root, ['lint']);
    expectRun(rl, 0, null, 'lint 0 erros no repo EN após o ciclo');
  });
  fixture('pt-doc-em-repo-en', () => {
    // documento PT existente num repo que passou a lang=en: continua válido e as edições preservam o PT
    const root = stBase(tmp, 'pt-em-en');
    stArchiveSpec(root);
    const id = stActiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCore(`SPEC-${ST_ARCH}`));
    stLangEn(root);
    expectRun(runCli(root, ['index']), 0, null, 'index');
    expectRun(runCli(root, ['lint']), 0, null, 'lint de docs PT em repo EN');
    expectRun(runCli(root, ['pause', id, '--reason', 'aguardando API']), 0, 'paused:', 'pause --reason');
    const main = read(P(root, 'docs', 'future', id, 'main.md'));
    expect(/^\*\*Pausada em:\*\* .* — aguardando API$/m.test(main) && !main.includes('**Paused at:**'), `pause trocou o idioma do main PT — ${truncate(main, 400)}`);
    const j = read(P(root, 'docs', 'future', id, 'journal.md'));
    expect(j.includes('— [nota] Pausada: aguardando API'), `entrada de LOG não seguiu o idioma do journal PT — ${truncate(j.slice(-200), 200)}`);
  });
  fixture('en-doc-em-repo-pt', () => {
    // main/feature EN num repo PT (lang ausente): parser reconhece critérios, campos, seções e Size S/L
    const root = stBase(tmp, 'en-em-pt');
    const id = 'SPEC-20260701-1000-en-doc';
    const dir = P(root, 'docs', 'active', id);
    writeFile(P(dir, 'main.md'), stMainEn('20260701-1000', { porte: 'L', criterios: ['- [ ] covered [accepted-incomplete: “later is fine” 2026-07-01 10:00]'] }));
    writeFile(P(dir, 'journal.md'), stJournal('20260701-1000'));
    writeFile(P(root, 'docs', 'claims', `${id}.md`), makeClaim({ id, title: 'en', owner: '@tester', branch: 'feature/x', features: 'core', ativada: '2026-01-10 10:05' }));
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCoreEn(''));
    runCli(root, ['index']);
    expectRun(runCli(root, ['lint']), 0, null, 'lint de docs EN em repo PT');
    const pm = parseMain(read(P(dir, 'main.md')));
    expect(pm.fields.Porte === 'G' && pm.fields.Resumo && getCriteria(pm).length === 1, `parseMain não normalizou EN — ${JSON.stringify(pm.fields).slice(0, 200)}`);
    expect(ACEITO_RE.test(getCriteria(pm)[0].raw), 'accepted-incomplete com aspas curvas não reconhecido');
    expect(read(P(root, 'docs', 'DEFERRED.md')).includes('"later is fine"'), 'DEFERRED não listou o marcador EN');
    const dry = runCli(root, ['close', id, '--dry']);
    expect(!dry.out.includes('critério 1 aberto'), `critério aceito (EN) tratado como aberto — saída: ${truncate(dry.out, 300)}`);
  });
  fixture('log-tipo-aliases', () => {
    const root = stBase(tmp, 'log-alias');
    stFeatureBranch(root);
    const id = stActiveSpec(root);
    for (const t of ['decisao', 'decision', 'conclusão']) { // sem acento, EN e NFD ("ã" decomposto)
      expectRun(runCli(root, ['log', id, t, `via ${t}`]), 0, null, `log ${t}`);
    }
    const j = read(P(root, 'docs', 'active', id, 'journal.md'));
    expect(j.includes('— [decisão] via decisao') && j.includes('— [decisão] via decision') && j.includes('— [conclusão] via'), `tipos não normalizados para o idioma do journal PT — ${truncate(j.slice(-300), 300)}`);
    expectRun(runCli(root, ['log', id, 'decidido', 'x']), 1, 'tipo inválido', 'tipo inexistente segue erro');
    expectRun(runCli(root, ['new', 'x', '--future', '--size', 'L', '--porte', 'G']), 1, 'não ambos', 'alias + canônico juntos é erro');
  });
  fixture('en-mensagens-close-lint', () => {
    // repo lang=en: mensagens da CLI em EN (checklist do close, lint), sem prosa PT
    const root = stBase(tmp, 'en-msgs');
    stLangEn(root);
    stFeatureBranch(root);
    const id = stActiveSpec(root);
    writeFile(P(root, 'docs', 'features', 'core.md'), stFeatureCoreEn(''));
    runCli(root, ['index']);
    const dry = runCli(root, ['close', id, '--dry']);
    expectRun(dry, 1, 'ready: NO', 'close --dry EN');
    expect(dry.out.includes('pending item(s)') && dry.out.includes('criterion 1') && !/pendência|critério|pronto:/.test(dry.out), `close --dry com prosa PT — saída: ${truncate(dry.out, 400)}`);
    writeFile(P(root, 'docs', 'features', 'core.md'), '# core\n');
    const rl = runCli(root, ['lint']);
    expectRun(rl, 1, 'ERROR   docs/features/core.md: feature without a **Keywords:** line', 'lint EN');
    expect(/lint: \d+ error\(s\), \d+ warning\(s\)/.test(rl.out) && !/ERRO |AVISO|erro\(s\)/.test(rl.out), `lint com prosa PT — saída: ${truncate(rl.out, 400)}`);
    const nf = runCli(root, ['close', 'SPEC-29990101-0000-nada']);
    expectRun(nf, 1, '[specctl] ERROR: SPEC', 'die EN');
  });
  fixture('entrypoints-en-pt', () => {
    // entrypoints: EN em repo lang=en; nos dois idiomas skills sdd-* e o núcleo RULES.md alcança o agente
    const root = stBase(tmp, 'ep-en');
    stLangEn(root);
    expectRun(runCli(root, ['entrypoints']), 0, 'CLAUDE.md:', 'entrypoints EN');
    const c = read(P(root, 'CLAUDE.md')), a = read(P(root, 'AGENTS.md'));
    expect(/^\*\*Core \(R\.1–R\.17\), always loaded:\*\* @docs\/RULES\.md$/m.test(c) && c.includes('sdd-create-prd') && c.includes('[continuation: SPEC-x]') && c.includes('/spec close') && c.includes(PROJ_INI_EN), `CLAUDE.md EN incompleto — ${truncate(c, 300)}`);
    expect(!/cria-prd|executar-|Comandos|Estrutura/.test(c + a), 'entrypoint EN com nome antigo/prosa PT');
    expect(a.includes('read `docs/RULES.md` at the start of EVERY session') && a.includes('## No hooks?'), 'AGENTS.md EN sem instrução de leitura do RULES');
    expect(bytesOf(c) <= 6000 && bytesOf(a) <= 6200, `orçamento: CLAUDE ${bytesOf(c)} / AGENTS ${bytesOf(a)}`);
    expectRun(runCli(root, ['lint']), 0, null, 'lint com entrypoints EN');
    const pt = stBase(tmp, 'ep-pt');
    expectRun(runCli(pt, ['entrypoints']), 0, 'CLAUDE.md:', 'entrypoints PT');
    const cp = read(P(pt, 'CLAUDE.md')), ap = read(P(pt, 'AGENTS.md'));
    expect(/^\*\*Núcleo \(R\.1–R\.17\), sempre carregado:\*\* @docs\/RULES\.md$/m.test(cp) && cp.includes('sdd-create-prd') && cp.includes('[continuidade: SPEC-x]') && cp.includes(PROJ_INI), 'CLAUDE.md PT sem import do RULES/skills novas');
    expect(!/cria-prd|criar-tasks|executar-/.test(cp + ap) && ap.includes('leia `docs/RULES.md`'), 'entrypoint PT com skill antiga ou AGENTS sem RULES');
  });
  fixture('en-guard-read-sem-subagente', () => {
    // deny do guard-read em EN e sem a rota "via subagente" (hooks PreToolUse disparam nos subagentes também)
    const root = stBase(tmp, 'en-gr');
    stLangEn(root);
    const aid = stArchiveSpec(root);
    const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: P(root, 'docs', 'archive', aid, 'journal.md') } });
    const r = runCli(root, ['guard-read'], payload);
    expectRun(r, 2, '[guard-read] BLOCKED (R.8', 'guard-read EN');
    expect(r.out.includes('.allow-read') && !/subagent|BLOQUEADO/i.test(r.out), `guard-read EN cita subagente/PT — ${truncate(r.out, 300)}`);
    const g = runCli(root, ['guard-read'], JSON.stringify({ tool_name: 'Grep', tool_input: { path: P(root, 'docs', 'archive') } }));
    expect(g.code === 2 && !/subagent/i.test(g.out), `Grep em archive cita subagente — ${truncate(g.out, 300)}`);
  });
  fixture('init-lang-en', () => {
    const root = P(tmp, 'init-en');
    fs.mkdirSync(root, { recursive: true });
    expectRun(runCli(root, ['init', '--lang', 'en']), 0, 'init ok', 'init --lang en');
    const man = JSON.parse(read(P(root, 'docs', '.spec-system.json')));
    expect(man.lang === 'en', 'manifesto sem lang=en');
    expect(read(P(root, 'docs', 'TAXONOMY.md')).includes('## Areas') && read(P(root, 'docs', 'INDEX.md')).includes(GERADO_MARK_EN), 'stubs/índices não saíram em EN');
    expectRun(runCli(root, ['lint']), 0, null, 'lint pós-init EN');
    const pt = P(tmp, 'init-pt');
    fs.mkdirSync(pt, { recursive: true });
    expectRun(runCli(pt, ['init']), 0, 'init ok', 'init sem --lang');
    expect(!('lang' in JSON.parse(read(P(pt, 'docs', '.spec-system.json')))), 'init sem --lang não deve gravar lang');
    expectRun(runCli(pt, ['init', '--force', '--lang', 'xx']), 1, '--lang inválido', 'lang inválido');
  });

  out(`== specctl self-test (v${VERSION}) ==`);
  let pass = 0;
  for (const [name, ok, why] of results) {
    if (ok) { pass++; out(`PASS  ${name}`); }
    else out(`FAIL  ${name} — ${why}`);
  }
  out(`\nResultado: ${pass}/${results.length} PASS`);
  const allOk = pass === results.length;
  if (allOk) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { out(`(fixtures mantidas em ${tmp} — remoção falhou)`); } }
  else out(`fixtures preservadas para inspeção em: ${tmp}`);
  process.exit(allOk ? 0 : 1);
}

// ---------------------------------------------------------------- dispatch

const VALUE_FLAGS = ['base', 'motivo', 'porte', 'owner', 'features', 'program', 'workspace', 'branch', 'evidence', 'body-file', 'file', 'cita', 'agent', 'lang', 'size', 'reason', 'quote'];
// aliases EN → nome canônico (PT) usado pelo código
const FLAG_ALIASES = { size: 'porte', reason: 'motivo', quote: 'cita' };
const BOOL_FLAGS = ['all', 'compact', 'deps', 'dry', 'fix', 'force', 'future', 'main-gate', 'pr', 'stdin', 'strict', 'target-main'];
// flag desconhecida = erro: antes `close <id> --dyr` era aceito em silêncio e rodava um close REAL
function checkFlagName(name) {
  if (VALUE_FLAGS.includes(name) || BOOL_FLAGS.includes(name)) return;
  const all = [...VALUE_FLAGS, ...BOOL_FLAGS];
  const near = all.filter((f) => editDistance(f, name) <= 2);
  die(tr(LANG, `flag desconhecida --${name}${near.length ? ` — quis dizer --${near[0]}?` : ''} (veja: node scripts/specctl.mjs --help)`, `unknown flag --${name}${near.length ? ` — did you mean --${near[0]}?` : ''} (see: node scripts/specctl.mjs --help)`));
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
function parseArgs(argv) {
  const flags = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '--version') { pos.push(a); continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) { checkFlagName(a.slice(2, eq)); flags[a.slice(2, eq)] = a.slice(eq + 1); }
      else {
        const name = a.slice(2);
        checkFlagName(name);
        if (VALUE_FLAGS.includes(name)) {
          flags[name] = argv[++i];
          if (flags[name] === undefined) die(tr(LANG, `--${name} exige valor`, `--${name} requires a value`));
        } else flags[name] = true;
      }
    } else pos.push(a);
  }
  for (const [en, pt] of Object.entries(FLAG_ALIASES)) {
    if (en in flags) {
      if (pt in flags) die(tr(LANG, `use --${en} OU --${pt}, não ambos`, `use --${en} OR --${pt}, not both`));
      flags[pt] = flags[en]; delete flags[en];
    }
  }
  return { flags, pos };
}
const USAGE_EN = () => `specctl v${VERSION} (${SCHEMA}) — single CLI of the SPEC system (SDD v4)
usage: node scripts/specctl.mjs <command> [args]

lifecycle:      init [--lang pt|en] · new · activate · pause · resume · reopen <id> --reason "..." · close <id> [--dry] · archive · discard
                new: on main/master only --future is allowed (R.2) — an active SPEC requires a feature branch
                close: transactional close (verify+digest+archive) — start with close <id> --dry
                reopen: archive→active (R.6.2 fix — improper close); discard does not reopen
                PT aliases: --porte (=--size, accepts P|M|G) · --motivo (=--reason) · --cita (=--quote)
scribe:         log <id> <type> "title" [--stdin|--body-file <f>] · check <id> <n> [--evidence "..."]
closing:        digest <id> [--stdin|--file <f>] [--fix] · rollup <area> · escalate <id> <M|L> · deescalate <id> <S|M> --quote "..."
validation:     lint [--strict] [--target-main] · audit [--pr --base <sha>] [--deps] [--main-gate] · verify <id> [--all] · self-test
context:        brief [--compact] [--agent <id>] · capsule · stamp · index · next [--program <slug>] · entrypoints · adopt-workspace <id>
hooks:          guard-read · guard-write · stamp-check · session-close
`;
function usage(code = 1) {
  if (LANG === 'en') { (code ? process.stderr : process.stdout).write(USAGE_EN()); process.exit(code); }
  (code ? process.stderr : process.stdout).write(`specctl v${VERSION} (${SCHEMA}) — CLI única do sistema SPEC (SDD v4)
uso: node scripts/specctl.mjs <comando> [args]

ciclo de vida:  init [--lang pt|en] · new · activate · pause · resume · reopen <id> --motivo "..." · close <id> [--dry] · archive · discard
                new: em main/master só --future é permitido (R.2) — SPEC ativa exige branch de feature
                close: fechamento transacional (verify+digest+archive) — comece por close <id> --dry
                reopen: archive→active (correção R.6.2 — fechamento indevido); discard não reabre
                aliases EN: --size (=--porte, aceita S|M|L) · --reason (=--motivo) · --quote (=--cita)
scribe:         log <id> <tipo> "título" [--stdin|--body-file <f>] · check <id> <n> [--evidence "..."]
fechamento:     digest <id> [--stdin|--file <f>] [--fix] · rollup <area> · escalate <id> <M|G> · deescalate <id> <P|M> --cita "..."
validação:      lint [--strict] [--target-main] · audit [--pr --base <sha>] [--deps] [--main-gate] · verify <id> [--all] · self-test
contexto:       brief [--compact] [--agent <id>] · capsule · stamp · index · next [--program <slug>] · entrypoints · adopt-workspace <id>
hooks:          guard-read · guard-write · stamp-check · session-close
`);
  process.exit(code);
}

const [, , cmd, ...rest] = process.argv;
// idioma já no parse de flags/usage (antes de requireRoot): leitura SILENCIOSA do manifesto — manifesto
// inválido não emite aviso aqui (o aviso continua saindo, uma vez, pelo manifest() do comando)
try { const r0 = findRoot(process.cwd()); if (r0 && JSON.parse(read(P(r0, 'docs', '.spec-system.json'))).lang === 'en') LANG = 'en'; } catch { /* pt */ }
const { flags, pos } = parseArgs(rest);
try {
  switch (cmd) {
    case 'init': cmdInit(flags); break;
    case 'new': cmdNew(pos, flags); break;
    case 'activate': cmdActivate(pos, flags); break;
    case 'pause': cmdPause(pos, flags); break;
    case 'resume': cmdResume(pos); break;
    case 'reopen': cmdReopen(pos, flags); break;
    case 'archive': cmdArchive(pos); break;
    case 'discard': cmdDiscard(pos, flags); break;
    case 'lint': cmdLint(flags); break;
    case 'audit': cmdAudit(flags); break;
    case 'index': cmdIndex(); break;
    case 'next': cmdNext(null, flags); break;
    case 'brief': cmdBrief(flags); break;
    case 'capsule': cmdCapsule(); break;
    case 'stamp': cmdStamp(); break;
    case 'verify': cmdVerify(pos, flags); break;
    case 'log': cmdLog(pos, flags); break;
    case 'check': cmdCheck(pos, flags); break;
    case 'digest': cmdDigest(pos, flags); break;
    case 'rollup': cmdRollup(pos); break;
    case 'escalate': cmdEscalate(pos); break;
    case 'deescalate': cmdDeescalate(pos, flags); break;
    case 'close': cmdClose(pos, flags); break;
    case 'guard-read': cmdGuardRead(); break;
    case 'guard-write': cmdGuardWrite(); break;
    case 'stamp-check': cmdStampCheck(); break;
    case 'session-close': cmdSessionClose(); break;
    case 'adopt-workspace': cmdAdoptWorkspace(pos); break;
    case 'entrypoints': cmdEntrypoints(); break;
    case 'self-test': cmdSelfTest(); break;
    case '--version': case 'version': out(`specctl ${VERSION} (${SCHEMA})`); break;
    case '--help': case 'help': usage(0); break;
    default: usage();
  }
} catch (e) {
  die(`${tr(LANG, `falha inesperada em '${cmd}'`, `unexpected failure in '${cmd}'`)}: ${e.message}${process.env.SPECCTL_DEBUG ? '\n' + e.stack : ''}`);
}
