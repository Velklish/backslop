// Обновление на новую версию: тег, пробный запуск, пин в `cli` и `gates`, затем migrate, init и
// выжимка CHANGELOG уже новой версией; пин — только после пробы (ADR-004, 02-cli.md, `upgrade`).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, gateEntry, loadProject, parseCli, pinRe, pinSep, saveConfig } from './config.js';
import { CliError, GIT_MAX_BUFFER, gitCause, info, ok, parseCommandArgs, warn } from './util.js';
import { compareVersions, latestVersion, normalizeVersion } from './version.js';
import { tr } from './i18n.js';
import { isJournalLine, livePinFiles, symlinkComponent } from './mdwalk.js';

// A release is a `vX.Y.Z` tag; git's login prompt is off, or a typo would wait for the timeout. git
// resolves a relative remote path from the repository toplevel, so a local one goes absolute.
export function listReleaseTags(source, lang = 'ru', root = process.cwd()) {
  const local = path.resolve(root, source);
  const r = spawnSync('git', ['ls-remote', '--tags', '--refs', existsSync(local) ? local : source], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.status !== 0) {
    throw new CliError(`git ls-remote --tags ${source}: ${gitCause(r, lang)}`);
  }
  return r.stdout.split('\n')
    .map((line) => line.split('\t')[1])
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => normalizeVersion(tag));
}

// Every pin of the cli spec in a command moves, and the old cli as a whole word too: a floating
// form carries no pin for `pinRe` to find.
export function rewriteCommand(command, oldCli, form, pin) {
  const whole = new RegExp(`(?<![^\\s;&|(])${oldCli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^\\s;&|)])`, 'g');
  return command.replace(whole, () => form.withPin(pin)).replace(pinRe(form), () => `${form.spec}${pinSep(form)}${pin}`);
}

// A scoped entry is rewritten inside and keeps `when`; an untouched entry stays the same
// reference, so the moved count compares against the original list.
export function rewriteGates(gates, oldCli, form, pin) {
  return gates.map((gate) => {
    const { command, when } = gateEntry(gate);
    const next = rewriteCommand(command, oldCli, form, pin);
    if (next === command) return gate;
    return when === null ? next : { ...gate, command: next };
  });
}

// A live file upgrade rewrites: `text`, or `null` behind a symlink (`link`) or not in UTF-8 — its
// write would leave the project or lose bytes. One predicate for the rewrite, the check and lint.
export function livePinText(root, abs) {
  const link = symlinkComponent(root, abs);
  if (link !== null) return { text: null, link };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(abs)), link: null };
  } catch {
    return { text: null, link: null };
  }
}

// Live files are the `livePinFiles` set that lint reads too (ADR-019).
export function rewriteProsePins(root, docs, prefix, form, pin, lang = 'ru') {
  const re = pinRe(form);
  const target = `${form.spec}${pinSep(form)}${pin}`;
  const changed = [];
  for (const [rel, abs] of livePinFiles(root, docs, prefix)) {
    const { text, link } = livePinText(root, abs);
    if (text === null) {
      // Named only with a stale pin in it; latin1 reads an ASCII pin whatever the file's bytes.
      const live = readFileSync(abs, 'latin1').split('\n').filter((line) => !isJournalLine(rel, docs, line));
      if (!live.some((line) => [...line.matchAll(re)].some((m) => m[1] !== pin))) continue;
      if (link !== null) {
        warn(tr(lang, `${rel}: путь идёт через symlink ${link} — пин не переставлен, запись ушла бы за ссылку`, `${rel}: the path goes through the symlink ${link} — pin not rewritten, the write would land behind the link`));
      } else {
        warn(tr(lang, `${rel}: не UTF-8 — пин не переставлен; перекодируй файл и повтори upgrade`, `${rel}: not valid UTF-8 — pin not rewritten; convert it, then rerun upgrade`));
      }
      continue;
    }
    const next = text.split('\n').map((line) => (isJournalLine(rel, docs, line) ? line : line.replace(re, target))).join('\n');
    if (next === text) continue;
    writeFileSync(abs, next);
    changed.push(rel);
  }
  return changed;
}
// `--pin-only` штамп не трогает, но после него и ручных migrate/init штамп уже новый: без этой
// проверки обычный upgrade на той же версии сказал бы «уже на vX», не дойдя до живых файлов.
function hasStaleLivePins(root, cfg, form) {
  if (!form || form.pin === null) return false;
  const re = pinRe(form);
  const commands = [...cfg.gates.map((gate) => gateEntry(gate).command), cfg.probe ?? ''];
  if (commands.some((command) => [...command.matchAll(re)].some((m) => m[1] !== form.pin))) return true;
  for (const [rel, abs] of livePinFiles(root, cfg.docs, cfg.prefix)) {
    const { text } = livePinText(root, abs);
    if (text === null) continue;
    for (const line of text.split('\n')) {
      if (isJournalLine(rel, cfg.docs, line)) continue;
      for (const match of line.matchAll(re)) {
        if (match[1] !== form.pin) return true;
      }
    }
  }
  return false;
}


