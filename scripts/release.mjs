#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { today } from '../lib/util.js';
import { compareVersions } from '../lib/version.js';

function fail(message) {
  process.stderr.write(`release: ${message}\n`);
  process.exitCode = 1;
}

function command(bin, args, { capture = false, allow = [] } = {}) {
  process.stdout.write(`release: → ${bin} ${args.join(' ')}\n`);
  const result = spawnSync(bin, args, {
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(`${bin}: ${result.error.message}`);
  if (result.status !== 0 && !allow.includes(result.status)) {
    const detail = capture ? (result.stderr ?? '').trim() : '';
    throw new Error(`${bin} ${args.join(' ')}: код ${result.status ?? result.signal}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync('package.json', 'utf8')).version;
  } catch (error) {
    throw new Error(`package.json не читается: ${error.message}`);
  }
}

function tagExistsLocally(tag) {
  return command('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { capture: true, allow: [1] }).status === 0;
}

function tagExistsOnOrigin(tag) {
  return command('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], { capture: true, allow: [2] }).status === 0;
}

// Бамп — отдельный ход перед релизом: версия пакета, штамп раскладки (его ставит init новой
// версией) и заголовок верхней секции CHANGELOG. Совместить его с релизом нельзя — preflight
// требует чистого дерева, а коммитов скрипт не пишет: дифф проверяет и коммитит агент.
function bump(version) {
  const pkg = readFileSync('package.json', 'utf8');
  const current = packageVersion();
  // Только вверх: понижение прошло бы оба guard'а и оставило дерево полубампнутым —
  // package.json на новой версии, а `init` уже отказал бы «штамп новее инструмента».
  if (compareVersions(version, current) <= 0) throw new Error(`package.json на version ${current}: bump идёт только вверх, ${version} не старше`);
  const bumped = pkg.replace(`"version": "${current}"`, `"version": "${version}"`);
  if (bumped === pkg) throw new Error(`package.json: строки "version": "${current}" нет — бампни руками`);
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const heading = changelog.match(/^## .*$/m);
  if (!heading) throw new Error('CHANGELOG.md: нет ни одной секции «## »');
  if (/^## v\d/.test(heading[0])) throw new Error(`CHANGELOG.md: верхняя секция «${heading[0]}» уже выпущена — нечего переименовывать в v${version}`);
  const section = `## v${version} — ${today()}`;

  // Проверки все до первой записи: отказ на середине оставил бы package.json бампнутым, а
  // CHANGELOG — со старым заголовком, и это ровно тот рассинхрон, который гейт 11 ловит.
  writeFileSync('package.json', bumped);
  writeFileSync('CHANGELOG.md', changelog.replace(heading[0], section));
  command('node', ['bin/backslop.js', 'init']);
  process.stdout.write(`release: bump ${current} → ${version}: package.json, CHANGELOG.md («${heading[0]}» → «${section}»), штамп backslop.json через init\n`);
  process.stdout.write(`release: проверь дифф и закоммить, затем npm run release -- ${version}\n`);
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith('-'));
  const positionals = argv.filter((a) => !a.startsWith('-'));
  const unknown = flags.filter((f) => f !== '--bump');
  if (unknown.length) throw new Error(`неизвестный флаг ${unknown[0]}: есть только --bump`);
  if (positionals.length !== 1 || !/^\d+\.\d+\.\d+$/.test(positionals[0])) {
    throw new Error('нужен один аргумент в форме X.Y.Z: npm run release -- X.Y.Z [--bump]');
  }
  const version = positionals[0];
  if (flags.includes('--bump')) {
    bump(version);
    return;
  }
  const tag = `v${version}`;
  const actualVersion = packageVersion();
  if (actualVersion !== version) throw new Error(`package.json: version ${actualVersion}, а релиз запрошен ${version}`);

  const branch = command('git', ['branch', '--show-current'], { capture: true }).stdout.trim();
  if (branch !== 'main') throw new Error(`текущая ветка «${branch || 'detached HEAD'}», релиз разрешён только из main`);
  const dirty = command('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
  if (dirty) throw new Error(`рабочее дерево нечисто:\n${dirty}`);
  if (tagExistsLocally(tag)) throw new Error(`локальный тег ${tag} уже существует`);
  if (tagExistsOnOrigin(tag)) throw new Error(`тег ${tag} уже существует в origin`);
  command('git', ['fetch', 'origin']);
  const ancestor = command('git', ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'], { capture: true, allow: [1] });
  if (ancestor.status !== 0) {
    throw new Error('локальный main не является fast-forward от origin/main: atomic push отказал бы после npm publish');
  }

  command('npm', ['test']);
  command('npm', ['run', 'lint']);
  command('npm', ['pack', '--dry-run']);
  const dirtyAfterGates = command('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
  if (dirtyAfterGates) throw new Error(`gates изменили рабочее дерево; тег не создан:\n${dirtyAfterGates}`);
  command('git', ['tag', tag]);
  try {
    command('git', ['push', '--atomic', '--dry-run', 'origin', 'main', tag]);
  } catch (error) {
    throw new Error(`${error.message}\nstate: локальный тег ${tag} создан; origin не изменён; npm registry не тронут\nnext: устрани отказ push (или удали локальный тег ${tag} и повтори release)`);
  }

  try {
    command('npm', ['publish']);
  } catch (error) {
    throw new Error(`${error.message}\nstate: локальный тег ${tag} создан; origin не изменён; состояние npm registry неизвестно\nnext: npm view backslop@${version} version\nif published: git push --atomic origin main ${tag}\nif E404: npm publish, затем git push --atomic origin main ${tag}`);
  }

  try {
    command('git', ['push', '--atomic', 'origin', 'main', tag]);
  } catch (error) {
    throw new Error(`${error.message}\nstate: backslop@${version} опубликован; локальный тег ${tag} создан; atomic push не подтверждён\nnext: git push --atomic origin main ${tag}`);
  }
  process.stdout.write(`release: backslop@${version} опубликован, main и ${tag} атомарно отправлены\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}
