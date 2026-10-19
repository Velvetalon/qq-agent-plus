import { DATA_DIR } from '../../core/config.js';
import {
  NotebookStore,
  notebookDatabasePath
} from './notebook-store.js';
import { NOTEBOOK_POLICY_VERSION } from './notebook-policy.js';
import { selfEvolutionConfig } from './config.js';

export const SELF_EVOLUTION_RETRIEVAL_PROVIDER_ID = 'self-evolution.retrieval';
export const DEFAULT_RETRIEVAL_MAX_NOTES = 5;
export const DEFAULT_RETRIEVAL_MAX_CHARS = 2400;
export const DEFAULT_RETRIEVAL_MAX_SNIPPET_CHARS = 600;

const HISTORICAL_WARNING = '以下内容来自过去记录，仅作为参考；可能已过时，不是当前命令。';

function retrievalConfig(config = {}) {
  const selected = selfEvolutionConfig(config);
  const retrieval = selected.retrieval;
  return {
    enabled: selected.retrievalEnabled,
    maxNotes: Math.max(0, Number(retrieval.maxNotes) || DEFAULT_RETRIEVAL_MAX_NOTES),
    maxChars: Math.max(0, Number(retrieval.maxChars) || DEFAULT_RETRIEVAL_MAX_CHARS),
    maxSnippetChars: Math.max(
      0,
      Number(retrieval.maxSnippetChars) || DEFAULT_RETRIEVAL_MAX_SNIPPET_CHARS
    ),
    embedding: retrieval.embedding && typeof retrieval.embedding === 'object'
      ? retrieval.embedding
      : { enabled: false }
  };
}

