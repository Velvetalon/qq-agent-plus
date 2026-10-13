# Social WIP Takeover Contract V1

Date: 2026-10-13, Asia/Hong_Kong.
Baseline: `8233c83c5839a4e8fcc563302769d3569898332a`.
Authority: user explicitly requested takeover and continued development.
This contract implements the three existing 2026-10-13 social plans, not a
replacement product design. Production actions remain excluded.

## SC0 Evidence

- Tracked checkout clean; untracked `NEED_HELP.md` preserved.
- Node: `E:\node22\node.exe`, 22.22.2.
- State/console/config baseline: 17 PASS, exit 0.
- Shared focused baseline: 90 PASS, 23 FAIL, exit 1. Evidence log is outside
  Git in the current chat's `work/social-sc0-baseline.log`.
- Verified producer gaps: Orchestrator success/failure events v2; Planner
  excludes share/react; no caller of claimDue; blanket topic invalidation;
  interactionId=sessionId; legacy callback removes deliveryGuard.
- Verified memory gaps: per-item reject state accounting, direct model-facing
  reads bypass policy, no cleanup CLI, default evidence accumulation not
  proven through the real producer. Existing v2/auto-apply tests conflict
  with the new review-only contract and must be migrated, not bypassed.

## Ownership

- Runtime writer: `src/conversation/*`, `src/core/orchestrator.js`,
  `src/core/store.js` (only completion queue schema preservation),
  `src/plugins/context.js`, `src/onebot/sender.js`; tests social-state/runtime,
  orchestrator, delivery-integration and plugin-tool-context.
- Memory writer: `src/plugins/self-evolution/*`, `src/plugins/manager.js`,
  `src/plugins/builtin/self-evolution.js`,
  `scripts/notebook-memory-cleanup.mjs`; social-memory and existing
  self-evolution/learned-self/functional-repair tests.
- Coordinator: configuration, sessions, console, UI, portable progress,
  integration acceptance and decision arbitration.
- Agents do not write canonical checkpoints, read credential outputs or
  contact production. Independent review does not edit production code.
- No commits, pushes, deployments, runtime mode changes, external model calls
  or QQ actions are implied.

## Event Contract

Real completion events carry schemaVersion=3 and evidenceVersion=3,
accountId/chatKey/sessionId/runId/triggerKind/proactive, topicId,
interactionId, deliveryState, delivered, originalSourceIds and bounded
conversationEvidence. item.originalSourceId is the archived original source;
messageId is local storage ID and platformMessageId is QQ ID.
Manager.buildCompletionEvents accepts/preserves schemaVersion,
originalSourceIds, deliveryState and item.platformMessageId in addition to
existing singular aliases. Missing values remain missing; Manager never
manufactures role/causal/confirmation facts.

Actual integration audit found extension_events persists action_summary but
drops v3 top-level facts. Queue preservation is a host Store responsibility:
persist schemaVersion/evidenceVersion/trigger/proactive/interaction/topic/
originalSourceIds/deliveryState/delivered inside existing action_summary
and rehydrate those same verified fields on claim (or additive event payload
storage if needed). Missing legacy schema remains <=2; do not promote rows
using evidenceVersion alone. lease/ack and event idempotency semantics stay
unchanged. Runtime writer owns this scoped Store repair; Manager supplies
schemaVersion in actionSummary as well as top-level for compatibility.

Optional host feedback schema:
`explicitFeedback:{feedbackId,sourceRef,targetSourceRef,
targetKind:'trait'|'candidate',action:'confirm'|'correct'|'retract',value?}`.
sourceRef must resolve to an actual current user evidence item in the same
account/chat; targetSourceRef must resolve to an existing same-chat candidate
or adopted user-scoped trait. Unknown targets/sources or bot/global subjects
do not permit automatic correction. Confirm records support, never bypasses
review. Correct/retract may revoke an already wrong user-scoped statement
using current profile CAS; no model can manufacture this host feedback.
Absent/unrecognized feedback stays empty. Admin profile correction remains
the protected existing management route. Natural-language feedback can affect
current Replyer context without pretending a host-recorded correction exists.

Known human entries have role=user, sourceRecordType=message,
sourceRecordId, originalSourceId, interactionId, topicId and
userConfirmed=false absent a genuine structured feedback source.
Assistant entries have role=assistant, sourceRecordType=outbound,
delivered=true only for Sender-confirmed effects. Delivery never implies
human confirmation. No defaulting missing evidence role to user.

