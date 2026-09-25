import crypto from 'node:crypto';
import { DATA_DIR } from '../../core/config.js';
import {
  DEFAULT_NOTEBOOK_LIMITS,
  NotebookError,
  NotebookStore,
  SELF_EVOLUTION_PLUGIN_ID,
  notebookDatabasePath
} from '../self-evolution/notebook-store.js';

function ok(value) {
  return { content: JSON.stringify(value) };
}

function errorResult(error) {
  const normalized = error instanceof NotebookError
    ? error
    : new NotebookError('NOTEBOOK_ERROR', String(error?.message || error));
  return {
    content: `错误：${normalized.message}`,
    isError: true,
    errorCode: normalized.code,
    saved: false
  };
}

function configForPlugin(config = {}) {
  return config?.selfEvolution
    || config?.plugins?.selfEvolution
    || config?.plugins?.['self-evolution']
    || {};
}

function pluginEnabled(config = {}) {
  return configForPlugin(config).enabled === true;
}

function hostIdempotencyKey(ctx, action, args) {
  const explicit = ctx?.idempotencyKey || ctx?.toolCallId || ctx?.session?.toolCallId;
  if (explicit) return `host:${String(explicit).slice(0, 220)}`;
  const runId = ctx?.runId || ctx?.sessionId || ctx?.session?.leaseId || ctx?.session?.id;
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({ action, args }))
    .digest('hex')
    .slice(0, 32);
  return `run:${String(runId || 'anonymous').slice(0, 120)}:${action}:${digest}`;
}

function toolSource(ctx) {
  return {
    kind: 'chat',
    accountId: String(ctx?.accountId || 'default'),
    chatKey: String(ctx?.chatKey || ''),
    sessionId: String(ctx?.sessionId || ctx?.session?.id || ''),
    runId: String(ctx?.runId || ctx?.session?.leaseId || ctx?.session?.id || ''),
    toolCallId: String(ctx?.toolCallId || ctx?.session?.toolCallId || '')
  };
}

function contentOrBody(args) {
  const hasContent = Object.hasOwn(args, 'content');
  const hasBody = Object.hasOwn(args, 'body');
  if (hasContent && hasBody && args.content !== args.body) {
    throw new NotebookError('NOTEBOOK_INVALID_ARGUMENT', 'content 与 body 不能同时指向不同正文');
  }
  return hasContent ? args.content : args.body;
}

