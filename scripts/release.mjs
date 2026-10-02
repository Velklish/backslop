#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { today } from '../lib/util.js';
import { sectionVersion } from '../lib/changelog-format.js';
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
    throw new Error(`${bin} ${args.join(' ')}: exit code ${result.status ?? result.signal}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync('package.json', 'utf8')).version;
  } catch (error) {
    throw new Error(`package.json cannot be read: ${error.message}`);
  }
}

function tagExistsLocally(tag) {
  return command('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { capture: true, allow: [1] }).status === 0;
}

function tagExistsOnOrigin(tag) {
  return command('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], { capture: true, allow: [2] }).status === 0;
}

// A bump is a step before the release: the package version, the layout stamp (via `init`) and
// the top CHANGELOG heading. The release needs a clean tree, so the bump is committed first.
function bump(version) {
  const pkg = readFileSync('package.json', 'utf8');
  const current = packageVersion();
  // Upward only: a lower version would pass the checks below and leave the tree half-bumped,
  // because `init` refuses a stamp newer than the tool.
  if (compareVersions(version, current) <= 0) throw new Error(`package.json is at version ${current}: bump goes only upward, ${version} is not newer`);
  const bumped = pkg.replace(`"version": "${current}"`, `"version": "${version}"`);
  if (bumped === pkg) throw new Error(`package.json: no line "version": "${current}" — bump it by hand`);
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const heading = changelog.match(/^## (.*)$/m);
  if (!heading) throw new Error('CHANGELOG.md: no “## ” section at all');
  if (sectionVersion(heading[1].trim()) !== null) throw new Error(`CHANGELOG.md: the top section “${heading[0]}” is already released — nothing to rename to v${version}`);
  const section = `## v${version} — ${today()}`;

  // All checks come before the first write: a refusal midway would leave drift lint catches.
  // `init` is not covered and may refuse after two writes; the stamp then stays as it was.
  writeFileSync('package.json', bumped);
  writeFileSync('CHANGELOG.md', changelog.replace(heading[0], section));
  command(process.execPath, ['bin/backslop.js', 'init']);
  process.stdout.write(`release: bump ${current} → ${version}: package.json, CHANGELOG.md (“${heading[0]}” → “${section}”), backslop.json stamp through init\n`);
  process.stdout.write(`release: review the diff and commit, then npm run release -- ${version} --no-publish\n`);
}

function main(argv) {
  const flags = argv.filter((a) => a.startsWith('-'));
  const positionals = argv.filter((a) => !a.startsWith('-'));
  const known = ['--bump', '--no-publish'];
  const unknown = flags.filter((f) => !known.includes(f));
  if (unknown.length) throw new Error(`unknown flag ${unknown[0]}: the flags are ${known.join(' and ')}`);
  if (positionals.length !== 1 || !/^\d+\.\d+\.\d+$/.test(positionals[0])) {
    throw new Error('one argument of the form X.Y.Z is required: npm run release -- X.Y.Z [--bump | --no-publish]');
  }
  const version = positionals[0];
  if (flags.includes('--bump') && flags.includes('--no-publish')) {
    throw new Error('--bump and --no-publish together make no sense: bump publishes nothing and never reaches the release');
  }
  if (flags.includes('--bump')) {
    bump(version);
    return;
  }
  // The tag and the atomic push are needed even without an npm publish:
  // `--no-publish` is the regular release path, not a way around the script.
  const publish = !flags.includes('--no-publish');
  const tag = `v${version}`;
  const actualVersion = packageVersion();
  if (actualVersion !== version) throw new Error(`package.json: version ${actualVersion}, but the release asked for is ${version}`);

  const branch = command('git', ['branch', '--show-current'], { capture: true }).stdout.trim();
  if (branch !== 'main') throw new Error(`the current branch is “${branch || 'detached HEAD'}”, a release is allowed only from main`);
  const dirty = command('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
  if (dirty) throw new Error(`the working tree is dirty:\n${dirty}`);
  if (tagExistsLocally(tag)) throw new Error(`the local tag ${tag} already exists`);
  if (tagExistsOnOrigin(tag)) throw new Error(`the tag ${tag} already exists in origin`);
  command('git', ['fetch', 'origin']);
  const ancestor = command('git', ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'], { capture: true, allow: [1] });
  if (ancestor.status !== 0) {
    const tail = publish ? 'the atomic push would be refused after npm publish' : 'the atomic push would be refused';
    throw new Error(`local main is not a fast-forward from origin/main: ${tail}`);
  }

  command('npm', ['test']);
  command('npm', ['run', 'lint']);
  command('npm', ['pack', '--dry-run']);
  const dirtyAfterGates = command('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
  if (dirtyAfterGates) throw new Error(`the gates changed the working tree; the tag is not created:\n${dirtyAfterGates}`);
  command('git', ['tag', tag]);
  try {
    command('git', ['push', '--atomic', '--dry-run', 'origin', 'main', tag]);
  } catch (error) {
    throw new Error(`${error.message}\nstate: the local tag ${tag} is created; origin is unchanged; the npm registry is untouched\nnext: fix the push refusal, then delete the local tag — git tag -d ${tag} — and rerun release`);
  }

  if (publish) {
    try {
      command('npm', ['publish']);
    } catch (error) {
      throw new Error(`${error.message}\nstate: the local tag ${tag} is created; origin is unchanged; the npm registry state is unknown\nnext: npm view backslop@${version} version\nif published: git push --atomic origin main ${tag}\nif E404: npm publish, then git push --atomic origin main ${tag}`);
    }
  }

  const published = publish ? `backslop@${version} is published` : 'npm publish was not run (--no-publish)';
  try {
    command('git', ['push', '--atomic', 'origin', 'main', tag]);
  } catch (error) {
    throw new Error(`${error.message}\nstate: ${published}; the local tag ${tag} is created; the atomic push is not confirmed\nnext: git push --atomic origin main ${tag}`);
  }
  process.stdout.write(`release: ${published}, main and ${tag} pushed atomically\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}
