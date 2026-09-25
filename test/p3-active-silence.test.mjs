import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitStaySilent,
  preflightToolCalls,
  summarizeOutbound,
  validateStaySilentArgs
} from '../src/core/action-control.js';
import { staySilentTool } from '../src/plugins/builtin/runtime-control-tools.js';
import { createRuntimeControlContext } from '../src/plugins/context.js';
import { annotateExperimentalToolSchemas, ExperimentalToolBatch } from '../src/pilots/experimental-tool-scheduler.js';
import { buildSystemPrompt } from '../src/llm/prompt.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';

function call(id, name, args = {}) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  };
}

function defs(...entries) {
  return entries.map(([name, effect, terminal = false]) => ({
    name,
    effect,
    terminal,
    execute: async () => ({ content: name })
  }));
}

test('stay_silent validates strictly and only records a pending request', async () => {
  const session = { id: 's1', leaseId: 'r1', sent: [] };
  const ctx = createRuntimeControlContext({ session });
  const valid = await staySilentTool.execute(ctx, {
    reasonCode: 'no_new_value',
    reason: '没有新的内容',
    threadDisposition: 'listening'
  });
  assert.equal(valid.isError, undefined);
  assert.deepEqual(session.pendingTerminationRequest, {
    reasonCode: 'no_new_value',
    reason: '没有新的内容',
    threadDisposition: 'listening'
  });
  assert.equal(validateStaySilentArgs({
    reasonCode: 'no_new_value',
    threadDisposition: 'listening',
    extra: true
  }).ok, false);
  assert.equal((await staySilentTool.execute(ctx, {
    reasonCode: 'no_new_value',
    threadDisposition: 'listening',
    reason: 'x'.repeat(241)
  })).isError, true);
  assert.deepEqual(session.pendingTerminationRequest, {
    reasonCode: 'no_new_value',
    reason: '没有新的内容',
    threadDisposition: 'listening'
  });
});

test('terminal batch preflight is independent of scheduler enablement', async () => {
  const stay = call('t', 'stay_silent', {
    reasonCode: 'topic_moved',
    threadDisposition: 'close'
  });
  const send = call('s', 'send_message', { messages: 'must not share silence' });
  const conflict = preflightToolCalls([send, stay], defs(
    ['send_message', 'external-write'],
    ['stay_silent', 'control', true]
  ));
  assert.equal(conflict.validTerminal, false);
  assert.equal(conflict.calls[1].result.errorCode, 'TERMINAL_BATCH_BLOCKED');
  assert.equal(conflict.calls[1].result.terminalBlocked, true);

  const trailing = preflightToolCalls([stay, send], defs(
    ['send_message', 'external-write'],
    ['stay_silent', 'control', true]
  ));
  assert.equal(trailing.calls[0].execute, false);
  assert.equal(trailing.calls[1].result.skipped, true);
  assert.equal(trailing.calls[1].result.errorCode, 'SKIPPED_AFTER_TERMINAL');

  const duplicate = preflightToolCalls([
    stay,
    call('t2', 'finish', { summary: 'duplicate' })
  ], defs(
    ['finish', 'control', true],
    ['stay_silent', 'control', true]
  ));
  assert.equal(duplicate.validTerminal, false);
  assert.equal(duplicate.calls[0].result.terminalBlocked, true);
  assert.equal(duplicate.calls[1].result.skipped, true);

  const futureNotebook = preflightToolCalls([
    call('n', 'notebook_append', { content: 'x' }),
    stay
  ], defs(['notebook_append', 'local-write'], ['stay_silent', 'control', true]));
  assert.equal(futureNotebook.validTerminal, true);

  const schemas = annotateExperimentalToolSchemas([
    { type: 'function', function: { name: 'stay_silent', description: 'silent', parameters: {} } }
  ], { toolSchedulerPilot: { enabled: true } });
  assert.match(schemas[0].function.description, /finish/);
  const scheduled = new ExperimentalToolBatch([stay], {
    execute: async () => ({ content: 'ok' })
  });
  const enabledResult = await scheduled.next('stay_silent', stay.function.arguments);
  assert.equal(enabledResult.result.content, 'ok');
});

test('stay_silent commits explicit silence only with zero outbound effects', () => {
  const session = { id: 's2', leaseId: 'r2', sent: [], outbound: { effects: [] } };
  const request = { reasonCode: 'already_answered', reason: '', threadDisposition: 'active' };
  const committed = commitStaySilent(session, request, {
    terminalToolCallId: 't2',
    outbound: summarizeOutbound(session)
  });
  assert.equal(committed.committed, true);
  assert.equal(session.termination.kind, 'explicit_silence');
  assert.equal(session.participation.decision, 'stay_silent');
  assert.equal(session.threadDisposition, 'active');

  const priorSend = {
    id: 's3',
    leaseId: 'r3',
    sent: [{ type: 'face' }],
    outbound: {
      attempted: 1,
      succeeded: 1,
      failed: 0,
      unknown: 0,
      held: 0,
      effects: [{ id: 'e3', type: 'face', state: 'sent' }]
    }
  };
  const blocked = commitStaySilent(priorSend, request, {
    terminalToolCallId: 't3',
    outbound: summarizeOutbound(priorSend)
  });
  assert.equal(blocked.committed, false);
  assert.equal(priorSend.termination.kind, 'blocked');
  assert.equal(priorSend.termination.blocked, true);
});

test('participation policy is present once and exposes explicit silence without role-text edits', () => {
  const cfg = structuredClone(DEFAULT_CONFIG);
  const prompt = buildSystemPrompt({ persona: cfg.persona });
  assert.ok((prompt.match(/【该说\/不该说】/g) || []).length >= 1);
  assert.match(prompt, /stay_silent/);
  assert.match(prompt, /reasonCode/);
  assert.match(prompt, /threadDisposition/);
});