function makeTools(getStore) {
  return [
    {
      name: 'notebook_append',
      description: '把一条长期有效的事实、偏好或经验写入 Notebook。正文只写可复用内容；scope 可选 global 或当前 chat。写入是本地持久化，不会向聊天发送消息。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Notebook 正文；最多 4000 字符' },
          body: { type: 'string', description: 'content 的兼容别名；不要与 content 同时使用' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选标签；标签不能改变可见范围' },
          scope: { type: 'string', enum: ['global', 'chat'], description: 'global=账号共享；chat=当前会话' }
        },
        required: ['content'],
        additionalProperties: false
      },
      ownerPluginId: SELF_EVOLUTION_PLUGIN_ID,
      effect: 'local-write',
      parallelSafe: false,
      terminal: false,
      order: 80,
      async execute(ctx, args = {}) {
        const store = getStore();
        if (!store) return errorResult(new NotebookError('NOTEBOOK_DISABLED', 'self-evolution Notebook 当前未启用'));
        try {
          const source = toolSource(ctx);
          const result = store.append({
            accountId: source.accountId,
            scope: args.scope,
            content: contentOrBody(args),
            tags: args.tags,
            source,
            currentChatKey: source.chatKey,
            idempotencyKey: hostIdempotencyKey(ctx, 'append', args)
          });
          return ok(result);
        } catch (error) {
          return errorResult(error);
        }
      }
    },
    {
      name: 'notebook_search',
      description: '搜索当前账号可见的 Notebook。聊天中只能看到 global 与当前 chat 的 active 条目；tags 只是过滤条件，不能扩大 scope。归档条目不会被召回。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选关键词；不填则列出可见 Notebook' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选标签过滤' },
          scope: { type: 'string', enum: ['global', 'chat'], description: '可选；chat 只能指向当前会话' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: '最多返回条数，默认 20' }
        },
        additionalProperties: false
      },
      ownerPluginId: SELF_EVOLUTION_PLUGIN_ID,
      effect: 'read',
      parallelSafe: true,
      terminal: false,
      order: 81,
      async execute(ctx, args = {}) {
        const store = getStore();
        if (!store) return errorResult(new NotebookError('NOTEBOOK_DISABLED', 'self-evolution Notebook 当前未启用'));
        try {
          const source = toolSource(ctx);
          return ok(store.search({
            accountId: source.accountId,
            currentChatKey: source.chatKey,
            scope: args.scope,
            query: args.query,
            tags: args.tags,
            limit: args.limit,
            includeArchived: false,
            admin: false
          }));
        } catch (error) {
          return errorResult(error);
        }
      }
    },
    {
      name: 'notebook_update',
      description: '按 noteId 与 expectedRevision 原子编辑 Notebook。revision 不匹配时拒绝并保留原正文，必须重新搜索后重试。',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
          expectedRevision: { type: 'integer', minimum: 1 },
          content: { type: 'string', description: '新的正文；最多 4000 字符' },
          body: { type: 'string', description: 'content 的兼容别名；不要与 content 同时使用' },
          tags: { type: 'array', items: { type: 'string' }, description: '新的完整标签数组' }
        },
        required: ['noteId', 'expectedRevision'],
        additionalProperties: false
      },
      ownerPluginId: SELF_EVOLUTION_PLUGIN_ID,
      effect: 'local-write',
      parallelSafe: false,
      terminal: false,
      order: 82,
      async execute(ctx, args = {}) {
        const store = getStore();
        if (!store) return errorResult(new NotebookError('NOTEBOOK_DISABLED', 'self-evolution Notebook 当前未启用'));
        try {
          const source = toolSource(ctx);
          return ok(store.update({
            accountId: source.accountId,
            noteId: args.noteId,
            expectedRevision: args.expectedRevision,
            content: Object.hasOwn(args, 'content') ? args.content : undefined,
            body: Object.hasOwn(args, 'body') ? args.body : undefined,
            tags: args.tags,
            source,
            currentChatKey: source.chatKey,
            idempotencyKey: hostIdempotencyKey(ctx, 'update', args)
          }));
        } catch (error) {
          return errorResult(error);
        }
      }
    },
    {
      name: 'notebook_archive',
      description: '按 noteId 与 expectedRevision 归档 Notebook。归档保留完整版本历史，但从搜索召回中排除，不执行硬删除。',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
          expectedRevision: { type: 'integer', minimum: 1 }
        },
        required: ['noteId', 'expectedRevision'],
        additionalProperties: false
      },
      ownerPluginId: SELF_EVOLUTION_PLUGIN_ID,
      effect: 'local-write',
      parallelSafe: false,
      terminal: false,
      order: 83,
      async execute(ctx, args = {}) {
        const store = getStore();
        if (!store) return errorResult(new NotebookError('NOTEBOOK_DISABLED', 'self-evolution Notebook 当前未启用'));
        try {
          const source = toolSource(ctx);
          return ok(store.archive({
            accountId: source.accountId,
            noteId: args.noteId,
            expectedRevision: args.expectedRevision,
            source,
            currentChatKey: source.chatKey,
            idempotencyKey: hostIdempotencyKey(ctx, 'archive', args)
          }));
        } catch (error) {
          return errorResult(error);
        }
      }
    }
  ];
}

export function createSelfEvolutionPlugin({
  dataDir = DATA_DIR,
  filename = notebookDatabasePath(dataDir),
  limits = DEFAULT_NOTEBOOK_LIMITS,
  now
} = {}) {
  let store = null;
  const tools = makeTools(() => store);
  const plugin = {
    id: SELF_EVOLUTION_PLUGIN_ID,
    name: 'Self-evolution Notebook',
    version: '1.0.0',
    apiVersion: 1,
    enabled: true,
    isEnabled: pluginEnabled,
    declare(registrar) {
      registrar.addTools(tools);
    },
    start(_services, config = {}) {
      if (store) return store;
      store = new NotebookStore({
        dataDir,
        filename,
        limits: { ...limits, ...configForPlugin(config).limits },
        now
      });
      return store;
    },
    stop() {
      store?.close();
      store = null;
    },
    getStore() {
      return store;
    }
  };
  return Object.freeze(plugin);
}

export const selfEvolutionPlugin = createSelfEvolutionPlugin();

export function openSelfEvolutionNotebook(options = {}) {
  return NotebookStore.openExisting(options);
}
