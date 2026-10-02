import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LIB = path.join(ROOT, 'lib');

// The command-to-command imports 06-module-map.md lists: all for a function, never for `run`.
const ALLOWED = ['fold>links', 'hook>lint', 'lint>links', 'migrate>links', 'seed>links'];

test('command modules import another command module only through the imports listed in ALLOWED', () => {
  const commands = new Set(readFileSync(path.join(ROOT, 'bin', 'backslop.js'), 'utf8')
    .match(/const COMMANDS = \[(.*?)\]/s)[1].match(/'([^']+)'/g).map((q) => q.slice(1, -1)));
  const found = [];
  for (const file of readdirSync(LIB).filter((f) => f.endsWith('.js'))) {
    const from = file.slice(0, -3);
    if (!commands.has(from)) continue;
    for (const [, target] of readFileSync(path.join(LIB, file), 'utf8').matchAll(/from '\.\/([\w-]+)\.js'/g)) {
      if (commands.has(target)) found.push(`${from}>${target}`);
    }
  }
  assert.deepEqual(found.sort(), ALLOWED);
});
