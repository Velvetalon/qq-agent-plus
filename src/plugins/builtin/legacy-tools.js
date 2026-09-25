import { experimentalToolClass } from '../../pilots/experimental-tool-scheduler.js';
import { buildToolDefs } from '../../tools/tools-core.js';

const EXTERNAL_WRITE_TOOLS = new Set([
  'send_message',
  'send_sticker',
  'send_face',
  'send_poke',
  'friend_request_propose'
]);

const LOCAL_WRITE_TOOLS = new Set([
  'sticker_note',
  'collect_sticker',
  'schedule_wake',
  'memory_append',
  'memory_remove',
  'report_feedback'
]);

function legacyEffect(name) {
  if (EXTERNAL_WRITE_TOOLS.has(name)) return 'external-write';
  if (LOCAL_WRITE_TOOLS.has(name)) return 'local-write';
  if (name === 'finish' || name === 'stay_silent') return 'control';
  return 'read';
}

export function decorateLegacyTool(tool, ownerPluginId = 'legacy-tools', { terminal = false } = {}) {
  const schedulerClass = experimentalToolClass(tool.name);
  return {
    ...tool,
    ownerPluginId,
    effect: legacyEffect(tool.name),
    parallelSafe: schedulerClass === 'parallel-read',
    order: tool.order ?? undefined,
    terminal
  };
}

export function createLegacyToolsPlugin({ exclude = [] } = {}) {
  const excluded = new Set(exclude);
  return Object.freeze({
    id: 'legacy-tools',
    name: 'Legacy tools',
    version: '1.0.0',
    apiVersion: 1,
    required: true,
    declare(registrar) {
      registrar.addTools(buildToolDefs()
        .map((tool, index) => ({ ...tool, order: index }))
        .filter((tool) => !excluded.has(tool.name))
        .map((tool) => decorateLegacyTool(tool)));
    }
  });
}

export const legacyToolsPlugin = Object.freeze({
  id: 'legacy-tools',
  name: 'Legacy tools',
  version: '1.0.0',
  apiVersion: 1,
  required: true,
  declare(registrar) {
    registrar.addTools(buildToolDefs()
      .map((tool, index) => decorateLegacyTool({ ...tool, order: index })));
  }
});
