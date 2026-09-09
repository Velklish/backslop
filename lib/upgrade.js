// Обновление проекта на новую версию backslop: последний тег из источника релизов, пробный
// запуск новой версии, пин в `cli` и `gates`, затем миграция и раскладка уже новой версией и
// выжимка CHANGELOG. Сама команда может идти из старой версии — всё, что зависит от формата,
// делает новая. Пин записывается только после того, как новая версия хоть раз запустилась:
// иначе отказ сети или тега оставлял бы проект с пином на версию, которой нет. `--pin-only`
// сокращает только хвост — migrate, init и выжимку CHANGELOG, — но не пробу.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { CONFIG_FILE, loadProject, parseCli, pinRe, pinSep, saveConfig } from './config.js';
import { CliError, info, ok, parseCommandArgs, warn } from './util.js';
import { compareVersions, latestVersion, normalizeVersion } from './version.js';
import { tr } from './i18n.js';
import { liveMarkdown } from './mdwalk.js';

// Первая версия с upgrade/migrate: ниже неё новая версия не сумеет ни принять пин, ни
// перевести формат, поэтому обновление туда — отказ по построению.
export const MIN_UPGRADE_TARGET = '0.2.0';

// Релиз — тег `vX.Y.Z`; другие теги источника не релизы. Промпт логина git подавлен: опечатка
// в адресе иначе ждала бы ввода в терминале до таймаута.
export function listReleaseTags(source, lang = 'ru') {
  const r = spawnSync('git', ['ls-remote', '--tags', '--refs', source], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim() || (r.error ? r.error.message : tr(lang, `код ${r.status}`, `code ${r.status}`));
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

// Пин живёт не только в конфиге: живая инструкция в docs зовёт версию текстом самой команды,
// и после upgrade зовёт снятую. Ищется спека с любым номером — той же, по которой предупреждает
// `lint`, а не литерал прежнего `cli`: иначе проза, отставшая на две версии (например, после
// `--pin-only`), не чинилась бы уже никогда. Записи, описывающие момент, а не запуск, —
// CHANGELOG, ADR, архив и карточки задач — остаются как были.
export function rewriteProsePins(root, docs, prefix, form, pin) {
  const re = pinRe(form);
  const target = `${form.spec}${pinSep(form)}${pin}`;
  const changed = [];
  for (const [rel, abs] of liveMarkdown(root, docs, prefix)) {
    const text = readFileSync(abs, 'utf8');
    const next = text.replace(re, target);
    if (next === text) continue;
    writeFileSync(abs, next);
    changed.push(rel);
  }
  return changed;
}

// Команда из конфига исполняется как есть, оболочкой: тот же уровень доверия, что у gates.
function exec(command, cwd, recovery, lang) {
  info(`→ ${command}`);
  const r = spawnSync(command, { cwd, shell: true, stdio: 'inherit', timeout: 10 * 60 * 1000 });
  if (r.status !== 0) {
    throw new CliError(tr(lang, `команда «${command}» завершилась кодом ${r.status ?? r.signal}. ${recovery}`, `command “${command}” exited with code ${r.status ?? r.signal}. ${recovery}`));
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
    throw new CliError(tr(cfg.lang,
      `cli «${cfg.cli}» — не установка из релиза, а источник релизов (поле source в ${CONFIG_FILE}) не задан: обновлять нечего. Репозиторий самого инструмента обновляется через git`,
      `cli “${cfg.cli}” is not a release installation and ${CONFIG_FILE} has no source field: there is nothing to update. Update the tool repository itself with git`));
  }

  const tags = listReleaseTags(source, cfg.lang);
  let target;
  if (values.to !== undefined) {
    target = normalizeVersion(values.to);
    if (target === null) throw new CliError(tr(cfg.lang, `--to «${values.to}»: нужна форма X.Y.Z`, `--to “${values.to}”: expected X.Y.Z`));
    if (!tags.includes(target)) throw new CliError(tr(cfg.lang, `тега v${target} в ${source} нет; есть: ${tags.length ? tags.map((t) => `v${t}`).join(', ') : 'ни одного'}`, `tag v${target} does not exist in ${source}; available: ${tags.length ? tags.map((t) => `v${t}`).join(', ') : 'none'}`));
  } else {
    target = latestVersion(tags);
    if (target === null) throw new CliError(tr(cfg.lang, `в ${source} нет тегов релизов вида vX.Y.Z`, `${source} has no release tags matching vX.Y.Z`));
  }
  if (compareVersions(target, MIN_UPGRADE_TARGET) < 0) {
    throw new CliError(tr(cfg.lang, `v${target} старше v${MIN_UPGRADE_TARGET}: у таких версий нет migrate и upgrade, обновиться на них нельзя`, `v${target} predates v${MIN_UPGRADE_TARGET}; those versions have no migrate or upgrade commands and cannot be upgrade targets`));
  }

  const current = form?.pin ?? cfg.version ?? null;
  const label = current ? `v${current}` : tr(cfg.lang, 'без пина и штампа', 'without a pin or version stamp');
  if (current && compareVersions(target, current) < 0) {
    throw new CliError(tr(cfg.lang, `понижение ${label} → v${target} не поддерживается: старая версия не знает формата файлов новой`, `downgrade ${label} → v${target} is not supported: the older version does not understand the newer file format`));
  }
  if (current && compareVersions(target, current) === 0 && values.to === undefined && cfg.version === current) {
    ok(tr(cfg.lang, `upgrade: проект уже на ${label}, новее v${target} в ${source} нет`, `upgrade: project is already on ${label}; ${source} has nothing newer than v${target}`));
    return 0;
  }

  const newCli = form ? form.withPin(target) : cfg.cli;
  const newGates = rewriteGates(cfg.gates, cfg.cli, newCli);
  info(tr(cfg.lang, `upgrade: ${label} → v${target} (источник ${source})`, `upgrade: ${label} → v${target} (source ${source})`));
  if (form) {
    info(`cli: ${cfg.cli} → ${newCli}`);
    info(tr(cfg.lang, `gates с новым пином: ${newGates.filter((g, i) => g !== cfg.gates[i]).length} из ${cfg.gates.length}`, `gates with the new pin: ${newGates.filter((g, i) => g !== cfg.gates[i]).length} of ${cfg.gates.length}`));
  } else {
    warn(tr(cfg.lang, `cli «${cfg.cli}» не в форме npx github:… или npx backslop@X.Y.Z: пин не меняется, обнови установку сам`, `cli “${cfg.cli}” is not an npx github:… or npx backslop@X.Y.Z pin: its pin is unchanged; update the installation yourself`));
  }
  if (dry) {
    info(tr(cfg.lang, '--dry-run: ничего не записано; дальше были бы пробный запуск новой версии, пин, migrate и init новой версией, выжимка CHANGELOG', '--dry-run: nothing was written; the real run would probe the new version, update the pin, run migrate and init with it, then print CHANGELOG entries'));
    return 0;
  }

  const recovery = tr(cfg.lang, `Пин и штамп не тронуты — повтори ${cfg.cli} upgrade${values.to !== undefined ? ` --to v${target}` : ''} после починки`, `Pin and version stamp were not changed — fix the problem, then retry ${cfg.cli} upgrade${values.to !== undefined ? ` --to v${target}` : ''}`);
  exec(`${newCli} version`, root, recovery, cfg.lang);

  if (form) {
    cfg.cli = newCli;
    cfg.gates = newGates;
    saveConfig(root, cfg);
  }
  if (form && !pinOnly) {
    const rewritten = rewriteProsePins(root, cfg.docs, cfg.prefix, form, target);
    info(tr(cfg.lang, `пин в прозе: ${rewritten.length} файлов`, `pin in prose: ${rewritten.length} files`));
  }
  if (pinOnly) {
    info(tr(cfg.lang, `пин переставлен; дальше сам: ${newCli} migrate && ${newCli} init`, `pin updated; finish manually: ${newCli} migrate && ${newCli} init`));
    return 0;
  }

  const afterPin = tr(cfg.lang, `Пин уже v${target}: доведи руками — ${newCli} migrate, затем ${newCli} init`, `Pin is already v${target}: finish manually with ${newCli} migrate, then ${newCli} init`);
  exec(`${newCli} migrate`, root, afterPin, cfg.lang);
  exec(`${newCli} init`, root, afterPin, cfg.lang);
  exec(current ? `${newCli} changelog --since v${current} --to v${target}` : `${newCli} changelog --to v${target}`, root, tr(cfg.lang, 'Обновление прошло, не напечаталась только выжимка CHANGELOG', 'Upgrade completed; only the CHANGELOG summary failed to print'), cfg.lang);
  ok(`upgrade: ${label} → v${target}`);
  return 0;
}
