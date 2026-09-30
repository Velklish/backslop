// Обновление на новую версию: тег, пробный запуск, пин в `cli` и `gates`, затем migrate, init и
// выжимка CHANGELOG уже новой версией; пин — только после пробы (ADR-048, 02-cli.md, `upgrade`).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { CONFIG_FILE, gateEntry, loadProject, parseCli, pinRe, pinSep, pinTailRe, saveConfig } from './config.js';
import { CliError, GIT_MAX_BUFFER, escapeRe, gitCause, info, ok, parseCommandArgs, runShell, shellOutcome, shellPassed, warn } from './util.js';
import { compareVersions, latestVersion, normalizeVersion } from './version.js';
import { msg } from './i18n.js';
import { UnreadableDir, isJournalLine, livePinFiles, stalePins, symlinkComponent, wordUnreadable } from './mdwalk.js';

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
  const whole = new RegExp(`(?<![^\\s;&|("'])${escapeRe(oldCli)}(?![^\\s;&|)"'])`, 'g');
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

const pinsUnreadable = (lang) => msg(lang, 'pins cannot be read from it');

// Live files are the `livePinFiles` set that lint reads too (ADR-048).
export function rewriteProsePins(root, docs, prefix, form, pin, lang = 'ru') {
  const re = pinRe(form);
  const target = `${form.spec}${pinSep(form)}${pin}`;
  const changed = [];
  for (const [rel, abs] of wordUnreadable(root, lang, pinsUnreadable(lang), () => livePinFiles(root, docs, prefix))) {
    const { text, link } = livePinText(root, abs);
    if (text === null) {
      // Named only with a stale pin in it; latin1 reads an ASCII pin whatever the file's bytes.
      const live = readFileSync(abs, 'latin1').split('\n').filter((line) => !isJournalLine(rel, docs, line));
      if (!live.some((line) => [...line.matchAll(re)].some((m) => m[1] !== pin))) continue;
      if (link !== null) {
        warn(msg(lang, '{rel}: the path goes through the symlink {link} — pin not rewritten, the write would land behind the link', { rel, link }));
      } else {
        warn(msg(lang, '{rel}: not valid UTF-8 — pin not rewritten; convert it, then rerun upgrade', { rel }));
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
  const tailed = pinTailRe(form);
  if (commands.some((command) => [...command.matchAll(re)].some((m) => m[1] !== form.pin) || command.match(tailed))) return true;
  // Read as the rewrite reads: a file it skips is empty here, or every later upgrade would rerun.
  const stale = () => stalePins(root, cfg.docs, cfg.prefix, form, (abs) => livePinText(root, abs).text ?? '');
  return wordUnreadable(root, cfg.lang, pinsUnreadable(cfg.lang), stale).length > 0;
}


// Команда из конфига исполняется как есть, оболочкой: тот же уровень доверия, что у gates.
// `capture` reruns silently for stdout, without stdin: the visible run before it showed any prompt.
function exec(command, cwd, recovery, lang, { capture = false, timeout } = {}) {
  if (!capture) info(`→ ${command}`);
  const r = runShell(command, { cwd, capture, timeout });
  if (!shellPassed(r)) {
    const why = shellOutcome(r, lang);
    throw new CliError(msg(lang, 'step “{command}” — {why}. {recovery}', { command, why, recovery }));
  }
  return r.stdout;
}

export async function run(argv, { cwd, lang, timeout }) {
  const { values } = parseCommandArgs(argv, {
    to: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'pin-only': { type: 'boolean' },
  }, { positionals: 0, lang });
  const dry = values['dry-run'] === true;
  const pinOnly = values['pin-only'] === true;

  const project = loadProject(cwd);
  const { root, cfg } = project;
  const form = parseCli(cfg.cli);
  const source = cfg.source ?? form?.repoUrl ?? null;
  if (!source) {
    throw new CliError(msg(cfg.lang,
      'cli “{cli}” is not a release installation and {config} has no source field: there is nothing to update. Update the tool repository itself with git', { cli: cfg.cli, config: CONFIG_FILE }));
  }

  const wanted = values.to === undefined ? null : normalizeVersion(values.to);
  if (values.to !== undefined && wanted === null) throw new CliError(msg(cfg.lang, '--to “{to}”: expected X.Y.Z', { to: values.to }));
  const tags = listReleaseTags(source, cfg.lang, root);
  let target;
  if (wanted !== null) {
    target = wanted;
    if (!tags.includes(target)) {
      throw new CliError(tags.length
        ? msg(cfg.lang, 'tag v{target} does not exist in {source}; available: {tags}', { target, source, tags: tags.map((t) => `v${t}`).join(', ') })
        : msg(cfg.lang, 'tag v{target} does not exist in {source}; available: none', { target, source }));
    }
  } else {
    target = latestVersion(tags);
    if (target === null) throw new CliError(msg(cfg.lang, '{source} has no release tags matching vX.Y.Z', { source }));
  }

  const pin = form?.pin ?? null;
  const stamp = cfg.version ?? null;
  const current = pin ?? stamp;
  // The downgrade check stays on the pin; the label and CHANGELOG start from the lower of the two.
  const from = pin && stamp && compareVersions(stamp, pin) < 0 ? stamp : current;
  const label = from ? `v${from}` : msg(cfg.lang, 'without a pin or version stamp');
  if (current && compareVersions(target, current) < 0) {
    throw new CliError(msg(cfg.lang, 'downgrade v{current} → v{target} is not supported: the older version does not understand the newer file format', { current, target }));
  }
  const floating = form !== null && pin === null;
  if (!floating && current && compareVersions(target, current) === 0 && values.to === undefined && cfg.version === current && !hasStaleLivePins(root, cfg, form)) {
    ok(msg(cfg.lang, 'upgrade: project is already on {label}; {source} has nothing newer than v{target}', { label, source, target }));
    return 0;
  }

  const newCli = form ? form.withPin(target) : cfg.cli;
  const newGates = form ? rewriteGates(cfg.gates, cfg.cli, form, target) : cfg.gates;
  const newProbe = form && cfg.probe !== undefined ? rewriteCommand(cfg.probe, cfg.cli, form, target) : cfg.probe;
  const both = pin && stamp && pin !== stamp ? msg(cfg.lang, 'cli pin v{pin}, version stamp v{stamp}; ', { pin, stamp }) : '';
  info(msg(cfg.lang, 'upgrade: {label} → v{target} ({both}source {source})', { label, target, both, source }));
  if (form) {
    info(`cli: ${cfg.cli} → ${newCli}`);
    info(msg(cfg.lang, 'gates with the new pin: {changed} of {gates}', { changed: newGates.filter((g, i) => g !== cfg.gates[i]).length, gates: cfg.gates.length }));
    if (newProbe !== cfg.probe) info(`probe: ${cfg.probe} → ${newProbe}`);
  } else {
    warn(msg(cfg.lang, 'cli “{cli}” is not an npx github:… or npx backslop@X.Y.Z pin: its pin is unchanged; update the installation yourself', { cli: cfg.cli }));
  }
  if (dry) {
    info(msg(cfg.lang, '--dry-run: nothing was written; the real run would probe the new version, update the pin, run migrate and init with it, move pins in live files, then print CHANGELOG entries'));
    return 0;
  }

  const recovery = msg(cfg.lang, 'Pin and version stamp were not changed — fix the problem, then retry {cli} upgrade{to}', { cli: cfg.cli, to: values.to !== undefined ? ` --to v${target}` : '' });
  // npx asks before an install on stdout: the first run keeps it visible, the second is parsed.
  exec(`${newCli} version`, root, recovery, cfg.lang, { timeout });
  const printed = exec(`${newCli} version`, root, recovery, cfg.lang, { capture: true, timeout });
  const probed = normalizeVersion([...(printed ?? '').matchAll(/^backslop (\d+\.\d+\.\d+)\s*$/gm)].at(-1)?.[1]);
  if (probed === null) {
    throw new CliError(msg(cfg.lang, '“{newCli} version” printed no “backslop X.Y.Z” line. {recovery}', { newCli, recovery }));
  }
  if (probed !== target) {
    throw new CliError(msg(cfg.lang, 'cli still runs v{probed}, not v{target} — update the installation, then retry', { probed, target }));
  }

  if (form) {
    cfg.cli = newCli;
    cfg.gates = newGates;
    if (newProbe !== undefined) cfg.probe = newProbe;
    saveConfig(root, cfg);
  }
  const finish = form
    ? msg(cfg.lang, '{newCli} migrate && {newCli} init, then {newCli} upgrade for live pins', { newCli })
    : `${newCli} migrate && ${newCli} init`;
  if (pinOnly) {
    if (form) info(msg(cfg.lang, 'pin updated; finish manually: {finish}', { finish }));
    return 0;
  }

  const afterPin = form
    ? msg(cfg.lang, 'Pin is already v{target}: finish manually with {finish}', { target, finish })
    : msg(cfg.lang, 'Finish manually with {finish}', { finish });
  exec(`${newCli} migrate`, root, afterPin, cfg.lang, { timeout });
  exec(`${newCli} init`, root, afterPin, cfg.lang, { timeout });
  // Prose pins move after migrate and init: a moved pin in the rules pair would read to migrate
  // as an uncommitted edit.
  if (form) {
    let rewritten;
    try {
      rewritten = rewriteProsePins(root, cfg.docs, cfg.prefix, form, target, cfg.lang);
    } catch (e) {
      if (e instanceof UnreadableDir) throw new CliError(`${e.message}. ${afterPin}`);
      throw e;
    }
    info(msg(cfg.lang, 'pin in prose: {rewritten} files', { rewritten: rewritten.length }));
  }
  exec(from ? `${newCli} changelog --since v${from} --to v${target}` : `${newCli} changelog --to v${target}`, root, msg(cfg.lang, 'Upgrade completed; only the CHANGELOG summary failed to print'), cfg.lang, { timeout });
  ok(`upgrade: ${label} → v${target}`);
  return 0;
}
