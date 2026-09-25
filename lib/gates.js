// Раннер гейтов из поля `gates`: команды по порядку, код — у самой команды, в конце снимок дерева.
// Инструмент докладывает факт: дефект ли красный гейт и законна ли грязь дерева, решает агент.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { CONFIG_FILE, gateEntry, loadProject } from './config.js';
import { CliError, bad, git, gitCause, info, ok, parseCommandArgs } from './util.js';
import { tr } from './i18n.js';

// Гейт на дереве, не равном коммиту, про коммит ничего не доказывает. Без git снимка нет (`null`),
// а `head: null` — репозиторий без коммитов: чистоту видно, назвать нечем.
function treeSnapshot(root) {
  if (git(root, ['rev-parse', '--git-dir']).status !== 0) return null;
  const status = git(root, ['status', '--porcelain', '--', '.']);
  if (status.status !== 0) return null;
  const head = git(root, ['rev-parse', 'HEAD']);
  const prefix = projectPrefix(root);
  const lines = status.stdout.replace(/\n$/, '').split('\n');
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    clean: status.stdout === '',
    dirty: lines.map((l) => porcelainInProject(l, prefix)).join('\n'),
  };
}

// A porcelain v1 path is bare or C-quoted by git (`"pkg/a b.md"`, octal for non-ASCII bytes).
const PORCELAIN_PATH = String.raw`"(?:[^"\\]|\\.)*"|[^ ]+`;
const PORCELAIN_LINE = new RegExp(`^(.. )(${PORCELAIN_PATH})(?: -> (${PORCELAIN_PATH}))?$`);

function cQuoted(text) {
  return [...Buffer.from(text)].map((b) => (b === 0x22 || b === 0x5c ? `\\${String.fromCharCode(b)}`
    : b < 0x20 || b >= 0x7f ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b))).join('');
}

function porcelainInProject(line, prefix) {
  const m = line.match(PORCELAIN_LINE);
  if (!m) return line;
  const strip = (p) => {
    if (p === prefix || p === `"${prefix}"` || p === `"${cQuoted(prefix)}"`) return './';
    if (p.startsWith(prefix)) return p.slice(prefix.length);
    const q = [prefix, cQuoted(prefix)].find((x) => p.startsWith(`"${x}`));
    if (q === undefined) return p;
    const rest = p.slice(q.length + 1, -1);
    // Git quotes a path only for a space or an escape; a prefix may have been the only reason.
    return /[\\ ]/.test(rest) ? `"${rest}"` : rest;
  };
  return `${m[1]}${strip(m[2])}${m[3] === undefined ? '' : ` -> ${strip(m[3])}`}`;
}

