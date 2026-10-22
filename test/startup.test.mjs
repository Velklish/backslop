import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BIN, cleanup, cli, gitAll, put, read, run, ruTwinLine } from './helpers.mjs';

const output = {
  claude: '.claude/skills/backslop-task/SKILL.md',
  cursor: '.cursor/rules/backslop-task.mdc',
  codex: '.agents/skills/backslop-task/SKILL.md',
};

function project(tools, lang = 'en') {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'backslop startup space-')));
  run(root, ['init', '-q', '-b', 'main']);
  run(root, ['config', 'user.name', 'test']);
  run(root, ['config', 'user.email', 'test@example.com']);
  const pin = `"${process.execPath}" "${BIN}"`;
  const r = cli(root, ['init', '--tools', tools.join(',') || 'none', '--lang', lang, '--cli', pin]);
  assert.equal(r.code, 0, r.err);
  return root;
}

function startup(root, current) {
  const cfg = JSON.parse(read(root, 'backslop.json'));
  if (!cfg.tools.includes(current)) return 0;
  const instruction = read(root, 'AGENTS.md');
  const flag = instruction.includes('lint --require-adapter <tool>')
    ? ['--require-adapter', current] : ['--require-adapters'];
  const check = cli(root, ['lint', ...flag]);
  if (check.code === 0) return 0;
  const repair = cli(root, ['init']);
  assert.equal(repair.code, 0, repair.err);
  assert.equal(cli(root, ['lint', ...flag]).code, 0);
  return 1;
}

function adapterSnapshot(root, tool) {
  const dir = output[tool].split('/').slice(0, 2).join('/');
  return readdirSync(path.join(root, dir), { recursive: true }).sort()
    .map((rel) => `${dir}/${rel}`).filter((rel) => statSync(path.join(root, rel)).isFile())
    .map((rel) => ({ rel, sha256: createHash('sha256').update(read(root, rel)).digest('hex'),
      mtime: statSync(path.join(root, rel)).mtimeMs }));
}

for (const lang of ['en', 'ru']) {
  for (const current of ['claude', 'cursor', 'codex']) {
    test(`startup: mixed ${lang} valid ${current} does not rebuild for another missing adapter`, () => {
      const other = current === 'cursor' ? 'codex' : 'cursor';
      const root = project([current, other], lang);
      try {
        rmSync(path.join(root, output[other].split('/').slice(0, 2).join('/')), { recursive: true });
        const before = adapterSnapshot(root, current);
        assert.equal(startup(root, current), 0, 'valid current adapter must not invoke init for another missing adapter');
        assert.deepEqual(adapterSnapshot(root, current), before, 'current adapter bytes and mtimes stay unchanged');
        assert.equal(existsSync(path.join(root, output[other])), false, 'startup leaves the other missing adapter alone');
      } finally { cleanup(root); }
    });
    test(`startup: mixed ${lang} missing ${current} repairs through the configured init contract`, () => {
      const other = current === 'cursor' ? 'codex' : 'cursor';
      const root = project([current, other], lang);
      try {
        const config = read(root, 'backslop.json');
        const otherBefore = read(root, output[other]);
        rmSync(path.join(root, output[current].split('/').slice(0, 2).join('/')), { recursive: true });
        assert.equal(startup(root, current), 1);
        assert.equal(read(root, 'backslop.json'), config, 'bare init preserves tools, language, version and pin');
        assert.equal(read(root, output[other]), otherBefore);
        assert.equal(startup(root, current), 0, 'repeated startup needs no init');
      } finally { cleanup(root); }
    });
  }
}

test('startup: none and an unselected current harness do not initialize', () => {
  for (const tools of [[], ['cursor']]) {
    const root = project(tools);
    try {
      const config = read(root, 'backslop.json');
      assert.equal(startup(root, 'codex'), 0);
      assert.equal(existsSync(path.join(root, output.codex)), false);
      assert.equal(read(root, 'backslop.json'), config);
    } finally { cleanup(root); }
  }
});

