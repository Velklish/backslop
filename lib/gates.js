// Раннер гейтов из поля `gates`: команды по порядку, код возврата берётся у самой команды, а
// не у пайпа, и в конце — снимок дерева, на котором они прогнаны. Инструмент только
// докладывает факт: дефект ли красный гейт и законна ли грязь дерева, решает агент.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { CONFIG_FILE, loadProject } from './config.js';
import { CliError, bad, git, info, ok, parseCommandArgs } from './util.js';
import { tr } from './i18n.js';

// Снимок дерева: гейт на дереве, не равном коммиту, про коммит ничего не доказывает. Без git
// снимка нет — это не отказ, а отсутствие улики, и оно называется вслух. Свежий репозиторий без
// коммитов — третий случай: дерево есть и его чистоту видно, а называть нечем, и `head: null`
// отличает его от «репозитория нет».
function treeSnapshot(root) {
  if (git(root, ['rev-parse', '--git-dir']).status !== 0) return null;
  const status = git(root, ['status', '--porcelain']);
  if (status.status !== 0) return null;
  const head = git(root, ['rev-parse', 'HEAD']);
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    clean: status.stdout.trim() === '',
    dirty: status.stdout.trim(),
  };
}

// Потолок ожидания на гейт: залипшая команда иначе держала бы прогон вечно.
const GATE_TIMEOUT_MS = 10 * 60 * 1000;

// Команда исполняется оболочкой как есть — тот же уровень доверия к `backslop.json`, что у
// `upgrade`. При `--json` вывод гейта уходит в stderr: stdout остаётся разбираемым JSON.
// Три исхода различаются: свой код возврата, смерть по сигналу (в том числе по таймауту) и
// незапуск. Свести их к одной единице значило бы называть отказ инструмента красным гейтом.
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
  };
}

// Хвост строки гейта: что именно случилось, а не только «не ноль».
function outcome(r, lang) {
  if (r.signal !== null) return tr(lang, `прерван сигналом ${r.signal} (потолок ${GATE_TIMEOUT_MS / 60000} мин)`, `killed by signal ${r.signal} (cap ${GATE_TIMEOUT_MS / 60000} min)`);
  if (r.error !== null) return tr(lang, `не запустился: ${r.error}`, `did not start: ${r.error}`);
  return tr(lang, `код ${r.code}`, `code ${r.code}`);
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, {
    'keep-going': { type: 'boolean' },
    'require-clean': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    json: { type: 'boolean' },
  });
  const keepGoing = values['keep-going'] === true;
  const dry = values['dry-run'] === true;
  const asJson = values.json === true;

  const { root, cfg } = loadProject(cwd);
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

  if (dry) {
    const report = { gates: cfg.gates.map((command) => ({ command })), total: cfg.gates.length, dryRun: true };
    if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      for (const command of cfg.gates) info(command);
      ok(tr(cfg.lang, `гейтов ${cfg.gates.length}, ничего не запущено (--dry-run)`, `gates ${cfg.gates.length}, nothing was run (--dry-run)`));
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

  const results = [];
  for (const command of cfg.gates) {
    const result = runGate(command, root, asJson);
    results.push(result);
    if (!asJson) {
      const line = `${command} — ${outcome(result, cfg.lang)}, ${result.ms} ms`;
      if (result.code === 0) ok(line);
      else bad(line);
    }
    if (result.code !== 0 && !keepGoing) break;
  }

  const green = results.filter((r) => r.code === 0).length;
  const skipped = cfg.gates.length - results.length;
  const tree = treeSnapshot(root);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ gates: results, total: cfg.gates.length, green, skipped, tree }, null, 2)}\n`);
  } else {
    const tail = skipped ? tr(cfg.lang, `, не запущено ${skipped}`, `, not run ${skipped}`) : '';
    const line = tr(cfg.lang, `гейтов ${cfg.gates.length}, зелёных ${green}${tail}`, `gates ${cfg.gates.length}, green ${green}${tail}`);
    if (green === cfg.gates.length) ok(line);
    else bad(line);
    if (tree === null) info(tr(cfg.lang, 'дерево: git-репозитория нет, снимка нет', 'tree: no git repository, no snapshot'));
    else info(tr(cfg.lang, `дерево: ${tree.head ?? 'коммитов ещё нет'}, ${tree.clean ? 'чисто' : 'нечисто'}`, `tree: ${tree.head ?? 'no commits yet'}, ${tree.clean ? 'clean' : 'dirty'}`));
  }
  return green === cfg.gates.length ? 0 : 1;
}
