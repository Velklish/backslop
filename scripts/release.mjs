#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

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

function main(argv) {
  if (argv.length !== 1 || !/^\d+\.\d+\.\d+$/.test(argv[0])) {
    throw new Error('нужен один аргумент в форме X.Y.Z: npm run release -- X.Y.Z');
  }
  const version = argv[0];
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