test('startup: the tracked instruction precedes task selection in both languages and uses the configured CLI', () => {
  for (const lang of ['en', 'ru']) {
    const root = project(['codex'], lang);
    try {
      const agents = read(root, 'AGENTS.md');
      const line = lang === 'en' ? '**Agent startup' : ruTwinLine('agents-section.md', '**Agent startup').split('**')[1];
      assert.ok(agents.indexOf(line) >= 0, 'startup instruction exists before skills are available');
      assert.ok(agents.indexOf(line) < agents.indexOf('\n1. '), 'startup happens before taking a task');
      const { cli: pin } = JSON.parse(read(root, 'backslop.json'));
      assert.ok(agents.includes(`${pin} lint --require-adapter <tool>`));
      assert.ok(agents.includes(`${pin} init`));
      assert.ok(agents.includes('backslop.json'));
      assert.doesNotMatch(agents, /\{\{/);
    } finally { cleanup(root); }
  }
});

test('startup: Claude import survives Git enumeration and a fresh clone without generated skills', () => {
  const root = project(['claude']);
  const clone = `${root}-clone`;
  try {
    gitAll(root);
    assert.match(run(root, ['ls-files']).stdout, /^CLAUDE\.md$/m);
    run(root, ['clone', '-q', root, clone]);
    assert.equal(read(clone, 'CLAUDE.md'), '@AGENTS.md\n');
    assert.ok(read(clone, 'AGENTS.md').includes('lint --require-adapter <tool>'));
    assert.equal(existsSync(path.join(clone, output.claude)), false);
    assert.equal(cli(clone, ['lint']).code, 0);
    const strict = cli(clone, ['lint', '--require-adapters']);
    assert.equal(strict.code, 1, strict.err);
    assert.match(strict.err, /generated output for adapter claude is missing/);
  } finally { cleanup(root); cleanup(clone); }
});

for (const lang of ['en', 'ru']) {
  for (const tools of [['claude'], ['cursor'], ['codex'], ['claude', 'cursor', 'codex'], []]) {
    test(`startup: ${lang} ${tools.join('+') || 'none'} missing, partial and valid outputs preserve project bytes`, () => {
      const root = project(tools, lang);
      try {
        put(root, 'AGENTS.md', `# User instructions\n\n${read(root, 'AGENTS.md')}\nKeep this tail.\n`);
        if (tools.includes('claude')) put(root, 'CLAUDE.md', '# Custom instructions\n\n@AGENTS.md\n');
        put(root, '.claude/settings.json', '{"custom":true}\n');
        put(root, '.cursor/hooks.json', '{"version":1,"hooks":{},"custom":true}\n');
        put(root, '.codex/config.toml', 'model = "unchanged"\n');
        const added = cli(root, ['new', 'preserved', '--title', 'Preserved', '--queue']);
        assert.equal(added.code, 0, added.err);
        const card = read(root, 'docs/backlog/queue/BS-1-preserved.md')
          .replace(/\[TODO[^\]]*\]/, '[Reference](../../reference/README.md)')
          .replace(/\[TODO[^\]]*\]/g, 'Preserved');
        put(root, 'docs/backlog/queue/BS-1-preserved.md', card);
        const files = ['backslop.json', 'AGENTS.md', 'docs/README.md', 'docs/backlog/README.md',
          'docs/backlog/queue/BS-1-preserved.md', '.claude/settings.json', '.cursor/hooks.json', '.codex/config.toml'];
        if (tools.includes('claude')) files.push('CLAUDE.md');
        const before = files.map((rel) => read(root, rel));
        for (const tool of tools) rmSync(path.join(root, output[tool].split('/').slice(0, 2).join('/')), { recursive: true });
        const missing = cli(root, ['lint', '--require-adapters']);
        assert.equal(missing.code, tools.length ? 1 : 0, missing.err);
        if (tools.length) {
          const restored = cli(root, ['init']);
          assert.equal(restored.code, 0, restored.err);
          assert.equal(cli(root, ['lint', '--require-adapters']).code, 0);
          for (const tool of tools) {
            const rel = tool === 'cursor' ? '.cursor/rules/backslop-batch/references/measurements.md' : `${output[tool].split('/').slice(0, 2).join('/')}/backslop-batch/references/measurements.md`;
            rmSync(path.join(root, rel));
          }
          assert.equal(cli(root, ['lint']).code, 1, 'present skills still expose links to missing references');
          assert.equal(cli(root, ['lint', '--require-adapters']).code, 1, 'partial outputs need restoration');
          assert.equal(cli(root, ['init']).code, 0);
          const times = tools.map((tool) => statSync(path.join(root, output[tool])).mtimeMs);
          assert.equal(cli(root, ['lint', '--require-adapters']).code, 0);
          assert.deepEqual(tools.map((tool) => statSync(path.join(root, output[tool])).mtimeMs), times, 'valid check never rebuilds');
          assert.equal(cli(root, ['init']).code, 0, 'repeated restoration succeeds');
        } else {
          for (const rel of Object.values(output)) assert.equal(existsSync(path.join(root, rel)), false);
        }
        assert.deepEqual(files.map((rel) => read(root, rel)), before);
      } finally { cleanup(root); }
    });
  }
}

