import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function renderFunction(name, nextName, state = {}) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ state, esc: escape, fmtTime: (at) => String(at) });
  vm.runInContext(source.slice(start, end), context);
  return context[name];
}

test('candidate UI shows support and counter evidence, escapes source text, and does not allow gated adoption', () => {
  const render = renderFunction('renderSelfEvolutionCandidates', 'renderSelfEvolutionReflection', {
    selfEvolutionBusy: ''
  });
  const base = {
    candidateId: 'candidate-1',
    proposalId: 'refprop_' + '1'.repeat(24),
    key: 'communication_style',
    value: '<script>untrusted</script>',
    subject: { kind: 'user', id: 'synthetic-user' },
    scope: 'chat',
    chatKey: 'group:10001',
    supportRefs: ['account:group:10001:message:1'],
    counterRefs: ['account:group:10001:message:2'],
    supportingEvidence: [{ sourceRef: 'message:1', text: '<b>source text</b>' }],
    independentRoots: ['1'],
    interactionIds: ['interaction-1'],
    eligible: false,
    reason: 'insufficient-interactions',
    status: 'pending',
    currentProfileRevision: 4,
    expiresAt: 1800000000000
  };
  const html = render({
    status: { reflection: { running: true } },
    candidates: { entries: [base] }
  });
  assert.match(html, /支撑/);
  assert.match(html, /反证/);
  assert.match(html, /insufficient-interactions/);
  assert.match(html, /&lt;script&gt;untrusted&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;source text&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>|<b>source text/);
  assert.match(html, /data-decision="approve"[^>]+disabled/);
  assert.doesNotMatch(html, /data-decision="reject"[^>]+disabled/);
  const disabled = render({
    status: { reflection: { running: false } },
    candidates: { disabled: true, entries: [{ ...base, eligible: true }] }
  });
  assert.match(disabled, /data-decision="approve"[^>]+disabled/);
  assert.match(disabled, /data-decision="reject"[^>]+disabled/);
});

test('social UI separates share/react decisions, targets, materials, and failed delivery', () => {
  const render = renderFunction('renderSocialSessionPanel', 'refreshSocialSessionDetail', {
    socialStatusChatKey: 'group:10001',
    socialStatus: { enabled: false, scene: { topics: [] }, intents: [] }
  });
  const html = render({
    conversationMode: 'social',
    chatKey: 'group:10001',
    sent: [],
    outbound: { attempted: 1, succeeded: 0 },
    socialAudit: {
      decision: 'share',
      targetMessageIds: ['11', '12'],
      sourceRefs: ['external:synthetic-observation'],
      materialRefs: [{ kind: 'notebook', id: 'safe-note', revision: 5 }],
      deliveryState: 'failed',
      delivered: false,
      dispatchBlocked: 'material-stale',
      goal: '<img src=x>',
      reasoning: 'hidden reasoning never displayed'
    }
  });
  assert.match(html, /分享/);
  assert.match(html, /11 · 12/);
  assert.match(html, /external:synthetic-observation/);
  assert.match(html, /notebook:safe-note@5/);
  assert.match(html, /failed/);
  assert.match(html, /material-stale/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /hidden reasoning|<img src=x>|已发出/);
  assert.match(render({
    chatKey: 'group:10001', conversationMode: 'social', socialAudit: { decision: 'react' }
  }), /反应/);
});