SocialStateStore owns persistent interactions tied to causal topic continuity,
not sessions/runs. Retry and split batches retain identity. Explicit replies
continue the target interaction; closed or genuinely new independent topic
opens another. Platform/local reply namespaces remain separate. IDs are
always scoped by account/chat. Preserve evidence still referenced by held,
pending and unresolved intents.

Legacy modes retain old conversation behavior. Where no verified interaction
identity exists, their evidence remains history/episode-only; do not invent
v3 qualifications for compatibility tests.

## Runtime Contract

Actions: reply/share/react/listen/wait/close. Canonical targetMessageIds is
bounded (max 8); one old targetMessageId is a supported input alias only.
Reply/react require real human targets. Share may have no targets but needs
verified sourceRefs: current human roots, a persisted scoped external
observation, or explicit configured/shared interest. No source is created
from model assertions. Models cannot set account/chat/permission fields.

Material refs: `{kind, id, revision, scope, visibility, policyVersion}`.
Notebook policy marker is `notebook-memory-v2`.
Orchestrator constructor gains optional injected callback:
`validateSocialMaterials({accountId, chatKey, refs}) -> {valid, invalidRefs}`.
createApp supplies it through existing NotebookStore lifecycle. No material
refs means valid without IO; refs with no validator must fail closed.
Runtime converts provider source metadata into refs, captures scoped
material revisions and validates after send-queue delay before outbox intent.