test('startup: existing managed Claude ignore migrates without touching user ignore lines or custom instructions', () => {
  const root = project(['claude']);
  try {
    put(root, '.gitignore', 'private/\n# backslop:start\n.claude/skills/backslop-*\n/CLAUDE.md\n# backslop:end\nlocal/\n');
    put(root, 'CLAUDE.md', '# Custom\n@AGENTS.md\n');
    assert.equal(cli(root, ['init']).code, 0);
    assert.equal(read(root, 'CLAUDE.md'), '# Custom\n@AGENTS.md\n');
    assert.equal(read(root, '.gitignore'), 'private/\n# backslop:start\n.claude/skills/backslop-*\n# backslop:end\nlocal/\n');
  } finally { cleanup(root); }
});

test('startup: strict check reports foreign and invalid outputs without writing over them', () => {
  const root = project(['codex']);
  try {
    put(root, output.codex, '# Foreign skill\n');
    const r = cli(root, ['lint', '--require-adapters']);
    assert.equal(r.code, 1);
    assert.match(r.err, /a foreign file without the .* marker/);
    assert.equal(cli(root, ['init']).code, 0, 'existing init reports foreign ownership as a warning');
    assert.equal(read(root, output.codex), '# Foreign skill\n');
    assert.equal(cli(root, ['lint', '--require-adapters']).code, 1);
    rmSync(path.join(root, output.codex));
    put(root, output.codex, '<!-- backslop:generated -->\n[Broken](missing-file.md)\n');
    assert.equal(cli(root, ['lint', '--require-adapters']).code, 1, 'owned invalid links require restoration');
    assert.equal(cli(root, ['init']).code, 0);
    assert.equal(cli(root, ['lint', '--require-adapters']).code, 0);
  } finally { cleanup(root); }
});


test('startup: configured hooks and their foreign settings survive restoration', () => {
  const root = project(['claude', 'cursor', 'codex']);
  try {
    assert.equal(cli(root, ['init', '--hooks', 'claude,cursor,codex']).code, 0);
    const files = ['backslop.json', '.claude/settings.json', '.cursor/hooks.json', '.codex/hooks.json'];
    const before = files.map((rel) => read(root, rel));
    for (const tool of Object.keys(output)) {
      rmSync(path.join(root, output[tool].split('/').slice(0, 2).join('/')), { recursive: true });
    }
    assert.equal(cli(root, ['init']).code, 0);
    assert.deepEqual(files.map((rel) => read(root, rel)), before);
    assert.equal(cli(root, ['lint', '--require-adapters']).code, 0);
  } finally { cleanup(root); }
});

