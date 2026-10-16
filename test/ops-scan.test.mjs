import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function scan(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-scan-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'fixture.js'), source);
  const syntax = spawnSync(process.execPath, ['--check', path.join(dir, 'fixture.js')], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  return spawnSync(process.execPath, [path.join(repo, 'src/ops.js'), 'scan', dir, '--strict', '--no-ignore'], {
    cwd: repo, encoding: 'utf8'
  });
}

test('strict scan recognizes callback parameters and destructured bindings without an ignore list', (t) => {
  const result = scan(t, `
    async function validate(validator, { scope, mapNote = null } = {}) {
      const output = await validator(scope);
      return mapNote(output);
    }
    const { createRequire } = await import('node:module');
    const loaded = createRequire(import.meta.url)('node:fs');
    const { source: renamed, nested: { callback }, ...rest } = loaded;
    const [first, , ...others] = [];
    const arrows = [value => value(), ({ run: invoke = null }) => invoke(),
      function (plain) { return plain(); }, async function* (generator) { yield generator(); }];
    class Store {
      #apply({ apply, revision = 0 }) { return apply(revision); }
      async run(onReadResult = null, onImageResult = null) {
        return [onReadResult(), onImageResult()];
      }
    }
    const calls = [renamed(), callback(), first()];
  `);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /可疑未定义调用点: 0/);
});

test('strict scan still rejects unknown calls, alias keys and default-expression names', (t) => {
  const result = scan(t, `
    const { original: local, nested: { callback: handler }, value = fallbackMissing() } = {};
    function call({ run = defaultMissing() } = {}) { return run(); }
    const good = [local(), handler()];
    const bad = [original(), callback(), typoMissing()];
    standaloneMissing();
    if (conditionMissing()) { const nested = insideMissing(); }
    const arrow = () => arrowMissing();
  `);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const name of ['fallbackMissing', 'defaultMissing', 'original', 'callback',
    'typoMissing', 'standaloneMissing', 'conditionMissing', 'insideMissing', 'arrowMissing']) {
    assert.ok(result.stdout.includes(`${name}(`), name + ': ' + result.stdout);
  }
  for (const name of ['local', 'handler', 'run']) assert.ok(!result.stdout.includes(`${name}(`));
});

test('strict scan reports source line after multiline templates and comments', (t) => {
  const result = scan(t, [
    'const note = `first',
    'second',
    'third`;',
    '/* first',
    'second */',
    '// comment',
    'const result = unknownAfterLiteral();'
  ].join('\n'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /unknownAfterLiteral\(第7行\)/);
});
