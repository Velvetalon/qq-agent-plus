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
