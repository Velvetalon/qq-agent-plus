import { parseSourceRef } from '../plugins/self-evolution/retrieval-provider.js';

const MAX_SOCIAL_MATERIAL_REFS = 128;

export function buildSocialMaterialRefs(blocks = [], { accountId, chatKey } = {}) {
  const currentChatKey = String(chatKey || '');
  const refs = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const ref of Array.isArray(block?.materialRefs) ? block.materialRefs : []) {
      if (ref?.kind === 'learned-self'
        && String(ref.id) === String(accountId || '')
        && String(ref.revision || '') !== ''
        && Number.isSafeInteger(Number(ref.revision))
        && Number(ref.revision) >= 0
        && ref.scope === 'chat'
        && ref.visibility === `chat:${currentChatKey}`
        && ref.policyVersion === 'learned-self-v1') {
        refs.push({
          kind: 'learned-self',
          id: String(ref.id),
          revision: Number(ref.revision),
          scope: 'chat',
          visibility: `chat:${currentChatKey}`,
          policyVersion: 'learned-self-v1',
          traitKeys: Array.isArray(ref.traitKeys) ? [...ref.traitKeys] : [],
          expiresAt: ref.expiresAt
        });
      }
      if (ref?.kind === 'notebook'
        && String(ref.id || '').trim()
        && Number.isSafeInteger(Number(ref.revision))
        && Number(ref.revision) > 0
        && ['chat', 'global'].includes(String(ref.scope))
        && String(ref.visibility || '')
        && ref.policyVersion === 'notebook-memory-v2') {
        refs.push({
          kind: 'notebook',
          id: String(ref.id),
          revision: Number(ref.revision),
          scope: String(ref.scope),
          visibility: String(ref.visibility),
          policyVersion: 'notebook-memory-v2'
        });
      }
    }
    const source = parseSourceRef(block?.sourceRefs);
    const id = String(source?.noteId || '').trim();
    const revision = Number(source?.revision);
    if (!id || !Number.isSafeInteger(revision) || revision < 1) continue;
    const explicitRef = source?.materialRef && typeof source.materialRef === 'object'
      ? source.materialRef
      : null;
    if (explicitRef && (explicitRef.kind !== 'notebook'
      || explicitRef.policyVersion !== 'notebook-memory-v2')) continue;
    const scope = String(explicitRef?.scope || source?.scope || block?.scope || '');
    if (!['chat', 'global'].includes(scope)) continue;
    const visibility = scope === 'global'
      ? 'global'
      : String(explicitRef?.visibility || source?.visibility || block?.visibility || `chat:${currentChatKey}`);
    if (scope === 'chat' && visibility !== `chat:${currentChatKey}`) continue;
    refs.push({
      kind: 'notebook',
      id,
      revision,
      scope,
      visibility,
      policyVersion: 'notebook-memory-v2'
    });
  }
  // Keep an overflow entry so validation refuses instead of ignoring injected material.
  return [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()]
    .slice(0, MAX_SOCIAL_MATERIAL_REFS + 1);
}

export async function validateSocialMaterialRefs(validator, { accountId, chatKey, refs = [] } = {}) {
  if (!Array.isArray(refs) || refs.length > MAX_SOCIAL_MATERIAL_REFS) {
    return {
      valid: false,
      invalidRefs: Array.isArray(refs) ? refs.slice(0, MAX_SOCIAL_MATERIAL_REFS + 1) : [],
      reason: 'material_ref_limit_invalid'
    };
  }
  const materialRefs = refs;
  if (!materialRefs.length) return { valid: true, invalidRefs: [] };
  if (typeof validator !== 'function') return { valid: false, invalidRefs: materialRefs, reason: 'material_validator_unavailable' };
  let result;
  try {
    result = await validator({
      accountId: String(accountId || ''),
      chatKey: String(chatKey || ''),
      refs: materialRefs
    });
  } catch {
    return { valid: false, invalidRefs: materialRefs, reason: 'material_validation_failed' };
  }
  const invalidRefs = Array.isArray(result?.invalidRefs) ? result.invalidRefs : [];
  return {
    valid: result?.valid === true && invalidRefs.length === 0,
    invalidRefs,
    reason: result?.valid === true && invalidRefs.length === 0 ? '' : 'material_revision_invalid'
  };
}
