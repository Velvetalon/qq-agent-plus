import { buildToolDefs } from '../../tools/tools-core.js';
import { decorateLegacyTool } from './legacy-tools.js';

const TOOLS = new Set(['send_message', 'send_sticker', 'send_face', 'send_poke']);

export const messagingPlugin = Object.freeze({
  id: 'messaging',
  name: 'Messaging',
  version: '1.0.0',
  apiVersion: 1,
  required: true,
  declare(registrar) {
    registrar.addTools(buildToolDefs()
      .map((tool, index) => ({ ...tool, order: index }))
      .filter((tool) => TOOLS.has(tool.name))
      .map((tool) => decorateLegacyTool(tool, 'messaging')));
  }
});

