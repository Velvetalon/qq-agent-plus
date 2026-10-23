import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildUserPrompt } from '../src/llm/prompt.js';
import { buildSocialPlannerPrompts, buildSocialReplyerPrompts } from '../src/conversation/prompts.js';
import { buildMomentSystemPrompt } from '../src/llm/moment-prompt.js';
import { buildQzoneInteractionPrompt } from '../src/llm/qzone-interaction-prompt.js';

const persona = {
  botName: 'NeutralBot', selfNickname: '', behaviorProfile: 'legacy', participation: 'medium',
  roleText: 'ROLE_STYLE_SENTINEL：表达风格完全由管理员提供。',
  customRules: 'CUSTOM_RULE_SENTINEL：遵守这条管理员规则。'
};
const forbidden = [
  '反 AI 味', '保持主体性', '群聊不是客服队列', '像真人一样', '装傻乱回',
  '已读乱回', '从什么地方写起', '像自己发动态', '一轮常见', '每 3~5 轮'
];
function assertNeutral(text, label) {
  assert.match(text, /ROLE_STYLE_SENTINEL/ , label + ' keeps role text');
  assert.match(text, /CUSTOM_RULE_SENTINEL/, label + ' keeps custom rules');
  for (const word of forbidden) assert.equal(text.includes(word), false, `${label} contains ${word}`);
}

test('main legacy prompt keeps protocol but not default personality', () => {
  const text = buildSystemPrompt({ persona });
  assertNeutral(text, 'main');
  assert.match(text, /安全规则/);
  assert.match(text, /send_message/);
  assert.match(text, /stay_silent/);
  assert.match(text, /finish/);
});

test('threaded and lifecycle dynamic context remain data-only', () => {
  const base = {
    persona, store: { recent: () => [] }, memory: { formatForPrompt: () => '' },
    chatKey: 'group:1', kind: 'group', chatId: '1', chatName: 'G', selfNickname: 'NeutralBot',
    selfId: '12345', triggerEntries: [{ id: 1, senderId: '2', text: 'new message', ts: Date.now() }],
    contextLimit: 4, recentCount: 1, lastMessageAt: Date.now(), conversationMode: 'threaded',
    thread: { state: 'active', engagedUntil: Date.now() + 10000, topic: 'topic' }, session: {}
  };
  const threaded = buildUserPrompt({ ...base, lifecycleContinuation: false });
  const lifecycle = buildUserPrompt({ ...base, lifecycleContinuation: true, conversationMode: 'lifecycle' });
  for (const [label, text] of [['threaded', threaded], ['lifecycle', lifecycle]]) {
    assert.match(text, /当前对话线程|生命周期续接/, label);
    assert.match(text, /本次唤醒/, label);
    for (const word of forbidden) assert.equal(text.includes(word), false, `${label} contains ${word}`);
  }
});

test('social planner and replyer retain schemas and remove style coaching', () => {
  const planner = buildSocialPlannerPrompts({ persona }).system;
  const replyer = buildSocialReplyerPrompts({ persona }).system;
  for (const [label, text] of [['planner', planner], ['replyer', replyer]]) {
    assertNeutral(text, label);
    assert.match(text, /stay_silent/);
  }
  assert.match(planner, /JSON/);
  assert.match(planner, /sourceMessageIds|source ID/);
  assert.match(replyer, /send_message/);
});

test('moment and Qzone prompts make role text primary and preserve operation safety', () => {
  const moment = buildMomentSystemPrompt(persona);
  const qzone = buildQzoneInteractionPrompt(persona);
  for (const [label, text] of [['moment', moment], ['qzone', qzone]]) {
    assertNeutral(text, label);
    assert.match(text, /不可信|安全/);
    assert.match(text, /submit_/);
  }
});
