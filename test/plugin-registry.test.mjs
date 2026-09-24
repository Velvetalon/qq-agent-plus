import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolDefs as coreBuildToolDefs, toOpenAiTools as coreToOpenAiTools } from '../src/tools/tools-core.js';
import { legacyToolsPlugin } from '../src/plugins/builtin/legacy-tools.js';
import { createRunContext } from '../src/plugins/context.js';
import { PluginManager } from '../src/plugins/manager.js';
import { PluginRegistry } from '../src/plugins/registry.js';

function tool(name, ownerPluginId, overrides = {}) {
  return {
    name,
    description: `test tool ${name}`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ content: name }),
    ownerPluginId,
    effect: 'read',
    parallelSafe: false,
    terminal: false,
    ...overrides
  };
}

function plugin(id, tools = [tool(`${id}.tool`, id)], overrides = {}) {
  return {
    id,
    name: `Plugin ${id}`,
    version: '1.0.0',
    apiVersion: 1,
    declare(registrar) {
      registrar.addTools(tools);
    },
    ...overrides
  };
}

test('legacy adapter preserves the 23 tool names, order, and OpenAI schemas', () => {
  const registry = new PluginRegistry();
  registry.register(legacyToolsPlugin);
  const actual = registry.getTools();
  const expected = coreBuildToolDefs();

  assert.deepEqual(actual.map((item) => item.name), expected.map((item) => item.name));
  assert.deepEqual(
    actual.map((item) => ({ name: item.name, description: item.description, parameters: item.parameters })),
    expected.map((item) => ({ name: item.name, description: item.description, parameters: item.parameters }))
  );
  assert.deepEqual(
    coreToOpenAiTools(actual),
    coreToOpenAiTools(expected)
  );
  assert.equal(actual.length, 23);
  assert.ok(actual.every((item) => item.ownerPluginId === 'legacy-tools'));
});

test('registry stages atomically and rejects duplicate owners, tools, invalid schemas, and reserved names', () => {
  const registry = new PluginRegistry();
  registry.register(plugin('alpha'));
  const before = registry.snapshot();

  assert.throws(() => registry.register(plugin('alpha')), /Duplicate plugin owner/);
  assert.throws(() => registry.register(plugin('beta', [tool('alpha.tool', 'beta')])), /Duplicate tool name/);
  assert.throws(() => registry.register(plugin('bad', [tool('bad.tool', 'other')])), /ownerPluginId/);
  assert.throws(() => registry.register(plugin('broken', [tool('broken.tool', 'broken', {
    parameters: { type: 'array' }
  })])), /parameters\.type/);
  assert.throws(() => registry.register(plugin('unsafe', [tool('finish', 'unsafe')])), /reserved tool name/);
  assert.throws(() => registry.register(plugin('terminal', [tool('terminal.tool', 'terminal', {
    terminal: true
  })])), /only runtime-control/);

  assert.equal(registry.revision, before.revision);
  assert.deepEqual(registry.getTools().map((item) => item.name), ['alpha.tool']);
});

test('published registrations have stable plugin/tool ordering independent of registration order', () => {
  const registry = new PluginRegistry();
  registry.registerAll([
    plugin('zeta', [tool('zeta.second', 'zeta'), tool('zeta.first', 'zeta')]),
    plugin('alpha')
  ]);
  assert.deepEqual(registry.getTools().map((item) => item.name), [
    'alpha.tool',
    'zeta.second',
    'zeta.first'
  ]);
});

test('manager snapshots freeze config, plugin enablement, generations, and tool handles per run', () => {
  const manager = new PluginManager();
  manager.register(plugin('alpha'));
  const config = { feature: { enabled: true }, nested: { value: 1 } };
  const first = manager.createRunSnapshot(config);

  config.nested.value = 2;
  manager.setEnabled('alpha', false);
  const second = manager.createRunSnapshot(config);

  assert.equal(first.config.nested.value, 1);
  assert.deepEqual(first.plugins.map((item) => item.id), ['alpha']);
  assert.deepEqual(first.tools.map((item) => item.name), ['alpha.tool']);
  assert.equal(first.toolHandles['alpha.tool'].ownerPluginId, 'alpha');
  assert.equal(Object.isFrozen(first.config.nested), true);
  assert.equal(first.generations.alpha, 1);
  assert.deepEqual(second.plugins, []);
  assert.deepEqual(second.tools, []);
  assert.equal(second.generations.alpha, undefined);
  assert.equal(first.registryRevision, second.registryRevision);
  assert.equal(Object.isFrozen(first), true);

  const context = createRunContext(first, {
    chatKey: 'group:1',
    sessionId: 'session-1',
    currentMessageIds: ['message-1']
  });
  assert.equal(context.chatKey, 'group:1');
  assert.deepEqual(context.currentMessageIds, ['message-1']);
  assert.equal(context.toolHandles['alpha.tool'].name, 'alpha.tool');
});
