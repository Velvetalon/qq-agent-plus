import { longtimeTool } from './runtime-control-tools.js';

export const longtimePlugin = Object.freeze({
  id: 'longtime',
  name: '龙time',
  version: '1.0.0',
  apiVersion: 1,
  required: true,
  declare(registrar) {
    registrar.addTools({
      ...longtimeTool,
      ownerPluginId: 'longtime',
      order: 1001
    });
  }
});
