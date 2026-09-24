import { buildToolDefs } from '../../tools/tools-core.js';
import { decorateLegacyTool } from './legacy-tools.js';

const TOOLS = new Set(['memory_append', 'memory_query', 'person_memory_lookup', 'memory_remove']);

export const memoryToolsPlugin = Object.freeze({
  id: 'memory-tools',
  name: 'Memory tools',
  version: '1.0.0',
  apiVersion: 1,
  required: true,
  declare(registrar) {
    registrar.addTools(buildToolDefs()
      .map((tool, index) => ({ ...tool, order: index }))
      .filter((tool) => TOOLS.has(tool.name))
      .map((tool) => decorateLegacyTool(tool, 'memory-tools')));
  }
});

