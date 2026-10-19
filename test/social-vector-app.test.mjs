import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-social-vector-app-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { DEFAULT_CONFIG, updateConfig } = await import('../src/core/config.js');
const { createApp } = await import('../src/console/app.js');

test('A-H05 real app vector consumers reject archived memory in queued and subsequent runs', async (t) => {
  const listener = http.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.server = { ...cfg.server, host: '127.0.0.1', port, strictPort: true, token: 'synthetic-vector-console' };
  cfg.runtime.mode = 'active'; cfg.conversation.mode = 'social'; cfg.allow.groups = ['1'];
  cfg.onebot = { ...cfg.onebot, selfId: '888', wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1' };
  cfg.api = { ...cfg.api, baseUrl: 'https://vector-chat.invalid', model: 'mock', apiKey: 'synthetic', priceRemoteUrl: 'none' };
  cfg.memory.consolidateEnabled = false; cfg.sticker.enabled = false;
  for (const key of ['proactive', 'pacing', 'dailyMoments', 'qzoneInteractions', 'autoUpdate']) cfg[key] = { ...cfg[key], enabled: false };
  cfg.selfEvolution = { enabled: true, reflection: { enabled: true, pollIntervalMs: 100000 },
    retrieval: { enabled: true, embedding: { enabled: true, provider: 'synthetic', endpoint: 'https://vector-embedding.invalid/v1',
      model: 'synthetic-2d', dimension: 2, allowPrivate: true, allowQuery: true, allowAnonymous: true } } };
  cfg.send = { ...cfg.send, minGapMs: 1, maxGapMs: 1, byLengthMs: 0 };
  cfg.wakeDelayMinMs = 600000; cfg.wakeDelayMaxMs = 600000;
  updateConfig(cfg);
  const originalFetch = globalThis.fetch;
  let app, sourceId, phase = 0, sends = 0, embeddingCalls = 0, archiveQueued = false, muteQueued = false, note, silentEpisode = false;
  let embeddingFailure = false;
  const requests = [], reflections = [], toolResults = [], replyPrompts = [];
  const marker = 'SYNTHETIC_OBSERVATORY_EPISODE';
  const response = (message) => Response.json({ choices: [{ message }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  globalThis.fetch = async (url, options) => {
    const host = new URL(String(url)).hostname;
    if (host === '127.0.0.1') return originalFetch(url, options);
    const body = options?.body ? JSON.parse(options.body) : null;
    if (host === 'vector-embedding.invalid') {
      embeddingCalls += 1;
      if (embeddingFailure) return Response.json({ error: 'synthetic provider unavailable' }, { status: 503 });
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return Response.json({ data: inputs.map((_input, index) => ({ index, embedding: [1, 0] })), usage: { total_tokens: 2 } });
    }
    assert.equal(host, 'vector-chat.invalid', 'all external traffic stays within synthetic boundaries');
    if (!body) return Response.json({ data: [] });
    requests.push(body);
    // Synthetic semantic-review response must not consume the scripted chat phase.
    if (body.messages?.[0]?.role === 'system' && body.messages[0].content.startsWith('【阶段：发送前语义审核】')) {
      return response({ content: JSON.stringify({ claimsComplete: true,
        novelty: { repeated: false, previousIds: [], reason: 'synthetic fixture approval' }, claims: [], issues: [] }) });
    }
    if (body.messages.length === 1 && body.messages[0].role === 'user') {
      reflections.push(body.messages[0].content);
      if (silentEpisode) {
        const input = JSON.parse(body.messages[0].content.split('\nReflectionInput: ')[1]);
        const evidenceRefs = input.conversationEvidence.filter((item) => item.role === 'user').map((item) => item.sourceRef);
        return response({ content: JSON.stringify({ noteOperations: [{ operation: 'append', scope: 'chat', chatKey: 'group:1',
          content: 'We quietly considered the observatory question together. SILENT_EPISODE', tags: ['experience'], evidenceRefs }],
        traitProposals: [], capabilityGapProposals: [], summary: 'Preserve a specific human episode without claiming a preference.' }) });
      }
      return response({ content: JSON.stringify({ noteOperations: [], traitProposals: [], capabilityGapProposals: [], summary: 'No new memory needed.' }) });
    }
    phase += 1;
    if (silentEpisode) return response({ content: JSON.stringify({ action: 'listen', sourceMessageIds: [sourceId], sourceRefs: [], targetMessageIds: [], goal: '', novelty: '' }) });
    if (phase === 1) return response({ tool_calls: [{ id: 'search-' + sourceId, type: 'function', function: { name: 'notebook_search', arguments: JSON.stringify({ query: 'observatory', limit: 5 }) } }] });
    if (phase === 2) {
      const result = body.messages.findLast((item) => item.role === 'tool');
      try { toolResults.push(JSON.parse(result.content)); } catch { toolResults.push({ error: result.content }); }
      return response({ content: JSON.stringify({ action: 'reply', topicId: null, topic: 'observatory', sourceMessageIds: [sourceId], targetMessageIds: [sourceId], sourceRefs: [], goal: 'Answer the observatory question', novelty: 'Explain the observation', initiative: null }) });
    }
    if (phase === 3) {
      replyPrompts.push(JSON.stringify(body.messages));
      return response({ tool_calls: [{ id: 'send-' + sourceId, type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ messages: 'An answer about the observatory ' + sourceId }) } }] });
    }
    return response({ content: 'done' });
  };
  t.after(async () => { try { if (app) await app.stop(); } finally { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } });
  app = createApp({ log: () => {} });
  app.onebot.connect = async () => { app.onebot.selfInfo = await app.onebot.call('get_login_info'); };
  app.onebot.call = async (action) => {
    if (action === 'get_login_info') return { user_id: 888, nickname: 'synthetic' };
    if (action === 'get_friend_list') return [];
    if (action === 'get_forward_msg') return { messages: [{ sender: { user_id: 77, nickname: 'original-author' },
      time: Math.floor(Date.now() / 1000), content: [{ type: 'text', data: { text: 'I prefer concise observatory reports.' } }] }] };
    throw new Error('Unexpected protocol call: ' + action);
  };
  app.onebot.getGroupInfo = async () => ({ group_name: 'synthetic' });
  app.onebot.sendText = async () => ({ message_id: ++sends + 10000 });
  await app.start();
  const registration = (id) => app.orchestrator.pluginManager.registry.getRegistrations().find((entry) => entry.plugin.id === id).plugin;
  let notebook = registration('self-evolution').getStore();
  let worker = registration('self-evolution-reflection').getWorker();
  note = notebook.append({ accountId: '888', scope: 'chat', chatKey: 'group:1', currentChatKey: 'group:1',
    content: 'We discussed an observatory visit. ' + marker, tags: ['experience'],
    source: { kind: 'chat', accountId: '888', chatKey: 'group:1', sessionId: 'synthetic-seed', runId: 'synthetic-seed' }, idempotencyKey: 'seed-episode' }).note;
  const excludedMarkers = ['OTHER_ACCOUNT_ONLY', 'OTHER_GROUP_ONLY', 'PRIVATE_CHAT_ONLY'];
  for (const [index, accountId, chatKey] of [[0, '999', 'group:1'], [1, '888', 'group:2'], [2, '888', 'private:42']]) {
    notebook.append({ accountId, scope: 'chat', chatKey, currentChatKey: chatKey,
      content: 'An observatory memory ' + excludedMarkers[index],
      source: { kind: 'chat', accountId, chatKey, sessionId: 'synthetic-scope', runId: 'synthetic-scope' }, idempotencyKey: 'scope-' + index });
  }
  const operational = notebook.append({ accountId: '888', scope: 'chat', chatKey: 'group:1', currentChatKey: 'group:1',
    content: '机器人以后遇到投递失败必须30分钟后重试并补发。', tags: ['experience', 'system'],
    source: { kind: 'chat', accountId: '888', chatKey: 'group:1', sessionId: 'synthetic-policy', runId: 'synthetic-policy' }, idempotencyKey: 'operational' }).note;
  assert.equal(operational.recallable, false);
  excludedMarkers.push(operational.content);
  const legacy = notebook.append({ accountId: '888', scope: 'chat', chatKey: 'group:1', currentChatKey: 'group:1',
    content: 'An older observatory recollection. LEGACY_VECTOR_MATERIAL', tags: ['experience'],
    source: { kind: 'chat', accountId: '888', chatKey: 'group:1', sessionId: 'legacy-seed', runId: 'legacy-seed' }, idempotencyKey: 'legacy-seed' }).note;
  await notebook.processEmbeddingQueue();
  // Explicit legacy pollution fixture: retain its already-built vector while the
  // old body contains a runtime directive and misleading persisted labels.
  notebook.database.prepare("UPDATE notebook_notes SET body=?,note_type='experience',channel='memory',tags_json='[\"system\"]' WHERE id=?")
    .run(operational.content + ' LEGACY_VECTOR_MATERIAL', legacy.id);
  excludedMarkers.push('LEGACY_VECTOR_MATERIAL');
  const ready = await notebook.semanticSearch({ accountId: '888', chatKey: 'group:1', query: 'observatory' });
  assert.ok(ready.results.some((item) => item.noteId === note.id && item.rankingSource === 'sqlite-vec'));
  assert.ok(!ready.results.some((item) => item.noteId === legacy.id));
  const request = async (revision) => {
    const result = await fetch(`http://127.0.0.1:${port}/api/self-evolution/notebook/${note.id}/archive`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-console-token': cfg.server.token, connection: 'close' },
      body: JSON.stringify({ expectedRevision: revision }) });
    return { status: result.status, body: await result.json() };
  };
  const enqueue = app.sender.sendTextBatch.bind(app.sender);
  app.sender.sendTextBatch = async (...args) => {
    if (archiveQueued) { archiveQueued = false; assert.equal((await request(note.revision)).status, 200); }
    if (muteQueued) { muteQueued = false; await app.onebot.onEvent({ post_type: 'notice', notice_type: 'group_ban', sub_type: 'ban', self_id: 888, group_id: 1, user_id: 888, time: Math.floor(Date.now() / 1000), duration: 600 }); }
    return enqueue(...args);
  };
  const run = async (mid, forwarded = false) => {
    phase = 0;
    await app.onebot.onEvent({ post_type: 'message', message_type: 'group', self_id: 888, group_id: 1, user_id: 42,
      message_id: mid, time: Math.floor(Date.now() / 1000), sender: { user_id: 42, nickname: 'synthetic-member' },
      message: forwarded ? [{ type: 'forward', data: { id: 'synthetic-forward-resource' } }] : 'What did we discuss about the observatory?', raw_message: 'What did we discuss about the observatory?' });
    sourceId = String(app.store.recent('group:1', { limit: 1 })[0].id);
    await app.orchestrator.wake('group:1');
    await app.orchestrator.pluginManager.drainCompletionEvents();
    const result = await worker.runOnce();
    assert.equal(result.committed, true, JSON.stringify({ result, sessions: app.sessions.listSummaries(1) }));
  };
  await run(101);
  assert.equal(sends, 1);
  assert.ok(toolResults[0].results.some((item) => item.noteId === note.id && item.rankingSource === 'sqlite-vec'));
  assert.ok(replyPrompts[0].includes(marker), 'automatic context reaches real Replyer');
  assert.ok(reflections[0].includes(marker), 'real completion observer/worker retrieves the same memory');
  for (const forbidden of excludedMarkers) {
    assert.ok(!JSON.stringify(toolResults).includes(forbidden));
    assert.ok(!replyPrompts.join('\n').includes(forbidden));
    assert.ok(!reflections.join('\n').includes(forbidden));
  }
  assert.equal((await request(note.revision + 1)).status, 409, 'wrong CAS cannot archive');
  const correctedMarker = 'CORRECTED_OBSERVATORY_EPISODE';
  const correction = await fetch(`http://127.0.0.1:${port}/api/self-evolution/notebook/${note.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-console-token': cfg.server.token, connection: 'close' },
    body: JSON.stringify({ expectedRevision: note.revision, content: 'A corrected observatory fact. ' + correctedMarker }) });
  assert.equal(correction.status, 200, await correction.text());
  note = notebook.get({ accountId: '888', noteId: note.id, currentChatKey: 'group:1' });
  await notebook.processEmbeddingQueue();
  await run(102);
  assert.equal(sends, 2);
  for (const content of [JSON.stringify(toolResults.at(-1)), replyPrompts.at(-1), reflections.at(-1)]) {
    assert.ok(content.includes(correctedMarker)); assert.ok(!content.includes(marker));
  }
  archiveQueued = true;
  await run(103);
  assert.equal(sends, 2, 'real archive while queued blocks actual Sender');
  const blocked = app.sessions.listSummaries().find((item) => item.socialAudit?.dispatchBlocked === 'material_revision_invalid');
  assert.ok(blocked, JSON.stringify(app.sessions.listSummaries()));
  assert.equal(app.store.listRunEffects(app.sessions.get(blocked.id).leaseId).length, 0);
  assert.ok(!reflections.at(-1).includes(correctedMarker), 'reflection after archive does not revive the note');
  await run(104);
  assert.equal(sends, 3, 'a new independent draft can proceed without revoked memory');
  assert.ok(!JSON.stringify(toolResults.at(-1)).includes(note.id));
  assert.ok(!replyPrompts.at(-1).includes(marker));
  assert.ok(!reflections.at(-1).includes(marker));
  assert.ok(!replyPrompts.at(-1).includes(correctedMarker));
  assert.ok(!reflections.at(-1).includes(correctedMarker));
  assert.ok(embeddingCalls > 3);
  assert.equal(app.store.unreadCount('group:1'), 0);
  muteQueued = true;
  await run(105);
  assert.equal(sends, 3, 'a host group_ban notice during queueing blocks the draft');
  for (const patch of [{ self_id: 999 }, { user_id: 42 }, { time: Math.floor(Date.now() / 1000) - 10 }]) {
    await app.onebot.onEvent({ post_type: 'notice', notice_type: 'group_ban', sub_type: 'lift_ban', self_id: 888, group_id: 1, user_id: 888, time: Math.floor(Date.now() / 1000), duration: 0, ...patch });
    assert.equal(app.orchestrator.getSocialStatus('group:1').mute.muted, true);
  }
  const beforeMutedWake = requests.length;
  await app.orchestrator.wake('group:1', { manual: true });
  assert.equal(requests.length, beforeMutedWake, 'known mute blocks model work');
  cfg.conversation.mode = 'legacy'; updateConfig(cfg);
  await app.onebot.onEvent({ post_type: 'notice', notice_type: 'group_ban', sub_type: 'lift_ban', self_id: 888, group_id: 1, user_id: 888, time: Math.floor(Date.now() / 1000) + 1, duration: 0 });
  cfg.conversation.mode = 'social'; updateConfig(cfg);
  assert.equal(app.orchestrator.getSocialStatus('group:1').mute.muted, false, 'tracked notices remain current while temporarily in another mode');
  silentEpisode = true;
  await run(106);
  assert.equal(sends, 3, 'silent human episode never claims a visible response');
  const episode = notebook.search({ accountId: '888', currentChatKey: 'group:1', query: 'SILENT_EPISODE' });
  assert.equal(episode.notes.length, 1, JSON.stringify(episode));
  assert.equal(registration('self-evolution-reflection').getStore().getLearnedSelfRevision({ accountId: '888' }), 0);
  silentEpisode = false;
  await run(107, true);
  const forwarded = app.store.findByMid('group:1', 107);
  assert.equal(forwarded.eventKind, 'forward');
  const reflectionInput = JSON.parse(reflections.at(-1).split('\nReflectionInput: ')[1]);
  const forwardedEvidence = reflectionInput.conversationEvidence.find((entry) => entry.sourceRecordId === String(forwarded.id));
  assert.equal(forwardedEvidence.sourceRecordType, 'forward');
  assert.equal(forwardedEvidence.userEvidence, false);
  assert.ok(!reflectionInput.traitEvidencePool.some((entry) => entry.sourceRef === forwardedEvidence.sourceRef));
  // F4: disabling embedding must not silently select lexical/recent memories.
  const beforeDisabled = embeddingCalls;
  const disabledResponse = await fetch(`http://127.0.0.1:${port}/api/config`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-console-token': cfg.server.token, connection: 'close' },
    body: JSON.stringify({ selfEvolution: { retrieval: { embedding: { enabled: false } } } })
  });
  assert.equal(disabledResponse.status, 200, await disabledResponse.text());
  notebook = registration('self-evolution').getStore();
  worker = registration('self-evolution-reflection').getWorker();
  silentEpisode = false;
  await run(108);
  const disabledTool = toolResults.at(-1);
  const disabledReflection = JSON.parse(reflections.at(-1).split('\nReflectionInput: ')[1]);
  assert.deepEqual({ tool: disabledTool.notes.length, reflection: disabledReflection.notebook.length,
    automatic: replyPrompts.at(-1).includes('SILENT_EPISODE') }, { tool: 0, reflection: 0, automatic: false });
  assert.ok(disabledTool.degradationReason);
  assert.ok(disabledReflection.diagnostics.retrieval.reason);
  assert.equal(embeddingCalls, beforeDisabled);
  const reconfigure = async (embedding) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-console-token': cfg.server.token, connection: 'close' },
      body: JSON.stringify({ selfEvolution: { retrieval: { embedding } } })
    });
    assert.equal(response.status, 200, await response.text());
    notebook = registration('self-evolution').getStore(); worker = registration('self-evolution-reflection').getWorker();
  };
  await reconfigure({ enabled: true, allowQuery: false });
  await notebook.processEmbeddingQueue();
  const beforeDenied = embeddingCalls;
  await run(109);
  assert.equal(toolResults.at(-1).degradationReason, 'external-disallowed');
  let input = JSON.parse(reflections.at(-1).split('\nReflectionInput: ')[1]);
  assert.deepEqual(input.notebook, []); assert.equal(input.diagnostics.retrieval.reason, 'external-disallowed');
  assert.ok(!replyPrompts.at(-1).includes('SILENT_EPISODE'));
  assert.equal(embeddingCalls, beforeDenied);
  await reconfigure({ allowQuery: true });
  await notebook.processEmbeddingQueue(); embeddingFailure = true;
  await run(110);
  assert.ok(toolResults.at(-1).error);
  input = JSON.parse(reflections.at(-1).split('\nReflectionInput: ')[1]);
  assert.deepEqual(input.notebook, []); assert.equal(input.diagnostics.retrieval.reason, 'retrieval-failed');
  assert.ok(!replyPrompts.at(-1).includes('SILENT_EPISODE'));


});
