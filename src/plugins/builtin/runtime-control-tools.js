import {
  validateStaySilentArgs,
  terminalRequestResult
} from '../../core/action-control.js';

export const staySilentTool = Object.freeze({
  name: 'stay_silent',
  description: '在本轮没有值得发送的新内容时，明确结束并保持沉默。必须提供 reasonCode 和 threadDisposition；可选 reason 最多 240 字符。该工具不会向 QQ 发送任何消息。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      reasonCode: {
        type: 'string',
        enum: ['not_relevant', 'no_new_value', 'waiting_for_context', 'already_answered', 'topic_moved']
      },
      reason: { type: 'string', maxLength: 240 },
      threadDisposition: {
        type: 'string',
        enum: ['active', 'listening', 'close']
      }
    },
    required: ['reasonCode', 'threadDisposition']
  },
  effect: 'control',
  parallelSafe: false,
  terminal: true,
  execute(ctx, args) {
    const checked = validateStaySilentArgs(args);
    if (!checked.ok) {
      return {
        content: `错误：${checked.message}`,
        isError: true,
        errorCode: checked.errorCode,
        reportIncident: false
      };
    }
    // The host commits this request only after the complete batch preflight.
    ctx.session.pendingTerminationRequest = checked.value;
    return terminalRequestResult(checked.value);
  }
});

export const longtimeTool = Object.freeze({
  name: 'longtime',
  description: '处理当前消息里的字面量 #龙time。只在当前触发消息包含 #龙time 时调用，历史消息、引用和指令说明不算。首次不传 decision：无图且整条消息恰好为 #龙time 时，系统会随机发送一张标签精确包含“龙图”的表情；带图时返回该消息的真实图片，必须看图后再次调用本工具。再次调用时，decision=dragon 表示明确是龙图，系统逐张收藏并补齐精确标签“龙图”，不发送文字；decision=not_dragon 表示明确不是，必须同时给一句不超过 80 字的短回复，系统只针对这次投稿发一次，不收藏；decision=uncertain 表示依据不足，系统不收藏也不发送。不要拼接不同消息中的指令和图片，不要用备注或相似标签代替精确标签。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      messageId: {
        type: ['integer', 'string'],
        description: '当前触发消息的 #id；必须是本次输入里明确带 #龙time 的那一条'
      },
      decision: {
        type: 'string',
        enum: ['dragon', 'not_dragon', 'uncertain'],
        description: '看图后的判断；首次处理带图投稿时省略'
      },
      reply: {
        type: 'string',
        maxLength: 80,
        description: '仅 decision=not_dragon 时必填：针对这次投稿的一句短回复'
      }
    },
    required: ['messageId']
  },
  effect: 'external-write',
  parallelSafe: false,
  terminal: false,
  execute(ctx, args) {
    if (typeof ctx.longtimeCommand !== 'function') {
      return {
        content: '错误：longtime 系统工具尚未装配完成',
        isError: true,
        errorCode: 'LONGTIME_UNAVAILABLE',
        reportIncident: false
      };
    }
    return ctx.longtimeCommand(args || {});
  }
});