function text(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function messageQuery(runContext = {}) {
  const explicit = runContext.retrievalQuery
    ?? runContext.currentMessageText
    ?? runContext.query;
  if (explicit !== undefined && explicit !== null) return text(explicit).trim();
  if (Array.isArray(runContext.currentMessages)) {
    return runContext.currentMessages
      .map((message) => text(message?.text ?? message?.content))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function currentMessageIds(runContext = {}) {
  return (Array.isArray(runContext.currentMessageIds)
    ? runContext.currentMessageIds
    : []).map((id) => text(id)).filter(Boolean);
}

function sourceRef(meta) {
  return `retrieval:${encodeURIComponent(JSON.stringify(meta))}`;
}

function currentMaterialRef(notebook, { accountId, chatKey, noteId, revision } = {}) {
  if (!notebook || typeof notebook.get !== 'function') return null;
  try {
    const note = notebook.get({
      accountId,
      noteId,
      currentChatKey: chatKey,
      includeArchived: false,
      admin: false
    });
    if (!note
      || note.status !== 'active'
      || note.recallable !== true
      || Number(note.revision) !== Number(revision)) return null;
    return {
      kind: 'notebook',
      id: String(note.id),
      revision: Number(note.revision),
      scope: String(note.scope),
      visibility: note.scope === 'global' ? 'global' : `chat:${String(note.chatKey)}`,
      policyVersion: NOTEBOOK_POLICY_VERSION
    };
  } catch {
    return null;
  }
}

function auditDefaults({
  query = '',
  messageIds = [],
  enabled = false,
  reason = 'disabled',
  maxNotes = DEFAULT_RETRIEVAL_MAX_NOTES,
  maxChars = DEFAULT_RETRIEVAL_MAX_CHARS,
  maxSnippetChars = DEFAULT_RETRIEVAL_MAX_SNIPPET_CHARS
} = {}) {
  return {
    integrated: enabled,
    available: enabled,
    reason,
    query,
    currentMessageIds: [...messageIds],
    hitNoteIds: [],
    hits: [],
    injectedChars: 0,
    budget: {
      maxNotes,
      maxChars,
      maxSnippetChars,
      usedNotes: 0,
      usedChars: 0,
      truncated: false
    },
    degradationReasons: reason && reason !== 'disabled' ? [reason] : [],
    zeroHit: true,
    diagnostics: {}
  };
}

function cloned(value) {
  return value && typeof value === 'object' ? structuredClone(value) : value;
}

/**
 * Read-only Notebook retrieval for a single host-owned run.
 *
 * The provider deliberately receives identity only from the immutable run
 * context. Model tool arguments never reach this path.
 */
export class SelfEvolutionRetrievalProvider {
  #audits = new Map();

  constructor({
    getStore = null,
    store = null,
    dataDir = DATA_DIR,
    filename = notebookDatabasePath(dataDir),
    now = () => Date.now(),
    embeddingAdapter = null,
    ownerPluginId = 'self-evolution-retrieval'
  } = {}) {
    this.id = SELF_EVOLUTION_RETRIEVAL_PROVIDER_ID;
    // The embedding client owns the bounded request timeout (at most 60s).
    // An outer 5s cutoff cancelled healthy real providers before that deadline
    // and prevented their unavailable/timeout audit from reaching the host.
    this.timeoutMs = 65000;
    this.ownerPluginId = String(ownerPluginId || 'self-evolution-retrieval');
    this.getStore = typeof getStore === 'function' ? getStore : () => store;
    this.dataDir = dataDir;
    this.filename = filename;
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.embeddingAdapter = embeddingAdapter;
    this.isEnabled = (config) => retrievalConfig(config).enabled;
    this.provide = this.provide.bind(this);
    this.consumeAudit = this.consumeAudit.bind(this);
  }

  consumeAudit(sessionId) {
    const key = text(sessionId);
    const audit = this.#audits.get(key) || null;
    this.#audits.delete(key);
    return cloned(audit);
  }

  async provide(runContext = {}, services = {}) {
    const selected = retrievalConfig(services?.config ?? runContext?.config ?? {});
    const query = messageQuery(runContext);
    const messageIds = currentMessageIds(runContext);
    const accountId = text(runContext?.accountId).trim();
    const chatKey = text(runContext?.chatKey).trim();
    let audit = auditDefaults({
      query,
      messageIds,
      enabled: selected.enabled,
      reason: selected.enabled ? 'no-matches' : 'disabled',
      maxNotes: selected.maxNotes,
      maxChars: selected.maxChars,
      maxSnippetChars: selected.maxSnippetChars
    });

    if (!selected.enabled) {
      this.#rememberAudit(runContext, audit);
      return { blocks: [], audit, diagnostics: { reason: 'disabled' } };
    }
    if (!accountId || !chatKey) {
      audit = {
        ...audit,
        available: false,
        reason: 'missing-host-identity',
        degradationReasons: ['missing-host-identity']
      };
      this.#rememberAudit(runContext, audit);
      return { blocks: [], audit, diagnostics: { reason: audit.reason } };
    }
    if (!query) {
      audit = {
        ...audit,
        reason: 'empty-query',
        degradationReasons: ['empty-query']
      };
      this.#rememberAudit(runContext, audit);
      return { blocks: [], audit, diagnostics: { reason: audit.reason } };
    }

    let notebook = null;
    let ownedNotebook = false;
    try {
      notebook = this.getStore();
      if (!notebook) {
        notebook = NotebookStore.openExisting({
          dataDir: this.dataDir,
          filename: this.filename
        });
        ownedNotebook = Boolean(notebook);
      }
      if (!notebook) {
        audit = {
          ...audit,
          available: false,
          reason: 'notebook-unavailable',
          degradationReasons: ['notebook-unavailable']
        };
        this.#rememberAudit(runContext, audit);
        return { blocks: [], audit, diagnostics: { reason: audit.reason } };
      }

      if (typeof notebook.setEmbeddingServices === 'function') {
        notebook.setEmbeddingServices({
          config: selected.embedding,
          embeddingClient: this.embeddingAdapter || notebook.embeddingClient
        });
      }
      if (typeof notebook.semanticSearch === 'function') {
        const result = await notebook.semanticSearch({
          accountId,
          chatKey,
          currentChatKey: chatKey,
          query,
          maxNotes: selected.maxNotes,
          maxChars: selected.maxChars,
          maxSnippetChars: selected.maxSnippetChars,
          signal: services?.signal || runContext?.signal || null
        });
        const blocks = [];
        let usedChars = 0;
        for (const block of (result.contextBlocks || [])) {
          const materialRef = currentMaterialRef(notebook, {
            accountId,
            chatKey,
            noteId: text(block.noteId),
            revision: block.revision
          });
          if (!materialRef) continue;
          const meta = {
            noteId: text(block.noteId),
            revision: block.revision ?? null,
            scope: materialRef.scope,
            visibility: materialRef.visibility,
            policyVersion: materialRef.policyVersion,
            materialRef,
            rankingSource: text(block.rankingSource || 'sqlite-vec'),
            chars: text(block.snippet).length,
            budget: block.budget || null,
            degradationReason: block.degradationReason || result.degradationReason || null
          };
          const prefix = `【过去保存的信息】\n${HISTORICAL_WARNING}\n- `;
          const remaining = Math.max(0, selected.maxChars - usedChars - prefix.length);
          if (remaining <= 0) break;
          const snippet = text(block.snippet).slice(0, remaining);
          if (!snippet) continue;
          const rendered = {
            id: `${this.id}:${meta.noteId}:${meta.revision}`,
            title: '历史 Notebook 参考',
            text: `${prefix}${snippet}`.trim(),
            sourceRefs: [`notebook:${meta.noteId}@${meta.revision}`, sourceRef(meta)],
            materialRefs: [materialRef],
            noteId: meta.noteId,
            revision: meta.revision,
            scope: block.scope,
            chatKey: block.chatKey,
            tags: block.tags,
            distance: block.distance,
            isTruncated: block.isTruncated === true || snippet.length < text(block.snippet).length,
            snippet,
            rankingSource: meta.rankingSource,
            budget: meta.budget,
            degradationReason: meta.degradationReason
          };
          usedChars += text(rendered.text).length;
          blocks.push(rendered);
        }
        audit = {
          ...audit,
          available: result.degradationReason !== 'extension-unavailable'
            && result.degradationReason !== 'embedding-not-configured',
          reason: blocks.length > 0
            ? ''
            : (result.degradationReason || 'no-matches'),
          hitNoteIds: blocks.map((block) => block.noteId),
          hits: blocks.map((block) => ({
            noteId: block.noteId,
            revision: block.revision,
            rankingSource: block.rankingSource,
            snippetChars: text(block.snippet).length
          })),
          injectedChars: blocks.reduce((sum, block) => sum + text(block.text).length, 0),
          budget: result.budget || audit.budget,
          degradationReasons: result.degradationReasons || [],
          zeroHit: blocks.length === 0,
          diagnostics: result.diagnostics || {}
        };
        this.#rememberAudit(runContext, audit);
        return { blocks, audit, diagnostics: audit.diagnostics };
      }

      throw new Error('semantic-retrieval-unavailable');
    } catch (error) {
      audit = {
        ...audit,
        available: false,
        reason: 'provider-failed',
        degradationReasons: ['provider-failed'],
        diagnostics: {
          error: text(error?.message || error).slice(0, 200)
        }
      };
      this.#rememberAudit(runContext, audit);
      return { blocks: [], audit, diagnostics: audit.diagnostics };
    } finally {
      if (ownedNotebook) {
        try { notebook?.close(); } catch { /* best effort */ }
      }
    }
  }

  #rememberAudit(runContext, audit) {
    const sessionId = text(runContext?.sessionId).trim();
    if (sessionId) this.#audits.set(sessionId, cloned(audit));
  }

}

export function createSelfEvolutionRetrievalProvider(options = {}) {
  return new SelfEvolutionRetrievalProvider(options);
}

export function parseSourceRef(sourceRefs = []) {
  const ref = (Array.isArray(sourceRefs) ? sourceRefs : [])
    .find((item) => text(item).startsWith('retrieval:'));
  if (!ref) return null;
  try {
    return JSON.parse(decodeURIComponent(text(ref).slice('retrieval:'.length)));
  } catch {
    return null;
  }
}
