/** Live-only transport boundary. No secret or real account belongs in evidence. */
export const LIVE_MODEL = 'deepseek/deepseek-v4.1-flash-1017';
export const LIVE_ENDPOINT = 'https://nano-gpt.com/api/v1/chat/completions';
export function boundedChatTransport({ fetchImpl, key, record, afterDispatch, maxCalls = 100, maxTokens = 300000, deadlineMs = 1800000, timeoutMs = 60000 }) {
  const started = Date.now();
  const stats = { calls: 0, tokens: 0, reservedUnknownTokens: 0, blocked: 0, budgetStops: 0, errors: 0 };
  let active = false;
  let failed = false;
  const scrub = (v) => String(v ?? '').split(key).join('[REDACTED]');
  const fetch = async (url, options = {}) => {
    if (failed) throw new Error('LIVE_PREVIOUS_FAILURE_STOPPED');
    if (String(url) !== LIVE_ENDPOINT || options.method !== 'POST') { stats.blocked++; throw new Error('LIVE_DESTINATION_BLOCKED'); }
    const body = JSON.parse(options.body);
    if (body.model !== LIVE_MODEL || body.stream !== false) throw new Error('LIVE_MODEL_OR_MODE_BLOCKED');
    if (active) throw new Error('LIVE_PARALLEL_REQUEST_BLOCKED');
    body.max_tokens = Math.min(2048, Number(body.max_tokens) || 2048);
    const payload = JSON.stringify(body);
    // UTF-8 bytes are a conservative upper bound for byte-fallback input tokens.
    const reserve = Buffer.byteLength(payload, 'utf8') + body.max_tokens;
    if (reserve > 128000 || stats.calls >= maxCalls || stats.tokens + stats.reservedUnknownTokens + reserve > maxTokens || Date.now() - started > deadlineMs) { stats.budgetStops++; record({error:'LIVE_BUDGET_EXHAUSTED',dispatched:false}); throw new Error('LIVE_BUDGET_EXHAUSTED'); }
    const call = ++stats.calls;
    const begin = Date.now();
    const phase = body.messages?.some(m => String(m.content).includes('【阶段：参与规划】')) ? 'planner' : body.messages?.some(m => String(m.content).includes('【阶段：自然回应】')) ? 'replyer' : body.messages?.length === 1 && String(body.messages[0]?.content).includes('ReflectionInput:') ? 'reflection' : 'other-or-repair';
    active = true;
    stats.reservedUnknownTokens += reserve;
    try {
      const pendingResponse = fetchImpl(LIVE_ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: payload, redirect: 'error', signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.min(timeoutMs, deadlineMs - (Date.now() - started)))])
      });
      pendingResponse.catch(() => {});
      await afterDispatch?.({ call, phase, body });
      const response = await pendingResponse;
      const text = await response.text();
      let data; try { data = JSON.parse(text); } catch { data = null; }
      const usage = data?.usage || null;
      if (Number.isFinite(usage?.total_tokens)) {
        stats.tokens += usage.total_tokens;
        stats.reservedUnknownTokens -= reserve;
      }
      const message = data?.choices?.[0]?.message;
      const entry = { call, phase, elapsedMs: Date.now() - begin, httpStatus: response.status, requestedModel: body.model, returnedModel: data?.model ?? null, temperature: body.temperature, maxTokens: body.max_tokens, thinking: body.thinking ?? null, usage, cost: data?.cost ?? data?.usage?.cost ?? null, finishReason: data?.choices?.[0]?.finish_reason ?? null, request: body, response: message ? { content: message.content ?? '', tool_calls: message.tool_calls ?? [] } : null };
      if (!response.ok) { entry.error = scrub(data?.error?.message || data?.error || `HTTP_${response.status}`).slice(0, 500); }
      record(JSON.parse(scrub(JSON.stringify(entry))));
      if (!response.ok) throw new Error(`LIVE_HTTP_${response.status}`);
      if (!data?.choices?.length) throw new Error('LIVE_MISSING_CHOICES');
      return Response.json(data, { status: response.status });
    } catch (error) {
      failed = true;
      stats.errors++;
      record({ call, phase, elapsedMs: Date.now() - begin, error: scrub(error.message).slice(0, 500), cause: error.cause ? { name: error.cause.name, code: error.cause.code, message: scrub(error.cause.message).slice(0, 400) } : null, remoteOutcome: 'unknown-unless-http-response-recorded' });
      throw new Error(scrub(error.message));
    } finally { active = false; }
  };
  return { fetch, stats };
}
