import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialPlannerPrompts, buildSocialReplyerPrompts } from '../src/conversation/prompts.js';
for (const build of [buildSocialPlannerPrompts, buildSocialReplyerPrompts]) {
  test(`${build.name} exposes bounded low/medium/high participation preferences`, () => {
    const low = build({ persona: {participation: 'low'} }).system;
    const mid = build({ persona: {participation: 'medium'} }).system;
    const high = build({ persona: {participation: 'high'} }).system;
    assert.match(low, /偏低.*明确邀请.*直接问题/);
    assert.match(mid, /适中.*不必每轮接话/);
    assert.match(high, /偏高.*无人回应.*不要催场/);
    for (const prompt of [low, mid, high]) assert.match(prompt, /不是强制回复概率.*问题已解决状态和发送边界/);
    assert.equal(build({persona:{participation:'invalid'}}).system, mid);
  });
}

test('Replyer distinguishes internal draft from visible tool-delivered output without forcing speech', () => {
  const prompt = buildSocialReplyerPrompts().system;
  assert.match(prompt, /普通 assistant content 只是内部草稿.*不会展示给群友/);
  assert.match(prompt, /即使只回答一个词.*必须调用 send_message/);
  assert.match(prompt, /想保持沉默时返回空内容/);
});

test('Replyer sees host message cap and can consolidate without forced output', () => {
  for (const [input, expected] of [[1,1],[3,3],[6,6],[99,6],[0,3],[NaN,3]]) {
    const prompt = buildSocialReplyerPrompts({maxMessagesPerTurn:input}).system;
    assert.ok(prompt.includes('最多 '+expected+' 条可见消息'));
    assert.match(prompt, /合并进较少消息.*不是必须发送的数量/);
  }
  assert.match(buildSocialPlannerPrompts().system, /没有新角度就选择 react\/listen/);
});

test('Replyer marks current targets instead of inviting old question replay', () => {
 const user = buildSocialReplyerPrompts({decision:{targetMessageIds:['3']},messages:[{id:'1',text:'old question'},{id:'2',self:true,text:'old answer'},{id:'3',text:'new question'}]}).user;
 assert.match(user, /\[历史背景\].*old question/);
 assert.match(user, /\[历史背景\].*old answer/);
 assert.match(user, /\[本轮回应目标\].*new question/);
 assert.match(user, /已经回答的问题不要再答/);
});

test('Planner sees the exact topic scope of a due intent without forced sending', () => {
 const user = buildSocialPlannerPrompts({dueIntent:{topicId:'topic-authorized',goal:'Check update',sourceMessageIds:['7']}}).user;
 assert.match(user, /到期的主持端意图.*topicId=topic-authorized/);
 assert.match(user, /不可改选其他话题.*listen\/close/);
});

test('decision repair gets full source-object contract and actual allowed topics and human IDs', async()=>{
 const {buildSocialDecisionRepairMessages}=await import('../src/conversation/prompts.js');
 const ref={kind:'external_observation',id:'read:1',revision:1,scope:{accountId:'a',chatKey:'group:1'},visibility:'chat',policyVersion:'v1'};
 const [system,user]=buildSocialDecisionRepairMessages({invalidReason:'invalid_source_ref_shape',rawDecision:'{"sourceRefs":["read:1"]}',scene:{topics:[{id:'t'}]},knownMessages:[{id:'h'},{id:'s',self:true}],sourceRefs:[ref]});
 assert.match(system.content,/不能是 ID 字符串数组/);assert.match(system.content,/精确且唯一匹配/);assert.match(system.content,/不重新规划/);
 const data=JSON.parse(user.content);assert.deepEqual(data.allowedTopicIds,['t']);assert.deepEqual(data.allowedHumanMessageIds,['h']);assert.deepEqual(data.allowedSourceRefs,[ref]);assert.equal(data.invalidReason,'invalid_source_ref_shape');
});

test('Replyer keeps already-sent text and actual novelty check at the end of fresh context',()=>{
 const user=buildSocialReplyerPrompts({messages:[{id:'1',self:true,text:'previous punchline'},{id:'2',text:'next image'}],decision:{targetMessageIds:['2'],novelty:'a genuinely different angle'}}).user;
 assert.match(user,/本话题已经发过的文字.*\n- previous punchline/);assert.match(user,/当前人类明确要求重述/);assert.match(user,/实际输出必须体现新增点/);assert.match(user,/a genuinely different angle/);
});