// Образец `when` сверяется с путём целиком: `*` и `?` не переходят `/`, `**` переходит, а `**/`
// в начале сегмента значит ещё и «ноль сегментов» (ADR-023, «Глоб»).
export function globToRe(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i += 1;
      if (pattern[i + 1] === '/' && (i === 1 || pattern[i - 2] === '/')) {
        i += 1;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// `-z` — против экранирования не-ASCII при `core.quotePath`, `-uall` — файлы вместо `?? dir/`. У
// переименования в набор идут оба имени: область, откуда файл ушёл, тоже задета (ADR-023).
function worktreePaths(root) {
  const r = git(root, ['status', '--porcelain', '-z', '-uall']);
  if (r.status !== 0) return null;
  const fields = r.stdout.split('\0').filter((f) => f !== '');
  const paths = [];
  for (let i = 0; i < fields.length; i += 1) {
    const xy = fields[i].slice(0, 2);
    paths.push(fields[i].slice(3));
    if (xy.includes('R') || xy.includes('C')) {
      i += 1;
      if (fields[i] !== undefined) paths.push(fields[i]);
    }
  }
  return paths;
}

// git печатает пути от корня репозитория, образцы `when` написаны от `backslop.json`: в монорепе
// префикс проекта снимается, путь вне проекта уходит (ADR-023, «Система координат»).
function projectPrefix(root) {
  const r = git(root, ['rev-parse', '--show-prefix']);
  return r.status === 0 ? r.stdout.trim() : '';
}

// Число отброшенных отличает «база не дала диффа» от «дифф целиком вне проекта»: ходы у них разные.
function toProjectPaths(paths, prefix) {
  if (!prefix) return { paths, dropped: 0 };
  const inside = paths.filter((p) => p.startsWith(prefix));
  return { paths: inside.map((p) => p.slice(prefix.length)), dropped: paths.length - inside.length };
}

// Дифф к базе. `--no-renames` даёт обе стороны переименования отдельными записями, по той же
// причине, что и у грязного дерева. `diff.relative` would make paths cwd-relative.
function basePaths(root, base, lang) {
  const r = git(root, ['-c', 'diff.relative=false', 'diff', '--name-only', '-z', '--no-renames', `${base}..HEAD`]);
  if (r.status !== 0) {
    const why = gitCause(r, lang);
    throw new CliError(tr(lang, `--base ${base}: git diff отказал — ${why}`, `--base ${base}: git diff failed — ${why}`));
  }
  return r.stdout.split('\0').filter((p) => p !== '');
}

// Без `--base` набор — грязное дерево, с `--base` — дифф к ней плюс грязное дерево; без git набора
// нет, и гоняется всё. Чем он считался, печатается в отчёте (ADR-023, «Отчёт»).
function changedPaths(root, base, lang) {
  const dirty = git(root, ['rev-parse', '--git-dir']).status === 0 ? worktreePaths(root) : null;
  if (dirty === null) {
    if (base !== undefined) {
      throw new CliError(tr(lang,
        `--base ${base}: git не отдал состояние дерева, набор путей не посчитать`,
        `--base ${base}: git did not report the tree state, so the path set cannot be computed`));
    }
    return null;
  }
  const prefix = projectPrefix(root);
  // Дедупликация до фильтра: иначе путь, попавший и в дифф, и в грязное дерево, считался бы
  // отброшенным дважды.
  const fromBase = base === undefined ? [] : [...new Set(basePaths(root, base, lang))];
  const raw = [...new Set([...fromBase, ...dirty])];
  const { paths, dropped } = toProjectPaths(raw, prefix);
  // Neighbour dirt is not this project's business: only a base diff dropped outside counts as one.
  const baseDropped = toProjectPaths(fromBase, prefix).dropped;
  return {
    scope: { source: base === undefined ? 'worktree' : 'base+worktree', base: base ?? null, prefix, dropped, paths: paths.sort() },
    baseDropped,
  };
}

function scopeLine(scope, lang) {
  const how = scope.base === null
    ? 'git status --porcelain'
    : `git diff --name-only ${scope.base}..HEAD ${tr(lang, 'плюс', 'plus')} git status --porcelain`;
  // Префикс называется вслух: иначе в монорепе не видно, что набор сужен до каталога проекта.
  // Отброшенное — тоже: пустой набор при непустом дифсе иначе читался бы как «ничего не тронуто».
  const from = scope.prefix ? tr(lang, `, пути от корня проекта (${scope.prefix})`, `, paths relative to the project root (${scope.prefix})`) : '';
  const out = scope.dropped ? tr(lang, `, отброшено ${scope.dropped} вне проекта`, `, ${scope.dropped} dropped outside the project`) : '';
  return tr(lang, `область: ${how}${from}, путей ${scope.paths.length}${out}`, `scope: ${how}${from}, paths ${scope.paths.length}${out}`);
}

// Пропуск называется причиной, а не молчанием: строка без причины читается как покрытие, которого
// не было. Нет области или нет набора — команда гоняется, как гонялась до появления формы.
function skipReason(gate, scope, lang) {
  if (gate.when === null || scope === null) return null;
  const res = gate.when.map(globToRe);
  if (scope.paths.some((p) => res.some((re) => re.test(p)))) return null;
  return tr(lang,
    `пропущен: область не задета (${gate.when.join(', ')}), путей в наборе ${scope.paths.length}`,
    `skipped: the scope is untouched (${gate.when.join(', ')}), ${scope.paths.length} paths in the set`);
}

// Потолок ожидания на гейт: залипшая команда иначе держала бы прогон вечно.
const GATE_TIMEOUT_MS = 10 * 60 * 1000;

// Команда — оболочкой как есть, при `--json` её вывод уходит в stderr. Свой код, сигнал (и таймаут)
// и незапуск — три исхода: отказ инструмента не называется красным гейтом (ADR-009).
function runGate(command, cwd, quiet) {
  const started = Date.now();
  const r = spawnSync(command, {
    cwd,
    shell: true,
    stdio: quiet ? ['ignore', process.stderr, process.stderr] : 'inherit',
    timeout: GATE_TIMEOUT_MS,
  });
  return {
    command,
    code: r.status ?? null,
    signal: r.signal ?? null,
    error: r.error ? r.error.message : null,
    ms: Date.now() - started,
    timedOut: r.error?.code === 'ETIMEDOUT',
  };
}

// Зелёный — код 0 без ошибки запуска: потолок даёт ETIMEDOUT и при коде 0, если оболочка
// пережила SIGTERM.
function passed(r) {
  return r.code === 0 && r.error === null;
}

// Хвост строки гейта: что именно случилось, а не только «не ноль».
function outcome(r, timedOut, lang) {
  const cap = GATE_TIMEOUT_MS / 60000;
  if (timedOut) return tr(lang, `превысил потолок ${cap} мин`, `timed out after the ${cap}-min cap`);
  if (r.signal !== null) return tr(lang, `прерван сигналом ${r.signal}`, `killed by signal ${r.signal}`);
  if (r.error !== null) return tr(lang, `не запустился: ${r.error}`, `did not start: ${r.error}`);
  return tr(lang, `код ${r.code}`, `code ${r.code}`);
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, {
    'keep-going': { type: 'boolean' },
    'require-clean': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    json: { type: 'boolean' },
    base: { type: 'string' },
  });
  const keepGoing = values['keep-going'] === true;
  const dry = values['dry-run'] === true;
  const asJson = values.json === true;

  const { root, cfg } = loadProject(cwd);
  const gates = cfg.gates.map(gateEntry);
  if (!cfg.gates.length) {
    throw new CliError(tr(cfg.lang,
      `${CONFIG_FILE}: список gates пуст — гнать нечего`,
      `${CONFIG_FILE}: the gates list is empty — there is nothing to run`));
  }

  if (dry && values['require-clean'] === true) {
    throw new CliError(tr(cfg.lang,
      '--dry-run и --require-clean вместе бессмысленны: перечень печатается, не запуская гейтов',
      '--dry-run and --require-clean make no sense together: the list is printed without running any gate'));
  }
  if (dry && values.base !== undefined) {
    throw new CliError(tr(cfg.lang,
      '--dry-run и --base вместе бессмысленны: перечень печатается целиком, область не считается',
      '--dry-run and --base make no sense together: the whole list is printed and no scope is computed'));
  }
  // Пустой `--base` — незаданная `$BASE`, а не база по умолчанию: молча он посчитал бы одно грязное
  // дерево, пока отчёт заявляет базу (ADR-023, «Отказы вместо молчаливого вырождения»).
  if (values.base !== undefined && !values.base.trim()) {
    throw new CliError(tr(cfg.lang,
      '--base пуст: назови ссылку или убери флаг — пустая база посчитала бы одно грязное дерево, назвав это диффом',
      '--base is empty: name a ref or drop the flag — an empty base would count the dirty tree alone and call it a diff'));
  }

  // Перечень печатается целиком: `--dry-run` отвечает на «что настроено», а не «что запустится
  // сейчас». Область у записи видна рядом с командой, считать набор путей незачем.
  if (dry) {
    const report = { gates: gates.map(({ command, when }) => ({ command, when })), total: gates.length, dryRun: true };
    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const gate of gates) info(gate.when ? `${gate.command} — ${tr(cfg.lang, 'область', 'scope')}: ${gate.when.join(', ')}` : gate.command);
      ok(tr(cfg.lang, `гейтов ${gates.length}, ничего не запущено (--dry-run)`, `gates ${gates.length}, nothing was run (--dry-run)`));
    }
    return 0;
  }

  if (values['require-clean'] === true) {
    const before = treeSnapshot(root);
    if (before === null) {
      throw new CliError(tr(cfg.lang,
        '--require-clean: git-репозитория нет, чистоту дерева не проверить',
        '--require-clean: there is no git repository, so tree cleanliness cannot be checked'));
    }
    if (!before.clean) {
      throw new CliError(tr(cfg.lang,
        `--require-clean: дерево нечисто, гейты не запущены:\n${before.dirty}`,
        `--require-clean: the tree is dirty, no gate was run:\n${before.dirty}`));
    }
  }

  // Набор считается, только когда его читает хоть одна область или его просит явный `--base`.
  const counted = gates.some((g) => g.when !== null) || values.base !== undefined
    ? changedPaths(root, values.base, cfg.lang)
    : null;
  const scope = counted?.scope ?? null;
  if (!asJson && scope !== null) info(scopeLine(scope, cfg.lang));

  // Приёмка на пустом наборе — отказ по набору, не по флагам (пуст и `--base HEAD`). Различитель —
  // сырой набор: соседний пакет монорепы — честный пропуск (ADR-023, «Отказы вместо…»).
  if (values['require-clean'] === true && scope !== null && !scope.paths.length && !counted.baseDropped && gates.some((g) => g.when !== null)) {
    throw new CliError(values.base === undefined
      ? tr(cfg.lang,
        '--require-clean без --base: на чистом дереве набор изменённых путей пуст, и каждая запись с областью была бы пропущена. Назови базу: --base <ref>',
        '--require-clean without --base: on a clean tree the changed path set is empty, so every scoped entry would be skipped. Name the base: --base <ref>')
      : tr(cfg.lang,
        `--require-clean --base ${values.base}: набор изменённых путей пуст — база не дала диффа, и каждая запись с областью была бы пропущена. Назови базу, от которой ветка ушла`,
        `--require-clean --base ${values.base}: the changed path set is empty — the base yielded no diff, so every scoped entry would be skipped. Name the base the branch diverged from`));
  }

  const results = [];
  for (const gate of gates) {
    const skip = skipReason(gate, scope, cfg.lang);
    if (skip !== null) {
      results.push({ command: gate.command, when: gate.when, skipped: skip });
      if (!asJson) info(`${gate.command} — ${skip}`);
      continue;
    }
    const { timedOut, ...ran } = runGate(gate.command, root, asJson);
    const result = { ...ran, when: gate.when };
    results.push(result);
    if (!asJson) {
      const line = `${gate.command} — ${outcome(result, timedOut, cfg.lang)}, ${result.ms} ms`;
      if (passed(result)) ok(line);
      else bad(line);
    }
    if (!passed(result) && !keepGoing) break;
  }

  // Пропущенное по области к зелёным не прибавляется никогда и итог не краснит: красным прогон
  // делает только красный гейт. Не дошедшие из-за красного считаются там же, где и раньше.
  const green = results.filter(passed).length;
  const outOfScope = results.filter((r) => r.skipped !== undefined).length;
  const skipped = outOfScope + (gates.length - results.length);
  const failed = results.some((r) => r.skipped === undefined && !passed(r));
  const tree = treeSnapshot(root);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ gates: results, total: gates.length, green, skipped, outOfScope, scope, tree }, null, 2)}\n`);
  } else {
    const tail = skipped ? tr(cfg.lang, `, не запущено ${skipped}`, `, not run ${skipped}`) : '';
    const why = outOfScope ? tr(cfg.lang, ` (вне области ${outOfScope})`, ` (out of scope ${outOfScope})`) : '';
    const line = tr(cfg.lang, `гейтов ${gates.length}, зелёных ${green}${tail}${why}`, `gates ${gates.length}, green ${green}${tail}${why}`);
    if (failed) bad(line);
    else ok(line);
    if (tree === null) info(tr(cfg.lang, 'дерево: git-репозитория нет, снимка нет', 'tree: no git repository, no snapshot'));
    else info(tr(cfg.lang, `дерево: ${tree.head ?? 'коммитов ещё нет'}, ${tree.clean ? 'чисто' : 'нечисто'}`, `tree: ${tree.head ?? 'no commits yet'}, ${tree.clean ? 'clean' : 'dirty'}`));
  }
  return failed ? 1 : 0;
}
