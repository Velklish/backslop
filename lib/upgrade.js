// Обновление проекта на новую версию backslop: последний тег из источника релизов, пробный
// запуск новой версии, пин в `cli` и `gates`, затем миграция и раскладка уже новой версией и
// выжимка CHANGELOG. Сама команда может идти из старой версии — всё, что зависит от формата,
// делает новая. Пин записывается только после того, как новая версия хоть раз запустилась:
// иначе отказ сети или тега оставлял бы проект с пином на версию, которой нет.
import { spawnSync } from 'node:child_process';
import { CONFIG_FILE, loadProject, parseCli, saveConfig } from './config.js';
import { CliError, info, ok, parseCommandArgs, warn } from './util.js';
import { compareVersions, latestVersion, normalizeVersion } from './version.js';

// Первая версия с upgrade/migrate: ниже неё новая версия не сумеет ни принять пин, ни
// перевести формат, поэтому обновление туда — отказ по построению.
export const MIN_UPGRADE_TARGET = '0.2.0';

// Релиз — тег `vX.Y.Z`; другие теги источника не релизы. Промпт логина git подавлен: опечатка
// в адресе иначе ждала бы ввода в терминале до таймаута.
export function listReleaseTags(source) {
  const r = spawnSync('git', ['ls-remote', '--tags', '--refs', source], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || (r.error ? r.error.message : `код ${r.status}`);
    throw new CliError(`git ls-remote --tags ${source}: ${why}`);
  }
  return r.stdout.split('\n')
    .map((line) => line.split('\t')[1])
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => normalizeVersion(tag));
}

// Гейты, начинающиеся со старой команды, получают новую; остальные не трогаются.
export function rewriteGates(gates, oldCli, newCli) {
  return gates.map((g) => (g === oldCli || g.startsWith(`${oldCli} `) ? newCli + g.slice(oldCli.length) : g));
}

// Команда из конфига исполняется как есть, оболочкой: тот же уровень доверия, что у gates.
function exec(command, cwd, recovery) {
  info(`→ ${command}`);
  const r = spawnSync(command, { cwd, shell: true, stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (r.status !== 0) {
    throw new CliError(`команда «${command}» завершилась кодом ${r.status ?? r.signal}. ${recovery}`);
  }
}

export async function run(argv, { cwd }) {
  const { values } = parseCommandArgs(argv, {
    to: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'pin-only': { type: 'boolean' },
  });
  const dry = values['dry-run'] === true;
  const pinOnly = values['pin-only'] === true;

  const project = loadProject(cwd);
  const { root, cfg } = project;
  const form = parseCli(cfg.cli);
  const source = cfg.source ?? form?.repoUrl ?? null;
  if (!source) {
    throw new CliError(`cli «${cfg.cli}» — не установка из релиза, а источник релизов (поле source в ${CONFIG_FILE}) не задан: обновлять нечего. Репозиторий самого инструмента обновляется через git`);
  }

  const tags = listReleaseTags(source);
  let target;
  if (values.to !== undefined) {
    target = normalizeVersion(values.to);
    if (target === null) throw new CliError(`--to «${values.to}»: нужна форма X.Y.Z`);
    if (!tags.includes(target)) throw new CliError(`тега v${target} в ${source} нет; есть: ${tags.length ? tags.map((t) => `v${t}`).join(', ') : 'ни одного'}`);
  } else {
    target = latestVersion(tags);
    if (target === null) throw new CliError(`в ${source} нет тегов релизов вида vX.Y.Z`);
  }
  if (compareVersions(target, MIN_UPGRADE_TARGET) < 0) {
    throw new CliError(`v${target} старше v${MIN_UPGRADE_TARGET}: у таких версий нет migrate и upgrade, обновиться на них нельзя`);
  }

  const current = form?.pin ?? cfg.version ?? null;
  const label = current ? `v${current}` : 'без пина и штампа';
  if (current && compareVersions(target, current) < 0) {
    throw new CliError(`понижение ${label} → v${target} не поддерживается: старая версия не знает формата файлов новой`);
  }
  if (current && compareVersions(target, current) === 0 && values.to === undefined && cfg.version === current) {
    ok(`upgrade: проект уже на ${label}, новее v${target} в ${source} нет`);
    return 0;
  }

  const newCli = form ? form.withPin(target) : cfg.cli;
  const newGates = rewriteGates(cfg.gates, cfg.cli, newCli);
  info(`upgrade: ${label} → v${target} (источник ${source})`);
  if (form) {
    info(`cli: ${cfg.cli} → ${newCli}`);
    info(`gates с новым пином: ${newGates.filter((g, i) => g !== cfg.gates[i]).length} из ${cfg.gates.length}`);
  } else {
    warn(`cli «${cfg.cli}» не в форме npx github:…: пин не меняется, обнови установку сам (например, npm i -g ${source}#v${target})`);
  }
  if (dry) {
    info('--dry-run: ничего не записано; дальше были бы пробный запуск новой версии, пин, migrate и init новой версией, выжимка CHANGELOG');
    return 0;
  }

  const recovery = `Пин и штамп не тронуты — повтори ${cfg.cli} upgrade${values.to !== undefined ? ` --to v${target}` : ''} после починки`;
  if (!pinOnly) exec(`${newCli} version`, root, recovery);

  if (form) {
    cfg.cli = newCli;
    cfg.gates = newGates;
    saveConfig(root, cfg);
  }
  if (pinOnly) {
    info(`пин переставлен; дальше сам: ${newCli} migrate && ${newCli} init`);
    return 0;
  }

  const afterPin = `Пин уже v${target}: доведи руками — ${newCli} migrate, затем ${newCli} init`;
  exec(`${newCli} migrate`, root, afterPin);
  exec(`${newCli} init`, root, afterPin);
  exec(current ? `${newCli} changelog --since v${current} --to v${target}` : `${newCli} changelog --to v${target}`, root, 'Обновление прошло, не напечаталась только выжимка CHANGELOG');
  ok(`upgrade: ${label} → v${target}`);
  return 0;
}