// Команда из конфига исполняется как есть, оболочкой: тот же уровень доверия, что у gates.
// `capture` reruns silently for stdout, without stdin: the visible run before it showed any prompt.
function exec(command, cwd, recovery, lang, capture = false) {
  if (!capture) info(`→ ${command}`);
  const r = spawnSync(command, { cwd, shell: true, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', timeout: 10 * 60 * 1000 });
  if (r.status !== 0) {
    throw new CliError(tr(lang, `команда «${command}» завершилась кодом ${r.status ?? r.signal}. ${recovery}`, `command “${command}” exited with code ${r.status ?? r.signal}. ${recovery}`));
  }
  return r.stdout;
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

  const tags = listReleaseTags(source, cfg.lang, root);
  let target;
  if (values.to !== undefined) {
    target = normalizeVersion(values.to);
    if (target === null) throw new CliError(tr(cfg.lang, `--to «${values.to}»: нужна форма X.Y.Z`, `--to “${values.to}”: expected X.Y.Z`));
    if (!tags.includes(target)) throw new CliError(tr(cfg.lang, `тега v${target} в ${source} нет; есть: ${tags.length ? tags.map((t) => `v${t}`).join(', ') : 'ни одного'}`, `tag v${target} does not exist in ${source}; available: ${tags.length ? tags.map((t) => `v${t}`).join(', ') : 'none'}`));
  } else {
    target = latestVersion(tags);
    if (target === null) throw new CliError(tr(cfg.lang, `в ${source} нет тегов релизов вида vX.Y.Z`, `${source} has no release tags matching vX.Y.Z`));
  }

  const pin = form?.pin ?? null;
  const stamp = cfg.version ?? null;
  const current = pin ?? stamp;
  // The downgrade check stays on the pin; the label and CHANGELOG start from the lower of the two.
  const from = pin && stamp && compareVersions(stamp, pin) < 0 ? stamp : current;
  const label = from ? `v${from}` : tr(cfg.lang, 'без пина и штампа', 'without a pin or version stamp');
  if (current && compareVersions(target, current) < 0) {
    throw new CliError(tr(cfg.lang, `понижение v${current} → v${target} не поддерживается: старая версия не знает формата файлов новой`, `downgrade v${current} → v${target} is not supported: the older version does not understand the newer file format`));
  }
  const floating = form !== null && pin === null;
  if (!floating && current && compareVersions(target, current) === 0 && values.to === undefined && cfg.version === current && !hasStaleLivePins(root, cfg, form)) {
    ok(tr(cfg.lang, `upgrade: проект уже на ${label}, новее v${target} в ${source} нет`, `upgrade: project is already on ${label}; ${source} has nothing newer than v${target}`));
    return 0;
  }

  const newCli = form ? form.withPin(target) : cfg.cli;
  const newGates = form ? rewriteGates(cfg.gates, cfg.cli, form, target) : cfg.gates;
  const newProbe = form && cfg.probe !== undefined ? rewriteCommand(cfg.probe, cfg.cli, form, target) : cfg.probe;
  const both = pin && stamp && pin !== stamp ? tr(cfg.lang, `пин в cli v${pin}, штамп v${stamp}; `, `cli pin v${pin}, version stamp v${stamp}; `) : '';
  info(tr(cfg.lang, `upgrade: ${label} → v${target} (${both}источник ${source})`, `upgrade: ${label} → v${target} (${both}source ${source})`));
  if (form) {
    info(`cli: ${cfg.cli} → ${newCli}`);
    info(tr(cfg.lang, `gates с новым пином: ${newGates.filter((g, i) => g !== cfg.gates[i]).length} из ${cfg.gates.length}`, `gates with the new pin: ${newGates.filter((g, i) => g !== cfg.gates[i]).length} of ${cfg.gates.length}`));
    if (newProbe !== cfg.probe) info(`probe: ${cfg.probe} → ${newProbe}`);
  } else {
    warn(tr(cfg.lang, `cli «${cfg.cli}» не в форме npx github:… или npx backslop@X.Y.Z: пин не меняется, обнови установку сам`, `cli “${cfg.cli}” is not an npx github:… or npx backslop@X.Y.Z pin: its pin is unchanged; update the installation yourself`));
  }
  if (dry) {
    info(tr(cfg.lang, '--dry-run: ничего не записано; дальше были бы пробный запуск новой версии, пин, migrate и init новой версией, пин в живых файлах, выжимка CHANGELOG', '--dry-run: nothing was written; the real run would probe the new version, update the pin, run migrate and init with it, move pins in live files, then print CHANGELOG entries'));
    return 0;
  }

  const recovery = tr(cfg.lang, `Пин и штамп не тронуты — повтори ${cfg.cli} upgrade${values.to !== undefined ? ` --to v${target}` : ''} после починки`, `Pin and version stamp were not changed — fix the problem, then retry ${cfg.cli} upgrade${values.to !== undefined ? ` --to v${target}` : ''}`);
  // npx asks before an install on stdout: the first run keeps it visible, the second is parsed.
  exec(`${newCli} version`, root, recovery, cfg.lang);
  const printed = exec(`${newCli} version`, root, recovery, cfg.lang, true);
  const probed = normalizeVersion([...(printed ?? '').matchAll(/^backslop (\d+\.\d+\.\d+)\s*$/gm)].at(-1)?.[1]);
  if (probed === null) {
    throw new CliError(tr(cfg.lang, `«${newCli} version» не напечатал строку «backslop X.Y.Z». ${recovery}`, `“${newCli} version” printed no “backslop X.Y.Z” line. ${recovery}`));
  }
  if (probed !== target) {
    throw new CliError(tr(cfg.lang, `cli всё ещё запускает v${probed}, а не v${target} — обнови установку, затем повтори`, `cli still runs v${probed}, not v${target} — update the installation, then retry`));
  }

  if (form) {
    cfg.cli = newCli;
    cfg.gates = newGates;
    if (newProbe !== undefined) cfg.probe = newProbe;
    saveConfig(root, cfg);
  }
  const finish = form
    ? tr(cfg.lang, `${newCli} migrate && ${newCli} init, затем ${newCli} upgrade для живых пинов`, `${newCli} migrate && ${newCli} init, then ${newCli} upgrade for live pins`)
    : `${newCli} migrate && ${newCli} init`;
  if (pinOnly) {
    if (form) info(tr(cfg.lang, `пин переставлен; дальше сам: ${finish}`, `pin updated; finish manually: ${finish}`));
    return 0;
  }

  const afterPin = form
    ? tr(cfg.lang, `Пин уже v${target}: доведи руками — ${finish}`, `Pin is already v${target}: finish manually with ${finish}`)
    : tr(cfg.lang, `Доведи руками — ${finish}`, `Finish manually with ${finish}`);
  exec(`${newCli} migrate`, root, afterPin, cfg.lang);
  exec(`${newCli} init`, root, afterPin, cfg.lang);
  // Prose pins move after migrate and init: a moved pin in the rules pair would read to migrate
  // as an uncommitted edit.
  if (form) {
    const rewritten = rewriteProsePins(root, cfg.docs, cfg.prefix, form, target, cfg.lang);
    info(tr(cfg.lang, `пин в прозе: ${rewritten.length} файлов`, `pin in prose: ${rewritten.length} files`));
  }
  exec(from ? `${newCli} changelog --since v${from} --to v${target}` : `${newCli} changelog --to v${target}`, root, tr(cfg.lang, 'Обновление прошло, не напечаталась только выжимка CHANGELOG', 'Upgrade completed; only the CHANGELOG summary failed to print'), cfg.lang);
  ok(`upgrade: ${label} → v${target}`);
  return 0;
}