Planner can only execute effect=read tools. Replyer gets read tools and
explicit known guarded visible actions (messaging and verified #longtime);
never arbitrary plugin administrative/external writes. Guard is retained in
legacy contexts only when a social guarded host context is present, without
changing other legacy callbacks. Existing Sender/Outbox remains sole delivery
owner. Partial/unknown stops remaining visible actions; no whole-turn replay.

Extract coherent phase/context/event components from the oversized
Orchestrator; do not perform unrelated legacy rewrite. Both model phases and
at most one JSON-repair/replan share existing deadline and run token budget.
Replyer gets necessary Planner tool data/images as sourced bounded material,
not Planner transcript or hidden reasoning. No mandatory bubbles/questions.
no_output/listen are normal terminal outcomes.

Delivery relevance: known covered inputs do not invalidate a draft; explicit
withdrawal/correction or new critical reply to a target does. Unrelated topic
updates do not. One bounded replan is allowed; sustained changes defer to
the next actual incoming batch. Guard checks actual runtime mode/permission,
time, material version, intent lease token, cancellation and visible budget.

## Initiative Contract

State owns pending/leased/completed/cancelled/expired/held, sourceRefs,
causalRootId, evaluationAttempts and bounded postponements. External
observations are host recorded, same account/chat, finite TTL; never human
preference evidence. An empty tick performs zero model/network calls.
Reuse the existing scheduled ticker to call `runSocialIntentTick()`; expose
this async bounded tick for tests. Check scope, mode, permission, active run,
pending human messages and concurrency BEFORE claim.

Claims require lease ownership at resolve/send. Recovery: unknown/partial
effects stay held, proven zero effects may be cancelled or bounded retry.
An expired unanswered intent releases budget for new independent source, not
for recursive same-root rearming. Completed no-output is not unanswered
delivery. Only related human continuation marks a delivered initiative
answered. Mode-off cancels new execution without deleting state/history.
`getSocialStatus` reads initialized history while disabled without DDL or IO
effects; never-used GET does not create social tables.

## Memory Contract

Keep existing Notebook/Reflection boundaries. Ordinary meaningful episodes
can be saved from one interaction or silence; ineligible traits never discard
valid notes. Validate raw model output once at each trust boundary; do not
forward a normalized object as raw output. Persist rejected item codes,
references, status and actor, with accurate all-rejected/partial counts.

No legacy evidence or autoApplyBehaviorTraits setting qualifies a stable
trait. Behavior adopts only explicit review with profile CAS. Candidate
claims retain subject (user scoped identity or bot), support/counter refs,
independent roots/interactions, timestamps, TTL and status. Accumulation
uses same candidate and host roots, not arbitrary message totals. Models
select semantically supporting refs, host verifies provenance; no keyword
classifier claims semantic entailment. Global promotions remain denied
unless explicitly authorized abstract evidence exists.

Subject storage decision: retain the existing flat global/chat profile shape.
Bot subject uses the legacy logical key. User subjects use a private qualified
bucket key derived from logical key + hash(subject), retaining `key` and
`subject` metadata in the entry. This prevents Alice and Bob's same-name
preferences overwriting each other without adding a second profile engine.
User feedback resolves logical trait key only for that same current
user subject, never an arbitrary qualified entry. Source/correction metadata
and history expose both identifiers; old user-subject entries remain readable.
Provider labels logical key and subject and filters user preferences by
host visibleParticipants. Unknown-subject legacy entries are not implicitly
treated as adopted bot preferences in social context.

Social Replyer includes the adopted Learned Self provider as well as
Notebook retrieval; user preference is explicitly another user's preference,
not bot identity. Add `learned-self` MaterialRef
`{kind:'learned-self',id:accountId,revision:headRevision,scope:'chat',
visibility:'chat:<chatKey>',policyVersion:'learned-self-v1'}` for injected
adopted preference blocks. Coordinator's assembly callback dispatches
Notebook refs to NotebookStore and Learned Self refs to existing
ReflectionStore context/revision/base-persona checks. Unknown kinds fail
closed. Changing/correcting/expiring an injected profile invalidates its
material before send. No extra model or network call is introduced.
Learned Self refs additionally carry bounded `traitKeys` (physical storage
keys actually injected, <=12) and `expiresAt` (earliest finite expiry of
those injected entries). Manager preserves these allowlisted materialRefs;
runtime carries them unchanged. Reflection validator checks every referenced
entry is still active and current, not merely "some preference remains".
This prevents an expired Alice trait surviving because unrelated Bob traits
are still active. Missing required learned-self traitKeys fails closed.

Structured explicit feedback can revoke an old candidate/current trait.
No false automatic user confirmation from preference-looking text.
Source pool stays bounded, scoped and current. Review revalidates evidence,
policy, expiry and CAS. Pending insufficient evidence stays visible but
not adoptable; invalid/procedural proposals are rejected audibly.

Candidate management surfaces reuse ReflectionStore proposal identity:
`listCandidates({accountId,chatKey='',status='pending',limit=100})` and
`reviewCandidate({proposalId,decision,actor,expectedProfileRevision,
basePersonaHash,basePersona})`. Single approval only changes that trait and
then reconciles containing batch status. Caller must verify proposal belongs
to the host account and allowed chat before review. Global candidates have
no implicit approval route. List results include safe current revision,
subject, supporting/counter refs, root/interaction counts, eligible state,
expiry and structured rejection reasons, not raw hidden reasoning.

Notebook audit/admin reads can inspect operational notes. Nonadmin
model-facing get/search/semantic/reflection reads all apply the same current
recall policy. Technical descriptions of retry/queue/result=120 are allowed;
self-directed execution rules are operational. Type/tag/source=system cannot
grant model bypass. Archive increments revision so vectors/cache/guard stop
using old data.

NotebookStore gains:
`validateMaterialRefs({accountId,currentChatKey,refs}) -> {valid,invalidRefs}`.
Only refs for active, visible, recallable current revision and current
policyVersion are valid. No DDL for read-only validation.
Canonical visibility is `global` or `chat:<chatKey>`.

Cleanup CLI uses explicit existing database/account, default dry-run,
portable bounded manifest {policyVersion,account,items:[id,revision,reason]}.
Apply needs confirm/actor and reclassifies current content plus exact CAS for
each item; unrelated/current legal notes are never archived. No deletes or
raw production text in Git. Return per-item outcomes; existing archive
history and correction API are rollback path.

## Acceptance and Return Conditions

Target hard tests: A-E, A-P, A-R, A-I, A-D, A-M, A-L, A-C and A-H from existing
acceptance document. New social-runtime/social-memory suites must include real
Orchestrator/Manager flow, not injected shared reflection window IDs.
Boundary HTTP can be stubbed; internal state, plugin assembly, guard, worker,
SQL, source pool and CAS must be real.

Update old fixtures only where their expectation conflicts with approved
new semantics; retain safety/race assertions. Preserve historical verification
docs; append new verified results to social-engine-closure.md. Windows EBUSY
cleanup must close fixture handles, not skip assertions.

Return NEEDS_DESIGN for changes to scope, adoption, public material/intent
contract, new services or external spending. Stop a delegated task on verified
scope completion and return files, commands/exit codes, evidence, residual
gaps and candidate digest. Final coordinator acceptance requires independent
read-only review and at least one adversarial/integration check.
