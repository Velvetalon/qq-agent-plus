import { buildToolDefs } from '../../tools/tools-core.js';
import { decorateLegacyTool } from './legacy-tools.js';
import { staySilentTool } from './runtime-control-tools.js';

const TOOLS = new Set(['schedule_wake', 'finish']);

export const runtimeControlPlugin = Object.freeze({
  id: 'runtime-control',
  name: 'Runtime control',
  version: '1.1.0',
  apiVersion: 1,
  required: true,
  declare(registrar) {
    registrar.addTools(buildToolDefs()
      .map((tool, index) => ({ ...tool, order: index }))
      .filter((tool) => TOOLS.has(tool.name))
      .map((tool) => decorateLegacyTool(tool, 'runtime-control', { terminal: tool.name === 'finish' })));
    registrar.addTools({
      ...staySilentTool,
      ownerPluginId: 'runtime-control',
      order: 1000
    });
  }
});