test('startup: invalid configuration and blocked output paths fail without rewriting project files', () => {
  const root = project(['codex']);
  try {
    const before = read(root, 'AGENTS.md');
    const config = read(root, 'backslop.json');
    put(root, 'backslop.json', '{invalid');
    assert.equal(cli(root, ['lint', '--require-adapters']).code, 1);
    assert.equal(cli(root, ['init']).code, 1);
    assert.equal(read(root, 'backslop.json'), '{invalid');
    put(root, 'backslop.json', config);
    rmSync(path.join(root, output.codex));
    put(root, output.codex + '/blocked', 'keep');
    assert.equal(cli(root, ['lint', '--require-adapters']).code, 1);
    assert.equal(cli(root, ['init']).code, 1);
    assert.equal(read(root, output.codex + '/blocked'), 'keep');
    assert.equal(read(root, 'backslop.json'), config);
    assert.equal(read(root, 'AGENTS.md'), before);
  } finally { cleanup(root); }
});


test('startup: strict check refuses linked adapter roots without following or replacing them', {
  skip: process.platform === 'win32' && 'Windows symlink creation needs privileges',
}, () => {
  const root = project(['codex']);
  try {
    const before = read(root, output.codex);
    renameSync(path.join(root, '.agents/skills'), path.join(root, 'kept-skills'));
    symlinkSync(path.join(root, 'kept-skills'), path.join(root, '.agents/skills'), 'dir');
    const strict = cli(root, ['lint', '--require-adapters']);
    assert.equal(strict.code, 1);
    assert.match(strict.err, /adapter path contains a symlink/);
    assert.equal(cli(root, ['init']).code, 1);
    assert.equal(read(root, output.codex), before);
  } finally { cleanup(root); }
});


for (const lang of ['en', 'ru']) {
  test(`startup: rendered ${lang} instructions preserve the pinned CLI and block unavailable commands`, () => {
    const root = project(['codex'], lang);
    try {
      const pin = '"node executable" "Backslop CLI.js" --pin "release version"';
      const config = JSON.parse(read(root, 'backslop.json'));
      config.cli = pin;
      put(root, 'backslop.json', JSON.stringify(config) + '\n');
      const rendered = cli(root, ['init']);
      assert.equal(rendered.code, 0, rendered.err);
      assert.equal(JSON.parse(read(root, 'backslop.json')).cli, pin);
      const agents = read(root, 'AGENTS.md');
      const check = agents.indexOf(`${pin} lint --require-adapter <tool>`);
      const restore = agents.indexOf(`${pin} init`);
      assert.ok(check >= 0, 'startup check preserves the configured CLI pin and quoting');
      assert.ok(restore > check, 'restoration uses the same CLI after the startup check');
      assert.ok(restore < agents.indexOf('\n1. '), 'startup restoration precedes task selection');
      const exactPin = lang === 'en'
        ? "Use exactly the project's configured CLI, including its pin and quoting."
        : "\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439 \u0440\u043e\u0432\u043d\u043e CLI \u043f\u0440\u043e\u0435\u043a\u0442\u0430, \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u044f pin \u0438 \u043a\u0430\u0432\u044b\u0447\u043a\u0438.";
      const blocker = lang === 'en'
        ? /A missing CLI,[^\n]* is a blocker: report the exact command and refusal/
        : /\u041d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0439 CLI,[^\n]* \u2014 \u0431\u043b\u043e\u043a\u0435\u0440: \u0441\u043e\u043e\u0431\u0449\u0438 \u0442\u043e\u0447\u043d\u0443\u044e \u043a\u043e\u043c\u0430\u043d\u0434\u0443 \u0438 \u043e\u0442\u043a\u0430\u0437/;
      const noSubstitution = lang === 'en'
        ? 'do not substitute an unpinned CLI'
        : "\u043d\u0435 \u043f\u043e\u0434\u043c\u0435\u043d\u044f\u0439 CLI \u043d\u0435\u043f\u0440\u0438\u043a\u0440\u0435\u043f\u043b\u0451\u043d\u043d\u043e\u0439 \u0432\u0435\u0440\u0441\u0438\u0435\u0439";
      assert.ok(agents.includes(exactPin), 'the instruction requires the exact pin and quoting');
      assert.match(agents, blocker, 'an unavailable CLI blocks startup and reports the command and refusal');
      assert.ok(agents.includes(noSubstitution), 'startup forbids substituting an unpinned CLI');
    } finally { cleanup(root); }
  });
}
