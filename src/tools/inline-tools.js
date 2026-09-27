// 内联工具调用解析：少数模型不返回原生 tool_calls，而是把调用写进文本。
// 从 orchestrator.js 抽出来共享给各判断类模块（表情判断 / 空间互动 / 每日说说 / 身份与关系评估）。
// 支持格式：
//   1. <tool_call> <function=send_message> <parameter=messages>…</parameter> </function> </tool_call>
//   2. <tool_call> {"name":"send_message","arguments":{...}} </tool_call>
//   3. <tool_call> send_message \n {"messages":"..."} </tool_call>
//   4. 整段就是一个带 name 的 JSON（没有 <tool_call> 包裹）

function parseInlineBlock(block) {
  // 1) 整个块是 JSON：{"name": "...", "arguments": {...}}（部分模型用 parameters/args）
  const jsonMatch = block.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const name = obj.name || obj.function || obj.tool;
      const args = obj.arguments || obj.parameters || obj.args || obj.input || {};
      if (name) return { name: String(name), args: (args && typeof args === 'object' && !Array.isArray(args)) ? args : {} };
    } catch { /* 不是 JSON，继续按 XML 解析 */ }
  }

  // 2) <function=send_message> + <parameter=key>value</parameter>
  const fnMatch = block.match(/<function\s*=\s*([^>]+)>/i);
  let name = fnMatch ? fnMatch[1].trim().replace(/^["']|["']$/g, '') : '';
  const args = {};
  const paramRe = /<parameter\s*=\s*([^>]+)>([\s\S]*?)<\/parameter>/gi;
  let pm;
  while ((pm = paramRe.exec(block)) !== null) {
    const key = pm[1].trim().replace(/^["']|["']$/g, '');
    let value = pm[2].trim();
    try { value = JSON.parse(value); } catch { /* 保持原始文本 */ }
    args[key] = value;
  }
  if (name && fnMatch) return { name, args };

  // 3) 首行是函数名，其余是 JSON 参数（GLM/Qwen 部分格式）
  const lines = block.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!name && lines.length >= 2 && /^[a-zA-Z_][\w.-]*$/.test(lines[0])) {
    name = lines[0];
    try {
      const parsed = JSON.parse(lines.slice(1).join('\n'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { name, args: parsed };
    } catch { /* ignore */ }
  }
  return null;
}

export function parseInlineToolCalls(text) {
  const out = [];
  const blockRe = /<\|?tool_call\|?(?:\s[^>]*)?>([\s\S]*?)(?:<\/\|?tool_call\|?>|<\|\/tool_call\|>)/gi;
  let match;
  while ((match = blockRe.exec(String(text || ''))) !== null) {
    const block = match[1].trim();
    if (!block) continue;
    const call = parseInlineBlock(block);
    if (call) out.push(call);
  }
  if (!out.length && /<function\s*=/i.test(String(text || ''))) {
    const call = parseInlineBlock(String(text || '').trim());
    if (call) out.push(call);
  }
  return out;
}

function textContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    return typeof part.text === 'string'
      ? part.text
      : typeof part.content === 'string'
        ? part.content
        : '';
  }).filter(Boolean).join('\n');
}

function normalizeStructuredCall(call, index) {
  if (!call || typeof call !== 'object') return null;
  const fn = call.function && typeof call.function === 'object' ? call.function : {};
  const name = String(
    fn.name
      || call.name
      || call.function_name
      || call.tool_name
      || ''
  ).trim();
  if (!name) return null;
  const args = fn.arguments
    ?? fn.parameters
    ?? call.arguments
    ?? call.parameters
    ?? call.args
    ?? call.input
    ?? {};
  const argumentsText = typeof args === 'string' ? args : JSON.stringify(args);
  return {
    id: String(call.id || `structured_${index + 1}`),
    type: String(call.type || 'function'),
    function: {
      name,
      arguments: argumentsText || '{}'
    }
  };
}

function resolveTextToolCalls(text) {
  const value = textContent(text);
  if (!value) return [];
  let parsed = /<tool_call/i.test(value) ? parseInlineToolCalls(value) : [];
  if (!parsed.length) {
    const jsonMatch = value.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        const name = obj.name || obj.function || obj.tool;
        const args = obj.arguments || obj.parameters || obj.args || obj.input;
        if (name && args && typeof args === 'object' && !Array.isArray(args)) {
          parsed = [{ name: String(name), args }];
        }
      } catch { /* 不是 JSON，当普通文本 */ }
    }
  }
  return parsed;
}

function structuredContentToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content.map((part, index) => {
    if (!part || typeof part !== 'object') return null;
    const type = String(part.type || '').toLowerCase();
    if (!['tool_use', 'tool_call', 'function_call'].includes(type)) return null;
    return normalizeStructuredCall({
      id: part.id,
      type: 'function',
      function: {
        name: part.name || part.function?.name,
        arguments: part.arguments ?? part.input ?? part.function?.arguments
      }
    }, index);
  }).filter(Boolean);
}

/**
 * 统一取一次响应里的工具调用，返回 OpenAI 结构（照旧读 call.function.name / arguments）。
 * 优先原生 tool_calls；兼容 legacy function_call、数组 content、reasoning_content
 * 以及模型写在文本里的内联调用。只有明确识别到调用时才转成 OpenAI 结构。
 */
export function resolveToolCalls(message) {
  const rawStructured = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : message?.tool_calls && typeof message.tool_calls === 'object'
      ? [message.tool_calls]
      : [];
  const structured = rawStructured
    .map(normalizeStructuredCall)
    .filter(Boolean);
  if (structured.length === rawStructured.length && structured.length) return structured;

  const legacy = normalizeStructuredCall(message?.function_call, 0);
  if (legacy) return [legacy];

  const contentCalls = structuredContentToolCalls(message?.content);
  if (contentCalls.length) return contentCalls;

  const textCandidates = [message?.content, message?.reasoning_content];
  for (const candidate of textCandidates) {
    const parsed = resolveTextToolCalls(candidate);
    if (parsed.length) {
      return parsed.map((call, index) => ({
        id: `inline_${index + 1}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
      }));
    }
  }
  return [];
}
