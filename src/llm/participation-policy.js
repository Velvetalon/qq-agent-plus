import { notebookCapabilityText as roleNotebookCapabilityText } from '../plugins/self-evolution/notebook-policy.js';

// Reply/silence decisions are administrator-configured behavior, not language style.
export function participationPolicyText(level = 'medium') {
  const mode = String(level || 'medium');
  const trigger = mode === 'low'
    ? '低参与配置：优先保持沉默，仅在管理员配置的触发条件、明确点名或必要事项下考虑发送。'
    : mode === 'high'
      ? '高参与配置：允许更广的触发范围，但仍须遵守来源、工具和发送边界。'
      : '中参与配置：按触发条件和消息相关性决定是否发送。';
  return [
    '【参与度配置（管理员）】',
    `- ${trigger}`,
    '- 被 @、直接提问、关键词或其他触发条件命中时，依据当前上下文判断；误 @、无新增内容、话题已解决或不符合配置时可以沉默。',
    '- 发送只能通过可用工具；普通正文只是草稿。决定不发送时调用 stay_silent，并填写准确的 reasonCode 与 threadDisposition。',
    '- follow-up 或 schedule_wake 仅在有明确的新事项且符合工具协议时使用。'
  ].join('\n');
}

export function notebookCapabilityText(enabled = false) {
  return roleNotebookCapabilityText(enabled);
}
